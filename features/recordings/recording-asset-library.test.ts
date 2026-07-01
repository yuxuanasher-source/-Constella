import { describe, expect, it, vi } from "vitest";

import { createSignedDownloadUrl } from "@/features/storage/private-upload";

import { listStreamerRecordingAssets } from "./recording-asset-library";

vi.mock("@/features/storage/private-upload", () => ({
  createSignedDownloadUrl: vi.fn(async ({ path }: { path: string }) => ({
    signedUrl: `https://download.local/${path}`,
  })),
}));

describe("recording asset library", () => {
  it("lists streamer assets with signed private-file preview URLs", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: "asset-1",
          title: "项目录屏 v1",
          asset_kind: "project_submission",
          review_status: "submitted",
          preview_state: "private_file",
          duration_seconds: 900,
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
          recording_ai_analyses: [
            {
              id: "analysis-1",
              asset_id: "asset-1",
              status: "succeeded",
              provider_name: "deterministic",
              summary: "录屏节奏稳定，适合进入人工复核。",
              scorecard: { rhythm: 82, interaction: 76 },
              dimensions: [
                {
                  key: "rhythm",
                  label: "直播节奏",
                  score: 82,
                  finding: "开场节奏稳定",
                },
              ],
              risk_flags: [],
              recommendations: [
                {
                  title: "人工复核高光片段",
                  detail: "确认后进入主播画像。",
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
            },
          ],
        },
      ],
      error: null,
    });
    const eqStreamer = vi.fn(() => ({ order }));
    const eqOrg = vi.fn(() => ({ eq: eqStreamer }));
    const select = vi.fn(() => ({ eq: eqOrg }));
    const supabase = {
      from: vi.fn(() => ({ select })),
    };

    const assets = await listStreamerRecordingAssets(supabase as never, {
      organizationId: "org-1",
      streamerId: "streamer-1",
      bucket: "private",
    });

    expect(supabase.from).toHaveBeenCalledWith("recording_assets");
    expect(eqOrg).toHaveBeenCalledWith("organization_id", "org-1");
    expect(eqStreamer).toHaveBeenCalledWith("streamer_id", "streamer-1");
    expect(createSignedDownloadUrl).toHaveBeenCalledWith({
      client: supabase,
      bucket: "private",
      path: "org-1/recordings/project-1/demo.mp4",
      expiresInSeconds: 3600,
    });
    expect(assets).toEqual([
      expect.objectContaining({
        id: "asset-1",
        title: "项目录屏 v1",
        primarySource: expect.objectContaining({
          previewMode: "private_file",
          downloadUrl:
            "https://download.local/org-1/recordings/project-1/demo.mp4",
        }),
        aiAnalysis: expect.objectContaining({
          id: "analysis-1",
          status: "succeeded",
          summary: "录屏节奏稳定，适合进入人工复核。",
          segments: [
            expect.objectContaining({
              title: "开场",
              timeRangeLabel: "00:00 - 02:00",
            }),
          ],
        }),
      }),
    ]);
  });
});
