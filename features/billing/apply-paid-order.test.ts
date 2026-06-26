import { describe, expect, it } from "vitest";

import { applyPaidOrder } from "./apply-paid-order";
import { createMemoryBillingRepo } from "./billing-repo-memory";
import type { OrderRecord } from "./billing-repo";
import {
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "./billing-test-fixtures";

const NOW = new Date("2026-06-16T00:00:00.000Z");

function makeOrder(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: overrides.id ?? "order-1",
    organizationId: "org-1",
    kind: overrides.kind ?? "subscription_new",
    status: "paid",
    amountCents: overrides.amountCents ?? 0,
    currency: "CNY",
    target: overrides.target ?? {},
    planId: overrides.planId ?? null,
    planPriceId: null,
    billingCycle: overrides.billingCycle ?? "monthly",
    idempotencyKey: "key",
    provider: "mock",
    expiresAt: null,
    paidAt: NOW.toISOString(),
    createdBy: "user-owner",
    ...overrides,
  };
}

function setup(sub?: Parameters<typeof makeSubscription>[0]) {
  return createMemoryBillingRepo({
    plans: TEST_PLANS,
    prices: TEST_PRICES,
    subscription: makeSubscription(
      sub ?? { organizationId: "org-1", planId: "plan_trial", status: "trialing" },
    ),
  });
}

describe("applyPaidOrder", () => {
  it("activates a new subscription and recomputes included quotas", async () => {
    const { repo, state } = setup();
    const result = await applyPaidOrder({
      repo,
      order: makeOrder({ kind: "subscription_new", planId: "plan_pro" }),
      now: NOW,
    });

    expect(result).toEqual({ applied: true, subscriptionStatus: "active" });
    const sub = state.subscriptions.get("org-1");
    expect(sub).toMatchObject({
      planId: "plan_pro",
      status: "active",
      currentPeriodStart: "2026-06-16",
      currentPeriodEnd: "2026-07-16",
      lastOrderId: "order-1",
    });
    expect(state.usageCounters.get("org-1:ocr:2026-06-01")?.includedQuantity).toBe(
      5000,
    );
  });

  it("extends the period from the prior period end on renewal", async () => {
    const { repo, state } = setup({
      organizationId: "org-1",
      planId: "plan_basic",
      status: "active",
      currentPeriodStart: "2026-06-01",
      currentPeriodEnd: "2026-07-01",
    });
    await applyPaidOrder({
      repo,
      order: makeOrder({ kind: "subscription_renewal", planId: "plan_basic" }),
      now: NOW,
    });
    expect(state.subscriptions.get("org-1")).toMatchObject({
      currentPeriodStart: "2026-07-01",
      currentPeriodEnd: "2026-08-01",
    });
  });

  it("schedules a downgrade for the next period without switching now", async () => {
    const { repo, state } = setup({
      organizationId: "org-1",
      planId: "plan_pro",
      status: "active",
    });
    await applyPaidOrder({
      repo,
      order: makeOrder({ kind: "subscription_downgrade", planId: "plan_basic" }),
      now: NOW,
    });
    const sub = state.subscriptions.get("org-1");
    expect(sub?.planId).toBe("plan_pro");
    expect(sub?.pendingPlanId).toBe("plan_basic");
  });

  it("credits a usage add-on to the monthly counter", async () => {
    const { repo, state } = setup();
    await applyPaidOrder({
      repo,
      order: makeOrder({
        kind: "usage_addon",
        amountCents: 10000,
        target: { metric: "ocr", quantity: 1000 },
      }),
      now: NOW,
    });
    expect(state.usageAddons).toHaveLength(1);
    expect(state.usageCounters.get("org-1:ocr:2026-06-01")?.addonQuantity).toBe(
      1000,
    );
  });

  it("enables a feature add-on", async () => {
    const { repo, state } = setup();
    await applyPaidOrder({
      repo,
      order: makeOrder({
        kind: "feature_addon",
        target: { featureKey: "war_room" },
      }),
      now: NOW,
    });
    expect(state.featureAddons.get("org-1:war_room")).toEqual({
      featureKey: "war_room",
      enabled: true,
    });
  });
});
