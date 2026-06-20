import { describe, expect, it } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import {
  TEST_ACTOR,
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "./billing-test-fixtures";
import { createCheckoutOrder } from "./checkout";
import { createMockPaymentProvider } from "./providers/mock-provider";

const NOW = new Date("2026-06-16T00:00:00.000Z");
const provider = createMockPaymentProvider({ secret: "test-secret" });

function setup(subscriptionOverrides?: Parameters<typeof makeSubscription>[0]) {
  return createMemoryBillingRepo({
    plans: TEST_PLANS,
    prices: TEST_PRICES,
    subscription: makeSubscription(
      subscriptionOverrides ?? {
        organizationId: "org-1",
        planId: "plan_trial",
        status: "trialing",
      },
    ),
  });
}

describe("createCheckoutOrder", () => {
  it("prices a new subscription server-side and prepays", async () => {
    const { repo, state } = setup();
    const result = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_new",
        target: { planCode: "pro", billingCycle: "monthly" },
      },
      now: NOW,
    });

    expect(result.order.amountCents).toBe(99900);
    expect(result.order.status).toBe("pending");
    expect(result.payParams.type).toBe("qrcode");
    expect(state.orders.size).toBe(1);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({
      type: "payment",
      status: "created",
      amountCents: 99900,
    });
  });

  it("reuses the pending order for a repeated intent (idempotency)", async () => {
    const { repo, state } = setup();
    const intent = {
      kind: "subscription_new" as const,
      target: { planCode: "pro", billingCycle: "monthly" as const },
    };
    const first = await createCheckoutOrder({ repo, provider, actor: TEST_ACTOR, intent, now: NOW });
    const second = await createCheckoutOrder({ repo, provider, actor: TEST_ACTOR, intent, now: NOW });

    expect(second.reused).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(state.orders.size).toBe(1);
  });

  it("computes upgrade proration against the current subscription", async () => {
    const { repo } = setup({
      organizationId: "org-1",
      planId: "plan_basic",
      status: "active",
      currentPeriodStart: "2026-06-01",
      currentPeriodEnd: "2026-07-01",
    });
    const result = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: {
        kind: "subscription_upgrade",
        target: { planCode: "pro", billingCycle: "monthly" },
      },
      now: NOW,
    });
    expect(result.order.amountCents).toBe(35000);
  });

  it("prices usage add-ons by unit × quantity", async () => {
    const { repo } = setup();
    const result = await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: { kind: "usage_addon", target: { metric: "ocr", quantity: 1000 } },
      now: NOW,
    });
    expect(result.order.amountCents).toBe(10000);
  });

  it("writes a high-signal audit entry when an audit sink is provided", async () => {
    const { repo } = setup();
    const audits: string[] = [];
    await createCheckoutOrder({
      repo,
      provider,
      actor: TEST_ACTOR,
      intent: { kind: "feature_addon", target: { featureKey: "war_room" } },
      now: NOW,
      audit: async (input) => {
        audits.push(`${input.module}:${input.objectType}`);
      },
    });
    expect(audits).toContain("billing:billing_order");
  });
});
