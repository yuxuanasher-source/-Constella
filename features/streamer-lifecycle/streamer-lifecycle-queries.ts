import type { SupabaseClient } from "@supabase/supabase-js";

// console 只读查询：主播生命周期总览与调班审批队列，全部返回 camelCase DTO。

export type StreamerLifecycleOverviewRow = {
  streamerId: string;
  displayName: string;
  lifecycleStage: string;
  rating: string;
  operationTier: string;
  operationTags: string[];
  contractStartDate: string | null;
  contractEndDate: string | null;
  revenueShareBps: number | null;
  pendingAssessments: number;
  lateCount: number;
  absentCount: number;
  broadcastRateBps: number | null;
  avgSessionMinutes: number | null;
  avgSessionRevenueAmount: number | null;
  totalRevenueAmount: number | null;
  totalSettlementAmount: number | null;
  actualHourlyRate: number | null;
  totalGmvAmount: number | null;
  roiBps: number | null;
  viewsPerHour: number | null;
  liveSessions: number | null;
  snapshotPeriodEnd: string | null;
};

export type ShiftChangeQueueItem = {
  requestId: string;
  streamerName: string;
  requestType: string;
  status: string;
  reason: string;
  proposedStartAt: string | null;
  proposedEndAt: string | null;
  substituteStreamerName: string | null;
  createdAt: string;
};

export type StreamerLifecycleEventItem = {
  eventId: string;
  streamerName: string;
  eventType: string;
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  createdAt: string;
};

export type StreamerLifecycleOverview = {
  streamers: StreamerLifecycleOverviewRow[];
  shiftChangeQueue: ShiftChangeQueueItem[];
  recentEvents: StreamerLifecycleEventItem[];
};

