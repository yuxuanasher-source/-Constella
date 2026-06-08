import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { listOpsSettlementBatches } from "@/features/settlements/settlement-queries";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  RouteError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import {
  generateSettlementBatch,
  type SettlementBatchType,
} from "@/features/settlements/settlement-service";
import { isMcnStaff } from "@/lib/rbac/roles";

const batchTypes = new Set(["receivable", "payable"]);

export async function GET() {
  try {
    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view settlement batches", 403);
    }

    const batches = await listOpsSettlementBatches(context.supabase);
    return NextResponse.json({ batches });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const batchType = requiredString(body, "batchType");
    if (!batchTypes.has(batchType)) {
      throw new RouteError("batchType must be receivable or payable", 400);
    }

    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const result = await generateSettlementBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      input: {
        projectId: requiredString(body, "projectId"),
        batchType: batchType as SettlementBatchType,
        periodStart: requiredString(body, "periodStart"),
        periodEnd: requiredString(body, "periodEnd"),
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
