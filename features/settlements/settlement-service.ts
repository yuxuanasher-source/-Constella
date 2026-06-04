import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import {
  calculateSettlementItem,
  summarizeEvidence,
  type SettlementCalculatedItem,
  type SettlementMethod,
  type SettlementRule,
} from "./settlement-engine";

export type SettlementBatchType = "receivable" | "payable";
export type SettlementBatchStatus =
  | "draft"
  | "generated"
  | "pending"
  | "confirmed"
  | "locked"
  | "reopened"
  | "voided";

export type SettlementActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type SettlementPoolReport = {
  id: string;
  organizationId: string;
  projectId: string;
  streamerId: string;
  liveTaskId: string;
  status: "approved";
  settlementDuration: number | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  evidenceLevel: "green" | "yellow" | "red" | null;
  settledBatchItemId: string | null;
  settledBatchTypes?: SettlementBatchType[];
  createdAt: string;
};

export type SettlementRuleRecord = {
  projectId: string;
  streamerId: string;
} & SettlementRule;

export type ProjectSettlementRuleRecord = {
  projectId: string;
} & SettlementRule;

export type SettlementBatchRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  batchType: SettlementBatchType;
  status: SettlementBatchStatus;
  periodStart: string;
  periodEnd: string;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceSummary: Record<string, unknown>;
  lockReason?: string | null;
  reopenReason?: string | null;
  createdBy?: string | null;
  lockedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SettlementBatchItemRecord = {
  id: string;
  organizationId: string;
  settlementBatchId: string;
  projectId: string;
  streamerId?: string | null;
  liveReportId?: string | null;
  itemType: string;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  evidenceSnapshot: Record<string, unknown>;
  createdAt?: string;
};

export type SettlementRepository = {
  listSettlementPoolReports(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  }): Promise<SettlementPoolReport[]>;
  getSettlementRules(input: {
    projectId: string;
    streamerIds: string[];
  }): Promise<SettlementRuleRecord[]>;
  getProjectSettlementRule(input: {
    projectId: string;
  }): Promise<ProjectSettlementRuleRecord | null>;
  createSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
    computedAmount: number;
    manualAmount: number;
    adjustmentAmount: number;
    evidenceSummary: Record<string, unknown>;
    createdBy: string;
  }): Promise<SettlementBatchRecord>;
  createSettlementBatchItem(
    input: Omit<SettlementBatchItemRecord, "id" | "createdAt">,
  ): Promise<SettlementBatchItemRecord>;
  markReportSettled(input: {
    reportId: string;
    settlementBatchItemId: string;
    batchType: SettlementBatchType;
  }): Promise<void>;
  getSettlementBatchById(
    batchId: string,
  ): Promise<SettlementBatchRecord | null>;
  updateSettlementBatch(
    batchId: string,
    patch: Partial<SettlementBatchRecord>,
  ): Promise<SettlementBatchRecord>;
};

export type SettlementAuditWriter = (input: AuditLogInput) => Promise<void>;
export type SettlementNotifier = (input: NotificationInput) => Promise<void>;
export type ManualSettlementItemType = "cpa" | "cps" | "gift" | "manual";

export async function listSettlementPool({
  repo,
  actor,
  projectId,
  batchType = "payable",
  periodStart,
  periodEnd,
}: {
  repo: Pick<SettlementRepository, "listSettlementPoolReports">;
  actor: SettlementActor;
  projectId: string;
  batchType?: SettlementBatchType;
  periodStart: string;
  periodEnd: string;
}): Promise<SettlementPoolReport[]> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can view settlement pool");
  }

  assertPeriod(periodStart, periodEnd);

  const reports = await repo.listSettlementPoolReports({
    organizationId: actor.organizationId,
    projectId,
    batchType,
    periodStart,
    periodEnd,
  });

  return reports.filter(
    (report) =>
      report.organizationId === actor.organizationId &&
      !report.settledBatchTypes?.includes(batchType),
  );
}

