import { describe, expect, it } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import type { BillingRepo } from "./billing-repo";
import {
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
const SECRET = "test-secret";
const provider = createMockPaymentProvider({ secret: SECRET });

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
    createdBy: "user-owner",
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
    SECRET,
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
    const result = await handle(repo, paymentWebhook({ status: "failed" }));
    expect(result.processed).toBe(true);
    expect(state.orders.get("order-1")?.status).toBe("failed");
    expect(state.subscriptions.get("org-1")?.status).toBe("trialing");
  });
});
