import { NextResponse } from "next/server";

import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import {
  getSettlementRouteContext,
  jsonError,
  requiredQueryParam,
  RouteError,
} from "@/features/settlements/settlement-route-utils";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function GET(request: Request) {
  try {
    const batchType = requiredQueryParam(request.url, "batchType");
    const periodStart = requiredQueryParam(request.url, "periodStart");
    const periodEnd = requiredQueryParam(request.url, "periodEnd");
    if (batchType !== "streamer_payable") {
      throw new RouteError(
        `${batchType} finance batch source preview is not enabled yet`,
        400,
      );
    }

    const context = await getSettlementRouteContext();
    if (!isMcnStaff(context.auth.role)) {
      throw new RouteError("Only MCN staff can preview finance batches", 403);
    }

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const sources = await repo.listStreamerPayableSources({
      organizationId: context.auth.organizationId,
      periodStart,
      periodEnd,
      projectIds: commaList(request.url, "projectIds"),
      streamerIds: commaList(request.url, "streamerIds"),
      sourceIds: commaList(request.url, "sourceIds"),
    });

    return NextResponse.json({ sources });
  } catch (error) {
    return jsonError(error);
  }
}

function commaList(url: string, key: string): string[] {
  const value = new URL(url).searchParams.get(key);
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
