import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CustomRuleRouteError,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleLifecycleResultDto,
} from "@/features/settlements/custom-rule-route-context";

const clientRequestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const canonicalOffsetDateTimeSchema = z.iso.datetime({ offset: true });
const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const targetSchema = z.discriminatedUnion("targetType", [
  z.strictObject({ targetType: z.literal("project"), targetId: z.null() }),
  z.strictObject({
    targetType: z.literal("streamer_group"),
    targetId: z.string().uuid(),
  }),
  z.strictObject({
    targetType: z.literal("project_streamer"),
    targetId: z.string().uuid(),
  }),
]);
const sourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ai_draft"), id: z.string().uuid() }),
  z.strictObject({ kind: z.literal("saved_draft"), id: z.string().uuid() }),
]);
const bodySchema = z.strictObject({
  source: sourceSchema,
  sourceSimulationId: z.string().uuid(),
  destinationVersionId: z.string().uuid(),
  destinationSimulationId: z.string().uuid(),
  scope: z.enum(["receivable", "payable", "external_cost", "reconciliation"]),
  target: targetSchema,
  effectiveFrom: canonicalOffsetDateTimeSchema,
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: clientRequestIdSchema,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const body = await parseCustomRuleJson(request, bodySchema);
    if (body.scope !== "payable" && body.target.targetType !== "project") {
      throw new CustomRuleRouteError({
        code: "CUSTOM_RULE_TARGET_INVALID",
        message: "Settlement rule target is invalid for the selected scope",
        status: 422,
        retryable: false,
        path: ["target"],
      });
    }
    await context.requireProjectAccess(inputParams.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const result = await context.lifecycle.applyAndSubmitCustomRule({
      actor: context.actor,
      projectId: inputParams.projectId,
      source: body.source,
      sourceSimulationId: body.sourceSimulationId,
      destinationVersionId: body.destinationVersionId,
      destinationSimulationId: body.destinationSimulationId,
      scope: body.scope,
      target: body.target,
      effectiveFrom: body.effectiveFrom,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json(toCustomRuleLifecycleResultDto(result), {
      status: 201,
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
