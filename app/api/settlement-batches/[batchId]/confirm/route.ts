import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { createSettlementBatchRuleExceptionGate } from "@/features/settlements/custom-rule-exception-service";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { confirmSettlementBatch } from "@/features/settlements/settlement-service";

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
    const batch = await confirmSettlementBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
      reason,
      gate: createSettlementBatchRuleExceptionGate({
        repo: context.repo,
        organizationId: context.auth.organizationId,
      }),
    });

    return NextResponse.json({ batch });
  } catch (error) {
    return confirmError(error);
  }
}

function confirmError(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "Settlement batch has unresolved rule exceptions"
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return jsonError(error);
}
