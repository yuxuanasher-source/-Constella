import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeProjectFinancialSettings,
  type ProjectFinancialSettings,
} from "@/features/complex-cost/project-financials";
import type { SettlementReconciliationRunTriggerType } from "@/features/complex-cost/complex-cost-types";
import { isMcnStaff } from "@/lib/rbac/roles";

import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import { SupabaseCustomRuleReadRepository } from "./custom-rule-repository";
import {
  calculateCustomReconciliationInputHash,
  deepFreeze,
  executeCustomRuleReconciliationChecks,
  finalChecksWithCoreSource,
  type ReconciliationCheckWithSource,
} from "./custom-rule-reconciliation";
import {
  reconcileProjectSettlement,
  type ProjectSettlementReconciliationResult,
  type ReconciliationCheck,
  type ReconciliationConfig,
  type ReconciliationEvidence,
} from "./project-settlement-reconciliation";
import type { SettlementActor } from "./settlement-service";

// Wires the pure §3.4 reconciliation core to real project data: it gathers the
// period's receivable/payable batch totals, the project's confirmed external
// cost items and its financial settings, then runs reconcileProjectSettlement.
// Read-only; MCN staff only.

export type BatchTotals = {
  computedCents: number;
  manualCents: number;
  adjustmentCents: number;
};
export type ReconciliationRunMetadata = {
  id: string;
  inputHash: string;
  createdAt?: string | null;
};

export type ConfirmedCostSummary = {
  costCents: number;
  revenueOffsetCents: number;
  adjustmentCents: number;
};

export type PersistedSettlementReconciliationRun = {
  id: string;
  inputHash: string;
  result: ProjectSettlementReconciliationRunResult;
  createdAt?: string | null;
};

export type ProjectSettlementReconciliationRunResult = Omit<
  ProjectSettlementReconciliationResult,
  "checks"
> & {
    checks: ReconciliationCheck[] | ReconciliationCheckWithSource[];
    run?: ReconciliationRunMetadata;
    customRule?: {
      ruleVersionId: string;
      contractLabel: string;
      formulaHash: string;
    };
  };

export type PersistReconciliationRunInput = {
  organizationId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  triggerType: SettlementReconciliationRunTriggerType;
  triggerBatchId?: string | null;
  inputHash: string;
  coreResult: ProjectSettlementReconciliationResult;
  result: ProjectSettlementReconciliationRunResult;
  ruleVersionId?: string | null;
  formulaHash?: string | null;
  customChecks: ReconciliationCheckWithSource[];
  finalChecks: ReconciliationCheckWithSource[];
  blocked: boolean;
  warnings: ReconciliationCheckWithSource[];
  createdBy: string;
};

