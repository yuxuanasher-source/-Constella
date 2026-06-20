import type { BillingRepo, OrderRecord, SubscriptionRecord } from "./billing-repo";
import { checkoutIdempotencyKey } from "./checkout";
import { resolvePlanPriceCents } from "./pricing";
import {
  evaluateDunning,
  isPendingOrderExpired,
  shouldGenerateRenewal,
  DEFAULT_GRACE_DAYS,
  DEFAULT_RENEW_LEAD_DAYS,
} from "./subscription-lifecycle";

export type DunningHooks = {
  /** 进入 past_due（试用到期 / 账期到期）时的副作用：通知 + 埋点 + 审计。 */
  onPastDue?: (
    subscription: SubscriptionRecord,
    cause: "trial_expired" | "period_ended",
    graceUntil: string,
  ) => Promise<void>;
  /** 宽限超时进入 readonly 时的副作用。 */
  onReadonly?: (subscription: SubscriptionRecord) => Promise<void>;
};

export type DunningSummary = {
  scanned: number;
  enteredPastDue: string[];
  enteredReadonly: string[];
};

/**
 * 催缴扫描（每日）：把到期 / 试用到期订阅推入 past_due（带宽限），
 * 宽限超时再推入 readonly。状态机推进与现有 isReadOnlyStatus / route-guard 衔接。
 */
export async function runDunningSweep({
  repo,
  now = new Date(),
  graceDays = DEFAULT_GRACE_DAYS,
  hooks,
}: {
  repo: BillingRepo;
  now?: Date;
  graceDays?: number;
  hooks?: DunningHooks;
}): Promise<DunningSummary> {
  const subscriptions = await repo.listLifecycleSubscriptions();
  const summary: DunningSummary = {
    scanned: subscriptions.length,
    enteredPastDue: [],
    enteredReadonly: [],
  };

  for (const subscription of subscriptions) {
    const decision = evaluateDunning({ subscription, now, graceDays });
    if (decision.action === "enter_past_due") {
      await repo.updateSubscription(subscription.organizationId, {
        status: "past_due",
        graceUntil: decision.graceUntil,
      });
      summary.enteredPastDue.push(subscription.organizationId);
      await hooks?.onPastDue?.(subscription, decision.cause, decision.graceUntil);
    } else if (decision.action === "enter_readonly") {
      await repo.updateSubscription(subscription.organizationId, {
        status: "readonly",
      });
      summary.enteredReadonly.push(subscription.organizationId);
      await hooks?.onReadonly?.(subscription);
    }
  }

  return summary;
}

export type RenewalHooks = {
  onRenewalOrder?: (
    subscription: SubscriptionRecord,
    order: OrderRecord,
  ) => Promise<void>;
};

export type RenewalSummary = {
  scanned: number;
  generated: string[];
  skipped: number;
};

/**
 * 续费扫描（每日）：到期前 N 天为开启自动续费的订阅生成一张待支付续费单并通知。
 * 首版不做免密代扣（生成待支付订单 + 通知），用与 checkout 相同的幂等键，
 * 用户再次发起 checkout 时复用同一订单完成支付。若有排期降级则按 pending plan 计费。
 */
export async function runRenewalSweep({
  repo,
  now = new Date(),
  leadDays = DEFAULT_RENEW_LEAD_DAYS,
  hooks,
}: {
  repo: BillingRepo;
  now?: Date;
  leadDays?: number;
  hooks?: RenewalHooks;
}): Promise<RenewalSummary> {
  const subscriptions = await repo.listLifecycleSubscriptions();
  const summary: RenewalSummary = {
    scanned: subscriptions.length,
    generated: [],
    skipped: 0,
  };

  for (const subscription of subscriptions) {
    if (!shouldGenerateRenewal({ subscription, now, leadDays })) {
      continue;
    }
    const planId = subscription.pendingPlanId ?? subscription.planId;
    const cycle = subscription.pendingBillingCycle ?? subscription.billingCycle;
    const plan = await repo.getPlanById(planId);
    const ownerUserId = await repo.getOwnerUserId(subscription.organizationId);
    if (!plan || !ownerUserId) {
      summary.skipped += 1;
      continue;
    }

    const intent = {
      kind: "subscription_renewal" as const,
      target: { planCode: plan.code, billingCycle: cycle },
    };
    const idempotencyKey = checkoutIdempotencyKey(intent, now);
    const existing = await repo.findOrderByIdempotencyKey(
      subscription.organizationId,
      idempotencyKey,
    );
    if (existing) {
      summary.skipped += 1;
      continue;
    }

    const prices = await repo.getPlanPrices(plan.id);
    const amountCents = resolvePlanPriceCents(prices, cycle);
    const planPriceId = await repo.getPlanPriceId(plan.id, cycle);

    const order = await repo.insertOrder({
      organizationId: subscription.organizationId,
      kind: "subscription_renewal",
      amountCents,
      currency: "CNY",
      target: intent.target,
      planId: plan.id,
      planPriceId,
      billingCycle: cycle,
      idempotencyKey,
      createdBy: ownerUserId,
    });
    summary.generated.push(order.id);
    await hooks?.onRenewalOrder?.(subscription, order);
  }

  return summary;
}

export type ExpireOrdersSummary = {
  scanned: number;
  cancelled: string[];
};

/**
 * 待支付订单关闭（每 10 分钟）：超时未支付的 pending 订单置为 cancelled。
 */
export async function runExpirePendingOrdersSweep({
  repo,
  now = new Date(),
}: {
  repo: BillingRepo;
  now?: Date;
}): Promise<ExpireOrdersSummary> {
  const orders = await repo.listPendingOrders();
  const summary: ExpireOrdersSummary = { scanned: orders.length, cancelled: [] };

  for (const order of orders) {
    if (isPendingOrderExpired(order, now)) {
      await repo.updateOrder(order.id, { status: "cancelled" });
      summary.cancelled.push(order.id);
    }
  }

  return summary;
}
