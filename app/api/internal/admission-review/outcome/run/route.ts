import { NextResponse } from "next/server";

import { runPostJoinOutcomes } from "@/features/admission-review/outcome-job";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// 上播后结果回流 runner：入项满观察窗口的申请回看直播表现，写
// post_join_outcome 信号（准入判断的事后 ground truth）。
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
  if (!isUuid(organizationId)) {
    return NextResponse.json(
      { error: "Admission runner organization is not configured" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    windowDays?: unknown;
    limit?: unknown;
  };

  try {
    const result = await runPostJoinOutcomes({
      client: supabase as never,
      actor: { organizationId },
      windowDays:
        typeof body.windowDays === "number" && Number.isFinite(body.windowDays)
          ? body.windowDays
          : undefined,
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : undefined,
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
