import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditLogInput } from "@/lib/audit/audit";
import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";
import { normalizePublishedBrand } from "@/features/organizations/organization-brand";

import type {
  ApplicationStatus,
  RecordingReviewStatus,
} from "./application-state";
import type { VendorAdmissionDecision } from "./admission-board";
import type { AdmissionShareCandidateRepository } from "./admission-share-candidates";
import { AdmissionShareProjectStatusError } from "./admission-share-policy";
import { listAdmissionShareBoardProgress } from "./admission-share-progress";
import {
  preflightAdmissionShareSelection,
  type AdmissionShareMode,
  type AdmissionShareSelectionInput,
} from "./admission-share-workflow";

type AdmissionSharePreflightResult = ReturnType<
  typeof preflightAdmissionShareSelection
>;

export type AdmissionShareBoardActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type AdmissionShareBoardRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  tokenHash: string;
  accessCodeHash: string | null;
  status: "active" | "expired" | "revoked";
  expiresAt: string;
  allowVendorSubmit: boolean;
  allowExternalFallback: boolean;
  reviewState: "not_started" | "viewed" | "in_progress" | "submitted_locked";
  roundNumber: number;
  brandSnapshot?: unknown;
  brandVersion?: number;
  contactCardId?: string | null;
  contactCardSnapshot?: unknown | null;
  createdBy: string;
  createdAt?: string;
};

