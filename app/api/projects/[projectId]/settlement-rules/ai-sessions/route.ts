import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { settlementAmbiguitySchema } from "@/features/settlements/custom-rule-ai";
import { businessRuleContractSchema } from "@/features/settlements/custom-rule-contract";
import {
  assertCustomRuleAuthorRole,
  CustomRuleRouteError,
  customRuleErrorResponse,
  customRuleResolvedFailureResponse,
  createCustomRuleStartRequestIdentity,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleAuthoringDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const bodySchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  promptText: z.string().trim().min(1).max(4_000),
  seedContract: businessRuleContractSchema,
  initialAmbiguities: z.array(settlementAmbiguitySchema).min(1).max(100),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
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
    const authoring = context.authoring;
    const requestIdentity = createCustomRuleStartRequestIdentity(body);
    const claimed = await context.claimAiSession({
      projectId: inputParams.projectId,
      clientRequestId: body.clientRequestId,
      requestFingerprint: requestIdentity.requestFingerprint,
      title: body.title,
    });
    const session = claimed.session;
    const result = await authoring.startSession({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: session.id,
      title: body.title,
      clientRequestId: requestIdentity.task7ClientRequestId,
      promptText: body.promptText,
      seedContract: body.seedContract,
      initialAmbiguities: body.initialAmbiguities,
    });
    if (result.conversationId !== session.id) {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_IDEMPOTENCY_CONFLICT",
        message: "Settlement rule start replay returned a different session",
        status: 409,
        retryable: false,
      });
    }
    const failureResponse = customRuleResolvedFailureResponse(result);
    if (failureResponse) return failureResponse;
    await context.audit({
      organizationId: context.auth.organizationId,
      actorUserId: context.auth.userId,
      actorName: context.auth.name,
      actorRole: context.auth.role,
      action: "create",
      module: "settlement_rule_authoring",
      objectType: "ai_settlement_rule_session",
      objectId: session.id,
      projectId: inputParams.projectId,
      after: { resultKind: "kind" in result ? result.kind : "failed" },
    });
    return NextResponse.json(
      { session, result: toCustomRuleAuthoringDto(result) },
      { status: 201 },
    );
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
