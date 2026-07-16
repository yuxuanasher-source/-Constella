import { z } from "zod";

import type {
  AiExecutionActor,
  AiProvider,
  AiProviderName,
} from "@/features/ai/contracts";
import {
  createAiInvocationId,
  recordAiInvocation,
} from "@/features/ai/invocation-ledger";
import { runAiGateway } from "@/features/ai/llm-gateway";
import {
  createConfiguredAiProviders,
  resolveAiProviderRouting,
} from "@/features/ai/provider-registry";
import {
  createDoubaoAsrProvider,
  isDoubaoAsrConfigured,
  readDoubaoAsrConfigFromEnv,
  type DoubaoAsrProvider,
  type DoubaoAsrUtterance,
} from "@/features/ai/providers/doubao-asr-provider";
import { getPrivateStorageBucket } from "@/lib/config/env";

import type {
  RecordingAiAnalysisDraft,
  RecordingAiDimensionKey,
} from "./recording-ai-analysis";
import type { RecordingAssetDto } from "./recording-assets";
import { extractRecordingAudioFromStorage } from "./recording-audio-extraction";

// 录屏 AI 分析流水线：上传的录屏文件 -> ffmpeg 抽音频 -> 豆包 ASR 转文字
// -> DeepSeek（经 llm-gateway，主/备/降级同一套路由）生成结构化分析草稿。
// 任一环节失败由调用方（runner）回退到确定性草稿，分析任务本身不失败。
// 返回 null 表示「本资产不适用流水线」（无原始文件 / ASR 未配置），静默回退。

const PROMPT_KEY = "recording.analyze_asset";
const PROMPT_VERSION = 1;
const ASR_SCENE = "recording.transcribe_asset";
// 火山录音识别按时长计费（约 0.8 元/小时），折算成「分」记入台账。
const ASR_COST_CENTS_PER_HOUR = 80;
// 转写全文进 prompt 的截断阈值：保头保尾，中间标注省略。
const TRANSCRIPT_HEAD_CHARS = 9_000;
const TRANSCRIPT_TAIL_CHARS = 3_000;
const MAX_PROMPT_UTTERANCES = 120;

const REVIEW_BOUNDARY =
  "AI 分析仅作为审核辅助，不自动通过、不自动拒绝，也不自动修改主播画像；关键结论必须由人工审核确认。";

export type RecordingAiPipelineResult = {
  draft: RecordingAiAnalysisDraft;
  providerName: AiProviderName;
  asrProvider: string;
  transcriptText: string;
  transcriptUtterances: DoubaoAsrUtterance[];
};

export type RecordingAiPipelineStage =
  | "extracting_audio"
  | "transcribing"
  | "analyzing"
  | "generating_report";

export type RecordingAiDraftPipeline = (input: {
  asset: RecordingAssetDto;
  signal?: AbortSignal;
  onStage?: (stage: RecordingAiPipelineStage) => Promise<void> | void;
}) => Promise<RecordingAiPipelineResult | null>;

type LedgerClient = Parameters<typeof recordAiInvocation>[0]["client"];

type StorageClient = Parameters<
  typeof extractRecordingAudioFromStorage
>[0]["client"];

const scoreSchema = z.number().min(0).max(100);

const dimensionKeySchema = z.enum([
  "rhythm",
  "script",
  "interaction",
  "media_quality",
  "compliance",
  "project_match",
]);

const llmDraftSchema = z.object({
  summary: z.string().trim().min(1),
  scorecard: z.object({
    rhythm: scoreSchema,
    script: scoreSchema,
    interaction: scoreSchema,
    media_quality: scoreSchema,
    compliance: scoreSchema,
    project_match: scoreSchema,
  }),
  dimensions: z
    .array(
      z.object({
        key: dimensionKeySchema,
        label: z.string().trim().min(1),
        score: scoreSchema,
        finding: z.string().trim().min(1),
      }),
    )
    .min(1),
  riskFlags: z.array(z.string().trim().min(1)),
  recommendations: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        detail: z.string().trim().min(1),
      }),
    )
    .min(1),
  segments: z
    .array(
      z.object({
        segmentKind: z.string().trim().min(1),
        startSeconds: z.number().min(0),
        endSeconds: z.number().min(0),
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        riskLevel: z.enum(["low", "medium", "high"]),
      }),
    )
    .min(1),
});

type LlmDraftOutput = z.infer<typeof llmDraftSchema>;

