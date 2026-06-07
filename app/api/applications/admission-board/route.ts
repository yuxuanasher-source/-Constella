import { NextResponse } from "next/server";

import { listAdmissionProjectBoards } from "@/features/applications/admission-board";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can view the admission project board",
        403,
      );
    }

    const projects = await listAdmissionProjectBoards(context.supabase);
    return NextResponse.json({ projects });
  } catch (error) {
    return jsonError(error);
  }
}
