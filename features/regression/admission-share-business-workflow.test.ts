import { describe, expect, it, vi } from "vitest";

import {
  createAdmissionShareBoard,
  reopenAdmissionShareBoard,
  savePublicAdmissionReviewDraft,
  submitVendorAdmissionReviews,
  type AdmissionShareBoardRecord,
  type AdmissionShareBoardRepository,
  type PublicAdmissionShareBoardSnapshot,
  type SubmitAdmissionReviewResult,
} from "@/features/applications/admission-share-board";
import type {
  AdmissionShareCandidateDto,
  AdmissionShareCandidateRepository,
} from "@/features/applications/admission-share-candidates";
import {
  preflightAdmissionShareSelection,
  type AdmissionShareMode,
  type AdmissionShareReviewState,
  type AdmissionShareSelectionInput,
} from "@/features/applications/admission-share-workflow";

const scenarios = [
  {
    name: "preview never writes drafts or results",
    mode: "preview",
    expectedDraftWrites: 0,
    expectedSubmissionWrites: 0,
  },
  {
    name: "formal selected+pending orchestration maps RPC incomplete boundary; live SQL completeness separately",
    mode: "formal_review",
    decisions: ["selected", "pending"],
    expectedError: "REVIEW_INCOMPLETE",
  },
  {
    name: "historically approved version remains selectable",
    mcnReviewDecision: "approved",
    currentRecordingStatus: "rejected",
    expectedShareable: true,
  },
  {
    name: "historical v1 selection and skipped RPC orchestration; live latest-state preservation separately",
    selectedVersion: 1,
    latestVersion: 2,
    expectedSyncStatus: "skipped",
    expectedSyncError: "superseded_recording_version",
  },
  {
    name: "locked submission requires MCN reopen",
    reviewState: "submitted_locked",
    expectedError: "REVIEW_ALREADY_LOCKED",
  },
] as const;

const actor = {
  userId: "ops-user",
  name: "MCN 运营",
  role: "ops_manager" as const,
  organizationId: "org-1",
};
const now = "2026-07-30T12:00:00.000Z";
const expiresAt = "2026-08-06T12:00:00.000Z";

type BusinessCandidate = AdmissionShareCandidateDto & {
  currentRecordingStatus: "approved" | "rejected" | "needs_changes";
};

function candidate(
  overrides: Partial<BusinessCandidate> = {},
): BusinessCandidate {
  return {
    applicationId: "application-1",
    recordingSubmissionId: "recording-1-v1",
    recordingVersion: 1,
    isLatestVersion: true,
    streamer: {
      id: "streamer-1",
      displayName: "主播甲",
      accountLabel: "douyin / streamer-1",
    },
    mcnReviewDecision: "approved",
    mcnReviewedAt: "2026-07-29T12:00:00.000Z",
    sourceHealth: "original_ready",
    hasPrivateStorage: true,
    externalUrl: null,
    isShareable: true,
    blockReason: null,
    currentVendorDecision: "pending",
    lastSharedAt: null,
    currentRecordingStatus: "approved",
    ...overrides,
  };
}

function selection(
  source: AdmissionShareCandidateDto,
  sortOrder = 0,
): AdmissionShareSelectionInput {
  return {
    applicationId: source.applicationId,
    recordingSubmissionId: source.recordingSubmissionId,
    recordingVersion: source.recordingVersion,
    sortOrder,
  };
}

