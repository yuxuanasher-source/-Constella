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
import { createStreamerAssessment } from "@/features/streamer-lifecycle/streamer-lifecycle-service";
import {
  STREAMER_ASSESSMENT_TYPES,
  type StreamerAssessmentType,
} from "@/features/streamer-lifecycle/streamer-lifecycle-state";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const { streamerId } = await params;
    const body = await readJsonBody(request);
    const assessmentType = requiredString(body, "assessmentType");
    if (
      !STREAMER_ASSESSMENT_TYPES.includes(
        assessmentType as StreamerAssessmentType,
      )
    ) {
      throw new RouteError(
        `assessmentType must be one of ${STREAMER_ASSESSMENT_TYPES.join(", ")}`,
        400,
      );
    }
    const title = requiredString(body, "title");

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const assessment = await createStreamerAssessment({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      streamerId,
      input: {
        assessmentType: assessmentType as StreamerAssessmentType,
        title,
        projectId: optionalString(body, "projectId") ?? null,
        liveTaskId: optionalString(body, "liveTaskId") ?? null,
        scheduledAt: optionalString(body, "scheduledAt") ?? null,
      },
    });

    return NextResponse.json({ assessment }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
