import { describe, expect, it } from "vitest";

import {
  calculateProjectFinancials,
  normalizeProjectFinancialSettings,
} from "./project-financials";

describe("calculateProjectFinancials", () => {
  it("charges VAT and surtax only when an invoice is issued", () => {
    const result = calculateProjectFinancials({
      expectedReceivableCents: 1_000_000,
      settings: {
        isInvoiced: true,
        outputVatRateBps: 600, // 6%
        surtaxRateBps: 1200, // 12% of the VAT
        procurementCostCents: 50_000,
      },
    });

    // VAT = 1,000,000 * 6% = 60,000
    expect(result.outputVatCents).toBe(60_000);
    // surtax = 60,000 * 12% = 7,200
    expect(result.surtaxCents).toBe(7_200);
    expect(result.procurementCostCents).toBe(50_000);
    expect(result.totalFinancialCostCents).toBe(60_000 + 7_200 + 50_000);
  });

  it("skips VAT and surtax when no invoice is issued but keeps procurement", () => {
    const result = calculateProjectFinancials({
      expectedReceivableCents: 1_000_000,
      settings: {
        isInvoiced: false,
        outputVatRateBps: 600,
        surtaxRateBps: 1200,
        procurementCostCents: 50_000,
      },
    });

    expect(result.outputVatCents).toBe(0);
    expect(result.surtaxCents).toBe(0);
    expect(result.totalFinancialCostCents).toBe(50_000);
  });

  it("clamps out-of-range rates and negative amounts", () => {
    const result = calculateProjectFinancials({
      expectedReceivableCents: -100,
      settings: {
        isInvoiced: true,
        outputVatRateBps: 20000,
        surtaxRateBps: -50,
        procurementCostCents: -10,
      },
    });

    expect(result.outputVatRateBps).toBe(10000);
    expect(result.surtaxRateBps).toBe(0);
    expect(result.procurementCostCents).toBe(0);
    expect(result.outputVatCents).toBe(0); // receivable clamped to 0
    expect(result.totalFinancialCostCents).toBe(0);
  });

  it("normalizes partial settings", () => {
    expect(normalizeProjectFinancialSettings(null)).toEqual({
      isInvoiced: false,
      outputVatRateBps: 0,
      surtaxRateBps: 0,
      procurementCostCents: 0,
    });
    expect(
      normalizeProjectFinancialSettings({
        isInvoiced: true,
        outputVatRateBps: 600,
      }),
    ).toEqual({
      isInvoiced: true,
      outputVatRateBps: 600,
      surtaxRateBps: 0,
      procurementCostCents: 0,
    });
  });
});
