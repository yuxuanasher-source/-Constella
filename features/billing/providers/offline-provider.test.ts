import { describe, expect, it } from "vitest";

import { createOfflinePaymentProvider } from "./offline-provider";

describe("offline payment provider", () => {
  const provider = createOfflinePaymentProvider();

  it("creates and queries a non-network payment record", async () => {
    await expect(
      provider.createPayment({
        orderId: "order-offline-1",
        amountCents: 12_300,
        currency: "CNY",
        subject: "线下订阅",
      }),
    ).resolves.toEqual({
      provider: "offline",
      channel: "mock",
      providerTxnId: "offline_order-offline-1",
      payParams: { type: "none", value: "" },
    });
    await expect(
      provider.queryPayment("offline_order-offline-1"),
    ).resolves.toEqual({
      status: "succeeded",
    });
  });

  it("requires the reviewed external reference for refunds", async () => {
    const input = {
      orderId: "order-offline-1",
      transactionId: "transaction-1",
      providerTxnId: "offline_order-offline-1",
      amountCents: 12_300,
      reason: "manual refund",
    };

    await expect(provider.refund(input)).rejects.toThrow(
      /external reference is required/i,
    );
    await expect(
      provider.refund({
        ...input,
        refundExternalReference: "  bank-refund-42  ",
      }),
    ).resolves.toEqual({
      provider: "offline",
      refundTxnId: "bank-refund-42",
      status: "succeeded",
    });
  });

  it("rejects webhooks and exposes no channel statement", async () => {
    expect(
      provider.verifyWebhook({
        rawBody: "{}",
        signature: "not-used",
      }),
    ).toEqual({
      verified: false,
      reason: "Offline payments do not accept webhooks",
    });
    await expect(provider.fetchStatement("2026-07-31")).resolves.toEqual([]);
  });
});
