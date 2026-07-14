import { NextResponse } from "next/server";
import { z } from "zod";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  CustomRuleRouteError,
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleJson,
  parseCustomRuleParams,
  toSettlementGroupAssignmentChangeDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  groupId: z.string().uuid(),
});
const bodySchema = z.strictObject({
  projectStreamerId: z.string().uuid(),
  effectiveFrom: z.iso.datetime({ offset: true }),
  effectiveUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});

function assertGroupMutationRole(role: string): void {
  if (role !== "owner" && role !== "ops_manager") {
    throw new CustomRuleRouteError({
      code: "CUSTOM_RULE_ACTION_NOT_ALLOWED",
      message: "Current role cannot mutate settlement rule groups",
      status: 403,
      retryable: false,
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; groupId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;
    assertGroupMutationRole(context.auth.role);

    const inputParams = parseCustomRuleParams(await params, paramsSchema);
    const body = await parseCustomRuleJson(request, bodySchema);
    await context.requireProjectAccess(inputParams.projectId);
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const change = await context.groups.changeSettlementGroupAssignment({
      actor: context.actor,
      projectId: inputParams.projectId,
      projectStreamerId: body.projectStreamerId,
      groupId: inputParams.groupId,
      effectiveFrom: body.effectiveFrom,
      effectiveUntil: body.effectiveUntil ?? null,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json({
      assignmentChange: toSettlementGroupAssignmentChangeDto(change),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
