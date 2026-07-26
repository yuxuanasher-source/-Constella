import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseBillingRepo } from "@/features/billing/billing-repo-supabase";

import type { OrganizationLifecycleStatus } from "./platform-admin-contracts";
import type {
  PlatformAdminOrderRecord,
  PlatformAdminPaymentRepository,
} from "./platform-admin-payment-service";
import { SupabasePlatformAdminOperationLog } from "./platform-admin-operation-log";

export function createSupabasePlatformAdminPaymentRepository(
  client: SupabaseClient,
): PlatformAdminPaymentRepository {
  const billing = createSupabaseBillingRepo(client);
  return Object.assign(billing, {
    operationLog: new SupabasePlatformAdminOperationLog(client),

    async getOrganizationForPayment(organizationId: string) {
      const { data, error } = await client
        .from("organizations")
        .select("id, lifecycle_status")
        .eq("id", organizationId)
        .maybeSingle<{
          id: string;
          lifecycle_status: OrganizationLifecycleStatus;
        }>();
      throwIf(error, "load payment organization");
      return data
        ? { id: data.id, lifecycleStatus: data.lifecycle_status }
        : null;
    },

    async getTransactionByProviderReference(
      provider: string,
      reference: string,
    ) {
      const { data, error } = await client
        .from("billing_transactions")
        .select("id, order_id, type, status, amount_cents")
        .eq("provider", provider)
        .eq("provider_txn_id", reference)
        .maybeSingle<{
          id: string;
          order_id: string;
          type: "payment" | "refund";
          status: "created" | "succeeded" | "failed";
          amount_cents: number;
        }>();
      throwIf(error, "load billing transaction");
      return data
        ? {
            id: data.id,
            orderId: data.order_id,
            type: data.type,
            status: data.status,
            amountCents: data.amount_cents,
          }
        : null;
    },

    async getAdminOrder(
      orderId: string,
    ): Promise<PlatformAdminOrderRecord | null> {
      const [order, versionResult] = await Promise.all([
        billing.getOrderById(orderId),
        client
          .from("billing_orders")
          .select("updated_at")
          .eq("id", orderId)
          .maybeSingle<{ updated_at: string }>(),
      ]);
      throwIf(versionResult.error, "load billing order version");
      return order && versionResult.data
        ? { ...order, updatedAt: versionResult.data.updated_at }
        : null;
    },

    async cancelPendingOrder(
      orderId: string,
      expectedUpdatedAt: string,
    ): Promise<PlatformAdminOrderRecord | null> {
      const { data, error } = await client
        .from("billing_orders")
        .update({ status: "cancelled" })
        .eq("id", orderId)
        .eq("status", "pending")
        .eq("updated_at", expectedUpdatedAt)
        .select("updated_at")
        .maybeSingle<{ updated_at: string }>();
      throwIf(error, "cancel billing order");
      if (!data) {
        return null;
      }
      const order = await billing.getOrderById(orderId);
      return order ? { ...order, updatedAt: data.updated_at } : null;
    },
  });
}

function throwIf(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) {
    throw new Error(`Failed to ${operation}: ${error.message}`);
  }
}
