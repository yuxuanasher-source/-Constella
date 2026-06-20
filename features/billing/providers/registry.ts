import { createMockPaymentProvider } from "./mock-provider";
import type { PaymentProvider } from "./payment-provider";

/**
 * 支付 Provider 注册表。首版仅 mock；持牌聚合支付（微信 / 支付宝）实现
 * 后续以同一 {@link PaymentProvider} 契约接入，编排层无需改动。
 */
export function getPaymentProvider(name?: string): PaymentProvider {
  const resolved = name ?? process.env.BILLING_PAYMENT_PROVIDER ?? "mock";
  switch (resolved) {
    case "mock":
      return createMockPaymentProvider({
        secret: process.env.BILLING_MOCK_WEBHOOK_SECRET,
      });
    default:
      throw new Error(`Unknown payment provider: ${resolved}`);
  }
}
