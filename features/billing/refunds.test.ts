import { describe, expect, it } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import type { BillingRepo, NewOrderInput } from "./billing-repo";
import {
  TEST_ACTOR,
  TEST_PAYMENT_WEBHOOK_SECRET,
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "./billing-test-fixtures";
import { createMockPaymentProvider } from "./providers/mock-provider";
import {
  assertRefundable,
  requestRefund,
  requestRefundCore,
} from "./refunds";

const NOW = new Date("2026-06-20T00:00:00.000Z");
const PAID_AT = "2026-06-16T00:00:00.000Z";
const provider = createMockPaymentProvider({
  secret: TEST_PAYMENT_WEBHOOK_SECRET,
});

async function seedPaidOrder(repo: BillingRepo, input: Partial<NewOrderInput>) {
  const id = input.id ?? "order-1";
  await repo.insertOrder({
    id,
    organizationId: "org-1",
    kind: input.kind ?? "subscription_new",
    amountCents: input.amountCents ?? 99900,
    currency: "CNY",
    target: input.target ?? {},
    planId: input.planId ?? null,
    billingCycle: input.billingCycle ?? "monthly",
    idempotencyKey: input.idempotencyKey ?? id,
    createdBy: "user-owner",
  });
  await repo.updateOrder(id, { status: "paid", paidAt: PAID_AT });
  await repo.insertTransaction({
    organizationId: "org-1",
    orderId: id,
    type: "payment",
    status: "succeeded",
    amountCents: input.amountCents ?? 99900,
    provider: "mock",
    providerTxnId: `mock_pay_${id}`,
    succeededAt: PAID_AT,
  });
  return id;
}

function setup() {
  return createMemoryBillingRepo({
    plans: TEST_PLANS,
    prices: TEST_PRICES,
    subscription: makeSubscription({
      organizationId: "org-1",
      planId: "plan_pro",
      status: "active",
    }),
  });
}

describe("requestRefund", () => {
  it("exposes an actor-independent core scoped to an explicit organization", async () => {
    const { repo, state } = setup();
    await seedPaidOrder(repo, {
      id: "order-core",
      kind: "subscription_new",
      planId: "plan_pro",
    });

    const result = await requestRefundCore({
      repo,
      provider,
      organizationId: "org-1",
      orderId: "order-core",
      amountCents: 99900,
      reason: "平台审核退款",
      now: NOW,
    });

    expect(result.status).toBe("refunded");
    expect(state.orders.get("order-core")?.status).toBe("refunded");
  });

  it("cancels the subscription and downgrades to free on subscription refund", async () => {
    const { repo, state } = setup();
    await seedPaidOrder(repo, { id: "order-sub", kind: "subscription_new", planId: "plan_pro" });

    const result = await requestRefund({
      repo,
      provider,
      actor: TEST_ACTOR,
      orderId: "order-sub",
      reason: "客户取消",
      now: NOW,
    });

    expect(result.status).toBe("refunded");
    expect(state.orders.get("order-sub")?.status).toBe("refunded");
    expect(state.subscriptions.get("org-1")).toMatchObject({
      status: "cancelled",
      planId: "plan_free",
    });
  });

  it("claws back an unused usage add-on", async () => {
    const { repo, state } = setup();
    await repo.upsertUsageCounter({
      organizationId: "org-1",
      metric: "ocr",
      periodMonth: "2026-06-01",
      includedQuantity: 5000,
    });
    await repo.upsertUsageCounter({
      organizationId: "org-1",
      metric: "ocr",
      periodMonth: "2026-06-01",
      addonQuantityDelta: 1000,
    });
    await seedPaidOrder(repo, {
      id: "order-addon",
      kind: "usage_addon",
      amountCents: 10000,
      target: { metric: "ocr", quantity: 1000 },
    });

    await requestRefund({
      repo,
      provider,
      actor: TEST_ACTOR,
      orderId: "order-addon",
      reason: "误购",
      now: NOW,
    });

    expect(state.usageCounters.get("org-1:ocr:2026-06-01")?.addonQuantity).toBe(0);
    expect(state.orders.get("order-addon")?.status).toBe("refunded");
  });

  it("rejects refunding a consumed usage add-on", async () => {
    const { repo, state } = setup();
    // add-on credits already partly consumed (used 5500 > included 5000)
    state.usageCounters.set("org-1:ocr:2026-06-01", {
      includedQuantity: 5000,
      addonQuantity: 1000,
      usedQuantity: 5500,
    });
    const orderId = await seedPaidOrder(repo, {
      id: "order-addon",
      kind: "usage_addon",
      amountCents: 10000,
      target: { metric: "ocr", quantity: 1000 },
    });
    const order = await repo.getOrderById(orderId);

    await expect(
      assertRefundable({ repo, order: order!, now: NOW }),
    ).rejects.toThrow(/already consumed/);
    await expect(
      requestRefund({
        repo,
        provider,
        actor: TEST_ACTOR,
        orderId,
        reason: "误购",
        now: NOW,
      }),
    ).rejects.toThrow(/already consumed/);
  });

  it("disables a feature add-on on refund", async () => {
    const { repo, state } = setup();
    await repo.upsertFeatureAddon({
      organizationId: "org-1",
      featureKey: "war_room",
      amountCents: 50000,
      enabled: true,
      periodStart: "2026-06-01",
      periodEnd: "2026-07-01",
    });
    await seedPaidOrder(repo, {
      id: "order-feature",
      kind: "feature_addon",
      amountCents: 50000,
      target: { featureKey: "war_room" },
    });

    await requestRefund({
      repo,
      provider,
      actor: TEST_ACTOR,
      orderId: "order-feature",
      reason: "不需要了",
      now: NOW,
    });

    expect(state.featureAddons.get("org-1:war_room")).toEqual({
      featureKey: "war_room",
      enabled: false,
    });
  });

  it("requires a reason and a paid order", async () => {
    const { repo } = setup();
    await seedPaidOrder(repo, { id: "order-x", planId: "plan_pro" });

    await expect(
      requestRefund({ repo, provider, actor: TEST_ACTOR, orderId: "order-x", reason: " ", now: NOW }),
    ).rejects.toThrow(/reason/);

    await repo.insertOrder({
      id: "order-pending",
      organizationId: "org-1",
      kind: "subscription_new",
      amountCents: 99900,
      currency: "CNY",
      target: {},
      idempotencyKey: "pending",
      createdBy: "user-owner",
    });
    await expect(
      requestRefund({
        repo,
        provider,
        actor: TEST_ACTOR,
        orderId: "order-pending",
        reason: "x",
        now: NOW,
      }),
    ).rejects.toThrow(/paid/);
  });

  it("requires a succeeded payment transaction", async () => {
    const { repo } = setup();
    await repo.insertOrder({
      id: "order-failed-payment",
      organizationId: "org-1",
      kind: "subscription_new",
      amountCents: 99900,
      currency: "CNY",
      target: {},
      planId: "plan_pro",
      billingCycle: "monthly",
      idempotencyKey: "failed-payment",
      createdBy: "user-owner",
    });
    await repo.updateOrder("order-failed-payment", {
      status: "paid",
      paidAt: PAID_AT,
    });
    await repo.insertTransaction({
      organizationId: "org-1",
      orderId: "order-failed-payment",
      type: "payment",
      status: "failed",
      amountCents: 99900,
      provider: "mock",
      providerTxnId: "mock_failed_payment",
    });

    await expect(
      requestRefundCore({
        repo,
        provider,
        organizationId: "org-1",
        orderId: "order-failed-payment",
        amountCents: 99900,
        reason: "退款",
        now: NOW,
      }),
    ).rejects.toThrow(/settled payment/);
  });
});
