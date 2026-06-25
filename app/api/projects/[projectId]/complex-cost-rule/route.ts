import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { getProjectComplexCostSettings } from "@/features/complex-cost/complex-cost-queries";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  optionalRecord,
  readJsonBody,
} from "@/features/complex-cost/complex-cost-route-utils";
import { saveComplexCostRuleDraft } from "@/features/complex-cost/complex-cost-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getComplexCostRouteContext();
    const settings = await getProjectComplexCostSettings(context.supabase, {
      organizationId: context.auth.organizationId,
      projectId,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const rule = await saveComplexCostRuleDraft({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      input: {
        projectId,
        rulePayload: optionalRecord(body, "rulePayload") ?? body,
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
