import { describe, expect, it, vi } from "vitest";

import { evaluateAutoReviewShadow } from "./auto-review-service";

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
