import { NextResponse } from "next/server";

import { requestRecordingAiAnalysis } from "@/features/recordings/recording-ai-analysis";
import { kickRecordingAiAnalysisInProcess } from "@/features/recordings/recording-ai-instant-run";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { scheduleInstantKick } from "@/lib/http/schedule-instant-kick";
import { isMcnStaff } from "@/lib/rbac/roles";

type RouteContext = {
  params: Promise<{ assetId: string }>;
};

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

    return NextResponse.json({ analysis }, { status: 202 });
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
