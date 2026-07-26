import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingPlanTier, SubscriptionStatus } from "@/features/billing/billing-gates";
import type { BillingCycle } from "@/features/billing/order-types";

import {
  type PlatformAdminBillingRepository,
  type PlatformBillingPlanRecord,
  type PlatformCostVersionRecord,
  type PlatformPlanMetadataPatch,
  type PlatformPriceVersionRecord,
  type PlatformSubscriptionAdminRecord,
} from "./platform-admin-billing-service";
import {
  PlatformAdminConflictError,
  PlatformAdminValidationError,
} from "./platform-admin-errors";
import { SupabasePlatformAdminOperationLog } from "./platform-admin-operation-log";

type PlanRow = {
  id: string;
  code: string;
  tier: BillingPlanTier;
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  included_active_streamers: number;
  included_seats: number;
  included_ocr: number;
  included_ai: number;
  included_storage_mb: number;
  included_exports: number;
  features: Record<string, boolean>;
  updated_at: string;
};

type SubscriptionRow = {
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  grace_until: string | null;
  pending_plan_id: string | null;
  pending_billing_cycle: BillingCycle | null;
  auto_renew: boolean;
  last_order_id: string | null;
  updated_at: string;
};

type PriceRow = {
  id: string;
  plan_id: string;
  billing_cycle: BillingCycle;
  price_cents: number;
  currency: string;
  active: boolean;
  effective_from: string;
  effective_to: string | null;
};

type CostRow = {
  id: string;
  plan_id: string;
  effective_from: string;
  effective_to: string | null;
  fixed_cost_cents: number;
  per_seat_cost_cents: number;
  per_active_streamer_cost_cents: number;
  metric_unit_costs: Record<string, number>;
  reason: string;
  created_by: string;
};

const planColumns = `
  id,
  code,
  tier,
  name,
  monthly_price_cents,
  annual_price_cents,
  included_active_streamers,
  included_seats,
  included_ocr,
  included_ai,
  included_storage_mb,
  included_exports,
  features,
  updated_at
`;

const subscriptionColumns = `
  organization_id,
  plan_id,
  status,
  billing_cycle,
  current_period_start,
  current_period_end,
  trial_ends_at,
  grace_until,
  pending_plan_id,
  pending_billing_cycle,
  auto_renew,
  last_order_id,
  updated_at
`;

const priceColumns = `
  id,
  plan_id,
  billing_cycle,
  price_cents,
  currency,
  active,
  effective_from,
  effective_to
`;

export class SupabasePlatformAdminBillingRepository implements PlatformAdminBillingRepository {
  readonly operationLog;

  constructor(private readonly client: SupabaseClient) {
    this.operationLog = new SupabasePlatformAdminOperationLog(client);
  }

  async getPlan(planId: string) {
    const { data, error } = await this.client
      .from("billing_plans")
      .select(planColumns)
      .eq("id", planId)
      .maybeSingle<PlanRow>();
    throwIf(error, "load billing plan");
    return data ? mapPlan(data) : null;
  }

  async getSubscription(organizationId: string) {
    const { data, error } = await this.client
      .from("organization_subscriptions")
      .select(subscriptionColumns)
      .eq("organization_id", organizationId)
      .maybeSingle<SubscriptionRow>();
    throwIf(error, "load organization subscription");
    return data ? mapSubscription(data) : null;
  }

  async updateSubscription(
    organizationId: string,
    patch: Parameters<
      PlatformAdminBillingRepository["updateSubscription"]
    >[1],
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("organization_subscriptions")
      .update(subscriptionPatchToRow(patch))
      .eq("organization_id", organizationId)
      .eq("updated_at", expectedUpdatedAt)
      .select(subscriptionColumns)
      .maybeSingle<SubscriptionRow>();
    return requireUpdated(result, "subscription", mapSubscription);
  }

