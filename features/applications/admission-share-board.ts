import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";
import { verifyAdmissionShareCapability } from "@/lib/http/admission-share-capability";

import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "./application-state";
import type { VendorAdmissionDecision } from "./admission-board";

export type AdmissionShareBoardActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type ShareableApplication = {
  id: string;
  organizationId: string;
  projectId: string;
  streamerId: string;
  status: ApplicationStatus;
};

export type ShareableRecording = {
  id: string;
  applicationId: string;
  projectId: string;
  streamerId: string;
  version: number;
  status: RecordingReviewStatus;
};

export type AdmissionShareBoardRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  tokenHash: string;
  accessCodeHash: string | null;
  accessCodeSalt: string | null;
  accessCodeHashVersion: "scrypt_v1" | "sha256_salted_v1" | null;
  accessCodeHashParams: AccessCodeHashParams | null;
  accessCodeFailureCount: number;
  accessCodeFailureVersion: number;
  accessCodeLockedUntil: string | null;
  status: "active" | "expired" | "revoked";
  expiresAt: string;
  allowVendorSubmit: boolean;
  createdBy: string;
  createdAt?: string;
};

export type AdmissionShareBoardRepository = {
  listShareableApplications(
    projectId: string,
    applicationIds?: string[],
  ): Promise<ShareableApplication[]>;
  listLatestRecordings(applicationIds: string[]): Promise<ShareableRecording[]>;
  createShareBoard(
    input: Omit<
      AdmissionShareBoardRecord,
      | "id"
      | "status"
      | "createdAt"
      | "accessCodeFailureCount"
      | "accessCodeFailureVersion"
      | "accessCodeLockedUntil"
    >,
  ): Promise<AdmissionShareBoardRecord>;
  createShareItems(
    items: Array<{
      shareBoardId: string;
      organizationId: string;
      projectId: string;
      applicationId: string;
      recordingSubmissionId: string;
      recordingVersion: number;
      sortOrder: number;
    }>,
  ): Promise<void>;
  listShareBoards(projectId: string): Promise<AdmissionShareBoardRecord[]>;
  revokeShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    revokedBy: string;
    revokedAt: string;
  }): Promise<void>;
  getPublicShareBoardSnapshot(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBoardSnapshot | null>;
  getPublicShareBoardAccess(
    tokenHash: string,
  ): Promise<PublicAdmissionShareAccess | null>;
  upsertVendorReviews(
    rows: VendorReviewUpsertInput[],
  ): Promise<Array<{ id: string; recordingSubmissionId: string }>>;
  updateRecordingReviewForVendor(
    recordingSubmissionId: string,
    input: {
      status: RecordingReviewStatus;
      reviewNote: string;
      reviewedAt: string;
    },
  ): Promise<void>;
  updateApplicationStatusForVendor(
    applicationId: string,
    input: {
      status: ApplicationStatus;
      decisionReason: string;
      decidedAt: string;
    },
  ): Promise<void>;
  markShareBoardSubmitted(
    shareBoardId: string,
    submittedAt: string,
  ): Promise<void>;
  markShareBoardViewed(shareBoardId: string, viewedAt: string): Promise<void>;
  recordAccessCodeFailure(input: {
    shareBoardId: string;
    failedAt: string;
  }): Promise<{
    failureCount: number;
    failureVersion: number;
    lockedUntil: string | null;
  }>;
  resetAccessCodeFailures(input: {
    shareBoardId: string;
    observedFailureVersion: number;
  }): Promise<boolean>;
};

export type AccessCodeHashParams = {
  N: number;
  r: number;
  p: number;
  keyLength: number;
};

export type PublicAdmissionShareAccess = AdmissionShareBoardRecord;

export type PreparedPublicAdmissionShareAccess = {
  token: string;
  tokenHash: string;
  access: PublicAdmissionShareAccess;
};

export type CreateAdmissionShareBoardInput = {
  title?: string;
  expiresAt?: string;
  accessCode?: string;
  applicationIds?: string[];
  allowVendorSubmit?: boolean;
};

export type AdmissionShareBoardAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export type PublicAdmissionShareBoardSnapshot = AdmissionShareBoardRecord & {
  project: {
    id: string;
    code: string;
    name: string;
    vendor: string;
    product: string;
  };
  items: PublicAdmissionShareItemSnapshot[];
};

export type PublicAdmissionShareItemSnapshot = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  recordingSubmissionId: string;
  recordingVersion: number;
  recordingStatus: RecordingReviewStatus;
  recordingUrl: string | null;
  storagePath: string | null;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  vendorReview: {
    decision: VendorAdmissionDecision;
    remark: string;
    reviewerName: string;
    reviewerContact: string;
    submittedAt: string;
  } | null;
};

export type VendorReviewUpsertInput = {
  organizationId: string;
  projectId: string;
  shareBoardId: string;
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  decision: VendorAdmissionDecision;
  remark: string;
  vendorReviewerName: string;
  vendorReviewerContact: string;
  submittedAt: string;
  syncedApplicationStatus: ApplicationStatus | null;
  syncedRecordingStatus: RecordingReviewStatus | null;
  syncStatus: "synced" | "skipped" | "failed";
  syncError?: string | null;
};

