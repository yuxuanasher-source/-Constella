import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePlatformPlan } from "@/features/platform-admin/platform-admin-billing-service";

import { getPlatformAdminRouteContext } from "../../route-context";
import { PATCH } from "./route";

vi.mock("../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-billing-service", () => ({
  updatePlatformPlan: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: {},
  mutationRepo: {},
  billingRepo: { repo: "billing-admin" },
};

describe("platform-admin plan route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(updatePlatformPlan).mockResolvedValue({ id: "plan-1" } as never);
  });

  it("updates metadata but rejects code mutation by schema", async () => {
    const response = await PATCH(
      new Request("https://example.cn/api/platform-admin/plans/plan-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "专业协作版",
          included: { seats: 20 },
          expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
          reason: "套餐调整",
          idempotencyKey: "plan-update-1",
        }),
      }),
      { params: Promise.resolve({ planId: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updatePlatformPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "plan-1",
        repo: context.billingRepo,
      }),
    );
  });
});
