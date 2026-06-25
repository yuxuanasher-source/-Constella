import { describe, expect, it, vi } from "vitest";

import {
  evaluateAutoReviewActive,
  evaluateAutoReviewShadow,
} from "./auto-review-service";

const report = {
  id: "report-1",
  status: "pending_review",
  evidenceLevel: "green" as const,
  timeSource: "system" as const,
  settlementDuration: 120,
  systemDuration: 120,
  screenshotDuration: 121,
  riskFlags: [],
  taskHasAnomaly: false,
  durationOverridden: false,
  projectSensitivity: "normal" as const,
  streamerTrust: "trusted" as const,
  plannedDuration: 120,
};

const rule = {
  id: "rule-1",
  mode: "shadow" as const,
  maxDurationDeviationPct: 10,
  maxDurationDeviationMinutes: 15,
  dailyHardLimitMinutes: 480,
};

const activeRule = {
  ...rule,
  mode: "active" as const,
};

function createClient() {
  const auditInserts: Record<string, unknown>[] = [];
  return {
    client: {
      from: vi.fn(() => ({
        insert: vi.fn(async (payload: Record<string, unknown>) => {
          auditInserts.push(payload);
          return { error: null };
        }),
      })),
    },
    auditInserts,
  };
}

describe("evaluateAutoReviewShadow", () => {
  it("writes audit and does not mutate report state", async () => {
    const { client, auditInserts } = createClient();

    const result = await evaluateAutoReviewShadow({
      client,
      actor: {
        userId: "user-ops",
        name: "运营经理",
        role: "ops_manager",
        organizationId: "org-1",
      },
      report,
      rule,
    });

    expect(result).toMatchObject({
      decision: "auto_pass_candidate",
      mode: "shadow",
    });
    expect(auditInserts).toEqual([
      expect.objectContaining({
        organization_id: "org-1",
        action: "approve",
        module: "auto_review",
        object_type: "live_report",
        object_id: "report-1",
        changed_fields: ["shadow_decision"],
      }),
    ]);
  });
});

describe("evaluateAutoReviewActive", () => {
  it("refuses active approval unless the rule version is explicitly active", async () => {
    const { client } = createClient();
    const approveReport = vi.fn();

    await expect(
      evaluateAutoReviewActive({
        client,
        actor: {
          userId: "user-ops",
          name: "Ops Manager",
          role: "ops_manager",
          organizationId: "org-1",
        },
        report,
        rule,
        approveReport,
      }),
    ).rejects.toThrow("Active auto review requires active rule version");
    expect(approveReport).not.toHaveBeenCalled();
  });

  it("approves only by entering the settlement pool and does not calculate money", async () => {
    const { client, auditInserts } = createClient();
    const approveReport = vi.fn(async (input: unknown) => {
      void input;
      return {
        id: "report-1",
        status: "approved",
        enterSettlementPool: true,
      };
    });

    const result = await evaluateAutoReviewActive({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      report,
      rule: activeRule,
      approveReport,
    });

    expect(result).toMatchObject({
      decision: "auto_pass_candidate",
      mode: "active",
      applied: true,
    });
    expect(approveReport).toHaveBeenCalledWith({
      actor: expect.objectContaining({ role: "ops_manager" }),
      reportId: "report-1",
      input: {
        decision: "approve",
        includeInTaskResult: true,
        enterSettlementPool: true,
        reviewNotes: "Auto review passed by rule rule-1",
        reason: "auto_review:rule-1",
      },
    });
    expect(JSON.stringify(approveReport.mock.calls[0][0])).not.toContain(
      "computedAmount",
    );
    expect(JSON.stringify(approveReport.mock.calls[0][0])).not.toContain(
      "manualAmount",
    );
    expect(auditInserts).toEqual([
      expect.objectContaining({
        module: "auto_review",
        changed_fields: ["active_decision"],
      }),
    ]);
  });

  it("blocks active approval when rollout gate is not allowed", async () => {
    const { client, auditInserts } = createClient();
    const approveReport = vi.fn();

    await expect(
      evaluateAutoReviewActive({
        client,
        actor: {
          userId: "user-ops",
          name: "Ops Manager",
          role: "ops_manager",
          organizationId: "org-1",
        },
        report,
        rule: activeRule,
        approveReport,
        rolloutGate: {
          allowed: false,
          targetMode: "active",
          effectiveMode: "shadow",
          reasons: [],
          failedGates: ["kill_switch_enabled"],
        },
      }),
    ).rejects.toThrow("Active auto review blocked by rollout gate");

    expect(approveReport).not.toHaveBeenCalled();
    expect(auditInserts).toEqual([]);
  });

  it("keeps active approval when rollout gate allows active", async () => {
    const { client } = createClient();
    const approveReport = vi.fn(async (input: unknown) => {
      void input;
      return {
        id: "report-1",
        status: "approved",
        enterSettlementPool: true,
      };
    });

    const result = await evaluateAutoReviewActive({
      client,
      actor: {
        userId: "user-ops",
        name: "Ops Manager",
        role: "ops_manager",
        organizationId: "org-1",
      },
      report,
      rule: activeRule,
      approveReport,
      rolloutGate: {
        allowed: true,
        targetMode: "active",
        effectiveMode: "active",
        reasons: ["shadow_far_within_threshold"],
        failedGates: [],
      },
    });

    expect(result).toMatchObject({
      decision: "auto_pass_candidate",
      mode: "active",
      applied: true,
    });
    expect(approveReport).toHaveBeenCalledTimes(1);
  });
});
