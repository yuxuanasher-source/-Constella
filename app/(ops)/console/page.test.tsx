import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import ConsolePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn(
    (props: {
      currentUser?: { name?: string };
      dashboardHome?: { profile?: { title?: string } } | null;
    }) => (
      <div data-testid="ops-reference-app">
        {props.currentUser?.name ?? "missing-user"}
        <span>
          {props.dashboardHome?.profile?.title ?? "missing-dashboard"}
        </span>
      </div>
    ),
  ),
}));

vi.mock("@/features/dashboards/role-home-loader", () => ({
  loadRoleHomeDashboard: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("console route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadRoleHomeDashboard).mockResolvedValue({
      profile: {
        role: "ops_manager",
        title: "项目推进看板",
        subtitle: "关注招募、录屏、排班、报数和异常卡点",
        scopeLabel: "授权项目",
      },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      generatedAt: "2026-06-16T09:30:00.000Z",
    });
  });

  it("passes the authenticated staff identity and dashboardHome into the ops UI", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ops",
      email: "alice@example.test",
      name: "Alice Ops",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "ops_manager",
    });

    render(await ConsolePage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Alice Ops",
    );
    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "项目推进看板",
    );
    expect(loadRoleHomeDashboard).toHaveBeenCalledWith({
      supabase,
      auth: expect.objectContaining({
        userId: "user-ops",
        role: "ops_manager",
      }),
    });
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "warroom",
        dashboardHome: expect.objectContaining({
          profile: expect.objectContaining({ title: "项目推进看板" }),
        }),
        currentUser: expect.objectContaining({
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }),
        organizationSettings: expect.objectContaining({
          name: "Demo Org",
        }),
      }),
      undefined,
    );
  });

  it("falls back to the legacy war room when dashboard loading fails", async () => {
    const supabase = {};
    const dashboardError = new Error("dashboard unavailable");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ops",
      email: "alice@example.test",
      name: "Alice Ops",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "ops_manager",
    });
    vi.mocked(loadRoleHomeDashboard).mockRejectedValue(dashboardError);

    try {
      render(await ConsolePage());

      expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
        "Alice Ops",
      );
      expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
        "missing-dashboard",
      );
      expect(OpsReferenceApp).toHaveBeenCalledWith(
        expect.objectContaining({
          initialRoute: "warroom",
          dashboardHome: null,
          currentUser: expect.objectContaining({
            id: "user-ops",
            role: "ops_manager",
          }),
        }),
        undefined,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load role dashboard",
        dashboardError,
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("redirects unauthenticated visitors to login", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(Promise.resolve().then(() => ConsolePage())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(loadRoleHomeDashboard).not.toHaveBeenCalled();
  });
});