export async function generateSettlementBatch({
  repo,
  audit,
  notify,
  actor,
  input,
}: {
  repo: SettlementRepository;
  audit: SettlementAuditWriter;
  notify: SettlementNotifier;
  actor: SettlementActor;
  input: {
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  };
}): Promise<{
  batch: SettlementBatchRecord;
  items: SettlementBatchItemRecord[];
}> {
  assertCanManageSettlement(actor.role);
  assertPeriod(input.periodStart, input.periodEnd);

  const reports = (
    await repo.listSettlementPoolReports({
      organizationId: actor.organizationId,
      projectId: input.projectId,
      batchType: input.batchType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    })
  ).filter((report) => report.organizationId === actor.organizationId);
  const eligibleReports = reports.filter(
    (report) =>
      report.status === "approved" &&
      !report.settledBatchTypes?.includes(input.batchType) &&
      report.settlementDuration !== null,
  );
  if (eligibleReports.length === 0) {
    throw new Error("No unsettled approved reports found");
  }

  const rules = await repo.getSettlementRules({
    projectId: input.projectId,
    streamerIds: unique(eligibleReports.map((report) => report.streamerId)),
  });
  const projectRule =
    input.batchType === "receivable"
      ? await repo.getProjectSettlementRule({ projectId: input.projectId })
      : null;
  const ruleByStreamer = new Map(
    rules.map((rule) => [rule.streamerId, rule] as const),
  );
  const baseSalaryApplied = new Set<string>();
  const calculations = eligibleReports.map((report) => {
    const rule =
      input.batchType === "receivable"
        ? (projectRule ?? fallbackRule())
        : (ruleByStreamer.get(report.streamerId) ?? fallbackRule());
    const includeBaseSalary = !baseSalaryApplied.has(report.streamerId);
    if (includeBaseSalary) {
      baseSalaryApplied.add(report.streamerId);
    }

    return {
      report,
      item: calculateSettlementItem({
        report,
        rule,
        includeBaseSalary,
      }),
    };
  });

  const totals = totalItems(calculations.map(({ item }) => item));
  const batch = await repo.createSettlementBatch({
    organizationId: actor.organizationId,
    projectId: input.projectId,
    batchType: input.batchType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    computedAmount: totals.computedAmount,
    manualAmount: totals.manualAmount,
    adjustmentAmount: totals.adjustmentAmount,
    evidenceSummary: summarizeEvidence(
      calculations.map(({ report }) => ({
        evidenceLevel: report.evidenceLevel,
      })),
    ),
    createdBy: actor.userId,
  });

  const items: SettlementBatchItemRecord[] = [];
  for (const { report, item } of calculations) {
    const createdItem = await repo.createSettlementBatchItem({
      organizationId: actor.organizationId,
      settlementBatchId: batch.id,
      projectId: report.projectId,
      streamerId: report.streamerId,
      liveReportId: report.id,
      itemType: liveReportItemType(input.batchType),
      computedAmount: item.computedAmount,
      manualAmount: item.manualAmount,
      adjustmentAmount: item.adjustmentAmount,
      evidenceLevel: report.evidenceLevel,
      evidenceSnapshot: item.evidenceSnapshot,
    });
    await repo.markReportSettled({
      reportId: report.id,
      settlementBatchItemId: createdItem.id,
      batchType: input.batchType,
    });
    items.push(createdItem);
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "settlement",
    objectType: "settlement_batch",
    objectId: batch.id,
    projectId: batch.projectId,
    after: batch as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "computed_amount",
      "manual_amount",
      "adjustment_amount",
      "evidence_summary",
    ],
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: "finance",
    type: "settlement",
    title: "Settlement batch generated",
    content: `${input.batchType} batch ${batch.id} is ready for review.`,
    objectType: "settlement_batch",
    objectId: batch.id,
    source: "settlement.batch.generate",
  });

  return { batch, items };
}

