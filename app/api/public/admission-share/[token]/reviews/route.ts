import { NextResponse } from "next/server";

import {
  submitVendorAdmissionReviews,
  SupabaseAdmissionShareBoardRepository,
  type SubmitVendorAdmissionReviewsInput,
} from "@/features/applications/admission-share-board";
import type { VendorAdmissionDecision } from "@/features/applications/admission-board";
import {
  jsonError,
  optionalString,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

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
      throw new RouteError("Public share service is unavailable", 500);
    }

    const body = await readJsonBody(request);
    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const result = await submitVendorAdmissionReviews({
      repo,
      token,
      accessCode: optionalSearchParam(request, "accessCode"),
      input: toVendorReviewInput(body),
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

function toVendorReviewInput(
  body: Record<string, unknown>,
): SubmitVendorAdmissionReviewsInput {
  return {
    reviewerName: optionalString(body, "reviewerName"),
    reviewerContact: optionalString(body, "reviewerContact"),
    projectRemark: optionalString(body, "projectRemark"),
    items: Array.isArray(body.items) ? body.items.map(toReviewItem) : [],
  };
}

function toReviewItem(value: unknown) {
  const item = isRecord(value) ? value : {};
  return {
    recordingSubmissionId: optionalString(item, "recordingSubmissionId") ?? "",
    recordingVersion: numberValue(item.recordingVersion),
    decision: (optionalString(item, "decision") ??
      "pending") as VendorAdmissionDecision,
    remark: optionalString(item, "remark"),
  };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalSearchParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  return value?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
