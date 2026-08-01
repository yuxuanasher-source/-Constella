import { createHash } from "node:crypto";

import { applyPaidOrder } from "./apply-paid-order";
import type { BillingRepo } from "./billing-repo";
import type { BillingAudit } from "./checkout";
import type { PaymentProvider } from "./providers/payment-provider";
import { settleRefund } from "./refunds";

export type WebhookHandleResult = {
  processed: boolean;
  reason?: string;
  orderId?: string;
  verificationFailed?: true;
};

export type WebhookBusinessInvariantReason =
  | "amount_mismatch"
  | "provider_mismatch"
  | "invalid_provider_transaction";

/**
 * 渠道异步回调处理：验签 → 落 billing_webhook_events → 幂等 → 写交易 → 推状态机。
 * 幂等三道闸：webhook(event_id) 唯一、订单 pending→paid 原子翻转、交易渠道单号唯一。
 */
export async function handleWebhook({
  repo,
  provider,
  rawBody,
  signature,
  headers,
  now = new Date(),
  audit,
}: {
  repo: BillingRepo;
  provider: PaymentProvider;
  rawBody: string;
  signature?: string;
  headers?: Record<string, string>;
  now?: Date;
  audit?: BillingAudit;
}): Promise<WebhookHandleResult> {
  const verify = provider.verifyWebhook({ rawBody, signature, headers });

  if (!verify.verified) {
    // 未验签事件只落库不处理（可重放排查）。
    await repo.recordWebhookEvent({
      provider: provider.name,
      eventId: fingerprint(rawBody),
      signatureVerified: false,
      rawPayload: safeParse(rawBody),
    });
    return {
      processed: false,
      reason: verify.reason,
      verificationFailed: true,
    };
  }

  const event = verify.event;
  const record = await repo.recordWebhookEvent({
    provider: provider.name,
    eventId: event.eventId,
    signatureVerified: true,
    rawPayload: event.raw,
    orderId: event.orderId,
  });
  if (record.alreadyProcessed) {
    return { processed: false, reason: "duplicate", orderId: event.orderId };
  }

  const order = await repo.getOrderById(event.orderId);
  if (!order) {
    await repo.markWebhookProcessed(provider.name, event.eventId);
    return {
      processed: false,
      reason: "order_not_found",
      orderId: event.orderId,
    };
  }

  const invariantRejection = businessInvariantRejection({
    provider,
    orderProvider: order.provider,
    event,
    orderAmountCents: order.amountCents,
  });
  if (invariantRejection) {
    if (audit) {
      await audit({
        organizationId: order.organizationId,
        action: "reject",
        module: "billing",
        objectType: "billing_webhook_event",
        reason: invariantRejection,
        result: "failure",
        after: {
          processed: true,
          webhookEventId: event.eventId,
          rejectionReason: invariantRejection,
          orderId: order.id,
          eventType: event.type,
        },
        changedFields: ["processed"],
      });
    }
    await repo.markWebhookProcessed(provider.name, event.eventId);
    return {
      processed: false,
      reason: invariantRejection,
      orderId: order.id,
    };
  }

  if (event.type === "refund") {
    await repo.insertTransaction({
      organizationId: order.organizationId,
      orderId: order.id,
      type: "refund",
      status: event.status,
      amountCents: event.amountCents,
      provider: provider.name,
      providerTxnId: event.providerTxnId,
      providerPayload: asPayload(event.raw),
      succeededAt: event.status === "succeeded" ? now.toISOString() : null,
    });
    if (event.status === "succeeded") {
      await settleRefund({ repo, order, now });
    }
    await repo.markWebhookProcessed(provider.name, event.eventId);
    return { processed: true, orderId: order.id };
  }

  // payment
  if (event.status !== "succeeded") {
    await repo.insertTransaction({
      organizationId: order.organizationId,
      orderId: order.id,
      type: "payment",
      status: "failed",
      amountCents: event.amountCents,
      provider: provider.name,
      providerTxnId: event.providerTxnId,
      providerPayload: asPayload(event.raw),
      failureReason: "provider_reported_failure",
    });
    await repo.updateOrder(order.id, { status: "failed" });
    await repo.markWebhookProcessed(provider.name, event.eventId);
    return { processed: true, orderId: order.id };
  }

  const paidAt = now.toISOString();
  const transition = await repo.markOrderPaid(order.id, paidAt);
  if (!transition.transitioned) {
    await repo.markWebhookProcessed(provider.name, event.eventId);
    return { processed: false, reason: "already_paid", orderId: order.id };
  }

  await repo.insertTransaction({
    organizationId: order.organizationId,
    orderId: order.id,
    type: "payment",
    status: "succeeded",
    amountCents: event.amountCents,
    provider: provider.name,
    providerTxnId: event.providerTxnId,
    providerPayload: asPayload(event.raw),
    succeededAt: paidAt,
  });

  await applyPaidOrder({
    repo,
    order: { ...order, status: "paid", paidAt },
    now,
  });

  if (audit) {
    await audit({
      organizationId: order.organizationId,
      action: "update",
      module: "billing",
      objectType: "billing_order",
      objectId: order.id,
      after: {
        status: "paid",
        kind: order.kind,
        amountCents: order.amountCents,
      },
      changedFields: ["status"],
    });
  }

  await repo.markWebhookProcessed(provider.name, event.eventId);
  return { processed: true, orderId: order.id };
}

function businessInvariantRejection({
  provider,
  orderProvider,
  event,
  orderAmountCents,
}: {
  provider: PaymentProvider;
  orderProvider?: string | null;
  event: {
    type: "payment" | "refund";
    status: "succeeded" | "failed";
    providerTxnId: string;
    amountCents: number;
  };
  orderAmountCents: number;
}): WebhookBusinessInvariantReason | null {
  if (!orderProvider || orderProvider !== provider.name) {
    return "provider_mismatch";
  }
  if (!event.providerTxnId.trim()) {
    return "invalid_provider_transaction";
  }
  if (
    event.type === "payment" &&
    event.status === "succeeded" &&
    event.amountCents !== orderAmountCents
  ) {
    return "amount_mismatch";
  }
  return null;
}

function fingerprint(rawBody: string): string {
  return `unverified_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

function safeParse(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return { raw: rawBody };
  }
}

function asPayload(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : { value: raw };
}
