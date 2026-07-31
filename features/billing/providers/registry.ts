import { createMockPaymentProvider } from "./mock-provider";
import { createOfflinePaymentProvider } from "./offline-provider";
import type { PaymentProvider } from "./payment-provider";

export type PaymentProviderEnv = {
  NODE_ENV?: string;
  BILLING_PAYMENT_PROVIDER?: string;
  PAYMENT_PROVIDER_DEFAULT?: string;
  BILLING_MOCK_WEBHOOK_SECRET?: string;
};

export class PaymentProviderUnavailableError extends Error {
  readonly code = "PAYMENT_PROVIDER_UNAVAILABLE";

  constructor() {
    super("Payment provider unavailable");
    this.name = "PaymentProviderUnavailableError";
  }
}

/**
 * 支付 Provider 注册表。未配置时使用线下支付；mock 仅允许带强密钥的
 * 非生产环境本地联调，避免配置漂移后静默接受伪造回调。
 */
export function getPaymentProvider(
  name?: string,
  env: PaymentProviderEnv = process.env,
): PaymentProvider {
  const configured =
    name !== undefined
      ? name
      : env.BILLING_PAYMENT_PROVIDER !== undefined
        ? env.BILLING_PAYMENT_PROVIDER
        : "offline";
  const resolved = configured.trim();
  if (!resolved) {
    throw new PaymentProviderUnavailableError();
  }

  switch (resolved) {
    case "mock": {
      if (
        (env.NODE_ENV !== "test" && env.NODE_ENV !== "development") ||
        env.PAYMENT_PROVIDER_DEFAULT !== "mock"
      ) {
        throw new PaymentProviderUnavailableError();
      }
      try {
        return createMockPaymentProvider({
          secret: env.BILLING_MOCK_WEBHOOK_SECRET ?? "",
        });
      } catch {
        throw new PaymentProviderUnavailableError();
      }
    }
    case "offline":
      return createOfflinePaymentProvider();
    default:
      throw new PaymentProviderUnavailableError();
  }
}
