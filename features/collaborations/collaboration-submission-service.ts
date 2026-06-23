import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import { canManageCollaboration } from "./collaboration-service";
import {
  assertCanResubmit,
  assertSubmissionTransition,
  type CollaborationSubmissionStatus,
} from "./collaboration-submission-state";

export type CollaborationSubmissionRecord = {
  id: string;
  collaborationId: string;
  hostOrganizationId: string;
  partnerOrganizationId: string;
  projectId: string;
  streamerName: string;
  liveAccount?: string | null;
  recordingUrl?: string | null;
  note?: string | null;
  status: CollaborationSubmissionStatus;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  linkedStreamerId?: string | null;
  linkedRecordingSubmissionId?: string | null;
};

export type CollaborationLookup = {
  id: string;
  projectId: string;
  hostOrganizationId: string;
  partnerOrganizationId: string | null;
  status: "invited" | "active" | "paused" | "ended" | "revoked";
};

export type SubmissionActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CollaborationSubmissionRepository = {
  getCollaboration(collaborationId: string): Promise<CollaborationLookup | null>;
  createSubmission(input: {
    collaborationId: string;
    hostOrganizationId: string;
    partnerOrganizationId: string;
    projectId: string;
    streamerName: string;
    liveAccount: string | null;
    recordingUrl: string | null;
    note: string | null;
    submittedBy: string;
  }): Promise<CollaborationSubmissionRecord>;
  getSubmissionById(
    submissionId: string,
  ): Promise<CollaborationSubmissionRecord | null>;
  updateSubmission(
    submissionId: string,
    patch: Record<string, unknown>,
  ): Promise<CollaborationSubmissionRecord>;
  // 一审通过：在甲方组织内按名建档主播（带 MCN 来源备注/标签），
  // 并落地为录屏待审核记录，桥接现有履约链路。
  landApprovedSubmission(input: {
    submission: CollaborationSubmissionRecord;
    reviewerUserId: string;
  }): Promise<{ streamerId: string; recordingSubmissionId: string | null }>;
};

export type SubmissionAuditWriter = (input: AuditLogInput) => Promise<void>;
export type SubmissionNotifier = (input: NotificationInput) => Promise<void>;

export type ReviewDecision =
  | "under_review"
  | "approved"
  | "rejected"
  | "needs_changes";

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export async function submitCollaborationContent({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: Pick<
    CollaborationSubmissionRepository,
    "getCollaboration" | "createSubmission"
  >;
  audit: SubmissionAuditWriter;
  notify: SubmissionNotifier;
  actor: SubmissionActor;
  input: {
    collaborationId: string;
    streamerName: string;
    liveAccount?: string | null;
    recordingUrl?: string | null;
    note?: string | null;
  };
}): Promise<CollaborationSubmissionRecord> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can submit collaboration content");
  }

  const collaboration = await repo.getCollaboration(input.collaborationId);
  if (!collaboration) {
    throw new Error("Collaboration not found");
  }
  if (collaboration.status !== "active") {
    throw new Error("Collaboration is not active");
  }
  if (collaboration.partnerOrganizationId !== actor.organizationId) {
    throw new Error("Only the partner organization can submit content");
  }

  const streamerName = input.streamerName.trim();
  if (!streamerName) {
    throw new Error("streamerName is required");
  }

  const submission = await repo.createSubmission({
    collaborationId: collaboration.id,
    hostOrganizationId: collaboration.hostOrganizationId,
    partnerOrganizationId: actor.organizationId,
    projectId: collaboration.projectId,
    streamerName,
    liveAccount: normalizeOptionalText(input.liveAccount),
    recordingUrl: normalizeOptionalText(input.recordingUrl),
    note: normalizeOptionalText(input.note),
    submittedBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "collaboration",
    objectType: "collaboration_submission",
    objectId: submission.id,
    projectId: submission.projectId,
    after: submission as unknown as Record<string, unknown>,
    changedFields: ["streamer_name", "live_account", "recording_url", "status"],
  });

  await notify({
    organizationId: collaboration.hostOrganizationId,
    recipientRole: "ops_manager",
    type: "review",
    title: "新的协作录屏待审核",
    content: `合作方提交了主播「${streamerName}」的录屏，待一审。`,
    objectType: "collaboration_submission",
    objectId: submission.id,
    source: "collaboration.submission.create",
  });

  return submission;
}

