import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
} from "@/features/complex-cost/complex-cost-route-utils";
import { confirmProjectCostImportBatch } from "@/features/complex-cost/complex-cost-service";
import { SupabaseCustomRuleReadRepository } from "@/features/settlements/custom-rule-repository";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const result = await confirmProjectCostImportBatch({
      repo: context.repo,
      customRuleRepo: new SupabaseCustomRuleReadRepository(context.supabase),
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      batchId,
      reason: requiredString(body, "reason"),
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
