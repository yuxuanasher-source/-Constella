import type { SupabaseClient } from "@supabase/supabase-js";

type ProjectPersonRelation =
  | { full_name: string | null }
  | { full_name: string | null }[]
  | null;

type ProjectSettlementBatchRelation =
  | { id: string; status: string | null }[]
  | null;

type ProjectLiveReportRelation =
  | {
      id: string;
      status: string | null;
      enter_settlement_pool: boolean | null;
      settled_batch_item_id: string | null;
    }[]
  | null;

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
  default_base_salary?: number | null;
  default_settlement_method?: string | null;
  default_settlement_rule?: unknown;
  is_invoiced?: boolean | null;
  output_vat_rate_bps?: number | null;
  surtax_rate_bps?: number | null;
  procurement_cost_cents?: number | null;
  vendor_name?: string | null;
  product_name?: string | null;
  agent_name?: string | null;
  supplier_name?: string | null;
  description?: string | null;
  is_public_to_streamers: boolean;
  public_summary: string;
  game_download_url: string | null;
  is_open_to_mcn_collaboration: boolean;
  mcn_collaboration_summary: string;
  mcn_collaboration_terms: Record<string, unknown>;
  created_by?: string | null;
  owner_id?: string | null;
  ops_manager_id?: string | null;
  creator?: ProjectPersonRelation;
  owner?: ProjectPersonRelation;
  opsManager?: ProjectPersonRelation;
  settlement_batches?: ProjectSettlementBatchRelation;
  live_reports?: ProjectLiveReportRelation;
  published_at: string | null;
  created_at: string;
};

export type ListProjectsOptions = {
  organizationId: string;
};

export async function listProjects(
  supabase: SupabaseClient | null,
  options: ListProjectsOptions,
): Promise<ProjectListItem[]> {
  if (!supabase) {
    return [];
  }

  const query = supabase
    .from("projects")
    .select(
      "id, code, name, status, sensitivity, starts_at, ends_at, open_signup, allow_direct_invite, force_recording, force_system_timing, default_hourly_rate, default_base_salary, default_settlement_method, default_settlement_rule, is_invoiced, output_vat_rate_bps, surtax_rate_bps, procurement_cost_cents, vendor_name, product_name, agent_name, supplier_name, description, is_public_to_streamers, public_summary, game_download_url, is_open_to_mcn_collaboration, mcn_collaboration_summary, mcn_collaboration_terms, created_by, owner_id, ops_manager_id, creator:profiles!projects_created_by_fkey(full_name), owner:profiles!projects_owner_id_fkey(full_name), opsManager:profiles!projects_ops_manager_id_fkey(full_name), settlement_batches(id, status), live_reports(id, status, enter_settlement_pool, settled_batch_item_id), published_at, created_at",
    )
    // 组织过滤放在查询层（RLS 仍作为第二道防线），避免拉全库再靠
    // RLS 过滤的额外扫描。
    .eq("organization_id", options.organizationId)
    // 嵌套关联收敛：DTO 只做「存在性」判定（hasSettlementBatch /
    // hasApprovedPoolReport），无需拉全部子行。
    // settlement_batches：任意 1 行即可判定存在。
    .limit(1, { referencedTable: "settlement_batches" })
    // live_reports：只取会命中 hasApprovedPoolReport 谓词的行
    // （approved 且未结算入批次、未显式退出结算池），每项目 1 行足够。
    .eq("live_reports.status", "approved")
    .is("live_reports.settled_batch_item_id", null)
    .or("enter_settlement_pool.is.null,enter_settlement_pool.eq.true", {
      referencedTable: "live_reports",
    })
    .limit(1, { referencedTable: "live_reports" });

  // 防线：全量列表按创建时间倒序取最新 200 条，避免数据增长后单次
  // 请求拖全表（含嵌套关联）。
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(200);

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
