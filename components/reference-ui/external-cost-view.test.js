import { describe, expect, it } from "vitest";

import {
  buildCostItemPayload,
  canConfirmCostItem,
  canVoidCostItem,
  costStatusLabel,
  costStatusTone,
  defaultCostDraft,
  yuanInputToCents,
} from "./external-cost-view";

describe("external-cost-view", () => {
  it("converts yuan input to integer cents", () => {
    expect(yuanInputToCents("120.50")).toBe(12_050);
    expect(yuanInputToCents(0)).toBe(0);
    expect(yuanInputToCents("-5")).toBeNull();
    expect(yuanInputToCents("abc")).toBeNull();
    // Blank / whitespace must be invalid, not coerced to 0.
    expect(yuanInputToCents("")).toBeNull();
    expect(yuanInputToCents("   ")).toBeNull();
  });

  it("rejects a draft with a blank amount", () => {
    expect(
      buildCostItemPayload({ ...defaultCostDraft(), amountYuan: "", reason: "x" })
        .error,
    ).toMatch(/金额/);
  });

  it("maps status to tone and label", () => {
    expect(costStatusTone("pending_review")).toBe("amber");
    expect(costStatusTone("confirmed")).toBe("green");
    expect(costStatusLabel("voided")).toBe("已作废");
    expect(costStatusLabel("unknown")).toBe("unknown");
  });

  it("derives allowed transitions", () => {
    expect(canConfirmCostItem("pending_review")).toBe(true);
    expect(canConfirmCostItem("confirmed")).toBe(false);
    expect(canVoidCostItem("confirmed")).toBe(true);
    expect(canVoidCostItem("voided")).toBe(false);
  });

  it("builds a valid payload from a draft", () => {
    const result = buildCostItemPayload({
      ...defaultCostDraft(),
      amountYuan: "300",
      reason: "供应商账单",
    });
    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      itemType: "supplier_fee",
      amountCents: 30_000,
      direction: "cost",
      evidenceLevel: "yellow",
      reason: "供应商账单",
    });
  });

  it("rejects a draft with a bad amount or missing reason", () => {
    expect(buildCostItemPayload({ ...defaultCostDraft(), amountYuan: "-1", reason: "x" }).error).toMatch(
      /金额/,
    );
    expect(
      buildCostItemPayload({ ...defaultCostDraft(), amountYuan: "10", reason: "  " }).error,
    ).toMatch(/原因/);
  });
});
