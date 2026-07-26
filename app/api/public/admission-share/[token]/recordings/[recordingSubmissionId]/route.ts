import { NextResponse } from "next/server";

import {
  getPublicAdmissionRecordingPlaybackSource,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import {
  ADMISSION_SHARE_RATE_LIMITS,
  enforceAdmissionShareRateLimit,
  RateLimitDeniedError,
  RateLimitUnavailableError,
} from "@/lib/http/rate-limit";

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ token: string; recordingSubmissionId: string }> },
) {
  try {
    const { token, recordingSubmissionId } = await params;
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new RouteError("Public share service is unavailable", 500);
    }
    await enforceAdmissionShareRateLimit({
      client: supabase,
      request,
      token,
      policy: ADMISSION_SHARE_RATE_LIMITS.recording,
    });

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const source = await getPublicAdmissionRecordingPlaybackSource({
      repo,
      token,
      accessCode: optionalSearchParam(request, "accessCode"),
      recordingSubmissionId,
    });

    if (source.storagePath) {
      const signed = await createSignedDownloadUrl({
        client: supabase,
        bucket: getPrivateStorageBucket(),
        path: source.storagePath,
        expiresInSeconds: 3600,
      });
      return NextResponse.redirect(signed.signedUrl, 302);
    }

    if (source.recordingUrl) {
      return NextResponse.redirect(source.recordingUrl, 302);
    }

    throw new RouteError("Recording playback source is unavailable", 404);
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

function optionalSearchParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  return value?.trim() || undefined;
}
