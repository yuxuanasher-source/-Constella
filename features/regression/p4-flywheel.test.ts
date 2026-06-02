import { describe, expect, it, vi } from "vitest";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { evaluateAutoReviewActive } from "@/features/auto-review/auto-review-service";
import { rankStreamerCandidates } from "@/features/war-room/matching-engine";
import { calculateProjectPricing } from "@/features/war-room/pricing-calculator";
import { buildProjectReviewReport } from "@/features/war-room/project-review-report";

function createAuditClient() {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error: null })),
    })),
  };
}

describe("P4 flywheel regression", () => {
  it("connects quote, matching, auto-review, project review, and safe AI diagnosis", async () => {
    const actor = {
      userId: "user-ops",
      name: "Ops Manager",
      role: "ops_manager" as const,
      organizationId: "org-1",
    };
    const pricing = calculateProjectPricing({
      vendorSettlementMethod: "cpt",
      streamerCount: 5,
      estimatedMinutesPerStreamer: 1200,
      vendorHourlyRateCents: 12000,
      streamerHourlyCostCents: 7000,
      supplierCostCents: 200000,
      targetMarginBps: 2000,
    });
    const [match] = rankStreamerCandidates({
      project: {
        category: "moba",
        platform: "douyin",
        preferredStyles: ["高互动"],
        requiredMinutes: 900,
      },
      candidates: [
        {
          id: "streamer-a",
          name: "Ava",
          categories: ["moba"],
          platforms: ["douyin"],
          styles: ["高互动"],
          completionRateBps: 9200,
          screeningPassRateBps: 8800,
          roiBps: 14000,
          grossMarginContributionCents: 180000,
          riskTags: [],
          availableMinutes: 1200,
          referenceProjects: [],
        },
      ],
    });
    const approveReport = vi.fn(async (input: unknown) => {
      void input;
      return {
        id: "report-1",
        status: "approved",
        enterSettlementPool: true,
      };
    });
    const autoReview = await evaluateAutoReviewActive({
      client: createAuditClient(),
      actor,
      report: {
        id: "report-1",
        status: "pending_review",
        evidenceLevel: "green",
        timeSource: "system",
        settlementDuration: 120,
        systemDuration: 120,
        screenshotDuration: 120,
        riskFlags: [],
        taskHasAnomaly: false,
        durationOverridden: false,
        projectSensitivity: "normal",
        streamerTrust: "trusted",
        plannedDuration: 120,
      },
      rule: {
        id: "rule-active",
        mode: "active",
        maxDurationDeviationPct: 10,
        maxDurationDeviationMinutes: 15,
        dailyHardLimitMinutes: 480,
      },
      approveReport,
    });
    const review = buildProjectReviewReport({
      project: {
        id: "project-1",
        name: "王者荣耀春节档",
        category: "moba",
        platform: "douyin",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-07",
      },
      finance: {
        receivableCents: pricing.expectedReceivableCents,
        payableCents: pricing.streamerPayableCents,
        supplierCostCents: pricing.supplierCostCents,
        adjustmentCents: 0,
        manualRevenueCents: 0,
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
      ],
      suppliers: [],
      evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
      targetMarginBps: 2000,
    });
    const diagnosis = await runAiToolQuery({
      client: createAuditClient(),
      actor: { ...actor, role: "streamer" },
      toolName: "streamer_diagnosis",
      input: {
        report: {
          totalViews: 300,
          grossMarginCents: review.grossMarginCents,
        },
        feedback: ["互动断层"],
      },
    });

    expect(pricing.grossMarginCents).toBe(300000);
    expect(match).toMatchObject({
      streamerId: "streamer-a",
      suggestedSettlementMethod: "base_salary_cpt",
    });
    expect(autoReview).toMatchObject({
      decision: "auto_pass_candidate",
      applied: true,
    });
    expect(JSON.stringify(approveReport.mock.calls[0][0])).not.toMatch(
      /computedAmount|manualAmount/,
    );
    expect(review).toMatchObject({
      shouldContinue: true,
      bestStreamer: { streamerId: "streamer-a" },
    });
    expect(JSON.stringify(diagnosis.output)).not.toContain("grossMarginCents");
  });
});
