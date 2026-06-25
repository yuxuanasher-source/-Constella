import { NextResponse } from "next/server";
import { z } from "zod";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
} from "@/features/applications/application-route-utils";
import { getStreamerIdForUser } from "@/features/applications/application-repository";
import { submitRecording } from "@/features/applications/application-service";
import { parseJsonBody } from "@/lib/http/parse-json-body";

const submitRecordingBodySchema = z.object({
  storagePath: z.string().trim().min(1).optional(),
  externalUrl: z.string().trim().min(1).optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const body = await parseJsonBody(request, submitRecordingBodySchema);
    const context = await getAdmissionRouteContext();
    const currentStreamerId =
      context.auth.role === "streamer"
        ? await getStreamerIdForUser(
            context.supabase,
            context.auth.userId,
            context.auth.organizationId,
          )
        : null;
    const recording = await submitRecording({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: {
        ...actorFromContext(context),
        streamerId: currentStreamerId,
      },
      input: {
        applicationId,
        storagePath: body.storagePath,
        externalUrl: body.externalUrl,
        durationSeconds: body.durationSeconds,
      },
    });

    return NextResponse.json({ recording }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