export class SupabaseAdmissionShareBoardRepository implements AdmissionShareBoardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listShareableApplications(
    projectId: string,
    applicationIds?: string[],
  ): Promise<ShareableApplication[]> {
    let query = this.client
      .from("project_applications")
      .select("id, organization_id, project_id, streamer_id, status")
      .eq("project_id", projectId);

    if (applicationIds?.length) {
      query = query.in("id", applicationIds);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return ((data ?? []) as ShareableApplicationRow[]).map(
      toShareableApplication,
    );
  }

  async listLatestRecordings(
    applicationIds: string[],
  ): Promise<ShareableRecording[]> {
    if (applicationIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("recording_submissions")
      .select("id, application_id, project_id, streamer_id, version, status")
      .in("application_id", applicationIds)
      .order("version", { ascending: false });

    if (error) {
      throw error;
    }

    const latest = new Map<string, ShareableRecording>();
    for (const row of (data ?? []) as ShareableRecordingRow[]) {
      if (!latest.has(row.application_id)) {
        latest.set(row.application_id, toShareableRecording(row));
      }
    }
    return [...latest.values()];
  }

  async createShareBoard(
    input: Omit<
      AdmissionShareBoardRecord,
      | "id"
      | "status"
      | "createdAt"
      | "accessCodeFailureCount"
      | "accessCodeFailureVersion"
      | "accessCodeLockedUntil"
    >,
  ): Promise<AdmissionShareBoardRecord> {
    const { data, error } = await this.client
      .from("project_recording_share_boards")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        title: input.title,
        token_hash: input.tokenHash,
        access_code_hash: input.accessCodeHash,
        access_code_salt: input.accessCodeSalt,
        access_code_hash_version: input.accessCodeHashVersion,
        access_code_hash_params: input.accessCodeHashParams,
        expires_at: input.expiresAt,
        allow_vendor_submit: input.allowVendorSubmit,
        created_by: input.createdBy,
      })
      .select(
        "id, organization_id, project_id, title, token_hash, access_code_hash, access_code_salt, access_code_hash_version, access_code_hash_params, access_code_failure_count, access_code_failure_version, access_code_locked_until, status, expires_at, allow_vendor_submit, created_by, created_at",
      )
      .single<AdmissionShareBoardRow>();

    if (error) {
      throw error;
    }

    return toShareBoardRecord(data);
  }

  async createShareItems(
    items: Array<{
      shareBoardId: string;
      organizationId: string;
      projectId: string;
      applicationId: string;
      recordingSubmissionId: string;
      recordingVersion: number;
      sortOrder: number;
    }>,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const { error } = await this.client
      .from("project_recording_share_items")
      .insert(
        items.map((item) => ({
          share_board_id: item.shareBoardId,
          organization_id: item.organizationId,
          project_id: item.projectId,
          application_id: item.applicationId,
          recording_submission_id: item.recordingSubmissionId,
          recording_version: item.recordingVersion,
          sort_order: item.sortOrder,
        })),
      );

    if (error) {
      throw error;
    }
  }

  async listShareBoards(
    projectId: string,
  ): Promise<AdmissionShareBoardRecord[]> {
    const { data, error } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, organization_id, project_id, title, token_hash, access_code_hash, access_code_salt, access_code_hash_version, access_code_hash_params, access_code_failure_count, access_code_failure_version, access_code_locked_until, status, expires_at, allow_vendor_submit, created_by, created_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as AdmissionShareBoardRow[]).map(toShareBoardRecord);
  }

  async revokeShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    revokedBy: string;
    revokedAt: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("project_recording_share_boards")
      .update({
        status: "revoked",
        revoked_by: input.revokedBy,
        revoked_at: input.revokedAt,
      })
      .eq("id", input.shareBoardId)
      .eq("project_id", input.projectId);

    if (error) {
      throw error;
    }
  }

  async getPublicShareBoardSnapshot(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBoardSnapshot | null> {
    const { data: boardData, error: boardError } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, organization_id, project_id, title, token_hash, access_code_hash, access_code_salt, access_code_hash_version, access_code_hash_params, access_code_failure_count, access_code_failure_version, access_code_locked_until, status, expires_at, allow_vendor_submit, created_by, created_at, projects(id, code, name, vendor_name, product_name)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle<AdmissionShareBoardWithProjectRow>();

    if (boardError) {
      throw boardError;
    }
    if (!boardData) {
      return null;
    }

    const { data: itemData, error: itemError } = await this.client
      .from("project_recording_share_items")
      .select(
        "application_id, recording_submission_id, recording_version, project_applications(status, streamer_id, streamers(id, display_name, streamer_accounts(platform, account_handle, is_primary))), recording_submissions(status, external_url, storage_path)",
      )
      .eq("share_board_id", boardData.id)
      .order("sort_order", { ascending: true });

    if (itemError) {
      throw itemError;
    }

    const recordingIds = ((itemData ?? []) as PublicShareItemRow[]).map(
      (item) => item.recording_submission_id,
    );
    const vendorReviews = await this.listVendorReviewsForShare(
      boardData.id,
      recordingIds,
    );
    const vendorReviewByRecording = new Map(
      vendorReviews.map((review) => [review.recording_submission_id, review]),
    );

    return {
      ...toShareBoardRecord(boardData),
      project: toPublicProject(boardData),
      items: ((itemData ?? []) as PublicShareItemRow[]).map((item) =>
        toPublicShareItemSnapshot(item, vendorReviewByRecording),
      ),
    };
  }

  async getPublicShareBoardAccess(
    tokenHash: string,
  ): Promise<PublicAdmissionShareAccess | null> {
    const { data, error } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, organization_id, project_id, title, token_hash, access_code_hash, access_code_salt, access_code_hash_version, access_code_hash_params, access_code_failure_count, access_code_failure_version, access_code_locked_until, status, expires_at, allow_vendor_submit, created_by, created_at",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle<AdmissionShareBoardRow>();
    if (error) {
      throw error;
    }
    return data ? toShareBoardRecord(data) : null;
  }

  async upsertVendorReviews(
    rows: VendorReviewUpsertInput[],
  ): Promise<Array<{ id: string; recordingSubmissionId: string }>> {
    if (rows.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("project_recording_vendor_reviews")
      .upsert(
        rows.map((row) => ({
          organization_id: row.organizationId,
          project_id: row.projectId,
          share_board_id: row.shareBoardId,
          application_id: row.applicationId,
          recording_submission_id: row.recordingSubmissionId,
          recording_version: row.recordingVersion,
          decision: row.decision,
          remark: row.remark,
          vendor_reviewer_name: row.vendorReviewerName,
          vendor_reviewer_contact: row.vendorReviewerContact,
          submitted_at: row.submittedAt,
          synced_application_status: row.syncedApplicationStatus,
          synced_recording_status: row.syncedRecordingStatus,
          sync_status: row.syncStatus,
          sync_error: row.syncError ?? null,
        })),
        { onConflict: "share_board_id,recording_submission_id" },
      )
      .select("id, recording_submission_id");

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: String((row as { id: unknown }).id),
      recordingSubmissionId: String(
        (row as { recording_submission_id: unknown }).recording_submission_id,
      ),
    }));
  }

  async updateRecordingReviewForVendor(
    recordingSubmissionId: string,
    input: {
      status: RecordingReviewStatus;
      reviewNote: string;
      reviewedAt: string;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from("recording_submissions")
      .update({
        status: input.status,
        reviewed_at: input.reviewedAt,
        review_note: input.reviewNote,
      })
      .eq("id", recordingSubmissionId);

    if (error) {
      throw error;
    }
  }

  async updateApplicationStatusForVendor(
    applicationId: string,
    input: {
      status: ApplicationStatus;
      decisionReason: string;
      decidedAt: string;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from("project_applications")
      .update({
        status: input.status,
        decided_at: input.decidedAt,
        decision_reason: input.decisionReason,
      })
      .eq("id", applicationId);

    if (error) {
      throw error;
    }
  }

  async markShareBoardSubmitted(
    shareBoardId: string,
    submittedAt: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("project_recording_share_boards")
      .update({ last_submitted_at: submittedAt })
      .eq("id", shareBoardId);

    if (error) {
      throw error;
    }
  }

  async markShareBoardViewed(
    shareBoardId: string,
    viewedAt: string,
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "mark_admission_share_board_viewed",
      {
        p_share_board_id: shareBoardId,
        p_viewed_at: viewedAt,
      },
    );

    if (error) {
      throw error;
    }
  }

  async recordAccessCodeFailure(input: {
    shareBoardId: string;
    failedAt: string;
  }): Promise<{
    failureCount: number;
    failureVersion: number;
    lockedUntil: string | null;
  }> {
    const { data, error } = await this.client.rpc(
      "record_admission_share_access_code_failure",
      {
        p_share_board_id: input.shareBoardId,
        p_failed_at: input.failedAt,
      },
    );
    if (error) {
      throw error;
    }
    const row = first(data) as {
      failure_count?: unknown;
      failure_version?: unknown;
      locked_until?: unknown;
    } | null;
    if (
      !row ||
      typeof row.failure_count !== "number" ||
      typeof row.failure_version !== "number"
    ) {
      throw new Error("Access-code failure update returned an invalid result");
    }
    return {
      failureCount: row.failure_count,
      failureVersion: row.failure_version,
      lockedUntil:
        typeof row.locked_until === "string" ? row.locked_until : null,
    };
  }

  async resetAccessCodeFailures(input: {
    shareBoardId: string;
    observedFailureVersion: number;
  }): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      "reset_admission_share_access_code_failures",
      {
        p_share_board_id: input.shareBoardId,
        p_observed_failure_version: input.observedFailureVersion,
      },
    );
    if (error) {
      throw error;
    }
    return data === true;
  }

  private async listVendorReviewsForShare(
    shareBoardId: string,
    recordingIds: string[],
  ): Promise<PublicVendorReviewRow[]> {
    if (recordingIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("project_recording_vendor_reviews")
      .select(
        "recording_submission_id, decision, remark, vendor_reviewer_name, vendor_reviewer_contact, submitted_at",
      )
      .eq("share_board_id", shareBoardId)
      .in("recording_submission_id", recordingIds);

    if (error) {
      throw error;
    }

    return (data ?? []) as PublicVendorReviewRow[];
  }
}