function createWorkflowHarness(candidates: BusinessCandidate[]) {
  let snapshot: PublicAdmissionShareBoardSnapshot | null = null;
  let submitBehavior: (
    input: Parameters<AdmissionShareBoardRepository["submitReview"]>[0],
  ) => Promise<SubmitAdmissionReviewResult> = async () => ({
    submissionRevision: 1,
    submittedCount: 0,
    syncedCount: 0,
    skippedCount: 0,
    items: [],
  });
  const draftWrites: Array<
    Parameters<AdmissionShareBoardRepository["saveReviewDraft"]>[0]
  > = [];
  const submissionWrites: Array<
    Parameters<AdmissionShareBoardRepository["submitReview"]>[0]
  > = [];

  const repo = {
    createShareBoardWithItems: vi.fn(
      async (
        input: Parameters<
          AdmissionShareBoardRepository["createShareBoardWithItems"]
        >[0],
      ) => {
        const shareBoard: AdmissionShareBoardRecord = {
          id: "share-board-1",
          organizationId: input.organizationId,
          projectId: input.projectId,
          title: input.title,
          purpose: input.purpose,
          mode: input.mode,
          tokenHash: input.tokenHash,
          accessCodeHash: input.accessCodeHash,
          status: "active",
          expiresAt: input.expiresAt,
          allowVendorSubmit: input.mode === "formal_review",
          allowExternalFallback: input.allowExternalFallback,
          reviewState: "not_started",
          roundNumber: input.mode === "formal_review" ? 1 : 0,
          createdBy: input.createdBy,
          createdAt: now,
        };
        snapshot = {
          ...shareBoard,
          project: {
            id: input.projectId,
            code: "P-001",
            name: "项目一",
            vendor: "甲方一",
            product: "产品一",
          },
          progress: { completed: 0, total: input.items.length },
          latestSubmission: null,
          items: input.items.map((item) => {
            const source = candidates.find(
              (entry) =>
                entry.recordingSubmissionId === item.recordingSubmissionId,
            );
            if (!source) {
              throw new Error("Regression fixture candidate is missing");
            }
            return {
              applicationId: item.applicationId,
              applicationStatus: "recording_approved" as const,
              recordingSubmissionId: item.recordingSubmissionId,
              recordingVersion: item.recordingVersion,
              recordingStatus: source.currentRecordingStatus,
              recordingUrl: source.externalUrl,
              storagePath: source.hasPrivateStorage
                ? `private/${item.recordingSubmissionId}.mp4`
                : null,
              playbackUrl: `/api/public/admission-share/token/recordings/${item.recordingSubmissionId}`,
              externalUrl: source.externalUrl,
              sourceHealth: source.sourceHealth,
              hasPrivateStorage: source.hasPrivateStorage,
              streamer: source.streamer,
              finalReview: null,
            };
          }),
        };
        return shareBoard;
      },
    ),
    listShareBoards: vi.fn().mockResolvedValue([]),
    extendShareBoard: vi.fn(),
    reopenShareBoard: vi.fn(async () => {
      if (snapshot) {
        snapshot = { ...snapshot, reviewState: "in_progress" };
      }
    }),
    rotateShareBoardToken: vi.fn(),
    revokeShareBoard: vi.fn(),
    reportPlaybackIssue: vi.fn(),
    listPlaybackIssues: vi.fn().mockResolvedValue([]),
    resolvePlaybackIssue: vi.fn(),
    getPublicShareBoardSnapshot: vi.fn(async (tokenHash: string) =>
      snapshot?.tokenHash === tokenHash ? snapshot : null,
    ),
    listReviewDrafts: vi.fn().mockResolvedValue([]),
    saveReviewDraft: vi.fn(async (input) => {
      draftWrites.push(input);
      const sharedItem = snapshot?.items.find(
        (item) => item.recordingSubmissionId === input.recordingSubmissionId,
      );
      if (!sharedItem) {
        throw new Error("Regression fixture share item is missing");
      }
      return {
        recordingSubmissionId: input.recordingSubmissionId,
        recordingVersion: sharedItem.recordingVersion,
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
        revision: input.expectedRevision + 1,
        updatedAt: input.savedAt,
      };
    }),
    submitReview: vi.fn(async (input) => {
      submissionWrites.push(input);
      return submitBehavior(input);
    }),
    listReviewSubmissions: vi.fn().mockResolvedValue([]),
    upsertVendorReviews: vi.fn(),
    updateRecordingReviewForVendor: vi.fn(),
    updateApplicationStatusForVendor: vi.fn(),
    markShareBoardSubmitted: vi.fn(),
    markShareBoardViewed: vi.fn(),
  } satisfies AdmissionShareBoardRepository;

  const candidateRepo: AdmissionShareCandidateRepository = {
    listCandidates: vi.fn().mockResolvedValue(candidates),
    getPlaybackSource: vi.fn(),
  };
  const accessStore = {
    consumeAttempt: vi.fn(),
    createSession: vi.fn(),
    hasValidSession: vi.fn().mockResolvedValue(true),
  };

  return {
    repo,
    candidateRepo,
    accessStore,
    draftWrites,
    submissionWrites,
    setReviewState(reviewState: AdmissionShareReviewState) {
      if (!snapshot) {
        throw new Error("Share board must be created before changing state");
      }
      snapshot = { ...snapshot, reviewState };
    },
    setSubmitBehavior(behavior: typeof submitBehavior) {
      submitBehavior = behavior;
    },
  };
}

async function createShare(
  harness: ReturnType<typeof createWorkflowHarness>,
  mode: AdmissionShareMode,
  items: AdmissionShareSelectionInput[],
  token: string,
) {
  return createAdmissionShareBoard({
    repo: harness.repo,
    candidateRepo: harness.candidateRepo,
    audit: vi.fn(),
    actor,
    projectId: "project-1",
    input: {
      title: mode === "preview" ? "只读预览" : "正式复核",
      mode,
      expiresAt,
      requireAccessCode: false,
      items,
    },
    now,
    tokenFactory: () => token,
  });
}

