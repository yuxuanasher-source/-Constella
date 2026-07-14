import { createHash } from "node:crypto";

import {
  executeCompiledCustomRule,
  type CustomRuleExecutionResult,
} from "./custom-rule-engine";
import {
  applyMissingDataPoliciesBeforeExecution,
  type MissingDataVariableCategory,
  type MissingDataVariableDeclaration,
} from "./custom-rule-missing-data";
import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import type {
  CompiledAstNode,
  CustomRuleMissingDataPolicy,
  ExternalCostRuleResult,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import type {
  ExternalCostRuleExceptionRecord,
  ExternalCostRuleReplayItemInput,
  ProjectCostImportBatchRecord,
  ProjectCostItemType,
  ReplayExternalCostRuleExceptionItemsInput,
} from "@/features/complex-cost/complex-cost-types";
import type {
  ConfirmCostImportExceptionInput,
  ConfirmCostImportItemInput,
} from "@/features/complex-cost/complex-cost-repository";

const MAX_ITEMS_PER_IMPORT_CONFIRMATION = 1_000;

export type ExecuteExternalCostRuleForImportInput = {
  organizationId: string;
  projectId: string;
  importBatch: ProjectCostImportBatchRecord;
  ruleVersion: CustomSettlementRuleVersion;
  reason: string;
  createdBy: string;
};

export type ExecuteExternalCostRuleForImportResult = {
  kind: "custom";
  ruleVersionId: string;
  inputHash: string;
  idempotencyKey: string;
  items: ConfirmCostImportItemInput[];
  exceptions: ConfirmCostImportExceptionInput[];
};

type NormalizedImportContext = {
  rowIndex: number;
  rawRow: Record<string, unknown>;
  variables: Record<string, TypedRuntimeValue>;
  sourceInputHash: string;
  sourceContextHash: string;
};

type ReplaySnapshot = {
  organizationId: string;
  projectId: string;
  importBatchId: string;
  importRowIndex: number;
  ruleVersionId: string;
  compiledAst: CompiledAstNode;
  parameters: Record<string, TypedRuntimeValue>;
  normalizedInputs: Record<string, TypedRuntimeValue>;
  rawRow: Record<string, unknown>;
  streamerId: string | null;
  supplierOrganizationId: string | null;
  liveReportId: string | null;
};

export function executeExternalCostRuleForImport(
  input: ExecuteExternalCostRuleForImportInput,
): ExecuteExternalCostRuleForImportResult {
  const declarations = declarationsFromRuleVersion(input.ruleVersion);
  const parameters = typedParameterValues(input.ruleVersion.parameters);
  const contexts = input.importBatch.parsedPayload.map((row, rowIndex) =>
    normalizeImportRow({
      organizationId: input.organizationId,
      projectId: input.projectId,
      importBatch: input.importBatch,
      ruleVersionId: input.ruleVersion.id,
      row,
      rowIndex,
    }),
  );
  const items: ConfirmCostImportItemInput[] = [];
  const exceptions: ConfirmCostImportExceptionInput[] = [];

  for (const context of contexts) {
    const prepared = applyMissingDataPoliciesBeforeExecution({
      ruleVersionId: input.ruleVersion.id,
      target: { targetType: "project", targetId: null },
      layer: "project_base",
      executionUnitKey: executionUnitKey(input.importBatch.id, context.rowIndex),
      variables: context.variables,
      declarations,
    });

    if (prepared.kind === "blocked") {
      throw new Error(prepared.error.issue.code);
    }

    const replaySnapshot = replaySnapshotForContext({
      input,
      context,
      parameters,
      variables:
        prepared.kind === "ready" ? prepared.variables : context.variables,
    });

    if (prepared.kind === "review") {
      for (const exception of prepared.exceptions) {
        exceptions.push({
          importRowIndex: context.rowIndex,
          ruleVersionId: input.ruleVersion.id,
          variableName: exception.variable,
          policy: "route_item_to_review",
          sourceContextSnapshot: {
            ...replaySnapshot,
            policy: exception.policy,
            variableName: exception.variable,
            normalizedInputs: context.variables,
            __source_context_hash: context.sourceContextHash,
            __confirmation_idempotency_key: confirmationIdempotencyKey({
              organizationId: input.organizationId,
              projectId: input.projectId,
              importBatchId: input.importBatch.id,
              ruleVersionId: input.ruleVersion.id,
              inputHash: context.sourceInputHash,
              mode: "custom",
            }),
          },
        });
      }
      continue;
    }

    const result = executeCostItems(input.ruleVersion, prepared.variables, parameters);
    for (const [outputIndex, item] of result.items.entries()) {
      items.push(
        costItemForOutput({
          context,
          item,
          outputIndex,
          ruleVersion: input.ruleVersion,
          organizationId: input.organizationId,
          projectId: input.projectId,
          importBatchId: input.importBatch.id,
        }),
      );
    }
  }

  if (items.length > MAX_ITEMS_PER_IMPORT_CONFIRMATION) {
    throw new Error("CUSTOM_RULE_OUTPUT_COUNT_CAP_EXCEEDED");
  }

  const inputHash = sha256({
    ruleVersionId: input.ruleVersion.id,
    sourceInputHashes: contexts.map((context) => context.sourceInputHash),
    itemCount: items.length,
    exceptionCount: exceptions.length,
  });

  return {
    kind: "custom",
    ruleVersionId: input.ruleVersion.id,
    inputHash,
    idempotencyKey: confirmationIdempotencyKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      importBatchId: input.importBatch.id,
      ruleVersionId: input.ruleVersion.id,
      inputHash,
      mode: "custom",
    }),
    items,
    exceptions,
  };
}

