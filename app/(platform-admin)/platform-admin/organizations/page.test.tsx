import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPlatformOrganizationDetail,
  listPlatformOrganizations,
  listPlatformPlans,
  loadPlatformOverview,
} from "@/features/platform-admin/platform-admin-read-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import { requirePlatformAdminPage } from "../platform-admin-auth";
import OrganizationsPage from "./page";

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  getPlatformOrganizationDetail: vi.fn(),
  listPlatformOrganizations: vi.fn(),
  listPlatformPlans: vi.fn(),
  loadPlatformOverview: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../platform-admin-auth", () => ({
  requirePlatformAdminPage: vi.fn(),
}));

describe("platform-admin organizations page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformAdminPage).mockResolvedValue({
      userId: "admin-user",
      email: "admin@example.com",
      name: "平台管理员",
      role: "super_admin",
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
    vi.mocked(loadPlatformOverview).mockResolvedValue({
      period: { start: "2026-07-01", end: "2026-07-31" },
      organizationCount: 0,
      payingOrganizationCount: 0,
      successfulOrderCount: 0,
      netRevenueCents: 0,
      forecastRevenueCents: 0,
      arpCents: 0,
      computableContributionMarginCents: 0,
      costCoverage: { covered: 0, total: 0 },
      expiry: { expired: 0, within7Days: 0, within30Days: 0 },
    });
    vi.mocked(listPlatformOrganizations).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    vi.mocked(listPlatformPlans).mockResolvedValue([]);
    vi.mocked(getPlatformOrganizationDetail).mockResolvedValue(null as never);
  });

  it("renders the authenticated organization control workspace", async () => {
    render(await OrganizationsPage());

    expect(screen.getByText("平台管理后台")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "组织与订阅" }),
    ).toBeInTheDocument();
    expect(screen.getByText("尚无组织")).toBeInTheDocument();
  });
});
