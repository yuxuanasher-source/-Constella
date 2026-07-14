import { NextResponse } from "next/server";

import {
  runProjectSettlementReconciliation,
  SupabaseReconciliationDataSource,
} from "@/features/settlements/project-settlement-reconciliation-service";
import {
  getSettlementRouteContext,
  jsonError,
  requiredQueryParam,
  RouteError,
  settlementActorFromContext,
  isUuid,
  settlementReconciliationRouteMetadata,
} from "@/features/settlements/settlement-route-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getSettlementRouteContext();
    const { projectId } = await params;
    if (!isUuid(projectId)) {
      throw new RouteError("projectId must be a valid UUID", 400);
    }

    const periodStart = requiredQueryParam(request.url, "periodStart");
    const periodEnd = requiredQueryParam(request.url, "periodEnd");
    const forceApproved =
      new URL(request.url).searchParams.get("forceApproved") === "true";

    const reconciliation = await runProjectSettlementReconciliation({
      source: new SupabaseReconciliationDataSource(context.supabase),
      actor: settlementActorFromContext(context),
      projectId,
      periodStart,
      periodEnd,
      forceApproved,
    });

    return NextResponse.json({
      reconciliation,
      metadata: settlementReconciliationRouteMetadata(reconciliation),
    });
  } catch (error) {
    return jsonError(error);
  }
}
