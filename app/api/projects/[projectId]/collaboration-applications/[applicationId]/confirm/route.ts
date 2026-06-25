import { NextResponse } from "next/server";

import {
  confirmProjectCollaborationCounter,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; applicationId: string }> },
) {
  try {
    const { projectId, applicationId } = await params;
    const context = await getAdmissionRouteContext();
    const repoClient = createSupabaseAdminClient();
    if (!repoClient) {
      throw new RouteError("Collaboration service is unavailable", 500);
    }

    const repo = new SupabaseProjectCollaborationRepository(repoClient);
    const result = await confirmProjectCollaborationCounter({
      repo,
      audit: (input) => context.audit(repoClient, input),
      actor: actorFromContext(context),
      projectId,
      applicationId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
