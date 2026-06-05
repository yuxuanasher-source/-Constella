import { NextResponse } from "next/server";

import {
  evaluateAutoReviewRolloutGate,
  type AutoReviewRolloutMode,
} from "@/features/auto-review/auto-review-rollout-gates";
import {
  listAutoReviewRolloutMetricRows,
  type AutoReviewRolloutMetricQueryClient,
} from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);
const rolloutModes = new Set<AutoReviewRolloutMode>([
  "shadow",
  "gray",
  "active",
]);

export async function GET(request: Request) {
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
        { error: "Only operations roles can read auto review rollout metrics" },
        { status: 403 },
      );
    }

    const parsed = parseRolloutMetricsQuery(new URL(request.url).searchParams);
    const metricClient =
      supabase as unknown as AutoReviewRolloutMetricQueryClient;
    const metrics = await listAutoReviewRolloutMetricRows(metricClient, {
      organizationId: auth.organizationId,
      config: parsed.config,
      limit: parsed.limit,
    });
    const gate = evaluateAutoReviewRolloutGate(metrics.gateInput);

    return NextResponse.json({
      result: {
        gate,
        metrics,
      },
    });
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

function parseRolloutMetricsQuery(searchParams: URLSearchParams) {
  return {
    limit: parseOptionalInteger(searchParams.get("limit")),
    config: {
      targetMode: parseTargetMode(searchParams.get("targetMode")),
      killSwitchEnabled: parseBoolean(
        searchParams.get("killSwitchEnabled"),
        false,
      ),
      minimumShadowSampleCount: parseIntegerWithDefault(
        searchParams.get("minimumShadowSampleCount"),
        50,
      ),
      maximumFalseAcceptRateBps: parseIntegerWithDefault(
        searchParams.get("maximumFalseAcceptRateBps"),
        100,
      ),
      minimumAuditSampleCount: parseIntegerWithDefault(
        searchParams.get("minimumAuditSampleCount"),
        20,
      ),
      maximumAuditErrorRateBps: parseIntegerWithDefault(
        searchParams.get("maximumAuditErrorRateBps"),
        250,
      ),
      explicitActiveRequest: parseBoolean(
        searchParams.get("explicitActiveRequest"),
        false,
      ),
    },
  };
}

function parseTargetMode(value: string | null): AutoReviewRolloutMode {
  if (!value) {
    return "shadow";
  }

  if (rolloutModes.has(value as AutoReviewRolloutMode)) {
    return value as AutoReviewRolloutMode;
  }

  throw new Error("targetMode must be shadow, gray, or active");
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value === "true";
}

function parseIntegerWithDefault(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  return parseOptionalInteger(value) ?? fallback;
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.trunc(parsed);
}
