import { createHash } from "node:crypto";

import type { AuditLogInput } from "@/lib/audit/audit";

import type {
  ConfirmCostImportItemInput,
  ConfirmCostImportWithRuleItemsInput,
  ConfirmCostImportWithRuleItemsResult,
  ResolveExternalCostRuleExceptionInput,
  ResolveExternalCostRuleExceptionResult,
} from "./complex-cost-repository";
import type {
  ComplexCostActor,
  ComplexCostRuleStatus,
  ComplexCostRuleVersionRecord,
  CreateProjectCostItemInput,
  ExternalCostRuleExceptionRecord,
  ProjectComplexCostEntitlementRecord,
  ProjectCostImportBatchRecord,
  ProjectCostImportType,
  ProjectCostItemRecord,
  ProjectCostItemStatus,
  ReplayExternalCostRuleExceptionItemsInput,
  ReplayExternalCostRuleExceptionItemsResult,
  SettlementReconciliationRunRecord,
} from "./complex-cost-types";
import { calculateImportedCostAmountCents } from "./complex-cost-calculator";
import {
  buildExternalCostRuleExceptionReplay,
  executeExternalCostRuleForImport,
} from "@/features/settlements/custom-rule-external-cost";
import type {
  CustomSettlementRuleVersion,
  ResolvedExecutableCustomRuleLayers,
} from "@/features/settlements/custom-rule-repository";
import type { CustomRuleExecutionUnit } from "@/features/settlements/custom-rule-types";

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
  getProjectCostItemById(
    itemId: string,
  ): Promise<ProjectCostItemRecord | null>;
  updateProjectCostItem(
    itemId: string,
    patch: { status: ProjectCostItemStatus },
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
  listSettlementReconciliationRuns(input: {
    organizationId: string;
    projectId: string;
  }): Promise<SettlementReconciliationRunRecord[]>;
  getExternalCostRuleExceptionById(input: {
    organizationId: string;
    exceptionId: string;
  }): Promise<ExternalCostRuleExceptionRecord | null>;
  resolveExternalCostRuleException(
    input: ResolveExternalCostRuleExceptionInput,
  ): Promise<ResolveExternalCostRuleExceptionResult>;
  listExternalCostRuleExceptionsForImportRow(input: {
    organizationId: string;
    projectId: string;
    importBatchId: string;
    importRowIndex: number;
  }): Promise<ExternalCostRuleExceptionRecord[]>;
  replayExternalCostRuleExceptionItems(
    input: ReplayExternalCostRuleExceptionItemsInput,
  ): Promise<ReplayExternalCostRuleExceptionItemsResult>;
  confirmCostImportWithRuleItems(
    input: ConfirmCostImportWithRuleItemsInput,
  ): Promise<ConfirmCostImportWithRuleItemsResult>;
};

export type ExternalCostRuleReadRepository = {
  resolveExecutableCustomRuleLayers(input: {
    organizationId: string;
    projectId: string;
    scope: "external_cost";
    executionTimestamp: string;
    executionUnits: CustomRuleExecutionUnit[];
  }): Promise<ResolvedExecutableCustomRuleLayers>;
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
    | "getProjectEntitlement"
    | "confirmCostImportWithRuleItems"
  >;
  customRuleRepo?: ExternalCostRuleReadRepository;
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

  const activeExternalRule = await resolveEffectiveExternalCostRule({
    customRuleRepo: args.customRuleRepo,
    actor: args.actor,
    batch,
  });
  const prepared = activeExternalRule
    ? executeExternalCostRuleForImport({
        organizationId: args.actor.organizationId,
        projectId: batch.projectId,
        importBatch: batch,
        ruleVersion: activeExternalRule,
        reason: args.reason.trim(),
        createdBy: args.actor.userId,
      })
    : legacyImportConfirmationPayload({
        actor: args.actor,
        batch,
        reason: args.reason.trim(),
      });

  const confirmed = await args.repo.confirmCostImportWithRuleItems({
    organizationId: args.actor.organizationId,
    projectId: batch.projectId,
    importBatchId: batch.id,
    idempotencyKey: prepared.idempotencyKey,
    inputHash: prepared.inputHash,
    mode: prepared.kind === "custom" ? "custom" : "legacy",
    reason: args.reason.trim(),
    createdBy: args.actor.userId,
    ...(prepared.kind === "custom"
      ? {
          customItems: prepared.items,
          exceptions: prepared.exceptions,
        }
      : { legacyItems: prepared.items }),
  });
  const updatedBatch = confirmed.importBatch;

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
    after: {
      ...(updatedBatch as unknown as Record<string, unknown>),
      mode: prepared.kind,
      ruleVersionId:
        prepared.kind === "custom" ? prepared.ruleVersionId : null,
      itemCount: confirmed.items.length,
      exceptionCount: confirmed.exceptions.length,
      inputHash: prepared.inputHash,
    },
    changedFields: ["status"],
    reason: args.reason,
    isHighRisk: true,
  });

  return { importBatch: updatedBatch, items: confirmed.items };
}

