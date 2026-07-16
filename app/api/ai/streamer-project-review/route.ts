import { NextResponse } from "next/server";

import { runAiToolQuery } from "@/features/ai/ai-tool-layer";
import { loadStreamerProjectReviewInput } from "@/features/streamers/streamer-project-review-loader";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run streamer project review" },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      streamerId?: unknown;
      projectId?: unknown;
    };
    const streamerId =
      typeof body.streamerId === "string" ? body.streamerId.trim() : "";
    const projectId =
      typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!streamerId || !projectId) {
      return NextResponse.json(
        { error: "Streamer and project are required" },
        { status: 400 },
      );
    }

    const profileInput = await loadStreamerProjectReviewInput({
      supabase,
      organizationId: auth.organizationId,
      streamerId,
      projectId,
    });
    const result = await runAiToolQuery({
      client: supabase,
      actor: {
        userId: auth.userId,
        name: auth.name,
        role: auth.role,
        organizationId: auth.organizationId,
      },
      toolName: "streamer_project_review",
      input: { profileInput },
    });

    return NextResponse.json({ result, profileInput });
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
