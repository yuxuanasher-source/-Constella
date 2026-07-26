import { advancePeriod, periodMonthOf, toDateString } from "./billing-period";
import {
  planIncludedQuantities,
  type BillingRepo,
  type OrderRecord,
} from "./billing-repo";
import type { BillingActor } from "./billing-write-guard";
import type { BillingAudit } from "./checkout";
import type { OrderTarget } from "./order-types";
import type { PaymentProvider } from "./providers/payment-provider";
import type { UsageMetric } from "./usage-metering";

export type RefundResultSummary = {
  orderId: string;
  status: "refunding" | "refunded";
  refundTxnId: string;
};

export type RefundNotify = (
  order: OrderRecord,
  settled: boolean,
) => Promise<void>;

/**
 * 申请退款（owner，需 reason）。校验可退 → 调 Provider 退款 → 写退款流水。
 * 同步成功（mock）立即回滚业务；异步渠道由退款回调 {@link settleRefund} 收尾。
 * 资金高风险动作：必须 reason + 高风险审计。
 */
export async function requestRefund({
  repo,
  provider,
  actor,
  orderId,
  reason,
  now = new Date(),
  audit,
  notify,
}: {
  repo: BillingRepo;
  provider: PaymentProvider;
  actor: BillingActor;
  orderId: string;
  reason: string;
  now?: Date;
  audit?: BillingAudit;
  notify?: RefundNotify;
}): Promise<RefundResultSummary> {
  const order = await repo.getOrderById(orderId);
  if (!order || order.organizationId !== actor.organizationId) {
    throw new Error("Order not found");
  }
  const result = await requestRefundCore({
    repo,
    provider,
    organizationId: actor.organizationId,
    orderId,
    amountCents: order.amountCents,
    reason,
    now,
  });
  const settled = result.status === "refunded";

  if (audit) {
    await audit({
      organizationId: order.organizationId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "void",
      module: "billing",
      objectType: "billing_order",
      objectId: order.id,
      reason,
      isHighRisk: true,
      after: { status: settled ? "refunded" : "refunding", kind: order.kind },
      changedFields: ["status"],
    });
  }
  if (notify) {
    await notify(order, settled);
  }

  return result;
}

/**
 * 不含租户角色判断与租户审计的退款核心。调用方必须显式传入组织边界；
 * 机构入口和平台入口分别在外围完成各自授权与审计。
 */
export async function requestRefundCore({
  repo,
  provider,
  organizationId,
  orderId,
  amountCents,
  refundExternalReference,
  reason,
  now = new Date(),
}: {
  repo: BillingRepo;
  provider: PaymentProvider;
  organizationId: string;
  orderId: string;
  amountCents?: number;
  refundExternalReference?: string;
  reason: string;
  now?: Date;
}): Promise<RefundResultSummary> {
  if (!reason?.trim()) {
    throw new Error("Refund requires a reason");
  }

  const order = await repo.getOrderById(orderId);
  if (!order || order.organizationId !== organizationId) {
    throw new Error("Order not found");
  }
  if (order.status !== "paid") {
    throw new Error("Only paid orders can be refunded");
  }
  const refundableAmount = amountCents ?? order.amountCents;
  if (
    !Number.isInteger(refundableAmount) ||
    refundableAmount <= 0 ||
    refundableAmount !== order.amountCents
  ) {
    throw new Error(
      "Refund amount must equal the full refundable order amount",
    );
  }

  await assertRefundable({ repo, order, now });

  const payment = await repo.getOrderPaymentTransaction(order.id);
  if (!payment?.providerTxnId || payment.amountCents < refundableAmount) {
    throw new Error("No settled payment transaction to refund");
  }

  await repo.updateOrder(order.id, { status: "refunding" });

  const refund = await provider.refund({
    orderId: order.id,
    transactionId: payment.providerTxnId,
    providerTxnId: payment.providerTxnId,
    amountCents: refundableAmount,
    reason,
    refundExternalReference,
  });

  await repo.insertTransaction({
    organizationId: order.organizationId,
    orderId: order.id,
    type: "refund",
    status: refund.status,
    amountCents: refundableAmount,
    provider: refund.provider,
    providerTxnId: refund.refundTxnId,
    failureReason: refund.status === "failed" ? "provider_refund_failed" : null,
    succeededAt: refund.status === "succeeded" ? now.toISOString() : null,
  });

  let settled = false;
  if (refund.status === "succeeded") {
    settled = (
      await settleRefund({
        repo,
        order: { ...order, status: "refunding" },
        now,
      })
    ).applied;
  }

  return {
    orderId: order.id,
    status: settled ? "refunded" : "refunding",
    refundTxnId: refund.refundTxnId,
  };
}

