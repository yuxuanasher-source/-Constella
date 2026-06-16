import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
} from "@/features/complex-cost/complex-cost-route-utils";
import { approveComplexCostRuleVersion } from "@/features/complex-cost/complex-cost-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const rule = await approveComplexCostRuleVersion({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      versionId: requiredString(body, "versionId"),
      reason: requiredString(body, "reason"),
    });

    return NextResponse.json({ rule });
  } catch (error) {
    return jsonError(error);
  }
}