export async function resubmitCollaborationContent({
  repo,
  audit,
  actor,
  submissionId,
  input,
}: {
  repo: Pick<
    CollaborationSubmissionRepository,
    "getSubmissionById" | "updateSubmission"
  >;
  audit: SubmissionAuditWriter;
  actor: SubmissionActor;
  submissionId: string;
  input: {
    streamerName?: string;
    liveAccount?: string | null;
    recordingUrl?: string | null;
    note?: string | null;
  };
}): Promise<CollaborationSubmissionRecord> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can submit collaboration content");
  }

  const before = await repo.getSubmissionById(submissionId);
  if (!before) {
    throw new Error("Collaboration submission not found");
  }
  if (before.partnerOrganizationId !== actor.organizationId) {
    throw new Error("Only the partner organization can submit content");
  }

  assertCanResubmit(before.status);

  const patch: Record<string, unknown> = { status: "submitted" };
  if (input.streamerName !== undefined) {
    const name = input.streamerName.trim();
    if (!name) {
      throw new Error("streamerName cannot be empty");
    }
    patch.streamer_name = name;
  }
  if (input.liveAccount !== undefined) {
    patch.live_account = normalizeOptionalText(input.liveAccount);
  }
  if (input.recordingUrl !== undefined) {
    patch.recording_url = normalizeOptionalText(input.recordingUrl);
  }
  if (input.note !== undefined) {
    patch.note = normalizeOptionalText(input.note);
  }

  const after = await repo.updateSubmission(submissionId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "collaboration",
    objectType: "collaboration_submission",
    objectId: after.id,
    projectId: after.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: Object.keys(patch),
  });

  return after;
}

export async function reviewCollaborationSubmission({
  repo,
  audit,
  notify,
  actor,
  submissionId,
  decision,
  reviewNote,
}: {
  repo: CollaborationSubmissionRepository;
  audit: SubmissionAuditWriter;
  notify: SubmissionNotifier;
  actor: SubmissionActor;
  submissionId: string;
  decision: ReviewDecision;
  reviewNote?: string;
}): Promise<CollaborationSubmissionRecord> {
  if (!canManageCollaboration(actor.role)) {
    throw new Error("Current role cannot review collaboration submissions");
  }

  const before = await repo.getSubmissionById(submissionId);
  if (!before) {
    throw new Error("Collaboration submission not found");
  }
  if (before.hostOrganizationId !== actor.organizationId) {
    throw new Error("Only host organization staff can review submissions");
  }

  assertSubmissionTransition(before.status, decision);

  const patch: Record<string, unknown> = {
    status: decision,
    reviewed_by: actor.userId,
    reviewed_at: new Date().toISOString(),
    review_note: normalizeOptionalText(reviewNote),
  };

  if (decision === "approved") {
    const landed = await repo.landApprovedSubmission({
      submission: before,
      reviewerUserId: actor.userId,
    });
    patch.linked_streamer_id = landed.streamerId;
    patch.linked_recording_submission_id = landed.recordingSubmissionId;
  }

  const after = await repo.updateSubmission(submissionId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: decision === "rejected" ? "reject" : "approve",
    module: "collaboration",
    objectType: "collaboration_submission",
    objectId: after.id,
    projectId: after.projectId,
    streamerId: after.linkedStreamerId ?? undefined,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: Object.keys(patch),
  });

  await notify({
    organizationId: after.partnerOrganizationId,
    recipientRole: "ops_manager",
    type: "review",
    title: "协作录屏一审结果",
    content: `主播「${after.streamerName}」的录屏一审结果：${decision}。`,
    objectType: "collaboration_submission",
    objectId: after.id,
    source: "collaboration.submission.review",
  });

  return after;
}
