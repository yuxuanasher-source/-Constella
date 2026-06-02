import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isReadOnlyStatus,
  resolvePlanEntitlements,
  type BillingPlanTier,
  type SubscriptionStatus,
} from "./billing-gates";
import {
  calculateUsageStatus,
  getUsagePeriodMonth,
  type UsageMetric,
  type UsageStatus,
} from "./usage-metering";

export type BillingStatus = {
  subscriptionStatus: SubscriptionStatus;
  mode: "active" | "read_only";
  plan: {
    tier: BillingPlanTier;
    code: string;
    name: string;
  };
  entitlements: ReturnType<typeof resolvePlanEntitlements>;
  usage: UsageStatus[];
};

export function buildBillingStatus({
  subscription,
  featureAddons,
  usageCounters,
}: {
  subscription: {
    status: SubscriptionStatus;
    plan: {
      tier: BillingPlanTier;
      code: string;
      name: string;
    };
  };
  featureAddons: Array<{ featureKey: string; enabled: boolean }>;
  usageCounters: Array<{
    metric: UsageMetric;
    usedQuantity: number;
    includedQuantity: number;
    addonQuantity: number;
  }>;
}): BillingStatus {
  const entitlements = resolvePlanEntitlements({
    planTier: subscription.plan.tier,
    featureAddons,
  });

  return {
    subscriptionStatus: subscription.status,
    mode: isReadOnlyStatus(subscription.status) ? "read_only" : "active",
    plan: subscription.plan,
    entitlements,
    usage: usageCounters.map((counter) =>
      calculateUsageStatus({
        metric: counter.metric,
        usedQuantity: counter.usedQuantity,
        includedQuantity: counter.includedQuantity,
        addonQuantity: counter.addonQuantity,
      }),
    ),
  };
}

type SubscriptionRow = {
  status: SubscriptionStatus;
  billing_plans:
    | {
        tier: BillingPlanTier;
        code: string;
        name: string;
      }
    | Array<{
        tier: BillingPlanTier;
        code: string;
        name: string;
      }>
    | null;
};

type FeatureAddonRow = {
  feature_key: string;
  enabled: boolean;
};

type UsageCounterRow = {
  metric: UsageMetric;
  used_quantity: number;
  included_quantity: number;
  addon_quantity: number;
};

export async function getBillingStatus({
  client,
  organizationId,
  now = new Date(),
}: {
  client: SupabaseClient;
  organizationId: string;
  now?: Date;
}): Promise<BillingStatus> {
  const { data: subscription } = await client
    .from("organization_subscriptions")
    .select("status, billing_plans(tier, code, name)")
    .eq("organization_id", organizationId)
    .maybeSingle<SubscriptionRow>();
  const { data: featureAddons } = await client
    .from("feature_addons")
    .select("feature_key, enabled")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .returns<FeatureAddonRow[]>();
  const { data: counters } = await client
    .from("usage_monthly_counters")
    .select("metric, used_quantity, included_quantity, addon_quantity")
    .eq("organization_id", organizationId)
    .eq("period_month", getUsagePeriodMonth(now))
    .returns<UsageCounterRow[]>();

  const plan = Array.isArray(subscription?.billing_plans)
    ? subscription?.billing_plans[0]
    : subscription?.billing_plans;

  return buildBillingStatus({
    subscription: {
      status: subscription?.status ?? "trialing",
      plan: plan ?? {
        tier: "free",
        code: "free",
        name: "免费版",
      },
    },
    featureAddons: (featureAddons ?? []).map((addon) => ({
      featureKey: addon.feature_key,
      enabled: addon.enabled,
    })),
    usageCounters: (counters ?? []).map((counter) => ({
      metric: counter.metric,
      usedQuantity: counter.used_quantity,
      includedQuantity: counter.included_quantity,
      addonQuantity: counter.addon_quantity,
    })),
  });
}
