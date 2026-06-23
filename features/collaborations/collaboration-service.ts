import type { AuditLogInput } from "@/lib/audit/audit";
import type { NotificationInput } from "@/lib/notify/notify";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

export const COLLABORATION_STATUSES = [
  "invited",
  "active",
  "paused",
  "ended",
  "revoked",
] as const;
export type CollaborationStatus = (typeof COLLABORATION_STATUSES)[number];

export const COLLABORATION_SETTLEMENT_MODES = [
  "percentage",
  "hourly_fixed",
] as const;
export type CollaborationSettlementMode =
  (typeof COLLABORATION_SETTLEMENT_MODES)[number];

export type CollaborationRecord = {
  id: string;
  hostOrganizationId: string;
  projectId: string;
  partnerOrganizationId?: string | null;
  inviteCode?: string | null;
  status: CollaborationStatus;
  settlementMode: CollaborationSettlementMode;
  sharePercentage?: number | null;
  hourlyFixedAmount?: number | null;
};

export type CollaborationActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
};

export type SettlementConfigInput = {
  settlementMode: CollaborationSettlementMode;
  sharePercentage?: number | null;
  hourlyFixedAmount?: number | null;
};

export type OpenCollaborationInput = {
  projectId: string;
} & SettlementConfigInput;

export type CollaborationRepository = {
  createCollaboration(input: {
    hostOrganizationId: string;
    projectId: string;
    inviteCode: string;
    settlementMode: CollaborationSettlementMode;
    sharePercentage: number | null;
    hourlyFixedAmount: number | null;
    invitedBy: string;
  }): Promise<CollaborationRecord>;
  acceptByInviteCode(input: {
    inviteCode: string;
    partnerOrganizationId: string;
  }): Promise<CollaborationRecord>;
  getById(collaborationId: string): Promise<CollaborationRecord | null>;
  updateCollaboration(
    collaborationId: string,
    patch: Record<string, unknown>,
  ): Promise<CollaborationRecord>;
};

export type CollaborationAuditWriter = (input: AuditLogInput) => Promise<void>;
export type CollaborationNotifier = (input: NotificationInput) => Promise<void>;

const HOST_MANAGE_ROLES: AppRole[] = [
  "owner",
  "ops_manager",
  "operator_business",
];

export function canManageCollaboration(role: AppRole): boolean {
  return HOST_MANAGE_ROLES.includes(role);
}

function assertCanManageCollaboration(role: AppRole): void {
  if (!canManageCollaboration(role)) {
    throw new Error("Current role cannot manage project collaborations");
  }
}

function assertSettlementConfig(input: SettlementConfigInput): {
  sharePercentage: number | null;
  hourlyFixedAmount: number | null;
} {
  if (input.settlementMode === "percentage") {
    const pct = input.sharePercentage;
    if (pct === null || pct === undefined || !Number.isFinite(pct)) {
      throw new Error("Percentage mode requires a share percentage");
    }
    if (pct < 0 || pct > 1) {
      throw new Error("Share percentage must be between 0 and 1");
    }
    return { sharePercentage: pct, hourlyFixedAmount: null };
  }

  const amount = input.hourlyFixedAmount;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    throw new Error("Hourly fixed mode requires an hourly amount");
  }
  if (amount < 0) {
    throw new Error("Hourly fixed amount must be non-negative");
  }
  return { sharePercentage: null, hourlyFixedAmount: amount };
}

export function generateInviteCode(
  randomPart: string = Math.random().toString(36).slice(2, 10),
): string {
  return `COLLAB-${randomPart.toUpperCase()}`;
}

