import { NextResponse } from "next/server";

import {
  resolveAdmissionSharePlaybackIssue,
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
  { params }: { params: Promise<{ projectId: string; issueId: string }> },
) {
  try {
    const { projectId, issueId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can resolve admission share playback issues",
        403,
      );
    }

    await resolveAdmissionSharePlaybackIssue({
      repo: new SupabaseAdmissionShareBoardRepository(context.supabase),
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      organizationId: context.auth.organizationId,
      projectId,
      issueId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
