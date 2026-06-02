import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
} from "@/features/applications/application-route-utils";
import { reviewRecordingSubmission } from "@/features/applications/application-service";

const reviewDecisions = new Set(["approved", "rejected", "needs_changes"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const body = await readJsonBody(request);
    const decision = requiredString(body, "decision");
    if (!reviewDecisions.has(decision)) {
      throw new Error("decision must be approved, rejected, or needs_changes");
    }

    const context = await getAdmissionRouteContext();
    const application = await reviewRecordingSubmission({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: {
        applicationId,
        decision: decision as "approved" | "rejected" | "needs_changes",
        note: optionalString(body, "note"),
      },
    });

    return NextResponse.json({ application });
  } catch (error) {
    return jsonError(error);
  }
}
