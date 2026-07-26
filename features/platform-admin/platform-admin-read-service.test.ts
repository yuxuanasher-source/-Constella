import { describe, expect, it, vi } from "vitest";

import type { PlatformAdminRepository } from "./platform-admin-repository";
import {
  getPlatformOrganizationDetail,
  listPlatformOrganizations,
  loadPlatformOverview,
  PlatformAdminNotFoundError,
} from "./platform-admin-read-service";

const period = { start: "2026-07-01", end: "2026-07-31" };

function createRepository(
  overrides: Partial<PlatformAdminRepository> = {},
): PlatformAdminRepository {
  return {
    listOrganizations: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })),
    getOrganizationDetail: vi.fn(async () => null),
    listUsers: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })),
    listPlans: vi.fn(async () => []),
    listOrders: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })),
    listAudit: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })),
    loadOverviewSource: vi.fn(async () => ({
      organizations: [],
      transactions: [],
      organizationCosts: [],
      forecastRevenueCents: 0,
      subscriptionPeriodEnds: [],
      today: "2026-07-25",
    })),
    ...overrides,
  };
}

describe("loadPlatformOverview", () => {
  it("calculates cost coverage without treating missing costs as zero", async () => {
    const repo = createRepository({
      loadOverviewSource: vi.fn(async () => ({
        organizations: [
          { id: "a", lifecycleStatus: "active" as const },
          { id: "b", lifecycleStatus: "frozen" as const },
        ],
        transactions: [
          {
            organizationId: "a",
            orderId: "order-1",
            type: "payment" as const,
            status: "succeeded" as const,
            amountCents: 10000,
          },
        ],
        organizationCosts: [
          { organizationId: "a", costCents: 2500, complete: true },
        ],
        forecastRevenueCents: 16000,
        subscriptionPeriodEnds: ["2026-07-28"],
        today: "2026-07-25",
      })),
    });

    await expect(loadPlatformOverview({ repo, period })).resolves.toEqual({
      period,
      organizationCount: 2,
      payingOrganizationCount: 1,
      successfulOrderCount: 1,
      netRevenueCents: 10000,
      forecastRevenueCents: 16000,
      arpCents: 5000,
      computableContributionMarginCents: 7500,
      costCoverage: { covered: 1, total: 2 },
      expiry: { expired: 0, within7Days: 1, within30Days: 0 },
    });
  });
});

describe("listPlatformOrganizations", () => {
  it("normalizes search, caps page size, and sorts by expiry then name", async () => {
    const listOrganizations = vi.fn(async () => ({
      items: [
        {
          id: "org-z",
          name: "知夏传媒",
          code: "zhixia",
          lifecycleStatus: "active" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
          memberCount: 4,
          primaryAccount: null,
          subscription: {
            id: "sub-z",
            status: "active",
            billingCycle: "monthly",
            currentPeriodStart: "2026-07-01",
            currentPeriodEnd: "2026-08-20",
            plan: { id: "plan-pro", code: "pro", name: "专业版" },
          },
          netRevenueCents: 20000,
          cost: null,
        },
        {
          id: "org-b",
          name: "北辰传媒",
          code: "beichen",
          lifecycleStatus: "frozen" as const,
          createdAt: "2026-01-02T00:00:00.000Z",
          memberCount: 2,
          primaryAccount: {
            userId: "user-b",
            email: "owner@beichen.cn",
            name: "北辰管理员",
            assignmentSource: "signup",
            confirmedAt: "2026-01-02T00:00:00.000Z",
          },
          subscription: {
            id: "sub-b",
            status: "active",
            billingCycle: "annual",
            currentPeriodStart: "2026-01-01",
            currentPeriodEnd: "2026-08-01",
            plan: { id: "plan-pro", code: "pro", name: "专业版" },
          },
          netRevenueCents: 30000,
          cost: { costCents: 12000, complete: true },
        },
        {
          id: "org-a",
          name: "安澜传媒",
          code: "anlan",
          lifecycleStatus: "active" as const,
          createdAt: "2026-01-03T00:00:00.000Z",
          memberCount: 3,
          primaryAccount: null,
          subscription: {
            id: "sub-a",
            status: "active",
            billingCycle: "monthly",
            currentPeriodStart: "2026-07-01",
            currentPeriodEnd: "2026-08-01",
            plan: { id: "plan-basic", code: "basic", name: "基础版" },
          },
          netRevenueCents: 9000,
          cost: { costCents: 2000, complete: false },
        },
      ],
      total: 3,
      page: 1,
      pageSize: 100,
    }));
    const repo = createRepository({ listOrganizations });

    const result = await listPlatformOrganizations({
      repo,
      query: {
        search: "  星   耀 ",
        page: 0,
        pageSize: 1000,
        period,
      },
    });

    expect(listOrganizations).toHaveBeenCalledWith({
      search: "星 耀",
      page: 1,
      pageSize: 100,
      period,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      "org-a",
      "org-b",
      "org-z",
    ]);
    expect(result.items[0].primaryAccount).toEqual({
      status: "pending",
      userId: null,
      email: null,
      name: null,
    });
    expect(result.items[0].metrics).toEqual({
      netRevenueCents: 9000,
      costCents: null,
      contributionMarginCents: null,
    });
    expect(result.items[1].metrics).toEqual({
      netRevenueCents: 30000,
      costCents: 12000,
      contributionMarginCents: 18000,
    });
  });
});

describe("getPlatformOrganizationDetail", () => {
  it("throws a typed not-found error for a missing organization", async () => {
    const repo = createRepository();

    await expect(
      getPlatformOrganizationDetail({
        repo,
        organizationId: "missing",
        period,
      }),
    ).rejects.toBeInstanceOf(PlatformAdminNotFoundError);
  });
});
