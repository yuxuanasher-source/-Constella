import type { FunnelEventName } from "./funnel-events";

export type FunnelEventRow = {
  event: string;
  reason?: string | null;
};

export type FunnelMetrics = {
  counts: Record<string, number>;
  totals: {
    signupCompleted: number;
    activated: number;
    firstSettlementBatch: number;
    paywallShown: number;
    paywallClicked: number;
    checkoutStarted: number;
    subscriptionActivated: number;
  };
  rates: {
    activationRate: number;
    paywallCtr: number;
    checkoutConversion: number;
    trialToPaid: number;
  };
  paywallReasons: Record<string, number>;
};

const TRACKED_EVENTS: FunnelEventName[] = [
  "landing_view",
  "pricing_view",
  "signup_started",
  "signup_completed",
  "onboarding_step_completed",
  "activated",
  "first_settlement_batch",
  "paywall_shown",
  "paywall_cta_clicked",
  "checkout_started",
  "subscription_activated",
  "trial_ending_notified",
  "trial_expired",
];

/**
 * 把漏斗事件聚合成「注册 → 激活 → Aha → 付费」转化看板数据（纯函数）。
 */
export function aggregateFunnel(events: FunnelEventRow[]): FunnelMetrics {
  const counts: Record<string, number> = {};
  for (const name of TRACKED_EVENTS) {
    counts[name] = 0;
  }
  const paywallReasons: Record<string, number> = {};

  for (const event of events) {
    counts[event.event] = (counts[event.event] ?? 0) + 1;
    if (
      (event.event === "paywall_shown" || event.event === "paywall_cta_clicked") &&
      event.reason
    ) {
      paywallReasons[event.reason] = (paywallReasons[event.reason] ?? 0) + 1;
    }
  }

  const totals = {
    signupCompleted: counts.signup_completed ?? 0,
    activated: counts.activated ?? 0,
    firstSettlementBatch: counts.first_settlement_batch ?? 0,
    paywallShown: counts.paywall_shown ?? 0,
    paywallClicked: counts.paywall_cta_clicked ?? 0,
    checkoutStarted: counts.checkout_started ?? 0,
    subscriptionActivated: counts.subscription_activated ?? 0,
  };

  return {
    counts,
    totals,
    rates: {
      activationRate: ratio(totals.activated, totals.signupCompleted),
      paywallCtr: ratio(totals.paywallClicked, totals.paywallShown),
      checkoutConversion: ratio(
        totals.subscriptionActivated,
        totals.checkoutStarted,
      ),
      trialToPaid: ratio(totals.subscriptionActivated, totals.signupCompleted),
    },
    paywallReasons,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}
