import { NextResponse } from "next/server";

import { listProjectCollaborations } from "@/features/collaborations/collaboration-queries";
import { SupabaseCollaborationRepository } from "@/features/collaborations/collaboration-repository";
import {
  COLLABORATION_SETTLEMENT_MODES,
  openCollaboration,
  type CollaborationSettlementMode,
} from "@/features/collaborations/collaboration-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const collaborations = await listProjectCollaborations(supabase, projectId);
    return NextResponse.json({ collaborations });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      settlementMode?: unknown;
      sharePercentage?: unknown;
      hourlyFixedAmount?: unknown;
    };
    const settlementMode =
      typeof body.settlementMode === "string" ? body.settlementMode.trim() : "";
    if (
      !COLLABORATION_SETTLEMENT_MODES.includes(
        settlementMode as CollaborationSettlementMode,
      )
    ) {
      return NextResponse.json(
        { error: "settlementMode is invalid" },
        { status: 400 },
      );
    }

    const { projectId } = await params;
    const collaboration = await openCollaboration({
      repo: new SupabaseCollaborationRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      input: {
        projectId,
        settlementMode: settlementMode as CollaborationSettlementMode,
        sharePercentage: asNumber(body.sharePercentage),
        hourlyFixedAmount: asNumber(body.hourlyFixedAmount),
      },
    });

    return NextResponse.json({ collaboration }, { status: 201 });
  } catch (error) {
    return jsonServiceError(error);
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
