import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  BillingRepo,
  FeatureAddonInput,
  NewOrderInput,
  OrderRecord,
  PlanRecord,
  SubscriptionRecord,
  TransactionInput,
  UsageAddonInput,
  UsageCounterPatch,
  WebhookEventInput,
} from "./billing-repo";
import type { BillingCycle } from "./order-types";
import type { PlanPriceRow } from "./pricing";

type PlanRow = {
  id: string;
  code: string;
  tier: PlanRecord["tier"];
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  included_active_streamers: number;
  included_seats: number;
  included_ocr: number;
  included_ai: number;
  included_storage_mb: number;
  included_exports: number;
};

type OrderRow = {
  id: string;
  organization_id: string;
  kind: OrderRecord["kind"];
  status: OrderRecord["status"];
  amount_cents: number;
  currency: string;
  target: OrderRecord["target"];
  plan_id: string | null;
  plan_price_id: string | null;
  billing_cycle: BillingCycle | null;
  idempotency_key: string;
  provider: string | null;
  expires_at: string | null;
  paid_at: string | null;
  created_by: string;
};

type SubscriptionRow = {
  organization_id: string;
  plan_id: string;
  status: SubscriptionRecord["status"];
  billing_cycle: BillingCycle;
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  grace_until: string | null;
  pending_plan_id: string | null;
  pending_billing_cycle: BillingCycle | null;
  auto_renew: boolean;
  last_order_id: string | null;
};

export function createSupabaseBillingRepo(client: SupabaseClient): BillingRepo {
  return {
    async getPlanByCode(code) {
      const { data } = await client
        .from("billing_plans")
        .select(PLAN_COLUMNS)
        .eq("code", code)
        .maybeSingle<PlanRow>();
      return data ? toPlanRecord(data) : null;
    },

    async getPlanById(id) {
      const { data } = await client
        .from("billing_plans")
        .select(PLAN_COLUMNS)
        .eq("id", id)
        .maybeSingle<PlanRow>();
      return data ? toPlanRecord(data) : null;
    },

    async getPlanPrices(planId) {
      const { data } = await client
        .from("billing_plan_prices")
        .select("billing_cycle, price_cents, active")
        .eq("plan_id", planId)
        .returns<
          { billing_cycle: BillingCycle; price_cents: number; active: boolean }[]
        >();
      return (data ?? []).map<PlanPriceRow>((row) => ({
        billingCycle: row.billing_cycle,
        priceCents: row.price_cents,
        active: row.active,
      }));
    },

    async getPlanPriceId(planId, cycle) {
      const { data } = await client
        .from("billing_plan_prices")
        .select("id")
        .eq("plan_id", planId)
        .eq("billing_cycle", cycle)
        .eq("active", true)
        .limit(1)
        .maybeSingle<{ id: string }>();
      return data?.id ?? null;
    },

    async getSubscription(organizationId) {
      const { data } = await client
        .from("organization_subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .eq("organization_id", organizationId)
        .maybeSingle<SubscriptionRow>();
      return data ? toSubscriptionRecord(data) : null;
    },

    async updateSubscription(organizationId, patch) {
      const { error } = await client
        .from("organization_subscriptions")
        .update(subscriptionPatchToRow(patch))
        .eq("organization_id", organizationId);
      throwIf(error);
    },

    async findOrderByIdempotencyKey(organizationId, idempotencyKey) {
      const { data } = await client
        .from("billing_orders")
        .select(ORDER_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle<OrderRow>();
      return data ? toOrderRecord(data) : null;
    },

    async getOrderById(orderId) {
      const { data } = await client
        .from("billing_orders")
        .select(ORDER_COLUMNS)
        .eq("id", orderId)
        .maybeSingle<OrderRow>();
      return data ? toOrderRecord(data) : null;
    },

    async insertOrder(input) {
      const { data, error } = await client
        .from("billing_orders")
        .insert(newOrderToRow(input))
        .select(ORDER_COLUMNS)
        .single<OrderRow>();
      throwIf(error);
      if (!data) {
        throw new Error("Failed to insert billing order");
      }
      return toOrderRecord(data);
    },

    async updateOrder(orderId, patch) {
      const { error } = await client
        .from("billing_orders")
        .update(orderPatchToRow(patch))
        .eq("id", orderId);
      throwIf(error);
    },

    async markOrderPaid(orderId, paidAt) {
      const { data, error } = await client
        .from("billing_orders")
        .update({ status: "paid", paid_at: paidAt })
        .eq("id", orderId)
        .eq("status", "pending")
        .select("id")
        .returns<{ id: string }[]>();
      throwIf(error);
      return { transitioned: (data?.length ?? 0) > 0 };
    },

    async insertTransaction(input) {
      const row = transactionToRow(input);
      const { error } = input.providerTxnId
        ? await client
            .from("billing_transactions")
            .upsert(row, { onConflict: "provider,provider_txn_id" })
        : await client.from("billing_transactions").insert(row);
      throwIf(error);
    },

    async recordWebhookEvent(input) {
      const { error } = await client
        .from("billing_webhook_events")
        .insert(webhookEventToRow(input));
      if (!error) {
        return { alreadyProcessed: false };
      }
      const { data } = await client
        .from("billing_webhook_events")
        .select("processed")
        .eq("provider", input.provider)
        .eq("event_id", input.eventId)
        .maybeSingle<{ processed: boolean }>();
      return { alreadyProcessed: data?.processed ?? true };
    },

    async markWebhookProcessed(provider, eventId) {
      const { error } = await client
        .from("billing_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("provider", provider)
        .eq("event_id", eventId);
      throwIf(error);
    },

    async upsertUsageCounter(patch: UsageCounterPatch) {
      const { data: existing } = await client
        .from("usage_monthly_counters")
        .select("used_quantity, included_quantity, addon_quantity")
        .eq("organization_id", patch.organizationId)
        .eq("metric", patch.metric)
        .eq("period_month", patch.periodMonth)
        .maybeSingle<{
          used_quantity: number;
          included_quantity: number;
          addon_quantity: number;
        }>();

      const included = patch.includedQuantity ?? existing?.included_quantity ?? 0;
      const addon =
        (existing?.addon_quantity ?? 0) + (patch.addonQuantityDelta ?? 0);

      const { error } = await client
        .from("usage_monthly_counters")
        .upsert(
          {
            organization_id: patch.organizationId,
            metric: patch.metric,
            period_month: patch.periodMonth,
            used_quantity: existing?.used_quantity ?? 0,
            included_quantity: included,
            addon_quantity: addon,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,metric,period_month" },
        );
      throwIf(error);
    },

    async insertUsageAddon(input: UsageAddonInput) {
      const { error } = await client.from("usage_addons").insert({
        organization_id: input.organizationId,
        metric: input.metric,
        quantity: input.quantity,
        amount_cents: input.amountCents,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status: "active",
      });
      throwIf(error);
    },

    async upsertFeatureAddon(input: FeatureAddonInput) {
      const { error } = await client.from("feature_addons").upsert(
        {
          organization_id: input.organizationId,
          feature_key: input.featureKey,
          amount_cents: input.amountCents,
          enabled: input.enabled,
          period_start: input.periodStart,
          period_end: input.periodEnd,
        },
        { onConflict: "organization_id,feature_key" },
      );
      throwIf(error);
    },
  };
}

const PLAN_COLUMNS =
  "id, code, tier, name, monthly_price_cents, annual_price_cents, included_active_streamers, included_seats, included_ocr, included_ai, included_storage_mb, included_exports";

const ORDER_COLUMNS =
  "id, organization_id, kind, status, amount_cents, currency, target, plan_id, plan_price_id, billing_cycle, idempotency_key, provider, expires_at, paid_at, created_by";

const SUBSCRIPTION_COLUMNS =
  "organization_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_ends_at, grace_until, pending_plan_id, pending_billing_cycle, auto_renew, last_order_id";

function toPlanRecord(row: PlanRow): PlanRecord {
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
  };
}

function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    target: row.target ?? {},
    planId: row.plan_id,
    planPriceId: row.plan_price_id,
    billingCycle: row.billing_cycle,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    createdBy: row.created_by,
  };
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
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
  };
}

