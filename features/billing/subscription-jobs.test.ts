import { describe, expect, it, vi } from "vitest";

import { createMemoryBillingRepo } from "./billing-repo-memory";
import {
  TEST_PLANS,
  TEST_PRICES,
  makeSubscription,
} from "./billing-test-fixtures";
import {
  runDunningSweep,
  runExpirePendingOrdersSweep,
  runRenewalSweep,
} from "./subscription-jobs";

const NOW = new Date("2026-06-20T00:00:00.000Z");

describe("runDunningSweep", () => {
  it("advances expired/overdue/grace-elapsed subscriptions and fires hooks", async () => {
    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
    });
    state.subscriptions.set(
      "org-trial",
      makeSubscription({
        organizationId: "org-trial",
        planId: "plan_trial",
        status: "trialing",
        trialEndsAt: "2026-06-15T00:00:00.000Z",
      }),
    );
    state.subscriptions.set(
      "org-active",
      makeSubscription({
        organizationId: "org-active",
        planId: "plan_pro",
        status: "active",
        currentPeriodEnd: "2026-06-01",
      }),
    );
    state.subscriptions.set(
      "org-grace",
      makeSubscription({
        organizationId: "org-grace",
        planId: "plan_pro",
        status: "past_due",
        graceUntil: "2026-06-10T00:00:00.000Z",
      }),
    );
    state.subscriptions.set(
      "org-ok",
      makeSubscription({
        organizationId: "org-ok",
        planId: "plan_pro",
        status: "active",
        currentPeriodEnd: "2026-07-01",
      }),
    );

    const onPastDue = vi.fn(async () => undefined);
    const onReadonly = vi.fn(async () => undefined);

    const summary = await runDunningSweep({
      repo,
      now: NOW,
      hooks: { onPastDue, onReadonly },
    });

    expect(summary.enteredPastDue.sort()).toEqual(["org-active", "org-trial"]);
    expect(summary.enteredReadonly).toEqual(["org-grace"]);
    expect(state.subscriptions.get("org-trial")?.status).toBe("past_due");
    expect(state.subscriptions.get("org-active")?.status).toBe("past_due");
    expect(state.subscriptions.get("org-grace")?.status).toBe("readonly");
    expect(state.subscriptions.get("org-ok")?.status).toBe("active");
    expect(onPastDue).toHaveBeenCalledTimes(2);
    expect(onReadonly).toHaveBeenCalledTimes(1);
  });
});

describe("runRenewalSweep", () => {
  function setupDue(extra?: Parameters<typeof makeSubscription>[0]) {
    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
      owners: { "org-1": "user-owner" },
    });
    state.subscriptions.set(
      "org-1",
      makeSubscription({
        organizationId: "org-1",
        planId: "plan_pro",
        status: "active",
        currentPeriodEnd: "2026-06-22",
        autoRenew: true,
        ...extra,
      }),
    );
    return { repo, state };
  }

  it("generates a pending renewal order once and notifies", async () => {
    const { repo, state } = setupDue();
    const onRenewalOrder = vi.fn(async () => undefined);

    const first = await runRenewalSweep({
      repo,
      now: NOW,
      hooks: { onRenewalOrder },
    });
    expect(first.generated).toHaveLength(1);
    expect(onRenewalOrder).toHaveBeenCalledTimes(1);

    const order = state.orders.get(first.generated[0]);
    expect(order).toMatchObject({
      kind: "subscription_renewal",
      planId: "plan_pro",
      amountCents: 99900,
      status: "pending",
      createdBy: "user-owner",
    });

    // idempotent: a second sweep reuses the existing order
    const second = await runRenewalSweep({ repo, now: NOW });
    expect(second.generated).toHaveLength(0);
    expect(state.orders.size).toBe(1);
  });

  it("prices a scheduled downgrade at the pending plan", async () => {
    const { repo, state } = setupDue({
      organizationId: "org-1",
      planId: "plan_pro",
      pendingPlanId: "plan_basic",
      pendingBillingCycle: "monthly",
      status: "active",
      currentPeriodEnd: "2026-06-22",
    });
    const summary = await runRenewalSweep({ repo, now: NOW });
    const order = state.orders.get(summary.generated[0]);
    expect(order).toMatchObject({ planId: "plan_basic", amountCents: 29900 });
  });
});

describe("runExpirePendingOrdersSweep", () => {
  it("cancels only the timed-out pending orders", async () => {
    const { repo, state } = createMemoryBillingRepo({
      plans: TEST_PLANS,
      prices: TEST_PRICES,
    });
    await repo.insertOrder({
      id: "order-expired",
      organizationId: "org-1",
      kind: "subscription_new",
      amountCents: 99900,
      currency: "CNY",
      target: {},
      idempotencyKey: "k1",
      expiresAt: "2026-06-19T00:00:00.000Z",
      createdBy: "user-1",
    });
    await repo.insertOrder({
      id: "order-fresh",
      organizationId: "org-1",
      kind: "subscription_new",
      amountCents: 99900,
      currency: "CNY",
      target: {},
      idempotencyKey: "k2",
      expiresAt: "2026-06-21T00:00:00.000Z",
      createdBy: "user-1",
    });

    const summary = await runExpirePendingOrdersSweep({ repo, now: NOW });

    expect(summary.cancelled).toEqual(["order-expired"]);
    expect(state.orders.get("order-expired")?.status).toBe("cancelled");
    expect(state.orders.get("order-fresh")?.status).toBe("pending");
  });
});
