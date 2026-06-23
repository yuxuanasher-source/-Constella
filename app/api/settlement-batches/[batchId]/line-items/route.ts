import { NextResponse } from "next/server";

import { SupabaseSettlementLineRepository } from "@/features/settlements/settlement-line-repository";
import { addSettlementLineItem } from "@/features/settlements/settlement-line-service";
import type { SettlementLineDirection } from "@/features/settlements/settlement-margin-engine";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const DIRECTIONS = new Set<SettlementLineDirection>(["revenue", "cost"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    const items = await new SupabaseSettlementLineRepository(
      supabase,
    ).listLineItems(batchId);
    return NextResponse.json({ lineItems: items });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      direction?: unknown;
      category?: unknown;
      label?: unknown;
      amount?: unknown;
      streamerId?: unknown;
      reason?: unknown;
    };
    const direction =
      typeof body.direction === "string" ? body.direction.trim() : "";
    if (!DIRECTIONS.has(direction as SettlementLineDirection)) {
      return NextResponse.json(
        { error: "direction must be revenue or cost" },
        { status: 400 },
      );
    }
    if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
      return NextResponse.json(
        { error: "amount must be a number" },
        { status: 400 },
      );
    }
    if (!asText(body.category) || !asText(body.label)) {
      return NextResponse.json(
        { error: "category and label are required" },
        { status: 400 },
      );
    }
    if (!asText(body.reason)) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const { batchId } = await params;
    const lineItem = await addSettlementLineItem({
      repo: new SupabaseSettlementLineRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      batchId,
      input: {
        direction: direction as SettlementLineDirection,
        category: String(body.category),
        label: String(body.label),
        amount: body.amount,
        streamerId: asText(body.streamerId),
        reason: String(body.reason),
      },
    });

    return NextResponse.json({ lineItem }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
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
