import { describe, expect, it } from "vitest";

import { confirmRecordingAiProfileInsight } from "./recording-profile-insights";

const actor = {
  userId: "user-ops",
  email: "ops@example.com",
  name: "Ops",
  organizationId: "org-1",
  organizationName: "Org",
  role: "ops_manager" as const,
};

describe("recording profile insights", () => {
  it("confirms a succeeded recording AI analysis into a streamer profile insight", async () => {
    const client = createProfileInsightClient({
      analysis: analysisRow(),
    });

    const insight = await confirmRecordingAiProfileInsight({
      client: client as never,
      actor,
      assetId: "asset-1",
    });

    expect(client.queries.recording_ai_analyses).toEqual(
      expect.objectContaining({
        asset_id: "asset-1",
        status: "succeeded",
      }),
    );
    expect(client.upserts.streamer_profile_insights).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        streamer_id: "streamer-1",
        project_id: "project-1",
        recording_asset_id: "asset-1",
        recording_ai_analysis_id: "analysis-1",
        source_type: "recording_ai_analysis",
        source_ref: "recording_ai_analyses:analysis-1",
        title: "录屏 AI 观察 · 项目录屏 v3",
        summary: "建议补充互动亮点后再通过。",
        strengths: ["节奏 82：开场节奏稳定。"],
        risks: ["互动证明不足", "互动 58：缺少评论区回应。"],
        recommendations: ["补录互动片段 - 补录 30 秒评论区回应，再进入厂家复核。"],
        tags: expect.arrayContaining([
          "recording_ai",
          "confirmed",
          "节奏",
          "互动",
        ]),
        created_by: "user-ops",
      }),
    ]);
    expect(insight).toMatchObject({
      id: "insight-1",
      streamerId: "streamer-1",
      sourceRef: "recording_ai_analyses:analysis-1",
      summary: "建议补充互动亮点后再通过。",
    });
  });

  it("requires an operations role and a completed analysis", async () => {
    await expect(
      confirmRecordingAiProfileInsight({
        client: createProfileInsightClient({ analysis: analysisRow() }) as never,
        actor: { ...actor, role: "finance" },
        assetId: "asset-1",
      }),
    ).rejects.toThrow("Only operations staff can confirm profile insights");

    await expect(
      confirmRecordingAiProfileInsight({
        client: createProfileInsightClient({ analysis: null }) as never,
        actor,
        assetId: "asset-1",
      }),
    ).rejects.toThrow("Completed recording AI analysis not found");
  });
});

function analysisRow() {
  return {
    id: "analysis-1",
    organization_id: "org-1",
    asset_id: "asset-1",
    status: "succeeded",
    provider_name: "deterministic",
    summary: "建议补充互动亮点后再通过。",
    scorecard: { rhythm: 82, interaction: 58 },
    dimensions: [
      {
        key: "rhythm",
        label: "节奏",
        score: 82,
        finding: "开场节奏稳定。",
      },
      {
        key: "interaction",
        label: "互动",
        score: 58,
        finding: "缺少评论区回应。",
      },
    ],
    risk_flags: ["互动证明不足"],
    recommendations: [
      {
        title: "补录互动片段",
        detail: "补录 30 秒评论区回应，再进入厂家复核。",
        requiresHumanApproval: true,
      },
    ],
    error_summary: null,
    ai_invocation_id: "invocation-1",
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:05:00.000Z",
    completed_at: "2026-07-01T10:05:00.000Z",
    recording_ai_segments: [],
    recording_assets: {
      id: "asset-1",
      organization_id: "org-1",
      streamer_id: "streamer-1",
      project_id: "project-1",
      application_id: "application-1",
      title: "项目录屏 v3",
    },
  };
}

function createProfileInsightClient({
  analysis,
}: {
  analysis: ReturnType<typeof analysisRow> | null;
}) {
  const queries: Record<string, Record<string, unknown>> = {
    recording_ai_analyses: {},
  };
  const upserts: Record<string, Record<string, unknown>[]> = {
    streamer_profile_insights: [],
  };
  const insightRow = {
    id: "insight-1",
    organization_id: "org-1",
    streamer_id: "streamer-1",
    source_type: "recording_ai_analysis",
    source_ref: "recording_ai_analyses:analysis-1",
    recording_asset_id: "asset-1",
    recording_ai_analysis_id: "analysis-1",
    project_id: "project-1",
    title: "录屏 AI 观察 · 项目录屏 v3",
    summary: "建议补充互动亮点后再通过。",
    strengths: ["节奏 82：开场节奏稳定。"],
    risks: ["互动证明不足", "互动 58：缺少评论区回应。"],
    recommendations: ["补录互动片段 - 补录 30 秒评论区回应，再进入厂家复核。"],
    dimensions: [
      {
        key: "rhythm",
        label: "节奏",
        score: 82,
        finding: "开场节奏稳定。",
      },
    ],
    tags: ["recording_ai", "confirmed", "节奏", "互动"],
    created_by: "user-ops",
    confirmed_at: "2026-07-02T09:00:00.000Z",
    created_at: "2026-07-02T09:00:00.000Z",
  };
  return {
    queries,
    upserts,
    from(table: string) {
      if (table === "recording_ai_analyses") {
        return {
          select: () => ({
            eq(column: string, value: unknown) {
              queries.recording_ai_analyses[column] = value;
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle: async () => ({ data: analysis, error: null }),
          }),
        };
      }
      if (table === "streamer_profile_insights") {
        return {
          upsert(payload: Record<string, unknown>) {
            upserts.streamer_profile_insights.push(payload);
            return {
              select: () => ({
                single: async () => ({ data: insightRow, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}