type ShareableApplicationRow = {
  id: string;
  organization_id: string;
  project_id: string;
  streamer_id: string;
  status: ApplicationStatus;
};

type ShareableRecordingRow = {
  id: string;
  application_id: string;
  project_id: string;
  streamer_id: string;
  version: number;
  status: RecordingReviewStatus;
};

type AdmissionShareBoardRow = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  token_hash: string;
  access_code_hash: string | null;
  access_code_salt: string | null;
  access_code_hash_version: "scrypt_v1" | "sha256_salted_v1" | null;
  access_code_hash_params: AccessCodeHashParams | null;
  access_code_failure_count: number;
  access_code_failure_version: number;
  access_code_locked_until: string | null;
  status: "active" | "expired" | "revoked";
  expires_at: string;
  allow_vendor_submit: boolean;
  created_by: string;
  created_at?: string;
};

type AdmissionShareBoardWithProjectRow = AdmissionShareBoardRow & {
  projects:
    | {
        id: string;
        code: string | null;
        name: string | null;
        vendor_name: string | null;
        product_name: string | null;
      }
    | Array<{
        id: string;
        code: string | null;
        name: string | null;
        vendor_name: string | null;
        product_name: string | null;
      }>
    | null;
};

type PublicShareItemRow = {
  application_id: string;
  recording_submission_id: string;
  recording_version: number;
  project_applications:
    | {
        status: ApplicationStatus;
        streamer_id: string;
        streamers:
          | {
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
              }> | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
              }> | null;
            }>
          | null;
      }
    | Array<{
        status: ApplicationStatus;
        streamer_id: string;
        streamers:
          | {
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
              }> | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
              }> | null;
            }>
          | null;
      }>
    | null;
  recording_submissions:
    | {
        status: RecordingReviewStatus;
        external_url: string | null;
        storage_path: string | null;
      }
    | Array<{
        status: RecordingReviewStatus;
        external_url: string | null;
        storage_path: string | null;
      }>
    | null;
};

