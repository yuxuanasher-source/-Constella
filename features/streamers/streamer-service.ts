import type { AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

export type StreamerRiskLevel = "low" | "medium" | "high" | "blacklisted";
export type StreamerCooperationStatus =
  | "not_started"
  | "active"
  | "paused"
  | "ended";
export const STREAMER_SOURCE_TYPES = [
  "self_incubated",
  "signed",
  "external",
  "supplier_recommended",
  "account_managed",
] as const;
export type StreamerSourceType = (typeof STREAMER_SOURCE_TYPES)[number];
export const STREAMER_SETTLEMENT_METHODS = [
  "cpt",
  "cpa",
  "cps",
  "gift",
  "base_salary",
  "base_salary_cpt",
  "manual",
] as const;
export type StreamerSettlementMethod =
  (typeof STREAMER_SETTLEMENT_METHODS)[number];

export type StreamerRecord = {
  id: string;
  displayName: string;
  userId?: string | null;
  riskLevel: StreamerRiskLevel;
  riskReason?: string | null;
  blacklistReason?: string | null;
  cooperationStatus: StreamerCooperationStatus;
};

export type StreamerActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type CreateStreamerProfileInput = {
  displayName: string;
  userId?: string | null;
  realName?: string | null;
  gender?: string | null;
  sourceType?: StreamerSourceType;
  categories?: string[];
  platforms?: string[];
  styles?: string[];
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
};

export type CreateStreamerProfileRepositoryInput = {
  organizationId: string;
  actorUserId: string;
  displayName: string;
  userId?: string | null;
  realName?: string | null;
  gender?: string | null;
  sourceType?: StreamerSourceType;
  categories?: string[];
  platforms?: string[];
  styles?: string[];
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number;
  defaultBaseSalary?: number;
  defaultCpsRateBps?: number;
};

export type UpdateStreamerRiskInput = {
  riskLevel: StreamerRiskLevel;
  riskReason?: string | null;
  blacklistReason?: string | null;
};

export type UpdateStreamerSettlementRuleInput = {
  defaultSettlementMethod?: StreamerSettlementMethod;
  defaultHourlyRate?: number | null;
  defaultBaseSalary?: number | null;
  defaultCpsRateBps?: number | null;
};

export type StreamerRepository = {
  createProfile(
    input: CreateStreamerProfileRepositoryInput,
  ): Promise<StreamerRecord>;
  getById(streamerId: string): Promise<StreamerRecord | null>;
  updateRisk(
    streamerId: string,
    input: {
      risk_level: StreamerRiskLevel;
      risk_reason?: string | null;
      blacklist_reason?: string | null;
    },
  ): Promise<StreamerRecord>;
  updateSettlementRule(
    streamerId: string,
    input: {
      default_settlement_method?: StreamerSettlementMethod;
      default_price?: number;
      default_base_salary?: number;
      default_cps_rate_bps?: number;
    },
  ): Promise<StreamerRecord>;
};

export type StreamerAuditWriter = (input: AuditLogInput) => Promise<void>;

export function assertStreamerCanBeInvited(streamer: StreamerRecord): void {
  if (streamer.riskLevel === "blacklisted") {
    throw new Error("Blacklisted streamers cannot be invited");
  }
}

export async function createStreamerProfile({
  repo,
  audit,
  actor,
  input,
}: {
  repo: StreamerRepository;
  audit: StreamerAuditWriter;
  actor: StreamerActor;
  input: CreateStreamerProfileInput;
}): Promise<StreamerRecord> {
  const normalizedInput = normalizeCreateStreamerInput(input);
  const createInput: CreateStreamerProfileRepositoryInput = {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    displayName: normalizedInput.displayName,
    userId: normalizedInput.userId ?? null,
  };
  if (normalizedInput.realName !== undefined) {
    createInput.realName = normalizedInput.realName;
  }
  if (normalizedInput.gender !== undefined) {
    createInput.gender = normalizedInput.gender;
  }
  if (normalizedInput.sourceType !== undefined) {
    createInput.sourceType = normalizedInput.sourceType;
  }
  if (normalizedInput.categories !== undefined) {
    createInput.categories = normalizedInput.categories;
  }
  if (normalizedInput.platforms !== undefined) {
    createInput.platforms = normalizedInput.platforms;
  }
  if (normalizedInput.styles !== undefined) {
    createInput.styles = normalizedInput.styles;
  }
  if (normalizedInput.defaultSettlementMethod !== undefined) {
    createInput.defaultSettlementMethod =
      normalizedInput.defaultSettlementMethod;
  }
  if (normalizedInput.defaultHourlyRate !== undefined) {
    createInput.defaultHourlyRate = normalizedInput.defaultHourlyRate;
  }
  if (normalizedInput.defaultBaseSalary !== undefined) {
    createInput.defaultBaseSalary = normalizedInput.defaultBaseSalary;
  }
  if (normalizedInput.defaultCpsRateBps !== undefined) {
    createInput.defaultCpsRateBps = normalizedInput.defaultCpsRateBps;
  }

  const streamer = await repo.createProfile(createInput);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "streamer",
    objectType: "streamer",
    objectId: streamer.id,
    objectName: streamer.displayName,
    after: streamer,
    changedFields: getCreateStreamerChangedFields(normalizedInput),
  });

  return streamer;
}

