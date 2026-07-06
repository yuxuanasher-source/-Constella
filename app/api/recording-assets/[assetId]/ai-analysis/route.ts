import { NextResponse } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requestRecordingAiAnalysis } from "@/features/recordings/recording-ai-analysis";
import { kickRecordingAiAnalysisInProcess } from "@/features/recordings/recording-ai-instant-run";
import { getAuthContext } from "@/lib/auth/context";
import {
  getPrivateStorageBucket,
  getRecordingAiMonthlyQuota,
  getRecordingMaxFileBytes,
} from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { scheduleInstantKick } from "@/lib/http/schedule-instant-kick";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

type SizeGateClient = Pick<SupabaseClient, "from" | "storage">;

// 入队前的尺寸闸门（阶段0 整改 R7）：对主 storage_object source 查存储对象
// 元信息，超过 RECORDING_MAX_FILE_BYTES 直接 400，不浪费一次注定超限的解析。
// 查询失败（无 storage source、对象缺失、storage 不可用等）一律不拦截，
// 走既有流程——解析侧的 ffprobe 时长/大小闸门会兜底。
async function isRecordingSourceOversized({
  client,
  assetId,
  organizationId,
}: {
  client: SizeGateClient;
  assetId: string;
  organizationId: string;
}): Promise<boolean> {
  try {
    const { data: source, error } = await client
      .from("recording_asset_sources")
      .select("storage_path")
      .eq("organization_id", organizationId)
      .eq("asset_id", assetId)
      .eq("source_kind", "storage_object")
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return false;
    }
    const storagePath =
      typeof source?.storage_path === "string"
        ? source.storage_path.trim()
        : "";
    if (!storagePath) {
      return false;
    }

    const { data: info, error: infoError } = await client.storage
      .from(getPrivateStorageBucket())
      .info(storagePath);
    if (infoError) {
      return false;
    }
    const size = info?.size;
    return (
      typeof size === "number" &&
      Number.isFinite(size) &&
      size > getRecordingMaxFileBytes()
    );
  } catch {
    return false;
  }
}

// 「本月」口径与 role-home-loader 的仪表盘口径一致：Asia/Shanghai 的自然月。
// Asia/Shanghai 固定 UTC+8、无夏令时，直接做偏移运算即可得到
// 「本月一日 00:00（上海时间）」对应的 UTC 时刻，作为 created_at 的下界。
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function currentMonthStartIso(now: Date): string {
  const shanghai = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), 1) -
      SHANGHAI_UTC_OFFSET_MS,
  ).toISOString();
}

type QuotaGateResult =
  | { state: "ok" | "exceeded"; used: number; limit: number }
  | { state: "unknown" };

// 入队前的月度配额闸门（阶段0 整改 R8，已拍板：超限=硬拒 429）：
// 统计本组织本月（Asia/Shanghai 自然月）已创建的解析条数，打满即 429。
// 计数查询失败（DB 抖动、mock client 无 from 等）→ unknown，不拦截照常入队，
// 与 R7 尺寸闸门同一取舍：元信息类检查失败不误伤正常流程。
async function checkRecordingAiMonthlyQuota({
  client,
  organizationId,
}: {
  client: Pick<SupabaseClient, "from">;
  organizationId: string;
}): Promise<QuotaGateResult> {
  const limit = getRecordingAiMonthlyQuota();
  try {
    const { count, error } = await client
      .from("recording_ai_analyses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", currentMonthStartIso(new Date()));
    if (error || typeof count !== "number") {
      return { state: "unknown" };
    }
    return count >= limit
      ? { state: "exceeded", used: count, limit }
      : { state: "ok", used: count, limit };
  } catch {
    return { state: "unknown" };
  }
}

export async function POST(_request: Request, context: RouteContext) {
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
        { error: "Only MCN staff can start recording AI analysis" },
        { status: 403 },
      );
    }

    const { assetId } = await context.params;

    if (
      await isRecordingSourceOversized({
        client: supabase,
        assetId,
        organizationId: auth.organizationId,
      })
    ) {
      return NextResponse.json(
        { error: "录屏文件超过解析大小上限" },
        { status: 400 },
      );
    }

    const quota = await checkRecordingAiMonthlyQuota({
      client: supabase,
      organizationId: auth.organizationId,
    });
    if (quota.state === "exceeded") {
      return NextResponse.json(
        {
          error: `本月解析额度已用完（${quota.limit} 条/月），下月自动恢复`,
          quota: { used: quota.used, limit: quota.limit },
        },
        { status: 429 },
      );
    }

    const analysis = await requestRecordingAiAnalysis({
      client: supabase,
      actor: auth,
      assetId,
    });

    // 入队成功后立即在本进程内执行该条分析，消除等 cron 的调度延迟。
    // kick 自带并发闸门与全链路降级（闸门满/env 未配置/admin client 不可用
    // → 跳过留给 cron，认领竞态 → 吞掉，异常 → 只记日志），
    // scheduleInstantKick 再兜一层，保证任何 kick 异常都不影响 202 入队响应。
    scheduleInstantKick("recording-ai", () =>
      kickRecordingAiAnalysisInProcess({ analysisId: analysis.id }),
    );

    // 202 附带配额用量（used 含本次刚入队的一条），供前端展示剩余额度；
    // 计数不可用（unknown）时省略 quota 字段，不给前端假数字。
    return NextResponse.json(
      quota.state === "ok"
        ? {
            analysis,
            quota: { used: quota.used + 1, limit: quota.limit },
          }
        : { analysis },
      { status: 202 },
    );
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
