import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";
import type { AdmissionCheckpointResultInput } from "@/features/admission-review/contracts";
import type {
  NormalizedRecordingSelfCheck,
  RecordingSelfAssessmentLevel,
} from "@/features/recordings/recording-production-standard";
import { normalizeRecordingStoragePath } from "@/features/storage/recording-path-guard";

import {
  assertApplicationTransition,
  assertCanSubmitRecording,
  mapRecordingDecisionToApplicationStatus,
  type ApplicationStatus,
  type RecordingReviewStatus,
} from "./application-state";

export type ApplicationSource = "signup" | "direct_invite";
export type ProjectStreamerStatus =
  | "candidate"
  | "screening"
  | "approved"
  | "rejected"
  | "joined"
  | "removed";

export type AdmissionActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
  streamerId?: string | null;
};

export type ProjectAdmissionConfig = {
  id: string;
  name: string;
  organizationId: string;
  status: string;
  openSignup: boolean;
  allowDirectInvite: boolean;
  forceRecording: boolean;
  defaultSettlementMethod: string;
  defaultHourlyRate: number;
  defaultBaseSalary: number;
  defaultSettlementRule: Record<string, unknown>;
};

export type StreamerAdmissionRecord = {
  id: string;
  displayName: string;
  organizationId?: string | null;
  userId?: string | null;
  riskLevel: "low" | "medium" | "high" | "blacklisted";
  defaultSettlementMethod?: string | null;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
};

export type ApplicationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  streamerId: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  decisionReason?: string | null;
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
};

export type RecordingSubmissionRecord = {
  id: string;
  applicationId: string;
  version: number;
  status: RecordingReviewStatus;
  uploadedBy: string | null;
  mcnReviewDecision?: Extract<
    RecordingReviewStatus,
    "approved" | "rejected" | "needs_changes"
  > | null;
  mcnReviewedBy?: string | null;
  mcnReviewedAt?: string | null;
  mcnReviewNote?: string | null;
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
  selfScoreTotal?: number | null;
  selfAssessmentLevel?: RecordingSelfAssessmentLevel | null;
};

export type ProjectStreamerRecord = {
  id: string;
  projectId: string;
  streamerId: string;
  status: ProjectStreamerStatus;
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
};

export type ActiveCollaborationAgreementRecord = {
  id: string;
  projectId: string;
  partnerOrganizationId: string;
  status: "active";
};

export type StreamerVisiblePublicProject = {
  id: string;
  name: string;
  organizationId: string;
  status: string;
  isPublicToStreamers: boolean;
};

export type SelfSignupApplicationRepository = ApplicationRepository & {
  getPublicProjectForRecording?(
    projectId: string,
  ): Promise<StreamerVisiblePublicProject | null>;
};

