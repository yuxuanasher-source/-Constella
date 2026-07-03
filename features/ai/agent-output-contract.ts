import type { AgentOutput } from "./contracts";

export type AgentOutputValidation = {
  valid: boolean;
  errors: string[];
};

// 数字护栏语义化(方案 WP4):叙事(findings/caveats/recommendations)中
// 出现的数字必须能在事实语句中找到同一数字 token——finding 只能复述它
// 引用的事实里的数字,caveat/recommendation 可复述任何事实里的数字。
// 这替代了旧的 /\d/ 全禁:既允许「转化率 4167 bps 偏低」这类有溯源的
// 复述,也继续拦截无中生有的数值声明。中文数字无法可靠判定,不做硬拦,
// 由 prompt 规则约束。
export function validateAgentOutput(
  output: AgentOutput,
): AgentOutputValidation {
  const errors: string[] = [];
  const factsBySource = new Map(
    output.facts.map((fact) => [
      sourceKey(fact.sourceTool, fact.sourceId),
      fact,
    ]),
  );
  const allFactNumbers = collectNumberTokens(
    output.facts.map((fact) => fact.statement),
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
    if (!finding.evidence.length) {
      errors.push(
        `findings[${index}] must include at least one evidence reference`,
      );
      return;
    }

    const citedStatements: string[] = [];
    for (const evidence of finding.evidence) {
      if (!evidence.sourceTool.trim() || !evidence.sourceId.trim()) {
        errors.push(
          `findings[${index}] evidence must include sourceTool and sourceId`,
        );
        continue;
      }
      const fact = factsBySource.get(
        sourceKey(evidence.sourceTool, evidence.sourceId),
      );
      if (!fact) {
        errors.push(
          `findings[${index}] evidence must reference an existing fact`,
        );
        continue;
      }
      citedStatements.push(fact.statement);
    }

    if (
      hasUnsourcedNumber(finding.summary, collectNumberTokens(citedStatements))
    ) {
      errors.push(
        `findings[${index}] must not include unsourced numeric claims`,
      );
    }
  });

  output.caveats.forEach((caveat, index) => {
    if (hasUnsourcedNumber(caveat.summary, allFactNumbers)) {
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
      hasUnsourcedNumber(recommendation.proposal, allFactNumbers) ||
      hasUnsourcedNumber(recommendation.expectedImpact, allFactNumbers)
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

const NUMBER_TOKEN_PATTERN = /\d+(?:\.\d+)?/g;

export function collectNumberTokens(statements: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const statement of statements) {
    for (const match of statement.matchAll(NUMBER_TOKEN_PATTERN)) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}

export function hasUnsourcedNumber(
  value: string | undefined,
  allowedNumbers: Set<string>,
): boolean {
  if (!value) {
    return false;
  }
  for (const match of value.matchAll(NUMBER_TOKEN_PATTERN)) {
    if (!allowedNumbers.has(match[0])) {
      return true;
    }
  }
  return false;
}
