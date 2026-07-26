import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordPlatformOfflinePayment } from "@/features/platform-admin/platform-admin-payment-service";

import { getPlatformAdminRouteContext } from "../../../route-context";
import { POST } from "./route";

vi.mock("../../../route-context", () => ({
  getPlatformAdminRouteContext: vi.fn(),
}));
vi.mock("@/features/platform-admin/platform-admin-payment-service", () => ({
  recordPlatformOfflinePayment: vi.fn(),
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

describe("platform-admin offline payments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlatformAdminRouteContext).mockResolvedValue(context as never);
    vi.mocked(recordPlatformOfflinePayment).mockResolvedValue({
      orderId: "order-1",
      transactionId: "txn-1",
      status: "paid",
      appliedSubscriptionStatus: "active",
      traceId: "trace-1",
    });
  });

  it("records a complete offline receipt and returns its trace separately", async () => {
    const command = {
      purpose: "subscription_new",
      planId: "11111111-1111-4111-8111-111111111111",
      billingCycle: "monthly",
      amountCents: 29900,
      currency: "CNY",
      receivedAt: "2026-07-26T08:00:00.000Z",
      externalReference: "BANK-001",
      channel: "bank_transfer",
      reason: "对公转账到账",
      idempotencyKey: "offline-1",
    };
    const response = await POST(
      new Request(
        "https://example.cn/api/platform-admin/organizations/org-1/payments",
        { method: "POST", body: JSON.stringify(command) },
      ),
      { params: Promise.resolve({ organizationId: "org-1" }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: {
        orderId: "order-1",
        transactionId: "txn-1",
        status: "paid",
        appliedSubscriptionStatus: "active",
      },
      traceId: "trace-1",
    });
    expect(recordPlatformOfflinePayment).toHaveBeenCalledWith({
      repo: context.paymentRepo,
      actor: context.actor,
      organizationId: "org-1",
      command,
    });
  });
});
