import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  RouteError,
} from "@/features/live-operations/live-operations-route-utils";
import { confirmLiveReportOcrResult } from "@/features/live-operations/live-operations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const { reportId } = await params;
    const body = await readJsonBody(request);
    const confirmedDuration = optionalNumber(body, "confirmedDuration");
    if (confirmedDuration === undefined) {
      throw new RouteError("confirmedDuration is required", 400);
    }

    const context = await getLiveOperationsRouteContext();
    const report = await confirmLiveReportOcrResult({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context, true),
      reportId,
      input: {
        ocrDuration: optionalNumber(body, "ocrDuration"),
        ocrViewers: optionalNumber(body, "ocrViewers"),
        confirmedDuration,
        confirmedViewers: optionalNumber(body, "confirmedViewers"),
        note: optionalString(body, "note"),
      },
    });

    return NextResponse.json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
