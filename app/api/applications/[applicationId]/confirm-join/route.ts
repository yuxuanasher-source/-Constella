import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
} from "@/features/applications/application-route-utils";
import { confirmApplicationJoin } from "@/features/applications/application-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const context = await getAdmissionRouteContext();
    const projectStreamer = await confirmApplicationJoin({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: { applicationId },
    });

    return NextResponse.json({ projectStreamer });
  } catch (error) {
    return jsonError(error);
  }
}
