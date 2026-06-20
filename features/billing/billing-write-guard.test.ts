import { describe, expect, it } from "vitest";

import {
  assertBillingWriteAllowed,
  assertUsageWriteAllowed,
} from "./billing-write-guard";
import { calculateUsageStatus } from "./usage-metering";

describe("assertBillingWriteAllowed", () => {
  it("allows writes for active and trialing subscriptions", () => {
    expect(() => assertBillingWriteAllowed("active")).not.toThrow();
    expect(() => assertBillingWriteAllowed("trialing")).not.toThrow();
  });

  it("blocks writes in read-only states", () => {
    for (const status of ["past_due", "readonly", "cancelled"] as const) {
      expect(() => assertBillingWriteAllowed(status)).toThrow(/read-only/);
    }
  });
});

describe("assertUsageWriteAllowed", () => {
  it("hard-blocks OCR overage without an add-on", () => {
    const usage = calculateUsageStatus({
      metric: "ocr",
      usedQuantity: 250,
      includedQuantity: 200,
      addonQuantity: 0,
    });
    expect(usage.shouldHardBlock).toBe(true);
    expect(() => assertUsageWriteAllowed(usage)).toThrow(/Usage limit reached/);
  });

  it("permits AI soft overage", () => {
    const usage = calculateUsageStatus({
      metric: "ai",
      usedQuantity: 2100,
      includedQuantity: 2000,
      addonQuantity: 0,
    });
    expect(usage.shouldHardBlock).toBe(false);
    expect(() => assertUsageWriteAllowed(usage)).not.toThrow();
  });
});
