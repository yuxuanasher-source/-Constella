import { NextResponse } from "next/server";

import {
  getSettlementRouteContext,
  jsonError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { listSettlementRuleExceptions } from "@/features/settlements/custom-rule-exception-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const context = await getSettlementRouteContext();
    const exceptions = await listSettlementRuleExceptions({
      repo: context.repo,
      actor: settlementActorFromContext(context),
      batchId,
    });

    return NextResponse.json({ exceptions });
  } catch (error) {
    return jsonError(error);
  }
}
