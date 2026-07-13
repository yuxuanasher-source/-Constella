import {
  businessRuleContractSchema,
  type BusinessRuleContract,
} from "./custom-rule-contract";
import type {
  CustomRuleCompositionMode,
  CustomRuleExecutionGrain,
  CustomRuleScope,
  CustomRuleVersionStatus,
  RuntimeScalarType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import {
  centsToLegacyYuan,
  percentToBpsStrict,
  yuanToCentsStrict,
} from "./custom-rule-types";
import {
  hashCustomRuleContract,
  hashCustomRuleParameters,
} from "./custom-rule-simulation";

export type RuleParameterDefinition = {
  key: string;
  labelZh: string;
  type: "money_cents" | "rate_bps" | "integer" | "number";
  value: number;
  min?: number;
  max?: number;
};

export type RuleParameterEdit = Pick<
  RuleParameterDefinition,
  "key" | "type" | "value"
>;

export type RuleParameterUiDefinition = Omit<
  RuleParameterDefinition,
  "type"
> & {
  type: "money_yuan" | "percent" | "integer" | "number";
};

export type ReusableRuleVersion = {
  id: string;
  organizationId: string;
  projectId: string;
  scope: CustomRuleScope;
  target: { targetType: "project"; targetId: null } | {
    targetType: "streamer_group" | "project_streamer";
    targetId: string;
  };
  executionGrain: CustomRuleExecutionGrain;
  compositionMode: CustomRuleCompositionMode;
  priority: number;
  versionNumber: number;
  status: CustomRuleVersionStatus;
  formula: string;
  compiledAst: unknown;
  variables: unknown[];
  parameters: Record<string, TypedRuntimeValue>;
  parameterDefinitions?: RuleParameterDefinition[];
  ruleContract: BusinessRuleContract;
  systemExplanationTemplate: string;
  missingDataPolicy: Record<string, unknown>;
  testCases: unknown[];
  simulationSummary: Record<string, unknown>;
  formulaHash: string;
  contractHash: string;
  parameterHash: string;
  catalogHash: string;
  dataSelectionHash: string;
  variableCatalogVersion?: string;
  simulationId: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  createdBy: string;
  approvedBy: string | null;
  aiDraftId: string | null;
  reason: string | null;
  createdAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
};

export type EditableReusableRuleDraft = Omit<
  ReusableRuleVersion,
  | "status"
  | "simulationId"
  | "approvedBy"
  | "approvedAt"
  | "effectiveFrom"
  | "effectiveUntil"
  | "archivedAt"
  | "aiDraftId"
> & {
  status: "draft";
  simulationId: null;
  approvedBy: null;
  approvedAt: null;
  effectiveFrom: null;
  effectiveUntil: null;
  archivedAt: null;
  aiDraftId: null;
};

export type CloneRuleVersionToEditableDraftResult = {
  version: EditableReusableRuleDraft;
  lineage: {
    sourceRuleVersionId: string;
    sourceProjectId: string;
    sourceVersionNumber: number;
    sourceScope: CustomRuleScope;
  };
  missingTargetVariables: string[];
};

export type OrganizationRuleTemplate = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sourceRuleVersionId: string | null;
  sourceProjectId: string | null;
  sourceVersionNumber: number | null;
  sourceScope: CustomRuleScope | null;
  executionGrain: CustomRuleExecutionGrain;
  compositionMode: CustomRuleCompositionMode;
  formula: string;
  compiledAst: unknown;
  variables: unknown[];
  parameters: Record<string, TypedRuntimeValue>;
  ruleContract: BusinessRuleContract;
  missingDataPolicy: Record<string, unknown>;
  testCases: unknown[];
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
};

export type ReusableSettlementRuleTemplateDto =
  | {
      kind: "system";
      id: string;
      name: string;
      description: string;
      contract: BusinessRuleContract;
      readOnly: true;
    }
  | (OrganizationRuleTemplate & {
      kind: "organization";
      readOnly: false;
    });

export class CustomRuleTemplateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomRuleTemplateError";
  }
}

