import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
} from "@/features/live-operations/live-operations-route-utils";
import { generateReportPreReview } from "@/features/report-pre-review/report-pre-review-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  void request;
  try {
    const { reportId } = await params;
    const context = await getLiveOperationsRouteContext();
    const actor = await actorFromContext(context);
    const preReview = await generateReportPreReview({
      client: context.supabase,
      actor,
      reportId,
      audit: (input) => context.audit(context.supabase, input),
    });

    return NextResponse.json({
      preReview: {
        id: preReview.preReviewId,
        ...preReview.result,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
