import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordingAiAnalysisDto } from "@/features/recordings/recording-ai-analysis";

import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "./application-state";
import type { ApplicationSource } from "./application-service";
import { latestRecordingAiAnalysesByAsset } from "./application-queries";
import { listAdmissionShareBoardProgress } from "./admission-share-progress";

type MaybeArray<T> = T | T[] | null | undefined;

export type VendorAdmissionDecision =
  | "pending"
  | "selected"
  | "backup"
  | "rejected"
  | "needs_changes";

export type AdmissionApplicationProjectRow = {
  id?: string;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  vendor_name?: string | null;
  product_name?: string | null;
};

export type AdmissionApplicationStreamerAccountRow = {
  platform?: string | null;
  account_handle?: string | null;
  is_primary?: boolean | null;
};

export type AdmissionApplicationStreamerRow = {
  id?: string | null;
  display_name?: string | null;
  cooperation_status?: string | null;
  risk_level?: string | null;
  streamer_accounts?: MaybeArray<AdmissionApplicationStreamerAccountRow>;
};

export type AdmissionApplicationRow = {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submitted_at: string;
  decision_reason: string | null;
  project_id: string;
  streamer_id: string;
  projects?: MaybeArray<AdmissionApplicationProjectRow>;
  streamers?: MaybeArray<AdmissionApplicationStreamerRow>;
};

export type AdmissionRecordingRow = {
  id: string;
  application_id: string;
  asset_id?: string | null;
  version: number;
  status: RecordingReviewStatus;
  duration_seconds: number | null;
  external_url?: string | null;
  storage_path?: string | null;
  submitted_at?: string | null;
  created_at: string;
  aiAnalysis?: RecordingAiAnalysisDto | null;
};

export type AdmissionVendorReviewRow = {
  application_id: string;
  recording_submission_id: string;
  recording_version: number;
  decision: VendorAdmissionDecision;
  remark: string | null;
  vendor_reviewer_name?: string | null;
  vendor_reviewer_contact?: string | null;
  submitted_at: string;
  sync_status?: "synced" | "skipped" | "failed" | null;
  sync_error?: string | null;
};

export type AdmissionShareBoardRow = {
  id: string;
  project_id: string;
  mode: "preview" | "formal_review";
  status: "active" | "expired" | "revoked";
  review_state: "not_started" | "viewed" | "in_progress" | "submitted_locked";
  round_number: number;
  expires_at: string;
  last_viewed_at?: string | null;
  last_draft_at?: string | null;
  last_submitted_at?: string | null;
  locked_at?: string | null;
  item_count?: number;
  draft_completed_count?: number;
  created_at?: string;
};

export type AdmissionProjectBoard = {
  project: {
    id: string;
    code: string;
    name: string;
    status: string;
    vendor: string;
    product: string;
  };
  counts: {
    totalApplications: number;
    recordingCount: number;
    mcnPendingReview: number;
    mcnApproved: number;
    mcnRejected: number;
    needsChanges: number;
    vendorPending: number;
    vendorSelected: number;
    vendorBackup: number;
    vendorRejected: number;
    vendorNeedsChanges: number;
    pendingFinalConfirm: number;
  };
  share: {
    id: string | null;
    mode: "preview" | "formal_review" | null;
    status: "unshared" | "active" | "expired" | "revoked";
    reviewState:
      | "not_started"
      | "viewed"
      | "in_progress"
      | "submitted_locked"
      | null;
    roundNumber: number | null;
    expiresAt: string | null;
    lastViewedAt: string | null;
    lastDraftAt: string | null;
    lastSubmittedAt: string | null;
    lockedAt: string | null;
  };
  shareProgress: {
    completed: number;
    total: number;
  };
  lastActivityAt: string | null;
};

export type AdmissionRecordingDetail = {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submittedAt: string;
  decisionReason: string | null;
  project: AdmissionProjectBoard["project"];
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
    cooperationStatus: string;
    riskLevel: string;
  };
  latestRecording: {
    id: string;
    assetId: string | null;
    version: number;
    status: RecordingReviewStatus;
    durationSeconds: number | null;
    url: string | null;
    hasPrivateStorage: boolean;
    submittedAt: string;
    aiAnalysis: RecordingAiAnalysisDto | null;
  } | null;
  vendorReview: {
    recordingSubmissionId: string;
    recordingVersion: number;
    decision: VendorAdmissionDecision;
    remark: string;
    reviewerName: string;
    reviewerContact: string;
    submittedAt: string;
    syncStatus: "synced" | "skipped" | "failed";
    syncError: string | null;
  } | null;
};

