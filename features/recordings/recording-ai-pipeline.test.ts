import { describe, expect, it } from "vitest";

import type { AiProvider } from "@/features/ai/contracts";
import type { recordAiInvocation } from "@/features/ai/invocation-ledger";
import type { runAiGateway } from "@/features/ai/llm-gateway";
import type {
  DoubaoAsrProvider,
  DoubaoAsrResult,
} from "@/features/ai/providers/doubao-asr-provider";

import { createRecordingAiAnalysisPipeline } from "./recording-ai-pipeline";
import type { RecordingAssetDto } from "./recording-assets";
import type { extractRecordingAudioFromStorage } from "./recording-audio-extraction";

const actor = {
  userId: "user-1",
  name: "Recording AI Runner",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const fakeClient = {} as never;

function fakeAsset(
  overrides: Partial<RecordingAssetDto> = {},
): RecordingAssetDto {
  return {
    id: "asset-1",
    title: "新品首播复盘",
    assetKind: "project_submission",
    reviewStatus: "reviewing",
    reviewStatusLabel: "审核中",
    previewState: "private_file",
    durationSeconds: 1800,
    projectId: "project-1",
    applicationId: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    primarySource: {
      id: "source-1",
      sourceKind: "storage_object",
      previewState: "private_file",
      previewMode: "private_file",
      provider: "storage",
      externalUrl: null,
      storagePath: "recordings/org-1/asset-1/replay.mp4",
      openUrl: null,
      embedUrl: null,
      downloadUrl: null,
      submittedAt: "2026-07-01T00:00:00Z",
    },
    sources: [],
    aiAnalysis: null,
    ...overrides,
  };
}

function asrReturning(result: Partial<DoubaoAsrResult>): DoubaoAsrProvider {
  return {
    recognizeAudio: () =>
      Promise.resolve({
        status: "succeeded",
        text: "大家好，今天首播新品，先讲玩法再抽福利。",
        utterances: [
          { text: "大家好，今天首播新品", startSeconds: 0, endSeconds: 4.5 },
          { text: "先讲玩法再抽福利", startSeconds: 5, endSeconds: 9 },
        ],
        durationSeconds: 1750,
        latencyMs: 800,
        ...result,
      }),
  };
}

const llmProviders = [
  {
    name: "deepseek",
    capabilities: ["text", "structured", "shadow"],
  } as unknown as AiProvider,
];

const llmOutput = {
  summary: "开场直入主题，互动引导偏少。",
  scorecard: {
    rhythm: 82,
    script: 74.6,
    interaction: 61,
    media_quality: 70,
    compliance: 88,
    project_match: 90,
  },
  dimensions: [
    {
      key: "rhythm",
      label: "直播节奏",
      score: 82,
      finding: "开场即讲新品，节奏紧凑。",
    },
    {
      key: "interaction",
      label: "互动设计",
      score: 61,
      finding: "缺少评论引导话术。",
    },
  ],
  riskFlags: ["福利承诺未说明兑现时间"],
  recommendations: [
    { title: "补充互动引导", detail: "中段每十分钟安排一次评论提问。" },
  ],
  segments: [
    {
      segmentKind: "opening",
      startSeconds: 0,
      endSeconds: 9,
      title: "开场承接",
      summary: "快速交代新品与福利节点。",
      riskLevel: "low",
    },
    {
      segmentKind: "risk",
      startSeconds: 1700,
      endSeconds: 99999,
      title: "福利承诺",
      summary: "承诺抽奖但未说明兑现时间。",
      riskLevel: "medium",
    },
  ],
};

function successGateway(
  calls: Array<Record<string, unknown>> = [],
): typeof runAiGateway {
  return ((input: Record<string, unknown>) => {
    calls.push(input);
    return Promise.resolve({
      status: "succeeded",
      providerName: "deepseek",
      fallbackUsed: false,
      structuredOutput: llmOutput,
      usage: { promptTokens: 900, completionTokens: 300, totalTokens: 1200 },
      latencyMs: 1500,
      costCents: 2,
    });
  }) as unknown as typeof runAiGateway;
}

function collectInvocations(
  invocations: Array<Record<string, unknown>>,
): typeof recordAiInvocation {
  return (({ input }: { input: Record<string, unknown> }) => {
    invocations.push(input);
    return Promise.resolve(String(input.id ?? "invocation"));
  }) as unknown as typeof recordAiInvocation;
}

const noExtract = (() =>
  Promise.reject(
    new Error("should not extract"),
  )) as unknown as typeof extractRecordingAudioFromStorage;

const fakeExtract = ((input: { storagePath: string }) => {
  void input;
  return Promise.resolve({
    audioBase64: "bW9jaw==",
    format: "mp3" as const,
    audioBytes: 4,
  });
}) as unknown as typeof extractRecordingAudioFromStorage;

describe("createRecordingAiAnalysisPipeline", () => {
  it("returns null when doubao ASR is not configured", () => {
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: { DEEPSEEK_API_KEY: "key" },
    });

    expect(pipeline).toBeNull();
  });

  it("returns null when no real structured provider is configured", () => {
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {
        DOUBAO_ASR_APP_KEY: "app",
        DOUBAO_ASR_ACCESS_KEY: "key",
      },
    });

    expect(pipeline).toBeNull();
  });

  it("transcribes the recording and turns the LLM output into a draft", async () => {
    const gatewayCalls: Array<Record<string, unknown>> = [];
    const invocations: Array<Record<string, unknown>> = [];
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({}),
      providers: llmProviders,
      extractAudio: fakeExtract,
      runGateway: successGateway(gatewayCalls),
      recordInvocation: collectInvocations(invocations),
    });

    expect(pipeline).not.toBeNull();
    const result = await pipeline!({ asset: fakeAsset() });

    expect(result).not.toBeNull();
    expect(result!.providerName).toBe("deepseek");
    expect(result!.asrProvider).toBe("doubao_asr");
    expect(result!.transcriptText).toContain("今天首播新品");
    expect(result!.transcriptUtterances).toHaveLength(2);

    // LLM 输出被规范化:分数取整、片段时间被夹在转写时长内、建议强制人工确认。
    expect(result!.draft.scorecard.script).toBe(74);
    expect(result!.draft.segments[1].endSeconds).toBe(1750);
    expect(result!.draft.segments[1].startSeconds).toBe(1700);
    expect(result!.draft.recommendations[0].requiresHumanApproval).toBe(true);
    expect(result!.draft.reviewBoundary).toContain("人工审核确认");
    expect(result!.draft.segments[0].evidence).toMatchObject({
      source: "asr_transcript",
      provider: "doubao_asr",
    });

    // prompt 中带上了转写文本与时间轴。
    const request = gatewayCalls[0].request as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = request.messages.find((m) => m.role === "user");
    expect(userMessage?.content).toContain("【转写全文】");
    expect(userMessage?.content).toContain("[00:00-00:04] 大家好，今天首播新品");

    // ASR 与 LLM 各记一笔调用台账。
    expect(invocations.map((entry) => entry.scene)).toEqual([
      "recording.transcribe_asset",
      "recording.analyze_asset",
    ]);
    expect(invocations[0].providerName).toBe("doubao_asr");
    expect(invocations[1].providerName).toBe("deepseek");
  });

  it("skips assets without a downloadable storage object", async () => {
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({}),
      providers: llmProviders,
      extractAudio: noExtract,
      runGateway: successGateway(),
      recordInvocation: collectInvocations([]),
    });

    const asset = fakeAsset({
      primarySource: null,
      sources: [
        {
          id: "source-2",
          sourceKind: "bilibili_url",
          previewState: "previewable",
          previewMode: "embed",
          provider: "bilibili",
          externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          storagePath: null,
          openUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          embedUrl: null,
          downloadUrl: null,
          submittedAt: "2026-07-01T00:00:00Z",
        },
      ],
    });

    await expect(pipeline!({ asset })).resolves.toBeNull();
  });

  it("returns null when ASR degrades at runtime", async () => {
    const invocations: Array<Record<string, unknown>> = [];
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({
        status: "degraded",
        text: "",
        utterances: [],
        degradedReason: "provider_unconfigured",
      }),
      providers: llmProviders,
      extractAudio: fakeExtract,
      runGateway: successGateway(),
      recordInvocation: collectInvocations(invocations),
    });

    await expect(pipeline!({ asset: fakeAsset() })).resolves.toBeNull();
    expect(invocations[0].status).toBe("degraded");
  });

  it("throws when ASR fails so the runner can fall back", async () => {
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({
        status: "failed",
        text: "",
        utterances: [],
        errorSummary: "audio too noisy",
      }),
      providers: llmProviders,
      extractAudio: fakeExtract,
      runGateway: successGateway(),
      recordInvocation: collectInvocations([]),
    });

    await expect(pipeline!({ asset: fakeAsset() })).rejects.toThrow(
      /audio too noisy/,
    );
  });

  it("throws when the transcript is empty", async () => {
    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({ text: "   ", utterances: [] }),
      providers: llmProviders,
      extractAudio: fakeExtract,
      runGateway: successGateway(),
      recordInvocation: collectInvocations([]),
    });

    await expect(pipeline!({ asset: fakeAsset() })).rejects.toThrow(
      /empty transcript/,
    );
  });

  it("throws and records the failure when the LLM call fails", async () => {
    const invocations: Array<Record<string, unknown>> = [];
    const failingGateway = (() =>
      Promise.resolve({
        status: "failed",
        fallbackUsed: true,
        errorSummary: "all providers failed",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 10,
        costCents: 0,
      })) as unknown as typeof runAiGateway;

    const pipeline = createRecordingAiAnalysisPipeline({
      client: fakeClient,
      actor,
      env: {},
      asr: asrReturning({}),
      providers: llmProviders,
      extractAudio: fakeExtract,
      runGateway: failingGateway,
      recordInvocation: collectInvocations(invocations),
    });

    await expect(pipeline!({ asset: fakeAsset() })).rejects.toThrow(
      /all providers failed/,
    );
    expect(invocations.map((entry) => entry.scene)).toEqual([
      "recording.transcribe_asset",
      "recording.analyze_asset",
    ]);
    expect(invocations[1].status).toBe("failed");
  });
});
