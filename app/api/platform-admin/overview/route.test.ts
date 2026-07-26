import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPlatformOverview } from "@/features/platform-admin/platform-admin-read-service";

import { getPlatformAdminRouteContext } from "../route-context";
import { GET } from "./route";

vi.mock("../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));

vi.mock("@/features/platform-admin/platform-admin-read-service", () => ({
  loadPlatformOverview: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: {
    userId: "admin-user",
    email: "admin@example.com",
    name: "平台管理员",
    role: "super_admin" as const,
  },
  admin: { client: "admin" },
  repo: { repo: "platform" },
};

describe("platform-admin overview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(loadPlatformOverview).mockResolvedValue({
      period: { start: "2026-07-01", end: "2026-07-31" },
      organizationCount: 12,
      payingOrganizationCount: 8,
      successfulOrderCount: 9,
      netRevenueCents: 880000,
      forecastRevenueCents: 960000,
      arpCents: 73333,
      computableContributionMarginCents: 310000,
      costCoverage: { covered: 10, total: 12 },
      expiry: { expired: 1, within7Days: 2, within30Days: 4 },
    });
  });

  it.each([401, 403, 503])(
    "forwards the %s route-context failure",
    async (status) => {
      vi.mocked(getPlatformAdminRouteContext).mockResolvedValue({
        ok: false,
        status,
      } as never);

      const response = await GET(
        new Request("https://example.cn/api/platform-admin/overview"),
      );

      expect(response.status).toBe(status);
      expect(loadPlatformOverview).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid reporting period", async () => {
    const response = await GET(
      new Request(
        "https://example.cn/api/platform-admin/overview?start=2026-08-01&end=2026-07-01",
      ),
    );

    expect(response.status).toBe(400);
    expect(loadPlatformOverview).not.toHaveBeenCalled();
  });

  it("returns the exact overview DTO", async () => {
    const response = await GET(
      new Request(
        "https://example.cn/api/platform-admin/overview?start=2026-07-01&end=2026-07-31",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        period: { start: "2026-07-01", end: "2026-07-31" },
        organizationCount: 12,
        payingOrganizationCount: 8,
        successfulOrderCount: 9,
        netRevenueCents: 880000,
        forecastRevenueCents: 960000,
        arpCents: 73333,
        computableContributionMarginCents: 310000,
        costCoverage: { covered: 10, total: 12 },
        expiry: { expired: 1, within7Days: 2, within30Days: 4 },
      },
    });
    expect(loadPlatformOverview).toHaveBeenCalledWith({
      repo: context.repo,
      period: { start: "2026-07-01", end: "2026-07-31" },
    });
  });
});