export async function resolveExternalCostRuleExceptionWithReplay(args: {
  repo: Pick<
    ComplexCostRepository,
    | "getProjectEntitlement"
    | "getExternalCostRuleExceptionById"
    | "resolveExternalCostRuleException"
    | "listExternalCostRuleExceptionsForImportRow"
    | "replayExternalCostRuleExceptionItems"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  exceptionId: string;
  resolutionValue: Record<string, unknown>;
  resolutionReason: string;
}): Promise<
  ResolveExternalCostRuleExceptionResult & {
    replay: ReplayExternalCostRuleExceptionItemsResult | null;
  }
> {
  assertCanReviewCostItems(args.actor);
  assertReason(
    args.resolutionReason,
    "Resolving an external cost rule exception requires a reason",
  );

  const before = await args.repo.getExternalCostRuleExceptionById({
    organizationId: args.actor.organizationId,
    exceptionId: args.exceptionId,
  });
  if (!before) {
    throw new Error("External cost rule exception not found");
  }
  assertSameOrganization(args.actor, before.organizationId);
  await requireProjectEntitlement(args.repo, args.actor, before.projectId);

  const resolved = await args.repo.resolveExternalCostRuleException({
    organizationId: args.actor.organizationId,
    exceptionId: args.exceptionId,
    resolutionValue: args.resolutionValue,
    resolutionReason: args.resolutionReason.trim(),
    resolvedBy: args.actor.userId,
  });
  assertSameOrganization(args.actor, resolved.exception.organizationId);

  if (!resolved.needsReplay || resolved.openSiblingCount !== 0) {
    await auditExternalCostRuleExceptionResolution({
      audit: args.audit,
      actor: args.actor,
      before,
      resolved,
      replayInputHash: null,
      replayedItemSourceInputHashes: [],
      replayedItemExecutionKeys: [],
      replayedItemCount: 0,
      reason: args.resolutionReason.trim(),
    });
    return { ...resolved, replay: null };
  }

  const siblings = await args.repo.listExternalCostRuleExceptionsForImportRow({
    organizationId: args.actor.organizationId,
    projectId: resolved.exception.projectId,
    importBatchId: resolved.exception.importBatchId,
    importRowIndex: resolved.exception.importRowIndex,
  });
  const replayInput = buildExternalCostRuleExceptionReplay({
    organizationId: args.actor.organizationId,
    projectId: resolved.exception.projectId,
    importBatchId: resolved.exception.importBatchId,
    importRowIndex: resolved.exception.importRowIndex,
    createdBy: args.actor.userId,
    exceptions: siblings,
  });
  if (!replayInput) {
    await auditExternalCostRuleExceptionResolution({
      audit: args.audit,
      actor: args.actor,
      before,
      resolved,
      replayInputHash: null,
      replayedItemSourceInputHashes: [],
      replayedItemExecutionKeys: [],
      replayedItemCount: 0,
      reason: args.resolutionReason.trim(),
    });
    return { ...resolved, replay: null };
  }

  const replay = await args.repo.replayExternalCostRuleExceptionItems(
    replayInput,
  );
  await auditExternalCostRuleExceptionResolution({
    audit: args.audit,
    actor: args.actor,
    before,
    resolved,
    replayInputHash: replayInput.inputHash,
    replayedItemSourceInputHashes: replayInput.items.map(
      (item) => item.sourceInputHash,
    ),
    replayedItemExecutionKeys: replayInput.items.map(
      (item) => item.sourceExecutionKey,
    ),
    replayedItemCount: replay.items.length,
    reason: args.resolutionReason.trim(),
  });

  return {
    ...resolved,
    items: [...resolved.items, ...replay.items],
    replayed: true,
    replay,
  };
}

