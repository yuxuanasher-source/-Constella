import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
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
const bodySchema = z.strictObject({
  effectiveUntil: z.iso.datetime({ offset: true }),
  fallbackProof: z.strictObject({
    simulationId: z.string().uuid(),
    proofKind: z.enum(["remaining_custom_layers", "fixed_fallback"]),
    remainingCustomLayerCount: z.number().int().min(0).max(10_000),
    fixedFallbackAvailable: z.boolean(),
    lockedBatchCount: z.number().int().min(0).max(10_000),
  }),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});

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

    const result = await context.lifecycle.archiveCustomRule({
      actor: context.actor,
      projectId: inputParams.projectId,
      ruleVersionId: inputParams.ruleVersionId,
      effectiveUntil: body.effectiveUntil,
      fallbackProof: body.fallbackProof,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json(toCustomRuleLifecycleResultDto(result));
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
