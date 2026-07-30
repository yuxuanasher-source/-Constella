import { NextResponse } from "next/server";

import {
  checkpointsForStage,
  defaultAdmissionRubric,
} from "@/features/admission-review/contracts";
import {
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import {
  getPublicAdmissionShareBoard,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    // Public visitors are unauthenticated, so RLS (staff-only policies) would
    // hide the share board. Access is instead gated by the secret share token,
    // so we read through the service-role client which stays server-side only.
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new RouteError("Public share service is unavailable", 500);
    }

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const { organizationId, ...shareBoard } =
      await getPublicAdmissionShareBoard({
        repo,
        token,
        accessCode: optionalSearchParam(request, "accessCode"),
      });

    // 厂家端可选理由标签（仅 key/名称/说明，不泄漏内部配置）。
    // 解析失败不影响看板本身，退回内置默认字典。
    const rubric = await resolveAdmissionRubric({
      client: supabase as unknown as AdmissionReviewClient,
      organizationId: organizationId ?? "",
    }).catch(() => defaultAdmissionRubric());
    const vendorCheckpoints = checkpointsForStage(rubric, "vendor_second").map(
      (checkpoint) => ({
        key: checkpoint.key,
        label: checkpoint.label,
        description: checkpoint.description,
      }),
    );

    return NextResponse.json({
      shareBoard: toPublicResponse(shareBoard),
      vendorCheckpoints,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function optionalSearchParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  return value?.trim() || undefined;
}

function toPublicResponse(
  shareBoard: Awaited<ReturnType<typeof getPublicAdmissionShareBoard>>,
) {
  return {
    ...shareBoard,
    items: shareBoard.items.map((item) => ({
      ...item,
      vendorReview: item.vendorReview
        ? {
            decision: item.vendorReview.decision,
            remark: item.vendorReview.remark,
            submittedAt: item.vendorReview.submittedAt,
          }
        : null,
    })),
  };
}
