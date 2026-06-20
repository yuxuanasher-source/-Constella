import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditLogInput } from "@/lib/audit/audit";
import { canPublishProject } from "@/lib/rbac/permissions";
import type { AppRole } from "@/lib/rbac/roles";
import { isMcnStaff } from "@/lib/rbac/roles";

export type CollaborationShareStatus = "active" | "expired" | "revoked";
export type CollaborationApplicationStatus =
  | "submitted"
  | "approved"
  | "owner_countered"
  | "rejected"
  | "withdrawn"
  | "expired";
export type CollaborationAgreementStatus = "active" | "suspended" | "ended";

export type ProjectCollaborationActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CollaborationProjectRecord = {
  id: string;
  ownerOrganizationId: string;
  ownerOrganizationName: string;
  name: string;
  code: string;
  isOpenToMcnCollaboration: boolean;
  collaborationSummary: string;
  collaborationTerms: Record<string, unknown>;
  privateMargin?: unknown;
};

export type CollaborationShareRecord = {
  id: string;
  ownerOrganizationId: string;
  projectId: string;
  tokenHash: string;
  status: CollaborationShareStatus;
  expiresAt: string;
  allowApplications: boolean;
  visibleFields: string[];
  createdBy: string;
  revokedBy?: string | null;
  revokedAt?: string | null;
  lastViewedAt?: string | null;
  lastSubmittedAt?: string | null;
  createdAt?: string;
};

export type CollaborationApplicationRecord = {
  id: string;
  shareId: string;
  projectId: string;
  ownerOrganizationId: string;
  applicantOrganizationId: string;
  requestedRevenueShareBps: number;
  ownerCounterRevenueShareBps: number | null;
  finalRevenueShareBps: number | null;
  status: CollaborationApplicationStatus;
  applicantNote: string;
  ownerReviewNote: string;
  rejectionReason: string;
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  applicantConfirmedBy: string | null;
  applicantConfirmedAt: string | null;
  createdAt?: string;
};

export type CollaborationAgreementRecord = {
  id: string;
  applicationId: string;
  projectId: string;
  ownerOrganizationId: string;
  partnerOrganizationId: string;
  revenueShareBps: number;
  settlementBasis: "project_revenue";
  status: CollaborationAgreementStatus;
  ownerConfirmedBy: string;
  ownerConfirmedAt: string;
  partnerConfirmedBy: string | null;
  partnerConfirmedAt: string | null;
  statusReason: string | null;
  createdAt?: string;
};

export type PartnerCollaborationProjectRecord = {
  agreement: CollaborationAgreementRecord;
  project: CollaborationProjectRecord;
};

export type PartnerCollaborationApplicationRecord = {
  application: CollaborationApplicationRecord;
  project: CollaborationProjectRecord;
};

