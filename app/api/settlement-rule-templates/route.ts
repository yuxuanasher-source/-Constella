import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CustomRuleRouteError,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  toReusableSettlementRuleTemplateDto,
} from "@/features/settlements/custom-rule-route-context";

const bodySchema = z.strictObject({
  projectId: z.string().uuid(),
  sourceRuleVersionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000).nullable().optional(),
  confirmedContractHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});

function assertTemplateMutationRole(role: string): void {
  if (role !== "owner" && role !== "ops_manager") {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_ACTION_NOT_ALLOWED",
      message: "Current role cannot save settlement rule templates",
      status: 403,
      retryable: false,
    });
  }
}

export async function GET(_request?: Request) {
  try {
    void _request;
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const templates =
      await context.templates.listReusableSettlementRuleTemplates({
        actor: context.actor,
      });

    return NextResponse.json({
      templates: templates.map(toReusableSettlementRuleTemplateDto),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;
    assertTemplateMutationRole(context.auth.role);

    const body = await parseCustomRuleJson(request, bodySchema);
    await context.requireProjectAccess(body.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const template = await context.lifecycle.saveOrganizationRuleTemplate({
      actor: context.actor,
      projectId: body.projectId,
      sourceRuleVersionId: body.sourceRuleVersionId,
      name: body.name,
      description: body.description ?? null,
      confirmedContractHash: body.confirmedContractHash,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json(
      {
        template: toReusableSettlementRuleTemplateDto({
          ...template,
          kind: "organization",
          readOnly: false,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
