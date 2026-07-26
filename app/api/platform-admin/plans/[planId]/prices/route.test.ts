import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlatformPriceVersion } from "@/features/platform-admin/platform-admin-billing-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { POST } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-billing-service", () => ({
  createPlatformPriceVersion: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: {},
  mutationRepo: {},
  billingRepo: { repo: "billing-admin" },
};

describe("platform-admin plan prices route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(createPlatformPriceVersion).mockResolvedValue({
      id: "price-new",
    } as never);
  });

  it("creates an immutable price version", async () => {
    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/plans/plan-1/prices",
        {
          method: "POST",
          body: JSON.stringify({
            billingCycle: "monthly",
            priceCents: 12900,
            currency: "CNY",
            effectiveFrom: "2026-08-01T00:00:00.000Z",
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "价格升级",
            idempotencyKey: "price-1",
          }),
        },
      ),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );

    expect(response.status).toBe(201);
    expect(createPlatformPriceVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        repo: context.billingRepo,
      }),
    );
  });
});
