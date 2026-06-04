import type { AgentOutputValidation } from "./agent-output-contract";
import {
  runBusinessAnalysisAgent,
  type BusinessAnalysisAgentResult,
} from "./business-analysis-agent";
import {
  runCastingAdviceAgent,
  type CastingAdviceAgentResult,
  type CastingAdviceInput,
} from "./casting-advice-agent";
import type { AgentOutput } from "./contracts";
import {
  runPricingTradeoffAgent,
  type PricingTradeoffAgentResult,
  type PricingTradeoffInput,
} from "./pricing-tradeoff-agent";
import {
  runScriptOptimizationAgent,
  type ScriptOptimizationAgentResult,
  type ScriptOptimizationInput,
} from "./script-optimization-agent";
import type { ProjectReviewInput } from "@/features/war-room/project-review-report";

export type M10CopilotIntent =
  | "pricing_tradeoff"
  | "casting_advice"
  | "project_review"
  | "script_optimization";

export type M10CopilotInput =
  | { intent: "pricing_tradeoff"; payload: PricingTradeoffInput }
  | { intent: "casting_advice"; payload: CastingAdviceInput }
  | { intent: "project_review"; payload: ProjectReviewInput }
  | { intent: "script_optimization"; payload: ScriptOptimizationInput };

export type M10CopilotSummary = {
  intent: M10CopilotIntent;
  title: string;
  status: "ready_for_review" | "needs_review" | "blocked";
  nextStep: string;
  requiresHumanApproval: true;
  persistence: "read_only" | "draft_not_persisted";
};

export type M10CopilotRoutedResult =
  | PricingTradeoffAgentResult
  | CastingAdviceAgentResult
  | BusinessAnalysisAgentResult
  | ScriptOptimizationAgentResult;

export type M10CopilotAgentResult = {
  intent: M10CopilotIntent;
  copilotSummary: M10CopilotSummary;
  routedResult: M10CopilotRoutedResult;
  agentOutput: AgentOutput;
  validation: AgentOutputValidation;
};

export function runM10CopilotAgent(
  input: M10CopilotInput,
): M10CopilotAgentResult {
  const rawInput = input as { intent: string; payload: unknown };

  if (rawInput.intent === "pricing_tradeoff") {
    const routedResult = runPricingTradeoffAgent(
      rawInput.payload as PricingTradeoffInput,
    );

    return {
      intent: "pricing_tradeoff",
      copilotSummary: pricingSummary(routedResult),
      routedResult,
      agentOutput: routedResult.agentOutput,
      validation: routedResult.validation,
    };
  }

  if (rawInput.intent === "casting_advice") {
    const routedResult = runCastingAdviceAgent(rawInput.payload as CastingAdviceInput);

    return {
      intent: "casting_advice",
      copilotSummary: castingSummary(routedResult),
      routedResult,
      agentOutput: routedResult.agentOutput,
      validation: routedResult.validation,
    };
  }

  if (rawInput.intent === "project_review") {
    const routedResult = runBusinessAnalysisAgent(
      rawInput.payload as ProjectReviewInput,
    );

    return {
      intent: "project_review",
      copilotSummary: projectReviewSummary(routedResult),
      routedResult,
      agentOutput: routedResult.output,
      validation: routedResult.validation,
    };
  }

  if (rawInput.intent === "script_optimization") {
    const routedResult = runScriptOptimizationAgent(
      rawInput.payload as ScriptOptimizationInput,
    );

    return {
      intent: "script_optimization",
      copilotSummary: scriptSummary(),
      routedResult,
      agentOutput: routedResult.agentOutput,
      validation: routedResult.validation,
    };
  }

  throw new Error("Unsupported M10 Copilot intent");
}

function pricingSummary(
  routedResult: PricingTradeoffAgentResult,
): M10CopilotSummary {
  const decision = routedResult.tradeoffAdvice.decision;

  if (decision === "pause_commitment") {
    return summary({
      intent: "pricing_tradeoff",
      title: "Pricing tradeoff brief",
      status: "blocked",
      nextStep: "Review quote economics before customer commitment",
    });
  }

  if (decision === "raise_quote_review") {
    return summary({
      intent: "pricing_tradeoff",
      title: "Pricing tradeoff brief",
      status: "needs_review",
      nextStep: "Review quote level with finance",
    });
  }

  return summary({
    intent: "pricing_tradeoff",
    title: "Pricing tradeoff brief",
    status: "ready_for_review",
    nextStep: "Send quote for human approval review",
  });
}

function castingSummary(
  routedResult: CastingAdviceAgentResult,
): M10CopilotSummary {
  const topAdvice = routedResult.candidateAdvice[0];

  if (!topAdvice) {
    return summary({
      intent: "casting_advice",
      title: "Casting advice brief",
      status: "blocked",
      nextStep: "Collect candidate snapshots before review",
    });
  }

  if (topAdvice.recommendation === "manual_review") {
    return summary({
      intent: "casting_advice",
      title: "Casting advice brief",
      status: "needs_review",
      nextStep: "Review candidate risk before outreach",
    });
  }

  return summary({
    intent: "casting_advice",
    title: "Casting advice brief",
    status: "ready_for_review",
    nextStep: "Send candidate shortlist for human approval review",
  });
}

function projectReviewSummary(
  routedResult: BusinessAnalysisAgentResult,
): M10CopilotSummary {
  if (routedResult.report.shouldContinue) {
    return summary({
      intent: "project_review",
      title: "Project review brief",
      status: "ready_for_review",
      nextStep: "Send continuation plan for human approval review",
    });
  }

  return summary({
    intent: "project_review",
    title: "Project review brief",
    status: "needs_review",
    nextStep: "Review project risks before continuation",
  });
}

function scriptSummary(): M10CopilotSummary {
  return summary({
    intent: "script_optimization",
    title: "Script optimization brief",
    status: "needs_review",
    nextStep: "Review draft before saving or publishing elsewhere",
    persistence: "draft_not_persisted",
  });
}

function summary(input: {
  intent: M10CopilotIntent;
  title: string;
  status: M10CopilotSummary["status"];
  nextStep: string;
  persistence?: M10CopilotSummary["persistence"];
}): M10CopilotSummary {
  return {
    intent: input.intent,
    title: input.title,
    status: input.status,
    nextStep: input.nextStep,
    requiresHumanApproval: true,
    persistence: input.persistence ?? "read_only",
  };
}