function newOrderToRow(input: NewOrderInput): Record<string, unknown> {
  return {
    id: input.id,
    organization_id: input.organizationId,
    kind: input.kind,
    status: input.status ?? "pending",
    amount_cents: input.amountCents,
    currency: input.currency,
    target: input.target,
    plan_id: input.planId ?? null,
    plan_price_id: input.planPriceId ?? null,
    billing_cycle: input.billingCycle ?? null,
    idempotency_key: input.idempotencyKey,
    provider: input.provider ?? null,
    expires_at: input.expiresAt ?? null,
    created_by: input.createdBy,
  };
}

function orderPatchToRow(patch: Partial<OrderRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.provider !== undefined) row.provider = patch.provider;
  if (patch.planPriceId !== undefined) row.plan_price_id = patch.planPriceId;
  if (patch.paidAt !== undefined) row.paid_at = patch.paidAt;
  if (patch.amountCents !== undefined) row.amount_cents = patch.amountCents;
  return row;
}

function subscriptionPatchToRow(
  patch: Partial<SubscriptionRecord>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.planId !== undefined) row.plan_id = patch.planId;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.billingCycle !== undefined) row.billing_cycle = patch.billingCycle;
  if (patch.currentPeriodStart !== undefined)
    row.current_period_start = patch.currentPeriodStart;
  if (patch.currentPeriodEnd !== undefined)
    row.current_period_end = patch.currentPeriodEnd;
  if (patch.trialEndsAt !== undefined) row.trial_ends_at = patch.trialEndsAt;
  if (patch.graceUntil !== undefined) row.grace_until = patch.graceUntil;
  if (patch.pendingPlanId !== undefined) row.pending_plan_id = patch.pendingPlanId;
  if (patch.pendingBillingCycle !== undefined)
    row.pending_billing_cycle = patch.pendingBillingCycle;
  if (patch.autoRenew !== undefined) row.auto_renew = patch.autoRenew;
  if (patch.lastOrderId !== undefined) row.last_order_id = patch.lastOrderId;
  return row;
}

function transactionToRow(input: TransactionInput): Record<string, unknown> {
  return {
    organization_id: input.organizationId,
    order_id: input.orderId,
    type: input.type,
    status: input.status,
    amount_cents: input.amountCents,
    provider: input.provider,
    provider_txn_id: input.providerTxnId ?? null,
    provider_payload: input.providerPayload ?? {},
    failure_reason: input.failureReason ?? null,
    succeeded_at: input.succeededAt ?? null,
  };
}

function webhookEventToRow(input: WebhookEventInput): Record<string, unknown> {
  return {
    provider: input.provider,
    event_id: input.eventId,
    signature_verified: input.signatureVerified,
    raw_payload: input.rawPayload ?? {},
    order_id: input.orderId ?? null,
  };
}

function throwIf(error: { message: string } | null): void {
  if (error) {
    throw error instanceof Error ? error : new Error(error.message);
  }
}