export async function lockSettlementBatch({
  repo,
  audit,
  notify,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: Pick<
    SettlementRepository,
    "getSettlementBatchById" | "updateSettlementBatch"
  >;
  audit: SettlementAuditWriter;
  notify: SettlementNotifier;
  actor: SettlementActor;
  batchId: string;
  reason: string;
  now?: string;
}): Promise<SettlementBatchRecord> {
  assertCanLockSettlement(actor.role);
  assertReason(reason, "Locking a settlement batch requires a reason");
  const before = await requireSettlementBatch(repo, batchId);
  if (before.status === "locked" || before.status === "voided") {
    throw new Error("Only open settlement batches can be locked");
  }

  const after = await repo.updateSettlementBatch(batchId, {
    status: "locked",
    lockedAt: now,
    lockReason: reason,
  });

  await auditSettlementTransition({
    audit,
    actor,
    before,
    after,
    action: "lock",
    reason,
    changedFields: ["status", "locked_at", "lock_reason"],
  });
  await notifyHighRiskSettlement({
    notify,
    actor,
    batch: after,
    title: "Settlement batch locked",
    content: `${after.id} was locked.`,
  });

  return after;
}

export async function addManualSettlementItem({
  repo,
  audit,
  notify,
  actor,
  batchId,
  input,
}: {
  repo: Pick<
    SettlementRepository,
    | "getSettlementBatchById"
    | "createSettlementBatchItem"
    | "updateSettlementBatch"
  >;
  audit: SettlementAuditWriter;
  notify: SettlementNotifier;
  actor: SettlementActor;
  batchId: string;
  input: {
    itemType: ManualSettlementItemType;
    projectId?: string;
    streamerId?: string | null;
    manualAmount: number;
    adjustmentAmount?: number;
    evidenceLevel: "yellow" | "red";
    reason: string;
    note?: string;
  };
}): Promise<SettlementBatchItemRecord> {
  assertCanManageSettlement(actor.role);
  assertReason(
    input.reason,
    "Manual settlement amount changes require a reason",
  );
  assertManualAmount(input.manualAmount);
  const before = await requireSettlementBatch(repo, batchId);
  if (before.status === "locked" || before.status === "voided") {
    throw new Error("Locked or voided settlement batches cannot be edited");
  }

  const item = await repo.createSettlementBatchItem({
    organizationId: actor.organizationId,
    settlementBatchId: before.id,
    projectId: input.projectId ?? before.projectId,
    streamerId: input.streamerId ?? null,
    liveReportId: null,
    itemType: input.itemType,
    computedAmount: 0,
    manualAmount: input.manualAmount,
    adjustmentAmount: input.adjustmentAmount ?? 0,
    evidenceLevel: input.evidenceLevel,
    evidenceSnapshot: {
      source: "manual",
      itemType: input.itemType,
      reason: input.reason,
      note: input.note,
    },
  });
  const after = await repo.updateSettlementBatch(batchId, {
    manualAmount: before.manualAmount + item.manualAmount,
    adjustmentAmount: before.adjustmentAmount + item.adjustmentAmount,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "settlement_batch",
    objectId: before.id,
    projectId: before.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: ["manual_amount", "adjustment_amount"],
    reason: input.reason,
    isHighRisk: true,
  });

  await notify({
    organizationId: actor.organizationId,
    recipientRole: "finance",
    type: "settlement",
    title: "Manual settlement amount added",
    content: `${input.itemType} amount was added to ${before.id}.`,
    objectType: "settlement_batch",
    objectId: before.id,
    source: "settlement.manual_item.create",
    isHighRisk: true,
  });

  return item;
}

