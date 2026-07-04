import type { AuditLogInput } from "@/lib/audit/audit";
import { type AppRole } from "@/lib/rbac/roles";

export const PLATFORM_ACCOUNT_TYPES = [
  "self_incubated",
  "partner",
  "streamer_owned",
] as const;
export type PlatformAccountType = (typeof PLATFORM_ACCOUNT_TYPES)[number];

export const PLATFORM_ACCOUNT_STATUSES = [
  "nurturing",
  "active",
  "idle",
  "frozen",
  "retired",
] as const;
export type PlatformAccountStatus = (typeof PLATFORM_ACCOUNT_STATUSES)[number];

export type PlatformAccountRecord = {
  id: string;
  organizationId: string;
  platform: string;
  accountSource?: string | null;
  accountUid: string;
  xingtuId?: string | null;
  cooperationCode?: string | null;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
  realNameHolder?: string | null;
  realNamePhone?: string | null;
  securityPhone?: string | null;
  securityEmail?: string | null;
  followerCount?: number;
  projectId?: string | null;
  operatorId?: string | null;
  boundStreamerId?: string | null;
  note?: string | null;
  lastLiveAt?: string | null;
  lastSyncedAt?: string | null;
  createdAt?: string;
};

export type AccountLibraryActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CreatePlatformAccountInput = {
  platform: string;
  accountUid: string;
  accountSource?: string | null;
  xingtuId?: string | null;
  cooperationCode?: string | null;
  accountType?: PlatformAccountType;
  status?: PlatformAccountStatus;
  realNameHolder?: string | null;
  realNamePhone?: string | null;
  securityPhone?: string | null;
  securityEmail?: string | null;
  followerCount?: number;
  projectId?: string | null;
  operatorId?: string | null;
  boundStreamerId?: string | null;
  note?: string | null;
};

export type CreatePlatformAccountRepositoryInput = CreatePlatformAccountInput & {
  organizationId: string;
  actorUserId: string;
  accountType: PlatformAccountType;
  status: PlatformAccountStatus;
};

// 状态不在通用更新里改：生命周期流转走 transitionPlatformAccountStatus，
// 保证 platform_account_status_logs 全程可追溯。
export type UpdatePlatformAccountInput = {
  platform?: string;
  accountSource?: string | null;
  xingtuId?: string | null;
  cooperationCode?: string | null;
  accountType?: PlatformAccountType;
  realNameHolder?: string | null;
  realNamePhone?: string | null;
  securityPhone?: string | null;
  securityEmail?: string | null;
  followerCount?: number;
  projectId?: string | null;
  operatorId?: string | null;
  note?: string | null;
};

export type AccountLibraryRepository = {
  createAccount(
    input: CreatePlatformAccountRepositoryInput,
  ): Promise<PlatformAccountRecord>;
  getById(accountId: string): Promise<PlatformAccountRecord | null>;
  updateAccount(
    accountId: string,
    patch: Record<string, unknown>,
  ): Promise<PlatformAccountRecord>;
};

export type AccountLibraryAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

// 实名与密保信息变更属于合规高风险操作，必须带 reason 写高风险审计
const SENSITIVE_FIELDS = [
  "real_name_holder",
  "real_name_phone",
  "security_phone",
  "security_email",
] as const;

export function canManageAccounts(role: AppRole): boolean {
  return (
    role === "owner" ||
    role === "ops_manager" ||
    role === "operator_business"
  );
}

export function assertCanManageAccounts(role: AppRole): void {
  if (!canManageAccounts(role)) {
    throw new Error("Current role cannot manage platform accounts");
  }
}

export async function createPlatformAccount({
  repo,
  audit,
  actor,
  input,
}: {
  repo: AccountLibraryRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  input: CreatePlatformAccountInput;
}): Promise<PlatformAccountRecord> {
  assertCanManageAccounts(actor.role);

  const normalized = normalizeCreateInput(input);
  const account = await repo.createAccount({
    ...normalized,
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "account_library",
    objectType: "platform_account",
    objectId: account.id,
    objectName: `${account.platform}:${account.accountUid}`,
    after: account as unknown as Record<string, unknown>,
    changedFields: getCreateChangedFields(normalized),
  });

  return account;
}

export async function updatePlatformAccount({
  repo,
  audit,
  actor,
  accountId,
  input,
  reason,
}: {
  repo: AccountLibraryRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  accountId: string;
  input: UpdatePlatformAccountInput;
  reason?: string;
}): Promise<PlatformAccountRecord> {
  assertCanManageAccounts(actor.role);

  const before = await repo.getById(accountId);
  if (!before) {
    throw new Error("Platform account not found");
  }

  const patch = normalizeUpdatePatch(input);
  if (Object.keys(patch).length === 0) {
    throw new Error("No account fields to update");
  }

  const touchesSensitive = SENSITIVE_FIELDS.some((field) => field in patch);
  if (touchesSensitive && !reason?.trim()) {
    throw new Error("Updating real-name fields requires a reason");
  }

  const account = await repo.updateAccount(accountId, patch);

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
    changedFields: Object.keys(patch),
    isHighRisk: touchesSensitive,
    reason: reason?.trim(),
  });

  return account;
}

