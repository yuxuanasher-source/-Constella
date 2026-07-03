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
import { reviewShiftChangeRequest } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const body = await readJsonBody(request);
    const decision = requiredString(body, "decision");
    if (decision !== "approved" && decision !== "rejected") {
      throw new RouteError("decision must be approved or rejected", 400);
    }

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const shiftChangeRequest = await reviewShiftChangeRequest({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      requestId,
      input: {
        decision,
        reviewNote: optionalString(body, "reviewNote"),
      },
    });

    return NextResponse.json({ shiftChangeRequest });
  } catch (error) {
    return jsonError(error);
  }
}
