import { createHash } from "node:crypto";

import type { AuditLogInput } from "@/lib/audit/audit";
import { isMcnStaff, type AppRole } from "@/lib/rbac/roles";

import { compiledAstNodeSchema, typedRuntimeValueSchema } from "./custom-rule-contract";
import { executeCompiledCustomRule } from "./custom-rule-engine";
import {
  centsToLegacyYuan,
  yuanToCentsStrict,
  type TypedRuntimeValue,
} from "./custom-rule-types";
import type {
  SettlementActor,
  SettlementAuditWriter,
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementRepository,
  SettlementRuleExceptionRecord,
} from "./settlement-service";

type ListSettlementRuleExceptionsRepository = {
  listSettlementRuleExceptions(input: {
    organizationId: string;
    batchId: string;
  }): Promise<SettlementRuleExceptionRecord[]>;
};

type ResolveSettlementRuleExceptionRepository = Pick<
  SettlementRepository,
  "getSettlementBatchById" | "listSettlementBatchItems"
> &
  ListSettlementRuleExceptionsRepository & {
    resolveSettlementRuleException(
      input: Parameters<
        NonNullable<SettlementRepository["resolveSettlementRuleException"]>
      >[0],
    ): ReturnType<
      NonNullable<SettlementRepository["resolveSettlementRuleException"]>
    >;
  };

type OpenRuleExceptionGateRepository = {
  hasOpenSettlementRuleExceptions(input: {
    organizationId: string;
    batchId: string;
  }): Promise<boolean>;
};

export type SettlementRuleExceptionResolutionResult = {
  batch: SettlementBatchRecord;
  item: SettlementBatchItemRecord;
  exception: SettlementRuleExceptionRecord;
  amountDelta: number;
  idempotent: boolean;
};

export async function listSettlementRuleExceptions({
  repo,
  actor,
  batchId,
}: {
  repo: ListSettlementRuleExceptionsRepository;
  actor: SettlementActor;
  batchId: string;
}): Promise<SettlementRuleExceptionRecord[]> {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can view settlement rule exceptions");
  }

  const exceptions = await repo.listSettlementRuleExceptions({
    organizationId: actor.organizationId,
    batchId,
  });

  return exceptions.filter(
    (exception) =>
      exception.organizationId === actor.organizationId &&
      exception.settlementBatchId === batchId,
  );
}

export async function resolveSettlementRuleException({
  repo,
  audit,
  actor,
  batchId,
  exceptionId,
  input,
}: {
  repo: ResolveSettlementRuleExceptionRepository;
  audit: SettlementAuditWriter;
  actor: SettlementActor;
  batchId: string;
  exceptionId: string;
  input: {
    resolutionValue: unknown;
    reason: string;
  };
}): Promise<SettlementRuleExceptionResolutionResult> {
  assertResolverRole(actor.role);
  assertReason(input.reason);
  const resolutionValue = parseResolutionValue(input.resolutionValue);
  const batch = await requireOpenResolutionBatch(repo, batchId, actor);
  const exceptions = await listSettlementRuleExceptions({
    repo,
    actor,
    batchId,
  });
  const exception = exceptions.find((candidate) => candidate.id === exceptionId);
  if (!exception) {
    throw new Error("Settlement rule exception not found");
  }

  const items = await repo.listSettlementBatchItems(batchId);
  const item = items.find(
    (candidate) =>
      candidate.id === exception.settlementBatchItemId &&
      candidate.organizationId === actor.organizationId &&
      candidate.settlementBatchId === batchId,
  );
  if (!item) {
    throw new Error("Settlement rule exception not found");
  }

  if (exception.status === "resolved") {
    if (sameJson(exception.resolutionValue, resolutionValue)) {
      return {
        batch,
        item,
        exception,
        amountDelta: 0,
        idempotent: true,
      };
    }
    throw new Error(
      "Settlement rule exception was already resolved with a different value",
    );
  }
  if (exception.status !== "review_required") {
    throw new Error("Settlement rule exception is not open for resolution");
  }

  const siblingExceptions = exceptions.filter(
    (candidate) =>
      candidate.settlementBatchItemId === exception.settlementBatchItemId &&
      candidate.id !== exception.id,
  );
  const openSiblingCount = siblingExceptions.filter(
    (candidate) => candidate.status === "review_required",
  ).length;
  const resolvedSiblingValues = resolvedSiblingValuesByVariable(siblingExceptions);
  const replay =
    openSiblingCount > 0
      ? {
          oldAmountCents: yuanToCentsStrict(item.computedAmount),
          newAmountCents: yuanToCentsStrict(item.computedAmount),
          newComputedAmount: item.computedAmount,
        }
      : replaySnapshottedLayer({
          exception,
          item,
          resolutionValue,
          resolvedSiblingValues,
        });
  if (
    actor.role === "operator_business" &&
    replay.newComputedAmount !== item.computedAmount
  ) {
    throw new Error(
      "Current role cannot resolve money-changing settlement rule exceptions",
    );
  }

  const resolved = await repo.resolveSettlementRuleException({
    organizationId: actor.organizationId,
    exceptionId: exception.id,
    settlementBatchItemId: item.id,
    oldComputedAmount: item.computedAmount,
    newComputedAmount: replay.newComputedAmount,
    resolutionValue,
    resolutionReason: input.reason.trim(),
    resolvedBy: actor.userId,
  });

  await auditResolution({
    audit,
    actor,
    batch,
    item,
    exception,
    resolutionValue,
    reason: input.reason.trim(),
    oldAmountCents: replay.oldAmountCents,
    newAmountCents: replay.newAmountCents,
  });

  return {
    ...resolved,
    amountDelta: replay.newComputedAmount - item.computedAmount,
    idempotent: false,
  };
}

