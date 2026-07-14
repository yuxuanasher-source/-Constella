import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { listOpsSettlementBatches } from "@/features/settlements/settlement-queries";
import { createProductionCustomSettlementExecutionPort } from "@/features/settlements/custom-rule-service";
import {
  getSettlementRouteContext,
  isUuid,
  jsonError,
  optionalString,
  readJsonBody,
  requiredString,
  requiredUuid,
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

    const batches = await listOpsSettlementBatches(
      context.supabase,
      context.auth.organizationId,
    );
    return NextResponse.json({ batches });
  } catch (error) {
    return jsonError(error);
  }
}

// 建批次可选按主播过滤：缺省 = 周期内全量入批（旧行为）；传入时必须是
// 非空 uuid 数组，空数组视为参数错误而不是「全不选也生成」。
function optionalStreamerIds(
  body: Record<string, unknown>,
): string[] | undefined {
  const value = body.streamerIds;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new RouteError("streamerIds must be a non-empty array", 400);
  }

  const ids = value.map((item) => String(item));
  if (ids.some((id) => !isUuid(id))) {
    throw new RouteError("streamerIds must contain valid uuids", 400);
  }

  return ids;
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
      customExecutionPort: createProductionCustomSettlementExecutionPort({
        supabase: context.supabase,
      }),
      input: {
        projectId: requiredUuid(body, "projectId"),
        batchType: batchType as SettlementBatchType,
        periodStart: requiredString(body, "periodStart"),
        periodEnd: requiredString(body, "periodEnd"),
        title: optionalString(body, "title"),
        streamerIds: optionalStreamerIds(body),
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
