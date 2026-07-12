import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  assertCustomRuleAuthorRole,
  customRuleErrorResponse,
  customRuleResolvedFailureResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleAuthoringDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
});
const bodySchema = z.strictObject({
  expectedDraftId: z.string().uuid(),
  expectedRevisionNumber: z.number().int().positive(),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  promptText: z.string().trim().min(1).max(4_000),
});

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; sessionId: string }>;
  },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;
    assertCustomRuleAuthorRole(context.auth.role);

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const body = await parseCustomRuleJson(request, bodySchema);
    await context.requireProjectAccess(inputParams.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });
    const result = await context.authoring.answerOrRevise({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: inputParams.sessionId,
      ...body,
    });
    const failureResponse = customRuleResolvedFailureResponse(result);
    if (failureResponse) return failureResponse;
    await context.audit({
      organizationId: context.auth.organizationId,
      actorUserId: context.auth.userId,
      actorName: context.auth.name,
      actorRole: context.auth.role,
      action: "update",
      module: "settlement_rule_authoring",
      objectType: "ai_settlement_rule_session",
      objectId: inputParams.sessionId,
      projectId: inputParams.projectId,
      after: { resultKind: "kind" in result ? result.kind : "failed" },
    });
    return NextResponse.json({ result: toCustomRuleAuthoringDto(result) });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
