import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
} from "@/features/applications/application-route-utils";
import { submitRecording } from "@/features/applications/application-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    const recording = await submitRecording({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: {
        applicationId,
        storagePath: optionalString(body, "storagePath"),
        externalUrl: optionalString(body, "externalUrl"),
        durationSeconds: optionalNumber(body, "durationSeconds"),
      },
    });

    return NextResponse.json({ recording }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
