import { NextResponse } from "next/server";
import { z } from "zod";

import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import {
  authenticatePublicAdmissionShareAccess,
  hashShareSecret,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";
import { setAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

import { publicAdmissionShareErrorResponse } from "../../public-route-utils";

const accessBodySchema = z.object({
  accessCode: z.string().trim().min(1).max(64),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const body = await parseJsonBody(request, accessBodySchema);
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const result = await authenticatePublicAdmissionShareAccess({
      repo: new SupabaseAdmissionShareBoardRepository(supabase),
      accessStore: new SupabaseAdmissionShareAccessStore(supabase),
      token,
      accessCode: body.accessCode,
      clientFingerprint: requestFingerprint(request, token),
    });
    const response = NextResponse.json({
      authenticated: true,
      expiresAt: result.expiresAt,
    });
    setAdmissionShareAccessSession(response, {
      token,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      secure: new URL(request.url).protocol === "https:",
    });
    return response;
  } catch (error) {
    if (error instanceof ValidationError) {
      return publicAdmissionShareErrorResponse(
        new PublicAdmissionShareError(
          "ACCESS_CODE_INVALID",
          "Access code is invalid",
          401,
        ),
      );
    }
    return publicAdmissionShareErrorResponse(error);
  }
}

function requestFingerprint(request: Request, token: string) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const userAgent = request.headers.get("user-agent")?.trim() || "unknown";
  return hashShareSecret(`${token}\n${address}\n${userAgent}`);
}
