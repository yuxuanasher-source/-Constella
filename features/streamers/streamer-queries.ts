import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveListRange, type ListPagination } from "@/lib/http/pagination";

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
  default_settlement_method: string;
  risk_level: string;
  clean_report_count: number;
  created_at: string;
};

export async function listStreamerPool(
  supabase: SupabaseClient | null,
  pagination?: ListPagination,
): Promise<StreamerListRow[]> {
  if (!supabase) {
    return [];
  }

  const { from, to } = resolveListRange(pagination);
  const { data, error } = await supabase
    .from("streamers")
    .select(
      "id, display_name, real_name, gender, source_type, cooperation_status, categories, platforms, styles, default_settlement_method, risk_level, clean_report_count, created_at",
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }

  return data ?? [];
}