type PublicVendorReviewRow = {
  recording_submission_id: string;
  decision: VendorAdmissionDecision;
  remark: string | null;
  vendor_reviewer_name: string | null;
  vendor_reviewer_contact: string | null;
  submitted_at: string;
};

export async function createAdmissionShareBoard({
  repo,
  audit,
  actor,
  projectId,
  input,
  now = new Date().toISOString(),
  tokenFactory = createShareToken,
  accessCodeSaltFactory = createAccessCodeSalt,
}: {
  repo: AdmissionShareBoardRepository;
  audit?: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  input: CreateAdmissionShareBoardInput;
  now?: string;
  tokenFactory?: () => string;
  accessCodeSaltFactory?: () => string;
}) {
  const expiresAt = validateShareBoardExpiry(
    input.expiresAt ?? daysFrom(now, 7),
    now,
  );
  const applicationIds = input.applicationIds
    ?.map((id) => id.trim())
    .filter(Boolean);
  const applications = await repo.listShareableApplications(
    projectId,
    applicationIds?.length ? applicationIds : undefined,
  );
  if (applications.length === 0) {
    throw new Error("Share board requires at least one application");
  }
  if (
    applicationIds?.length &&
    applications.length !== new Set(applicationIds).size
  ) {
    throw new Error("All selected applications must exist");
  }
  if (applications.some((application) => application.projectId !== projectId)) {
    throw new Error("Applications must belong to the selected project");
  }

  const recordings = await repo.listLatestRecordings(
    applications.map((application) => application.id),
  );
  const recordingsByApplication = new Map(
    recordings.map((recording) => [recording.applicationId, recording]),
  );
  const isExplicitSelection = Boolean(applicationIds?.length);
  const applicationsWithRecordings = applications.filter((application) =>
    recordingsByApplication.has(application.id),
  );
  if (
    isExplicitSelection &&
    applicationsWithRecordings.length !== applications.length
  ) {
    throw new Error("Every shared application must have a recording");
  }
  const approvedApplications = applications.filter((application) =>
    isMcnApprovedShareCandidate(
      application,
      recordingsByApplication.get(application.id),
    ),
  );
  if (
    isExplicitSelection &&
    approvedApplications.length !== applications.length
  ) {
    throw new Error("Every shared recording must be approved by MCN");
  }
  const applicationsToShare = isExplicitSelection
    ? applications
    : approvedApplications;
  if (applicationsToShare.length === 0) {
    throw new Error("Share board requires at least one MCN-approved recording");
  }

  const token = tokenFactory();
  const accessCode = input.accessCode?.trim() || "";
  const accessCodeSalt = accessCode ? accessCodeSaltFactory() : null;
  const accessCodeHash =
    accessCode && accessCodeSalt
      ? await hashAccessCode(accessCode, accessCodeSalt)
      : null;
  const shareBoard = await repo.createShareBoard({
    organizationId: actor.organizationId,
    projectId,
    title: input.title?.trim() || "Admission recording review",
    tokenHash: hashShareSecret(token),
    accessCodeHash,
    accessCodeSalt,
    accessCodeHashVersion: accessCodeHash ? "scrypt_v1" : null,
    accessCodeHashParams: accessCodeHash
      ? DEFAULT_ACCESS_CODE_SCRYPT_PARAMS
      : null,
    expiresAt,
    allowVendorSubmit: input.allowVendorSubmit ?? true,
    createdBy: actor.userId,
  });

  const shareItems = applicationsToShare.map((application, index) => {
    const recording = recordingsByApplication.get(application.id);
    if (!recording) {
      throw new Error("Every shared application must have a recording");
    }
    return {
      shareBoardId: shareBoard.id,
      organizationId: actor.organizationId,
      projectId,
      applicationId: application.id,
      recordingSubmissionId: recording.id,
      recordingVersion: recording.version,
      sortOrder: index,
    };
  });
  await repo.createShareItems(shareItems);

  await audit?.({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create_share_board",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoard.id,
    objectName: shareBoard.title,
    projectId,
    after: {
      id: shareBoard.id,
      projectId,
      applicationCount: applications.length,
      expiresAt: shareBoard.expiresAt,
      allowVendorSubmit: shareBoard.allowVendorSubmit,
    },
    changedFields: ["share_board", "share_items"],
  });

  return { shareBoard, token };
}

