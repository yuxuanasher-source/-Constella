import { NextResponse } from "next/server";

import {
  getSettlementRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  readJsonBody,
  requiredNumber,
  requiredString,
  RouteError,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";
import {
  addManualSettlementItem,
  type ManualSettlementItemType,
} from "@/features/settlements/settlement-service";

const manualItemTypes = new Set(["cpa", "cps", "gift", "manual"]);
const evidenceLevels = new Set(["yellow", "red"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const itemType = requiredString(body, "itemType");
    const evidenceLevel = requiredString(body, "evidenceLevel");
    if (!manualItemTypes.has(itemType)) {
      throw new RouteError("itemType must be cpa, cps, gift, or manual", 400);
    }
    if (!evidenceLevels.has(evidenceLevel)) {
      throw new RouteError("evidenceLevel must be yellow or red", 400);
    }

    const context = await getSettlementRouteContext();
    const item = await addManualSettlementItem({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: settlementActorFromContext(context),
      batchId,
      input: {
        itemType: itemType as ManualSettlementItemType,
        projectId: optionalString(body, "projectId"),
        streamerId: optionalString(body, "streamerId"),
        manualAmount: requiredNumber(body, "manualAmount"),
        adjustmentAmount: optionalNumber(body, "adjustmentAmount"),
        evidenceLevel: evidenceLevel as "yellow" | "red",
        reason: requiredString(body, "reason"),
        note: optionalString(body, "note"),
      },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
