import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { addFinanceBatchAdjustment } from "@/features/finance-batches/finance-batch-service";
import type { FinanceAdjustmentDirection } from "@/features/finance-batches/finance-batch-types";
import {
  getSettlementRouteContext,
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
    const body = await readJsonBody(request);
    const direction = requiredString(body, "direction");
    if (!adjustmentDirections.has(direction)) {
      throw new RouteError("direction must be increase or decrease", 400);
    }

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
        financeBatchItemId: optionalString(body, "financeBatchItemId") ?? null,
        direction: direction as FinanceAdjustmentDirection,
        amount: requiredNumber(body, "amount"),
        reason: requiredString(body, "reason"),
        evidenceSnapshot: readEvidenceSnapshot(body.evidenceSnapshot),
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
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
