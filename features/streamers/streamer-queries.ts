import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aggregateStreamerAdmissionStats,
  type StreamerAdmissionApplicationRow,
  type StreamerAdmissionStats,
} from "./streamer-admission-stats";

export type StreamerListRow = {
  id: string;
  display_name: string;
  real_name: string | null;
  gender: string | null;
  source_type: string;
  cooperation_status: string;
  categories: string[];
  platforms: string[];
  styles: string[];
  skills?: string[];
  availability?: Record<string, unknown> | unknown[] | null;
  equipment?: Record<string, unknown> | unknown[] | null;
  default_settlement_method: string;
  default_price?: number | null;
  default_base_salary?: number | null;
  default_cps_rate_bps?: number | null;
  rating?: string | null;
  risk_level: string;
  clean_report_count: number;
  created_at: string;
  streamer_accounts?: StreamerAccountMetricRow[];
  recording_submissions?: StreamerRecordingMetricRow[];
  streamer_profile_insights?: StreamerProfileInsightMetricRow[];
  project_applications?: StreamerAdmissionApplicationRow[];
  admission_stats?: StreamerAdmissionStats;
  streamer_capability_reports?: StreamerCapabilityReportRow[];
  live_tasks?: StreamerTaskMetricRow[];
  live_reports?: StreamerReportMetricRow[];
  project_streamers?: StreamerProjectMetricRow[];
};

export type StreamerCapabilityReportRow = {
  id: string;
  organization_id: string;
  streamer_id: string;
  asset_id: string;
  dimensions: unknown;
  overall_score: number;
  grade: string;
  growth_advice: unknown;
  history_stats: unknown;
  calibration_version: number;
  created_at: string;
};

export type StreamerAccountMetricRow = {
  id: string;
  platform: string;
  account_handle: string;
  follower_count: number | null;
  is_primary: boolean;
  verified_at: string | null;
};

export type StreamerRecordingMetricRow = {
  status: string;
  submitted_at: string | null;
};

export type StreamerProfileInsightMetricRow = {
  id: string;
  title: string;
  summary: string;
  strengths?: string[] | null;
  risks?: string[] | null;
  recommendations?: string[] | null;
  tags?: string[] | null;
  source_ref: string;
  confirmed_at: string | null;
};

export type StreamerTaskMetricRow = {
  status: string;
  planned_duration: number | null;
  system_duration: number | null;
  planned_start_at: string | null;
  project_id: string | null;
};

export type StreamerReportMetricRow = {
  id?: string;
  live_task_id?: string | null;
  status: string;
  settlement_duration: number | null;
  evidence_level: string | null;
  viewers: number | null;
  created_at: string | null;
  project_id: string | null;
  projects?:
    | { default_hourly_rate: number | null }
    | { default_hourly_rate: number | null }[]
    | null;
  settlement_batch_items?: Array<{
    id: string;
    streamer_id: string | null;
    live_report_id: string | null;
    computed_amount: number | string;
    manual_amount: number | string;
    adjustment_amount: number | string;
    settlement_batches?:
      | { organization_id?: string | null; batch_type: string; status: string }
      | {
          organization_id?: string | null;
          batch_type: string;
          status: string;
        }[]
      | null;
  }>;
  settlement_batch_item_reports?: Array<{
    settlement_batch_item_id: string;
    settlement_batch_items?:
      | NonNullable<StreamerReportMetricRow["settlement_batch_items"]>[number]
      | NonNullable<
          StreamerReportMetricRow["settlement_batch_items"]
        >[number][]
      | null;
  }>;
  streamer_metrics?: Array<{
    source_report_id: string | null;
    metric_key: string;
    metric_value: number;
  }>;
};

export type StreamerProjectMetricRow = {
  status: string;
  project_id: string | null;
  projects?:
    | {
        id: string;
        code: string;
        name: string;
        status: string;
        default_hourly_rate: number | null;
      }
    | {
        id: string;
        code: string;
        name: string;
        status: string;
        default_hourly_rate: number | null;
      }[]
    | null;
};

