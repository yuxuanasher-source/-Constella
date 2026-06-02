import { NextResponse } from "next/server";

import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import {
  getSettlementRouteContext,
  jsonError,
  requiredQueryParam,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { listSettlementPool } from "@/features/settlements/settlement-service";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
  try {
    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view settlement pool", 403);
    }

    const projectId = requiredQueryParam(request.url, "projectId");
    const periodStart = requiredQueryParam(request.url, "periodStart");
    const periodEnd = requiredQueryParam(request.url, "periodEnd");

    await listSettlementPool({
      repo: context.repo,
      actor: {
        userId: context.auth.userId,
        name: context.auth.name,
        role: context.auth.role,
        organizationId: context.auth.organizationId,
      },
      projectId,
      periodStart,
      periodEnd,
    });

    const reports = await listOpsSettlementPool(context.supabase, {
      projectId,
      periodStart,
      periodEnd,
    });
    return NextResponse.json({ reports });
  } catch (error) {
    return jsonError(error);
  }
}