export type ApplicationRepository = {
  getProjectAdmissionConfig(
    projectId: string,
  ): Promise<ProjectAdmissionConfig | null>;
  getStreamerForAdmission(
    streamerId: string,
  ): Promise<StreamerAdmissionRecord | null>;
  getApplicationById(applicationId: string): Promise<ApplicationRecord | null>;
  getApplicationByProjectAndStreamer(
    projectId: string,
    streamerId: string,
    source?: ApplicationSource,
  ): Promise<ApplicationRecord | null>;
  getActiveCollaborationAgreement(input: {
    projectId: string;
    collaborationId: string;
    contributorOrganizationId: string;
  }): Promise<ActiveCollaborationAgreementRecord | null>;
  createApplication(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    source: ApplicationSource;
    status: ApplicationStatus;
    invitedBy?: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<ApplicationRecord>;
  updateApplicationStatus(
    applicationId: string,
    input: {
      status: ApplicationStatus;
      decidedBy?: string;
      decidedAt?: string;
      decisionReason?: string | null;
    },
  ): Promise<ApplicationRecord>;
  markApplicationRecordingReviewing(
    applicationId: string,
  ): Promise<ApplicationRecord>;
  createRecordingSubmission(input: {
    organizationId: string;
    applicationId: string;
    projectId: string;
    streamerId: string;
    uploadedBy: string;
    version: number;
    storagePath?: string;
    externalUrl?: string;
    durationSeconds?: number;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
    selfCheck?: NormalizedRecordingSelfCheck;
  }): Promise<RecordingSubmissionRecord>;
  getLatestRecordingSubmission(
    applicationId: string,
  ): Promise<RecordingSubmissionRecord | null>;
  updateRecordingReview(
    recordingId: string,
    input: {
      status: RecordingReviewStatus;
      reviewedBy: string;
      reviewedAt: string;
      reviewNote?: string;
      mcnReviewDecision: Extract<
        RecordingReviewStatus,
        "approved" | "rejected" | "needs_changes"
      >;
      mcnReviewedBy: string;
      mcnReviewedAt: string;
      mcnReviewNote?: string;
    },
  ): Promise<RecordingSubmissionRecord>;
  createProjectStreamer(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    status: ProjectStreamerStatus;
    settlementMethod: string;
    hourlyRate: number;
    baseSalary: number;
    cpsRateBps: number;
    settlementRule: Record<string, unknown>;
    createdBy: string;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
  }): Promise<ProjectStreamerRecord>;
};

export type ApplicationAuditWriter = (input: AuditLogInput) => Promise<void>;
export type ApplicationNotifier = (input: NotificationInput) => Promise<void>;

const blockedSelfSignupProjectStatuses = new Set([
  "draft",
  "ended",
  "closed",
  "archived",
]);

