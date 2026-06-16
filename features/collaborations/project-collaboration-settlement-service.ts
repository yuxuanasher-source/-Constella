import type { AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

export type CollaborationSettlementBatchType = "partner_receivable";
export type CollaborationSettlementBatchStatus =
  | "generated"
  | "partner_confirmed"
  | "partner_disputed"
  | "locked"
  | "reopened"
  | "voided";

export type CollaborationSettlementActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CollaborationSettlementAgreementRecord = {
  id: string;
  projectId: string;
  ownerOrganizationId: string;
  partnerOrganizationId: string;
  revenueShareBps: number;
  status: "active" | "suspended" | "ended";
};

export type CollaborationSettlementRevenueRecord = {
  id: string;
  agreementId: string;
  projectId: string;
  ownerOrganizationId: string;
  partnerOrganizationId: string;
  periodStart: string;
  periodEnd: string;
  revenueAmount: number;
  status: "draft" | "confirmed" | "voided";
  evidenceSnapshot?: Record<string, unknown>;
};

export type CollaborationSettlementBatchRecord = {
  id: string;
  agreementId: string;
  projectId: string;
  ownerOrganizationId: string;
  partnerOrganizationId: string;
  batchType: CollaborationSettlementBatchType;
  status: CollaborationSettlementBatchStatus;
  periodStart: string;
  periodEnd: string;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceSummary: Record<string, unknown>;
  partnerResponseReason?: string | null;
  lockReason?: string | null;
  reopenReason?: string | null;
  voidReason?: string | null;
  createdBy?: string | null;
};

export type CollaborationSettlementItemRecord = {
  id: string;
  settlementBatchId: string;
  agreementId: string;
  revenueRecordId: string;
  projectId: string;
  ownerOrganizationId: string;
  partnerOrganizationId: string;
  batchType: CollaborationSettlementBatchType;
  itemType: "project_revenue_share";
  revenueAmount: number;
  revenueShareBps: number;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceSnapshot: Record<string, unknown>;
};

export type CollaborationSettlementRepository = {
  getAgreementById(
    agreementId: string,
  ): Promise<CollaborationSettlementAgreementRecord | null>;
  listRevenueRecords(input: {
    agreementId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<CollaborationSettlementRevenueRecord[]>;
  listConsumedRevenueRecordIds(input: {
    agreementId: string;
    batchType: CollaborationSettlementBatchType;
  }): Promise<string[]>;
  createSettlementBatch(
    input: Omit<CollaborationSettlementBatchRecord, "id"> & {
      createdBy: string;
    },
  ): Promise<CollaborationSettlementBatchRecord>;
  createSettlementItem(
    input: Omit<CollaborationSettlementItemRecord, "id">,
  ): Promise<CollaborationSettlementItemRecord>;
  getSettlementBatchById(
    batchId: string,
  ): Promise<CollaborationSettlementBatchRecord | null>;
  updateSettlementBatch(
    batchId: string,
    patch: Partial<CollaborationSettlementBatchRecord> & {
      partnerRespondedBy?: string;
      partnerRespondedAt?: string;
      lockedBy?: string;
      lockedAt?: string;
      reopenedBy?: string;
      reopenedAt?: string;
      voidedBy?: string;
      voidedAt?: string;
    },
  ): Promise<CollaborationSettlementBatchRecord>;
};

export type CollaborationSettlementAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export async function generateCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  input,
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  input: {
    agreementId: string;
    periodStart: string;
    periodEnd: string;
  };
}) {
  assertCanGenerate(actor.role);
  assertPeriod(input.periodStart, input.periodEnd);
  const agreement = await requireAgreement(repo, input.agreementId);
  assertOwnerOrganization(actor, agreement.ownerOrganizationId);
  if (agreement.status !== "active") {
    throw new Error("Only active collaboration agreements can be settled");
  }

  const revenueRecords = await repo.listRevenueRecords({
    agreementId: agreement.id,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  const confirmed = revenueRecords.filter(
    (record) => record.status === "confirmed",
  );
  if (confirmed.length === 0) {
    throw new Error("No confirmed collaboration revenue records found");
  }

  const consumed = new Set(
    await repo.listConsumedRevenueRecordIds({
      agreementId: agreement.id,
      batchType: "partner_receivable",
    }),
  );
  const unconsumed = confirmed.filter((record) => !consumed.has(record.id));
  if (unconsumed.length === 0) {
    throw new Error("No unconsumed collaboration revenue records found");
  }

  const items = unconsumed.map((record) => ({
    record,
    amount: calculatePartnerAmount(
      record.revenueAmount,
      agreement.revenueShareBps,
    ),
  }));
  const computedAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const evidenceSummary = {
    revenueRecordCount: items.length,
    revenueAmount: unconsumed.reduce(
      (sum, record) => sum + record.revenueAmount,
      0,
    ),
    revenueShareBps: agreement.revenueShareBps,
  };

  const batch = await repo.createSettlementBatch({
    agreementId: agreement.id,
    projectId: agreement.projectId,
    ownerOrganizationId: agreement.ownerOrganizationId,
    partnerOrganizationId: agreement.partnerOrganizationId,
    batchType: "partner_receivable",
    status: "generated",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    computedAmount,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary,
    createdBy: actor.userId,
  });
  const createdItems = [];
  for (const item of items) {
    createdItems.push(
      await repo.createSettlementItem({
        settlementBatchId: batch.id,
        agreementId: agreement.id,
        revenueRecordId: item.record.id,
        projectId: agreement.projectId,
        ownerOrganizationId: agreement.ownerOrganizationId,
        partnerOrganizationId: agreement.partnerOrganizationId,
        batchType: "partner_receivable",
        itemType: "project_revenue_share",
        revenueAmount: item.record.revenueAmount,
        revenueShareBps: agreement.revenueShareBps,
        computedAmount: item.amount,
        manualAmount: 0,
        adjustmentAmount: 0,
        evidenceSnapshot: {
          revenueRecordId: item.record.id,
          revenueAmount: item.record.revenueAmount,
          revenueShareBps: agreement.revenueShareBps,
          source: item.record.evidenceSnapshot ?? {},
        },
      }),
    );
  }

  await auditSettlement(audit, actor, batch, "create", ["status"]);
  return { batch, items: createdItems };
}

export async function confirmCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  batchId,
  now = new Date().toISOString(),
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  batchId: string;
  now?: string;
}) {
  const before = await requireBatch(repo, batchId);
  assertPartnerOrganization(actor, before.partnerOrganizationId);
  assertStatusIn(before.status, ["generated", "reopened"], "confirm");
  const after = await repo.updateSettlementBatch(batchId, {
    status: "partner_confirmed",
    partnerRespondedBy: actor.userId,
    partnerRespondedAt: now,
  });
  await auditSettlement(audit, actor, after, "update", ["status"]);
  return after;
}

export async function disputeCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  batchId: string;
  reason: string;
  now?: string;
}) {
  assertReason(reason, "Dispute reason is required");
  const before = await requireBatch(repo, batchId);
  assertPartnerOrganization(actor, before.partnerOrganizationId);
  assertStatusIn(before.status, ["generated", "reopened"], "dispute");
  const after = await repo.updateSettlementBatch(batchId, {
    status: "partner_disputed",
    partnerResponseReason: reason.trim(),
    partnerRespondedBy: actor.userId,
    partnerRespondedAt: now,
  });
  await auditSettlement(audit, actor, after, "update", ["status"]);
  return after;
}

