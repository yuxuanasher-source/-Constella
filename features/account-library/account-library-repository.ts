import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountBanRecordInput,
  AccountLifecycleRepository,
  AccountStatusLogInput,
  LiftBanRecordsInput,
} from "./account-lifecycle-service";
import type {
  AccountLibraryRepository,
  CreatePlatformAccountRepositoryInput,
  PlatformAccountRecord,
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";
import type {
  AccountMetricsRepository,
  AccountMetricsUpsertInput,
} from "./account-metrics-service";
import type {
  AccountDeviceRecord,
  AccountDeviceStatus,
  AccountLoginLogRecord,
  AccountLoginRiskLevel,
  AccountSecurityRepository,
} from "./account-security-service";

type PlatformAccountRow = {
  id: string;
  organization_id: string;
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

const accountSelect =
  "id, organization_id, platform, account_source, account_uid, xingtu_id, cooperation_code, account_type, status, real_name_holder, real_name_phone, security_phone, security_email, follower_count, project_id, operator_id, bound_streamer_id, note, last_live_at, last_synced_at, created_at";

type AccountDeviceRow = {
  id: string;
  organization_id: string;
  account_id: string;
  device_name: string;
  device_fingerprint: string;
  status: AccountDeviceStatus;
  note: string | null;
  revoked_at: string | null;
};

const deviceSelect =
  "id, organization_id, account_id, device_name, device_fingerprint, status, note, revoked_at";

type AccountLoginLogRow = {
  id: string;
  organization_id: string;
  account_id: string;
  device_fingerprint: string;
  device_name: string | null;
  ip_address: string | null;
  location: string | null;
  logged_in_at: string;
  is_whitelisted: boolean;
  risk_level: AccountLoginRiskLevel;
  note: string | null;
};

const loginLogSelect =
  "id, organization_id, account_id, device_fingerprint, device_name, ip_address, location, logged_in_at, is_whitelisted, risk_level, note";

export class SupabaseAccountLibraryRepository
  implements
    AccountLibraryRepository,
    AccountLifecycleRepository,
    AccountSecurityRepository,
    AccountMetricsRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async createAccount(
    input: CreatePlatformAccountRepositoryInput,
  ): Promise<PlatformAccountRecord> {
    const insertPayload: Record<string, unknown> = {
      organization_id: input.organizationId,
      created_by: input.actorUserId,
      platform: input.platform,
      account_uid: input.accountUid,
      account_type: input.accountType,
      status: input.status,
      account_source: input.accountSource ?? null,
      xingtu_id: input.xingtuId ?? null,
      cooperation_code: input.cooperationCode ?? null,
      real_name_holder: input.realNameHolder ?? null,
      real_name_phone: input.realNamePhone ?? null,
      security_phone: input.securityPhone ?? null,
      security_email: input.securityEmail ?? null,
      follower_count: input.followerCount ?? 0,
      project_id: input.projectId ?? null,
      operator_id: input.operatorId ?? null,
      bound_streamer_id: input.boundStreamerId ?? null,
      note: input.note ?? null,
    };

    const { data, error } = await this.client
      .from("platform_accounts")
      .insert(insertPayload)
      .select(accountSelect)
      .single<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return toPlatformAccountRecord(data);
  }

  async getById(accountId: string): Promise<PlatformAccountRecord | null> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .select(accountSelect)
      .eq("id", accountId)
      .maybeSingle<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return data ? toPlatformAccountRecord(data) : null;
  }

  async updateAccount(
    accountId: string,
    patch: Record<string, unknown>,
  ): Promise<PlatformAccountRecord> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .update(patch)
      .eq("id", accountId)
      .select(accountSelect)
      .single<PlatformAccountRow>();

    if (error) {
      throw error;
    }

    return toPlatformAccountRecord(data);
  }

  async createStatusLog(input: AccountStatusLogInput): Promise<void> {
    const { error } = await this.client
      .from("platform_account_status_logs")
      .insert({
        organization_id: input.organizationId,
        account_id: input.accountId,
        from_status: input.fromStatus,
        to_status: input.toStatus,
        reason: input.reason ?? null,
        source: input.source,
        changed_by: input.changedBy ?? null,
      });

    if (error) {
      throw error;
    }
  }

  async createBanRecord(input: AccountBanRecordInput): Promise<void> {
    const { error } = await this.client
      .from("platform_account_ban_records")
      .insert({
        organization_id: input.organizationId,
        account_id: input.accountId,
        reason: input.reason,
        source: input.source ?? null,
        created_by: input.createdBy ?? null,
      });

    if (error) {
      throw error;
    }
  }

  async liftOpenBanRecords(
    accountId: string,
    input: LiftBanRecordsInput,
  ): Promise<void> {
    const { error } = await this.client
      .from("platform_account_ban_records")
      .update({
        lifted_at: input.liftedAt,
        lifted_by: input.liftedBy ?? null,
        lifted_reason: input.liftedReason ?? null,
      })
      .eq("account_id", accountId)
      .is("lifted_at", null);

    if (error) {
      throw error;
    }
  }

  async listAutoIdleCandidates(input: {
    organizationId: string;
    cutoffIso: string;
  }): Promise<PlatformAccountRecord[]> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .select(accountSelect)
      .eq("organization_id", input.organizationId)
      .eq("status", "active")
      .or(
        `last_live_at.lt.${input.cutoffIso},and(last_live_at.is.null,created_at.lt.${input.cutoffIso})`,
      )
      .limit(200)
      .returns<PlatformAccountRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toPlatformAccountRecord);
  }

  async createDevice(input: {
    organizationId: string;
    accountId: string;
    deviceName: string;
    deviceFingerprint: string;
    note: string | null;
    createdBy: string;
  }): Promise<AccountDeviceRecord> {
    const { data, error } = await this.client
      .from("platform_account_devices")
      .insert({
        organization_id: input.organizationId,
        account_id: input.accountId,
        device_name: input.deviceName,
        device_fingerprint: input.deviceFingerprint,
        note: input.note,
        created_by: input.createdBy,
      })
      .select(deviceSelect)
      .single<AccountDeviceRow>();

    if (error) {
      throw error;
    }

    return toAccountDeviceRecord(data);
  }

  async getDeviceById(deviceId: string): Promise<AccountDeviceRecord | null> {
    const { data, error } = await this.client
      .from("platform_account_devices")
      .select(deviceSelect)
      .eq("id", deviceId)
      .maybeSingle<AccountDeviceRow>();

    if (error) {
      throw error;
    }

    return data ? toAccountDeviceRecord(data) : null;
  }

  async updateDevice(
    deviceId: string,
    patch: Record<string, unknown>,
  ): Promise<AccountDeviceRecord> {
    const { data, error } = await this.client
      .from("platform_account_devices")
      .update(patch)
      .eq("id", deviceId)
      .select(deviceSelect)
      .single<AccountDeviceRow>();

    if (error) {
      throw error;
    }

    return toAccountDeviceRecord(data);
  }

  async hasActiveDevice(
    accountId: string,
    deviceFingerprint: string,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("platform_account_devices")
      .select("id")
      .eq("account_id", accountId)
      .eq("device_fingerprint", deviceFingerprint)
      .eq("status", "active")
      .limit(1);

    if (error) {
      throw error;
    }

    return (data ?? []).length > 0;
  }

  async createLoginLog(input: {
    organizationId: string;
    accountId: string;
    deviceFingerprint: string;
    deviceName: string | null;
    ipAddress: string | null;
    location: string | null;
    loggedInAt: string;
    isWhitelisted: boolean;
    riskLevel: AccountLoginRiskLevel;
    note: string | null;
    createdBy: string;
  }): Promise<AccountLoginLogRecord> {
    const { data, error } = await this.client
      .from("platform_account_login_logs")
      .insert({
        organization_id: input.organizationId,
        account_id: input.accountId,
        device_fingerprint: input.deviceFingerprint,
        device_name: input.deviceName,
        ip_address: input.ipAddress,
        location: input.location,
        logged_in_at: input.loggedInAt,
        is_whitelisted: input.isWhitelisted,
        risk_level: input.riskLevel,
        note: input.note,
        created_by: input.createdBy,
      })
      .select(loginLogSelect)
      .single<AccountLoginLogRow>();

    if (error) {
      throw error;
    }

    return toAccountLoginLogRecord(data);
  }

  async listSyncableAccounts(
    organizationId: string,
  ): Promise<PlatformAccountRecord[]> {
    const { data, error } = await this.client
      .from("platform_accounts")
      .select(accountSelect)
      .eq("organization_id", organizationId)
      .in("status", ["nurturing", "active", "idle"])
      .limit(500)
      .returns<PlatformAccountRow[]>();

    if (error) {
      throw error;
    }

    return (data ?? []).map(toPlatformAccountRecord);
  }

  async upsertMetrics(input: AccountMetricsUpsertInput): Promise<void> {
    const { error } = await this.client
      .from("platform_account_metrics")
      .upsert(
        {
          organization_id: input.organizationId,
          account_id: input.accountId,
          metric_date: input.metricDate,
          follower_count: input.followerCount,
          live_view_count: input.liveViewCount,
          gmv_amount: input.gmvAmount,
          live_duration_minutes: input.liveDurationMinutes,
          source: input.source,
          synced_at: input.syncedAt,
        },
        { onConflict: "account_id,metric_date" },
      );

    if (error) {
      throw error;
    }
  }
}

