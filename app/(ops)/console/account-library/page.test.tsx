import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listPlatformAccounts } from "@/features/account-library/account-library-queries";
import { toPlatformAccountDtos } from "@/features/account-library/account-library-ui-adapters";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import {
  currentUserFromAuth,
  loadConsoleDashboardHome,
  organizationSettingsFromAuth,
  requireConsoleStaffAuth,
} from "../console-auth";
import AccountLibraryPage from "./page";

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn(() => <div data-testid="ops-reference-app" />),
}));

vi.mock("@/components/account-library/account-library-shell", () => ({
  AccountLibraryShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="legacy-account-library-shell">{children}</div>
  ),
}));

vi.mock("@/components/account-library/account-library-panel", () => ({
  AccountLibraryPanel: () => <div>legacy account panel</div>,
}));

vi.mock("@/features/account-library/account-library-queries", () => ({
  listPlatformAccounts: vi.fn(),
}));

vi.mock("@/features/account-library/account-library-service", () => ({
  canManageAccounts: vi.fn(() => true),
}));

vi.mock("@/features/account-library/account-library-ui-adapters", () => ({
  toPlatformAccountDtos: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/notify/unread-count", () => ({
  getUnreadNotificationCount: vi.fn(() => Promise.resolve(0)),
}));

vi.mock("@/lib/rbac/roles", () => ({
  isMcnStaff: vi.fn(() => true),
}));

vi.mock("../console-auth", () => ({
  currentUserFromAuth: vi.fn(),
  loadConsoleDashboardHome: vi.fn(),
  organizationSettingsFromAuth: vi.fn(),
  requireConsoleStaffAuth: vi.fn(),
}));

describe("account library console route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const supabase = { source: "test-supabase" };
    const auth = {
      userId: "user-ops",
      email: "ops@example.test",
      name: "Alice Ops",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "ops_manager",
    };
    const accountDtos = [
      {
        id: "account-1",
        platform: "抖音",
        accountUid: "douyin-1",
      },
    ];
    const dashboardHome = {
      profile: { role: "ops_manager", title: "运营看板" },
      kpis: [],
      queue: [],
      risks: [],
      drilldowns: [],
      generatedAt: "2026-07-29T00:00:00.000Z",
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth as never);
    vi.mocked(requireConsoleStaffAuth).mockResolvedValue({
      supabase,
      auth,
    } as never);
    vi.mocked(listPlatformAccounts).mockResolvedValue([
      { id: "account-1" },
    ] as never);
    vi.mocked(toPlatformAccountDtos).mockReturnValue(accountDtos as never);
    vi.mocked(loadConsoleDashboardHome).mockResolvedValue(
      dashboardHome as never,
    );
    vi.mocked(currentUserFromAuth).mockReturnValue({
      id: "user-ops",
      name: "Alice Ops",
      role: "ops_manager",
      org: "Demo Org",
    } as never);
    vi.mocked(organizationSettingsFromAuth).mockReturnValue({
      name: "Demo Org",
    });
  });

  it("preloads the account library into the shared ops app shell", async () => {
    render(await AccountLibraryPage());

    expect(screen.getByTestId("ops-reference-app")).toBeInTheDocument();
    expect(
      screen.queryByTestId("legacy-account-library-shell"),
    ).not.toBeInTheDocument();
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "account-library",
        accountLibraryAccounts: [
          expect.objectContaining({ id: "account-1" }),
        ],
        currentUser: expect.objectContaining({
          id: "user-ops",
          role: "ops_manager",
        }),
        organizationSettings: { name: "Demo Org" },
        dashboardHome: expect.objectContaining({
          profile: expect.objectContaining({ title: "运营看板" }),
        }),
      }),
      undefined,
    );
  });
});
