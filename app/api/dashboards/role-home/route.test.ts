import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("role home dashboard route", () => {
  const supabase = {};
  const auth = {
    userId: "user-owner",
    email: "owner@example.test",
    name: "Owner",
    organizationId: "org-1",
    organizationName: "Org",
    role: "owner" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(loadRoleHomeDashboard).mockResolvedValue({
      profile: {
        role: "owner",
        title: "经营总览看板",
        subtitle: "关注收入、毛利、履约和高风险动作",
        scopeLabel: "全组织",
      },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      generatedAt: "2026-06-16T09:30:00.000Z",
    });
  });

  it("returns the authenticated role dashboard", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dashboard.profile.title).toBe("经营总览看板");
    expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
      supabase,
      auth,
    });
  });

  it("returns 401 without auth", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(401);
  });
});
