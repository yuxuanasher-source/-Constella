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

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["production", "production"],
    ["spaced production", " production "],
    ["uppercase production", "PRODUCTION"],
    ["mixed-case development", "Development"],
    ["malformed test", "test "],
    ["staging", "staging"],
    ["preview", "preview"],
    ["production-like", "production-preview"],
  ])(
    "refuses mock when NODE_ENV is %s",
    (_label, nodeEnv) => {
      expectUnavailable(() =>
        getPaymentProvider("mock", {
          NODE_ENV: nodeEnv,
          PAYMENT_PROVIDER_DEFAULT: "mock",
          BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
        }),
      );
    },
  );

  it.each([undefined, "", "offline", " mock ", "MOCK"])(
    "requires an exact mock arming value, received %j",
    (providerDefault) => {
      expectUnavailable(() =>
        getPaymentProvider("mock", {
          NODE_ENV: "test",
          PAYMENT_PROVIDER_DEFAULT: providerDefault,
          BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
        }),
      );
    },
  );

  it("requires an explicit strong mock secret outside production", () => {
    expectUnavailable(() =>
      getPaymentProvider("mock", {
        NODE_ENV: "test",
        PAYMENT_PROVIDER_DEFAULT: "mock",
      }),
    );
    expectUnavailable(() =>
      getPaymentProvider("mock", {
        NODE_ENV: "development",
        PAYMENT_PROVIDER_DEFAULT: "mock",
        BILLING_MOCK_WEBHOOK_SECRET: "too-short",
      }),
    );
  });

  it("allows mock locally with an explicit strong secret", () => {
    expect(
      getPaymentProvider("mock", {
        NODE_ENV: "test",
        PAYMENT_PROVIDER_DEFAULT: "mock",
        BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
      }).name,
    ).toBe("mock");
  });

  it("allows mock in development with every explicit safeguard", () => {
    expect(
      getPaymentProvider(undefined, {
        NODE_ENV: "development",
        BILLING_PAYMENT_PROVIDER: "mock",
        PAYMENT_PROVIDER_DEFAULT: "mock",
        BILLING_MOCK_WEBHOOK_SECRET: TEST_PAYMENT_WEBHOOK_SECRET,
      }).name,
    ).toBe("mock");
  });

  it.each([
    ["explicit empty", "", {}],
    ["explicit whitespace", "   ", {}],
    ["configured empty", undefined, { BILLING_PAYMENT_PROVIDER: "" }],
    [
      "configured whitespace",
      undefined,
      { BILLING_PAYMENT_PROVIDER: "   " },
    ],
  ])(
    "rejects %s provider names instead of defaulting to offline",
    (_label, name, env) => {
      expectUnavailable(() => getPaymentProvider(name, env));
    },
  );

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

  it("does not expose the mock secret when configuration is unavailable", () => {
    const sensitiveSecret = `${TEST_PAYMENT_WEBHOOK_SECRET}-sensitive`;
    let thrown: unknown;

    try {
      getPaymentProvider("mock", {
        NODE_ENV: "staging",
        PAYMENT_PROVIDER_DEFAULT: "mock",
        BILLING_MOCK_WEBHOOK_SECRET: sensitiveSecret,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        name: "PaymentProviderUnavailableError",
        message: "Payment provider unavailable",
      }),
    );
    expect(String(thrown)).not.toContain(sensitiveSecret);
  });
});
