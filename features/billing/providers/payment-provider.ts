/**
 * PaymentProvider 适配层契约。编排与 Provider 分离：
 * 订单编排（写 billing_orders、算金额、推订阅）是纯业务，不直连支付 SDK；
 * Provider 只负责「预下单 / 查单 / 退款 / 验签」。
 *
 * mock 实现用于测试与未签约前的本地联调；持牌聚合支付实现后续替换，
 * 不改动编排层。
 */

export type PaymentChannel = "wechat" | "alipay" | "mock";

export type CreatePaymentInput = {
  orderId: string;
  amountCents: number;
  currency: string;
  subject: string;
  channel?: PaymentChannel;
  expiresAt?: string;
};

export type PaymentParams = {
  type: "qrcode" | "redirect" | "none";
  value: string;
};

export type CreatePaymentResult = {
  provider: string;
  channel: PaymentChannel;
  providerTxnId: string;
  payParams: PaymentParams;
  expiresAt?: string;
};

export type PaymentQueryStatus = "pending" | "succeeded" | "failed";

export type RefundInput = {
  orderId: string;
  transactionId: string;
  providerTxnId: string;
  amountCents: number;
  reason: string;
  refundExternalReference?: string;
};

export type RefundResult = {
  provider: string;
  refundTxnId: string;
  status: "succeeded" | "failed";
};

export type WebhookVerifyInput = {
  rawBody: string;
  signature?: string;
  headers?: Record<string, string>;
};

export type PaymentEvent = {
  eventId: string;
  type: "payment" | "refund";
  status: "succeeded" | "failed";
  providerTxnId: string;
  orderId: string;
  amountCents: number;
  raw: unknown;
};

export type WebhookVerifyResult =
  | { verified: false; reason: string }
  | { verified: true; event: PaymentEvent };

export type StatementEntry = {
  providerTxnId: string;
  amountCents: number;
};

export type PaymentProvider = {
  name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  queryPayment(providerTxnId: string): Promise<{ status: PaymentQueryStatus }>;
  refund(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(input: WebhookVerifyInput): WebhookVerifyResult;
  /** 拉取某日渠道对账文件（单号级金额）。适配层预留各渠道 parser。 */
  fetchStatement(date: string): Promise<StatementEntry[]>;
};
