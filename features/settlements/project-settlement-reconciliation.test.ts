import { describe, expect, it } from "vitest";

import {
  reconcileProjectSettlement,
  type ProjectSettlementReconciliationInput,
} from "./project-settlement-reconciliation";

const baseSettings = {
  isInvoiced: false,
  outputVatRateBps: 0,
  surtaxRateBps: 0,
  procurementCostCents: 0,
};

function build(
  overrides: Partial<ProjectSettlementReconciliationInput> = {},
): ProjectSettlementReconciliationInput {
  return {
    receivableComputedCents: 1_000_000,
    payableTotalCents: 400_000,
    externalCostCents: 100_000,
    financialSettings: { ...baseSettings },
    evidence: { green: 10, yellow: 0, red: 0 },
    ...overrides,
  };
}

describe("reconcileProjectSettlement", () => {
  it("computes income, cost, tax and margin for a healthy invoiced project", () => {
    const result = reconcileProjectSettlement(
      build({
        receivableComputedCents: 1_000_000,
        receivableManualCents: 0,
        payableTotalCents: 400_000,
        externalCostCents: 100_000,
        financialSettings: {
          isInvoiced: true,
          outputVatRateBps: 600, // 6%
          surtaxRateBps: 1200, // 12% of VAT
          procurementCostCents: 50_000,
        },
      }),
    );

    expect(result.income.receivableCents).toBe(1_000_000);
    // VAT = 1,000,000 * 6% = 60,000; surtax = 60,000 * 12% = 7,200.
    expect(result.tax.outputVatCents).toBe(60_000);
    expect(result.tax.surtaxCents).toBe(7_200);
    expect(result.tax.taxTotalCents).toBe(67_200);
    // Invoice face value = R + VAT.
    expect(result.tax.invoiceAmountCents).toBe(1_060_000);
    // Cost = payable + external + procurement.
    expect(result.cost.totalCents).toBe(550_000);
    // GM = R - COST - TAX = 1,000,000 - 550,000 - 67,200.
    expect(result.profit.grossMarginCents).toBe(382_800);
    expect(result.profit.marginRateBps).toBe(3828);
    expect(result.hasBlocking).toBe(false);
    expect(result.canConfirm).toBe(true);
    expect(result.canLock).toBe(true);
  });

  it("does not charge VAT when the project is not invoiced", () => {
    const result = reconcileProjectSettlement(
      build({
        financialSettings: {
          isInvoiced: false,
          outputVatRateBps: 600,
          surtaxRateBps: 1200,
          procurementCostCents: 0,
        },
      }),
    );

    expect(result.tax.outputVatCents).toBe(0);
    expect(result.tax.surtaxCents).toBe(0);
    expect(result.tax.invoiceAmountCents).toBe(1_000_000);
  });

  it("blocks confirmation when the project has no receivable configured", () => {
    const result = reconcileProjectSettlement(
      build({ receivableComputedCents: 0, receivableManualCents: 0 }),
    );

    const check = result.checks.find((c) => c.key === "income_configured");
    expect(check?.severity).toBe("block");
    expect(result.hasBlocking).toBe(true);
    expect(result.canConfirm).toBe(false);
  });

  it("allows a zero receivable when explicitly configured", () => {
    const result = reconcileProjectSettlement(
      build({
        receivableComputedCents: 0,
        payableTotalCents: 0,
        externalCostCents: 0,
        config: { allowZeroReceivable: true },
      }),
    );

    expect(
      result.checks.some((c) => c.key === "income_configured"),
    ).toBe(false);
    expect(result.canConfirm).toBe(true);
  });

  it("blocks when an invoiced project is missing its VAT rate", () => {
    const result = reconcileProjectSettlement(
      build({
        financialSettings: {
          isInvoiced: true,
          outputVatRateBps: 0,
          surtaxRateBps: 0,
          procurementCostCents: 0,
        },
      }),
    );

    const check = result.checks.find((c) => c.key === "tax_complete");
    expect(check?.severity).toBe("block");
    expect(result.canConfirm).toBe(false);
  });

  it("blocks a negative-margin batch and force-release downgrades it to a warning", () => {
    const losing = build({
      receivableComputedCents: 100_000,
      payableTotalCents: 400_000,
      externalCostCents: 0,
    });

    const blocked = reconcileProjectSettlement(losing);
    expect(blocked.profit.grossMarginCents).toBeLessThan(0);
    expect(
      blocked.checks.find((c) => c.key === "margin_floor")?.severity,
    ).toBe("block");
    expect(blocked.canConfirm).toBe(false);

    const released = reconcileProjectSettlement({
      ...losing,
      forceApproved: true,
    });
    expect(
      released.checks.find((c) => c.key === "margin_floor")?.severity,
    ).toBe("warn");
    expect(released.hasBlocking).toBe(false);
    expect(released.canConfirm).toBe(true);
  });

  it("blocks when margin rate is under a configured floor", () => {
    const result = reconcileProjectSettlement(
      build({
        receivableComputedCents: 1_000_000,
        payableTotalCents: 900_000,
        externalCostCents: 0,
        config: { marginRateFloorBps: 2000 }, // require >= 20%
      }),
    );

    // GM = 100,000 -> 10% margin, under the 20% floor.
    expect(result.profit.marginRateBps).toBe(1000);
    expect(
      result.checks.find((c) => c.key === "margin_floor")?.severity,
    ).toBe("block");
  });

  it("warns on red evidence and high yellow ratio without blocking", () => {
    const result = reconcileProjectSettlement(
      build({ evidence: { green: 5, yellow: 4, red: 1 } }),
    );

    const red = result.checks.find((c) => c.key === "evidence_red");
    const yellow = result.checks.find((c) => c.key === "evidence_yellow_ratio");
    expect(red?.severity).toBe("warn");
    // yellow ratio = 4/10 = 40% > 20%.
    expect(yellow?.severity).toBe("warn");
    expect(result.hasBlocking).toBe(false);
    expect(result.hasWarning).toBe(true);
    expect(result.canConfirm).toBe(true);
  });

  it("warns when the receivable and payable pools do not match", () => {
    const result = reconcileProjectSettlement(
      build({ poolMismatchReportIds: ["r1", "r2"] }),
    );

    const check = result.checks.find((c) => c.key === "pool_consistency");
    expect(check?.severity).toBe("warn");
    expect(result.canConfirm).toBe(true);
  });

  it("treats revenue-offset external cost as a negative cost line", () => {
    const result = reconcileProjectSettlement(
      build({ externalCostCents: -50_000, payableTotalCents: 0 }),
    );

    expect(result.cost.externalCostCents).toBe(-50_000);
    expect(result.cost.totalCents).toBe(-50_000);
  });
});
