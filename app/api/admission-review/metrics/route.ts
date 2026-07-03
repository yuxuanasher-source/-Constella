import { NextResponse } from "next/server";

import {
  getAdmissionRouteContext,
  jsonError,
} from "@/features/applications/application-route-utils";

// 审核校准看板：读取最近一次物化的对齐指标（RLS 限 MCN 员工）。
export async function GET(request: Request) {
  try {
    const context = await getAdmissionRouteContext();
    const url = new URL(request.url);
    const limit = Math.max(
      1,
      Math.min(Number(url.searchParams.get("limit")) || 200, 500),
    );

    const { data, error } = await context.supabase
      .from("admission_review_metrics")
      .select(
        "period_start, period_end, metric_key, checkpoint_key, numerator, denominator, computed_at",
      )
      .eq("organization_id", context.auth.organizationId)
      .order("period_end", { ascending: false })
      .order("metric_key", { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    const metrics = (data ?? []).map((row) => ({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      metricKey: row.metric_key,
      checkpointKey: row.checkpoint_key || null,
      numerator: row.numerator,
      denominator: row.denominator,
      rate: row.denominator > 0 ? row.numerator / row.denominator : null,
      computedAt: row.computed_at,
    }));

    return NextResponse.json({ metrics });
  } catch (error) {
    return jsonError(error);
  }
}
