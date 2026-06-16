import type { AuditLogInput } from "@/lib/audit/audit";

import type {
  ComplexCostActor,
  ComplexCostRuleStatus,
  ComplexCostRuleVersionRecord,
  CreateProjectCostItemInput,
  ProjectComplexCostEntitlementRecord,
  ProjectCostImportBatchRecord,
  ProjectCostImportType,
  ProjectCostItemRecord,
  ProjectCostItemStatus,
} from "./complex-cost-types";
import { calculateImportedCostAmountCents } from "./complex-cost-calculator";

export type ComplexCostAuditWriter = (input: AuditLogInput) => Promise<void>;

export type CreateRuleVersionRepoInput = {
  organizationId: string;
  projectId: string;
  versionNo: number;
  status: ComplexCostRuleStatus;
  rulePayload: Record<string, unknown>;
  createdBy: string;
};

export type CreateProjectCostItemRepoInput = {
  organizationId: string;
  projectId: string;
  streamerId?: string | null;
  supplierOrganizationId?: string | null;
  liveReportId?: string | null;
  settlementBatchId?: string | null;
  itemType: CreateProjectCostItemInput["itemType"];
  amountCents: number;
  direction: CreateProjectCostItemInput["direction"];
  evidenceLevel: CreateProjectCostItemInput["evidenceLevel"];
  source: NonNullable<CreateProjectCostItemInput["source"]>;
  sourcePayload: Record<string, unknown>;
  reason: string;
  status: ProjectCostItemStatus;
  createdBy: string;
};

export type CreateImportBatchRepoInput = {
  organizationId: string;
  projectId: string;
  importType: ProjectCostImportType;
  fileUrl?: string | null;
  rowCount: number;
  parsedPayload: Array<Record<string, unknown>>;
  status: ProjectCostImportBatchRecord["status"];
  createdBy: string;
};

export type ComplexCostRepository = {
  getProjectEntitlement(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectComplexCostEntitlementRecord | null>;
  getNextRuleVersionNo(projectId: string): Promise<number>;
  createRuleVersion(
    input: CreateRuleVersionRepoInput,
  ): Promise<ComplexCostRuleVersionRecord>;
  getRuleVersionById(
    versionId: string,
  ): Promise<ComplexCostRuleVersionRecord | null>;
  updateRuleVersion(
    versionId: string,
    patch: Partial<ComplexCostRuleVersionRecord>,
  ): Promise<ComplexCostRuleVersionRecord>;
  archiveActiveRuleVersions(input: {
    projectId: string;
    exceptVersionId: string;
  }): Promise<void>;
  createProjectCostItem(
    input: CreateProjectCostItemRepoInput,
  ): Promise<ProjectCostItemRecord>;
  listProjectCostItems(input: {
    organizationId: string;
    projectId: string;
    status?: ProjectCostItemStatus;
  }): Promise<ProjectCostItemRecord[]>;
  createImportBatch(
    input: CreateImportBatchRepoInput,
  ): Promise<ProjectCostImportBatchRecord>;
  getImportBatchById(
    batchId: string,
  ): Promise<ProjectCostImportBatchRecord | null>;
  updateImportBatch(
    batchId: string,
    patch: Partial<ProjectCostImportBatchRecord>,
  ): Promise<ProjectCostImportBatchRecord>;
  attachCostItemsToSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    costItemIds: string[];
    settlementBatchId: string;
  }): Promise<ProjectCostItemRecord[]>;
};

export async function saveComplexCostRuleDraft(args: {
  repo: Pick<
    ComplexCostRepository,
    "getProjectEntitlement" | "getNextRuleVersionNo" | "createRuleVersion"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: { projectId: string; rulePayload: Record<string, unknown> };
}): Promise<ComplexCostRuleVersionRecord> {
  assertCanConfigureRules(args.actor);
  await requireProjectEntitlement(args.repo, args.actor, args.input.projectId);

  const versionNo = await args.repo.getNextRuleVersionNo(args.input.projectId);
  const rule = await args.repo.createRuleVersion({
    organizationId: args.actor.organizationId,
    projectId: args.input.projectId,
    versionNo,
    status: "draft",
    rulePayload: args.input.rulePayload,
    createdBy: args.actor.userId,
  });

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: "create",
    module: "complex_cost",
    objectType: "project_cost_rule_version",
    objectId: rule.id,
    projectId: rule.projectId,
    after: rule as unknown as Record<string, unknown>,
    changedFields: ["status", "rule_payload"],
  });

  return rule;
}

