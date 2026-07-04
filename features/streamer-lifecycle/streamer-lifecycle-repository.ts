import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AttendanceCandidateTask,
  PerformanceSourceTask,
  ShiftChangeStatus,
  ShiftChangeType,
  StreamerAssessmentType,
  StreamerLifecycleStage,
  StreamerRating,
} from "./streamer-lifecycle-state";
import type {
  AttendanceRecordInput,
  LifecycleEventInput,
  LiveTaskForLifecycle,
  PerformanceSnapshotRecord,
  ShiftChangeRequestRecord,
  StreamerAssessmentRecord,
  StreamerLifecycleRecord,
  StreamerLifecycleRepository,
} from "./streamer-lifecycle-service";

type StreamerLifecycleRow = {
  id: string;
  display_name: string;
  user_id: string | null;
  risk_level: string;
  lifecycle_stage: StreamerLifecycleStage;
  rating: StreamerRating;
  contract_start_date: string | null;
  contract_end_date: string | null;
  revenue_share_bps: number | null;
  operation_tier: string;
  operation_tags: string[] | null;
  default_price: number | null;
};

const streamerLifecycleSelect =
  "id, display_name, user_id, risk_level, lifecycle_stage, rating, contract_start_date, contract_end_date, revenue_share_bps, operation_tier, operation_tags, default_price";

type AssessmentRow = {
  id: string;
  streamer_id: string;
  project_id: string | null;
  live_task_id: string | null;
  assessment_type: StreamerAssessmentType;
  title: string;
  status: "pending" | "passed" | "failed";
  score: number | null;
  conclusion: string;
  scheduled_at: string | null;
  concluded_at: string | null;
};

const assessmentSelect =
  "id, streamer_id, project_id, live_task_id, assessment_type, title, status, score, conclusion, scheduled_at, concluded_at";

type ShiftChangeRequestRow = {
  id: string;
  live_task_id: string;
  project_id: string | null;
  streamer_id: string;
  request_type: ShiftChangeType;
  proposed_start_at: string | null;
  proposed_end_at: string | null;
  substitute_streamer_id: string | null;
  reason: string;
  status: ShiftChangeStatus;
  review_note: string | null;
};

const shiftChangeRequestSelect =
  "id, live_task_id, project_id, streamer_id, request_type, proposed_start_at, proposed_end_at, substitute_streamer_id, reason, status, review_note";

type SnapshotRow = {
  id: string;
  streamer_id: string;
  period_start: string;
  period_end: string;
  scheduled_sessions: number;
  live_sessions: number;
  completed_sessions: number;
  broadcast_rate_bps: number;
  total_live_minutes: number;
  total_revenue_amount: number;
  avg_session_revenue_amount: number;
  avg_session_roi_bps: number | null;
  total_viewers: number;
  avg_session_viewers: number;
  computed_at: string;
};

const snapshotSelect =
  "id, streamer_id, period_start, period_end, scheduled_sessions, live_sessions, completed_sessions, broadcast_rate_bps, total_live_minutes, total_revenue_amount, avg_session_revenue_amount, avg_session_roi_bps, total_viewers, avg_session_viewers, computed_at";

type MaybeArray<T> = T | T[] | null;

type PerformanceTaskRow = {
  id: string;
  status: string;
  planned_start_at: string | null;
  system_started_at: string | null;
  system_duration: number;
  live_reports: MaybeArray<{
    settlement_duration: number | null;
    viewers: number | null;
    status: string;
  }>;
  projects: MaybeArray<{ default_hourly_rate: number | null }>;
};

