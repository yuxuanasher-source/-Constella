import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { cancelShiftChangeRequest } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await params;
    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const shiftChangeRequest = await cancelShiftChangeRequest({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context, true),
      requestId,
    });

    return NextResponse.json({ shiftChangeRequest });
  } catch (error) {
    return jsonError(error);
  }
}