export function buildExternalCostRuleExceptionReplay(input: {
  organizationId: string;
  projectId: string;
  importBatchId: string;
  importRowIndex: number;
  createdBy: string;
  exceptions: ExternalCostRuleExceptionRecord[];
}): ReplayExternalCostRuleExceptionItemsInput | null {
  if (
    input.exceptions.length === 0 ||
    input.exceptions.some((exception) => exception.status !== "resolved")
  ) {
    return null;
  }

  const sorted = [...input.exceptions].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const first = sorted[0];
  const snapshot = parseReplaySnapshot(first?.sourceContextSnapshot);
  if (!snapshot) {
    throw new Error("CUSTOM_RULE_REPLAY_SNAPSHOT_INVALID");
  }
  const sourceContextHash =
    typeof first?.sourceContextSnapshot.__source_context_hash === "string"
      ? first.sourceContextSnapshot.__source_context_hash
      : null;
  if (!sourceContextHash) {
    throw new Error("CUSTOM_RULE_REPLAY_SOURCE_CONTEXT_HASH_MISSING");
  }

  const variables = { ...snapshot.normalizedInputs };
  const resolutions: Record<string, unknown> = {};
  for (const exception of sorted) {
    const resolution = exception.resolutionValue;
    if (!isTypedRuntimeValue(resolution)) {
      throw new Error("CUSTOM_RULE_REPLAY_RESOLUTION_INVALID");
    }
    variables[exception.variableName] = resolution;
    resolutions[exception.variableName] = resolution;
  }

  const resolutionHash = sha256(resolutions);
  const sourceInputHash = sourceContextHash;
  const result = executeCostItems(
    {
      id: snapshot.ruleVersionId,
      compiledAst: snapshot.compiledAst,
    } as unknown as CustomSettlementRuleVersion,
    variables,
    snapshot.parameters,
  );
  const exceptionIds = sorted.map((exception) => exception.id);
  const items: ExternalCostRuleReplayItemInput[] = result.items.map(
    (item, outputIndex) => ({
      importRowIndex: input.importRowIndex,
      ruleVersionId: snapshot.ruleVersionId,
      streamerId: snapshot.streamerId,
      supplierOrganizationId: snapshot.supplierOrganizationId,
      liveReportId: snapshot.liveReportId,
      itemType: item.category,
      amountCents: item.amountCents,
      direction: "cost",
      evidenceLevel: snapshot.liveReportId ? "green" : "yellow",
      sourcePayload: {
        provenance: {
          source: "custom_rule_import_replay",
          importBatchId: input.importBatchId,
          ruleVersionId: snapshot.ruleVersionId,
          replayedFromExceptions: exceptionIds,
          resolutionHash,
        },
        evidence: evidenceSnapshot(snapshot.liveReportId),
        row: snapshot.rawRow,
        memo: item.memo,
      },
      sourceExecutionKey: stableExecutionKey({
        organizationId: input.organizationId,
        projectId: input.projectId,
        importBatchId: input.importBatchId,
        rowIndex: input.importRowIndex,
        ruleVersionId: snapshot.ruleVersionId,
        outputIndex,
        sourceInputHash,
        exceptionIds,
        resolutionHash,
      }),
      sourceInputHash,
      sourceExplanation: deterministicExplanation(item),
      status: "pending_review",
    }),
  );
  const inputHash = sourceContextHash;

  return {
    organizationId: input.organizationId,
    projectId: input.projectId,
    importBatchId: input.importBatchId,
    importRowIndex: input.importRowIndex,
    idempotencyKey: sha256([
      input.organizationId,
      input.projectId,
      input.importBatchId,
      input.importRowIndex,
      snapshot.ruleVersionId,
      ...exceptionIds,
      inputHash,
    ]),
    inputHash,
    createdBy: input.createdBy,
    items,
  };
}

