import { beforeEach, describe, expect, it, vi } from "vitest";

import { changePlatformSubscription } from "@/features/platform-admin/platform-admin-billing-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { PATCH } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-billing-service", () => ({
  changePlatformSubscription: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: {},
  mutationRepo: {},
  billingRepo: { repo: "billing-admin" },
};

describe("platform-admin subscription route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(changePlatformSubscription).mockResolvedValue({
      preview: { targetPlan: "专业版" },
      applied: null,
    } as never);
  });

  it("returns a preview without applying", async () => {
    const command = {
      action: "change_plan",
      targetPlanId: "11111111-1111-4111-8111-111111111111",
      targetBillingCycle: "annual",
      timing: "next_cycle",
      expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
      reason: "客户升级",
      idempotencyKey: "subscription-change-1",
    };
    const response = await PATCH(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1/subscription",
        {
          method: "PATCH",
          body: JSON.stringify({ mode: "preview", command }),
        },
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(200);
    expect(changePlatformSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.billingRepo,
        actor: context.actor,
        organizationId: "org-1",
        mode: "preview",
        command,
      }),
    );
  });
});
