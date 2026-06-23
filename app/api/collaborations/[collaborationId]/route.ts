import { NextResponse } from "next/server";

import { SupabaseCollaborationRepository } from "@/features/collaborations/collaboration-repository";
import {
  changeCollaborationStatus,
  COLLABORATION_SETTLEMENT_MODES,
  updateCollaborationSettlement,
  type CollaborationSettlementMode,
} from "@/features/collaborations/collaboration-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const MANAGEABLE_STATUSES = new Set(["active", "paused", "ended", "revoked"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ collaborationId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
      settlementMode?: unknown;
      sharePercentage?: unknown;
      hourlyFixedAmount?: unknown;
    };
    const { collaborationId } = await params;
    const repo = new SupabaseCollaborationRepository(supabase);
    const audit = (input: Parameters<typeof writeAuditLog>[1]) =>
      writeAuditLog(supabase, input);

    if (typeof body.settlementMode === "string") {
      const mode = body.settlementMode.trim();
      if (
        !COLLABORATION_SETTLEMENT_MODES.includes(
          mode as CollaborationSettlementMode,
        )
      ) {
        return NextResponse.json(
          { error: "settlementMode is invalid" },
          { status: 400 },
        );
      }
      const collaboration = await updateCollaborationSettlement({
        repo,
        audit,
        actor: auth,
        collaborationId,
        input: {
          settlementMode: mode as CollaborationSettlementMode,
          sharePercentage: asNumber(body.sharePercentage),
          hourlyFixedAmount: asNumber(body.hourlyFixedAmount),
        },
      });
      return NextResponse.json({ collaboration });
    }

    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (!MANAGEABLE_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "status must be active, paused, ended, or revoked" },
        { status: 400 },
      );
    }

    const collaboration = await changeCollaborationStatus({
      repo,
      audit,
      actor: auth,
      collaborationId,
      status: status as "active" | "paused" | "ended" | "revoked",
    });
    return NextResponse.json({ collaboration });
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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
