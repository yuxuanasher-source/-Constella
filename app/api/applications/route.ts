import { NextResponse } from "next/server";

import { listOpsApplicationQueue } from "@/features/applications/application-queries";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { parseListPagination } from "@/lib/http/pagination";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
  try {
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can view the application queue",
        403,
      );
    }

    const applications = await listOpsApplicationQueue(
      context.supabase,
      parseListPagination(request.url),
    );
    return NextResponse.json({ applications });
  } catch (error) {
    return jsonError(error);
  }
}