export function cloneRuleVersionToEditableDraft(input: {
  sourceVersion: ReusableRuleVersion;
  targetProjectId: string;
  targetCatalog: {
    version: string;
    variables: readonly {
      id: string;
      availability?: "available" | "partial" | "unavailable" | "not_applicable";
    }[];
  };
  newVersionId: string;
  reason: string;
}): CloneRuleVersionToEditableDraftResult {
  const contract = rebindContractToProject(input.sourceVersion.ruleContract);
  const availableTargetVariables = new Set(
    input.targetCatalog.variables
      .filter(
        (variable) =>
          variable.availability === undefined ||
          variable.availability === "available" ||
          variable.availability === "partial",
      )
      .map((variable) => variable.id),
  );
  const missingTargetVariables = contract.requiredInputs
    .map((requiredInput) => requiredInput.name)
    .filter((name) => !availableTargetVariables.has(name))
    .sort();
  const parameterDefinitions =
    input.sourceVersion.parameterDefinitions ??
    deriveParameterDefinitionsFromContract(contract);
  const parameters = materializeParameters(parameterDefinitions);

  return {
    version: {
      ...clonePlain(input.sourceVersion),
      id: input.newVersionId,
      projectId: input.targetProjectId,
      target: { targetType: "project", targetId: null },
      versionNumber: 1,
      status: "draft",
      parameters,
      parameterDefinitions,
      ruleContract: contract,
      simulationSummary: {},
      contractHash: hashCustomRuleContract(contract),
      parameterHash: hashCustomRuleParameters(parameters),
      catalogHash: input.targetCatalog.version,
      variableCatalogVersion: input.targetCatalog.version,
      dataSelectionHash: "0".repeat(64),
      simulationId: null,
      effectiveFrom: null,
      effectiveUntil: null,
      approvedBy: null,
      approvedAt: null,
      archivedAt: null,
      aiDraftId: null,
      reason: input.reason,
    },
    lineage: {
      sourceRuleVersionId: input.sourceVersion.id,
      sourceProjectId: input.sourceVersion.projectId,
      sourceVersionNumber: input.sourceVersion.versionNumber,
      sourceScope: input.sourceVersion.scope,
    },
    missingTargetVariables,
  };
}

export function assertTemplateSimulationReady(input: {
  missingTargetVariables: readonly string[];
}): void {
  if (input.missingTargetVariables.length > 0) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_TEMPLATE_TARGET_VARIABLES_MISSING",
      `Target project is missing variables required for simulation: ${[
        ...input.missingTargetVariables,
      ].join(", ")}`,
    );
  }
}

export function applyRuleParameterEdits(input: {
  sourceVersion: ReusableRuleVersion;
  definitions: readonly RuleParameterDefinition[];
  edits: readonly RuleParameterEdit[];
  newVersionId: string;
  reason: string;
}): {
  version: EditableReusableRuleDraft;
  priorSimulationStale: true;
} {
  const definitions = normalizeRuleParameterDefinitions(input.definitions);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const nextDefinitions = definitions.map((definition) => ({ ...definition }));

  for (const edit of input.edits) {
    const definition = byKey.get(edit.key);
    if (!definition) {
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_UNKNOWN",
        `Unknown rule parameter: ${edit.key}`,
      );
    }
    if (definition.type !== edit.type) {
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_TYPE_MISMATCH",
        `Parameter ${edit.key} type must remain ${definition.type}`,
      );
    }
    validateParameterNumber(edit, definition);
    const target = nextDefinitions.find((item) => item.key === edit.key);
    if (!target) throw new Error("normalized parameter definition disappeared");
    target.value = edit.value;
  }

  const parameters = materializeParameters(nextDefinitions);
  return {
    version: {
      ...clonePlain(input.sourceVersion),
      id: input.newVersionId,
      versionNumber: input.sourceVersion.versionNumber + 1,
      status: "draft",
      parameters,
      parameterDefinitions: nextDefinitions,
      parameterHash: hashCustomRuleParameters(parameters),
      simulationSummary: {},
      dataSelectionHash: "0".repeat(64),
      simulationId: null,
      effectiveFrom: null,
      effectiveUntil: null,
      approvedBy: null,
      approvedAt: null,
      archivedAt: null,
      aiDraftId: null,
      reason: input.reason,
    },
    priorSimulationStale: true,
  };
}

