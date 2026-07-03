import { NextResponse } from "next/server";

import { learnRecordingIntelligenceCalibration } from "@/features/recordings/recording-intelligence-learning";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

/**
 * 录屏智能分析自学习 runner：定时全量读取组织履约数据（上传、上播测试、
 * 排班开播），产出新版本校准（漏斗卡点 + 评分权重 + 话术基线）。复用
 * recording AI runner 的 token 与组织配置。
 */
export async function POST(request: Request) {
  const expected = process.env.RECORDING_AI_RUNNER_TOKEN;
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

  const organizationId = process.env.RECORDING_AI_RUNNER_ORGANIZATION_ID;
  const userId = process.env.RECORDING_AI_RUNNER_USER_ID;
  if (!isUuid(organizationId) || !isUuid(userId)) {
    return NextResponse.json(
      { error: "Recording AI runner organization and user are not configured" },
      { status: 500 },
    );
  }

  try {
    const calibration = await learnRecordingIntelligenceCalibration({
      client: supabase as never,
      actor: {
        userId,
        name:
          process.env.RECORDING_AI_RUNNER_USER_NAME || "Recording AI Runner",
        role: "ops_manager" as const,
        organizationId,
      },
    });

    return NextResponse.json({
      calibration: {
        version: calibration.version,
        uploadRateBps: calibration.uploadRateBps,
        goLiveRateBps: calibration.goLiveRateBps,
        liveTestPassRateBps: calibration.liveTestPassRateBps,
        bottlenecks: calibration.bottlenecks,
        scriptBenchmarkSource: calibration.scriptBenchmark.source,
      },
    });
  } catch {
    return NextResponse.json(
      {
        errorCode: "learn_failed",
        errorMessage: "Recording intelligence calibration failed",
      },
      { status: 500 },
    );
  }
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
