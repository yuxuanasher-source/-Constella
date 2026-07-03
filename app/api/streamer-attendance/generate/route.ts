import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
import { generateAttendanceRecords } from "@/features/streamer-lifecycle/streamer-lifecycle-service";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const context = await getStreamerLifecycleRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "project_management",
    });

    const result = await generateAttendanceRecords({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: await actorFromContext(context),
      input: { until: optionalString(body, "until") },
    });

    return NextResponse.json({ result });
  } catch (error) {
    return jsonError(error);
  }
}
