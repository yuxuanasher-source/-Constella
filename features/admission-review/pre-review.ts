import { z } from "zod";

import type {
  AiActor,
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
import type { RecordingProductionGuide } from "@/features/recordings/recording-production-guide";
import type {
  NormalizedRecordingSelfCheck,
  RerecordSuggestion,
} from "@/features/recordings/recording-production-standard";

import {
  checkpointsForStage,
  failedHardBlocks,
  type AdmissionCheckpointResultInput,
  type AdmissionEvaluationRecord,
  type AdmissionRubric,
} from "./contracts";
import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "./evaluation-service";

// AI 预审（L2_DRAFT）：把录屏转写 + 录屏 AI 评分映射到一审卡点，逐项给
// verdict + 置信度 + 转写证据，供审核员预填审核单。永不自动通过/驳回——
// 预审结果只是草稿，一审仍由人工提交；人工提交时自动产生 ai_vs_mcn 对齐信号。

export const PRE_REVIEW_SCENE = "admission.pre_review";
export const PRE_REVIEW_PROMPT_VERSION = 2;
const TRANSCRIPT_HEAD_CHARS = 8_000;
const TRANSCRIPT_TAIL_CHARS = 2_000;
const PROMPT_SHORT_FIELD_CHARS = 80;
const PROMPT_LONG_FIELD_CHARS = 80;
const PROMPT_URL_CHARS = 120;
const PROMPT_LIST_MAX_ITEMS = 4;
const PROMPT_LIST_ITEM_CHARS = 42;
const PROMPT_TECHNICAL_MAX_ENTRIES = 3;
const PROMPT_TECHNICAL_KEY_CHARS = 24;
const PROMPT_TECHNICAL_VALUE_CHARS = 36;
const PROMPT_KEY_MOMENT_NOTE_CHARS = 36;

export type AdmissionPreReviewSubmission = {
  organizationId: string;
  applicationId: string;
  submissionId: string;
  projectName?: string | null;
  streamerName?: string | null;
  durationSeconds?: number | null;
};

export type AdmissionTranscriptSource = {
  transcriptText: string;
  scorecard: Record<string, number>;
  summary: string | null;
};

export type AdmissionPreReviewResult = {
  evaluation: AdmissionEvaluationRecord;
  decision: "approved" | "needs_changes" | "rejected" | "manual_review";
  confidence: "high" | "medium" | "low";
  noteDraft: string;
  checkpointResults: AdmissionCheckpointResultInput[];
  providerName: AiProviderName;
};

/** 历史相似案例（Phase 4 few-shot 注入用）。 */
export type AdmissionPreReviewExample = {
  decision: string;
  reasonCodes: string[];
  note: string | null;
};

const preReviewSchema = z.object({
  decision: z.enum(["approved", "needs_changes", "rejected", "manual_review"]),
  confidence: z.enum(["high", "medium", "low"]),
  noteDraft: z.string().trim().min(1),
  checkpoints: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        verdict: z.enum(["pass", "fail", "not_applicable"]),
        confidence: z.number().min(0).max(1),
        evidence: z.string().trim(),
        issue: z.string().trim().optional(),
        howToImprove: z.string().trim().optional(),
        rerecordSuggestion: z.enum(["none", "clip", "full"]).optional(),
      }),
    )
    .min(1),
});

