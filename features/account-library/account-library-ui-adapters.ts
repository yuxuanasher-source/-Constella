import type { AppRole } from "@/lib/rbac/roles";

import type {
  AccountBanRecordRow,
  AccountDeviceRow,
  AccountLoginLogRow,
  AccountMetricsRow,
  AccountStatusLogRow,
  PlatformAccountListRow,
} from "./account-library-queries";
import type { AccountStatusLogSource } from "./account-lifecycle-service";
import type {
  PlatformAccountStatus,
  PlatformAccountType,
} from "./account-library-service";
import type {
  AccountDeviceStatus,
  AccountLoginRiskLevel,
} from "./account-security-service";

export type PlatformAccountDto = {
  id: string;
  platform: string;
  accountSource: string | null;
  accountUid: string;
  xingtuId: string | null;
  cooperationCode: string | null;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
  realNameHolder: string | null;
  realNamePhone: string | null;
  realNamePhoneMasked: boolean;
  securityPhone: string | null;
  securityEmail: string | null;
  securityInfoMasked: boolean;
  followerCount: number;
  projectId: string | null;
  operatorId: string | null;
  boundStreamerId: string | null;
  note: string | null;
  lastLiveAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

// 仅 owner/ops_manager 可见实名手机号与密保信息明文，其余角色一律掩码。
function canViewSensitiveInfo(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) {
    return phone;
  }
  if (phone.length <= 4) {
    return "****";
  }
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) {
    return email;
  }
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "****";
  }
  return `${email.slice(0, 1)}***${email.slice(atIndex)}`;
}

export function toPlatformAccountDto(
  row: PlatformAccountListRow,
  role: AppRole,
): PlatformAccountDto {
  const showSensitive = canViewSensitiveInfo(role);
  return {
    id: row.id,
    platform: row.platform,
    accountSource: row.account_source,
    accountUid: row.account_uid,
    xingtuId: row.xingtu_id,
    cooperationCode: row.cooperation_code,
    accountType: row.account_type,
    status: row.status,
    realNameHolder: row.real_name_holder,
    realNamePhone: showSensitive
      ? row.real_name_phone
      : maskPhone(row.real_name_phone),
    realNamePhoneMasked: !showSensitive,
    securityPhone: showSensitive
      ? row.security_phone
      : maskPhone(row.security_phone),
    securityEmail: showSensitive
      ? row.security_email
      : maskEmail(row.security_email),
    securityInfoMasked: !showSensitive,
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

export function toPlatformAccountDtos(
  rows: PlatformAccountListRow[],
  role: AppRole,
): PlatformAccountDto[] {
  return rows.map((row) => toPlatformAccountDto(row, role));
}

export type AccountStatusLogDto = {
  id: string;
  fromStatus: PlatformAccountStatus;
  toStatus: PlatformAccountStatus;
  reason: string | null;
  source: AccountStatusLogSource;
  changedAt: string;
};

export function toAccountStatusLogDtos(
  rows: AccountStatusLogRow[],
): AccountStatusLogDto[] {
  return rows.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    source: row.source,
    changedAt: row.changed_at,
  }));
}

export type AccountDeviceDto = {
  id: string;
  deviceName: string;
  deviceFingerprint: string;
  status: AccountDeviceStatus;
  note: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function toAccountDeviceDtos(
  rows: AccountDeviceRow[],
): AccountDeviceDto[] {
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    deviceFingerprint: row.device_fingerprint,
    status: row.status,
    note: row.note,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }));
}

export type AccountLoginLogDto = {
  id: string;
  deviceFingerprint: string;
  deviceName: string | null;
  ipAddress: string | null;
  location: string | null;
  loggedInAt: string;
  isWhitelisted: boolean;
  riskLevel: AccountLoginRiskLevel;
  note: string | null;
};

export function toAccountLoginLogDtos(
  rows: AccountLoginLogRow[],
): AccountLoginLogDto[] {
  return rows.map((row) => ({
    id: row.id,
    deviceFingerprint: row.device_fingerprint,
    deviceName: row.device_name,
    ipAddress: row.ip_address,
    location: row.location,
    loggedInAt: row.logged_in_at,
    isWhitelisted: row.is_whitelisted,
    riskLevel: row.risk_level,
    note: row.note,
  }));
}

export type AccountBanRecordDto = {
  id: string;
  reason: string;
  source: string | null;
  bannedAt: string;
  liftedAt: string | null;
  liftedReason: string | null;
};

export function toAccountBanRecordDtos(
  rows: AccountBanRecordRow[],
): AccountBanRecordDto[] {
  return rows.map((row) => ({
    id: row.id,
    reason: row.reason,
    source: row.source,
    bannedAt: row.banned_at,
    liftedAt: row.lifted_at,
    liftedReason: row.lifted_reason,
  }));
}

export type AccountMetricsDto = {
  id: string;
  metricDate: string;
  followerCount: number;
  liveViewCount: number;
  gmvAmount: number;
  liveDurationMinutes: number;
  source: "platform_api" | "manual";
  syncedAt: string;
};

export function toAccountMetricsDtos(
  rows: AccountMetricsRow[],
): AccountMetricsDto[] {
  return rows.map((row) => ({
    id: row.id,
    metricDate: row.metric_date,
    followerCount: row.follower_count,
    liveViewCount: row.live_view_count,
    gmvAmount: row.gmv_amount,
    liveDurationMinutes: row.live_duration_minutes,
    source: row.source,
    syncedAt: row.synced_at,
  }));
}
