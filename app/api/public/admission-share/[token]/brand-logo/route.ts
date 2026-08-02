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

const BRAND_LOGO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

    if (new URL(request.url).searchParams.get("asset") !== "1") {
      const assetUrl = new URL(request.url);
      assetUrl.hash = "";
      assetUrl.search = "";
      assetUrl.searchParams.set("asset", "1");
      return NextResponse.redirect(assetUrl, 302);
    }

    let upstream: Response;
    try {
      const signed = await createSignedDownloadUrl({
        client: supabase,
        bucket: getPrivateStorageBucket(),
        path: storagePath,
        expiresInSeconds: 3600,
      });
      const signedUrl = normalizeAbsoluteHttpUrl(signed.signedUrl);
      if (!signedUrl) {
        throw brandLogoUnavailable();
      }
      upstream = await fetch(signedUrl, {
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw brandLogoUnavailable();
    }

    const contentType = normalizeBrandLogoContentType(
      upstream.headers.get("content-type"),
    );
    if (!upstream.ok || !upstream.body || !contentType) {
      throw brandLogoUnavailable();
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=300, must-revalidate",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}

function normalizeBrandLogoContentType(value: string | null) {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return BRAND_LOGO_CONTENT_TYPES.has(contentType) ? contentType : null;
}

function brandLogoUnavailable() {
  return new PublicAdmissionShareError(
    "RECORDING_SOURCE_UNAVAILABLE",
    "Brand logo source is unavailable",
    404,
  );
}
