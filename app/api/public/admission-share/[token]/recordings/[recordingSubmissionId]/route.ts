import { NextResponse } from "next/server";

import {
  getPublicAdmissionRecordingPlaybackSource,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";
import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";

import { publicAdmissionShareErrorResponse } from "../../../public-route-utils";

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
      throw new PublicAdmissionShareError(
        "SHARE_SERVICE_UNAVAILABLE",
        "Public share service is unavailable",
        503,
      );
    }

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const accessStore = new SupabaseAdmissionShareAccessStore(supabase);
    const source = await getPublicAdmissionRecordingPlaybackSource({
      repo,
      accessStore,
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
      recordingSubmissionId,
    });

    if (source.storagePath) {
      const signed = await createSignedDownloadUrl({
        client: supabase,
        bucket: getPrivateStorageBucket(),
        path: source.storagePath,
        expiresInSeconds: 3600,
      });
      const signedUrl = normalizeAbsoluteHttpUrl(signed.signedUrl);
      if (signedUrl) {
        return NextResponse.redirect(signedUrl, 302);
      }
    }

    const recordingUrl = normalizeAbsoluteHttpUrl(source.recordingUrl);
    if (recordingUrl) {
      return NextResponse.redirect(recordingUrl, 302);
    }

    throw new PublicAdmissionShareError(
      "RECORDING_SOURCE_UNAVAILABLE",
      "Recording playback source is unavailable",
      404,
    );
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}