async function saveDraft(
  harness: ReturnType<typeof createWorkflowHarness>,
  token: string,
  source: AdmissionShareCandidateDto,
  decision: "pending" | "selected" | "backup" | "rejected" | "needs_changes",
) {
  return savePublicAdmissionReviewDraft({
    repo: harness.repo,
    accessStore: harness.accessStore,
    token,
    sessionToken: "valid-review-session",
    recordingSubmissionId: source.recordingSubmissionId,
    input: {
      expectedRevision: 0,
      decision,
      remark: "",
      reasonCodes: [],
    },
    now,
  });
}

describe("admission share business workflow regression", () => {
  it.each(scenarios)("$name", async (scenario) => {
    if (scenario.name === "preview never writes drafts or results") {
      const source = candidate();
      const harness = createWorkflowHarness([source]);
      const token = "preview-token";
      await createShare(harness, scenario.mode, [selection(source)], token);

      await expect(
        saveDraft(harness, token, source, "selected"),
      ).rejects.toMatchObject({ code: "REVIEW_ALREADY_LOCKED" });
      await expect(
        submitVendorAdmissionReviews({
          repo: harness.repo,
          token,
          input: {},
          now,
        }),
      ).rejects.toMatchObject({ code: "REVIEW_VALIDATION_FAILED" });

      expect(harness.draftWrites).toHaveLength(scenario.expectedDraftWrites);
      expect(harness.submissionWrites).toHaveLength(
        scenario.expectedSubmissionWrites,
      );
      return;
    }

    if (
      scenario.name ===
      "formal selected+pending orchestration maps RPC incomplete boundary; live SQL completeness separately"
    ) {
      const sources = [
        candidate(),
        candidate({
          applicationId: "application-2",
          recordingSubmissionId: "recording-2-v1",
          streamer: {
            id: "streamer-2",
            displayName: "主播乙",
            accountLabel: "douyin / streamer-2",
          },
        }),
      ];
      const harness = createWorkflowHarness(sources);
      const token = "formal-incomplete-token";
      await createShare(
        harness,
        scenario.mode,
        sources.map((source, index) => selection(source, index)),
        token,
      );
      for (const [index, decision] of scenario.decisions.entries()) {
        await saveDraft(harness, token, sources[index], decision);
      }

      // The fake persistence boundary does not decide completeness. The SQL
      // contract and live DB own that rule; this layer maps its stable error.
      harness.setSubmitBehavior(async () => {
        throw new Error("admission_share_review_incomplete");
      });

      await expect(
        submitVendorAdmissionReviews({
          repo: harness.repo,
          token,
          input: { projectRemark: "仍有一条待判断" },
          now,
        }),
      ).rejects.toMatchObject({ code: scenario.expectedError });
      expect(harness.repo.submitReview).toHaveBeenCalledTimes(1);
      expect(harness.repo.submitReview).toHaveBeenCalledWith({
        shareBoardId: "share-board-1",
        projectRemark: "仍有一条待判断",
        submittedAt: now,
      });
      expect(harness.draftWrites).toEqual([
        {
          shareBoardId: "share-board-1",
          recordingSubmissionId: "recording-1-v1",
          expectedRevision: 0,
          decision: "selected",
          remark: "",
          reasonCodes: [],
          savedAt: now,
        },
        {
          shareBoardId: "share-board-1",
          recordingSubmissionId: "recording-2-v1",
          expectedRevision: 0,
          decision: "pending",
          remark: "",
          reasonCodes: [],
          savedAt: now,
        },
      ]);
      expect(harness.submissionWrites).toEqual([
        {
          shareBoardId: "share-board-1",
          projectRemark: "仍有一条待判断",
          submittedAt: now,
        },
      ]);
      expect(harness.repo.upsertVendorReviews).not.toHaveBeenCalled();
      expect(
        harness.repo.updateRecordingReviewForVendor,
      ).not.toHaveBeenCalled();
      expect(
        harness.repo.updateApplicationStatusForVendor,
      ).not.toHaveBeenCalled();
      expect(harness.repo.markShareBoardSubmitted).not.toHaveBeenCalled();
      return;
    }

    if (scenario.name === "historically approved version remains selectable") {
      const source = candidate({
        mcnReviewDecision: scenario.mcnReviewDecision,
        currentRecordingStatus: scenario.currentRecordingStatus,
        currentVendorDecision: "rejected",
      });
      const selected = selection(source);
      const preflight = preflightAdmissionShareSelection([source], [selected]);

      expect(preflight.items[0]).toMatchObject({
        status: scenario.expectedShareable ? "ready" : "blocked",
        reasonCode: null,
      });
      const harness = createWorkflowHarness([source]);
      await createShare(
        harness,
        "formal_review",
        [selected],
        "historical-approved-token",
      );
      expect(harness.repo.createShareBoardWithItems).toHaveBeenCalledWith(
        expect.objectContaining({ items: [selected] }),
      );
      expect(source.currentRecordingStatus).toBe("rejected");
      return;
    }

    if (
      scenario.name ===
      "historical v1 selection and skipped RPC orchestration; live latest-state preservation separately"
    ) {
      const historical = candidate({
        recordingVersion: scenario.selectedVersion,
        isLatestVersion: false,
      });
      const latest = candidate({
        recordingSubmissionId: "recording-1-v2",
        recordingVersion: scenario.latestVersion,
        isLatestVersion: true,
      });
      const sources = [historical, latest];
      const selected = selection(historical);
      const preflight = preflightAdmissionShareSelection(sources, [selected]);
      expect(preflight.items).toEqual([
        {
          ...selected,
          status: "ready",
          sourceHealth: "original_ready",
          reasonCode: null,
        },
      ]);

      const harness = createWorkflowHarness(sources);
      const token = "historical-result-token";
      await createShare(harness, "formal_review", [selected], token);
      expect(harness.repo.createShareBoardWithItems).toHaveBeenCalledWith(
        expect.objectContaining({ items: [selected] }),
      );
      const rpcOutcome: SubmitAdmissionReviewResult = {
        submissionRevision: 1,
        submittedCount: 1,
        syncedCount: 0,
        skippedCount: 1,
        items: [
          {
            vendorReviewId: "vendor-review-old-version",
            applicationId: historical.applicationId,
            recordingSubmissionId: historical.recordingSubmissionId,
            recordingVersion: scenario.selectedVersion,
            decision: "rejected",
            remark: "旧版不采用",
            reasonCodes: ["script_fit"],
            syncStatus: scenario.expectedSyncStatus,
            syncError: scenario.expectedSyncError,
          },
        ],
      };
      harness.setSubmitBehavior(async () => rpcOutcome);

      const result = await submitVendorAdmissionReviews({
        repo: harness.repo,
        token,
        input: { projectRemark: "历史版本复核" },
        now,
      });

      expect(harness.repo.submitReview).toHaveBeenCalledTimes(1);
      expect(harness.repo.submitReview).toHaveBeenCalledWith({
        shareBoardId: "share-board-1",
        projectRemark: "历史版本复核",
        submittedAt: now,
      });
      expect(harness.submissionWrites).toEqual([
        {
          shareBoardId: "share-board-1",
          projectRemark: "历史版本复核",
          submittedAt: now,
        },
      ]);
      expect(result).toBe(rpcOutcome);
      expect(result).toMatchObject({
        submissionRevision: 1,
        submittedCount: 1,
        syncedCount: 0,
        skippedCount: 1,
        items: [
          {
            recordingSubmissionId: "recording-1-v1",
            recordingVersion: 1,
            syncStatus: "skipped",
            syncError: "superseded_recording_version",
          },
        ],
      });
      expect(historical.recordingVersion).toBe(scenario.selectedVersion);
      expect(latest.recordingVersion).toBe(scenario.latestVersion);
      expect(harness.repo.upsertVendorReviews).not.toHaveBeenCalled();
      expect(
        harness.repo.updateRecordingReviewForVendor,
      ).not.toHaveBeenCalled();
      expect(
        harness.repo.updateApplicationStatusForVendor,
      ).not.toHaveBeenCalled();
      expect(harness.repo.markShareBoardSubmitted).not.toHaveBeenCalled();
      return;
    }

    const source = candidate();
    const harness = createWorkflowHarness([source]);
    const token = "locked-review-token";
    await createShare(harness, "formal_review", [selection(source)], token);
    harness.setReviewState(scenario.reviewState);

    await expect(
      saveDraft(harness, token, source, "selected"),
    ).rejects.toMatchObject({ code: scenario.expectedError });
    const audit = vi.fn().mockResolvedValue(undefined);
    await reopenAdmissionShareBoard({
      repo: harness.repo,
      audit,
      actor,
      projectId: "project-1",
      shareBoardId: "share-board-1",
      reason: "甲方需要修正误选结果",
    });
    await expect(
      saveDraft(harness, token, source, "selected"),
    ).resolves.toMatchObject({ decision: "selected", revision: 1 });
    expect(harness.draftWrites).toHaveLength(1);
    expect(harness.repo.reopenShareBoard).toHaveBeenCalledWith({
      shareBoardId: "share-board-1",
      projectId: "project-1",
      reason: "甲方需要修正误选结果",
      actorUserId: actor.userId,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reopen_share_board",
        reason: "甲方需要修正误选结果",
        isHighRisk: true,
      }),
    );
  });
});
