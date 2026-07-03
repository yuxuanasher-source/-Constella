import { NextResponse } from "next/server";

import { checkpointsForStage } from "@/features/admission-review/contracts";
import {
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import {
  getAdmissionRouteContext,
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";

// 审核卡点字典查询：一审/二审 UI 渲染结构化审核单用。
export async function GET(request: Request) {
  try {
    const context = await getAdmissionRouteContext();
    const rubric = await resolveAdmissionRubric({
      client: context.supabase as unknown as AdmissionReviewClient,
      organizationId: context.auth.organizationId,
    });

    const stage = new URL(request.url).searchParams.get("stage");
    if (stage && stage !== "mcn_first" && stage !== "vendor_second") {
      throw new RouteError("stage must be mcn_first or vendor_second", 400);
    }

    return NextResponse.json({
      rubricVersion: rubric.rubricVersion,
      source: rubric.source,
      checkpoints: stage
        ? checkpointsForStage(rubric, stage as StageFilter)
        : rubric.checkpoints,
    });
  } catch (error) {
    return jsonError(error);
  }
}

type StageFilter = Parameters<typeof checkpointsForStage>[1];