export async function reopenSettlementBatch({
  repo,
  audit,
  notify,
  actor,
  batchId,
  reason,
}: {
  repo: Pick<
    SettlementRepository,
    "getSettlementBatchById" | "updateSettlementBatch"
  >;
  audit: SettlementAuditWriter;
  notify: SettlementNotifier;
  actor: SettlementActor;
  batchId: string;
  reason: string;
}): Promise<SettlementBatchRecord> {
  if (actor.role !== "owner") {
    throw new Error("Only owners can reopen locked settlement batches");
  }
  assertReason(reason, "Reopening a settlement batch requires a reason");
  const before = await requireSettlementBatch(repo, batchId);
  if (before.status !== "locked") {
    throw new Error("Only locked settlement batches can be reopened");
  }

  const after = await repo.updateSettlementBatch(batchId, {
    status: "reopened",
    reopenReason: reason,
  });

  await auditSettlementTransition({
    audit,
    actor,
    before,
    after,
    action: "reopen",
    reason,
    changedFields: ["status", "reopen_reason"],
  });
  await notifyHighRiskSettlement({
    notify,
    actor,
    batch: after,
    title: "Settlement batch reopened",
    content: `${after.id} was reopened: ${reason}`,
  });

  return after;
}

function assertCanManageSettlement(role: AppRole): void {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "operator_business"
  ) {
    throw new Error("Current role cannot manage settlement batches");
  }
}

function assertCanLockSettlement(role: AppRole): void {
  if (role !== "owner" && role !== "ops_manager") {
    throw new Error("Current role cannot lock settlement batches");
  }
}

function assertPeriod(periodStart: string, periodEnd: string): void {
  if (!periodStart || !periodEnd) {
    throw new Error("Settlement period is required");
  }

  if (new Date(periodEnd).getTime() < new Date(periodStart).getTime()) {
    throw new Error("Settlement period end cannot be earlier than start");
  }
}

function assertReason(reason: string, message: string): void {
  if (!reason.trim()) {
    throw new Error(message);
  }
}

function assertManualAmount(manualAmount: number): void {
  if (!Number.isFinite(manualAmount) || manualAmount < 0) {
    throw new Error("Manual amount must be non-negative");
  }
}

async function requireSettlementBatch(
  repo: Pick<SettlementRepository, "getSettlementBatchById">,
  batchId: string,
): Promise<SettlementBatchRecord> {
  const batch = await repo.getSettlementBatchById(batchId);
  if (!batch) {
    throw new Error("Settlement batch not found");
  }

  return batch;
}

function fallbackRule(): SettlementRule & {
  settlementMethod: SettlementMethod;
} {
  return { settlementMethod: "manual", hourlyRate: 0, baseSalary: 0 };
}

function liveReportItemType(batchType: SettlementBatchType): string {
  return `live_report_${batchType}`;
}

function totalItems(items: SettlementCalculatedItem[]) {
  return items.reduce(
    (summary, item) => ({
      computedAmount: summary.computedAmount + item.computedAmount,
      manualAmount: summary.manualAmount + item.manualAmount,
      adjustmentAmount: summary.adjustmentAmount + item.adjustmentAmount,
    }),
    { computedAmount: 0, manualAmount: 0, adjustmentAmount: 0 },
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function auditSettlementTransition({
  audit,
  actor,
  before,
  after,
  action,
  reason,
  changedFields,
}: {
  audit: SettlementAuditWriter;
  actor: SettlementActor;
  before: SettlementBatchRecord;
  after: SettlementBatchRecord;
  action: "lock" | "reopen";
  reason: string;
  changedFields: string[];
}) {
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    module: "settlement",
    objectType: "settlement_batch",
    objectId: after.id,
    projectId: after.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields,
    reason,
    isHighRisk: true,
  });
}

async function notifyHighRiskSettlement({
  notify,
  actor,
  batch,
  title,
  content,
}: {
  notify: SettlementNotifier;
  actor: SettlementActor;
  batch: SettlementBatchRecord;
  title: string;
  content: string;
}) {
  await notify({
    organizationId: actor.organizationId,
    recipientRole: "owner",
    type: "high_risk",
    title,
    content,
    objectType: "settlement_batch",
    objectId: batch.id,
    source: "settlement.batch.high_risk",
    isHighRisk: true,
  });
}
