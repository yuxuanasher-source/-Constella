import type { SupabaseClient } from "@supabase/supabase-js";

import type { AiActor } from "@/features/ai/contracts";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// /api/internal/ocr/run（cron runner）与报数入队后的进程内即时执行共用的
// runner 身份解析：service-role admin client + env 配置的系统身份。
// 解析失败以 reason 区分，内部路由据此返回不同的 500 错误，
// 即时执行路径则静默跳过（cron 兜底）。

export type OcrRunnerUnavailableReason =
  | "admin_client_unavailable"
  | "runner_not_configured";

export type OcrRunnerIdentity =
  | { ok: true; client: SupabaseClient; actor: AiActor }
  | { ok: false; reason: OcrRunnerUnavailableReason };

export function resolveOcrRunnerIdentity(
  env: Record<string, string | undefined> = process.env,
): OcrRunnerIdentity {
  const client = createSupabaseAdminClient();
  if (!client) {
    return { ok: false, reason: "admin_client_unavailable" };
  }

  const organizationId = env.OCR_RUNNER_ORGANIZATION_ID;
  const userId = env.OCR_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return { ok: false, reason: "runner_not_configured" };
  }

  return {
    ok: true,
    client,
    actor: {
      userId,
      name: env.OCR_RUNNER_USER_NAME || "OCR Runner",
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
