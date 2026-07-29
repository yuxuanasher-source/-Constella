import { NextResponse } from "next/server";
import { z } from "zod";

import {
  evaluateAutoReviewActive,
  evaluateAutoReviewShadow,
} from "@/features/auto-review/auto-review-service";
import { evaluateAutoReviewRolloutGate } from "@/features/auto-review/auto-review-rollout-gates";
import {
  listAutoReviewRolloutMetricRows,
  type AutoReviewRolloutMetricQueryClient,
} from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { reviewLiveReport } from "@/features/live-operations/live-operations-service";
import { SupabaseLiveOperationsRepository } from "@/features/live-operations/live-operations-repository";
import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { toHttpError } from "@/lib/http/http-error";
import { parseJsonBody } from "@/lib/http/parse-json-body";
import { sendNotification } from "@/lib/notify/notify";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

const autoReviewEvaluateBodySchema = z.object({
  targetMode: z.enum(["shadow", "active"]).optional(),
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
  rolloutConfig: z
    .object({
      killSwitchEnabled: z.boolean().optional(),
      minimumShadowSampleCount: z.number().int().nonnegative().optional(),
      maximumFalseAcceptRateBps: z.number().int().nonnegative().optional(),
      minimumAuditSampleCount: z.number().int().nonnegative().optional(),
      maximumAuditErrorRateBps: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
    })
    .optional(),
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

    const targetMode = body.targetMode ?? body.rule.mode;
    if (targetMode === "active") {
      const metricClient =
        supabase as unknown as AutoReviewRolloutMetricQueryClient;
      const config = {
        targetMode: "active" as const,
        killSwitchEnabled: body.rolloutConfig?.killSwitchEnabled ?? false,
        minimumShadowSampleCount:
          body.rolloutConfig?.minimumShadowSampleCount ?? 50,
        maximumFalseAcceptRateBps:
          body.rolloutConfig?.maximumFalseAcceptRateBps ?? 100,
        minimumAuditSampleCount:
          body.rolloutConfig?.minimumAuditSampleCount ?? 20,
        maximumAuditErrorRateBps:
          body.rolloutConfig?.maximumAuditErrorRateBps ?? 250,
        explicitActiveRequest: true,
      };
      const metrics = await listAutoReviewRolloutMetricRows(metricClient, {
        organizationId: auth.organizationId,
        config,
        limit: body.rolloutConfig?.limit,
      });
      const rolloutGate = evaluateAutoReviewRolloutGate(metrics.gateInput);

      if (!rolloutGate.allowed || rolloutGate.effectiveMode !== "active") {
        const result = await evaluateAutoReviewShadow({
          client: supabase,
          actor: auth,
          report: body.report,
          rule: { ...body.rule, mode: "shadow" },
        });
        return NextResponse.json({
          result: { ...result, applied: false },
          rolloutGate,
        });
      }

      const systemActor = {
        userId: auth.userId,
        name: "系统自动审核",
        role: auth.role,
        organizationId: auth.organizationId,
      };
      const repo = new SupabaseLiveOperationsRepository(supabase);
      const result = await evaluateAutoReviewActive({
        client: supabase,
        actor: systemActor,
        report: body.report,
        rule: { ...body.rule, mode: "active" },
        rolloutGate,
        approveReport: ({ actor, reportId, input }) =>
          reviewLiveReport({
            repo,
            audit: (auditInput) => writeAuditLog(supabase, auditInput),
            notify: (notifyInput) => sendNotification(supabase, notifyInput),
            actor,
            reportId,
            input,
          }),
      });

      return NextResponse.json({ result, rolloutGate });
    }

    const result = await evaluateAutoReviewShadow({
      client: supabase,
      actor: auth,
      report: body.report,
      rule: { ...body.rule, mode: "shadow" },
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
