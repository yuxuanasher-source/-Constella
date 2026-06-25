import { NextResponse } from "next/server";
import { z } from "zod";

import {
  rankStreamerCandidates,
  scoreSupplierQuality,
} from "@/features/war-room/matching-engine";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { isMcnStaff } from "@/lib/rbac/roles";

const referenceProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  result: z.string(),
});

const streamerCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  categories: z.array(z.string()),
  platforms: z.array(z.string()),
  styles: z.array(z.string()),
  completionRateBps: z.number(),
  screeningPassRateBps: z.number(),
  roiBps: z.number(),
  grossMarginContributionCents: z.number(),
  riskTags: z.array(z.string()),
  availableMinutes: z.number(),
  referenceProjects: z.array(referenceProjectSchema),
});

const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  screeningPassRateBps: z.number(),
  completionRateBps: z.number(),
  marginContributionCents: z.number(),
  anomalyRateBps: z.number(),
  blacklistRateBps: z.number(),
  isBlacklisted: z.boolean(),
});

const matchingBodySchema = z.object({
  project: z.object({
    category: z.string(),
    platform: z.string(),
    preferredStyles: z.array(z.string()),
    requiredMinutes: z.number(),
  }),
  candidates: z.array(streamerCandidateSchema).default([]),
  suppliers: z.array(supplierSchema).default([]),
});

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

    const body = await parseJsonBody(request, matchingBodySchema);
    const matches = rankStreamerCandidates({
      project: body.project,
      candidates: body.candidates,
    });
    const suppliers = body.suppliers.map(scoreSupplierQuality);

    return NextResponse.json({ matches, suppliers });
  } catch (error) {
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
