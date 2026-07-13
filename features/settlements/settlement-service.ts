import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import {
  calculateCpsManualAmount,
  calculateSettlementItem,
  summarizeEvidence,
  type SettlementCalculatedItem,
  type SettlementMethod,
  type SettlementRule,
} from "./settlement-engine";
import { centsToLegacyYuan, yuanToCentsStrict } from "./custom-rule-types";

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
  systemDuration?: number | null;
  screenshotDuration?: number | null;
  settlementDuration: number | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  evidenceLevel: "green" | "yellow" | "red" | null;
  settledBatchItemId: string | null;
  settledBatchTypes?: SettlementBatchType[];
  viewers?: number | null;
  reviewedAt?: string | null;
  liveTaskSystemStartedAt?: string | null;
  plannedStartAt?: string | null;
  projectStreamerId?: string | null;
  streamerSource?: string | null;
  collaborationId?: string | null;
  frozenHourlyRate?: number | null;
  frozenBaseSalary?: number | null;
  frozenCpsRateBps?: number | null;
  settlementGroups?: Array<{
    id: string;
    name: string;
    assignmentId: string;
  }>;
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
  title?: string | null;
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

export type StreamerUserLink = {
  streamerId: string;
  userId: string | null;
  displayName: string | null;
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

export type SettlementBatchItemReportLinkRecord = {
  settlementBatchItemId: string;
  liveReportId: string;
};

export type SettlementRuleExceptionPolicy =
  | "route_item_to_review"
  | "block_batch"
  | "use_explicit_default";

export type SettlementRuleExceptionStatus =
  | "review_required"
  | "resolved"
  | "voided";

export type SettlementRuleExceptionInsert = {
  liveReportId?: string | null;
  ruleVersionId?: string | null;
  layerSnapshot: Record<string, unknown>;
  variableName: string;
  policy: SettlementRuleExceptionPolicy;
  resolutionValue?: Record<string, unknown> | null;
  resolutionReason?: string | null;
  createdBy?: string | null;
};

export type SettlementRuleExceptionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  settlementBatchId: string;
  settlementBatchItemId: string;
  liveReportId: string | null;
  ruleVersionId: string | null;
  layerSnapshot: Record<string, unknown>;
  variableName: string;
  policy: SettlementRuleExceptionPolicy;
  status: SettlementRuleExceptionStatus;
  resolutionValue: Record<string, unknown> | null;
  resolutionReason: string | null;
  createdBy: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type SettlementBatchAtomicItemInput = {
  streamerId?: string | null;
  liveReportId?: string | null;
  liveReportIds?: string[];
  itemType: string;
  computedAmount: number;
  manualAmount: number;
  adjustmentAmount: number;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  evidenceSnapshot: Record<string, unknown>;
  exceptions?: SettlementRuleExceptionInsert[];
};

export type CustomSettlementProductionInput = {
  organizationId: string;
  projectId: string;
  batchType: SettlementBatchType;
  periodStart: string;
  periodEnd: string;
  title?: string | null;
  reports: SettlementPoolReport[];
  selectedStreamerIds?: string[];
  legacyComputedAmountCentsByReportId?: Record<string, number>;
};

export type CustomSettlementProductionItem = {
  streamerId?: string | null;
  sourceReportIds: string[];
  itemType?: string;
  computedAmountCents: number;
  manualAmount?: number;
  adjustmentAmount?: number;
  evidenceLevel?: "green" | "yellow" | "red" | null;
  evidenceSnapshot: Record<string, unknown>;
  exceptions?: SettlementRuleExceptionInsert[];
  reviewRouted?: boolean;
};

export type CustomSettlementProductionResult = {
  items: CustomSettlementProductionItem[];
  evidenceSummary?: Record<string, unknown>;
};

export type CustomSettlementExecutionPort = {
  resolveAndExecute(
    input: CustomSettlementProductionInput,
  ): Promise<"no_custom_layers" | CustomSettlementProductionResult>;
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
  createSettlementBatchAtomic(input: {
    organizationId: string;
    projectId: string;
    batchType: SettlementBatchType;
    title?: string | null;
    periodStart: string;
    periodEnd: string;
    computedAmount: number;
    manualAmount: number;
    adjustmentAmount: number;
    evidenceSummary: Record<string, unknown>;
    createdBy: string;
    items: SettlementBatchAtomicItemInput[];
  }): Promise<{
    batch: SettlementBatchRecord;
    items: SettlementBatchItemRecord[];
    links?: SettlementBatchItemReportLinkRecord[];
    exceptions?: SettlementRuleExceptionRecord[];
  }>;
  resolveSettlementRuleException?(input: {
    organizationId: string;
    exceptionId: string;
    settlementBatchItemId: string;
    oldComputedAmount: number;
    newComputedAmount: number;
    resolutionValue: Record<string, unknown>;
    resolutionReason: string;
    resolvedBy: string;
  }): Promise<{
    batch: SettlementBatchRecord;
    item: SettlementBatchItemRecord;
    exception: SettlementRuleExceptionRecord;
  }>;
  listSettlementRuleExceptions?(input: {
    organizationId: string;
    batchId: string;
  }): Promise<SettlementRuleExceptionRecord[]>;
  hasOpenSettlementRuleExceptions?(input: {
    organizationId: string;
    batchId: string;
  }): Promise<boolean>;
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
  listSettlementBatchItems(
    batchId: string,
  ): Promise<SettlementBatchItemRecord[]>;
  listStreamerUserLinks(input: {
    organizationId: string;
    streamerIds: string[];
  }): Promise<StreamerUserLink[]>;
};

export type SettlementAuditWriter = (input: AuditLogInput) => Promise<void>;
export type SettlementNotifier = (input: NotificationInput) => Promise<void>;
export type ManualSettlementItemType = "cpa" | "cps" | "gift" | "manual";
export type SettlementBatchGate = {
  assertNoOpenRuleExceptions(batchId: string): Promise<void>;
};

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
  customExecutionPort,
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
    title?: string;
    // 结算流程改造：建批次时可以只勾选部分主播参与本次结算；
    // 缺省（undefined）保持旧行为 = 周期内全量入批。
    streamerIds?: string[];
  };
  customExecutionPort?: CustomSettlementExecutionPort;
}): Promise<{
  batch: SettlementBatchRecord;
  items: SettlementBatchItemRecord[];
}> {
  assertCanManageSettlement(actor.role);
  assertPeriod(input.periodStart, input.periodEnd);
  const selectedStreamerIds = normalizeStreamerFilter(input.streamerIds);

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
      report.settlementDuration !== null &&
      (!selectedStreamerIds || selectedStreamerIds.has(report.streamerId)),
  );
  if (eligibleReports.length === 0) {
    throw new Error(
      selectedStreamerIds
        ? "No unsettled approved reports found for the selected streamers"
        : "No unsettled approved reports found",
    );
  }

  const legacyPayload = await buildLegacySettlementBatchPayload({
    repo,
    input,
    actor,
    eligibleReports,
  });

  const customExecution = customExecutionPort
    ? await customExecutionPort.resolveAndExecute({
        organizationId: actor.organizationId,
        projectId: input.projectId,
        batchType: input.batchType,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        title: input.title?.trim() || null,
        reports: eligibleReports,
        legacyComputedAmountCentsByReportId:
          legacyComputedAmountCentsByReportId(legacyPayload.items),
        ...(selectedStreamerIds
          ? { selectedStreamerIds: Array.from(selectedStreamerIds).sort() }
          : {}),
      })
    : "no_custom_layers";

  const batchPayload =
    customExecution === "no_custom_layers"
      ? legacyPayload
      : buildCustomSettlementBatchPayload({
          input,
          actor,
          eligibleReports,
          customExecution,
        });

  const { batch, items } = await repo.createSettlementBatchAtomic(batchPayload);

  await auditGeneratedSettlementBatch({ audit, actor, batch });

  await notifyGeneratedSettlementBatch({ notify, actor, batch, input });

  return { batch, items };
}

