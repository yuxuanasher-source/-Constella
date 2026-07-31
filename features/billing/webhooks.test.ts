import { describe, expect, it, vi } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import type { BillingRepo } from "./billing-repo";
import {
  TEST_PAYMENT_WEBHOOK_SECRET,
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "./billing-test-fixtures";
import {
  buildSignedMockWebhook,
  createMockPaymentProvider,
  type MockWebhookBody,
} from "./providers/mock-provider";
import { handleWebhook } from "./webhooks";

const NOW = new Date("2026-06-16T00:00:00.000Z");
const provider = createMockPaymentProvider({
  secret: TEST_PAYMENT_WEBHOOK_SECRET,
});

async function setupWithPendingOrder() {
  const { repo, state } = createMemoryBillingRepo({
    plans: TEST_PLANS,
    prices: TEST_PRICES,
    subscription: makeSubscription({
      organizationId: "org-1",
      planId: "plan_trial",
      status: "trialing",
    }),
  });
  await repo.insertOrder({
    id: "order-1",
    organizationId: "org-1",
    kind: "subscription_new",
    amountCents: 99900,
    currency: "CNY",
    target: { planCode: "pro", billingCycle: "monthly" },
    planId: "plan_pro",
    billingCycle: "monthly",
    idempotencyKey: "k1",
    provider: "mock",
    createdBy: "user-owner",
  });
  return { repo, state };
}

async function setupWithRefundingFeatureOrder(
  orderProvider: string | null = "mock",
) {
  const { repo, state } = createMemoryBillingRepo({
    plans: TEST_PLANS,
    prices: TEST_PRICES,
    subscription: makeSubscription({
      organizationId: "org-1",
      planId: "plan_pro",
      status: "active",
    }),
  });
  await repo.insertOrder({
    id: "order-1",
    organizationId: "org-1",
    kind: "feature_addon",
    amountCents: 10000,
    currency: "CNY",
    target: { featureKey: "war_room" },
    idempotencyKey: "refund-k1",
    provider: orderProvider,
    createdBy: "user-owner",
  });
  await repo.updateOrder("order-1", {
    status: "refunding",
    paidAt: "2026-06-15T00:00:00.000Z",
  });
  await repo.upsertFeatureAddon({
    organizationId: "org-1",
    featureKey: "war_room",
    amountCents: 10000,
    enabled: true,
    periodStart: "2026-06-01",
    periodEnd: "2026-07-01",
  });
  return { repo, state };
}

function paymentWebhook(overrides: Partial<MockWebhookBody> = {}) {
  return buildSignedMockWebhook(
    {
      eventId: "evt-1",
      type: "payment",
      status: "succeeded",
      providerTxnId: "mock_pay_order-1",
      orderId: "order-1",
      amountCents: 99900,
      ...overrides,
    },
    TEST_PAYMENT_WEBHOOK_SECRET,
  );
}

async function handle(
  repo: BillingRepo,
  payload: { rawBody: string; signature: string },
) {
  return handleWebhook({ repo, provider, ...payload, now: NOW });
}

describe("handleWebhook", () => {
  it("activates the subscription on a verified payment success", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const result = await handle(repo, paymentWebhook());

    expect(result).toMatchObject({ processed: true, orderId: "order-1" });
    expect(state.orders.get("order-1")?.status).toBe("paid");
    expect(state.subscriptions.get("org-1")?.status).toBe("active");
    expect(state.transactions.filter((t) => t.status === "succeeded")).toHaveLength(1);
  });

  it("is idempotent against a replayed event", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const payload = paymentWebhook();
    await handle(repo, payload);
    const second = await handle(repo, payload);

    expect(second).toMatchObject({ processed: false, reason: "duplicate" });
    expect(state.transactions).toHaveLength(1);
  });

  it("only applies once across distinct events for the same order", async () => {
    const { repo, state } = await setupWithPendingOrder();
    await handle(repo, paymentWebhook({ eventId: "evt-1" }));
    const second = await handle(repo, paymentWebhook({ eventId: "evt-2" }));

    expect(second).toMatchObject({ processed: false, reason: "already_paid" });
    expect(state.transactions).toHaveLength(1);
  });

  it("rejects an unverified webhook but records it for replay", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const { rawBody } = paymentWebhook();
    const result = await handleWebhook({
      repo,
      provider,
      rawBody,
      signature: "deadbeef",
      now: NOW,
    });

    expect(result).toMatchObject({ processed: false, reason: "signature_mismatch" });
    expect(state.orders.get("order-1")?.status).toBe("pending");
    const events = [...state.webhookEvents.values()];
    expect(events).toHaveLength(1);
    expect(events[0].signatureVerified).toBe(false);
  });

  it("acks gracefully when the order is missing", async () => {
    const { repo } = await setupWithPendingOrder();
    const result = await handle(repo, paymentWebhook({ orderId: "missing" }));
    expect(result).toMatchObject({ processed: false, reason: "order_not_found" });
  });

  it("marks the order failed on a reported payment failure", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const result = await handle(
      repo,
      paymentWebhook({ status: "failed", amountCents: 1 }),
    );
    expect(result.processed).toBe(true);
    expect(state.orders.get("order-1")?.status).toBe("failed");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");
    expect(state.transactions[0]?.amountCents).toBe(1);
  });

  it("rejects a succeeded payment with an amount mismatch without side effects", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const audit = vi.fn(async () => undefined);

    const result = await handleWebhook({
      repo,
      provider,
      ...paymentWebhook({ amountCents: 99899 }),
      now: NOW,
      audit,
    });

    expect(result).toEqual({
      processed: false,
      reason: "amount_mismatch",
      orderId: "order-1",
    });
    expect(state.orders.get("order-1")?.status).toBe("pending");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");
    expect(state.transactions).toHaveLength(0);
    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "billing",
        objectType: "billing_webhook_event",
        objectId: "evt-1",
        reason: "amount_mismatch",
        result: "failure",
      }),
    );
  });

  it.each([
    ["missing", null],
    ["mismatched", "offline"],
  ])(
    "rejects a payment whose order provider is %s without side effects",
    async (_label, orderProvider) => {
      const { repo, state } = await setupWithPendingOrder();
      await repo.updateOrder("order-1", { provider: orderProvider });

      const result = await handle(repo, paymentWebhook());

      expect(result).toEqual({
        processed: false,
        reason: "provider_mismatch",
        orderId: "order-1",
      });
      expect(state.orders.get("order-1")?.status).toBe("pending");
      expect(state.subscriptions.get("org-1")?.status).toBe("trialing");
      expect(state.transactions).toHaveLength(0);
      expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
    },
  );

  it("rejects a blank provider transaction id without side effects", async () => {
    const { repo, state } = await setupWithPendingOrder();

    const result = await handle(
      repo,
      paymentWebhook({ providerTxnId: "   " }),
    );

    expect(result).toEqual({
      processed: false,
      reason: "invalid_provider_transaction",
      orderId: "order-1",
    });
    expect(state.orders.get("order-1")?.status).toBe("pending");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");
    expect(state.transactions).toHaveLength(0);
    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
  });

  it.each([
    ["missing", null],
    ["mismatched", "offline"],
  ])(
    "rejects a refund whose order provider is %s without side effects",
    async (_label, orderProvider) => {
      const { repo, state } =
        await setupWithRefundingFeatureOrder(orderProvider);
      const audit = vi.fn(async () => undefined);

      const result = await handleWebhook({
        repo,
        provider,
        ...paymentWebhook({
          type: "refund",
          providerTxnId: "mock_refund_order-1",
          amountCents: 4000,
        }),
        now: NOW,
        audit,
      });

      expect(result).toEqual({
        processed: false,
        reason: "provider_mismatch",
        orderId: "order-1",
      });
      expect(state.transactions).toHaveLength(0);
      expect(state.orders.get("order-1")).toMatchObject({
        status: "refunding",
        provider: orderProvider,
      });
      expect(state.subscriptions.get("org-1")).toMatchObject({
        status: "active",
        planId: "plan_pro",
      });
      expect(state.featureAddons.get("org-1:war_room")?.enabled).toBe(true);
      expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
      expect(audit).toHaveBeenCalledOnce();
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: "billing_webhook_event",
          objectId: "evt-1",
          reason: "provider_mismatch",
          result: "failure",
        }),
      );
    },
  );

  it.each(["", "   "])(
    "rejects refund provider transaction id %j without side effects",
    async (providerTxnId) => {
      const { repo, state } = await setupWithRefundingFeatureOrder();
      const audit = vi.fn(async () => undefined);

      const result = await handleWebhook({
        repo,
        provider,
        ...paymentWebhook({
          type: "refund",
          providerTxnId,
          amountCents: 4000,
        }),
        now: NOW,
        audit,
      });

      expect(result).toEqual({
        processed: false,
        reason: "invalid_provider_transaction",
        orderId: "order-1",
      });
      expect(state.transactions).toHaveLength(0);
      expect(state.orders.get("order-1")).toMatchObject({
        status: "refunding",
        provider: "mock",
      });
      expect(state.subscriptions.get("org-1")).toMatchObject({
        status: "active",
        planId: "plan_pro",
      });
      expect(state.featureAddons.get("org-1:war_room")?.enabled).toBe(true);
      expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
      expect(audit).toHaveBeenCalledOnce();
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: "billing_webhook_event",
          objectId: "evt-1",
          reason: "invalid_provider_transaction",
          result: "failure",
        }),
      );
    },
  );

  it("leaves a rejected payment retryable when invariant audit fails", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const payload = paymentWebhook({ amountCents: 99899 });
    const audit = vi
      .fn()
      .mockRejectedValueOnce(new Error("audit unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).rejects.toThrow("audit unavailable");

    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(false);
    expect(state.transactions).toHaveLength(0);
    expect(state.orders.get("order-1")?.status).toBe("pending");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");

    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toEqual({
      processed: false,
      reason: "amount_mismatch",
      orderId: "order-1",
    });

    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
    expect(audit).toHaveBeenCalledTimes(2);
    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toMatchObject({
      processed: false,
      reason: "duplicate",
    });
    expect(audit).toHaveBeenCalledTimes(2);
    expect(state.transactions).toHaveLength(0);
  });

  it("leaves a rejected refund retryable when invariant audit fails", async () => {
    const { repo, state } = await setupWithRefundingFeatureOrder("offline");
    const payload = paymentWebhook({
      type: "refund",
      providerTxnId: "mock_refund_order-1",
      amountCents: 4000,
    });
    const audit = vi
      .fn()
      .mockRejectedValueOnce(new Error("audit unavailable"))
      .mockResolvedValue(undefined);

    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).rejects.toThrow("audit unavailable");

    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(false);
    expect(state.transactions).toHaveLength(0);
    expect(state.orders.get("order-1")?.status).toBe("refunding");
    expect(state.subscriptions.get("org-1")).toMatchObject({
      status: "active",
      planId: "plan_pro",
    });
    expect(state.featureAddons.get("org-1:war_room")?.enabled).toBe(true);

    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toEqual({
      processed: false,
      reason: "provider_mismatch",
      orderId: "order-1",
    });

    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
    expect(audit).toHaveBeenCalledTimes(2);
    await expect(
      handleWebhook({
        repo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toMatchObject({
      processed: false,
      reason: "duplicate",
    });
    expect(audit).toHaveBeenCalledTimes(2);
    expect(state.transactions).toHaveLength(0);
    expect(state.orders.get("order-1")?.status).toBe("refunding");
    expect(state.featureAddons.get("org-1:war_room")?.enabled).toBe(true);
  });

  it("keeps invariant rejection retryable when processed acknowledgement fails", async () => {
    const { repo, state } = await setupWithPendingOrder();
    const payload = paymentWebhook({ providerTxnId: "   " });
    const audit = vi.fn(async () => undefined);
    let failProcessedMark = true;
    const retryableRepo: BillingRepo = {
      ...repo,
      async markWebhookProcessed(providerName, eventId) {
        if (failProcessedMark) {
          failProcessedMark = false;
          throw new Error("processed acknowledgement unavailable");
        }
        await repo.markWebhookProcessed(providerName, eventId);
      },
    };

    await expect(
      handleWebhook({
        repo: retryableRepo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).rejects.toThrow("processed acknowledgement unavailable");

    expect(audit).toHaveBeenCalledOnce();
    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(false);
    expect(state.transactions).toHaveLength(0);
    expect(state.orders.get("order-1")?.status).toBe("pending");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");

    await expect(
      handleWebhook({
        repo: retryableRepo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toEqual({
      processed: false,
      reason: "invalid_provider_transaction",
      orderId: "order-1",
    });

    expect(audit).toHaveBeenCalledTimes(2);
    expect(state.webhookEvents.get("mock:evt-1")?.processed).toBe(true);
    await expect(
      handleWebhook({
        repo: retryableRepo,
        provider,
        ...payload,
        now: NOW,
        audit,
      }),
    ).resolves.toMatchObject({
      processed: false,
      reason: "duplicate",
    });
    expect(audit).toHaveBeenCalledTimes(2);
    expect(state.transactions).toHaveLength(0);
  });

  it("permits a partial refund when the order provider matches", async () => {
    const { repo, state } = await setupWithRefundingFeatureOrder();

    const result = await handle(
      repo,
      paymentWebhook({
        type: "refund",
        providerTxnId: "mock_refund_order-1",
        amountCents: 4000,
      }),
    );

    expect(result).toEqual({ processed: true, orderId: "order-1" });
    expect(state.transactions).toEqual([
      expect.objectContaining({
        type: "refund",
        status: "succeeded",
        amountCents: 4000,
      }),
    ]);
    expect(state.orders.get("order-1")?.status).toBe("refunded");
    expect(state.featureAddons.get("org-1:war_room")?.enabled).toBe(false);
  });
});
