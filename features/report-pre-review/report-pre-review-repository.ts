import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ReportPreReviewDecision,
  ReportPreReviewResult,
  ReportPreReviewSnapshot,
  ReportPreReviewSuggestedAction,
} from "./report-pre-review-engine";

type ReportPreReviewClient = Pick<SupabaseClient, "from">;

type MaybeRelation<T> = T | T[] | null;

type LiveReportSnapshotRow = {
  id: string;
  status: string;
  settlement_duration: number | null;
  system_duration: number | null;
  screenshot_duration: number | null;
  time_source: ReportPreReviewSnapshot["timeSource"];
  evidence_level: ReportPreReviewSnapshot["evidenceLevel"];
  risk_flags: string[] | null;
  live_tasks: MaybeRelation<{
    planned_duration: number | null;
    system_duration: number | null;
    anomaly_flags: string[] | null;
  }>;
  projects: MaybeRelation<{
    sensitivity: "normal" | "high" | null;
  }>;
  streamers: MaybeRelation<{
    risk_level: "low" | "medium" | "high" | null;
    auto_trust: "trusted" | "probation" | "restricted" | null;
    clean_report_count: number | null;
  }>;
  ocr_results: Array<{ status: string | null }> | null;
  report_screenshots: Array<{ id: string }> | null;
};

type ReportPreReviewResultRow = {
  id: string;
  live_report_id: string;
  decision: ReportPreReviewDecision;
  confidence: ReportPreReviewResult["confidence"];
  suggested_action: ReportPreReviewSuggestedAction;
  evidence_summary: string;
  review_note_draft: string;
  reasons: string[] | null;
  failed_gates: string[] | null;
  source: ReportPreReviewResult["source"];
  ai_invocation_id: string | null;
  created_at: string;
};

export type ReportPreReviewSummary = {
  id: string;
  reportId: string;
  decision: ReportPreReviewDecision;
  confidence: ReportPreReviewResult["confidence"];
  suggestedAction: ReportPreReviewSuggestedAction;
  evidenceSummary: string;
  reviewNoteDraft: string;
  reasons: string[];
  failedGates: string[];
  source: ReportPreReviewResult["source"];
  invocationId?: string;
  createdAt: string;
};

export async function getReportPreReviewSnapshot(
  client: ReportPreReviewClient,
  input: { organizationId: string; reportId: string },
): Promise<ReportPreReviewSnapshot | null> {
  const { data, error } = await client
    .from("live_reports")
    .select(
      `
        id,
        status,
        settlement_duration,
        system_duration,
        screenshot_duration,
        time_source,
        evidence_level,
        risk_flags,
        live_tasks(planned_duration, system_duration, anomaly_flags),
        projects(sensitivity),
        streamers(risk_level, auto_trust, clean_report_count),
        ocr_results(status),
        report_screenshots(id)
      `,
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.reportId)
    .maybeSingle<LiveReportSnapshotRow>();

  if (error) {
    throw error;
  }

  return data ? toReportPreReviewSnapshot(data) : null;
}

