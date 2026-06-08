import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { getStreamerProjectAnnouncement } from "@/features/recordings/project-announcements";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getLiveOperationsRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError(
        "Only streamers can access project announcements",
        403,
      );
    }

    const streamerId = await getStreamerIdForUser(
      context.supabase,
      context.auth.userId,
      context.auth.organizationId,
    );
    if (!streamerId) {
      throw new RouteError("Current user is not bound to a streamer", 400);
    }

    const { projectId } = await params;
    const project = await getStreamerProjectAnnouncement(context.supabase, {
      organizationId: context.auth.organizationId,
      streamerId,
      projectId,
    });
    if (!project) {
      throw new RouteError("Project announcement not found", 404);
    }

    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(error);
  }
}
