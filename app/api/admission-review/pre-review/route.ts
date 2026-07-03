import { NextResponse } from "next/server";

import { evaluateFastLaneEligibility } from "@/features/admission-review/fast-lane";
import { METRIC_AI_FALSE_PASS } from "@/features/admission-review/metrics";
import {
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import { getLatestAdmissionPreReview } from "@/features/admission-review/pre-review";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";

// 审核 UI 预填：取指定录屏提交最近一次 AI 预审（L2 草稿），并附带
// 快速通道资格评估（仅排序/抽检标记，通过与否仍由人工逐件决定）。
// RLS 保证只有本组织 MCN 员工能读到评估行。
export async function GET(request: Request) {
  try {
    const submissionId = new URL(request.url).searchParams
      .get("submissionId")
      ?.trim();
    if (!submissionId) {
      throw new RouteError("submissionId is required", 400);
    }

    const context = await getAdmissionRouteContext();
    const preReview = await getLatestAdmissionPreReview({
      client: context.supabase as never,
      submissionId,
    });

    if (!preReview) {
      return NextResponse.json({ preReview: null, fastLane: null });
    }

    const rubric = await resolveAdmissionRubric({
      client: context.supabase as unknown as AdmissionReviewClient,
      organizationId: context.auth.organizationId,
    });

    // 最近校准窗口的逐卡点漏放指标；查询失败按无指标处理（不合格）。
    const { data: metricRows } = await context.supabase
      .from("admission_review_metrics")
      .select("metric_key, checkpoint_key, numerator, denominator")
      .eq("organization_id", context.auth.organizationId)
      .eq("metric_key", METRIC_AI_FALSE_PASS)
      .order("period_end", { ascending: false })
      .limit(50);

    const fastLane = evaluateFastLaneEligibility({
      preReview,
      rubric,
      metrics: (metricRows ?? []).map((row) => ({
        metricKey: row.metric_key,
        checkpointKey: row.checkpoint_key || null,
        numerator: row.numerator,
        denominator: row.denominator,
      })),
    });

    return NextResponse.json({ preReview, fastLane });
  } catch (error) {
    return jsonError(error);
  }
}