export async function approveComplexCostRuleVersion(args: {
  repo: Pick<
    ComplexCostRepository,
    "getRuleVersionById" | "updateRuleVersion" | "archiveActiveRuleVersions"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  versionId: string;
  reason: string;
  now?: string;
}): Promise<ComplexCostRuleVersionRecord> {
  assertCanConfigureRules(args.actor);
  assertReason(args.reason, "Approving a complex cost rule requires a reason");

  const before = await requireRuleVersion(args.repo, args.versionId);
  assertSameOrganization(args.actor, before.organizationId);
  if (before.status !== "draft") {
    throw new Error("Only draft complex cost rules can be approved");
  }

  await args.repo.archiveActiveRuleVersions({
    projectId: before.projectId,
    exceptVersionId: before.id,
  });
  const after = await args.repo.updateRuleVersion(before.id, {
    status: "active",
    approvedBy: args.actor.userId,
    effectiveFrom: args.now ?? new Date().toISOString(),
  });

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: "approve",
    module: "complex_cost",
    objectType: "project_cost_rule_version",
    objectId: after.id,
    projectId: after.projectId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: ["status", "approved_by", "effective_from"],
    reason: args.reason,
    isHighRisk: true,
  });

  return after;
}

export async function createManualProjectCostItem(args: {
  repo: Pick<
    ComplexCostRepository,
    "getProjectEntitlement" | "createProjectCostItem"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: CreateProjectCostItemInput;
}): Promise<ProjectCostItemRecord> {
  assertCanCreateCostItems(args.actor);
  await requireProjectEntitlement(args.repo, args.actor, args.input.projectId);
  assertReason(args.input.reason, "Manual project cost items require a reason");
  assertAmount(args.input.amountCents);

  const item = await args.repo.createProjectCostItem({
    organizationId: args.actor.organizationId,
    projectId: args.input.projectId,
    streamerId: args.input.streamerId ?? null,
    supplierOrganizationId: args.input.supplierOrganizationId ?? null,
    liveReportId: args.input.liveReportId ?? null,
    settlementBatchId: args.input.settlementBatchId ?? null,
    itemType: args.input.itemType,
    amountCents: Math.trunc(args.input.amountCents),
    direction: args.input.direction,
    evidenceLevel: args.input.evidenceLevel,
    source: args.input.source ?? "manual",
    sourcePayload: args.input.sourcePayload ?? {},
    reason: args.input.reason.trim(),
    status: args.input.status ?? "pending_review",
    createdBy: args.actor.userId,
  });

  await auditCostItemCreate({
    audit: args.audit,
    actor: args.actor,
    item,
    isHighRisk: item.itemType === "penalty" || Boolean(item.settlementBatchId),
  });

  return item;
}

export async function createProjectCostImportBatch(args: {
  repo: Pick<
    ComplexCostRepository,
    "getProjectEntitlement" | "createImportBatch"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: {
    projectId: string;
    importType: ProjectCostImportType;
    fileUrl?: string | null;
    parsedPayload: Array<Record<string, unknown>>;
  };
}): Promise<ProjectCostImportBatchRecord> {
  assertCanCreateCostItems(args.actor);
  await requireProjectEntitlement(args.repo, args.actor, args.input.projectId);

  const batch = await args.repo.createImportBatch({
    organizationId: args.actor.organizationId,
    projectId: args.input.projectId,
    importType: args.input.importType,
    fileUrl: args.input.fileUrl ?? null,
    rowCount: args.input.parsedPayload.length,
    parsedPayload: args.input.parsedPayload,
    status: "parsed",
    createdBy: args.actor.userId,
  });

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: "create",
    module: "complex_cost",
    objectType: "project_cost_import_batch",
    objectId: batch.id,
    projectId: batch.projectId,
    after: batch as unknown as Record<string, unknown>,
    changedFields: ["import_type", "row_count", "status"],
  });

  return batch;
}

export async function confirmProjectCostImportBatch(args: {
  repo: Pick<
    ComplexCostRepository,
    | "getImportBatchById"
    | "createProjectCostItem"
    | "updateImportBatch"
    | "getProjectEntitlement"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  batchId: string;
  reason: string;
}): Promise<{
  importBatch: ProjectCostImportBatchRecord;
  items: ProjectCostItemRecord[];
}> {
  assertCanCreateCostItems(args.actor);
  assertReason(
    args.reason,
    "Confirming imported project costs requires a reason",
  );

  const batch = await args.repo.getImportBatchById(args.batchId);
  if (!batch) {
    throw new Error("Project cost import batch not found");
  }
  assertSameOrganization(args.actor, batch.organizationId);
  await requireProjectEntitlement(args.repo, args.actor, batch.projectId);
  if (batch.status === "confirmed") {
    throw new Error("Project cost import batch is already confirmed");
  }

  const items: ProjectCostItemRecord[] = [];
  for (const row of batch.parsedPayload) {
    const itemType = importRowItemType(row, batch.importType);
    const amountCents = calculateImportedCostAmountCents({
      itemType,
      unitCount: numberFromRow(row, "unitCount"),
      unitPriceCents: numberFromRow(row, "unitPriceCents"),
      salesAmountCents: numberFromRow(row, "salesAmountCents"),
      rateBps: numberFromRow(row, "rateBps"),
      directAmountCents: numberFromRow(row, "directAmountCents"),
    });
    const item = await args.repo.createProjectCostItem({
      organizationId: args.actor.organizationId,
      projectId: batch.projectId,
      streamerId: stringFromRow(row, "streamerId"),
      supplierOrganizationId: stringFromRow(row, "supplierOrganizationId"),
      liveReportId: stringFromRow(row, "liveReportId"),
      settlementBatchId: null,
      itemType,
      amountCents,
      direction: "cost",
      evidenceLevel: "yellow",
      source: "import",
      sourcePayload: row,
      reason: args.reason.trim(),
      status: "confirmed",
      createdBy: args.actor.userId,
    });
    items.push(item);
  }

  const updatedBatch = await args.repo.updateImportBatch(batch.id, {
    status: "confirmed",
  });

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: "approve",
    module: "complex_cost",
    objectType: "project_cost_import_batch",
    objectId: batch.id,
    projectId: batch.projectId,
    before: batch as unknown as Record<string, unknown>,
    after: updatedBatch as unknown as Record<string, unknown>,
    changedFields: ["status"],
    reason: args.reason,
    isHighRisk: true,
  });

  return { importBatch: updatedBatch, items };
}