export type ReconciliationDataSource = {
  getBatchTotals(input: {
    organizationId: string;
    projectId: string;
    batchType: "receivable" | "payable";
    periodStart: string;
    periodEnd: string;
  }): Promise<{
    totals: BatchTotals;
    evidence: ReconciliationEvidence;
    finalized?: boolean;
  }>;
  getConfirmedCostSummary(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ConfirmedCostSummary & { finalized?: boolean }>;
  getFinancialSettings(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectFinancialSettings & { finalized?: boolean }>;
  resolveActiveReconciliationRule?(input: {
    organizationId: string;
    projectId: string;
    executionTimestamp: string;
  }): Promise<CustomSettlementRuleVersion | null>;
  getCachedReconciliationRun?(input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
    inputHash: string;
  }): Promise<PersistedSettlementReconciliationRun | null>;
  persistReconciliationRun?(
    input: PersistReconciliationRunInput,
  ): Promise<PersistedSettlementReconciliationRun | ReconciliationRunMetadata>;
};

export async function runProjectSettlementReconciliation({
  source,
  actor,
  projectId,
  periodStart,
  periodEnd,
  forceApproved = false,
  config,
  expectedInputHash,
  triggerType = "manual",
  triggerBatchId = null,
  onStep,
}: {
  source: ReconciliationDataSource;
  actor: SettlementActor;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  forceApproved?: boolean;
  config?: Partial<ReconciliationConfig>;
  expectedInputHash?: string;
  triggerType?: SettlementReconciliationRunTriggerType;
  triggerBatchId?: string | null;
  onStep?: (step: string) => void;
}): Promise<ProjectSettlementReconciliationRunResult> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can view settlement reconciliation");
  }
  assertPeriod(periodStart, periodEnd);

  const [receivable, payable, cost, settings] = await Promise.all([
    source.getBatchTotals({
      organizationId: actor.organizationId,
      projectId,
      batchType: "receivable",
      periodStart,
      periodEnd,
    }),
    source.getBatchTotals({
      organizationId: actor.organizationId,
      projectId,
      batchType: "payable",
      periodStart,
      periodEnd,
    }),
    source.getConfirmedCostSummary({
      organizationId: actor.organizationId,
      projectId,
    }),
    source.getFinancialSettings({
      organizationId: actor.organizationId,
      projectId,
    }),
  ]);
  const activeRule = source.resolveActiveReconciliationRule
    ? await source.resolveActiveReconciliationRule({
        organizationId: actor.organizationId,
        projectId,
        executionTimestamp: new Date().toISOString(),
      })
    : null;

  assertFinalizedInputs(receivable, payable, cost, settings);

  // Both batch types are priced from the same approved reports, so use the
  // receivable evidence as the income-side signal and fall back to payable when
  // no receivable batch has been generated yet.
  const evidence = hasEvidence(receivable.evidence)
    ? receivable.evidence
    : payable.evidence;

  const coreInput = {
    receivableComputedCents: receivable.totals.computedCents,
    receivableManualCents:
      receivable.totals.manualCents + receivable.totals.adjustmentCents,
    payableTotalCents:
      payable.totals.computedCents +
      payable.totals.manualCents +
      payable.totals.adjustmentCents,
    externalCostCents: cost.costCents - cost.revenueOffsetCents,
    manualAdjustmentCents: cost.adjustmentCents,
    financialSettings: settings,
    evidence,
    forceApproved,
    config,
  };
  onStep?.("compute:core");
  const coreResult = reconcileProjectSettlement(coreInput);
  const inputHash = calculateCustomReconciliationInputHash({
    coreInput,
    activeRule,
  });
  if (expectedInputHash !== undefined && expectedInputHash !== inputHash) {
    throw new Error("Settlement reconciliation input hash changed");
  }

  if (source.getCachedReconciliationRun) {
    const cached = await source.getCachedReconciliationRun({
      organizationId: actor.organizationId,
      projectId,
      periodStart,
      periodEnd,
      inputHash,
    });
    if (cached?.inputHash === inputHash) {
      return deepFreeze(cached.result);
    }
  }

  let result: ProjectSettlementReconciliationRunResult = coreResult;
  let finalChecks = finalChecksWithCoreSource(coreResult);
  let customChecks: ReconciliationCheckWithSource[] = [];
  if (activeRule) {
    onStep?.("build:variables");
    onStep?.("execute:custom_rule");
    result = executeCustomRuleReconciliationChecks({
      coreResult,
      ruleVersion: activeRule,
    });
    onStep?.("append:custom_checks");
    finalChecks = result.checks as ReconciliationCheckWithSource[];
    customChecks = finalChecks.filter((check) => check.source === "custom_rule");
  }

  if (source.persistReconciliationRun) {
    const persisted = await source.persistReconciliationRun({
      organizationId: actor.organizationId,
      projectId,
      periodStart,
      periodEnd,
      triggerType,
      triggerBatchId,
      inputHash,
      coreResult,
      result,
      ruleVersionId: activeRule?.id ?? null,
      formulaHash: activeRule?.formulaHash ?? null,
      customChecks,
      finalChecks,
      blocked: result.hasBlocking,
      warnings: finalChecks.filter((check) => check.severity === "warn"),
      createdBy: actor.userId,
    });
    result = {
      ...result,
      run: {
        id: persisted.id,
        inputHash: persisted.inputHash,
        createdAt: persisted.createdAt,
      },
    };
  }

  return deepFreeze(result);
}

function hasEvidence(evidence: ReconciliationEvidence): boolean {
  return (
    evidence.green > 0 ||
    evidence.yellow > 0 ||
    evidence.red > 0 ||
    (evidence.unknown ?? 0) > 0
  );
}

function assertPeriod(periodStart: string, periodEnd: string): void {
  if (!periodStart || !periodEnd) {
    throw new Error("Settlement period is required");
  }
  if (new Date(periodEnd).getTime() < new Date(periodStart).getTime()) {
    throw new Error("Settlement period end cannot be earlier than start");
  }
}

function assertFinalizedInputs(
  ...inputs: Array<{ finalized?: boolean }>
): void {
  if (inputs.some((input) => input.finalized === false)) {
    throw new Error("Settlement reconciliation requires finalized inputs");
  }
}

// --- Supabase implementation ------------------------------------------------

type SettlementBatchTotalsRow = {
  computed_amount: number | null;
  manual_amount: number | null;
  adjustment_amount: number | null;
  evidence_summary: Record<string, unknown> | null;
  status: string | null;
};

const FINALIZED_SETTLEMENT_BATCH_STATUSES = new Set(["confirmed", "locked"]);
const EXCLUDED_SETTLEMENT_BATCH_STATUSES = new Set(["voided"]);

type CostSummaryRow = {
  amount_cents: number | null;
  direction: "cost" | "revenue_offset" | "adjustment";
};

