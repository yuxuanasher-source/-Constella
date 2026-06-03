import { describe, expect, it } from "vitest";

import {
  toPricingResultDto,
  toProjectReviewDto,
  toSupplierQualityDtos,
  toStreamerMatchDtos,
} from "./war-room-ui-dto";

describe("war room UI DTOs", () => {
  it("formats pricing cents and basis points for display", () => {
    expect(
      toPricingResultDto({
        estimatedDurationMinutes: 6000,
        expectedReceivableCents: 1200000,
        streamerPayableCents: 700000,
        supplierCostCents: 200000,
        platformFeeCents: 0,
        carriedManualRevenueCents: 0,
        manualRevenueEvidenceLevel: "red",
        grossMarginCents: 300000,
        marginRateBps: 2500,
        breakEvenQuoteCents: 900000,
        breakEvenVendorHourlyRateCents: 9000,
        suggestedMinimumQuoteCents: 1125000,
        suggestedMinimumVendorHourlyRateCents: 11250,
        recommendedSettlementMethod: "cpt",
        riskNotes: ["margin_below_target"],
      }),
    ).toEqual({
      estimatedDurationLabel: "100.0 h",
      expectedReceivableLabel: "12,000.00 元",
      streamerPayableLabel: "7,000.00 元",
      supplierCostLabel: "2,000.00 元",
      platformFeeLabel: "0.00 元",
      grossMarginLabel: "3,000.00 元",
      marginRateLabel: "25.00%",
      breakEvenQuoteLabel: "9,000.00 元",
      suggestedMinimumQuoteLabel: "11,250.00 元",
      recommendedSettlementMethodLabel: "CPT",
      riskNotes: ["margin_below_target"],
    });
  });

  it("maps matching and supplier API results into reference UI rows", () => {
    expect(
      toStreamerMatchDtos([
        {
          streamerId: "streamer-a",
          streamerName: "Ava",
          score: 93,
          reasons: ["category_match"],
          riskNotes: ["availability_shortage"],
          referenceProjects: [],
          suggestedSettlementMethod: "base_salary_cpt",
        },
      ]),
    ).toEqual([
      {
        id: "streamer-a",
        alias: "Ava",
        score: 93,
        reasons: ["category_match"],
        risks: ["availability_shortage"],
        suggestedSettlementMethodLabel: "底薪 + CPT",
      },
    ]);

    expect(
      toSupplierQualityDtos([
        {
          supplierId: "supplier-a",
          supplierName: "星河公会",
          score: 89,
          grade: "A",
          reasons: ["high_screening_pass_rate"],
          riskNotes: [],
        },
      ]),
    ).toEqual([
      {
        id: "supplier-a",
        name: "星河公会",
        score: 89,
        grade: "A",
        streamers: 0,
        finishRate: 0,
        anomalyRate: 0,
        grossContrib: 0,
        trend: "+0",
        reasons: ["high_screening_pass_rate"],
        risks: [],
      },
    ]);
  });

  it("formats project review output into concise UI labels", () => {
    expect(
      toProjectReviewDto({
        projectId: "project-1",
        projectName: "王者荣耀春节档",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
        streamerCount: 2,
        totalDurationMinutes: 1800,
        totalViews: 170000,
        effectiveManualRevenueCents: 80000,
        receivableCents: 1200000,
        payableCents: 600000,
        supplierCostCents: 100000,
        grossMarginCents: 500000,
        marginRateBps: 4167,
        bestStreamer: { streamerId: "streamer-a", name: "Ava", score: 92 },
        worstStreamer: { streamerId: "streamer-b", name: "Bo", score: 48 },
        supplierPerformance: [],
        evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
        anomalyCount: 2,
        disputeCount: 1,
        shouldContinue: true,
        nextSuggestedQuoteCents: 1320000,
        nextRoundRecommendations: ["retain_best_streamers"],
        riskNotes: ["review_disputes"],
      }),
    ).toEqual({
      conclusionLabel: "继续投入",
      grossMarginLabel: "5,000.00 元",
      marginRateLabel: "41.67%",
      nextSuggestedQuoteLabel: "13,200.00 元",
      totalDurationLabel: "30.0 h",
      totalViewsLabel: "170,000",
      bestStreamerLabel: "Ava",
      worstStreamerLabel: "Bo",
      recommendations: ["retain_best_streamers"],
      riskNotes: ["review_disputes"],
    });
  });
});
