import { NextResponse } from "next/server";

import {
  revokeProjectCollaborationShare,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
} from "@/features/applications/application-route-utils";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; shareId: string }> },
) {
  try {
    const { projectId, shareId } = await params;
    const context = await getAdmissionRouteContext();
    const repo = new SupabaseProjectCollaborationRepository(context.supabase);

    await revokeProjectCollaborationShare({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      shareId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
