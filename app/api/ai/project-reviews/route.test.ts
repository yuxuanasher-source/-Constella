import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

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

describe("AI project review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns grounded AG1 project review output for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      report: {
        projectId: "project-api",
        marginRateBps: 4167,
        shouldContinue: true,
      },
      agentOutput: {
        facts: expect.arrayContaining([
          expect.objectContaining({
            sourceTool: "project_review_summary",
            sourceId: "project-api:marginRateBps",
          }),
        ]),
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            requiresHumanApproval: true,
          }),
        ]),
      },
      validation: { valid: true, errors: [] },
    });
    expect(JSON.stringify(body.agentOutput.findings)).not.toMatch(/\d/);
    expect(JSON.stringify(body.agentOutput.recommendations)).not.toMatch(/\d/);
  });

  it("blocks streamers from internal project review economics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("requires authentication", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/ai/project-reviews", {
        method: "POST",
        body: JSON.stringify(createRequestBody()),
      }),
    );

    expect(response.status).toBe(401);
  });
});

function createRequestBody() {
  return {
    project: {
      id: "project-api",
      name: "Campaign Alpha",
      category: "moba",
      platform: "douyin",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
    },
    finance: {
      receivableCents: 1200000,
      payableCents: 600000,
      supplierCostCents: 100000,
      adjustmentCents: 0,
      manualRevenueCents: 80000,
    },
    streamers: [
      {
        id: "streamer-a",
        name: "Ava",
        durationMinutes: 1200,
        totalViews: 120000,
        completionRateBps: 9500,
        roiBps: 14000,
        grossMarginContributionCents: 320000,
        anomalyCount: 0,
        disputeCount: 0,
      },
    ],
    suppliers: [],
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}
