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

describe("war room project review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns project review report for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/project-review", {
        method: "POST",
        body: JSON.stringify({
          project: {
            id: "project-1",
            name: "王者荣耀春节档",
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
            manualRevenueCents: 0,
          },
          streamers: [],
          suppliers: [],
          evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        projectId: "project-1",
        grossMarginCents: 500000,
      },
    });
  });

  it("accepts explicit streamer metric gaps and reports them", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/project-review", {
        method: "POST",
        body: JSON.stringify({
          project: {
            id: "project-gap",
            name: "缺口项目",
            category: "moba",
            platform: "douyin",
            periodStart: "2026-02-01",
            periodEnd: "2026-02-07",
          },
          finance: {
            receivableCents: 100000,
            payableCents: 50000,
            supplierCostCents: 10000,
            adjustmentCents: 0,
            manualRevenueCents: 0,
          },
          streamers: [
            {
              id: "streamer-gap",
              name: "Gap",
              durationMinutes: 0,
              totalViews: 0,
              completionRateBps: null,
              roiBps: null,
              grossMarginContributionCents: null,
              anomalyCount: 0,
              disputeCount: 0,
            },
          ],
          suppliers: [],
          evidenceSummary: { green: 0, yellow: 0, red: 0, unknown: 1 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      report: {
        riskNotes: expect.arrayContaining([
          "streamer_completion_rate_unavailable",
          "streamer_roi_unavailable",
          "streamer_gross_margin_contribution_unavailable",
        ]),
      },
    });
  });

  it("blocks streamers from internal review economics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/war-room/project-review", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects invalid project review request bodies before report generation", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/project-review", {
        method: "POST",
        body: JSON.stringify({
          project: {
            id: "project-1",
            name: "王者荣耀春节档",
            category: "moba",
            platform: "douyin",
            periodStart: "2026-02-01",
            periodEnd: "2026-02-07",
          },
          finance: {
            receivableCents: "1200000",
            payableCents: 600000,
            supplierCostCents: 100000,
            adjustmentCents: 0,
            manualRevenueCents: 0,
          },
          streamers: [],
          suppliers: [],
          evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
  });
});
