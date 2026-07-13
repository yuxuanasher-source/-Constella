import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT } from "@/features/settlements/custom-rule-governance";
import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleLifecycleResultDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
});
const clientRequestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const baseApprovalSchema = z.strictObject({
  effectiveFrom: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: clientRequestIdSchema,
});
const bodySchema = z.union([
  baseApprovalSchema.extend({
    force: z.literal(true),
    acknowledgment: z.literal(CUSTOM_RULE_FORCE_APPROVAL_ACKNOWLEDGEMENT),
  }),
  baseApprovalSchema.extend({
    force: z.literal(false).optional(),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; ruleVersionId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const body = await parseCustomRuleJson(request, bodySchema);
    await context.requireProjectAccess(inputParams.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const result =
      body.force === true
        ? await context.lifecycle.forceApproveCustomRule({
            actor: context.actor,
            projectId: inputParams.projectId,
            ruleVersionId: inputParams.ruleVersionId,
            effectiveFrom: body.effectiveFrom,
            reason: body.reason,
            acknowledgment: body.acknowledgment,
            clientRequestId: body.clientRequestId,
          })
        : await context.lifecycle.approveCustomRule({
            actor: context.actor,
            projectId: inputParams.projectId,
            ruleVersionId: inputParams.ruleVersionId,
            effectiveFrom: body.effectiveFrom,
            reason: body.reason,
            clientRequestId: body.clientRequestId,
          });

    return NextResponse.json(toCustomRuleLifecycleResultDto(result));
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
