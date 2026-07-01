import { NextResponse } from "next/server";

import { runRecordingAiAnalysisOnce } from "@/features/recordings/recording-ai-analysis";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function POST(request: Request) {
  const expected = process.env.RECORDING_AI_RUNNER_TOKEN;
  const actual = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || actual !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase admin client is unavailable" },
      { status: 500 },
    );
  }

  const organizationId = process.env.RECORDING_AI_RUNNER_ORGANIZATION_ID;
  const userId = process.env.RECORDING_AI_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return NextResponse.json(
      { error: "Recording AI runner organization and user are not configured" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    analysisId?: unknown;
  };
  const analysisId =
    typeof body.analysisId === "string" ? body.analysisId.trim() : "";
  if (!analysisId) {
    return NextResponse.json(
      { error: "Recording analysis id is required" },
      { status: 400 },
    );
  }

  try {
    const analysis = await runRecordingAiAnalysisOnce({
      client: supabase as never,
      actor: {
        userId,
        name:
          process.env.RECORDING_AI_RUNNER_USER_NAME || "Recording AI Runner",
        role: "ops_manager",
        organizationId,
      },
      analysisId,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      {
        errorCode: "runner_failed",
        errorMessage: sanitizeRunnerError(error),
      },
      { status: 500 },
    );
  }
}

function sanitizeRunnerError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Recording AI runner failed";
  return message
    .replace(/[A-Za-z0-9_.-]+\/[^\s;]+/g, "[redacted]")
    .replace(/secret=([^\s;]+)/gi, "secret=[redacted]")
    .replace(/\n[\s\S]*/g, "")
    .slice(0, 200);
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
