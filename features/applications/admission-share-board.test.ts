import { describe, expect, it, vi } from "vitest";

import {
  createAdmissionShareBoard,
  getPublicAdmissionShareBoard,
  getPublicAdmissionRecordingPlaybackSource,
  hashShareSecret,
  mapVendorDecisionToSyncPatch,
  submitVendorAdmissionReviews,
  type AdmissionShareBoardRepository,
} from "./admission-share-board";

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

function createRepo(
  overrides: Partial<AdmissionShareBoardRepository> = {},
): AdmissionShareBoardRepository & {
  shareBoardInserts: Record<string, unknown>[];
  shareItemInserts: Record<string, unknown>[];
} {
  const shareBoardInserts: Record<string, unknown>[] = [];
  const shareItemInserts: Record<string, unknown>[] = [];
  return {
    shareBoardInserts,
    shareItemInserts,
    listShareableApplications: vi.fn().mockResolvedValue([
      {
        id: "app-1",
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "recording_approved",
      },
      {
        id: "app-2",
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-2",
        status: "recording_approved",
      },
    ]),
    listLatestRecordings: vi.fn().mockResolvedValue([
      {
        id: "rec-1",
        applicationId: "app-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        version: 2,
        status: "approved",
      },
      {
        id: "rec-2",
        applicationId: "app-2",
        projectId: "project-1",
        streamerId: "streamer-2",
        version: 1,
        status: "approved",
      },
    ]),
    createShareBoard: vi.fn().mockImplementation(async (input) => {
      shareBoardInserts.push(input);
      return {
        id: "share-1",
        ...input,
        status: "active",
        createdAt: "2026-06-07T00:00:00.000Z",
      };
    }),
    createShareItems: vi.fn().mockImplementation(async (items) => {
      shareItemInserts.push(...items);
    }),
    listShareBoards: vi.fn().mockResolvedValue([]),
    revokeShareBoard: vi.fn(),
    getPublicShareBoardSnapshot: vi.fn(),
    upsertVendorReviews: vi.fn(),
    updateRecordingReviewForVendor: vi.fn(),
    updateApplicationStatusForVendor: vi.fn(),
    markShareBoardSubmitted: vi.fn(),
    ...overrides,
  };
}

