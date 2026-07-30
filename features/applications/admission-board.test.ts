import { describe, expect, it } from "vitest";

import {
  type AdmissionRecordingDetail,
  toAdmissionResultTask,
  toAdmissionProjectBoards,
  toAdmissionRecordingDetails,
  toAdmissionRecordingExportRows,
} from "./admission-board";

const applications = [
  {
    id: "app-1",
    source: "signup" as const,
    status: "recording_reviewing" as const,
    submitted_at: "2026-06-07T01:00:00.000Z",
    decision_reason: null,
    project_id: "project-1",
    streamer_id: "streamer-1",
    projects: {
      id: "project-1",
      code: "P-001",
      name: "Alpha Project",
      status: "active",
      vendor_name: "Vendor A",
      product_name: "Game A",
    },
    streamers: {
      id: "streamer-1",
      display_name: "Streamer One",
      cooperation_status: "active",
      risk_level: "low",
      streamer_accounts: [
        {
          platform: "Douyin",
          account_handle: "one-live",
          is_primary: true,
        },
      ],
    },
  },
  {
    id: "app-2",
    source: "direct_invite" as const,
    status: "recording_approved" as const,
    submitted_at: "2026-06-07T02:00:00.000Z",
    decision_reason: "approved",
    project_id: "project-1",
    streamer_id: "streamer-2",
    projects: {
      id: "project-1",
      code: "P-001",
      name: "Alpha Project",
      status: "active",
      vendor_name: "Vendor A",
      product_name: "Game A",
    },
    streamers: {
      id: "streamer-2",
      display_name: "Streamer Two",
      cooperation_status: "active",
      risk_level: "low",
      streamer_accounts: [
        {
          platform: "Bilibili",
          account_handle: "two-live",
          is_primary: true,
        },
      ],
    },
  },
  {
    id: "app-3",
    source: "signup" as const,
    status: "recording_required" as const,
    submitted_at: "2026-06-07T03:00:00.000Z",
    decision_reason: "needs changes",
    project_id: "project-2",
    streamer_id: "streamer-3",
    projects: {
      id: "project-2",
      code: "P-002",
      name: "Beta Project",
      status: "recruiting",
      vendor_name: "Vendor B",
      product_name: "Game B",
    },
    streamers: {
      id: "streamer-3",
      display_name: "Streamer Three",
      cooperation_status: "active",
      risk_level: "medium",
      streamer_accounts: [],
    },
  },
];

const rec2AiAnalysis = {
  id: "analysis-rec-2",
  assetId: "asset-rec-2",
  status: "succeeded" as const,
  statusLabel: "分析完成",
  providerName: "mock-provider",
  summary: "Stable pacing with clear gameplay demo.",
  scorecard: { rhythm: 4, script: 3 },
  dimensions: [
    {
      key: "rhythm" as const,
      label: "节奏",
      score: 4,
      finding: "Good pacing overall.",
    },
  ],
  riskFlags: ["mentions competitor product"],
  recommendations: [],
  segments: [],
  transcriptText: null,
  asrProvider: null,
  errorSummary: null,
  aiInvocationId: null,
  createdAt: "2026-06-07T02:20:00.000Z",
  updatedAt: "2026-06-07T02:20:00.000Z",
  completedAt: "2026-06-07T02:20:00.000Z",
};

const recordings = [
  {
    id: "rec-1-old",
    application_id: "app-1",
    asset_id: null,
    version: 1,
    status: "submitted" as const,
    duration_seconds: 1800,
    external_url: "https://video.example/old",
    storage_path: null,
    submitted_at: "2026-06-07T01:05:00.000Z",
    created_at: "2026-06-07T01:05:00.000Z",
  },
  {
    id: "rec-1",
    application_id: "app-1",
    asset_id: null,
    version: 2,
    status: "reviewing" as const,
    duration_seconds: 3600,
    external_url: "https://video.example/latest",
    storage_path: null,
    submitted_at: "2026-06-07T01:10:00.000Z",
    created_at: "2026-06-07T01:10:00.000Z",
  },
  {
    id: "rec-2",
    application_id: "app-2",
    asset_id: "asset-rec-2",
    version: 1,
    status: "approved" as const,
    duration_seconds: 4200,
    external_url: null,
    storage_path: "private/org/project/rec-2.mp4",
    submitted_at: "2026-06-07T02:10:00.000Z",
    created_at: "2026-06-07T02:10:00.000Z",
    aiAnalysis: rec2AiAnalysis,
  },
  {
    id: "rec-3",
    application_id: "app-3",
    asset_id: null,
    version: 1,
    status: "needs_changes" as const,
    duration_seconds: 1200,
    external_url: "https://video.example/needs-changes",
    storage_path: null,
    submitted_at: "2026-06-07T03:10:00.000Z",
    created_at: "2026-06-07T03:10:00.000Z",
  },
];

