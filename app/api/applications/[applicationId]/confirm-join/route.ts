import { NextResponse } from "next/server";

import {
  actorFromContext,
  getAdmissionRouteContext,
  jsonError,
  optionalNumber,
  optionalString,
  RouteError,
} from "@/features/applications/application-route-utils";
import {
  confirmApplicationJoin,
  type ConfirmJoinSettlementOverride,
} from "@/features/applications/application-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  try {
    const { applicationId } = await params;
    const settlement = await readOptionalSettlement(request);
    const context = await getAdmissionRouteContext();
    const projectStreamer = await confirmApplicationJoin({
      repo: context.repo,
      audit: (input) => context.audit(context.supabase, input),
      notify: (input) => context.notify(context.supabase, input),
      actor: actorFromContext(context),
      input: { applicationId, settlement },
    });

    return NextResponse.json({ projectStreamer });
  } catch (error) {
    return jsonError(error);
  }
}

// 确认加入的历史调用不带 body；带 body 时才解析可选的结算规则设定
// （结算流程改造 step 1：入项即定价）。
async function readOptionalSettlement(
  request: Request,
): Promise<ConfirmJoinSettlementOverride | undefined> {
  const raw = await request.text();
  if (!raw.trim()) {
    return undefined;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new RouteError("Invalid JSON body", 400);
  }

  if (typeof body !== "object" || body === null) {
    throw new RouteError("Invalid JSON body", 400);
  }

  const record = body as Record<string, unknown>;
  const settlement = record.settlement;
  if (settlement === undefined || settlement === null) {
    return undefined;
  }

  if (typeof settlement !== "object") {
    throw new RouteError("settlement must be an object", 400);
  }

  const settlementRecord = settlement as Record<string, unknown>;
  const settlementMethod = optionalString(settlementRecord, "settlementMethod");
  if (!settlementMethod) {
    throw new RouteError("settlement.settlementMethod is required", 400);
  }

  return {
    settlementMethod,
    hourlyRate: optionalNumber(settlementRecord, "hourlyRate"),
    baseSalary: optionalNumber(settlementRecord, "baseSalary"),
    cpsRateBps: optionalNumber(settlementRecord, "cpsRateBps"),
  };
}