export function createSettlementBatchRuleExceptionGate({
  repo,
  organizationId,
}: {
  repo: OpenRuleExceptionGateRepository;
  organizationId: string;
}) {
  return {
    async assertNoOpenRuleExceptions(batchId: string): Promise<void> {
      const hasOpen = await repo.hasOpenSettlementRuleExceptions({
        organizationId,
        batchId,
      });
      if (hasOpen) {
        throw new Error("Settlement batch has unresolved rule exceptions");
      }
    },
  };
}

async function requireOpenResolutionBatch(
  repo: Pick<SettlementRepository, "getSettlementBatchById">,
  batchId: string,
  actor: SettlementActor,
): Promise<SettlementBatchRecord> {
  const batch = await repo.getSettlementBatchById(batchId);
  if (!batch || batch.organizationId !== actor.organizationId) {
    throw new Error("Settlement batch not found");
  }
  if (
    batch.status === "confirmed" ||
    batch.status === "locked" ||
    batch.status === "voided"
  ) {
    throw new Error(
      "Settlement batch is no longer open for rule exception resolution",
    );
  }
  return batch;
}

function replaySnapshottedLayer({
  exception,
  item,
  resolutionValue,
  resolvedSiblingValues,
}: {
  exception: SettlementRuleExceptionRecord;
  item: SettlementBatchItemRecord;
  resolutionValue: TypedRuntimeValue;
  resolvedSiblingValues: Record<string, TypedRuntimeValue>;
}): {
  oldAmountCents: number;
  newAmountCents: number;
  newComputedAmount: number;
} {
  const layer = exception.layerSnapshot;
  const compiledAst = compiledAstNodeSchema.safeParse(layer.compiledAst);
  if (!compiledAst.success) {
    throw new Error("Settlement rule exception snapshot cannot be replayed safely");
  }
  assertSnapshotHash(compiledAst.data, layer);

  const variables = {
    ...parseTypedInputs(layer.typedInputs),
    ...parseTypedInputs(readRuleEngineFallbackTypedInputs(item)),
    ...resolvedSiblingValues,
    [exception.variableName]: resolutionValue,
  };
  const replayLayers = replayLayersFromSnapshot(layer, compiledAst.data);
  let runningAmountCents = priorLayerAmountCents(variables);
  for (const replayLayer of replayLayers) {
    const layerVariables = {
      ...variables,
      prior_layer_amount: {
        type: "money_cents",
        amountCents: runningAmountCents,
      } satisfies TypedRuntimeValue,
    };
    const result = executeCompiledCustomRule({
      ast: replayLayer.compiledAst,
      variables: layerVariables,
      parameters: replayLayer.parameters,
    });
    const outputAmountCents = result.componentsCents.final;
    if (!Number.isSafeInteger(outputAmountCents)) {
      throw new Error("Settlement rule exception produced an unsafe amount");
    }
    runningAmountCents =
      replayLayer.composition === "add"
        ? runningAmountCents + outputAmountCents
        : outputAmountCents;
  }
  const newAmountCents = runningAmountCents;
  if (!Number.isSafeInteger(newAmountCents)) {
    throw new Error("Settlement rule exception produced an unsafe amount");
  }

  return {
    oldAmountCents: yuanToCentsStrict(item.computedAmount),
    newAmountCents,
    newComputedAmount: centsToLegacyYuan(newAmountCents),
  };
}

type ReplayLayer = {
  compiledAst: ReturnType<typeof compiledAstNodeSchema.parse>;
  parameters: Record<string, TypedRuntimeValue>;
  composition: "replace" | "add" | "multiply" | "clamp";
};

