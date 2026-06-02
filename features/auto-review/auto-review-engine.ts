export type AutoReviewMode = "shadow" | "active";

export type AutoReviewDecision =
  | "auto_pass_candidate"
  | "manual_review"
  | "disabled";

export type AutoReviewReportSnapshot = {
  id: string;
  status: string;
  evidenceLevel: "green" | "yellow" | "red" | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  settlementDuration: number | null;
  systemDuration: number | null;
  screenshotDuration: number | null;
  riskFlags: string[];
  taskHasAnomaly: boolean;
  durationOverridden: boolean;
  projectSensitivity: "normal" | "high";
  streamerTrust: "trusted" | "probation" | "restricted";
  plannedDuration: number | null;
};

export type AutoReviewRule = {
  id: string;
  mode: AutoReviewMode;
  maxDurationDeviationPct: number;
  maxDurationDeviationMinutes: number;
  dailyHardLimitMinutes: number;
};

export type AutoReviewResult = {
  decision: AutoReviewDecision;
  mode: AutoReviewMode;
  confidence: "high" | "low";
  reasons: string[];
  failedGates: string[];
};

export function evaluateAutoReview(
  report: AutoReviewReportSnapshot,
  rule: AutoReviewRule,
): AutoReviewResult {
  const failedGates: string[] = [];
  const reasons: string[] = [];

  if (report.status !== "pending_review") {
    failedGates.push("status_not_pending_review");
  }

  if (report.evidenceLevel !== "green" || report.timeSource !== "system") {
    failedGates.push("evidence_not_green");
  } else {
    reasons.push("green_system_evidence");
  }

  if (report.riskFlags.length > 0) {
    failedGates.push("risk_flags_present");
  }

  if (report.taskHasAnomaly) {
    failedGates.push("task_has_anomaly");
  }

  if (report.durationOverridden) {
    failedGates.push("duration_overridden");
  }

  if (report.streamerTrust !== "trusted") {
    failedGates.push("streamer_not_trusted");
  }

  if (report.projectSensitivity === "high") {
    failedGates.push("project_high_sensitive");
  }

  if (
    report.settlementDuration !== null &&
    report.settlementDuration > rule.dailyHardLimitMinutes
  ) {
    failedGates.push("daily_hard_limit_exceeded");
  }

  if (!isWithinPlannedDurationGuardrail(report, rule)) {
    failedGates.push("planned_duration_deviation");
  }

  return {
    decision:
      failedGates.length === 0 ? "auto_pass_candidate" : "manual_review",
    mode: rule.mode,
    confidence: failedGates.length === 0 ? "high" : "low",
    reasons,
    failedGates,
  };
}

function isWithinPlannedDurationGuardrail(
  report: AutoReviewReportSnapshot,
  rule: AutoReviewRule,
): boolean {
  if (
    report.plannedDuration === null ||
    report.plannedDuration <= 0 ||
    report.settlementDuration === null
  ) {
    return true;
  }

  const deviation = Math.abs(report.settlementDuration - report.plannedDuration);
  const pctLimit = Math.round(
    report.plannedDuration * (rule.maxDurationDeviationPct / 100),
  );
  const limit = Math.max(pctLimit, rule.maxDurationDeviationMinutes);
  return deviation <= limit;
}
