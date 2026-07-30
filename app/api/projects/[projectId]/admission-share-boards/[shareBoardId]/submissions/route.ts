import { NextResponse } from "next/server";

import { SupabaseAdmissionShareBoardRepository } from "@/features/applications/admission-share-board";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; shareBoardId: string }>;
  },
) {
  try {
    const { projectId, shareBoardId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can read admission share submissions",
        403,
      );
    }

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    const submissions = await repo.listReviewSubmissions(
      projectId,
      shareBoardId,
    );

    return NextResponse.json({ submissions });
  } catch (error) {
    return jsonError(error);
  }
}