type SubmissionAssetDb = {
  from(table: "recording_asset_sources"): {
    select(columns: string): {
      eq(
        column: "recording_submission_id",
        value: string,
      ): {
        limit(count: number): PromiseLike<{
          data: Array<{ asset_id: string }> | null;
          error: Error | null;
        }>;
      };
    };
  };
  from(table: "recording_ai_analyses"): {
    select(columns: string): {
      eq(
        column: "asset_id",
        value: string,
      ): {
        eq(
          column: "status",
          value: string,
        ): {
          order(
            column: "created_at",
            options: { ascending: boolean },
          ): {
            limit(count: number): PromiseLike<{
              data: Array<{
                transcript_text: string | null;
                scorecard: unknown;
                summary: string | null;
              }> | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
};

/**
 * 找到提交对应的转写：recording_submissions -> recording_asset_sources
 * -> recording_ai_analyses（最新一条成功且有转写的分析）。
 * 没有转写返回 null（预审不适用，静默跳过）。
 */
export async function findTranscriptForSubmission({
  client,
  submissionId,
}: {
  client: SubmissionAssetDb;
  submissionId: string;
}): Promise<AdmissionTranscriptSource | null> {
  const { data: sources, error: sourcesError } = await client
    .from("recording_asset_sources")
    .select("asset_id")
    .eq("recording_submission_id", submissionId)
    .limit(1);
  if (sourcesError) {
    throw sourcesError;
  }
  const assetId = sources?.[0]?.asset_id;
  if (!assetId) {
    return null;
  }

  const { data: analyses, error: analysesError } = await client
    .from("recording_ai_analyses")
    .select("transcript_text, scorecard, summary")
    .eq("asset_id", assetId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1);
  if (analysesError) {
    throw analysesError;
  }

  const analysis = analyses?.[0];
  if (!analysis?.transcript_text?.trim()) {
    return null;
  }

  const scorecard: Record<string, number> = {};
  if (analysis.scorecard && typeof analysis.scorecard === "object") {
    for (const [key, value] of Object.entries(
      analysis.scorecard as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value)) {
        scorecard[key] = value;
      }
    }
  }

  return {
    transcriptText: analysis.transcript_text,
    scorecard,
    summary: analysis.summary ?? null,
  };
}

export async function generateAdmissionPreReview({
  client,
  actor,
  submission,
  transcript,
  projectGuide = null,
  selfCheck = null,
  rubric,
  examples = [],
  providers,
  runGateway = runAiGateway,
  recordInvocation = recordAiInvocation,
}: {
  client: AdmissionReviewClient &
    Parameters<typeof recordAiInvocation>[0]["client"];
  actor: AiActor;
  submission: AdmissionPreReviewSubmission;
  transcript: AdmissionTranscriptSource;
  projectGuide?: RecordingProductionGuide | null;
  selfCheck?: NormalizedRecordingSelfCheck | null;
  rubric?: AdmissionRubric;
  examples?: AdmissionPreReviewExample[];
  providers?: AiProvider[];
  runGateway?: typeof runAiGateway;
  recordInvocation?: typeof recordAiInvocation;
}): Promise<AdmissionPreReviewResult> {
  const resolvedRubric =
    rubric ??
    (await resolveAdmissionRubric({
      client,
      organizationId: submission.organizationId,
    }));
  const checkpoints = checkpointsForStage(resolvedRubric, "mcn_first");
  if (!checkpoints.length) {
    throw new Error("Admission rubric has no mcn_first checkpoints");
  }

  const resolvedProviders = (
    providers ?? createConfiguredAiProviders()
  ).filter((provider) => provider.name !== "deterministic");
  if (
    !resolvedProviders.some((provider) =>
      provider.capabilities.includes("structured"),
    )
  ) {
    throw new Error("Admission pre-review requires a real LLM provider");
  }
  const routing = resolveAiProviderRouting();

  const result = await runGateway({
    providers: resolvedProviders,
    primaryProvider: routing.primaryProvider,
    request: {
      kind: "structured",
      promptKey: PRE_REVIEW_SCENE,
      promptVersion: PRE_REVIEW_PROMPT_VERSION,
      messages: [
        { role: "system", content: buildSystemPrompt(checkpoints, examples) },
        {
          role: "user",
          content: buildUserPrompt({
            submission,
            transcript,
            projectGuide,
            selfCheck,
          }),
        },
      ],
      responseSchema: preReviewSchema,
      metadata: { submissionId: submission.submissionId },
    },
  });

  const invocationId = createAiInvocationId();
  await recordInvocation({
    client,
    actor,
    input: {
      id: invocationId,
      scene: PRE_REVIEW_SCENE,
      objectType: "recording_submission",
      objectId: submission.submissionId,
      providerName: result.providerName,
      primaryProvider: routing.primaryProvider,
      status: result.status,
      promptKey: PRE_REVIEW_SCENE,
      promptVersion: PRE_REVIEW_PROMPT_VERSION,
      usage: result.usage,
      costCents: result.costCents,
      latencyMs: result.latencyMs,
      degradedReason: result.degradedReason,
      errorSummary: result.errorSummary,
      metadata: { fewShotExamples: examples.length },
    },
  });

  if (result.status !== "succeeded" || !result.providerName) {
    throw new Error(
      result.errorSummary ?? "Admission pre-review LLM call did not succeed",
    );
  }

  const parsed = preReviewSchema.safeParse(result.structuredOutput);
  if (!parsed.success) {
    throw new Error("Admission pre-review output did not match the schema");
  }

  // 过滤 LLM 编造的卡点 key；全部无效则视为失败（预审必须逐项可对齐）。
  const allowedKeys = new Set(checkpoints.map((checkpoint) => checkpoint.key));
  const checkpointResults: AdmissionCheckpointResultInput[] =
    parsed.data.checkpoints
      .filter((item) => allowedKeys.has(item.key))
      .map((item) => {
        const rerecordSuggestion: RerecordSuggestion =
          item.rerecordSuggestion ?? "none";
        return {
          checkpointKey: item.key,
          verdict: item.verdict,
          confidence: item.confidence,
          evidence: {
            source: "asr_transcript",
            ...(item.evidence.trim() ? { quote: item.evidence.trim() } : {}),
            structuredFeedback: {
              issue: item.issue?.trim() || null,
              howToImprove: item.howToImprove?.trim() || null,
              rerecordSuggestion,
              advisoryOnly: true,
            },
          },
        };
      });
  if (!checkpointResults.length) {
    throw new Error("Admission pre-review produced no valid checkpoints");
  }

  // 模型自相矛盾（判通过但硬卡点 fail）时降级为 manual_review，不丢弃预审。
  const decision =
    parsed.data.decision === "approved" &&
    failedHardBlocks(resolvedRubric, checkpointResults).length
      ? "manual_review"
      : parsed.data.decision;

  const evaluation = await recordAdmissionEvaluation({
    client,
    rubric: resolvedRubric,
    input: {
      organizationId: submission.organizationId,
      applicationId: submission.applicationId,
      submissionId: submission.submissionId,
      stage: "ai_pre_review",
      decision,
      decisionConfidence: parsed.data.confidence,
      aiInvocationId: invocationId,
      note: parsed.data.noteDraft,
      noteSource: "llm_classified",
      checkpointResults,
    },
  });

  return {
    evaluation,
    decision,
    confidence: parsed.data.confidence,
    noteDraft: parsed.data.noteDraft,
    checkpointResults,
    providerName: result.providerName,
  };
}

type PreReviewLookupDb = {
  from(table: "admission_review_evaluations"): {
    select(columns: string): {
      eq(
        column: "submission_id",
        value: string,
      ): {
        eq(
          column: "stage",
          value: string,
        ): {
          order(
            column: "created_at",
            options: { ascending: boolean },
          ): {
            limit(count: number): PromiseLike<{
              data: Array<{
                id: string;
                decision: string;
                decision_confidence: string | null;
                note: string | null;
                created_at: string;
                admission_review_checkpoint_results?: Array<{
                  checkpoint_key: string;
                  verdict: string;
                  confidence: number | null;
                  evidence: Record<string, unknown> | null;
                }> | null;
              }> | null;
              error: Error | null;
            }>;
          };
        };
      };
    };
  };
};

export type AdmissionPreReviewView = {
  evaluationId: string;
  decision: string;
  confidence: string | null;
  noteDraft: string | null;
  createdAt: string;
  checkpoints: Array<{
    key: string;
    verdict: string;
    confidence: number | null;
    evidence: Record<string, unknown>;
  }>;
};

/** 审核 UI 预填用：取该提交最近一次 AI 预审。 */
export async function getLatestAdmissionPreReview({
  client,
  submissionId,
}: {
  client: PreReviewLookupDb;
  submissionId: string;
}): Promise<AdmissionPreReviewView | null> {
  const { data, error } = await client
    .from("admission_review_evaluations")
    .select(
      "id, decision, decision_confidence, note, created_at, admission_review_checkpoint_results(checkpoint_key, verdict, confidence, evidence)",
    )
    .eq("submission_id", submissionId)
    .eq("stage", "ai_pre_review")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const row = data?.[0];
  if (!row) {
    return null;
  }

  return {
    evaluationId: row.id,
    decision: row.decision,
    confidence: row.decision_confidence,
    noteDraft: row.note,
    createdAt: row.created_at,
    checkpoints: (row.admission_review_checkpoint_results ?? []).map(
      (result) => ({
        key: result.checkpoint_key,
        verdict: result.verdict,
        confidence: result.confidence,
        evidence: result.evidence ?? {},
      }),
    ),
  };
}

function buildSystemPrompt(
  checkpoints: ReturnType<typeof checkpointsForStage>,
  examples: AdmissionPreReviewExample[],
): string {
  const lines = [
    "你是游戏直播 MCN 的上播审核预审员，依据录屏转写文本对照卡点清单逐项预判。",
    "严格规则:",
    "1. 只能依据转写文本与提供的元数据，不得编造转写中不存在的内容。",
    "2. 每个卡点给 pass / fail / not_applicable 和 0-1 置信度；无法从转写判断的卡点用 not_applicable + 低置信度。",
    "3. evidence 必须引用转写原文片段；没有依据就留空字符串。",
    "4. 你的结论只是人工审核的预填草稿，不会自动生效；置信度不足时 decision 用 manual_review。",
    "5. 硬卡点（hard_block）fail 时 decision 不得为 approved。",
    "6. rerecordSuggestion 只能表达建议，不能表达最终审核结论，也不能作为通过/驳回依据。",
    "7. 避免强制重录口吻；需要时写“建议补录指定片段”或“建议整段重录”。",
    "卡点清单:",
    ...checkpoints.map(
      (checkpoint) =>
        `- ${checkpoint.key} [${checkpoint.severity}] ${checkpoint.label}：${checkpoint.description}`,
    ),
  ];

  if (examples.length) {
    lines.push(
      "历史相似案例（同品类人工终审结论，供校准口径，不可照抄）:",
      ...examples.map(
        (example, index) =>
          `${index + 1}. 人工结论=${example.decision}；理由码=${
            example.reasonCodes.join("/") || "无"
          }；备注=${example.note ?? "无"}`,
      ),
    );
  }

  lines.push(
    "只返回 JSON:",
    JSON.stringify({
      decision: "approved|needs_changes|rejected|manual_review",
      confidence: "high|medium|low",
      noteDraft: "给审核员的一句话预审意见",
      checkpoints: [
        {
          key: "...",
          verdict: "pass|fail|not_applicable",
          confidence: 0.9,
          evidence: "转写引用",
          issue: "问题概述或空字符串",
          howToImprove: "改进建议或空字符串",
          rerecordSuggestion: "none|clip|full",
        },
      ],
    }),
  );

  return lines.join("\n");
}

function buildUserPrompt({
  submission,
  transcript,
  projectGuide,
  selfCheck,
}: {
  submission: AdmissionPreReviewSubmission;
  transcript: AdmissionTranscriptSource;
  projectGuide?: RecordingProductionGuide | null;
  selfCheck?: NormalizedRecordingSelfCheck | null;
}): string {
  const scorecardLine = Object.entries(transcript.scorecard)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

  return [
    "【提交信息】",
    `项目: ${submission.projectName ?? "未知"}`,
    `主播: ${submission.streamerName ?? "未知"}`,
    `录屏时长(秒): ${submission.durationSeconds ?? "未知"}`,
    transcript.summary ? `录屏 AI 摘要: ${transcript.summary}` : "",
    scorecardLine ? `录屏 AI 六维评分: ${scorecardLine}` : "",
    "",
    ...buildProjectGuidePromptLines(projectGuide),
    ...buildSelfCheckPromptLines(selfCheck),
    "",
    "【转写全文】",
    truncateTranscript(transcript.transcriptText),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildProjectGuidePromptLines(
  projectGuide: RecordingProductionGuide | null | undefined,
): string[] {
  if (!projectGuide) {
    return [];
  }

  return [
    "【项目任务卡】",
    `游戏: ${formatPromptField(projectGuide.gameName)}`,
    `版本/区服: ${joinNonEmpty([
      compactText(projectGuide.gameVersion, PROMPT_SHORT_FIELD_CHARS),
      compactText(projectGuide.serverRegion, PROMPT_SHORT_FIELD_CHARS),
    ]) || "未知"}`,
    `推广目标: ${formatPromptField(projectGuide.promotionGoal)}`,
    `目标用户: ${formatPromptField(projectGuide.targetAudience)}`,
    `必须展示: ${formatTextList(projectGuide.requiredContent)}`,
    `必须讲解: ${formatTextList(projectGuide.requiredTalkingPoints)}`,
    `商业动作: ${formatTextList(projectGuide.commercialActions)}`,
    `禁止内容: ${formatTextList(projectGuide.forbiddenContent)}`,
    formatTechnicalStandard(projectGuide.technicalStandard),
    projectGuide.templateText
      ? `任务模板: ${compactText(projectGuide.templateText, PROMPT_LONG_FIELD_CHARS)}`
      : "",
    projectGuide.exampleUrl
      ? `参考视频: ${compactText(projectGuide.exampleUrl, PROMPT_URL_CHARS)}`
      : "",
    "",
  ].filter(Boolean);
}

function buildSelfCheckPromptLines(
  selfCheck: NormalizedRecordingSelfCheck | null | undefined,
): string[] {
  if (!selfCheck) {
    return [];
  }

  const keyMoments = Array.isArray(selfCheck.keyMoments)
    ? selfCheck.keyMoments
        .map(
          (item) =>
            `${item.key}=${item.startSeconds}-${item.endSeconds}s${
              item.note
                ? `(${compactText(item.note, PROMPT_KEY_MOMENT_NOTE_CHARS)})`
                : ""
            }`,
        )
        .join("；")
    : "";

  return [
    "【主播自检】",
    `主播自评总分: ${selfCheck.totalScore}`,
    `主播自评等级: ${selfCheck.selfLevel}`,
    `关键时间点: ${keyMoments || "无"}`,
    selfCheck.note
      ? `主播备注: ${compactText(selfCheck.note, PROMPT_LONG_FIELD_CHARS)}`
      : "",
    "",
  ].filter(Boolean);
}

function formatTextList(values: string[] | null | undefined): string {
  const normalized = (values ?? [])
    .map((value) => compactText(value, PROMPT_LIST_ITEM_CHARS))
    .filter(Boolean);
  if (!normalized.length) {
    return "无";
  }

  const visible = normalized.slice(0, PROMPT_LIST_MAX_ITEMS);
  const remaining = normalized.length - visible.length;
  return remaining > 0
    ? `${visible.join("；")}；另${remaining}项`
    : visible.join("；");
}

function joinNonEmpty(values: Array<string | null | undefined>): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(" / ");
}

function formatTechnicalStandard(
  standard: Record<string, unknown> | null | undefined,
): string {
  if (!standard || !Object.keys(standard).length) {
    return "技术标准: 无";
  }

  const entries = Object.entries(standard)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${compactText(key, PROMPT_TECHNICAL_KEY_CHARS)}=${compactText(
          stringifyPromptValue(value),
          PROMPT_TECHNICAL_VALUE_CHARS,
        )}`,
    );
  const visible = entries.slice(0, PROMPT_TECHNICAL_MAX_ENTRIES);
  const remaining = entries.length - visible.length;
  return `技术标准: ${
    visible.length
      ? remaining > 0
        ? `${visible.join("；")}；另${remaining}项`
        : visible.join("；")
      : "无"
  }`;
}

function formatPromptField(value: string | null | undefined): string {
  return compactText(value, PROMPT_SHORT_FIELD_CHARS) || "未知";
}

function compactText(
  value: string | null | undefined,
  maxChars: number,
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function stringifyPromptValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
