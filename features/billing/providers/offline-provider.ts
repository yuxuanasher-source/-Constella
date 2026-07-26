import type { PaymentProvider } from "./payment-provider";

/**
 * 人工线下收退款适配器。它不发起资金划转，只把平台管理员已经在银行等
 * 外部渠道完成的动作，以外部流水号确认为成功记录。
 */
export function createOfflinePaymentProvider(): PaymentProvider {
  return {
    name: "offline",
    async createPayment(input) {
      return {
        provider: "offline",
        channel: "mock",
        providerTxnId: `offline_${input.orderId}`,
        payParams: { type: "none", value: "" },
      };
    },
    async queryPayment() {
      return { status: "succeeded" };
    },
    async refund(input) {
      const reference = input.refundExternalReference?.trim();
      if (!reference) {
        throw new Error("Offline refund external reference is required");
      }
      return {
        provider: "offline",
        refundTxnId: reference,
        status: "succeeded",
      };
    },
    verifyWebhook() {
      return {
        verified: false,
        reason: "Offline payments do not accept webhooks",
      };
    },
    async fetchStatement() {
      return [];
    },
  };
}