describe("admission share board service", () => {
  it("hashes share secrets deterministically", () => {
    expect(hashShareSecret("share-token")).toBe(hashShareSecret("share-token"));
    expect(hashShareSecret("share-token")).not.toBe("share-token");
  });

  it("creates a share board without storing the plain token and locks recording versions", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await createAdmissionShareBoard({
      repo,
      audit,
      actor,
      projectId: "project-1",
      input: {
        title: "Vendor review",
        applicationIds: ["app-1", "app-2"],
        accessCode: "2468",
      },
      now: "2026-06-07T00:00:00.000Z",
      tokenFactory: () => "plain-token",
    });

    expect(result.token).toBe("plain-token");
    expect(repo.shareBoardInserts[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        tokenHash: hashShareSecret("plain-token"),
        accessCodeHash: hashShareSecret("2468"),
        expiresAt: "2026-06-14T00:00:00.000Z",
        allowVendorSubmit: true,
        createdBy: "user-ops",
      }),
    );
    expect(JSON.stringify(repo.shareBoardInserts)).not.toContain("plain-token");
    expect(repo.shareItemInserts).toEqual([
      expect.objectContaining({
        shareBoardId: "share-1",
        applicationId: "app-1",
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
      }),
      expect.objectContaining({
        shareBoardId: "share-1",
        applicationId: "app-2",
        recordingSubmissionId: "rec-2",
        recordingVersion: 1,
      }),
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create_share_board",
        module: "admission",
        objectType: "project_recording_share_board",
        projectId: "project-1",
      }),
    );
  });

  it("rejects share creation when a selected application has no recording", async () => {
    const repo = createRepo({
      listShareableApplications: vi.fn().mockResolvedValue([
        {
          id: "app-1",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          status: "recording_approved",
        },
      ]),
      listLatestRecordings: vi.fn().mockResolvedValue([]),
    });

    await expect(
      createAdmissionShareBoard({
        repo,
        actor,
        projectId: "project-1",
        input: { title: "Vendor review", applicationIds: ["app-1"] },
        now: "2026-06-07T00:00:00.000Z",
        tokenFactory: () => "plain-token",
      }),
    ).rejects.toThrow("Every shared application must have a recording");
  });

  it("rejects explicitly selected recordings that are not MCN approved", async () => {
    const repo = createRepo({
      listShareableApplications: vi.fn().mockResolvedValue([
        {
          id: "app-1",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          status: "recording_approved",
        },
      ]),
      listLatestRecordings: vi.fn().mockResolvedValue([
        {
          id: "rec-1",
          applicationId: "app-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          version: 1,
          status: "submitted",
        },
      ]),
    });

    await expect(
      createAdmissionShareBoard({
        repo,
        actor,
        projectId: "project-1",
        input: { title: "Vendor review", applicationIds: ["app-1"] },
        now: "2026-06-07T00:00:00.000Z",
        tokenFactory: () => "plain-token",
      }),
    ).rejects.toThrow("Every shared recording must be approved by MCN");
  });

  it("shares only approved applications with recordings when creating a project-level board", async () => {
    const repo = createRepo({
      listShareableApplications: vi.fn().mockResolvedValue([
        {
          id: "app-1",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          status: "recording_approved",
        },
        {
          id: "app-no-recording",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-2",
          status: "submitted",
        },
      ]),
      listLatestRecordings: vi.fn().mockResolvedValue([
        {
          id: "rec-1",
          applicationId: "app-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          version: 1,
          status: "approved",
        },
      ]),
    });

    await createAdmissionShareBoard({
      repo,
      actor,
      projectId: "project-1",
      input: { title: "Vendor review" },
      now: "2026-06-07T00:00:00.000Z",
      tokenFactory: () => "plain-token",
    });

    expect(repo.shareItemInserts).toEqual([
      expect.objectContaining({
        applicationId: "app-1",
        recordingSubmissionId: "rec-1",
      }),
    ]);
  });

  it("shares only MCN-approved recordings when creating a project-level board", async () => {
    const repo = createRepo({
      listShareableApplications: vi.fn().mockResolvedValue([
        {
          id: "app-approved",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-1",
          status: "recording_approved",
        },
        {
          id: "app-reviewing",
          organizationId: "org-1",
          projectId: "project-1",
          streamerId: "streamer-2",
          status: "recording_reviewing",
        },
      ]),
      listLatestRecordings: vi.fn().mockResolvedValue([
        {
          id: "rec-approved",
          applicationId: "app-approved",
          projectId: "project-1",
          streamerId: "streamer-1",
          version: 1,
          status: "approved",
        },
        {
          id: "rec-reviewing",
          applicationId: "app-reviewing",
          projectId: "project-1",
          streamerId: "streamer-2",
          version: 1,
          status: "submitted",
        },
      ]),
    });

    await createAdmissionShareBoard({
      repo,
      actor,
      projectId: "project-1",
      input: { title: "Vendor review" },
      now: "2026-06-07T00:00:00.000Z",
      tokenFactory: () => "plain-token",
    });

    expect(repo.shareItemInserts).toEqual([
      expect.objectContaining({
        applicationId: "app-approved",
        recordingSubmissionId: "rec-approved",
      }),
    ]);
  });

  it("rejects applications outside the target project", async () => {
    const repo = createRepo({
      listShareableApplications: vi.fn().mockResolvedValue([
        {
          id: "app-1",
          organizationId: "org-1",
          projectId: "project-2",
          streamerId: "streamer-1",
          status: "recording_reviewing",
        },
      ]),
    });

    await expect(
      createAdmissionShareBoard({
        repo,
        actor,
        projectId: "project-1",
        input: { title: "Vendor review", applicationIds: ["app-1"] },
        now: "2026-06-07T00:00:00.000Z",
        tokenFactory: () => "plain-token",
      }),
    ).rejects.toThrow("Applications must belong to the selected project");
  });

  it("maps vendor decisions to application and recording sync patches", () => {
    expect(
      mapVendorDecisionToSyncPatch("selected", "recording_reviewing"),
    ).toEqual({
      applicationStatus: "recording_approved",
      recordingStatus: "approved",
      syncStatus: "synced",
    });
    expect(
      mapVendorDecisionToSyncPatch("backup", "recording_reviewing"),
    ).toEqual({
      applicationStatus: null,
      recordingStatus: null,
      syncStatus: "synced",
    });
    expect(mapVendorDecisionToSyncPatch("selected", "joined")).toEqual({
      applicationStatus: null,
      recordingStatus: null,
      syncStatus: "skipped",
    });
  });

  it("returns a public share DTO without token hashes or private storage paths", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    const dto = await getPublicAdmissionShareBoard({
      repo,
      token: "plain-token",
      accessCode: "2468",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(dto).toEqual(
      expect.objectContaining({
        id: "share-1",
        title: "Vendor review",
        project: expect.objectContaining({ id: "project-1" }),
        items: [
          expect.objectContaining({
            applicationId: "app-1",
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            recordingUrl: "https://video.example/rec-1",
            playbackUrl:
              "/api/public/admission-share/plain-token/recordings/rec-1?accessCode=2468",
            hasPrivateStorage: true,
            vendorReview: {
              decision: "backup",
              remark: "可作为备选。",
              submittedAt: "2026-07-29T10:00:00.000Z",
            },
          }),
          expect.objectContaining({
            applicationId: "app-2",
            recordingSubmissionId: "rec-2",
            recordingVersion: 1,
            recordingUrl: null,
            playbackUrl:
              "/api/public/admission-share/plain-token/recordings/rec-2?accessCode=2468",
            hasPrivateStorage: true,
          }),
        ],
      }),
    );
    expect(JSON.stringify(dto)).not.toContain("tokenHash");
    expect(JSON.stringify(dto)).not.toContain("accessCodeHash");
    expect(JSON.stringify(dto)).not.toContain("private/path/rec-2.mp4");
    expect(JSON.stringify(dto)).not.toContain("reviewerName");
    expect(JSON.stringify(dto)).not.toContain("reviewerContact");
  });

  it("resolves private recording playback sources only after share gating", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    const source = await getPublicAdmissionRecordingPlaybackSource({
      repo,
      token: "plain-token",
      recordingSubmissionId: "rec-2",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(source).toEqual({
      recordingUrl: null,
      storagePath: "private/path/rec-2.mp4",
    });
    expect(repo.getPublicShareBoardSnapshot).toHaveBeenCalledWith(
      hashShareSecret("plain-token"),
    );
  });

  it("rejects expired public share links", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi
        .fn()
        .mockResolvedValue(
          publicSnapshot({ expiresAt: "2026-06-06T00:00:00.000Z" }),
        ),
    });

    await expect(
      getPublicAdmissionShareBoard({
        repo,
        token: "plain-token",
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toThrow("Share link is expired or revoked");
  });

  it("records human-tagged evaluations when vendors pick reason codes", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      upsertVendorReviews: vi.fn().mockResolvedValue([
        { id: "vendor-review-1", recordingSubmissionId: "rec-1" },
        { id: "vendor-review-2", recordingSubmissionId: "rec-2" },
      ]),
    });
    const recordEvaluation = vi.fn().mockResolvedValue(undefined);

    await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {
        items: [
          {
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "rejected",
            remark: "话术不贴卖点",
            reasonCodes: ["script_fit"],
          },
          {
            recordingSubmissionId: "rec-2",
            recordingVersion: 1,
            decision: "backup",
            remark: "备选",
          },
        ],
      },
      now: "2026-06-07T05:00:00.000Z",
      recordEvaluation,
    });

    // 只有带理由标签的项触发评估；无标签项交给 LLM 归一化 runner 兜底。
    expect(recordEvaluation).toHaveBeenCalledTimes(1);
    expect(recordEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        applicationId: "app-1",
        recordingSubmissionId: "rec-1",
        vendorReviewId: "vendor-review-1",
        decision: "rejected",
        remark: "话术不贴卖点",
        reasonCodes: ["script_fit"],
      }),
    );
  });

  it("never fails a vendor submission because evaluation recording failed", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      upsertVendorReviews: vi
        .fn()
        .mockResolvedValue([
          { id: "vendor-review-1", recordingSubmissionId: "rec-1" },
        ]),
    });

    const result = await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {
        items: [
          {
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "rejected",
            remark: "违规承诺",
            reasonCodes: ["compliance_violation"],
          },
        ],
      },
      now: "2026-06-07T05:00:00.000Z",
      recordEvaluation: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(result.submittedCount).toBe(1);
  });

  it("submits vendor reviews and syncs selected decisions", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    const result = await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {
        reviewerName: "Vendor Reviewer",
        reviewerContact: "reviewer@example.com",
        items: [
          {
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "selected",
            remark: "Good fit.",
          },
          {
            recordingSubmissionId: "rec-2",
            recordingVersion: 1,
            decision: "backup",
            remark: "Backup only.",
          },
        ],
      },
      now: "2026-06-07T05:00:00.000Z",
    });

    expect(result).toEqual({
      submittedCount: 2,
      syncedCount: 1,
      skippedCount: 1,
    });
    expect(repo.upsertVendorReviews).toHaveBeenCalledWith([
      expect.objectContaining({
        decision: "selected",
        syncedApplicationStatus: "recording_approved",
        syncedRecordingStatus: "approved",
        syncStatus: "synced",
      }),
      expect.objectContaining({
        decision: "backup",
        syncedApplicationStatus: null,
        syncedRecordingStatus: null,
        syncStatus: "skipped",
      }),
    ]);
    expect(repo.updateRecordingReviewForVendor).toHaveBeenCalledWith(
      "rec-1",
      expect.objectContaining({ status: "approved", reviewNote: "Good fit." }),
    );
    expect(repo.updateApplicationStatusForVendor).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({
        status: "recording_approved",
        decisionReason: "Good fit.",
      }),
    );
    expect(repo.markShareBoardSubmitted).toHaveBeenCalledWith(
      "share-1",
      "2026-06-07T05:00:00.000Z",
    );
  });

  it("persists vendor backup decisions without changing MCN-approved statuses", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {
        reviewerName: "Vendor",
        items: [
          {
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "backup",
            remark: "Keep as backup.",
          },
        ],
      },
      now: "2026-06-07T08:00:00.000Z",
    });

    expect(repo.updateRecordingReviewForVendor).not.toHaveBeenCalled();
    expect(repo.updateApplicationStatusForVendor).not.toHaveBeenCalled();
    expect(repo.upsertVendorReviews).toHaveBeenCalledWith([
      expect.objectContaining({
        decision: "backup",
        remark: "Keep as backup.",
        syncedApplicationStatus: null,
        syncedRecordingStatus: null,
        syncStatus: "synced",
      }),
    ]);
  });

  it.each([
    {
      decision: "rejected",
      expectedApplicationStatus: "recording_rejected",
      expectedRecordingStatus: "rejected",
      remark: "Quality is not enough.",
    },
    {
      decision: "needs_changes",
      expectedApplicationStatus: "recording_required",
      expectedRecordingStatus: "needs_changes",
      remark: "Please add gameplay intro.",
    },
  ] as const)(
    "syncs vendor $decision to recording and application details",
    async ({
      decision,
      expectedApplicationStatus,
      expectedRecordingStatus,
      remark,
    }) => {
      const repo = createRepo({
        getPublicShareBoardSnapshot: vi
          .fn()
          .mockResolvedValue(publicSnapshot()),
      });

      await submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: {
          items: [
            {
              recordingSubmissionId: "rec-1",
              recordingVersion: 2,
              decision,
              remark,
            },
          ],
        },
        now: "2026-06-07T08:00:00.000Z",
      });

      expect(repo.updateRecordingReviewForVendor).toHaveBeenCalledWith(
        "rec-1",
        expect.objectContaining({
          status: expectedRecordingStatus,
          reviewNote: remark,
        }),
      );
      expect(repo.updateApplicationStatusForVendor).toHaveBeenCalledWith(
        "app-1",
        expect.objectContaining({
          status: expectedApplicationStatus,
          decisionReason: remark,
        }),
      );
    },
  );

  it.each(["rejected", "needs_changes"] as const)(
    "requires a remark for vendor %s decisions",
    async (decision) => {
      const repo = createRepo({
        getPublicShareBoardSnapshot: vi
          .fn()
          .mockResolvedValue(publicSnapshot()),
      });

      await expect(
        submitVendorAdmissionReviews({
          repo,
          token: "plain-token",
          input: {
            items: [
              {
                recordingSubmissionId: "rec-1",
                recordingVersion: 2,
                decision,
                remark: " ",
              },
            ],
          },
          now: "2026-06-07T08:00:00.000Z",
        }),
      ).rejects.toThrow("Vendor rejection or change request requires a remark");
    },
  );

  it("rejects stale recording versions on vendor submit", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    await expect(
      submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: {
          reviewerName: "Vendor Reviewer",
          items: [
            {
              recordingSubmissionId: "rec-1",
              recordingVersion: 1,
              decision: "selected",
            },
          ],
        },
        now: "2026-06-07T05:00:00.000Z",
      }),
    ).rejects.toThrow("Recording version is stale");
  });
});

function publicSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-1",
    organizationId: "org-1",
    projectId: "project-1",
    title: "Vendor review",
    tokenHash: hashShareSecret("plain-token"),
    accessCodeHash: null,
    status: "active" as const,
    expiresAt: "2026-06-14T00:00:00.000Z",
    allowVendorSubmit: true,
    project: {
      id: "project-1",
      code: "P-001",
      name: "Alpha",
      vendor: "Vendor",
      product: "Game",
    },
    items: [
      {
        applicationId: "app-1",
        applicationStatus: "recording_reviewing" as const,
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        recordingStatus: "reviewing" as const,
        recordingUrl: "https://video.example/rec-1",
        storagePath: "private/path/rec-1.mp4",
        streamer: {
          id: "streamer-1",
          displayName: "Streamer One",
          accountLabel: "Douyin / one-live",
        },
        vendorReview: {
          decision: "backup" as const,
          remark: "可作为备选。",
          reviewerName: "厂家复核人",
          reviewerContact: "reviewer@example.com",
          submittedAt: "2026-07-29T10:00:00.000Z",
        },
      },
      {
        applicationId: "app-2",
        applicationStatus: "joined" as const,
        recordingSubmissionId: "rec-2",
        recordingVersion: 1,
        recordingStatus: "approved" as const,
        recordingUrl: null,
        storagePath: "private/path/rec-2.mp4",
        streamer: {
          id: "streamer-2",
          displayName: "Streamer Two",
          accountLabel: "Bilibili / two-live",
        },
        vendorReview: null,
      },
    ],
    ...overrides,
  };
}