export class SupabaseReconciliationDataSource
  implements ReconciliationDataSource
{
  constructor(private readonly client: SupabaseClient) {}

  async getBatchTotals(input: {
    organizationId: string;
    projectId: string;
    batchType: "receivable" | "payable";
    periodStart: string;
    periodEnd: string;
  }): Promise<{
    totals: BatchTotals;
    evidence: ReconciliationEvidence;
    finalized?: boolean;
  }> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .select(
        "computed_amount, manual_amount, adjustment_amount, evidence_summary, status",
      )
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("batch_type", input.batchType)
      // Any batch whose period overlaps the requested window.
      .lte("period_start", input.periodEnd)
      .gte("period_end", input.periodStart)
      .returns<SettlementBatchTotalsRow[]>();

    if (error) {
      throw error;
    }

    const totals: BatchTotals = {
      computedCents: 0,
      manualCents: 0,
      adjustmentCents: 0,
    };
    const evidence: ReconciliationEvidence = {
      green: 0,
      yellow: 0,
      red: 0,
      unknown: 0,
    };
    let finalized = true;

    for (const row of data ?? []) {
      if (EXCLUDED_SETTLEMENT_BATCH_STATUSES.has(row.status ?? "")) {
        continue;
      }
      if (!FINALIZED_SETTLEMENT_BATCH_STATUSES.has(row.status ?? "")) {
        finalized = false;
        continue;
      }
      // settlement_batches amounts are numeric(12,2) yuan, while the cost and
      // tax lines are stored in cents. Normalize batch amounts to cents here so
      // the reconciliation sums one consistent unit (mixing the two would skew
      // every total by 100x and make every project look like a loss).
      totals.computedCents += yuanToCents(row.computed_amount);
      totals.manualCents += yuanToCents(row.manual_amount);
      totals.adjustmentCents += yuanToCents(row.adjustment_amount);
      const summary = row.evidence_summary ?? {};
      evidence.green += countOf(summary, "green");
      evidence.yellow += countOf(summary, "yellow");
      evidence.red += countOf(summary, "red");
      evidence.unknown = (evidence.unknown ?? 0) + countOf(summary, "unknown");
    }

    return { totals, evidence, finalized };
  }

  async getConfirmedCostSummary(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ConfirmedCostSummary> {
    const { data, error } = await this.client
      .from("project_cost_items")
      .select("amount_cents, direction")
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("status", "confirmed")
      .returns<CostSummaryRow[]>();

    if (error) {
      throw error;
    }

    const summary: ConfirmedCostSummary = {
      costCents: 0,
      revenueOffsetCents: 0,
      adjustmentCents: 0,
    };
    for (const row of data ?? []) {
      const amount = Number(row.amount_cents ?? 0);
      if (row.direction === "cost") {
        summary.costCents += amount;
      } else if (row.direction === "revenue_offset") {
        summary.revenueOffsetCents += amount;
      } else if (row.direction === "adjustment") {
        summary.adjustmentCents += amount;
      }
    }

    return summary;
  }

  async getFinancialSettings(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectFinancialSettings> {
    const { data, error } = await this.client
      .from("projects")
      .select(
        "is_invoiced, output_vat_rate_bps, surtax_rate_bps, procurement_cost_cents",
      )
      .eq("organization_id", input.organizationId)
      .eq("id", input.projectId)
      .maybeSingle<{
        is_invoiced: boolean | null;
        output_vat_rate_bps: number | null;
        surtax_rate_bps: number | null;
        procurement_cost_cents: number | null;
      }>();

    if (error) {
      throw error;
    }

    return normalizeProjectFinancialSettings({
      isInvoiced: data?.is_invoiced ?? false,
      outputVatRateBps: data?.output_vat_rate_bps ?? 0,
      surtaxRateBps: data?.surtax_rate_bps ?? 0,
      procurementCostCents: data?.procurement_cost_cents ?? 0,
    });
  }

  resolveActiveReconciliationRule(input: {
    organizationId: string;
    projectId: string;
    executionTimestamp: string;
  }): Promise<CustomSettlementRuleVersion | null> {
    return new SupabaseCustomRuleReadRepository(
      this.client,
    ).getActiveProjectReconciliationRule(input);
  }

  async getCachedReconciliationRun(input: {
    organizationId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
    inputHash: string;
  }): Promise<PersistedSettlementReconciliationRun | null> {
    const run = await new SupabaseCustomRuleReadRepository(
      this.client,
    ).getCachedSettlementReconciliationRun(input);
    if (!run) return null;
    return {
      id: run.id,
      inputHash: run.inputHash,
      createdAt: run.createdAt,
      result: {
        ...(run.result as ProjectSettlementReconciliationRunResult),
        run: {
          id: run.id,
          inputHash: run.inputHash,
          createdAt: run.createdAt,
        },
      },
    };
  }

  async persistReconciliationRun(
    input: PersistReconciliationRunInput,
  ): Promise<PersistedSettlementReconciliationRun> {
    const run = await new SupabaseCustomRuleReadRepository(
      this.client,
    ).createSettlementReconciliationRun(input);
    return {
      id: run.id,
      inputHash: run.inputHash,
      createdAt: run.createdAt,
      result: {
        ...input.result,
        run: {
          id: run.id,
          inputHash: run.inputHash,
          createdAt: run.createdAt,
        },
      },
    };
  }
}

function yuanToCents(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.round((value as number) * 100) : 0;
}

function countOf(summary: Record<string, unknown>, key: string): number {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}
