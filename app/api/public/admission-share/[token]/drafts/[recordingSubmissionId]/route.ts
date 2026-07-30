import { NextResponse } from "next/server";

import {
  PublicAdmissionShareError,
  savePublicAdmissionReviewDraft,
  SupabaseAdmissionShareBoardRepository,
  type SaveAdmissionReviewDraftInput,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { readJsonBody } from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

import {
  publicAdmissionReviewDraftDto,
  publicAdmissionShareErrorResponse,
} from "../../../public-route-utils";

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ token: string; recordingSubmissionId: string }>;
  },
) {
  try {
    const { token, recordingSubmissionId } = await params;
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const body = await readJsonBody(request);
    const result = await savePublicAdmissionReviewDraft({
      repo: new SupabaseAdmissionShareBoardRepository(supabase),
      accessStore: new SupabaseAdmissionShareAccessStore(supabase),
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
      recordingSubmissionId,
      input: toDraftInput(body),
    });

    return NextResponse.json(publicAdmissionReviewDraftDto(result));
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

function toDraftInput(
  body: Record<string, unknown>,
): SaveAdmissionReviewDraftInput {
  if (
    typeof body.expectedRevision !== "number" ||
    typeof body.decision !== "string" ||
    typeof body.remark !== "string" ||
    !Array.isArray(body.reasonCodes) ||
    !body.reasonCodes.every(
      (reasonCode): reasonCode is string => typeof reasonCode === "string",
    )
  ) {
    throw new PublicAdmissionShareError(
      "REVIEW_VALIDATION_FAILED",
      "Draft input is invalid",
      400,
    );
  }

  return {
    expectedRevision: body.expectedRevision,
    decision: body.decision as SaveAdmissionReviewDraftInput["decision"],
    remark: body.remark,
    reasonCodes: body.reasonCodes,
  };
}
