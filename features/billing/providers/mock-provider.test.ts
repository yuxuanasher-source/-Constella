import { describe, expect, it } from "vitest";

import {
  buildSignedMockWebhook,
  createMockPaymentProvider,
  signMockWebhook,
} from "./mock-provider";

describe("mock payment provider", () => {
  const provider = createMockPaymentProvider({ secret: "test-secret" });

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
      {
        eventId: "evt-1",
        type: "payment",
        status: "succeeded",
        providerTxnId: "mock_pay_order-1",
        orderId: "order-1",
        amountCents: 99900,
      },
      "test-secret",
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
      {
        eventId: "evt-1",
        type: "payment",
        status: "succeeded",
        providerTxnId: "mock_pay_order-1",
        orderId: "order-1",
        amountCents: 99900,
      },
      "test-secret",
    );
    const result = provider.verifyWebhook({
      rawBody,
      signature: signMockWebhook("wrong-secret", rawBody),
    });
    expect(result).toEqual({ verified: false, reason: "signature_mismatch" });
  });
});
