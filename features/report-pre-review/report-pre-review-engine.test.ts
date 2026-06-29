import { describe, expect, it } from "vitest";

import {
  evaluateReportPreReview,
  mergePreReviewWording,
  type ReportPreReviewSnapshot,
} from "./report-pre-review-engine";

const baseSnapshot: ReportPreReviewSnapshot = {
  reportId: "report-1",
  status: "pending_review",
  evidenceLevel: "green",
  timeSource: "system",
  settlementDuration: 120,
  systemDuration: 120,
  screenshotDuration: 119,
  screenshotCount: 1,
  ocrStatus: "succeeded",
  riskFlags: [],
  taskHasAnomaly: false,
  durationOverridden: false,
  projectSensitivity: "normal",
  streamerTrust: "trusted",
  plannedDuration: 120,
};

describe("evaluateReportPreReview", () => {
  it("returns quick_pass_candidate for clean green system evidence", () => {
    expect(evaluateReportPreReview(baseSnapshot)).toMatchObject({
      reportId: "report-1",
      decision: "quick_pass_candidate",
      confidence: "high",
      suggestedAction: "approve",
      failedGates: [],
      source: "deterministic",
    });
  });

  it("returns need_more_evidence when screenshot or OCR evidence is missing", () => {
    expect(
      evaluateReportPreReview({
        ...baseSnapshot,
        screenshotCount: 0,
        ocrStatus: "failed",
      }),
    ).toMatchObject({
      decision: "need_more_evidence",
      suggestedAction: "need_more",
      failedGates: expect.arrayContaining([
        "screenshot_missing",
        "ocr_not_succeeded",
      ]),
    });
  });

  it("routes moderate duration divergence to manual review", () => {
    expect(
      evaluateReportPreReview({
        ...baseSnapshot,
        settlementDuration: 145,
      }),
    ).toMatchObject({
      decision: "manual_review",
      confidence: "medium",
      suggestedAction: "review",
      failedGates: expect.arrayContaining(["duration_divergence"]),
    });
  });

  it("blocks high-risk quick pass for severe duration divergence or high sensitivity", () => {
    expect(
      evaluateReportPreReview({
        ...baseSnapshot,
        settlementDuration: 190,
      }),
    ).toMatchObject({
      decision: "high_risk_blocked",
      suggestedAction: "reject",
      failedGates: expect.arrayContaining(["severe_duration_divergence"]),
    });

    expect(
      evaluateReportPreReview({
        ...baseSnapshot,
        projectSensitivity: "high",
      }),
    ).toMatchObject({
      decision: "high_risk_blocked",
      failedGates: expect.arrayContaining(["project_high_sensitive"]),
    });
  });

  it("never lets LLM wording upgrade a deterministic hard block", () => {
    const deterministic = evaluateReportPreReview({
      ...baseSnapshot,
      projectSensitivity: "high",
    });

    const merged = mergePreReviewWording(deterministic, {
      decision: "quick_pass_candidate",
      evidenceSummary: "Looks clean.",
      reviewNoteDraft: "Approve directly.",
      reasons: ["llm_claimed_clean"],
    });

    expect(merged.decision).toBe("high_risk_blocked");
    expect(merged.suggestedAction).toBe("reject");
    expect(merged.evidenceSummary).toBe("Looks clean.");
    expect(merged.reasons).toContain("project_high_sensitive");
    expect(merged.reasons).toContain("llm_claimed_clean");
  });
});
