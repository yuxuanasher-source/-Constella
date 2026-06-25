export type AutoReviewRolloutMode = "shadow" | "gray" | "active";

export type AutoReviewRolloutGateInput = {
  targetMode: AutoReviewRolloutMode;
  killSwitchEnabled: boolean;
  shadowSampleCount: number;
  minimumShadowSampleCount: number;
  shadowFalseAcceptRateBps: number;
  maximumFalseAcceptRateBps: number;
  auditSampleCount: number;
  minimumAuditSampleCount: number;
  auditErrorRateBps: number;
  maximumAuditErrorRateBps: number;
  explicitActiveRequest: boolean;
};

export type AutoReviewRolloutGateResult = {
  allowed: boolean;
  targetMode: AutoReviewRolloutMode;
  effectiveMode: AutoReviewRolloutMode;
  reasons: string[];
  failedGates: string[];
};

export function evaluateAutoReviewRolloutGate(
  input: AutoReviewRolloutGateInput,
): AutoReviewRolloutGateResult {
  const failedGates: string[] = [];
  const reasons: string[] = [];

  if (input.killSwitchEnabled) {
    failedGates.push("kill_switch_enabled");
  } else {
    reasons.push("kill_switch_clear");
  }

  if (input.targetMode === "shadow") {
    if (!input.killSwitchEnabled) {
      reasons.push("shadow_mode_allowed");
    }

    return buildResult(input.targetMode, reasons, failedGates);
  }

  if (
    safeCount(input.shadowSampleCount) <
    safeCount(input.minimumShadowSampleCount)
  ) {
    failedGates.push("insufficient_shadow_samples");
  } else {
    reasons.push("shadow_samples_sufficient");
  }

  if (input.targetMode === "gray") {
    return buildResult(input.targetMode, reasons, failedGates);
  }

  if (!input.explicitActiveRequest) {
    failedGates.push("explicit_active_request_missing");
  } else {
    reasons.push("explicit_active_request_present");
  }

  if (
    safeBps(input.shadowFalseAcceptRateBps) >
    safeBps(input.maximumFalseAcceptRateBps)
  ) {
    failedGates.push("shadow_far_above_threshold");
  } else {
    reasons.push("shadow_far_within_threshold");
  }

  if (
    safeCount(input.auditSampleCount) < safeCount(input.minimumAuditSampleCount)
  ) {
    failedGates.push("insufficient_audit_samples");
  } else {
    reasons.push("audit_samples_sufficient");
  }

  if (
    safeBps(input.auditErrorRateBps) > safeBps(input.maximumAuditErrorRateBps)
  ) {
    failedGates.push("audit_error_rate_above_threshold");
  } else {
    reasons.push("audit_error_rate_within_threshold");
  }

  return buildResult(input.targetMode, reasons, failedGates);
}

function buildResult(
  targetMode: AutoReviewRolloutMode,
  reasons: string[],
  failedGates: string[],
): AutoReviewRolloutGateResult {
  const allowed = failedGates.length === 0;

  return {
    allowed,
    targetMode,
    effectiveMode: allowed ? targetMode : "shadow",
    reasons,
    failedGates,
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function safeBps(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
