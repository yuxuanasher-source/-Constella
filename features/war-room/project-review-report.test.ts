import { describe, expect, it } from "vitest";

import { buildProjectReviewReport } from "./project-review-report";

describe("buildProjectReviewReport", () => {
  it("summarizes delivery, finance, streamers, supplier performance, and next-round suggestions", () => {
    const report = buildProjectReviewReport({
      project: {
        id: "project-1",
        name: "王者荣耀春节档",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
      },
      finance: {
        receivableCents: 1200000,
        payableCents: 600000,
        supplierCostCents: 100000,
        adjustmentCents: 0,
        manualRevenueCents: 80000,
      },
      streamers: [
        {
          id: "streamer-a",
          name: "Ava",
          durationMinutes: 1200,
          totalViews: 120000,
          completionRateBps: 9500,
          roiBps: 14000,
          grossMarginContributionCents: 320000,
          anomalyCount: 0,
          disputeCount: 0,
        },
        {
          id: "streamer-b",
          name: "Bo",
          durationMinutes: 600,
          totalViews: 50000,
          completionRateBps: 6000,
          roiBps: 5000,
          grossMarginContributionCents: 30000,
          anomalyCount: 2,
          disputeCount: 1,
        },
      ],
      suppliers: [
        {
          id: "supplier-a",
          name: "星河公会",
          screeningPassRateBps: 9000,
          completionRateBps: 8500,
          marginContributionCents: 1500000,
          anomalyRateBps: 500,
          blacklistRateBps: 0,
          isBlacklisted: false,
        },
      ],
      evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
      targetMarginBps: 3000,
    });

    expect(report).toMatchObject({
      projectId: "project-1",
      streamerCount: 2,
      totalDurationMinutes: 1800,
      totalViews: 170000,
      effectiveManualRevenueCents: 80000,
      grossMarginCents: 500000,
      marginRateBps: 4167,
      bestStreamer: { streamerId: "streamer-a", name: "Ava" },
      worstStreamer: { streamerId: "streamer-b", name: "Bo" },
      supplierPerformance: [
        { supplierId: "supplier-a", supplierName: "星河公会", grade: "A" },
      ],
      anomalyCount: 2,
      disputeCount: 1,
      shouldContinue: true,
      nextSuggestedQuoteCents: 1320000,
      nextRoundRecommendations: expect.arrayContaining([
        "retain_best_streamers",
        "replace_high_risk_streamers",
      ]),
    });
  });

  it("uses explicit fallbacks for zero receivable instead of NaN or Infinity", () => {
    const report = buildProjectReviewReport({
      project: {
        id: "project-empty",
        name: "零预算测试",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
      },
      finance: {
        receivableCents: 0,
        payableCents: 100000,
        supplierCostCents: 0,
        adjustmentCents: 0,
        manualRevenueCents: 0,
      },
      streamers: [],
      suppliers: [],
      evidenceSummary: { green: 0, yellow: 0, red: 0, unknown: 0 },
      targetMarginBps: 3000,
    });

    expect(report).toMatchObject({
      marginRateBps: 0,
      shouldContinue: false,
      nextSuggestedQuoteCents: 100000,
      riskNotes: expect.arrayContaining(["zero_receivable", "negative_margin"]),
    });
    expect(Number.isFinite(report.marginRateBps)).toBe(true);
  });

  it("keeps unavailable streamer metrics explicit instead of scoring fabricated zeroes", () => {
    const report = buildProjectReviewReport({
      project: {
        id: "project-missing-performance",
        name: "缺口项目",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
      },
      finance: {
        receivableCents: 100000,
        payableCents: 50000,
        supplierCostCents: 10000,
        adjustmentCents: 0,
        manualRevenueCents: 0,
      },
      streamers: [
        {
          id: "streamer-no-performance",
          name: "No Performance",
          durationMinutes: 0,
          totalViews: 0,
          completionRateBps: null,
          roiBps: null,
          grossMarginContributionCents: null,
          anomalyCount: 0,
          disputeCount: 0,
        },
      ],
      suppliers: [],
      evidenceSummary: { green: 0, yellow: 0, red: 0, unknown: 1 },
    });

    expect(report.bestStreamer).toBeNull();
    expect(report.worstStreamer).toBeNull();
    expect(report.nextRoundRecommendations).not.toContain(
      "retain_best_streamers",
    );
    expect(report.riskNotes).toEqual(
      expect.arrayContaining([
        "streamer_completion_rate_unavailable",
        "streamer_roi_unavailable",
        "streamer_gross_margin_contribution_unavailable",
      ]),
    );
  });

  it("keeps partial streamer metrics on their original absolute weights", () => {
    const report = buildProjectReviewReport({
      project: {
        id: "project-partial-performance",
        name: "部分指标项目",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
      },
      finance: {
        receivableCents: 100000,
        payableCents: 50000,
        supplierCostCents: 10000,
        adjustmentCents: 0,
        manualRevenueCents: 0,
      },
      streamers: [
        {
          id: "streamer-completion-only",
          name: "Completion Only",
          durationMinutes: 0,
          totalViews: 0,
          completionRateBps: 10000,
          roiBps: null,
          grossMarginContributionCents: null,
          anomalyCount: 0,
          disputeCount: 0,
        },
      ],
      suppliers: [],
      evidenceSummary: { green: 0, yellow: 0, red: 0, unknown: 1 },
    });

    expect(report.bestStreamer).toMatchObject({
      streamerId: "streamer-completion-only",
      score: 35,
    });
  });
});
