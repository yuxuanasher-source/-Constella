import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { syncStreamerPerformance } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const body = await readJsonBody(request);
    const periodStart = requiredString(body, "periodStart");
    const periodEnd = requiredString(body, "periodEnd");

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const snapshot = await syncStreamerPerformance({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
      input: { periodStart, periodEnd },
    });

    return NextResponse.json({ snapshot });
  } catch (error) {
    return jsonError(error);
  }
}