export async function applyToProject({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: SelfSignupApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: { projectId: string; streamerId: string };
}): Promise<ApplicationRecord> {
  if (actor.role !== "streamer") {
    throw new Error("Only streamers can apply to projects");
  }

  const project = await resolveSelfSignupProject(repo, actor, input.projectId);

  const streamer = await requireStreamer(repo, input.streamerId);
  assertStreamerCanEnterAdmission(streamer, "apply");

  const existingApplication = await repo.getApplicationByProjectAndStreamer(
    project.id,
    streamer.id,
  );
  if (existingApplication) {
    return existingApplication;
  }

  const application = await repo.createApplication({
    organizationId: actor.organizationId,
    projectId: project.id,
    streamerId: streamer.id,
    source: "signup",
    status: project.forceRecording ? "submitted" : "recording_approved",
  });

  await auditApplicationCreate({
    audit,
    actor,
    application,
    project,
    streamer,
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "New project application",
    content: `${streamer.displayName} applied to ${project.name}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.apply",
  });

  return application;
}

export async function inviteStreamerToProject({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: { projectId: string; streamerId: string; collaborationId?: string };
}): Promise<ApplicationRecord> {
  if (!canManageAdmission(actor.role)) {
    throw new Error("Current role cannot invite streamers");
  }

  const project = await requireProject(repo, input.projectId);
  if (!project.allowDirectInvite) {
    throw new Error("Project does not allow direct invitations");
  }

  const streamer = await requireStreamer(repo, input.streamerId);
  assertStreamerCanEnterAdmission(streamer, "invite");

  const existingInvite = await repo.getApplicationByProjectAndStreamer(
    project.id,
    streamer.id,
    "direct_invite",
  );
  if (existingInvite) {
    return existingInvite;
  }
  const collaborationAttribution = await resolveCollaborationAttribution({
    repo,
    actor,
    projectId: project.id,
    collaborationId: input.collaborationId,
  });
  if (
    collaborationAttribution &&
    streamer.organizationId !==
      collaborationAttribution.contributorOrganizationId
  ) {
    throw new Error(
      "Collaboration invitations require a streamer from the partner organization",
    );
  }

  const application = await repo.createApplication({
    organizationId:
      collaborationAttribution?.contributorOrganizationId ??
      actor.organizationId,
    projectId: project.id,
    streamerId: streamer.id,
    source: "direct_invite",
    status: project.forceRecording ? "invited" : "recording_approved",
    invitedBy: actor.userId,
    collaborationId: collaborationAttribution?.collaborationId,
    contributorOrganizationId:
      collaborationAttribution?.contributorOrganizationId,
  });

  await auditApplicationCreate({
    audit,
    actor,
    application,
    project,
    streamer,
  });

  if (streamer.userId) {
    await notify({
      organizationId: actor.organizationId,
      recipientUserId: streamer.userId,
      type: "task",
      title: "Project invitation",
      content: `${project.name} invited you to submit a screening recording.`,
      objectType: "application",
      objectId: application.id,
      source: "application.invite",
    });
  }

  return application;
}

export async function submitRecording({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: {
    applicationId: string;
    storagePath?: string;
    externalUrl?: string;
    durationSeconds?: number;
    selfCheck?: NormalizedRecordingSelfCheck;
  };
}): Promise<RecordingSubmissionRecord> {
  const isSelfUpload = actor.role === "streamer";
  if (!isSelfUpload && !canManageAdmission(actor.role)) {
    throw new Error("Current role cannot submit screening recordings");
  }

  const storagePath = normalizeRecordingStoragePath(
    input.storagePath,
    actor.organizationId,
  );
  const externalUrl = normalizeExternalRecordingUrl(input.externalUrl);
  if (!storagePath && !externalUrl) {
    throw new Error(
      "Recording submission requires a storage path or external URL",
    );
  }

  const application = await requireApplication(repo, input.applicationId);
  if (isSelfUpload) {
    if (!actor.streamerId || application.streamerId !== actor.streamerId) {
      throw new Error("Application is not available for the current streamer");
    }
  } else {
    await assertStaffCanAccessApplication(repo, actor, application);
    const streamer = await requireStreamer(repo, application.streamerId);
    if (streamer.riskLevel === "blacklisted") {
      throw new Error("Blacklisted streamers cannot submit recordings");
    }
  }
  assertCanSubmitRecording(application.status);

  const nextStatus = "recording_reviewing";
  assertApplicationTransition(application.status, nextStatus);

  const latest = await repo.getLatestRecordingSubmission(application.id);
  const recording = await repo.createRecordingSubmission({
    organizationId:
      application.contributorOrganizationId ??
      application.organizationId ??
      actor.organizationId,
    applicationId: application.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    uploadedBy: actor.userId,
    version: (latest?.version ?? 0) + 1,
    storagePath,
    externalUrl,
    durationSeconds: input.durationSeconds,
    collaborationId: application.collaborationId,
    contributorOrganizationId: application.contributorOrganizationId,
    selfCheck: input.selfCheck,
  });

  await repo.markApplicationRecordingReviewing(application.id);
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "application",
    objectType: "recording_submission",
    objectId: recording.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    after: {
      ...recording,
      uploadedBy: actor.userId,
      uploadMode: isSelfUpload ? "self" : "proxy",
    },
    changedFields: [
      "version",
      "storage_path",
      "external_url",
      "uploaded_by",
      "upload_mode",
    ],
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "Screening recording submitted",
    content: isSelfUpload
      ? `Streamer submitted their screening recording for application ${application.id}.`
      : `${actor.name || actor.role} proxy-uploaded a screening recording for application ${application.id}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.recording.submit",
  });

  return recording;
}

// 卡点评估回写（features/admission-review）。可选注入：路由侧绑定 supabase，
// 单元测试与旧调用方不传时行为不变。
export type AdmissionEvaluationRecorder = (input: {
  organizationId: string;
  applicationId: string;
  submissionId: string;
  decision: Extract<
    RecordingReviewStatus,
    "approved" | "rejected" | "needs_changes"
  >;
  reviewerId: string;
  note?: string;
  noteSource: "human" | "needs_classification";
  reasonCodes: string[];
  checkpointResults?: AdmissionCheckpointResultInput[];
}) => Promise<void>;

