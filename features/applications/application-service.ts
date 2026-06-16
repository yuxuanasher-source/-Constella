import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

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
};

export type ProjectAdmissionConfig = {
  id: string;
  name: string;
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
  collaborationId?: string | null;
  contributorOrganizationId?: string | null;
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
    version: number;
    storagePath?: string;
    externalUrl?: string;
    durationSeconds?: number;
    collaborationId?: string | null;
    contributorOrganizationId?: string | null;
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

export async function applyToProject({
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
  input: { projectId: string; streamerId: string };
}): Promise<ApplicationRecord> {
  if (actor.role !== "streamer") {
    throw new Error("Only streamers can apply to projects");
  }

  const project = await requireProject(repo, input.projectId);
  if (!project.openSignup) {
    throw new Error("Project is not open for signup");
  }

  const streamer = await requireStreamer(repo, input.streamerId);
  assertStreamerCanEnterAdmission(streamer, "apply");

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
  };
}): Promise<RecordingSubmissionRecord> {
  if (actor.role !== "streamer") {
    throw new Error("Only streamers can submit screening recordings");
  }

  if (!input.storagePath && !input.externalUrl) {
    throw new Error(
      "Recording submission requires a storage path or external URL",
    );
  }

  const application = await requireApplication(repo, input.applicationId);
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
    version: (latest?.version ?? 0) + 1,
    storagePath: input.storagePath,
    externalUrl: input.externalUrl,
    durationSeconds: input.durationSeconds,
    collaborationId: application.collaborationId,
    contributorOrganizationId: application.contributorOrganizationId,
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
    after: recording,
    changedFields: ["version", "storage_path", "external_url"],
  });
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "operator_business",
    type: "review",
    title: "Screening recording submitted",
    content: `Application ${application.id} has a recording ready for review.`,
    objectType: "application",
    objectId: application.id,
    source: "application.recording.submit",
  });

  return recording;
}

export async function reviewRecordingSubmission({
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
    decision: Extract<
      RecordingReviewStatus,
      "approved" | "rejected" | "needs_changes"
    >;
    note?: string;
  };
}): Promise<ApplicationRecord> {
  if (!canManageAdmission(actor.role)) {
    throw new Error("Current role cannot review screening recordings");
  }

  const application = await requireApplication(repo, input.applicationId);
  const latest = await repo.getLatestRecordingSubmission(application.id);
  if (!latest) {
    throw new Error("Application has no recording to review");
  }

  const nextStatus = mapRecordingDecisionToApplicationStatus(input.decision);
  assertApplicationTransition(application.status, nextStatus);
  const now = new Date().toISOString();
  const reviewedRecording = await repo.updateRecordingReview(latest.id, {
    status: input.decision,
    reviewedBy: actor.userId,
    reviewedAt: now,
    reviewNote: input.note,
  });
  const updated = await repo.updateApplicationStatus(application.id, {
    status: nextStatus,
    decidedBy: actor.userId,
    decidedAt: now,
    decisionReason: input.note,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: input.decision === "approved" ? "approve" : "reject",
    module: "application",
    objectType: "recording_submission",
    objectId: reviewedRecording.id,
    projectId: application.projectId,
    streamerId: application.streamerId,
    before: latest,
    after: reviewedRecording,
    changedFields: ["status", "reviewed_by", "reviewed_at", "review_note"],
    reason: input.note,
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: input.decision === "approved" ? "owner" : "streamer",
    type: "review",
    title:
      input.decision === "approved"
        ? "Screening approved, join confirmation needed"
        : "Screening recording needs attention",
    content:
      input.decision === "approved"
        ? `Application ${application.id} is ready for final join confirmation.`
        : `Application ${application.id} was marked ${input.decision}.`,
    objectType: "application",
    objectId: application.id,
    source: "application.recording.review",
  });

  return updated;
}

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
  input: { applicationId: string };
}): Promise<ProjectStreamerRecord> {
  if (!canConfirmJoin(actor.role)) {
    throw new Error("Only owner and ops_manager can confirm project join");
  }

  const application = await requireApplication(repo, input.applicationId);
  const project = await requireProject(repo, application.projectId);
  const streamer = await requireStreamer(repo, application.streamerId);
  assertApplicationTransition(application.status, "joined");
  const now = new Date().toISOString();
  const settlementSnapshot = resolveProjectStreamerSettlementSnapshot({
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

function canConfirmJoin(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
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
  project: ProjectAdmissionConfig;
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
