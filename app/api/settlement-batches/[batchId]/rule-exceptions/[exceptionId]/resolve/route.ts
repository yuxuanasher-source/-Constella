import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { resolveSettlementRuleException } from "@/features/settlements/custom-rule-exception-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string; exceptionId: string }> },
) {
  try {
    const { batchId, exceptionId } = await params;
    const body = await readJsonBody(request);
    const reason = requiredString(body, "reason");
    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });
    const result = await resolveSettlementRuleException({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
      exceptionId,
      input: {
        resolutionValue: body.resolutionValue,
        reason,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return ruleExceptionResolveError(error);
  }
}

function ruleExceptionResolveError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message ===
        "Settlement batch is no longer open for rule exception resolution" ||
      error.message ===
        "Settlement rule exception was already resolved with a different value" ||
      error.message === "Settlement rule exception is not open for resolution" ||
      error.message === "Settlement rule exception amount is stale"
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error.message === "Settlement rule exception not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
  }
  return jsonError(error);
}
