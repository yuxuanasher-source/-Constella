import type { UsageMetric } from "./usage-metering";

export type BillingCycle = "monthly" | "annual";

export type BillingOrderKind =
  | "subscription_new"
  | "subscription_renewal"
  | "subscription_upgrade"
  | "subscription_downgrade"
  | "usage_addon"
  | "feature_addon";

export type BillingOrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunding"
  | "refunded";

export type BillingTransactionType = "payment" | "refund";

export type BillingTransactionStatus = "created" | "succeeded" | "failed";

/**
 * Order intent snapshot. The server resolves the concrete amount from
 * {@link order-types.BillingOrderKind} + this target; the client only ever
 * sends intent (plan/cycle/metric/quantity/featureKey), never money.
 */
export type OrderTarget = {
  planCode?: string;
  billingCycle?: BillingCycle;
  metric?: UsageMetric;
  quantity?: number;
  featureKey?: string;
};

export type CheckoutIntent = {
  kind: BillingOrderKind;
  target: OrderTarget;
};

export const subscriptionOrderKinds: BillingOrderKind[] = [
  "subscription_new",
  "subscription_renewal",
  "subscription_upgrade",
  "subscription_downgrade",
];

export function isSubscriptionOrderKind(kind: BillingOrderKind): boolean {
  return subscriptionOrderKinds.includes(kind);
}
