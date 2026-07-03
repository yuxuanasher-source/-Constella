import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

import type { AccountLibraryActor } from "./account-library-service";

export type AccountLibraryRunnerContext = {
  supabase: SupabaseClient;
  actor: AccountLibraryActor;
};

// 账号库定时任务（闲置扫描 / 指标同步）共用的 Bearer token 鉴权与系统身份解析，
// 约定同 /api/internal/anomalies/run。
export function resolveAccountLibraryRunnerContext(
  request: Request,
): AccountLibraryRunnerContext | NextResponse {
  const expected = process.env.ACCOUNT_LIBRARY_RUNNER_TOKEN;
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

  const organizationId = process.env.ACCOUNT_LIBRARY_RUNNER_ORGANIZATION_ID;
  const userId = process.env.ACCOUNT_LIBRARY_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return NextResponse.json(
      {
        error: "Account library runner organization and user are not configured",
      },
      { status: 500 },
    );
  }

  return {
    supabase,
    actor: {
      userId,
      name:
        process.env.ACCOUNT_LIBRARY_RUNNER_USER_NAME || "Account Library Runner",
      role: "ops_manager",
      organizationId,
    },
  };
}

export function sanitizeRunnerError(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Account library runner failed";
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
