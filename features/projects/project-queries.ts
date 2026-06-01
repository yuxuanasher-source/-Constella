import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
  status: string;
  sensitivity: string;
  force_system_timing: boolean;
  default_hourly_rate: number;
  published_at: string | null;
  created_at: string;
};

export async function listProjects(
  supabase: SupabaseClient | null,
): Promise<ProjectListItem[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, sensitivity, force_system_timing, default_hourly_rate, published_at, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function unreadNotificationCount(
  supabase: SupabaseClient | null,
): Promise<number> {
  if (!supabase) {
    return 0;
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread");

  if (error) {
    throw error;
  }

  return count ?? 0;
}
