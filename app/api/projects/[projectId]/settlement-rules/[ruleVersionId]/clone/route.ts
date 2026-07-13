import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toCustomRuleGovernanceRuleDto,
} from "@/features/settlements/custom-rule-route-context";
import type { CustomSettlementRuleVersion } from "@/features/settlements/custom-rule-repository";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
});
const bodySchema = z.strictObject({
  targetProjectId: z.string().uuid(),
  targetVariableCatalogVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  targetAvailableVariableIds: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u))
    .max(300),
  newVersionId: z.string().uuid(),
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
    await context.requireProjectAccess(body.targetProjectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const clone = await context.lifecycle.cloneCustomRuleToDraft({
      actor: context.actor,
      sourceProjectId: inputParams.projectId,
      targetProjectId: body.targetProjectId,
      sourceRuleVersionId: inputParams.ruleVersionId,
      targetVariableCatalogVersion: body.targetVariableCatalogVersion,
      targetAvailableVariableIds: body.targetAvailableVariableIds,
      newVersionId: body.newVersionId,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json(
      {
        rule: toCustomRuleGovernanceRuleDto(
          clone.version as unknown as CustomSettlementRuleVersion,
        ),
        lineage: clone.lineage,
        missingTargetVariables: clone.missingTargetVariables,
      },
      { status: 201 },
    );
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
