import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpsShell } from "@/components/layouts/ops-shell";
import { ConsoleAiWorkbench } from "@/components/console/ai-workbench";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import AiConsolePage from "./page";
import { loadConsoleDashboardHome } from "../console-auth";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/layouts/ops-shell", () => ({
  OpsShell: vi.fn(
    ({
      children,
      activeHref,
      unreadCount,
    }: {
      children: React.ReactNode;
      activeHref?: string;
      unreadCount: number;
    }) => (
      <div data-active-href={activeHref} data-testid="ops-shell">
        <span>unread:{unreadCount}</span>
        {children}
      </div>
    ),
  ),
}));

vi.mock("@/components/console/ai-workbench", () => ({
  ConsoleAiWorkbench: vi.fn(
    ({
      currentUser,
      dashboardHome,
      dashboardHomeError,
    }: {
      currentUser?: { name?: string };
      dashboardHome?: { profile?: { title?: string } } | null;
      dashboardHomeError?: string | null;
    }) => (
      <div data-testid="ai-workbench">
        <span>{currentUser?.name ?? "missing-user"}</span>
        <span>{dashboardHome?.profile?.title ?? "missing-dashboard"}</span>
        <span>error:{dashboardHomeError ?? "null"}</span>
      </div>
    ),
  ),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("../console-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../console-auth")>();
  return {
    ...actual,
    loadConsoleDashboardHome: vi.fn(),
  };
});

describe("console ai route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConsoleDashboardHome).mockResolvedValue({
      profile: {
        role: "owner",
        title: "经营指挥盘",
        subtitle: "真实业务上下文",
        scopeLabel: "全组织",
      },
      kpis: [],
      queue: [],
      risks: [{ key: "risk-1", title: "高风险项目", subtitle: "", tone: "red", target: { route: "projects" } }],
      drilldowns: [],
      generatedAt: "2026-07-20T01:00:00.000Z",
    });
  });

  it("renders a shell route for the AI workbench without ops-reference", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ai",
      email: "ai@example.test",
      name: "AI Operator",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });

    render(await AiConsolePage());

    expect(screen.getByTestId("ops-shell")).toHaveAttribute(
      "data-active-href",
      "/console/ai",
    );
    expect(screen.getByTestId("ops-shell")).toHaveTextContent("unread:1");
    expect(screen.getByTestId("ai-workbench")).toHaveTextContent("AI Operator");
    expect(screen.getByTestId("ai-workbench")).toHaveTextContent("经营指挥盘");
    expect(screen.getByTestId("ai-workbench")).toHaveTextContent("error:null");
    expect(OpsShell).toHaveBeenCalledWith(
      expect.objectContaining({
        activeHref: "/console/ai",
        unreadCount: 1,
      }),
      undefined,
    );
    expect(ConsoleAiWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUser: expect.objectContaining({
          id: "user-ai",
          name: "AI Operator",
          role: "owner",
        }),
        dashboardHome: expect.objectContaining({
          profile: expect.objectContaining({ title: "经营指挥盘" }),
        }),
        dashboardHomeError: null,
      }),
      undefined,
    );
    expect(loadConsoleDashboardHome).toHaveBeenCalledWith(supabase, {
      userId: "user-ai",
      email: "ai@example.test",
      name: "AI Operator",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
  });

  it("keeps the workbench visibly degraded when dashboard loading returns null", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ai",
      email: "ai@example.test",
      name: "AI Operator",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(loadConsoleDashboardHome).mockResolvedValue(null);

    render(await AiConsolePage());

    expect(screen.getByTestId("ai-workbench")).toHaveTextContent(
      "missing-dashboard",
    );
    expect(screen.getByTestId("ai-workbench")).toHaveTextContent(
      "error:AI 上下文暂不可用",
    );
  });

  it("keeps the workbench available when dashboard loading throws", async () => {
    const dashboardError = new Error("dashboard offline");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-ai",
      email: "ai@example.test",
      name: "AI Operator",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(loadConsoleDashboardHome).mockRejectedValue(dashboardError);

    try {
      render(await AiConsolePage());

      expect(screen.getByTestId("ai-workbench")).toHaveTextContent(
        "missing-dashboard",
      );
      expect(screen.getByTestId("ai-workbench")).toHaveTextContent(
        "error:AI 上下文暂不可用",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to load AI workbench dashboard",
        dashboardError,
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
