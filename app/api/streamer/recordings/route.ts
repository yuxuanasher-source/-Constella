import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
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
  );
  if (!streamerId) {
    throw new RouteError("Current user is not bound to a streamer", 400);
  }

  return { context, streamerId };
}
