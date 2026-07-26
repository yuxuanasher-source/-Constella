import { describe, expect, it } from "vitest";

import {
  computeFeatureAddonAmountCents,
  computeUsageAddonAmountCents,
  resolvePlanPriceCents,
  type PlanPriceRow,
} from "./pricing";

const prices: PlanPriceRow[] = [
  { billingCycle: "monthly", priceCents: 99900, active: true },
  { billingCycle: "annual", priceCents: 999000, active: true },
  { billingCycle: "monthly", priceCents: 49900, active: false },
];

describe("resolvePlanPriceCents", () => {
  it("returns the active price for the requested cycle", () => {
    expect(resolvePlanPriceCents(prices, "monthly")).toBe(99900);
    expect(resolvePlanPriceCents(prices, "annual")).toBe(999000);
  });

  it("throws when no active price is configured", () => {
    expect(() =>
      resolvePlanPriceCents(
        [{ billingCycle: "monthly", priceCents: 1, active: false }],
        "monthly",
      ),
    ).toThrow(/not configured/);
  });

  it("uses effective windows so a future version is not charged early", () => {
    const versioned: PlanPriceRow[] = [
      {
        billingCycle: "monthly",
        priceCents: 99900,
        active: false,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-08-01T00:00:00.000Z",
      },
      {
        billingCycle: "monthly",
        priceCents: 129900,
        active: true,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ];

    expect(
      resolvePlanPriceCents(
        versioned,
        "monthly",
        new Date("2026-07-26T00:00:00.000Z"),
      ),
    ).toBe(99900);
    expect(
      resolvePlanPriceCents(
        versioned,
        "monthly",
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).toBe(129900);
  });
});

describe("usage and feature add-on pricing", () => {
  it("multiplies unit price by quantity for usage add-ons", () => {
    expect(computeUsageAddonAmountCents("ocr", 1000)).toBe(10 * 1000);
    expect(computeUsageAddonAmountCents("ai", 2000)).toBe(5 * 2000);
  });

  it("rejects non-positive quantities", () => {
    expect(() => computeUsageAddonAmountCents("ocr", 0)).toThrow(/positive/);
  });

  it("prices feature add-ons from the configured table", () => {
    expect(computeFeatureAddonAmountCents("war_room")).toBe(50000);
    expect(() => computeFeatureAddonAmountCents("unknown_feature")).toThrow(
      /No add-on price/,
    );
  });
});