export function parameterDefinitionsToUiDto(
  definitions: readonly RuleParameterDefinition[],
): RuleParameterUiDefinition[] {
  return normalizeRuleParameterDefinitions(definitions).map((definition) => ({
    ...definition,
    type: parameterTypeToUiType(definition.type),
    value: parameterValueToUiValue(definition.type, definition.value),
    min:
      definition.min === undefined
        ? undefined
        : parameterValueToUiValue(definition.type, definition.min),
    max:
      definition.max === undefined
        ? undefined
        : parameterValueToUiValue(definition.type, definition.max),
  }));
}

export function parameterDefinitionsFromUiDto(
  definitions: readonly RuleParameterUiDefinition[],
): RuleParameterDefinition[] {
  return normalizeRuleParameterDefinitions(
    definitions.map((definition) => ({
      ...definition,
      type: uiTypeToParameterType(definition.type),
      value: uiValueToParameterValue(definition.type, definition.value),
      min:
        definition.min === undefined
          ? undefined
          : uiValueToParameterValue(definition.type, definition.min),
      max:
        definition.max === undefined
          ? undefined
          : uiValueToParameterValue(definition.type, definition.max),
    })),
  );
}

export function materializeParameterDefinitionsForPersistence(
  definitions: readonly RuleParameterDefinition[],
): Record<string, TypedRuntimeValue> {
  return materializeParameters(definitions);
}

export function normalizeRuleParameterDefinitions(
  definitions: readonly RuleParameterDefinition[],
): RuleParameterDefinition[] {
  const keys = new Set<string>();
  return definitions.map((definition) => {
    const normalized = {
      ...definition,
      key: definition.key.trim(),
      labelZh: definition.labelZh.trim(),
    };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized.key)) {
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_KEY_INVALID",
        "Parameter key must be a valid identifier",
      );
    }
    if (normalized.labelZh.length === 0) {
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_LABEL_REQUIRED",
        "Parameter label is required",
      );
    }
    if (keys.has(normalized.key)) {
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_DUPLICATE",
        `Duplicate rule parameter: ${normalized.key}`,
      );
    }
    keys.add(normalized.key);
    validateParameterNumber(normalized, normalized);
    return normalized;
  });
}

export function deriveParameterDefinitionsFromContract(
  contract: BusinessRuleContract,
): RuleParameterDefinition[] {
  const parsed = businessRuleContractSchema.parse(contract);
  return normalizeRuleParameterDefinitions(
    parsed.parameters.map((parameter) => {
      const type = parameter.valueType;
      if (type.kind !== "scalar") {
        throw new CustomRuleTemplateError(
          "CUSTOM_RULE_PARAMETER_TYPE_UNSUPPORTED",
          `Parameter ${parameter.name} must be scalar`,
        );
      }
      return {
        key: parameter.name,
        labelZh: parameter.description,
        type: scalarTypeToParameterType(type.scalarType),
        value: runtimeValueToNumber(parameter.name, parameter.defaultValue),
      };
    }),
  );
}

export function listReusableSettlementRuleTemplates(input: {
  systemTemplates: readonly {
    id: string;
    name: string;
    description: string;
    contract: BusinessRuleContract;
  }[];
  organizationTemplates: readonly OrganizationRuleTemplate[];
  actorOrganizationId: string;
}): ReusableSettlementRuleTemplateDto[] {
  return [
    ...input.systemTemplates.map((template) => ({
      kind: "system" as const,
      id: template.id,
      name: template.name,
      description: template.description,
      contract: businessRuleContractSchema.parse(template.contract),
      readOnly: true as const,
    })),
    ...input.organizationTemplates
      .filter((template) => template.organizationId === input.actorOrganizationId)
      .map((template) => ({
        ...clonePlain(template),
        kind: "organization" as const,
        readOnly: false as const,
      })),
  ];
}

export function assertReusableTemplateEditable(input: {
  templateKind: "system" | "organization";
  templateOrganizationId?: string;
  actorOrganizationId: string;
}): void {
  if (input.templateKind === "system") {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_SYSTEM_TEMPLATE_READ_ONLY",
      "System templates are read-only",
    );
  }
  if (input.templateOrganizationId !== input.actorOrganizationId) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_TEMPLATE_ORG_MISMATCH",
      "Organization templates are isolated by organization",
    );
  }
}