export async function listAdmissionShareBoards({
  repo,
  projectId,
}: {
  repo: AdmissionShareBoardRepository;
  actor: AdmissionShareBoardActor;
  projectId: string;
}) {
  return repo.listShareBoards(projectId);
}

export async function revokeAdmissionShareBoard({
  repo,
  audit,
  actor,
  projectId,
  shareBoardId,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  audit?: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  now?: string;
}) {
  await repo.revokeShareBoard({
    shareBoardId,
    projectId,
    revokedBy: actor.userId,
    revokedAt: now,
  });
  await audit?.({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "revoke_share_board",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoardId,
    projectId,
    changedFields: ["status", "revoked_by", "revoked_at"],
  });
}

export async function getPublicAdmissionShareBoard({
  repo,
  token,
  capability,
  capabilitySecret,
  preparedAccess,
  now = new Date().toISOString(),
  onViewAuditError = observeViewAuditError,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  capability?: string;
  capabilitySecret?: string;
  preparedAccess?: PreparedPublicAdmissionShareAccess;
  now?: string;
  onViewAuditError?: (error: unknown) => void;
}) {
  const snapshot = await requirePublicSnapshot({
    repo,
    token,
    capability,
    capabilitySecret,
    preparedAccess,
    now,
  });
  await markShareBoardViewedBestEffort(
    repo,
    snapshot.id,
    now,
    onViewAuditError,
  );

  return toPublicShareDto(snapshot, { token });
}

export async function getPublicAdmissionRecordingPlaybackSource({
  repo,
  token,
  capability,
  capabilitySecret,
  preparedAccess,
  recordingSubmissionId,
  now = new Date().toISOString(),
  onViewAuditError = observeViewAuditError,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  capability?: string;
  capabilitySecret?: string;
  preparedAccess?: PreparedPublicAdmissionShareAccess;
  recordingSubmissionId: string;
  now?: string;
  onViewAuditError?: (error: unknown) => void;
}) {
  const snapshot = await requirePublicSnapshot({
    repo,
    token,
    capability,
    capabilitySecret,
    preparedAccess,
    now,
  });
  const item = snapshot.items.find(
    (entry) => entry.recordingSubmissionId === recordingSubmissionId,
  );
  if (!item) {
    throw new Error("Recording is not part of this share board");
  }
  await markShareBoardViewedBestEffort(
    repo,
    snapshot.id,
    now,
    onViewAuditError,
  );
  return {
    recordingUrl: item.recordingUrl,
    storagePath: item.storagePath,
  };
}

export type SubmitVendorAdmissionReviewsInput = {
  reviewerName?: string;
  reviewerContact?: string;
  projectRemark?: string;
  items: Array<{
    recordingSubmissionId: string;
    recordingVersion: number;
    decision: VendorAdmissionDecision;
    remark?: string;
    /** 可选理由标签（卡点 key）。厂家不选时由 LLM 归一化兜底。 */
    reasonCodes?: string[];
  }>;
};

/** 厂家带理由标签提交时的评估回写钩子（features/admission-review）。 */
export type VendorEvaluationRecorder = (input: {
  organizationId: string;
  applicationId: string;
  recordingSubmissionId: string;
  vendorReviewId: string;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
}) => Promise<void>;