async function buildLegacySettlementBatchPayload({
  repo,
  input,
  actor,
  eligibleReports,
}: {
  repo: SettlementRepository;
  input: {
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
    title?: string;
  };
  actor: SettlementActor;
  eligibleReports: SettlementPoolReport[];
}): Promise<Parameters<SettlementRepository["createSettlementBatchAtomic"]>[0]> {
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
  let receivableBaseSalaryApplied = false;
  const calculations = eligibleReports.map((report) => {
    const rule =
      input.batchType === "receivable"
        ? (projectRule ?? fallbackRule())
        : (ruleByStreamer.get(report.streamerId) ?? fallbackRule());
    // Receivable base salary is a project-level fee billed to the vendor once
    // for the whole batch; applying it per streamer over-bills by (N-1) × base
    // salary. Payable base salary stays per streamer (once per streamer).
    let includeBaseSalary: boolean;
    if (input.batchType === "receivable") {
      includeBaseSalary = !receivableBaseSalaryApplied;
      receivableBaseSalaryApplied = true;
    } else {
      includeBaseSalary = !baseSalaryApplied.has(report.streamerId);
      if (includeBaseSalary) {
        baseSalaryApplied.add(report.streamerId);
      }
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
  // Persist the batch, its items and the per-report settled pointers in a single
  // database transaction (see the generate_settlement_batch RPC) so a partial
  // failure can never leave an orphaned batch with only some items/reports.
  return {
    organizationId: actor.organizationId,
    projectId: input.projectId,
    batchType: input.batchType,
    title: input.title?.trim() || null,
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
    items: calculations.map(({ report, item }) => ({
      streamerId: report.streamerId,
      liveReportId: report.id,
      liveReportIds: [report.id],
      itemType: liveReportItemType(input.batchType),
      computedAmount: item.computedAmount,
      manualAmount: item.manualAmount,
      adjustmentAmount: item.adjustmentAmount,
      evidenceLevel: report.evidenceLevel,
      evidenceSnapshot: item.evidenceSnapshot,
    })),
  };
}

function buildCustomSettlementBatchPayload({
  input,
  actor,
  eligibleReports,
  customExecution,
}: {
  input: {
    projectId: string;
    batchType: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
    title?: string;
  };
  actor: SettlementActor;
  eligibleReports: SettlementPoolReport[];
  customExecution: CustomSettlementProductionResult;
}): Parameters<SettlementRepository["createSettlementBatchAtomic"]>[0] {
  const reportById = new Map(
    eligibleReports.map((report) => [report.id, report]),
  );
  const computedAmountCents = totalCustomComputedCents(customExecution.items);
  return {
    organizationId: actor.organizationId,
    projectId: input.projectId,
    batchType: input.batchType,
    title: input.title?.trim() || null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    computedAmount: centsToLegacyYuanBigInt(computedAmountCents),
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary:
      customExecution.evidenceSummary ??
      summarizeEvidence(
        eligibleReports.map((report) => ({
          evidenceLevel: report.evidenceLevel,
        })),
      ),
    createdBy: actor.userId,
    items: customExecution.items.map((item) => {
      const sourceReportIds = unique(item.sourceReportIds);
      const firstReport = sourceReportIds
        .map((reportId) => reportById.get(reportId))
        .find((report): report is SettlementPoolReport => Boolean(report));
      const computedAmount = centsToLegacyYuan(
        assertSafeCents(item.computedAmountCents),
      );
      return {
        streamerId: item.streamerId ?? firstReport?.streamerId ?? null,
        liveReportId:
          sourceReportIds.length === 1 ? sourceReportIds[0] : null,
        liveReportIds: sourceReportIds,
        itemType: item.itemType ?? liveReportItemType(input.batchType),
        computedAmount,
        manualAmount: item.manualAmount ?? 0,
        adjustmentAmount: item.adjustmentAmount ?? 0,
        evidenceLevel: item.evidenceLevel ?? firstReport?.evidenceLevel ?? null,
        evidenceSnapshot: item.evidenceSnapshot,
        exceptions: item.exceptions,
      };
    }),
  };
}

async function auditGeneratedSettlementBatch({
  audit,
  actor,
  batch,
}: {
  audit: SettlementAuditWriter;
  actor: SettlementActor;
  batch: SettlementBatchRecord;
}): Promise<void> {
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
}

async function notifyGeneratedSettlementBatch({
  notify,
  actor,
  batch,
  input,
}: {
  notify: SettlementNotifier;
  actor: SettlementActor;
  batch: SettlementBatchRecord;
  input: { batchType: SettlementBatchType };
}): Promise<void> {
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
}

export async function confirmSettlementBatch({
  repo,
  audit,
  notify,
  actor,
  batchId,
  reason,
  gate,
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
  gate?: SettlementBatchGate;
}): Promise<SettlementBatchRecord> {
  assertCanConfirmSettlement(actor.role);
  assertReason(reason, "Confirming a settlement batch requires a reason");
  const before = await requireSettlementBatch(repo, batchId);
  if (before.status !== "generated" && before.status !== "reopened") {
    throw new Error(
      "Only generated or reopened settlement batches can be confirmed",
    );
  }
  await gate?.assertNoOpenRuleExceptions(batchId);

  const after = await repo.updateSettlementBatch(batchId, {
    status: "confirmed",
  });

  await auditSettlementTransition({
    audit,
    actor,
    before,
    after,
    action: "approve",
    reason,
    changedFields: ["status"],
  });
  await notifyHighRiskSettlement({
    notify,
    actor,
    batch: after,
    title: "Settlement batch confirmed",
    content: `${after.id} was confirmed.`,
  });

  return after;
}

export async function lockSettlementBatch({
  repo,
  audit,
  notify,
  actor,
  batchId,
  reason,
  now = new Date().toISOString(),
  gate,
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
  gate?: SettlementBatchGate;
}): Promise<SettlementBatchRecord> {
  assertCanLockSettlement(actor.role);
  assertReason(reason, "Locking a settlement batch requires a reason");
  const before = await requireSettlementBatch(repo, batchId);
  if (before.status === "locked" || before.status === "voided") {
    throw new Error("Only open settlement batches can be locked");
  }
  await gate?.assertNoOpenRuleExceptions(batchId);

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
    | "getSettlementRules"
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
    manualAmount?: number;
    salesAmount?: number;
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
  const before = await requireSettlementBatch(repo, batchId);
  const manualSettlement = await resolveManualSettlementInput({
    repo,
    batch: before,
    input,
  });
  assertManualAmount(manualSettlement.manualAmount);
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
    manualAmount: manualSettlement.manualAmount,
    adjustmentAmount: input.adjustmentAmount ?? 0,
    evidenceLevel: input.evidenceLevel,
    evidenceSnapshot: manualSettlement.evidenceSnapshot,
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

// 结算流程改造 step 4：批次财务确认/锁定后，可选把每位参与主播的应付明细
// 以站内通知（recipient_user_id 定向投递）发给主播本人。金额按批次项逐主播
// 聚合；未绑定登录账号（streamers.user_id 为空）的主播计入 skipped。
export async function sendSettlementBatchStatements({
  repo,
  audit,
  notify,
  actor,
  batchId,
}: {
  repo: Pick<
    SettlementRepository,
    | "getSettlementBatchById"
    | "listSettlementBatchItems"
    | "listStreamerUserLinks"
  >;
  audit: SettlementAuditWriter;
  notify: SettlementNotifier;
  actor: SettlementActor;
  batchId: string;
}): Promise<{ notified: number; skipped: number }> {
  assertCanManageSettlement(actor.role);
  const batch = await requireSettlementBatch(repo, batchId);
  if (batch.organizationId !== actor.organizationId) {
    throw new Error("Settlement batch not found");
  }
  if (batch.batchType !== "payable") {
    throw new Error("Only payable batches can be sent to streamers");
  }
  if (batch.status !== "confirmed" && batch.status !== "locked") {
    throw new Error(
      "Only confirmed or locked settlement batches can be sent to streamers",
    );
  }

  const items = await repo.listSettlementBatchItems(batchId);
  const totalsByStreamer = new Map<string, number>();
  for (const item of items) {
    if (!item.streamerId) {
      continue;
    }
    const total =
      item.computedAmount + item.manualAmount + item.adjustmentAmount;
    totalsByStreamer.set(
      item.streamerId,
      (totalsByStreamer.get(item.streamerId) ?? 0) + total,
    );
  }
  if (totalsByStreamer.size === 0) {
    throw new Error("Settlement batch has no streamer items to send");
  }

  const links = await repo.listStreamerUserLinks({
    organizationId: actor.organizationId,
    streamerIds: Array.from(totalsByStreamer.keys()),
  });
  const linkByStreamer = new Map(links.map((link) => [link.streamerId, link]));

  let notified = 0;
  let skipped = 0;
  for (const [streamerId, amount] of totalsByStreamer) {
    const link = linkByStreamer.get(streamerId);
    if (!link?.userId) {
      skipped += 1;
      continue;
    }

    const batchLabel = batch.title?.trim() || batch.id;
    await notify({
      organizationId: actor.organizationId,
      recipientUserId: link.userId,
      type: "settlement",
      title: "结算明细已生成",
      content: `结算批次「${batchLabel}」（${batch.periodStart} ~ ${batch.periodEnd}）你的应付合计 ¥${amount.toFixed(2)}，可在「结算账单」查看明细。`,
      objectType: "settlement_batch",
      objectId: batch.id,
      source: "settlement.batch.statement",
    });
    notified += 1;
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "export",
    module: "settlement",
    objectType: "settlement_batch",
    objectId: batch.id,
    projectId: batch.projectId,
    after: {
      statement_notified: notified,
      statement_skipped: skipped,
    },
    changedFields: [],
    reason: "send streamer settlement statements",
  });

  return { notified, skipped };
}

function normalizeStreamerFilter(
  streamerIds: string[] | undefined,
): Set<string> | null {
  if (!streamerIds) {
    return null;
  }

  const cleaned = streamerIds.map((id) => id.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error("At least one streamer must be selected");
  }

  return new Set(cleaned);
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

function assertCanConfirmSettlement(role: AppRole): void {
  if (role !== "owner" && role !== "finance") {
    throw new Error("Current role cannot confirm settlement batches");
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

async function resolveManualSettlementInput({
  repo,
  batch,
  input,
}: {
  repo: Pick<SettlementRepository, "getSettlementRules">;
  batch: SettlementBatchRecord;
  input: {
    itemType: ManualSettlementItemType;
    streamerId?: string | null;
    manualAmount?: number;
    salesAmount?: number;
    reason: string;
    note?: string;
  };
}): Promise<{
  manualAmount: number;
  evidenceSnapshot: Record<string, unknown>;
}> {
  if (
    input.itemType === "cps" &&
    input.manualAmount === undefined &&
    input.salesAmount !== undefined &&
    input.streamerId
  ) {
    const [rule] = await repo.getSettlementRules({
      projectId: batch.projectId,
      streamerIds: [input.streamerId],
    });
    const cpsRateBps = rule?.cpsRateBps ?? 0;
    return {
      manualAmount: calculateCpsManualAmount({
        salesAmount: input.salesAmount,
        cpsRateBps,
      }),
      evidenceSnapshot: {
        source: "manual_cps_import",
        itemType: input.itemType,
        reason: input.reason,
        note: input.note,
        salesAmount: input.salesAmount,
        cpsRateBps,
        settlementRuleSource: "project_streamer_snapshot",
      },
    };
  }

  return {
    manualAmount: input.manualAmount ?? 0,
    evidenceSnapshot: {
      source: "manual",
      itemType: input.itemType,
      reason: input.reason,
      note: input.note,
    },
  };
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

function legacyComputedAmountCentsByReportId(
  items: SettlementBatchAtomicItemInput[],
): Record<string, number> {
  const entries: Array<[string, number]> = [];
  for (const item of items) {
    for (const reportId of item.liveReportIds ?? []) {
      entries.push([reportId, yuanToCentsStrict(item.computedAmount)]);
    }
  }
  return Object.fromEntries(entries);
}

const LEGACY_NUMERIC_12_2_MAX_CENTS = BigInt("999999999999");
const LEGACY_NUMERIC_12_2_MIN_CENTS = BigInt("-999999999999");

function totalCustomComputedCents(
  items: CustomSettlementProductionItem[],
): bigint {
  return items.reduce((total, item) => {
    if (item.reviewRouted) {
      return total;
    }
    return total + BigInt(assertSafeCents(item.computedAmountCents));
  }, BigInt(0));
}

function centsToLegacyYuanBigInt(cents: bigint): number {
  if (
    cents > LEGACY_NUMERIC_12_2_MAX_CENTS ||
    cents < LEGACY_NUMERIC_12_2_MIN_CENTS
  ) {
    throw new RangeError("custom settlement total exceeds numeric(12,2)");
  }
  if (
    cents > BigInt(Number.MAX_SAFE_INTEGER) ||
    cents < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError("custom settlement total exceeds safe conversion");
  }
  return centsToLegacyYuan(Number(cents));
}

function assertSafeCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("custom settlement amount cents must be a safe integer");
  }
  if (
    BigInt(cents) > LEGACY_NUMERIC_12_2_MAX_CENTS ||
    BigInt(cents) < LEGACY_NUMERIC_12_2_MIN_CENTS
  ) {
    throw new RangeError("custom settlement item exceeds numeric(12,2)");
  }
  return cents;
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
  action: "approve" | "lock" | "reopen";
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
