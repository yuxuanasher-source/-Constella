import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { addFinanceBatchAdjustment } from "@/features/finance-batches/finance-batch-service";
import type { FinanceAdjustmentDirection } from "@/features/finance-batches/finance-batch-types";
import {
  getSettlementRouteContext,
  isUuid,
  jsonError,
  optionalString,
  readJsonBody,
  requiredNumber,
  requiredString,
  RouteError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";

const adjustmentDirections = new Set<string>(["increase", "decrease"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    assertUuid(batchId, "batchId");
    const body = await readJsonBody(request);
    const direction = requiredString(body, "direction");
    if (!adjustmentDirections.has(direction)) {
      throw new RouteError("direction must be increase or decrease", 400);
    }
    const financeBatchItemId = optionalUuid(body, "financeBatchItemId") ?? null;
    const amount = requiredNumber(body, "amount");
    const reason = requiredString(body, "reason");
    const evidenceSnapshot = readEvidenceSnapshot(body.evidenceSnapshot);

    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const result = await addFinanceBatchAdjustment({
      repo,
      actor: settlementActorFromContext(context),
      input: {
        financeBatchId: batchId,
        financeBatchItemId,
        direction: direction as FinanceAdjustmentDirection,
        amount,
        reason,
        evidenceSnapshot,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

function optionalUuid(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = optionalString(body, key);
  if (value && !isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }

  return value;
}

function assertUuid(value: string, key: string): void {
  if (!isUuid(value)) {
    throw new RouteError(`${key} must be a valid UUID`, 400);
  }
}

function readEvidenceSnapshot(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RouteError("evidenceSnapshot must be an object", 400);
  }

  return value as Record<string, unknown>;
}
