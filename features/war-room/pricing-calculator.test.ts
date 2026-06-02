import { describe, expect, it } from "vitest";

import { calculateProjectPricing } from "./pricing-calculator";

describe("calculateProjectPricing", () => {
  it("calculates CPT quote economics with cents, minutes, and basis points", () => {
    const result = calculateProjectPricing({
      vendorSettlementMethod: "cpt",
      streamerCount: 5,
      estimatedMinutesPerStreamer: 1200,
      vendorHourlyRateCents: 12000,
      streamerHourlyCostCents: 7000,
      supplierCostCents: 200000,
      platformFeeBps: 0,
      manualAdjustmentCents: 0,
      targetMarginBps: 2000,
    });

    expect(result).toMatchObject({
      estimatedDurationMinutes: 6000,
      expectedReceivableCents: 1200000,
      streamerPayableCents: 700000,
      supplierCostCents: 200000,
      platformFeeCents: 0,
      grossMarginCents: 300000,
      marginRateBps: 2500,
      breakEvenQuoteCents: 900000,
      breakEvenVendorHourlyRateCents: 9000,
      suggestedMinimumQuoteCents: 1125000,
      suggestedMinimumVendorHourlyRateCents: 11250,
      recommendedSettlementMethod: "cpt",
      riskNotes: [],
    });
  });

  it("uses explicit zero fallbacks when duration or receivable is absent", () => {
    const result = calculateProjectPricing({
      vendorSettlementMethod: "cpt",
      streamerCount: 3,
      estimatedMinutesPerStreamer: 0,
      vendorHourlyRateCents: 10000,
      streamerHourlyCostCents: 6000,
      supplierCostCents: 30000,
      platformFeeBps: 0,
      manualAdjustmentCents: 0,
      targetMarginBps: 2000,
    });

    expect(result).toMatchObject({
      estimatedDurationMinutes: 0,
      expectedReceivableCents: 0,
      marginRateBps: 0,
      breakEvenQuoteCents: 30000,
      breakEvenVendorHourlyRateCents: null,
      suggestedMinimumVendorHourlyRateCents: null,
      recommendedSettlementMethod: "fixed_budget",
      riskNotes: expect.arrayContaining([
        "zero_estimated_duration",
        "zero_receivable",
        "negative_margin",
      ]),
    });
  });

  it("keeps manual CPA CPS and gift estimates as carried values, not engine proof", () => {
    const result = calculateProjectPricing({
      vendorSettlementMethod: "fixed_budget",
      streamerCount: 2,
      estimatedMinutesPerStreamer: 600,
      vendorBudgetCents: 500000,
      streamerHourlyCostCents: 5000,
      supplierCostCents: 40000,
      expectedManualRevenueCents: 80000,
      platformFeeBps: 500,
      manualAdjustmentCents: -10000,
      targetMarginBps: 3000,
    });

    expect(result).toMatchObject({
      expectedReceivableCents: 580000,
      carriedManualRevenueCents: 80000,
      manualRevenueEvidenceLevel: "red",
      platformFeeCents: 29000,
      grossMarginCents: 401000,
      marginRateBps: 6914,
      recommendedSettlementMethod: "fixed_budget",
    });
  });
});
