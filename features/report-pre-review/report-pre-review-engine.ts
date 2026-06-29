export type ReportPreReviewDecision =
  | "quick_pass_candidate"
  | "manual_review"
  | "need_more_evidence"
  | "high_risk_blocked";

export type ReportPreReviewSuggestedAction =
  | "approve"
  | "need_more"
  | "reject"
  | "review";

export type ReportPreReviewSnapshot = {
  reportId: string;
  status: string;
  evidenceLevel: "green" | "yellow" | "red" | null;
  timeSource: "system" | "screenshot" | "claimed" | null;
  settlementDuration: number | null;
  systemDuration: number | null;
  screenshotDuration: number | null;
  screenshotCount: number;
  ocrStatus: "succeeded" | "failed" | "pending" | "missing" | null;
  riskFlags: string[];
  taskHasAnomaly: boolean;
  durationOverridden: boolean;
  projectSensitivity: "normal" | "high";
  streamerTrust: "trusted" | "probation" | "restricted";
  plannedDuration: number | null;
};

export type ReportPreReviewResult = {
  reportId: string;
  decision: ReportPreReviewDecision;
  confidence: "high" | "medium" | "low";
  evidenceSummary: string;
  suggestedAction: ReportPreReviewSuggestedAction;
  reviewNoteDraft: string;
  reasons: string[];
  failedGates: string[];
  source: "deterministic" | "llm" | "degraded";
  invocationId?: string;
};

export type ReportPreReviewRule = {
  maxDurationDeviationPct: number;
  maxDurationDeviationMinutes: number;
  severeDurationDeviationMultiplier: number;
  dailyHardLimitMinutes: number;
};

export type LlmPreReviewWording = Partial<
  Pick<
    ReportPreReviewResult,
    "decision" | "evidenceSummary" | "reviewNoteDraft" | "reasons"
  >
>;

const DEFAULT_RULE: ReportPreReviewRule = {
  maxDurationDeviationPct: 10,
  maxDurationDeviationMinutes: 15,
  severeDurationDeviationMultiplier: 2,
  dailyHardLimitMinutes: 480,
};

const HARD_BLOCK_GATES = new Set([
  "project_high_sensitive",
  "streamer_restricted",
  "evidence_red",
  "severe_duration_divergence",
  "daily_hard_limit_exceeded",
  "task_has_anomaly",
]);

const NEED_MORE_GATES = new Set([
  "screenshot_missing",
  "ocr_not_succeeded",
  "duration_missing",
]);

export function evaluateReportPreReview(
  snapshot: ReportPreReviewSnapshot,
  rule: Partial<ReportPreReviewRule> = {},
): ReportPreReviewResult {
  const effectiveRule = { ...DEFAULT_RULE, ...rule };
  const failedGates: string[] = [];
  const reasons: string[] = [];

  if (snapshot.status !== "pending_review") {
    failedGates.push("status_not_pending_review");
  }

  if (snapshot.screenshotCount <= 0) {
    failedGates.push("screenshot_missing");
  }

  if (snapshot.ocrStatus !== "succeeded") {
    failedGates.push("ocr_not_succeeded");
  }

  if (snapshot.evidenceLevel === "green" && snapshot.timeSource === "system") {
    reasons.push("green_system_evidence");
  } else {
    failedGates.push(evidenceGate(snapshot));
  }

  if (snapshot.settlementDuration === null) {
    failedGates.push("duration_missing");
  }

  if (snapshot.riskFlags.length > 0) {
    failedGates.push("risk_flags_present");
  }

  if (snapshot.taskHasAnomaly) {
    failedGates.push("task_has_anomaly");
  }

  if (snapshot.durationOverridden) {
    failedGates.push("duration_overridden");
  }

  if (snapshot.projectSensitivity === "high") {
    failedGates.push("project_high_sensitive");
  }

  if (snapshot.streamerTrust === "restricted") {
    failedGates.push("streamer_restricted");
  } else if (snapshot.streamerTrust !== "trusted") {
    failedGates.push("streamer_not_trusted");
  }

  if (
    snapshot.settlementDuration !== null &&
    snapshot.settlementDuration > effectiveRule.dailyHardLimitMinutes
  ) {
    failedGates.push("daily_hard_limit_exceeded");
  }

  const durationGate = durationDeviationGate(snapshot, effectiveRule);
  if (durationGate) {
    failedGates.push(durationGate);
  }

  const decision = decisionFromGates(failedGates);
  return {
    reportId: snapshot.reportId,
    decision,
    confidence: confidenceFromDecision(decision, failedGates),
    evidenceSummary: buildEvidenceSummary(snapshot, failedGates),
    suggestedAction: suggestedActionFor(decision),
    reviewNoteDraft: buildReviewNoteDraft(decision, snapshot, failedGates),
    reasons,
    failedGates: unique(failedGates),
    source: "deterministic",
  };
}

