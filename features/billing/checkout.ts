import { randomUUID } from "node:crypto";

import type { AuditLogInput } from "@/lib/audit/audit";

import type {
  BillingRepo,
  OrderRecord,
  PlanRecord,
  SubscriptionRecord,
} from "./billing-repo";
import { periodMonthOf, toDateString } from "./billing-period";
import type { BillingActor } from "./billing-write-guard";
import type {
  BillingCycle,
  BillingOrderKind,
  CheckoutIntent,
  OrderTarget,
} from "./order-types";
import {
  computeFeatureAddonAmountCents,
  computeUsageAddonAmountCents,
  resolvePlanPriceCents,
} from "./pricing";
import { computeUpgradeProrationCents } from "./proration";
import type {
  PaymentParams,
  PaymentProvider,
} from "./providers/payment-provider";

const ORDER_TTL_MS = 15 * 60 * 1000;

export type CheckoutResult = {
  order: OrderRecord;
  payParams: PaymentParams;
  provider: string;
  providerTxnId: string;
  reused: boolean;
};

export type BillingAudit = (input: AuditLogInput) => Promise<void>;

/**
 * 创建订单并预下单。金额一律服务端按 billing_plan_prices / 加量单价计算，
 * 前端只传意图。幂等：同一意图（org + idempotency_key）复用未支付订单。
 */
export async function createCheckoutOrder({
  repo,
  provider,
  actor,
  intent,
  now = new Date(),
  audit,
}: {
  repo: BillingRepo;
  provider: PaymentProvider;
  actor: BillingActor;
  intent: CheckoutIntent;
  now?: Date;
  audit?: BillingAudit;
}): Promise<CheckoutResult> {
  const subscription = await repo.getSubscription(actor.organizationId);
  const resolved = await resolveOrderAmount({ repo, intent, subscription, now });
  const idempotencyKey = checkoutIdempotencyKey(intent, now);

  const existing = await repo.findOrderByIdempotencyKey(
    actor.organizationId,
    idempotencyKey,
  );

  if (existing && existing.status === "pending") {
    const pay = await provider.createPayment({
      orderId: existing.id,
      amountCents: existing.amountCents,
      currency: existing.currency,
      subject: orderSubject(intent),
      expiresAt: existing.expiresAt ?? undefined,
    });
    await repo.updateOrder(existing.id, { provider: pay.provider });
    return {
      order: existing,
      payParams: pay.payParams,
      provider: pay.provider,
      providerTxnId: pay.providerTxnId,
      reused: true,
    };
  }

  if (existing && existing.status !== "pending") {
    throw new Error("An order for this intent has already been processed");
  }

  const orderId = randomUUID();
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS).toISOString();
  const order = await repo.insertOrder({
    id: orderId,
    organizationId: actor.organizationId,
    kind: intent.kind,
    status: "pending",
    amountCents: resolved.amountCents,
    currency: "CNY",
    target: intent.target,
    planId: resolved.planId,
    planPriceId: resolved.planPriceId,
    billingCycle: resolved.billingCycle,
    idempotencyKey,
    expiresAt,
    createdBy: actor.userId,
  });

  const pay = await provider.createPayment({
    orderId: order.id,
    amountCents: order.amountCents,
    currency: order.currency,
    subject: orderSubject(intent),
    expiresAt,
  });

  await repo.updateOrder(order.id, { provider: pay.provider });
  await repo.insertTransaction({
    organizationId: actor.organizationId,
    orderId: order.id,
    type: "payment",
    status: "created",
    amountCents: order.amountCents,
    provider: pay.provider,
    providerTxnId: pay.providerTxnId,
  });

  if (audit) {
    await audit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "create",
      module: "billing",
      objectType: "billing_order",
      objectId: order.id,
      after: {
        kind: order.kind,
        amountCents: order.amountCents,
        planId: order.planId,
        billingCycle: order.billingCycle,
      },
      changedFields: ["kind", "amount_cents"],
    });
  }

  return {
    order: { ...order, provider: pay.provider },
    payParams: pay.payParams,
    provider: pay.provider,
    providerTxnId: pay.providerTxnId,
    reused: false,
  };
}

type ResolvedAmount = {
  amountCents: number;
  planId?: string | null;
  planPriceId?: string | null;
  billingCycle?: BillingCycle | null;
};

