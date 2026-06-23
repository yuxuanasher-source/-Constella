import { NextResponse } from "next/server";

import { SupabaseSettlementLineRepository } from "@/features/settlements/settlement-line-repository";
import { recomputeCollaborationSettlement } from "@/features/settlements/settlement-line-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

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
      collaborationId?: unknown;
    };
    const collaborationId =
      typeof body.collaborationId === "string"
        ? body.collaborationId.trim()
        : "";
    if (!collaborationId) {
      return NextResponse.json(
        { error: "collaborationId is required" },
        { status: 400 },
      );
    }

    const { batchId } = await params;
    const collaborationSettlement = await recomputeCollaborationSettlement({
      repo: new SupabaseSettlementLineRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      batchId,
      collaborationId,
    });

    return NextResponse.json({ collaborationSettlement }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
