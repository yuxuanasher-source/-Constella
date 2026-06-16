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
import {
  createLiveTask,
  type LiveTaskType,
} from "@/features/live-operations/live-operations-service";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET() {
  try {
    const context = await getLiveOperationsRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view live tasks", 403);
    }

    const tasks = await listOpsLiveTaskQueue(
      context.supabase,
      context.auth.organizationId,
    );
    return NextResponse.json({ tasks });
  } catch (error) {
    return jsonError(error);
  }
}

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
        taskType: optionalLiveTaskType(body),
        plannedStartAt: optionalString(body, "plannedStartAt"),
        plannedEndAt: optionalString(body, "plannedEndAt"),
        plannedDuration: optionalNumber(body, "plannedDuration"),
        note: optionalString(body, "note"),
        collaborationId: optionalString(body, "collaborationId"),
      },
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

function optionalLiveTaskType(
  body: Record<string, unknown>,
): LiveTaskType | undefined {
  const value =
    optionalString(body, "type") ?? optionalString(body, "taskType");
  if (!value) return undefined;
  if (
    value === "project" ||
    value === "trial" ||
    value === "training" ||
    value === "temporary"
  ) {
    return value;
  }
  throw new RouteError("Invalid live task type", 400);
}
