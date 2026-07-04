import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { updateStreamerRating } from "@/features/streamer-lifecycle/streamer-lifecycle-service";
import {
  STREAMER_RATINGS,
  type StreamerRating,
} from "@/features/streamer-lifecycle/streamer-lifecycle-state";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const body = await readJsonBody(request);
    const rating = requiredString(body, "rating");
    if (!STREAMER_RATINGS.includes(rating as StreamerRating)) {
      throw new RouteError(
        `rating must be one of ${STREAMER_RATINGS.join(", ")}`,
        400,
      );
    }
    const reason = requiredString(body, "reason");

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const streamer = await updateStreamerRating({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
      input: { rating: rating as StreamerRating },
      reason,
    });

    return NextResponse.json({ streamer });
  } catch (error) {
    return jsonError(error);
  }
}