function executeCostItems(
  ruleVersion: Pick<CustomSettlementRuleVersion, "id" | "compiledAst">,
  variables: Record<string, TypedRuntimeValue>,
  parameters: Record<string, TypedRuntimeValue>,
): ExternalCostRuleResult {
  try {
    const result = executeCompiledCustomRule<CustomRuleExecutionResult>({
      ast: ruleVersion.compiledAst as unknown as CompiledAstNode,
      variables,
      parameters,
    });
    if (result.kind !== "cost_items") {
      throw new Error("External cost rule must emit cost items");
    }
    return result;
  } catch {
    throw new Error("CUSTOM_RULE_EXECUTION_BLOCKED");
  }
}

function costItemForOutput(input: {
  context: NormalizedImportContext;
  item: ExternalCostRuleResult["items"][number];
  outputIndex: number;
  ruleVersion: CustomSettlementRuleVersion;
  organizationId: string;
  projectId: string;
  importBatchId: string;
}): ConfirmCostImportItemInput {
  const row = input.context.rawRow;
  const liveReportId = stringFromRow(row, "liveReportId");
  const sourceInputHash = input.context.sourceInputHash;
  return {
    importRowIndex: input.context.rowIndex,
    ruleVersionId: input.ruleVersion.id,
    streamerId: stringFromRow(row, "streamerId"),
    supplierOrganizationId: stringFromRow(row, "supplierOrganizationId"),
    liveReportId,
    itemType: input.item.category,
    amountCents: input.item.amountCents,
    direction: "cost",
    evidenceLevel: liveReportId ? "green" : "yellow",
    sourcePayload: {
      provenance: {
        source: "custom_rule_import",
        importBatchId: input.importBatchId,
        ruleVersionId: input.ruleVersion.id,
        formulaHash: input.ruleVersion.formulaHash,
      },
      evidence: evidenceSnapshot(liveReportId),
      row,
      memo: input.item.memo,
    },
    sourceExecutionKey: stableExecutionKey({
      organizationId: input.organizationId,
      projectId: input.projectId,
      importBatchId: input.importBatchId,
      rowIndex: input.context.rowIndex,
      ruleVersionId: input.ruleVersion.id,
      outputIndex: input.outputIndex,
      sourceInputHash,
    }),
    sourceInputHash,
    sourceExplanation: deterministicExplanation(input.item),
    status: "pending_review",
  };
}

function normalizeImportRow(input: {
  organizationId: string;
  projectId: string;
  importBatch: ProjectCostImportBatchRecord;
  ruleVersionId: string;
  row: Record<string, unknown>;
  rowIndex: number;
}): NormalizedImportContext {
  const variables: Record<string, TypedRuntimeValue> = {
    project_id: { type: "string", value: input.projectId },
    import_type: { type: "string", value: input.importBatch.importType },
    import_row_index: { type: "integer", value: input.rowIndex },
  };
  setString(variables, "streamer_id", input.row.streamerId);
  setString(variables, "supplier_id", input.row.supplierOrganizationId);
  setString(variables, "report_id", input.row.liveReportId);
  setInteger(variables, "order_count", input.row.unitCount);
  setMoney(variables, "sales_amount", input.row.salesAmountCents);
  setMappedDirectAmount(variables, input.importBatch.importType, input.row);
  const sourceInput = {
    rowIndex: input.rowIndex,
    ruleVersionId: input.ruleVersionId,
    variables,
  };
  const sourceInputHash = sha256(sourceInput);
  return {
    rowIndex: input.rowIndex,
    rawRow: input.row,
    variables,
    sourceInputHash,
    sourceContextHash: sha256({
      organizationId: input.organizationId,
      projectId: input.projectId,
      importBatchId: input.importBatch.id,
      ...sourceInput,
    }),
  };
}