export async function submitVendorAdmissionReviews({
  repo,
  token,
  capability,
  preparedAccess,
  input,
  now = new Date().toISOString(),
  recordEvaluation,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  capability?: string;
  preparedAccess?: PreparedPublicAdmissionShareAccess;
  input: SubmitVendorAdmissionReviewsInput;
  now?: string;
  recordEvaluation?: VendorEvaluationRecorder;
}) {
  const snapshot = await requirePublicSnapshot({
    repo,
    token,
    capability,
    preparedAccess,
    now,
  });
  if (!snapshot.allowVendorSubmit) {
    throw new Error("Share board does not allow vendor submissions");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Vendor review submission requires at least one item");
  }

  const itemsByRecording = new Map(
    snapshot.items.map((item) => [item.recordingSubmissionId, item]),
  );
  const reviewRows: VendorReviewUpsertInput[] = [];
  let syncedCount = 0;
  let skippedCount = 0;

  for (const item of input.items) {
    const snapshotItem = itemsByRecording.get(item.recordingSubmissionId);
    if (!snapshotItem) {
      throw new Error("Recording is not part of this share board");
    }
    if (snapshotItem.recordingVersion !== item.recordingVersion) {
      throw new Error("Recording version is stale");
    }
    assertVendorDecision(item.decision);

    const remark = item.remark?.trim() || "";
    if (
      (item.decision === "rejected" || item.decision === "needs_changes") &&
      !remark
    ) {
      throw new Error("Vendor rejection or change request requires a remark");
    }
    const syncPatch = mapVendorDecisionToSyncPatch(
      item.decision,
      snapshotItem.applicationStatus,
    );
    if (syncPatch.syncStatus === "synced") {
      syncedCount += 1;
      if (syncPatch.recordingStatus) {
        await repo.updateRecordingReviewForVendor(
          snapshotItem.recordingSubmissionId,
          {
            status: syncPatch.recordingStatus,
            reviewNote: remark,
            reviewedAt: now,
          },
        );
      }
      if (syncPatch.applicationStatus) {
        await repo.updateApplicationStatusForVendor(
          snapshotItem.applicationId,
          {
            status: syncPatch.applicationStatus,
            decisionReason: remark,
            decidedAt: now,
          },
        );
      }
    } else {
      skippedCount += 1;
    }

    reviewRows.push({
      organizationId: snapshot.organizationId,
      projectId: snapshot.projectId,
      shareBoardId: snapshot.id,
      applicationId: snapshotItem.applicationId,
      recordingSubmissionId: snapshotItem.recordingSubmissionId,
      recordingVersion: snapshotItem.recordingVersion,
      decision: item.decision,
      remark,
      vendorReviewerName: input.reviewerName?.trim() || "",
      vendorReviewerContact: input.reviewerContact?.trim() || "",
      submittedAt: now,
      syncedApplicationStatus: syncPatch.applicationStatus,
      syncedRecordingStatus: syncPatch.recordingStatus,
      syncStatus: syncPatch.syncStatus,
      syncError: null,
    });
  }

  const upserted = await repo.upsertVendorReviews(reviewRows);
  await repo.markShareBoardSubmitted(snapshot.id, now);

  // 厂家勾选了理由标签的项，直接落人工评估（无需 LLM 归一化）。
  // 评估失败不影响厂家提交结果——信号沉淀永不阻塞外部方操作。
  if (recordEvaluation) {
    const vendorReviewIdBySubmission = new Map(
      upserted.map((row) => [row.recordingSubmissionId, row.id]),
    );
    for (const item of input.items) {
      const reasonCodes = (item.reasonCodes ?? [])
        .map((code) => code.trim())
        .filter(Boolean);
      const vendorReviewId = vendorReviewIdBySubmission.get(
        item.recordingSubmissionId,
      );
      if (!reasonCodes.length || !vendorReviewId) {
        continue;
      }
      const snapshotItem = itemsByRecording.get(item.recordingSubmissionId);
      if (!snapshotItem) {
        continue;
      }
      try {
        await recordEvaluation({
          organizationId: snapshot.organizationId,
          applicationId: snapshotItem.applicationId,
          recordingSubmissionId: item.recordingSubmissionId,
          vendorReviewId,
          decision: item.decision,
          remark: item.remark?.trim() || "",
          reasonCodes,
        });
      } catch {
        // 忽略评估失败；归一化 runner 会兜底。
      }
    }
  }

  return {
    submittedCount: reviewRows.length,
    syncedCount,
    skippedCount,
  };
}

export function createShareToken() {
  return randomBytes(32).toString("base64url");
}

export function createAccessCodeSalt() {
  return randomBytes(16).toString("hex");
}

export function hashShareSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export const DEFAULT_ACCESS_CODE_SCRYPT_PARAMS: AccessCodeHashParams = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 32,
};

export async function hashAccessCode(
  value: string,
  salt: string,
  params: AccessCodeHashParams = DEFAULT_ACCESS_CODE_SCRYPT_PARAMS,
) {
  assertScryptParams(params);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      value,
      Buffer.from(salt, "hex"),
      params.keyLength,
      {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 64 * 1024 * 1024,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );
  });
  return derived.toString("hex");
}

function hashTransitionalSaltedAccessCode(value: string, salt: string) {
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(value)
    .digest("hex");
}

