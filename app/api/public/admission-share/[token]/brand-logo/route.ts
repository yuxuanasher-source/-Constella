import { NextResponse } from "next/server";

import {
  getPublicAdmissionShareBrandLogoPath,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";
import { normalizeAbsoluteHttpUrl } from "@/lib/http/safe-public-url";

import { publicAdmissionShareErrorResponse } from "../../public-route-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
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
    const storagePath = await getPublicAdmissionShareBrandLogoPath({
      repo,
      accessStore,
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
    });
    if (!storagePath) {
      throw brandLogoUnavailable();
    }

    let signedUrl: string | null = null;
    try {
      const signed = await createSignedDownloadUrl({
        client: supabase,
        bucket: getPrivateStorageBucket(),
        path: storagePath,
        expiresInSeconds: 3600,
      });
      signedUrl = normalizeAbsoluteHttpUrl(signed.signedUrl);
    } catch {
      throw brandLogoUnavailable();
    }

    if (!signedUrl) {
      throw brandLogoUnavailable();
    }
    return NextResponse.redirect(signedUrl, 302);
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

function brandLogoUnavailable() {
  return new PublicAdmissionShareError(
    "RECORDING_SOURCE_UNAVAILABLE",
    "Brand logo source is unavailable",
    404,
  );
}
