import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
  optionalBoolean,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/live-operations/live-operations-route-utils";
import { reviewLiveReport } from "@/features/live-operations/live-operations-service";

const reviewDecisions = new Set(["approve", "reject", "need_more"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const { reportId } = await params;
    const body = await readJsonBody(request);
    const decision = requiredString(body, "decision");
    if (!reviewDecisions.has(decision)) {
      throw new Error("decision must be approve, reject, or need_more");
    }

    const context = await getLiveOperationsRouteContext();
    const report = await reviewLiveReport({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      reportId,
      input: {
        decision: decision as "approve" | "reject" | "need_more",
        includeInTaskResult: optionalBoolean(body, "includeInTaskResult"),
        enterSettlementPool: optionalBoolean(body, "enterSettlementPool"),
        reviewNotes: optionalString(body, "reviewNotes"),
        reason: optionalString(body, "reason"),
      },
    });

    return NextResponse.json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