/**
 * 组装默认流水线。返回 null 表示先决条件不满足（豆包 ASR 未配置，或没有任何
 * 真实 LLM provider），runner 直接走确定性草稿，行为与流水线出现前完全一致。
 */
export function createRecordingAiAnalysisPipeline({
  client,
  actor,
  env = process.env,
  asr,
  providers,
  extractAudio = extractRecordingAudioFromStorage,
  runGateway = runAiGateway,
  recordInvocation = recordAiInvocation,
}: {
  client: LedgerClient & StorageClient;
  actor: AiExecutionActor;
  env?: Record<string, string | undefined>;
  asr?: DoubaoAsrProvider;
  providers?: AiProvider[];
  extractAudio?: typeof extractRecordingAudioFromStorage;
  runGateway?: typeof runAiGateway;
  recordInvocation?: typeof recordAiInvocation;
}): RecordingAiDraftPipeline | null {
  const asrConfig = readDoubaoAsrConfigFromEnv(env);
  const resolvedAsr =
    asr ??
    (isDoubaoAsrConfigured(asrConfig)
      ? createDoubaoAsrProvider(asrConfig)
      : null);
  if (!resolvedAsr) {
    return null;
  }

  const resolvedProviders = providers ?? createConfiguredAiProviders({ env });
  const hasRealStructuredProvider = resolvedProviders.some(
    (provider) =>
      provider.name !== "deterministic" &&
      provider.capabilities.includes("structured"),
  );
  if (!hasRealStructuredProvider) {
    return null;
  }

  const routing = resolveAiProviderRouting(env);
  const bucket = getPrivateStorageBucket(env);

  return async ({ asset, signal, onStage }) => {
    const storagePath = resolveStoragePath(asset);
    if (!storagePath) {
      // B 站 / 外部链接没有可下载的原始文件，不代理抓取，静默回退。
      return null;
    }

    await onStage?.("extracting_audio");
    throwIfAborted(signal);
    const audio = await extractAudio({ client, bucket, storagePath, signal });
    throwIfAborted(signal);

    await onStage?.("transcribing");
    const transcript = await transcribeExtractedAudio({
      asr: resolvedAsr,
      audioBase64: audio.audioBase64,
      format: audio.format,
      asset,
      client,
      actor,
      recordInvocation,
    });
    if (transcript === null) {
      return null;
    }

    throwIfAborted(signal);
    await onStage?.("analyzing");
    const { draft, providerName } = await buildLlmDraft({
      asset,
      transcript,
      providers: resolvedProviders,
      primaryProvider: routing.primaryProvider,
      client,
      actor,
      runGateway,
      recordInvocation,
    });

    await onStage?.("generating_report");
    return {
      draft,
      providerName,
      asrProvider: "doubao_asr",
      transcriptText: transcript.text,
      transcriptUtterances: transcript.utterances,
    };
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Recording AI analysis was cancelled", "AbortError");
  }
}

type TranscriptResult = {
  text: string;
  utterances: DoubaoAsrUtterance[];
  durationSeconds: number | null;
};

async function transcribeExtractedAudio({
  asr,
  audioBase64,
  format,
  asset,
  client,
  actor,
  recordInvocation,
}: {
  asr: DoubaoAsrProvider;
  audioBase64: string;
  format: string;
  asset: RecordingAssetDto;
  client: LedgerClient;
  actor: AiExecutionActor;
  recordInvocation: typeof recordAiInvocation;
}): Promise<TranscriptResult | null> {
  const result = await asr.recognizeAudio({ audioBase64, format });

  await recordInvocation({
    client,
    actor,
    input: {
      id: createAiInvocationId(),
      scene: ASR_SCENE,
      objectType: "recording_asset",
      objectId: asset.id,
      providerName: "doubao_asr",
      status: result.status,
      latencyMs: result.latencyMs,
      costCents:
        result.status === "succeeded" && result.durationSeconds
          ? Math.ceil(
              (result.durationSeconds / 3600) * ASR_COST_CENTS_PER_HOUR,
            )
          : 0,
      degradedReason: result.degradedReason,
      errorSummary: result.errorSummary,
      metadata: {
        requestId: result.requestId,
        durationSeconds: result.durationSeconds,
        utteranceCount: result.utterances.length,
      },
    },
  });

  if (result.status === "degraded") {
    return null;
  }
  if (result.status === "failed") {
    throw new Error(result.errorSummary ?? "Doubao ASR failed");
  }
  if (!result.text.trim()) {
    throw new Error("Doubao ASR returned an empty transcript");
  }

  return {
    text: result.text,
    utterances: result.utterances,
    durationSeconds: result.durationSeconds,
  };
}