/**
 * 退款收尾（同步成功或异步回调成功时）。原子翻转 refunding→refunded，
 * 只生效一次，然后按订单类型回滚业务。
 */
export async function settleRefund({
  repo,
  order,
  now = new Date(),
}: {
  repo: BillingRepo;
  order: OrderRecord;
  now?: Date;
}): Promise<{ applied: boolean }> {
  const transition = await repo.markOrderRefunded(order.id);
  if (!transition.transitioned) {
    return { applied: false };
  }
  await applyRefund({ repo, order, now });
  return { applied: true };
}

/** 退款前置校验：用量加量包若已被消耗则拒绝退款（不可把额度改负）。 */
export async function assertRefundable({
  repo,
  order,
  now,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  now: Date;
}): Promise<void> {
  if (order.kind !== "usage_addon") {
    return;
  }
  const metric = requireMetric(order.target);
  const quantity = requireQuantity(order.target);
  const periodMonth = periodMonthOf(order.paidAt ?? now);
  const counter = await repo.getUsageCounter(order.organizationId, metric, periodMonth);
  const addon = counter?.addonQuantity ?? 0;
  const used = counter?.usedQuantity ?? 0;
  const included = counter?.includedQuantity ?? 0;
  const unusedAddon = Math.max(0, Math.min(addon, included + addon - used));
  if (unusedAddon < quantity) {
    throw new Error("Usage add-on already consumed; cannot refund");
  }
}

async function applyRefund({
  repo,
  order,
  now,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  now: Date;
}): Promise<void> {
  switch (order.kind) {
    case "subscription_new":
    case "subscription_renewal":
    case "subscription_upgrade": {
      const freePlan = await repo.getPlanByCode("free");
      await repo.updateSubscription(order.organizationId, {
        status: "cancelled",
        ...(freePlan ? { planId: freePlan.id } : {}),
      });
      if (freePlan) {
        const included = planIncludedQuantities(freePlan);
        const periodMonth = periodMonthOf(now);
        for (const metric of Object.keys(included) as UsageMetric[]) {
          await repo.upsertUsageCounter({
            organizationId: order.organizationId,
            metric,
            periodMonth,
            includedQuantity: included[metric],
          });
        }
      }
      break;
    }
    case "usage_addon": {
      const metric = requireMetric(order.target);
      const quantity = requireQuantity(order.target);
      await repo.upsertUsageCounter({
        organizationId: order.organizationId,
        metric,
        periodMonth: periodMonthOf(order.paidAt ?? now),
        addonQuantityDelta: -quantity,
      });
      break;
    }
    case "feature_addon": {
      if (!order.target.featureKey) {
        break;
      }
      const subscription = await repo.getSubscription(order.organizationId);
      const periodStart = subscription?.currentPeriodStart ?? toDateString(now);
      const periodEnd =
        subscription?.currentPeriodEnd ?? advancePeriod(periodStart, "monthly");
      await repo.upsertFeatureAddon({
        organizationId: order.organizationId,
        featureKey: order.target.featureKey,
        amountCents: 0,
        enabled: false,
        periodStart,
        periodEnd,
      });
      break;
    }
    default:
      break;
  }
}

function requireMetric(target: OrderTarget): UsageMetric {
  if (!target.metric) {
    throw new Error("usage_addon order requires target.metric");
  }
  return target.metric;
}

function requireQuantity(target: OrderTarget): number {
  if (!target.quantity || target.quantity <= 0) {
    throw new Error("usage_addon order requires a positive target.quantity");
  }
  return Math.trunc(target.quantity);
}
