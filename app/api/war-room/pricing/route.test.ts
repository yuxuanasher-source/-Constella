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

describe("war room pricing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
  });

  it("returns project pricing calculation for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/pricing", {
        method: "POST",
        body: JSON.stringify({
          vendorSettlementMethod: "cpt",
          streamerCount: 5,
          estimatedMinutesPerStreamer: 1200,
          vendorHourlyRateCents: 12000,
          streamerHourlyCostCents: 7000,
          supplierCostCents: 200000,
          targetMarginBps: 2000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pricing: {
        expectedReceivableCents: 1200000,
        grossMarginCents: 300000,
        suggestedMinimumVendorHourlyRateCents: 11250,
      },
    });
  });

  it("blocks streamers from internal quote economics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/war-room/pricing", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects invalid pricing request bodies before calculation", async () => {
    const response = await POST(
      new Request("http://localhost/api/war-room/pricing", {
        method: "POST",
        body: JSON.stringify({
          vendorSettlementMethod: "cpt",
          streamerCount: "5",
          estimatedMinutesPerStreamer: 1200,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
  });
});