export type ProjectCollaborationRepository = {
  getProject(projectId: string): Promise<CollaborationProjectRecord | null>;
  listShares(projectId: string): Promise<CollaborationShareRecord[]>;
  createShare(
    input: Omit<CollaborationShareRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationShareRecord>;
  revokeShare(input: {
    shareId: string;
    projectId: string;
    revokedBy: string;
    revokedAt: string;
  }): Promise<void>;
  getPublicShareByTokenHash(
    tokenHash: string,
  ): Promise<PublicShareSnapshot | null>;
  markShareViewed(shareId: string, viewedAt: string): Promise<void>;
  markShareSubmitted(shareId: string, submittedAt: string): Promise<void>;
  findPendingApplication(
    projectId: string,
    applicantOrganizationId: string,
  ): Promise<CollaborationApplicationRecord | null>;
  findActiveAgreement(
    projectId: string,
    partnerOrganizationId: string,
  ): Promise<CollaborationAgreementRecord | null>;
  createApplication(
    input: Omit<CollaborationApplicationRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationApplicationRecord>;
  listApplications(
    projectId: string,
  ): Promise<CollaborationApplicationRecord[]>;
  listApplicationsForApplicant(
    applicantOrganizationId: string,
  ): Promise<PartnerCollaborationApplicationRecord[]>;
  getApplication(
    applicationId: string,
  ): Promise<CollaborationApplicationRecord | null>;
  updateApplication(
    applicationId: string,
    patch: Partial<CollaborationApplicationRecord>,
  ): Promise<CollaborationApplicationRecord>;
  getAgreementByApplicationId(
    applicationId: string,
  ): Promise<CollaborationAgreementRecord | null>;
  createAgreement(
    input: Omit<CollaborationAgreementRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationAgreementRecord>;
  listCollaborationProjectsForPartner(
    partnerOrganizationId: string,
  ): Promise<PartnerCollaborationProjectRecord[]>;
};

export type PublicShareSnapshot = {
  share: CollaborationShareRecord;
  project: CollaborationProjectRecord;
};

export type ProjectCollaborationAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export type CreateCollaborationShareInput = {
  expiresAt?: string;
  allowApplications?: boolean;
  visibleFields?: string[];
};

export type SubmitCollaborationApplicationInput = {
  requestedRevenueShareBps: number;
  applicantNote?: string;
};

export type AcceptCollaborationInviteInput = {
  inviteLink: string;
  requestedRevenueShareBps?: number;
  applicantNote?: string;
};

export type ReviewCollaborationApplicationInput =
  | {
      action: "accept";
      ownerReviewNote?: string;
    }
  | {
      action: "reject";
      ownerReviewNote?: string;
      rejectionReason?: string;
    }
  | {
      action: "counter";
      ownerCounterRevenueShareBps: number;
      ownerReviewNote?: string;
    };

export class SupabaseProjectCollaborationRepository implements ProjectCollaborationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProject(
    projectId: string,
  ): Promise<CollaborationProjectRecord | null> {
    const { data, error } = await this.client
      .from("projects")
      .select(projectSelect)
      .eq("id", projectId)
      .maybeSingle<ProjectRow>();

    if (error) {
      throw error;
    }

    return data ? toProjectRecord(data) : null;
  }

  async listShares(projectId: string): Promise<CollaborationShareRecord[]> {
    const { data, error } = await this.client
      .from("project_collaboration_shares")
      .select(shareSelect)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ShareRow[]).map(toShareRecord);
  }

  async createShare(
    input: Omit<CollaborationShareRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationShareRecord> {
    const { data, error } = await this.client
      .from("project_collaboration_shares")
      .insert({
        owner_organization_id: input.ownerOrganizationId,
        project_id: input.projectId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
        allow_applications: input.allowApplications,
        visible_fields: input.visibleFields,
        created_by: input.createdBy,
      })
      .select(shareSelect)
      .single<ShareRow>();

    if (error) {
      throw error;
    }

    return toShareRecord(data);
  }

  async revokeShare(input: {
    shareId: string;
    projectId: string;
    revokedBy: string;
    revokedAt: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("project_collaboration_shares")
      .update({
        status: "revoked",
        revoked_by: input.revokedBy,
        revoked_at: input.revokedAt,
      })
      .eq("id", input.shareId)
      .eq("project_id", input.projectId);

    if (error) {
      throw error;
    }
  }

  async getPublicShareByTokenHash(
    tokenHash: string,
  ): Promise<PublicShareSnapshot | null> {
    const { data, error } = await this.client
      .from("project_collaboration_shares")
      .select(`${shareSelect}, projects(${projectSelect})`)
      .eq("token_hash", tokenHash)
      .maybeSingle<ShareWithProjectRow>();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const project = first(data.projects);
    return project
      ? { share: toShareRecord(data), project: toProjectRecord(project) }
      : null;
  }

  async markShareViewed(shareId: string, viewedAt: string): Promise<void> {
    const { error } = await this.client
      .from("project_collaboration_shares")
      .update({ last_viewed_at: viewedAt })
      .eq("id", shareId);

    if (error) {
      throw error;
    }
  }

  async markShareSubmitted(
    shareId: string,
    submittedAt: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("project_collaboration_shares")
      .update({ last_submitted_at: submittedAt })
      .eq("id", shareId);

    if (error) {
      throw error;
    }
  }

  async findPendingApplication(
    projectId: string,
    applicantOrganizationId: string,
  ): Promise<CollaborationApplicationRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .select(applicationSelect)
      .eq("project_id", projectId)
      .eq("applicant_organization_id", applicantOrganizationId)
      .in("status", ["submitted", "owner_countered"])
      .maybeSingle<ApplicationRow>();

    if (error) {
      throw error;
    }

    return data ? toApplicationRecord(data) : null;
  }

  async findActiveAgreement(
    projectId: string,
    partnerOrganizationId: string,
  ): Promise<CollaborationAgreementRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .select(agreementSelect)
      .eq("project_id", projectId)
      .eq("partner_organization_id", partnerOrganizationId)
      .eq("status", "active")
      .maybeSingle<AgreementRow>();

    if (error) {
      throw error;
    }

    return data ? toAgreementRecord(data) : null;
  }

  async createApplication(
    input: Omit<CollaborationApplicationRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationApplicationRecord> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .insert({
        share_id: input.shareId,
        project_id: input.projectId,
        owner_organization_id: input.ownerOrganizationId,
        applicant_organization_id: input.applicantOrganizationId,
        requested_revenue_share_bps: input.requestedRevenueShareBps,
        owner_counter_revenue_share_bps: input.ownerCounterRevenueShareBps,
        final_revenue_share_bps: input.finalRevenueShareBps,
        applicant_note: input.applicantNote,
        owner_review_note: input.ownerReviewNote,
        rejection_reason: input.rejectionReason,
        submitted_by: input.submittedBy,
        reviewed_by: input.reviewedBy,
        reviewed_at: input.reviewedAt,
        applicant_confirmed_by: input.applicantConfirmedBy,
        applicant_confirmed_at: input.applicantConfirmedAt,
      })
      .select(applicationSelect)
      .single<ApplicationRow>();

    if (error) {
      throw error;
    }

    return toApplicationRecord(data);
  }

  async listApplications(
    projectId: string,
  ): Promise<CollaborationApplicationRecord[]> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .select(applicationSelect)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ApplicationRow[]).map(toApplicationRecord);
  }

  async listApplicationsForApplicant(
    applicantOrganizationId: string,
  ): Promise<PartnerCollaborationApplicationRecord[]> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .select(`${applicationSelect}, projects(${projectSelect})`)
      .eq("applicant_organization_id", applicantOrganizationId)
      .in("status", ["submitted", "owner_countered"])
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as ApplicationWithProjectRow[])
      .map((row) => {
        const project = first(row.projects);
        return project
          ? {
              application: toApplicationRecord(row),
              project: toProjectRecord(project),
            }
          : null;
      })
      .filter((row): row is PartnerCollaborationApplicationRecord =>
        Boolean(row),
      );
  }

  async getApplication(
    applicationId: string,
  ): Promise<CollaborationApplicationRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .select(applicationSelect)
      .eq("id", applicationId)
      .maybeSingle<ApplicationRow>();

    if (error) {
      throw error;
    }

    return data ? toApplicationRecord(data) : null;
  }

  async updateApplication(
    applicationId: string,
    patch: Partial<CollaborationApplicationRecord>,
  ): Promise<CollaborationApplicationRecord> {
    const { data, error } = await this.client
      .from("project_collaboration_applications")
      .update(toApplicationPatchRow(patch))
      .eq("id", applicationId)
      .select(applicationSelect)
      .single<ApplicationRow>();

    if (error) {
      throw error;
    }

    return toApplicationRecord(data);
  }

  async getAgreementByApplicationId(
    applicationId: string,
  ): Promise<CollaborationAgreementRecord | null> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .select(agreementSelect)
      .eq("application_id", applicationId)
      .maybeSingle<AgreementRow>();

    if (error) {
      throw error;
    }

    return data ? toAgreementRecord(data) : null;
  }

  async createAgreement(
    input: Omit<CollaborationAgreementRecord, "id" | "status" | "createdAt">,
  ): Promise<CollaborationAgreementRecord> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .insert({
        application_id: input.applicationId,
        project_id: input.projectId,
        owner_organization_id: input.ownerOrganizationId,
        partner_organization_id: input.partnerOrganizationId,
        revenue_share_bps: input.revenueShareBps,
        settlement_basis: input.settlementBasis,
        owner_confirmed_by: input.ownerConfirmedBy,
        owner_confirmed_at: input.ownerConfirmedAt,
        partner_confirmed_by: input.partnerConfirmedBy,
        partner_confirmed_at: input.partnerConfirmedAt,
        status_reason: input.statusReason,
      })
      .select(agreementSelect)
      .single<AgreementRow>();

    if (error) {
      throw error;
    }

    return toAgreementRecord(data);
  }

  async listCollaborationProjectsForPartner(
    partnerOrganizationId: string,
  ): Promise<PartnerCollaborationProjectRecord[]> {
    const { data, error } = await this.client
      .from("project_collaboration_agreements")
      .select(`${agreementSelect}, projects(${projectSelect})`)
      .eq("partner_organization_id", partnerOrganizationId)
      .in("status", ["active", "suspended", "ended"])
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return ((data ?? []) as AgreementWithProjectRow[])
      .map((row) => {
        const project = first(row.projects);
        return project
          ? {
              agreement: toAgreementRecord(row),
              project: toProjectRecord(project),
            }
          : null;
      })
      .filter((row): row is PartnerCollaborationProjectRecord => Boolean(row));
  }
}

