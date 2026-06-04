import { validateAgentOutput } from "./agent-output-contract";
import type { AgentOutput } from "./contracts";
import {
  buildProjectReviewReport,
  type ProjectReviewInput,
  type ProjectReviewReport,
} from "@/features/war-room/project-review-report";

export type BusinessAnalysisAgentResult = {
  report: ProjectReviewReport;
  output: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};

const sourceTool = "project_review_summary";

export function runBusinessAnalysisAgent(
  input: ProjectReviewInput,
): BusinessAnalysisAgentResult {
  const report = buildProjectReviewReport(input);
  const output = buildAgentOutput(report);
  const validation = validateAgentOutput(output);

  return { report, output, validation };
}

function buildAgentOutput(report: ProjectReviewReport): AgentOutput {
  const facts: AgentOutput["facts"] = [
    fact(report, "marginRateBps", `Margin rate is ${report.marginRateBps} bps`),
    fact(
      report,
      "grossMarginCents",
      `Gross margin is ${report.grossMarginCents} cents`,
    ),
    fact(report, "shouldContinue", `Should continue is ${report.shouldContinue}`),
    fact(report, "anomalyCount", `Anomaly count is ${report.anomalyCount}`),
    fact(report, "disputeCount", `Dispute count is ${report.disputeCount}`),
    fact(
      report,
      "nextSuggestedQuoteCents",
      `Next suggested quote is ${report.nextSuggestedQuoteCents} cents`,
    ),
  ];

  const findings: AgentOutput["findings"] = [
    report.shouldContinue
      ? {
          summary: "Project economics support continuing the next round",
          evidence: [
            source(report, "marginRateBps"),
            source(report, "shouldContinue"),
          ],
        }
      : {
          summary: "Project economics require quote review before continuation",
          evidence: [
            source(report, "marginRateBps"),
            source(report, "grossMarginCents"),
            source(report, "shouldContinue"),
          ],
        },
  ];

  if (report.anomalyCount > 0 || report.disputeCount > 0) {
    findings.push({
      summary: "Delivery risk needs manual review before scaling",
      evidence: [source(report, "anomalyCount"), source(report, "disputeCount")],
    });
  }

  const caveats: AgentOutput["caveats"] = [
    {
      summary: "Market demand and competitor timing were not verified",
      unverifiedExternalFactor: true,
    },
  ];

  if (report.evidenceSummary.unknown > 0) {
    caveats.push({
      summary: "Some operational evidence remains unconfirmed",
      unverifiedExternalFactor: true,
    });
  }

  return {
    facts,
    findings,
    caveats,
    recommendations: buildRecommendations(report),
  };
}

function buildRecommendations(
  report: ProjectReviewReport,
): AgentOutput["recommendations"] {
  const recommendations: AgentOutput["recommendations"] = [];

  recommendations.push(
    report.shouldContinue
      ? {
          proposal: "Continue the project with the current operating guardrails",
          expectedImpact: "Protect margin while preserving delivery continuity",
          requiresHumanApproval: true,
        }
      : {
          proposal: "Review pricing before opening the next round",
          expectedImpact: "Reduce margin risk before committing more inventory",
          requiresHumanApproval: true,
        },
  );

  if (
    report.nextRoundRecommendations.includes("replace_high_risk_streamers") ||
    report.anomalyCount > 0 ||
    report.disputeCount > 0
  ) {
    recommendations.push({
      proposal: "Review high risk streamer allocation before execution",
      expectedImpact: "Lower delivery uncertainty before scaling",
      requiresHumanApproval: true,
    });
  }

  return recommendations;
}

function fact(
  report: ProjectReviewReport,
  field: keyof ProjectReviewReport,
  statement: string,
): AgentOutput["facts"][number] {
  return {
    statement,
    ...source(report, field),
  };
}

function source(
  report: ProjectReviewReport,
  field: keyof ProjectReviewReport,
): { sourceTool: string; sourceId: string } {
  return {
    sourceTool,
    sourceId: `${report.projectId}:${String(field)}`,
  };
}
