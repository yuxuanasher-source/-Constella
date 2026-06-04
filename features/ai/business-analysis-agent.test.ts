import { describe, expect, it } from "vitest";

import { runBusinessAnalysisAgent } from "./business-analysis-agent";
import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";
import type { ProjectReviewInput } from "@/features/war-room/project-review-report";

describe("runBusinessAnalysisAgent", () => {
  it("S1 recommends continuing a profitable project with fully sourced facts", () => {
    const result = runBusinessAnalysisAgent(createInput());

    expect(result.report).toMatchObject({
      projectId: "project-s1",
      marginRateBps: 4167,
      shouldContinue: true,
    });
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.output.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Margin rate is 4167 bps",
          sourceTool: "project_review_summary",
          sourceId: "project-s1:marginRateBps",
        }),
        expect.objectContaining({
          statement: "Gross margin is 500000 cents",
          sourceId: "project-s1:grossMarginCents",
        }),
      ]),
    );
    expect(result.output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Project economics support continuing the next round",
          evidence: [
            { sourceTool: "project_review_summary", sourceId: "project-s1:marginRateBps" },
            { sourceTool: "project_review_summary", sourceId: "project-s1:shouldContinue" },
          ],
        }),
      ]),
    );
    expect(result.output.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Continue the project with the current operating guardrails",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.output);
  });

  it("S2 recommends pricing review when margin is below target", () => {
    const result = runBusinessAnalysisAgent(
      createInput({
        projectId: "project-s2",
        finance: {
          receivableCents: 1000000,
          payableCents: 750000,
          supplierCostCents: 150000,
          adjustmentCents: 0,
          manualRevenueCents: 0,
        },
      }),
    );

    expect(result.report).toMatchObject({
      marginRateBps: 1000,
      shouldContinue: false,
      riskNotes: expect.arrayContaining(["low_margin"]),
    });
    expect(result.validation.valid).toBe(true);
    expect(result.output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Project economics require quote review before continuation",
        }),
      ]),
    );
    expect(result.output.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Review pricing before opening the next round",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.output);
  });

  it("S3 keeps zero receivable finite and records unverified external caveats", () => {
    const result = runBusinessAnalysisAgent(
      createInput({
        projectId: "project-s3",
        finance: {
          receivableCents: 0,
          payableCents: 100000,
          supplierCostCents: 0,
          adjustmentCents: 0,
          manualRevenueCents: 0,
        },
        streamers: [],
        evidenceSummary: { green: 0, yellow: 0, red: 0, unknown: 2 },
      }),
    );

    expect(result.report).toMatchObject({
      marginRateBps: 0,
      shouldContinue: false,
      riskNotes: expect.arrayContaining(["zero_receivable", "negative_margin"]),
    });
    expect(Number.isFinite(result.report.marginRateBps)).toBe(true);
    expect(result.validation.valid).toBe(true);
    expect(result.output.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Market demand and competitor timing were not verified",
          unverifiedExternalFactor: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.output);
  });

  it("S4 highlights anomaly and dispute risk without executing replacement", () => {
    const result = runBusinessAnalysisAgent(
      createInput({
        projectId: "project-s4",
        streamers: [
          {
            id: "streamer-a",
            name: "Ava",
            durationMinutes: 1200,
            totalViews: 120000,
            completionRateBps: 9500,
            roiBps: 14000,
            grossMarginContributionCents: 320000,
            anomalyCount: 2,
            disputeCount: 1,
          },
        ],
      }),
    );

    expect(result.report).toMatchObject({
      anomalyCount: 2,
      disputeCount: 1,
      nextRoundRecommendations: expect.arrayContaining([
        "replace_high_risk_streamers",
      ]),
    });
    expect(result.validation.valid).toBe(true);
    expect(result.output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Delivery risk needs manual review before scaling",
        }),
      ]),
    );
    expect(result.output.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Review high risk streamer allocation before execution",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.output);
  });
});

function createInput(
  overrides: Partial<{
    projectId: string;
    finance: ProjectReviewInput["finance"];
    streamers: ProjectReviewInput["streamers"];
    evidenceSummary: ProjectReviewInput["evidenceSummary"];
  }> = {},
): ProjectReviewInput {
  return {
    project: {
      id: overrides.projectId ?? "project-s1",
      name: "Campaign Alpha",
      category: "moba",
      platform: "douyin",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
    },
    finance:
      overrides.finance ?? {
        receivableCents: 1200000,
        payableCents: 600000,
        supplierCostCents: 100000,
        adjustmentCents: 0,
        manualRevenueCents: 80000,
      },
    streamers:
      overrides.streamers ?? [
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
    evidenceSummary: overrides.evidenceSummary ?? {
      green: 8,
      yellow: 1,
      red: 0,
      unknown: 0,
    },
    targetMarginBps: 3000,
  };
}

function expectNoNumbersOutsideFacts(output: AgentOutput): void {
  expect(validateAgentOutput(output)).toEqual({ valid: true, errors: [] });
  const nonFactText = [
    ...output.findings.map((finding) => finding.summary),
    ...output.caveats.map((caveat) => caveat.summary),
    ...output.recommendations.flatMap((recommendation) => [
      recommendation.proposal,
      recommendation.expectedImpact ?? "",
    ]),
  ].join(" ");

  expect(nonFactText).not.toMatch(/\d/);
}
