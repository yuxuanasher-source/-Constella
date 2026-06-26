import { NextResponse } from "next/server";

import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
  SupabaseProjectCollaborationRepository,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function GET() {
  try {
    const context = await getAdmissionRouteContext();
    const repoClient = createSupabaseAdminClient();
    if (!repoClient) {
      throw new RouteError("Collaboration service is unavailable", 500);
    }

    const repo = new SupabaseProjectCollaborationRepository(repoClient);
    const actor = actorFromContext(context);
    const [projects, applications] = await Promise.all([
      listPartnerCollaborationProjects({
        repo,
        actor,
      }),
      listPartnerCollaborationApplications({
        repo,
        actor,
      }),
    ]);

    return NextResponse.json({ projects, applications });
  } catch (error) {
    return jsonError(error);
  }
}
