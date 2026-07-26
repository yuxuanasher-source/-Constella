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
  preparePublicAdmissionShareAccess,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { admissionShareCapabilityFromRequest } from "@/lib/http/admission-share-capability";
import {
  ADMISSION_SHARE_RATE_LIMITS,
  enforceAdmissionShareIpRateLimit,
  enforceAdmissionShareTokenRateLimit,
  RateLimitDeniedError,
  RateLimitUnavailableError,
} from "@/lib/http/rate-limit";

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
    const rateLimitInput = {
      client: supabase,
      request,
      token,
      policy: ADMISSION_SHARE_RATE_LIMITS.board,
    };
    await enforceAdmissionShareIpRateLimit(rateLimitInput);

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const preparedAccess = await preparePublicAdmissionShareAccess({
      repo,
      token,
      now: new Date().toISOString(),
    });
    await enforceAdmissionShareTokenRateLimit(rateLimitInput);
    const { organizationId, ...shareBoard } =
      await getPublicAdmissionShareBoard({
        repo,
        token,
        capability: admissionShareCapabilityFromRequest(request),
        preparedAccess,
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

    return NextResponse.json({ shareBoard, vendorCheckpoints });
  } catch (error) {
    if (error instanceof RateLimitDeniedError) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof RateLimitUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return jsonError(error);
  }
}
