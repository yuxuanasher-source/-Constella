import { NextResponse } from "next/server";

import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import { lockSettlementBatch } from "@/features/settlements/settlement-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getSettlementRouteContext();
    const batch = await lockSettlementBatch({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
      reason: requiredString(body, "reason"),
    });

    return NextResponse.json({ batch });
  } catch (error) {
    return jsonError(error);
  }
}