  async updatePlanMetadata(
    planId: string,
    patch: PlatformPlanMetadataPatch,
    expectedUpdatedAt: string,
  ) {
    const result = await this.client
      .from("billing_plans")
      .update(planPatchToRow(patch))
      .eq("id", planId)
      .eq("updated_at", expectedUpdatedAt)
      .select(planColumns)
      .maybeSingle<PlanRow>();
    return requireUpdated(result, "billing plan", mapPlan);
  }

  async getActivePriceVersion(
    planId: string,
    billingCycle: BillingCycle,
  ) {
    const { data, error } = await this.client
      .from("billing_plan_prices")
      .select(priceColumns)
      .eq("plan_id", planId)
      .eq("billing_cycle", billingCycle)
      .eq("active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle<PriceRow>();
    throwIf(error, "load active plan price");
    return data ? mapPrice(data) : null;
  }

  async createPriceVersionAtomic(
    input: Parameters<
      PlatformAdminBillingRepository["createPriceVersionAtomic"]
    >[0],
    expectedPlanUpdatedAt: string,
  ) {
    const { data, error } = await this.client.rpc(
      "platform_create_plan_price_version",
      {
        p_plan_id: input.planId,
        p_billing_cycle: input.billingCycle,
        p_price_cents: input.priceCents,
        p_currency: input.currency,
        p_effective_from: input.effectiveFrom,
        p_previous_price_version_id: input.previousPriceVersionId,
        p_expected_plan_updated_at: expectedPlanUpdatedAt,
      },
    );
    translateRpcError(error, "create plan price version");
    return mapPrice(data as PriceRow);
  }

  async findOverlappingCostVersion(input: {
    planId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }) {
    let request = this.client
      .from("billing_plan_cost_versions")
      .select("id")
      .eq("plan_id", input.planId)
      .or(
        `effective_to.is.null,effective_to.gt.${input.effectiveFrom}`,
      );
    if (input.effectiveTo) {
      request = request.lt("effective_from", input.effectiveTo);
    }
    const { data, error } = await request
      .limit(1)
      .maybeSingle<{ id: string }>();
    throwIf(error, "check cost version overlap");
    return data;
  }

  async createCostVersion(
    input: Omit<PlatformCostVersionRecord, "id">,
    expectedPlanUpdatedAt: string,
  ) {
    const { data, error } = await this.client.rpc(
      "platform_create_plan_cost_version",
      {
        p_plan_id: input.planId,
        p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo,
        p_fixed_cost_cents: input.fixedCostCents,
        p_per_seat_cost_cents: input.perSeatCostCents,
        p_per_active_streamer_cost_cents:
          input.perActiveStreamerCostCents,
        p_metric_unit_costs: input.metricUnitCosts,
        p_reason: input.reason,
        p_created_by: input.createdBy,
        p_expected_plan_updated_at: expectedPlanUpdatedAt,
      },
    );
    translateRpcError(error, "create plan cost version");
    return mapCost(data as CostRow);
  }
}

function mapPlan(row: PlanRow): PlatformBillingPlanRecord {
  return {
    id: row.id,
    code: row.code,
    tier: row.tier,
    name: row.name,
    monthlyPriceCents: row.monthly_price_cents,
    annualPriceCents: row.annual_price_cents,
    includedActiveStreamers: row.included_active_streamers,
    includedSeats: row.included_seats,
    includedOcr: row.included_ocr,
    includedAi: row.included_ai,
    includedStorageMb: row.included_storage_mb,
    includedExports: row.included_exports,
    features: row.features ?? {},
    updatedAt: row.updated_at,
  };
}

function mapSubscription(row: SubscriptionRow): PlatformSubscriptionAdminRecord {
  return {
    organizationId: row.organization_id,
    planId: row.plan_id,
    status: row.status,
    billingCycle: row.billing_cycle,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    graceUntil: row.grace_until,
    pendingPlanId: row.pending_plan_id,
    pendingBillingCycle: row.pending_billing_cycle,
    autoRenew: row.auto_renew,
    lastOrderId: row.last_order_id,
    updatedAt: row.updated_at,
  };
}

function mapPrice(row: PriceRow): PlatformPriceVersionRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    billingCycle: row.billing_cycle,
    priceCents: row.price_cents,
    currency: row.currency,
    active: row.active,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function mapCost(row: CostRow): PlatformCostVersionRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    fixedCostCents: row.fixed_cost_cents,
    perSeatCostCents: row.per_seat_cost_cents,
    perActiveStreamerCostCents: row.per_active_streamer_cost_cents,
    metricUnitCosts: row.metric_unit_costs,
    reason: row.reason,
    createdBy: row.created_by,
  };
}

