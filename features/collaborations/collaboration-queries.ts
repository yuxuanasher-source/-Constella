import type { SupabaseClient } from "@supabase/supabase-js";

export type CollaborationListRow = {
  id: string;
  host_organization_id: string;
  project_id: string;
  partner_organization_id: string | null;
  invite_code: string | null;
  status: string;
  settlement_mode: string;
  share_percentage: number | null;
  hourly_fixed_amount: number | null;
  created_at: string;
};

export type CollaborationSubmissionListRow = {
  id: string;
  collaboration_id: string;
  project_id: string;
  partner_organization_id: string;
  streamer_name: string;
  live_account: string | null;
  recording_url: string | null;
  note: string | null;
  status: string;
  review_note: string | null;
  linked_streamer_id: string | null;
  created_at: string;
};

const collaborationListSelect =
  "id, host_organization_id, project_id, partner_organization_id, invite_code, status, settlement_mode, share_percentage, hourly_fixed_amount, created_at";

const submissionListSelect =
  "id, collaboration_id, project_id, partner_organization_id, streamer_name, live_account, recording_url, note, status, review_note, linked_streamer_id, created_at";

// RLS 自动按甲方/乙方身份过滤可见行
export async function listProjectCollaborations(
  supabase: SupabaseClient | null,
  projectId: string,
): Promise<CollaborationListRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_collaborations")
    .select(collaborationListSelect)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listMyCollaborations(
  supabase: SupabaseClient | null,
): Promise<CollaborationListRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_collaborations")
    .select(collaborationListSelect)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listProjectCollaborationSubmissions(
  supabase: SupabaseClient | null,
  projectId: string,
  status?: string,
): Promise<CollaborationSubmissionListRow[]> {
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("collaboration_submissions")
    .select(submissionListSelect)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listCollaborationSubmissions(
  supabase: SupabaseClient | null,
  collaborationId: string,
): Promise<CollaborationSubmissionListRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("collaboration_submissions")
    .select(submissionListSelect)
    .eq("collaboration_id", collaborationId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}
