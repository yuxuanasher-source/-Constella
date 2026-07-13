import { NextResponse } from "next/server";
import { z } from "zod";

import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleParams,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
});

function toReviewEventDto(event: {
  id: string;
  eventType: string;
  actorId: string;
  actorRole: string;
  reason: string | null;
  comment: string | null;
  beforeStatus: string | null;
  afterStatus: string | null;
  createdAt: string;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    actorId: event.actorId,
    actorRole: event.actorRole,
    reason: event.reason,
    comment: event.comment,
    beforeStatus: event.beforeStatus,
    afterStatus: event.afterStatus,
    createdAt: event.createdAt,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; ruleVersionId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const input = parseCustomRuleParams(await params, paramsSchema);
    await context.requireProjectAccess(input.projectId);
    const events = await context.repository.listCustomRuleReviewEvents({
      organizationId: context.auth.organizationId,
      projectId: input.projectId,
      ruleVersionId: input.ruleVersionId,
    });

    return NextResponse.json({ events: events.map(toReviewEventDto) });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
