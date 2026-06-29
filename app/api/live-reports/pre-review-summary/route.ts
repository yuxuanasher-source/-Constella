import { NextResponse } from "next/server";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
  jsonError,
} from "@/features/live-operations/live-operations-route-utils";
import { listReportPreReviewSummaries } from "@/features/report-pre-review/report-pre-review-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const context = await getLiveOperationsRouteContext();
    const actor = await actorFromContext(context);
    const summaries = await listReportPreReviewSummaries({
      client: context.supabase,
      actor,
      reportIds: parseReportIds(url.searchParams),
      limit: parseLimit(url.searchParams),
    });

    return NextResponse.json({ summaries });
  } catch (error) {
    return jsonError(error);
  }
}

function parseReportIds(params: URLSearchParams): string[] | undefined {
  const values = params
    .getAll("reportIds")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

function parseLimit(params: URLSearchParams): number | undefined {
  const value = Number(params.get("limit"));
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return Math.min(value, 200);
}