function toPlatformAccountRecord(
  row: PlatformAccountRow,
): PlatformAccountRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    platform: row.platform,
    accountSource: row.account_source,
    accountUid: row.account_uid,
    xingtuId: row.xingtu_id,
    cooperationCode: row.cooperation_code,
    accountType: row.account_type,
    status: row.status,
    realNameHolder: row.real_name_holder,
    realNamePhone: row.real_name_phone,
    securityPhone: row.security_phone,
    securityEmail: row.security_email,
    followerCount: row.follower_count,
    projectId: row.project_id,
    operatorId: row.operator_id,
    boundStreamerId: row.bound_streamer_id,
    note: row.note,
    lastLiveAt: row.last_live_at,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

function toAccountDeviceRecord(row: AccountDeviceRow): AccountDeviceRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accountId: row.account_id,
    deviceName: row.device_name,
    deviceFingerprint: row.device_fingerprint,
    status: row.status,
    note: row.note,
    revokedAt: row.revoked_at,
  };
}

function toAccountLoginLogRecord(
  row: AccountLoginLogRow,
): AccountLoginLogRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accountId: row.account_id,
    deviceFingerprint: row.device_fingerprint,
    deviceName: row.device_name,
    ipAddress: row.ip_address,
    location: row.location,
    loggedInAt: row.logged_in_at,
    isWhitelisted: row.is_whitelisted,
    riskLevel: row.risk_level,
    note: row.note,
  };
}
