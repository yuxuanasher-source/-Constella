import { NextResponse } from "next/server";

import {
  preparePublicAdmissionShareAccess,
  SupabaseAdmissionShareBoardRepository,
  verifyPublicAdmissionShareAccessCode,
} from "@/features/applications/admission-share-board";
import {
  jsonError,
  readJsonBody,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  ADMISSION_SHARE_CAPABILITY_COOKIE,
  AdmissionShareCapabilityUnavailableError,
  requireAdmissionShareCapabilitySecret,
  signAdmissionShareCapability,
} from "@/lib/http/admission-share-capability";
import {
  ADMISSION_SHARE_RATE_LIMITS,
  enforceAdmissionShareIpRateLimit,
  RateLimitDeniedError,
  RateLimitUnavailableError,
} from "@/lib/http/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const capabilitySecret = requireAdmissionShareCapabilitySecret();
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new RouteError("Public share service is unavailable", 500);
    }
    const rateLimitInput = {
      client: supabase,
      request,
      token,
      policy: ADMISSION_SHARE_RATE_LIMITS.unlock,
    };
    await enforceAdmissionShareIpRateLimit(rateLimitInput);

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const now = new Date().toISOString();
    const preparedAccess = await preparePublicAdmissionShareAccess({
      repo,
      token,
      now,
    });

    const body = await readJsonBody(request);
    const accessCode =
      typeof body.accessCode === "string" ? body.accessCode.trim() : "";
    await verifyPublicAdmissionShareAccessCode({
      repo,
      access: preparedAccess.access,
      accessCode,
      now,
    });

    const response = NextResponse.json({ unlocked: true });
    if (preparedAccess.access.accessCodeHash) {
      const capability = signAdmissionShareCapability({
        boardId: preparedAccess.access.id,
        tokenHash: preparedAccess.tokenHash,
        accessCodeHash: preparedAccess.access.accessCodeHash,
        boardExpiresAt: preparedAccess.access.expiresAt,
        now,
        secret: capabilitySecret,
      });
      response.cookies.set(
        ADMISSION_SHARE_CAPABILITY_COOKIE,
        capability.value,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: `/api/public/admission-share/${encodeURIComponent(token)}`,
          expires: new Date(capability.expiresAt),
        },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof AdmissionShareCapabilityUnavailableError) {
      return NextResponse.json(
        { error: "Public share unlock service is unavailable" },
        { status: 503 },
      );
    }
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
    if (error instanceof RouteError) {
      return jsonError(error);
    }
    return NextResponse.json(
      { error: "Unable to unlock share" },
      { status: 400 },
    );
  }
}
