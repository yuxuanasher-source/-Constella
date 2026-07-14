import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  assertCustomRuleAuthorRole,
  customRuleErrorResponse,
  customRuleResolvedFailureResponse,
  customRuleUserExamplesSchema,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleAuthoringDto,
} from "@/features/settlements/custom-rule-route-context";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const selectionSchema = z
  .strictObject({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    criteriaCodes: z
      .array(
        z.enum([
          "approved_reports",
          "period_overlap",
          "complete_evidence",
          "project_scope",
        ]),
      )
      .min(1)
      .max(4),
    userExamples: customRuleUserExamplesSchema.optional(),
  })
  .refine((selection) => selection.periodStart <= selection.periodEnd, {
    path: ["periodStart"],
    message: "selection period is invalid",
  });
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
  contractConfirmed: z.literal(true),
  expectedContractHash: hashSchema,
  expectedCatalogVersion: hashSchema,
  expectedFormulaHash: hashSchema.optional(),
  expectedEvidenceHash: hashSchema.optional(),
  expectedDataSelectionHash: hashSchema.optional(),
  simulationSelection: selectionSchema,
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
    const authorizedSelection = await context.authorizeSimulationSelection({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: inputParams.sessionId,
      draftId: body.expectedDraftId,
      expectedRevisionNumber: body.expectedRevisionNumber,
      selection: body.simulationSelection,
    });
    const result = await context.authoring.confirmContract({
      actor: context.actor,
      projectId: inputParams.projectId,
      conversationId: inputParams.sessionId,
      ...body,
      simulationSelection: authorizedSelection,
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
      objectType: "ai_settlement_rule_contract",
      objectId: inputParams.sessionId,
      projectId: inputParams.projectId,
      after: { confirmed: true },
    });
    return NextResponse.json({ result: toCustomRuleAuthoringDto(result) });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