const vendorReviews = [
  {
    application_id: "app-2",
    recording_submission_id: "rec-2",
    recording_version: 1,
    decision: "backup" as const,
    remark: "Keep as backup.",
    vendor_reviewer_name: "Vendor Reviewer",
    vendor_reviewer_contact: "reviewer@example.com",
    submitted_at: "2026-06-07T04:00:00.000Z",
  },
  {
    application_id: "app-3",
    recording_submission_id: "rec-3",
    recording_version: 1,
    decision: "needs_changes" as const,
    remark: "Needs tutorial segment.",
    vendor_reviewer_name: "Vendor Reviewer",
    vendor_reviewer_contact: "reviewer@example.com",
    submitted_at: "2026-06-07T04:30:00.000Z",
  },
];

const shareBoards = [
  {
    id: "share-preview-1",
    project_id: "project-1",
    status: "active" as const,
    mode: "preview" as const,
    review_state: "viewed" as const,
    round_number: 0,
    expires_at: "2026-08-10T00:00:00.000Z",
    last_viewed_at: "2026-07-29T08:00:00.000Z",
    last_draft_at: null,
    last_submitted_at: null,
    locked_at: null,
    item_count: 3,
    draft_completed_count: 0,
    created_at: "2026-07-29T00:00:00.000Z",
  },
  {
    id: "share-formal-2",
    project_id: "project-1",
    status: "active" as const,
    mode: "formal_review" as const,
    review_state: "in_progress" as const,
    round_number: 2,
    expires_at: "2026-08-06T00:00:00.000Z",
    last_viewed_at: "2026-07-30T08:00:00.000Z",
    last_draft_at: "2026-07-30T08:20:00.000Z",
    last_submitted_at: null,
    locked_at: null,
    item_count: 10,
    draft_completed_count: 4,
    created_at: "2026-07-30T00:00:00.000Z",
  },
];

