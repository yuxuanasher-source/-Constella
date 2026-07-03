import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { applyStreamerOperationTier } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const { streamer, plan } = await applyStreamerOperationTier({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
    });

    return NextResponse.json({ streamer, plan });
  } catch (error) {
    return jsonError(error);
  }
}
