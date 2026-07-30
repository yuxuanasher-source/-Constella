import { NextResponse } from "next/server";

import {
  checkpointsForStage,
  type AdmissionRubric,
} from "@/features/admission-review/contracts";
import {
  recordAdmissionEvaluation,
  resolveAdmissionRubric,
  type AdmissionReviewClient,
} from "@/features/admission-review/evaluation-service";
import { recordMcnVsVendorSignal } from "@/features/admission-review/signals";
import {
  PublicAdmissionShareError,
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
  type SubmitVendorAdmissionReviewsInput,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import {
  optionalString,
  readJsonBody,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

import { publicAdmissionShareErrorResponse } from "../../public-route-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    // Vendors submit through the public link without an authenticated session,
    // so RLS would block them. The secret share token authorizes the request,
    // and the service-role client stays server-side only.
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const body = await readJsonBody(request);
    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const accessStore = new SupabaseAdmissionShareAccessStore(supabase);
    const reviewClient = supabase as unknown as AdmissionReviewClient;
    const rubricCache = new Map<string, AdmissionRubric>();

    const result = await submitVendorAdmissionReviews({
      repo,
      accessStore,
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
      input: toVendorReviewInput(body),
      // 厂家勾选理由标签时直接落人工评估；非法标签宽容过滤（外部输入）。
      recordEvaluation: async (evaluation) => {
        let rubric = rubricCache.get(evaluation.organizationId);
        if (!rubric) {
          rubric = await resolveAdmissionRubric({
            client: reviewClient,
            organizationId: evaluation.organizationId,
          });
          rubricCache.set(evaluation.organizationId, rubric);
        }
        const allowed = new Set(
          checkpointsForStage(rubric, "vendor_second").map(
            (checkpoint) => checkpoint.key,
          ),
        );
        const reasonCodes = evaluation.reasonCodes.filter((code) =>
          allowed.has(code),
        );
        if (!reasonCodes.length) {
          return;
        }
        await recordAdmissionEvaluation({
          client: reviewClient,
          rubric,
          input: {
            organizationId: evaluation.organizationId,
            applicationId: evaluation.applicationId,
            submissionId: evaluation.recordingSubmissionId,
            stage: "vendor_second",
            decision: evaluation.decision,
            vendorReviewId: evaluation.vendorReviewId,
            note: evaluation.remark,
            noteSource: "human",
            reasonCodes,
          },
        });
        // 一审 vs 二审对齐信号（一审漏判监测）；失败不阻塞厂家提交。
        await recordMcnVsVendorSignal({
          client: reviewClient as never,
          organizationId: evaluation.organizationId,
          submissionId: evaluation.recordingSubmissionId,
        }).catch(() => null);
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

function toVendorReviewInput(
  body: Record<string, unknown>,
): SubmitVendorAdmissionReviewsInput {
  return {
    projectRemark: optionalString(body, "projectRemark"),
  };
}
