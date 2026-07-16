import { describe, expect, it } from "vitest";

import {
  buildRecordingAiAnalysisDraft,
  claimAndRunRecordingAiAnalyses,
  executeClaimedRecordingAiAnalysis,
  RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY,
  runRecordingAiAnalysisOnce,
  toRecordingAiAnalysisDto,
} from "./recording-ai-analysis";
import type { RecordingAiPipelineResult } from "./recording-ai-pipeline";
import type {
  RecordingAssetDto,
  RecordingAssetSourceDto,
} from "./recording-assets";

function pipelineResultFixture(): RecordingAiPipelineResult {
  return {
    providerName: "deepseek",
    asrProvider: "doubao_asr",
    transcriptText: "大家好，今天首播新品。",
    transcriptUtterances: [
      { text: "大家好，今天首播新品", startSeconds: 0, endSeconds: 4.5 },
    ],
    draft: {
      summary: "开场直入主题，互动引导偏少。",
      reviewBoundary:
        "AI 分析仅作为审核辅助，不自动通过、不自动拒绝，也不自动修改主播画像；关键结论必须由人工审核确认。",
      scorecard: {
        rhythm: 82,
        script: 74,
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
      ],
      riskFlags: ["福利承诺未说明兑现时间"],
      recommendations: [
        {
          title: "补充互动引导",
          detail: "中段每十分钟安排一次评论提问。",
          requiresHumanApproval: true,
        },
      ],
      segments: [
        {
          segmentKind: "opening",
          startSeconds: 0,
          endSeconds: 60,
          title: "开场承接",
          summary: "快速交代新品与福利节点。",
          riskLevel: "low",
          evidence: { source: "asr_transcript", provider: "doubao_asr" },
          sortOrder: 1,
        },
      ],
    },
  };
}

