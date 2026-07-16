import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { transitionFinanceBatch } from "@/features/finance-batches/finance-batch-service";
import {
  getSettlementRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const batch = await transitionFinanceBatch({
      repo,
      actor: settlementActorFromContext(context),
      input: {
        financeBatchId: batchId,
        action: "lock",
        reason: optionalString(body, "reason") ?? null,
      },
    });

    return NextResponse.json({ batch });
  } catch (error) {
    return jsonError(error);
  }
}
