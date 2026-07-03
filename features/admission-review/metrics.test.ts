import { describe, expect, it } from "vitest";

import {
  buildAdmissionCalibrationDraft,
  buildCalibrationProposals,
  computeAdmissionReviewMetrics,
  METRIC_AI_FALSE_PASS,
  METRIC_AI_MCN_AGREEMENT,
  METRIC_MCN_MISS,
  METRIC_VENDOR_REJECT_REASON,
} from "./metrics";

function aiVsMcnSignal(payload: Record<string, unknown>) {
  return {
    signal_kind: "ai_vs_mcn",
    payload: {
      aiEvaluationId: "evaluation-ai",
      mcnEvaluationId: "evaluation-mcn",
      aiDecision: "approved",
      aiConfidence: "high",
      mcnDecision: "approved",
      overallAgreement: true,
      checkpointDeltas: [],
      ...payload,
    },
  };
}

function mcnVsVendorSignal(payload: Record<string, unknown>) {
  return {
    signal_kind: "mcn_vs_vendor",
    payload: {
      mcnEvaluationId: "evaluation-mcn",
      vendorEvaluationId: "evaluation-vendor",
      mcnDecision: "approved",
      vendorDecision: "selected",
      vendorReasonCodes: [],
      mcnMiss: false,
      ...payload,
    },
  };
}

describe("computeAdmissionReviewMetrics", () => {
  it("aggregates agreement, false pass/block and mcn miss metrics", () => {
    const rows = computeAdmissionReviewMetrics([
      aiVsMcnSignal({
        overallAgreement: true,
        checkpointDeltas: [
          { key: "script_fit", ai: "fail", mcn: "fail", match: true },
          { key: "media_quality", ai: "pass", mcn: "fail", match: false },
        ],
      }),
      aiVsMcnSignal({
        overallAgreement: false,
        checkpointDeltas: [
          { key: "script_fit", ai: "fail", mcn: "pass", match: false },
          { key: "media_quality", ai: null, mcn: "fail", match: false },
        ],
      }),
      mcnVsVendorSignal({
        vendorDecision: "rejected",
        vendorReasonCodes: ["script_fit"],
        mcnMiss: true,
      }),
      mcnVsVendorSignal({}),
      // 一审驳回后的二审信号不计入漏判分母。
      mcnVsVendorSignal({ mcnDecision: "rejected", mcnMiss: false }),
    ]);

    expect(rows).toContainEqual({
      metricKey: METRIC_AI_MCN_AGREEMENT,
      checkpointKey: "",
      numerator: 1,
      denominator: 2,
    });
    expect(rows).toContainEqual({
      metricKey: METRIC_AI_MCN_AGREEMENT,
      checkpointKey: "script_fit",
      numerator: 1,
      denominator: 2,
    });
    expect(rows).toContainEqual({
      metricKey: METRIC_AI_FALSE_PASS,
      checkpointKey: "media_quality",
      numerator: 1,
      denominator: 1,
    });
    expect(rows).toContainEqual({
      metricKey: METRIC_MCN_MISS,
      checkpointKey: "",
      numerator: 1,
      denominator: 2,
    });
    expect(rows).toContainEqual({
      metricKey: METRIC_VENDOR_REJECT_REASON,
      checkpointKey: "script_fit",
      numerator: 1,
      denominator: 1,
    });
  });

  it("returns no rows when there are no signals", () => {
    expect(computeAdmissionReviewMetrics([])).toEqual([]);
  });
});

describe("buildCalibrationProposals", () => {
  it("proposes only for checkpoints over threshold with enough samples", () => {
    const proposals = buildCalibrationProposals([
      {
        metricKey: METRIC_AI_FALSE_PASS,
        checkpointKey: "compliance_violation",
        numerator: 4,
        denominator: 40,
      },
      // 样本不足：不出提案。
      {
        metricKey: METRIC_AI_FALSE_PASS,
        checkpointKey: "script_fit",
        numerator: 5,
        denominator: 10,
      },
      // 低于阈值：不出提案。
      {
        metricKey: METRIC_AI_FALSE_PASS,
        checkpointKey: "media_quality",
        numerator: 1,
        denominator: 100,
      },
    ]);

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      checkpointKey: "compliance_violation",
      falsePassRate: 0.1,
      sampleSize: 40,
    });
  });
});

describe("buildAdmissionCalibrationDraft", () => {
  it("wraps a proposal into a pending L2 draft envelope", () => {
    const envelope = buildAdmissionCalibrationDraft(
      {
        checkpointKey: "compliance_violation",
        falsePassRate: 0.1,
        sampleSize: 40,
        suggestion: "建议提高门槛",
      },
      { periodStart: "2026-06-05", periodEnd: "2026-07-03" },
    );

    expect(envelope).toMatchObject({
      draftType: "admission_calibration",
      status: "pending",
      targetStateMachine: "admission_review_calibration",
      payload: {
        checkpointKey: "compliance_violation",
        requiresHumanApproval: true,
        suggestion: "建议提高门槛",
      },
    });
  });
});
