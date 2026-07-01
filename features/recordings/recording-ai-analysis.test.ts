import { describe, expect, it } from "vitest";

import {
  buildRecordingAiAnalysisDraft,
  runRecordingAiAnalysisOnce,
  toRecordingAiAnalysisDto,
} from "./recording-ai-analysis";
import type {
  RecordingAssetDto,
  RecordingAssetSourceDto,
} from "./recording-assets";

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
