import { describe, expect, it, vi } from "vitest";

import {
  runProjectSettlementReconciliation,
  SupabaseReconciliationDataSource,
  type ReconciliationDataSource,
} from "./project-settlement-reconciliation-service";
import type { SettlementActor } from "./settlement-service";

const actor: SettlementActor = {
  userId: "user-1",
  name: "运营经理",
  role: "ops_manager",
  organizationId: "org-1",
};

function createSource(
  overrides: Partial<{
    receivable: { totals: Totals; evidence: Evidence };
    payable: { totals: Totals; evidence: Evidence };
    cost: { costCents: number; revenueOffsetCents: number; adjustmentCents: number };
    settings: {
      isInvoiced: boolean;
      outputVatRateBps: number;
      surtaxRateBps: number;
      procurementCostCents: number;
    };
  }> = {},
): ReconciliationDataSource {
  const zeroEvidence = { green: 0, yellow: 0, red: 0, unknown: 0 };
  const receivable = overrides.receivable ?? {
    totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
    evidence: { green: 8, yellow: 0, red: 0, unknown: 0 },
  };
  const payable = overrides.payable ?? {
    totals: { computedCents: 400_000, manualCents: 0, adjustmentCents: 0 },
    evidence: zeroEvidence,
  };
  const cost = overrides.cost ?? {
    costCents: 100_000,
    revenueOffsetCents: 0,
    adjustmentCents: 0,
  };
  const settings = overrides.settings ?? {
    isInvoiced: false,
    outputVatRateBps: 0,
    surtaxRateBps: 0,
    procurementCostCents: 0,
  };

  return {
    getBatchTotals: vi.fn(async ({ batchType }) =>
      batchType === "receivable" ? receivable : payable,
    ),
    getConfirmedCostSummary: vi.fn(async () => cost),
    getFinancialSettings: vi.fn(async () => settings),
  };
}

type Totals = { computedCents: number; manualCents: number; adjustmentCents: number };
type Evidence = { green: number; yellow: number; red: number; unknown?: number };

describe("runProjectSettlementReconciliation", () => {
  it("composes batch, cost and tax inputs into the reconciliation result", async () => {
    const source = createSource({
      receivable: {
        totals: { computedCents: 1_000_000, manualCents: 20_000, adjustmentCents: 0 },
        evidence: { green: 9, yellow: 1, red: 0, unknown: 0 },
      },
      payable: {
        totals: { computedCents: 400_000, manualCents: 0, adjustmentCents: 10_000 },
        evidence: { green: 0, yellow: 0, red: 0, unknown: 0 },
      },
      cost: { costCents: 100_000, revenueOffsetCents: 30_000, adjustmentCents: 5_000 },
      settings: {
        isInvoiced: true,
        outputVatRateBps: 600,
        surtaxRateBps: 1200,
        procurementCostCents: 50_000,
      },
    });

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    // R = 1,000,000 + 20,000 manual.
    expect(result.income.receivableCents).toBe(1_020_000);
    // payable = 400,000 + 10,000 adjustment.
    expect(result.cost.payableCents).toBe(410_000);
    // external = cost 100,000 - revenue_offset 30,000.
    expect(result.cost.externalCostCents).toBe(70_000);
    expect(result.cost.procurementCents).toBe(50_000);
    expect(result.profit.manualAdjustmentCents).toBe(5_000);
    // VAT = 1,020,000 * 6% = 61,200.
    expect(result.tax.outputVatCents).toBe(61_200);
    expect(result.evidence.yellow).toBe(1);
    expect(result.canConfirm).toBe(true);
  });

  it("falls back to payable evidence when no receivable batch exists yet", async () => {
    const source = createSource({
      receivable: {
        totals: { computedCents: 500_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 0, yellow: 0, red: 0, unknown: 0 },
      },
      payable: {
        totals: { computedCents: 100_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 3, yellow: 0, red: 2, unknown: 0 },
      },
    });

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(result.evidence.red).toBe(2);
    expect(result.checks.some((c) => c.key === "evidence_red")).toBe(true);
  });

  it("rejects non-MCN roles", async () => {
    const source = createSource();
    await expect(
      runProjectSettlementReconciliation({
        source,
        actor: { ...actor, role: "streamer" },
        projectId: "p-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).rejects.toThrow(/MCN staff/);
    expect(source.getBatchTotals).not.toHaveBeenCalled();
  });

  it("rejects an inverted period", async () => {
    const source = createSource();
    await expect(
      runProjectSettlementReconciliation({
        source,
        actor,
        projectId: "p-1",
        periodStart: "2026-06-30",
        periodEnd: "2026-06-01",
      }),
    ).rejects.toThrow(/period end cannot be earlier/);
  });
});

describe("SupabaseReconciliationDataSource", () => {
  it("normalizes numeric(12,2) yuan batch amounts to cents", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: function () {
            return this;
          },
          neq: function () {
            return this;
          },
          lte: function () {
            return this;
          },
          gte: function () {
            return this;
          },
          returns: async () =>
            table === "settlement_batches"
              ? {
                  data: [
                    {
                      computed_amount: 1234.56,
                      manual_amount: 10.0,
                      adjustment_amount: 0,
                      evidence_summary: { green: 3, yellow: 1, red: 0 },
                    },
                  ],
                  error: null,
                }
              : { data: [], error: null },
        }),
      }),
    };

    const source = new SupabaseReconciliationDataSource(client as never);
    const { totals, evidence } = await source.getBatchTotals({
      organizationId: "org-1",
      projectId: "p-1",
      batchType: "receivable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    // 1234.56 yuan -> 123456 cents; 10.00 yuan -> 1000 cents.
    expect(totals.computedCents).toBe(123_456);
    expect(totals.manualCents).toBe(1_000);
    expect(evidence.green).toBe(3);
    expect(evidence.yellow).toBe(1);
  });
});
