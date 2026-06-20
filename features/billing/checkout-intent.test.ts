import { describe, expect, it } from "vitest";

import { parseCheckoutIntent } from "./checkout-intent";

describe("parseCheckoutIntent", () => {
  it("parses a valid subscription intent", () => {
    expect(
      parseCheckoutIntent({
        kind: "subscription_new",
        target: { planCode: "pro", billingCycle: "annual" },
      }),
    ).toEqual({
      kind: "subscription_new",
      target: { planCode: "pro", billingCycle: "annual" },
    });
  });

  it("rejects unknown order kinds", () => {
    expect(() => parseCheckoutIntent({ kind: "free_lunch" })).toThrow(
      /Invalid order kind/,
    );
  });

  it("refuses any client-supplied amount", () => {
    expect(() =>
      parseCheckoutIntent({
        kind: "usage_addon",
        target: { metric: "ocr", quantity: 100, amountCents: 1 },
      }),
    ).toThrow(/Amount cannot be supplied/);
  });

  it("drops unknown cycle and metric values", () => {
    expect(
      parseCheckoutIntent({
        kind: "usage_addon",
        target: { metric: "bogus", billingCycle: "weekly", quantity: 5 },
      }),
    ).toEqual({ kind: "usage_addon", target: { quantity: 5 } });
  });
});
