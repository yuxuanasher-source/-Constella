import type { BillingFeatureKey } from "@/features/billing/billing-gates";
import type { BillingStatus } from "@/features/billing/billing-status";
import type { UsageMetric } from "@/features/billing/usage-metering";

export type PaywallReason =
  | "feature_not_entitled"
  | "usage_near_limit"
  | "usage_hard_block"
  | "trial_ending"
  | "trial_expired";

export type PaywallDecision = {
  reason: PaywallReason;
  blocking: boolean;
  featureKey?: BillingFeatureKey;
  metric?: UsageMetric;
};

export type PaywallContext = {
  featureKey?: BillingFeatureKey;
  metric?: UsageMetric;
  now?: Date;
  trialEndingThresholdDays?: number;
  nearLimitRatio?: number;
};

const DEFAULT_TRIAL_THRESHOLD_DAYS = 3;
const DEFAULT_NEAR_LIMIT_RATIO = 0.8;

/**
 * 纯函数：从后端 getBillingStatus 结论 + 访问上下文推导付费墙原因。
 * 付费墙只是体验层；真正的权限与额度由 billing-gates / route-guard / metering 兜底。
 * 前端不自行判断权限，只渲染此结论。
 */
export function resolvePaywall(
  status: BillingStatus,
  context: PaywallContext = {},
): PaywallDecision | null {
  // 1. 只读（试用到期 / 欠费）—— 全局硬墙
  if (status.mode === "read_only") {
    return { reason: "trial_expired", blocking: true };
  }

  // 2. 访问未授权功能
  if (context.featureKey && !status.entitlements[context.featureKey]) {
    return {
      reason: "feature_not_entitled",
      blocking: true,
      featureKey: context.featureKey,
    };
  }

  // 3. 用量硬墙 / 接近额度
  if (context.metric) {
    const usage = status.usage.find((item) => item.metric === context.metric);
    if (usage?.shouldHardBlock) {
      return {
        reason: "usage_hard_block",
        blocking: true,
        metric: context.metric,
      };
    }
    if (usage && isNearLimit(usage, context.nearLimitRatio)) {
      return {
        reason: "usage_near_limit",
        blocking: false,
        metric: context.metric,
      };
    }
  }

  // 4. 试用临近到期
  if (
    status.subscriptionStatus === "trialing" &&
    isTrialEnding(
      status.trialEndsAt,
      context.now ?? new Date(),
      context.trialEndingThresholdDays ?? DEFAULT_TRIAL_THRESHOLD_DAYS,
    )
  ) {
    return { reason: "trial_ending", blocking: false };
  }

  return null;
}

function isNearLimit(
  usage: BillingStatus["usage"][number],
  ratio = DEFAULT_NEAR_LIMIT_RATIO,
): boolean {
  if (usage.allowanceQuantity <= 0) {
    return usage.usedQuantity > 0;
  }
  return usage.usedQuantity / usage.allowanceQuantity >= ratio;
}

function isTrialEnding(
  trialEndsAt: string | null,
  now: Date,
  thresholdDays: number,
): boolean {
  if (!trialEndsAt) {
    return false;
  }
  const ends = new Date(trialEndsAt).getTime();
  const diffDays = (ends - now.getTime()) / 86_400_000;
  return diffDays >= 0 && diffDays <= thresholdDays;
}
