import { NextResponse } from "next/server";

import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import {
  getSettlementRouteContext,
  jsonError,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view finance batches", 403);
    }

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const detail = await repo.getFinanceBatchDetail({
      organizationId: context.auth.organizationId,
      financeBatchId: batchId,
    });
    if (!detail) {
      throw new RouteError("Finance batch not found", 404);
    }

    return NextResponse.json(detail);
  } catch (error) {
    return jsonError(error);
  }
}
