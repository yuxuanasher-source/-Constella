import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { evaluateAutoReviewShadow } from "@/features/auto-review/auto-review-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/auto-review/auto-review-service", () => ({
  evaluateAutoReviewShadow: vi.fn(),
}));

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
});
