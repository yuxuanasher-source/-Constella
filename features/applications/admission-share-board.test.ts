import { describe, expect, it, vi } from "vitest";

import {
  authenticatePublicAdmissionShareAccess,
  createAdmissionShareBoard,
  ensurePublicAdmissionShareSession,
  extendAdmissionShareBoard,
  getPublicAdmissionShareBoard,
  getPublicAdmissionRecordingPlaybackSource,
  hashAdmissionShareAccessCode,
  hashShareSecret,
  mapVendorDecisionToSyncPatch,
  listPublicAdmissionReviewDrafts,
  reopenAdmissionShareBoard,
  revokeAdmissionShareBoard,
  rotateAdmissionShareBoardToken,
  savePublicAdmissionReviewDraft,
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
  verifyAdmissionShareAccessCode,
  type AdmissionShareBoardRepository,
} from "./admission-share-board";
import type {
  AdmissionShareCandidateDto,
  AdmissionShareCandidateRepository,
} from "./admission-share-candidates";

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
    extendShareBoard: vi.fn(),
    reopenShareBoard: vi.fn(),
    rotateShareBoardToken: vi.fn(),
    revokeShareBoard: vi.fn(),
    getPublicShareBoardSnapshot: vi.fn(),
    submitReview: vi.fn(),
    listReviewSubmissions: vi.fn().mockResolvedValue([]),
    upsertVendorReviews: vi.fn(),
    updateRecordingReviewForVendor: vi.fn(),
    updateApplicationStatusForVendor: vi.fn(),
    markShareBoardSubmitted: vi.fn(),
    markShareBoardViewed: vi.fn().mockResolvedValue(undefined),
    listReviewDrafts: vi.fn().mockResolvedValue([]),
    saveReviewDraft: vi.fn(),
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

