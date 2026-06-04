import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import {
  runPricingTradeoffAgent,
  type PricingTradeoffInput,
} from "./pricing-tradeoff-agent";
import type { AgentOutput } from "./contracts";

describe("runPricingTradeoffAgent", () => {
  it("approves a healthy quote review with fully sourced facts", () => {
    const result = runPricingTradeoffAgent(createInput());

    expect(result.pricing).toMatchObject({
      expectedReceivableCents: 1200000,
      grossMarginCents: 300000,
      marginRateBps: 2500,
      suggestedMinimumVendorHourlyRateCents: 11250,
      riskNotes: [],
    });
    expect(result.tradeoffAdvice).toMatchObject({
      decision: "approve_review",
      riskLevel: "low",
      recommendedSettlementMethod: "cpt",
      riskNotes: [],
      reviewChecklist: expect.arrayContaining([
        "confirm_inventory_scope",
        "confirm_finance_approval",
      ]),
    });
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Margin rate is 2500 bps",
          sourceTool: "pricing_tradeoff",
          sourceId: "pricing_tradeoff:marginRateBps",
        }),
        expect.objectContaining({
          statement: "Expected receivable is 1200000 cents",
          sourceTool: "pricing_tradeoff",
          sourceId: "pricing_tradeoff:expectedReceivableCents",
        }),
      ]),
    );
    expect(result.agentOutput.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Quote economics are ready for approval review",
          evidence: [
            {
              sourceTool: "pricing_tradeoff",
              sourceId: "pricing_tradeoff:marginRateBps",
            },
            {
              sourceTool: "pricing_tradeoff",
              sourceId: "pricing_tradeoff:riskNoteCount",
            },
          ],
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("asks for quote review when margin is below target", () => {
    const result = runPricingTradeoffAgent(
      createInput({
        vendorHourlyRateCents: 10000,
      }),
    );

    expect(result.pricing).toMatchObject({
      marginRateBps: 1000,
      riskNotes: expect.arrayContaining(["low_margin"]),
    });
    expect(result.tradeoffAdvice).toMatchObject({
      decision: "raise_quote_review",
      riskLevel: "medium",
    });
    expect(result.agentOutput.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Review quote level before customer commitment",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });

  it("pauses commitment when gross margin is negative", () => {
    const result = runPricingTradeoffAgent(
      createInput({
        vendorHourlyRateCents: 8000,
      }),
    );

    expect(result.pricing).toMatchObject({
      grossMarginCents: -100000,
      riskNotes: expect.arrayContaining(["negative_margin"]),
    });
    expect(result.tradeoffAdvice).toMatchObject({
      decision: "pause_commitment",
      riskLevel: "high",
    });
    expect(result.agentOutput.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal: "Pause commitment until quote economics are reviewed",
          requiresHumanApproval: true,
        }),
      ]),
    );
    expect(JSON.stringify(result.agentOutput.recommendations)).not.toContain(
      "execute",
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });
});

function createInput(
  overrides: Partial<PricingTradeoffInput> = {},
): PricingTradeoffInput {
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
    ...overrides,
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
