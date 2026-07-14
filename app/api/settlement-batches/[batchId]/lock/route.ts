import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { lockSettlementBatch } from "@/features/settlements/settlement-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const reason = requiredString(body, "reason");
    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });
    if (!context.gate) {
      throw new Error("Settlement transition gate is unavailable");
    }
    const batch = await lockSettlementBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
      reason,
      gate: context.gate,
    });

    return NextResponse.json({ batch, reconciliation: batch.reconciliation });
  } catch (error) {
    return lockError(error);
  }
}

function lockError(error: unknown) {
  if (
    error instanceof Error &&
    (error.message === "Settlement batch has unresolved rule exceptions" ||
      error.message === "Settlement batch reconciliation blocked")
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return jsonError(error);
}