async function buildLlmDraft({
  asset,
  transcript,
  providers,
  primaryProvider,
  client,
  actor,
  runGateway,
  recordInvocation,
}: {
  asset: RecordingAssetDto;
  transcript: TranscriptResult;
  providers: AiProvider[];
  primaryProvider?: AiProviderName;
  client: LedgerClient;
  actor: AiExecutionActor;
  runGateway: typeof runAiGateway;
  recordInvocation: typeof recordAiInvocation;
}): Promise<{ draft: RecordingAiAnalysisDraft; providerName: AiProviderName }> {
  const result = await runGateway({
    providers: providers.filter(
      (provider) => provider.name !== "deterministic",
    ),
    primaryProvider,
    request: {
      kind: "structured",
      promptKey: PROMPT_KEY,
      promptVersion: PROMPT_VERSION,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: buildUserPrompt({ asset, transcript }),
        },
      ],
      responseSchema: llmDraftSchema,
      metadata: { assetId: asset.id },
    },
  });

  await recordInvocation({
    client,
    actor,
    input: {
      id: createAiInvocationId(),
      scene: PROMPT_KEY,
      objectType: "recording_asset",
      objectId: asset.id,
      providerName: result.providerName,
      primaryProvider,
      status: result.status,
      promptKey: PROMPT_KEY,
      promptVersion: PROMPT_VERSION,
      usage: result.usage,
      costCents: result.costCents,
      latencyMs: result.latencyMs,
      degradedReason: result.degradedReason,
      errorSummary: result.errorSummary,
      metadata: { stage: "llm", fallbackUsed: result.fallbackUsed },
    },
  });

  if (result.status !== "succeeded" || !result.providerName) {
    throw new Error(
      result.errorSummary ?? "Recording analysis LLM call did not succeed",
    );
  }

  const parsed = llmDraftSchema.safeParse(result.structuredOutput);
  if (!parsed.success) {
    throw new Error("Recording analysis LLM output did not match the schema");
  }

  return {
    draft: toAnalysisDraft(parsed.data, {
      durationSeconds:
        transcript.durationSeconds ?? asset.durationSeconds ?? null,
    }),
    providerName: result.providerName,
  };
}

function resolveStoragePath(asset: RecordingAssetDto): string | null {
  const fromPrimary = asset.primarySource?.storagePath?.trim();
  if (fromPrimary) {
    return fromPrimary;
  }
  for (const source of asset.sources) {
    const path = source.storagePath?.trim();
    if (path) {
      return path;
    }
  }
  return null;
}

function buildSystemPrompt(): string {
  return [
    "你是游戏直播 MCN 的录屏审核辅助分析师，依据直播录屏的语音转写文本评估直播质量。",
    "严格规则:",
    "1. 只能依据下方提供的转写文本和资产元数据，不得编造转写中不存在的内容、数据或平台信息。",
    "2. 片段（segments）的时间戳必须落在转写时间轴范围内，且来自转写中真实出现的内容。",
    "3. 音画质量仅能从转写可判断的范围（口播清晰度、断句混乱等）评估，无法判断时给中间分并在 finding 中说明。",
    `4. 所有建议都必须经人工确认后才能执行。${REVIEW_BOUNDARY}`,
    "5. 使用简洁、专业的中文。",
    "6. 只返回 JSON，结构为:",
    JSON.stringify({
      summary: "整体分析摘要",
      scorecard: {
        rhythm: 0,
        script: 0,
        interaction: 0,
        media_quality: 0,
        compliance: 0,
        project_match: 0,
      },
      dimensions: [
        { key: "rhythm", label: "直播节奏", score: 0, finding: "..." },
      ],
      riskFlags: ["..."],
      recommendations: [{ title: "...", detail: "..." }],
      segments: [
        {
          segmentKind: "opening",
          startSeconds: 0,
          endSeconds: 0,
          title: "...",
          summary: "...",
          riskLevel: "low",
        },
      ],
    }),
    "scorecard 与 dimensions 的 key 固定为 rhythm/script/interaction/media_quality/compliance/project_match，分数为 0-100 整数。",
    "segmentKind 建议使用 opening/interaction/conversion/risk/highlight。",
  ].join("\n");
}

