import { NextResponse } from "next/server";

import { listStreamerTaskCards } from "@/features/live-operations/live-operations-queries";
import { getStreamerIdForUser } from "@/features/live-operations/live-operations-repository";
import {
  getLiveOperationsRouteContext,
  jsonError,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (context.auth.role !== "streamer") {
      throw new RouteError("Only streamers can view streamer tasks", 403);
    }

    const streamerId = await getStreamerIdForUser(
      context.supabase,
      context.auth.userId,
    );
    if (!streamerId) {
      throw new RouteError("Current user is not bound to a streamer", 400);
    }

    const tasks = await listStreamerTaskCards(context.supabase, streamerId);
    return NextResponse.json({ tasks });
  } catch (error) {
    return jsonError(error);
  }
}
