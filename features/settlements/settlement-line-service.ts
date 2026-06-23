import type { AuditLogInput } from "@/lib/audit/audit";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import {
  buildSettlementBreakdown,
  calculateCollaborationSplit,
  summarizeLineItems,
  type CollaborationSplitMode,
  type SettlementBreakdown,
  type SettlementLineDirection,
} from "./settlement-margin-engine";
import type { SettlementActor } from "./settlement-service";

export type SettlementLineItemRecord = {
  id: string;
  settlementBatchId: string;
  projectId: string;
  streamerId?: string | null;
  direction: SettlementLineDirection;
  category: string;
  label: string;
  amount: number;
  isSystemGenerated: boolean;
};

export type CollaborationSettlementRecord = {
  id: string;
  settlementBatchId: string;
  collaborationId: string;
  projectId: string;
  mode: CollaborationSplitMode;
  sharePercentage?: number | null;
  hourlyFixedAmount?: number | null;
  basisAmount: number;
  totalHours?: number | null;
  computedAmount: number;
  manualAmount: number;
};

export type SettlementBatchLite = {
  id: string;
  projectId: string;
  organizationId: string;
  status: string;
};

export type CollaborationLite = {
  id: string;
  projectId: string;
  mode: CollaborationSplitMode;
  sharePercentage?: number | null;
  hourlyFixedAmount?: number | null;
};

export type SettlementLineRepository = {
  getBatch(batchId: string): Promise<SettlementBatchLite | null>;
  listLineItems(batchId: string): Promise<SettlementLineItemRecord[]>;
  createLineItem(input: {
    organizationId: string;
    settlementBatchId: string;
    projectId: string;
    streamerId: string | null;
    direction: SettlementLineDirection;
    category: string;
    label: string;
    amount: number;
    reason: string;
    createdBy: string;
  }): Promise<SettlementLineItemRecord>;
  getLineItemById(
    lineItemId: string,
  ): Promise<SettlementLineItemRecord | null>;
  updateLineItem(
    lineItemId: string,
    patch: Record<string, unknown>,
  ): Promise<SettlementLineItemRecord>;
  deleteLineItem(lineItemId: string): Promise<void>;
  getCollaboration(collaborationId: string): Promise<CollaborationLite | null>;
  getBatchTotalHours(batchId: string): Promise<number>;
  listCollaborationSettlements(
    batchId: string,
  ): Promise<CollaborationSettlementRecord[]>;
  upsertCollaborationSettlement(input: {
    organizationId: string;
    settlementBatchId: string;
    collaborationId: string;
    projectId: string;
    mode: CollaborationSplitMode;
    sharePercentage: number | null;
    hourlyFixedAmount: number | null;
    basisAmount: number;
    totalHours: number | null;
    computedAmount: number;
    createdBy: string;
  }): Promise<CollaborationSettlementRecord>;
};

export type SettlementLineAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

const MANAGE_ROLES: AppRole[] = ["owner", "ops_manager", "operator_business"];

function assertCanManage(role: AppRole): void {
  if (!MANAGE_ROLES.includes(role)) {
    throw new Error("Current role cannot manage settlement line items");
  }
}

function assertEditable(batch: SettlementBatchLite): void {
  if (batch.status === "locked" || batch.status === "voided") {
    throw new Error("Locked or voided settlement batches cannot be edited");
  }
}

function assertReason(reason: string | undefined, message: string): string {
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new Error(message);
  }
  return trimmed;
}

function assertAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Line item amount must be non-negative");
  }
}

async function requireBatch(
  repo: Pick<SettlementLineRepository, "getBatch">,
  batchId: string,
): Promise<SettlementBatchLite> {
  const batch = await repo.getBatch(batchId);
  if (!batch) {
    throw new Error("Settlement batch not found");
  }
  return batch;
}

export async function addSettlementLineItem({
  repo,
  audit,
  actor,
  batchId,
  input,
}: {
  repo: Pick<
    SettlementLineRepository,
    "getBatch" | "createLineItem"
  >;
  audit: SettlementLineAuditWriter;
  actor: SettlementActor;
  batchId: string;
  input: {
    direction: SettlementLineDirection;
    category: string;
    label: string;
    amount: number;
    streamerId?: string | null;
    reason?: string;
  };
}): Promise<SettlementLineItemRecord> {
  assertCanManage(actor.role);
  assertAmount(input.amount);
  const reason = assertReason(
    input.reason,
    "Adding a settlement line item requires a reason",
  );
  const category = input.category.trim();
  const label = input.label.trim();
  if (!category || !label) {
    throw new Error("Line item category and label are required");
  }

  const batch = await requireBatch(repo, batchId);
  assertEditable(batch);

  const item = await repo.createLineItem({
    organizationId: actor.organizationId,
    settlementBatchId: batch.id,
    projectId: batch.projectId,
    streamerId: input.streamerId ?? null,
    direction: input.direction,
    category,
    label,
    amount: input.amount,
    reason,
    createdBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "settlement_line_item",
    objectId: item.id,
    projectId: batch.projectId,
    streamerId: item.streamerId ?? undefined,
    after: item as unknown as Record<string, unknown>,
    changedFields: ["direction", "category", "label", "amount"],
    isHighRisk: true,
    reason,
  });

  return item;
}