export async function reviewRecordingSubmission({
  repo,
  audit,
  notify,
  actor,
  input,
  recordEvaluation,
}: {
  repo: ApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: {
    applicationId: string;
    decision: Extract<
      RecordingReviewStatus,
      "approved" | "rejected" | "needs_changes"
    >;
    note?: string;
    reasonCodes?: string[];
    checkpointResults?: AdmissionCheckpointResultInput[];
  };
  recordEvaluation?: AdmissionEvaluationRecorder;
}): Promise<ApplicationRecord> {
  if (!canManageAdmission(actor.role)) {
    throw new Error("Current role cannot review screening recordings");
  }

  const reasonCodes = (input.reasonCodes ?? [])
    .map((code) => code.trim())
    .filter(Boolean);
  const note = input.note?.trim() || undefined;

  const application = await requireApplication(repo, input.applicationId);
  const latest = await repo.getLatestRecordingSubmission(application.id);
  if (!latest) {
    throw new Error("Application has no recording to review");
  }

  const frozenDecision = latest.mcnReviewDecision ?? null;
  if (frozenDecision && frozenDecision !== input.decision) {
    throw new Error(
      `Recording MCN review is already frozen as ${frozenDecision} and cannot change to ${input.decision}`,
    );
  }

  // 驳回/需修改必须给出可沉淀的理由：理由码（结构化）或备注（老客户端，
  // 标记 needs_classification 等待归一化）。已冻结的同决策重试沿用首次事实。
  if (
    !frozenDecision &&
    input.decision !== "approved" &&
    !reasonCodes.length &&
    !note
  ) {
    throw new Error(
      "Rejection or change request requires reason codes or a note",
    );
  }

  const effectiveDecision = frozenDecision ?? input.decision;
  const effectiveNote = frozenDecision
    ? (latest.mcnReviewNote ?? undefined)
    : note;
  const nextStatus = mapRecordingDecisionToApplicationStatus(effectiveDecision);
  assertApplicationTransition(application.status, nextStatus);
  const now = new Date().toISOString();
  const effectiveReviewerId =
    (frozenDecision && latest.mcnReviewedBy) || actor.userId;
  const effectiveReviewedAt = (frozenDecision && latest.mcnReviewedAt) || now;
  const reviewedRecording = frozenDecision
    ? latest
    : await repo.updateRecordingReview(latest.id, {
        status: effectiveDecision,
        reviewedBy: effectiveReviewerId,
        reviewedAt: effectiveReviewedAt,
        reviewNote: effectiveNote,
        mcnReviewDecision: effectiveDecision,
        mcnReviewedBy: effectiveReviewerId,
        mcnReviewedAt: effectiveReviewedAt,
        mcnReviewNote: effectiveNote,
      });
  const updated = await repo.updateApplicationStatus(application.id, {
    status: nextStatus,
    decidedBy: effectiveReviewerId,
    decidedAt: effectiveReviewedAt,
    decisionReason: effectiveNote,
  });

  if (recordEvaluation) {
    await recordEvaluation({
      organizationId:
        application.contributorOrganizationId ??
        application.organizationId ??
        actor.organizationId,
      applicationId: application.id,
      submissionId: latest.id,
      decision: effectiveDecision,
      reviewerId: effectiveReviewerId,
      note: effectiveNote,
      noteSource: reasonCodes.length ? "human" : "needs_classification",
      reasonCodes,
      checkpointResults: input.checkpointResults,
    });
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: effectiveDecision === "approved" ? "approve" : "reject",
    module: "application",
    objectType: "recording_submission",
    objectId: reviewedRecording.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    before: latest,
    after: reviewedRecording,
    changedFields: ["status", "reviewed_by", "reviewed_at", "review_note"],
    reason: effectiveNote,
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: effectiveDecision === "approved" ? "owner" : "streamer",
    type: "review",
    title:
      effectiveDecision === "approved"
        ? "Screening approved, join confirmation needed"
        : "Screening recording needs attention",
    content:
      effectiveDecision === "approved"
        ? `Application ${application.id} is ready for final join confirmation.`
        : `Application ${application.id} was marked ${effectiveDecision}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.recording.review",
  });

  return updated;
}

export type ConfirmJoinSettlementOverride = {
  settlementMethod: string;
  hourlyRate?: number;
  baseSalary?: number;
  cpsRateBps?: number;
};

const confirmJoinSettlementMethods = new Set([
  "cpt",
  "cpa",
  "cps",
  "gift",
  "base_salary",
  "base_salary_cpt",
  "manual",
]);

export async function confirmApplicationJoin({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: {
    applicationId: string;
    // 结算流程改造 step 1：确认加入时运营可直接为该主播设定本项目的
    // 结算规则；缺省保持旧行为 = 主播默认 > 项目默认 的自动快照。
    settlement?: ConfirmJoinSettlementOverride;
  };
}): Promise<ProjectStreamerRecord> {
  if (!canConfirmJoin(actor.role)) {
    throw new Error("Only owner and ops_manager can confirm project join");
  }

  const application = await requireApplication(repo, input.applicationId);
  const project = await requireProject(repo, application.projectId);
  const streamer = await requireStreamer(repo, application.streamerId);
  assertApplicationTransition(application.status, "joined");
  const now = new Date().toISOString();
  const settlementSnapshot = input.settlement
    ? operatorConfirmSettlementSnapshot({ override: input.settlement, now })
    : resolveProjectStreamerSettlementSnapshot({
        project,
        streamer,
        now,
      });

  const projectStreamer = await repo.createProjectStreamer({
    organizationId:
      application.contributorOrganizationId ??
      application.organizationId ??
      actor.organizationId,
    projectId: application.projectId,
    streamerId: application.streamerId,
    status: "joined",
    settlementMethod: settlementSnapshot.settlementMethod,
    hourlyRate: settlementSnapshot.hourlyRate,
    baseSalary: settlementSnapshot.baseSalary,
    cpsRateBps: settlementSnapshot.cpsRateBps,
    settlementRule: settlementSnapshot.settlementRule,
    createdBy: actor.userId,
    collaborationId: application.collaborationId,
    contributorOrganizationId: application.contributorOrganizationId,
  });
  const updated = await repo.updateApplicationStatus(application.id, {
    status: "joined",
    decidedBy: actor.userId,
    decidedAt: now,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "approve",
    module: "application",
    objectType: "application",
    objectId: application.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    before: application,
    after: updated,
    changedFields: ["status", "decided_by", "decided_at"],
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "streamer",
    type: "task",
    title: "Project join confirmed",
    content: `You have joined ${project.name}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.join.confirm",
  });

  return projectStreamer;
}

