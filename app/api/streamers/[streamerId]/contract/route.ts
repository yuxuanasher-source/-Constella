import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { updateStreamerContract } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const body = await readJsonBody(request);
    const reason = requiredString(body, "reason");

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const streamer = await updateStreamerContract({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
      input: {
        contractStartDate:
          body.contractStartDate === null
            ? null
            : optionalString(body, "contractStartDate"),
        contractEndDate:
          body.contractEndDate === null
            ? null
            : optionalString(body, "contractEndDate"),
        revenueShareBps:
          body.revenueShareBps === null
            ? null
            : optionalNumber(body, "revenueShareBps"),
      },
      reason,
    });

    return NextResponse.json({ streamer });
  } catch (error) {
    return jsonError(error);
  }
}
