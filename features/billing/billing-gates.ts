export type BillingPlanTier = "free" | "basic" | "pro" | "enterprise";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "readonly"
  | "cancelled";

export type BillingFeatureKey =
  | "project_management"
  | "settlement"
  | "export_center"
  | "war_room"
  | "auto_review_shadow"
  | "auto_review_active"
  | "ai_diagnosis"
  | "vendor_portal"
  | "private_deployment";

export type PlanEntitlements = Record<BillingFeatureKey, boolean>;

export type FeatureAddon = {
  featureKey: BillingFeatureKey | string;
  enabled: boolean;
};

const baseEntitlements: Record<BillingPlanTier, PlanEntitlements> = {
  free: {
    project_management: true,
    settlement: false,
    export_center: false,
    war_room: false,
    auto_review_shadow: false,
    auto_review_active: false,
    ai_diagnosis: false,
    vendor_portal: false,
    private_deployment: false,
  },
  basic: {
    project_management: true,
    settlement: true,
    export_center: false,
    war_room: false,
    auto_review_shadow: false,
    auto_review_active: false,
    ai_diagnosis: false,
    vendor_portal: false,
    private_deployment: false,
  },
  pro: {
    project_management: true,
    settlement: true,
    export_center: true,
    war_room: true,
    auto_review_shadow: true,
    auto_review_active: false,
    ai_diagnosis: true,
    vendor_portal: false,
    private_deployment: false,
  },
  enterprise: {
    project_management: true,
    settlement: true,
    export_center: true,
    war_room: true,
    auto_review_shadow: true,
    auto_review_active: true,
    ai_diagnosis: true,
    vendor_portal: true,
    private_deployment: true,
  },
};

export function resolvePlanEntitlements({
  planTier,
  featureAddons,
}: {
  planTier: BillingPlanTier;
  featureAddons: FeatureAddon[];
}): PlanEntitlements {
  const entitlements = { ...baseEntitlements[planTier] };
  for (const addon of featureAddons) {
    if (addon.enabled && isBillingFeatureKey(addon.featureKey)) {
      entitlements[addon.featureKey] = true;
    }
  }
  return entitlements;
}

export function evaluateBillingGate({
  entitlements,
  subscriptionStatus,
  featureKey,
  action,
}: {
  entitlements: PlanEntitlements;
  subscriptionStatus: SubscriptionStatus;
  featureKey: BillingFeatureKey;
  action: "read" | "write";
}):
  | { allowed: true; mode: "active" | "read_only" }
  | {
      allowed: false;
      mode: "active" | "read_only";
      reason: "feature_not_entitled" | "subscription_readonly";
    } {
  const readOnly = isReadOnlyStatus(subscriptionStatus);
  const mode = readOnly ? "read_only" : "active";

  if (!entitlements[featureKey]) {
    return { allowed: false, mode, reason: "feature_not_entitled" };
  }
  if (readOnly && action === "write") {
    return { allowed: false, mode, reason: "subscription_readonly" };
  }
  return { allowed: true, mode };
}

export function isReadOnlyStatus(status: SubscriptionStatus): boolean {
  return (
    status === "past_due" || status === "readonly" || status === "cancelled"
  );
}

function isBillingFeatureKey(value: string): value is BillingFeatureKey {
  return value in baseEntitlements.enterprise;
}
