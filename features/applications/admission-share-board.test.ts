import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  AdmissionShareContactCardError,
  authenticatePublicAdmissionShareAccess,
  createAdmissionShareBoard,
  ensurePublicAdmissionShareSession,
  extendAdmissionShareBoard,
  getPublicAdmissionShareBoard,
  getPublicAdmissionShareBoardContextWithSession,
  getPublicAdmissionRecordingPlaybackSource,
  hashAdmissionShareAccessCode,
  hashShareSecret,
  listInternalAdmissionShareBoards,
  listAdmissionSharePlaybackIssues,
  mapVendorDecisionToSyncPatch,
  listPublicAdmissionReviewDrafts,
  recordPublicAdmissionPlaybackIssue,
  reopenAdmissionShareBoard,
  resolveAdmissionSharePlaybackIssue,
  revokeAdmissionShareBoard,
  rotateAdmissionShareBoardToken,
  savePublicAdmissionReviewDraft,
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
  toAdmissionSharePresentation,
  toInternalAdmissionSharePresentation,
  verifyAdmissionShareAccessCode,
  type AdmissionShareBoardRepository,
  type PublicAdmissionShareBrand,
  type PublicAdmissionShareContactCard,
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
        brandSnapshot: {
          schemaVersion: 1,
          version: 1,
          logoText: "星河",
          logoStoragePath: null,
          brandName: "星河直播",
          brandTagline: "专业直播运营",
          primaryColor: "#165DFF",
          publishedAt: "2026-06-01T00:00:00.000Z",
        },
        brandVersion: 1,
        contactCardId: input.contactCardId ?? null,
        contactCardSnapshot: null,
        createdAt: "2026-06-07T00:00:00.000Z",
      };
    }),
    listShareBoards: vi.fn().mockResolvedValue([]),
    extendShareBoard: vi.fn(),
    reopenShareBoard: vi.fn(),
    rotateShareBoardToken: vi.fn(),
    revokeShareBoard: vi.fn(),
    reportPlaybackIssue: vi.fn(),
    listPlaybackIssues: vi.fn().mockResolvedValue([]),
    resolvePlaybackIssue: vi.fn(),
    getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
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