function setMappedDirectAmount(
  variables: Record<string, TypedRuntimeValue>,
  importType: ProjectCostImportBatchRecord["importType"],
  row: Record<string, unknown>,
): void {
  const itemType = stringFromRow(row, "itemType") ?? importType;
  const value = row.directAmountCents;
  if (itemType === "traffic") {
    setMoney(variables, "traffic_cost", value);
  } else if (itemType === "gift") {
    setMoney(variables, "gift_amount", value);
  } else {
    setMoney(variables, "supplier_fee", value);
  }
}

function replaySnapshotForContext(input: {
  input: ExecuteExternalCostRuleForImportInput;
  context: NormalizedImportContext;
  parameters: Record<string, TypedRuntimeValue>;
  variables: Record<string, TypedRuntimeValue>;
}): ReplaySnapshot {
  const row = input.context.rawRow;
  return {
    organizationId: input.input.organizationId,
    projectId: input.input.projectId,
    importBatchId: input.input.importBatch.id,
    importRowIndex: input.context.rowIndex,
    ruleVersionId: input.input.ruleVersion.id,
    compiledAst: input.input.ruleVersion.compiledAst as unknown as CompiledAstNode,
    parameters: input.parameters,
    normalizedInputs: input.variables,
    rawRow: row,
    streamerId: stringFromRow(row, "streamerId"),
    supplierOrganizationId: stringFromRow(row, "supplierOrganizationId"),
    liveReportId: stringFromRow(row, "liveReportId"),
  };
}

function declarationsFromRuleVersion(
  ruleVersion: CustomSettlementRuleVersion,
): MissingDataVariableDeclaration[] {
  const fromPayload = Array.isArray(ruleVersion.variables)
    ? ruleVersion.variables
        .map((entry) => declarationFromUnknown(entry))
        .filter(
          (entry): entry is MissingDataVariableDeclaration => entry !== null,
        )
    : [];
  if (fromPayload.length > 0) {
    return fromPayload.sort((left, right) => left.name.localeCompare(right.name));
  }
  return (ruleVersion.ruleContract.requiredInputs ?? []).map((input) => ({
    name: input.name,
    required: true,
    category: "formula_input",
    valueType: input.valueType,
    missingDataPolicy: ruleVersion.ruleContract.missingDataPolicy,
  }));
}

function declarationFromUnknown(
  value: unknown,
): MissingDataVariableDeclaration | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.variableId === "string"
        ? record.variableId
        : null;
  if (!name || !isRuntimeValueType(record.valueType)) return null;
  return {
    name,
    required: record.required === true,
    category: isMissingDataCategory(record.category)
      ? record.category
      : "formula_input",
    valueType: record.valueType,
    missingDataPolicy: isMissingDataPolicy(record.missingDataPolicy)
      ? record.missingDataPolicy
      : undefined,
  };
}

function parseReplaySnapshot(value: unknown): ReplaySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.organizationId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.importBatchId !== "string" ||
    typeof record.importRowIndex !== "number" ||
    typeof record.ruleVersionId !== "string" ||
    !record.compiledAst ||
    !isTypedRuntimeRecord(record.parameters) ||
    !isTypedRuntimeRecord(record.normalizedInputs)
  ) {
    return null;
  }
  return {
    organizationId: record.organizationId,
    projectId: record.projectId,
    importBatchId: record.importBatchId,
    importRowIndex: record.importRowIndex,
    ruleVersionId: record.ruleVersionId,
    compiledAst: record.compiledAst as CompiledAstNode,
    parameters: record.parameters,
    normalizedInputs: record.normalizedInputs,
    rawRow: isRecord(record.rawRow) ? record.rawRow : {},
    streamerId: nullableString(record.streamerId),
    supplierOrganizationId: nullableString(record.supplierOrganizationId),
    liveReportId: nullableString(record.liveReportId),
  };
}

