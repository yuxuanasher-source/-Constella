import { NextResponse } from "next/server";

import {
  PublicAdmissionShareError,
  recordPublicAdmissionPlaybackIssue,
  SupabaseAdmissionShareBoardRepository,
  type AdmissionShareBrowserFamily,
  type AdmissionSharePlaybackErrorCode,
  type AdmissionSharePlaybackSource,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

import { publicAdmissionShareErrorResponse } from "../../../../public-route-utils";

const issueSources = new Set<AdmissionSharePlaybackSource>([
  "original",
  "external",
  "none",
]);
const issueCodes = new Set<AdmissionSharePlaybackErrorCode>([
  "MEDIA_LOAD_FAILED",
  "MEDIA_DECODE_FAILED",
  "EXTERNAL_LINK_FAILED",
  "NO_PLAYABLE_SOURCE",
]);

export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ token: string; recordingSubmissionId: string }> },
) {
  try {
    const { token, recordingSubmissionId } = await params;
    const body = await readPlaybackIssueBody(request);
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const result = await recordPublicAdmissionPlaybackIssue({
      repo: new SupabaseAdmissionShareBoardRepository(supabase),
      accessStore: new SupabaseAdmissionShareAccessStore(supabase),
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
      recordingSubmissionId,
      sourceType: body.sourceType,
      errorCode: body.errorCode,
      userAgentFamily: browserFamilyFromUserAgent(
        request.headers.get("user-agent"),
      ),
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

async function readPlaybackIssueBody(request: Request): Promise<{
  sourceType: AdmissionSharePlaybackSource;
  errorCode: AdmissionSharePlaybackErrorCode;
}> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidPlaybackIssue();
  }

  const values = body as Record<string, unknown>;
  const keys = Object.keys(values);
  const sourceType = values.sourceType;
  const errorCode = values.errorCode;
  if (
    keys.length !== 2 ||
    !keys.includes("sourceType") ||
    !keys.includes("errorCode") ||
    typeof sourceType !== "string" ||
    !issueSources.has(sourceType as AdmissionSharePlaybackSource) ||
    typeof errorCode !== "string" ||
    !issueCodes.has(errorCode as AdmissionSharePlaybackErrorCode)
  ) {
    throw invalidPlaybackIssue();
  }

  return {
    sourceType: sourceType as AdmissionSharePlaybackSource,
    errorCode: errorCode as AdmissionSharePlaybackErrorCode,
  };
}

function browserFamilyFromUserAgent(
  userAgent: string | null,
): AdmissionShareBrowserFamily {
  const value = userAgent ?? "";
  if (/(?:samsungbrowser)\//iu.test(value)) return "Samsung Internet";
  if (/(?:edg|edga|edgios)\//iu.test(value)) return "Edge";
  if (/(?:opr|opera)\//iu.test(value)) return "Opera";
  if (/(?:firefox|fxios)\//iu.test(value)) return "Firefox";
  if (/(?:chrome|crios)\//iu.test(value)) return "Chrome";
  if (/safari\//iu.test(value) && /version\//iu.test(value)) return "Safari";
  return "Unknown";
}

function invalidPlaybackIssue() {
  return new PublicAdmissionShareError(
    "REVIEW_VALIDATION_FAILED",
    "Invalid playback issue",
    400,
  );
}
