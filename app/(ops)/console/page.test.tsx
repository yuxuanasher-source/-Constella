import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { loadRoleHomeDashboard } from "@/features/dashboards/role-home-loader";
import type { PublishedOrganizationBrand } from "@/features/organizations/organization-brand";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { organizationSettingsFromAuth } from "./console-auth";
import ConsolePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn(
    (props: {
      initialRoute?: string;
      currentUser?: { name?: string };
      dashboardHome?: { profile?: { title?: string } } | null;
      dashboardHomeError?: string | null;
    }) => (
      <div data-testid="ops-reference-app">
        <span>{props.currentUser?.name ?? "missing-user"}</span>
        <span>initialRoute: {props.initialRoute ?? "missing-route"}</span>
        <span>
          {props.dashboardHome?.profile?.title ?? "missing-dashboard"}
        </span>
        <span>dashboardHomeError: {props.dashboardHomeError ?? "null"}</span>
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

  afterEach(() => {
    vi.unstubAllEnvs();
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
      organizationBranding: {
        schemaVersion: 1,
        version: 3,
        logoText: "DEMO",
        logoStoragePath: null,
        brandName: "Demo Console",
        brandTagline: "Make work visible",
        primaryColor: "#123456",
        actionColor: "#123456",
        softColor: "#E3E7EB",
        publishedAt: "2026-08-01T00:00:00.000Z",
        semantic: {
          success: "#00B42A",
          warning: "#FF7D00",
          danger: "#F53F3F",
          info: "#165DFF",
        },
      },
      role: "ops_manager",
    });

    render(await ConsolePage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Alice Ops",
    );
    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "initialRoute: home",
    );
    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "项目推进看板",
    );
    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "dashboardHomeError: null",
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
        initialRoute: "home",
        dashboardHome: expect.objectContaining({
          profile: expect.objectContaining({ title: "项目推进看板" }),
        }),
        dashboardHomeError: null,
        currentUser: expect.objectContaining({
          id: "user-ops",
          name: "Alice Ops",
          role: "ops_manager",
          dept: "Demo Org",
        }),
        organizationSettings: expect.objectContaining({
          name: "Demo Org",
          brand: expect.objectContaining({
            schemaVersion: 1,
            version: 3,
            primaryColor: "#123456",
          }),
          logoText: "DEMO",
          brandName: "Demo Console",
          brandTagline: "Make work visible",
          primaryColor: "#123456",
          logoStoragePath: null,
        }),
      }),
      undefined,
    );
  });

  it("passes a visible dashboard error when dashboard loading fails", async () => {
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
        "initialRoute: home",
      );
      expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
        "missing-dashboard",
      );
      expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
        "dashboardHomeError: 角色看板暂不可用",
      );
      expect(OpsReferenceApp).toHaveBeenCalledWith(
        expect.objectContaining({
          initialRoute: "home",
          dashboardHome: null,
          dashboardHomeError: "角色看板暂不可用",
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

  it("renders the v2 ops shell when the feature flag is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPS_UI_V2", "true");
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

    expect(
      screen.getByRole("heading", { name: "经营总览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Demo Org")).toBeInTheDocument();
    expect(OpsReferenceApp).not.toHaveBeenCalled();
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

describe("organizationSettingsFromAuth", () => {
  it("preserves the canonical brand and projects only compatibility fields", () => {
    const brand: PublishedOrganizationBrand = {
      schemaVersion: 1,
      version: 4,
      logoText: "北辰",
      logoStoragePath:
        "11111111-1111-4111-8111-111111111111/brand-logos/33333333-3333-4333-8333-333333333333.webp",
      brandName: "北辰经营舱",
      brandTagline: "稳健增长",
      primaryColor: "#123456",
      actionColor: "#123456",
      softColor: "#E3E7EB",
      publishedAt: "2026-08-01T00:00:00.000Z",
      semantic: {
        success: "#00B42A",
        warning: "#FF7D00",
        danger: "#F53F3F",
        info: "#165DFF",
      },
    };
    const auth: AuthContext = {
      userId: "user-current",
      email: "current@example.test",
      name: "Current Owner",
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "北辰机构",
      organizationBranding: brand,
      role: "owner",
    };

    const settings = organizationSettingsFromAuth(auth);

    expect(settings.brand).toBe(brand);
    expect(settings).toEqual({
      name: "北辰机构",
      brand,
      logoText: "北辰",
      brandName: "北辰经营舱",
      brandTagline: "稳健增长",
      primaryColor: "#123456",
      logoStoragePath:
        "11111111-1111-4111-8111-111111111111/brand-logos/33333333-3333-4333-8333-333333333333.webp",
    });
  });
});