function rebindContractToProject(contract: BusinessRuleContract): BusinessRuleContract {
  return businessRuleContractSchema.parse({
    ...clonePlain(contract),
    target: { targetType: "project", targetId: null },
  });
}

function validateParameterNumber(
  value: Pick<RuleParameterDefinition, "key" | "type" | "value">,
  bounds: Pick<RuleParameterDefinition, "min" | "max">,
): void {
  if (!Number.isFinite(value.value)) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_PARAMETER_VALUE_INVALID",
      `Parameter ${value.key} value must be finite`,
    );
  }
  if (
    (value.type === "money_cents" ||
      value.type === "rate_bps" ||
      value.type === "integer") &&
    !Number.isSafeInteger(value.value)
  ) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_PARAMETER_VALUE_INVALID",
      `Parameter ${value.key} value must be a safe integer`,
    );
  }
  if (bounds.min !== undefined && value.value < bounds.min) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_PARAMETER_BELOW_MINIMUM",
      `Parameter ${value.key} is below the minimum`,
    );
  }
  if (bounds.max !== undefined && value.value > bounds.max) {
    throw new CustomRuleTemplateError(
      "CUSTOM_RULE_PARAMETER_ABOVE_MAXIMUM",
      `Parameter ${value.key} is above the maximum`,
    );
  }
}

function materializeParameters(
  definitions: readonly RuleParameterDefinition[],
): Record<string, TypedRuntimeValue> {
  return Object.fromEntries(
    normalizeRuleParameterDefinitions(definitions).map((definition) => [
      definition.key,
      parameterDefinitionToValue(definition),
    ]),
  );
}

function parameterDefinitionToValue(
  definition: RuleParameterDefinition,
): TypedRuntimeValue {
  switch (definition.type) {
    case "money_cents":
      return { type: "money_cents", amountCents: definition.value };
    case "rate_bps":
      return { type: "rate_bps", rateBps: definition.value };
    case "integer":
      return { type: "integer", value: definition.value };
    case "number":
      return { type: "number", value: definition.value };
  }
}

function parameterTypeToUiType(
  type: RuleParameterDefinition["type"],
): RuleParameterUiDefinition["type"] {
  switch (type) {
    case "money_cents":
      return "money_yuan";
    case "rate_bps":
      return "percent";
    case "integer":
    case "number":
      return type;
  }
}

function uiTypeToParameterType(
  type: RuleParameterUiDefinition["type"],
): RuleParameterDefinition["type"] {
  switch (type) {
    case "money_yuan":
      return "money_cents";
    case "percent":
      return "rate_bps";
    case "integer":
    case "number":
      return type;
  }
}

function parameterValueToUiValue(
  type: RuleParameterDefinition["type"],
  value: number,
): number {
  switch (type) {
    case "money_cents":
      return centsToLegacyYuan(value);
    case "rate_bps":
      return value / 100;
    case "integer":
    case "number":
      return value;
  }
}

function uiValueToParameterValue(
  type: RuleParameterUiDefinition["type"],
  value: number,
): number {
  switch (type) {
    case "money_yuan":
      return yuanToCentsStrict(value);
    case "percent":
      return percentToBpsStrict(value);
    case "integer":
    case "number":
      return value;
  }
}

function runtimeValueToNumber(key: string, value: TypedRuntimeValue): number {
  switch (value.type) {
    case "money_cents":
      return value.amountCents;
    case "rate_bps":
      return value.rateBps;
    case "integer":
    case "number":
      return value.value;
    default:
      throw new CustomRuleTemplateError(
        "CUSTOM_RULE_PARAMETER_TYPE_UNSUPPORTED",
        `Parameter ${key} must be numeric`,
      );
  }
}

function scalarTypeToParameterType(
  scalarType: RuntimeScalarType,
): RuleParameterDefinition["type"] {
  if (
    scalarType === "money_cents" ||
    scalarType === "rate_bps" ||
    scalarType === "integer" ||
    scalarType === "number"
  ) {
    return scalarType;
  }
  throw new CustomRuleTemplateError(
    "CUSTOM_RULE_PARAMETER_TYPE_UNSUPPORTED",
    `Parameter scalar type ${String(scalarType)} is not supported`,
  );
}

function clonePlain<Value>(value: Value): Value {
  return structuredClone(value);
}