export type AdmissionShareBoardTaskRecord = {
  id: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  status: AdmissionShareBoardRecord["status"];
  reviewState: AdmissionShareBoardRecord["reviewState"];
  roundNumber: number;
  expiresAt: string;
  itemCount: number;
  draftCompletedCount: number;
  lastViewedAt: string | null;
  lastDraftAt: string | null;
  lastSubmittedAt: string | null;
  lockedAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type AdmissionShareBoardTaskWithPresentation =
  AdmissionShareBoardTaskRecord & {
    presentation: InternalAdmissionSharePresentation;
  };

export type AdmissionShareBoardInternalHydration = {
  task: AdmissionShareBoardTaskRecord;
  snapshot: AdmissionSharePresentationSnapshot;
};

export type AdmissionShareBoardInternalPage = {
  tasks: AdmissionShareBoardTaskRecord[];
  nextCursor: string | null;
};

export type CreateAdmissionShareBoardPersistenceResult = {
  shareBoard: AdmissionShareBoardRecord;
  snapshot: AdmissionSharePresentationSnapshot;
};

export type CreateAdmissionShareBoardPersistenceInput = {
  organizationId: string;
  projectId: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  tokenHash: string;
  accessCodeHash: string | null;
  expiresAt: string;
  allowExternalFallback: boolean;
  contactCardId?: string | null;
  createdBy: string;
  items: AdmissionShareSelectionInput[];
};

export type AdmissionShareBoardRepository = {
  createShareBoardWithItems(
    input: CreateAdmissionShareBoardPersistenceInput,
  ): Promise<CreateAdmissionShareBoardPersistenceResult>;
  listShareBoards(projectId: string): Promise<AdmissionShareBoardTaskRecord[]>;
  extendShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    expiresAt: string;
    actorUserId: string;
  }): Promise<void>;
  reopenShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    reason: string;
    actorUserId: string;
  }): Promise<void>;
  rotateShareBoardToken(input: {
    shareBoardId: string;
    projectId: string;
    tokenHash: string;
    actorUserId: string;
  }): Promise<void>;
  revokeShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<void>;
  reportPlaybackIssue(input: {
    shareBoardId: string;
    recordingSubmissionId: string;
    sourceType: AdmissionSharePlaybackSource;
    errorCode: AdmissionSharePlaybackErrorCode;
    userAgentFamily: AdmissionShareBrowserFamily;
    reportedAt: string;
  }): Promise<{ issueId: string }>;
  listPlaybackIssues(input: {
    organizationId: string;
    projectId: string;
    status?: AdmissionSharePlaybackIssueStatus;
  }): Promise<AdmissionSharePlaybackIssueDto[]>;
  resolvePlaybackIssue(input: {
    organizationId: string;
    projectId: string;
    issueId: string;
    actorUserId: string;
    resolvedAt: string;
  }): Promise<{ resolvedNow: boolean }>;
  getPublicShareBoardSnapshot(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBoardSnapshot | null>;
  getPublicShareBrandLogoAccess?(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBrandLogoAccess | null>;
  listReviewDrafts(shareBoardId: string): Promise<AdmissionReviewDraftDto[]>;
  saveReviewDraft(
    input: SaveAdmissionReviewDraftPersistenceInput,
  ): Promise<AdmissionReviewDraftDto>;
  submitReview(
    input: SubmitAdmissionReviewPersistenceInput,
  ): Promise<SubmitAdmissionReviewResult>;
  listReviewSubmissions(
    projectId: string,
    shareBoardId: string,
  ): Promise<AdmissionReviewSubmissionDto[]>;
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
};

export type AdmissionShareBoardInternalReader = {
  listInternalShareBoardTasks(input: {
    projectId: string;
    beforeCreatedAt?: string;
    beforeId?: string;
    limit: number;
  }): Promise<AdmissionShareBoardInternalPage>;
  getInternalShareBoardHydration(input: {
    projectId: string;
    shareBoardId: string;
  }): Promise<AdmissionShareBoardInternalHydration>;
};

export type CreateAdmissionShareBoardInput = {
  title?: string;
  purpose?: string;
  mode: AdmissionShareMode;
  expiresAt?: string;
  requireAccessCode?: boolean;
  accessCode?: string;
  allowExternalFallback?: boolean;
  contactCardId?: string | null;
  items: AdmissionShareSelectionInput[];
};

export class AdmissionShareSelectionError extends Error {
  readonly name = "AdmissionShareSelectionError";

  constructor(public readonly items: AdmissionSharePreflightResult["items"]) {
    super("Admission share selection changed");
  }
}

export class AdmissionShareFormalRoundConflictError extends Error {
  readonly name = "AdmissionShareFormalRoundConflictError";

  constructor() {
    super("Admission share formal round already open");
  }
}

export class AdmissionShareContactCardError extends Error {
  readonly name = "AdmissionShareContactCardError";
  readonly code = "INVALID_ORGANIZATION_CONTACT_CARD";
  readonly statusCode = 400;

  constructor() {
    super("Selected organization contact card is unavailable");
  }
}

export class AdmissionShareCursorError extends Error {
  readonly name = "AdmissionShareCursorError";
  readonly code = "SHARE_CURSOR_INVALID";
  readonly statusCode = 400;

  constructor() {
    super("Admission share cursor is invalid");
  }
}

export class AdmissionShareItemLimitError extends Error {
  readonly name = "AdmissionShareItemLimitError";
  readonly code = "SHARE_BOARD_TOO_LARGE";
  readonly statusCode = 400;

  constructor() {
    super("Admission share boards support at most 5000 recordings");
  }
}

export class AdmissionShareLifecycleError extends Error {
  readonly name = "AdmissionShareLifecycleError";

  constructor(
    public readonly code:
      | "SHARE_EXPIRY_INVALID"
      | "SHARE_NOT_ACTIVE"
      | "SHARE_REOPEN_NOT_ALLOWED"
      | "SHARE_REOPEN_REASON_REQUIRED"
      | "SHARE_SUBMISSION_MISSING"
      | "SHARE_FORMAL_ROUND_CONFLICT"
      | "SHARE_TOKEN_INVALID"
      | "SHARE_FORBIDDEN"
      | "SHARE_NOT_FOUND",
    message: string,
    public readonly statusCode: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export class AdmissionSharePlaybackIssueError extends Error {
  readonly name = "AdmissionSharePlaybackIssueError";

  constructor(
    public readonly code:
      | "PLAYBACK_ISSUE_FORBIDDEN"
      | "PLAYBACK_ISSUE_NOT_FOUND"
      | "PLAYBACK_ISSUE_DATABASE_ERROR"
      | "PLAYBACK_ISSUE_INVALID_RESPONSE",
    message: string,
    public readonly statusCode: 403 | 404 | 500,
  ) {
    super(message);
  }
}

class AdmissionShareSelectionChangedPersistenceError extends Error {
  constructor(readonly originalError: unknown) {
    super("Admission share selection changed during persistence");
  }
}

export type AdmissionShareBoardAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export type AdmissionShareAccessStore = {
  consumeAttempt(input: {
    shareBoardId: string;
    clientFingerprint: string;
    succeeded: boolean | null;
    now: string;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  createSession(input: {
    shareBoardId: string;
    sessionToken: string;
    expiresAt: string;
  }): Promise<void>;
  hasValidSession(input: {
    shareBoardId: string;
    sessionToken: string;
    now: string;
  }): Promise<boolean>;
};

export class PublicAdmissionShareError extends Error {
  constructor(
    public readonly code:
      | "ACCESS_CODE_REQUIRED"
      | "ACCESS_CODE_INVALID"
      | "ACCESS_RATE_LIMITED"
      | "SHARE_NOT_AVAILABLE"
      | "SHARE_EXPIRED"
      | "SHARE_REVOKED"
      | "RECORDING_NOT_SHARED"
      | "RECORDING_SOURCE_UNAVAILABLE"
      | "REVIEW_VALIDATION_FAILED"
      | "REVIEW_INCOMPLETE"
      | "RECORDING_VERSION_STALE"
      | "DRAFT_CONFLICT"
      | "DRAFT_SAVE_FAILED"
      | "REVIEW_ALREADY_LOCKED"
      | "REVIEW_REOPEN_REQUIRED"
      | "SHARE_SERVICE_UNAVAILABLE",
    message: string,
    public readonly statusCode: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export type PublicAdmissionShareBoardSnapshot = AdmissionShareBoardRecord & {
  project: {
    id: string;
    code: string;
    name: string;
    vendor: string;
    product: string;
  };
  progress: PublicAdmissionShareProgress;
  latestSubmission: PublicAdmissionShareSubmissionSummary | null;
  items: PublicAdmissionShareItemSnapshot[];
};

export type PublicAdmissionShareBrandLogoAccess = Pick<
  AdmissionShareBoardRecord,
  | "id"
  | "organizationId"
  | "accessCodeHash"
  | "status"
  | "expiresAt"
  | "brandSnapshot"
>;

type AdmissionSharePresentationItemSnapshot = Omit<
  PublicAdmissionShareItemSnapshot,
  "storagePath"
> & {
  storagePath?: string | null;
  hasPrivateStorage?: boolean;
};

export type AdmissionSharePresentationSnapshot = Omit<
  PublicAdmissionShareBoardSnapshot,
  "tokenHash" | "accessCodeHash" | "items"
> & {
  tokenHash?: string;
  accessCodeHash?: string | null;
  items: AdmissionSharePresentationItemSnapshot[];
};

export type PublicAdmissionShareBrand = {
  version: number;
  logoText: string;
  logoUrl: string | null;
  brandName: string;
  brandTagline: string;
  primaryColor: string;
};

export type PublicAdmissionShareContactCard = {
  displayName: string;
  title: string;
  phone?: string;
  email?: string;
  wechat?: string;
};

export type AdmissionShareSourceHealth =
  | "original_ready"
  | "original_with_external_fallback"
  | "external_only"
  | "blocked";

export type PublicAdmissionShareProgress = {
  completed: number;
  total: number;
};

export type PublicAdmissionShareSubmissionSummary = {
  revision: number;
  submittedAt: string;
  summary: {
    selected: number;
    backup: number;
    rejected: number;
    needsChanges: number;
  };
};

export type PublicAdmissionShareFinalReview = {
  decision: Exclude<VendorAdmissionDecision, "pending">;
  remark: string;
  reasonCodes: string[];
  submittedAt: string;
};

export type PublicAdmissionShareItemSnapshot = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  recordingSubmissionId: string;
  recordingVersion: number;
  recordingStatus: RecordingReviewStatus;
  recordingUrl: string | null;
  storagePath: string | null;
  sourceHealth: AdmissionShareSourceHealth;
  streamer: {
    id: string;
    displayName: string;
    accountLabel: string;
  };
  finalReview: PublicAdmissionShareFinalReview | null;
};

export type PublicAdmissionShareBoard = {
  id: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  status: AdmissionShareBoardRecord["status"];
  reviewState: AdmissionShareBoardRecord["reviewState"];
  roundNumber: number;
  expiresAt: string;
  canSubmit: boolean;
  allowExternalFallback: boolean;
  project: PublicAdmissionShareBoardSnapshot["project"];
  progress: PublicAdmissionShareProgress;
  latestSubmission: PublicAdmissionShareSubmissionSummary | null;
  items: Array<{
    applicationId: string;
    recordingSubmissionId: string;
    recordingVersion: number;
    playbackUrl: string;
    externalUrl: string | null;
    sourceHealth: AdmissionShareSourceHealth;
    hasPrivateStorage: boolean;
    streamer: PublicAdmissionShareItemSnapshot["streamer"];
    finalReview: PublicAdmissionShareFinalReview | null;
  }>;
};

export type BrandedPublicAdmissionShareBoard = PublicAdmissionShareBoard & {
  brand: PublicAdmissionShareBrand;
  contactCard: PublicAdmissionShareContactCard | null;
};

export type AdmissionSharePresentation = Pick<
  PublicAdmissionShareBoard,
  | "title"
  | "purpose"
  | "mode"
  | "status"
  | "reviewState"
  | "roundNumber"
  | "expiresAt"
  | "project"
  | "progress"
  | "latestSubmission"
> & {
  brand: Omit<PublicAdmissionShareBrand, "logoUrl" | "version">;
  contactCard: PublicAdmissionShareContactCard | null;
  items: Array<
    Pick<
      PublicAdmissionShareBoard["items"][number],
      | "applicationId"
      | "recordingSubmissionId"
      | "recordingVersion"
      | "sourceHealth"
      | "streamer"
      | "finalReview"
    >
  >;
};

export type InternalAdmissionSharePresentation = AdmissionSharePresentation & {
  id: string;
  brandVersion: number;
  contactCardId: string | null;
  sourceDiagnostics: Array<{
    recordingSubmissionId: string;
    applicationStatus: ApplicationStatus;
    recordingStatus: RecordingReviewStatus;
    hasPrivateStorage: boolean;
    externalUrl: string | null;
  }>;
};

export type AdmissionSharePlaybackSource = "original" | "external" | "none";

export type AdmissionSharePlaybackErrorCode =
  | "MEDIA_LOAD_FAILED"
  | "MEDIA_DECODE_FAILED"
  | "EXTERNAL_LINK_FAILED"
  | "NO_PLAYABLE_SOURCE";

export type AdmissionShareBrowserFamily =
  | "Chrome"
  | "Edge"
  | "Firefox"
  | "Safari"
  | "Opera"
  | "Samsung Internet"
  | "Unknown";

export type AdmissionSharePlaybackIssueStatus = "open" | "resolved";

export type AdmissionSharePlaybackIssueDto = {
  id: string;
  shareBoardId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  streamerDisplayName: string;
  sourceType: AdmissionSharePlaybackSource;
  errorCode: string;
  status: AdmissionSharePlaybackIssueStatus;
  reportedAt: string;
  resolvedAt: string | null;
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

export type AdmissionReviewDraftDto = {
  recordingSubmissionId: string;
  recordingVersion: number;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
  revision: number;
  updatedAt: string;
};

export type SaveAdmissionReviewDraftInput = {
  expectedRevision: number;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
};

export type SaveAdmissionReviewDraftPersistenceInput =
  SaveAdmissionReviewDraftInput & {
    shareBoardId: string;
    recordingSubmissionId: string;
    savedAt: string;
  };

export type SubmitAdmissionReviewPersistenceInput = {
  shareBoardId: string;
  projectRemark: string;
  submittedAt: string;
};

export type AdmissionReviewSubmissionResultItem = {
  vendorReviewId: string;
  applicationId: string;
  recordingSubmissionId: string;
  recordingVersion: number;
  decision: Exclude<VendorAdmissionDecision, "pending">;
  remark: string;
  reasonCodes: string[];
  syncStatus: "synced" | "skipped";
  syncError: string | null;
};

export type SubmitAdmissionReviewResult = {
  submissionRevision: number;
  submittedCount: number;
  syncedCount: number;
  skippedCount: number;
  items: AdmissionReviewSubmissionResultItem[];
};

export type AdmissionReviewSubmissionDto = {
  id: string;
  revision: number;
  projectRemark: string;
  submittedAt: string;
  summary: {
    selected: number;
    backup: number;
    rejected: number;
    needsChanges: number;
  };
  items: Array<{
    applicationId: string;
    recordingSubmissionId: string;
    recordingVersion: number;
    decision: Exclude<VendorAdmissionDecision, "pending">;
    remark: string;
    reasonCodes: string[];
    syncStatus: "synced" | "skipped" | "failed";
    syncError: string | null;
  }>;
};

const INTERNAL_SHARE_DEFAULT_PAGE_SIZE = 20;
const INTERNAL_SHARE_MAX_PAGE_SIZE = 50;
const PUBLIC_SHARE_COLLECTION_PAGE_SIZE = 1000;
const ADMISSION_SHARE_MAX_ITEMS = 5000;

export class SupabaseAdmissionShareBoardRepository implements AdmissionShareBoardRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createShareBoardWithItems(
    input: CreateAdmissionShareBoardPersistenceInput,
  ): Promise<CreateAdmissionShareBoardPersistenceResult> {
    const { data, error } = await this.client
      .rpc("create_admission_share_board", {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_title: input.title,
        p_purpose: input.purpose,
        p_mode: input.mode,
        p_token_hash: input.tokenHash,
        p_access_code_hash: input.accessCodeHash,
        p_expires_at: input.expiresAt,
        p_allow_external_fallback: input.allowExternalFallback,
        p_created_by: input.createdBy,
        p_items: input.items.map((item) => ({
          application_id: item.applicationId,
          recording_submission_id: item.recordingSubmissionId,
          recording_version: item.recordingVersion,
          sort_order: item.sortOrder,
        })),
        p_contact_card_id: input.contactCardId ?? null,
      })
      .single<{ board: Record<string, unknown>; snapshot: unknown }>();

    if (error) {
      if (isAdmissionShareProjectStatusRpcError(error)) {
        throw new AdmissionShareProjectStatusError(
          "Project status changed before share creation",
          409,
        );
      }
      if (isAdmissionShareFormalRoundConflictRpcError(error)) {
        throw new AdmissionShareFormalRoundConflictError();
      }
      if (isAdmissionShareSelectionChangedRpcError(error)) {
        throw new AdmissionShareSelectionChangedPersistenceError(error);
      }
      if (isAdmissionShareContactCardRpcError(error)) {
        throw new AdmissionShareContactCardError();
      }
      if (isAdmissionShareItemLimitRpcError(error)) {
        throw new AdmissionShareItemLimitError();
      }
      throw error;
    }

    return {
      shareBoard: toCreatedShareBoardRecord(data.board, input),
      snapshot: data.snapshot as AdmissionSharePresentationSnapshot,
    };
  }

  async listShareBoards(
    projectId: string,
  ): Promise<AdmissionShareBoardTaskRecord[]> {
    const { data, error } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, title, purpose, mode, status, expires_at, review_state, round_number, last_viewed_at, last_draft_at, last_submitted_at, locked_at, created_by, created_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as AdmissionShareBoardTaskRow[];
    if (rows.length === 0) {
      return [];
    }

    const progressByBoard = await listAdmissionShareBoardProgress(this.client, [
      projectId,
    ]);
    return rows.map((row) => {
      const progress = progressByBoard.get(row.id) ?? {
        itemCount: 0,
        draftCompletedCount: 0,
      };
      return toShareBoardTaskRecord(row, progress);
    });
  }

  async listInternalShareBoardTasks(input: {
    projectId: string;
    beforeCreatedAt?: string;
    beforeId?: string;
    limit: number;
  }): Promise<AdmissionShareBoardInternalPage> {
    const limit = normalizeInternalSharePageSize(input.limit);
    const { data, error } = await this.client.rpc(
      "list_internal_admission_share_board_tasks",
      {
        p_project_id: input.projectId,
        p_before_created_at: input.beforeCreatedAt ?? null,
        p_before_id: input.beforeId ?? null,
        p_limit: limit,
      },
    );
    if (error) {
      if (isAdmissionShareCursorRpcError(error))
        throw new AdmissionShareCursorError();
      throw error;
    }

    const rows = (data ?? []) as Array<{ task: unknown }>;
    const hasNextPage = rows.length > limit;
    const tasks = rows
      .slice(0, limit)
      .map((row) => row.task as AdmissionShareBoardTaskRecord);
    const last = tasks.at(-1);
    return {
      tasks,
      nextCursor:
        hasNextPage && last
          ? encodeAdmissionShareCursor(last.createdAt, last.id)
          : null,
    };
  }

  async getInternalShareBoardHydration(input: {
    projectId: string;
    shareBoardId: string;
  }): Promise<AdmissionShareBoardInternalHydration> {
    const { data, error } = await this.client.rpc(
      "get_internal_admission_share_board_hydration",
      {
        p_project_id: input.projectId,
        p_share_board_id: input.shareBoardId,
      },
    );
    if (error) {
      if (isAdmissionShareItemLimitRpcError(error)) {
        throw new AdmissionShareItemLimitError();
      }
      throw mapAdmissionShareLifecycleRpcError(error);
    }

    const hydration = ((data ?? []) as Array<{ hydration?: unknown }>)[0]
      ?.hydration;
    if (!hydration) {
      throw new AdmissionShareLifecycleError(
        "SHARE_NOT_FOUND",
        "Share board was not found in this project",
        404,
      );
    }
    return hydration as AdmissionShareBoardInternalHydration;
  }

  async extendShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    expiresAt: string;
    actorUserId: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("extend_admission_share_board", {
      p_share_board_id: input.shareBoardId,
      p_project_id: input.projectId,
      p_expires_at: input.expiresAt,
      p_actor_user_id: input.actorUserId,
    });

    if (error) {
      throw mapAdmissionShareLifecycleRpcError(error);
    }
  }

  async reopenShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    reason: string;
    actorUserId: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("reopen_admission_share_board", {
      p_share_board_id: input.shareBoardId,
      p_project_id: input.projectId,
      p_reason: input.reason,
      p_actor_user_id: input.actorUserId,
    });

    if (error) {
      throw mapAdmissionShareLifecycleRpcError(error);
    }
  }

  async rotateShareBoardToken(input: {
    shareBoardId: string;
    projectId: string;
    tokenHash: string;
    actorUserId: string;
  }): Promise<void> {
    const { error } = await this.client.rpc(
      "rotate_admission_share_board_token",
      {
        p_share_board_id: input.shareBoardId,
        p_project_id: input.projectId,
        p_token_hash: input.tokenHash,
        p_actor_user_id: input.actorUserId,
      },
    );

    if (error) {
      throw mapAdmissionShareLifecycleRpcError(error);
    }
  }

  async revokeShareBoard(input: {
    shareBoardId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("revoke_admission_share_board", {
      p_share_board_id: input.shareBoardId,
      p_project_id: input.projectId,
      p_actor_user_id: input.actorUserId,
    });

    if (error) {
      throw mapAdmissionShareLifecycleRpcError(error);
    }
  }

  async reportPlaybackIssue(input: {
    shareBoardId: string;
    recordingSubmissionId: string;
    sourceType: AdmissionSharePlaybackSource;
    errorCode: AdmissionSharePlaybackErrorCode;
    userAgentFamily: AdmissionShareBrowserFamily;
    reportedAt: string;
  }): Promise<{ issueId: string }> {
    const { data, error } = await this.client
      .rpc("report_admission_share_playback_issue", {
        p_share_board_id: input.shareBoardId,
        p_recording_submission_id: input.recordingSubmissionId,
        p_source_type: input.sourceType,
        p_error_code: input.errorCode,
        p_user_agent_family: input.userAgentFamily,
        p_reported_at: input.reportedAt,
      })
      .single<{ id: string }>();

    if (error) {
      throw error;
    }

    return { issueId: data.id };
  }

  async listPlaybackIssues(input: {
    organizationId: string;
    projectId: string;
    status?: AdmissionSharePlaybackIssueStatus;
  }): Promise<AdmissionSharePlaybackIssueDto[]> {
    let query = this.client
      .from("project_recording_share_playback_issues")
      .select(
        "id, share_board_id, recording_submission_id, source_type, error_code, status, reported_at, resolved_at, recording_submissions!inner(version, streamers!inner(display_name))",
      )
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);

    if (input.status) {
      query = query.eq("status", input.status);
    }

    const { data, error } = await query.order("reported_at", {
      ascending: false,
    });
    if (error) {
      throw mapAdmissionSharePlaybackIssueDbError(error);
    }

    return ((data ?? []) as AdmissionSharePlaybackIssueRow[]).map(
      toAdmissionSharePlaybackIssueDto,
    );
  }

  async resolvePlaybackIssue(input: {
    organizationId: string;
    projectId: string;
    issueId: string;
    actorUserId: string;
    resolvedAt: string;
  }): Promise<{ resolvedNow: boolean }> {
    const { data, error } = await this.client
      .rpc("resolve_admission_share_playback_issue", {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_issue_id: input.issueId,
        p_actor_user_id: input.actorUserId,
        p_resolved_at: input.resolvedAt,
      })
      .single<{ resolved_now: boolean }>();

    if (error) {
      throw mapAdmissionSharePlaybackIssueDbError(error);
    }
    if (!data || typeof data.resolved_now !== "boolean") {
      throw new AdmissionSharePlaybackIssueError(
        "PLAYBACK_ISSUE_INVALID_RESPONSE",
        "Playback issue resolution response was invalid",
        500,
      );
    }

    return { resolvedNow: data.resolved_now };
  }

  async getPublicShareBoardSnapshot(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBoardSnapshot | null> {
    const { data: boardData, error: boardError } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, organization_id, project_id, title, purpose, mode, token_hash, access_code_hash, status, expires_at, allow_vendor_submit, allow_external_fallback, review_state, round_number, brand_snapshot, brand_version, contact_card_id, contact_card_snapshot, created_by, created_at, projects(id, code, name, vendor_name, product_name)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle<AdmissionShareBoardWithProjectRow>();

    if (boardError) {
      throw boardError;
    }
    if (!boardData) {
      return null;
    }

    const itemRows = await this.listPublicShareItemRows(boardData.id);
    const workflow =
      boardData.mode === "formal_review"
        ? await this.getPublicReviewWorkflow(boardData.id)
        : {
            completedDraftCount: 0,
            latestSubmission: null,
            finalReviewByRecording: new Map<
              string,
              PublicAdmissionShareFinalReview
            >(),
          };
    const completed =
      boardData.review_state === "submitted_locked" && workflow.latestSubmission
        ? itemRows.length
        : Math.min(workflow.completedDraftCount, itemRows.length);

    return {
      ...toShareBoardRecord(boardData),
      project: toPublicProject(boardData),
      progress: {
        completed,
        total: itemRows.length,
      },
      latestSubmission: workflow.latestSubmission,
      items: itemRows.map((item) =>
        toPublicShareItemSnapshot(item, workflow.finalReviewByRecording),
      ),
    };
  }

  async getPublicShareBrandLogoAccess(
    tokenHash: string,
  ): Promise<PublicAdmissionShareBrandLogoAccess | null> {
    const { data, error } = await this.client
      .from("project_recording_share_boards")
      .select(
        "id, organization_id, access_code_hash, status, expires_at, brand_snapshot",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle<PublicAdmissionShareBrandLogoAccessRow>();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    return {
      id: data.id,
      organizationId: data.organization_id,
      accessCodeHash: data.access_code_hash,
      status: data.status,
      expiresAt: data.expires_at,
      brandSnapshot: data.brand_snapshot,
    };
  }

  async listReviewDrafts(
    shareBoardId: string,
  ): Promise<AdmissionReviewDraftDto[]> {
    const rows = await this.listPublicReviewDraftRows(shareBoardId);
    return rows.map(toReviewDraftDto);
  }

  async saveReviewDraft(
    input: SaveAdmissionReviewDraftPersistenceInput,
  ): Promise<AdmissionReviewDraftDto> {
    const { data, error } = await this.client
      .rpc("save_admission_share_review_draft", {
        p_share_board_id: input.shareBoardId,
        p_recording_submission_id: input.recordingSubmissionId,
        p_expected_revision: input.expectedRevision,
        p_decision: input.decision,
        p_remark: input.remark,
        p_reason_codes: input.reasonCodes,
        p_saved_at: input.savedAt,
      })
      .single<AdmissionReviewDraftRow>();

    if (error) {
      throw error;
    }

    return toReviewDraftDto(data);
  }

  async submitReview(
    input: SubmitAdmissionReviewPersistenceInput,
  ): Promise<SubmitAdmissionReviewResult> {
    const { data, error } = await this.client.rpc(
      "submit_admission_share_review",
      {
        p_share_board_id: input.shareBoardId,
        p_project_remark: input.projectRemark,
        p_submitted_at: input.submittedAt,
      },
    );

    if (error) {
      throw mapAdmissionShareSubmitRpcError(error);
    }

    return toSubmitAdmissionReviewResult(data);
  }

  async listReviewSubmissions(
    projectId: string,
    shareBoardId: string,
  ): Promise<AdmissionReviewSubmissionDto[]> {
    const { data: submissionData, error: submissionError } = await this.client
      .from("project_recording_vendor_review_submissions")
      .select(
        "id, revision, project_remark, selected_count, backup_count, rejected_count, needs_changes_count, submitted_at",
      )
      .eq("project_id", projectId)
      .eq("share_board_id", shareBoardId)
      .order("revision", { ascending: false });

    if (submissionError) {
      throw submissionError;
    }

    const submissions = (submissionData ??
      []) as AdmissionReviewSubmissionRow[];
    if (submissions.length === 0) {
      return [];
    }

    const { data: itemData, error: itemError } = await this.client
      .from("project_recording_vendor_review_submission_items")
      .select(
        "submission_id, application_id, recording_submission_id, recording_version, decision, remark, reason_codes, sync_status, sync_error, created_at",
      )
      .eq("project_id", projectId)
      .eq("share_board_id", shareBoardId)
      .in(
        "submission_id",
        submissions.map((submission) => submission.id),
      )
      .order("created_at", { ascending: true });

    if (itemError) {
      throw itemError;
    }

    const itemsBySubmission = new Map<
      string,
      AdmissionReviewSubmissionItemRow[]
    >();
    for (const item of (itemData ?? []) as AdmissionReviewSubmissionItemRow[]) {
      const items = itemsBySubmission.get(item.submission_id) ?? [];
      items.push(item);
      itemsBySubmission.set(item.submission_id, items);
    }

    return submissions.map((submission) => ({
      id: submission.id,
      revision: submission.revision,
      projectRemark: submission.project_remark,
      submittedAt: submission.submitted_at,
      summary: {
        selected: submission.selected_count,
        backup: submission.backup_count,
        rejected: submission.rejected_count,
        needsChanges: submission.needs_changes_count,
      },
      items: (itemsBySubmission.get(submission.id) ?? []).map((item) => ({
        applicationId: item.application_id,
        recordingSubmissionId: item.recording_submission_id,
        recordingVersion: item.recording_version,
        decision: item.decision,
        remark: item.remark,
        reasonCodes: item.reason_codes,
        syncStatus: item.sync_status,
        syncError: item.sync_error,
      })),
    }));
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

  private async listPublicShareItemRows(
    shareBoardId: string,
  ): Promise<PublicShareItemRow[]> {
    return collectBoundedPublicRows(async (from, to) => {
      const { data, error } = await this.client
        .from("project_recording_share_items")
        .select(
          "id, sort_order, application_id, recording_submission_id, recording_version, source_health, project_applications(status, streamer_id, streamers(id, display_name, streamer_accounts(id, platform, account_handle, is_primary, created_at))), recording_submissions(status, external_url, storage_path)",
        )
        .eq("share_board_id", shareBoardId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as PublicShareItemRow[];
    });
  }

  private async listPublicReviewDraftRows(
    shareBoardId: string,
  ): Promise<AdmissionReviewDraftRow[]> {
    return collectBoundedPublicRows(async (from, to) => {
      const { data, error } = await this.client
        .from("project_recording_vendor_review_drafts")
        .select(
          "recording_submission_id, recording_version, decision, remark, reason_codes, revision, updated_at",
        )
        .eq("share_board_id", shareBoardId)
        .order("recording_submission_id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as AdmissionReviewDraftRow[];
    });
  }

  private async listPublicSubmissionReceiptRows(
    submissionId: string,
  ): Promise<PublicSubmissionReceiptItemRow[]> {
    return collectBoundedPublicRows(async (from, to) => {
      const { data, error } = await this.client
        .from("project_recording_vendor_review_submission_items")
        .select("id, recording_submission_id, decision, remark, reason_codes")
        .eq("submission_id", submissionId)
        .order("recording_submission_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as PublicSubmissionReceiptItemRow[];
    });
  }

  private async getPublicReviewWorkflow(shareBoardId: string): Promise<{
    completedDraftCount: number;
    latestSubmission: PublicAdmissionShareSubmissionSummary | null;
    finalReviewByRecording: Map<string, PublicAdmissionShareFinalReview>;
  }> {
    const [draftRows, submissionResult] = await Promise.all([
      this.listPublicReviewDraftRows(shareBoardId),
      this.client
        .from("project_recording_vendor_review_submissions")
        .select(
          "id, revision, project_remark, selected_count, backup_count, rejected_count, needs_changes_count, submitted_at",
        )
        .eq("share_board_id", shareBoardId)
        .order("revision", { ascending: false })
        .order("id", { ascending: false })
        .limit(1),
    ]);

    if (submissionResult.error) {
      throw submissionResult.error;
    }

    const completedDraftCount = draftRows.filter(
      isAdmissionReviewDraftComplete,
    ).length;
    const latestRow = (
      (submissionResult.data ?? []) as AdmissionReviewSubmissionRow[]
    )[0];
    if (!latestRow) {
      return {
        completedDraftCount,
        latestSubmission: null,
        finalReviewByRecording: new Map(),
      };
    }

    const itemRows = await this.listPublicSubmissionReceiptRows(latestRow.id);

    const finalReviewByRecording = new Map<
      string,
      PublicAdmissionShareFinalReview
    >(
      itemRows.map((item) => [
        item.recording_submission_id,
        {
          decision: item.decision,
          remark: trimPostgresBtrimSpaces(item.remark),
          reasonCodes: item.reason_codes,
          submittedAt: latestRow.submitted_at,
        },
      ]),
    );
    return {
      completedDraftCount,
      latestSubmission: {
        revision: latestRow.revision,
        submittedAt: latestRow.submitted_at,
        summary: {
          selected: latestRow.selected_count,
          backup: latestRow.backup_count,
          rejected: latestRow.rejected_count,
          needsChanges: latestRow.needs_changes_count,
        },
      },
      finalReviewByRecording,
    };
  }
}

type AdmissionShareBoardRow = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  token_hash: string;
  access_code_hash: string | null;
  status: "active" | "expired" | "revoked";
  expires_at: string;
  allow_vendor_submit: boolean;
  allow_external_fallback: boolean;
  review_state: "not_started" | "viewed" | "in_progress" | "submitted_locked";
  round_number: number;
  brand_snapshot: unknown;
  brand_version: number;
  contact_card_id: string | null;
  contact_card_snapshot: unknown | null;
  created_by: string;
  created_at?: string;
};

type AdmissionShareBoardTaskRow = {
  id: string;
  title: string;
  purpose: string;
  mode: AdmissionShareMode;
  status: AdmissionShareBoardRecord["status"];
  expires_at: string;
  review_state: AdmissionShareBoardRecord["reviewState"];
  round_number: number;
  last_viewed_at: string | null;
  last_draft_at: string | null;
  last_submitted_at: string | null;
  locked_at: string | null;
  created_by: string;
  created_at: string;
};

type AdmissionReviewDraftRow = {
  recording_submission_id: string;
  recording_version: number;
  decision: VendorAdmissionDecision;
  remark: string;
  reason_codes: string[];
  revision: number;
  updated_at: string;
};

type AdmissionReviewSubmissionRow = {
  id: string;
  revision: number;
  project_remark: string;
  selected_count: number;
  backup_count: number;
  rejected_count: number;
  needs_changes_count: number;
  submitted_at: string;
};

type AdmissionReviewSubmissionItemRow = {
  submission_id: string;
  application_id: string;
  recording_submission_id: string;
  recording_version: number;
  decision: Exclude<VendorAdmissionDecision, "pending">;
  remark: string;
  reason_codes: string[];
  sync_status: "synced" | "skipped" | "failed";
  sync_error: string | null;
  created_at: string;
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

type PublicAdmissionShareBrandLogoAccessRow = {
  id: string;
  organization_id: string;
  access_code_hash: string | null;
  status: AdmissionShareBoardRecord["status"];
  expires_at: string;
  brand_snapshot: unknown;
};

type PublicShareItemRow = {
  id: string;
  sort_order: number;
  application_id: string;
  recording_submission_id: string;
  recording_version: number;
  source_health: AdmissionShareSourceHealth;
  project_applications:
    | {
        status: ApplicationStatus;
        streamer_id: string;
        streamers:
          | {
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                id: string;
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
                created_at: string;
              }> | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                id: string;
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
                created_at: string;
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
                id: string;
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
                created_at: string;
              }> | null;
            }
          | Array<{
              id: string;
              display_name: string | null;
              streamer_accounts: Array<{
                id: string;
                platform: string | null;
                account_handle: string | null;
                is_primary: boolean | null;
                created_at: string;
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

type PublicSubmissionReceiptItemRow = {
  id: string;
  recording_submission_id: string;
  decision: Exclude<VendorAdmissionDecision, "pending">;
  remark: string | null;
  reason_codes: string[];
};

type AdmissionSharePlaybackIssueRow = {
  id: string;
  share_board_id: string;
  recording_submission_id: string;
  source_type: AdmissionSharePlaybackSource;
  error_code: string;
  status: AdmissionSharePlaybackIssueStatus;
  reported_at: string;
  resolved_at: string | null;
  recording_submissions:
    | {
        version: number;
        streamers:
          | { display_name: string | null }
          | Array<{ display_name: string | null }>
          | null;
      }
    | Array<{
        version: number;
        streamers:
          | { display_name: string | null }
          | Array<{ display_name: string | null }>
          | null;
      }>
    | null;
};

export async function createAdmissionShareBoard({
  repo,
  candidateRepo,
  audit,
  actor,
  projectId,
  input,
  now = new Date().toISOString(),
  tokenFactory = createShareToken,
  accessCodeFactory = createAdmissionShareAccessCode,
}: {
  repo: AdmissionShareBoardRepository;
  candidateRepo: AdmissionShareCandidateRepository;
  audit?: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  input: CreateAdmissionShareBoardInput;
  now?: string;
  tokenFactory?: () => string;
  accessCodeFactory?: () => string;
}) {
  if (input.mode !== "preview" && input.mode !== "formal_review") {
    throw new Error("Share mode must be preview or formal_review");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Share board requires at least one recording");
  }
  const contactCardId = normalizeAdmissionShareContactCardId(
    input.contactCardId,
  );

  const requireAccessCode =
    input.requireAccessCode ?? input.mode === "formal_review";
  const accessCode = requireAccessCode
    ? input.accessCode?.trim() || accessCodeFactory()
    : undefined;
  if (accessCode && (accessCode.length < 6 || accessCode.length > 64)) {
    throw new Error("Access code must be between 6 and 64 characters");
  }
  const expiresAt = input.expiresAt ?? daysFrom(now, 7);
  const nowMs = Date.parse(now);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Share expiry must be a valid date");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("Share expiry must be in the future");
  }
  if (expiresAtMs < nowMs + 24 * 60 * 60 * 1000) {
    throw new Error("Share expiry must be at least 1 day");
  }
  if (expiresAtMs > nowMs + 30 * 24 * 60 * 60 * 1000) {
    throw new Error("Share expiry cannot exceed 30 days");
  }

  const candidates = await candidateRepo.listCandidates({
    organizationId: actor.organizationId,
    projectId,
  });
  const preflight = preflightAdmissionShareSelection(candidates, input.items);
  const blockedItems = preflight.items.filter(
    (item) => item.status === "blocked",
  );
  if (blockedItems.length > 0) {
    throw new AdmissionShareSelectionError(blockedItems);
  }

  const token = tokenFactory();
  const tokenHash = hashShareSecret(token);
  let persisted: CreateAdmissionShareBoardPersistenceResult;
  try {
    persisted = await repo.createShareBoardWithItems({
      organizationId: actor.organizationId,
      projectId,
      title: input.title?.trim() || "Admission recording review",
      purpose: input.purpose?.trim() || "",
      mode: input.mode,
      tokenHash,
      accessCodeHash: accessCode
        ? hashAdmissionShareAccessCode(accessCode)
        : null,
      expiresAt,
      allowExternalFallback: input.allowExternalFallback ?? true,
      contactCardId,
      createdBy: actor.userId,
      items: preflight.items.map((item) => ({
        applicationId: item.applicationId,
        recordingSubmissionId: item.recordingSubmissionId,
        recordingVersion: item.recordingVersion,
        sortOrder: item.sortOrder,
      })),
    });
  } catch (error) {
    if (!(error instanceof AdmissionShareSelectionChangedPersistenceError)) {
      throw error;
    }

    const refreshedCandidates = await candidateRepo.listCandidates({
      organizationId: actor.organizationId,
      projectId,
    });
    const refreshedPreflight = preflightAdmissionShareSelection(
      refreshedCandidates,
      input.items,
    );
    const refreshedBlockedItems = refreshedPreflight.items.filter(
      (item) => item.status === "blocked",
    );
    if (refreshedBlockedItems.length > 0) {
      throw new AdmissionShareSelectionError(refreshedBlockedItems);
    }
    throw error.originalError;
  }

  const { shareBoard, snapshot } = persisted;
  const presentation = toInternalAdmissionSharePresentation(snapshot);

  if (audit) {
    try {
      await audit({
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
          itemCount: input.items.length,
          mode: shareBoard.mode,
          expiresAt: shareBoard.expiresAt,
          allowExternalFallback: shareBoard.allowExternalFallback,
          brandVersion: shareBoard.brandVersion,
          contactCardId: shareBoard.contactCardId,
        },
        changedFields: [
          "share_board",
          "share_items",
          "brand_snapshot",
          "contact_card_snapshot",
          "share_event",
        ],
      });
    } catch {
      // The atomic created event is the primary evidence. Losing the only
      // plaintext credentials after a committed RPC would make the share
      // permanently inaccessible, so supplemental audit failure is nonfatal.
    }
  }

  return { shareBoard, presentation, token, accessCode };
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

export async function listInternalAdmissionShareBoardTasks({
  repo,
  projectId,
  cursor,
  limit = INTERNAL_SHARE_DEFAULT_PAGE_SIZE,
}: {
  repo: AdmissionShareBoardRepository & AdmissionShareBoardInternalReader;
  actor: AdmissionShareBoardActor;
  projectId: string;
  cursor?: string;
  limit?: number;
}): Promise<{
  shareBoards: AdmissionShareBoardTaskRecord[];
  nextCursor: string | null;
}> {
  const decoded =
    cursor === undefined ? null : decodeAdmissionShareCursor(cursor);
  const page = await repo.listInternalShareBoardTasks({
    projectId,
    beforeCreatedAt: decoded?.createdAt,
    beforeId: decoded?.id,
    limit: normalizeInternalSharePageSize(limit),
  });
  return {
    shareBoards: page.tasks,
    nextCursor: page.nextCursor,
  };
}

export async function getInternalAdmissionShareBoardDetail({
  repo,
  projectId,
  shareBoardId,
}: {
  repo: AdmissionShareBoardRepository & AdmissionShareBoardInternalReader;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
}): Promise<AdmissionShareBoardTaskWithPresentation> {
  const { task, snapshot } = await repo.getInternalShareBoardHydration({
    projectId,
    shareBoardId,
  });
  return {
    ...task,
    presentation: toInternalAdmissionSharePresentation(snapshot),
  };
}

export async function extendAdmissionShareBoard({
  repo,
  audit,
  actor,
  projectId,
  shareBoardId,
  expiresAt,
}: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  expiresAt: string;
}): Promise<void> {
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new AdmissionShareLifecycleError(
      "SHARE_EXPIRY_INVALID",
      "Share expiry must be a valid date",
      400,
    );
  }

  await repo.extendShareBoard({
    shareBoardId,
    projectId,
    expiresAt,
    actorUserId: actor.userId,
  });
  await writeLifecycleAuditBestEffort(audit, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "extend_share_board",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoardId,
    projectId,
    after: { expiresAt },
    changedFields: ["expires_at", "share_event"],
  });
}

export async function reopenAdmissionShareBoard({
  repo,
  audit,
  actor,
  projectId,
  shareBoardId,
  reason,
}: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  reason: string;
}): Promise<void> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 2) {
    throw new AdmissionShareLifecycleError(
      "SHARE_REOPEN_REASON_REQUIRED",
      "Reopen reason must contain at least two characters",
      400,
    );
  }

  await repo.reopenShareBoard({
    shareBoardId,
    projectId,
    reason: normalizedReason,
    actorUserId: actor.userId,
  });
  await writeLifecycleAuditBestEffort(audit, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "reopen_share_board",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoardId,
    projectId,
    changedFields: [
      "review_state",
      "locked_at",
      "reopened_by",
      "reopened_at",
      "reopen_reason",
      "review_drafts",
      "share_event",
    ],
    reason: normalizedReason,
    isHighRisk: true,
  });
}

export async function rotateAdmissionShareBoardToken({
  repo,
  audit,
  actor,
  projectId,
  shareBoardId,
  tokenFactory = createShareToken,
}: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
  tokenFactory?: () => string;
}): Promise<{ token: string }> {
  const token = tokenFactory();
  await repo.rotateShareBoardToken({
    shareBoardId,
    projectId,
    tokenHash: hashShareSecret(token),
    actorUserId: actor.userId,
  });
  await writeLifecycleAuditBestEffort(audit, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "rotate_share_board_token",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoardId,
    projectId,
    changedFields: [
      "token_hash",
      "access_sessions",
      "access_attempts",
      "share_event",
    ],
    reason: "Manual admission share token rotation",
    isHighRisk: true,
  });

  return { token };
}

export async function revokeAdmissionShareBoard({
  repo,
  audit,
  actor,
  projectId,
  shareBoardId,
}: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  projectId: string;
  shareBoardId: string;
}): Promise<void> {
  await repo.revokeShareBoard({
    shareBoardId,
    projectId,
    actorUserId: actor.userId,
  });
  await writeLifecycleAuditBestEffort(audit, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "revoke_share_board",
    module: "admission",
    objectType: "project_recording_share_board",
    objectId: shareBoardId,
    projectId,
    changedFields: [
      "status",
      "token_hash",
      "revoked_by",
      "revoked_at",
      "access_sessions",
      "access_attempts",
      "share_event",
    ],
    reason: "Admission share board revoked",
    isHighRisk: true,
  });
}