function admissionShareTask(id: string, roundNumber: number) {
  return {
    id,
    title: `Review round ${roundNumber}`,
    purpose: "Confirm recordings",
    mode: "formal_review" as const,
    status: "active" as const,
    reviewState: "not_started" as const,
    roundNumber,
    expiresAt: "2026-08-06T00:00:00.000Z",
    itemCount: 1,
    draftCompletedCount: 0,
    lastViewedAt: null,
    lastDraftAt: null,
    lastSubmittedAt: null,
    lockedAt: null,
    createdBy: "user-ops",
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

function internalShareBoardRow(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    organization_id: "org-1",
    project_id: "project-1",
    title: `Review ${id}`,
    purpose: "Confirm recordings",
    mode: "formal_review",
    token_hash: `private-hash-${id}`,
    access_code_hash: null,
    status: "active",
    expires_at: "2026-08-06T00:00:00.000Z",
    allow_vendor_submit: true,
    allow_external_fallback: true,
    review_state: "in_progress",
    round_number: id === "share-1" ? 1 : 2,
    brand_snapshot: {
      schemaVersion: 1,
      version: 4,
      logoText: "STAR",
      logoStoragePath: "org-1/brand-logos/private.webp",
      brandName: "Star Live",
      brandTagline: "Professional live operations",
      primaryColor: "#165DFF",
      publishedAt: "2026-07-29T00:00:00.000Z",
    },
    brand_version: 4,
    contact_card_id: null,
    contact_card_snapshot: null,
    last_viewed_at: null,
    last_draft_at: null,
    last_submitted_at: null,
    locked_at: null,
    created_by: "user-ops",
    created_at: createdAt,
    projects: {
      id: "project-1",
      code: "P-001",
      name: "Launch project",
      vendor_name: "Vendor",
      product_name: "Product",
    },
    ...overrides,
  };
}

function internalShareItemRow(
  shareBoardId: string,
  recordingSubmissionId: string,
  sortOrder: number,
) {
  return {
    share_board_id: shareBoardId,
    application_id: `app-${recordingSubmissionId}`,
    recording_submission_id: recordingSubmissionId,
    recording_version: 1,
    sort_order: sortOrder,
    source_health: "original_ready",
    project_applications: {
      status: "recording_reviewing",
      streamer_id: `streamer-${recordingSubmissionId}`,
      streamers: {
        id: `streamer-${recordingSubmissionId}`,
        display_name: `Streamer ${recordingSubmissionId}`,
        streamer_accounts: [],
      },
    },
    recording_submissions: {
      status: "submitted",
      external_url: null,
      storage_path: `private/${recordingSubmissionId}.mp4`,
    },
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

  it("passes only the selected contact-card id into persistence and ignores forged snapshots", async () => {
    const repo = createRepo();
    const forgedStoragePath = "other-org/brand-logos/forged.webp";

    await createAdmissionShareBoard({
      repo,
      candidateRepo: createCandidateRepo(),
      audit: vi.fn().mockResolvedValue(undefined),
      actor,
      projectId: "project-1",
      input: {
        mode: "preview",
        contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
        brandSnapshot: { logoStoragePath: forgedStoragePath },
        contactCardSnapshot: { displayName: "伪造联系人" },
        items: [
          {
            applicationId: "app-2",
            recordingSubmissionId: "recording-2-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      } as never,
      now: "2026-07-30T00:00:00.000Z",
      tokenFactory: () => "plain-token",
    });

    const persisted = repo.shareBoardInserts[0];
    expect(persisted).toMatchObject({
      contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
    });
    expect(persisted).not.toHaveProperty("brandSnapshot");
    expect(persisted).not.toHaveProperty("contactCardSnapshot");
    expect(JSON.stringify(persisted)).not.toContain(forgedStoragePath);
  });

  it("rehydrates the just-created board and returns one complete internal presentation", async () => {
    const snapshot = publicSnapshot({
      brandVersion: 6,
      contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
      contactCardSnapshot: {
        displayName: "Lin",
        title: "Account lead",
        phone: "13800000000",
      },
    });
    const getPublicShareBoardSnapshot = vi.fn().mockResolvedValue(snapshot);
    const repo = createRepo({ getPublicShareBoardSnapshot });

    const result = await createAdmissionShareBoard({
      repo,
      candidateRepo: createCandidateRepo(),
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
    });

    expect(getPublicShareBoardSnapshot).toHaveBeenCalledTimes(1);
    expect(getPublicShareBoardSnapshot).toHaveBeenCalledWith(
      hashShareSecret("plain-token"),
    );
    expect(result.presentation).toEqual(
      toInternalAdmissionSharePresentation(snapshot),
    );
    expect(result.presentation.project).toEqual(snapshot.project);
    expect(result.presentation.progress).toEqual(snapshot.progress);
    expect(result.presentation.latestSubmission).toEqual(
      snapshot.latestSubmission,
    );
    expect(result.presentation.items).toHaveLength(snapshot.items.length);
    expect(JSON.stringify(result.presentation)).not.toContain(
      "logoStoragePath",
    );
    expect(JSON.stringify(result.presentation)).not.toContain("storagePath");
    expect(JSON.stringify(result.presentation)).not.toContain("tokenHash");
  });

  it("lists complete internal presentations through one batch repository read", async () => {
    const snapshots = [
      publicSnapshot({ id: "share-1", roundNumber: 1 }),
      publicSnapshot({ id: "share-2", roundNumber: 2 }),
    ];
    const getPublicShareBoardSnapshot = vi.fn();
    const listShareBoards = vi.fn();
    const listInternalShareBoardHydrations = vi.fn().mockResolvedValue(
      snapshots.map((snapshot, index) => ({
        task: admissionShareTask(snapshot.id, index + 1),
        snapshot,
      })),
    );
    const repo = createRepo({
      listShareBoards,
      getPublicShareBoardSnapshot,
      listInternalShareBoardHydrations,
    } as never);

    const result = await listInternalAdmissionShareBoards({
      repo: repo as never,
      actor,
      projectId: "project-1",
    });

    expect(listInternalShareBoardHydrations).toHaveBeenCalledTimes(1);
    expect(listInternalShareBoardHydrations).toHaveBeenCalledWith("project-1");
    expect(listShareBoards).not.toHaveBeenCalled();
    expect(getPublicShareBoardSnapshot).not.toHaveBeenCalled();
    expect(result.map((board) => board.id)).toEqual(["share-1", "share-2"]);
    expect(result.map((board) => board.presentation)).toEqual(
      snapshots.map(toInternalAdmissionSharePresentation),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("accessCodeHash");
    expect(serialized).not.toContain("storagePath");
    expect(serialized).not.toContain("logoStoragePath");
  });

  it("sends no client-authored snapshot parameters to the atomic creation RPC", async () => {
    const row = {
      id: "share-1",
      organization_id: "org-1",
      project_id: "project-1",
      title: "Vendor review",
      purpose: "",
      mode: "preview",
      token_hash: "hashed-token",
      access_code_hash: null,
      status: "active",
      expires_at: "2026-08-06T00:00:00.000Z",
      allow_vendor_submit: false,
      allow_external_fallback: true,
      review_state: "not_started",
      round_number: 0,
      created_by: "user-ops",
      created_at: "2026-07-30T00:00:00.000Z",
      brand_snapshot: {
        schemaVersion: 1,
        version: 4,
        logoText: "星河",
        logoStoragePath: "org-1/brand-logos/private.webp",
        brandName: "星河直播",
        brandTagline: "专业直播运营",
        primaryColor: "#165DFF",
        publishedAt: "2026-07-29T00:00:00.000Z",
      },
      brand_version: 4,
      contact_card_id: null,
      contact_card_snapshot: null,
    };
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    const repo = new SupabaseAdmissionShareBoardRepository({ rpc } as never);

    await repo.createShareBoardWithItems({
      organizationId: "org-1",
      projectId: "project-1",
      title: "Vendor review",
      purpose: "",
      mode: "preview",
      tokenHash: "hashed-token",
      accessCodeHash: null,
      expiresAt: "2026-08-06T00:00:00.000Z",
      allowExternalFallback: true,
      createdBy: "user-ops",
      contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
      items: [
        {
          applicationId: "app-2",
          recordingSubmissionId: "recording-2-v1",
          recordingVersion: 1,
          sortOrder: 0,
        },
      ],
    } as never);

    expect(rpc).toHaveBeenCalledWith("create_admission_share_board", {
      p_organization_id: "org-1",
      p_project_id: "project-1",
      p_title: "Vendor review",
      p_purpose: "",
      p_mode: "preview",
      p_token_hash: "hashed-token",
      p_access_code_hash: null,
      p_expires_at: "2026-08-06T00:00:00.000Z",
      p_allow_external_fallback: true,
      p_created_by: "user-ops",
      p_items: [
        {
          application_id: "app-2",
          recording_submission_id: "recording-2-v1",
          recording_version: 1,
          sort_order: 0,
        },
      ],
      p_contact_card_id: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
    });
    const rpcPayload = vi.mocked(rpc).mock.calls[0]?.[1];
    expect(rpcPayload).not.toHaveProperty("p_brand_snapshot");
    expect(rpcPayload).not.toHaveProperty("p_contact_card_snapshot");
  });

  it("maps a cross-organization or disabled contact card to one sanitized domain failure", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "invalid_organization_contact_card",
        details: "private card lookup diagnostics",
      },
    });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc: vi.fn().mockReturnValue({ single }),
    } as never);

    const operation = repo.createShareBoardWithItems({
      organizationId: "org-1",
      projectId: "project-1",
      title: "Vendor review",
      purpose: "",
      mode: "preview",
      tokenHash: "hashed-token",
      accessCodeHash: null,
      expiresAt: "2026-08-06T00:00:00.000Z",
      allowExternalFallback: true,
      createdBy: "user-ops",
      contactCardId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
      items: [
        {
          applicationId: "app-2",
          recordingSubmissionId: "recording-2-v1",
          recordingVersion: 1,
          sortOrder: 0,
        },
      ],
    });

    await expect(operation).rejects.toBeInstanceOf(
      AdmissionShareContactCardError,
    );
    await expect(operation).rejects.toMatchObject({
      code: "INVALID_ORGANIZATION_CONTACT_CARD",
      message: "Selected organization contact card is unavailable",
      statusCode: 400,
    });
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

  it("maps a database project-status race to the stable domain conflict", async () => {
    const rpcError = {
      code: "P0001",
      message: "admission_share_project_status_blocked",
    };
    const single = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc: vi.fn().mockReturnValue({ single }),
    } as never);

    await expect(
      repo.createShareBoardWithItems({
        organizationId: "org-1",
        projectId: "project-1",
        title: "Vendor review",
        purpose: "",
        mode: "formal_review",
        tokenHash: "a".repeat(64),
        accessCodeHash: null,
        expiresAt: "2026-08-06T00:00:00.000Z",
        allowExternalFallback: true,
        createdBy: "user-ops",
        items: [
          {
            applicationId: "app-2",
            recordingSubmissionId: "recording-2-v1",
            recordingVersion: 1,
            sortOrder: 0,
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: "AdmissionShareProjectStatusError",
      code: "ADMISSION_SHARE_PROJECT_STATUS_BLOCKED",
      statusCode: 409,
    });
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
      brand: {
        logoText: "星河",
        logoUrl: null,
        brandName: "星河直播",
        brandTagline: "专业直播运营",
        primaryColor: "#165DFF",
      },
      contactCard: null,
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

  it("derives internal and public shared fields from one persisted presentation without leaking private paths", async () => {
    const privateLogoPath =
      "9d4ba455-c58a-4e31-a3e8-c42a760ea54c/brand-logos/8732c883-7ea9-4db0-9b29-4a77e1f8c79e.webp";
    const snapshot = publicSnapshot({
      organizationId: "9d4ba455-c58a-4e31-a3e8-c42a760ea54c",
      brandVersion: 7,
      brandSnapshot: {
        schemaVersion: 1,
        version: 7,
        logoText: "星河",
        logoStoragePath: privateLogoPath,
        brandName: "星河直播",
        brandTagline: "专业直播运营",
        primaryColor: "#4A63D8",
        publishedAt: "2026-07-30T00:00:00.000Z",
        internalNote: "never public",
      },
      contactCardId: "8732c883-7ea9-4db0-9b29-4a77e1f8c79e",
      contactCardSnapshot: {
        displayName: "林经理",
        title: "商务负责人",
        phone: "13800000000",
        internalUserId: "private-user-id",
      },
    });
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(snapshot),
    });

    const presentation = toAdmissionSharePresentation(snapshot as never);
    const internalDto = toInternalAdmissionSharePresentation(snapshot as never);
    const publicDto = await getPublicAdmissionShareBoard({
      repo,
      token: "plain-token",
      now: "2026-06-07T01:00:00.000Z",
    });
    const publicBrand: Record<string, unknown> = { ...publicDto.brand };
    delete publicBrand.logoUrl;
    const publicShared = {
      title: publicDto.title,
      purpose: publicDto.purpose,
      mode: publicDto.mode,
      status: publicDto.status,
      reviewState: publicDto.reviewState,
      roundNumber: publicDto.roundNumber,
      expiresAt: publicDto.expiresAt,
      project: publicDto.project,
      brand: publicBrand,
      contactCard: publicDto.contactCard,
      progress: publicDto.progress,
      latestSubmission: publicDto.latestSubmission,
      items: publicDto.items.map((item) => ({
        applicationId: item.applicationId,
        recordingSubmissionId: item.recordingSubmissionId,
        recordingVersion: item.recordingVersion,
        sourceHealth: item.sourceHealth,
        streamer: item.streamer,
        finalReview: item.finalReview,
      })),
    };
    const internalShared: Record<string, unknown> = { ...internalDto };
    for (const privateField of [
      "id",
      "brandVersion",
      "contactCardId",
      "sourceDiagnostics",
    ]) {
      delete internalShared[privateField];
    }

    expect(publicShared).toEqual(presentation);
    expect(internalShared).toEqual(presentation);
    expect(publicDto.brand?.logoUrl).toBeNull();
    const serialized = JSON.stringify({ presentation, publicDto });
    expect(serialized).not.toContain(privateLogoPath);
    expect(serialized).not.toContain("internalNote");
    expect(serialized).not.toContain("internalUserId");
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "/relative/video.mp4",
  ])("removes an unsafe external URL from the public DTO: %s", async (url) => {
    const snapshot = publicSnapshot();
    snapshot.items[0].recordingUrl = url;
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(snapshot),
    });

    const dto = await getPublicAdmissionShareBoard({
      repo,
      token: "plain-token",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(dto.items[0].externalUrl).toBeNull();
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
      allowExternalFallback: true,
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

  it("keeps the board external-fallback policy on the gated playback source", async () => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          allowExternalFallback: false,
        }),
      ),
    });

    const source = await getPublicAdmissionRecordingPlaybackSource({
      repo,
      token: "plain-token",
      recordingSubmissionId: "rec-1",
      now: "2026-06-07T01:00:00.000Z",
    });

    expect(source).toMatchObject({
      allowExternalFallback: false,
      recordingUrl: "https://video.example/rec-1",
      storagePath: "private/path/rec-1.mp4",
    });
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
    expectTypeOf(
      passwordless.board.brand,
    ).toEqualTypeOf<PublicAdmissionShareBrand>();
    expectTypeOf(
      passwordless.board.contactCard,
    ).toEqualTypeOf<PublicAdmissionShareContactCard | null>();
    expect(passwordless.board.brand).toMatchObject({
      logoText: "星河",
      logoUrl: null,
    });
    expect(passwordless.board).toHaveProperty("contactCard");
    expect(passwordless.allowVendorSubmit).toBe(true);

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
    expect(preview.allowVendorSubmit).toBe(false);
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
      brand_snapshot: {
        schemaVersion: 1,
        version: 4,
        logoText: "星河",
        logoStoragePath: null,
        brandName: "星河直播",
        brandTagline: "专业直播运营",
        primaryColor: "#165DFF",
        publishedAt: "2026-07-29T00:00:00.000Z",
      },
      brand_version: 4,
      contact_card_id: null,
      contact_card_snapshot: null,
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
      brandVersion: 4,
      brandSnapshot: expect.objectContaining({ brandName: "星河直播" }),
      contactCardId: null,
      contactCardSnapshot: null,
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

  it("hydrates all internal share presentations with a fixed batch query plan", async () => {
    const boardRows = [
      internalShareBoardRow("share-2", "2026-07-31T00:00:00.000Z"),
      internalShareBoardRow("share-1", "2026-07-30T00:00:00.000Z", {
        review_state: "submitted_locked",
      }),
    ];
    const itemRows = [
      internalShareItemRow("share-1", "rec-1", 0),
      internalShareItemRow("share-2", "rec-3", 0),
      internalShareItemRow("share-1", "rec-2", 1),
    ];
    const submissionRows = [
      {
        id: "submission-2",
        share_board_id: "share-1",
        revision: 2,
        project_remark: "Confirmed",
        selected_count: 1,
        backup_count: 0,
        rejected_count: 0,
        needs_changes_count: 1,
        submitted_at: "2026-07-31T09:00:00.000Z",
      },
      {
        id: "submission-1",
        share_board_id: "share-1",
        revision: 1,
        project_remark: "First pass",
        selected_count: 0,
        backup_count: 1,
        rejected_count: 0,
        needs_changes_count: 1,
        submitted_at: "2026-07-30T09:00:00.000Z",
      },
    ];
    const receiptRows = [
      {
        submission_id: "submission-2",
        recording_submission_id: "rec-2",
        decision: "needs_changes",
        remark: "Adjust opening",
        reason_codes: ["opening"],
      },
    ];

    const boardRange = vi
      .fn()
      .mockResolvedValue({ data: boardRows, error: null });
    const boardQuery = { order: vi.fn(), range: boardRange };
    boardQuery.order.mockReturnValue(boardQuery);
    const boardEq = vi.fn().mockReturnValue(boardQuery);
    const boardSelect = vi.fn().mockReturnValue({ eq: boardEq });
    const itemRange = vi
      .fn()
      .mockResolvedValue({ data: itemRows, error: null });
    const itemQuery = { order: vi.fn(), range: itemRange };
    itemQuery.order.mockReturnValue(itemQuery);
    const itemEq = vi.fn().mockReturnValue(itemQuery);
    const itemSelect = vi.fn().mockReturnValue({ eq: itemEq });
    const draftRange = vi.fn().mockResolvedValue({ data: [], error: null });
    const draftQuery = { order: vi.fn(), range: draftRange };
    draftQuery.order.mockReturnValue(draftQuery);
    const draftEq = vi.fn().mockReturnValue(draftQuery);
    const draftSelect = vi.fn().mockReturnValue({ eq: draftEq });
    const submissionRange = vi
      .fn()
      .mockResolvedValue({ data: submissionRows, error: null });
    const submissionQuery = { order: vi.fn(), range: submissionRange };
    submissionQuery.order.mockReturnValue(submissionQuery);
    const submissionEq = vi.fn().mockReturnValue(submissionQuery);
    const submissionSelect = vi.fn().mockReturnValue({ eq: submissionEq });
    const receiptRange = vi
      .fn()
      .mockResolvedValue({ data: receiptRows, error: null });
    const receiptQuery = { order: vi.fn(), range: receiptRange };
    receiptQuery.order.mockReturnValue(receiptQuery);
    const receiptIn = vi.fn().mockReturnValue(receiptQuery);
    const receiptEq = vi.fn().mockReturnValue({ in: receiptIn });
    const receiptSelect = vi.fn().mockReturnValue({ eq: receiptEq });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === "project_recording_share_boards") {
        return { select: boardSelect };
      }
      if (table === "project_recording_share_items") {
        return { select: itemSelect };
      }
      if (table === "project_recording_vendor_review_drafts") {
        return { select: draftSelect };
      }
      if (table === "project_recording_vendor_review_submissions") {
        return { select: submissionSelect };
      }
      if (table === "project_recording_vendor_review_submission_items") {
        return { select: receiptSelect };
      }
      throw new Error(`unexpected batch table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          share_board_id: "share-1",
          item_count: 2,
          draft_completed_count: 1,
        },
        {
          share_board_id: "share-2",
          item_count: 1,
          draft_completed_count: 0,
        },
      ],
      error: null,
    });
    const repo = new SupabaseAdmissionShareBoardRepository({
      from,
      rpc,
    } as never);

    const hydrations = await repo.listInternalShareBoardHydrations("project-1");
    const snapshots = hydrations.map(({ snapshot }) => snapshot);

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "project_recording_share_boards",
      "project_recording_share_items",
      "project_recording_vendor_review_drafts",
      "project_recording_vendor_review_submissions",
      "project_recording_vendor_review_submission_items",
    ]);
    expect(rpc).not.toHaveBeenCalled();
    expect(boardEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(itemEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(draftEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(submissionEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(receiptEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(itemQuery.order.mock.calls).toEqual([
      ["share_board_id", { ascending: true }],
      ["sort_order", { ascending: true }],
    ]);
    expect(itemRange).toHaveBeenCalledWith(0, 999);
    expect(boardRange).toHaveBeenCalledWith(0, 999);
    expect(submissionRange).toHaveBeenCalledWith(0, 999);
    expect(receiptIn).toHaveBeenCalledWith("submission_id", ["submission-2"]);
    expect(receiptRange).toHaveBeenCalledWith(0, 999);
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual([
      "share-2",
      "share-1",
    ]);
    expect(hydrations.map(({ task }) => task.id)).toEqual([
      "share-2",
      "share-1",
    ]);
    expect(
      snapshots[1]?.items.map((item) => item.recordingSubmissionId),
    ).toEqual(["rec-1", "rec-2"]);
    expect(snapshots[1]?.progress).toEqual({ completed: 2, total: 2 });
    expect(snapshots[1]?.latestSubmission?.revision).toBe(2);
    expect(snapshots[1]?.items[1]?.finalReview).toMatchObject({
      decision: "needs_changes",
      submittedAt: "2026-07-31T09:00:00.000Z",
    });
    const presentations = snapshots.map(toInternalAdmissionSharePresentation);
    expect(JSON.stringify(presentations)).not.toContain("tokenHash");
    expect(JSON.stringify(presentations)).not.toContain("storagePath");
    expect(JSON.stringify(presentations)).not.toContain("logoStoragePath");
  });

  it("paginates batch items without truncating presentations above the PostgREST row cap", async () => {
    const boardRange = vi.fn().mockResolvedValue({
      data: [
        internalShareBoardRow("share-1", "2026-07-30T00:00:00.000Z", {
          review_state: "submitted_locked",
        }),
      ],
      error: null,
    });
    const boardQuery = { order: vi.fn(), range: boardRange };
    boardQuery.order.mockReturnValue(boardQuery);
    const boardSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(boardQuery),
    });
    const firstPage = Array.from({ length: 1000 }, (_, index) =>
      internalShareItemRow("share-1", `rec-${index}`, index),
    );
    const itemRange = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [internalShareItemRow("share-1", "rec-1000", 1000)],
        error: null,
      });
    const itemQuery = {
      order: vi.fn(),
      range: itemRange,
    };
    itemQuery.order.mockReturnValue(itemQuery);
    const itemSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(itemQuery),
    });
    const draftRange = vi.fn().mockResolvedValue({ data: [], error: null });
    const draftQuery = { order: vi.fn(), range: draftRange };
    draftQuery.order.mockReturnValue(draftQuery);
    const draftSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(draftQuery),
    });
    const submissionRange = vi.fn().mockResolvedValue({
      data: [
        {
          id: "submission-1",
          share_board_id: "share-1",
          revision: 1,
          project_remark: "Confirmed",
          selected_count: 1001,
          backup_count: 0,
          rejected_count: 0,
          needs_changes_count: 0,
          submitted_at: "2026-07-31T09:00:00.000Z",
        },
      ],
      error: null,
    });
    const submissionQuery = { order: vi.fn(), range: submissionRange };
    submissionQuery.order.mockReturnValue(submissionQuery);
    const submissionSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(submissionQuery),
    });
    const firstReceiptPage = Array.from({ length: 1000 }, (_, index) => ({
      submission_id: "submission-1",
      recording_submission_id: `rec-${index}`,
      decision: "selected",
      remark: "",
      reason_codes: [],
    }));
    const receiptRange = vi
      .fn()
      .mockResolvedValueOnce({ data: firstReceiptPage, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            submission_id: "submission-1",
            recording_submission_id: "rec-1000",
            decision: "selected",
            remark: "",
            reason_codes: [],
          },
        ],
        error: null,
      });
    const receiptQuery = { order: vi.fn(), range: receiptRange };
    receiptQuery.order.mockReturnValue(receiptQuery);
    const receiptSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue(receiptQuery),
      }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === "project_recording_share_boards") {
        return { select: boardSelect };
      }
      if (table === "project_recording_share_items") {
        return { select: itemSelect };
      }
      if (table === "project_recording_vendor_review_drafts") {
        return { select: draftSelect };
      }
      if (table === "project_recording_vendor_review_submissions") {
        return { select: submissionSelect };
      }
      if (table === "project_recording_vendor_review_submission_items") {
        return { select: receiptSelect };
      }
      throw new Error(`unexpected pagination table: ${table}`);
    });
    const repo = new SupabaseAdmissionShareBoardRepository({
      from,
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            share_board_id: "share-1",
            item_count: 1001,
            draft_completed_count: 0,
          },
        ],
        error: null,
      }),
    } as never);

    const hydrations = await repo.listInternalShareBoardHydrations("project-1");

    expect(itemRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(receiptRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(hydrations[0]?.snapshot.items).toHaveLength(1001);
    expect(hydrations[0]?.snapshot.items[1000]?.recordingSubmissionId).toBe(
      "rec-1000",
    );
    expect(hydrations[0]?.snapshot.items[1000]?.finalReview?.decision).toBe(
      "selected",
    );
  });

  it("paginates boards and submissions and chunks receipt ids without per-board queries", async () => {
    const boardRows = Array.from({ length: 1001 }, (_, index) =>
      internalShareBoardRow(
        `share-${index}`,
        new Date(Date.UTC(2026, 6, 30) + index * 1000).toISOString(),
      ),
    );
    const boardRange = vi
      .fn()
      .mockResolvedValueOnce({ data: boardRows.slice(0, 1000), error: null })
      .mockResolvedValueOnce({ data: boardRows.slice(1000), error: null });
    const boardQuery = { order: vi.fn(), range: boardRange };
    boardQuery.order.mockReturnValue(boardQuery);
    const boardSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(boardQuery),
    });

    const itemRows = boardRows.map((board, index) =>
      internalShareItemRow(board.id, `rec-${index}`, 0),
    );
    const itemRange = vi
      .fn()
      .mockResolvedValueOnce({ data: itemRows.slice(0, 1000), error: null })
      .mockResolvedValueOnce({ data: itemRows.slice(1000), error: null });
    const itemQuery = { order: vi.fn(), range: itemRange };
    itemQuery.order.mockReturnValue(itemQuery);
    const itemSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(itemQuery),
    });

    const submissionRows = boardRows.map((board, index) => ({
      id: `submission-${index}`,
      share_board_id: board.id,
      revision: 1,
      project_remark: "Confirmed",
      selected_count: 0,
      backup_count: 0,
      rejected_count: 0,
      needs_changes_count: 0,
      submitted_at: "2026-07-31T09:00:00.000Z",
    }));
    const submissionRange = vi
      .fn()
      .mockResolvedValueOnce({
        data: submissionRows.slice(0, 1000),
        error: null,
      })
      .mockResolvedValueOnce({
        data: submissionRows.slice(1000),
        error: null,
      });
    const submissionQuery = { order: vi.fn(), range: submissionRange };
    submissionQuery.order.mockReturnValue(submissionQuery);
    const submissionSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(submissionQuery),
    });

    const draftProgressCases = [
      { decision: "selected", remark: "", completed: 1 },
      { decision: "backup", remark: "", completed: 1 },
      { decision: "rejected", remark: "Reason", completed: 1 },
      { decision: "needs_changes", remark: "Fix opening", completed: 1 },
      { decision: "rejected", remark: "", completed: 0 },
      { decision: "needs_changes", remark: "   ", completed: 0 },
      { decision: "pending", remark: "", completed: 0 },
    ];
    const draftRows = boardRows.map((board, index) => {
      const progressCase =
        draftProgressCases[index % draftProgressCases.length];
      return {
        share_board_id: board.id,
        recording_submission_id: `rec-${index}`,
        decision: progressCase?.decision,
        remark: progressCase?.remark,
      };
    });
    const draftRange = vi
      .fn()
      .mockResolvedValueOnce({ data: draftRows.slice(0, 1000), error: null })
      .mockResolvedValueOnce({ data: draftRows.slice(1000), error: null });
    const draftQuery = { order: vi.fn(), range: draftRange };
    draftQuery.order.mockReturnValue(draftQuery);
    const draftSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(draftQuery),
    });

    const receiptRange = vi.fn().mockResolvedValue({ data: [], error: null });
    const receiptQuery = { order: vi.fn(), range: receiptRange };
    receiptQuery.order.mockReturnValue(receiptQuery);
    const receiptIn = vi.fn().mockReturnValue(receiptQuery);
    const receiptSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ in: receiptIn }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === "project_recording_share_boards") {
        return { select: boardSelect };
      }
      if (table === "project_recording_share_items") {
        return { select: itemSelect };
      }
      if (table === "project_recording_vendor_review_submissions") {
        return { select: submissionSelect };
      }
      if (table === "project_recording_vendor_review_drafts") {
        return { select: draftSelect };
      }
      if (table === "project_recording_vendor_review_submission_items") {
        return { select: receiptSelect };
      }
      throw new Error(`unexpected collection table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repo = new SupabaseAdmissionShareBoardRepository({
      from,
      rpc,
    } as never);

    const hydrations = await repo.listInternalShareBoardHydrations("project-1");

    expect(boardRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(submissionRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(draftRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(hydrations).toHaveLength(1001);
    expect(
      hydrations.slice(0, draftProgressCases.length).map((hydration) => ({
        taskCompleted: hydration.task.draftCompletedCount,
        presentationCompleted: hydration.snapshot.progress.completed,
      })),
    ).toEqual(
      draftProgressCases.map(({ completed }) => ({
        taskCompleted: completed,
        presentationCompleted: completed,
      })),
    );
    expect(hydrations[1000]?.task.itemCount).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(receiptIn).toHaveBeenCalledTimes(11);
    expect(
      receiptIn.mock.calls.every(
        ([field, ids]) =>
          field === "submission_id" &&
          Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 100,
      ),
    ).toBe(true);
  });
});

describe("admission share playback issue service", () => {
  const issue = {
    id: "issue-1",
    shareBoardId: "share-1",
    recordingSubmissionId: "rec-1",
    recordingVersion: 2,
    streamerDisplayName: "Streamer One",
    sourceType: "original" as const,
    errorCode: "MEDIA_DECODE_FAILED",
    status: "open" as const,
    reportedAt: "2026-07-30T09:00:00.000Z",
    resolvedAt: null,
  };

  it("gates a public report by the opaque session and shared item before one RPC", async () => {
    const reportPlaybackIssue = vi
      .fn()
      .mockResolvedValue({ issueId: "issue-1" });
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      reportPlaybackIssue,
    });
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };

    await expect(
      recordPublicAdmissionPlaybackIssue({
        repo,
        accessStore,
        token: "plain-token",
        sessionToken: "opaque-session-token",
        recordingSubmissionId: "rec-1",
        sourceType: "original",
        errorCode: "MEDIA_DECODE_FAILED",
        userAgentFamily: "Chrome",
        now: "2026-06-07T09:00:00.000Z",
      }),
    ).resolves.toEqual({ issueId: "issue-1" });

    expect(accessStore.hasValidSession).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      sessionToken: "opaque-session-token",
      now: "2026-06-07T09:00:00.000Z",
    });
    expect(reportPlaybackIssue).toHaveBeenCalledWith({
      shareBoardId: "share-1",
      recordingSubmissionId: "rec-1",
      sourceType: "original",
      errorCode: "MEDIA_DECODE_FAILED",
      userAgentFamily: "Chrome",
      reportedAt: "2026-06-07T09:00:00.000Z",
    });
    expect(JSON.stringify(reportPlaybackIssue.mock.calls)).not.toMatch(
      /plain-token|opaque-session-token|storage_path|access_code/iu,
    );
  });

  it("rejects unshared recordings and non-whitelisted issue data before persistence", async () => {
    const reportPlaybackIssue = vi.fn();
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
      reportPlaybackIssue,
    });
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(true),
    };
    const base = {
      repo,
      accessStore,
      token: "plain-token",
      sessionToken: "opaque-session-token",
      recordingSubmissionId: "rec-1",
      sourceType: "original" as const,
      errorCode: "MEDIA_LOAD_FAILED",
      userAgentFamily: "Chrome",
      now: "2026-06-07T09:00:00.000Z",
    };

    await expect(
      recordPublicAdmissionPlaybackIssue({
        ...base,
        recordingSubmissionId: "rec-not-shared",
      }),
    ).rejects.toMatchObject({ code: "RECORDING_NOT_SHARED", statusCode: 404 });
    await expect(
      recordPublicAdmissionPlaybackIssue({
        ...base,
        sourceType: "script" as never,
      }),
    ).rejects.toMatchObject({
      code: "REVIEW_VALIDATION_FAILED",
      statusCode: 400,
    });
    await expect(
      recordPublicAdmissionPlaybackIssue({
        ...base,
        errorCode: "CUSTOM_ERROR",
      }),
    ).rejects.toMatchObject({
      code: "REVIEW_VALIDATION_FAILED",
      statusCode: 400,
    });
    await expect(
      recordPublicAdmissionPlaybackIssue({
        ...base,
        userAgentFamily: "Mozilla/5.0 Chrome/140 secret-tail",
      }),
    ).rejects.toMatchObject({
      code: "REVIEW_VALIDATION_FAILED",
      statusCode: 400,
    });
    expect(reportPlaybackIssue).not.toHaveBeenCalled();
  });

  it("requires the established session for an access-code protected preview report", async () => {
    const reportPlaybackIssue = vi.fn();
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(
        publicSnapshot({
          mode: "preview",
          allowVendorSubmit: false,
          roundNumber: 0,
          accessCodeHash: hashAdmissionShareAccessCode("24681024"),
        }),
      ),
      reportPlaybackIssue,
    });
    const accessStore = {
      consumeAttempt: vi.fn(),
      createSession: vi.fn(),
      hasValidSession: vi.fn().mockResolvedValue(false),
    };

    await expect(
      recordPublicAdmissionPlaybackIssue({
        repo,
        accessStore,
        token: "plain-token",
        recordingSubmissionId: "rec-1",
        sourceType: "original",
        errorCode: "MEDIA_LOAD_FAILED",
        userAgentFamily: "Chrome",
        now: "2026-06-07T09:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_CODE_REQUIRED",
      statusCode: 401,
    });
    expect(reportPlaybackIssue).not.toHaveBeenCalled();
  });

  it("checks MCN role and organization again before listing or resolving", async () => {
    const repo = createRepo({
      listPlaybackIssues: vi.fn().mockResolvedValue([issue]),
      resolvePlaybackIssue: vi.fn().mockResolvedValue({ resolvedNow: true }),
    });
    const audit = vi.fn().mockRejectedValue(new Error("audit unavailable"));

    await expect(
      listAdmissionSharePlaybackIssues({
        repo,
        actor,
        organizationId: "org-1",
        projectId: "project-1",
        status: "open",
      }),
    ).resolves.toEqual([issue]);
    expect(repo.listPlaybackIssues).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      status: "open",
    });

    await expect(
      resolveAdmissionSharePlaybackIssue({
        repo,
        audit,
        actor,
        organizationId: "org-1",
        projectId: "project-1",
        issueId: "issue-1",
        now: "2026-07-30T10:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(repo.resolvePlaybackIssue).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      issueId: "issue-1",
      actorUserId: "user-ops",
      resolvedAt: "2026-07-30T10:00:00.000Z",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        action: "resolve_share_playback_issue",
        objectId: "issue-1",
        projectId: "project-1",
      }),
    );

    for (const unauthorizedActor of [
      { ...actor, organizationId: "org-2" },
      { ...actor, role: "streamer" as const },
    ]) {
      await expect(
        listAdmissionSharePlaybackIssues({
          repo,
          actor: unauthorizedActor,
          organizationId: "org-1",
          projectId: "project-1",
          status: "open",
        }),
      ).rejects.toMatchObject({
        code: "PLAYBACK_ISSUE_FORBIDDEN",
        statusCode: 403,
      });
    }
  });

  it("writes the supplemental resolution audit only for the atomic winning RPC", async () => {
    const resolvePlaybackIssue = vi
      .fn()
      .mockResolvedValueOnce({ resolvedNow: true })
      .mockResolvedValueOnce({ resolvedNow: false });
    const repo = createRepo({ resolvePlaybackIssue });
    const audit = vi.fn().mockResolvedValue(undefined);
    const input = {
      repo,
      audit,
      actor,
      organizationId: "org-1",
      projectId: "project-1",
      issueId: "issue-1",
      now: "2026-07-30T10:00:00.000Z",
    };

    await resolveAdmissionSharePlaybackIssue(input);
    await resolveAdmissionSharePlaybackIssue(input);

    expect(resolvePlaybackIssue).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "resolve_share_playback_issue",
        objectId: "issue-1",
      }),
    );
  });

  it("maps staff issue rows to the strict DTO without persistence-only fields", async () => {
    const row = {
      id: "issue-1",
      share_board_id: "share-1",
      recording_submission_id: "rec-1",
      source_type: "original",
      error_code: "MEDIA_DECODE_FAILED",
      status: "open",
      reported_at: "2026-07-30T09:00:00.000Z",
      resolved_at: null,
      user_agent_family: "Chrome",
      resolution_note: "internal",
      recording_submissions: {
        version: 2,
        streamers: { display_name: "Streamer One" },
      },
    };
    const order = vi.fn().mockResolvedValue({ data: [row], error: null });
    const statusEq = vi.fn().mockReturnValue({ order });
    const projectEq = vi.fn().mockReturnValue({ eq: statusEq });
    const organizationEq = vi.fn().mockReturnValue({ eq: projectEq });
    const select = vi.fn().mockReturnValue({ eq: organizationEq });
    const from = vi.fn().mockReturnValue({ select });
    const repo = new SupabaseAdmissionShareBoardRepository({ from } as never);

    const result = await repo.listPlaybackIssues({
      organizationId: "org-1",
      projectId: "project-1",
      status: "open",
    });

    expect(organizationEq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(projectEq).toHaveBeenCalledWith("project_id", "project-1");
    expect(statusEq).toHaveBeenCalledWith("status", "open");
    expect(result).toEqual([issue]);
    expect(JSON.stringify(result)).not.toMatch(
      /userAgent|resolutionNote|organizationId|projectId/iu,
    );
  });

  it("maps list database failures to a sanitized dedicated 500 error", async () => {
    const order = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    const statusEq = vi.fn().mockReturnValue({ order });
    const projectEq = vi.fn().mockReturnValue({ eq: statusEq });
    const organizationEq = vi.fn().mockReturnValue({ eq: projectEq });
    const select = vi.fn().mockReturnValue({ eq: organizationEq });
    const from = vi.fn().mockReturnValue({ select });
    const repo = new SupabaseAdmissionShareBoardRepository({ from } as never);

    await expect(
      repo.listPlaybackIssues({
        organizationId: "org-1",
        projectId: "project-1",
        status: "open",
      }),
    ).rejects.toMatchObject({
      code: "PLAYBACK_ISSUE_DATABASE_ERROR",
      statusCode: 500,
      message: "Playback issue database request failed",
    });
  });

  it.each([
    [
      { code: "42501", message: "row level security rejected request" },
      { code: "PLAYBACK_ISSUE_FORBIDDEN", statusCode: 403 },
    ],
    [
      { code: "P0001", message: "admission_share_playback_issue_not_found" },
      { code: "PLAYBACK_ISSUE_NOT_FOUND", statusCode: 404 },
    ],
    [
      { code: "XX000", message: "private database detail" },
      { code: "PLAYBACK_ISSUE_DATABASE_ERROR", statusCode: 500 },
    ],
  ])(
    "maps resolve database error %# to a stable service error",
    async (error, expected) => {
      const single = vi.fn().mockResolvedValue({ data: null, error });
      const rpc = vi.fn().mockReturnValue({ single });
      const repo = new SupabaseAdmissionShareBoardRepository({ rpc } as never);

      await expect(
        repo.resolvePlaybackIssue({
          organizationId: "org-1",
          projectId: "project-1",
          issueId: "issue-1",
          actorUserId: "user-ops",
          resolvedAt: "2026-07-30T10:00:00.000Z",
        }),
      ).rejects.toMatchObject(expected);
    },
  );

  it("maps an invalid resolve RPC payload to a dedicated 500 error", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { issue_id: "issue-1", resolved_now: "yes" },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ single });
    const repo = new SupabaseAdmissionShareBoardRepository({ rpc } as never);

    await expect(
      repo.resolvePlaybackIssue({
        organizationId: "org-1",
        projectId: "project-1",
        issueId: "issue-1",
        actorUserId: "user-ops",
        resolvedAt: "2026-07-30T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "PLAYBACK_ISSUE_INVALID_RESPONSE",
      statusCode: 500,
    });
  });

  it("uses only the atomic report and resolve RPCs for issue mutations", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "issue-1" },
      error: null,
    });
    const resolveSingle = vi.fn().mockResolvedValue({
      data: { issue_id: "issue-1", resolved_now: true },
      error: null,
    });
    const rpc = vi
      .fn()
      .mockReturnValueOnce({ single })
      .mockReturnValueOnce({ single: resolveSingle });
    const from = vi.fn();
    const repo = new SupabaseAdmissionShareBoardRepository({
      rpc,
      from,
    } as never);

    await expect(
      repo.reportPlaybackIssue({
        shareBoardId: "share-1",
        recordingSubmissionId: "rec-1",
        sourceType: "original",
        errorCode: "MEDIA_DECODE_FAILED",
        userAgentFamily: "Chrome",
        reportedAt: "2026-07-30T09:00:00.000Z",
      }),
    ).resolves.toEqual({ issueId: "issue-1" });
    await expect(
      repo.resolvePlaybackIssue({
        organizationId: "org-1",
        projectId: "project-1",
        issueId: "issue-1",
        actorUserId: "user-ops",
        resolvedAt: "2026-07-30T10:00:00.000Z",
      }),
    ).resolves.toEqual({ resolvedNow: true });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "report_admission_share_playback_issue",
      {
        p_share_board_id: "share-1",
        p_recording_submission_id: "rec-1",
        p_source_type: "original",
        p_error_code: "MEDIA_DECODE_FAILED",
        p_user_agent_family: "Chrome",
        p_reported_at: "2026-07-30T09:00:00.000Z",
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "resolve_admission_share_playback_issue",
      {
        p_organization_id: "org-1",
        p_project_id: "project-1",
        p_issue_id: "issue-1",
        p_actor_user_id: "user-ops",
        p_resolved_at: "2026-07-30T10:00:00.000Z",
      },
    );
    expect(from).not.toHaveBeenCalled();
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
    brandSnapshot: {
      schemaVersion: 1,
      version: 1,
      logoText: "星河",
      logoStoragePath: null,
      brandName: "星河直播",
      brandTagline: "专业直播运营",
      primaryColor: "#165DFF",
      publishedAt: "2026-06-01T00:00:00.000Z",
    },
    brandVersion: 1,
    contactCardId: null,
    contactCardSnapshot: null,
    reviewState: "not_started" as const,
    roundNumber: 1,
    createdBy: "user-ops",
    createdAt: "2026-06-07T00:00:00.000Z",
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
