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
