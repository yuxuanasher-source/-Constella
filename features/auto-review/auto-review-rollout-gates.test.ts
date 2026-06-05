import { describe, expect, it } from "vitest";

import {
  evaluateAutoReviewRolloutGate,
  type AutoReviewRolloutGateInput,
} from "./auto-review-rollout-gates";

describe("evaluateAutoReviewRolloutGate", () => {
  it("allows shadow mode by default", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        targetMode: "shadow",
        explicitActiveRequest: false,
      }),
    ).toEqual({
      allowed: true,
      targetMode: "shadow",
      effectiveMode: "shadow",
      reasons: expect.arrayContaining(["shadow_mode_allowed"]),
      failedGates: [],
    });
  });

  it("blocks active when kill switch is enabled", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        killSwitchEnabled: true,
      }),
    ).toMatchObject({
      allowed: false,
      targetMode: "active",
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["kill_switch_enabled"]),
    });
  });

  it("blocks active without an explicit active request", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        explicitActiveRequest: false,
      }),
    ).toMatchObject({
      allowed: false,
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["explicit_active_request_missing"]),
    });
  });

  it("blocks gray and active when shadow sample count is below threshold", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        targetMode: "gray",
        shadowSampleCount: 49,
        minimumShadowSampleCount: 50,
      }),
    ).toMatchObject({
      allowed: false,
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["insufficient_shadow_samples"]),
    });

    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        shadowSampleCount: 49,
        minimumShadowSampleCount: 50,
      }),
    ).toMatchObject({
      allowed: false,
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["insufficient_shadow_samples"]),
    });
  });

  it("blocks active when shadow false accept rate is above threshold", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        shadowFalseAcceptRateBps: 101,
        maximumFalseAcceptRateBps: 100,
      }),
    ).toMatchObject({
      allowed: false,
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["shadow_far_above_threshold"]),
    });
  });

  it("blocks active when audit error rate is above threshold", () => {
    expect(
      evaluateAutoReviewRolloutGate({
        ...passingInput(),
        auditErrorRateBps: 251,
        maximumAuditErrorRateBps: 250,
      }),
    ).toMatchObject({
      allowed: false,
      effectiveMode: "shadow",
      failedGates: expect.arrayContaining(["audit_error_rate_above_threshold"]),
    });
  });

  it("allows active only when all rollout gates pass", () => {
    expect(evaluateAutoReviewRolloutGate(passingInput())).toEqual({
      allowed: true,
      targetMode: "active",
      effectiveMode: "active",
      reasons: expect.arrayContaining([
        "explicit_active_request_present",
        "shadow_samples_sufficient",
        "shadow_far_within_threshold",
        "audit_samples_sufficient",
        "audit_error_rate_within_threshold",
      ]),
      failedGates: [],
    });
  });
});

function passingInput(): AutoReviewRolloutGateInput {
  return {
    targetMode: "active",
    killSwitchEnabled: false,
    shadowSampleCount: 100,
    minimumShadowSampleCount: 50,
    shadowFalseAcceptRateBps: 50,
    maximumFalseAcceptRateBps: 100,
    auditSampleCount: 30,
    minimumAuditSampleCount: 20,
    auditErrorRateBps: 100,
    maximumAuditErrorRateBps: 250,
    explicitActiveRequest: true,
  };
}
