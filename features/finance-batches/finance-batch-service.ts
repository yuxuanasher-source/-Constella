import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";
import type {
  EvidenceLevel,
  TimeSource,
} from "@/features/live-operations/live-report-evidence";
import {
  calculateSettlementItem,
  type SettlementMethod,
} from "@/features/settlements/settlement-engine";

import { financeAmount } from "./finance-batch-money";
import {
  assertFinanceBatchAdjustable,
  assertFinanceBatchTransition,
  nextFinanceBatchStatus,
} from "./finance-batch-status";
import type {
  CreateFinanceBatchInput,
  FinanceActor,
  FinanceAdjustmentDirection,
  FinanceBatchAction,
  FinanceBatchAdjustmentRecord,
  FinanceBatchItemRecord,
  FinanceBatchRecord,
  FinanceBatchStatus,
  FinanceBatchType,
  FinanceCounterpartyType,
  FinanceSourceType,
} from "./finance-batch-types";

export type StreamerPayableSource = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string | null;
  projectCode: string | null;
  streamerId: string;
  streamerName: string | null;
  settlementDuration: number;
  timeSource: TimeSource | null;
  evidenceLevel: EvidenceLevel | null;
  createdAt: string;
  settlementMethod: SettlementMethod;
  hourlyRate: number;
  baseSalary: number;
  cpsRateBps: number;
};

export type FinanceBatchAtomicItemInput = {
  projectId: string;
  counterpartyType: FinanceCounterpartyType;
  counterpartyId: string | null;
  counterpartyNameSnapshot: string | null;
  sourceType: FinanceSourceType;
  sourceId: string;
  sourceSnapshot: Record<string, unknown>;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  evidenceLevel: string | null;
  evidenceSnapshot: Record<string, unknown>;
  exceptionFlags: string[];
};

export type FinanceBatchRepository = {
  listStreamerPayableSources(input: {
    organizationId: string;
    periodStart: string;
    periodEnd: string;
    projectIds: string[];
    streamerIds: string[];
    sourceIds: string[];
  }): Promise<StreamerPayableSource[]>;
  createFinanceBatchAtomic(input: {
    organizationId: string;
    batchType: FinanceBatchType;
    title?: string | null;
    periodStart: string;
    periodEnd: string;
    systemAmount: number;
    adjustmentAmount: number;
    finalAmount: number;
    createdBy: string;
    items: FinanceBatchAtomicItemInput[];
  }): Promise<{
    batch: FinanceBatchRecord;
    items: FinanceBatchItemRecord[];
  }>;
  getFinanceBatch(input: {
    organizationId: string;
    financeBatchId: string;
  }): Promise<FinanceBatchRecord | null>;
  addAdjustment(input: {
    organizationId: string;
    financeBatchId: string;
    financeBatchItemId: string | null;
    direction: FinanceAdjustmentDirection;
    amount: number;
    reason: string;
    evidenceSnapshot: Record<string, unknown>;
    createdBy: string;
  }): Promise<{
    batch: FinanceBatchRecord;
    adjustment: FinanceBatchAdjustmentRecord;
  }>;
  transitionBatch(input: {
    organizationId: string;
    financeBatchId: string;
    nextStatus: FinanceBatchStatus;
    actorUserId: string;
    reason: string | null;
  }): Promise<FinanceBatchRecord>;
};

export async function createFinanceBatch(input: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  input: CreateFinanceBatchInput;
}): Promise<{
  batch: FinanceBatchRecord;
  items: FinanceBatchItemRecord[];
}> {
  assertMcnStaff(input.actor);
  assertValidPeriod(input.input.periodStart, input.input.periodEnd);

  if (input.input.batchType !== "streamer_payable") {
    throw new Error(`${input.input.batchType} finance batches are not enabled yet`);
  }

  const selection = normalizeSelection(input.input.selection);
  const sources = await input.repo.listStreamerPayableSources({
    organizationId: input.actor.organizationId,
    periodStart: input.input.periodStart,
    periodEnd: input.input.periodEnd,
    ...selection,
  });
  if (sources.length === 0) {
    throw new Error("No eligible streamer payable sources found");
  }

  const baseSalaryAppliedStreamerIds = new Set<string>();
  const items = sources.map((source) =>
    toStreamerPayableItem(source, {
      includeBaseSalary: shouldIncludeBaseSalaryForSource(
        source,
        baseSalaryAppliedStreamerIds,
      ),
    }),
  );
  if (items.length === 0) {
    throw new Error("No eligible streamer payable sources found");
  }

  const systemAmount = financeAmount(
    items.reduce((sum, item) => sum + item.systemAmount, 0),
  );
  const adjustmentAmount = financeAmount(
    items.reduce((sum, item) => sum + item.adjustmentAmount, 0),
  );

  return input.repo.createFinanceBatchAtomic({
    organizationId: input.actor.organizationId,
    batchType: input.input.batchType,
    title: input.input.title?.trim() || null,
    periodStart: input.input.periodStart,
    periodEnd: input.input.periodEnd,
    systemAmount,
    adjustmentAmount,
    finalAmount: financeAmount(systemAmount + adjustmentAmount),
    createdBy: input.actor.userId,
    items,
  });
}