type GetPublicAdmissionShareBoardInput = {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  accessCode?: string;
  sessionToken?: string;
  now?: string;
  onViewAuditError?: (error: unknown) => void;
};

type PreparedPublicAdmissionShareSession =
  | {
      sessionToken: string;
      expiresAt: string;
      created: true;
    }
  | {
      sessionToken: string;
      created: false;
    }
  | null;

export async function getPublicAdmissionShareBoardContext({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  now = new Date().toISOString(),
  onViewAuditError = observeViewAuditError,
}: GetPublicAdmissionShareBoardInput): Promise<{
  organizationId: string;
  board: BrandedPublicAdmissionShareBoard;
}> {
  const snapshot = await requirePublicSnapshot({
    repo,
    accessStore,
    token,
    accessCode,
    sessionToken,
    now,
  });
  await markShareBoardViewedBestEffort(
    repo,
    snapshot.id,
    now,
    onViewAuditError,
  );

  return publicAdmissionShareContext(snapshot, token);
}

export async function getPublicAdmissionShareBoard(
  input: GetPublicAdmissionShareBoardInput,
): Promise<BrandedPublicAdmissionShareBoard> {
  return (await getPublicAdmissionShareBoardContext(input)).board;
}

export async function getPublicAdmissionShareBoardContextWithSession({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  now = new Date().toISOString(),
  onViewAuditError = observeViewAuditError,
  sessionTokenFactory = createShareToken,
}: GetPublicAdmissionShareBoardInput & {
  accessStore: AdmissionShareAccessStore;
  sessionTokenFactory?: () => string;
}): Promise<{
  organizationId: string;
  allowVendorSubmit: boolean;
  board: BrandedPublicAdmissionShareBoard;
  session: PreparedPublicAdmissionShareSession;
}> {
  const snapshot = await requireAvailablePublicSnapshot({ repo, token, now });
  const session = await preparePublicAdmissionShareSession({
    snapshot,
    accessStore,
    sessionToken,
    now,
    sessionTokenFactory,
  });
  await requirePublicSnapshotAccess({
    snapshot,
    accessStore,
    accessCode,
    sessionToken: session?.sessionToken ?? sessionToken,
    now,
  });
  await markShareBoardViewedBestEffort(
    repo,
    snapshot.id,
    now,
    onViewAuditError,
  );

  return {
    ...publicAdmissionShareContext(snapshot, token),
    allowVendorSubmit: snapshot.allowVendorSubmit,
    session,
  };
}

