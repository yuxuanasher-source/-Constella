import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
} from "@/features/live-operations/live-operations-route-utils";
import { submitLiveReport } from "@/features/live-operations/live-operations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonBody(request);
    const context = await getLiveOperationsRouteContext();
    const report = await submitLiveReport({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      taskId,
      input: {
        screenshotStoragePath: optionalString(body, "screenshotStoragePath"),
        screenshotFileHash: optionalString(body, "screenshotFileHash"),
        screenshotDuration: optionalNumber(body, "screenshotDuration"),
        claimedDuration: optionalNumber(body, "claimedDuration"),
        viewers: optionalNumber(body, "viewers"),
      },
    });

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
