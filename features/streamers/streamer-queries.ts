import type { SupabaseClient } from "@supabase/supabase-js";

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
  risk_level: string;
  clean_report_count: number;
  created_at: string;
  streamer_accounts?: StreamerAccountMetricRow[];
  recording_submissions?: StreamerRecordingMetricRow[];
  live_tasks?: StreamerTaskMetricRow[];
  live_reports?: StreamerReportMetricRow[];
  project_streamers?: StreamerProjectMetricRow[];
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

export type StreamerTaskMetricRow = {
  status: string;
  planned_duration: number | null;
  system_duration: number | null;
  planned_start_at: string | null;
  project_id: string | null;
};

export type StreamerReportMetricRow = {
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
): Promise<StreamerListRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("streamers")
    .select(
      "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, default_settlement_method, risk_level, clean_report_count, created_at, recording_submissions(status, submitted_at), live_tasks(status, planned_duration, system_duration, planned_start_at, project_id), live_reports(status, settlement_duration, evidence_level, viewers, created_at, project_id, projects(default_hourly_rate)), project_streamers(status, project_id, projects(id, code, name, status, default_hourly_rate))",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
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
      "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, skills, availability, equipment, default_settlement_method, default_price, default_base_salary, risk_level, clean_report_count, created_at, streamer_accounts(id, platform, account_handle, follower_count, is_primary, verified_at), recording_submissions(status, submitted_at), live_reports(status, settlement_duration, evidence_level, viewers, created_at, project_id, projects(default_hourly_rate)), project_streamers(status, project_id, projects(id, code, name, status, default_hourly_rate))",
    )
    .eq("id", streamerId)
    .maybeSingle<StreamerListRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}