function buildUserPrompt({
  asset,
  transcript,
}: {
  asset: RecordingAssetDto;
  transcript: TranscriptResult;
}): string {
  const lines = [
    "【录屏资产】",
    `标题: ${asset.title}`,
    `资产类型: ${asset.assetKind === "project_submission" ? "项目投稿" : "主播素材库"}`,
    `审核状态: ${asset.reviewStatusLabel}`,
    `是否关联项目: ${asset.projectId ? "是" : "否"}`,
    `时长(秒): ${transcript.durationSeconds ?? asset.durationSeconds ?? "未知"}`,
    "",
    "【转写时间轴（节选）】",
    ...formatUtteranceLines(transcript.utterances),
    "",
    "【转写全文】",
    truncateTranscript(transcript.text),
  ];
  return lines.join("\n");
}

function formatUtteranceLines(utterances: DoubaoAsrUtterance[]): string[] {
  if (!utterances.length) {
    return ["(无时间轴信息)"];
  }

  // 均匀采样，避免几小时的直播把 prompt 撑爆。
  const step = Math.max(1, Math.ceil(utterances.length / MAX_PROMPT_UTTERANCES));
  const lines: string[] = [];
  for (let index = 0; index < utterances.length; index += step) {
    const utterance = utterances[index];
    lines.push(
      `[${formatClock(utterance.startSeconds)}-${formatClock(utterance.endSeconds)}] ${utterance.text}`,
    );
  }
  if (step > 1) {
    lines.push(`(时间轴共 ${utterances.length} 条，已按 1/${step} 采样)`);
  }
  return lines;
}

function truncateTranscript(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= TRANSCRIPT_HEAD_CHARS + TRANSCRIPT_TAIL_CHARS) {
    return normalized;
  }
  return [
    normalized.slice(0, TRANSCRIPT_HEAD_CHARS),
    `\n(中间省略 ${normalized.length - TRANSCRIPT_HEAD_CHARS - TRANSCRIPT_TAIL_CHARS} 字)\n`,
    normalized.slice(-TRANSCRIPT_TAIL_CHARS),
  ].join("");
}

function toAnalysisDraft(
  output: LlmDraftOutput,
  { durationSeconds }: { durationSeconds: number | null },
): RecordingAiAnalysisDraft {
  const maxSeconds =
    durationSeconds && durationSeconds > 0
      ? Math.trunc(durationSeconds)
      : null;

  const seenKeys = new Set<RecordingAiDimensionKey>();
  const dimensions = output.dimensions
    .filter((dimension) => {
      if (seenKeys.has(dimension.key)) {
        return false;
      }
      seenKeys.add(dimension.key);
      return true;
    })
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      score: clampScore(dimension.score),
      finding: dimension.finding,
    }));

  const segments = output.segments.map((segment, index) => {
    const start = clampSeconds(segment.startSeconds, maxSeconds);
    const end = Math.max(start, clampSeconds(segment.endSeconds, maxSeconds));
    return {
      segmentKind: segment.segmentKind,
      startSeconds: start,
      endSeconds: end,
      title: segment.title,
      summary: segment.summary,
      riskLevel: segment.riskLevel,
      evidence: {
        source: "asr_transcript",
        provider: "doubao_asr",
      } as Record<string, unknown>,
      sortOrder: index + 1,
    };
  });

  return {
    summary: output.summary,
    reviewBoundary: REVIEW_BOUNDARY,
    scorecard: {
      rhythm: clampScore(output.scorecard.rhythm),
      script: clampScore(output.scorecard.script),
      interaction: clampScore(output.scorecard.interaction),
      media_quality: clampScore(output.scorecard.media_quality),
      compliance: clampScore(output.scorecard.compliance),
      project_match: clampScore(output.scorecard.project_match),
    },
    dimensions,
    riskFlags: output.riskFlags,
    recommendations: output.recommendations.map((recommendation) => ({
      title: recommendation.title,
      detail: recommendation.detail,
      requiresHumanApproval: true as const,
    })),
    segments,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function clampSeconds(value: number, maxSeconds: number | null): number {
  const normalized = Math.max(0, Math.trunc(value));
  return maxSeconds === null ? normalized : Math.min(normalized, maxSeconds);
}

function formatClock(value: number): string {
  const seconds = Math.max(0, Math.trunc(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
