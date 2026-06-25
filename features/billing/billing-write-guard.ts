import type { AuthContext } from "@/lib/auth/context";

import { isReadOnlyStatus, type SubscriptionStatus } from "./billing-gates";
import type { UsageStatus } from "./usage-metering";

export type BillingActor = Pick<
  AuthContext,
  "userId" | "name" | "role" | "organizationId"
>;

/**
 * 欠费 / 取消 / 只读订阅拒绝写动作（route-guard 兜底，付费墙只是前端体验层）。
 */
export function assertBillingWriteAllowed(status: SubscriptionStatus): void {
  if (isReadOnlyStatus(status)) {
    const error = new Error(
      "Subscription is read-only; write actions are not allowed",
    );
    error.name = "SubscriptionReadOnlyError";
    throw error;
  }
}

/**
 * 强计量指标（OCR）超额且无加量包时硬阻断该写动作。
 * AI 等软超额指标不在此拦截，只提示加购。
 */
export function assertUsageWriteAllowed(usage: UsageStatus): void {
  if (usage.shouldHardBlock) {
    const error = new Error(
      `Usage limit reached for ${usage.metric}; purchase an add-on to continue`,
    );
    error.name = "UsageHardBlockError";
    throw error;
  }
}
