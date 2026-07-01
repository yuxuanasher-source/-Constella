import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUBLIC_PRICING_PLANS,
  resolvePublicPricingPlans,
} from "./pricing-data";

describe("public pricing data", () => {
  it("falls back to the standard paid plans when remote billing plans are empty", () => {
    const plans = resolvePublicPricingPlans([]);

    expect(plans.map((plan) => plan.code)).toEqual(["basic", "pro", "enterprise"]);
    expect(plans.every((plan) => plan.monthly_price_cents > 0)).toBe(true);
    expect(plans.every((plan) => plan.annual_price_cents > 0)).toBe(true);
  });

  it("replaces zero-valued seeded plans with the standard commercial prices", () => {
    const plans = resolvePublicPricingPlans([
      {
        id: "stale-basic",
        code: "basic",
        name: "基础版",
        monthly_price_cents: 0,
        annual_price_cents: 0,
        included_active_streamers: 0,
        included_seats: 0,
        included_ocr: 0,
        included_ai: 0,
      },
      {
        id: "stale-pro",
        code: "pro",
        name: "专业版",
        monthly_price_cents: 0,
        annual_price_cents: 0,
        included_active_streamers: 0,
        included_seats: 0,
        included_ocr: 0,
        included_ai: 0,
      },
    ]);

    expect(plans).toEqual(DEFAULT_PUBLIC_PRICING_PLANS);
  });

  it("keeps valid live prices while filling missing standard plans", () => {
    const plans = resolvePublicPricingPlans([
      {
        id: "custom-pro",
        code: "pro",
        name: "专业版",
        monthly_price_cents: 129900,
        annual_price_cents: 1299000,
        included_active_streamers: 50,
        included_seats: 20,
        included_ocr: 8000,
        included_ai: 15000,
      },
    ]);

    expect(plans.map((plan) => plan.code)).toEqual(["basic", "pro", "enterprise"]);
    expect(plans.find((plan) => plan.code === "pro")).toMatchObject({
      id: "custom-pro",
      monthly_price_cents: 129900,
      included_active_streamers: 50,
    });
    expect(plans.find((plan) => plan.code === "basic")).toMatchObject({
      monthly_price_cents: 29900,
    });
  });
});
