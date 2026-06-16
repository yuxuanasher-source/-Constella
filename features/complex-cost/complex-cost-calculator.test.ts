import { describe, expect, it } from "vitest";

import {
  calculateComplexCostPreview,
  calculateImportedCostAmountCents,
} from "./complex-cost-calculator";

describe("complex cost calculator", () => {
  it("previews game live project costs and gross margin", () => {
    expect(
      calculateComplexCostPreview({
        expectedReceivableCents: 1_000_000,
        streamerCount: 5,
        estimatedMinutesPerStreamer: 120,
        streamerHourlyCostCents: 8_000,
        streamerBaseCostCents: 20_000,
        supplierCostCents: 100_000,
        trafficCostCents: 80_000,
        platformFeeBps: 500,
        manualAdjustmentCents: -10_000,
      }),
    ).toMatchObject({
      estimatedDurationMinutes: 600,
      streamerPayableCents: 180_000,
      supplierCostCents: 100_000,
      trafficCostCents: 80_000,
      platformFeeCents: 50_000,
      grossMarginCents: 580_000,
      marginRateBps: 5800,
      riskNotes: [],
    });
  });

  it("calculates imported CPA, CPS, gift, and direct costs", () => {
    expect(
      calculateImportedCostAmountCents({
        itemType: "cpa",
        unitCount: 20,
        unitPriceCents: 3000,
      }),
    ).toBe(60_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "cps",
        salesAmountCents: 200_000,
        rateBps: 1500,
      }),
    ).toBe(30_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "gift",
        salesAmountCents: 100_000,
        rateBps: 5000,
      }),
    ).toBe(50_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "traffic",
        directAmountCents: 88_000,
      }),
    ).toBe(88_000);
  });
});
