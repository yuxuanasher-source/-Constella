import type { AgentOutput } from "./contracts";

export type AgentOutputValidation = {
  valid: boolean;
  errors: string[];
};

export function validateAgentOutput(
  output: AgentOutput,
): AgentOutputValidation {
  const errors: string[] = [];
  const factSources = new Set(
    output.facts.map((fact) => sourceKey(fact.sourceTool, fact.sourceId)),
  );

  output.facts.forEach((fact, index) => {
    if (!fact.statement.trim()) {
      errors.push(`facts[${index}] must include a statement`);
    }
    if (!fact.sourceTool.trim() || !fact.sourceId.trim()) {
      errors.push(`facts[${index}] must include sourceTool and sourceId`);
    }
  });

  output.findings.forEach((finding, index) => {
    if (containsNumericClaim(finding.summary)) {
      errors.push(
        `findings[${index}] must not include unsourced numeric claims`,
      );
    }

    if (!finding.evidence.length) {
      errors.push(
        `findings[${index}] must include at least one evidence reference`,
      );
      return;
    }

    for (const evidence of finding.evidence) {
      if (!evidence.sourceTool.trim() || !evidence.sourceId.trim()) {
        errors.push(
          `findings[${index}] evidence must include sourceTool and sourceId`,
        );
      } else if (
        !factSources.has(sourceKey(evidence.sourceTool, evidence.sourceId))
      ) {
        errors.push(
          `findings[${index}] evidence must reference an existing fact`,
        );
      }
    }
  });

  output.caveats.forEach((caveat, index) => {
    if (containsNumericClaim(caveat.summary)) {
      errors.push(
        `caveats[${index}] must not include unsourced numeric claims`,
      );
    }

    if (caveat.unverifiedExternalFactor !== true) {
      errors.push(`caveats[${index}] must mark unverified external factors`);
    }
  });

  output.recommendations.forEach((recommendation, index) => {
    if (
      containsNumericClaim(recommendation.proposal) ||
      containsNumericClaim(recommendation.expectedImpact)
    ) {
      errors.push(
        `recommendations[${index}] must not include unsourced numeric claims`,
      );
    }

    if (recommendation.requiresHumanApproval !== true) {
      errors.push(`recommendations[${index}] must require human approval`);
    }

    const rawRecommendation = recommendation as unknown as Record<
      string,
      unknown
    >;
    if ("action" in rawRecommendation || "execute" in rawRecommendation) {
      errors.push(
        `recommendations[${index}] must not contain executable actions`,
      );
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

function sourceKey(sourceTool: string, sourceId: string): string {
  return `${sourceTool}:${sourceId}`;
}

function containsNumericClaim(value: string | undefined): boolean {
  return /\d/.test(value ?? "");
}