describe("recording AI analysis", () => {
  it("builds a human-in-the-loop analysis draft from a recording asset", () => {
    const draft = buildRecordingAiAnalysisDraft({
      asset: assetFixture({
        durationSeconds: 1800,
        primarySource: {
          sourceKind: "storage_object",
          provider: "private_storage",
        },
      }),
    });

    expect(draft.summary).toContain("原始文件");
    expect(draft.reviewBoundary).toContain("人工审核");
    expect(draft.dimensions.map((dimension) => dimension.key)).toEqual([
      "rhythm",
      "script",
      "interaction",
      "media_quality",
      "compliance",
      "project_match",
    ]);
    expect(draft.segments).toEqual([
      expect.objectContaining({
        segmentKind: "opening",
        startSeconds: 0,
        endSeconds: 180,
      }),
      expect.objectContaining({
        segmentKind: "interaction",
      }),
      expect.objectContaining({
        segmentKind: "risk",
      }),
    ]);
    expect(draft.recommendations[0]).toMatchObject({
      requiresHumanApproval: true,
    });
  });

  it("maps persisted rows into an easy-to-render DTO", () => {
    const dto = toRecordingAiAnalysisDto({
      id: "analysis-1",
      asset_id: "asset-1",
      status: "succeeded",
      provider_name: "deterministic",
      summary: "录屏节奏稳定",
      scorecard: {
        rhythm: 82,
        interaction: 76,
      },
      dimensions: [
        {
          key: "rhythm",
          label: "直播节奏",
          score: 82,
          finding: "开场节奏稳定",
        },
      ],
      risk_flags: ["需要人工确认合规片段"],
      recommendations: [
        {
          title: "复核高光片段",
          detail: "由审核员确认后进入主播画像",
          requiresHumanApproval: true,
        },
      ],
      error_summary: null,
      ai_invocation_id: "invocation-1",
      created_at: "2026-07-01T10:00:00.000Z",
      updated_at: "2026-07-01T10:05:00.000Z",
      completed_at: "2026-07-01T10:05:00.000Z",
      recording_ai_segments: [
        {
          id: "segment-1",
          segment_kind: "opening",
          start_seconds: 0,
          end_seconds: 120,
          title: "开场",
          summary: "开场说明清晰",
          risk_level: "low",
          evidence: { source: "asset:asset-1" },
          sort_order: 1,
        },
      ],
    });

    expect(dto).toEqual(
      expect.objectContaining({
        id: "analysis-1",
        status: "succeeded",
        statusLabel: "已完成",
        scorecard: { rhythm: 82, interaction: 76 },
        segments: [
          expect.objectContaining({
            id: "segment-1",
            segmentKind: "opening",
            timeRangeLabel: "00:00 - 02:00",
          }),
        ],
      }),
    );
  });

  it("runs a queued analysis, stores the draft and persists review segments", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 0, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      now: () => new Date("2026-07-01T11:00:00.000Z"),
    });

    expect(result).toMatchObject({
      id: "analysis-1",
      status: "succeeded",
      statusLabel: "已完成",
      providerName: "deterministic",
      summary: expect.stringContaining("原始文件"),
    });
    expect(result.segments).toEqual([
      expect.objectContaining({
        segmentKind: "opening",
        timeRangeLabel: "00:00 - 03:00",
      }),
      expect.objectContaining({
        segmentKind: "interaction",
      }),
      expect.objectContaining({
        segmentKind: "risk",
      }),
    ]);
    expect(client.updates.recording_ai_analyses).toEqual([
      expect.objectContaining({
        status: "running",
        attempt: 1,
        error_summary: null,
      }),
      expect.objectContaining({
        status: "succeeded",
        summary: expect.stringContaining("原始文件"),
        completed_at: "2026-07-01T11:00:00.000Z",
      }),
    ]);
    expect(client.inserts.recording_ai_segments).toHaveLength(3);
  });

  it("persists the ASR + LLM pipeline draft with transcript columns", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 0, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      now: () => new Date("2026-07-01T11:00:00.000Z"),
      pipeline: () => Promise.resolve(pipelineResultFixture()),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deepseek",
      summary: "开场直入主题，互动引导偏少。",
      transcriptText: "大家好，今天首播新品。",
      asrProvider: "doubao_asr",
    });
    expect(client.updates.recording_ai_analyses.at(-1)).toEqual(
      expect.objectContaining({
        status: "succeeded",
        provider_name: "deepseek",
        transcript_text: "大家好，今天首播新品。",
        transcript_utterances: [
          { text: "大家好，今天首播新品", startSeconds: 0, endSeconds: 4.5 },
        ],
        asr_provider: "doubao_asr",
      }),
    );
    expect(client.inserts.recording_ai_segments).toEqual([
      expect.objectContaining({
        segment_kind: "opening",
        evidence: expect.objectContaining({ source: "asr_transcript" }),
      }),
    ]);
  });

  it("executes an already claimed platform row without incrementing attempt again", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({
        status: "running",
        attempt: 2,
        claimed_by: "recording:test:1",
      }),
      asset: assetRowFixture(),
    });

    const result = await executeClaimedRecordingAiAnalysis({
      client: client as never,
      actor,
      workItem: {
        ...analysisFixture({
          status: "running",
          attempt: 2,
          claimed_by: "recording:test:1",
        }),
        recording_assets: assetRowFixture(),
      } as never,
      now: () => new Date("2026-07-01T11:00:00.000Z"),
      draftBuilder: buildRecordingAiAnalysisDraft,
      pipeline: () => Promise.resolve(pipelineResultFixture()),
    });

    expect(result.status).toBe("succeeded");
    expect(client.updates.recording_ai_analyses).toEqual([
      expect.not.objectContaining({ attempt: 3 }),
    ]);
  });

  it("falls back to the deterministic draft when the pipeline throws", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 0, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      pipeline: () =>
        Promise.reject(new Error("Doubao ASR failed with secret=abc")),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
      transcriptText: null,
      asrProvider: null,
    });
    expect(result.riskFlags).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "AI 转写分析不可用，已回退基础分析：Doubao ASR failed with secret=[redacted]",
        ),
      ]),
    );
    expect(client.updates.recording_ai_analyses.at(-1)).toEqual(
      expect.objectContaining({
        status: "succeeded",
        provider_name: "deterministic",
        transcript_text: null,
        asr_provider: null,
      }),
    );
  });

  it("skips the pipeline silently when it is not applicable", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 0, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      pipeline: () => Promise.resolve(null),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerName: "deterministic",
    });
    expect(result.riskFlags.join(" ")).not.toContain("已回退基础分析");
  });

  it("rejects a queued analysis outside the runner organization", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({
        organization_id: "org-other",
        attempt: 0,
        max_attempts: 3,
      }),
      asset: assetRowFixture(),
    });

    await expect(
      runRecordingAiAnalysisOnce({
        client: client as never,
        actor,
        analysisId: "analysis-1",
      }),
    ).rejects.toThrow("Recording AI analysis belongs to another organization");
    expect(client.updates.recording_ai_analyses).toEqual([]);
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });

  it("requeues failed analysis while attempts remain", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 0, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      draftBuilder: () => {
        throw new Error("provider failed with secret=abc123");
      },
    });

    expect(result).toMatchObject({
      status: "queued",
      errorSummary: "provider failed with secret=[redacted]",
    });
    expect(client.updates.recording_ai_analyses.at(-1)).toEqual(
      expect.objectContaining({
        status: "queued",
        attempt: 1,
        error_summary: "provider failed with secret=[redacted]",
        completed_at: null,
      }),
    );
  });

  it("marks failed analysis final after max attempts", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({ attempt: 2, max_attempts: 3 }),
      asset: assetRowFixture(),
    });

    const result = await runRecordingAiAnalysisOnce({
      client: client as never,
      actor,
      analysisId: "analysis-1",
      now: () => new Date("2026-07-01T11:30:00.000Z"),
      draftBuilder: () => {
        throw new Error("provider timeout");
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorSummary: "provider timeout",
      completedAt: "2026-07-01T11:30:00.000Z",
    });
    expect(client.updates.recording_ai_analyses.at(-1)).toEqual(
      expect.objectContaining({
        status: "failed",
        attempt: 3,
        completed_at: "2026-07-01T11:30:00.000Z",
      }),
    );
  });

  it("refuses a single run when another runner claims the analysis first", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [analysisFixture({ id: "analysis-1" })],
      asset: assetRowFixture(),
      beforeClaim: () => {
        client.setStatus("analysis-1", "running");
      },
    });

    await expect(
      runRecordingAiAnalysisOnce({
        client: client as never,
        actor,
        analysisId: "analysis-1",
      }),
    ).rejects.toThrow("claimed by another runner");
    expect(client.updates["analysis-1"]).toBeUndefined();
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });

  it("refuses a single run when the queued analysis was cancelled", async () => {
    const client = createRecordingAiClient({
      analysis: analysisFixture({
        attempt: 0,
        max_attempts: 3,
        cancel_requested_at: "2026-07-01T10:30:00.000Z",
      }),
      asset: assetRowFixture(),
    });

    await expect(
      runRecordingAiAnalysisOnce({
        client: client as never,
        actor,
        analysisId: "analysis-1",
      }),
    ).rejects.toThrow("Recording AI analysis was cancelled");
    expect(client.updates.recording_ai_analyses).toEqual([]);
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });
});

