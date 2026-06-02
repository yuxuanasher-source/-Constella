import { NextResponse } from "next/server";

import {
  rankStreamerCandidates,
  scoreSupplierQuality,
  type MatchingProjectContext,
  type StreamerCandidateSnapshot,
  type SupplierQualitySnapshot,
} from "@/features/war-room/matching-engine";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";
import { isMcnStaff } from "@/lib/rbac/roles";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isMcnStaff(auth.role)) {
      return NextResponse.json(
        { error: "Only MCN staff can run matching decisions" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const matches = rankStreamerCandidates({
      project: body.project as MatchingProjectContext,
      candidates: Array.isArray(body.candidates)
        ? (body.candidates as StreamerCandidateSnapshot[])
        : [],
    });
    const suppliers = Array.isArray(body.suppliers)
      ? (body.suppliers as SupplierQualitySnapshot[]).map(scoreSupplierQuality)
      : [];

    return NextResponse.json({ matches, suppliers });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
