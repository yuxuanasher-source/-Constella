import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
} from "@/features/live-operations/live-operations-route-utils";
import { updateLiveTask } from "@/features/live-operations/live-operations-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const task = await updateLiveTask({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      taskId,
      input: {
        title: optionalString(body, "title"),
        plannedStartAt: optionalString(body, "plannedStartAt"),
        plannedEndAt: optionalString(body, "plannedEndAt"),
        plannedDuration: optionalNumber(body, "plannedDuration"),
      },
    });

    return NextResponse.json({ task });
  } catch (error) {
    return jsonError(error);
  }
}