export async function createProjectCollaborationShare({
  repo,
  audit,
  actor,
  projectId,
  input,
  now = new Date().toISOString(),
  tokenFactory = createShareToken,
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  projectId: string;
  input: CreateCollaborationShareInput;
  now?: string;
  tokenFactory?: () => string;
}) {
  const project = await requireOwnedProject(repo, actor, projectId);
  if (!project.isOpenToMcnCollaboration) {
    throw new Error("Project is not open to MCN collaboration");
  }

  const token = tokenFactory();
  const share = await repo.createShare({
    ownerOrganizationId: project.ownerOrganizationId,
    projectId,
    tokenHash: hashShareSecret(token),
    expiresAt: input.expiresAt ?? daysFrom(now, 14),
    allowApplications: input.allowApplications ?? true,
    visibleFields: input.visibleFields ?? [...defaultVisibleFields],
    createdBy: actor.userId,
    revokedBy: null,
    revokedAt: null,
    lastViewedAt: null,
    lastSubmittedAt: null,
  });

  await audit?.({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create_collaboration_share",
    module: "project",
    objectType: "project_collaboration_share",
    objectId: share.id,
    projectId,
    changedFields: ["share"],
    after: toSafeShare(share),
  });

  return { share, token };
}

export async function revokeProjectCollaborationShare({
  repo,
  audit,
  actor,
  projectId,
  shareId,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  projectId: string;
  shareId: string;
  now?: string;
}) {
  await requireOwnedProject(repo, actor, projectId);
  await repo.revokeShare({
    shareId,
    projectId,
    revokedBy: actor.userId,
    revokedAt: now,
  });

  await audit?.({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "revoke_collaboration_share",
    module: "project",
    objectType: "project_collaboration_share",
    objectId: shareId,
    projectId,
    changedFields: ["status", "revoked_by", "revoked_at"],
  });
}

