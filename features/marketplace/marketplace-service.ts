// 撮合论坛服务层：发布需求、投递接单、审核、达成。承载状态机守卫与权限校验
// （成交路径受控：仅发单方审核通过 + 接单方确认才达成）。仓储经 RepoPort 注入，可单测。

import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import {
  canConfirmDeal,
  canReview,
  postingAcceptsApplications,
  reviewTarget,
  type ReviewAction,
} from "./marketplace-state";
import type {
  ApplicationPublic,
  CreatePostingInput,
  DealRecord,
  PostingPublic,
  SubmitApplicationInput,
} from "./marketplace-types";

export type MarketplaceActor = {
  userId: string;
  name?: string | null;
  role: AppRole;
  organizationId: string;
};

export type AuditFn = (input: {
  action: string;
  objectType: string;
  objectId?: string;
  after?: Record<string, unknown>;
  changedFields?: string[];
}) => Promise<void> | void;

export type RepoPort = {
  getPostingById(id: string): Promise<PostingPublic | null>;
  createPosting(input: {
    organizationId: string;
    createdBy: string;
    postType: "demand" | "supply";
    status: "draft" | "open";
    title: string;
    productName: string | null;
    category: string | null;
    budgetCents: number | null;
    settlementMethod: string | null;
    requirements: string | null;
    description: string | null;
    deadlineAt: string | null;
    details: Record<string, unknown>;
  }): Promise<PostingPublic>;
  upsertPostingPrivate(input: {
    postingId: string;
    organizationId: string;
    contact: string | null;
    discloseAfterDeal: Record<string, unknown>;
  }): Promise<void>;
  updatePostingStatus(id: string, status: string): Promise<void>;
  getApplicationById(id: string): Promise<ApplicationPublic | null>;
  createApplication(input: {
    postingId: string;
    applicantOrganizationId: string;
    createdBy: string;
    status: "submitted";
    streamerLineup: string | null;
    pastCases: string | null;
    quoteCents: number | null;
    resources: string | null;
    message: string | null;
    submittedAt: string;
  }): Promise<ApplicationPublic>;
  updateApplication(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ApplicationPublic>;
  upsertApplicationPrivate(input: {
    applicationId: string;
    applicantOrganizationId: string;
    contact: string | null;
  }): Promise<void>;
  createDeal(input: {
    postingId: string;
    applicationId: string;
    ownerOrganizationId: string;
    applicantOrganizationId: string;
    createdBy: string;
  }): Promise<DealRecord>;
};

export class MarketplaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};
const nonNegInt = (v: unknown): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 0 ? n : null;
};

export async function publishPosting(
  repo: RepoPort,
  audit: AuditFn,
  actor: MarketplaceActor,
  input: CreatePostingInput,
): Promise<PostingPublic> {
  if (!isMcnStaff(actor.role)) {
    throw new MarketplaceError("Only MCN staff can publish postings", 403);
  }
  const title = clean(input.title);
  if (!title) throw new MarketplaceError("title is required", 400);

  const posting = await repo.createPosting({
    organizationId: actor.organizationId,
    createdBy: actor.userId,
    postType: input.postType === "supply" ? "supply" : "demand",
    status: input.publish === false ? "draft" : "open",
    title,
    productName: clean(input.productName),
    category: clean(input.category),
    budgetCents: nonNegInt(input.budgetCents),
    settlementMethod: clean(input.settlementMethod),
    requirements: clean(input.requirements),
    description: clean(input.description),
    deadlineAt: clean(input.deadlineAt),
    details:
      input.details && typeof input.details === "object" ? input.details : {},
  });

  const contact = clean(input.contact);
  const disclose =
    input.discloseAfterDeal && typeof input.discloseAfterDeal === "object"
      ? input.discloseAfterDeal
      : {};
  if (contact || Object.keys(disclose).length) {
    await repo.upsertPostingPrivate({
      postingId: posting.id,
      organizationId: actor.organizationId,
      contact,
      discloseAfterDeal: disclose,
    });
  }

  await audit({
    action: "create",
    objectType: "marketplace_posting",
    objectId: posting.id,
    after: { status: posting.status, title: posting.title },
    changedFields: ["status"],
  });
  return posting;
}

