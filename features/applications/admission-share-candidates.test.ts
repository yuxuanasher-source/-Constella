import { describe, expect, it, vi } from "vitest";

import {
  getAdmissionShareCandidatePlayback,
  listAdmissionShareCandidates,
  SupabaseAdmissionShareCandidateRepository,
} from "./admission-share-candidates";

function candidateRow(index: number) {
  return {
    id: `recording-${index}`,
    application_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    streamer_id: `streamer-${index}`,
    version: 1,
    status: "rejected",
    storage_path: `org-contributor/recordings/original-${index}.mp4`,
    external_url: null,
    mcn_review_decision: "approved",
    mcn_reviewed_at: "2026-07-30T08:00:00.000Z",
    streamer: {
      id: `streamer-${index}`,
      display_name: `主播${index}`,
      streamer_accounts: [
        {
          account_handle: `dy_${index}`,
          is_primary: true,
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
    vendor_reviews: [],
    share_items: [],
  };
}

describe("admission share candidates", () => {
  it("lets the host list every contributor-owned historical version", async () => {
    const rows = [
      {
        id: "recording-v2",
        application_id: "app-1",
        streamer_id: "streamer-1",
        version: 2,
        status: "rejected",
        storage_path: "org-contributor/recordings/original-v2.mp4",
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
        storage_path: "org-contributor/recordings/original-v1.mp4",
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
    const range = vi.fn().mockResolvedValue({ data: rows, error: null });
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order,
      or: vi.fn(),
      limit,
      range,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    order.mockReturnValue(recordingQuery);
    recordingQuery.or.mockReturnValue(recordingQuery);
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-1", organization_id: "org-1" },
      error: null,
    });
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: projectMaybeSingle,
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const from = vi.fn((table: string) =>
      table === "projects" ? projectQuery : recordingQuery,
    );
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
    expect(from).toHaveBeenNthCalledWith(1, "projects");
    expect(from).toHaveBeenNthCalledWith(2, "recording_submissions");
    expect(projectQuery.eq).toHaveBeenCalledWith("id", "project-1");
    expect(projectQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(recordingQuery.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(recordingQuery.eq).not.toHaveBeenCalledWith(
      "organization_id",
      expect.anything(),
    );
    expect(order).toHaveBeenNthCalledWith(1, "application_id", {
      ascending: true,
    });
    expect(order).toHaveBeenNthCalledWith(2, "version", {
      ascending: false,
    });
  });

  it("keeps the original set stable when a higher version is inserted before the cursor", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) =>
      candidateRow(index),
    );
    rows[999] = {
      ...rows[999],
      version: 2,
    };
    rows[1000] = {
      ...rows[1000],
      application_id: rows[999].application_id,
      version: 1,
    };
    const insertedAfterFirstPage = {
      ...rows[999],
      id: "recording-inserted-after-first-page",
      version: 3,
    };
    const firstPage = rows.slice(0, 1000);
    const secondPage = rows.slice(1000);
    const limit = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [insertedAfterFirstPage, ...rows].slice(1000).slice(0, 1000),
        error: null,
      });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      or: vi.fn(),
      limit,
      range,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    recordingQuery.order.mockReturnValue(recordingQuery);
    recordingQuery.or.mockReturnValue(recordingQuery);
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-1" },
      error: null,
    });
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: projectMaybeSingle,
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const from = vi.fn((table: string) =>
      table === "projects" ? projectQuery : recordingQuery,
    );
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from,
    } as never);

    const candidates = await listAdmissionShareCandidates(repo, {
      organizationId: "org-1",
      projectId: "project-1",
    });

    expect(candidates).toHaveLength(1001);
    expect(
      new Set(candidates.map((item) => item.recordingSubmissionId)).size,
    ).toBe(1001);
    expect(
      candidates.some(
        (item) => item.recordingSubmissionId === insertedAfterFirstPage.id,
      ),
    ).toBe(false);
    expect(candidates[999].isLatestVersion).toBe(true);
    expect(candidates[1000].isLatestVersion).toBe(false);
    expect(range).not.toHaveBeenCalled();
    expect(limit).toHaveBeenNthCalledWith(1, 1000);
    expect(limit).toHaveBeenNthCalledWith(2, 1000);
    expect(recordingQuery.or).toHaveBeenCalledWith(
      `application_id.gt.${rows[999].application_id},and(application_id.eq.${rows[999].application_id},version.lt.2)`,
    );
    expect(recordingQuery.order).toHaveBeenNthCalledWith(1, "application_id", {
      ascending: true,
    });
    expect(recordingQuery.order).toHaveBeenNthCalledWith(2, "version", {
      ascending: false,
    });
    expect(recordingQuery.order).toHaveBeenNthCalledWith(3, "application_id", {
      ascending: true,
    });
    expect(recordingQuery.order).toHaveBeenNthCalledWith(4, "version", {
      ascending: false,
    });
    expect(
      from.mock.calls.filter(([table]) => table === "projects"),
    ).toHaveLength(1);
    expect(
      from.mock.calls.filter(([table]) => table === "recording_submissions"),
    ).toHaveLength(2);
  });

  it("aborts candidate pagination when a later page fails", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) =>
      candidateRow(index),
    );
    const pageError = new Error("candidate page failed");
    const limit = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: null, error: pageError });
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: null, error: pageError });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      or: vi.fn(),
      limit,
      range,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    recordingQuery.order.mockReturnValue(recordingQuery);
    recordingQuery.or.mockReturnValue(recordingQuery);
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "project-1" },
        error: null,
      }),
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from: vi.fn((table: string) =>
        table === "projects" ? projectQuery : recordingQuery,
      ),
    } as never);

    await expect(
      listAdmissionShareCandidates(repo, {
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toBe(pageError);
    expect(range).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid database cursor before building a PostgREST filter", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) =>
      candidateRow(index),
    );
    rows[999] = {
      ...rows[999],
      application_id: "bad),or(application_id.neq.null",
    };
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: rows, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      or: vi.fn(),
      limit,
      range,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    recordingQuery.order.mockReturnValue(recordingQuery);
    recordingQuery.or.mockReturnValue(recordingQuery);
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "project-1" },
        error: null,
      }),
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from: vi.fn((table: string) =>
        table === "projects" ? projectQuery : recordingQuery,
      ),
    } as never);

    await expect(
      listAdmissionShareCandidates(repo, {
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).rejects.toThrow("Invalid admission share candidate cursor");
    expect(recordingQuery.or).not.toHaveBeenCalled();
  });

  it("lets the host play a contributor-owned original without mutable status filters", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        storage_path: "org-contributor/recordings/original.mp4",
        external_url: "https://video.example/fallback",
      },
      error: null,
    });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-1", organization_id: "org-1" },
      error: null,
    });
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: projectMaybeSingle,
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const from = vi.fn((table: string) =>
      table === "projects" ? projectQuery : recordingQuery,
    );
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
      storagePath: "org-contributor/recordings/original.mp4",
    });
    expect(projectQuery.eq).toHaveBeenCalledWith("id", "project-1");
    expect(projectQuery.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(recordingQuery.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(recordingQuery.eq).toHaveBeenCalledWith("id", "recording-v1");
    expect(recordingQuery.eq).toHaveBeenCalledWith(
      "mcn_review_decision",
      "approved",
    );
    expect(recordingQuery.eq).not.toHaveBeenCalledWith(
      "organization_id",
      expect.anything(),
    );
    expect(recordingQuery.eq).not.toHaveBeenCalledWith(
      "status",
      expect.anything(),
    );
  });

  it("rejects an unsafe external-only playback source", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        storage_path: null,
        external_url: "javascript:alert(1)",
      },
      error: null,
    });
    const recordingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    recordingQuery.select.mockReturnValue(recordingQuery);
    recordingQuery.eq.mockReturnValue(recordingQuery);
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-1", organization_id: "org-1" },
      error: null,
    });
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: projectMaybeSingle,
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from: vi.fn((table: string) =>
        table === "projects" ? projectQuery : recordingQuery,
      ),
    } as never);

    await expect(
      getAdmissionShareCandidatePlayback(repo, {
        organizationId: "org-1",
        projectId: "project-1",
        recordingSubmissionId: "recording-v1",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a collaboration organization before reading host recordings", async () => {
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const projectQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: projectMaybeSingle,
    };
    projectQuery.select.mockReturnValue(projectQuery);
    projectQuery.eq.mockReturnValue(projectQuery);
    const from = vi.fn((table: string) => {
      if (table !== "projects") {
        throw new Error("recordings must not be queried");
      }
      return projectQuery;
    });
    const repo = new SupabaseAdmissionShareCandidateRepository({
      from,
    } as never);

    await expect(
      listAdmissionShareCandidates(repo, {
        organizationId: "org-collaborator",
        projectId: "project-1",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(projectQuery.eq).toHaveBeenCalledWith(
      "organization_id",
      "org-collaborator",
    );
    expect(from).toHaveBeenCalledTimes(1);
  });
});