export async function listProjectCollaborationShares({
  repo,
  actor,
  projectId,
}: {
  repo: ProjectCollaborationRepository;
  actor: ProjectCollaborationActor;
  projectId: string;
}) {
  await requireOwnedProject(repo, actor, projectId);
  return repo.listShares(projectId);
}

export async function getPublicProjectCollaboration({
  repo,
  token,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  token: string;
  now?: string;
}) {
  const snapshot = await repo.getPublicShareByTokenHash(
    hashShareSecret(token.trim()),
  );
  if (!snapshot) {
    return unavailablePublicShare("Share link is not available");
  }
  if (
    snapshot.share.status !== "active" ||
    snapshot.share.expiresAt <= now ||
    !snapshot.project.isOpenToMcnCollaboration
  ) {
    return unavailablePublicShare("Share link is expired or revoked");
  }

  await repo.markShareViewed(snapshot.share.id, now);

  return {
    available: true as const,
    share: toPublicShare(snapshot.share),
    project: toPublicProject(snapshot.project, snapshot.share.visibleFields),
  };
}

export async function submitProjectCollaborationApplication({
  repo,
  audit,
  actor,
  token,
  input,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  token: string;
  input: SubmitCollaborationApplicationInput;
  now?: string;
}) {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN organization members can apply");
  }

  const snapshot = await requireAvailablePublicShare(repo, token, now);
  if (!snapshot.share.allowApplications) {
    throw new Error("Share link does not allow applications");
  }
  if (actor.organizationId === snapshot.project.ownerOrganizationId) {
    throw new Error("Applicant organization cannot be the project owner");
  }
  assertBasisPoints(input.requestedRevenueShareBps);

  const pending = await repo.findPendingApplication(
    snapshot.project.id,
    actor.organizationId,
  );
  if (pending) {
    throw new Error("Applicant already has a pending application");
  }

  const activeAgreement = await repo.findActiveAgreement(
    snapshot.project.id,
    actor.organizationId,
  );
  if (activeAgreement) {
    throw new Error("Applicant already has an active agreement");
  }

  const application = await repo.createApplication({
    shareId: snapshot.share.id,
    projectId: snapshot.project.id,
    ownerOrganizationId: snapshot.project.ownerOrganizationId,
    applicantOrganizationId: actor.organizationId,
    requestedRevenueShareBps: input.requestedRevenueShareBps,
    ownerCounterRevenueShareBps: null,
    finalRevenueShareBps: null,
    applicantNote: input.applicantNote?.trim() || "",
    ownerReviewNote: "",
    rejectionReason: "",
    submittedBy: actor.userId,
    reviewedBy: null,
    reviewedAt: null,
    applicantConfirmedBy: null,
    applicantConfirmedAt: null,
  });
  await repo.markShareSubmitted(snapshot.share.id, now);

  await audit?.({
    organizationId: snapshot.project.ownerOrganizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "submit_collaboration_application",
    module: "project",
    objectType: "project_collaboration_application",
    objectId: application.id,
    projectId: snapshot.project.id,
    after: application,
    changedFields: ["application"],
  });

  return application;
}

