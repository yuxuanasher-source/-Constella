import { NextResponse } from "next/server";

import { SupabaseSettlementLineRepository } from "@/features/settlements/settlement-line-repository";
import {
  deleteSettlementLineItem,
  updateSettlementLineItem,
} from "@/features/settlements/settlement-line-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string; lineItemId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      label?: unknown;
      category?: unknown;
      amount?: unknown;
      reason?: unknown;
    };
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    if (
      body.amount !== undefined &&
      (typeof body.amount !== "number" || !Number.isFinite(body.amount))
    ) {
      return NextResponse.json(
        { error: "amount must be a number" },
        { status: 400 },
      );
    }

    const { lineItemId } = await params;
    const lineItem = await updateSettlementLineItem({
      repo: new SupabaseSettlementLineRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      lineItemId,
      input: {
        label: typeof body.label === "string" ? body.label : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        amount: typeof body.amount === "number" ? body.amount : undefined,
        reason: body.reason,
      },
    });

    return NextResponse.json({ lineItem });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ batchId: string; lineItemId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const { lineItemId } = await params;
    await deleteSettlementLineItem({
      repo: new SupabaseSettlementLineRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      lineItemId,
      reason: body.reason,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonServiceError(error);
  }
}

function jsonServiceError(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { error: error.message },
      { status: statusForServiceError(error) },
    );
  }
  return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
}
