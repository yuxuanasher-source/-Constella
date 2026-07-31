import { describe, expect, it } from "vitest";

import { TEST_PAYMENT_WEBHOOK_SECRET } from "../billing-test-fixtures";
import { getPaymentProvider } from "./registry";

function expectUnavailable(run: () => unknown) {
  expect(run).toThrow(
    expect.objectContaining({
      name: "PaymentProviderUnavailableError",
      message: "Payment provider unavailable",
    }),
  );
}

describe("payment provider registry", () => {
  it("defaults to offline when no provider is configured", () => {
    expect(getPaymentProvider(undefined, {}).name).toBe("offline");
  });

  it("refuses the mock provider in production even with a strong secret", () => {
    expectUnavailable(() =>
      getPaymentProvider("mock", {
        NODE_ENV: "production",
        BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
      }),
    );
  });

  it("requires an explicit strong mock secret outside production", () => {
    expectUnavailable(() =>
      getPaymentProvider("mock", {
        NODE_ENV: "test",
      }),
    );
    expectUnavailable(() =>
      getPaymentProvider("mock", {
        NODE_ENV: "development",
        BILLING_MOCK_WEBHOOK_SECRET: "too-short",
      }),
    );
  });

  it("allows mock locally with an explicit strong secret", () => {
    expect(
      getPaymentProvider("mock", {
        NODE_ENV: "test",
        BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
      }).name,
    ).toBe("mock");
  });

  it("rejects unknown providers without exposing their name", () => {
    const unknownProvider = "secret-internal-provider";

    expectUnavailable(() =>
      getPaymentProvider(unknownProvider, {
        NODE_ENV: "test",
      }),
    );
    try {
      getPaymentProvider(unknownProvider, { NODE_ENV: "test" });
    } catch (error) {
      expect(String(error)).not.toContain(unknownProvider);
    }
  });
});