export async function submitProjectCollaborationInviteApplication({
  repo,
  audit,
  actor,
  input,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  input: AcceptCollaborationInviteInput;
  now?: string;
}) {
  const token = extractProjectCollaborationInviteToken(input.inviteLink);
  const application = await submitProjectCollaborationApplication({
    repo,
    audit,
    actor,
    token,
    input: {
      requestedRevenueShareBps: input.requestedRevenueShareBps ?? 0,
      applicantNote: input.applicantNote,
    },
    now,
  });
  const snapshot = await requireAvailablePublicShare(repo, token, now);

  return {
    application,
    project: toPublicProject(snapshot.project, snapshot.share.visibleFields),
    pendingOwnerReview: true as const,
  };
}

export async function listProjectCollaborationApplications({
  repo,
  actor,
  projectId,
}: {
  repo: ProjectCollaborationRepository;
  actor: ProjectCollaborationActor;
  projectId: string;
}) {
  await requireOwnedProject(repo, actor, projectId);
  return repo.listApplications(projectId);
}

export async function reviewProjectCollaborationApplication({
  repo,
  audit,
  actor,
  projectId,
  applicationId,
  input,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  projectId: string;
  applicationId: string;
  input: ReviewCollaborationApplicationInput;
  now?: string;
}) {
  await requireOwnedProject(repo, actor, projectId);
  const application = await requireApplication(repo, applicationId, projectId);

  if (application.status !== "submitted") {
    throw new Error("Only submitted applications can be reviewed");
  }

  if (input.action === "accept") {
    const activated = await activateAgreementFromApplication({
      repo,
      application,
      revenueShareBps: application.requestedRevenueShareBps,
      ownerActor: actor,
      ownerReviewNote: input.ownerReviewNote,
      partnerConfirmedBy: application.submittedBy,
      partnerConfirmedAt: application.createdAt ?? now,
      now,
    });
    await auditReview(audit, actor, activated.application, "accept");
    return activated;
  }

  if (input.action === "counter") {
    assertBasisPoints(input.ownerCounterRevenueShareBps);
    const countered = await repo.updateApplication(application.id, {
      status: "owner_countered",
      ownerCounterRevenueShareBps: input.ownerCounterRevenueShareBps,
      ownerReviewNote: input.ownerReviewNote?.trim() || "",
      reviewedBy: actor.userId,
      reviewedAt: now,
    });
    await auditReview(audit, actor, countered, "counter");
    return { application: countered, agreement: null };
  }

  const rejectionReason =
    input.rejectionReason?.trim() || input.ownerReviewNote?.trim() || "";
  if (!rejectionReason) {
    throw new Error("Rejection requires a reason");
  }
  const rejected = await repo.updateApplication(application.id, {
    status: "rejected",
    ownerReviewNote: input.ownerReviewNote?.trim() || "",
    rejectionReason,
    reviewedBy: actor.userId,
    reviewedAt: now,
  });
  await auditReview(audit, actor, rejected, "reject");
  return { application: rejected, agreement: null };
}

export async function confirmProjectCollaborationCounter({
  repo,
  audit,
  actor,
  projectId,
  applicationId,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  projectId: string;
  applicationId: string;
  now?: string;
}) {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN organization members can confirm a counter");
  }

  const application = await requireApplication(repo, applicationId, projectId);
  if (application.applicantOrganizationId !== actor.organizationId) {
    throw new Error("Only the applicant organization can confirm a counter");
  }
  if (application.status !== "owner_countered") {
    throw new Error("Application is not waiting for counter confirmation");
  }
  if (application.ownerCounterRevenueShareBps === null) {
    throw new Error("Counter offer is missing");
  }

  const activated = await activateAgreementFromApplication({
    repo,
    application,
    revenueShareBps: application.ownerCounterRevenueShareBps,
    ownerActor: {
      userId: application.reviewedBy ?? actor.userId,
    },
    ownerReviewNote: application.ownerReviewNote,
    partnerConfirmedBy: actor.userId,
    partnerConfirmedAt: now,
    now,
  });
  await audit?.({
    organizationId: application.ownerOrganizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "confirm_collaboration_counter",
    module: "project",
    objectType: "project_collaboration_application",
    objectId: application.id,
    projectId: application.projectId,
    after: activated.application,
    changedFields: ["status", "final_revenue_share_bps"],
  });

  return activated;
}

export async function listPartnerCollaborationApplications({
  repo,
  actor,
}: {
  repo: ProjectCollaborationRepository;
  actor: ProjectCollaborationActor;
}) {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN organization members can read collaborations");
  }

  const rows = await repo.listApplicationsForApplicant(actor.organizationId);
  return rows.map(({ application, project }) => ({
    application,
    project: toPublicProject(project),
  }));
}