export function mergePreReviewWording(
  deterministic: ReportPreReviewResult,
  wording: LlmPreReviewWording | null | undefined,
): ReportPreReviewResult {
  if (!wording) return deterministic;
  return {
    ...deterministic,
    evidenceSummary: wording.evidenceSummary ?? deterministic.evidenceSummary,
    reviewNoteDraft: wording.reviewNoteDraft ?? deterministic.reviewNoteDraft,
    reasons: unique([
      ...deterministic.reasons,
      ...deterministic.failedGates,
      ...(wording.reasons ?? []),
    ]),
    source: "llm",
  };
}

function evidenceGate(snapshot: ReportPreReviewSnapshot): string {
  if (snapshot.evidenceLevel === "red") return "evidence_red";
  if (snapshot.evidenceLevel === null) return "evidence_missing";
  return "evidence_not_green_system";
}

function durationDeviationGate(
  snapshot: ReportPreReviewSnapshot,
  rule: ReportPreReviewRule,
): string | null {
  if (
    snapshot.plannedDuration === null ||
    snapshot.plannedDuration <= 0 ||
    snapshot.settlementDuration === null
  ) {
    return null;
  }
  const deviation = Math.abs(
    snapshot.settlementDuration - snapshot.plannedDuration,
  );
  const pctLimit = Math.round(
    snapshot.plannedDuration * (rule.maxDurationDeviationPct / 100),
  );
  const limit = Math.max(pctLimit, rule.maxDurationDeviationMinutes);
  if (deviation <= limit) return null;
  if (deviation > limit * rule.severeDurationDeviationMultiplier) {
    return "severe_duration_divergence";
  }
  return "duration_divergence";
}

function decisionFromGates(failedGates: string[]): ReportPreReviewDecision {
  const gates = new Set(failedGates);
  if ([...gates].some((gate) => HARD_BLOCK_GATES.has(gate))) {
    return "high_risk_blocked";
  }
  if ([...gates].some((gate) => NEED_MORE_GATES.has(gate))) {
    return "need_more_evidence";
  }
  if (gates.size > 0) {
    return "manual_review";
  }
  return "quick_pass_candidate";
}

function confidenceFromDecision(
  decision: ReportPreReviewDecision,
  failedGates: string[],
): ReportPreReviewResult["confidence"] {
  if (decision === "quick_pass_candidate" || decision === "high_risk_blocked") {
    return "high";
  }
  return failedGates.length <= 1 ? "medium" : "low";
}

function suggestedActionFor(
  decision: ReportPreReviewDecision,
): ReportPreReviewSuggestedAction {
  if (decision === "quick_pass_candidate") return "approve";
  if (decision === "need_more_evidence") return "need_more";
  if (decision === "high_risk_blocked") return "reject";
  return "review";
}

function buildEvidenceSummary(
  snapshot: ReportPreReviewSnapshot,
  failedGates: string[],
): string {
  const facts = [
    `settlement=${displayMinutes(snapshot.settlementDuration)}`,
    `system=${displayMinutes(snapshot.systemDuration)}`,
    `screenshot=${displayMinutes(snapshot.screenshotDuration)}`,
    `evidence=${snapshot.evidenceLevel ?? "missing"}`,
    `timeSource=${snapshot.timeSource ?? "missing"}`,
    `ocr=${snapshot.ocrStatus ?? "missing"}`,
    `screenshots=${snapshot.screenshotCount}`,
  ];
  if (failedGates.length) {
    facts.push(`failedGates=${unique(failedGates).join(",")}`);
  }
  return facts.join("; ");
}

function buildReviewNoteDraft(
  decision: ReportPreReviewDecision,
  snapshot: ReportPreReviewSnapshot,
  failedGates: string[],
): string {
  const prefix =
    decision === "quick_pass_candidate"
      ? "AI pre-review suggests approval"
      : decision === "need_more_evidence"
        ? "AI pre-review suggests requesting more evidence"
        : decision === "high_risk_blocked"
          ? "AI pre-review flags high risk"
          : "AI pre-review suggests manual review";
  return `${prefix}: ${buildEvidenceSummary(snapshot, failedGates)}`;
}

function displayMinutes(value: number | null): string {
  return value === null ? "missing" : `${value}m`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
