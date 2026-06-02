import { describe, expect, it } from "vitest";

import {
  evaluateAutoReview,
  type AutoReviewReportSnapshot,
  type AutoReviewRule,
} from "./auto-review-engine";

const baseReport: AutoReviewReportSnapshot = {
  id: "report-1",
  status: "pending_review",
  evidenceLevel: "green",
  timeSource: "system",
  settlementDuration: 120,
  systemDuration: 120,
  screenshotDuration: 121,
  riskFlags: [],
  taskHasAnomaly: false,
  durationOverridden: false,
  projectSensitivity: "normal",
  streamerTrust: "trusted",
  plannedDuration: 120,
};

const baseRule: AutoReviewRule = {
  id: "rule-1",
  mode: "shadow",
  maxDurationDeviationPct: 10,
  maxDurationDeviationMinutes: 15,
  dailyHardLimitMinutes: 480,
};

describe("evaluateAutoReview", () => {
  it("marks clean green system-evidence reports as auto-pass candidates in shadow mode", () => {
    expect(evaluateAutoReview(baseReport, baseRule)).toEqual({
      decision: "auto_pass_candidate",
      mode: "shadow",
      confidence: "high",
      reasons: expect.arrayContaining(["green_system_evidence"]),
      failedGates: [],
    });
  });

  it("sends yellow, red, or conflicted evidence to manual review", () => {
    expect(
      evaluateAutoReview(
        {
          ...baseReport,
          evidenceLevel: "yellow",
          timeSource: "screenshot",
        },
        baseRule,
      ),
    ).toMatchObject({
      decision: "manual_review",
      failedGates: expect.arrayContaining(["evidence_not_green"]),
    });
  });

  it("blocks auto-pass when duration deviates from plan guardrails", () => {
    expect(
      evaluateAutoReview(
        {
          ...baseReport,
          settlementDuration: 180,
        },
        baseRule,
      ),
    ).toMatchObject({
      decision: "manual_review",
      failedGates: expect.arrayContaining(["planned_duration_deviation"]),
    });
  });

  it("blocks high sensitive projects and untrusted streamers", () => {
    expect(
      evaluateAutoReview(
        {
          ...baseReport,
          projectSensitivity: "high",
          streamerTrust: "probation",
        },
        baseRule,
      ),
    ).toMatchObject({
      decision: "manual_review",
      failedGates: expect.arrayContaining([
        "streamer_not_trusted",
        "project_high_sensitive",
      ]),
    });
  });
});
