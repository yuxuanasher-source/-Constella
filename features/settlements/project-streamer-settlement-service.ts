import type { SettlementMethod } from "./settlement-engine";
import type {
  SettlementActor,
  SettlementAuditWriter,
} from "./settlement-service";

export const PROJECT_STREAMER_SETTLEMENT_METHODS: readonly SettlementMethod[] = [
  "cpt",
  "cpa",
  "cps",
  "gift",
  "base_salary",
  "base_salary_cpt",
  "manual",
];

export type ProjectStreamerSettlementMethod = SettlementMethod;

export type ProjectStreamerSettlementRecord = {
  id: string;
  projectId: string;
  streamerId: string;
  streamerName: string | null;
  settlementMethod: SettlementMethod | null;
  hourlyRate: number | null;
  baseSalary: number | null;
  cpsRateBps: number | null;
};

export type UpdateProjectStreamerSettlementRuleInput = {
  settlementMethod?: SettlementMethod;
  hourlyRate?: number | null;
  baseSalary?: number | null;
  cpsRateBps?: number | null;
};

export type ProjectStreamerSettlementPatch = {
  settlement_method?: SettlementMethod;
  hourly_rate?: number;
  base_salary?: number;
  cps_rate_bps?: number;
};

export type ProjectStreamerSettlementRepository = {
  getProjectStreamerSettlement(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
  }): Promise<ProjectStreamerSettlementRecord | null>;
  updateProjectStreamerSettlementRule(input: {
    organizationId: string;
    projectId: string;
    streamerId: string;
    patch: ProjectStreamerSettlementPatch;
  }): Promise<ProjectStreamerSettlementRecord>;
};

function canEditProjectStreamerSettlementRule(
  role: SettlementActor["role"],
): boolean {
  return role === "owner" || role === "ops_manager";
}

function normalizeNonNegative(
  value: number | null | undefined,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return value;
}

function normalizeNonNegativeInteger(
  value: number | null | undefined,
  field: string,
): number | undefined {
  const normalized = normalizeNonNegative(value, field);
  if (normalized === undefined) {
    return undefined;
  }
  if (!Number.isInteger(normalized)) {
    throw new Error(`${field} must be an integer`);
  }
  return normalized;
}

function removeUndefined<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// Edit a streamer's per-project payable settlement rule (project_streamers).
// These columns are otherwise only written once at admission, so without this
// path a misconfigured rule (e.g. left at the "manual" fallback) can never be
// corrected through the product and always settles to ¥0.
export async function updateProjectStreamerSettlementRule({
  repo,
  audit,
  actor,
  projectId,
  streamerId,
  input,
  reason,
}: {
  repo: ProjectStreamerSettlementRepository;
  audit: SettlementAuditWriter;
  actor: SettlementActor;
  projectId: string;
  streamerId: string;
  input: UpdateProjectStreamerSettlementRuleInput;
  reason: string;
}): Promise<ProjectStreamerSettlementRecord> {
  if (!canEditProjectStreamerSettlementRule(actor.role)) {
    throw new Error(
      "Only owner and ops_manager can update project streamer settlement rules",
    );
  }
  if (!reason.trim()) {
    throw new Error(
      "Project streamer settlement rule changes require a reason",
    );
  }
  if (
    input.settlementMethod !== undefined &&
    !PROJECT_STREAMER_SETTLEMENT_METHODS.includes(input.settlementMethod)
  ) {
    throw new Error("settlementMethod is invalid");
  }

  const patch: ProjectStreamerSettlementPatch = removeUndefined({
    settlement_method: input.settlementMethod,
    hourly_rate: normalizeNonNegative(input.hourlyRate, "hourlyRate"),
    base_salary: normalizeNonNegative(input.baseSalary, "baseSalary"),
    cps_rate_bps: normalizeNonNegativeInteger(input.cpsRateBps, "cpsRateBps"),
  });
  if (Object.keys(patch).length === 0) {
    throw new Error("No settlement rule fields to update");
  }

  const before = await repo.getProjectStreamerSettlement({
    organizationId: actor.organizationId,
    projectId,
    streamerId,
  });
  if (!before) {
    throw new Error("Project streamer not found");
  }

  const after = await repo.updateProjectStreamerSettlementRule({
    organizationId: actor.organizationId,
    projectId,
    streamerId,
    patch,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "project_streamer",
    objectId: after.id,
    objectName: after.streamerName ?? after.streamerId,
    before,
    after,
    changedFields: Object.keys(patch),
    isHighRisk: true,
    reason: reason.trim(),
  });

  return after;
}
