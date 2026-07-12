import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { businessRuleContractSchema } from "@/features/settlements/custom-rule-contract";
import {
  CustomRuleRouteError,
  assertCustomRuleAuthorRole,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
} from "@/features/settlements/custom-rule-route-context";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";

const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const bodySchema = z.strictObject({
  formula: z.string().trim().min(1).max(4_000),
  contract: businessRuleContractSchema,
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

    const validation = validateCustomRuleFormula(body.formula, {
      scope: body.contract.scope,
      executionGrain: body.contract.executionGrain,
      parameters: body.contract.parameters.map((parameter) => ({
        name: parameter.name,
        valueType: parameter.valueType,
      })),
    });
    if (!validation.ok) {
      const issue = validation.issues[0];
      throw new CustomRuleRouteError({
        code: issue?.code ?? "CUSTOM_RULE_FORMULA_INVALID",
        message: issue?.message ?? "Settlement rule formula is invalid",
        status: 422,
        retryable: false,
        path: [
          "formula",
          ...(issue?.path ? issue.path.split(".").filter(Boolean) : []),
        ],
      });
    }

    return NextResponse.json({
      validation: {
        ok: true,
        variables: validation.variables,
        parameters: validation.parameters,
        formulaHash: validation.formulaHash,
      },
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
