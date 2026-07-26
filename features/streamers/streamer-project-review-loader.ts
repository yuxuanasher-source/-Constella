import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  StreamerProjectReviewInput,
  StreamerProjectReviewRecording,
  StreamerProjectReviewReport,
  StreamerProjectReviewTask,
} from "./streamer-project-review";

type StreamerProjectReviewLoaderClient = Pick<SupabaseClient, "from">;

type StreamerRow = {
  id: string;
  display_name?: string | null;
};

type ProjectRow = {
  id: string;
  name?: string | null;
  product_name?: string | null;
};

type LiveTaskRow = {
  id: string;
  status?: string | null;
  planned_start_at?: string | null;
  planned_end_at?: string | null;
  system_duration?: number | null;
};

type LiveReportRow = {
  id: string;
  live_task_id?: string | null;
  status?: string | null;
  settlement_duration?: number | null;
  system_duration?: number | null;
  viewers?: number | null;
  evidence_level?: string | null;
  risk_flags?: string[] | null;
  created_at?: string | null;
};

type OcrResultRow = {
  live_report_id?: string | null;
  raw_result?: unknown;
};

type ProjectApplicationRow = {
  id: string;
};

type RecordingSubmissionRow = {
  id: string;
  status?: string | null;
  duration_seconds?: number | null;
  review_note?: string | null;
};

export async function loadStreamerProjectReviewInput({
  supabase,
  organizationId,
  streamerId,
  projectId,
}: {
  supabase: StreamerProjectReviewLoaderClient;
  organizationId: string;
  streamerId: string;
  projectId: string;
}): Promise<StreamerProjectReviewInput> {
  const [streamer, project] = await Promise.all([
    loadSingle<StreamerRow>(
      supabase
        .from("streamers")
        .select("id, display_name")
        .eq("organization_id", organizationId)
        .eq("id", streamerId)
        .maybeSingle(),
    ),
    loadSingle<ProjectRow>(
      supabase
        .from("projects")
        .select("id, name, product_name")
        .eq("organization_id", organizationId)
        .eq("id", projectId)
        .maybeSingle(),
    ),
  ]);

  if (!streamer || !project) {
    throw new Error("Streamer project review target not found");
  }

  const [tasks, reports, applications] = await Promise.all([
    loadList<LiveTaskRow>(
      supabase
        .from("live_tasks")
        .select("id, status, planned_start_at, planned_end_at, system_duration")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .eq("streamer_id", streamerId)
        .order("planned_start_at", { ascending: true }),
    ),
    loadList<LiveReportRow>(
      supabase
        .from("live_reports")
        .select(
          "id, live_task_id, status, settlement_duration, system_duration, viewers, evidence_level, risk_flags, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .eq("streamer_id", streamerId)
        .order("created_at", { ascending: true }),
    ),
    loadList<ProjectApplicationRow>(
      supabase
        .from("project_applications")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("project_id", projectId)
        .eq("streamer_id", streamerId),
    ),
  ]);

  const applicationIds = applications.map((application) => application.id);
  const reportIds = reports.map((report) => report.id);
  const ocrResults = reportIds.length
    ? await loadList<OcrResultRow>(
        supabase
          .from("ocr_results")
          .select("live_report_id, raw_result")
          .eq("organization_id", organizationId)
          .in("live_report_id", reportIds),
      )
    : [];
  const ocrMetricByReportId = mapOcrMetricsByReportId(ocrResults);
  const recordings = applicationIds.length
    ? await loadList<RecordingSubmissionRow>(
        supabase
          .from("recording_submissions")
          .select("id, status, duration_seconds, review_note")
          .eq("organization_id", organizationId)
          .in("application_id", applicationIds)
          .order("created_at", { ascending: true }),
      )
    : [];

  return {
    streamer: {
      id: streamer.id,
      displayName: streamer.display_name?.trim() || "Unknown streamer",
    },
    project: {
      id: project.id,
      name: project.name?.trim() || "Unknown project",
      productType: project.product_name?.trim() || "unknown",
    },
    tasks: tasks.map(toReviewTask),
    reports: reports.map((report) =>
      toReviewReport(report, ocrMetricByReportId.get(report.id)),
    ),
    recordings: recordings.map(toReviewRecording),
  };
}

function toReviewTask(row: LiveTaskRow): StreamerProjectReviewTask {
  return {
    id: row.id,
    plannedStartAt: row.planned_start_at ?? null,
    plannedEndAt: row.planned_end_at ?? null,
    status: row.status ?? "unknown",
    systemDuration: row.system_duration ?? null,
  };
}

function toReviewReport(
  row: LiveReportRow,
  ocrMetrics?: { pcu?: number; acu?: number },
): StreamerProjectReviewReport {
  return {
    id: row.id,
    taskId: row.live_task_id ?? null,
    status: row.status ?? "unknown",
    settlementDuration: row.settlement_duration ?? null,
    systemDuration: row.system_duration ?? null,
    viewers: row.viewers ?? null,
    pcu: ocrMetrics?.pcu ?? null,
    acu: ocrMetrics?.acu ?? null,
    evidenceLevel: row.evidence_level ?? null,
    riskFlags: row.risk_flags ?? [],
    submittedAt: row.created_at ?? null,
  };
}

function mapOcrMetricsByReportId(
  rows: OcrResultRow[],
): Map<string, { pcu?: number; acu?: number }> {
  const result = new Map<string, { pcu?: number; acu?: number }>();
  for (const row of rows) {
    if (!row.live_report_id) continue;
    const metrics = extractOcrMetrics(row.raw_result);
    if (metrics.pcu !== undefined || metrics.acu !== undefined) {
      result.set(row.live_report_id, metrics);
    }
  }
  return result;
}

function extractOcrMetrics(value: unknown): { pcu?: number; acu?: number } {
  if (!isRecord(value) || !Array.isArray(value.metricCandidates)) return {};
  const metrics: { pcu?: number; acu?: number } = {};
  for (const candidate of value.metricCandidates) {
    if (!isRecord(candidate)) continue;
    const key = candidate.key;
    const metricValue = positiveNumber(candidate.value);
    if (metricValue === null) continue;
    if (key === "pcu") metrics.pcu = metricValue;
    if (key === "acu") metrics.acu = metricValue;
  }
  return metrics;
}

function toReviewRecording(
  row: RecordingSubmissionRow,
): StreamerProjectReviewRecording {
  return {
    id: row.id,
    status: row.status ?? "unknown",
    adopted: row.status === "approved",
    rejectionReasons: parseDecisionReasons(row.review_note),
    durationSeconds: row.duration_seconds ?? null,
  };
}

function parseDecisionReasons(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[;；,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function loadSingle<T>(
  query: PromiseLike<{ data: T | null; error: Error | null }> & {
    maybeSingle?: () => PromiseLike<{ data: T | null; error: Error | null }>;
  },
): Promise<T | null> {
  const result = query.maybeSingle ? await query.maybeSingle() : await query;
  if (result.error) throw result.error;
  return result.data ?? null;
}

async function loadList<T>(
  query: PromiseLike<{ data: T[] | null; error: Error | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
