import { NextResponse } from "next/server";

import { runAdmissionReviewMetrics } from "@/features/admission-review/metrics-job";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// 校准指标 runner（nightly）：物化审核对齐指标并生成阈值调整提案草稿。
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

  const body = (await request.json().catch(() => ({}))) as {
    windowDays?: unknown;
  };
  const windowDays =
    typeof body.windowDays === "number" && Number.isFinite(body.windowDays)
      ? body.windowDays
      : undefined;

  try {
    const result = await runAdmissionReviewMetrics({
      client: supabase as never,
      actor: {
        userId,
        name: process.env.ADMISSION_RUNNER_USER_NAME || "Admission Runner",
        role: "ops_manager" as const,
        organizationId,
      },
      windowDays,
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
