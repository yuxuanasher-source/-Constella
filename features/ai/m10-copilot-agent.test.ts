import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import { runM10CopilotAgent, type M10CopilotInput } from "./m10-copilot-agent";
import type { AgentOutput } from "./contracts";

describe("runM10CopilotAgent", () => {
  it("routes pricing tradeoff intent into a ready review envelope", () => {
    const result = runM10CopilotAgent({
      intent: "pricing_tradeoff",
      payload: createPricingPayload(),
    });

    expect(result).toMatchObject({
      intent: "pricing_tradeoff",
      copilotSummary: {
        intent: "pricing_tradeoff",
        status: "ready_for_review",
        requiresHumanApproval: true,
        persistence: "read_only",
      },
      routedResult: {
        tradeoffAdvice: {
          decision: "approve_review",
          riskLevel: "low",
        },
      },
      validation: { valid: true, errors: [] },
    });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "pricing_tradeoff",
          sourceId: "pricing_tradeoff:marginRateBps",
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("routes casting advice intent and preserves child facts", () => {
    const result = runM10CopilotAgent({
      intent: "casting_advice",
      payload: createCastingPayload(),
    });

    expect(result).toMatchObject({
      intent: "casting_advice",
      copilotSummary: {
        status: "ready_for_review",
        persistence: "read_only",
      },
      routedResult: {
        candidateAdvice: [
          {
            streamerId: "streamer-a",
            recommendation: "invite",
          },
        ],
      },
    });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "casting_advice",
          sourceId: "casting_advice:streamer-a:score",
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("routes project review intent and maps business output to agentOutput", () => {
    const result = runM10CopilotAgent({
      intent: "project_review",
      payload: createProjectReviewPayload(),
    });

    expect(result).toMatchObject({
      intent: "project_review",
      copilotSummary: {
        status: "ready_for_review",
        persistence: "read_only",
      },
      routedResult: {
        report: {
          projectId: "project-copilot",
          shouldContinue: true,
        },
      },
    });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTool: "project_review_summary",
          sourceId: "project-copilot:marginRateBps",
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("routes script optimization intent without persisting the draft", () => {
    const result = runM10CopilotAgent({
      intent: "script_optimization",
      payload: {
        scriptKey: "opening-hook",
        version: 1,
        currentScript: "Welcome to the stream.",
        diagnosisType: "traffic_drop",
        feedback: ["weak opening"],
        replayNotes: ["viewers left during intro"],
      },
    });

    expect(result).toMatchObject({
      intent: "script_optimization",
      copilotSummary: {
        status: "needs_review",
        persistence: "draft_not_persisted",
      },
      routedResult: {
        scriptVersionDraft: {
          scriptKey: "opening-hook",
          status: "draft",
        },
      },
      validation: { valid: true, errors: [] },
    });
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("rejects unsupported intents", () => {
    expect(() =>
      runM10CopilotAgent({
        intent: "unknown_intent",
        payload: {},
      } as unknown as M10CopilotInput),
    ).toThrow("Unsupported M10 Copilot intent");
  });
});

function createPricingPayload(): Extract<
  M10CopilotInput,
  { intent: "pricing_tradeoff" }
>["payload"] {
  return {
    vendorSettlementMethod: "cpt",
    streamerCount: 5,
    estimatedMinutesPerStreamer: 1200,
    vendorHourlyRateCents: 12000,
    streamerHourlyCostCents: 7000,
    supplierCostCents: 200000,
    platformFeeBps: 0,
    manualAdjustmentCents: 0,
    targetMarginBps: 2000,
  };
}

function createCastingPayload(): Extract<
  M10CopilotInput,
  { intent: "casting_advice" }
>["payload"] {
  return {
    project: {
      category: "moba",
      platform: "douyin",
      preferredStyles: ["high-energy"],
      requiredMinutes: 900,
    },
    maxRecommendations: 1,
    candidates: [
      {
        id: "streamer-a",
        name: "Ava",
        categories: ["moba"],
        platforms: ["douyin"],
        styles: ["high-energy"],
        completionRateBps: 9200,
        screeningPassRateBps: 8800,
        roiBps: 14000,
        grossMarginContributionCents: 180000,
        riskTags: [],
        availableMinutes: 1200,
        referenceProjects: [],
      },
    ],
  };
}

function createProjectReviewPayload(): Extract<
  M10CopilotInput,
  { intent: "project_review" }
>["payload"] {
  return {
    project: {
      id: "project-copilot",
      name: "Campaign Alpha",
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
    ],
    suppliers: [],
    evidenceSummary: {
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