export type AdmissionResultTask = {
  type:
    | "mcn_final_confirm"
    | "notify_streamer_changes"
    | "await_streamer_resubmission"
    | "new_version_review"
    | "start_next_round"
    | "historical_result_manual_review";
  applicationId: string;
  recordingSubmissionId: string | null;
  label: string;
};

const applicationSelect = `
  id,
  source,
  status,
  submitted_at,
  decision_reason,
  project_id,
  streamer_id,
  projects(id, code, name, status, vendor_name, product_name),
  streamers(
    id,
    display_name,
    cooperation_status,
    risk_level,
    streamer_accounts(platform, account_handle, is_primary)
  )
`;

export async function listAdmissionProjectBoards(
  supabase: SupabaseClient | null,
  organizationId: string,
): Promise<AdmissionProjectBoard[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select(applicationSelect)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const applications = (data ?? []) as unknown as AdmissionApplicationRow[];
  const applicationIds = applications.map((application) => application.id);
  const projectIds = unique(
    applications.map((application) => application.project_id),
  );
  const [recordings, vendorReviews, shareBoards] = await Promise.all([
    listRecordingRows(supabase, applicationIds),
    listVendorReviewRows(supabase, applicationIds),
    listShareBoardRows(supabase, projectIds, organizationId),
  ]);

  return toAdmissionProjectBoards(
    applications,
    recordings,
    vendorReviews,
    shareBoards,
  );
}

export async function listAdmissionProjectRecordings(
  supabase: SupabaseClient | null,
  projectId: string,
): Promise<AdmissionRecordingDetail[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_applications")
    .select(applicationSelect)
    .eq("project_id", projectId)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  const applications = (data ?? []) as unknown as AdmissionApplicationRow[];
  const applicationIds = applications.map((application) => application.id);
  const [recordings, vendorReviews] = await Promise.all([
    listRecordingRows(supabase, applicationIds),
    listVendorReviewRows(supabase, applicationIds),
  ]);
  await attachLatestRecordingAiAnalyses(supabase, recordings);

  return toAdmissionRecordingDetails(applications, recordings, vendorReviews);
}

export function toAdmissionProjectBoards(
  applications: AdmissionApplicationRow[],
  recordings: AdmissionRecordingRow[],
  vendorReviews: AdmissionVendorReviewRow[] = [],
  shareBoards: AdmissionShareBoardRow[] = [],
): AdmissionProjectBoard[] {
  const latestRecordings = latestRecordingsByApplication(recordings);
  const latestVendorReviews = latestVendorReviewsByApplication(vendorReviews);
  const sharesByProject = latestShareBoardByProject(shareBoards);
  const boards = new Map<string, AdmissionProjectBoard>();

  for (const application of applications) {
    const project = toProjectDto(application);
    const recording = latestRecordings.get(application.id) ?? null;
    const review = latestVendorReviews.get(application.id) ?? null;
    const board =
      boards.get(project.id) ??
      createProjectBoard(project, sharesByProject.get(project.id) ?? null);

    incrementProjectCounts(board, application.status, recording, review);
    board.lastActivityAt = maxIso(
      board.lastActivityAt,
      application.submitted_at,
      recording?.submitted_at ?? recording?.created_at ?? null,
      review?.submitted_at ?? null,
      board.share.lastSubmittedAt,
    );
    boards.set(project.id, board);
  }

  return [...boards.values()];
}

export function toAdmissionRecordingDetails(
  applications: AdmissionApplicationRow[],
  recordings: AdmissionRecordingRow[],
  vendorReviews: AdmissionVendorReviewRow[] = [],
): AdmissionRecordingDetail[] {
  const latestRecordings = latestRecordingsByApplication(recordings);
  const latestVendorReviews = latestVendorReviewsByApplication(vendorReviews);

  return applications.map((application) => {
    const recording = latestRecordings.get(application.id) ?? null;
    const review = latestVendorReviews.get(application.id) ?? null;
    return {
      id: application.id,
      source: application.source,
      status: application.status,
      submittedAt: application.submitted_at,
      decisionReason: application.decision_reason,
      project: toProjectDto(application),
      streamer: toStreamerDto(application),
      latestRecording: recording ? toRecordingDto(recording) : null,
      vendorReview: review ? toVendorReviewDto(review) : null,
    };
  });
}

