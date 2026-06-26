import { NextResponse } from "next/server";

import {
  reviewProjectCollaborationApplication,
  SupabaseProjectCollaborationRepository,
  type ReviewCollaborationApplicationInput,
} from "@/features/collaborations/project-collaboration-service";
import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; applicationId: string }> },
) {
  try {
    const { projectId, applicationId } = await params;
    const body = await readJsonBody(request);
    const context = await getAdmissionRouteContext();
    const repo = new SupabaseProjectCollaborationRepository(context.supabase);
    const result = await reviewProjectCollaborationApplication({
      repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: actorFromContext(context),
      projectId,
      applicationId,
      input: reviewInputFromBody(body),
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

function reviewInputFromBody(
  body: Record<string, unknown>,
): ReviewCollaborationApplicationInput {
  if (body.action === "accept") {
    return {
      action: "accept",
      ownerReviewNote: optionalString(body.ownerReviewNote),
    };
  }
  if (body.action === "reject") {
    return {
      action: "reject",
      ownerReviewNote: optionalString(body.ownerReviewNote),
      rejectionReason: optionalString(body.rejectionReason),
    };
  }
  if (body.action === "counter") {
    return {
      action: "counter",
      ownerCounterRevenueShareBps: requiredNumber(
        body.ownerCounterRevenueShareBps,
        "ownerCounterRevenueShareBps",
      ),
      ownerReviewNote: optionalString(body.ownerReviewNote),
    };
  }

  throw new RouteError("Invalid collaboration review action", 400);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredNumber(value: unknown, key: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RouteError(`${key} is required`, 400);
  }
  return value;
}
