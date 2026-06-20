import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeProjectFinancialSettings,
  type ProjectFinancialSettings,
} from "@/features/complex-cost/project-financials";
import { isMcnStaff } from "@/lib/rbac/roles";

import {
  reconcileProjectSettlement,
  type ProjectSettlementReconciliationResult,
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

export type ConfirmedCostSummary = {
  costCents: number;
  revenueOffsetCents: number;
  adjustmentCents: number;
};

export type ReconciliationDataSource = {
  getBatchTotals(input: {
    organizationId: string;
    projectId: string;
    batchType: "receivable" | "payable";
    periodStart: string;
    periodEnd: string;
  }): Promise<{ totals: BatchTotals; evidence: ReconciliationEvidence }>;
  getConfirmedCostSummary(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ConfirmedCostSummary>;
  getFinancialSettings(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectFinancialSettings>;
};

export async function runProjectSettlementReconciliation({
  source,
  actor,
  projectId,
  periodStart,
  periodEnd,
  forceApproved = false,
  config,
}: {
  source: ReconciliationDataSource;
  actor: SettlementActor;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  forceApproved?: boolean;
  config?: Partial<ReconciliationConfig>;
}): Promise<ProjectSettlementReconciliationResult> {
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

  // Both batch types are priced from the same approved reports, so use the
  // receivable evidence as the income-side signal and fall back to payable when
  // no receivable batch has been generated yet.
  const evidence = hasEvidence(receivable.evidence)
    ? receivable.evidence
    : payable.evidence;

  return reconcileProjectSettlement({
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
  });
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

// --- Supabase implementation ------------------------------------------------

type SettlementBatchTotalsRow = {
  computed_amount: number | null;
  manual_amount: number | null;
  adjustment_amount: number | null;
  evidence_summary: Record<string, unknown> | null;
};

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
  }): Promise<{ totals: BatchTotals; evidence: ReconciliationEvidence }> {
    const { data, error } = await this.client
      .from("settlement_batches")
      .select(
        "computed_amount, manual_amount, adjustment_amount, evidence_summary",
      )
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("batch_type", input.batchType)
      .neq("status", "voided")
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

    for (const row of data ?? []) {
      totals.computedCents += Number(row.computed_amount ?? 0);
      totals.manualCents += Number(row.manual_amount ?? 0);
      totals.adjustmentCents += Number(row.adjustment_amount ?? 0);
      const summary = row.evidence_summary ?? {};
      evidence.green += countOf(summary, "green");
      evidence.yellow += countOf(summary, "yellow");
      evidence.red += countOf(summary, "red");
      evidence.unknown = (evidence.unknown ?? 0) + countOf(summary, "unknown");
    }

    return { totals, evidence };
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
}

function countOf(summary: Record<string, unknown>, key: string): number {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}
