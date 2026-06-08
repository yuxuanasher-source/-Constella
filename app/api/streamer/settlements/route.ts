import { NextResponse } from "next/server";

import {
  listStreamerPayableItems,
  toStreamerEarningsSummary,
} from "@/features/settlements/streamer-settlement-queries";
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
      throw new RouteError("Only streamers can view streamer settlements", 403);
    }

    const streamerId = await getStreamerIdForUser(
      context.supabase,
      context.auth.userId,
      context.auth.organizationId,
    );
    if (!streamerId) {
      throw new RouteError("Current user is not bound to a streamer", 400);
    }

    const items = await listStreamerPayableItems(context.supabase, streamerId);
    return NextResponse.json({
      earnings: toStreamerEarningsSummary(items),
    });
  } catch (error) {
    return jsonError(error);
  }
}
