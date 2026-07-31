import { describe, expect, it } from "vitest";

import { TEST_PAYMENT_WEBHOOK_SECRET } from "../billing-test-fixtures";
import type { PaymentProvider } from "./payment-provider";
import {
  buildSignedMockWebhook,
  createMockPaymentProvider,
  signMockWebhook,
  type MockWebhookBody,
} from "./mock-provider";

describe("mock payment provider", () => {
  const provider = createMockPaymentProvider({
    secret: TEST_PAYMENT_WEBHOOK_SECRET,
  });
  const body: MockWebhookBody = {
    eventId: "evt-1",
    type: "payment",
    status: "succeeded",
    providerTxnId: "mock_pay_order-1",
    orderId: "order-1",
    amountCents: 99900,
  };

  it("creates a deterministic prepay descriptor", async () => {
    const pay = await provider.createPayment({
      orderId: "order-1",
      amountCents: 99900,
      currency: "CNY",
      subject: "订阅开通",
    });
    expect(pay.providerTxnId).toBe("mock_pay_order-1");
    expect(pay.payParams.type).toBe("qrcode");
  });

  it("verifies a correctly signed webhook", () => {
    const { rawBody, signature } = buildSignedMockWebhook(
      body,
      TEST_PAYMENT_WEBHOOK_SECRET,
    );
    const result = provider.verifyWebhook({ rawBody, signature });
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.event.orderId).toBe("order-1");
      expect(result.event.status).toBe("succeeded");
    }
  });

  it("rejects a tampered signature", () => {
    const { rawBody } = buildSignedMockWebhook(
      body,
      TEST_PAYMENT_WEBHOOK_SECRET,
    );
    const result = provider.verifyWebhook({
      rawBody,
      signature: signMockWebhook(
        "wrong-test-only-billing-webhook-secret-32-chars",
        rawBody,
      ),
    });
    expect(result).toEqual({ verified: false, reason: "signature_mismatch" });
  });

  it("requires an explicit secret", () => {
    const createWithoutOptions = createMockPaymentProvider as unknown as (
      options?: { secret?: string },
    ) => PaymentProvider;

    expect(() => createWithoutOptions()).toThrow(/explicit secret/i);
    expect(() => createWithoutOptions({})).toThrow(/explicit secret/i);
  });

  it("rejects blank and short secrets", () => {
    expect(() => createMockPaymentProvider({ secret: "   " })).toThrow(
      /at least 32 characters/i,
    );
    expect(() => createMockPaymentProvider({ secret: "too-short" })).toThrow(
      /at least 32 characters/i,
    );
  });

  it("requires an explicit strong secret when building signed webhooks", () => {
    const buildWithoutSecret = buildSignedMockWebhook as unknown as (
      value: MockWebhookBody,
      secret?: string,
    ) => { rawBody: string; signature: string };

    expect(() => buildWithoutSecret(body)).toThrow(/explicit secret/i);
    expect(() => buildSignedMockWebhook(body, "too-short")).toThrow(
      /at least 32 characters/i,
    );
  });
});
