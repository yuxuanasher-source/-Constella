import {
  assertCanManageAccounts,
  type AccountLibraryActor,
  type AccountLibraryAuditWriter,
  type PlatformAccountRecord,
} from "./account-library-service";
import type { AccountLibraryNotifier } from "./account-lifecycle-service";

export type AccountDeviceStatus = "active" | "revoked";

export type AccountDeviceRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  deviceName: string;
  deviceFingerprint: string;
  status: AccountDeviceStatus;
  note?: string | null;
  revokedAt?: string | null;
};

export type AccountLoginRiskLevel = "normal" | "suspicious";

export type AccountLoginLogRecord = {
  id: string;
  organizationId: string;
  accountId: string;
  deviceFingerprint: string;
  deviceName?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  loggedInAt: string;
  isWhitelisted: boolean;
  riskLevel: AccountLoginRiskLevel;
  note?: string | null;
};

export type CreateAccountDeviceInput = {
  deviceName: string;
  deviceFingerprint: string;
  note?: string | null;
};

export type RecordAccountLoginInput = {
  deviceFingerprint: string;
  deviceName?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  loggedInAt?: string;
  note?: string | null;
};

export type AccountSecurityRepository = {
  getById(accountId: string): Promise<PlatformAccountRecord | null>;
  createDevice(input: {
    organizationId: string;
    accountId: string;
    deviceName: string;
    deviceFingerprint: string;
    note: string | null;
    createdBy: string;
  }): Promise<AccountDeviceRecord>;
  getDeviceById(deviceId: string): Promise<AccountDeviceRecord | null>;
  updateDevice(
    deviceId: string,
    patch: Record<string, unknown>,
  ): Promise<AccountDeviceRecord>;
  hasActiveDevice(
    accountId: string,
    deviceFingerprint: string,
  ): Promise<boolean>;
  createLoginLog(input: {
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
  }): Promise<AccountLoginLogRecord>;
};

export async function addAccountDevice({
  repo,
  audit,
  actor,
  accountId,
  input,
}: {
  repo: AccountSecurityRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  accountId: string;
  input: CreateAccountDeviceInput;
}): Promise<AccountDeviceRecord> {
  assertCanManageAccounts(actor.role);

  const account = await repo.getById(accountId);
  if (!account) {
    throw new Error("Platform account not found");
  }

  const deviceName = input.deviceName.trim();
  if (!deviceName) {
    throw new Error("deviceName is required");
  }
  const deviceFingerprint = input.deviceFingerprint.trim();
  if (!deviceFingerprint) {
    throw new Error("deviceFingerprint is required");
  }

  const device = await repo.createDevice({
    organizationId: actor.organizationId,
    accountId,
    deviceName,
    deviceFingerprint,
    note: input.note?.trim() || null,
    createdBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "account_library",
    objectType: "platform_account_device",
    objectId: device.id,
    objectName: `${account.platform}:${account.accountUid}/${deviceName}`,
    after: device as unknown as Record<string, unknown>,
    changedFields: ["device_name", "device_fingerprint", "status"],
  });

  return device;
}

export async function revokeAccountDevice({
  repo,
  audit,
  actor,
  accountId,
  deviceId,
  reason,
  now = new Date().toISOString(),
}: {
  repo: AccountSecurityRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  accountId: string;
  deviceId: string;
  reason?: string;
  now?: string;
}): Promise<AccountDeviceRecord> {
  assertCanManageAccounts(actor.role);

  const before = await repo.getDeviceById(deviceId);
  if (!before || before.accountId !== accountId) {
    throw new Error("Account device not found");
  }
  if (before.status === "revoked") {
    throw new Error("Device is already revoked");
  }

  const device = await repo.updateDevice(deviceId, {
    status: "revoked",
    revoked_by: actor.userId,
    revoked_at: now,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "account_library",
    objectType: "platform_account_device",
    objectId: device.id,
    objectName: device.deviceName,
    before: before as unknown as Record<string, unknown>,
    after: device as unknown as Record<string, unknown>,
    changedFields: ["status"],
    reason: reason?.trim(),
  });

  return device;
}

// 登录事件入库：非白名单设备判定为可疑，推送高风险告警给运营负责人
export async function recordAccountLogin({
  repo,
  audit,
  notify,
  actor,
  accountId,
  input,
}: {
  repo: AccountSecurityRepository;
  audit: AccountLibraryAuditWriter;
  notify: AccountLibraryNotifier;
  actor: AccountLibraryActor;
  accountId: string;
  input: RecordAccountLoginInput;
}): Promise<AccountLoginLogRecord> {
  assertCanManageAccounts(actor.role);

  const account = await repo.getById(accountId);
  if (!account) {
    throw new Error("Platform account not found");
  }

  const deviceFingerprint = input.deviceFingerprint.trim();
  if (!deviceFingerprint) {
    throw new Error("deviceFingerprint is required");
  }

  const isWhitelisted = await repo.hasActiveDevice(
    accountId,
    deviceFingerprint,
  );
  const riskLevel: AccountLoginRiskLevel = isWhitelisted
    ? "normal"
    : "suspicious";

  const log = await repo.createLoginLog({
    organizationId: actor.organizationId,
    accountId,
    deviceFingerprint,
    deviceName: input.deviceName?.trim() || null,
    ipAddress: input.ipAddress?.trim() || null,
    location: input.location?.trim() || null,
    loggedInAt: input.loggedInAt ?? new Date().toISOString(),
    isWhitelisted,
    riskLevel,
    note: input.note?.trim() || null,
    createdBy: actor.userId,
  });

  if (riskLevel === "suspicious") {
    const deviceLabel = log.deviceName || deviceFingerprint;
    await notify({
      organizationId: actor.organizationId,
      recipientRole: "ops_manager",
      type: "high_risk",
      title: "账号异常登录告警",
      content: `${account.platform}:${account.accountUid} 检测到非白名单设备登录（${deviceLabel}），请立即核实。`,
      objectType: "platform_account_login_log",
      objectId: log.id,
      source: `account_login_alert:${log.id}`,
      isHighRisk: true,
    });

    await audit({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: actor.role,
      action: "login",
      module: "account_library",
      objectType: "platform_account_login_log",
      objectId: log.id,
      objectName: `${account.platform}:${account.accountUid}`,
      after: log as unknown as Record<string, unknown>,
      changedFields: ["risk_level"],
      isHighRisk: true,
      reason: "非白名单设备登录",
    });
  }

  return log;
}
