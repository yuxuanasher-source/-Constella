import { NextResponse } from "next/server";

import {
  listProjectCollaborationApplications,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
} from "@/features/applications/application-route-utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const context = await getAdmissionRouteContext();
    const repo = new SupabaseProjectCollaborationRepository(context.supabase);
    const applications = await listProjectCollaborationApplications({
      repo,
      actor: actorFromContext(context),
      projectId,
    });

    return NextResponse.json({ applications });
  } catch (error) {
    return jsonError(error);
  }
}
