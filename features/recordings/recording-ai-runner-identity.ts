import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiActor } from "@/features/ai/contracts";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// /api/internal/recording-ai/run（cron runner）与入队后的进程内即时执行
// 共用的 runner 身份解析：service-role admin client + env 配置的系统身份。
// 解析失败以 reason 区分，内部路由据此返回不同的 500 错误，
// 即时执行路径则静默跳过（cron 兜底）。

export type RecordingAiRunnerUnavailableReason =
  | "admin_client_unavailable"
  | "runner_not_configured";

export type RecordingAiRunnerIdentity =
  | { ok: true; client: SupabaseClient; actor: AiActor }
  | { ok: false; reason: RecordingAiRunnerUnavailableReason };

export function resolveRecordingAiRunnerIdentity(
  env: Record<string, string | undefined> = process.env,
): RecordingAiRunnerIdentity {
  const client = createSupabaseAdminClient();
  if (!client) {
    return { ok: false, reason: "admin_client_unavailable" };
  }

  const organizationId = env.RECORDING_AI_RUNNER_ORGANIZATION_ID;
  const userId = env.RECORDING_AI_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return { ok: false, reason: "runner_not_configured" };
  }

  return {
    ok: true,
    client,
    actor: {
      userId,
      name: env.RECORDING_AI_RUNNER_USER_NAME || "Recording AI Runner",
      role: "ops_manager",
      organizationId,
    },
  };
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