export function toAdmissionResultTask(
  detail: AdmissionRecordingDetail,
): AdmissionResultTask | null {
  if (detail.status === "joined") {
    return null;
  }

  const recording = detail.latestRecording;
  const review = detail.vendorReview;
  if (!recording || !review) {
    return null;
  }

  const reviewTargetsCurrentVersion =
    review.recordingSubmissionId === recording.id &&
    review.recordingVersion === recording.version;
  if (review.syncStatus === "failed") {
    return resultTask(
      "historical_result_manual_review",
      detail.id,
      review.recordingSubmissionId,
      "结果同步失败，待人工处理",
    );
  }
  if (
    review.syncStatus === "skipped" &&
    review.syncError === "application_already_joined"
  ) {
    return null;
  }
  if (review.syncStatus === "skipped" && !reviewTargetsCurrentVersion) {
    return resultTask(
      "historical_result_manual_review",
      detail.id,
      review.recordingSubmissionId,
      "历史版本结果待人工确认",
    );
  }

  if (!reviewTargetsCurrentVersion) {
    if (recording.status === "submitted" || recording.status === "reviewing") {
      return resultTask(
        "new_version_review",
        detail.id,
        recording.id,
        "新版本待 MCN 复核",
      );
    }
    if (recording.status === "approved") {
      return resultTask(
        "start_next_round",
        detail.id,
        recording.id,
        "可以发起下一轮",
      );
    }
    return null;
  }

  if (review.decision === "selected") {
    return resultTask(
      "mcn_final_confirm",
      detail.id,
      recording.id,
      "待 MCN 最终确认",
    );
  }
  if (review.decision === "rejected") {
    return resultTask(
      "notify_streamer_changes",
      detail.id,
      recording.id,
      "需要通知主播修改",
    );
  }
  if (review.decision === "needs_changes") {
    return resultTask(
      "await_streamer_resubmission",
      detail.id,
      recording.id,
      "等待主播重新提交",
    );
  }
  return null;
}

export function toAdmissionRecordingExportRows(
  details: AdmissionRecordingDetail[],
): Array<Record<string, unknown>> {
  return details.map((detail) => ({
    projectCode: detail.project.code,
    projectName: detail.project.name,
    vendorProduct: [detail.project.vendor, detail.project.product]
      .filter(Boolean)
      .join(" / "),
    streamerName: detail.streamer.displayName,
    streamerAccount: detail.streamer.accountLabel,
    recordingUrl: detail.latestRecording?.url ?? "",
    recordingVersion: detail.latestRecording?.version ?? "",
    recordingSubmittedAt: detail.latestRecording?.submittedAt ?? "",
    mcnReviewStatus: detail.status,
    vendorDecision: detail.vendorReview?.decision ?? "pending",
    vendorRemark: detail.vendorReview?.remark ?? "",
  }));
}