export async function appendReportPreReviewResult(
  client: ReportPreReviewClient,
  input: {
    organizationId: string;
    reportId: string;
    result: ReportPreReviewResult;
    statusSnapshot: Record<string, unknown>;
    createdBy: string;
  },
): Promise<string> {
  const { data, error } = await client
    .from("report_pre_review_results")
    .insert({
      organization_id: input.organizationId,
      live_report_id: input.reportId,
      decision: input.result.decision,
      confidence: input.result.confidence,
      evidence_summary: input.result.evidenceSummary,
      suggested_action: input.result.suggestedAction,
      review_note_draft: input.result.reviewNoteDraft,
      reasons: input.result.reasons,
      failed_gates: input.result.failedGates,
      source: input.result.source,
      ai_invocation_id: input.result.invocationId,
      status_snapshot: input.statusSnapshot,
      created_by: input.createdBy,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return data.id;
}

export async function listLatestReportPreReviewResults(
  client: ReportPreReviewClient,
  input: { organizationId: string; reportIds?: string[]; limit?: number },
): Promise<ReportPreReviewSummary[]> {
  let query = client
    .from("report_pre_review_results")
    .select(
      `
        id,
        live_report_id,
        decision,
        confidence,
        suggested_action,
        evidence_summary,
        review_note_draft,
        reasons,
        failed_gates,
        source,
        ai_invocation_id,
        created_at
      `,
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: false });

  if (input.reportIds?.length) {
    query = query.in("live_report_id", input.reportIds);
  }

  const { data, error } = await query
    .limit(input.limit ?? 100)
    .returns<ReportPreReviewResultRow[]>();

  if (error) {
    throw error;
  }

  const seen = new Set<string>();
  const summaries: ReportPreReviewSummary[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.live_report_id)) continue;
    seen.add(row.live_report_id);
    summaries.push(toReportPreReviewSummary(row));
  }
  return summaries;
}

function toReportPreReviewSnapshot(
  row: LiveReportSnapshotRow,
): ReportPreReviewSnapshot {
  const task = firstRelation(row.live_tasks);
  const project = firstRelation(row.projects);
  const streamer = firstRelation(row.streamers);
  return {
    reportId: row.id,
    status: row.status,
    evidenceLevel: row.evidence_level,
    timeSource: row.time_source,
    settlementDuration: row.settlement_duration,
    systemDuration: row.system_duration ?? task?.system_duration ?? null,
    screenshotDuration: row.screenshot_duration,
    screenshotCount: row.report_screenshots?.length ?? 0,
    ocrStatus: toOcrStatus(row.ocr_results),
    riskFlags: row.risk_flags ?? [],
    taskHasAnomaly: Boolean(task?.anomaly_flags?.length),
    durationOverridden: Boolean(
      row.risk_flags?.some((flag) =>
        ["duration_overridden", "manual_duration_override"].includes(flag),
      ),
    ),
    projectSensitivity: project?.sensitivity === "high" ? "high" : "normal",
    streamerTrust: toStreamerTrust(streamer),
    plannedDuration: task?.planned_duration ?? null,
  };
}

function toReportPreReviewSummary(
  row: ReportPreReviewResultRow,
): ReportPreReviewSummary {
  return {
    id: row.id,
    reportId: row.live_report_id,
    decision: row.decision,
    confidence: row.confidence,
    suggestedAction: row.suggested_action,
    evidenceSummary: row.evidence_summary,
    reviewNoteDraft: row.review_note_draft,
    reasons: row.reasons ?? [],
    failedGates: row.failed_gates ?? [],
    source: row.source,
    invocationId: row.ai_invocation_id ?? undefined,
    createdAt: row.created_at,
  };
}

function toOcrStatus(
  rows: Array<{ status: string | null }> | null,
): ReportPreReviewSnapshot["ocrStatus"] {
  if (!rows?.length) return "missing";
  const status =
    rows.find((row) => row.status === "succeeded")?.status ??
    rows[0]?.status ??
    null;
  if (status === "succeeded" || status === "failed" || status === "pending") {
    return status;
  }
  return "pending";
}

function toStreamerTrust(
  row:
    | {
        risk_level: "low" | "medium" | "high" | null;
        auto_trust: "trusted" | "probation" | "restricted" | null;
        clean_report_count: number | null;
      }
    | null
    | undefined,
): ReportPreReviewSnapshot["streamerTrust"] {
  if (!row) return "probation";
  if (row.auto_trust === "restricted" || row.risk_level === "high") {
    return "restricted";
  }
  if (
    row.auto_trust === "trusted" ||
    (row.risk_level === "low" && (row.clean_report_count ?? 0) >= 5)
  ) {
    return "trusted";
  }
  return "probation";
}

function firstRelation<T>(value: MaybeRelation<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
