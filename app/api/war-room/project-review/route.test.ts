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
