import { NextResponse } from "next/server";

import { runAdmissionPreReviews } from "@/features/admission-review/pre-review-job";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// AI 预审 runner：外部调度器以 Bearer token 调用（与归一化 runner 同一套
// ADMISSION_RUNNER_* 系统身份）。生成的预审是 L2 草稿，仅供审核员预填。
export async function POST(request: Request) {
  const expected = process.env.ADMISSION_RUNNER_TOKEN;
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

  const organizationId = process.env.ADMISSION_RUNNER_ORGANIZATION_ID;
  const userId = process.env.ADMISSION_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return NextResponse.json(
      { error: "Admission runner organization and user are not configured" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? body.limit
      : undefined;

  try {
    const result = await runAdmissionPreReviews({
      client: supabase as never,
      actor: {
        userId,
        name: process.env.ADMISSION_RUNNER_USER_NAME || "Admission Runner",
        role: "ops_manager" as const,
        organizationId,
      },
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        errorCode: "runner_failed",
        errorMessage: sanitizeRunnerMessage(
          error instanceof Error ? error.message : "Admission runner failed",
        ),
      },
      { status: 500 },
    );
  }
}

function sanitizeRunnerMessage(message: string): string {
  const trimmed = message.trim() || "Admission runner failed";
  return trimmed
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
