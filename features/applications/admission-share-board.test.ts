import { describe, expect, it, vi } from "vitest";

import {
  authenticatePublicAdmissionShareAccess,
  createAdmissionShareBoard,
  ensurePublicAdmissionShareSession,
  extendAdmissionShareBoard,
  getPublicAdmissionShareBoard,
  getPublicAdmissionShareBoardContextWithSession,
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

  it("returns the formal-review workflow receipt through an explicit public whitelist", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          purpose: "品牌方首轮选人",
          reviewState: "submitted_locked",
          roundNumber: 2,
          progress: {
            completed: 2,
            total: 2,
          },
          latestSubmission: {
            revision: 2,
            submittedAt: "2026-07-30T10:00:00.000Z",
            summary: {
              selected: 1,
              backup: 1,
              rejected: 0,
              needsChanges: 0,
            },
          },
        }),
      ),
    });

    const dto = await getPublicAdmissionShareBoard({
      repo,
      token: "plain-token",
      accessCode: "2468",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(dto).toEqual({
      id: "share-1",
      title: "Vendor review",
      purpose: "品牌方首轮选人",
      mode: "formal_review",
      status: "active",
      reviewState: "submitted_locked",
      roundNumber: 2,
      expiresAt: "2026-06-14T00:00:00.000Z",
      canSubmit: false,
      allowExternalFallback: true,
      project: {
        id: "project-1",
        code: "P-001",
        name: "Alpha",
        vendor: "Vendor",
        product: "Game",
      },
      progress: {
        completed: 2,
        total: 2,
      },
      latestSubmission: {
        revision: 2,
        submittedAt: "2026-07-30T10:00:00.000Z",
        summary: {
          selected: 1,
          backup: 1,
          rejected: 0,
          needsChanges: 0,
        },
      },
      items: [
        {
          applicationId: "app-1",
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          playbackUrl:
            "/api/public/admission-share/plain-token/recordings/rec-1",
          externalUrl: "https://video.example/rec-1",
          sourceHealth: "original_with_external_fallback",
          hasPrivateStorage: true,
          streamer: {
            id: "streamer-1",
            displayName: "Streamer One",
            accountLabel: "Douyin / one-live",
          },
          finalReview: {
            decision: "backup",
            remark: "可作为备选。",
            reasonCodes: ["capacity_fit"],
            submittedAt: "2026-07-29T10:00:00.000Z",
          },
        },
        {
          applicationId: "app-2",
          recordingSubmissionId: "rec-2",
          recordingVersion: 1,
          playbackUrl:
            "/api/public/admission-share/plain-token/recordings/rec-2",
          externalUrl: null,
          sourceHealth: "original_ready",
          hasPrivateStorage: true,
          streamer: {
            id: "streamer-2",
            displayName: "Streamer Two",
            accountLabel: "Bilibili / two-live",
          },
          finalReview: null,
        },
      ],
    });
    const serialized = JSON.stringify(dto);
    for (const forbidden of [
      "organizationId",
      "tokenHash",
      "accessCodeHash",
      "storagePath",
      "draft",
      "applicationStatus",
      "recordingStatus",
      "reviewerName",
      "reviewerContact",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(repo.markShareBoardViewed).toHaveBeenCalledWith(
      "share-1",
      "2026-06-07T01:00:00.000Z",
    );
  });

  it("returns preview mode as read-only without drafts or a submission receipt", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          mode: "preview",
          allowVendorSubmit: false,
          reviewState: "viewed",
          roundNumber: 0,
          progress: { completed: 0, total: 2 },
          latestSubmission: null,
        }),
      ),
    });

    const dto = await getPublicAdmissionShareBoard({
      repo,
      token: "preview-token",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(dto).toMatchObject({
      mode: "preview",
      canSubmit: false,
      progress: { completed: 0, total: 2 },
      latestSubmission: null,
    });
    expect(dto.items.every((item) => !("draft" in item))).toBe(true);
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

  it("hydrates the full public snapshot once while preparing each main-GET session mode", async () => {
    const passwordlessRepo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });
    const passwordlessAccessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn().mockResolvedValue(undefined),
      hasValidSession: vi.fn(),
    };

    const passwordless = await getPublicAdmissionShareBoardContextWithSession({
      repo: passwordlessRepo,
      accessStore: passwordlessAccessStore,
      token: "plain-token",
      now: "2026-06-07T01:00:00.000Z",
      sessionTokenFactory: () => "new-opaque-session",
    });

    expect(passwordlessRepo.getPublicShareBoardSnapshot).toHaveBeenCalledTimes(
      1,
    );
    expect(passwordless.session).toEqual({
      sessionToken: "new-opaque-session",
      expiresAt: "2026-06-14T00:00:00.000Z",
      created: true,
    });
    expect(passwordless.board).toMatchObject({
      mode: "formal_review",
      canSubmit: true,
    });

    const protectedRepo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          accessCodeHash: hashAdmissionShareAccessCode("24681024"),
        }),
      ),
    });
    const protectedAccessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };

    const protectedFormal =
      await getPublicAdmissionShareBoardContextWithSession({
        repo: protectedRepo,
        accessStore: protectedAccessStore,
        token: "protected-token",
        sessionToken: "existing-protected-session",
        now: "2026-06-07T01:00:00.000Z",
      });

    expect(protectedRepo.getPublicShareBoardSnapshot).toHaveBeenCalledTimes(1);
    expect(protectedFormal.session).toBeNull();
    expect(protectedAccessStore.createSession).not.toHaveBeenCalled();
    expect(protectedAccessStore.hasValidSession).toHaveBeenCalledTimes(1);

    const previewRepo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          mode: "preview",
          allowVendorSubmit: false,
          roundNumber: 0,
        }),
      ),
    });
    const previewAccessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn(),
    };

    const preview = await getPublicAdmissionShareBoardContextWithSession({
      repo: previewRepo,
      accessStore: previewAccessStore,
      token: "preview-token",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(previewRepo.getPublicShareBoardSnapshot).toHaveBeenCalledTimes(1);
    expect(preview.session).toBeNull();
    expect(preview.board).toMatchObject({
      mode: "preview",
      canSubmit: false,
    });
    expect(previewAccessStore.createSession).not.toHaveBeenCalled();
    expect(previewAccessStore.hasValidSession).not.toHaveBeenCalled();
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

  it("distinguishes revoked and expired public share links", async () => {
    const revokedRepo = createRepo({
      getPublicShareBoardSnapshot: vi
        .fn()
        .mockResolvedValue(publicSnapshot({ status: "revoked" })),
    });
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
    ).rejects.toMatchObject({
      code: "SHARE_EXPIRED",
      statusCode: 410,
    });
    await expect(
      getPublicAdmissionShareBoard({
        repo: revokedRepo,
        token: "plain-token",
        now: "2026-06-07T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "SHARE_REVOKED",
      statusCode: 410,
    });
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

  it("records post-submit evaluations with bounded concurrency", async () => {
    const evaluationItems = Array.from({ length: 5 }, (_, index) => ({
      vendorReviewId: `vendor-review-${index + 1}`,
      applicationId: `app-${index + 1}`,
      recordingSubmissionId: `rec-${index + 1}`,
      recordingVersion: 1,
      decision: "rejected" as const,
      remark: `reason-${index + 1}`,
      reasonCodes: ["script_fit"],
      syncStatus: "synced" as const,
      syncError: null,
    }));
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      submitReview: vi.fn().mockResolvedValue({
        submissionRevision: 1,
        submittedCount: evaluationItems.length,
        syncedCount: evaluationItems.length,
        skippedCount: 0,
        items: evaluationItems,
      }),
    });
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const recordEvaluation = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

    const submitted = submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {},
      now: "2026-06-07T05:00:00.000Z",
      recordEvaluation,
    });
    await vi.waitFor(() => {
      expect(recordEvaluation).toHaveBeenCalledTimes(4);
    });
    expect(maxActive).toBe(4);

    releases.shift()?.();
    await vi.waitFor(() => {
      expect(recordEvaluation).toHaveBeenCalledTimes(5);
    });

    for (const release of releases.splice(0)) {
      release();
    }
    await expect(submitted).resolves.toMatchObject({
      submissionRevision: 1,
      submittedCount: 5,
    });
  });

  it("returns a successful submission after a post-submit evaluation times out", async () => {
    vi.useFakeTimers();
    try {
      const repo = createRepo({
        getPublicShareBoardSnapshot: vi
          .fn()
          .mockResolvedValue(publicSnapshot()),
        submitReview: vi.fn().mockResolvedValue({
          submissionRevision: 1,
          submittedCount: 1,
          syncedCount: 1,
          skippedCount: 0,
          items: [
            {
              vendorReviewId: "vendor-review-hanging",
              applicationId: "app-1",
              recordingSubmissionId: "rec-1",
              recordingVersion: 2,
              decision: "rejected",
              remark: "不采用",
              reasonCodes: ["script_fit"],
              syncStatus: "synced",
              syncError: null,
            },
          ],
        }),
      });
      let settled = false;
      let activeWorkers = 0;
      let evaluationSignal: AbortSignal | undefined;
      let finishAbort: (() => void) | undefined;
      const submitted = submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: {},
        now: "2026-06-07T05:00:00.000Z",
        recordEvaluation: vi.fn((evaluation) => {
          evaluationSignal = evaluation.signal;
          activeWorkers += 1;
          return new Promise<void>((_resolve, reject) => {
            evaluation.signal.addEventListener(
              "abort",
              () => {
                finishAbort = () => {
                  activeWorkers -= 1;
                  reject(evaluation.signal.reason);
                };
              },
              { once: true },
            );
          });
        }),
      }).then((result) => {
        settled = true;
        return result;
      });

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(evaluationSignal?.aborted).toBe(true);
      expect(settled).toBe(false);
      expect(activeWorkers).toBe(1);

      finishAbort?.();
      await Promise.resolve();
      await Promise.resolve();

      await expect(submitted).resolves.toMatchObject({
        submissionRevision: 1,
        submittedCount: 1,
      });
      expect(activeWorkers).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

  it("hydrates progress and the immutable latest submission receipt for the public snapshot", async () => {
    const boardRow = {
      id: "share-1",
      organization_id: "org-1",
      project_id: "project-1",
      title: "Vendor review",
      purpose: "品牌方首轮选人",
      mode: "formal_review",
      token_hash: hashShareSecret("plain-token"),
      access_code_hash: null,
      status: "active",
      expires_at: "2026-08-06T00:00:00.000Z",
      allow_vendor_submit: true,
      allow_external_fallback: true,
      review_state: "submitted_locked",
      round_number: 2,
      created_by: "user-ops",
      created_at: "2026-07-30T07:00:00.000Z",
      projects: {
        id: "project-1",
        code: "P-001",
        name: "Alpha",
        vendor_name: "Vendor",
        product_name: "Game",
      },
    };
    const itemRows = [
      {
        application_id: "app-1",
        recording_submission_id: "rec-1",
        recording_version: 2,
        source_health: "original_with_external_fallback",
        project_applications: {
          status: "recording_approved",
          streamer_id: "streamer-1",
          streamers: {
            id: "streamer-1",
            display_name: "Streamer One",
            streamer_accounts: [],
          },
        },
        recording_submissions: {
          status: "approved",
          external_url: "https://video.example/rec-1",
          storage_path: "private/rec-1.mp4",
        },
      },
      {
        application_id: "app-2",
        recording_submission_id: "rec-2",
        recording_version: 1,
        source_health: "external_only",
        project_applications: {
          status: "recording_reviewing",
          streamer_id: "streamer-2",
          streamers: {
            id: "streamer-2",
            display_name: "Streamer Two",
            streamer_accounts: [],
          },
        },
        recording_submissions: {
          status: "reviewing",
          external_url: "https://video.example/rec-2",
          storage_path: null,
        },
      },
    ];
    const submissionRow = {
      id: "submission-2",
      revision: 2,
      project_remark: "",
      selected_count: 1,
      backup_count: 1,
      rejected_count: 0,
      needs_changes_count: 0,
      submitted_at: "2026-07-30T10:00:00.000Z",
    };
    const queriedTables: string[] = [];
    const itemSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: itemRows, error: null }),
      }),
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          share_board_id: "share-1",
          item_count: 2,
          draft_completed_count: 2,
        },
      ],
      error: null,
    });
    const from = vi.fn().mockImplementation((table: string) => {
      queriedTables.push(table);
      if (table === "project_recording_share_boards") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: boardRow, error: null }),
            }),
          }),
        };
      }
      if (table === "project_recording_share_items") {
        return { select: itemSelect };
      }
      if (table === "project_recording_vendor_review_submissions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi
                  .fn()
                  .mockResolvedValue({ data: [submissionRow], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "project_recording_vendor_review_submission_items") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  recording_submission_id: "rec-1",
                  decision: "selected",
                  remark: "优先选择",
                  reason_codes: ["script_fit"],
                },
                {
                  recording_submission_id: "rec-2",
                  decision: "backup",
                  remark: "",
                  reason_codes: [],
                },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected public snapshot table: ${table}`);
    });
    const repo = new SupabaseAdmissionShareBoardRepository({
      from,
      rpc,
    } as never);

    const snapshot = await repo.getPublicShareBoardSnapshot(
      hashShareSecret("plain-token"),
    );

    expect(itemSelect).toHaveBeenCalledWith(
      expect.stringContaining("source_health"),
    );
    expect(queriedTables).not.toContain("project_recording_vendor_reviews");
    expect(queriedTables).not.toContain(
      "project_recording_vendor_review_drafts",
    );
    expect(rpc).toHaveBeenCalledWith("list_admission_share_board_progress", {
      p_project_ids: ["project-1"],
    });
    expect(snapshot).toMatchObject({
      progress: { completed: 2, total: 2 },
      latestSubmission: {
        revision: 2,
        submittedAt: "2026-07-30T10:00:00.000Z",
        summary: {
          selected: 1,
          backup: 1,
          rejected: 0,
          needsChanges: 0,
        },
      },
      items: [
        {
          recordingSubmissionId: "rec-1",
          sourceHealth: "original_with_external_fallback",
          finalReview: {
            decision: "selected",
            remark: "优先选择",
            reasonCodes: ["script_fit"],
            submittedAt: "2026-07-30T10:00:00.000Z",
          },
        },
        {
          recordingSubmissionId: "rec-2",
          sourceHealth: "external_only",
          finalReview: {
            decision: "backup",
            remark: "",
            reasonCodes: [],
            submittedAt: "2026-07-30T10:00:00.000Z",
          },
        },
      ],
    });
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

  it("uses database aggregation across multiple boards and more than 1000 items without selecting secrets", async () => {
    const boardSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "share-1",
              title: "首轮复核",
              purpose: "确认首批主播",
              mode: "formal_review",
              status: "active",
              review_state: "in_progress",
              round_number: 1,
              expires_at: "2026-08-06T00:00:00.000Z",
              last_viewed_at: "2026-07-30T08:00:00.000Z",
              last_draft_at: "2026-07-30T08:20:00.000Z",
              last_submitted_at: null,
              locked_at: null,
              created_by: "user-ops",
              created_at: "2026-07-30T00:00:00.000Z",
            },
            {
              id: "share-2",
              title: "第二轮复核",
              purpose: "确认补录主播",
              mode: "formal_review",
              status: "active",
              review_state: "submitted_locked",
              round_number: 2,
              expires_at: "2026-08-10T00:00:00.000Z",
              last_viewed_at: "2026-07-31T08:00:00.000Z",
              last_draft_at: "2026-07-31T08:20:00.000Z",
              last_submitted_at: "2026-07-31T10:00:00.000Z",
              locked_at: "2026-07-31T10:00:00.000Z",
              created_by: "user-ops",
              created_at: "2026-07-31T00:00:00.000Z",
            },
          ],
          error: null,
        }),
      }),
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          share_board_id: "share-1",
          item_count: 1501,
          draft_completed_count: 1201,
        },
        {
          share_board_id: "share-2",
          item_count: 1200,
          draft_completed_count: 1200,
        },
      ],
      error: null,
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === "project_recording_share_boards") {
        return { select: boardSelect };
      }
      throw new Error(`unexpected detail-table query: ${table}`);
    });
    const repo = new SupabaseAdmissionShareBoardRepository({
      from,
      rpc,
    } as never);

    await expect(repo.listShareBoards("project-1")).resolves.toEqual([
      {
        id: "share-1",
        title: "首轮复核",
        purpose: "确认首批主播",
        mode: "formal_review",
        status: "active",
        reviewState: "in_progress",
        roundNumber: 1,
        expiresAt: "2026-08-06T00:00:00.000Z",
        itemCount: 1501,
        draftCompletedCount: 1201,
        lastViewedAt: "2026-07-30T08:00:00.000Z",
        lastDraftAt: "2026-07-30T08:20:00.000Z",
        lastSubmittedAt: null,
        lockedAt: null,
        createdBy: "user-ops",
        createdAt: "2026-07-30T00:00:00.000Z",
      },
      {
        id: "share-2",
        title: "第二轮复核",
        purpose: "确认补录主播",
        mode: "formal_review",
        status: "active",
        reviewState: "submitted_locked",
        roundNumber: 2,
        expiresAt: "2026-08-10T00:00:00.000Z",
        itemCount: 1200,
        draftCompletedCount: 1200,
        lastViewedAt: "2026-07-31T08:00:00.000Z",
        lastDraftAt: "2026-07-31T08:20:00.000Z",
        lastSubmittedAt: "2026-07-31T10:00:00.000Z",
        lockedAt: "2026-07-31T10:00:00.000Z",
        createdBy: "user-ops",
        createdAt: "2026-07-31T00:00:00.000Z",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_admission_share_board_progress", {
      p_project_ids: ["project-1"],
    });
    const selectedColumns = String(boardSelect.mock.calls[0]?.[0]);
    expect(selectedColumns).not.toContain("token_hash");
    expect(selectedColumns).not.toContain("access_code_hash");
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
        sourceHealth: "original_with_external_fallback" as const,
        streamer: {
          id: "streamer-1",
          displayName: "Streamer One",
          accountLabel: "Douyin / one-live",
        },
        finalReview: {
          decision: "backup" as const,
          remark: "可作为备选。",
          reasonCodes: ["capacity_fit"],
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
        sourceHealth: "original_ready" as const,
        streamer: {
          id: "streamer-2",
          displayName: "Streamer Two",
          accountLabel: "Bilibili / two-live",
        },
        finalReview: null,
      },
    ],
    progress: {
      completed: 1,
      total: 2,
    },
    latestSubmission: null,
    ...overrides,
  };
}
