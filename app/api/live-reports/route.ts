import { NextResponse } from "next/server";

import { listOpsLiveReportQueue } from "@/features/live-operations/live-operations-queries";
import {
  getLiveOperationsRouteContext,
  jsonError,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view report queue", 403);
    }

    const reports = await listOpsLiveReportQueue(context.supabase);
    return NextResponse.json({ reports });
  } catch (error) {
    return jsonError(error);
  }
}
