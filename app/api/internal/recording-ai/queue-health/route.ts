import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

// 录屏 AI 队列健康端点（阶段0 整改 R9）：供运维/监控轮询队列积压与失败率。
// - Bearer 校验复用 RECORDING_AI_RUNNER_TOKEN（与 recording-ai/run 同一写法）；
// - 全部 head+count / 窄查询实现，不拉业务行；
// - 统计为全库口径（admin client、不分组织）：生产为单组织部署，
//   且跨组织的积压同样是运维要关心的信号。
export const dynamic = "force-dynamic";

type QueueHealthClient = Pick<SupabaseClient, "from">;

const DAY_MS = 24 * 60 * 60 * 1000;

async function countByStatus(
  client: QueueHealthClient,
  status: "queued" | "running",
): Promise<number> {
  const { count, error } = await client
    .from("recording_ai_analyses")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

async function countCompletedSince(
  client: QueueHealthClient,
  status: "succeeded" | "failed",
  sinceIso: string,
): Promise<number> {
  const { count, error } = await client
    .from("recording_ai_analyses")
    .select("id", { count: "exact", head: true })
    .eq("status", status)
    .gte("completed_at", sinceIso);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

async function oldestQueuedCreatedAt(
  client: QueueHealthClient,
): Promise<string | null> {
  const { data, error } = await client
    .from("recording_ai_analyses")
    .select("created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return typeof data?.created_at === "string" ? data.created_at : null;
}

export async function GET(request: Request) {
  const expected = process.env.RECORDING_AI_RUNNER_TOKEN;
  const actual = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || actual !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = createSupabaseAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase admin client is unavailable" },
      { status: 500 },
    );
  }

  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - DAY_MS).toISOString();

  try {
    const [queued, running, failed24h, succeeded24h, oldestCreatedAt] =
      await Promise.all([
        countByStatus(client, "queued"),
        countByStatus(client, "running"),
        countCompletedSince(client, "failed", sinceIso),
        countCompletedSince(client, "succeeded", sinceIso),
        oldestQueuedCreatedAt(client),
      ]);

    // 失败率分母 = 近 24h 完成总数（成功 + 失败）；分母为 0 时 rate = 0。
    const completed24h = failed24h + succeeded24h;
    const failureRate24h = completed24h === 0 ? 0 : failed24h / completed24h;

    const oldestQueuedMs = oldestCreatedAt
      ? nowMs - new Date(oldestCreatedAt).getTime()
      : 0;
    const oldestQueuedMinutes = Math.max(0, Math.floor(oldestQueuedMs / 60000));

    return NextResponse.json({
      queued,
      running,
      failed24h,
      failureRate24h,
      oldestQueuedMinutes,
    });
  } catch {
    // 统计查询失败：监控端点宁可 500 也不报假零（假零会掩盖真实积压）。
    // 不回显错误详情，避免泄漏内部信息。
    return NextResponse.json(
      { error: "Recording AI queue health is unavailable" },
      { status: 500 },
    );
  }
}
