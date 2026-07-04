import { NextResponse } from "next/server";

import { SupabaseAccountLibraryRepository } from "@/features/account-library/account-library-repository";
import {
  resolveAccountLibraryRunnerContext,
  sanitizeRunnerError,
} from "@/features/account-library/account-library-runner-utils";
import {
  createHttpMetricsFetcher,
  createPushedMetricsFetcher,
  syncPlatformAccountMetrics,
  type AccountMetricsPayload,
  type PlatformMetricsFetcher,
} from "@/features/account-library/account-metrics-service";
import { writeAuditLog } from "@/lib/audit/audit";

// 定时任务：自动同步平台账号指标（粉丝/场观/流水）。
// 两种数据源：
// 1) 推送模式：请求体带 metrics 数组（外部集成已拉好数据）
// 2) 拉取模式：配置 PLATFORM_METRICS_ENDPOINT 后逐账号请求平台开放接口网关
export async function POST(request: Request) {
  const context = resolveAccountLibraryRunnerContext(request);
  if (context instanceof NextResponse) {
    return context;
  }
  const { supabase, actor } = context;

  const body = (await request.json().catch(() => ({}))) as {
    metrics?: unknown;
  };

  let fetcher: PlatformMetricsFetcher;
  if (Array.isArray(body.metrics)) {
    const metricsByAccount = new Map<string, AccountMetricsPayload>();
    for (const entry of body.metrics) {
      const parsed = parsePushedMetric(entry);
      if (!parsed) {
        return NextResponse.json(
          { error: "metrics entries require accountId and metricDate" },
          { status: 400 },
        );
      }
      metricsByAccount.set(parsed.accountId, parsed.payload);
    }
    fetcher = createPushedMetricsFetcher(metricsByAccount);
  } else {
    const endpoint = process.env.PLATFORM_METRICS_ENDPOINT;
    if (!endpoint) {
      return NextResponse.json(
        {
          error:
            "No metrics source: pass a metrics array or configure PLATFORM_METRICS_ENDPOINT",
        },
        { status: 400 },
      );
    }
    fetcher = createHttpMetricsFetcher({
      endpoint,
      token: process.env.PLATFORM_METRICS_TOKEN,
    });
  }

  try {
    const result = await syncPlatformAccountMetrics({
      repo: new SupabaseAccountLibraryRepository(supabase),
      audit: (input) => writeAuditLog(supabase, input),
      actor,
      fetcher,
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

function parsePushedMetric(entry: unknown): {
  accountId: string;
  payload: AccountMetricsPayload;
} | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const accountId =
    typeof record.accountId === "string" ? record.accountId.trim() : "";
  const metricDate =
    typeof record.metricDate === "string" ? record.metricDate.trim() : "";
  if (!accountId || !metricDate) {
    return null;
  }

  return {
    accountId,
    payload: {
      metricDate,
      followerCount: asNumber(record.followerCount),
      liveViewCount: asNumber(record.liveViewCount),
      gmvAmount: asNumber(record.gmvAmount),
      liveDurationMinutes: asNumber(record.liveDurationMinutes),
    },
  };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