export async function bindStreamerToAccount({
  repo,
  audit,
  actor,
  accountId,
  streamerId,
}: {
  repo: AccountLibraryRepository;
  audit: AccountLibraryAuditWriter;
  actor: AccountLibraryActor;
  accountId: string;
  streamerId: string | null;
}): Promise<PlatformAccountRecord> {
  assertCanManageAccounts(actor.role);

  const before = await repo.getById(accountId);
  if (!before) {
    throw new Error("Platform account not found");
  }

  if (before.accountType === "streamer_owned" && streamerId === null) {
    throw new Error("Streamer-owned accounts must stay bound to a streamer");
  }

  const account = await repo.updateAccount(accountId, {
    bound_streamer_id: streamerId,
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
    changedFields: ["bound_streamer_id"],
    streamerId: streamerId ?? undefined,
  });

  return account;
}

function normalizeCreateInput(input: CreatePlatformAccountInput) {
  const platform = input.platform.trim();
  if (!platform) {
    throw new Error("platform is required");
  }

  const accountUid = input.accountUid.trim();
  if (!accountUid) {
    throw new Error("accountUid is required");
  }

  const accountType = input.accountType ?? "self_incubated";
  const boundStreamerId = normalizeOptionalText(input.boundStreamerId) ?? null;
  if (accountType === "streamer_owned" && !boundStreamerId) {
    throw new Error("Streamer-owned accounts require a bound streamer");
  }

  return {
    platform,
    accountUid,
    accountType,
    status: input.status ?? "active",
    accountSource: normalizeOptionalText(input.accountSource) ?? null,
    xingtuId: normalizeOptionalText(input.xingtuId) ?? null,
    cooperationCode: normalizeOptionalText(input.cooperationCode) ?? null,
    realNameHolder: normalizeOptionalText(input.realNameHolder) ?? null,
    realNamePhone: normalizeOptionalText(input.realNamePhone) ?? null,
    securityPhone: normalizeOptionalText(input.securityPhone) ?? null,
    securityEmail: normalizeOptionalText(input.securityEmail) ?? null,
    followerCount: normalizeFollowerCount(input.followerCount) ?? 0,
    projectId: normalizeOptionalText(input.projectId) ?? null,
    operatorId: normalizeOptionalText(input.operatorId) ?? null,
    boundStreamerId,
    note: normalizeOptionalText(input.note) ?? null,
  };
}

function getCreateChangedFields(
  normalized: ReturnType<typeof normalizeCreateInput>,
): string[] {
  const fields = ["platform", "account_uid", "account_type", "status"];
  if (normalized.accountSource !== null) fields.push("account_source");
  if (normalized.xingtuId !== null) fields.push("xingtu_id");
  if (normalized.cooperationCode !== null) fields.push("cooperation_code");
  if (normalized.realNameHolder !== null) fields.push("real_name_holder");
  if (normalized.realNamePhone !== null) fields.push("real_name_phone");
  if (normalized.securityPhone !== null) fields.push("security_phone");
  if (normalized.securityEmail !== null) fields.push("security_email");
  if (normalized.followerCount !== 0) fields.push("follower_count");
  if (normalized.projectId !== null) fields.push("project_id");
  if (normalized.operatorId !== null) fields.push("operator_id");
  if (normalized.boundStreamerId !== null) fields.push("bound_streamer_id");
  if (normalized.note !== null) fields.push("note");
  return fields;
}

function normalizeUpdatePatch(
  input: UpdatePlatformAccountInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.platform !== undefined) {
    const platform = input.platform.trim();
    if (!platform) {
      throw new Error("platform cannot be empty");
    }
    patch.platform = platform;
  }
  if (input.accountType !== undefined) patch.account_type = input.accountType;
  if (input.accountSource !== undefined) {
    patch.account_source = normalizeOptionalText(input.accountSource) ?? null;
  }
  if (input.xingtuId !== undefined) {
    patch.xingtu_id = normalizeOptionalText(input.xingtuId) ?? null;
  }
  if (input.cooperationCode !== undefined) {
    patch.cooperation_code =
      normalizeOptionalText(input.cooperationCode) ?? null;
  }
  if (input.realNameHolder !== undefined) {
    patch.real_name_holder = normalizeOptionalText(input.realNameHolder) ?? null;
  }
  if (input.realNamePhone !== undefined) {
    patch.real_name_phone = normalizeOptionalText(input.realNamePhone) ?? null;
  }
  if (input.securityPhone !== undefined) {
    patch.security_phone = normalizeOptionalText(input.securityPhone) ?? null;
  }
  if (input.securityEmail !== undefined) {
    patch.security_email = normalizeOptionalText(input.securityEmail) ?? null;
  }
  if (input.followerCount !== undefined) {
    patch.follower_count = normalizeFollowerCount(input.followerCount);
  }
  if (input.projectId !== undefined) {
    patch.project_id = normalizeOptionalText(input.projectId) ?? null;
  }
  if (input.operatorId !== undefined) {
    patch.operator_id = normalizeOptionalText(input.operatorId) ?? null;
  }
  if (input.note !== undefined) {
    patch.note = normalizeOptionalText(input.note) ?? null;
  }

  return patch;
}

function normalizeFollowerCount(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("followerCount must be a non-negative number");
  }
  return Math.floor(value);
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
