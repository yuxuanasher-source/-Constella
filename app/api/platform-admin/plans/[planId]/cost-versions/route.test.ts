import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlatformCostVersion } from "@/features/platform-admin/platform-admin-billing-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { POST } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-billing-service", () => ({
  createPlatformCostVersion: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: {},
  mutationRepo: {},
  billingRepo: { repo: "billing-admin" },
};

describe("platform-admin cost versions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(createPlatformCostVersion).mockResolvedValue({
      id: "cost-new",
    } as never);
  });

  it("creates a governed cost version", async () => {
    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/plans/plan-1/cost-versions",
        {
          method: "POST",
          body: JSON.stringify({
            effectiveFrom: "2026-08-01T00:00:00.000Z",
            effectiveTo: null,
            fixedCostCents: 1000,
            perSeatCostCents: 100,
            perActiveStreamerCostCents: 200,
            metricUnitCosts: { ocr: 2 },
            expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
            reason: "更新标准成本",
            idempotencyKey: "cost-1",
          }),
        },
      ),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );

    expect(response.status).toBe(201);
    expect(createPlatformCostVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        repo: context.billingRepo,
      }),
    );
  });
});
