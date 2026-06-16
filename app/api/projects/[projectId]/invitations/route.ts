import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/applications/application-route-utils";
import { SupabaseApplicationRepository } from "@/features/applications/application-repository";
import { inviteStreamerToProject } from "@/features/applications/application-service";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const collaborationId = optionalString(body, "collaborationId");
    const context = await getAdmissionRouteContext();
    let repoClient = context.supabase;
    if (collaborationId) {
      const admin = createSupabaseAdminClient();
      if (!admin) {
        throw new RouteError("Collaboration service is unavailable", 500);
      }
      repoClient = admin;
    }

    const repo = new SupabaseApplicationRepository(repoClient);
    const application = await inviteStreamerToProject({
      repo,
      audit: (input) => context.audit(repoClient, input),
      notify: (input) => context.notify(repoClient, input),
      actor: actorFromContext(context),
      input: {
        projectId,
        streamerId: requiredString(body, "streamerId"),
        collaborationId,
      },
    });

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
