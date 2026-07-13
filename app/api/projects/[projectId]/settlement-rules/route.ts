import { NextResponse } from "next/server";
import { z } from "zod";

import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleParams,
  toCustomRuleGovernanceRuleDto,
} from "@/features/settlements/custom-rule-route-context";

const paramsSchema = z.strictObject({ projectId: z.string().uuid() });
const querySchema = z.strictObject({
  status: z
    .enum(["draft", "pending_review", "changes_requested", "active", "archived"])
    .optional(),
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

    const rules = await context.lifecycle.listCustomRules({
      actor: context.actor,
      projectId: inputParams.projectId,
      status: query.status,
    });

    return NextResponse.json({
      rules: rules.map(toCustomRuleGovernanceRuleDto),
    });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
