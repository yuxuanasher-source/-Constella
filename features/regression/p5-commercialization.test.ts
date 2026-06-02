import { describe, expect, it } from "vitest";

import { buildBillingStatus } from "@/features/billing/billing-status";
import {
  evaluateBillingGate,
  resolvePlanEntitlements,
} from "@/features/billing/billing-gates";
import { calculateUsageStatus } from "@/features/billing/usage-metering";

describe("P5 commercialization regression", () => {
  it("runs the flywheel under package gates, metering, add-ons, and past-due read-only mode", () => {
    const entitlements = resolvePlanEntitlements({
      planTier: "pro",
      featureAddons: [{ featureKey: "auto_review_active", enabled: true }],
    });
    const activeWrite = evaluateBillingGate({
      entitlements,
      subscriptionStatus: "active",
      featureKey: "war_room",
      action: "write",
    });
    const pastDueRead = evaluateBillingGate({
      entitlements,
      subscriptionStatus: "past_due",
      featureKey: "settlement",
      action: "read",
    });
    const pastDueWrite = evaluateBillingGate({
      entitlements,
      subscriptionStatus: "past_due",
      featureKey: "settlement",
      action: "write",
    });
    const usage = calculateUsageStatus({
      metric: "export",
      usedQuantity: 130,
      includedQuantity: 100,
      addonQuantity: 20,
    });
    const billing = buildBillingStatus({
      subscription: {
        status: "past_due",
        plan: { tier: "pro", code: "pro", name: "专业版" },
      },
      featureAddons: [{ featureKey: "auto_review_active", enabled: true }],
      usageCounters: [
        {
          metric: "export",
          usedQuantity: usage.usedQuantity,
          includedQuantity: usage.includedQuantity,
          addonQuantity: usage.addonQuantity,
        },
      ],
    });

    expect(activeWrite).toEqual({ allowed: true, mode: "active" });
    expect(pastDueRead).toEqual({ allowed: true, mode: "read_only" });
    expect(pastDueWrite).toEqual({
      allowed: false,
      mode: "read_only",
      reason: "subscription_readonly",
    });
    expect(usage).toMatchObject({
      overageQuantity: 10,
      billableOverageQuantity: 10,
      shouldHardBlock: false,
    });
    expect(billing).toMatchObject({
      subscriptionStatus: "past_due",
      mode: "read_only",
      entitlements: {
        war_room: true,
        auto_review_active: true,
      },
      usage: [{ metric: "export", overageQuantity: 10 }],
    });
    expect(JSON.stringify(billing)).not.toMatch(/amountCents|price/i);
  });
});
