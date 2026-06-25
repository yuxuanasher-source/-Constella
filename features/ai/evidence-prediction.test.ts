import { describe, expect, it } from "vitest";

import { resolveReportEvidence } from "@/features/live-operations/live-report-evidence";

import {
  computeDeviation,
  deviationSummary,
  predictEvidence,
} from "./evidence-prediction";

describe("computeDeviation (L1)", () => {
  it("flags within-threshold deviation (≤ max(10%,15min))", () => {
    const r = computeDeviation(120, 116);
    expect(r.absoluteDiffMinutes).toBe(4);
    expect(r.allowedDiffMinutes).toBe(15); // max(12, 15)
    expect(r.withinThreshold).toBe(true);
  });

  it("flags over-threshold deviation", () => {
    const r = computeDeviation(120, 90);
    expect(r.absoluteDiffMinutes).toBe(30);
    expect(r.withinThreshold).toBe(false);
    expect(deviationSummary(r)).toContain("超阈值");
  });

  it("uses the 10% bound when it exceeds 15 minutes", () => {
    const r = computeDeviation(300, 270);
    expect(r.allowedDiffMinutes).toBe(30); // max(30, 15)
    expect(r.withinThreshold).toBe(true);
  });

  it("returns nulls when a duration is missing", () => {
    const r = computeDeviation(120, null);
    expect(r.withinThreshold).toBeNull();
    expect(deviationSummary(r)).toContain("无法计算偏差");
  });
});

describe("predictEvidence (L1) mirrors the rule engine verdict", () => {
  const cases = [
    { systemMinutes: 120, screenMinutes: 116, declaredMinutes: 118 },
    { systemMinutes: 120, screenMinutes: 90, declaredMinutes: 118 },
    { systemMinutes: 120, screenMinutes: null, declaredMinutes: 118 },
    { systemMinutes: null, screenMinutes: 95, declaredMinutes: 118 },
    { systemMinutes: null, screenMinutes: null, declaredMinutes: 118 },
  ];

  it("predicted color/source always equals resolveReportEvidence", () => {
    for (const c of cases) {
      const predicted = predictEvidence(c);
      const truth = resolveReportEvidence({
        systemDuration: c.systemMinutes,
        screenshotDuration: c.screenMinutes,
        claimedDuration: c.declaredMinutes,
      });
      expect(predicted.evidenceLevel).toBe(truth.evidenceLevel);
      expect(predicted.timeSource).toBe(truth.timeSource);
      expect(predicted.settlementDuration).toBe(truth.settlementDuration);
    }
  });

  it("only green + system is CPT-eligible", () => {
    expect(predictEvidence({ systemMinutes: 120, screenMinutes: 116 }).cptEligible).toBe(true);
    expect(predictEvidence({ systemMinutes: 120, screenMinutes: 90 }).cptEligible).toBe(false); // yellow
    expect(predictEvidence({ systemMinutes: null, screenMinutes: 95 }).cptEligible).toBe(false); // yellow/screenshot
    expect(predictEvidence({ systemMinutes: null, screenMinutes: null, declaredMinutes: 118 }).cptEligible).toBe(false); // red
  });

  it("rejects when no usable duration is available", () => {
    const p = predictEvidence({ systemMinutes: null, screenMinutes: null, declaredMinutes: null });
    expect(p.rejected).toBe(true);
    expect(p.evidenceLevel).toBeNull();
    expect(p.guidance).toContain("拒绝入库");
  });

  it("guides a streamer to re-submit when screenshot is missing", () => {
    const p = predictEvidence({ systemMinutes: 120, screenMinutes: null });
    expect(p.evidenceLevel).toBe("yellow");
    expect(p.guidance).toContain("补传");
  });

  it("never claims to be the authoritative verdict", () => {
    const p = predictEvidence({ systemMinutes: 120, screenMinutes: 116 });
    expect(p.note).toContain("规则引擎裁决");
  });
});
