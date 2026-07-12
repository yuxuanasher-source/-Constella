import { NextResponse } from "next/server";
import { z } from "zod";

import {
  customRuleErrorResponse,
  getCustomRuleRouteContext,
  parseCustomRuleParams,
} from "@/features/settlements/custom-rule-route-context";

const requestSchema = z.strictObject({
  projectId: z.string().uuid(),
  scope: z.enum(["payable", "receivable"]),
  executionGrain: z.enum([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ]),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const context = await getCustomRuleRouteContext();
    if (context instanceof Response) return context;

    const routeParams = await params;
    const query = new URL(request.url).searchParams;
    const input = parseCustomRuleParams(
      {
        projectId: routeParams.projectId,
        scope: query.get("scope"),
        executionGrain: query.get("executionGrain"),
      },
      requestSchema,
    );
    await context.requireProjectAccess(input.projectId);
    const catalog = await context.catalog.getCatalog({
      organizationId: context.auth.organizationId,
      projectId: input.projectId,
      scope: input.scope,
      executionGrain: input.executionGrain,
    });
    return NextResponse.json({ catalog });
  } catch (error) {
    return customRuleErrorResponse(error);
  }
}