function replayLayersFromSnapshot(
  layer: Record<string, unknown>,
  fallbackCompiledAst: ReplayLayer["compiledAst"],
): ReplayLayer[] {
  const rawLayers = Array.isArray(layer.replayLayers)
    ? layer.replayLayers
    : [layer];
  return rawLayers.map((rawLayer) => {
    if (!isRecord(rawLayer)) {
      throw new Error("Settlement rule exception snapshot cannot be replayed safely");
    }
    const compiledAst = compiledAstNodeSchema.safeParse(
      rawLayer.compiledAst ?? fallbackCompiledAst,
    );
    if (!compiledAst.success) {
      throw new Error("Settlement rule exception snapshot cannot be replayed safely");
    }
    assertSnapshotHash(compiledAst.data, rawLayer);
    return {
      compiledAst: compiledAst.data,
      parameters: parseTypedInputs(rawLayer.parameters),
      composition: replayComposition(rawLayer.composition),
    };
  });
}

function replayComposition(value: unknown): ReplayLayer["composition"] {
  if (
    value === "replace" ||
    value === "add" ||
    value === "multiply" ||
    value === "clamp"
  ) {
    return value;
  }
  return "replace";
}

function priorLayerAmountCents(
  variables: Record<string, TypedRuntimeValue>,
): number {
  const value = variables.prior_layer_amount;
  return value?.type === "money_cents" ? value.amountCents : 0;
}

function resolvedSiblingValuesByVariable(
  exceptions: SettlementRuleExceptionRecord[],
): Record<string, TypedRuntimeValue> {
  const values: Record<string, TypedRuntimeValue> = {};
  for (const exception of exceptions) {
    if (exception.status !== "resolved" || exception.resolutionValue === null) {
      continue;
    }
    values[exception.variableName] = parseResolutionValue(
      exception.resolutionValue,
    );
  }
  return values;
}

function parseResolutionValue(value: unknown): TypedRuntimeValue {
  const parsed = typedRuntimeValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("resolutionValue must be a typed runtime value");
  }
  return parsed.data;
}

function parseTypedInputs(value: unknown): Record<string, TypedRuntimeValue> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, candidate]) => {
        const parsed = typedRuntimeValueSchema.safeParse(candidate);
        return parsed.success ? ([key, parsed.data] as const) : null;
      })
      .filter((entry): entry is readonly [string, TypedRuntimeValue] =>
        Boolean(entry),
      ),
  );
}

function readRuleEngineFallbackTypedInputs(
  item: SettlementBatchItemRecord,
): unknown {
  const ruleEngine = isRecord(item.evidenceSnapshot.ruleEngine)
    ? item.evidenceSnapshot.ruleEngine
    : null;
  const typedInputs = ruleEngine?.typedInputs;
  if (Array.isArray(typedInputs)) {
    return typedInputs.find(isRecord) ?? {};
  }
  return typedInputs;
}

function assertSnapshotHash(
  compiledAst: unknown,
  layer: Record<string, unknown>,
): void {
  const compiledAstHash =
    typeof layer.compiledAstHash === "string" ? layer.compiledAstHash : null;
  const activeCompiledAstHash =
    typeof layer.activeCompiledAstHash === "string"
      ? layer.activeCompiledAstHash
      : compiledAstHash;
  if (!compiledAstHash) {
    return;
  }
  const actualHash = hash(compiledAst);
  if (compiledAstHash !== actualHash || activeCompiledAstHash !== compiledAstHash) {
    throw new Error("Settlement rule exception snapshot cannot be replayed safely");
  }
}

async function auditResolution({
  audit,
  actor,
  batch,
  item,
  exception,
  resolutionValue,
  reason,
  oldAmountCents,
  newAmountCents,
}: {
  audit: SettlementAuditWriter;
  actor: SettlementActor;
  batch: SettlementBatchRecord;
  item: SettlementBatchItemRecord;
  exception: SettlementRuleExceptionRecord;
  resolutionValue: TypedRuntimeValue;
  reason: string;
  oldAmountCents: number;
  newAmountCents: number;
}): Promise<void> {
  const before: AuditLogInput["before"] = {
    exceptionStatus: exception.status,
    amountCents: oldAmountCents,
    source: "snapshotted_rule_exception",
    ruleVersionId: exception.ruleVersionId,
    settlementBatchItemId: item.id,
  };
  const after: AuditLogInput["after"] = {
    exceptionStatus: "resolved",
    amountCents: newAmountCents,
    source: "snapshotted_rule_exception",
    ruleVersionId: exception.ruleVersionId,
    resolutionValue,
    resolvedBy: actor.userId,
  };

  await audit({
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: actor.role,
    action: "update",
    module: "settlement",
    objectType: "settlement_rule_exception",
    objectId: exception.id,
    projectId: batch.projectId,
    before,
    after,
    changedFields: [
      "status",
      "computed_amount",
      "resolution_value",
      "resolution_reason",
      "resolved_by",
    ],
    reason,
    isHighRisk: true,
  });
}

function assertResolverRole(role: AppRole): void {
  if (
    role !== "owner" &&
    role !== "ops_manager" &&
    role !== "finance"
  ) {
    throw new Error(
      "Current role cannot resolve settlement rule exceptions",
    );
  }
}

function assertReason(reason: string): void {
  if (!reason.trim()) {
    throw new Error("Resolving a settlement rule exception requires a reason");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
