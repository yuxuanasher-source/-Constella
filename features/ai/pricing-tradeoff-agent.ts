import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";
import {
  calculateProjectPricing,
  type PricingSettlementMethod,
  type ProjectPricingInput,
  type ProjectPricingResult,
} from "@/features/war-room/pricing-calculator";

export type PricingTradeoffInput = ProjectPricingInput;

export type PricingTradeoffAdvice = {
  decision: "approve_review" | "raise_quote_review" | "pause_commitment";
  riskLevel: "low" | "medium" | "high";
  recommendedSettlementMethod: PricingSettlementMethod;
  riskNotes: string[];
  reviewChecklist: string[];
};

export type PricingTradeoffAgentResult = {
  pricing: ProjectPricingResult;
  tradeoffAdvice: PricingTradeoffAdvice;
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

const sourceTool = "pricing_tradeoff";

export function runPricingTradeoffAgent(
  input: PricingTradeoffInput,
): PricingTradeoffAgentResult {
  const pricing = calculateProjectPricing(input);
  const tradeoffAdvice = buildTradeoffAdvice(pricing);
  const agentOutput = buildAgentOutput(pricing, tradeoffAdvice);
  const validation = validateAgentOutput(agentOutput);

  return {
    pricing,
    tradeoffAdvice,
    agentOutput,
    validation,
  };
}

function buildTradeoffAdvice(
  pricing: ProjectPricingResult,
): PricingTradeoffAdvice {
  const decision = classifyDecision(pricing.riskNotes);

  return {
    decision,
    riskLevel: classifyRiskLevel(pricing.riskNotes),
    recommendedSettlementMethod: pricing.recommendedSettlementMethod,
    riskNotes: pricing.riskNotes,
    reviewChecklist: checklistForDecision(decision),
  };
}

function classifyDecision(
  riskNotes: string[],
): PricingTradeoffAdvice["decision"] {
  if (riskNotes.includes("negative_margin")) {
    return "pause_commitment";
  }

  if (
    riskNotes.some((riskNote) =>
      [
        "low_margin",
        "invalid_margin_target",
        "high_platform_fee",
        "zero_receivable",
      ].includes(riskNote),
    )
  ) {
    return "raise_quote_review";
  }

  return "approve_review";
}

function classifyRiskLevel(
  riskNotes: string[],
): PricingTradeoffAdvice["riskLevel"] {
  if (
    riskNotes.some((riskNote) =>
      ["negative_margin", "invalid_margin_target", "zero_receivable"].includes(
        riskNote,
      ),
    )
  ) {
    return "high";
  }

  if (
    riskNotes.some((riskNote) =>
      ["low_margin", "high_platform_fee"].includes(riskNote),
    )
  ) {
    return "medium";
  }

  return "low";
}

function checklistForDecision(
  decision: PricingTradeoffAdvice["decision"],
): string[] {
  if (decision === "pause_commitment") {
    return [
      "review_cost_assumptions",
      "review_quote_floor",
      "confirm_finance_approval",
      "pause_customer_commitment",
    ];
  }

  if (decision === "raise_quote_review") {
    return [
      "review_minimum_quote",
      "confirm_cost_scope",
      "confirm_finance_approval",
    ];
  }

  return [
    "confirm_inventory_scope",
    "confirm_finance_approval",
    "confirm_customer_scope",
  ];
}

function buildAgentOutput(
  pricing: ProjectPricingResult,
  tradeoffAdvice: PricingTradeoffAdvice,
): AgentOutput {
  return {
    facts: collectFacts(pricing),
    findings: buildFindings(pricing, tradeoffAdvice),
    caveats: [
      {
        summary: "Customer demand movement was not independently verified",
        unverifiedExternalFactor: true,
      },
      {
        summary: "Finance approval status was not independently verified",
        unverifiedExternalFactor: true,
      },
    ],
    recommendations: buildRecommendations(tradeoffAdvice),
  };
}

function collectFacts(pricing: ProjectPricingResult): AgentOutput["facts"] {
  return [
    {
      statement: `Estimated duration is ${pricing.estimatedDurationMinutes} minutes`,
      ...source("estimatedDurationMinutes"),
    },
    {
      statement: `Expected receivable is ${pricing.expectedReceivableCents} cents`,
      ...source("expectedReceivableCents"),
    },
    {
      statement: `Streamer payable is ${pricing.streamerPayableCents} cents`,
      ...source("streamerPayableCents"),
    },
    {
      statement: `Supplier cost is ${pricing.supplierCostCents} cents`,
      ...source("supplierCostCents"),
    },
    {
      statement: `Platform fee is ${pricing.platformFeeCents} cents`,
      ...source("platformFeeCents"),
    },
    {
      statement: `Gross margin is ${pricing.grossMarginCents} cents`,
      ...source("grossMarginCents"),
    },
    {
      statement: `Margin rate is ${pricing.marginRateBps} bps`,
      ...source("marginRateBps"),
    },
    {
      statement:
        pricing.suggestedMinimumQuoteCents === null
          ? "Suggested minimum quote is unavailable"
          : `Suggested minimum quote is ${pricing.suggestedMinimumQuoteCents} cents`,
      ...source("suggestedMinimumQuoteCents"),
    },
    {
      statement:
        pricing.suggestedMinimumVendorHourlyRateCents === null
          ? "Suggested minimum hourly rate is unavailable"
          : `Suggested minimum hourly rate is ${pricing.suggestedMinimumVendorHourlyRateCents} cents`,
      ...source("suggestedMinimumVendorHourlyRateCents"),
    },
    {
      statement: `Risk note count is ${pricing.riskNotes.length}`,
      ...source("riskNoteCount"),
    },
  ];
}

function buildFindings(
  pricing: ProjectPricingResult,
  tradeoffAdvice: PricingTradeoffAdvice,
): AgentOutput["findings"] {
  if (tradeoffAdvice.decision === "pause_commitment") {
    return [
      {
        summary: "Quote economics should pause before customer commitment",
        evidence: [source("grossMarginCents"), source("riskNoteCount")],
      },
    ];
  }

  if (tradeoffAdvice.decision === "raise_quote_review") {
    return [
      {
        summary: "Quote economics need pricing review before commitment",
        evidence: [
          source("marginRateBps"),
          source("suggestedMinimumQuoteCents"),
        ],
      },
    ];
  }

  return [
    {
      summary: "Quote economics are ready for approval review",
      evidence: [source("marginRateBps"), source("riskNoteCount")],
    },
    ...(pricing.expectedReceivableCents > 0
      ? [
          {
            summary: "Receivable assumptions support the current quote review",
            evidence: [
              source("expectedReceivableCents"),
              source("grossMarginCents"),
            ],
          },
        ]
      : []),
  ];
}

function buildRecommendations(
  tradeoffAdvice: PricingTradeoffAdvice,
): AgentOutput["recommendations"] {
  if (tradeoffAdvice.decision === "pause_commitment") {
    return [
      {
        proposal: "Pause commitment until quote economics are reviewed",
        expectedImpact: "Reduce margin risk before customer confirmation",
        requiresHumanApproval: true,
      },
    ];
  }

  if (tradeoffAdvice.decision === "raise_quote_review") {
    return [
      {
        proposal: "Review quote level before customer commitment",
        expectedImpact: "Protect margin before committing delivery capacity",
        requiresHumanApproval: true,
      },
    ];
  }

  return [
    {
      proposal: "Approve quote for human review",
      expectedImpact: "Keep pricing review controlled before commitment",
      requiresHumanApproval: true,
    },
  ];
}

function source(field: string): { sourceTool: string; sourceId: string } {
  return {
    sourceTool,
    sourceId: `${sourceTool}:${field}`,
  };
}
