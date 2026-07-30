import { describe, expect, it, vi } from "vitest";

import {
  authenticatePublicAdmissionShareAccess,
  createAdmissionShareBoard,
  getPublicAdmissionShareBoard,
  getPublicAdmissionRecordingPlaybackSource,
  hashAdmissionShareAccessCode,
  hashShareSecret,
  mapVendorDecisionToSyncPatch,
  submitVendorAdmissionReviews,
  verifyAdmissionShareAccessCode,
  type AdmissionShareBoardRepository,
} from "./admission-share-board";
import type { AdmissionShareCandidateRepository } from "./admission-share-candidates";

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
} {
  const shareBoardInserts: Record<string, unknown>[] = [];
  return {
    shareBoardInserts,
    createShareBoardWithItems: vi.fn().mockImplementation(async (input) => {
      shareBoardInserts.push(input);
      return {
        id: "share-1",
        ...input,
        status: "active",
        allowVendorSubmit: input.mode === "formal_review",
        reviewState: "not_started",
        roundNumber: input.mode === "formal_review" ? 1 : 0,
        createdAt: "2026-06-07T00:00:00.000Z",
      };
    }),
    listShareBoards: vi.fn().mockResolvedValue([]),
    revokeShareBoard: vi.fn(),
    getPublicShareBoardSnapshot: vi.fn(),
    upsertVendorReviews: vi.fn(),
    updateRecordingReviewForVendor: vi.fn(),
    updateApplicationStatusForVendor: vi.fn(),
    markShareBoardSubmitted: vi.fn(),
    markShareBoardViewed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createCandidateRepo(
  candidates: Awaited<
    ReturnType<AdmissionShareCandidateRepository["listCandidates"]>
  > = [
    {
      applicationId: "app-2",
      recordingSubmissionId: "recording-2-v1",
      recordingVersion: 1,
      isLatestVersion: true,
      streamer: {
        id: "streamer-2",
        displayName: "主播乙",
        accountLabel: "dy_2",
      },
      mcnReviewDecision: "approved",
      mcnReviewedAt: "2026-07-30T07:00:00.000Z",
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
      externalUrl: null,
      isShareable: true,
      blockReason: null,
      currentVendorDecision: "pending",
      lastSharedAt: null,
    },
  ],
): AdmissionShareCandidateRepository {
  return {
    listCandidates: vi.fn().mockResolvedValue(candidates),
    getPlaybackSource: vi.fn(),
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
    const candidateRepo = createCandidateRepo([
      {
        applicationId: "app-1",
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        isLatestVersion: true,
        streamer: {
          id: "streamer-1",
          displayName: "主播甲",
          accountLabel: "dy_1",
        },
        mcnReviewDecision: "approved",
        mcnReviewedAt: "2026-06-06T00:00:00.000Z",
        sourceHealth: "original_ready",
        hasPrivateStorage: true,
        externalUrl: null,
        isShareable: true,
        blockReason: null,
        currentVendorDecision: "pending",
        lastSharedAt: null,
      },
      {
        applicationId: "app-2",
        recordingSubmissionId: "rec-2",
        recordingVersion: 1,
        isLatestVersion: true,
        streamer: {
          id: "streamer-2",
          displayName: "主播乙",
          accountLabel: "dy_2",
        },
        mcnReviewDecision: "approved",
        mcnReviewedAt: "2026-06-06T00:00:00.000Z",
        sourceHealth: "original_ready",
        hasPrivateStorage: true,
        externalUrl: null,
        isShareable: true,
        blockReason: null,
        currentVendorDecision: "pending",
        lastSharedAt: null,
      },
    ]);

    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo,
      audit,
      actor,
      projectId: "project-1",
      input: {
        mode: "formal_review",
        title: "Vendor review",
        accessCode: "246810",
        items: [
          {
            applicationId: "app-1",
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            sortOrder: 0,
          },
          {
            applicationId: "app-2",
            recordingSubmissionId: "rec-2",
            recordingVersion: 1,
            sortOrder: 1,
          },
        ],
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
        accessCodeHash: expect.stringMatching(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/),
        expiresAt: "2026-06-14T00:00:00.000Z",
        mode: "formal_review",
        createdBy: "user-ops",
      }),
    );
    expect(JSON.stringify(repo.shareBoardInserts)).not.toContain("plain-token");
    expect(
      verifyAdmissionShareAccessCode(
        "246810",
        String(repo.shareBoardInserts[0]?.accessCodeHash),
      ),
    ).toBe(true);
    expect(repo.shareBoardInserts[0]?.items).toEqual([
      {
        applicationId: "app-1",
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        sortOrder: 0,
      },
      {
        applicationId: "app-2",
        recordingSubmissionId: "rec-2",
        recordingVersion: 1,
        sortOrder: 1,
      },
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

  it("creates only the explicitly selected recording versions", async () => {
    const repo = createRepo({
      createShareBoardWithItems: vi.fn().mockResolvedValue({
        id: "share-1",
        organizationId: "org-1",
        projectId: "project-1",
        title: "第一轮正式复核",
        purpose: "品牌方首轮选人",
        mode: "formal_review",
        tokenHash: hashShareSecret("plain-token"),
        accessCodeHash: hashAdmissionShareAccessCode("24681024"),
        status: "active",
        expiresAt: "2026-08-06T00:00:00.000Z",
        allowVendorSubmit: true,
        allowExternalFallback: true,
        reviewState: "not_started",
        roundNumber: 1,
        createdBy: "user-ops",
      }),
    } as never);
    const candidateRepo = createCandidateRepo();

    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo,
      audit: vi.fn().mockResolvedValue(undefined),
      actor,
      projectId: "project-1",
      input: {
        mode: "formal_review",
        title: "第一轮正式复核",
        purpose: "品牌方首轮选人",
        expiresAt: "2026-08-06T00:00:00.000Z",
        requireAccessCode: true,
        allowExternalFallback: true,
        items: [
          {
            applicationId: "app-2",
            recordingSubmissionId: "recording-2-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      },
      now: "2026-07-30T00:00:00.000Z",
      tokenFactory: () => "plain-token",
      accessCodeFactory: () => "24681024",
    });

    expect(candidateRepo.listCandidates).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(repo.createShareBoardWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "formal_review",
        purpose: "品牌方首轮选人",
        items: [
          expect.objectContaining({
            applicationId: "app-2",
            recordingSubmissionId: "recording-2-v1",
            recordingVersion: 1,
            sortOrder: 0,
          }),
        ],
      }),
    );
    expect(result.token).toBe("plain-token");
    expect(result.accessCode).toBe("24681024");
    expect(JSON.stringify(repo.shareBoardInserts)).not.toContain("plain-token");
  });

  it("returns itemized conflicts instead of silently adding project recordings", async () => {
    const repo = createRepo({
      createShareBoardWithItems: vi.fn(),
    } as never);
    const candidateRepo = createCandidateRepo([
      {
        applicationId: "app-2",
        recordingSubmissionId: "blocked",
        recordingVersion: 1,
        isLatestVersion: true,
        streamer: {
          id: "streamer-2",
          displayName: "主播乙",
          accountLabel: "dy_2",
        },
        mcnReviewDecision: null,
        mcnReviewedAt: null,
        sourceHealth: "blocked",
        hasPrivateStorage: true,
        externalUrl: null,
        isShareable: false,
        blockReason: "MCN_APPROVAL_REQUIRED",
        currentVendorDecision: "pending",
        lastSharedAt: null,
      },
    ]);

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo,
        actor,
        projectId: "project-1",
        input: {
          mode: "formal_review",
          title: "第一轮正式复核",
          items: [
            {
              applicationId: "app-2",
              recordingSubmissionId: "blocked",
              recordingVersion: 1,
              sortOrder: 0,
            },
          ],
        },
        tokenFactory: () => "plain-token",
        accessCodeFactory: () => "24681024",
      }),
    ).rejects.toMatchObject({
      name: "AdmissionShareSelectionError",
      items: [
        expect.objectContaining({
          recordingSubmissionId: "blocked",
          reasonCode: "MCN_APPROVAL_REQUIRED",
        }),
      ],
    });
    expect(repo.createShareBoardWithItems).not.toHaveBeenCalled();
  });

  it("generates one eight-digit access code by default for formal review", async () => {
    const repo = createRepo({
      createShareBoardWithItems: vi.fn().mockImplementation(async (input) => ({
        id: "share-1",
        ...input,
        status: "active",
        reviewState: "not_started",
        roundNumber: 1,
      })),
    } as never);

    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo: createCandidateRepo(),
      actor,
      projectId: "project-1",
      input: {
        mode: "formal_review",
        items: [
          {
            applicationId: "app-2",
            recordingSubmissionId: "recording-2-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      },
      tokenFactory: () => "plain-token",
      accessCodeFactory: () => "13572468",
    });

    expect(result.accessCode).toBe("13572468");
    expect(repo.createShareBoardWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCodeHash: expect.stringMatching(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/),
      }),
    );
  });

  it("salts new access-code hashes and verifies legacy hashes", () => {
    const first = hashAdmissionShareAccessCode("246810");
    const second = hashAdmissionShareAccessCode("246810");

    expect(first).toMatch(/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/);
    expect(first).not.toBe(second);
    expect(verifyAdmissionShareAccessCode("246810", first)).toBe(true);
    expect(verifyAdmissionShareAccessCode("wrong", first)).toBe(false);
    expect(
      verifyAdmissionShareAccessCode("2468", hashShareSecret("2468")),
    ).toBe(true);
  });

  it("authenticates a protected share and creates an opaque session", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          accessCodeHash: hashAdmissionShareAccessCode("246810"),
        }),
      ),
    });
    const accessStore = {
      consumeAttempt: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterSeconds: 0,
      }),
      createSession: vi.fn().mockResolvedValue(undefined),
      hasValidSession: vi.fn().mockResolvedValue(false),
    };

    await expect(
      authenticatePublicAdmissionShareAccess({
        repo,
        accessStore,
        token: "plain-token",
        accessCode: "246810",
        clientFingerprint: "a".repeat(64),
        now: "2026-06-07T00:00:00.000Z",
        sessionTokenFactory: () => "opaque-session-token",
      }),
    ).resolves.toEqual({
      sessionToken: "opaque-session-token",
      expiresAt: "2026-06-14T00:00:00.000Z",
    });
    expect(accessStore.consumeAttempt).toHaveBeenNthCalledWith(1, {
      shareBoardId: "share-1",
      clientFingerprint: "a".repeat(64),
      succeeded: null,
      now: "2026-06-07T00:00:00.000Z",
    });
    expect(accessStore.consumeAttempt).toHaveBeenNthCalledWith(2, {
      shareBoardId: "share-1",
      clientFingerprint: "a".repeat(64),
      succeeded: true,
      now: "2026-06-07T00:00:00.000Z",
    });
    expect(accessStore.createSession).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      sessionToken: "opaque-session-token",
      expiresAt: "2026-06-14T00:00:00.000Z",
    });
  });

  it("blocks access after the limiter rejects a failed code", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          accessCodeHash: hashAdmissionShareAccessCode("246810"),
        }),
      ),
    });
    const accessStore = {
      consumeAttempt: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
        .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 }),
      createSession: vi.fn().mockResolvedValue(undefined),
      hasValidSession: vi.fn().mockResolvedValue(false),
    };

    await expect(
      authenticatePublicAdmissionShareAccess({
        repo,
        accessStore,
        token: "plain-token",
        accessCode: "wrong-code",
        clientFingerprint: "b".repeat(64),
        now: "2026-06-07T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_RATE_LIMITED",
      statusCode: 429,
      retryAfterSeconds: 900,
    });
    expect(accessStore.createSession).not.toHaveBeenCalled();
  });

  it("accepts an unexpired opaque session for a protected share", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          accessCodeHash: hashAdmissionShareAccessCode("246810"),
        }),
      ),
    });
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };

    await expect(
      getPublicAdmissionShareBoard({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        now: "2026-06-07T00:00:00.000Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "share-1" }));
    expect(accessStore.hasValidSession).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      sessionToken: "opaque-session-token",
      now: "2026-06-07T00:00:00.000Z",
    });
  });

  it("requires a new access code after a protected session expires", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          accessCodeHash: hashAdmissionShareAccessCode("246810"),
        }),
      ),
    });
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(false),
    };

    await expect(
      getPublicAdmissionShareBoard({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "expired-session-token",
        now: "2026-06-07T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_CODE_REQUIRED",
      statusCode: 401,
    });
  });

  it("rejects weak access codes before creating a share board", async () => {
    const repo = createRepo();

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo: createCandidateRepo(),
        audit: vi.fn().mockResolvedValue(undefined),
        actor,
        projectId: "project-1",
        input: {
          mode: "formal_review",
          accessCode: "12345",
          items: [
            {
              applicationId: "app-2",
              recordingSubmissionId: "recording-2-v1",
              recordingVersion: 1,
              sortOrder: 0,
            },
          ],
        },
        now: "2026-06-07T00:00:00.000Z",
        tokenFactory: () => "plain-token",
      }),
    ).rejects.toThrow("Access code must be between 6 and 64 characters");

    expect(repo.shareBoardInserts).toHaveLength(0);
  });

  it.each([
    ["2026-06-06T23:59:59.000Z", "future"],
    ["2026-07-08T00:00:00.000Z", "30 days"],
  ])("rejects invalid share expiry %s", async (expiresAt, expectedMessage) => {
    const repo = createRepo();

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo: createCandidateRepo(),
        audit: vi.fn().mockResolvedValue(undefined),
        actor,
        projectId: "project-1",
        input: {
          mode: "preview",
          expiresAt,
          items: [
            {
              applicationId: "app-2",
              recordingSubmissionId: "recording-2-v1",
              recordingVersion: 1,
              sortOrder: 0,
            },
          ],
        },
        now: "2026-06-07T00:00:00.000Z",
        tokenFactory: () => "plain-token",
      }),
    ).rejects.toThrow(expectedMessage);

    expect(repo.shareBoardInserts).toHaveLength(0);
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
              "/api/public/admission-share/plain-token/recordings/rec-1",
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
              "/api/public/admission-share/plain-token/recordings/rec-2",
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
    expect(repo.markShareBoardViewed).toHaveBeenCalledWith(
      "share-1",
      "2026-06-07T01:00:00.000Z",
    );
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
    expect(repo.markShareBoardViewed).toHaveBeenCalledWith(
      "share-1",
      "2026-06-07T01:00:00.000Z",
    );
  });

  it("keeps public reads available when view auditing fails", async () => {
    const auditError = new Error("audit unavailable");
    const onViewAuditError = vi.fn();
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      markShareBoardViewed: vi.fn().mockRejectedValue(auditError),
    });

    const dto = await getPublicAdmissionShareBoard({
      repo,
      token: "plain-token",
      accessCode: "2468",
      now: "2026-06-07T01:00:00.000Z",
      onViewAuditError,
    });

    expect(dto.id).toBe("share-1");
    expect(onViewAuditError).toHaveBeenCalledWith(auditError);
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
    purpose: "",
    mode: "formal_review" as const,
    tokenHash: hashShareSecret("plain-token"),
    accessCodeHash: null,
    status: "active" as const,
    expiresAt: "2026-06-14T00:00:00.000Z",
    allowVendorSubmit: true,
    allowExternalFallback: true,
    reviewState: "not_started" as const,
    roundNumber: 1,
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