export async function openCollaboration({
  repo,
  audit,
  actor,
  input,
  inviteCode = generateInviteCode(),
}: {
  repo: Pick<CollaborationRepository, "createCollaboration">;
  audit: CollaborationAuditWriter;
  actor: CollaborationActor;
  input: OpenCollaborationInput;
  inviteCode?: string;
}): Promise<CollaborationRecord> {
  assertCanManageCollaboration(actor.role);
  const settlement = assertSettlementConfig(input);

  const collaboration = await repo.createCollaboration({
    hostOrganizationId: actor.organizationId,
    projectId: input.projectId,
    inviteCode,
    settlementMode: input.settlementMode,
    sharePercentage: settlement.sharePercentage,
    hourlyFixedAmount: settlement.hourlyFixedAmount,
    invitedBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "collaboration",
    objectType: "project_collaboration",
    objectId: collaboration.id,
    projectId: collaboration.projectId,
    after: collaboration as unknown as Record<string, unknown>,
    changedFields: [
      "status",
      "invite_code",
      "settlement_mode",
      "share_percentage",
      "hourly_fixed_amount",
    ],
  });

  return collaboration;
}

export async function acceptCollaboration({
  repo,
  audit,
  notify,
  actor,
  inviteCode,
}: {
  repo: Pick<CollaborationRepository, "acceptByInviteCode">;
  audit: CollaborationAuditWriter;
  notify: CollaborationNotifier;
  actor: CollaborationActor;
  inviteCode: string;
}): Promise<CollaborationRecord> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can accept collaboration invites");
  }
  if (!inviteCode.trim()) {
    throw new Error("Invite code is required");
  }

  const collaboration = await repo.acceptByInviteCode({
    inviteCode: inviteCode.trim(),
    partnerOrganizationId: actor.organizationId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "collaboration",
    objectType: "project_collaboration",
    objectId: collaboration.id,
    projectId: collaboration.projectId,
    after: collaboration as unknown as Record<string, unknown>,
    changedFields: ["status", "partner_organization_id", "accepted_at"],
  });

  await notify({
    organizationId: collaboration.hostOrganizationId,
    recipientRole: "ops_manager",
    type: "system",
    title: "协作方已加入项目",
    content: `合作方已通过协作码加入项目 ${collaboration.projectId}。`,
    objectType: "project_collaboration",
    objectId: collaboration.id,
    source: "collaboration.accept",
  });

  return collaboration;
}

export async function changeCollaborationStatus({
  repo,
  audit,
  actor,
  collaborationId,
  status,
}: {
  repo: Pick<
    CollaborationRepository,
    "getById" | "updateCollaboration"
  >;
  audit: CollaborationAuditWriter;
  actor: CollaborationActor;
  collaborationId: string;
  status: Extract<CollaborationStatus, "active" | "paused" | "ended" | "revoked">;
}): Promise<CollaborationRecord> {
  assertCanManageCollaboration(actor.role);

  const before = await repo.getById(collaborationId);
  if (!before) {
    throw new Error("Collaboration not found");
  }
  if (before.hostOrganizationId !== actor.organizationId) {
    throw new Error("Only host organization staff can change collaboration");
  }

  const after = await repo.updateCollaboration(collaborationId, { status });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "collaboration",
    objectType: "project_collaboration",
    objectId: after.id,
    projectId: after.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: ["status"],
  });

  return after;
}

export async function updateCollaborationSettlement({
  repo,
  audit,
  actor,
  collaborationId,
  input,
}: {
  repo: Pick<
    CollaborationRepository,
    "getById" | "updateCollaboration"
  >;
  audit: CollaborationAuditWriter;
  actor: CollaborationActor;
  collaborationId: string;
  input: SettlementConfigInput;
}): Promise<CollaborationRecord> {
  assertCanManageCollaboration(actor.role);
  const settlement = assertSettlementConfig(input);

  const before = await repo.getById(collaborationId);
  if (!before) {
    throw new Error("Collaboration not found");
  }
  if (before.hostOrganizationId !== actor.organizationId) {
    throw new Error("Only host organization staff can change collaboration");
  }

  const after = await repo.updateCollaboration(collaborationId, {
    settlement_mode: input.settlementMode,
    share_percentage: settlement.sharePercentage,
    hourly_fixed_amount: settlement.hourlyFixedAmount,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "collaboration",
    objectType: "project_collaboration",
    objectId: after.id,
    projectId: after.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: [
      "settlement_mode",
      "share_percentage",
      "hourly_fixed_amount",
    ],
  });

  return after;
}
