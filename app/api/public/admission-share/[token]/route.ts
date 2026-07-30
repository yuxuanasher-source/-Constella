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
  ensurePublicAdmissionShareSession,
  getPublicAdmissionShareBoard,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  readAdmissionShareAccessSession,
  setAdmissionShareAccessSession,
} from "@/lib/http/admission-share-access-session";

import { publicAdmissionShareErrorResponse } from "../public-route-utils";

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
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const accessStore = new SupabaseAdmissionShareAccessStore(supabase);
    const requestSession =
      readAdmissionShareAccessSession(request, token) ?? undefined;
    const preparedSession = await ensurePublicAdmissionShareSession({
      repo,
      accessStore,
      token,
      sessionToken: requestSession,
    });
    const { organizationId, ...shareBoard } =
      await getPublicAdmissionShareBoard({
        repo,
        accessStore,
        token,
        sessionToken: preparedSession?.sessionToken ?? requestSession,
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

    const response = NextResponse.json({
      shareBoard: toPublicResponse(shareBoard),
      vendorCheckpoints,
    });
    if (preparedSession?.created) {
      setAdmissionShareAccessSession(response, {
        token,
        sessionToken: preparedSession.sessionToken,
        expiresAt: preparedSession.expiresAt,
      });
    }
    return response;
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

function toPublicResponse(
  shareBoard: Omit<
    Awaited<ReturnType<typeof getPublicAdmissionShareBoard>>,
    "organizationId"
  >,
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