function createCandidate(
  overrides: Partial<AdmissionShareCandidateDto> = {},
): AdmissionShareCandidateDto {
  return {
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

  it("rechecks candidates after an atomic RPC selection race and returns itemized conflicts", async () => {
    const rpcError = {
      code: "P0001",
      message: "admission_share_selection_changed",
    };
    const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const rpc = vi.fn().mockReturnValue({ single });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc,
    } as never);
    const candidateRepo: AdmissionShareCandidateRepository = {
      listCandidates: vi
        .fn()
        .mockResolvedValueOnce([createCandidate()])
        .mockResolvedValueOnce([
          createCandidate({
            mcnReviewDecision: null,
            mcnReviewedAt: null,
            isShareable: false,
            blockReason: "MCN_APPROVAL_REQUIRED",
          }),
        ]),
      getPlaybackSource: vi.fn(),
    };

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo,
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
        now: "2026-07-30T00:00:00.000Z",
        tokenFactory: () => "plain-token",
        accessCodeFactory: () => "24681024",
      }),
    ).rejects.toMatchObject({
      name: "AdmissionShareSelectionError",
      items: [
        expect.objectContaining({
          recordingSubmissionId: "recording-2-v1",
          reasonCode: "MCN_APPROVAL_REQUIRED",
        }),
      ],
    });
    expect(candidateRepo.listCandidates).toHaveBeenCalledTimes(2);
  });

  it("preserves the RPC error when a fresh race check still has no blocked items", async () => {
    const rpcError = {
      code: "P0001",
      message: "admission_share_selection_changed",
    };
    const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc: vi.fn().mockReturnValue({ single }),
    } as never);
    const candidateRepo = createCandidateRepo([createCandidate()]);

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo,
        actor,
        projectId: "project-1",
        input: {
          mode: "preview",
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
      }),
    ).rejects.toBe(rpcError);
    expect(candidateRepo.listCandidates).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      code: "XX000",
      message: "admission_share_selection_changed",
    },
    {
      code: "P0001",
      message: "another_database_error",
    },
  ])(
    "does not reinterpret a non-matching RPC error $code/$message",
    async (rpcError) => {
      const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
      const repo = new SupabaseAdmissionShareBoardRepository({
        rpc: vi.fn().mockReturnValue({ single }),
      } as never);
      const candidateRepo = createCandidateRepo([createCandidate()]);

      await expect(
        createAdmissionShareBoard({
          repo,
          candidateRepo,
          actor,
          projectId: "project-1",
          input: {
            mode: "preview",
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
        }),
      ).rejects.toBe(rpcError);
      expect(candidateRepo.listCandidates).toHaveBeenCalledTimes(1);
    },
  );

  it("returns one-time credentials when supplemental audit writing fails", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockRejectedValue(new Error("audit unavailable"));

    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo: createCandidateRepo([createCandidate()]),
      audit,
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
      now: "2026-07-30T00:00:00.000Z",
      tokenFactory: () => "plain-token",
      accessCodeFactory: () => "24681024",
    });

    expect(result).toEqual(
      expect.objectContaining({
        token: "plain-token",
        accessCode: "24681024",
      }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("plain-token");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("24681024");
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
    ["2026-06-07T23:59:59.000Z", "at least 1 day"],
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

  it.each([
    {
      code: "P0001",
      message: "admission_share_formal_round_already_open",
    },
    {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "project_recording_share_boards_one_open_formal_idx"',
    },
    {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      constraint: "project_recording_share_boards_one_open_formal_idx",
    },
  ])(
    "maps formal-round persistence conflict $code to a domain error",
    async (rpcError) => {
      const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
      const repo = new SupabaseAdmissionShareBoardRepository({
        rpc: vi.fn().mockReturnValue({ single }),
      } as never);

      await expect(
        createAdmissionShareBoard({
          repo,
          candidateRepo: createCandidateRepo([createCandidate()]),
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
          now: "2026-07-30T00:00:00.000Z",
          tokenFactory: () => "plain-token",
          accessCodeFactory: () => "24681024",
        }),
      ).rejects.toMatchObject({
        name: "AdmissionShareFormalRoundConflictError",
      });
    },
  );

  it("preserves unrelated unique violations instead of mislabeling them", async () => {
    const rpcError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "some_other_unique_idx"',
    };
    const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc: vi.fn().mockReturnValue({ single }),
    } as never);
    const candidateRepo = createCandidateRepo([createCandidate()]);

    await expect(
      createAdmissionShareBoard({
        repo,
        candidateRepo,
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
        now: "2026-07-30T00:00:00.000Z",
        tokenFactory: () => "plain-token",
        accessCodeFactory: () => "24681024",
      }),
    ).rejects.toBe(rpcError);
    expect(candidateRepo.listCandidates).toHaveBeenCalledTimes(1);
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

  it("reads only the shared team's drafts after token and HttpOnly session gating", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      listReviewDrafts: vi.fn().mockResolvedValue([
        {
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          decision: "backup",
          remark: "保留作为备选",
          reasonCodes: ["account_fit"],
          revision: 4,
          updatedAt: "2026-06-07T01:00:00.000Z",
        },
      ]),
    });

    const drafts = await listPublicAdmissionReviewDrafts({
      repo,
      accessStore,
      token: "plain-token",
      sessionToken: "opaque-session-token",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(repo.getPublicShareBoardSnapshot).toHaveBeenCalledWith(
      hashShareSecret("plain-token"),
    );
    expect(accessStore.hasValidSession).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      sessionToken: "opaque-session-token",
      now: "2026-06-07T01:00:00.000Z",
    });
    expect(repo.listReviewDrafts).toHaveBeenCalledWith("share-1");
    expect(drafts).toEqual([
      {
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        decision: "backup",
        remark: "保留作为备选",
        reasonCodes: ["account_fit"],
        revision: 4,
        updatedAt: "2026-06-07T01:00:00.000Z",
      },
    ]);
  });

  it("saves a draft with optimistic revision control", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      saveReviewDraft: vi.fn().mockResolvedValue({
        recordingSubmissionId: "rec-1",
        recordingVersion: 2,
        decision: "needs_changes",
        remark: "开场需要更快进入卖点",
        reasonCodes: ["script_fit"],
        revision: 3,
        updatedAt: "2026-06-07T01:00:00.000Z",
      }),
    });

    const result = await savePublicAdmissionReviewDraft({
      repo,
      accessStore,
      token: "plain-token",
      sessionToken: "opaque-session-token",
      recordingSubmissionId: "rec-1",
      input: {
        expectedRevision: 2,
        decision: "needs_changes",
        remark: "开场需要更快进入卖点",
        reasonCodes: ["script_fit"],
      },
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(repo.saveReviewDraft).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      recordingSubmissionId: "rec-1",
      expectedRevision: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
      savedAt: "2026-06-07T01:00:00.000Z",
    });
    expect(result.revision).toBe(3);
  });

  it("rejects draft reads and saves without a valid HttpOnly session even when no access code is configured", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(false),
    };
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      listReviewDrafts: vi.fn(),
      saveReviewDraft: vi.fn(),
    });

    await expect(
      listPublicAdmissionReviewDrafts({
        repo,
        accessStore,
        token: "plain-token",
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_CODE_REQUIRED",
      statusCode: 401,
    });
    await expect(
      savePublicAdmissionReviewDraft({
        repo,
        accessStore,
        token: "plain-token",
        recordingSubmissionId: "rec-1",
        input: {
          expectedRevision: 0,
          decision: "pending",
          remark: "",
          reasonCodes: [],
        },
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_CODE_REQUIRED",
      statusCode: 401,
    });

    expect(repo.getPublicShareBoardSnapshot).toHaveBeenCalledWith(
      hashShareSecret("plain-token"),
    );
    expect(repo.listReviewDrafts).not.toHaveBeenCalled();
    expect(repo.saveReviewDraft).not.toHaveBeenCalled();
  });

  it("creates and reuses a passwordless formal-review session without creating one for preview", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn().mockResolvedValue(undefined),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const formalRepo = createRepo({
      getPublicShareBoardSnapshot: vi
        .fn()
        .mockResolvedValue(
          publicSnapshot({ expiresAt: "2026-07-01T00:00:00.000Z" }),
        ),
    });

    const created = await ensurePublicAdmissionShareSession({
      repo: formalRepo,
      accessStore,
      token: "plain-token",
      now: "2026-06-07T01:00:00.000Z",
      sessionTokenFactory: () => "new-opaque-session",
    });
    const reused = await ensurePublicAdmissionShareSession({
      repo: formalRepo,
      accessStore,
      token: "plain-token",
      sessionToken: "existing-session",
      now: "2026-06-07T01:00:00.000Z",
      sessionTokenFactory: () => "must-not-be-created",
    });
    const previewAccessStore = {
      ...accessStore,
      createSession: vi.fn(),
      hasValidSession: vi.fn(),
    };
    const preview = await ensurePublicAdmissionShareSession({
      repo: createRepo({
        getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
          publicSnapshot({
            mode: "preview",
            allowVendorSubmit: false,
            roundNumber: 0,
          }),
        ),
      }),
      accessStore: previewAccessStore,
      token: "preview-token",
      now: "2026-06-07T01:00:00.000Z",
    });
    const protectedAccessStore = {
      ...accessStore,
      createSession: vi.fn(),
      hasValidSession: vi.fn(),
    };
    const protectedFormal = await ensurePublicAdmissionShareSession({
      repo: createRepo({
        getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
          publicSnapshot({
            accessCodeHash: hashAdmissionShareAccessCode("24681024"),
          }),
        ),
      }),
      accessStore: protectedAccessStore,
      token: "protected-token",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(created).toEqual({
      sessionToken: "new-opaque-session",
      expiresAt: "2026-06-14T01:00:00.000Z",
      created: true,
    });
    expect(accessStore.createSession).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      sessionToken: "new-opaque-session",
      expiresAt: "2026-06-14T01:00:00.000Z",
    });
    expect(reused).toEqual({
      sessionToken: "existing-session",
      created: false,
    });
    expect(preview).toBeNull();
    expect(previewAccessStore.hasValidSession).not.toHaveBeenCalled();
    expect(previewAccessStore.createSession).not.toHaveBeenCalled();
    expect(protectedFormal).toBeNull();
    expect(protectedAccessStore.hasValidSession).not.toHaveBeenCalled();
    expect(protectedAccessStore.createSession).not.toHaveBeenCalled();
  });

  it("surfaces stable draft conflicts and locked-review errors", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const snapshot = publicSnapshot({
      accessCodeHash: hashAdmissionShareAccessCode("24681024"),
    });
    const draftInput = {
      expectedRevision: 2,
      decision: "needs_changes" as const,
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
    };

    for (const [message, code] of [
      ["admission_share_draft_conflict", "DRAFT_CONFLICT"],
      ["admission_share_review_already_locked", "REVIEW_ALREADY_LOCKED"],
    ] as const) {
      const repo = createRepo({
        getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(snapshot),
        saveReviewDraft: vi.fn().mockRejectedValue(new Error(message)),
      });

      await expect(
        savePublicAdmissionReviewDraft({
          repo,
          accessStore,
          token: "plain-token",
          sessionToken: "opaque-session-token",
          recordingSubmissionId: "rec-1",
          input: draftInput,
          now: "2026-06-07T01:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code, statusCode: 409 });
    }
  });

  it("rejects cross-board recordings and bounded draft input before the RPC", async () => {
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      saveReviewDraft: vi.fn(),
    });

    await expect(
      savePublicAdmissionReviewDraft({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        recordingSubmissionId: "rec-not-shared",
        input: {
          expectedRevision: 0,
          decision: "pending",
          remark: "",
          reasonCodes: [],
        },
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "RECORDING_NOT_SHARED" });

    await expect(
      savePublicAdmissionReviewDraft({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        recordingSubmissionId: "rec-1",
        input: {
          expectedRevision: -1,
          decision: "pending",
          remark: "",
          reasonCodes: [],
        },
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_VALIDATION_FAILED" });

    await expect(
      savePublicAdmissionReviewDraft({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        recordingSubmissionId: "rec-1",
        input: {
          expectedRevision: 0,
          decision: "pending",
          remark: "x".repeat(2001),
          reasonCodes: ["script_fit"],
        },
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_VALIDATION_FAILED" });

    await expect(
      savePublicAdmissionReviewDraft({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        recordingSubmissionId: "rec-1",
        input: {
          expectedRevision: 0,
          decision: "pending",
          remark: "",
          reasonCodes: [null as never],
        },
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "REVIEW_VALIDATION_FAILED" });
    expect(repo.saveReviewDraft).not.toHaveBeenCalled();
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

  it("rejects an incomplete formal review before mutating business state", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi
        .fn()
        .mockRejectedValue(new Error("admission_share_review_incomplete")),
    });

    await expect(
      submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: { projectRemark: "首轮复核完成" },
        now: "2026-06-07T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "REVIEW_INCOMPLETE",
      statusCode: 400,
    });
    expect(repo.updateRecordingReviewForVendor).not.toHaveBeenCalled();
    expect(repo.updateApplicationStatusForVendor).not.toHaveBeenCalled();
  });

  it("locks one atomic submission and never auto-joins selected streamers", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi.fn().mockResolvedValue({
        submissionRevision: 2,
        submittedCount: 4,
        syncedCount: 3,
        skippedCount: 1,
        items: [
          {
            vendorReviewId: "review-selected",
            applicationId: "app-1",
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "selected",
            remark: "适合本次合作",
            reasonCodes: [],
            syncStatus: "synced",
            syncError: null,
          },
        ],
      }),
    });

    const result = await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: { projectRemark: "首轮复核完成" },
      now: "2026-06-07T05:00:00.000Z",
    });

    expect(result).toMatchObject({
      submissionRevision: 2,
      submittedCount: 4,
      syncedCount: 3,
      skippedCount: 1,
    });
    expect(repo.submitReview).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      projectRemark: "首轮复核完成",
      submittedAt: "2026-06-07T05:00:00.000Z",
    });
    expect(repo.updateRecordingReviewForVendor).not.toHaveBeenCalled();
    expect(repo.updateApplicationStatusForVendor).not.toHaveBeenCalled();
    expect(repo.upsertVendorReviews).not.toHaveBeenCalled();
    expect(repo.markShareBoardSubmitted).not.toHaveBeenCalled();
    expect(
      (repo as unknown as { createProjectStreamer?: unknown })
        .createProjectStreamer,
    ).toBeUndefined();
  });

  it("records but does not sync a historical recording result", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi.fn().mockResolvedValue({
        submissionRevision: 1,
        submittedCount: 1,
        syncedCount: 0,
        skippedCount: 1,
        items: [
          {
            vendorReviewId: "review-old",
            applicationId: "app-1",
            recordingSubmissionId: "recording-v1",
            recordingVersion: 1,
            decision: "rejected",
            remark: "旧版不采用",
            reasonCodes: ["script_fit"],
            syncStatus: "skipped",
            syncError: "superseded_recording_version",
          },
        ],
      }),
    });

    const result = await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: { projectRemark: "复核完成" },
      now: "2026-06-07T05:00:00.000Z",
    });

    expect(result).toMatchObject({
      skippedCount: 1,
    });
  });

  it("records human-tagged evaluations only after the atomic submission", async () => {
    const callOrder: string[] = [];
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi.fn().mockImplementation(async () => {
        callOrder.push("submit");
        return {
          submissionRevision: 1,
          submittedCount: 2,
          syncedCount: 1,
          skippedCount: 1,
          items: [
            {
              vendorReviewId: "vendor-review-1",
              applicationId: "app-1",
              recordingSubmissionId: "rec-1",
              recordingVersion: 2,
              decision: "rejected",
              remark: "话术不贴卖点",
              reasonCodes: ["script_fit"],
              syncStatus: "synced",
              syncError: null,
            },
            {
              vendorReviewId: "vendor-review-2",
              applicationId: "app-2",
              recordingSubmissionId: "rec-2",
              recordingVersion: 1,
              decision: "backup",
              remark: "备选",
              reasonCodes: [],
              syncStatus: "skipped",
              syncError: "application_already_joined",
            },
          ],
        };
      }),
    });
    const recordEvaluation = vi.fn().mockImplementation(async () => {
      callOrder.push("evaluate");
    });

    await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: { projectRemark: "完成" },
      now: "2026-06-07T05:00:00.000Z",
      recordEvaluation,
    });

    expect(callOrder).toEqual(["submit", "evaluate"]);
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

  it("never rolls back a successful submission when evaluation recording fails", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi.fn().mockResolvedValue({
        submissionRevision: 1,
        submittedCount: 1,
        syncedCount: 1,
        skippedCount: 0,
        items: [
          {
            vendorReviewId: "vendor-review-1",
            applicationId: "app-1",
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision: "rejected",
            remark: "违规承诺",
            reasonCodes: ["compliance_violation"],
            syncStatus: "synced",
            syncError: null,
          },
        ],
      }),
    });

    const result = await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {},
      now: "2026-06-07T05:00:00.000Z",
      recordEvaluation: vi.fn().mockRejectedValue(new Error("boom")),
    });

    expect(result).toMatchObject({
      submissionRevision: 1,
      submittedCount: 1,
    });
    expect(repo.submitReview).toHaveBeenCalledTimes(1);
  });

  it("maps locked retry races to one stable public conflict", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi
        .fn()
        .mockRejectedValue(new Error("admission_share_review_already_locked")),
    });

    await expect(
      submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: {},
        now: "2026-06-07T05:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "REVIEW_ALREADY_LOCKED",
      statusCode: 409,
    });
  });

  it("extends a share board through the lifecycle repository and audits the new expiry", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    await extendAdmissionShareBoard({
      repo,
      audit,
      actor,
      projectId: "project-1",
      shareBoardId: "share-1",
      expiresAt: "2026-08-10T00:00:00.000Z",
    });

    expect(repo.extendShareBoard).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      projectId: "project-1",
      expiresAt: "2026-08-10T00:00:00.000Z",
      actorUserId: "user-ops",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "extend_share_board",
        projectId: "project-1",
        after: { expiresAt: "2026-08-10T00:00:00.000Z" },
      }),
    );
  });

  it("reopens a locked formal review with a trimmed high-risk reason", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    await reopenAdmissionShareBoard({
      repo,
      audit,
      actor,
      projectId: "project-1",
      shareBoardId: "share-1",
      reason: "  甲方误选一条录屏  ",
    });

    expect(repo.reopenShareBoard).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      projectId: "project-1",
      reason: "甲方误选一条录屏",
      actorUserId: "user-ops",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reopen_share_board",
        isHighRisk: true,
        reason: "甲方误选一条录屏",
      }),
    );
  });

  it("rejects a reopen reason shorter than two trimmed characters before persistence", async () => {
    const repo = createRepo();

    await expect(
      reopenAdmissionShareBoard({
        repo,
        audit: vi.fn(),
        actor,
        projectId: "project-1",
        shareBoardId: "share-1",
        reason: " A ",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.reopenShareBoard).not.toHaveBeenCalled();
  });

  it("rotates the token, returns plaintext once, and never records it in audit", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    const result = await rotateAdmissionShareBoardToken({
      repo,
      audit,
      actor,
      projectId: "project-1",
      shareBoardId: "share-1",
      tokenFactory: () => "new-plain-token",
    });

    expect(repo.rotateShareBoardToken).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      projectId: "project-1",
      tokenHash: hashShareSecret("new-plain-token"),
      actorUserId: "user-ops",
    });
    expect(result).toEqual({ token: "new-plain-token" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rotate_share_board_token",
        isHighRisk: true,
      }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("new-plain-token");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(
      hashShareSecret("new-plain-token"),
    );
  });

  it("does not lose the one-time token after rotation when supplemental audit fails", async () => {
    const repo = createRepo();

    await expect(
      rotateAdmissionShareBoardToken({
        repo,
        audit: vi.fn().mockRejectedValue(new Error("audit unavailable")),
        actor,
        projectId: "project-1",
        shareBoardId: "share-1",
        tokenFactory: () => "new-plain-token",
      }),
    ).resolves.toEqual({ token: "new-plain-token" });
  });

  it("revokes through the atomic lifecycle repository before auditing", async () => {
    const repo = createRepo();
    const audit = vi.fn().mockResolvedValue(undefined);

    await revokeAdmissionShareBoard({
      repo,
      audit,
      actor,
      projectId: "project-1",
      shareBoardId: "share-1",
    });

    expect(repo.revokeShareBoard).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      projectId: "project-1",
      actorUserId: "user-ops",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "revoke_share_board",
        projectId: "project-1",
      }),
    );
  });

  it("calls each lifecycle RPC with the authenticated actor and project scope", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const repo = new SupabaseAdmissionShareBoardRepository({ rpc } as never);

    await repo.extendShareBoard({
      shareBoardId: "share-1",
      projectId: "project-1",
      expiresAt: "2026-08-10T00:00:00.000Z",
      actorUserId: "user-ops",
    });
    await repo.reopenShareBoard({
      shareBoardId: "share-1",
      projectId: "project-1",
      reason: "甲方误选",
      actorUserId: "user-ops",
    });
    await repo.rotateShareBoardToken({
      shareBoardId: "share-1",
      projectId: "project-1",
      tokenHash: "a".repeat(64),
      actorUserId: "user-ops",
    });
    await repo.revokeShareBoard({
      shareBoardId: "share-1",
      projectId: "project-1",
      actorUserId: "user-ops",
    });

    expect(rpc.mock.calls).toEqual([
      [
        "extend_admission_share_board",
        {
          p_share_board_id: "share-1",
          p_project_id: "project-1",
          p_expires_at: "2026-08-10T00:00:00.000Z",
          p_actor_user_id: "user-ops",
        },
      ],
      [
        "reopen_admission_share_board",
        {
          p_share_board_id: "share-1",
          p_project_id: "project-1",
          p_reason: "甲方误选",
          p_actor_user_id: "user-ops",
        },
      ],
      [
        "rotate_admission_share_board_token",
        {
          p_share_board_id: "share-1",
          p_project_id: "project-1",
          p_token_hash: "a".repeat(64),
          p_actor_user_id: "user-ops",
        },
      ],
      [
        "revoke_admission_share_board",
        {
          p_share_board_id: "share-1",
          p_project_id: "project-1",
          p_actor_user_id: "user-ops",
        },
      ],
    ]);
  });

  it("persists and reads draft DTOs through the constrained repository methods", async () => {
    const draftRow = {
      recording_submission_id: "rec-1",
      recording_version: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reason_codes: ["script_fit"],
      revision: 3,
      updated_at: "2026-07-30T08:30:00.000Z",
    };
    const single = vi.fn().mockResolvedValue({ data: draftRow, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    const order = vi.fn().mockResolvedValue({ data: [draftRow], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc,
      from,
    } as never);

    const saved = await repo.saveReviewDraft({
      shareBoardId: "share-1",
      recordingSubmissionId: "rec-1",
      expectedRevision: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
      savedAt: "2026-07-30T08:30:00.000Z",
    });
    const drafts = await repo.listReviewDrafts("share-1");

    expect(rpc).toHaveBeenCalledWith("save_admission_share_review_draft", {
      p_share_board_id: "share-1",
      p_recording_submission_id: "rec-1",
      p_expected_revision: 2,
      p_decision: "needs_changes",
      p_remark: "开场需要更快进入卖点",
      p_reason_codes: ["script_fit"],
      p_saved_at: "2026-07-30T08:30:00.000Z",
    });
    expect(from).toHaveBeenCalledWith("project_recording_vendor_review_drafts");
    expect(eq).toHaveBeenCalledWith("share_board_id", "share-1");
    expect(saved).toEqual({
      recordingSubmissionId: "rec-1",
      recordingVersion: 2,
      decision: "needs_changes",
      remark: "开场需要更快进入卖点",
      reasonCodes: ["script_fit"],
      revision: 3,
      updatedAt: "2026-07-30T08:30:00.000Z",
    });
    expect(drafts).toEqual([saved]);
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
