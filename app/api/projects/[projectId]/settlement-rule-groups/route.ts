import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toSettlementRuleGroupDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const querySchema = z.strictObject({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
const bodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000).nullable().optional(),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const query = parseCustomRuleParams(
      Object.fromEntries(new URL(request.url).searchParams),
      querySchema,
    );
    await context.requireProjectAccess(inputParams.projectId);

    const groups = await context.groups.listSettlementRuleGroups({
      actor: context.actor,
      projectId: inputParams.projectId,
      includeArchived: query.includeArchived,
    });

    return NextResponse.json({
      groups: groups.map(toSettlementRuleGroupDto),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
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

    const group = await context.groups.createSettlementRuleGroup({
      actor: context.actor,
      projectId: inputParams.projectId,
      name: body.name,
      description: body.description ?? null,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json({ group: toSettlementRuleGroupDto(group) }, {
      status: 201,
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
