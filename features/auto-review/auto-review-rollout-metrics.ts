import type {
  AutoReviewRolloutGateInput,
  AutoReviewRolloutMode,
} from "./auto-review-rollout-gates";

export type AutoReviewRolloutMetricsConfig = Omit<
  AutoReviewRolloutGateInput,
  | "shadowSampleCount"
  | "shadowFalseAcceptRateBps"
  | "auditSampleCount"
  | "auditErrorRateBps"
>;

export type ShadowHumanDecision =
  | "approve"
  | "reject"
  | "needs_changes"
  | "unknown";

export type ShadowReviewOutcome = {
  reportId: string;
  shadowDecision: "auto_pass_candidate" | "manual_review" | "disabled";
  finalHumanDecision: ShadowHumanDecision;
};

export type AuditReviewSample = {
  sampleId: string;
  expectedDecision: ShadowHumanDecision;
  actualDecision: ShadowHumanDecision;
};

export type AutoReviewRolloutMetricsSummary = {
  targetMode: AutoReviewRolloutMode;
  shadowSampleCount: number;
  shadowAutoPassCount: number;
  shadowAutoPassReviewedCount: number;
  shadowFalseAcceptCount: number;
  auditSampleCount: number;
  auditComparedCount: number;
  auditErrorCount: number;
};

export type AutoReviewRolloutMetricsSnapshot = {
  gateInput: AutoReviewRolloutGateInput;
  summary: AutoReviewRolloutMetricsSummary;
};

export function buildAutoReviewRolloutMetrics(input: {
  config: AutoReviewRolloutMetricsConfig;
  shadowOutcomes: ShadowReviewOutcome[];
  auditSamples: AuditReviewSample[];
}): AutoReviewRolloutMetricsSnapshot {
  const shadowSampleCount = input.shadowOutcomes.length;
  const shadowAutoPassOutcomes = input.shadowOutcomes.filter(
    (outcome) => outcome.shadowDecision === "auto_pass_candidate",
  );
  const shadowAutoPassReviewed = shadowAutoPassOutcomes.filter(
    (outcome) => outcome.finalHumanDecision !== "unknown",
  );
  const shadowFalseAcceptCount = shadowAutoPassReviewed.filter(
    (outcome) => outcome.finalHumanDecision !== "approve",
  ).length;

  const comparedAuditSamples = input.auditSamples.filter(
    (sample) =>
      sample.expectedDecision !== "unknown" && sample.actualDecision !== "unknown",
  );
  const auditErrorCount = comparedAuditSamples.filter(
    (sample) => sample.expectedDecision !== sample.actualDecision,
  ).length;

  return {
    gateInput: {
      ...input.config,
      shadowSampleCount,
      shadowFalseAcceptRateBps: rateBps(
        shadowFalseAcceptCount,
        shadowAutoPassReviewed.length,
      ),
      auditSampleCount: comparedAuditSamples.length,
      auditErrorRateBps: rateBps(auditErrorCount, comparedAuditSamples.length),
    },
    summary: {
      targetMode: input.config.targetMode,
      shadowSampleCount,
      shadowAutoPassCount: shadowAutoPassOutcomes.length,
      shadowAutoPassReviewedCount: shadowAutoPassReviewed.length,
      shadowFalseAcceptCount,
      auditSampleCount: input.auditSamples.length,
      auditComparedCount: comparedAuditSamples.length,
      auditErrorCount,
    },
  };
}

function rateBps(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 10000);
}
