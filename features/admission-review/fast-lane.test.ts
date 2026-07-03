import { describe, expect, it } from "vitest";

import { defaultAdmissionRubric } from "./contracts";
import { evaluateFastLaneEligibility } from "./fast-lane";
import { METRIC_AI_FALSE_PASS } from "./metrics";
import type { AdmissionPreReviewView } from "./pre-review";

const rubric = defaultAdmissionRubric();

function preReview(
  overrides: Partial<AdmissionPreReviewView> = {},
): AdmissionPreReviewView {
  return {
    evaluationId: "evaluation-1",
    decision: "approved",
    confidence: "high",
    noteDraft: "整体达标",
    createdAt: "2026-07-03T12:00:00.000Z",
    checkpoints: [
      { key: "compliance_violation", verdict: "pass", confidence: 0.95, evidence: {} },
      { key: "media_unusable", verdict: "pass", confidence: 0.9, evidence: {} },
      { key: "identity_mismatch", verdict: "pass", confidence: 0.9, evidence: {} },
      { key: "script_fit", verdict: "pass", confidence: 0.8, evidence: {} },
    ],
    ...overrides,
  };
}

function qualifyingMetrics() {
  return ["compliance_violation", "media_unusable", "identity_mismatch"].map(
    (key) => ({
      metricKey: METRIC_AI_FALSE_PASS,
      checkpointKey: key,
      numerator: 3,
      denominator: 150,
    }),
  );
}

describe("evaluateFastLaneEligibility", () => {
  it("marks eligible when confidence is high and hard blocks are calibrated", () => {
    const assessment = evaluateFastLaneEligibility({
      preReview: preReview(),
      rubric,
      metrics: qualifyingMetrics(),
    });

    expect(assessment).toEqual({ eligible: true, reasons: [] });
  });

  it("rejects when the pre-review is not a high-confidence approve", () => {
    const assessment = evaluateFastLaneEligibility({
      preReview: preReview({ decision: "needs_changes", confidence: "medium" }),
      rubric,
      metrics: qualifyingMetrics(),
    });

    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toContain("pre_review_not_approved");
    expect(assessment.reasons).toContain("pre_review_confidence_not_high");
  });

  it("rejects when a hard block lacks calibration samples", () => {
    const metrics = qualifyingMetrics().filter(
      (row) => row.checkpointKey !== "identity_mismatch",
    );

    const assessment = evaluateFastLaneEligibility({
      preReview: preReview(),
      rubric,
      metrics,
    });

    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toContain(
      "insufficient_calibration_sample:identity_mismatch",
    );
  });

  it("rejects when a hard block false-pass rate is over threshold", () => {
    const metrics = qualifyingMetrics().map((row) =>
      row.checkpointKey === "compliance_violation"
        ? { ...row, numerator: 12 }
        : row,
    );

    const assessment = evaluateFastLaneEligibility({
      preReview: preReview(),
      rubric,
      metrics,
    });

    expect(assessment.eligible).toBe(false);
    expect(assessment.reasons).toContain(
      "false_pass_over_threshold:compliance_violation",
    );
  });

  it("rejects when a hard block was not predicted pass", () => {
    const assessment = evaluateFastLaneEligibility({
      preReview: preReview({
        checkpoints: [
          {
            key: "compliance_violation",
            verdict: "not_applicable",
            confidence: 0.4,
            evidence: {},
          },
        ],
      }),
      rubric,
      metrics: qualifyingMetrics(),
    });

    expect(assessment.eligible).toBe(false);
    expect(
      assessment.reasons.filter((reason) =>
        reason.startsWith("hard_block_not_pass:"),
      ).length,
    ).toBeGreaterThan(0);
  });
});
