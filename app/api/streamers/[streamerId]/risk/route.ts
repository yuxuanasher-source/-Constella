import { NextResponse } from "next/server";

import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import {
  updateStreamerRisk,
  type StreamerRiskLevel,
} from "@/features/streamers/streamer-service";
import { writeAuditLog } from "@/lib/audit/audit";
import { withAuth } from "@/lib/http/route-handler";

const validRiskLevels = new Set(["low", "medium", "high"]);

export const PATCH = withAuth<{ streamerId: string }>(
  async ({ supabase, auth, request, params }) => {
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
      return NextResponse.json(
        { error: "reason is required" },
        { status: 400 },
      );
    }

    const { streamerId } = params;
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
  },
);
