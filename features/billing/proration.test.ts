import { describe, expect, it } from "vitest";

import {
  computeDowngradeAmountCents,
  computeUpgradeProrationCents,
} from "./proration";

describe("computeUpgradeProrationCents", () => {
  it("charges the daily-rate difference for the remaining days (golden)", () => {
    const result = computeUpgradeProrationCents({
      oldPriceCents: 29900,
      newPriceCents: 99900,
      periodStart: "2026-06-01",
      periodEnd: "2026-07-01",
      now: "2026-06-16",
    });
    expect(result).toEqual({
      totalDays: 30,
      remainingDays: 15,
      amountCents: 35000,
    });
  });

  it("clamps remaining days to the full period when now precedes the start", () => {
    const result = computeUpgradeProrationCents({
      oldPriceCents: 29900,
      newPriceCents: 99900,
      periodStart: "2026-06-01",
      periodEnd: "2026-07-01",
      now: "2026-05-20",
    });
    expect(result.remainingDays).toBe(30);
    expect(result.amountCents).toBe(70000);
  });

  it("never charges below zero and floors a same-day-or-past upgrade at 0", () => {
    const result = computeUpgradeProrationCents({
      oldPriceCents: 99900,
      newPriceCents: 29900,
      periodStart: "2026-06-01",
      periodEnd: "2026-07-01",
      now: "2026-06-16",
    });
    expect(result.amountCents).toBe(0);
  });
});

describe("computeDowngradeAmountCents", () => {
  it("does not charge for downgrades (next-period switch, no refund)", () => {
    expect(computeDowngradeAmountCents()).toBe(0);
  });
});