export async function listPartnerCollaborationProjects({
  repo,
  actor,
}: {
  repo: ProjectCollaborationRepository;
  actor: ProjectCollaborationActor;
}) {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN organization members can read collaborations");
  }

  const rows = await repo.listCollaborationProjectsForPartner(
    actor.organizationId,
  );
  return rows.map(({ agreement, project }) => ({
    agreement: {
      id: agreement.id,
      status: agreement.status,
      revenueShareBps: agreement.revenueShareBps,
      settlementBasis: agreement.settlementBasis,
    },
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      ownerOrganizationName: project.ownerOrganizationName,
      collaborationSummary: project.collaborationSummary,
    },
  }));
}

export function createShareToken() {
  return randomBytes(32).toString("base64url");
}

export function hashShareSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertCanManage(role: AppRole) {
  if (!canPublishProject(role)) {
    throw new Error(
      "Only owner and ops_manager can manage project collaboration",
    );
  }
}

async function requireOwnedProject(
  repo: ProjectCollaborationRepository,
  actor: ProjectCollaborationActor,
  projectId: string,
) {
  assertCanManage(actor.role);
  const project = await repo.getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.ownerOrganizationId !== actor.organizationId) {
    throw new Error(
      "Only the project owner organization can manage collaboration",
    );
  }
  return project;
}

async function requireApplication(
  repo: ProjectCollaborationRepository,
  applicationId: string,
  projectId: string,
) {
  const application = await repo.getApplication(applicationId);
  if (!application || application.projectId !== projectId) {
    throw new Error("Collaboration application not found");
  }
  return application;
}

async function requireAvailablePublicShare(
  repo: ProjectCollaborationRepository,
  token: string,
  now: string,
) {
  const snapshot = await repo.getPublicShareByTokenHash(
    hashShareSecret(token.trim()),
  );
  if (!snapshot) {
    throw new Error("Share link is not available");
  }
  if (
    snapshot.share.status !== "active" ||
    snapshot.share.expiresAt <= now ||
    !snapshot.project.isOpenToMcnCollaboration
  ) {
    throw new Error("Share link is expired or revoked");
  }
  return snapshot;
}

async function activateAgreementFromApplication({
  repo,
  application,
  revenueShareBps,
  ownerActor,
  ownerReviewNote,
  partnerConfirmedBy,
  partnerConfirmedAt,
  now,
}: {
  repo: ProjectCollaborationRepository;
  application: CollaborationApplicationRecord;
  revenueShareBps: number;
  ownerActor: Pick<ProjectCollaborationActor, "userId">;
  ownerReviewNote?: string;
  partnerConfirmedBy: string | null;
  partnerConfirmedAt: string | null;
  now: string;
}) {
  const existing = await repo.getAgreementByApplicationId(application.id);
  if (existing) {
    return { application, agreement: existing };
  }
  const activeAgreement = await repo.findActiveAgreement(
    application.projectId,
    application.applicantOrganizationId,
  );
  if (activeAgreement) {
    throw new Error("Applicant already has an active agreement");
  }
  await assertApplicationShareIsActive(repo, application);

  const approved = await repo.updateApplication(application.id, {
    status: "approved",
    finalRevenueShareBps: revenueShareBps,
    ownerReviewNote: ownerReviewNote?.trim() ?? application.ownerReviewNote,
    reviewedBy: application.reviewedBy ?? ownerActor.userId,
    reviewedAt: application.reviewedAt ?? now,
    applicantConfirmedBy: partnerConfirmedBy,
    applicantConfirmedAt: partnerConfirmedAt,
  });
  const agreement = await repo.createAgreement({
    applicationId: approved.id,
    projectId: approved.projectId,
    ownerOrganizationId: approved.ownerOrganizationId,
    partnerOrganizationId: approved.applicantOrganizationId,
    revenueShareBps,
    settlementBasis: "project_revenue",
    ownerConfirmedBy: ownerActor.userId,
    ownerConfirmedAt: now,
    partnerConfirmedBy,
    partnerConfirmedAt,
    statusReason: null,
  });

  return { application: approved, agreement };
}

async function assertApplicationShareIsActive(
  repo: ProjectCollaborationRepository,
  application: CollaborationApplicationRecord,
) {
  const shares = await repo.listShares(application.projectId);
  const share = shares.find((item) => item.id === application.shareId);
  if (
    !share ||
    share.projectId !== application.projectId ||
    share.ownerOrganizationId !== application.ownerOrganizationId ||
    share.status !== "active"
  ) {
    throw new Error("Collaboration application is inconsistent with its share");
  }
}

