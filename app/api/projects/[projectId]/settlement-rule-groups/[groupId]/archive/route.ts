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

const paramsSchema = z.strictObject({
  projectId: z.string().uuid(),
  groupId: z.string().uuid(),
});
const bodySchema = z.strictObject({
  archivedAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(1_000),
  clientRequestId: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; groupId: string }> },
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

    const group = await context.groups.archiveSettlementRuleGroup({
      actor: context.actor,
      projectId: inputParams.projectId,
      groupId: inputParams.groupId,
      archivedAt: body.archivedAt,
      reason: body.reason,
      clientRequestId: body.clientRequestId,
    });

    return NextResponse.json({ group: toSettlementRuleGroupDto(group) });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
