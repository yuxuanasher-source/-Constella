import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelPlatformOrder } from "@/features/platform-admin/platform-admin-payment-service";

import { getPlatformAdminRouteContext } from "../../route-context";
import { PATCH } from "./route";

vi.mock("../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-payment-service", () => ({
  cancelPlatformOrder: vi.fn(),
}));

const context = {
  ok: true as const,
  actor: { userId: "admin-user", role: "super_admin" as const },
  admin: {},
  repo: {},
  mutationRepo: {},
  billingRepo: {},
  paymentRepo: { repo: "payment-admin" },
};

describe("platform-admin order route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(cancelPlatformOrder).mockResolvedValue({
      id: "order-1",
      status: "cancelled",
    } as never);
  });

  it("cancels a pending order with optimistic concurrency", async () => {
    const command = {
      action: "cancel",
      expectedUpdatedAt: "2026-07-26T08:00:00.000Z",
      reason: "重复订单",
      idempotencyKey: "cancel-order-1",
    };
    const response = await PATCH(
      new Request("https://example.cn/api/platform-admin/orders/order-1", {
        method: "PATCH",
        body: JSON.stringify(command),
      }),
      { params: Promise.resolve({ orderId: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(cancelPlatformOrder).toHaveBeenCalledWith({
      repo: context.paymentRepo,
      actor: context.actor,
      orderId: "order-1",
      command: {
        expectedUpdatedAt: command.expectedUpdatedAt,
        reason: command.reason,
        idempotencyKey: command.idempotencyKey,
      },
    });
  });
});