export async function submitApplication(
  repo: RepoPort,
  audit: AuditFn,
  actor: MarketplaceActor,
  postingId: string,
  input: SubmitApplicationInput,
  now: string,
): Promise<ApplicationPublic> {
  if (!isMcnStaff(actor.role)) {
    throw new MarketplaceError("Only MCN staff can submit applications", 403);
  }
  const posting = await repo.getPostingById(postingId);
  if (!posting) throw new MarketplaceError("Posting not found", 404);
  if (posting.organizationId === actor.organizationId) {
    throw new MarketplaceError("Cannot apply to your own posting", 400);
  }
  if (!postingAcceptsApplications(posting.status)) {
    throw new MarketplaceError("Posting is not open for applications", 400);
  }

  const application = await repo.createApplication({
    postingId,
    applicantOrganizationId: actor.organizationId,
    createdBy: actor.userId,
    status: "submitted",
    streamerLineup: clean(input.streamerLineup),
    pastCases: clean(input.pastCases),
    quoteCents: nonNegInt(input.quoteCents),
    resources: clean(input.resources),
    message: clean(input.message),
    submittedAt: now,
  });

  const contact = clean(input.contact);
  if (contact) {
    await repo.upsertApplicationPrivate({
      applicationId: application.id,
      applicantOrganizationId: actor.organizationId,
      contact,
    });
  }

  await audit({
    action: "create",
    objectType: "marketplace_application",
    objectId: application.id,
    after: { postingId, status: "submitted" },
    changedFields: ["status"],
  });
  return application;
}

export async function reviewApplication(
  repo: RepoPort,
  audit: AuditFn,
  actor: MarketplaceActor,
  applicationId: string,
  action: ReviewAction,
  note: string | null,
  now: string,
): Promise<ApplicationPublic> {
  const application = await repo.getApplicationById(applicationId);
  if (!application) throw new MarketplaceError("Application not found", 404);
  const posting = await repo.getPostingById(application.postingId);
  if (!posting) throw new MarketplaceError("Posting not found", 404);
  if (
    posting.organizationId !== actor.organizationId ||
    !isMcnStaff(actor.role)
  ) {
    throw new MarketplaceError("Only the posting owner can review", 403);
  }
  const target = reviewTarget(action);
  if (!target || !canReview(application.status, action)) {
    throw new MarketplaceError(
      `Cannot ${action} an application in status ${application.status}`,
      400,
    );
  }

  const updated = await repo.updateApplication(applicationId, {
    status: target,
    review_note: note ?? null,
    reviewed_by: actor.userId,
    reviewed_at: now,
  });

  await audit({
    action:
      action === "approve" ? "approve" : action === "reject" ? "reject" : "update",
    objectType: "marketplace_application",
    objectId: applicationId,
    after: { status: target },
    changedFields: ["status", "review_note"],
  });
  return updated;
}

// 达成：接单方对「已通过」的投递确认 → 落撮合关系（pending_collaboration），
// 投递转 deal_confirmed，需求转 matched。按决策，达成生成「待确认协作申请」的
// 深度桥接放后续期（此处先记录撮合关系，作为权益归属依据）。
export async function confirmDeal(
  repo: RepoPort,
  audit: AuditFn,
  actor: MarketplaceActor,
  applicationId: string,
): Promise<DealRecord> {
  const application = await repo.getApplicationById(applicationId);
  if (!application) throw new MarketplaceError("Application not found", 404);
  if (
    application.applicantOrganizationId !== actor.organizationId ||
    !isMcnStaff(actor.role)
  ) {
    throw new MarketplaceError("Only the applicant can confirm the deal", 403);
  }
  if (!canConfirmDeal(application.status)) {
    throw new MarketplaceError(
      "Only an approved application can be confirmed",
      400,
    );
  }
  const posting = await repo.getPostingById(application.postingId);
  if (!posting) throw new MarketplaceError("Posting not found", 404);

  const deal = await repo.createDeal({
    postingId: application.postingId,
    applicationId,
    ownerOrganizationId: posting.organizationId,
    applicantOrganizationId: actor.organizationId,
    createdBy: actor.userId,
  });
  await repo.updateApplication(applicationId, { status: "deal_confirmed" });
  await repo.updatePostingStatus(application.postingId, "matched");

  await audit({
    action: "create",
    objectType: "marketplace_deal",
    objectId: deal.id,
    after: { postingId: application.postingId, status: deal.status },
    changedFields: ["status"],
  });
  return deal;
}
