import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
} from "@/features/live-operations/live-operations-route-utils";
import { cancelLiveTask } from "@/features/live-operations/live-operations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const task = await cancelLiveTask({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      taskId,
      reason: optionalString(body, "reason"),
    });

    return NextResponse.json({ task });
  } catch (error) {
    return jsonError(error);
  }
}
