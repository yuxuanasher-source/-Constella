import { NextResponse } from "next/server";

import {
  revokeAdmissionShareBoard,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; shareBoardId: string }> },
) {
  try {
    const { projectId, shareBoardId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can revoke admission share boards",
        403,
      );
    }

    const repo = new SupabaseAdmissionShareBoardRepository(context.supabase);
    await revokeAdmissionShareBoard({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      shareBoardId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
