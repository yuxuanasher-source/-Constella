import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  arrayOfRecords,
  complexCostActorFromContext,
  getComplexCostRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
} from "@/features/complex-cost/complex-cost-route-utils";
import { attachProjectCostItemsToSettlementBatch } from "@/features/complex-cost/complex-cost-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getComplexCostRouteContext();

    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "complex_cost_rules",
    });

    const costItemIds = arrayOfRecords(
      { ids: body.costItemIds },
      "ids",
    ).flatMap((row) => Object.values(row).filter(isString));
    const items = await attachProjectCostItemsToSettlementBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      actor: complexCostActorFromContext(context),
      input: {
        projectId: requiredString(body, "projectId"),
        settlementBatchId: batchId,
        costItemIds:
          costItemIds.length > 0
            ? costItemIds
            : arrayOfStrings(body.costItemIds),
        reason: requiredString(body, "reason"),
      },
    });

    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