export async function ensurePublicAdmissionShareSession({
  repo,
  accessStore,
  token,
  sessionToken,
  now = new Date().toISOString(),
  sessionTokenFactory = createShareToken,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  now?: string;
  sessionTokenFactory?: () => string;
}): Promise<PreparedPublicAdmissionShareSession> {
  const snapshot = await requireAvailablePublicSnapshot({ repo, token, now });
  return preparePublicAdmissionShareSession({
    snapshot,
    accessStore,
    sessionToken,
    now,
    sessionTokenFactory,
  });
}

async function preparePublicAdmissionShareSession({
  snapshot,
  accessStore,
  sessionToken,
  now,
  sessionTokenFactory,
}: {
  snapshot: PublicAdmissionShareBoardSnapshot;
  accessStore: AdmissionShareAccessStore;
  sessionToken?: string;
  now: string;
  sessionTokenFactory: () => string;
}): Promise<PreparedPublicAdmissionShareSession> {
  if (
    snapshot.mode !== "formal_review" ||
    !snapshot.allowVendorSubmit ||
    snapshot.accessCodeHash
  ) {
    return null;
  }

  if (
    sessionToken &&
    (await accessStore.hasValidSession({
      shareBoardId: snapshot.id,
      sessionToken,
      now,
    }))
  ) {
    return { sessionToken, created: false };
  }

  const newSessionToken = sessionTokenFactory();
  const expiresAt = earlierIsoDate(snapshot.expiresAt, daysFrom(now, 7));
  await accessStore.createSession({
    shareBoardId: snapshot.id,
    sessionToken: newSessionToken,
    expiresAt,
  });
  return {
    sessionToken: newSessionToken,
    expiresAt,
    created: true,
  };
}

