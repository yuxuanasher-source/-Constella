import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentEvent,
  PaymentProvider,
  RefundInput,
  RefundResult,
  StatementEntry,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from "./payment-provider";

const DEFAULT_SECRET = "mock-secret";

/**
 * 确定性 mock 支付 Provider：可在测试与本地联调中跑通完整下单 / 回调链路。
 * 验签用 HMAC-SHA256，回调体须携带与 {@link signMockWebhook} 一致的签名。
 * `statement` 用于对账测试时注入渠道对账文件。
 */
export function createMockPaymentProvider(
  options: { secret?: string; statement?: StatementEntry[] } = {},
): PaymentProvider {
  const secret = options.secret ?? DEFAULT_SECRET;
  const statement = options.statement ?? [];

  return {
    name: "mock",
    async createPayment(
      input: CreatePaymentInput,
    ): Promise<CreatePaymentResult> {
      return {
        provider: "mock",
        channel: input.channel ?? "mock",
        providerTxnId: `mock_pay_${input.orderId}`,
        payParams: {
          type: "qrcode",
          value: `mock://pay/${input.orderId}?amount=${input.amountCents}`,
        },
        expiresAt: input.expiresAt,
      };
    },
    async queryPayment(providerTxnId: string) {
      void providerTxnId;
      return { status: "pending" as const };
    },
    async refund(input: RefundInput): Promise<RefundResult> {
      return {
        provider: "mock",
        refundTxnId: `mock_refund_${input.transactionId}`,
        status: "succeeded",
      };
    },
    verifyWebhook(input: WebhookVerifyInput): WebhookVerifyResult {
      const expected = signMockWebhook(secret, input.rawBody);
      if (!input.signature || !safeEqual(expected, input.signature)) {
        return { verified: false, reason: "signature_mismatch" };
      }

      let parsed: Partial<MockWebhookBody>;
      try {
        parsed = JSON.parse(input.rawBody) as Partial<MockWebhookBody>;
      } catch {
        return { verified: false, reason: "invalid_json" };
      }

      const event = toPaymentEvent(parsed);
      if (!event) {
        return { verified: false, reason: "invalid_event" };
      }
      return { verified: true, event };
    },
    async fetchStatement(date: string): Promise<StatementEntry[]> {
      void date;
      return statement;
    },
  };
}

export type MockWebhookBody = {
  eventId: string;
  type: "payment" | "refund";
  status: "succeeded" | "failed";
  providerTxnId: string;
  orderId: string;
  amountCents: number;
};

export function signMockWebhook(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** 测试 / 联调辅助：构造一条已签名的回调请求体。 */
export function buildSignedMockWebhook(
  body: MockWebhookBody,
  secret: string = DEFAULT_SECRET,
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(body);
  return { rawBody, signature: signMockWebhook(secret, rawBody) };
}

function toPaymentEvent(body: Partial<MockWebhookBody>): PaymentEvent | null {
  if (
    typeof body.eventId !== "string" ||
    typeof body.providerTxnId !== "string" ||
    typeof body.orderId !== "string" ||
    typeof body.amountCents !== "number" ||
    (body.type !== "payment" && body.type !== "refund") ||
    (body.status !== "succeeded" && body.status !== "failed")
  ) {
    return null;
  }
  return {
    eventId: body.eventId,
    type: body.type,
    status: body.status,
    providerTxnId: body.providerTxnId,
    orderId: body.orderId,
    amountCents: body.amountCents,
    raw: body,
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