async function resolveOrderAmount({
  repo,
  intent,
  subscription,
  now,
}: {
  repo: BillingRepo;
  intent: CheckoutIntent;
  subscription: SubscriptionRecord | null;
  now: Date;
}): Promise<ResolvedAmount> {
  switch (intent.kind) {
    case "usage_addon": {
      const metric = requireMetric(intent.target);
      const quantity = requireQuantity(intent.target);
      return {
        amountCents: computeUsageAddonAmountCents(metric, quantity),
      };
    }
    case "feature_addon": {
      const featureKey = requireFeatureKey(intent.target);
      return { amountCents: computeFeatureAddonAmountCents(featureKey) };
    }
    case "subscription_downgrade": {
      const { plan, cycle } = await resolveTargetPlan(repo, intent.target);
      const priceId = await repo.getPlanPriceId(plan.id, cycle);
      return {
        amountCents: 0,
        planId: plan.id,
        planPriceId: priceId,
        billingCycle: cycle,
      };
    }
    case "subscription_upgrade": {
      const { plan, cycle } = await resolveTargetPlan(repo, intent.target);
      const priceId = await repo.getPlanPriceId(plan.id, cycle);
      const newPrices = await repo.getPlanPrices(plan.id);
      const newPriceCents = resolvePlanPriceCents(newPrices, cycle);
      const oldPriceCents = await resolveCurrentPlanPriceCents(
        repo,
        subscription,
        cycle,
      );
      const proration = computeUpgradeProrationCents({
        oldPriceCents,
        newPriceCents,
        periodStart: subscription?.currentPeriodStart ?? toDateString(now),
        periodEnd: subscription?.currentPeriodEnd ?? toDateString(now),
        now,
      });
      return {
        amountCents: proration.amountCents,
        planId: plan.id,
        planPriceId: priceId,
        billingCycle: cycle,
      };
    }
    case "subscription_new":
    case "subscription_renewal":
    default: {
      const { plan, cycle } = await resolveTargetPlan(repo, intent.target);
      const prices = await repo.getPlanPrices(plan.id);
      const priceId = await repo.getPlanPriceId(plan.id, cycle);
      return {
        amountCents: resolvePlanPriceCents(prices, cycle),
        planId: plan.id,
        planPriceId: priceId,
        billingCycle: cycle,
      };
    }
  }
}

async function resolveTargetPlan(
  repo: BillingRepo,
  target: OrderTarget,
): Promise<{ plan: PlanRecord; cycle: BillingCycle }> {
  if (!target.planCode) {
    throw new Error("Subscription order requires target.planCode");
  }
  const plan = await repo.getPlanByCode(target.planCode);
  if (!plan) {
    throw new Error(`Unknown plan: ${target.planCode}`);
  }
  return { plan, cycle: target.billingCycle ?? "monthly" };
}

async function resolveCurrentPlanPriceCents(
  repo: BillingRepo,
  subscription: SubscriptionRecord | null,
  cycle: BillingCycle,
): Promise<number> {
  if (!subscription) {
    return 0;
  }
  const prices = await repo.getPlanPrices(subscription.planId);
  try {
    return resolvePlanPriceCents(prices, cycle);
  } catch {
    return 0;
  }
}

/**
 * 下单幂等键。续费定时任务用同一规则生成订单，使前端再次发起 checkout 时
 * 能复用同一未支付订单（cron 生成 → 用户付款 的衔接）。
 */
export function checkoutIdempotencyKey(intent: CheckoutIntent, now: Date): string {
  const month = periodMonthOf(now);
  switch (intent.kind) {
    case "usage_addon":
      return `usage_addon:${intent.target.metric}:${intent.target.quantity}:${month}`;
    case "feature_addon":
      return `feature_addon:${intent.target.featureKey}:${month}`;
    default:
      return `${intent.kind}:${intent.target.planCode}:${intent.target.billingCycle ?? "monthly"}:${month}`;
  }
}

function orderSubject(intent: CheckoutIntent): string {
  const labels: Record<BillingOrderKind, string> = {
    subscription_new: "订阅开通",
    subscription_renewal: "订阅续费",
    subscription_upgrade: "订阅升级",
    subscription_downgrade: "订阅降级",
    usage_addon: "用量加量包",
    feature_addon: "功能加购",
  };
  return labels[intent.kind];
}

function requireMetric(target: OrderTarget) {
  if (!target.metric) {
    throw new Error("usage_addon requires target.metric");
  }
  return target.metric;
}

function requireQuantity(target: OrderTarget): number {
  if (!target.quantity || target.quantity <= 0) {
    throw new Error("usage_addon requires a positive target.quantity");
  }
  return Math.trunc(target.quantity);
}

function requireFeatureKey(target: OrderTarget): string {
  if (!target.featureKey) {
    throw new Error("feature_addon requires target.featureKey");
  }
  return target.featureKey;
}
