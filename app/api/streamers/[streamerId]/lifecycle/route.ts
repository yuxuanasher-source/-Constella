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
import { changeStreamerLifecycleStage } from "@/features/streamer-lifecycle/streamer-lifecycle-service";
import {
  STREAMER_LIFECYCLE_STAGES,
  type StreamerLifecycleStage,
} from "@/features/streamer-lifecycle/streamer-lifecycle-state";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const body = await readJsonBody(request);
    const stage = requiredString(body, "stage");
    if (!STREAMER_LIFECYCLE_STAGES.includes(stage as StreamerLifecycleStage)) {
      throw new RouteError(
        `stage must be one of ${STREAMER_LIFECYCLE_STAGES.join(", ")}`,
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

    const streamer = await changeStreamerLifecycleStage({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
      input: { stage: stage as StreamerLifecycleStage },
      reason,
    });

    return NextResponse.json({ streamer });
  } catch (error) {
    return jsonError(error);
  }
}