export async function listPublicAdmissionReviewDrafts({
  repo,
  accessStore,
  token,
  sessionToken,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  now?: string;
}): Promise<AdmissionReviewDraftDto[]> {
  const snapshot = await requirePublicReviewDraftSnapshot({
    repo,
    accessStore,
    token,
    sessionToken,
    now,
  });
  if (snapshot.mode !== "formal_review" || !snapshot.allowVendorSubmit) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Share board does not allow review drafts",
      400,
    );
  }

  return repo.listReviewDrafts(snapshot.id);
}

export async function savePublicAdmissionReviewDraft({
  repo,
  accessStore,
  token,
  sessionToken,
  recordingSubmissionId,
  input,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  recordingSubmissionId: string;
  input: SaveAdmissionReviewDraftInput;
  now?: string;
}): Promise<AdmissionReviewDraftDto> {
  const snapshot = await requirePublicReviewDraftSnapshot({
    repo,
    accessStore,
    token,
    sessionToken,
    now,
  });
  if (
    snapshot.reviewState === "submitted_locked" ||
    !snapshot.allowVendorSubmit
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_ALREADY_LOCKED",
      "Review is already submitted and locked",
      409,
    );
  }
  if (snapshot.mode !== "formal_review") {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Share board does not allow review drafts",
      400,
    );
  }

  const recordingId = recordingSubmissionId.trim();
  if (
    !recordingId ||
    !snapshot.items.some((item) => item.recordingSubmissionId === recordingId)
  ) {
    throw new PublicAdmissionShareError(
      "RECORDING_NOT_SHARED",
      "Recording is not part of this share board",
      404,
    );
  }

  const normalizedInput = normalizeAdmissionReviewDraftInput(input);
  if (!Number.isFinite(Date.parse(now))) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft save time is invalid",
      400,
    );
  }

  try {
    return await repo.saveReviewDraft({
      shareBoardId: snapshot.id,
      recordingSubmissionId: recordingId,
      ...normalizedInput,
      savedAt: now,
    });
  } catch (error) {
    const message = admissionShareErrorMessage(error);
    if (message === "admission_share_draft_conflict") {
      throw new PublicAdmissionShareError(
        "DRAFT_CONFLICT",
        "Draft was updated by another review session",
        409,
      );
    }
    if (message === "admission_share_review_already_locked") {
      throw new PublicAdmissionShareError(
        "REVIEW_ALREADY_LOCKED",
        "Review is already submitted and locked",
        409,
      );
    }
    throw new PublicAdmissionShareError(
      "DRAFT_SAVE_FAILED",
      "Draft could not be saved",
      503,
    );
  }
}

export async function authenticatePublicAdmissionShareAccess({
  repo,
  accessStore,
  token,
  accessCode,
  clientFingerprint,
  now = new Date().toISOString(),
  sessionTokenFactory = createShareToken,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore: AdmissionShareAccessStore;
  token: string;
  accessCode: string;
  clientFingerprint: string;
  now?: string;
  sessionTokenFactory?: () => string;
}) {
  const snapshot = await requireAvailablePublicSnapshot({
    repo,
    token,
    now,
  });
  if (!snapshot.accessCodeHash) {
    throw new PublicAdmissionShareError(
      "ACCESS_CODE_INVALID",
      "This share link does not require an access code",
      400,
    );
  }

  const check = await accessStore.consumeAttempt({
    shareBoardId: snapshot.id,
    clientFingerprint,
    succeeded: null,
    now,
  });
  if (!check.allowed) {
    throw new PublicAdmissionShareError(
      "ACCESS_RATE_LIMITED",
      "Too many invalid access-code attempts",
      429,
      check.retryAfterSeconds,
    );
  }

  const succeeded = verifyAdmissionShareAccessCode(
    accessCode.trim(),
    snapshot.accessCodeHash,
  );
  const recorded = await accessStore.consumeAttempt({
    shareBoardId: snapshot.id,
    clientFingerprint,
    succeeded,
    now,
  });
  if (!recorded.allowed) {
    throw new PublicAdmissionShareError(
      "ACCESS_RATE_LIMITED",
      "Too many invalid access-code attempts",
      429,
      recorded.retryAfterSeconds,
    );
  }
  if (!succeeded) {
    throw new PublicAdmissionShareError(
      "ACCESS_CODE_INVALID",
      "Access code is invalid",
      401,
    );
  }

  const sessionToken = sessionTokenFactory();
  const expiresAt = earlierIsoDate(snapshot.expiresAt, daysFrom(now, 7));
  await accessStore.createSession({
    shareBoardId: snapshot.id,
    sessionToken,
    expiresAt,
  });
  return { sessionToken, expiresAt };
}

export async function getPublicAdmissionRecordingPlaybackSource({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  recordingSubmissionId,
  now = new Date().toISOString(),
  onViewAuditError = observeViewAuditError,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  accessCode?: string;
  sessionToken?: string;
  recordingSubmissionId: string;
  now?: string;
  onViewAuditError?: (error: unknown) => void;
}) {
  const snapshot = await requirePublicSnapshot({
    repo,
    accessStore,
    token,
    accessCode,
    sessionToken,
    now,
  });
  const item = snapshot.items.find(
    (entry) => entry.recordingSubmissionId === recordingSubmissionId,
  );
  if (!item) {
    throw new PublicAdmissionShareError(
      "RECORDING_NOT_SHARED",
      "Recording is not part of this share board",
      404,
    );
  }
  await markShareBoardViewedBestEffort(
    repo,
    snapshot.id,
    now,
    onViewAuditError,
  );
  return {
    allowExternalFallback: snapshot.allowExternalFallback,
    recordingUrl: item.recordingUrl,
    storagePath: item.storagePath,
  };
}

export async function getPublicAdmissionShareBrandLogoPath({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  accessCode?: string;
  sessionToken?: string;
  now?: string;
}): Promise<string | null> {
  const access = await requireAvailablePublicBrandLogoAccess({
    repo,
    token,
    now,
  });
  await requirePublicSnapshotAccess({
    snapshot: access,
    accessStore,
    accessCode,
    sessionToken,
    now,
  });
  return normalizedAdmissionShareBrand(access).logoStoragePath;
}

const admissionSharePlaybackIssueCodes =
  new Set<AdmissionSharePlaybackErrorCode>([
    "MEDIA_LOAD_FAILED",
    "MEDIA_DECODE_FAILED",
    "EXTERNAL_LINK_FAILED",
    "NO_PLAYABLE_SOURCE",
  ]);

const admissionSharePlaybackSources = new Set<AdmissionSharePlaybackSource>([
  "original",
  "external",
  "none",
]);

const admissionShareBrowserFamilies = new Set<AdmissionShareBrowserFamily>([
  "Chrome",
  "Edge",
  "Firefox",
  "Safari",
  "Opera",
  "Samsung Internet",
  "Unknown",
]);