export async function verifyAccessCode(
  value: string,
  verifier: {
    hash: string;
    salt: string | null;
    version: AdmissionShareBoardRecord["accessCodeHashVersion"];
    params: AccessCodeHashParams | null;
  },
) {
  let actualHash: string;
  if (verifier.version === "scrypt_v1") {
    if (!verifier.salt || !verifier.params) {
      return false;
    }
    actualHash = await hashAccessCode(value, verifier.salt, verifier.params);
  } else if (
    verifier.version === "sha256_salted_v1" ||
    (!verifier.version && verifier.salt)
  ) {
    if (!verifier.salt) {
      return false;
    }
    actualHash = hashTransitionalSaltedAccessCode(value, verifier.salt);
  } else {
    actualHash = hashShareSecret(value);
  }
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(verifier.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function assertScryptParams(params: AccessCodeHashParams) {
  if (
    !Number.isInteger(params.N) ||
    params.N < 16384 ||
    params.N > 262144 ||
    !Number.isInteger(params.r) ||
    params.r < 1 ||
    params.r > 16 ||
    !Number.isInteger(params.p) ||
    params.p < 1 ||
    params.p > 4 ||
    !Number.isInteger(params.keyLength) ||
    params.keyLength < 32 ||
    params.keyLength > 64
  ) {
    throw new Error("Access-code hash parameters are invalid");
  }
}

export function mapVendorDecisionToSyncPatch(
  decision: VendorAdmissionDecision,
  applicationStatus: ApplicationStatus,
): {
  applicationStatus: ApplicationStatus | null;
  recordingStatus: RecordingReviewStatus | null;
  syncStatus: "synced" | "skipped";
} {
  if (applicationStatus === "joined") {
    return {
      applicationStatus: null,
      recordingStatus: null,
      syncStatus: "skipped",
    };
  }

  if (decision === "selected") {
    return {
      applicationStatus: "recording_approved",
      recordingStatus: "approved",
      syncStatus: "synced",
    };
  }
  if (decision === "rejected") {
    return {
      applicationStatus: "recording_rejected",
      recordingStatus: "rejected",
      syncStatus: "synced",
    };
  }
  if (decision === "needs_changes") {
    return {
      applicationStatus: "recording_required",
      recordingStatus: "needs_changes",
      syncStatus: "synced",
    };
  }
  if (decision === "backup") {
    return {
      applicationStatus: null,
      recordingStatus: null,
      syncStatus: "synced",
    };
  }

  return {
    applicationStatus: null,
    recordingStatus: null,
    syncStatus: "skipped",
  };
}

function isMcnApprovedShareCandidate(
  application: ShareableApplication,
  recording: ShareableRecording | undefined,
) {
  return (
    application.status === "recording_approved" &&
    recording?.status === "approved"
  );
}

function daysFrom(now: string, days: number) {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

function validateShareBoardExpiry(expiresAt: string, now: string) {
  const nowTime = Date.parse(now);
  const expiresTime = Date.parse(expiresAt);
  const maxExpiresTime = nowTime + 30 * 24 * 60 * 60 * 1000;
  if (
    !Number.isFinite(nowTime) ||
    !Number.isFinite(expiresTime) ||
    expiresTime <= nowTime ||
    expiresTime > maxExpiresTime
  ) {
    throw new Error(
      "Share board expiry must be after now and no more than 30 days away",
    );
  }
  return new Date(expiresTime).toISOString();
}

export async function preparePublicAdmissionShareAccess({
  repo,
  token,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  now: string;
}): Promise<PreparedPublicAdmissionShareAccess> {
  const tokenHash = hashShareSecret(token.trim());
  const access = await repo.getPublicShareBoardAccess(tokenHash);
  if (!access) {
    throw new Error("Share link is not available");
  }
  if (
    access.status !== "active" ||
    Date.parse(access.expiresAt) <= Date.parse(now)
  ) {
    throw new Error("Share link is not available");
  }
  return { token, tokenHash, access };
}

export async function verifyPublicAdmissionShareAccessCode({
  repo,
  access,
  accessCode,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  access: PublicAdmissionShareAccess;
  accessCode: string;
  now: string;
}) {
  if (!access.accessCodeHash) {
    return;
  }
  const valid = await verifyAccessCode(accessCode.trim(), {
    hash: access.accessCodeHash,
    salt: access.accessCodeSalt,
    version: access.accessCodeHashVersion,
    params: access.accessCodeHashParams,
  });
  if (valid) {
    await repo.resetAccessCodeFailures({
      shareBoardId: access.id,
      observedFailureVersion: access.accessCodeFailureVersion,
    });
    return;
  }
  if (
    access.accessCodeLockedUntil &&
    Date.parse(access.accessCodeLockedUntil) > Date.parse(now)
  ) {
    throw new Error("Access code is temporarily locked");
  }
  const failure = await repo.recordAccessCodeFailure({
    shareBoardId: access.id,
    failedAt: now,
  });
  if (
    failure.lockedUntil &&
    Date.parse(failure.lockedUntil) > Date.parse(now)
  ) {
    throw new Error("Access code is temporarily locked");
  }
  throw new Error("Access code is invalid");
}

async function requirePublicSnapshot({
  repo,
  token,
  capability,
  capabilitySecret,
  preparedAccess,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  capability?: string;
  capabilitySecret?: string;
  preparedAccess?: PreparedPublicAdmissionShareAccess;
  now: string;
}) {
  const prepared =
    preparedAccess ??
    (await preparePublicAdmissionShareAccess({ repo, token, now }));
  if (
    prepared.tokenHash !== hashShareSecret(token.trim()) ||
    prepared.access.tokenHash !== prepared.tokenHash
  ) {
    throw new Error("Share link is not available");
  }
  if (
    prepared.access.accessCodeHash &&
    !verifyAdmissionShareCapability({
      boardId: prepared.access.id,
      tokenHash: prepared.tokenHash,
      accessCodeHash: prepared.access.accessCodeHash,
      capability,
      now,
      secret: capabilitySecret,
    })
  ) {
    throw new Error("Access code is required");
  }
  const snapshot = await repo.getPublicShareBoardSnapshot(prepared.tokenHash);
  if (!snapshot || snapshot.id !== prepared.access.id) {
    throw new Error("Share link is not available");
  }
  if (
    snapshot.status !== "active" ||
    Date.parse(snapshot.expiresAt) <= Date.parse(now)
  ) {
    throw new Error("Share link is expired or revoked");
  }
  return snapshot;
}

function toPublicShareDto(
  snapshot: PublicAdmissionShareBoardSnapshot,
  input: { token: string },
) {
  return {
    id: snapshot.id,
    // 供服务端解析 rubric（理由标签）；路由返回前会剥离，不进公开 payload。
    organizationId: snapshot.organizationId,
    title: snapshot.title,
    status: snapshot.status,
    expiresAt: snapshot.expiresAt,
    allowVendorSubmit: snapshot.allowVendorSubmit,
    project: snapshot.project,
    items: snapshot.items.map((item) => ({
      applicationId: item.applicationId,
      applicationStatus: item.applicationStatus,
      recordingSubmissionId: item.recordingSubmissionId,
      recordingVersion: item.recordingVersion,
      recordingStatus: item.recordingStatus,
      recordingUrl: item.recordingUrl,
      playbackUrl:
        item.recordingUrl ??
        (item.storagePath
          ? publicAdmissionRecordingPlaybackUrl({
              token: input.token,
              recordingSubmissionId: item.recordingSubmissionId,
            })
          : null),
      hasPrivateStorage: Boolean(item.storagePath && !item.recordingUrl),
      streamer: item.streamer,
      vendorReview: item.vendorReview,
    })),
  };
}

function publicAdmissionRecordingPlaybackUrl(input: {
  token: string;
  recordingSubmissionId: string;
}) {
  return `/api/public/admission-share/${encodeURIComponent(
    input.token,
  )}/recordings/${encodeURIComponent(input.recordingSubmissionId)}`;
}

async function markShareBoardViewedBestEffort(
  repo: AdmissionShareBoardRepository,
  shareBoardId: string,
  viewedAt: string,
  onError: (error: unknown) => void,
) {
  try {
    await repo.markShareBoardViewed(shareBoardId, viewedAt);
  } catch (error) {
    onError(error);
  }
}

function observeViewAuditError(error: unknown) {
  console.error("Admission share view audit failed", error);
}

function assertVendorDecision(value: VendorAdmissionDecision) {
  if (
    value !== "pending" &&
    value !== "selected" &&
    value !== "backup" &&
    value !== "rejected" &&
    value !== "needs_changes"
  ) {
    throw new Error("Invalid vendor decision");
  }
}

function toShareableApplication(
  row: ShareableApplicationRow,
): ShareableApplication {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    status: row.status,
  };
}

function toShareableRecording(row: ShareableRecordingRow): ShareableRecording {
  return {
    id: row.id,
    applicationId: row.application_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    version: row.version,
    status: row.status,
  };
}

function toShareBoardRecord(
  row: AdmissionShareBoardRow,
): AdmissionShareBoardRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    tokenHash: row.token_hash,
    accessCodeHash: row.access_code_hash,
    accessCodeSalt: row.access_code_salt,
    accessCodeHashVersion: row.access_code_hash_version,
    accessCodeHashParams: row.access_code_hash_params,
    accessCodeFailureCount: row.access_code_failure_count,
    accessCodeFailureVersion: row.access_code_failure_version,
    accessCodeLockedUntil: row.access_code_locked_until,
    status: row.status,
    expiresAt: row.expires_at,
    allowVendorSubmit: row.allow_vendor_submit,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toPublicProject(row: AdmissionShareBoardWithProjectRow) {
  const project = first(row.projects);
  return {
    id: row.project_id,
    code: project?.code?.trim() || "",
    name: project?.name?.trim() || "",
    vendor: project?.vendor_name?.trim() || "",
    product: project?.product_name?.trim() || "",
  };
}

function toPublicShareItemSnapshot(
  row: PublicShareItemRow,
  vendorReviewByRecording: Map<string, PublicVendorReviewRow>,
): PublicAdmissionShareItemSnapshot {
  const application = first(row.project_applications);
  const recording = first(row.recording_submissions);
  const streamer = first(application?.streamers);
  const review = vendorReviewByRecording.get(row.recording_submission_id);
  return {
    applicationId: row.application_id,
    applicationStatus: application?.status ?? "recording_reviewing",
    recordingSubmissionId: row.recording_submission_id,
    recordingVersion: row.recording_version,
    recordingStatus: recording?.status ?? "submitted",
    recordingUrl: recording?.external_url?.trim() || null,
    storagePath: recording?.storage_path ?? null,
    streamer: {
      id: streamer?.id ?? application?.streamer_id ?? "",
      displayName: streamer?.display_name?.trim() || "",
      accountLabel: accountLabel(streamer?.streamer_accounts),
    },
    vendorReview: review
      ? {
          decision: review.decision,
          remark: review.remark?.trim() || "",
          reviewerName: review.vendor_reviewer_name?.trim() || "",
          reviewerContact: review.vendor_reviewer_contact?.trim() || "",
          submittedAt: review.submitted_at,
        }
      : null,
  };
}

function accountLabel(
  accounts:
    | Array<{
        platform: string | null;
        account_handle: string | null;
        is_primary: boolean | null;
      }>
    | null
    | undefined,
) {
  const account = accounts?.find((item) => item.is_primary) ?? accounts?.[0];
  return [account?.platform?.trim(), account?.account_handle?.trim()]
    .filter(Boolean)
    .join(" / ");
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
