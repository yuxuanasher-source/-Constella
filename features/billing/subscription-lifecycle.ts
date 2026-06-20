import { toDateString } from "./billing-period";
import type { OrderRecord, SubscriptionRecord } from "./billing-repo";

export const DEFAULT_GRACE_DAYS = 7;
export const DEFAULT_RENEW_LEAD_DAYS = 3;

export type DunningDecision =
  | { action: "enter_past_due"; graceUntil: string; cause: "trial_expired" | "period_ended" }
  | { action: "enter_readonly" }
  | { action: "none" };

/**
 * 催缴判定（纯函数，《P6 设计》5.5 dunning）：
 * - trialing 且 trial_ends_at 已过 → past_due + 宽限。
 * - active 且账期已过（current_period_end < 今天）→ past_due + 宽限。
 * - past_due 且 grace_until 已过 → readonly。
 */
export function evaluateDunning({
  subscription,
  now,
  graceDays = DEFAULT_GRACE_DAYS,
}: {
  subscription: SubscriptionRecord;
  now: Date;
  graceDays?: number;
}): DunningDecision {
  const today = toDateString(now);

  if (subscription.status === "trialing") {
    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) <= now) {
      return {
        action: "enter_past_due",
        graceUntil: addDaysIso(now, graceDays),
        cause: "trial_expired",
      };
    }
    return { action: "none" };
  }

  if (subscription.status === "active") {
    if (today > subscription.currentPeriodEnd) {
      return {
        action: "enter_past_due",
        graceUntil: addDaysIso(now, graceDays),
        cause: "period_ended",
      };
    }
    return { action: "none" };
  }

  if (subscription.status === "past_due") {
    if (subscription.graceUntil && new Date(subscription.graceUntil) <= now) {
      return { action: "enter_readonly" };
    }
    return { action: "none" };
  }

  return { action: "none" };
}

/**
 * 是否到了为该订阅生成续费单的时间窗（到期前 leadDays 天内、开启自动续费）。
 */
export function shouldGenerateRenewal({
  subscription,
  now,
  leadDays = DEFAULT_RENEW_LEAD_DAYS,
}: {
  subscription: SubscriptionRecord;
  now: Date;
  leadDays?: number;
}): boolean {
  if (!subscription.autoRenew || subscription.status !== "active") {
    return false;
  }
  const days = daysBetween(toDateString(now), subscription.currentPeriodEnd);
  return days >= 0 && days <= leadDays;
}

/** 待支付订单是否已超时（应被自动关闭为 cancelled）。 */
export function isPendingOrderExpired(order: OrderRecord, now: Date): boolean {
  return (
    order.status === "pending" &&
    !!order.expiresAt &&
    new Date(order.expiresAt) < now
  );
}

function addDaysIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}
