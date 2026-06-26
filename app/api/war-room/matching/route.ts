import { NextResponse } from "next/server";

import {
  rankStreamerCandidates,
  scoreSupplierQuality,
  type MatchingProjectContext,
  type StreamerCandidateSnapshot,
  type SupplierQualitySnapshot,
} from "@/features/war-room/matching-engine";
import { withAuth } from "@/lib/http/route-handler";
import { isMcnStaff } from "@/lib/rbac/roles";

export const POST = withAuth(async ({ auth, request }) => {
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
});
