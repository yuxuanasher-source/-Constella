import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  resolveStreamerId,
} from "@/features/applications/application-route-utils";
import { applyToProject } from "@/features/applications/application-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    const application = await applyToProject({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: {
        projectId,
        streamerId: await resolveStreamerId(context, body),
      },
    });

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
