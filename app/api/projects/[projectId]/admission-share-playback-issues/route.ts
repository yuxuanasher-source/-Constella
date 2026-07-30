import { NextResponse } from "next/server";

import {
  listAdmissionSharePlaybackIssues,
  SupabaseAdmissionShareBoardRepository,
  type AdmissionSharePlaybackIssueStatus,
} from "@/features/applications/admission-share-board";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError(
        "Only MCN staff can read admission share playback issues",
        403,
      );
    }
    const status = playbackIssueStatus(request);
    const issues = await listAdmissionSharePlaybackIssues({
      repo: new SupabaseAdmissionShareBoardRepository(context.supabase),
      actor: actorFromContext(context),
      organizationId: context.auth.organizationId,
      projectId,
      status,
    });

    return NextResponse.json({ issues });
  } catch (error) {
    return jsonError(error);
  }
}

function playbackIssueStatus(
  request: Request,
): AdmissionSharePlaybackIssueStatus {
  const value = new URL(request.url).searchParams.get("status") ?? "open";
  if (value !== "open" && value !== "resolved") {
    throw new RouteError("status must be open or resolved", 400);
  }
  return value;
}
