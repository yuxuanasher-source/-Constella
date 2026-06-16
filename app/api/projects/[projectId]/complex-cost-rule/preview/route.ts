import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { calculateComplexCostPreview } from "@/features/complex-cost/complex-cost-calculator";
import {
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/complex-cost/complex-cost-route-utils";

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

    const entitlement = await context.repo.getProjectEntitlement({
      organizationId: context.auth.organizationId,
      projectId,
    });
    if (!entitlement) {
      throw new RouteError(
        "Complex cost rules are not enabled for this project",
        403,
      );
    }

    const preview = calculateComplexCostPreview({
      expectedReceivableCents: numberFromBody(body, "expectedReceivableCents"),
      streamerCount: numberFromBody(body, "streamerCount"),
      estimatedMinutesPerStreamer: numberFromBody(
        body,
        "estimatedMinutesPerStreamer",
      ),
      streamerHourlyCostCents: numberFromBody(body, "streamerHourlyCostCents"),
      streamerBaseCostCents: numberFromBody(body, "streamerBaseCostCents"),
      supplierCostCents: numberFromBody(body, "supplierCostCents"),
      trafficCostCents: numberFromBody(body, "trafficCostCents"),
      platformFeeBps: numberFromBody(body, "platformFeeBps"),
      manualAdjustmentCents: numberFromBody(body, "manualAdjustmentCents"),
    });

    return NextResponse.json({ preview });
  } catch (error) {
    return jsonError(error);
  }
}

function numberFromBody(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
