import { NextResponse } from "next/server";
import { z } from "zod";

import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import {
  authenticatePublicAdmissionShareAccess,
  hashShareSecret,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { ValidationError, parseJsonBody } from "@/lib/http/parse-json-body";
import { setAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

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
      return NextResponse.json(
        {
          code: "SHARE_SERVICE_UNAVAILABLE",
          error: "Share service unavailable",
        },
        { status: 503 },
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
      return NextResponse.json(
        { code: "ACCESS_CODE_INVALID", error: "Access code is invalid" },
        { status: 400 },
      );
    }
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      "code" in error
    ) {
      const retryAfterSeconds =
        "retryAfterSeconds" in error &&
        typeof error.retryAfterSeconds === "number"
          ? error.retryAfterSeconds
          : undefined;
      const response = NextResponse.json(
        {
          code: String(error.code),
          error: error instanceof Error ? error.message : "Share access failed",
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
        },
        { status: Number(error.statusCode) || 400 },
      );
      if (retryAfterSeconds) {
        response.headers.set("Retry-After", String(retryAfterSeconds));
      }
      return response;
    }
    return NextResponse.json(
      { code: "SHARE_SERVICE_UNAVAILABLE", error: "Share service unavailable" },
      { status: 503 },
    );
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
