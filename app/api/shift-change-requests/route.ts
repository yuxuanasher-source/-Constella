import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { createShiftChangeRequest } from "@/features/streamer-lifecycle/streamer-lifecycle-service";
import {
  SHIFT_CHANGE_TYPES,
  type ShiftChangeType,
} from "@/features/streamer-lifecycle/streamer-lifecycle-state";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const liveTaskId = requiredString(body, "liveTaskId");
    const requestType = requiredString(body, "requestType");
    if (!SHIFT_CHANGE_TYPES.includes(requestType as ShiftChangeType)) {
      throw new RouteError(
        `requestType must be one of ${SHIFT_CHANGE_TYPES.join(", ")}`,
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

    const shiftChangeRequest = await createShiftChangeRequest({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      input: {
        liveTaskId,
        requestType: requestType as ShiftChangeType,
        proposedStartAt: optionalString(body, "proposedStartAt") ?? null,
        proposedEndAt: optionalString(body, "proposedEndAt") ?? null,
        substituteStreamerId:
          optionalString(body, "substituteStreamerId") ?? null,
        reason,
      },
    });

    return NextResponse.json({ shiftChangeRequest }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
