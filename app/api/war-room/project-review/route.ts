import { NextResponse } from "next/server";
import { z } from "zod";

import { buildProjectReviewReport } from "@/features/war-room/project-review-report";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { isMcnStaff } from "@/lib/rbac/roles";

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

const reviewStreamerSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMinutes: z.number(),
  totalViews: z.number(),
  completionRateBps: z.number().nullable(),
  roiBps: z.number().nullable(),
  grossMarginContributionCents: z.number().nullable(),
  anomalyCount: z.number(),
  disputeCount: z.number(),
});

const projectReviewBodySchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    platform: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
  }),
  finance: z.object({
    receivableCents: z.number(),
    payableCents: z.number(),
    supplierCostCents: z.number(),
    adjustmentCents: z.number(),
    manualRevenueCents: z.number(),
  }),
  streamers: z.array(reviewStreamerSchema),
  suppliers: z.array(supplierSchema),
  evidenceSummary: z.object({
    green: z.number(),
    yellow: z.number(),
    red: z.number(),
    unknown: z.number(),
  }),
  targetMarginBps: z.number().optional(),
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
        { error: "Only MCN staff can build project review reports" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, projectReviewBodySchema);
    const report = buildProjectReviewReport(body);
    return NextResponse.json({ report });
  } catch (error) {
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