export async function getStreamerLifecycleOverview(
  client: SupabaseClient,
): Promise<StreamerLifecycleOverview> {
  const [streamersRes, assessmentsRes, attendanceRes, snapshotsRes] =
    await Promise.all([
      client
        .from("streamers")
        .select(
          "id, display_name, lifecycle_stage, rating, operation_tier, operation_tags, contract_start_date, contract_end_date, revenue_share_bps",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("streamer_assessments")
        .select("streamer_id, status")
        .eq("status", "pending")
        .limit(1000),
      client
        .from("streamer_attendance_records")
        .select("streamer_id, attendance_status")
        .limit(2000),
      client
        .from("streamer_performance_snapshots")
        .select(
          "streamer_id, period_end, broadcast_rate_bps, avg_session_minutes, avg_session_revenue_amount, total_revenue_amount, total_settlement_amount, actual_hourly_rate, total_gmv_amount, roi_bps, views_per_hour, live_sessions, computed_at",
        )
        .order("period_end", { ascending: false })
        .order("computed_at", { ascending: false })
        .limit(1000),
    ]);

  for (const res of [
    streamersRes,
    assessmentsRes,
    attendanceRes,
    snapshotsRes,
  ]) {
    if (res.error) {
      throw res.error;
    }
  }

  const pendingByStreamer = new Map<string, number>();
  for (const row of assessmentsRes.data ?? []) {
    const key = row.streamer_id as string;
    pendingByStreamer.set(key, (pendingByStreamer.get(key) ?? 0) + 1);
  }

  const lateByStreamer = new Map<string, number>();
  const absentByStreamer = new Map<string, number>();
  for (const row of attendanceRes.data ?? []) {
    const key = row.streamer_id as string;
    if (row.attendance_status === "late") {
      lateByStreamer.set(key, (lateByStreamer.get(key) ?? 0) + 1);
    } else if (row.attendance_status === "absent") {
      absentByStreamer.set(key, (absentByStreamer.get(key) ?? 0) + 1);
    }
  }

  const latestSnapshotByStreamer = new Map<
    string,
    {
      periodEnd: string;
      broadcastRateBps: number;
      avgSessionMinutes: number;
      avgSessionRevenueAmount: number;
      totalRevenueAmount: number;
      totalSettlementAmount: number | null;
      actualHourlyRate: number | null;
      totalGmvAmount: number | null;
      roiBps: number | null;
      viewsPerHour: number | null;
      liveSessions: number;
    }
  >();
  for (const row of snapshotsRes.data ?? []) {
    const key = row.streamer_id as string;
    if (!latestSnapshotByStreamer.has(key)) {
      latestSnapshotByStreamer.set(key, {
        periodEnd: row.period_end as string,
        broadcastRateBps: row.broadcast_rate_bps as number,
        avgSessionMinutes: Number(row.avg_session_minutes ?? 0),
        avgSessionRevenueAmount: Number(row.avg_session_revenue_amount ?? 0),
        totalRevenueAmount: Number(row.total_revenue_amount ?? 0),
        totalSettlementAmount: nullableNumber(row.total_settlement_amount),
        actualHourlyRate: nullableNumber(row.actual_hourly_rate),
        totalGmvAmount: nullableNumber(row.total_gmv_amount),
        roiBps: nullableNumber(row.roi_bps),
        viewsPerHour: nullableNumber(row.views_per_hour),
        liveSessions: row.live_sessions as number,
      });
    }
  }

  const streamers: StreamerLifecycleOverviewRow[] = (
    streamersRes.data ?? []
  ).map((row) => {
    const snapshot = latestSnapshotByStreamer.get(row.id as string) ?? null;
    return {
      streamerId: row.id as string,
      displayName: row.display_name as string,
      lifecycleStage: (row.lifecycle_stage as string) ?? "recruited",
      rating: (row.rating as string) ?? "unrated",
      operationTier: (row.operation_tier as string) ?? "unassigned",
      operationTags: (row.operation_tags as string[] | null) ?? [],
      contractStartDate: (row.contract_start_date as string | null) ?? null,
      contractEndDate: (row.contract_end_date as string | null) ?? null,
      revenueShareBps: (row.revenue_share_bps as number | null) ?? null,
      pendingAssessments: pendingByStreamer.get(row.id as string) ?? 0,
      lateCount: lateByStreamer.get(row.id as string) ?? 0,
      absentCount: absentByStreamer.get(row.id as string) ?? 0,
      broadcastRateBps: snapshot?.broadcastRateBps ?? null,
      avgSessionMinutes: snapshot?.avgSessionMinutes ?? null,
      avgSessionRevenueAmount: snapshot?.avgSessionRevenueAmount ?? null,
      totalRevenueAmount: snapshot?.totalRevenueAmount ?? null,
      totalSettlementAmount: snapshot?.totalSettlementAmount ?? null,
      actualHourlyRate: snapshot?.actualHourlyRate ?? null,
      totalGmvAmount: snapshot?.totalGmvAmount ?? null,
      roiBps: snapshot?.roiBps ?? null,
      viewsPerHour: snapshot?.viewsPerHour ?? null,
      liveSessions: snapshot?.liveSessions ?? null,
      snapshotPeriodEnd: snapshot?.periodEnd ?? null,
    };
  });

  const [queueRes, eventsRes] = await Promise.all([
    client
      .from("shift_change_requests")
      .select(
        "id, request_type, status, reason, proposed_start_at, proposed_end_at, created_at, streamers!shift_change_requests_streamer_id_fkey(display_name), substitute:streamers!shift_change_requests_substitute_streamer_id_fkey(display_name)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100),
    client
      .from("streamer_lifecycle_events")
      .select(
        "id, event_type, from_value, to_value, reason, created_at, streamers(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (queueRes.error) {
    throw queueRes.error;
  }
  if (eventsRes.error) {
    throw eventsRes.error;
  }

  const shiftChangeQueue: ShiftChangeQueueItem[] = (queueRes.data ?? []).map(
    (row) => ({
      requestId: row.id as string,
      streamerName: firstName(row.streamers) ?? "未知主播",
      requestType: row.request_type as string,
      status: row.status as string,
      reason: (row.reason as string) ?? "",
      proposedStartAt: (row.proposed_start_at as string | null) ?? null,
      proposedEndAt: (row.proposed_end_at as string | null) ?? null,
      substituteStreamerName: firstName(row.substitute),
      createdAt: row.created_at as string,
    }),
  );

  const recentEvents: StreamerLifecycleEventItem[] = (eventsRes.data ?? []).map(
    (row) => ({
      eventId: row.id as string,
      streamerName: firstName(row.streamers) ?? "未知主播",
      eventType: row.event_type as string,
      fromValue: (row.from_value as string | null) ?? null,
      toValue: (row.to_value as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      createdAt: row.created_at as string,
    }),
  );

  return { streamers, shiftChangeQueue, recentEvents };
}

function firstName(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const row = Array.isArray(value) ? value[0] : value;
  const name = (row as { display_name?: unknown } | null)?.display_name;
  return typeof name === "string" && name ? name : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
