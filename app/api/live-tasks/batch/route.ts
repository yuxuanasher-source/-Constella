import { NextResponse } from "next/server";

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
  createLiveTasks,
  type LiveTaskType,
} from "@/features/live-operations/live-operations-service";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const rawTasks = body.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      throw new RouteError("tasks is required", 400);
    }

    const context = await getLiveOperationsRouteContext();
    const tasks = await createLiveTasks({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      inputs: rawTasks.map((rawTask) => {
        const taskBody =
          rawTask && typeof rawTask === "object"
            ? (rawTask as Record<string, unknown>)
            : {};

        return {
          projectId: requiredString(taskBody, "projectId"),
          streamerId: requiredString(taskBody, "streamerId"),
          title: requiredString(taskBody, "title"),
          taskType: optionalLiveTaskType(taskBody),
          plannedStartAt: optionalString(taskBody, "plannedStartAt"),
          plannedEndAt: optionalString(taskBody, "plannedEndAt"),
          plannedDuration: optionalNumber(taskBody, "plannedDuration"),
          note: optionalString(taskBody, "note"),
          collaborationId: optionalString(taskBody, "collaborationId"),
        };
      }),
    });

    return NextResponse.json({ tasks }, { status: 201 });
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