export async function recordPublicAdmissionPlaybackIssue({
  repo,
  accessStore,
  token,
  sessionToken,
  recordingSubmissionId,
  sourceType,
  errorCode,
  userAgentFamily,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  recordingSubmissionId: string;
  sourceType: AdmissionSharePlaybackSource;
  errorCode: string;
  userAgentFamily: string;
  now?: string;
}): Promise<{ issueId: string }> {
  const snapshot = await requirePublicPlaybackIssueSnapshot({
    repo,
    accessStore,
    token,
    sessionToken,
    now,
  });
  const item = snapshot.items.find(
    (entry) => entry.recordingSubmissionId === recordingSubmissionId,
  );
  if (!item) {
    throw new PublicAdmissionShareError(
      "RECORDING_NOT_SHARED",
      "Recording is not part of this share board",
      404,
    );
  }
  if (
    !admissionSharePlaybackSources.has(sourceType) ||
    !admissionSharePlaybackIssueCodes.has(
      errorCode as AdmissionSharePlaybackErrorCode,
    ) ||
    !admissionShareBrowserFamilies.has(
      userAgentFamily as AdmissionShareBrowserFamily,
    )
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Invalid playback issue",
      400,
    );
  }

  return repo.reportPlaybackIssue({
    shareBoardId: snapshot.id,
    recordingSubmissionId,
    sourceType,
    errorCode: errorCode as AdmissionSharePlaybackErrorCode,
    userAgentFamily: userAgentFamily as AdmissionShareBrowserFamily,
    reportedAt: now,
  });
}

async function requirePublicPlaybackIssueSnapshot({
  repo,
  accessStore,
  token,
  sessionToken,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  now: string;
}) {
  const snapshot = await requireAvailablePublicSnapshot({ repo, token, now });
  if (snapshot.mode !== "formal_review" || !snapshot.allowVendorSubmit) {
    return requirePublicSnapshotAccess({
      snapshot,
      accessStore,
      sessionToken,
      now,
    });
  }
  if (
    sessionToken &&
    accessStore &&
    (await accessStore.hasValidSession({
      shareBoardId: snapshot.id,
      sessionToken,
      now,
    }))
  ) {
    return snapshot;
  }
  throw new PublicAdmissionShareError(
    "ACCESS_CODE_REQUIRED",
    "Access session is required",
    401,
  );
}

export async function listAdmissionSharePlaybackIssues({
  repo,
  actor,
  organizationId,
  projectId,
  status,
}: {
  repo: AdmissionShareBoardRepository;
  actor: AdmissionShareBoardActor;
  organizationId: string;
  projectId: string;
  status?: AdmissionSharePlaybackIssueStatus;
}): Promise<AdmissionSharePlaybackIssueDto[]> {
  assertAdmissionSharePlaybackIssueActor(actor, organizationId);
  return repo.listPlaybackIssues({ organizationId, projectId, status });
}

export async function resolveAdmissionSharePlaybackIssue({
  repo,
  audit,
  actor,
  organizationId,
  projectId,
  issueId,
  now = new Date().toISOString(),
}: {
  repo: AdmissionShareBoardRepository;
  audit: AdmissionShareBoardAuditWriter;
  actor: AdmissionShareBoardActor;
  organizationId: string;
  projectId: string;
  issueId: string;
  now?: string;
}): Promise<void> {
  assertAdmissionSharePlaybackIssueActor(actor, organizationId);
  const result = await repo.resolvePlaybackIssue({
    organizationId,
    projectId,
    issueId,
    actorUserId: actor.userId,
    resolvedAt: now,
  });
  if (!result.resolvedNow) {
    return;
  }
  await writeLifecycleAuditBestEffort(audit, {
    organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "resolve_share_playback_issue",
    module: "admission",
    objectType: "project_recording_share_playback_issue",
    objectId: issueId,
    projectId,
    after: { status: "resolved" },
    changedFields: ["status", "resolved_by", "resolved_at", "share_event"],
  });
}

function assertAdmissionSharePlaybackIssueActor(
  actor: AdmissionShareBoardActor,
  organizationId: string,
) {
  if (actor.organizationId !== organizationId || !isMcnStaff(actor.role)) {
    throw new AdmissionSharePlaybackIssueError(
      "PLAYBACK_ISSUE_FORBIDDEN",
      "Playback issue access is forbidden",
      403,
    );
  }
}

export type SubmitVendorAdmissionReviewsInput = {
  projectRemark?: string;
};

/**
 * 厂家带理由标签提交时的评估回写钩子（features/admission-review）。
 * 实现必须把 signal 传给底层 I/O，并在取消后 settle，避免提交回执遗留后台任务。
 */
export type VendorEvaluationRecorder = (input: {
  organizationId: string;
  applicationId: string;
  recordingSubmissionId: string;
  vendorReviewId: string;
  decision: VendorAdmissionDecision;
  remark: string;
  reasonCodes: string[];
  signal: AbortSignal;
}) => Promise<void>;

export async function submitVendorAdmissionReviews({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  input,
  now = new Date().toISOString(),
  recordEvaluation,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  accessCode?: string;
  sessionToken?: string;
  input: SubmitVendorAdmissionReviewsInput;
  now?: string;
  recordEvaluation?: VendorEvaluationRecorder;
}) {
  const snapshot = await requirePublicSnapshot({
    repo,
    accessStore,
    token,
    accessCode,
    sessionToken,
    now,
  });
  if (!snapshot.allowVendorSubmit) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Share board does not allow vendor submissions",
      400,
    );
  }

  let result: SubmitAdmissionReviewResult;
  try {
    result = await repo.submitReview({
      shareBoardId: snapshot.id,
      projectRemark: input.projectRemark?.trim() || "",
      submittedAt: now,
    });
  } catch (error) {
    throw mapAdmissionShareSubmitRpcError(error);
  }

  // 厂家勾选了理由标签的项，直接落人工评估（无需 LLM 归一化）。
  // 评估失败不影响厂家提交结果——信号沉淀永不阻塞外部方操作。
  if (recordEvaluation) {
    await recordVendorEvaluationsBestEffort(
      result.items
        .filter((item) => item.reasonCodes.length > 0)
        .map(
          (item) => (signal) =>
            recordEvaluation({
              organizationId: snapshot.organizationId,
              applicationId: item.applicationId,
              recordingSubmissionId: item.recordingSubmissionId,
              vendorReviewId: item.vendorReviewId,
              decision: item.decision,
              remark: item.remark,
              reasonCodes: item.reasonCodes,
              signal,
            }),
        ),
    );
  }

  return result;
}

const VENDOR_EVALUATION_CONCURRENCY = 4;
const VENDOR_EVALUATION_ITEM_TIMEOUT_MS = 1_000;
const VENDOR_EVALUATION_BATCH_TIMEOUT_MS = 1_500;

async function recordVendorEvaluationsBestEffort(
  evaluations: Array<(signal: AbortSignal) => Promise<void>>,
) {
  if (!evaluations.length) {
    return;
  }

  let nextIndex = 0;
  const deadline = Date.now() + VENDOR_EVALUATION_BATCH_TIMEOUT_MS;
  const workers = Array.from(
    {
      length: Math.min(VENDOR_EVALUATION_CONCURRENCY, evaluations.length),
    },
    async () => {
      while (nextIndex < evaluations.length) {
        const evaluation = evaluations[nextIndex];
        nextIndex += 1;
        const remainingMs = deadline - Date.now();
        if (!evaluation || remainingMs <= 0) {
          return;
        }
        await recordVendorEvaluationWithTimeout(
          evaluation,
          Math.min(VENDOR_EVALUATION_ITEM_TIMEOUT_MS, remainingMs),
        ).catch(() => {
          // 评估属于提交后的附加信号，失败或超时均由后续归一化补偿。
        });
      }
    },
  );

  await Promise.allSettled(workers);
}

