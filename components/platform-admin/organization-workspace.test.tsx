import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrganizationPageDto,
  PlatformOrganizationDetailDto,
  PlatformOverviewDto,
} from "@/features/platform-admin/platform-admin-contracts";

import { OrganizationWorkspace } from "./organization-workspace";

const overview: PlatformOverviewDto = {
  period: { start: "2026-07-01", end: "2026-07-31" },
  organizationCount: 2,
  payingOrganizationCount: 1,
  successfulOrderCount: 2,
  netRevenueCents: 128000,
  forecastRevenueCents: 158000,
  arpCents: 64000,
  computableContributionMarginCents: 46000,
  costCoverage: { covered: 1, total: 2 },
  expiry: { expired: 0, within7Days: 1, within30Days: 1 },
};

const organizationPage: OrganizationPageDto = {
  items: [
    {
      id: "org-a",
      name: "安澜传媒",
      code: "anlan",
      lifecycleStatus: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      memberCount: 2,
      primaryAccount: {
        status: "confirmed",
        userId: "user-owner",
        email: "owner@anlan.cn",
        name: "安澜负责人",
        assignmentSource: "signup",
        confirmedAt: "2026-01-01T00:00:00.000Z",
      },
      subscription: {
        id: "sub-a",
        status: "active",
        billingCycle: "monthly",
        currentPeriodStart: "2026-07-01",
        currentPeriodEnd: "2026-08-01",
        plan: { id: "plan-pro", code: "pro", name: "专业版" },
      },
      metrics: {
        netRevenueCents: 88000,
        costCents: null,
        contributionMarginCents: null,
      },
    },
    {
      id: "org-b",
      name: "北辰工作室",
      code: "beichen",
      lifecycleStatus: "frozen",
      createdAt: "2026-02-01T00:00:00.000Z",
      memberCount: 1,
      primaryAccount: {
        status: "pending",
        userId: null,
        email: null,
        name: null,
      },
      subscription: null,
      metrics: {
        netRevenueCents: 40000,
        costCents: 20000,
        contributionMarginCents: 20000,
      },
    },
  ],
  meta: { page: 1, pageSize: 20, total: 2 },
};

const initialDetail: PlatformOrganizationDetailDto = {
  ...organizationPage.items[0],
  members: [
    {
      membershipId: "member-owner",
      organizationId: "org-a",
      organizationName: "安澜传媒",
      userId: "user-owner",
      email: "owner@anlan.cn",
      name: "安澜负责人",
      role: "owner",
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      isPrimaryAccount: true,
    },
    {
      membershipId: "member-ops",
      organizationId: "org-a",
      organizationName: "安澜传媒",
      userId: "user-ops",
      email: "ops@anlan.cn",
      name: "运营一号",
      role: "operator",
      status: "active",
      joinedAt: "2026-01-02T00:00:00.000Z",
      isPrimaryAccount: false,
    },
  ],
  recentOrders: [],
};

describe("OrganizationWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            ...organizationPage.items[1],
            members: [],
            recentOrders: [],
          },
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the organization list and fixed detail pane in sync", async () => {
    render(
      <OrganizationWorkspace
        overview={overview}
        initialPage={organizationPage}
        initialDetail={initialDetail}
      />,
    );

    expect(
      screen.getByRole("button", { name: /安澜传媒/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /北辰工作室/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("主账号")).toBeInTheDocument();
    expect(screen.getByText("子账号")).toBeInTheDocument();
    expect(screen.getAllByText("实收").length).toBeGreaterThan(0);
    expect(screen.getAllByText("预测").length).toBeGreaterThan(0);
    expect(screen.getAllByText("标准估算").length).toBeGreaterThan(0);
    expect(screen.getByText("成本未配置")).toBeInTheDocument();
    expect(screen.getByLabelText("选择组织")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /北辰工作室/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "北辰工作室" }),
      ).toBeInTheDocument();
    });
  });
});