describe("claimAndRunRecordingAiAnalyses", () => {
  it("claims queued analyses in FIFO order up to the limit and executes them", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({
          id: "analysis-2",
          created_at: "2026-07-01T10:05:00.000Z",
        }),
        analysisFixture({
          id: "analysis-1",
          created_at: "2026-07-01T10:00:00.000Z",
        }),
        analysisFixture({
          id: "analysis-3",
          created_at: "2026-07-01T10:10:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      limit: 2,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result.failures).toEqual([]);
    expect(result.analyses).toEqual([
      { id: "analysis-1", status: "succeeded", attempt: 1 },
      { id: "analysis-2", status: "succeeded", attempt: 1 },
    ]);
    expect(client.updates["analysis-1"]).toEqual([
      expect.objectContaining({
        status: "running",
        attempt: 1,
        claimed_at: "2026-07-02T12:00:00.000Z",
        error_summary: null,
      }),
      expect.objectContaining({
        status: "succeeded",
        claimed_at: null,
        completed_at: "2026-07-02T12:00:00.000Z",
      }),
    ]);
    // The third analysis stays queued for the next scheduled run.
    expect(client.updates["analysis-3"]).toBeUndefined();
    expect(client.statusOf("analysis-3")).toBe("queued");
    expect(client.inserts.recording_ai_segments).toHaveLength(6);
  });

  it("returns an empty result when no analyses are queued", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({ id: "analysis-1", status: "succeeded" }),
        analysisFixture({ id: "analysis-2", status: "failed" }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
    });

    expect(result).toEqual({ analyses: [], failures: [] });
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });

  it("never double-runs an analysis claimed by another runner between listing and claiming", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({
          id: "analysis-1",
          created_at: "2026-07-01T10:00:00.000Z",
        }),
        analysisFixture({
          id: "analysis-2",
          created_at: "2026-07-01T10:05:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
      beforeClaim: (analysisId) => {
        // Simulate a concurrent runner winning the claim on analysis-2 after
        // it was listed but before our conditional update runs.
        if (analysisId === "analysis-2") {
          client.setStatus("analysis-2", "running");
        }
      },
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
    });

    expect(result.failures).toEqual([]);
    expect(result.analyses).toEqual([
      { id: "analysis-1", status: "succeeded", attempt: 1 },
    ]);
    expect(client.updates["analysis-2"]).toBeUndefined();
    expect(client.statusOf("analysis-2")).toBe("running");
    expect(client.inserts.recording_ai_segments).toHaveLength(3);
  });

  it("does not claim queued analyses that exhausted attempts", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({ id: "analysis-1", attempt: 3, max_attempts: 3 }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
    });

    expect(result).toEqual({ analyses: [], failures: [] });
    expect(client.updates["analysis-1"]).toBeUndefined();
    expect(client.statusOf("analysis-1")).toBe("queued");
  });

  it("requeues a claimed analysis when execution fails and attempts remain", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [analysisFixture({ id: "analysis-1" })],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      draftBuilder: () => {
        throw new Error("provider failed with secret=abc123");
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.analyses).toEqual([
      { id: "analysis-1", status: "queued", attempt: 1 },
    ]);
    expect(client.updates["analysis-1"]?.at(-1)).toEqual(
      expect.objectContaining({
        status: "queued",
        attempt: 1,
        claimed_at: null,
        error_summary: "provider failed with secret=[redacted]",
      }),
    );
    expect(client.statusOf("analysis-1")).toBe("queued");
  });

  it("reclaims running analyses whose claim exceeded the timeout", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        // Orphaned by a crashed runner 20 minutes ago (timeout is 15).
        analysisFixture({
          id: "analysis-1",
          status: "running",
          attempt: 1,
          claimed_at: "2026-07-02T11:40:00.000Z",
          created_at: "2026-07-01T10:00:00.000Z",
        }),
        analysisFixture({
          id: "analysis-2",
          created_at: "2026-07-01T10:05:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result.failures).toEqual([]);
    // The stale running row is reclaimed (consuming one more attempt) and
    // interleaves with queued rows in FIFO order by created_at.
    expect(result.analyses).toEqual([
      { id: "analysis-1", status: "succeeded", attempt: 2 },
      { id: "analysis-2", status: "succeeded", attempt: 1 },
    ]);
    expect(client.updates["analysis-1"]).toEqual([
      expect.objectContaining({
        status: "running",
        attempt: 2,
        claimed_at: "2026-07-02T12:00:00.000Z",
        error_summary: null,
      }),
      expect.objectContaining({
        status: "succeeded",
        claimed_at: null,
        completed_at: "2026-07-02T12:00:00.000Z",
      }),
    ]);
    expect(client.statusOf("analysis-1")).toBe("succeeded");
  });

  it("leaves running analyses within the claim timeout to their runner", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        // Claimed 10 minutes ago: still within the 15-minute timeout.
        analysisFixture({
          id: "analysis-1",
          status: "running",
          attempt: 1,
          claimed_at: "2026-07-02T11:50:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result).toEqual({ analyses: [], failures: [] });
    expect(client.updates["analysis-1"]).toBeUndefined();
    expect(client.statusOf("analysis-1")).toBe("running");
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });

  it("fails out stale running analyses that exhausted attempts instead of leaving them stuck", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({
          id: "analysis-1",
          status: "running",
          attempt: 3,
          max_attempts: 3,
          claimed_at: "2026-07-02T11:00:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result.analyses).toEqual([]);
    expect(result.failures).toEqual([
      {
        analysisId: "analysis-1",
        errorSummary: RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY,
      },
    ]);
    expect(client.updates["analysis-1"]).toEqual([
      {
        status: "failed",
        claimed_at: null,
        error_summary: RECORDING_AI_STALE_CLAIM_ERROR_SUMMARY,
        completed_at: "2026-07-02T12:00:00.000Z",
      },
    ]);
    expect(client.statusOf("analysis-1")).toBe("failed");
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });

  it("does not fail out an exhausted running analysis resolved between listing and finalization", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({
          id: "analysis-1",
          status: "running",
          attempt: 3,
          max_attempts: 3,
          claimed_at: "2026-07-02T11:00:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
      beforeClaim: () => {
        // The original runner was slow, not dead: it finishes right before
        // our conditional finalization runs.
        client.setStatus("analysis-1", "succeeded");
      },
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result).toEqual({ analyses: [], failures: [] });
    expect(client.updates["analysis-1"]).toBeUndefined();
    expect(client.statusOf("analysis-1")).toBe("succeeded");
  });

  it("never steals a stale running analysis resolved between listing and reclaim", async () => {
    const client = createRecordingAiQueueClient({
      analyses: [
        analysisFixture({
          id: "analysis-1",
          status: "running",
          attempt: 1,
          claimed_at: "2026-07-02T11:40:00.000Z",
        }),
      ],
      asset: assetRowFixture(),
      beforeClaim: () => {
        // The original runner was slow, not dead: it finishes the analysis
        // after we listed it but before our conditional reclaim runs.
        client.setStatus("analysis-1", "succeeded");
      },
    });

    const result = await claimAndRunRecordingAiAnalyses({
      client: client as never,
      actor,
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });

    expect(result).toEqual({ analyses: [], failures: [] });
    expect(client.updates["analysis-1"]).toBeUndefined();
    expect(client.statusOf("analysis-1")).toBe("succeeded");
    expect(client.inserts.recording_ai_segments).toEqual([]);
  });
});

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

function assetFixture(
  overrides: Partial<Omit<RecordingAssetDto, "primarySource" | "sources">> & {
    primarySource?: Partial<RecordingAssetSourceDto>;
  } = {},
): RecordingAssetDto {
  const primarySource: RecordingAssetSourceDto = {
    id: "source-1",
    sourceKind: "bilibili_url" as const,
    previewState: "previewable" as const,
    previewMode: "embed" as const,
    provider: "bilibili",
    externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    storagePath: null,
    openUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    embedUrl: "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD",
    downloadUrl: null,
    submittedAt: "2026-07-01T09:00:00.000Z",
    ...overrides.primarySource,
  };

  return {
    id: "asset-1",
    title: "项目录屏 v1",
    assetKind: "project_submission",
    reviewStatus: "submitted",
    reviewStatusLabel: "待审核",
    previewState: "previewable",
    durationSeconds: 1800,
    projectId: "project-1",
    applicationId: "application-1",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides,
    primarySource,
    sources: [primarySource],
    aiAnalysis: overrides.aiAnalysis ?? null,
  };
}

function analysisFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-1",
    organization_id: "org-1",
    asset_id: "asset-1",
    status: "queued",
    provider_name: "deterministic",
    summary: "",
    scorecard: {},
    dimensions: [],
    risk_flags: [],
    recommendations: [],
    attempt: 0,
    max_attempts: 3,
    claimed_at: null,
    error_summary: null,
    ai_invocation_id: "invocation-1",
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    completed_at: null,
    recording_ai_segments: [],
    ...overrides,
  };
}

function assetRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    title: "项目录屏 v1",
    asset_kind: "project_submission",
    review_status: "submitted",
    preview_state: "private_file",
    duration_seconds: 1800,
    project_id: "project-1",
    application_id: "application-1",
    created_at: "2026-07-01T09:00:00.000Z",
    updated_at: "2026-07-01T09:00:00.000Z",
    recording_asset_sources: [
      {
        id: "source-1",
        source_kind: "storage_object",
        preview_state: "private_file",
        provider: "private_storage",
        external_url: null,
        storage_path: "org-1/recordings/project-1/demo.mp4",
        submitted_at: "2026-07-01T09:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createRecordingAiClient({
  analysis,
  asset,
}: {
  analysis: Record<string, unknown>;
  asset: Record<string, unknown>;
}) {
  const state = {
    analysis: { ...analysis, recording_assets: asset } as Record<
      string,
      unknown
    >,
    segments: [] as Record<string, unknown>[],
  };
  const updates = {
    recording_ai_analyses: [] as Record<string, unknown>[],
  };
  const inserts = {
    recording_ai_segments: [] as Record<string, unknown>[],
    ai_invocations: [] as Record<string, unknown>[],
    usage_events: [] as Record<string, unknown>[],
    audit_logs: [] as Record<string, unknown>[],
  };

  return {
    updates,
    inserts,
    from(table: string) {
      if (table === "recording_ai_analyses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.analysis, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => {
                  updates.recording_ai_analyses.push(payload);
                  state.analysis = {
                    ...state.analysis,
                    ...payload,
                    recording_ai_segments: state.segments,
                  };
                  return { data: state.analysis, error: null };
                },
              }),
              // Conditional claim: update ... where id = ? and status = ?
              eq: (_column: string, expectedStatus: string) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (state.analysis.status !== expectedStatus) {
                      return { data: null, error: null };
                    }
                    updates.recording_ai_analyses.push(payload);
                    state.analysis = {
                      ...state.analysis,
                      ...payload,
                      recording_ai_segments: state.segments,
                    };
                    return { data: state.analysis, error: null };
                  },
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({
                data: { ...state.analysis, ...payload },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "recording_ai_segments") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            inserts.recording_ai_segments.push(...payload);
            state.segments = payload.map((segment, index) => ({
              id: `segment-${index + 1}`,
              segment_kind: segment.segment_kind,
              start_seconds: segment.start_seconds,
              end_seconds: segment.end_seconds,
              title: segment.title,
              summary: segment.summary,
              risk_level: segment.risk_level,
              evidence: segment.evidence,
              sort_order: segment.sort_order,
            }));
            return { error: null };
          },
        };
      }

      return {
        insert: async (payload: Record<string, unknown>) => {
          (inserts as Record<string, Record<string, unknown>[]>)[table]?.push(
            payload,
          );
          return { error: null };
        },
      };
    },
  };
}

