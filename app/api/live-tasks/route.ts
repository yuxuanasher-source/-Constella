import { NextResponse } from "next/server";

import { listOpsLiveTaskQueue } from "@/features/live-operations/live-operations-queries";
import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { createLiveTask } from "@/features/live-operations/live-operations-service";
import { recordOnboardingProgress } from "@/features/funnel/onboarding";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view live tasks", 403);
    }

    const tasks = await listOpsLiveTaskQueue(context.supabase);
    return NextResponse.json({ tasks });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const actor = await actorFromContext(context);
    const task = await createLiveTask({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor,
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

    await recordOnboardingProgress({
      client: context.supabase,
      actor,
      step: "schedule_live",
    }).catch(() => undefined);

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