export async function addFinanceBatchAdjustment(input: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  input: {
    financeBatchId: string;
    financeBatchItemId?: string | null;
    direction: FinanceAdjustmentDirection;
    amount: number;
    reason: string;
    evidenceSnapshot?: Record<string, unknown>;
  };
}): Promise<{
  batch: FinanceBatchRecord;
  adjustment: FinanceBatchAdjustmentRecord;
}> {
  assertFinanceController(input.actor);
  const batch = await input.repo.getFinanceBatch({
    organizationId: input.actor.organizationId,
    financeBatchId: input.input.financeBatchId,
  });
  if (!batch) {
    throw new Error("Finance batch not found");
  }
  if (batch.organizationId !== input.actor.organizationId) {
    throw new Error("Finance batch not found");
  }

  assertFinanceBatchAdjustable(batch.status);
  const reason = input.input.reason.trim();
  if (!reason) {
    throw new Error("Finance batch adjustment reason is required");
  }

  return input.repo.addAdjustment({
    organizationId: input.actor.organizationId,
    financeBatchId: input.input.financeBatchId,
    financeBatchItemId: input.input.financeBatchItemId ?? null,
    direction: input.input.direction,
    amount: financeAmount(Math.abs(input.input.amount)),
    reason,
    evidenceSnapshot: input.input.evidenceSnapshot ?? {},
    createdBy: input.actor.userId,
  });
}

export async function transitionFinanceBatch(input: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  input: {
    financeBatchId: string;
    action: FinanceBatchAction;
    reason?: string | null;
  };
}): Promise<FinanceBatchRecord> {
  assertFinanceController(input.actor);
  const batch = await input.repo.getFinanceBatch({
    organizationId: input.actor.organizationId,
    financeBatchId: input.input.financeBatchId,
  });
  if (!batch) {
    throw new Error("Finance batch not found");
  }
  if (batch.organizationId !== input.actor.organizationId) {
    throw new Error("Finance batch not found");
  }

  const reason = input.input.reason?.trim() || null;
  assertFinanceBatchTransition(batch.status, input.input.action, {
    reason: reason ?? undefined,
  });

  return input.repo.transitionBatch({
    organizationId: input.actor.organizationId,
    financeBatchId: input.input.financeBatchId,
    nextStatus: nextFinanceBatchStatus(batch.status, input.input.action),
    actorUserId: input.actor.userId,
    reason,
  });
}

function toStreamerPayableItem(
  source: StreamerPayableSource,
  options: { includeBaseSalary: boolean },
): FinanceBatchAtomicItemInput {
  const rule = {
    settlementMethod: source.settlementMethod,
    hourlyRate: source.hourlyRate,
    baseSalary: source.baseSalary,
    cpsRateBps: source.cpsRateBps,
  };
  const calculated = calculateSettlementItem({
    report: {
      id: source.id,
      settlementDuration: source.settlementDuration,
      timeSource: source.timeSource,
      evidenceLevel: source.evidenceLevel,
    },
    rule,
    includeBaseSalary: options.includeBaseSalary,
  });
  const systemAmount = financeAmount(calculated.computedAmount);

  return {
    projectId: source.projectId,
    counterpartyType: "streamer",
    counterpartyId: source.streamerId,
    counterpartyNameSnapshot: source.streamerName,
    sourceType: "live_report",
    sourceId: source.id,
    sourceSnapshot: {
      liveReportId: source.id,
      projectId: source.projectId,
      projectName: source.projectName,
      projectCode: source.projectCode,
      streamerId: source.streamerId,
      streamerName: source.streamerName,
      settlementDuration: source.settlementDuration,
      timeSource: source.timeSource,
      evidenceLevel: source.evidenceLevel,
      settlementMethod: source.settlementMethod,
      hourlyRate: source.hourlyRate,
      baseSalary: source.baseSalary,
      cpsRateBps: source.cpsRateBps,
      rule,
      breakdown: calculated.breakdown,
      createdAt: source.createdAt,
    },
    systemAmount,
    adjustmentAmount: 0,
    finalAmount: systemAmount,
    evidenceLevel: source.evidenceLevel,
    evidenceSnapshot: calculated.evidenceSnapshot,
    exceptionFlags: [],
  };
}

function shouldIncludeBaseSalaryForSource(
  source: StreamerPayableSource,
  appliedStreamerIds: Set<string>,
): boolean {
  const hasBaseSalary =
    source.settlementMethod === "base_salary" ||
    source.settlementMethod === "base_salary_cpt";
  if (!hasBaseSalary) {
    return false;
  }
  if (appliedStreamerIds.has(source.streamerId)) {
    return false;
  }
  appliedStreamerIds.add(source.streamerId);
  return true;
}

function assertMcnStaff(actor: FinanceActor): void {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can manage finance batches");
  }
}

function assertFinanceController(actor: FinanceActor): void {
  if (!canRoleControlFinanceBatches(actor.role)) {
    throw new Error("Only owner or finance can control finance batches");
  }
}

function canRoleControlFinanceBatches(role: AppRole | null | undefined): boolean {
  return role === "owner" || role === "finance";
}

function assertValidPeriod(periodStart: string, periodEnd: string): void {
  if (!isDateOnly(periodStart) || !isDateOnly(periodEnd)) {
    throw new Error("Finance batch period must use YYYY-MM-DD dates");
  }
  if (periodEnd < periodStart) {
    throw new Error("Finance batch period end must be on or after start");
  }
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeSelection(selection: CreateFinanceBatchInput["selection"]): {
  projectIds: string[];
  streamerIds: string[];
  sourceIds: string[];
} {
  return {
    projectIds: uniqueStable(selection.projectIds ?? []),
    streamerIds: uniqueStable(selection.streamerIds ?? []),
    sourceIds: uniqueStable(selection.sourceIds ?? []),
  };
}

function uniqueStable(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
