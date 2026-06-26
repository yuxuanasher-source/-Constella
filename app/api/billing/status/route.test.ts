import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { getBillingStatus } from "@/features/billing/billing-status";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/billing/billing-status", () => ({
  getBillingStatus: vi.fn(),
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

describe("billing status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(getBillingStatus).mockResolvedValue({
      subscriptionStatus: "active",
      mode: "active",
      plan: { tier: "pro", code: "pro", name: "专业版" },
      entitlements: { war_room: true },
      usage: [],
    } as never);
  });

  it("returns safe billing status for MCN staff", async () => {
    const response = await GET(new Request("http://localhost/api/billing/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      billing: {
        subscriptionStatus: "active",
        mode: "active",
        plan: { tier: "pro", code: "pro", name: "专业版" },
        entitlements: { war_room: true },
        usage: [],
      },
    });
    expect(getBillingStatus).toHaveBeenCalledWith({
      client: { client: "supabase" },
      organizationId: "org-1",
    });
  });

  it("blocks streamers from organization billing status", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await GET(new Request("http://localhost/api/billing/status"));

    expect(response.status).toBe(403);
    expect(getBillingStatus).not.toHaveBeenCalled();
  });
});
