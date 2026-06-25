import { describe, expect, it } from "vitest";

import { evaluateAutoReviewRolloutGate } from "./auto-review-rollout-gates";
import { buildAutoReviewRolloutMetrics } from "./auto-review-rollout-metrics";

describe("buildAutoReviewRolloutMetrics", () => {
  it("builds gate input from shadow false accepts and audit errors", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: passingConfig(),
      shadowOutcomes: [
        {
          reportId: "report-1",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "approve",
        },
        {
          reportId: "report-2",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "reject",
        },
        {
          reportId: "report-3",
          shadowDecision: "manual_review",
          finalHumanDecision: "needs_changes",
        },
      ],
      auditSamples: [
        {
          sampleId: "audit-1",
          expectedDecision: "approve",
          actualDecision: "approve",
        },
        {
          sampleId: "audit-2",
          expectedDecision: "approve",
          actualDecision: "reject",
        },
      ],
    });

    expect(snapshot.gateInput).toMatchObject({
      shadowSampleCount: 3,
      shadowFalseAcceptRateBps: 5000,
      auditSampleCount: 2,
      auditErrorRateBps: 5000,
    });
    expect(snapshot.summary).toMatchObject({
      shadowAutoPassCount: 2,
      shadowFalseAcceptCount: 1,
      auditComparedCount: 2,
      auditErrorCount: 1,
    });
  });

  it("ignores unknown human outcomes in the false accept denominator", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: passingConfig(),
      shadowOutcomes: [
        {
          reportId: "report-1",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "unknown",
        },
        {
          reportId: "report-2",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "approve",
        },
      ],
      auditSamples: [],
    });

    expect(snapshot.gateInput.shadowFalseAcceptRateBps).toBe(0);
    expect(snapshot.summary.shadowAutoPassReviewedCount).toBe(1);
  });

  it("preserves insufficient sample counts for the rollout gate", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: {
        ...passingConfig(),
        minimumShadowSampleCount: 10,
        minimumAuditSampleCount: 10,
      },
      shadowOutcomes: [],
      auditSamples: [],
    });

    expect(snapshot.gateInput.shadowSampleCount).toBe(0);
    expect(snapshot.gateInput.auditSampleCount).toBe(0);
  });

  it("feeds the rollout gate with measured metrics", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: passingConfig(),
      shadowOutcomes: [
        {
          reportId: "report-1",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "approve",
        },
      ],
      auditSamples: [
        {
          sampleId: "audit-1",
          expectedDecision: "approve",
          actualDecision: "approve",
        },
      ],
    });

    expect(evaluateAutoReviewRolloutGate(snapshot.gateInput)).toMatchObject({
      allowed: true,
      effectiveMode: "active",
    });
  });
});

function passingConfig() {
  return {
    targetMode: "active" as const,
    killSwitchEnabled: false,
    minimumShadowSampleCount: 1,
    maximumFalseAcceptRateBps: 100,
    minimumAuditSampleCount: 1,
    maximumAuditErrorRateBps: 100,
    explicitActiveRequest: true,
  };
}