export async function attachProjectCostItemsToSettlementBatch(args: {
  repo: Pick<
    ComplexCostRepository,
    "attachCostItemsToSettlementBatch" | "listProjectCostItems"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: {
    projectId: string;
    settlementBatchId: string;
    costItemIds: string[];
    reason: string;
  };
}): Promise<ProjectCostItemRecord[]> {
  assertCanCreateCostItems(args.actor);
  assertReason(args.input.reason, "Attaching cost items requires a reason");
  if (args.input.costItemIds.length === 0) {
    throw new Error("At least one project cost item is required");
  }

  const attached = await args.repo.attachCostItemsToSettlementBatch({
    organizationId: args.actor.organizationId,
    projectId: args.input.projectId,
    costItemIds: args.input.costItemIds,
    settlementBatchId: args.input.settlementBatchId,
  });

  if (attached.length !== args.input.costItemIds.length) {
    throw new Error(
      "Some project cost items could not be attached to the settlement batch",
    );
  }

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: "update",
    module: "complex_cost",
    objectType: "settlement_batch_cost_items",
    objectId: args.input.settlementBatchId,
    projectId: args.input.projectId,
    after: { costItemIds: attached.map((item) => item.id) },
    changedFields: ["settlement_batch_id"],
    reason: args.input.reason,
    isHighRisk: true,
  });

  return attached;
}

async function requireProjectEntitlement(
  repo: Pick<ComplexCostRepository, "getProjectEntitlement">,
  actor: ComplexCostActor,
  projectId: string,
): Promise<ProjectComplexCostEntitlementRecord> {
  const entitlement = await repo.getProjectEntitlement({
    organizationId: actor.organizationId,
    projectId,
  });
  if (!entitlement) {
    throw new Error("Complex cost rules are not enabled for this project");
  }
  return entitlement;
}

async function requireRuleVersion(
  repo: Pick<ComplexCostRepository, "getRuleVersionById">,
  versionId: string,
): Promise<ComplexCostRuleVersionRecord> {
  const version = await repo.getRuleVersionById(versionId);
  if (!version) {
    throw new Error("Complex cost rule version not found");
  }
  return version;
}

function assertCanConfigureRules(actor: ComplexCostActor): void {
  if (actor.role !== "owner" && actor.role !== "ops_manager") {
    throw new Error("Current role cannot configure complex cost rules");
  }
}

function assertCanCreateCostItems(actor: ComplexCostActor): void {
  if (
    actor.role !== "owner" &&
    actor.role !== "ops_manager" &&
    actor.role !== "operator_business"
  ) {
    throw new Error("Current role cannot manage project cost items");
  }
}

function assertSameOrganization(
  actor: ComplexCostActor,
  organizationId: string,
): void {
  if (organizationId !== actor.organizationId) {
    throw new Error("Complex cost record belongs to another organization");
  }
}

function assertReason(reason: string, message: string): void {
  if (!reason.trim()) {
    throw new Error(message);
  }
}

function assertAmount(amountCents: number): void {
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    throw new Error("Project cost amount must be non-negative");
  }
}

async function auditCostItemCreate({
  audit,
  actor,
  item,
  isHighRisk,
}: {
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  item: ProjectCostItemRecord;
  isHighRisk: boolean;
}) {
  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "create",
    module: "complex_cost",
    objectType: "project_cost_item",
    objectId: item.id,
    projectId: item.projectId,
    streamerId: item.streamerId ?? undefined,
    after: item as unknown as Record<string, unknown>,
    changedFields: [
      "item_type",
      "amount_cents",
      "direction",
      "evidence_level",
      "status",
    ],
    reason: item.reason,
    isHighRisk,
  });
}

function importRowItemType(
  row: Record<string, unknown>,
  importType: ProjectCostImportType,
): "cpa" | "cps" | "gift" | "supplier_fee" | "traffic" | "platform_fee" {
  const fromRow = stringFromRow(row, "itemType");
  if (
    fromRow === "cpa" ||
    fromRow === "cps" ||
    fromRow === "gift" ||
    fromRow === "supplier_fee" ||
    fromRow === "traffic" ||
    fromRow === "platform_fee"
  ) {
    return fromRow;
  }
  if (importType === "supplier_bill") {
    return "supplier_fee";
  }
  return importType;
}

function numberFromRow(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringFromRow(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
