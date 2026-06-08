import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { SupabaseApplicationRepository } from "@/features/applications/application-repository";
import { submitProjectRecording } from "@/features/recordings/project-recording-delivery";
import {
  createStreamerRecordingLink,
  listStreamerRecordingLinks,
} from "@/features/recordings/streamer-recording-library";

export async function GET() {
  try {
    const { context, streamerId } = await getStreamerRecordingContext();
    const recordings = await listStreamerRecordingLinks(context.supabase, {
      organizationId: context.auth.organizationId,
      streamerId,
    });

    return NextResponse.json({ recordings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { context, streamerId } = await getStreamerRecordingContext();
    const body = await readJsonBody(request);
    if (typeof body.projectId === "string" && body.projectId.trim()) {
      const projectRecording = await submitProjectRecording({
        repo: new SupabaseApplicationRepository(context.supabase),
        audit: (input) => context.audit(context.supabase, input),
        notify: (input) => context.notify(context.supabase, input),
        actor: {
          userId: context.auth.userId,
          name: context.auth.name,
          role: context.auth.role,
          organizationId: context.auth.organizationId,
        },
        input: {
          projectId: body.projectId,
          streamerId,
          link: body.link,
          durationSeconds:
            typeof body.durationSeconds === "number"
              ? body.durationSeconds
              : undefined,
        },
      });

      return NextResponse.json({ projectRecording }, { status: 201 });
    }

    const recording = await createStreamerRecordingLink(context.supabase, {
      organizationId: context.auth.organizationId,
      streamerId,
      submittedBy: context.auth.userId,
      product: body.product,
      category: body.category,
      link: body.link,
      month: body.month,
    });

    return NextResponse.json({ recording }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

async function getStreamerRecordingContext() {
  const context = await getLiveOperationsRouteContext();
  if (context.auth.role !== "streamer") {
    throw new RouteError("Only streamers can access recording links", 403);
  }

  const streamerId = await getStreamerIdForUser(
    context.supabase,
    context.auth.userId,
    context.auth.organizationId,
  );
  if (!streamerId) {
    throw new RouteError("Current user is not bound to a streamer", 400);
  }

  return { context, streamerId };
}
