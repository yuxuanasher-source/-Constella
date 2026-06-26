import { describe, expect, it } from "vitest";

import { aggregateFunnel } from "./funnel-metrics";

describe("aggregateFunnel", () => {
  it("counts events and derives conversion rates", () => {
    const metrics = aggregateFunnel([
      { event: "signup_completed" },
      { event: "signup_completed" },
      { event: "signup_completed" },
      { event: "signup_completed" },
      { event: "activated" },
      { event: "activated" },
      { event: "paywall_shown", reason: "trial_ending" },
      { event: "paywall_shown", reason: "usage_hard_block" },
      { event: "paywall_cta_clicked", reason: "trial_ending" },
      { event: "checkout_started" },
      { event: "subscription_activated" },
    ]);

    expect(metrics.totals).toEqual({
      signupCompleted: 4,
      activated: 2,
      firstSettlementBatch: 0,
      paywallShown: 2,
      paywallClicked: 1,
      checkoutStarted: 1,
      subscriptionActivated: 1,
    });
    expect(metrics.rates).toEqual({
      activationRate: 0.5,
      paywallCtr: 0.5,
      checkoutConversion: 1,
      trialToPaid: 0.25,
    });
    expect(metrics.paywallReasons).toEqual({
      trial_ending: 2,
      usage_hard_block: 1,
    });
  });

  it("returns zeroed rates with no events", () => {
    const metrics = aggregateFunnel([]);
    expect(metrics.totals.signupCompleted).toBe(0);
    expect(metrics.rates.activationRate).toBe(0);
    expect(metrics.counts.paywall_shown).toBe(0);
  });
});
