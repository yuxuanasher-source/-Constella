import { describe, expect, it } from "vitest";

import { buildBillingStatus } from "@/features/billing/billing-status";
import type {
  BillingPlanTier,
  SubscriptionStatus,
} from "@/features/billing/billing-gates";
import type { UsageMetric } from "@/features/billing/usage-metering";

import { resolvePaywall } from "./paywall";

function status({
  subscriptionStatus = "active" as SubscriptionStatus,
  tier = "basic" as BillingPlanTier,
  trialEndsAt = null as string | null,
  usageCounters = [] as Array<{
    metric: UsageMetric;
    usedQuantity: number;
    includedQuantity: number;
    addonQuantity: number;
  }>,
} = {}) {
  return buildBillingStatus({
    subscription: {
      status: subscriptionStatus,
      plan: { tier, code: tier, name: tier },
      trialEndsAt,
    },
    featureAddons: [],
    usageCounters,
  });
}

describe("resolvePaywall", () => {
  it("returns a blocking trial_expired wall in read-only mode", () => {
    expect(resolvePaywall(status({ subscriptionStatus: "past_due" }))).toEqual({
      reason: "trial_expired",
      blocking: true,
    });
  });

  it("flags unentitled features", () => {
    expect(
      resolvePaywall(status({ tier: "basic" }), { featureKey: "war_room" }),
    ).toEqual({
      reason: "feature_not_entitled",
      blocking: true,
      featureKey: "war_room",
    });
  });

  it("hard-blocks OCR overage and soft-warns near other limits", () => {
    const hard = resolvePaywall(
      status({
        usageCounters: [
          { metric: "ocr", usedQuantity: 250, includedQuantity: 200, addonQuantity: 0 },
        ],
      }),
      { metric: "ocr" },
    );
    expect(hard).toEqual({ reason: "usage_hard_block", blocking: true, metric: "ocr" });

    const near = resolvePaywall(
      status({
        usageCounters: [
          { metric: "ai", usedQuantity: 1600, includedQuantity: 2000, addonQuantity: 0 },
        ],
      }),
      { metric: "ai" },
    );
    expect(near).toEqual({ reason: "usage_near_limit", blocking: false, metric: "ai" });
  });

  it("surfaces a trial_ending banner near expiry", () => {
    const decision = resolvePaywall(
      status({ subscriptionStatus: "trialing", trialEndsAt: "2026-06-15T00:00:00.000Z" }),
      { now: new Date("2026-06-13T00:00:00.000Z") },
    );
    expect(decision).toEqual({ reason: "trial_ending", blocking: false });
  });

  it("returns null when entitled and within limits", () => {
    expect(resolvePaywall(status())).toBeNull();
  });
});
