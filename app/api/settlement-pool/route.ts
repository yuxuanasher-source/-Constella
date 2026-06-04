import { NextResponse } from "next/server";

import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import {
  getSettlementRouteContext,
  jsonError,
  requiredQueryParam,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { listSettlementPool } from "@/features/settlements/settlement-service";
import { isMcnStaff } from "@/lib/rbac/roles";

const batchTypes = new Set(["receivable", "payable"]);

export async function GET(request: Request) {
  try {
    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can view settlement pool", 403);
    }

    const projectId = requiredQueryParam(request.url, "projectId");
    const periodStart = requiredQueryParam(request.url, "periodStart");
    const periodEnd = requiredQueryParam(request.url, "periodEnd");
    const batchType =
      new URL(request.url).searchParams.get("batchType")?.trim() || "payable";
    if (!batchTypes.has(batchType)) {
      throw new RouteError("batchType must be receivable or payable", 400);
    }

    await listSettlementPool({
      repo: context.repo,
      actor: {
        userId: context.auth.userId,
        name: context.auth.name,
        role: context.auth.role,
        organizationId: context.auth.organizationId,
      },
      projectId,
      batchType: batchType as "receivable" | "payable",
      periodStart,
      periodEnd,
    });

    const reports = await listOpsSettlementPool(context.supabase, {
      projectId,
      batchType: batchType as "receivable" | "payable",
      periodStart,
      periodEnd,
    });
    return NextResponse.json({ reports });
  } catch (error) {
    return jsonError(error);
  }
}
