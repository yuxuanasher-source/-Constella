import { NextResponse } from "next/server";

import {
  getPublicAdmissionShareBoard,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import {
  jsonError,
  RouteError,
} from "@/features/applications/application-route-utils";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    // Public visitors are unauthenticated, so RLS (staff-only policies) would
    // hide the share board. Access is instead gated by the secret share token,
    // so we read through the service-role client which stays server-side only.
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new RouteError("Public share service is unavailable", 500);
    }

    const repo = new SupabaseAdmissionShareBoardRepository(supabase);
    const shareBoard = await getPublicAdmissionShareBoard({
      repo,
      token,
      accessCode: optionalSearchParam(request, "accessCode"),
    });

    return NextResponse.json({ shareBoard });
  } catch (error) {
    return jsonError(error);
  }
}

function optionalSearchParam(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  return value?.trim() || undefined;
}
