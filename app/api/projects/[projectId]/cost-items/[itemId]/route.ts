import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";
import { updateProjectCostItemStatus } from "@/features/complex-cost/complex-cost-service";
import type { ProjectCostItemStatus } from "@/features/complex-cost/complex-cost-types";

const reviewableStatuses = new Set(["confirmed", "voided"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  try {
    const { itemId } = await params;
    const body = await readJsonBody(request);
    const status = requiredString(body, "status");
    if (!reviewableStatuses.has(status)) {
      throw new RouteError("status must be confirmed or voided", 400);
    }

    const context = await getComplexCostRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const item = await updateProjectCostItemStatus({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      itemId,
      status: status as ProjectCostItemStatus,
      reason: requiredString(body, "reason"),
    });

    return NextResponse.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}