// Mock Supabase client backed by a mutable multi-analysis queue. Supports the
// candidate listing chain, the conditional (optimistic-lock) claim chain and
// the unconditional per-id update chain used by the recording AI runner.
function createRecordingAiQueueClient({
  analyses,
  asset,
  beforeClaim,
}: {
  analyses: Record<string, unknown>[];
  asset: Record<string, unknown>;
  beforeClaim?: (analysisId: string) => void;
}) {
  const state = {
    analyses: analyses.map((analysis) => ({
      ...analysis,
      recording_assets: asset,
      recording_ai_segments: [],
    })) as Record<string, unknown>[],
  };
  const updates: Record<string, Record<string, unknown>[]> = {};
  const inserts = {
    recording_ai_segments: [] as Record<string, unknown>[],
  };

  const findById = (id: string) =>
    state.analyses.find((analysis) => analysis.id === id) ?? null;

  return {
    updates,
    inserts,
    setStatus(id: string, status: string) {
      const analysis = findById(id);
      if (analysis) {
        analysis.status = status;
      }
    },
    statusOf(id: string) {
      return findById(id)?.status;
    },
    from(table: string) {
      if (table === "recording_ai_analyses") {
        // ISO timestamps compare correctly as strings, so the mock mirrors
        // `claimed_at < cutoff` with a plain string comparison.
        const claimedBefore = (
          analysis: Record<string, unknown>,
          cutoff: string | undefined,
        ) =>
          cutoff === undefined ||
          (typeof analysis.claimed_at === "string" &&
            analysis.claimed_at < cutoff);

        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              single: async () => ({ data: findById(value), error: null }),
              // Candidate listing:
              // .eq(org).eq(status)[.lt(claimed_at)].order(...).limit(n)
              eq: (_statusColumn: string, statusValue: string) => {
                const list = (cutoff?: string) => ({
                  order: () => ({
                    limit: async (count: number) => ({
                      data: state.analyses
                        .filter(
                          (analysis) =>
                            analysis.organization_id === value &&
                            analysis.status === statusValue &&
                            claimedBefore(analysis, cutoff),
                        )
                        .sort((left, right) =>
                          String(left.created_at).localeCompare(
                            String(right.created_at),
                          ),
                        )
                        .slice(0, count)
                        .map((analysis) => ({
                          id: analysis.id,
                          attempt: analysis.attempt,
                          max_attempts: analysis.max_attempts,
                          created_at: analysis.created_at,
                        })),
                      error: null,
                    }),
                  }),
                });
                return {
                  ...list(),
                  lt: (_claimedColumn: string, cutoff: string) => list(cutoff),
                };
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_idColumn: string, id: string) => ({
              select: () => ({
                single: async () => {
                  const analysis = findById(id);
                  if (!analysis) {
                    return {
                      data: null,
                      error: new Error("analysis not found"),
                    };
                  }
                  (updates[id] ??= []).push(payload);
                  Object.assign(analysis, payload);
                  return { data: { ...analysis }, error: null };
                },
              }),
              // Conditional claim:
              // update ... where id = ? and status = ? [and claimed_at < ?]
              eq: (_statusColumn: string, expectedStatus: string) => {
                const claim = (cutoff?: string) => ({
                  select: () => ({
                    maybeSingle: async () => {
                      beforeClaim?.(id);
                      const analysis = findById(id);
                      if (
                        !analysis ||
                        analysis.status !== expectedStatus ||
                        !claimedBefore(analysis, cutoff)
                      ) {
                        return { data: null, error: null };
                      }
                      (updates[id] ??= []).push(payload);
                      Object.assign(analysis, payload);
                      return { data: { ...analysis }, error: null };
                    },
                  }),
                });
                return {
                  ...claim(),
                  lt: (_claimedColumn: string, cutoff: string) => claim(cutoff),
                };
              },
            }),
          }),
        };
      }

      if (table === "recording_ai_segments") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            inserts.recording_ai_segments.push(...payload);
            return { error: null };
          },
        };
      }

      return {
        insert: async () => ({ error: null }),
      };
    },
  };
}
