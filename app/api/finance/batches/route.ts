import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { createFinanceBatch } from "@/features/finance-batches/finance-batch-service";
import type { FinanceBatchType } from "@/features/finance-batches/finance-batch-types";
import {
  getSettlementRouteContext,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
  RouteError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

const financeBatchTypes = new Set<string>([
  "receivable",
  "streamer_payable",
  "project_cost",
  "collaboration_share",
]);

export async function GET() {
  try {
    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view finance batches", 403);
    }

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const batches = await repo.listFinanceBatches({
      organizationId: context.auth.organizationId,
    });

    return NextResponse.json({ batches });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const batchType = requiredString(body, "batchType");
    if (!financeBatchTypes.has(batchType)) {
      throw new RouteError(
        "batchType must be receivable, streamer_payable, project_cost, or collaboration_share",
        400,
      );
    }

    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const result = await createFinanceBatch({
      repo,
      actor: settlementActorFromContext(context),
      input: {
        batchType: batchType as FinanceBatchType,
        periodStart: requiredString(body, "periodStart"),
        periodEnd: requiredString(body, "periodEnd"),
        title: optionalString(body, "title"),
        selection: parseSelection(body.selection),
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

function parseSelection(value: unknown): {
  projectIds?: string[];
  streamerIds?: string[];
  sourceIds?: string[];
} {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new RouteError("selection must be an object", 400);
  }

  const selection = value as Record<string, unknown>;
  return {
    projectIds: optionalStringArray(selection, "projectIds"),
    streamerIds: optionalStringArray(selection, "streamerIds"),
    sourceIds: optionalStringArray(selection, "sourceIds"),
  };
}

function optionalStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RouteError(`${key} must be an array of strings`, 400);
  }

  return value;
}
