import { writeAuditLog } from "@/lib/audit/audit";
import type { AuthContext } from "@/lib/auth/context";

export type UsageMetric =
  | "active_streamer"
  | "seat"
  | "ocr"
  | "ai"
  | "storage_mb"
  | "export";

export type UsageStatus = {
  metric: UsageMetric;
  usedQuantity: number;
  includedQuantity: number;
  addonQuantity: number;
  allowanceQuantity: number;
  remainingQuantity: number;
  overageQuantity: number;
  billableOverageQuantity: number;
  softOverage: true;
  shouldHardBlock: false;
};

type BillingUsageClient = {
  from(table: "usage_events" | "audit_logs"): {
    insert(
      payload: Record<string, unknown>,
    ): PromiseLike<{ error: Error | null }>;
  };
};

type BillingActor = Pick<
  AuthContext,
  "userId" | "name" | "role" | "organizationId"
>;

export function calculateUsageStatus({
  metric,
  usedQuantity,
  includedQuantity,
  addonQuantity,
}: {
  metric: UsageMetric;
  usedQuantity: number;
  includedQuantity: number;
  addonQuantity: number;
}): UsageStatus {
  const used = nonnegative(usedQuantity);
  const included = nonnegative(includedQuantity);
  const addon = nonnegative(addonQuantity);
  const allowance = included + addon;
  const overage = Math.max(0, used - allowance);

  return {
    metric,
    usedQuantity: used,
    includedQuantity: included,
    addonQuantity: addon,
    allowanceQuantity: allowance,
    remainingQuantity: Math.max(0, allowance - used),
    overageQuantity: overage,
    billableOverageQuantity: overage,
    softOverage: true,
    shouldHardBlock: false,
  };
}

export function getUsagePeriodMonth(occurredAt: string | Date): string {
  const date = new Date(occurredAt);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}-01`;
}

export async function recordUsageEvent({
  client,
  actor,
  input,
}: {
  client: BillingUsageClient;
  actor: BillingActor;
  input: {
    metric: UsageMetric;
    quantity: number;
    source: string;
    objectType?: string;
    objectId?: string;
    occurredAt?: string | Date;
    metadata?: Record<string, unknown>;
  };
}): Promise<void> {
  const quantity = nonnegative(input.quantity);
  if (quantity <= 0) {
    throw new Error("Usage quantity must be positive");
  }

  const periodMonth = getUsagePeriodMonth(input.occurredAt ?? new Date());
  const { error } = await client.from("usage_events").insert({
    organization_id: actor.organizationId,
    metric: input.metric,
    quantity,
    period_month: periodMonth,
    source: input.source,
    object_type: input.objectType,
    object_id: input.objectId,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw error;
  }

  await writeAuditLog(client as Parameters<typeof writeAuditLog>[0], {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "billing",
    objectType: "usage_event",
    objectId: input.objectId,
    after: {
      metric: input.metric,
      quantity,
      periodMonth,
      source: input.source,
    },
    changedFields: ["metric", "quantity"],
  });
}

function nonnegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
