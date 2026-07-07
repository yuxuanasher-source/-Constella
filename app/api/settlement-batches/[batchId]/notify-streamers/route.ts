import { NextResponse } from "next/server";

import {
  getSettlementRouteContext,
  jsonError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { sendSettlementBatchStatements } from "@/features/settlements/settlement-service";

// 结算流程 step 4：批次财务确认/锁定后，把每位参与主播的应付明细以站内
// 通知发给主播本人（可选动作，由运营在批次详情触发）。
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const context = await getSettlementRouteContext();
    const result = await sendSettlementBatchStatements({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