async function recordVendorEvaluationWithTimeout(
  evaluation: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`Vendor admission evaluation timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);

  try {
    // The recorder contract is cancellation-aware. Await the actual worker
    // after abort so no detached PostgREST promise survives the HTTP receipt.
    await evaluation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function createShareToken() {
  return randomBytes(32).toString("base64url");
}

function createAdmissionShareAccessCode() {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export function hashShareSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashAdmissionShareAccessCode(value: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(value, salt, 32).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

export function verifyAdmissionShareAccessCode(
  value: string,
  storedHash: string,
) {
  const [scheme, salt, expectedHex] = storedHash.split("$");
  if (
    scheme === "scrypt" &&
    salt &&
    expectedHex &&
    /^[a-f0-9]+$/i.test(salt) &&
    /^[a-f0-9]{64}$/i.test(expectedHex)
  ) {
    const actual = scryptSync(value, salt, 32);
    const expected = Buffer.from(expectedHex, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const actual = Buffer.from(hashShareSecret(value), "hex");
    const expected = Buffer.from(storedHash, "hex");
    return timingSafeEqual(actual, expected);
  }

  return false;
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

function daysFrom(now: string, days: number) {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeAdmissionShareContactCardId(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AdmissionShareContactCardError();
  }
  return normalized;
}

function isAdmissionShareSelectionChangedRpcError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P0001" &&
    candidate.message === "admission_share_selection_changed"
  );
}

function isAdmissionShareContactCardRpcError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P0001" &&
    candidate.message === "invalid_organization_contact_card"
  );
}

function isAdmissionShareItemLimitRpcError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P0001" &&
    (candidate.message === "admission_share_item_limit_exceeded" ||
      candidate.message === "admission_share_hydration_item_limit_exceeded")
  );
}

function isAdmissionShareCursorRpcError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown };
  return (
    candidate.message === "admission_share_cursor_invalid" ||
    candidate.message === "admission_share_page_limit_invalid"
  );
}

function isAdmissionShareProjectStatusRpcError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P0001" &&
    candidate.message === "admission_share_project_status_blocked"
  );
}

function isAdmissionShareFormalRoundConflictRpcError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  if (
    candidate.code === "P0001" &&
    candidate.message === "admission_share_formal_round_already_open"
  ) {
    return true;
  }
  if (candidate.code !== "23505") {
    return false;
  }

  const indexName = "project_recording_share_boards_one_open_formal_idx";
  return [candidate.constraint, candidate.message].some(
    (value) => typeof value === "string" && value.includes(indexName),
  );
}

function mapAdmissionShareSubmitRpcError(error: unknown): unknown {
  if (error instanceof PublicAdmissionShareError) {
    return error;
  }

  const message = admissionShareErrorMessage(error);
  if (message === "admission_share_review_incomplete") {
    return new PublicAdmissionShareError(
      "REVIEW_INCOMPLETE",
      "Admission review is incomplete",
      400,
    );
  }
  if (message === "admission_share_review_already_locked") {
    return new PublicAdmissionShareError(
      "REVIEW_ALREADY_LOCKED",
      "Admission review is already locked",
      409,
    );
  }
  if (message === "admission_share_board_not_found") {
    return new PublicAdmissionShareError(
      "SHARE_NOT_AVAILABLE",
      "Share link is not available",
      404,
    );
  }
  if (message === "admission_share_board_not_active") {
    return new PublicAdmissionShareError(
      "SHARE_EXPIRED",
      "Share link is expired or revoked",
      410,
    );
  }
  if (message === "admission_share_selection_changed") {
    return new PublicAdmissionShareError(
      "RECORDING_VERSION_STALE",
      "Recording version is stale",
      409,
    );
  }
  if (message === "admission_share_submit_invalid") {
    return new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Vendor review submission is invalid",
      400,
    );
  }
  return error;
}

function mapAdmissionShareLifecycleRpcError(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const message =
    typeof candidate.message === "string" ? candidate.message : undefined;

  if (candidate.code === "42501" || message === "insufficient_privilege") {
    return new AdmissionShareLifecycleError(
      "SHARE_FORBIDDEN",
      "You do not have permission to manage this share board",
      403,
    );
  }
  if (candidate.code === "P0002") {
    return new AdmissionShareLifecycleError(
      "SHARE_NOT_FOUND",
      "Share board was not found in this project",
      404,
    );
  }

  const mapped = lifecycleErrorByRpcMessage[message ?? ""];
  return mapped
    ? new AdmissionShareLifecycleError(
        mapped.code,
        mapped.message,
        mapped.status,
      )
    : error;
}

function mapAdmissionSharePlaybackIssueDbError(
  error: unknown,
): AdmissionSharePlaybackIssueError {
  if (error instanceof AdmissionSharePlaybackIssueError) {
    return error;
  }
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const message =
    typeof candidate.message === "string" ? candidate.message : "";

  if (candidate.code === "42501" || message === "insufficient_privilege") {
    return new AdmissionSharePlaybackIssueError(
      "PLAYBACK_ISSUE_FORBIDDEN",
      "Playback issue access is forbidden",
      403,
    );
  }
  if (
    candidate.code === "P0002" ||
    message === "admission_share_playback_issue_not_found"
  ) {
    return new AdmissionSharePlaybackIssueError(
      "PLAYBACK_ISSUE_NOT_FOUND",
      "Playback issue was not found",
      404,
    );
  }
  return new AdmissionSharePlaybackIssueError(
    "PLAYBACK_ISSUE_DATABASE_ERROR",
    "Playback issue database request failed",
    500,
  );
}

const lifecycleErrorByRpcMessage: Record<
  string,
  {
    code: AdmissionShareLifecycleError["code"];
    message: string;
    status: AdmissionShareLifecycleError["statusCode"];
  }
> = {
  invalid_admission_share_expiry: {
    code: "SHARE_EXPIRY_INVALID",
    message: "Share expiry must be in the future and within 30 days",
    status: 400,
  },
  admission_share_board_not_active: {
    code: "SHARE_NOT_ACTIVE",
    message: "Share board is not active",
    status: 409,
  },
  admission_share_reopen_not_allowed: {
    code: "SHARE_REOPEN_NOT_ALLOWED",
    message: "Only a locked formal review can be reopened",
    status: 409,
  },
  admission_share_reopen_reason_required: {
    code: "SHARE_REOPEN_REASON_REQUIRED",
    message: "Reopen reason must contain at least two characters",
    status: 400,
  },
  admission_share_submission_missing: {
    code: "SHARE_SUBMISSION_MISSING",
    message: "The locked review has no submission to reopen",
    status: 409,
  },
  admission_share_formal_round_already_open: {
    code: "SHARE_FORMAL_ROUND_CONFLICT",
    message: "Another formal review round is already open",
    status: 409,
  },
  invalid_admission_share_token: {
    code: "SHARE_TOKEN_INVALID",
    message: "Replacement share token is invalid",
    status: 400,
  },
};

async function writeLifecycleAuditBestEffort(
  audit: AdmissionShareBoardAuditWriter,
  input: AuditLogInput,
) {
  try {
    await audit(input);
  } catch {
    // Every lifecycle RPC writes its event in the same database transaction.
    // Supplemental audit outages must not turn a committed mutation into a
    // retry or discard one-time plaintext credentials after token rotation.
  }
}

async function requirePublicSnapshot({
  repo,
  accessStore,
  token,
  accessCode,
  sessionToken,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  accessCode?: string;
  sessionToken?: string;
  now: string;
}) {
  const snapshot = await requireAvailablePublicSnapshot({ repo, token, now });
  return requirePublicSnapshotAccess({
    snapshot,
    accessStore,
    accessCode,
    sessionToken,
    now,
  });
}

async function requirePublicSnapshotAccess<
  T extends Pick<AdmissionShareBoardRecord, "id" | "accessCodeHash">,
>({
  snapshot,
  accessStore,
  accessCode,
  sessionToken,
  now,
}: {
  snapshot: T;
  accessStore?: AdmissionShareAccessStore;
  accessCode?: string;
  sessionToken?: string;
  now: string;
}) {
  if (!snapshot.accessCodeHash) {
    return snapshot;
  }

  const normalizedAccessCode = accessCode?.trim() || "";
  if (
    normalizedAccessCode &&
    verifyAdmissionShareAccessCode(
      normalizedAccessCode,
      snapshot.accessCodeHash,
    )
  ) {
    return snapshot;
  }

  if (
    sessionToken &&
    accessStore &&
    (await accessStore.hasValidSession({
      shareBoardId: snapshot.id,
      sessionToken,
      now,
    }))
  ) {
    return snapshot;
  }

  const accessCodeWasProvided = Boolean(normalizedAccessCode);
  throw new PublicAdmissionShareError(
    accessCodeWasProvided ? "ACCESS_CODE_INVALID" : "ACCESS_CODE_REQUIRED",
    accessCodeWasProvided
      ? "Access code is invalid"
      : "Access code is required",
    401,
  );
}

async function requireAvailablePublicBrandLogoAccess({
  repo,
  token,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  now: string;
}) {
  const tokenHash = hashShareSecret(token.trim());
  if (!repo.getPublicShareBrandLogoAccess) {
    throw new PublicAdmissionShareError(
      "SHARE_SERVICE_UNAVAILABLE",
      "Public share service is unavailable",
      503,
    );
  }
  const access = await repo.getPublicShareBrandLogoAccess(tokenHash);
  if (!access) {
    throw new PublicAdmissionShareError(
      "SHARE_NOT_AVAILABLE",
      "Share link is not available",
      404,
    );
  }
  if (access.status === "revoked") {
    throw new PublicAdmissionShareError(
      "SHARE_REVOKED",
      "Share link is revoked",
      410,
    );
  }
  if (access.status !== "active" || access.expiresAt <= now) {
    throw new PublicAdmissionShareError(
      "SHARE_EXPIRED",
      "Share link is expired",
      410,
    );
  }
  return access;
}

async function requirePublicReviewDraftSnapshot({
  repo,
  accessStore,
  token,
  sessionToken,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  accessStore?: AdmissionShareAccessStore;
  token: string;
  sessionToken?: string;
  now: string;
}) {
  const snapshot = await requireAvailablePublicSnapshot({ repo, token, now });
  if (snapshot.mode !== "formal_review" || !snapshot.allowVendorSubmit) {
    return snapshot;
  }
  if (
    sessionToken &&
    accessStore &&
    (await accessStore.hasValidSession({
      shareBoardId: snapshot.id,
      sessionToken,
      now,
    }))
  ) {
    return snapshot;
  }

  throw new PublicAdmissionShareError(
    "ACCESS_CODE_REQUIRED",
    "A valid access session is required to review drafts",
    401,
  );
}

async function requireAvailablePublicSnapshot({
  repo,
  token,
  now,
}: {
  repo: AdmissionShareBoardRepository;
  token: string;
  now: string;
}) {
  const tokenHash = hashShareSecret(token.trim());
  const snapshot = await repo.getPublicShareBoardSnapshot(tokenHash);
  if (!snapshot) {
    throw new PublicAdmissionShareError(
      "SHARE_NOT_AVAILABLE",
      "Share link is not available",
      404,
    );
  }
  if (snapshot.status === "revoked") {
    throw new PublicAdmissionShareError(
      "SHARE_REVOKED",
      "Share link is revoked",
      410,
    );
  }
  if (snapshot.status !== "active" || snapshot.expiresAt <= now) {
    throw new PublicAdmissionShareError(
      "SHARE_EXPIRED",
      "Share link is expired",
      410,
    );
  }
  return snapshot;
}

function earlierIsoDate(left: string, right: string) {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeSnapshotText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return Array.from(candidate || fallback.trim())
    .slice(0, maxLength)
    .join("");
}

function normalizeInternalSharePageSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AdmissionShareCursorError();
  }
  return Math.min(value, INTERNAL_SHARE_MAX_PAGE_SIZE);
}

function encodeAdmissionShareCursor(createdAt: string, id: string) {
  const canonicalCreatedAt = new Date(createdAt).toISOString();
  return Buffer.from(
    JSON.stringify({ createdAt: canonicalCreatedAt, id }),
    "utf8",
  ).toString("base64url");
}

function decodeAdmissionShareCursor(value: string): {
  createdAt: string;
  id: string;
} {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const parsedCreatedAt =
      typeof decoded.createdAt === "string"
        ? new Date(decoded.createdAt)
        : null;
    if (
      typeof decoded.createdAt !== "string" ||
      !parsedCreatedAt ||
      !Number.isFinite(parsedCreatedAt.getTime()) ||
      typeof decoded.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        decoded.id,
      )
    ) {
      throw new AdmissionShareCursorError();
    }
    const canonical = {
      createdAt: parsedCreatedAt.toISOString(),
      id: decoded.id.toLowerCase(),
    };
    if (
      encodeAdmissionShareCursor(canonical.createdAt, canonical.id) !== value
    ) {
      throw new AdmissionShareCursorError();
    }
    return canonical;
  } catch (error) {
    if (error instanceof AdmissionShareCursorError) {
      throw error;
    }
    throw new AdmissionShareCursorError();
  }
}

function optionalSnapshotText(
  value: unknown,
  maxLength: number,
): string | undefined {
  const candidate = safeSnapshotText(value, "", maxLength);
  return candidate || undefined;
}

function pickPublicContactCard(
  value: unknown,
): PublicAdmissionShareContactCard | null {
  const source = recordFromUnknown(value);
  const displayName = safeSnapshotText(source.displayName, "", 40);
  if (!displayName) {
    return null;
  }

  const phone = optionalSnapshotText(source.phone, 30);
  const email = optionalSnapshotText(source.email, 120);
  const wechat = optionalSnapshotText(source.wechat, 60);
  return {
    displayName,
    title: safeSnapshotText(source.title, "", 40),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(wechat ? { wechat } : {}),
  };
}

export function toAdmissionShareIdentityPresentation(
  snapshot: Pick<
    AdmissionShareBoardRecord,
    "organizationId" | "brandSnapshot" | "contactCardSnapshot"
  >,
): Pick<AdmissionSharePresentation, "brand" | "contactCard"> {
  const brand = normalizedAdmissionShareBrand(snapshot);

  return {
    brand: {
      logoText: brand.logoText,
      brandName: brand.brandName,
      brandTagline: brand.brandTagline,
      primaryColor: brand.primaryColor,
    },
    contactCard: pickPublicContactCard(snapshot.contactCardSnapshot),
  };
}

function normalizedAdmissionShareBrand(
  snapshot: Pick<AdmissionShareBoardRecord, "organizationId" | "brandSnapshot">,
) {
  const rawBrand = recordFromUnknown(snapshot.brandSnapshot);
  const schemaIsTrusted =
    rawBrand.schemaVersion === undefined || rawBrand.schemaVersion === 1;
  const organizationName = schemaIsTrusted
    ? safeSnapshotText(rawBrand.brandName, "组织", 40)
    : "组织";
  return normalizePublishedBrand(snapshot.brandSnapshot, {
    organizationId: snapshot.organizationId,
    organizationName,
  });
}

export function toAdmissionSharePresentation(
  snapshot: AdmissionSharePresentationSnapshot,
): AdmissionSharePresentation {
  return {
    title: snapshot.title,
    purpose: snapshot.purpose,
    mode: snapshot.mode,
    status: snapshot.status,
    reviewState: snapshot.reviewState,
    roundNumber: snapshot.roundNumber,
    expiresAt: snapshot.expiresAt,
    project: snapshot.project,
    progress: snapshot.progress,
    latestSubmission: snapshot.latestSubmission,
    ...toAdmissionShareIdentityPresentation(snapshot),
    items: snapshot.items.map((item) => ({
      applicationId: item.applicationId,
      recordingSubmissionId: item.recordingSubmissionId,
      recordingVersion: item.recordingVersion,
      sourceHealth: item.sourceHealth,
      streamer: item.streamer,
      finalReview: item.finalReview,
    })),
  };
}

export function toInternalAdmissionSharePresentation(
  snapshot: AdmissionSharePresentationSnapshot,
): InternalAdmissionSharePresentation {
  return {
    id: snapshot.id,
    ...toAdmissionSharePresentation(snapshot),
    brandVersion: snapshot.brandVersion ?? 0,
    contactCardId: snapshot.contactCardId ?? null,
    sourceDiagnostics: snapshot.items.map((item) => ({
      recordingSubmissionId: item.recordingSubmissionId,
      applicationStatus: item.applicationStatus,
      recordingStatus: item.recordingStatus,
      hasPrivateStorage: item.hasPrivateStorage ?? Boolean(item.storagePath),
      externalUrl: normalizeAbsoluteHttpUrl(item.recordingUrl),
    })),
  };
}

function publicAdmissionShareContext(
  snapshot: PublicAdmissionShareBoardSnapshot,
  token: string,
) {
  return {
    organizationId: snapshot.organizationId,
    board: toPublicShareDto(snapshot, { token }),
  };
}

function toPublicShareDto(
  snapshot: PublicAdmissionShareBoardSnapshot,
  input: { token: string },
): BrandedPublicAdmissionShareBoard {
  const presentation = toAdmissionSharePresentation(snapshot);
  const normalizedBrand = normalizedAdmissionShareBrand(snapshot);
  const hasLogo = Boolean(normalizedBrand.logoStoragePath);
  return {
    id: snapshot.id,
    ...presentation,
    brand: {
      ...presentation.brand,
      version: normalizedBrand.version,
      logoUrl: hasLogo ? publicAdmissionShareBrandLogoUrl(input.token) : null,
    },
    canSubmit:
      snapshot.mode === "formal_review" &&
      snapshot.status === "active" &&
      snapshot.reviewState !== "submitted_locked",
    allowExternalFallback: snapshot.allowExternalFallback,
    items: snapshot.items.map((item, index) => ({
      ...presentation.items[index],
      playbackUrl: publicAdmissionRecordingPlaybackUrl({
        token: input.token,
        recordingSubmissionId: item.recordingSubmissionId,
      }),
      externalUrl: snapshot.allowExternalFallback
        ? normalizeAbsoluteHttpUrl(item.recordingUrl)
        : null,
      hasPrivateStorage: Boolean(item.storagePath),
    })),
  };
}

function publicAdmissionShareBrandLogoUrl(token: string) {
  return `/api/public/admission-share/${encodeURIComponent(token)}/brand-logo`;
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
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Invalid vendor decision",
      400,
    );
  }
}

function normalizeAdmissionReviewDraftInput(
  input: SaveAdmissionReviewDraftInput,
): SaveAdmissionReviewDraftInput {
  if (
    !input ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= 2_147_483_647
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft revision is invalid",
      400,
    );
  }
  assertVendorDecision(input.decision);
  if (typeof input.remark !== "string" || input.remark.length > 2000) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft remark is invalid",
      400,
    );
  }
  if (
    !Array.isArray(input.reasonCodes) ||
    input.reasonCodes.length > 20 ||
    input.reasonCodes.some((reasonCode) => typeof reasonCode !== "string")
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft reason codes are invalid",
      400,
    );
  }

  const reasonCodes = Array.from(
    new Set(input.reasonCodes.map((reasonCode) => reasonCode.trim())),
  );
  if (
    reasonCodes.some(
      (reasonCode) =>
        !reasonCode ||
        reasonCode.length > 64 ||
        !/^[A-Za-z0-9_.:-]+$/.test(reasonCode),
    )
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft reason codes are invalid",
      400,
    );
  }

  return {
    expectedRevision: input.expectedRevision,
    decision: input.decision,
    remark: input.remark,
    reasonCodes,
  };
}

function admissionShareErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (!error || typeof error !== "object") {
    return "";
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function toShareBoardRecord(
  row: AdmissionShareBoardRow,
): AdmissionShareBoardRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    purpose: row.purpose,
    mode: row.mode,
    tokenHash: row.token_hash,
    accessCodeHash: row.access_code_hash,
    status: row.status,
    expiresAt: row.expires_at,
    allowVendorSubmit: row.allow_vendor_submit,
    allowExternalFallback: row.allow_external_fallback,
    reviewState: row.review_state,
    roundNumber: row.round_number,
    brandSnapshot: row.brand_snapshot,
    brandVersion: row.brand_version,
    contactCardId: row.contact_card_id,
    contactCardSnapshot: row.contact_card_snapshot,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toCreatedShareBoardRecord(
  value: Record<string, unknown>,
  input: CreateAdmissionShareBoardPersistenceInput,
): AdmissionShareBoardRecord {
  return {
    id: String(value.id ?? ""),
    organizationId: String(value.organizationId ?? input.organizationId),
    projectId: String(value.projectId ?? input.projectId),
    title: String(value.title ?? input.title),
    purpose: String(value.purpose ?? input.purpose),
    mode: (value.mode ?? input.mode) as AdmissionShareMode,
    tokenHash: input.tokenHash,
    accessCodeHash: input.accessCodeHash,
    status: (value.status ?? "active") as AdmissionShareBoardRecord["status"],
    expiresAt: String(value.expiresAt ?? input.expiresAt),
    allowVendorSubmit: Boolean(
      value.allowVendorSubmit ?? input.mode === "formal_review",
    ),
    allowExternalFallback: Boolean(
      value.allowExternalFallback ?? input.allowExternalFallback,
    ),
    reviewState: (value.reviewState ??
      "not_started") as AdmissionShareBoardRecord["reviewState"],
    roundNumber: Number(value.roundNumber ?? 0),
    brandSnapshot: value.brandSnapshot,
    brandVersion: Number(value.brandVersion ?? 0),
    contactCardId:
      typeof value.contactCardId === "string" ? value.contactCardId : null,
    contactCardSnapshot: value.contactCardSnapshot ?? null,
    createdBy: String(value.createdBy ?? input.createdBy),
    createdAt:
      typeof value.createdAt === "string" ? value.createdAt : undefined,
  };
}

function toShareBoardTaskRecord(
  row: AdmissionShareBoardTaskRow,
  progress: Pick<
    AdmissionShareBoardTaskRecord,
    "itemCount" | "draftCompletedCount"
  >,
): AdmissionShareBoardTaskRecord {
  return {
    id: row.id,
    title: row.title,
    purpose: row.purpose,
    mode: row.mode,
    status: row.status,
    reviewState: row.review_state,
    roundNumber: row.round_number,
    expiresAt: row.expires_at,
    ...progress,
    lastViewedAt: row.last_viewed_at,
    lastDraftAt: row.last_draft_at,
    lastSubmittedAt: row.last_submitted_at,
    lockedAt: row.locked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toReviewDraftDto(
  row: AdmissionReviewDraftRow,
): AdmissionReviewDraftDto {
  return {
    recordingSubmissionId: row.recording_submission_id,
    recordingVersion: row.recording_version,
    decision: row.decision,
    remark: row.remark,
    reasonCodes: row.reason_codes,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function toSubmitAdmissionReviewResult(
  value: unknown,
): SubmitAdmissionReviewResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("admission_share_submit_invalid_result");
  }

  const row = value as Record<string, unknown>;
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    submissionRevision: requiredNonnegativeInteger(
      row.submissionRevision,
      "submissionRevision",
    ),
    submittedCount: requiredNonnegativeInteger(
      row.submittedCount,
      "submittedCount",
    ),
    syncedCount: requiredNonnegativeInteger(row.syncedCount, "syncedCount"),
    skippedCount: requiredNonnegativeInteger(row.skippedCount, "skippedCount"),
    items: items.map(toSubmitAdmissionReviewResultItem),
  };
}

function toSubmitAdmissionReviewResultItem(
  value: unknown,
): AdmissionReviewSubmissionResultItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("admission_share_submit_invalid_result");
  }
  const row = value as Record<string, unknown>;
  const decision = row.decision;
  const syncStatus = row.syncStatus;
  if (
    (decision !== "selected" &&
      decision !== "backup" &&
      decision !== "rejected" &&
      decision !== "needs_changes") ||
    (syncStatus !== "synced" && syncStatus !== "skipped")
  ) {
    throw new Error("admission_share_submit_invalid_result");
  }
  return {
    vendorReviewId: requiredResultString(row.vendorReviewId),
    applicationId: requiredResultString(row.applicationId),
    recordingSubmissionId: requiredResultString(row.recordingSubmissionId),
    recordingVersion: requiredNonnegativeInteger(
      row.recordingVersion,
      "recordingVersion",
    ),
    decision,
    remark: typeof row.remark === "string" ? row.remark : "",
    reasonCodes: Array.isArray(row.reasonCodes)
      ? row.reasonCodes.filter(
          (reasonCode): reasonCode is string => typeof reasonCode === "string",
        )
      : [],
    syncStatus,
    syncError: typeof row.syncError === "string" ? row.syncError : null,
  };
}

function requiredNonnegativeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`admission_share_submit_invalid_result:${field}`);
  }
  return Number(value);
}

function requiredResultString(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("admission_share_submit_invalid_result");
  }
  return value;
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
  finalReviewByRecording: Map<string, PublicAdmissionShareFinalReview>,
): PublicAdmissionShareItemSnapshot {
  const application = first(row.project_applications);
  const recording = first(row.recording_submissions);
  const streamer = first(application?.streamers);
  const finalReview = finalReviewByRecording.get(row.recording_submission_id);
  return {
    applicationId: row.application_id,
    applicationStatus: application?.status ?? "recording_reviewing",
    recordingSubmissionId: row.recording_submission_id,
    recordingVersion: row.recording_version,
    recordingStatus: recording?.status ?? "submitted",
    recordingUrl: recording?.external_url?.trim() || null,
    storagePath: recording?.storage_path ?? null,
    sourceHealth: row.source_health,
    streamer: {
      id: streamer?.id ?? application?.streamer_id ?? "",
      displayName: streamer?.display_name?.trim() || "",
      accountLabel: accountLabel(streamer?.streamer_accounts),
    },
    finalReview: finalReview ?? null,
  };
}

function toAdmissionSharePlaybackIssueDto(
  row: AdmissionSharePlaybackIssueRow,
): AdmissionSharePlaybackIssueDto {
  const recording = first(row.recording_submissions);
  const streamer = first(recording?.streamers);
  return {
    id: row.id,
    shareBoardId: row.share_board_id,
    recordingSubmissionId: row.recording_submission_id,
    recordingVersion: recording?.version ?? 0,
    streamerDisplayName: streamer?.display_name?.trim() || "",
    sourceType: row.source_type,
    errorCode: row.error_code,
    status: row.status,
    reportedAt: row.reported_at,
    resolvedAt: row.resolved_at,
  };
}

async function collectBoundedPublicRows<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PUBLIC_SHARE_COLLECTION_PAGE_SIZE) {
    const to = Math.min(
      from + PUBLIC_SHARE_COLLECTION_PAGE_SIZE - 1,
      ADMISSION_SHARE_MAX_ITEMS,
    );
    const page = await loadPage(from, to);

    if (from === ADMISSION_SHARE_MAX_ITEMS) {
      if (page.length > 0) throw new AdmissionShareItemLimitError();
      return rows;
    }

    rows.push(...page);
    if (page.length < PUBLIC_SHARE_COLLECTION_PAGE_SIZE) return rows;
  }
}

function isAdmissionReviewDraftComplete(row: AdmissionReviewDraftRow) {
  if (row.decision === "selected" || row.decision === "backup") return true;
  if (row.decision !== "rejected" && row.decision !== "needs_changes") {
    return false;
  }

  // PostgreSQL btrim(text) removes U+0020 spaces by default, not every JS
  // whitespace character. Keep public progress identical to the SQL aggregate.
  return /[^ ]/u.test(row.remark ?? "");
}

function trimPostgresBtrimSpaces(value: string | null) {
  return (value ?? "").replace(/^ +| +$/gu, "");
}

function accountLabel(
  accounts:
    | Array<{
        id: string;
        platform: string | null;
        account_handle: string | null;
        is_primary: boolean | null;
        created_at: string;
      }>
    | null
    | undefined,
) {
  const account = [...(accounts ?? [])].sort((left, right) => {
    if (left.is_primary !== right.is_primary) {
      return left.is_primary ? -1 : 1;
    }
    if (left.created_at !== right.created_at) {
      return left.created_at < right.created_at ? -1 : 1;
    }
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  })[0];
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
