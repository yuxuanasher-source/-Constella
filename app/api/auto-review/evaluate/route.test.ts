import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  evaluateAutoReviewActive,
  evaluateAutoReviewShadow,
} from "@/features/auto-review/auto-review-service";
import { listAutoReviewRolloutMetricRows } from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/auto-review/auto-review-service", () => ({
  evaluateAutoReviewActive: vi.fn(),
  evaluateAutoReviewShadow: vi.fn(),
}));

vi.mock(
  "@/features/auto-review/auto-review-rollout-metrics-repository",
  () => ({
    listAutoReviewRolloutMetricRows: vi.fn(),
  }),
);

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("auto review evaluate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(evaluateAutoReviewShadow).mockResolvedValue({
      decision: "auto_pass_candidate",
      mode: "shadow",
      confidence: "high",
      reasons: ["green_system_evidence"],
      failedGates: [],
    });
    vi.mocked(evaluateAutoReviewActive).mockResolvedValue({
      decision: "auto_pass_candidate",
      mode: "active",
      confidence: "high",
      reasons: ["green_system_evidence"],
      failedGates: [],
      applied: true,
    });
  });

  it("evaluates a report snapshot in shadow mode for staff", async () => {
    const body = {
      report: {
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
      },
      rule: {
        id: "rule-1",
        mode: "shadow",
        maxDurationDeviationPct: 10,
        maxDurationDeviationMinutes: 15,
        dailyHardLimitMinutes: 480,
      },
    };

    const response = await POST(
      new Request("http://localhost/api/auto-review/evaluate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: {
        decision: "auto_pass_candidate",
        mode: "shadow",
        confidence: "high",
        reasons: ["green_system_evidence"],
        failedGates: [],
      },
    });
    expect(evaluateAutoReviewShadow).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      report: body.report,
      rule: body.rule,
    });
  });

  it("blocks streamers from evaluating organization reports", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/auto-review/evaluate", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(evaluateAutoReviewShadow).not.toHaveBeenCalled();
  });

  it("applies active auto review only when rollout metrics allow active", async () => {
    const body = {
      targetMode: "active",
      report: reportSnapshot(),
      rule: {
        id: "rule-1",
        mode: "active",
        maxDurationDeviationPct: 10,
        maxDurationDeviationMinutes: 15,
        dailyHardLimitMinutes: 480,
      },
      rolloutConfig: { limit: 200 },
    };
    vi.mocked(listAutoReviewRolloutMetricRows).mockResolvedValueOnce({
      gateInput: {
        targetMode: "active",
        killSwitchEnabled: false,
        shadowSampleCount: 100,
        minimumShadowSampleCount: 50,
        shadowFalseAcceptRateBps: 0,
        maximumFalseAcceptRateBps: 100,
        auditSampleCount: 40,
        minimumAuditSampleCount: 20,
        auditErrorRateBps: 0,
        maximumAuditErrorRateBps: 250,
        explicitActiveRequest: true,
      },
      summary: {},
    } as never);

    const response = await POST(
      new Request("http://localhost/api/auto-review/evaluate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { mode: "active", applied: true },
      rolloutGate: { allowed: true, effectiveMode: "active" },
    });
    expect(listAutoReviewRolloutMetricRows).toHaveBeenCalledWith(
      { client: "supabase" },
      expect.objectContaining({
        organizationId: "org-1",
        limit: 200,
      }),
    );
    expect(evaluateAutoReviewActive).toHaveBeenCalledWith(
      expect.objectContaining({
        client: { client: "supabase" },
        actor: expect.objectContaining({ name: "系统自动审核" }),
        report: body.report,
        rule: expect.objectContaining({ id: "rule-1", mode: "active" }),
        rolloutGate: expect.objectContaining({ allowed: true }),
      }),
    );
  });

  it("falls back to shadow when active rollout gates are not ready", async () => {
    const body = {
      targetMode: "active",
      report: reportSnapshot(),
      rule: {
        id: "rule-1",
        mode: "active",
        maxDurationDeviationPct: 10,
        maxDurationDeviationMinutes: 15,
        dailyHardLimitMinutes: 480,
      },
    };
    vi.mocked(listAutoReviewRolloutMetricRows).mockResolvedValueOnce({
      gateInput: {
        targetMode: "active",
        killSwitchEnabled: false,
        shadowSampleCount: 0,
        minimumShadowSampleCount: 50,
        shadowFalseAcceptRateBps: 0,
        maximumFalseAcceptRateBps: 100,
        auditSampleCount: 0,
        minimumAuditSampleCount: 20,
        auditErrorRateBps: 0,
        maximumAuditErrorRateBps: 250,
        explicitActiveRequest: true,
      },
      summary: {},
    } as never);

    const response = await POST(
      new Request("http://localhost/api/auto-review/evaluate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { mode: "shadow", applied: false },
      rolloutGate: {
        allowed: false,
        failedGates: expect.arrayContaining([
          "insufficient_shadow_samples",
          "insufficient_audit_samples",
        ]),
      },
    });
    expect(evaluateAutoReviewActive).not.toHaveBeenCalled();
    expect(evaluateAutoReviewShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        rule: expect.objectContaining({ mode: "shadow" }),
      }),
    );
  });

  it("rejects invalid report snapshots before evaluation", async () => {
    const response = await POST(
      new Request("http://localhost/api/auto-review/evaluate", {
        method: "POST",
        body: JSON.stringify({
          report: {
            id: "report-1",
            status: "pending_review",
            evidenceLevel: "purple",
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
          },
          rule: {
            id: "rule-1",
            mode: "shadow",
            maxDurationDeviationPct: 10,
            maxDurationDeviationMinutes: 15,
            dailyHardLimitMinutes: 480,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
    expect(evaluateAutoReviewShadow).not.toHaveBeenCalled();
  });
});

function reportSnapshot() {
  return {
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
}