async function auditExternalCostRuleExceptionResolution(input: {
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  before: ExternalCostRuleExceptionRecord;
  resolved: ResolveExternalCostRuleExceptionResult;
  replayInputHash: string | null;
  replayedItemSourceInputHashes: string[];
  replayedItemExecutionKeys: string[];
  replayedItemCount: number;
  reason: string;
}): Promise<void> {
  await input.audit({
    organizationId: input.actor.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    action: "approve",
    module: "complex_cost",
    objectType: "external_cost_rule_exception",
    objectId: input.resolved.exception.id,
    projectId: input.resolved.exception.projectId,
    before: {
      status: input.before.status,
      importBatchId: input.before.importBatchId,
      importRowIndex: input.before.importRowIndex,
      ruleVersionId: input.before.ruleVersionId ?? null,
      sourceContextHash: sourceContextHashFromException(input.before),
    },
    after: {
      status: input.resolved.exception.status,
      importBatchId: input.resolved.exception.importBatchId,
      importRowIndex: input.resolved.exception.importRowIndex,
      ruleVersionId: input.resolved.exception.ruleVersionId ?? null,
      needsReplay: input.resolved.needsReplay,
      openSiblingCount: input.resolved.openSiblingCount,
      replayed: input.resolved.replayed || input.replayedItemCount > 0,
      replayedItemCount: input.replayedItemCount,
      sourceContextHash: sourceContextHashFromException(input.resolved.exception),
      replayInputHash: input.replayInputHash,
      replayedItemSourceInputHashes: input.replayedItemSourceInputHashes,
      replayedItemExecutionKeys: input.replayedItemExecutionKeys,
    },
    changedFields: ["status", "resolution_value", "resolution_reason", "replay"],
    reason: input.reason,
    isHighRisk: true,
  });
}

function sourceContextHashFromException(
  exception: ExternalCostRuleExceptionRecord,
): string | null {
  const value = exception.sourceContextSnapshot.__source_context_hash;
  return typeof value === "string" ? value : null;
}

type PreparedImportConfirmation =
  | {
      kind: "legacy";
      inputHash: string;
      idempotencyKey: string;
      items: ConfirmCostImportItemInput[];
    }
  | ReturnType<typeof executeExternalCostRuleForImport>;

function legacyImportConfirmationPayload(input: {
  actor: ComplexCostActor;
  batch: ProjectCostImportBatchRecord;
  reason: string;
}): PreparedImportConfirmation {
  const items = input.batch.parsedPayload.map((row, rowIndex) => {
    const itemType = importRowItemType(row, input.batch.importType);
    const amountCents = calculateImportedCostAmountCents({
      itemType,
      unitCount: numberFromRow(row, "unitCount"),
      unitPriceCents: numberFromRow(row, "unitPriceCents"),
      salesAmountCents: numberFromRow(row, "salesAmountCents"),
      rateBps: numberFromRow(row, "rateBps"),
      directAmountCents: numberFromRow(row, "directAmountCents"),
    });
    const sourceInputHash = serviceHash({
      mode: "legacy",
      rowIndex,
      row,
      itemType,
      amountCents,
    });
    return {
      importRowIndex: rowIndex,
      ruleVersionId: null,
      streamerId: stringFromRow(row, "streamerId"),
      supplierOrganizationId: stringFromRow(row, "supplierOrganizationId"),
      liveReportId: stringFromRow(row, "liveReportId"),
      itemType,
      amountCents,
      direction: "cost" as const,
      evidenceLevel: "yellow" as const,
      sourcePayload: row,
      sourceExecutionKey: serviceHash([
        input.actor.organizationId,
        input.batch.projectId,
        input.batch.id,
        rowIndex,
        "legacy",
        0,
        sourceInputHash,
      ]),
      sourceInputHash,
      sourceExplanation: "Legacy complex-cost import calculation.",
      status: "confirmed" as const,
    };
  });
  const inputHash = serviceHash({
    mode: "legacy",
    importBatchId: input.batch.id,
    items: items.map((item) => ({
      row: item.importRowIndex,
      type: item.itemType,
      amount: item.amountCents,
      sourceInputHash: item.sourceInputHash,
    })),
  });
  return {
    kind: "legacy",
    inputHash,
    idempotencyKey: serviceHash([
      input.actor.organizationId,
      input.batch.projectId,
      input.batch.id,
      "legacy",
      "legacy",
      inputHash,
    ]),
    items,
  };
}

