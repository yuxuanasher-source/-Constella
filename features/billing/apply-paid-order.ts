import type { SubscriptionStatus } from "./billing-gates";
import {
  planIncludedQuantities,
  type BillingRepo,
  type OrderRecord,
  type PlanRecord,
  type SubscriptionRecord,
} from "./billing-repo";
import { advancePeriod, periodMonthOf, toDateString } from "./billing-period";
import type { OrderTarget } from "./order-types";
import type { UsageMetric } from "./usage-metering";

export type ApplyPaidOrderResult = {
  applied: boolean;
  subscriptionStatus?: SubscriptionStatus;
};

/**
 * 把一笔已支付订单应用到订阅 / 加量 / 加购上，幂等。
 * 状态机推进只发生在这里（用户主动动作与 webhook 回调最终都汇聚于此）。
 */
export async function applyPaidOrder({
  repo,
  order,
  now = new Date(),
}: {
  repo: BillingRepo;
  order: OrderRecord;
  now?: Date;
}): Promise<ApplyPaidOrderResult> {
  const subscription = await repo.getSubscription(order.organizationId);

  switch (order.kind) {
    case "subscription_new":
    case "subscription_renewal":
    case "subscription_upgrade":
      return applySubscriptionActivation({ repo, order, subscription, now });
    case "subscription_downgrade":
      return applyDowngradeSchedule({ repo, order, subscription });
    case "usage_addon":
      return applyUsageAddon({ repo, order, now });
    case "feature_addon":
      return applyFeatureAddon({ repo, order, subscription, now });
    default:
      return { applied: false };
  }
}

async function applySubscriptionActivation({
  repo,
  order,
  subscription,
  now,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  subscription: SubscriptionRecord | null;
  now: Date;
}): Promise<ApplyPaidOrderResult> {
  const plan = await resolveOrderPlan(repo, order);
  const cycle = order.billingCycle ?? subscription?.billingCycle ?? "monthly";

  // 续费：从原账期末顺延；新订阅 / 升级：从今天起算。
  const today = toDateString(now);
  const start =
    order.kind === "subscription_renewal" && subscription
      ? subscription.currentPeriodEnd
      : today;
  const end = advancePeriod(start, cycle);

  await repo.updateSubscription(order.organizationId, {
    planId: plan.id,
    status: "active",
    billingCycle: cycle,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    graceUntil: null,
    pendingPlanId: null,
    pendingBillingCycle: null,
    lastOrderId: order.id,
  });

  await recomputeIncludedCounters(repo, order.organizationId, plan, now);

  return { applied: true, subscriptionStatus: "active" };
}

async function applyDowngradeSchedule({
  repo,
  order,
  subscription,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  subscription: SubscriptionRecord | null;
}): Promise<ApplyPaidOrderResult> {
  const plan = await resolveOrderPlan(repo, order);
  await repo.updateSubscription(order.organizationId, {
    pendingPlanId: plan.id,
    pendingBillingCycle: order.billingCycle ?? subscription?.billingCycle ?? "monthly",
    lastOrderId: order.id,
  });
  return { applied: true, subscriptionStatus: subscription?.status };
}

async function applyUsageAddon({
  repo,
  order,
  now,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  now: Date;
}): Promise<ApplyPaidOrderResult> {
  const metric = requireMetric(order.target);
  const quantity = requireQuantity(order.target);
  const { periodStart, periodEnd } = currentMonthWindow(now);

  await repo.insertUsageAddon({
    organizationId: order.organizationId,
    metric,
    quantity,
    amountCents: order.amountCents,
    periodStart,
    periodEnd,
  });

  await repo.upsertUsageCounter({
    organizationId: order.organizationId,
    metric,
    periodMonth: periodMonthOf(now),
    addonQuantityDelta: quantity,
  });

  return { applied: true };
}

async function applyFeatureAddon({
  repo,
  order,
  subscription,
  now,
}: {
  repo: BillingRepo;
  order: OrderRecord;
  subscription: SubscriptionRecord | null;
  now: Date;
}): Promise<ApplyPaidOrderResult> {
  const featureKey = order.target.featureKey;
  if (!featureKey) {
    throw new Error("feature_addon order requires target.featureKey");
  }
  const periodStart = subscription?.currentPeriodStart ?? toDateString(now);
  const periodEnd = subscription?.currentPeriodEnd ?? advancePeriod(periodStart, "monthly");

  await repo.upsertFeatureAddon({
    organizationId: order.organizationId,
    featureKey,
    amountCents: order.amountCents,
    enabled: true,
    periodStart,
    periodEnd,
  });

  return { applied: true };
}

async function recomputeIncludedCounters(
  repo: BillingRepo,
  organizationId: string,
  plan: PlanRecord,
  now: Date,
): Promise<void> {
  const included = planIncludedQuantities(plan);
  const periodMonth = periodMonthOf(now);
  for (const metric of Object.keys(included) as UsageMetric[]) {
    await repo.upsertUsageCounter({
      organizationId,
      metric,
      periodMonth,
      includedQuantity: included[metric],
    });
  }
}

async function resolveOrderPlan(
  repo: BillingRepo,
  order: OrderRecord,
): Promise<PlanRecord> {
  if (order.planId) {
    const byId = await repo.getPlanById(order.planId);
    if (byId) {
      return byId;
    }
  }
  if (order.target.planCode) {
    const byCode = await repo.getPlanByCode(order.target.planCode);
    if (byCode) {
      return byCode;
    }
  }
  throw new Error("Order is not associated with a plan");
}

function currentMonthWindow(now: Date): {
  periodStart: string;
  periodEnd: string;
} {
  const periodStart = periodMonthOf(now);
  const start = new Date(periodStart);
  const periodEnd = toDateString(
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)),
  );
  return { periodStart, periodEnd };
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
