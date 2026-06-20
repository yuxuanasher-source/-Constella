import { describe, expect, it } from "vitest";

import type { OrderRecord } from "./billing-repo";
import { makeSubscription } from "./billing-test-fixtures";
import {
  evaluateDunning,
  isPendingOrderExpired,
  shouldGenerateRenewal,
} from "./subscription-lifecycle";

const NOW = new Date("2026-06-20T00:00:00.000Z");

describe("evaluateDunning", () => {
  it("moves an expired trial into past_due with a grace window", () => {
    const decision = evaluateDunning({
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_trial",
        status: "trialing",
        trialEndsAt: "2026-06-15T00:00:00.000Z",
      }),
      now: NOW,
      graceDays: 7,
    });
    expect(decision).toEqual({
      action: "enter_past_due",
      cause: "trial_expired",
      graceUntil: "2026-06-27T00:00:00.000Z",
    });
  });

  it("moves an overdue active subscription into past_due", () => {
    const decision = evaluateDunning({
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_pro",
        status: "active",
        currentPeriodEnd: "2026-06-01",
      }),
      now: NOW,
    });
    expect(decision).toMatchObject({ action: "enter_past_due", cause: "period_ended" });
  });

  it("moves past_due into readonly once the grace window elapses", () => {
    const decision = evaluateDunning({
      subscription: makeSubscription({
        organizationId: "org-1",
        planId: "plan_pro",
        status: "past_due",
        graceUntil: "2026-06-10T00:00:00.000Z",
      }),
      now: NOW,
    });
    expect(decision).toEqual({ action: "enter_readonly" });
  });

  it("leaves healthy subscriptions untouched", () => {
    expect(
      evaluateDunning({
        subscription: makeSubscription({
          organizationId: "org-1",
          planId: "plan_pro",
          status: "active",
          currentPeriodEnd: "2026-07-01",
        }),
        now: NOW,
      }),
    ).toEqual({ action: "none" });
  });
});

describe("shouldGenerateRenewal", () => {
  const base = {
    organizationId: "org-1",
    planId: "plan_pro",
    status: "active" as const,
  };

  it("is true within the lead window for auto-renewing subscriptions", () => {
    expect(
      shouldGenerateRenewal({
        subscription: makeSubscription({ ...base, currentPeriodEnd: "2026-06-22" }),
        now: NOW,
        leadDays: 3,
      }),
    ).toBe(true);
  });

  it("is false outside the lead window or when auto-renew is off", () => {
    expect(
      shouldGenerateRenewal({
        subscription: makeSubscription({ ...base, currentPeriodEnd: "2026-07-10" }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldGenerateRenewal({
        subscription: makeSubscription({
          ...base,
          currentPeriodEnd: "2026-06-22",
          autoRenew: false,
        }),
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("isPendingOrderExpired", () => {
  const order = (overrides: Partial<OrderRecord>): OrderRecord => ({
    id: "order-1",
    organizationId: "org-1",
    kind: "subscription_new",
    status: "pending",
    amountCents: 1,
    currency: "CNY",
    target: {},
    idempotencyKey: "k",
    createdBy: "user-1",
    ...overrides,
  });

  it("flags pending orders past their expiry", () => {
    expect(
      isPendingOrderExpired(order({ expiresAt: "2026-06-19T00:00:00.000Z" }), NOW),
    ).toBe(true);
  });

  it("ignores future or non-pending orders", () => {
    expect(
      isPendingOrderExpired(order({ expiresAt: "2026-06-21T00:00:00.000Z" }), NOW),
    ).toBe(false);
    expect(
      isPendingOrderExpired(
        order({ status: "paid", expiresAt: "2026-06-19T00:00:00.000Z" }),
        NOW,
      ),
    ).toBe(false);
  });
});