export async function updateSettlementLineItem({
  repo,
  audit,
  actor,
  lineItemId,
  input,
}: {
  repo: Pick<
    SettlementLineRepository,
    "getBatch" | "getLineItemById" | "updateLineItem"
  >;
  audit: SettlementLineAuditWriter;
  actor: SettlementActor;
  lineItemId: string;
  input: {
    label?: string;
    category?: string;
    amount?: number;
    reason?: string;
  };
}): Promise<SettlementLineItemRecord> {
  assertCanManage(actor.role);
  const reason = assertReason(
    input.reason,
    "Updating a settlement line item requires a reason",
  );

  const before = await repo.getLineItemById(lineItemId);
  if (!before) {
    throw new Error("Settlement line item not found");
  }
  const batch = await requireBatch(repo, before.settlementBatchId);
  assertEditable(batch);

  const patch: Record<string, unknown> = {};
  if (input.amount !== undefined) {
    assertAmount(input.amount);
    patch.amount = input.amount;
  }
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) {
      throw new Error("Line item label cannot be empty");
    }
    patch.label = label;
  }
  if (input.category !== undefined) {
    const category = input.category.trim();
    if (!category) {
      throw new Error("Line item category cannot be empty");
    }
    patch.category = category;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No line item fields to update");
  }
  patch.reason = reason;

  const after = await repo.updateLineItem(lineItemId, patch);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "settlement_line_item",
    objectId: after.id,
    projectId: after.projectId,
    streamerId: after.streamerId ?? undefined,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: Object.keys(patch),
    isHighRisk: true,
    reason,
  });

  return after;
}

export async function deleteSettlementLineItem({
  repo,
  audit,
  actor,
  lineItemId,
  reason,
}: {
  repo: Pick<
    SettlementLineRepository,
    "getBatch" | "getLineItemById" | "deleteLineItem"
  >;
  audit: SettlementLineAuditWriter;
  actor: SettlementActor;
  lineItemId: string;
  reason?: string;
}): Promise<void> {
  assertCanManage(actor.role);
  const safeReason = assertReason(
    reason,
    "Deleting a settlement line item requires a reason",
  );

  const before = await repo.getLineItemById(lineItemId);
  if (!before) {
    throw new Error("Settlement line item not found");
  }
  const batch = await requireBatch(repo, before.settlementBatchId);
  assertEditable(batch);

  await repo.deleteLineItem(lineItemId);

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "void",
    module: "settlement",
    objectType: "settlement_line_item",
    objectId: before.id,
    projectId: before.projectId,
    streamerId: before.streamerId ?? undefined,
    before: before as unknown as Record<string, unknown>,
    changedFields: ["amount"],
    isHighRisk: true,
    reason: safeReason,
  });
}

export async function recomputeCollaborationSettlement({
  repo,
  audit,
  actor,
  batchId,
  collaborationId,
}: {
  repo: Pick<
    SettlementLineRepository,
    | "getBatch"
    | "getCollaboration"
    | "listLineItems"
    | "getBatchTotalHours"
    | "upsertCollaborationSettlement"
  >;
  audit: SettlementLineAuditWriter;
  actor: SettlementActor;
  batchId: string;
  collaborationId: string;
}): Promise<CollaborationSettlementRecord> {
  assertCanManage(actor.role);

  const batch = await requireBatch(repo, batchId);
  assertEditable(batch);

  const collaboration = await repo.getCollaboration(collaborationId);
  if (!collaboration) {
    throw new Error("Collaboration not found");
  }
  if (collaboration.projectId !== batch.projectId) {
    throw new Error("Collaboration does not belong to this batch project");
  }

  const items = await repo.listLineItems(batchId);
  const { grossMargin } = summarizeLineItems(
    items.map((item) => ({
      streamerId: item.streamerId ?? null,
      direction: item.direction,
      amount: item.amount,
    })),
  );
  const totalHours = await repo.getBatchTotalHours(batchId);

  const split = calculateCollaborationSplit({
    mode: collaboration.mode,
    sharePercentage: collaboration.sharePercentage,
    hourlyFixedAmount: collaboration.hourlyFixedAmount,
    grossMargin,
    totalHours,
  });

  const record = await repo.upsertCollaborationSettlement({
    organizationId: actor.organizationId,
    settlementBatchId: batch.id,
    collaborationId: collaboration.id,
    projectId: batch.projectId,
    mode: collaboration.mode,
    sharePercentage: collaboration.sharePercentage ?? null,
    hourlyFixedAmount: collaboration.hourlyFixedAmount ?? null,
    basisAmount: split.basisAmount,
    totalHours: collaboration.mode === "hourly_fixed" ? totalHours : null,
    computedAmount: split.computedAmount,
    createdBy: actor.userId,
  });

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "collaboration_settlement",
    objectId: record.id,
    projectId: batch.projectId,
    after: record as unknown as Record<string, unknown>,
    changedFields: ["basis_amount", "total_hours", "computed_amount"],
  });

  return record;
}

export async function getSettlementBreakdown({
  repo,
  actor,
  batchId,
}: {
  repo: Pick<
    SettlementLineRepository,
    "getBatch" | "listLineItems" | "listCollaborationSettlements"
  >;
  actor: SettlementActor;
  batchId: string;
}): Promise<
  SettlementBreakdown & {
    collaborations: CollaborationSettlementRecord[];
  }
> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can read settlement breakdown");
  }

  const batch = await requireBatch(repo, batchId);
  const items = await repo.listLineItems(batch.id);
  const collaborations = await repo.listCollaborationSettlements(batch.id);
  const mcnSplit = collaborations.reduce(
    (sum, row) => sum + row.computedAmount + row.manualAmount,
    0,
  );

  const breakdown = buildSettlementBreakdown({
    items: items.map((item) => ({
      streamerId: item.streamerId ?? null,
      direction: item.direction,
      amount: item.amount,
    })),
    mcnSplit,
  });

  return { ...breakdown, collaborations };
}
