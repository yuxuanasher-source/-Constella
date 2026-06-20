import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
} from "@/features/live-operations/live-operations-route-utils";
import { resolveLiveTaskAnomaly } from "@/features/live-operations/live-operations-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const context = await getLiveOperationsRouteContext();
    const task = await resolveLiveTaskAnomaly({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      taskId,
    });

    return NextResponse.json({ task });
  } catch (error) {
    return jsonError(error);
  }
}
