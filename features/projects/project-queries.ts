import type { SupabaseClient } from "@supabase/supabase-js";

export type ProjectListItem = {
  id: string;
  code: string;
  name: string;
  status: string;
  sensitivity: string;
  starts_at: string | null;
  ends_at: string | null;
  open_signup: boolean;
  allow_direct_invite: boolean;
  force_recording: boolean;
  force_system_timing: boolean;
  default_hourly_rate: number;
  default_settlement_method?: string | null;
  vendor_name?: string | null;
  product_name?: string | null;
  agent_name?: string | null;
  supplier_name?: string | null;
  description?: string | null;
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
      "id, code, name, status, sensitivity, starts_at, ends_at, open_signup, allow_direct_invite, force_recording, force_system_timing, default_hourly_rate, default_settlement_method, vendor_name, product_name, agent_name, supplier_name, description, published_at, created_at",
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