function normalizeCreateStreamerInput(
  input: CreateStreamerProfileInput,
): Required<Pick<CreateStreamerProfileInput, "displayName">> &
  Omit<CreateStreamerProfileInput, "displayName"> {
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new Error("displayName is required");
  }

  return {
    displayName,
    userId: normalizeOptionalText(input.userId),
    realName: normalizeOptionalText(input.realName),
    gender: normalizeOptionalText(input.gender),
    sourceType: input.sourceType,
    categories: normalizeTextList(input.categories),
    platforms: normalizeTextList(input.platforms),
    styles: normalizeTextList(input.styles),
    defaultSettlementMethod: input.defaultSettlementMethod,
    defaultHourlyRate: normalizeNonNegativeNumber(
      input.defaultHourlyRate,
      "defaultHourlyRate",
    ),
    defaultBaseSalary: normalizeNonNegativeNumber(
      input.defaultBaseSalary,
      "defaultBaseSalary",
    ),
    defaultCpsRateBps: normalizeCpsRateBps(input.defaultCpsRateBps),
  };
}

function getCreateStreamerChangedFields(
  input: ReturnType<typeof normalizeCreateStreamerInput>,
) {
  const fields = ["display_name", "user_id"];
  if (input.realName !== undefined) fields.push("real_name");
  if (input.gender !== undefined) fields.push("gender");
  if (input.sourceType !== undefined) fields.push("source_type");
  if (input.categories !== undefined) fields.push("categories");
  if (input.platforms !== undefined) fields.push("platforms");
  if (input.styles !== undefined) fields.push("styles");
  if (input.defaultSettlementMethod !== undefined) {
    fields.push("default_settlement_method");
  }
  if (input.defaultHourlyRate !== undefined) fields.push("default_price");
  if (input.defaultBaseSalary !== undefined) {
    fields.push("default_base_salary");
  }
  if (input.defaultCpsRateBps !== undefined) {
    fields.push("default_cps_rate_bps");
  }
  return fields;
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeTextList(values: string[] | undefined) {
  if (!values) {
    return undefined;
  }

  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNonNegativeNumber(
  value: number | null | undefined,
  fieldName: string,
) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be non-negative`);
  }
  return value;
}

function normalizeCpsRateBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error("defaultCpsRateBps must be between 0 and 10000");
  }
  return value;
}

export async function updateStreamerRisk({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerRepository;
  audit: StreamerAuditWriter;
  actor: StreamerActor;
  streamerId: string;
  input: UpdateStreamerRiskInput;
  reason: string;
}): Promise<StreamerRecord> {
  if (!canEditStreamerRisk(actor.role)) {
    throw new Error("Only owner and ops_manager can update streamer risk");
  }

  if (!reason.trim()) {
    throw new Error("Streamer risk changes require a reason");
  }

  const before = await repo.getById(streamerId);
  if (!before) {
    throw new Error("Streamer not found");
  }

  const patch = {
    risk_level: input.riskLevel,
    risk_reason: input.riskReason,
    blacklist_reason: input.blacklistReason,
  };
  const streamer = await repo.updateRisk(streamerId, removeUndefined(patch));

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "streamer",
    objectType: "streamer",
    objectId: streamer.id,
    objectName: streamer.displayName,
    before,
    after: streamer,
    changedFields: Object.keys(removeUndefined(patch)),
    isHighRisk: true,
    reason: reason.trim(),
  });

  return streamer;
}

function canEditStreamerRisk(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

export async function updateStreamerSettlementRule({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
}: {
  repo: StreamerRepository;
  audit: StreamerAuditWriter;
  actor: StreamerActor;
  streamerId: string;
  input: UpdateStreamerSettlementRuleInput;
  reason: string;
}): Promise<StreamerRecord> {
  if (!canEditStreamerSettlementRule(actor.role)) {
    throw new Error(
      "Only owner and ops_manager can update streamer settlement rules",
    );
  }
  if (!reason.trim()) {
    throw new Error("Streamer settlement rule changes require a reason");
  }

  const before = await repo.getById(streamerId);
  if (!before) {
    throw new Error("Streamer not found");
  }

  const normalized = normalizeSettlementRuleInput(input);
  const patch = removeUndefined({
    default_settlement_method: normalized.defaultSettlementMethod,
    default_price: normalized.defaultHourlyRate,
    default_base_salary: normalized.defaultBaseSalary,
    default_cps_rate_bps: normalized.defaultCpsRateBps,
  });
  const streamer = await repo.updateSettlementRule(streamerId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "streamer",
    objectType: "streamer",
    objectId: streamer.id,
    objectName: streamer.displayName,
    before,
    after: streamer,
    changedFields: Object.keys(patch),
    isHighRisk: true,
    reason: reason.trim(),
  });

  return streamer;
}

function normalizeSettlementRuleInput(input: UpdateStreamerSettlementRuleInput) {
  return {
    defaultSettlementMethod: input.defaultSettlementMethod,
    defaultHourlyRate: normalizeNonNegativeNumber(
      input.defaultHourlyRate,
      "defaultHourlyRate",
    ),
    defaultBaseSalary: normalizeNonNegativeNumber(
      input.defaultBaseSalary,
      "defaultBaseSalary",
    ),
    defaultCpsRateBps: normalizeCpsRateBps(input.defaultCpsRateBps),
  };
}

function canEditStreamerSettlementRule(role: AppRole): boolean {
  return role === "owner" || role === "ops_manager";
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
