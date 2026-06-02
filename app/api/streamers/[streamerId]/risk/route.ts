import { NextResponse } from "next/server";

import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  updateStreamerRisk,
  type StreamerRiskLevel,
} from "@/features/streamers/streamer-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const validRiskLevels = new Set(["low", "medium", "high"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ streamerId: string }> },
) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      riskLevel?: StreamerRiskLevel;
      riskReason?: string | null;
      blacklistReason?: string | null;
      reason?: string;
    };
    if (!body.riskLevel || !validRiskLevels.has(body.riskLevel)) {
      return NextResponse.json(
        { error: "riskLevel must be low, medium, or high" },
        { status: 400 },
      );
    }
    if (!body.reason?.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const { streamerId } = await params;
    const streamer = await updateStreamerRisk({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      streamerId,
      input: {
        riskLevel: body.riskLevel,
        riskReason: body.riskReason?.trim() || undefined,
        blacklistReason: body.blacklistReason?.trim() || undefined,
      },
      reason: body.reason.trim(),
    });

    return NextResponse.json({ streamer });
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