export class SupabaseStreamerLifecycleRepository implements StreamerLifecycleRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getStreamerLifecycle(
    streamerId: string,
  ): Promise<StreamerLifecycleRecord | null> {
    const { data, error } = await this.client
      .from("streamers")
      .select(streamerLifecycleSelect)
      .eq("id", streamerId)
      .maybeSingle<StreamerLifecycleRow>();

    if (error) {
      throw error;
    }

    return data ? toStreamerLifecycleRecord(data) : null;
  }

  async updateStreamerLifecycle(
    streamerId: string,
    patch: Record<string, unknown>,
  ): Promise<StreamerLifecycleRecord> {
    const { data, error } = await this.client
      .from("streamers")
      .update(patch)
      .eq("id", streamerId)
      .select(streamerLifecycleSelect)
      .single<StreamerLifecycleRow>();

    if (error) {
      throw error;
    }

    return toStreamerLifecycleRecord(data);
  }

  async insertLifecycleEvent(input: LifecycleEventInput): Promise<void> {
    const { error } = await this.client
      .from("streamer_lifecycle_events")
      .insert({
        organization_id: input.organizationId,
        streamer_id: input.streamerId,
        event_type: input.eventType,
        from_value: input.fromValue ?? null,
        to_value: input.toValue ?? null,
        reason: input.reason ?? null,
        detail: input.detail ?? {},
        created_by: input.createdBy ?? null,
      });

    if (error) {
      throw error;
    }
  }

  async createAssessment(input: {
    organizationId: string;
    streamerId: string;
    projectId?: string | null;
    liveTaskId?: string | null;
    assessmentType: StreamerAssessmentType;
    title: string;
    scheduledAt?: string | null;
    createdBy: string;
  }): Promise<StreamerAssessmentRecord> {
    const { data, error } = await this.client
      .from("streamer_assessments")
      .insert({
        organization_id: input.organizationId,
        streamer_id: input.streamerId,
        project_id: input.projectId ?? null,
        live_task_id: input.liveTaskId ?? null,
        assessment_type: input.assessmentType,
        title: input.title,
        scheduled_at: input.scheduledAt ?? null,
        created_by: input.createdBy,
      })
      .select(assessmentSelect)
      .single<AssessmentRow>();

    if (error) {
      throw error;
    }

    return toAssessmentRecord(data);
  }

  async getAssessmentById(
    assessmentId: string,
  ): Promise<StreamerAssessmentRecord | null> {
    const { data, error } = await this.client
      .from("streamer_assessments")
      .select(assessmentSelect)
      .eq("id", assessmentId)
      .maybeSingle<AssessmentRow>();

    if (error) {
      throw error;
    }

    return data ? toAssessmentRecord(data) : null;
  }

  async concludeAssessment(
    assessmentId: string,
    patch: {
      status: "passed" | "failed";
      score?: number | null;
      conclusion?: string;
      evaluator_id: string;
      concluded_at: string;
    },
  ): Promise<StreamerAssessmentRecord> {
    const { data, error } = await this.client
      .from("streamer_assessments")
      .update(patch)
      .eq("id", assessmentId)
      .select(assessmentSelect)
      .single<AssessmentRow>();

    if (error) {
      throw error;
    }

    return toAssessmentRecord(data);
  }

  async listAttendanceCandidateTasks(
    organizationId: string,
    until: string,
  ): Promise<AttendanceCandidateTask[]> {
    const { data: existing, error: existingError } = await this.client
      .from("streamer_attendance_records")
      .select("live_task_id")
      .eq("organization_id", organizationId);

    if (existingError) {
      throw existingError;
    }

    const covered = new Set(
      (existing ?? []).map((row) => row.live_task_id as string),
    );

    const { data, error } = await this.client
      .from("live_tasks")
      .select(
        "id, streamer_id, project_id, status, planned_start_at, planned_end_at, system_started_at, system_stopped_at, system_duration",
      )
      .eq("organization_id", organizationId)
      .neq("status", "cancelled")
      .not("planned_start_at", "is", null)
      .or(`system_started_at.not.is.null,planned_end_at.lte.${until}`)
      .limit(500);

    if (error) {
      throw error;
    }

    return (data ?? [])
      .filter((row) => !covered.has(row.id as string))
      .map((row) => ({
        taskId: row.id as string,
        streamerId: row.streamer_id as string,
        projectId: (row.project_id as string | null) ?? null,
        status: row.status as string,
        plannedStartAt: (row.planned_start_at as string | null) ?? null,
        plannedEndAt: (row.planned_end_at as string | null) ?? null,
        systemStartedAt: (row.system_started_at as string | null) ?? null,
        systemStoppedAt: (row.system_stopped_at as string | null) ?? null,
        systemDuration: (row.system_duration as number | null) ?? 0,
      }));
  }

  async insertAttendanceRecords(
    records: AttendanceRecordInput[],
  ): Promise<number> {
    const { data, error } = await this.client
      .from("streamer_attendance_records")
      .upsert(records.map(toAttendanceRow), {
        onConflict: "organization_id,live_task_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      throw error;
    }

    return data?.length ?? 0;
  }

  async upsertManualAttendance(record: AttendanceRecordInput): Promise<void> {
    const { error } = await this.client
      .from("streamer_attendance_records")
      .upsert(toAttendanceRow(record), {
        onConflict: "organization_id,live_task_id",
      });

    if (error) {
      throw error;
    }
  }

  async getLiveTaskById(taskId: string): Promise<LiveTaskForLifecycle | null> {
    const { data, error } = await this.client
      .from("live_tasks")
      .select(
        "id, organization_id, project_id, streamer_id, status, planned_start_at, planned_end_at",
      )
      .eq("id", taskId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id as string,
      organizationId: data.organization_id as string,
      projectId: (data.project_id as string | null) ?? null,
      streamerId: data.streamer_id as string,
      status: data.status as string,
      plannedStartAt: (data.planned_start_at as string | null) ?? null,
      plannedEndAt: (data.planned_end_at as string | null) ?? null,
    };
  }

  async getProjectStreamerStatus(
    projectId: string,
    streamerId: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from("project_streamers")
      .select("status")
      .eq("project_id", projectId)
      .eq("streamer_id", streamerId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.status as string | undefined) ?? null;
  }

  async createShiftChangeRequest(input: {
    organizationId: string;
    liveTaskId: string;
    projectId: string | null;
    streamerId: string;
    requestType: ShiftChangeType;
    proposedStartAt?: string | null;
    proposedEndAt?: string | null;
    substituteStreamerId?: string | null;
    reason: string;
    createdBy: string;
  }): Promise<ShiftChangeRequestRecord> {
    const { data, error } = await this.client
      .from("shift_change_requests")
      .insert({
        organization_id: input.organizationId,
        live_task_id: input.liveTaskId,
        project_id: input.projectId,
        streamer_id: input.streamerId,
        request_type: input.requestType,
        proposed_start_at: input.proposedStartAt ?? null,
        proposed_end_at: input.proposedEndAt ?? null,
        substitute_streamer_id: input.substituteStreamerId ?? null,
        reason: input.reason,
        created_by: input.createdBy,
      })
      .select(shiftChangeRequestSelect)
      .single<ShiftChangeRequestRow>();

    if (error) {
      throw error;
    }

    return toShiftChangeRequestRecord(data);
  }

  async getShiftChangeRequestById(
    requestId: string,
  ): Promise<ShiftChangeRequestRecord | null> {
    const { data, error } = await this.client
      .from("shift_change_requests")
      .select(shiftChangeRequestSelect)
      .eq("id", requestId)
      .maybeSingle<ShiftChangeRequestRow>();

    if (error) {
      throw error;
    }

    return data ? toShiftChangeRequestRecord(data) : null;
  }

  async updateShiftChangeRequest(
    requestId: string,
    patch: {
      status: ShiftChangeStatus;
      reviewed_by?: string;
      reviewed_at?: string;
      review_note?: string | null;
    },
  ): Promise<ShiftChangeRequestRecord> {
    const { data, error } = await this.client
      .from("shift_change_requests")
      .update(patch)
      .eq("id", requestId)
      .select(shiftChangeRequestSelect)
      .single<ShiftChangeRequestRow>();

    if (error) {
      throw error;
    }

    return toShiftChangeRequestRecord(data);
  }

  async updateLiveTaskSchedule(
    taskId: string,
    patch: {
      planned_start_at?: string;
      planned_end_at?: string;
      planned_duration?: number;
      streamer_id?: string;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from("live_tasks")
      .update(patch)
      .eq("id", taskId);

    if (error) {
      throw error;
    }
  }

  async listPerformanceSourceTasks(
    organizationId: string,
    streamerId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<PerformanceSourceTask[]> {
    const windowEndExclusive = new Date(
      new Date(`${periodEnd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.client
      .from("live_tasks")
      .select(
        "id, status, planned_start_at, system_started_at, system_duration, live_reports(settlement_duration, viewers, status), projects(default_hourly_rate)",
      )
      .eq("organization_id", organizationId)
      .eq("streamer_id", streamerId)
      .gte("planned_start_at", `${periodStart}T00:00:00Z`)
      .lt("planned_start_at", windowEndExclusive)
      .limit(500);

    if (error) {
      throw error;
    }

    return ((data ?? []) as PerformanceTaskRow[]).map((row) => {
      const report = firstOf(row.live_reports)
        ? pickReport(row.live_reports)
        : null;
      return {
        taskId: row.id,
        status: row.status,
        plannedStartAt: row.planned_start_at,
        systemStartedAt: row.system_started_at,
        systemDuration: row.system_duration ?? 0,
        settlementDuration: report?.settlement_duration ?? null,
        viewers: report?.viewers ?? null,
        projectHourlyRate: firstOf(row.projects)?.default_hourly_rate ?? null,
      };
    });
  }

  async upsertPerformanceSnapshot(input: {
    organizationId: string;
    streamerId: string;
    periodStart: string;
    periodEnd: string;
    metrics: Record<string, unknown>;
    createdBy: string;
  }): Promise<PerformanceSnapshotRecord> {
    const { data, error } = await this.client
      .from("streamer_performance_snapshots")
      .upsert(
        {
          organization_id: input.organizationId,
          streamer_id: input.streamerId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          ...input.metrics,
          computed_at: new Date().toISOString(),
          created_by: input.createdBy,
        },
        { onConflict: "organization_id,streamer_id,period_start,period_end" },
      )
      .select(snapshotSelect)
      .single<SnapshotRow>();

    if (error) {
      throw error;
    }

    return toSnapshotRecord(data);
  }

  async getLatestPerformanceSnapshot(
    streamerId: string,
  ): Promise<PerformanceSnapshotRecord | null> {
    const { data, error } = await this.client
      .from("streamer_performance_snapshots")
      .select(snapshotSelect)
      .eq("streamer_id", streamerId)
      .order("period_end", { ascending: false })
      .order("computed_at", { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const row = (data?.[0] as SnapshotRow | undefined) ?? null;
    return row ? toSnapshotRecord(row) : null;
  }
}

function toStreamerLifecycleRecord(
  row: StreamerLifecycleRow,
): StreamerLifecycleRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    userId: row.user_id,
    riskLevel: row.risk_level,
    lifecycleStage: row.lifecycle_stage,
    rating: row.rating,
    contractStartDate: row.contract_start_date,
    contractEndDate: row.contract_end_date,
    revenueShareBps: row.revenue_share_bps,
    operationTier: row.operation_tier,
    operationTags: row.operation_tags ?? [],
    defaultHourlyRate: row.default_price,
  };
}

function toAssessmentRecord(row: AssessmentRow): StreamerAssessmentRecord {
  return {
    id: row.id,
    streamerId: row.streamer_id,
    projectId: row.project_id,
    liveTaskId: row.live_task_id,
    assessmentType: row.assessment_type,
    title: row.title,
    status: row.status,
    score: row.score,
    conclusion: row.conclusion,
    scheduledAt: row.scheduled_at,
    concludedAt: row.concluded_at,
  };
}

function toShiftChangeRequestRecord(
  row: ShiftChangeRequestRow,
): ShiftChangeRequestRecord {
  return {
    id: row.id,
    liveTaskId: row.live_task_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    requestType: row.request_type,
    proposedStartAt: row.proposed_start_at,
    proposedEndAt: row.proposed_end_at,
    substituteStreamerId: row.substitute_streamer_id,
    reason: row.reason,
    status: row.status,
    reviewNote: row.review_note,
  };
}

function toSnapshotRecord(row: SnapshotRow): PerformanceSnapshotRecord {
  return {
    id: row.id,
    streamerId: row.streamer_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    scheduledSessions: row.scheduled_sessions,
    liveSessions: row.live_sessions,
    completedSessions: row.completed_sessions,
    broadcastRateBps: row.broadcast_rate_bps,
    totalLiveMinutes: row.total_live_minutes,
    totalRevenueAmount: Number(row.total_revenue_amount),
    avgSessionRevenueAmount: Number(row.avg_session_revenue_amount),
    avgSessionRoiBps: row.avg_session_roi_bps,
    totalViewers: row.total_viewers,
    avgSessionViewers: row.avg_session_viewers,
    computedAt: row.computed_at,
  };
}

function toAttendanceRow(record: AttendanceRecordInput) {
  return {
    organization_id: record.organizationId,
    streamer_id: record.streamerId,
    live_task_id: record.liveTaskId,
    project_id: record.projectId,
    attendance_status: record.attendanceStatus,
    planned_start_at: record.plannedStartAt,
    planned_end_at: record.plannedEndAt,
    actual_start_at: record.actualStartAt,
    actual_stop_at: record.actualStopAt,
    late_minutes: record.lateMinutes,
    live_minutes: record.liveMinutes,
    source: record.source,
    note: record.note ?? null,
    created_by: record.createdBy ?? null,
  };
}

function firstOf<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function pickReport(
  value: MaybeArray<{
    settlement_duration: number | null;
    viewers: number | null;
    status: string;
  }>,
) {
  const reports = Array.isArray(value) ? value : value ? [value] : [];
  const usable = reports.filter((report) => report.status !== "voided");
  return (
    usable.find((report) => report.status === "approved") ?? usable[0] ?? null
  );
}