function assertBasisPoints(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error("Revenue share must be between 0 and 10000 basis points");
  }
}

function extractProjectCollaborationInviteToken(inviteLink: string) {
  const text = String(inviteLink || "").trim();
  if (!text) {
    throw new Error("Invitation link is required");
  }

  try {
    const url = new URL(text, "http://localhost");
    const match = url.pathname.match(
      /\/share\/project-collaboration\/([^/?#]+)/,
    );
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    // Fall back to treating the value as a raw token.
  }

  return text.split(/[/?#]/)[0];
}

async function auditReview(
  audit: ProjectCollaborationAuditWriter | undefined,
  actor: ProjectCollaborationActor,
  application: CollaborationApplicationRecord,
  action: "accept" | "reject" | "counter",
) {
  await audit?.({
    organizationId: application.ownerOrganizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "review_collaboration_application",
    module: "project",
    objectType: "project_collaboration_application",
    objectId: application.id,
    projectId: application.projectId,
    after: { action, application },
    changedFields: ["status"],
  });
}

function unavailablePublicShare(reason: string) {
  return {
    available: false as const,
    reason,
  };
}

function toSafeShare(share: CollaborationShareRecord) {
  return {
    id: share.id,
    projectId: share.projectId,
    status: share.status,
    expiresAt: share.expiresAt,
    allowApplications: share.allowApplications,
    createdBy: share.createdBy,
    createdAt: share.createdAt,
  };
}

function toPublicShare(share: CollaborationShareRecord) {
  return {
    status: share.status,
    expiresAt: share.expiresAt,
    allowApplications: share.allowApplications,
  };
}

function toPublicProject(
  project: CollaborationProjectRecord,
  visibleFields: string[] = defaultVisibleFields,
) {
  const show = (field: string) => visibleFields.includes(field);
  return {
    id: project.id,
    name: show("projectName") ? project.name : "",
    code: project.code,
    ownerOrganizationName: project.ownerOrganizationName,
    collaborationSummary: show("collaborationSummary")
      ? project.collaborationSummary
      : "",
    collaborationTerms: show("collaborationTerms")
      ? project.collaborationTerms
      : {},
  };
}

const defaultVisibleFields = [
  "projectName",
  "collaborationSummary",
  "collaborationTerms",
];

function daysFrom(now: string, days: number) {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

const projectSelect = `
  id,
  organization_id,
  name,
  code,
  is_open_to_mcn_collaboration,
  mcn_collaboration_summary,
  mcn_collaboration_terms,
  organizations(name)
`;

const shareSelect = `
  id,
  owner_organization_id,
  project_id,
  token_hash,
  status,
  expires_at,
  allow_applications,
  visible_fields,
  created_by,
  revoked_by,
  revoked_at,
  last_viewed_at,
  last_submitted_at,
  created_at
`;

const applicationSelect = `
  id,
  share_id,
  project_id,
  owner_organization_id,
  applicant_organization_id,
  requested_revenue_share_bps,
  owner_counter_revenue_share_bps,
  final_revenue_share_bps,
  status,
  applicant_note,
  owner_review_note,
  rejection_reason,
  submitted_by,
  reviewed_by,
  reviewed_at,
  applicant_confirmed_by,
  applicant_confirmed_at,
  created_at
`;

const agreementSelect = `
  id,
  application_id,
  project_id,
  owner_organization_id,
  partner_organization_id,
  revenue_share_bps,
  settlement_basis,
  status,
  owner_confirmed_by,
  owner_confirmed_at,
  partner_confirmed_by,
  partner_confirmed_at,
  status_reason,
  created_at
`;

type ProjectRow = {
  id: string;
  organization_id: string;
  name: string | null;
  code: string | null;
  is_open_to_mcn_collaboration: boolean | null;
  mcn_collaboration_summary: string | null;
  mcn_collaboration_terms: Record<string, unknown> | null;
  organizations:
    | { name: string | null }
    | Array<{ name: string | null }>
    | null;
};

type ShareRow = {
  id: string;
  owner_organization_id: string;
  project_id: string;
  token_hash: string;
  status: CollaborationShareStatus;
  expires_at: string;
  allow_applications: boolean;
  visible_fields: string[] | null;
  created_by: string;
  revoked_by: string | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  last_submitted_at: string | null;
  created_at?: string;
};

type ShareWithProjectRow = ShareRow & {
  projects: ProjectRow | ProjectRow[] | null;
};

type AgreementWithProjectRow = AgreementRow & {
  projects: ProjectRow | ProjectRow[] | null;
};

type ApplicationWithProjectRow = ApplicationRow & {
  projects: ProjectRow | ProjectRow[] | null;
};

type ApplicationRow = {
  id: string;
  share_id: string;
  project_id: string;
  owner_organization_id: string;
  applicant_organization_id: string;
  requested_revenue_share_bps: number;
  owner_counter_revenue_share_bps: number | null;
  final_revenue_share_bps: number | null;
  status: CollaborationApplicationStatus;
  applicant_note: string | null;
  owner_review_note: string | null;
  rejection_reason: string | null;
  submitted_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applicant_confirmed_by: string | null;
  applicant_confirmed_at: string | null;
  created_at?: string;
};

type AgreementRow = {
  id: string;
  application_id: string;
  project_id: string;
  owner_organization_id: string;
  partner_organization_id: string;
  revenue_share_bps: number;
  settlement_basis: "project_revenue";
  status: CollaborationAgreementStatus;
  owner_confirmed_by: string;
  owner_confirmed_at: string;
  partner_confirmed_by: string | null;
  partner_confirmed_at: string | null;
  status_reason: string | null;
  created_at?: string;
};

function toProjectRecord(row: ProjectRow): CollaborationProjectRecord {
  const organization = first(row.organizations);
  return {
    id: row.id,
    ownerOrganizationId: row.organization_id,
    ownerOrganizationName: organization?.name?.trim() || "",
    name: row.name?.trim() || "",
    code: row.code?.trim() || "",
    isOpenToMcnCollaboration: Boolean(row.is_open_to_mcn_collaboration),
    collaborationSummary: row.mcn_collaboration_summary?.trim() || "",
    collaborationTerms: row.mcn_collaboration_terms ?? {},
  };
}

function toShareRecord(row: ShareRow): CollaborationShareRecord {
  return {
    id: row.id,
    ownerOrganizationId: row.owner_organization_id,
    projectId: row.project_id,
    tokenHash: row.token_hash,
    status: row.status,
    expiresAt: row.expires_at,
    allowApplications: row.allow_applications,
    visibleFields: row.visible_fields ?? [],
    createdBy: row.created_by,
    revokedBy: row.revoked_by,
    revokedAt: row.revoked_at,
    lastViewedAt: row.last_viewed_at,
    lastSubmittedAt: row.last_submitted_at,
    createdAt: row.created_at,
  };
}

function toApplicationRecord(
  row: ApplicationRow,
): CollaborationApplicationRecord {
  return {
    id: row.id,
    shareId: row.share_id,
    projectId: row.project_id,
    ownerOrganizationId: row.owner_organization_id,
    applicantOrganizationId: row.applicant_organization_id,
    requestedRevenueShareBps: row.requested_revenue_share_bps,
    ownerCounterRevenueShareBps: row.owner_counter_revenue_share_bps,
    finalRevenueShareBps: row.final_revenue_share_bps,
    status: row.status,
    applicantNote: row.applicant_note?.trim() || "",
    ownerReviewNote: row.owner_review_note?.trim() || "",
    rejectionReason: row.rejection_reason?.trim() || "",
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    applicantConfirmedBy: row.applicant_confirmed_by,
    applicantConfirmedAt: row.applicant_confirmed_at,
    createdAt: row.created_at,
  };
}

function toAgreementRecord(row: AgreementRow): CollaborationAgreementRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    projectId: row.project_id,
    ownerOrganizationId: row.owner_organization_id,
    partnerOrganizationId: row.partner_organization_id,
    revenueShareBps: row.revenue_share_bps,
    settlementBasis: row.settlement_basis,
    status: row.status,
    ownerConfirmedBy: row.owner_confirmed_by,
    ownerConfirmedAt: row.owner_confirmed_at,
    partnerConfirmedBy: row.partner_confirmed_by,
    partnerConfirmedAt: row.partner_confirmed_at,
    statusReason: row.status_reason,
    createdAt: row.created_at,
  };
}

function toApplicationPatchRow(patch: Partial<CollaborationApplicationRecord>) {
  return removeUndefined({
    owner_counter_revenue_share_bps: patch.ownerCounterRevenueShareBps,
    final_revenue_share_bps: patch.finalRevenueShareBps,
    status: patch.status,
    applicant_note: patch.applicantNote,
    owner_review_note: patch.ownerReviewNote,
    rejection_reason: patch.rejectionReason,
    reviewed_by: patch.reviewedBy,
    reviewed_at: patch.reviewedAt,
    applicant_confirmed_by: patch.applicantConfirmedBy,
    applicant_confirmed_at: patch.applicantConfirmedAt,
  });
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
