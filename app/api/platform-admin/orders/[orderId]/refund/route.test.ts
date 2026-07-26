import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPaymentProvider } from "@/features/billing/providers/registry";
import { PlatformAdminProviderUnavailableError } from "@/features/platform-admin/platform-admin-errors";
import { refundPlatformOrder } from "@/features/platform-admin/platform-admin-payment-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { POST } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/billing/providers/registry", () => ({
  getPaymentProvider: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-payment-service", () => ({
  refundPlatformOrder: vi.fn(),
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

describe("platform-admin refund route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(getPaymentProvider).mockReturnValue({ name: "offline" } as never);
    vi.mocked(refundPlatformOrder).mockResolvedValue({
      orderId: "order-1",
      transactionId: "txn-refund",
      status: "refunded",
      appliedSubscriptionStatus: "cancelled",
      traceId: "trace-refund",
    });
  });

  it("delegates a governed full refund", async () => {
    const command = {
      amountCents: 29900,
      refundExternalReference: "BANK-REFUND-001",
      reason: "客户取消",
      idempotencyKey: "refund-1",
    };
    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/orders/order-1/refund",
        { method: "POST", body: JSON.stringify(command) },
      ),
      { params: Promise.resolve({ orderId: "order-1" }) },
    );

    expect(response.status).toBe(200);
    expect(refundPlatformOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: context.paymentRepo,
        actor: context.actor,
        orderId: "order-1",
        command,
        providerResolver: expect.any(Function),
      }),
    );
  });

  it("maps provider configuration failures to 503", async () => {
    vi.mocked(refundPlatformOrder).mockRejectedValue(
      new PlatformAdminProviderUnavailableError("provider missing"),
    );
    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/orders/order-1/refund",
        {
          method: "POST",
          body: JSON.stringify({
            amountCents: 29900,
            refundExternalReference: "BANK-REFUND-001",
            reason: "客户取消",
            idempotencyKey: "refund-1",
          }),
        },
      ),
      { params: Promise.resolve({ orderId: "order-1" }) },
    );

    expect(response.status).toBe(503);
  });
});
