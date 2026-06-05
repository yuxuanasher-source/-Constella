import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listAutoReviewRolloutMetricRows } from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

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

describe("auto review rollout metrics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(listAutoReviewRolloutMetricRows).mockResolvedValue({
      gateInput: {
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
      },
      summary: {
        targetMode: "active",
        shadowSampleCount: 100,
        shadowAutoPassCount: 80,
        shadowAutoPassReviewedCount: 80,
        shadowFalseAcceptCount: 1,
        auditSampleCount: 30,
        auditComparedCount: 30,
        auditErrorCount: 1,
      },
    });
  });

  it("returns measured rollout metrics and gate result for operations staff", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/auto-review/rollout-metrics?targetMode=active&explicitActiveRequest=true&limit=200",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        gate: {
          allowed: true,
          targetMode: "active",
          effectiveMode: "active",
        },
        metrics: {
          summary: {
            shadowSampleCount: 100,
            auditComparedCount: 30,
          },
        },
      },
    });
    expect(listAutoReviewRolloutMetricRows).toHaveBeenCalledWith(
      { client: "supabase" },
      {
        organizationId: "org-1",
        limit: 200,
        config: expect.objectContaining({
          targetMode: "active",
          explicitActiveRequest: true,
          killSwitchEnabled: false,
          minimumShadowSampleCount: 50,
          maximumFalseAcceptRateBps: 100,
          minimumAuditSampleCount: 20,
          maximumAuditErrorRateBps: 250,
        }),
      },
    );
  });

  it("blocks streamers from reading organization rollout metrics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await GET(
      new Request("http://localhost/api/auto-review/rollout-metrics"),
    );

    expect(response.status).toBe(403);
    expect(listAutoReviewRolloutMetricRows).not.toHaveBeenCalled();
  });

  it("rejects invalid target mode", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/auto-review/rollout-metrics?targetMode=pilot",
      ),
    );

    expect(response.status).toBe(400);
    expect(listAutoReviewRolloutMetricRows).not.toHaveBeenCalled();
  });
});