export async function lockCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  batchId: string;
  reason: string;
  now?: string;
}) {
  assertCanLock(actor.role);
  assertReason(reason, "Lock reason is required");
  const before = await requireBatch(repo, batchId);
  assertOwnerOrganization(actor, before.ownerOrganizationId);
  assertStatusIn(
    before.status,
    ["generated", "partner_confirmed", "partner_disputed"],
    "lock",
  );
  const after = await repo.updateSettlementBatch(batchId, {
    status: "locked",
    lockReason: reason.trim(),
    lockedBy: actor.userId,
    lockedAt: now,
  });
  await auditSettlement(audit, actor, after, "lock", ["status", "lock_reason"]);
  return after;
}

export async function reopenCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  batchId: string;
  reason: string;
  now?: string;
}) {
  if (actor.role !== "owner") {
    throw new Error("Only owners can reopen settlement batches");
  }
  assertReason(reason, "Reopen reason is required");
  const before = await requireBatch(repo, batchId);
  assertOwnerOrganization(actor, before.ownerOrganizationId);
  assertStatusIn(before.status, ["locked"], "reopen");
  const after = await repo.updateSettlementBatch(batchId, {
    status: "reopened",
    reopenReason: reason.trim(),
    reopenedBy: actor.userId,
    reopenedAt: now,
  });
  await auditSettlement(audit, actor, after, "reopen", [
    "status",
    "reopen_reason",
  ]);
  return after;
}