describe("admission project board DTO", () => {
  it("groups application recordings by project and counts review states", () => {
    const boards = toAdmissionProjectBoards(
      applications,
      recordings,
      vendorReviews,
      shareBoards,
    );

    expect(boards).toHaveLength(2);
    expect(boards[0]).toEqual(
      expect.objectContaining({
        project: expect.objectContaining({
          id: "project-1",
          code: "P-001",
          name: "Alpha Project",
          vendor: "Vendor A",
          product: "Game A",
        }),
        counts: {
          totalApplications: 2,
          recordingCount: 2,
          mcnPendingReview: 1,
          mcnApproved: 1,
          mcnRejected: 0,
          needsChanges: 0,
          vendorPending: 1,
          vendorSelected: 0,
          vendorBackup: 1,
          vendorRejected: 0,
          vendorNeedsChanges: 0,
          pendingFinalConfirm: 1,
        },
        share: {
          id: "share-formal-2",
          mode: "formal_review",
          status: "active",
          reviewState: "in_progress",
          roundNumber: 2,
          expiresAt: "2026-08-06T00:00:00.000Z",
          lastViewedAt: "2026-07-30T08:00:00.000Z",
          lastDraftAt: "2026-07-30T08:20:00.000Z",
          lastSubmittedAt: null,
          lockedAt: null,
        },
        shareProgress: {
          completed: 4,
          total: 10,
        },
      }),
    );
    expect(boards[1].counts.vendorNeedsChanges).toBe(1);
    expect(JSON.stringify(boards)).not.toMatch(
      /grossMargin|supplierCost|settlementPrice|internalRisk|receivable/i,
    );
  });

  it("uses the latest recording version in project detail rows", () => {
    const details = toAdmissionRecordingDetails(
      applications,
      recordings,
      vendorReviews,
    );

    expect(details).toHaveLength(3);
    expect(details[0].latestRecording).toEqual(
      expect.objectContaining({
        id: "rec-1",
        assetId: null,
        version: 2,
        url: "https://video.example/latest",
        aiAnalysis: null,
      }),
    );
    expect(details[1].latestRecording).toEqual(
      expect.objectContaining({
        id: "rec-2",
        assetId: "asset-rec-2",
        version: 1,
        url: null,
        hasPrivateStorage: true,
        aiAnalysis: rec2AiAnalysis,
      }),
    );
    expect(details[1].vendorReview).toEqual(
      expect.objectContaining({
        decision: "backup",
        remark: "Keep as backup.",
      }),
    );
  });

  it("keeps private upload availability when the latest recording also has an external link", () => {
    const dualSourceRecording = {
      ...recordings[1],
      asset_id: "asset-rec-1",
      storage_path: "private/org/project/rec-1.mp4",
    };
    const details = toAdmissionRecordingDetails(
      applications,
      [recordings[0], dualSourceRecording, ...recordings.slice(2)],
      vendorReviews,
    );

    expect(details[0].latestRecording).toEqual(
      expect.objectContaining({
        assetId: "asset-rec-1",
        url: "https://video.example/latest",
        hasPrivateStorage: true,
      }),
    );
  });

  it("exposes vendor rejection and change request reasons in detail rows", () => {
    const details = toAdmissionRecordingDetails(
      [
        {
          ...applications[0],
          id: "app-rejected",
          status: "recording_rejected",
          decision_reason: "Quality is not enough.",
        },
        {
          ...applications[2],
          id: "app-change",
          status: "recording_required",
          decision_reason: "Please add gameplay intro.",
        },
      ],
      [
        {
          ...recordings[1],
          id: "rec-rejected",
          application_id: "app-rejected",
          status: "rejected",
        },
        {
          ...recordings[2],
          id: "rec-change",
          application_id: "app-change",
          status: "needs_changes",
        },
      ],
      [
        {
          application_id: "app-rejected",
          recording_submission_id: "rec-rejected",
          recording_version: 2,
          decision: "rejected",
          remark: "Quality is not enough.",
          vendor_reviewer_name: "Vendor Reviewer",
          vendor_reviewer_contact: "reviewer@example.com",
          submitted_at: "2026-06-07T05:00:00.000Z",
        },
        {
          application_id: "app-change",
          recording_submission_id: "rec-change",
          recording_version: 1,
          decision: "needs_changes",
          remark: "Please add gameplay intro.",
          vendor_reviewer_name: "Vendor Reviewer",
          vendor_reviewer_contact: "reviewer@example.com",
          submitted_at: "2026-06-07T05:30:00.000Z",
        },
      ],
    );

    expect(details[0]).toEqual(
      expect.objectContaining({
        decisionReason: "Quality is not enough.",
        vendorReview: expect.objectContaining({
          decision: "rejected",
          remark: "Quality is not enough.",
        }),
      }),
    );
    expect(details[1]).toEqual(
      expect.objectContaining({
        decisionReason: "Please add gameplay intro.",
        vendorReview: expect.objectContaining({
          decision: "needs_changes",
          remark: "Please add gameplay intro.",
        }),
      }),
    );
  });

  it("maps detail rows into safe admission recording export rows", () => {
    const rows = toAdmissionRecordingExportRows(
      toAdmissionRecordingDetails(applications, recordings, vendorReviews),
    );

    expect(rows[1]).toEqual({
      projectCode: "P-001",
      projectName: "Alpha Project",
      vendorProduct: "Vendor A / Game A",
      streamerName: "Streamer Two",
      streamerAccount: "Bilibili / two-live",
      recordingUrl: "",
      recordingVersion: 1,
      recordingSubmittedAt: "2026-06-07T02:10:00.000Z",
      mcnReviewStatus: "recording_approved",
      vendorDecision: "backup",
      vendorRemark: "Keep as backup.",
    });
    expect(JSON.stringify(rows)).not.toContain("private/org/project");
    expect(JSON.stringify(rows)).not.toContain("Private recording");
  });
});

function resultDetail(
  overrides: Partial<AdmissionRecordingDetail> = {},
): AdmissionRecordingDetail {
  return {
    id: "app-result",
    source: "signup",
    status: "recording_approved",
    submittedAt: "2026-07-30T07:00:00.000Z",
    decisionReason: null,
    project: {
      id: "project-1",
      code: "P-001",
      name: "Alpha Project",
      status: "active",
      vendor: "Vendor A",
      product: "Game A",
    },
    streamer: {
      id: "streamer-1",
      displayName: "主播甲",
      accountLabel: "抖音 / streamer-a",
      cooperationStatus: "active",
      riskLevel: "low",
    },
    latestRecording: {
      id: "recording-v2",
      assetId: "asset-v2",
      version: 2,
      status: "approved",
      durationSeconds: 1800,
      url: null,
      hasPrivateStorage: true,
      submittedAt: "2026-07-30T07:30:00.000Z",
      aiAnalysis: null,
    },
    vendorReview: {
      recordingSubmissionId: "recording-v2",
      recordingVersion: 2,
      decision: "selected",
      remark: "",
      reviewerName: "",
      reviewerContact: "",
      submittedAt: "2026-07-30T10:00:00.000Z",
      syncStatus: "synced",
      syncError: null,
    },
    ...overrides,
  };
}

