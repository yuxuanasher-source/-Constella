import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvidenceLevel, TimeSource } from "./live-report-evidence";
import type { LiveTaskStatus } from "./live-task-state";
import type { LiveTaskType, ReportStatus } from "./live-operations-service";

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
  taskId: string;
  projectId: string;
  streamerId: string;
  status: ReportStatus;
  taskTitle: string;
  projectName: string;
  streamerName: string;
  settlementDuration: number | null;
  systemDuration: number | null;
  screenshotDuration: number | null;
  divergencePct: number | null;
  timeSource: TimeSource | null;
  evidenceLevel: EvidenceLevel | null;
  viewers: number | null;
  riskFlags: string[];
  submittedAt: string;
};

export type OpsLiveTaskQueueItem = {
  id: string;
  title: string;
  status: LiveTaskStatus;
  taskType: LiveTaskType;
  projectId: string | null;
  projectName: string;
  streamerId: string;
  streamerName: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  plannedDuration: number | null;
  systemDuration: number;
  anomalyFlags?: string[];
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
  live_task_id: string;
  project_id: string;
  streamer_id: string;
  status: ReportStatus;
  settlement_duration: number | null;
  system_duration: number | null;
  screenshot_duration: number | null;
  divergence_pct: number | null;
  time_source: TimeSource | null;
  evidence_level: EvidenceLevel | null;
  viewers: number | null;
  risk_flags: string[] | null;
  created_at: string;
  live_tasks: { title: string } | { title: string }[] | null;
  projects: { name: string } | { name: string }[] | null;
  streamers: { display_name: string } | { display_name: string }[] | null;
};

type OpsLiveTaskRow = {
  id: string;
  title: string;
  status: LiveTaskStatus;
  task_type: LiveTaskType;
  project_id: string | null;
  streamer_id: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  planned_duration: number | null;
  system_duration: number;
  anomaly_flags?: string[] | null;
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
  organizationId?: string,
): Promise<OpsLiveReportQueueItem[]> {
  let query = client
    .from("live_reports")
    .select(
      "id, live_task_id, project_id, streamer_id, status, settlement_duration, system_duration, screenshot_duration, divergence_pct, time_source, evidence_level, viewers, risk_flags, created_at, live_tasks(title), projects(name), streamers(display_name)",
    )
    .in("status", [
      "pending_review",
      "pending_adjudication",
      "approved",
      "rejected",
      "need_more",
    ]);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  // 防线：按提交时间倒序取最新 200 条，避免报数历史增长后拖全表。
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<OpsLiveReportRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsLiveReportQueueItem);
}

export async function listOpsLiveTaskQueue(
  client: SupabaseClient,
  organizationId?: string,
): Promise<OpsLiveTaskQueueItem[]> {
  let query = client
    .from("live_tasks")
    .select(
      "id, title, status, task_type, project_id, streamer_id, planned_start_at, planned_end_at, planned_duration, system_duration, anomaly_flags, projects(name), streamers(display_name)",
    );

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  // 防线：只保留计划开始时间最新的 200 条任务，避免历史任务增长后拖全表。
  // 数据库按 planned_start_at 倒序截断（desc 时 NULL 在前，未排期任务视同
  // 最新、不会被截掉），再在内存中反转，保持对外「时间正序」的既有语义。
  const { data, error } = await query
    .order("planned_start_at", { ascending: false })
    .limit(200)
    .returns<OpsLiveTaskRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsLiveTaskQueueItem).reverse();
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
    taskId: row.live_task_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    status: row.status,
    taskTitle: task?.title ?? "Unknown task",
    projectName: project?.name ?? "Unknown project",
    streamerName: streamer?.display_name ?? "Unknown streamer",
    settlementDuration: row.settlement_duration,
    systemDuration: row.system_duration,
    screenshotDuration: row.screenshot_duration,
    divergencePct: row.divergence_pct,
    timeSource: row.time_source,
    evidenceLevel: row.evidence_level,
    viewers: row.viewers,
    riskFlags: row.risk_flags ?? [],
    submittedAt: row.created_at,
  };
}

export function toOpsLiveTaskQueueItem(
  row: OpsLiveTaskRow,
): OpsLiveTaskQueueItem {
  const project = first(row.projects);
  const streamer = first(row.streamers);

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    taskType: row.task_type,
    projectId: row.project_id,
    projectName: project?.name ?? "Unknown project",
    streamerId: row.streamer_id,
    streamerName: streamer?.display_name ?? "Unknown streamer",
    plannedStartAt: row.planned_start_at,
    plannedEndAt: row.planned_end_at,
    plannedDuration: row.planned_duration,
    systemDuration: row.system_duration,
    anomalyFlags: row.anomaly_flags ?? [],
  };
}

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
