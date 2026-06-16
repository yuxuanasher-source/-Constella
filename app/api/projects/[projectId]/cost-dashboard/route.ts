import { NextResponse } from "next/server";

import { getProjectComplexCostDashboard } from "@/features/complex-cost/complex-cost-queries";
import {
  getComplexCostRouteContext,
  jsonError,
} from "@/features/complex-cost/complex-cost-route-utils";
import { toComplexCostDashboardDto } from "@/features/complex-cost/complex-cost-ui-dto";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getComplexCostRouteContext();
    const dashboard = await getProjectComplexCostDashboard(context.supabase, {
      organizationId: context.auth.organizationId,
      projectId,
    });

    return NextResponse.json({
      dashboard: toComplexCostDashboardDto(dashboard, context.auth.role),
    });
  } catch (error) {
    return jsonError(error);
  }
}
