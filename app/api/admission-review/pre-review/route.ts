import { NextResponse } from "next/server";

import { getLatestAdmissionPreReview } from "@/features/admission-review/pre-review";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";

// 审核 UI 预填：取指定录屏提交最近一次 AI 预审（L2 草稿）。
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

    return NextResponse.json({ preReview });
  } catch (error) {
    return jsonError(error);
  }
}
