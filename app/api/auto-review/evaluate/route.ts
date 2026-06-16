import { NextResponse } from "next/server";
import { z } from "zod";

import { evaluateAutoReviewShadow } from "@/features/auto-review/auto-review-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

const autoReviewEvaluateBodySchema = z.object({
  report: z.object({
    id: z.string(),
    status: z.string(),
    evidenceLevel: z.enum(["green", "yellow", "red"]).nullable(),
    timeSource: z.enum(["system", "screenshot", "claimed"]).nullable(),
    settlementDuration: z.number().nullable(),
    systemDuration: z.number().nullable(),
    screenshotDuration: z.number().nullable(),
    riskFlags: z.array(z.string()),
    taskHasAnomaly: z.boolean(),
    durationOverridden: z.boolean(),
    projectSensitivity: z.enum(["normal", "high"]),
    streamerTrust: z.enum(["trusted", "probation", "restricted"]),
    plannedDuration: z.number().nullable(),
  }),
  rule: z.object({
    id: z.string(),
    mode: z.enum(["shadow", "active"]),
    maxDurationDeviationPct: z.number(),
    maxDurationDeviationMinutes: z.number(),
    dailyHardLimitMinutes: z.number(),
  }),
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

    if (!allowedRoles.has(auth.role)) {
      return NextResponse.json(
        { error: "Only operations roles can evaluate auto review" },
        { status: 403 },
      );
    }

    const body = await parseJsonBody(request, autoReviewEvaluateBodySchema);

    const result = await evaluateAutoReviewShadow({
      client: supabase,
      actor: auth,
      report: body.report,
      rule: body.rule,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const httpError = toHttpError(error);
    return NextResponse.json(
      { error: httpError.message },
      { status: httpError.status },
    );
  }
}
