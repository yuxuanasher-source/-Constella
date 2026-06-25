import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAuditLog } from "@/lib/audit/audit";

import type { BillingActor } from "./billing-write-guard";
import type {
  BillingCycle,
  BillingOrderKind,
  BillingOrderStatus,
  OrderTarget,
} from "./order-types";

export type SafeOrder = {
  id: string;
  kind: BillingOrderKind;
  status: BillingOrderStatus;
  amountCents: number;
  currency: string;
  billingCycle: BillingCycle | null;
  target: OrderTarget;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
};

type OrderRow = {
  id: string;
  kind: BillingOrderKind;
  status: BillingOrderStatus;
  amount_cents: number;
  currency: string;
  billing_cycle: BillingCycle | null;
  target: OrderTarget | null;
  created_at: string;
  expires_at: string | null;
  paid_at: string | null;
};

const ORDER_COLUMNS =
  "id, kind, status, amount_cents, currency, billing_cycle, target, created_at, expires_at, paid_at";

export async function listBillingOrders({
  client,
  organizationId,
}: {
  client: SupabaseClient;
  organizationId: string;
}): Promise<SafeOrder[]> {
  const { data, error } = await client
    .from("billing_orders")
    .select(ORDER_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .returns<OrderRow[]>();
  if (error) {
    throw error;
  }
  return (data ?? []).map(toSafeOrder);
}

export async function getBillingOrder({
  client,
  organizationId,
  orderId,
}: {
  client: SupabaseClient;
  organizationId: string;
  orderId: string;
}): Promise<SafeOrder | null> {
  const { data, error } = await client
    .from("billing_orders")
    .select(ORDER_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (error) {
    throw error;
  }
  return data ? toSafeOrder(data) : null;
}

export async function cancelBillingOrder({
  client,
  actor,
  orderId,
}: {
  client: SupabaseClient;
  actor: BillingActor;
  orderId: string;
}): Promise<SafeOrder> {
  const { data, error } = await client
    .from("billing_orders")
    .update({ status: "cancelled" })
    .eq("organization_id", actor.organizationId)
    .eq("id", orderId)
    .eq("status", "pending")
    .select(ORDER_COLUMNS)
    .maybeSingle<OrderRow>();
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Pending order not found");
  }

  await writeAuditLog(client, {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "billing",
    objectType: "billing_order",
    objectId: orderId,
    after: { status: "cancelled" },
    changedFields: ["status"],
  });

  return toSafeOrder(data);
}

function toSafeOrder(row: OrderRow): SafeOrder {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    target: row.target ?? {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
  };
}