export async function rejectApplicationJoin({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: ApplicationRepository;
  audit: ApplicationAuditWriter;
  notify: ApplicationNotifier;
  actor: AdmissionActor;
  input: { applicationId: string; reason: string };
}): Promise<ApplicationRecord> {
  if (!canConfirmJoin(actor.role)) {
    throw new Error("Only owner and ops_manager can reject project join");
  }

  if (!input.reason.trim()) {
    throw new Error("Rejecting join requires a reason");
  }

  const application = await requireApplication(repo, input.applicationId);
  assertApplicationTransition(application.status, "declined");
  const updated = await repo.updateApplicationStatus(application.id, {
    status: "declined",
    decidedBy: actor.userId,
    decidedAt: new Date().toISOString(),
    decisionReason: input.reason.trim(),
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "reject",
    module: "application",
    objectType: "application",
    objectId: application.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    before: application,
    after: updated,
    changedFields: ["status", "decision_reason", "decided_by", "decided_at"],
    reason: input.reason.trim(),
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "streamer",
    type: "review",
    title: "Project join not confirmed",
    content: `Application ${application.id} was not joined: ${input.reason.trim()}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.join.reject",
  });

  return updated;
}

function canManageAdmission(role: AppRole): boolean {
  return isMcnStaff(role) && role !== "finance";
}

function normalizeExternalRecordingUrl(value?: string): string | undefined {
  const normalized = value?.trim() || undefined;
  if (!normalized) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Recording link must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Recording link must be an http(s) URL");
  }

  return normalized;
}

async function assertStaffCanAccessApplication(
  repo: Pick<ApplicationRepository, "getActiveCollaborationAgreement">,
  actor: AdmissionActor,
  application: ApplicationRecord,
): Promise<void> {
  if (application.organizationId === actor.organizationId) {
    return;
  }

  if (
    application.collaborationId &&
    application.contributorOrganizationId === actor.organizationId
  ) {
    const agreement = await repo.getActiveCollaborationAgreement({
      projectId: application.projectId,
      collaborationId: application.collaborationId,
      contributorOrganizationId: actor.organizationId,
    });
    if (
      agreement?.id === application.collaborationId &&
      agreement.projectId === application.projectId &&
      agreement.partnerOrganizationId === actor.organizationId &&
      agreement.status === "active"
    ) {
      return;
    }
  }

  throw new Error("Cross-organization access is not allowed");
}

function canConfirmJoin(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

function operatorConfirmSettlementSnapshot({
  override,
  now,
}: {
  override: ConfirmJoinSettlementOverride;
  now: string;
}) {
  const method = override.settlementMethod;
  if (!confirmJoinSettlementMethods.has(method)) {
    throw new Error("Invalid settlement method");
  }

  const hourlyRate = nonNegativeAmount(override.hourlyRate, "hourlyRate");
  const baseSalary = nonNegativeAmount(override.baseSalary, "baseSalary");
  const cpsRateBps = nonNegativeAmount(override.cpsRateBps, "cpsRateBps");
  if (cpsRateBps > 10000) {
    throw new Error("cpsRateBps cannot exceed 10000");
  }

  return {
    settlementMethod: method,
    hourlyRate,
    baseSalary,
    cpsRateBps,
    settlementRule: {
      source: "operator_confirm",
      settlementMethod: method,
      cptHourlyRate: hourlyRate,
      baseSalary,
      cpsRateBps,
      snapshotAt: now,
    },
  };
}

function nonNegativeAmount(value: number | undefined, field: string): number {
  const amount = value ?? 0;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }

  return amount;
}

function resolveProjectStreamerSettlementSnapshot({
  project,
  streamer,
  now,
}: {
  project: ProjectAdmissionConfig;
  streamer: StreamerAdmissionRecord;
  now: string;
}) {
  if (streamerHasConfiguredSettlement(streamer)) {
    const method = streamer.defaultSettlementMethod ?? "manual";
    const hourlyRate = streamer.defaultHourlyRate ?? 0;
    const baseSalary = streamer.defaultBaseSalary ?? 0;
    const cpsRateBps = streamer.defaultCpsRateBps ?? 0;
    return {
      settlementMethod: method,
      hourlyRate,
      baseSalary,
      cpsRateBps,
      settlementRule: {
        source: "streamer_default",
        settlementMethod: method,
        cptHourlyRate: hourlyRate,
        baseSalary,
        cpsRateBps,
        snapshotAt: now,
      },
    };
  }

  return {
    settlementMethod: project.defaultSettlementMethod,
    hourlyRate: project.defaultHourlyRate,
    baseSalary: project.defaultBaseSalary,
    cpsRateBps: 0,
    settlementRule: {
      ...project.defaultSettlementRule,
      source: "project_default",
      settlementMethod: project.defaultSettlementMethod,
      cptHourlyRate: project.defaultHourlyRate,
      baseSalary: project.defaultBaseSalary,
      cpsRateBps: 0,
      snapshotAt: now,
    },
  };
}

function streamerHasConfiguredSettlement(streamer: StreamerAdmissionRecord) {
  const method = streamer.defaultSettlementMethod ?? "manual";
  return (
    (["cpt", "base_salary_cpt"].includes(method) &&
      (streamer.defaultHourlyRate ?? 0) > 0) ||
    (["base_salary", "base_salary_cpt"].includes(method) &&
      (streamer.defaultBaseSalary ?? 0) > 0) ||
    (method === "cps" && (streamer.defaultCpsRateBps ?? 0) > 0)
  );
}

function assertStreamerCanEnterAdmission(
  streamer: StreamerAdmissionRecord,
  action: "apply" | "invite",
): void {
  if (streamer.riskLevel === "blacklisted") {
    throw new Error(
      `Blacklisted streamers cannot be ${action === "apply" ? "accepted" : "invited"}`,
    );
  }
}

async function resolveSelfSignupProject(
  repo: SelfSignupApplicationRepository,
  actor: AdmissionActor,
  projectId: string,
): Promise<Pick<ProjectAdmissionConfig, "id" | "name" | "forceRecording">> {
  const project = await repo.getProjectAdmissionConfig(projectId);
  if (project) {
    if (!project.openSignup) {
      throw new Error("Project is not open for signup");
    }

    return project;
  }

  // Streamers usually cannot read the raw project row before joining it, so
  // self signup falls back to the same streamer-visible announcement source
  // that project recording delivery uses to create implicit applications
  // (see features/recordings/project-recording-delivery.ts).
  const publicProject = await repo.getPublicProjectForRecording?.(projectId);
  if (
    !publicProject ||
    publicProject.organizationId !== actor.organizationId ||
    !publicProject.isPublicToStreamers ||
    blockedSelfSignupProjectStatuses.has(publicProject.status)
  ) {
    throw new Error("Project not found");
  }

  return {
    id: publicProject.id,
    name: publicProject.name,
    forceRecording: true,
  };
}

async function requireProject(
  repo: Pick<ApplicationRepository, "getProjectAdmissionConfig">,
  projectId: string,
): Promise<ProjectAdmissionConfig> {
  const project = await repo.getProjectAdmissionConfig(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

async function requireStreamer(
  repo: Pick<ApplicationRepository, "getStreamerForAdmission">,
  streamerId: string,
): Promise<StreamerAdmissionRecord> {
  const streamer = await repo.getStreamerForAdmission(streamerId);
  if (!streamer) {
    throw new Error("Streamer not found");
  }

  return streamer;
}

async function requireApplication(
  repo: Pick<ApplicationRepository, "getApplicationById">,
  applicationId: string,
): Promise<ApplicationRecord> {
  const application = await repo.getApplicationById(applicationId);
  if (!application) {
    throw new Error("Application not found");
  }

  return application;
}

async function resolveCollaborationAttribution({
  repo,
  actor,
  projectId,
  collaborationId,
}: {
  repo: Pick<ApplicationRepository, "getActiveCollaborationAgreement">;
  actor: AdmissionActor;
  projectId: string;
  collaborationId?: string;
}) {
  if (!collaborationId?.trim()) {
    return null;
  }

  const agreement = await repo.getActiveCollaborationAgreement({
    projectId,
    collaborationId: collaborationId.trim(),
    contributorOrganizationId: actor.organizationId,
  });
  if (!agreement) {
    throw new Error("Active collaboration agreement is required");
  }

  return {
    collaborationId: agreement.id,
    contributorOrganizationId: agreement.partnerOrganizationId,
  };
}

async function auditApplicationCreate({
  audit,
  actor,
  application,
  project,
  streamer,
}: {
  audit: ApplicationAuditWriter;
  actor: AdmissionActor;
  application: ApplicationRecord;
  project: Pick<ProjectAdmissionConfig, "name">;
  streamer: StreamerAdmissionRecord;
}): Promise<void> {
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "application",
    objectType: "application",
    objectId: application.id,
    objectName: `${project.name} / ${streamer.displayName}`,
    projectId: application.projectId,
    streamerId: application.streamerId,
    after: application,
    changedFields: ["project_id", "streamer_id", "source", "status"],
  });
}
