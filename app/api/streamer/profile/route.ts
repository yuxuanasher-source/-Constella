import { NextResponse } from "next/server";

import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { getStreamerProfileRow } from "@/features/streamers/streamer-queries";
import { toStreamerDesktopProfileDto } from "@/features/streamers/streamer-ui-dto";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError("Only streamers can view streamer profile", 403);
    }

    const streamerId = await getStreamerIdForUser(
      context.supabase,
      context.auth.userId,
      context.auth.organizationId,
    );
    if (!streamerId) {
      throw new RouteError("Current user is not bound to a streamer", 400);
    }

    const row = await getStreamerProfileRow(context.supabase, streamerId);
    return NextResponse.json({
      profile: row
        ? toStreamerDesktopProfileDto(row, {
            organizationName: context.auth.organizationName,
          })
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
