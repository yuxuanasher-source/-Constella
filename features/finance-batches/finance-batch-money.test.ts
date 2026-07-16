import { describe, expect, it } from "vitest";

import {
  financeAmount,
  signedAdjustmentAmount,
  summarizeFinanceItems,
} from "./finance-batch-money";

describe("finance batch money helpers", () => {
  it("normalizes amounts to two decimals", () => {
    expect(financeAmount(12.345)).toBe(12.35);
    expect(financeAmount("8.1")).toBe(8.1);
  });

  it("rejects unsafe amounts", () => {
    expect(() => financeAmount(Number.NaN)).toThrow("Invalid finance amount");
    expect(() => financeAmount("abc")).toThrow("Invalid finance amount");
    expect(() => financeAmount("12-not-money")).toThrow(
      "Invalid finance amount",
    );
  });

  it("computes signed adjustments", () => {
    expect(signedAdjustmentAmount({ direction: "increase", amount: 25 })).toBe(
      25,
    );
    expect(signedAdjustmentAmount({ direction: "decrease", amount: 25 })).toBe(
      -25,
    );
    expect(
      signedAdjustmentAmount({ direction: "decrease", amount: -25 }),
    ).toBe(-25);
  });

  it("summarizes system, adjustment, and final amounts", () => {
    expect(
      summarizeFinanceItems([
        { systemAmount: 100, adjustmentAmount: 10 },
        { systemAmount: 60, adjustmentAmount: -5 },
      ]),
    ).toEqual({
      systemAmount: 160,
      adjustmentAmount: 5,
      finalAmount: 165,
      itemCount: 2,
    });
  });
});
