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
  RouteError,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { concludeStreamerAssessment } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  try {
    const { assessmentId } = await params;
    const body = await readJsonBody(request);
    const result = requiredString(body, "result");
    if (result !== "passed" && result !== "failed") {
      throw new RouteError("result must be passed or failed", 400);
    }

    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const assessment = await concludeStreamerAssessment({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: await actorFromContext(context),
      assessmentId,
      input: {
        result,
        score: optionalNumber(body, "score") ?? null,
        conclusion: optionalString(body, "conclusion"),
      },
    });

    return NextResponse.json({ assessment });
  } catch (error) {
    return jsonError(error);
  }
}