async function listRecordingRows(
  supabase: SupabaseClient,
  applicationIds: string[],
): Promise<AdmissionRecordingRow[]> {
  if (applicationIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("recording_submissions")
    .select(
      "id, application_id, asset_id, version, status, duration_seconds, external_url, storage_path, submitted_at, created_at",
    )
    .in("application_id", applicationIds)
    .order("version", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as AdmissionRecordingRow[];
}

async function attachLatestRecordingAiAnalyses(
  supabase: SupabaseClient,
  recordings: AdmissionRecordingRow[],
) {
  const latestRecordings = [
    ...latestRecordingsByApplication(recordings).values(),
  ];
  const latestAnalyses = await latestRecordingAiAnalysesByAsset(
    supabase,
    latestRecordings
      .map((recording) => recording.asset_id)
      .filter((assetId): assetId is string => Boolean(assetId)),
  );
  for (const recording of latestRecordings) {
    recording.aiAnalysis = recording.asset_id
      ? (latestAnalyses.get(recording.asset_id) ?? null)
      : null;
  }
}

async function listVendorReviewRows(
  supabase: SupabaseClient,
  applicationIds: string[],
): Promise<AdmissionVendorReviewRow[]> {
  if (applicationIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_recording_vendor_reviews")
    .select(
      "application_id, recording_submission_id, recording_version, decision, remark, vendor_reviewer_name, vendor_reviewer_contact, submitted_at, sync_status, sync_error",
    )
    .in("application_id", applicationIds)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as AdmissionVendorReviewRow[];
}

async function listShareBoardRows(
  supabase: SupabaseClient,
  projectIds: string[],
  organizationId: string,
): Promise<AdmissionShareBoardRow[]> {
  if (projectIds.length === 0) {
    return [];
  }

  // 组织过滤走 (organization_id, project_id, status) 组合索引，RLS 仍
  // 作为第二道防线。
  const { data, error } = await supabase
    .from("project_recording_share_boards")
    .select(
      "id, project_id, mode, status, review_state, round_number, expires_at, last_viewed_at, last_draft_at, last_submitted_at, locked_at, created_at",
    )
    .eq("organization_id", organizationId)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const shareBoards = (data ?? []) as unknown as AdmissionShareBoardRow[];
  if (shareBoards.length === 0) {
    return [];
  }

  const progressByBoard = await listAdmissionShareBoardProgress(
    supabase,
    projectIds,
  );
  return shareBoards.map((shareBoard) => ({
    ...shareBoard,
    item_count: progressByBoard.get(shareBoard.id)?.itemCount ?? 0,
    draft_completed_count:
      progressByBoard.get(shareBoard.id)?.draftCompletedCount ?? 0,
  }));
}

function createProjectBoard(
  project: AdmissionProjectBoard["project"],
  share: AdmissionShareBoardRow | null,
): AdmissionProjectBoard {
  return {
    project,
    counts: {
      totalApplications: 0,
      recordingCount: 0,
      mcnPendingReview: 0,
      mcnApproved: 0,
      mcnRejected: 0,
      needsChanges: 0,
      vendorPending: 0,
      vendorSelected: 0,
      vendorBackup: 0,
      vendorRejected: 0,
      vendorNeedsChanges: 0,
      pendingFinalConfirm: 0,
    },
    share: {
      id: share?.id ?? null,
      mode: share?.mode ?? null,
      status: share?.status ?? "unshared",
      reviewState: share?.review_state ?? null,
      roundNumber: share?.round_number ?? null,
      expiresAt: share?.expires_at ?? null,
      lastViewedAt: share?.last_viewed_at ?? null,
      lastDraftAt: share?.last_draft_at ?? null,
      lastSubmittedAt: share?.last_submitted_at ?? null,
      lockedAt: share?.locked_at ?? null,
    },
    shareProgress: {
      completed: share?.draft_completed_count ?? 0,
      total: share?.item_count ?? 0,
    },
    lastActivityAt: share?.last_submitted_at ?? null,
  };
}

function incrementProjectCounts(
  board: AdmissionProjectBoard,
  status: ApplicationStatus,
  recording: AdmissionRecordingRow | null,
  review: AdmissionVendorReviewRow | null,
) {
  board.counts.totalApplications += 1;
  if (recording) {
    board.counts.recordingCount += 1;
  }
  if (
    status === "recording_reviewing" ||
    recording?.status === "submitted" ||
    recording?.status === "reviewing"
  ) {
    board.counts.mcnPendingReview += 1;
  }
  if (status === "recording_approved" || status === "joined") {
    board.counts.mcnApproved += 1;
  }
  if (status === "recording_rejected" || recording?.status === "rejected") {
    board.counts.mcnRejected += 1;
  }
  if (
    status === "recording_required" ||
    recording?.status === "needs_changes"
  ) {
    board.counts.needsChanges += 1;
  }
  if (status === "recording_approved") {
    board.counts.pendingFinalConfirm += 1;
  }

  const decision = review?.decision ?? "pending";
  if (decision === "pending") board.counts.vendorPending += 1;
  if (decision === "selected") board.counts.vendorSelected += 1;
  if (decision === "backup") board.counts.vendorBackup += 1;
  if (decision === "rejected") board.counts.vendorRejected += 1;
  if (decision === "needs_changes") board.counts.vendorNeedsChanges += 1;
}

function toProjectDto(
  application: AdmissionApplicationRow,
): AdmissionProjectBoard["project"] {
  const project = first(application.projects);
  return {
    id: application.project_id,
    code: project?.code?.trim() || "",
    name: project?.name?.trim() || "",
    status: project?.status?.trim() || "",
    vendor: project?.vendor_name?.trim() || "",
    product: project?.product_name?.trim() || "",
  };
}

function toStreamerDto(application: AdmissionApplicationRow) {
  const streamer = first(application.streamers);
  return {
    id: application.streamer_id,
    displayName: streamer?.display_name?.trim() || "",
    accountLabel: streamerAccountLabel(streamer),
    cooperationStatus: streamer?.cooperation_status?.trim() || "",
    riskLevel: streamer?.risk_level?.trim() || "",
  };
}

function toRecordingDto(recording: AdmissionRecordingRow) {
  return {
    id: recording.id,
    assetId: recording.asset_id ?? null,
    version: recording.version,
    status: recording.status,
    durationSeconds: recording.duration_seconds,
    url: recording.external_url?.trim() || null,
    hasPrivateStorage: Boolean(recording.storage_path?.trim()),
    submittedAt: recording.submitted_at ?? recording.created_at,
    aiAnalysis: recording.aiAnalysis ?? null,
  };
}

function toVendorReviewDto(review: AdmissionVendorReviewRow) {
  return {
    recordingSubmissionId: review.recording_submission_id,
    recordingVersion: review.recording_version,
    decision: review.decision,
    remark: review.remark?.trim() || "",
    reviewerName: review.vendor_reviewer_name?.trim() || "",
    reviewerContact: review.vendor_reviewer_contact?.trim() || "",
    submittedAt: review.submitted_at,
    syncStatus: review.sync_status ?? "synced",
    syncError: review.sync_error?.trim() || null,
  };
}

function latestRecordingsByApplication(recordings: AdmissionRecordingRow[]) {
  const latest = new Map<string, AdmissionRecordingRow>();
  for (const recording of recordings) {
    const current = latest.get(recording.application_id);
    if (!current || recording.version > current.version) {
      latest.set(recording.application_id, recording);
    }
  }
  return latest;
}

function latestVendorReviewsByApplication(reviews: AdmissionVendorReviewRow[]) {
  const latest = new Map<string, AdmissionVendorReviewRow>();
  for (const review of reviews) {
    const current = latest.get(review.application_id);
    if (!current || review.submitted_at > current.submitted_at) {
      latest.set(review.application_id, review);
    }
  }
  return latest;
}

function latestShareBoardByProject(shareBoards: AdmissionShareBoardRow[]) {
  const latest = new Map<string, AdmissionShareBoardRow>();
  for (const share of shareBoards) {
    const current = latest.get(share.project_id);
    if (!current || shareBoardSortKey(share) > shareBoardSortKey(current)) {
      latest.set(share.project_id, share);
    }
  }
  return latest;
}

function shareBoardSortKey(shareBoard: AdmissionShareBoardRow) {
  return (
    shareBoard.created_at ??
    shareBoard.last_submitted_at ??
    shareBoard.expires_at
  );
}

function streamerAccountLabel(
  streamer: AdmissionApplicationStreamerRow | null,
) {
  const accounts = arrayOf(streamer?.streamer_accounts);
  const account = accounts.find((item) => item.is_primary) ?? accounts[0];
  return [account?.platform?.trim(), account?.account_handle?.trim()]
    .filter(Boolean)
    .join(" / ");
}

function maxIso(...values: Array<string | null | undefined>) {
  const normalized = values.filter(Boolean) as string[];
  if (normalized.length === 0) {
    return null;
  }
  return normalized.sort().at(-1) ?? null;
}

function first<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function arrayOf<T>(value: MaybeArray<T>): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function resultTask(
  type: AdmissionResultTask["type"],
  applicationId: string,
  recordingSubmissionId: string | null,
  label: string,
): AdmissionResultTask {
  return {
    type,
    applicationId,
    recordingSubmissionId,
    label,
  };
}