export async function listStreamerPool(
  supabase: SupabaseClient | null,
  organizationId: string,
): Promise<StreamerListRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("streamers")
    .select(
      "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, default_settlement_method, default_price, default_base_salary, default_cps_rate_bps, rating, risk_level, clean_report_count, created_at, streamer_capability_reports(id, organization_id, streamer_id, asset_id, dimensions, overall_score, grade, growth_advice, history_stats, calibration_version, created_at), recording_submissions(status, submitted_at), streamer_profile_insights(id, title, summary, strengths, risks, recommendations, tags, source_ref, confirmed_at), project_applications(organization_id, project_recording_vendor_reviews(id, organization_id, decision, submitted_at), admission_review_evaluations(id, vendor_review_id, submission_id, organization_id, stage, decision, created_at, admission_review_checkpoint_results(organization_id, checkpoint_key, verdict))), live_tasks(status, planned_duration, system_duration, planned_start_at, project_id), live_reports(id, live_task_id, status, settlement_duration, evidence_level, viewers, created_at, project_id, settlement_batch_items!settlement_batch_items_live_report_id_fkey(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status)), settlement_batch_item_reports(settlement_batch_item_id, settlement_batch_items(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status))), streamer_metrics(source_report_id, metric_key, metric_value), projects(default_hourly_rate)), project_streamers(status, project_id, projects(id, code, name, status, default_hourly_rate))",
    )
    // 组织过滤放在查询层（RLS 仍作为第二道防线）。
    .eq("organization_id", organizationId)
    .eq("streamer_capability_reports.organization_id", organizationId)
    .eq("live_reports.settlement_batch_items.organization_id", organizationId)
    .eq(
      "live_reports.settlement_batch_items.settlement_batches.organization_id",
      organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.organization_id",
      organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.settlement_batch_items.organization_id",
      organizationId,
    )
    .eq(
      "live_reports.settlement_batch_item_reports.settlement_batch_items.settlement_batches.organization_id",
      organizationId,
    )
    .eq("live_reports.streamer_metrics.organization_id", organizationId)
    .eq("project_applications.organization_id", organizationId)
    .eq(
      "project_applications.project_recording_vendor_reviews.organization_id",
      organizationId,
    )
    .in("project_applications.project_recording_vendor_reviews.decision", [
      "selected",
      "backup",
      "rejected",
      "needs_changes",
    ])
    .eq(
      "project_applications.admission_review_evaluations.organization_id",
      organizationId,
    )
    .in("project_applications.admission_review_evaluations.stage", [
      "vendor_second",
      "mcn_first",
    ])
    .eq(
      "project_applications.admission_review_evaluations.admission_review_checkpoint_results.organization_id",
      organizationId,
    )
    .eq(
      "project_applications.admission_review_evaluations.admission_review_checkpoint_results.verdict",
      "fail",
    )
    // 嵌套关联收敛：DTO 的指标窗口是「近 90 天」，按 created_at 倒序取
    // 最近 N 行足以覆盖常规体量；project_streamers 行数天然有限，保留。
    .order("created_at", {
      referencedTable: "recording_submissions",
      ascending: false,
    })
    .limit(50, { referencedTable: "recording_submissions" })
    .order("created_at", {
      referencedTable: "streamer_profile_insights",
      ascending: false,
    })
    .limit(20, { referencedTable: "streamer_profile_insights" })
    .order("created_at", {
      referencedTable: "streamer_capability_reports",
      ascending: false,
    })
    .order("id", {
      referencedTable: "streamer_capability_reports",
      ascending: false,
    })
    .limit(1, { referencedTable: "streamer_capability_reports" })
    .order("created_at", { referencedTable: "live_tasks", ascending: false })
    .limit(200, { referencedTable: "live_tasks" })
    .order("created_at", { referencedTable: "live_reports", ascending: false })
    .limit(200, { referencedTable: "live_reports" })
    .order("created_at", { ascending: false })
    // 防线：主播池列表限最新 200 条，避免数据增长后单次请求拖全表。
    .limit(200);

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown as StreamerListRow[]).map((row) => ({
    ...row,
    admission_stats: aggregateStreamerAdmissionStats({
      applications: row.project_applications,
      organizationId,
    }),
  }));
}

export async function getStreamerProfileRow(
  supabase: SupabaseClient | null,
  streamerId: string,
): Promise<StreamerListRow | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("streamers")
    .select(
      "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, skills, availability, equipment, default_settlement_method, default_price, default_base_salary, default_cps_rate_bps, rating, risk_level, clean_report_count, created_at, streamer_accounts(id, platform, account_handle, follower_count, is_primary, verified_at), recording_submissions(status, submitted_at), streamer_profile_insights(id, title, summary, strengths, risks, recommendations, tags, source_ref, confirmed_at), live_reports(id, live_task_id, status, settlement_duration, evidence_level, viewers, created_at, project_id, settlement_batch_items!settlement_batch_items_live_report_id_fkey(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status)), settlement_batch_item_reports(settlement_batch_item_id, settlement_batch_items(id, streamer_id, live_report_id, computed_amount, manual_amount, adjustment_amount, settlement_batches(organization_id, batch_type, status))), streamer_metrics(source_report_id, metric_key, metric_value), projects(default_hourly_rate)), project_streamers(status, project_id, projects(id, code, name, status, default_hourly_rate))",
    )
    .eq("id", streamerId)
    .maybeSingle<StreamerListRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}
