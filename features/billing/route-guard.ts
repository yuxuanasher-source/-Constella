import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateBillingGate, type BillingFeatureKey } from "./billing-gates";
import {
  getBillingStatus as loadBillingStatus,
  type BillingStatus,
} from "./billing-status";

type GetBillingStatus = typeof loadBillingStatus;

export function assertWriteAllowedFromBillingStatus({
  billing,
  featureKey,
}: {
  billing: BillingStatus;
  featureKey: BillingFeatureKey;
}) {
  const result = evaluateBillingGate({
    entitlements: billing.entitlements,
    subscriptionStatus: billing.subscriptionStatus,
    featureKey,
    action: "write",
  });

  if (result.allowed) {
    return;
  }

  if (result.reason === "subscription_readonly") {
    throw new Error(readOnlyMessage(billing.subscriptionStatus));
  }

  throw new Error(`Current plan is not entitled to ${featureKey}`);
}

export async function assertBillingWriteAllowed({
  client,
  organizationId,
  featureKey,
  now,
  getBillingStatus = loadBillingStatus,
}: {
  client: SupabaseClient;
  organizationId: string;
  featureKey: BillingFeatureKey;
  now?: Date;
  getBillingStatus?: GetBillingStatus;
}) {
  const billing = await getBillingStatus({
    client,
    organizationId,
    now,
  });

  assertWriteAllowedFromBillingStatus({ billing, featureKey });
}

function readOnlyMessage(status: BillingStatus["subscriptionStatus"]) {
  if (status === "past_due") {
    return "Organization is read-only because billing is past due";
  }
  if (status === "cancelled") {
    return "Organization is read-only because billing is cancelled";
  }
  return "Organization is read-only because billing is read-only";
}