export async function voidCollaborationSettlementBatch({
  repo,
  audit,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: CollaborationSettlementRepository;
  audit: CollaborationSettlementAuditWriter;
  actor: CollaborationSettlementActor;
  batchId: string;
  reason: string;
  now?: string;
}) {
  assertCanGenerate(actor.role);
  assertReason(reason, "Void reason is required");
  const before = await requireBatch(repo, batchId);
  assertOwnerOrganizationForVoid(actor, before.ownerOrganizationId);
  assertStatusIn(
    before.status,
    ["generated", "partner_confirmed", "partner_disputed", "reopened"],
    "void",
  );
  const after = await repo.updateSettlementBatch(batchId, {
    status: "voided",
    voidReason: reason.trim(),
    voidedBy: actor.userId,
    voidedAt: now,
  });
  await auditSettlement(audit, actor, after, "void", ["status", "void_reason"]);
  return after;
}

function calculatePartnerAmount(
  revenueAmount: number,
  revenueShareBps: number,
) {
  return Math.round((revenueAmount * revenueShareBps) / 10000);
}

async function requireAgreement(
  repo: Pick<CollaborationSettlementRepository, "getAgreementById">,
  agreementId: string,
) {
  const agreement = await repo.getAgreementById(agreementId);
  if (!agreement) {
    throw new Error("Collaboration agreement not found");
  }
  return agreement;
}

async function requireBatch(
  repo: Pick<CollaborationSettlementRepository, "getSettlementBatchById">,
  batchId: string,
) {
  const batch = await repo.getSettlementBatchById(batchId);
  if (!batch) {
    throw new Error("Collaboration settlement batch not found");
  }
  return batch;
}

function assertCanGenerate(role: AppRole) {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "operator_business"
  ) {
    throw new Error("Current role cannot manage collaboration settlement");
  }
}

function assertCanLock(role: AppRole) {
  if (role !== "owner" && role !== "ops_manager" && role !== "finance") {
    throw new Error("Current role cannot lock collaboration settlement");
  }
}

function assertOwnerOrganization(
  actor: CollaborationSettlementActor,
  ownerOrganizationId: string,
) {
  if (actor.organizationId !== ownerOrganizationId) {
    throw new Error("Only the owner organization can manage settlement");
  }
}

function assertOwnerOrganizationForVoid(
  actor: CollaborationSettlementActor,
  ownerOrganizationId: string,
) {
  if (actor.organizationId !== ownerOrganizationId) {
    throw new Error("Only the owner organization can void settlement batches");
  }
}

function assertPartnerOrganization(
  actor: CollaborationSettlementActor,
  partnerOrganizationId: string,
) {
  if (actor.organizationId !== partnerOrganizationId) {
    throw new Error("Only the partner organization can update this batch");
  }
}

function assertPeriod(periodStart: string, periodEnd: string) {
  if (!periodStart || !periodEnd) {
    throw new Error("Settlement period is required");
  }
  if (Date.parse(periodEnd) < Date.parse(periodStart)) {
    throw new Error("Settlement period end cannot be earlier than start");
  }
}

function assertReason(reason: string, message: string) {
  if (!reason?.trim()) {
    throw new Error(message);
  }
}

function assertStatusIn(
  status: CollaborationSettlementBatchStatus,
  allowed: CollaborationSettlementBatchStatus[],
  action: string,
) {
  if (!allowed.includes(status)) {
    throw new Error(
      `Cannot ${action} a ${status} collaboration settlement batch; expected ${allowed.join(
        " or ",
      )}`,
    );
  }
}

async function auditSettlement(
  audit: CollaborationSettlementAuditWriter,
  actor: CollaborationSettlementActor,
  batch: CollaborationSettlementBatchRecord,
  action: "create" | "update" | "lock" | "reopen" | "void",
  changedFields: string[],
) {
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    module: "project",
    objectType: "project_collaboration_settlement_batch",
    objectId: batch.id,
    projectId: batch.projectId,
    after: batch as unknown as Record<string, unknown>,
    changedFields,
  });
}
