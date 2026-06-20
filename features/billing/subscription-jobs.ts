import type { BillingRepo, SubscriptionRecord } from "./billing-repo";
import {
  evaluateDunning,
  isPendingOrderExpired,
  DEFAULT_GRACE_DAYS,
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
