import { NextResponse } from "next/server";

import {
  listPublicAdmissionReviewDrafts,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

import {
  publicAdmissionReviewDraftDto,
  publicAdmissionShareErrorResponse,
} from "../../public-route-utils";

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

    const drafts = await listPublicAdmissionReviewDrafts({
      repo: new SupabaseAdmissionShareBoardRepository(supabase),
      accessStore: new SupabaseAdmissionShareAccessStore(supabase),
      token,
      sessionToken:
        readAdmissionShareAccessSession(request, token) ?? undefined,
    });

    return NextResponse.json({
      drafts: drafts.map(publicAdmissionReviewDraftDto),
    });
  } catch (error) {
    return publicAdmissionShareErrorResponse(error);
  }
}
