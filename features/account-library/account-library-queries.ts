import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountStatusLogSource } from "./account-lifecycle-service";
import type {
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";
import type {
  AccountDeviceStatus,
  AccountLoginRiskLevel,
} from "./account-security-service";

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
  security_phone: string | null;
  security_email: string | null;
  follower_count: number;
  project_id: string | null;
  operator_id: string | null;
  bound_streamer_id: string | null;
  note: string | null;
  last_live_at: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export type AccountLibraryFilter = {
  platform?: string;
  accountType?: PlatformAccountType;
  status?: PlatformAccountStatus;
  operatorId?: string;
  boundStreamerId?: string;
  projectId?: string;
};

const accountListSelect =
  "id, platform, account_source, account_uid, xingtu_id, cooperation_code, account_type, status, real_name_holder, real_name_phone, security_phone, security_email, follower_count, project_id, operator_id, bound_streamer_id, note, last_live_at, last_synced_at, created_at";

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
  if (filter.projectId) {
    query = query.eq("project_id", filter.projectId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AccountStatusLogRow = {
  id: string;
  from_status: PlatformAccountStatus;
  to_status: PlatformAccountStatus;
  reason: string | null;
  source: AccountStatusLogSource;
  changed_by: string | null;
  changed_at: string;
};

export async function listAccountStatusLogs(
  supabase: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<AccountStatusLogRow[]> {
  const { data, error } = await supabase
    .from("platform_account_status_logs")
    .select("id, from_status, to_status, reason, source, changed_by, changed_at")
    .eq("account_id", accountId)
    .order("changed_at", { ascending: false })
    .limit(limit)
    .returns<AccountStatusLogRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AccountDeviceRow = {
  id: string;
  device_name: string;
  device_fingerprint: string;
  status: AccountDeviceStatus;
  note: string | null;
  revoked_at: string | null;
  created_at: string;
};

export async function listAccountDevices(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AccountDeviceRow[]> {
  const { data, error } = await supabase
    .from("platform_account_devices")
    .select(
      "id, device_name, device_fingerprint, status, note, revoked_at, created_at",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .returns<AccountDeviceRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AccountLoginLogRow = {
  id: string;
  device_fingerprint: string;
  device_name: string | null;
  ip_address: string | null;
  location: string | null;
  logged_in_at: string;
  is_whitelisted: boolean;
  risk_level: AccountLoginRiskLevel;
  note: string | null;
};

export async function listAccountLoginLogs(
  supabase: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<AccountLoginLogRow[]> {
  const { data, error } = await supabase
    .from("platform_account_login_logs")
    .select(
      "id, device_fingerprint, device_name, ip_address, location, logged_in_at, is_whitelisted, risk_level, note",
    )
    .eq("account_id", accountId)
    .order("logged_in_at", { ascending: false })
    .limit(limit)
    .returns<AccountLoginLogRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AccountBanRecordRow = {
  id: string;
  reason: string;
  source: string | null;
  banned_at: string;
  lifted_at: string | null;
  lifted_reason: string | null;
};

export async function listAccountBanRecords(
  supabase: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<AccountBanRecordRow[]> {
  const { data, error } = await supabase
    .from("platform_account_ban_records")
    .select("id, reason, source, banned_at, lifted_at, lifted_reason")
    .eq("account_id", accountId)
    .order("banned_at", { ascending: false })
    .limit(limit)
    .returns<AccountBanRecordRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}

export type AccountMetricsRow = {
  id: string;
  metric_date: string;
  follower_count: number;
  live_view_count: number;
  gmv_amount: number;
  live_duration_minutes: number;
  source: "platform_api" | "manual";
  synced_at: string;
};

export async function listAccountMetrics(
  supabase: SupabaseClient,
  accountId: string,
  limit = 30,
): Promise<AccountMetricsRow[]> {
  const { data, error } = await supabase
    .from("platform_account_metrics")
    .select(
      "id, metric_date, follower_count, live_view_count, gmv_amount, live_duration_minutes, source, synced_at",
    )
    .eq("account_id", accountId)
    .order("metric_date", { ascending: false })
    .limit(limit)
    .returns<AccountMetricsRow[]>();

  if (error) {
    throw error;
  }

  return data ?? [];
}
