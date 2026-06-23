import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";

export type PlatformAccountListRow = {
  id: string;
  platform: string;
  account_source: string | null;
  account_uid: string;
  xingtu_id: string | null;
  cooperation_code: string | null;
  account_type: PlatformAccountType;
  status: PlatformAccountStatus;
  real_name_holder: string | null;
  real_name_phone: string | null;
  operator_id: string | null;
  bound_streamer_id: string | null;
  note: string | null;
  created_at: string;
};

export type AccountLibraryFilter = {
  platform?: string;
  accountType?: PlatformAccountType;
  status?: PlatformAccountStatus;
  operatorId?: string;
  boundStreamerId?: string;
};

const accountListSelect =
  "id, platform, account_source, account_uid, xingtu_id, cooperation_code, account_type, status, real_name_holder, real_name_phone, operator_id, bound_streamer_id, note, created_at";

export async function listPlatformAccounts(
  supabase: SupabaseClient | null,
  filter: AccountLibraryFilter = {},
): Promise<PlatformAccountListRow[]> {
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("platform_accounts")
    .select(accountListSelect)
    .order("created_at", { ascending: false });

  if (filter.platform) {
    query = query.eq("platform", filter.platform);
  }
  if (filter.accountType) {
    query = query.eq("account_type", filter.accountType);
  }
  if (filter.status) {
    query = query.eq("status", filter.status);
  }
  if (filter.operatorId) {
    query = query.eq("operator_id", filter.operatorId);
  }
  if (filter.boundStreamerId) {
    query = query.eq("bound_streamer_id", filter.boundStreamerId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}
