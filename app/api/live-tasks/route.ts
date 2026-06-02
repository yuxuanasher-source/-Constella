import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/live-operations/live-operations-route-utils";
import { createLiveTask } from "@/features/live-operations/live-operations-service";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const task = await createLiveTask({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      input: {
        projectId: requiredString(body, "projectId"),
        streamerId: requiredString(body, "streamerId"),
        title: requiredString(body, "title"),
        plannedStartAt: optionalString(body, "plannedStartAt"),
        plannedEndAt: optionalString(body, "plannedEndAt"),
        plannedDuration: optionalNumber(body, "plannedDuration"),
        note: optionalString(body, "note"),
      },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
