import type { NotificationInput } from "@/lib/notify/notify";

import {
  assertCanManageAccounts,
  type AccountLibraryActor,
  type AccountLibraryAuditWriter,
  type PlatformAccountRecord,
  type PlatformAccountStatus,
} from "./account-library-service";

// 生命周期：养号(nurturing) -> 启用(active) -> 停播/闲置(idle)
//          -> 封禁(frozen) -> 注销(retired)，retired 为终态。
export const ACCOUNT_STATUS_TRANSITIONS: Record<
  PlatformAccountStatus,
  PlatformAccountStatus[]
> = {
  nurturing: ["active", "frozen", "retired"],
  active: ["idle", "frozen", "retired"],
  idle: ["nurturing", "active", "frozen", "retired"],
  frozen: ["active", "retired"],
  retired: [],
};

export type AccountStatusLogSource = "manual" | "auto_idle" | "metrics_sync";

export type AccountStatusLogInput = {
  organizationId: string;
  accountId: string;
  fromStatus: PlatformAccountStatus;
  toStatus: PlatformAccountStatus;
  reason?: string | null;
  source: AccountStatusLogSource;
  changedBy?: string | null;
};

export type AccountBanRecordInput = {
  organizationId: string;
  accountId: string;
  reason: string;
  source?: string | null;
  createdBy?: string | null;
};

export type LiftBanRecordsInput = {
  liftedBy?: string | null;
  liftedReason?: string | null;
  liftedAt: string;
};

export type AccountLifecycleRepository = {
  getById(accountId: string): Promise<PlatformAccountRecord | null>;
  updateAccount(
    accountId: string,
    patch: Record<string, unknown>,
  ): Promise<PlatformAccountRecord>;
  createStatusLog(input: AccountStatusLogInput): Promise<void>;
  createBanRecord(input: AccountBanRecordInput): Promise<void>;
  liftOpenBanRecords(
    accountId: string,
    input: LiftBanRecordsInput,
  ): Promise<void>;
  listAutoIdleCandidates(input: {
    organizationId: string;
    cutoffIso: string;
  }): Promise<PlatformAccountRecord[]>;
};

export type AccountLibraryNotifier = (
  input: NotificationInput,
) => Promise<void>;

const HIGH_RISK_TARGET_STATUSES: PlatformAccountStatus[] = [
  "frozen",
  "retired",
];

export function canTransitionAccountStatus(
  fromStatus: PlatformAccountStatus,
  toStatus: PlatformAccountStatus,
): boolean {
  return ACCOUNT_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export async function transitionPlatformAccountStatus({
  repo,
  audit,
  actor,
  accountId,
  toStatus,
  reason,
  banSource,
  now = new Date().toISOString(),
}: {
  repo: AccountLifecycleRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  accountId: string;
  toStatus: PlatformAccountStatus;
  reason?: string;
  banSource?: string;
  now?: string;
}): Promise<PlatformAccountRecord> {
  assertCanManageAccounts(actor.role);

  const before = await repo.getById(accountId);
  if (!before) {
    throw new Error("Platform account not found");
  }
  if (before.status === toStatus) {
    throw new Error("Account is already in this status");
  }
  if (!canTransitionAccountStatus(before.status, toStatus)) {
    throw new Error(
      `Cannot transition account from ${before.status} to ${toStatus}`,
    );
  }

  const trimmedReason = reason?.trim();
  const isHighRisk = HIGH_RISK_TARGET_STATUSES.includes(toStatus);
  if (isHighRisk && !trimmedReason) {
    throw new Error("Freezing or retiring an account requires a reason");
  }

  const account = await repo.updateAccount(accountId, { status: toStatus });

  if (toStatus === "frozen") {
    await repo.createBanRecord({
      organizationId: actor.organizationId,
      accountId,
      reason: trimmedReason as string,
      source: banSource?.trim() || null,
      createdBy: actor.userId,
    });
  } else if (before.status === "frozen") {
    // 解封或封禁后注销：补齐未关闭的封禁存档
    await repo.liftOpenBanRecords(accountId, {
      liftedBy: actor.userId,
      liftedReason: trimmedReason ?? null,
      liftedAt: now,
    });
  }

  await repo.createStatusLog({
    organizationId: actor.organizationId,
    accountId,
    fromStatus: before.status,
    toStatus,
    reason: trimmedReason ?? null,
    source: "manual",
    changedBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "account_library",
    objectType: "platform_account",
    objectId: account.id,
    objectName: `${account.platform}:${account.accountUid}`,
    before: before as unknown as Record<string, unknown>,
    after: account as unknown as Record<string, unknown>,
    changedFields: ["status"],
    isHighRisk,
    reason: trimmedReason,
  });

  return account;
}

export const DEFAULT_IDLE_AFTER_DAYS = 14;

// 自动标记闲置：active 且超过 idleAfterDays 无直播（无记录则按建档时间）的账号转 idle
export async function markIdlePlatformAccounts({
  repo,
  audit,
  notify,
  actor,
  now = new Date().toISOString(),
  idleAfterDays = DEFAULT_IDLE_AFTER_DAYS,
}: {
  repo: AccountLifecycleRepository;
  audit: AccountLibraryAuditWriter;
  notify: AccountLibraryNotifier;
  actor: AccountLibraryActor;
  now?: string;
  idleAfterDays?: number;
}): Promise<{ scannedCount: number; markedCount: number }> {
  assertCanManageAccounts(actor.role);

  const cutoffIso = new Date(
    new Date(now).getTime() - idleAfterDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const candidates = await repo.listAutoIdleCandidates({
    organizationId: actor.organizationId,
    cutoffIso,
  });

  let markedCount = 0;
  for (const account of candidates) {
    await repo.updateAccount(account.id, { status: "idle" });
    await repo.createStatusLog({
      organizationId: actor.organizationId,
      accountId: account.id,
      fromStatus: account.status,
      toStatus: "idle",
      reason: `超过 ${idleAfterDays} 天无直播，自动标记闲置`,
      source: "auto_idle",
      changedBy: actor.userId,
    });
    markedCount += 1;
  }

  if (markedCount > 0) {
    await notify({
      organizationId: actor.organizationId,
      recipientRole: "ops_manager",
      type: "system",
      title: "账号库闲置扫描",
      content: `${markedCount} 个账号超过 ${idleAfterDays} 天无直播，已自动标记为闲置，可安排复用。`,
      objectType: "platform_account_idle_scan",
      source: "account_library_idle_scan",
    });
  }

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "account_library",
    objectType: "account_idle_scan",
    after: {
      scannedCount: candidates.length,
      markedCount,
      idleAfterDays,
    },
    changedFields: ["status"],
  });

  return { scannedCount: candidates.length, markedCount };
}