describe("admission result task DTO", () => {
  it("requires MCN final confirmation for a selected current version", () => {
    const detail = resultDetail();

    expect(toAdmissionResultTask(detail)).toEqual({
      type: "mcn_final_confirm",
      applicationId: detail.id,
      recordingSubmissionId: detail.latestRecording?.id,
      label: "待 MCN 最终确认",
    });
  });

  it("does not turn a backup result into a state-changing task", () => {
    const detail = resultDetail({
      vendorReview: {
        ...resultDetail().vendorReview!,
        decision: "backup",
      },
    });

    expect(toAdmissionResultTask(detail)).toBeNull();
  });

  it("turns rejected and needs-changes results into explicit streamer follow-up", () => {
    expect(
      toAdmissionResultTask(
        resultDetail({
          vendorReview: {
            ...resultDetail().vendorReview!,
            decision: "rejected",
          },
        }),
      ),
    ).toEqual({
      type: "notify_streamer_changes",
      applicationId: "app-result",
      recordingSubmissionId: "recording-v2",
      label: "需要通知主播修改",
    });
    expect(
      toAdmissionResultTask(
        resultDetail({
          status: "recording_required",
          vendorReview: {
            ...resultDetail().vendorReview!,
            decision: "needs_changes",
          },
        }),
      ),
    ).toEqual({
      type: "await_streamer_resubmission",
      applicationId: "app-result",
      recordingSubmissionId: "recording-v2",
      label: "等待主播重新提交",
    });
  });

  it("routes skipped historical results to manual review without overwriting the current version", () => {
    const detail = resultDetail({
      vendorReview: {
        ...resultDetail().vendorReview!,
        recordingSubmissionId: "recording-v1",
        recordingVersion: 1,
        decision: "rejected",
        syncStatus: "skipped",
        syncError: "superseded_recording_version",
      },
    });

    expect(toAdmissionResultTask(detail)).toEqual({
      type: "historical_result_manual_review",
      applicationId: "app-result",
      recordingSubmissionId: "recording-v1",
      label: "历史版本结果待人工确认",
    });
  });

  it("routes a newer recording through MCN review before another formal round", () => {
    const previousReview = {
      ...resultDetail().vendorReview!,
      recordingSubmissionId: "recording-v1",
      recordingVersion: 1,
      decision: "needs_changes" as const,
    };

    expect(
      toAdmissionResultTask(
        resultDetail({
          status: "recording_reviewing",
          latestRecording: {
            ...resultDetail().latestRecording!,
            status: "reviewing",
          },
          vendorReview: previousReview,
        }),
      ),
    ).toEqual({
      type: "new_version_review",
      applicationId: "app-result",
      recordingSubmissionId: "recording-v2",
      label: "新版本待 MCN 复核",
    });
    expect(
      toAdmissionResultTask(
        resultDetail({
          vendorReview: previousReview,
        }),
      ),
    ).toEqual({
      type: "start_next_round",
      applicationId: "app-result",
      recordingSubmissionId: "recording-v2",
      label: "可以发起下一轮",
    });
  });

  it("does not require final confirmation for an already joined streamer", () => {
    expect(
      toAdmissionResultTask(
        resultDetail({
          status: "joined",
          vendorReview: {
            ...resultDetail().vendorReview!,
            syncStatus: "skipped",
            syncError: "application_already_joined",
          },
        }),
      ),
    ).toBeNull();
  });

  it.each(["rejected", "needs_changes"] as const)(
    "does not create a %s follow-up task after a joined application is skipped",
    (decision) => {
      expect(
        toAdmissionResultTask(
          resultDetail({
            status: "joined",
            vendorReview: {
              ...resultDetail().vendorReview!,
              decision,
              syncStatus: "skipped",
              syncError: "application_already_joined",
            },
          }),
        ),
      ).toBeNull();
    },
  );
});
