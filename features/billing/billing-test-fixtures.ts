import type { PlanRecord, SubscriptionRecord } from "./billing-repo";
import type { PlanPriceRow } from "./pricing";

/** Explicit test-only HMAC secret; never use outside local/test billing fixtures. */
export const TEST_PAYMENT_WEBHOOK_SECRET =
  "test-only-billing-webhook-secret-32-chars-minimum";

/** 与 P6 迁移内置套餐保持一致的测试样本（仅用于测试）。 */
export const TEST_PLANS: PlanRecord[] = [
  makePlan({
    id: "plan_trial",
    code: "trial",
    tier: "free",
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    includedActiveStreamers: 5,
    includedSeats: 3,
    includedOcr: 200,
    includedAi: 500,
  }),
  makePlan({
    id: "plan_free",
    code: "free",
    tier: "free",
    includedActiveStreamers: 2,
    includedSeats: 2,
    includedOcr: 50,
    includedAi: 100,
  }),
  makePlan({
    id: "plan_basic",
    code: "basic",
    tier: "basic",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    includedActiveStreamers: 10,
    includedSeats: 5,
    includedOcr: 1000,
    includedAi: 2000,
  }),
  makePlan({
    id: "plan_pro",
    code: "pro",
    tier: "pro",
    monthlyPriceCents: 99900,
    annualPriceCents: 999000,
    includedActiveStreamers: 30,
    includedSeats: 15,
    includedOcr: 5000,
    includedAi: 10000,
  }),
];

export const TEST_PRICES: Record<string, PlanPriceRow[]> = Object.fromEntries(
  TEST_PLANS.map((plan) => [
    plan.id,
    [
      {
        billingCycle: "monthly",
        priceCents: plan.monthlyPriceCents,
        active: true,
      },
      {
        billingCycle: "annual",
        priceCents: plan.annualPriceCents,
        active: true,
      },
    ],
  ]),
);

export function makePlan(
  overrides: Partial<PlanRecord> & { id: string; code: string },
): PlanRecord {
  return {
    tier: "basic",
    name: overrides.code,
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    includedActiveStreamers: 0,
    includedSeats: 0,
    includedOcr: 0,
    includedAi: 0,
    includedStorageMb: 0,
    includedExports: 0,
    ...overrides,
  };
}

export function makeSubscription(
  overrides: Partial<SubscriptionRecord> & {
    organizationId: string;
    planId: string;
  },
): SubscriptionRecord {
  return {
    status: "trialing",
    billingCycle: "monthly",
    currentPeriodStart: "2026-06-01",
    currentPeriodEnd: "2026-07-01",
    trialEndsAt: "2026-06-15T00:00:00.000Z",
    graceUntil: null,
    pendingPlanId: null,
    pendingBillingCycle: null,
    autoRenew: true,
    lastOrderId: null,
    ...overrides,
  };
}

export const TEST_ACTOR = {
  userId: "user-owner",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};
