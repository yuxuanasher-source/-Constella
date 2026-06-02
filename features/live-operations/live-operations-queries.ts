import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvidenceLevel, TimeSource } from "./live-report-evidence";
import type { LiveTaskStatus } from "./live-task-state";
import type { ReportStatus } from "./live-operations-service";

export type StreamerTaskCard = {
  id: string;
  title: string;
  status: LiveTaskStatus;
  projectName: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  plannedDuration: number | null;
  systemDuration: number;
};

export type OpsLiveReportQueueItem = {
  id: string;
  status: ReportStatus;
  taskTitle: string;
  projectName: string;
  streamerName: string;
  settlementDuration: number | null;
  timeSource: TimeSource | null;
  evidenceLevel: EvidenceLevel | null;
  viewers: number | null;
  submittedAt: string;
};

type StreamerTaskRow = {
  id: string;
  title: string;
  status: LiveTaskStatus;
  planned_start_at: string | null;
  planned_end_at: string | null;
  planned_duration: number | null;
  system_duration: number;
  projects: { name: string } | { name: string }[] | null;
};

type OpsLiveReportRow = {
  id: string;
  status: ReportStatus;
  settlement_duration: number | null;
  time_source: TimeSource | null;
  evidence_level: EvidenceLevel | null;
  viewers: number | null;
  created_at: string;
  live_tasks: { title: string } | { title: string }[] | null;
  projects: { name: string } | { name: string }[] | null;
  streamers: { display_name: string } | { display_name: string }[] | null;
};

export async function listStreamerTaskCards(
  client: SupabaseClient,
  streamerId: string,
): Promise<StreamerTaskCard[]> {
  const { data, error } = await client
    .from("live_tasks")
    .select(
      "id, title, status, planned_start_at, planned_end_at, planned_duration, system_duration, projects(name)",
    )
    .eq("streamer_id", streamerId)
    .order("planned_start_at", { ascending: true })
    .returns<StreamerTaskRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toStreamerTaskCard);
}

export async function listOpsLiveReportQueue(
  client: SupabaseClient,
): Promise<OpsLiveReportQueueItem[]> {
  const { data, error } = await client
    .from("live_reports")
    .select(
      "id, status, settlement_duration, time_source, evidence_level, viewers, created_at, live_tasks(title), projects(name), streamers(display_name)",
    )
    .in("status", ["pending_review", "pending_adjudication"])
    .order("created_at", { ascending: false })
    .returns<OpsLiveReportRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsLiveReportQueueItem);
}

export function toStreamerTaskCard(row: StreamerTaskRow): StreamerTaskCard {
  const project = first(row.projects);

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    projectName: project?.name ?? "Unknown project",
    plannedStartAt: row.planned_start_at,
    plannedEndAt: row.planned_end_at,
    plannedDuration: row.planned_duration,
    systemDuration: row.system_duration,
  };
}

export function toOpsLiveReportQueueItem(
  row: OpsLiveReportRow,
): OpsLiveReportQueueItem {
  const task = first(row.live_tasks);
  const project = first(row.projects);
  const streamer = first(row.streamers);

  return {
    id: row.id,
    status: row.status,
    taskTitle: task?.title ?? "Unknown task",
    projectName: project?.name ?? "Unknown project",
    streamerName: streamer?.display_name ?? "Unknown streamer",
    settlementDuration: row.settlement_duration,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    viewers: row.viewers,
    submittedAt: row.created_at,
  };
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