function subscriptionPatchToRow(
  patch: Parameters<
    PlatformAdminBillingRepository["updateSubscription"]
  >[1],
) {
  return {
    ...(patch.planId !== undefined ? { plan_id: patch.planId } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.billingCycle !== undefined
      ? { billing_cycle: patch.billingCycle }
      : {}),
    ...(patch.currentPeriodStart !== undefined
      ? { current_period_start: patch.currentPeriodStart }
      : {}),
    ...(patch.currentPeriodEnd !== undefined
      ? { current_period_end: patch.currentPeriodEnd }
      : {}),
    ...(patch.trialEndsAt !== undefined
      ? { trial_ends_at: patch.trialEndsAt }
      : {}),
    ...(patch.graceUntil !== undefined
      ? { grace_until: patch.graceUntil }
      : {}),
    ...(patch.pendingPlanId !== undefined
      ? { pending_plan_id: patch.pendingPlanId }
      : {}),
    ...(patch.pendingBillingCycle !== undefined
      ? { pending_billing_cycle: patch.pendingBillingCycle }
      : {}),
    ...(patch.autoRenew !== undefined ? { auto_renew: patch.autoRenew } : {}),
    ...(patch.lastOrderId !== undefined
      ? { last_order_id: patch.lastOrderId }
      : {}),
  };
}

function planPatchToRow(patch: PlatformPlanMetadataPatch) {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.features !== undefined ? { features: patch.features } : {}),
    ...(patch.includedActiveStreamers !== undefined
      ? { included_active_streamers: patch.includedActiveStreamers }
      : {}),
    ...(patch.includedSeats !== undefined
      ? { included_seats: patch.includedSeats }
      : {}),
    ...(patch.includedOcr !== undefined
      ? { included_ocr: patch.includedOcr }
      : {}),
    ...(patch.includedAi !== undefined
      ? { included_ai: patch.includedAi }
      : {}),
    ...(patch.includedStorageMb !== undefined
      ? { included_storage_mb: patch.includedStorageMb }
      : {}),
    ...(patch.includedExports !== undefined
      ? { included_exports: patch.includedExports }
      : {}),
  };
}

function requireUpdated<Row, Result>(
  result: { data: Row | null; error: { message: string } | null },
  subject: string,
  map: (row: Row) => Result,
): Result {
  throwIf(result.error, `update ${subject}`);
  if (!result.data) {
    throw new PlatformAdminConflictError(
      `The ${subject} changed after it was loaded. Refresh and try again.`,
    );
  }
  return map(result.data);
}

function translateRpcError(
  error: { code?: string; message: string } | null,
  operation: string,
): asserts error is null {
  if (!error) {
    return;
  }
  if (
    error.code === "40001" ||
    error.message.toLowerCase().includes("changed after")
  ) {
    throw new PlatformAdminConflictError(error.message);
  }
  if (
    error.code === "23P01" ||
    error.message.toLowerCase().includes("overlap")
  ) {
    throw new PlatformAdminValidationError(error.message);
  }
  throw new Error(`Failed to ${operation}: ${error.message}`);
}

function throwIf(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) {
    throw new Error(`Failed to ${operation}: ${error.message}`);
  }
}