async function resolveEffectiveExternalCostRule(input: {
  customRuleRepo?: ExternalCostRuleReadRepository;
  actor: ComplexCostActor;
  batch: ProjectCostImportBatchRecord;
}): Promise<CustomSettlementRuleVersion | null> {
  if (!input.customRuleRepo) {
    return null;
  }
  const executionTimestamp =
    input.batch.createdAt ?? new Date().toISOString();
  const lookup = await input.customRuleRepo.resolveExecutableCustomRuleLayers({
    organizationId: input.actor.organizationId,
    projectId: input.batch.projectId,
    scope: "external_cost",
    executionTimestamp,
    executionUnits: [
      {
        key: `cost_import:${input.batch.id}`,
        grain: "report",
        projectId: input.batch.projectId,
        projectStreamerId: "import",
        streamerId: undefined,
        periodStart: executionTimestamp,
        periodEnd: executionTimestamp,
        sourceReportIds: [],
        membershipSnapshot: {
          projectStreamerId: "import",
          effectiveAt: executionTimestamp,
          groups: [],
          snapshotHash: serviceHash({
            importBatchId: input.batch.id,
            executionTimestamp,
          }),
        },
        variables: {},
      },
    ],
  });
  const version = lookup.projectBaseVersion;
  if (!version || version.scope !== "external_cost") {
    return null;
  }
  return version;
}

// Transition a manual project cost item's review status (pending_review/draft
// -> confirmed, or any open status -> voided). Without this, manually-entered
// external costs are created as pending_review and can never become confirmed,
// so they never enter the §3.4 reconciliation or a settlement batch (which both
// only count confirmed items) — the external-cost loop stays broken.
const COST_ITEM_REVIEW_TARGETS: ProjectCostItemStatus[] = ["confirmed", "voided"];

export async function updateProjectCostItemStatus(args: {
  repo: Pick<
    ComplexCostRepository,
    "getProjectCostItemById" | "updateProjectCostItem" | "getProjectEntitlement"
  >;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  itemId: string;
  status: ProjectCostItemStatus;
  reason: string;
}): Promise<ProjectCostItemRecord> {
  assertCanReviewCostItems(args.actor);
  if (!COST_ITEM_REVIEW_TARGETS.includes(args.status)) {
    throw new Error("Project cost item status must be confirmed or voided");
  }
  assertReason(args.reason, "Reviewing a project cost item requires a reason");

  const before = await args.repo.getProjectCostItemById(args.itemId);
  if (!before) {
    throw new Error("Project cost item not found");
  }
  assertSameOrganization(args.actor, before.organizationId);
  await requireProjectEntitlement(args.repo, args.actor, before.projectId);

  assertCostItemTransition(before.status, args.status);

  const after = await args.repo.updateProjectCostItem(args.itemId, {
    status: args.status,
  });

  await args.audit({
    organizationId: args.actor.organizationId,
    actorUserId: args.actor.userId,
    actorName: args.actor.name,
    actorRole: args.actor.role,
    action: args.status === "confirmed" ? "approve" : "void",
    module: "complex_cost",
    objectType: "project_cost_item",
    objectId: after.id,
    projectId: after.projectId,
    streamerId: after.streamerId ?? undefined,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    changedFields: ["status"],
    reason: args.reason,
    isHighRisk: true,
  });

  return after;
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

function assertCanReviewCostItems(actor: ComplexCostActor): void {
  if (actor.role !== "owner" && actor.role !== "ops_manager") {
    throw new Error("Current role cannot review project cost items");
  }
}

// Allowed status transitions: open items (draft/pending_review) may be
// confirmed; open or confirmed items may be voided. Re-confirming or
// re-voiding a terminal state is rejected.
function assertCostItemTransition(
  from: ProjectCostItemStatus,
  to: ProjectCostItemStatus,
): void {
  if (to === "confirmed") {
    if (from !== "draft" && from !== "pending_review") {
      throw new Error(
        `Cannot confirm a project cost item in status ${from}`,
      );
    }
    return;
  }
  if (to === "voided") {
    if (from === "voided") {
      throw new Error("Project cost item is already voided");
    }
    return;
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

function serviceHash(value: unknown): string {
  const text = Array.isArray(value) ? value.join("\u001f") : stableServiceJson(value);
  return createHash("sha256").update(text).digest("hex");
}

function stableServiceJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableServiceJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableServiceJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
