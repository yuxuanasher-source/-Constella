import { NextResponse } from "next/server";

import {
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
} from "@/features/settlements/settlement-queries";
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
      throw new RouteError("Only MCN staff can view settlement batches", 403);
    }

    const batches = await listOpsSettlementBatches(
      context.supabase,
      context.auth.organizationId,
    );
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) {
      throw new RouteError("Settlement batch not found", 404);
    }

    const details = await listOpsSettlementBatchDetails(context.supabase, {
      organizationId: context.auth.organizationId,
      batchId,
    });

    return NextResponse.json({
      batch,
      items: details[batchId] ?? [],
    });
  } catch (error) {
    return jsonError(error);
  }
}
