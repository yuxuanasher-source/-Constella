import { describe, expect, it, vi } from "vitest";

import {
  getAdmissionShareCandidatePlayback,
  listAdmissionShareCandidates,
  SupabaseAdmissionShareCandidateRepository,
} from "./admission-share-candidates";

describe("admission share candidates", () => {
  it("lists every historical version using immutable MCN approval and source health", async () => {
    const rows = [
      {
        id: "recording-v2",
        application_id: "app-1",
        streamer_id: "streamer-1",
        version: 2,
        status: "rejected",
        storage_path: "org-1/recordings/original-v2.mp4",
        external_url: "https://video.example/v2",
        mcn_review_decision: "approved",
        mcn_reviewed_at: "2026-07-30T08:00:00.000Z",
        streamer: {
          id: "streamer-1",
          display_name: "主播甲",
          streamer_accounts: [
            {
              account_handle: "dy_1",
              is_primary: true,
              created_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
        vendor_reviews: [
          {
            decision: "rejected",
            submitted_at: "2026-07-30T09:00:00.000Z",
          },
        ],
        share_items: [
          {
            created_at: "2026-07-30T08:30:00.000Z",
          },
        ],
      },
      {
        id: "recording-v1",
        application_id: "app-1",
        streamer_id: "streamer-1",
        version: 1,
        status: "needs_changes",
        storage_path: "org-1/recordings/original-v1.mp4",
        external_url: null,
        mcn_review_decision: "approved",
        mcn_reviewed_at: "2026-07-29T08:00:00.000Z",
        streamer: {
          id: "streamer-1",
          display_name: "主播甲",
          streamer_accounts: [
            {
              account_handle: "dy_1",
              is_primary: true,
              created_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
        vendor_reviews: [],
        share_items: [],
      },
    ];
    const order = vi.fn();
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    order
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: rows, error: null });
    const from = vi.fn(() => query);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from,
    } as never);

    const candidates = await listAdmissionShareCandidates(repo, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        applicationId: "app-1",
        recordingSubmissionId: "recording-v2",
        recordingVersion: 2,
        isLatestVersion: true,
        mcnReviewDecision: "approved",
        sourceHealth: "original_with_external_fallback",
        isShareable: true,
        currentVendorDecision: "rejected",
      }),
      expect.objectContaining({
        applicationId: "app-1",
        recordingSubmissionId: "recording-v1",
        recordingVersion: 1,
        isLatestVersion: false,
        mcnReviewDecision: "approved",
        isShareable: true,
      }),
    ]);
    expect(Object.keys(candidates[0]).sort()).toEqual(
      [
        "applicationId",
        "recordingSubmissionId",
        "recordingVersion",
        "isLatestVersion",
        "streamer",
        "mcnReviewDecision",
        "mcnReviewedAt",
        "sourceHealth",
        "hasPrivateStorage",
        "externalUrl",
        "isShareable",
        "blockReason",
        "currentVendorDecision",
        "lastSharedAt",
      ].sort(),
    );
    expect(JSON.stringify(candidates)).not.toContain("storage_path");
    expect(from).toHaveBeenCalledWith("recording_submissions");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(order).toHaveBeenNthCalledWith(1, "application_id", {
      ascending: true,
    });
    expect(order).toHaveBeenNthCalledWith(2, "version", {
      ascending: false,
    });
  });

  it("chooses the original source without depending on mutable statuses", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        storage_path: "org-1/recordings/original.mp4",
        external_url: "https://video.example/fallback",
      },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from,
    } as never);

    await expect(
      getAdmissionShareCandidatePlayback(repo, {
        organizationId: "org-1",
        projectId: "project-1",
        recordingSubmissionId: "recording-v1",
      }),
    ).resolves.toEqual({
      sourceType: "original",
      storagePath: "org-1/recordings/original.mp4",
    });
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(query.eq).toHaveBeenCalledWith("id", "recording-v1");
    expect(query.eq).toHaveBeenCalledWith("mcn_review_decision", "approved");
    expect(query.eq).not.toHaveBeenCalledWith("status", expect.anything());
  });

  it("rejects an unsafe external-only playback source", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        storage_path: null,
        external_url: "javascript:alert(1)",
      },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from: vi.fn(() => query),
    } as never);

    await expect(
      getAdmissionShareCandidatePlayback(repo, {
        organizationId: "org-1",
        projectId: "project-1",
        recordingSubmissionId: "recording-v1",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
