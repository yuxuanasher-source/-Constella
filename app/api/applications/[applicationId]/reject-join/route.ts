import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
} from "@/features/applications/application-route-utils";
import { rejectApplicationJoin } from "@/features/applications/application-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    const application = await rejectApplicationJoin({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: {
        applicationId,
        reason: requiredString(body, "reason"),
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    return jsonError(error);
  }
}