function typedParameterValues(
  parameters: CustomSettlementRuleVersion["parameters"],
): Record<string, TypedRuntimeValue> {
  return Object.fromEntries(
    Object.entries(parameters ?? {}).filter(
      (entry): entry is [string, TypedRuntimeValue] =>
        isTypedRuntimeValue(entry[1]),
    ),
  );
}

function stableExecutionKey(input: {
  organizationId: string;
  projectId: string;
  importBatchId: string;
  rowIndex: number;
  ruleVersionId: string;
  outputIndex: number;
  sourceInputHash: string;
  exceptionIds?: string[];
  resolutionHash?: string;
}): string {
  return sha256([
    input.organizationId,
    input.projectId,
    input.importBatchId,
    input.rowIndex,
    input.ruleVersionId,
    input.outputIndex,
    input.sourceInputHash,
    ...(input.exceptionIds ?? []),
    ...(input.resolutionHash ? [input.resolutionHash] : []),
  ]);
}

function confirmationIdempotencyKey(input: {
  organizationId: string;
  projectId: string;
  importBatchId: string;
  ruleVersionId: string | null;
  inputHash: string;
  mode: "legacy" | "custom";
}): string {
  return sha256([
    input.organizationId,
    input.projectId,
    input.importBatchId,
    input.mode,
    input.ruleVersionId ?? "legacy",
    input.inputHash,
  ]);
}

function evidenceSnapshot(liveReportId: string | null) {
  if (liveReportId) {
    return { kind: "linked_report", liveReportId };
  }
  return { kind: "import_reference", level: "yellow_review" };
}

function deterministicExplanation(
  item: ExternalCostRuleResult["items"][number],
): string {
  return `Custom external-cost rule emitted ${item.category} for ${item.amountCents} cents: ${item.memo}`;
}

function executionUnitKey(importBatchId: string, rowIndex: number): string {
  return `cost_import:${importBatchId}:row:${rowIndex}`;
}

function setMoney(
  variables: Record<string, TypedRuntimeValue>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    variables[key] = { type: "money_cents", amountCents: value };
  }
}

function setInteger(
  variables: Record<string, TypedRuntimeValue>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    variables[key] = { type: "integer", value };
  }
}

function setString(
  variables: Record<string, TypedRuntimeValue>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string" && value.trim()) {
    variables[key] = { type: "string", value: value.trim() };
  }
}

function stringFromRow(row: Record<string, unknown>, key: string): string | null {
  return nullableString(row[key]);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTypedRuntimeRecord(
  value: unknown,
): value is Record<string, TypedRuntimeValue> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isTypedRuntimeValue(entry))
  );
}

function isTypedRuntimeValue(value: unknown): value is TypedRuntimeValue {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "money_cents":
      return Number.isSafeInteger(value.amountCents);
    case "rate_bps":
      return Number.isSafeInteger(value.rateBps);
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "integer":
      return Number.isSafeInteger(value.value);
    case "boolean":
      return typeof value.value === "boolean";
    case "string":
    case "timestamp":
      return typeof value.value === "string";
    case "array":
      return Array.isArray(value.items) && value.items.every(isTypedRuntimeValue);
    case "object":
      return isTypedRuntimeRecord(value.fields);
    default:
      return false;
  }
}

function isRuntimeValueType(value: unknown): value is RuntimeValueType {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "scalar") {
    return typeof value.scalarType === "string";
  }
  if (value.kind === "array") {
    return isRuntimeValueType(value.itemType);
  }
  return value.kind === "object" && isRecord(value.fields);
}

function isMissingDataPolicy(
  value: unknown,
): value is CustomRuleMissingDataPolicy {
  if (!isRecord(value) || typeof value.action !== "string") return false;
  if (value.action === "route_item_to_review" || value.action === "block_batch") {
    return true;
  }
  return value.action === "use_explicit_default" && isTypedRuntimeValue(value.defaultValue);
}

function isMissingDataCategory(
  value: unknown,
): value is MissingDataVariableCategory {
  return (
    value === "formula_input" ||
    value === "optional_input" ||
    value === "identity" ||
    value === "evidence" ||
    value === "authorization" ||
    value === "provider_data"
  );
}

function sha256(value: unknown): string {
  const text = Array.isArray(value) ? value.join("\u001f") : stableJson(value);
  return createHash("sha256").update(text).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
