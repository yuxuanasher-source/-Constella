import type { AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

export type StreamerRiskLevel = "low" | "medium" | "high" | "blacklisted";
export type StreamerCooperationStatus =
  | "not_started"
  | "active"
  | "paused"
  | "ended";

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
};

export type UpdateStreamerRiskInput = {
  riskLevel: StreamerRiskLevel;
  riskReason?: string | null;
  blacklistReason?: string | null;
};

export type StreamerRepository = {
  createProfile(input: {
    organizationId: string;
    actorUserId: string;
    displayName: string;
    userId?: string | null;
  }): Promise<StreamerRecord>;
  getById(streamerId: string): Promise<StreamerRecord | null>;
  updateRisk(
    streamerId: string,
    input: {
      risk_level: StreamerRiskLevel;
      risk_reason?: string | null;
      blacklist_reason?: string | null;
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
  const streamer = await repo.createProfile({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    displayName: input.displayName,
    userId: input.userId ?? null,
  });

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
    changedFields: ["display_name", "user_id"],
  });

  return streamer;
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

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
