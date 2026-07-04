import { NextResponse } from "next/server";

import { markIdlePlatformAccounts } from "@/features/account-library/account-lifecycle-service";
import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  resolveAccountLibraryRunnerContext,
  sanitizeRunnerError,
} from "@/features/account-library/account-library-runner-utils";
import { writeAuditLog } from "@/lib/audit/audit";
import { sendNotification } from "@/lib/notify/notify";

// 定时任务：自动标记闲置账号（外部调度器以 Bearer token 调用）
export async function POST(request: Request) {
  const context = resolveAccountLibraryRunnerContext(request);
  if (context instanceof NextResponse) {
    return context;
  }
  const { supabase, actor } = context;

  const body = (await request.json().catch(() => ({}))) as {
    idleAfterDays?: unknown;
  };
  const idleAfterDays =
    typeof body.idleAfterDays === "number" &&
    Number.isFinite(body.idleAfterDays) &&
    body.idleAfterDays > 0
      ? Math.floor(body.idleAfterDays)
      : undefined;

  try {
    const result = await markIdlePlatformAccounts({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      notify: (input) => sendNotification(supabase, input),
      actor,
      idleAfterDays,
    });

    return NextResponse.json({ result });
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
