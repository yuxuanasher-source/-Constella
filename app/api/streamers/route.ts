import { NextResponse } from "next/server";

import { listStreamerPool } from "@/features/streamers/streamer-queries";
import { SupabaseStreamerRepository } from "@/features/streamers/streamer-repository";
import { createStreamerProfile } from "@/features/streamers/streamer-service";
import { toStreamerCardDtos } from "@/features/streamers/streamer-ui-dto";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const streamers = await listStreamerPool(supabase);
    return NextResponse.json({ streamers: toStreamerCardDtos(streamers) });
  } catch (error) {
    return jsonServiceError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await getAuthContext(supabase) : null;
    if (!supabase || !auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      displayName?: string;
      userId?: string;
    };
    const displayName = body.displayName?.trim();
    if (!displayName) {
      return NextResponse.json(
        { error: "displayName is required" },
        { status: 400 },
      );
    }

    const streamer = await createStreamerProfile({
      repo: new SupabaseStreamerRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor: auth,
      input: {
        displayName,
        userId: body.userId?.trim() || undefined,
      },
    });

    return NextResponse.json({ streamer }, { status: 201 });
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
