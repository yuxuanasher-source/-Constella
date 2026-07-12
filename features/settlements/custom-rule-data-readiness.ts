import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

import type {
  CustomRuleMissingDataPolicy,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import {
  assertCoverageCounts,
  isConfirmedIanaTimezone,
  type CustomRuleVariableAvailability,
  type CustomRuleVariableCatalog,
  type CustomRuleVariableCatalogItem,
} from "./custom-rule-variable-catalog";

export type CustomRuleInputRequirement =
  | { variableId: string; required: true }
  | {
      variableId: string;
      required: false;
      missingDataPolicy?: CustomRuleMissingDataPolicy;
    };

export type CustomRuleReadinessCode =
  | "CUSTOM_RULE_INPUT_AVAILABLE"
  | "CUSTOM_RULE_INPUT_SCHEMA_READY_NO_HISTORY"
  | "CUSTOM_RULE_REQUIRED_INPUT_INCOMPLETE"
  | "CUSTOM_RULE_INPUT_UNAVAILABLE"
  | "CUSTOM_RULE_INPUT_NOT_APPLICABLE"
  | "CUSTOM_RULE_MISSING_DATA_POLICY_REQUIRED"
  | "CUSTOM_RULE_OPTIONAL_INPUT_ROUTE_TO_REVIEW"
  | "CUSTOM_RULE_OPTIONAL_INPUT_BLOCK_BATCH"
  | "CUSTOM_RULE_OPTIONAL_INPUT_EXPLICIT_DEFAULT"
  | "CUSTOM_RULE_EXPLICIT_DEFAULT_FORBIDDEN"
  | "CUSTOM_RULE_EXPLICIT_DEFAULT_TYPE_MISMATCH"
  | "CUSTOM_RULE_BUSINESS_TIMEZONE_UNCONFIRMED";

export type CustomRuleInputReadiness = {
  variableId: string;
  required: boolean;
  status: CustomRuleVariableAvailability;
  ready: boolean;
  coverageNumerator: number;
  coverageDenominator: number;
  code: CustomRuleReadinessCode;
  reasonZh: string;
};

export type CustomRuleDataReadinessWarning = {
  code: "CUSTOM_RULE_PROJECT_NO_HISTORY";
  reasonZh: string;
};

export type CustomRuleDataReadinessReport = {
  catalogVersion: string;
  readinessHash: string;
  businessTimezone: string | null;
  businessTimezoneConfirmed: boolean;
  businessTimezoneSource: CustomRuleVariableCatalog["businessTimezoneSource"];
  historicalVerification: "verified" | "unverified";
  readyForSimulation: boolean;
  readyForActivation: boolean;
  inputs: CustomRuleInputReadiness[];
  warnings: CustomRuleDataReadinessWarning[];
};

export type CustomRuleSimulationReadinessSnapshot = Pick<
  CustomRuleDataReadinessReport,
  "catalogVersion" | "readinessHash" | "businessTimezone"
>;

export class CustomRuleReadinessInputError extends TypeError {
  readonly code = "CUSTOM_RULE_READINESS_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CustomRuleReadinessInputError";
  }
}

const TIMEZONE_VARIABLES = new Set(["weekday", "hour_of_day"]);
const EXPLICIT_DEFAULT_FORBIDDEN_VARIABLES = new Set([
  "project_id",
  "streamer_id",
  "collaboration_id",
  "system_minutes",
  "screenshot_minutes",
  "settlement_minutes",
  "evidence_level",
  "time_source",
  "views",
  "live_started_at",
  "weekday",
  "hour_of_day",
  "approved_at",
  "period_start",
  "period_end",
]);
const MAX_REQUIREMENTS = 300;
const MAX_RUNTIME_VALUE_DEPTH = 20;
const MAX_RUNTIME_VALUE_NODES = 300;

export function buildCustomRuleInputRequirements(input: {
  requiredVariableIds: readonly string[];
  formulaVariableIds: readonly string[];
  missingDataPolicy: CustomRuleMissingDataPolicy;
}): CustomRuleInputRequirement[] {
  const requiredIds = new Set(input.requiredVariableIds);
  return [...new Set([...requiredIds, ...input.formulaVariableIds])]
    .sort((left, right) => left.localeCompare(right))
    .map((variableId) =>
      requiredIds.has(variableId)
        ? { variableId, required: true as const }
        : {
            variableId,
            required: false as const,
            missingDataPolicy: input.missingDataPolicy,
          },
    );
}

export function calculateCustomRuleOptionalPolicyHash(
  inputs: readonly CustomRuleInputRequirement[],
): string {
  const requiredIds = new Set(
    inputs.flatMap((requirement) =>
      requirement.required ? [requirement.variableId] : [],
    ),
  );
  const snapshots = inputs.flatMap((requirement) =>
    !requirement.required && !requiredIds.has(requirement.variableId)
      ? [
          {
            variableId: requirement.variableId,
            missingDataPolicy: requirement.missingDataPolicy ?? null,
          },
        ]
      : [],
  );
  const unique = new Map(
    snapshots.map((snapshot) => [canonicalJson(snapshot), snapshot]),
  );
  const canonical = [...unique.values()].sort(
    (left, right) =>
      left.variableId.localeCompare(right.variableId) ||
      canonicalJson(left.missingDataPolicy).localeCompare(
        canonicalJson(right.missingDataPolicy),
      ),
  );
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}

export function isCustomRuleExplicitDefaultForbiddenVariable(
  variableId: string,
): boolean {
  return EXPLICIT_DEFAULT_FORBIDDEN_VARIABLES.has(variableId);
}

export function analyzeCustomRuleDataReadiness(unsafeInput: {
  catalog: CustomRuleVariableCatalog;
  inputs: readonly CustomRuleInputRequirement[];
}): CustomRuleDataReadinessReport {
  const input = validateReadinessInput(unsafeInput);
  validateCatalogCoverage(input.catalog);
  const catalogById = new Map(
    input.catalog.variables.map((variable) => [variable.id, variable]),
  );
  const requirements = [...input.inputs].sort((left, right) =>
    left.variableId.localeCompare(right.variableId),
  );
  const evaluated = requirements.map((requirement) =>
    evaluateInputReadiness({
      requirement,
      variable: catalogById.get(requirement.variableId),
      catalog: input.catalog,
    }),
  );
  const warnings: CustomRuleDataReadinessWarning[] = input.catalog.hasHistory
    ? []
    : [
        {
          code: "CUSTOM_RULE_PROJECT_NO_HISTORY",
          reasonZh: "项目暂无历史数据，只能使用结构校验、合成边界和用户示例试算。",
        },
      ];
  const readyForSimulation = evaluated.every((item) => item.readiness.ready);
  const readinessHash = hashReadinessState({
    catalog: input.catalog,
    evaluated,
  });

  return {
    catalogVersion: input.catalog.version,
    readinessHash,
    businessTimezone: input.catalog.businessTimezone,
    businessTimezoneConfirmed:
      input.catalog.businessTimezoneConfirmed,
    businessTimezoneSource: input.catalog.businessTimezoneSource,
    historicalVerification: input.catalog.hasHistory
      ? "verified"
      : "unverified",
    readyForSimulation,
    readyForActivation: readyForSimulation && input.catalog.hasHistory,
    inputs: evaluated.map((item) => item.readiness),
    warnings,
  };
}

export function isCustomRuleSimulationReadinessFresh(
  snapshot: CustomRuleSimulationReadinessSnapshot,
  current: CustomRuleDataReadinessReport,
): boolean {
  return (
    snapshot.catalogVersion === current.catalogVersion &&
    snapshot.readinessHash === current.readinessHash &&
    snapshot.businessTimezone === current.businessTimezone
  );
}

type EvaluatedInput = {
  readiness: CustomRuleInputReadiness;
  missingDataPolicy: CustomRuleMissingDataPolicy | null;
};

function evaluateInputReadiness(input: {
  requirement: CustomRuleInputRequirement;
  variable: CustomRuleVariableCatalogItem | undefined;
  catalog: CustomRuleVariableCatalog;
}): EvaluatedInput {
  const policy =
    input.requirement.required === false
      ? input.requirement.missingDataPolicy ?? null
      : null;
  const variable = input.variable;

  if (!variable) {
    return evaluated({
      requirement: input.requirement,
      policy,
      status: "not_applicable",
      ready: false,
      numerator: 0,
      denominator: 0,
      code: "CUSTOM_RULE_INPUT_NOT_APPLICABLE",
      reasonZh: "该变量不适用于当前规则范围或执行粒度。",
    });
  }

  const status = resolveDataStatus(variable, input.catalog.hasHistory);
  if (
    TIMEZONE_VARIABLES.has(variable.id) &&
    !isConfirmedIanaTimezone({
      businessTimezone: input.catalog.businessTimezone,
      businessTimezoneConfirmed:
        input.catalog.businessTimezoneConfirmed,
      businessTimezoneSource: input.catalog.businessTimezoneSource,
    })
  ) {
    return evaluatedVariable({
      requirement: input.requirement,
      variable,
      policy,
      status: "unavailable",
      ready: false,
      code: "CUSTOM_RULE_BUSINESS_TIMEZONE_UNCONFIRMED",
      reasonZh: "星期和小时变量需要先确认有效的 IANA 业务时区。",
    });
  }

  if (status === "unavailable") {
    return evaluatedVariable({
      requirement: input.requirement,
      variable,
      policy,
      status,
      ready: false,
      code: "CUSTOM_RULE_INPUT_UNAVAILABLE",
      reasonZh: "当前没有可依赖的规范化持久数据源。",
    });
  }

  if (input.requirement.required) {
    if (status === "partial") {
      return evaluatedVariable({
        requirement: input.requirement,
        variable,
        policy,
        status,
        ready: false,
        code: "CUSTOM_RULE_REQUIRED_INPUT_INCOMPLETE",
        reasonZh: `必填变量历史覆盖不足（${variable.coverageNumerator}/${variable.coverageDenominator}）。`,
      });
    }

    return evaluatedVariable({
      requirement: input.requirement,
      variable,
      policy,
      status,
      ready: true,
      code: input.catalog.hasHistory
        ? "CUSTOM_RULE_INPUT_AVAILABLE"
        : "CUSTOM_RULE_INPUT_SCHEMA_READY_NO_HISTORY",
      reasonZh: input.catalog.hasHistory
        ? "数据源可用且历史覆盖完整。"
        : "数据结构可用，但项目暂无历史样本，不能计算历史覆盖率。",
    });
  }

  if (!policy) {
    return evaluatedVariable({
      requirement: input.requirement,
      variable,
      policy,
      status,
      ready: false,
      code: "CUSTOM_RULE_MISSING_DATA_POLICY_REQUIRED",
      reasonZh: "可选变量必须明确选择缺失数据处理策略。",
    });
  }

  switch (policy.action) {
    case "route_item_to_review":
      return evaluatedVariable({
        requirement: input.requirement,
        variable,
        policy,
        status,
        ready: true,
        code: "CUSTOM_RULE_OPTIONAL_INPUT_ROUTE_TO_REVIEW",
        reasonZh:
          status === "partial"
            ? "缺失该变量的记录将转入人工复核。"
            : "已明确：该变量缺失时转入人工复核。",
      });
    case "block_batch":
      return evaluatedVariable({
        requirement: input.requirement,
        variable,
        policy,
        status,
        ready: true,
        code: "CUSTOM_RULE_OPTIONAL_INPUT_BLOCK_BATCH",
        reasonZh:
          status === "partial"
            ? "存在缺失记录；执行时将阻断整个结算批次。"
            : "已明确：该变量缺失时阻断整个结算批次。",
      });
    case "use_explicit_default":
      if (isCustomRuleExplicitDefaultForbiddenVariable(variable.id)) {
        return evaluatedVariable({
          requirement: input.requirement,
          variable,
          policy,
          status,
          ready: false,
          code: "CUSTOM_RULE_EXPLICIT_DEFAULT_FORBIDDEN",
          reasonZh: "身份、证据真实性或授权相关变量禁止使用默认值。",
        });
      }
      if (!runtimeValueMatchesType(policy.defaultValue, variable.runtimeType)) {
        return evaluatedVariable({
          requirement: input.requirement,
          variable,
          policy,
          status,
          ready: false,
          code: "CUSTOM_RULE_EXPLICIT_DEFAULT_TYPE_MISMATCH",
          reasonZh: "明确默认值的运行时类型与变量类型不一致。",
        });
      }
      return evaluatedVariable({
        requirement: input.requirement,
        variable,
        policy,
        status,
        ready: true,
        code: "CUSTOM_RULE_OPTIONAL_INPUT_EXPLICIT_DEFAULT",
        reasonZh:
          status === "partial"
            ? "缺失记录将使用已明确并纳入试算的默认值。"
            : "已明确：该变量缺失时使用可见默认值。",
      });
    default:
      throw new CustomRuleReadinessInputError(
        "missing-data policy action is unsupported",
      );
  }
}

function resolveDataStatus(
  variable: CustomRuleVariableCatalogItem,
  hasHistory: boolean,
): Exclude<CustomRuleVariableAvailability, "not_applicable"> {
  if (variable.availability === "unavailable") {
    return "unavailable";
  }
  if (variable.availability === "partial") {
    return "partial";
  }
  if (!hasHistory && variable.coverageDenominator === 0) {
    return "available";
  }
  if (variable.coverageDenominator === 0) {
    return "partial";
  }
  return variable.coverageNumerator === variable.coverageDenominator
    ? "available"
    : "partial";
}

function evaluatedVariable(input: {
  requirement: CustomRuleInputRequirement;
  variable: CustomRuleVariableCatalogItem;
  policy: CustomRuleMissingDataPolicy | null;
  status: CustomRuleVariableAvailability;
  ready: boolean;
  code: CustomRuleReadinessCode;
  reasonZh: string;
}): EvaluatedInput {
  return evaluated({
    requirement: input.requirement,
    policy: input.policy,
    status: input.status,
    ready: input.ready,
    numerator: input.variable.coverageNumerator,
    denominator: input.variable.coverageDenominator,
    code: input.code,
    reasonZh: input.reasonZh,
  });
}

function evaluated(input: {
  requirement: CustomRuleInputRequirement;
  policy: CustomRuleMissingDataPolicy | null;
  status: CustomRuleVariableAvailability;
  ready: boolean;
  numerator: number;
  denominator: number;
  code: CustomRuleReadinessCode;
  reasonZh: string;
}): EvaluatedInput {
  return {
    readiness: {
      variableId: input.requirement.variableId,
      required: input.requirement.required,
      status: input.status,
      ready: input.ready,
      coverageNumerator: input.numerator,
      coverageDenominator: input.denominator,
      code: input.code,
      reasonZh: input.reasonZh,
    },
    missingDataPolicy: input.policy,
  };
}

type OwnDataObject = {
  descriptors: PropertyDescriptorMap;
  keys: string[];
};

type RuntimeValueWorkItem = {
  source: unknown;
  depth: number;
  assign: (value: TypedRuntimeValue) => void;
};

function validateReadinessInput(input: unknown): {
  catalog: CustomRuleVariableCatalog;
  inputs: readonly CustomRuleInputRequirement[];
} {
  const outer = readOwnDataObject(input, "readiness input");
  assertExactKeys(outer, ["catalog", "inputs"], "readiness input");
  const catalog = ownDataValue(outer, "catalog");
  if (
    nodeTypes.isProxy(catalog) ||
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog)
  ) {
    throw new CustomRuleReadinessInputError(
      "catalog must be a non-proxy object",
    );
  }

  const unsafeRequirements = readOwnDataArray(
    ownDataValue(outer, "inputs"),
    "inputs",
    MAX_REQUIREMENTS,
  );
  const variableIds = new Set<string>();
  const requirements = unsafeRequirements.map((requirement, index) => {
    const validated = validateRequirement(requirement, index);
    if (variableIds.has(validated.variableId)) {
      throw new CustomRuleReadinessInputError(
        `inputs[${index}] duplicates variableId ${validated.variableId}`,
      );
    }
    variableIds.add(validated.variableId);
    return validated;
  });

  const snapshot = Object.create(null) as {
    catalog: CustomRuleVariableCatalog;
    inputs: readonly CustomRuleInputRequirement[];
  };
  snapshot.catalog = catalog as CustomRuleVariableCatalog;
  snapshot.inputs = Object.freeze(requirements);
  return Object.freeze(snapshot);
}

function validateRequirement(
  input: unknown,
  index: number,
): CustomRuleInputRequirement {
  const label = `inputs[${index}]`;
  const requirement = readOwnDataObject(input, label);
  const variableId = ownDataValue(requirement, "variableId");
  const required = ownDataValue(requirement, "required");
  if (
    typeof variableId !== "string" ||
    variableId.length === 0 ||
    variableId.trim() !== variableId
  ) {
    throw new CustomRuleReadinessInputError(
      `${label}.variableId must be a nonempty canonical string`,
    );
  }
  if (required === true) {
    assertExactKeys(requirement, ["variableId", "required"], label);
    return freezeNullRecord({ variableId, required: true });
  }
  if (required !== false) {
    throw new CustomRuleReadinessInputError(
      `${label}.required must be a boolean literal`,
    );
  }
  assertAllowedKeys(
    requirement,
    ["variableId", "required", "missingDataPolicy"],
    label,
  );
  if (!Object.hasOwn(requirement.descriptors, "missingDataPolicy")) {
    return freezeNullRecord({ variableId, required: false });
  }
  return freezeNullRecord({
    variableId,
    required: false,
    missingDataPolicy: validateMissingDataPolicy(
      ownDataValue(requirement, "missingDataPolicy"),
      `${label}.missingDataPolicy`,
    ),
  });
}

function validateMissingDataPolicy(
  input: unknown,
  label: string,
): CustomRuleMissingDataPolicy {
  const policy = readOwnDataObject(input, label);
  const action = ownDataValue(policy, "action");
  switch (action) {
    case "route_item_to_review":
      assertExactKeys(policy, ["action"], label);
      return freezeNullRecord({ action });
    case "block_batch":
      assertExactKeys(policy, ["action"], label);
      return freezeNullRecord({ action });
    case "use_explicit_default":
      assertExactKeys(policy, ["action", "defaultValue"], label);
      return freezeNullRecord({
        action,
        defaultValue: validateTypedRuntimeValue(
          ownDataValue(policy, "defaultValue"),
          `${label}.defaultValue`,
        ),
      });
    default:
      throw new CustomRuleReadinessInputError(
        `${label}.action is unsupported`,
      );
  }
}

function validateTypedRuntimeValue(
  input: unknown,
  label: string,
): TypedRuntimeValue {
  let snapshot: TypedRuntimeValue | undefined;
  let nodeCount = 0;
  let itemCount = 0;
  const work: RuntimeValueWorkItem[] = [
    {
      source: input,
      depth: 0,
      assign(value) {
        snapshot = value;
      },
    },
  ];

  while (work.length > 0) {
    const current = work.pop();
    if (!current) {
      break;
    }
    if (current.depth > MAX_RUNTIME_VALUE_DEPTH) {
      throw new CustomRuleReadinessInputError(
        `${label} exceeds maximum depth ${MAX_RUNTIME_VALUE_DEPTH}`,
      );
    }
    nodeCount += 1;
    if (nodeCount > MAX_RUNTIME_VALUE_NODES) {
      throw new CustomRuleReadinessInputError(
        `${label} exceeds maximum node count ${MAX_RUNTIME_VALUE_NODES}`,
      );
    }

    const value = readOwnDataObject(current.source, label);
    const type = ownDataValue(value, "type");
    switch (type) {
      case "money_cents": {
        assertExactKeys(value, ["type", "amountCents"], label);
        const amountCents = ownDataValue(value, "amountCents");
        if (!Number.isSafeInteger(amountCents)) {
          throw new CustomRuleReadinessInputError(
            `${label}.amountCents must be a safe integer`,
          );
        }
        current.assign(
          freezeNullRecord({ type, amountCents }) as TypedRuntimeValue,
        );
        break;
      }
      case "rate_bps": {
        assertExactKeys(value, ["type", "rateBps"], label);
        const rateBps = ownDataValue(value, "rateBps");
        if (!Number.isSafeInteger(rateBps)) {
          throw new CustomRuleReadinessInputError(
            `${label}.rateBps must be a safe integer`,
          );
        }
        current.assign(freezeNullRecord({ type, rateBps }) as TypedRuntimeValue);
        break;
      }
      case "number": {
        assertExactKeys(value, ["type", "value"], label);
        const numericValue = ownDataValue(value, "value");
        if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
          throw new CustomRuleReadinessInputError(
            `${label}.value must be a finite number`,
          );
        }
        current.assign(
          freezeNullRecord({ type, value: numericValue }) as TypedRuntimeValue,
        );
        break;
      }
      case "integer": {
        assertExactKeys(value, ["type", "value"], label);
        const integerValue = ownDataValue(value, "value");
        if (!Number.isSafeInteger(integerValue)) {
          throw new CustomRuleReadinessInputError(
            `${label}.value must be a safe integer`,
          );
        }
        current.assign(
          freezeNullRecord({ type, value: integerValue }) as TypedRuntimeValue,
        );
        break;
      }
      case "boolean":
      case "string":
      case "timestamp": {
        assertExactKeys(value, ["type", "value"], label);
        const scalarValue = ownDataValue(value, "value");
        const expectedType = type === "boolean" ? "boolean" : "string";
        if (typeof scalarValue !== expectedType) {
          throw new CustomRuleReadinessInputError(
            `${label}.value must be a ${expectedType}`,
          );
        }
        current.assign(
          freezeNullRecord({ type, value: scalarValue }) as TypedRuntimeValue,
        );
        break;
      }
      case "array": {
        assertExactKeys(value, ["type", "items"], label);
        const unsafeItems = readOwnDataArray(
          ownDataValue(value, "items"),
          `${label}.items`,
          MAX_RUNTIME_VALUE_NODES,
        );
        itemCount += unsafeItems.length;
        assertRuntimeItemBudget(itemCount, label);
        const items = new Array<TypedRuntimeValue>(unsafeItems.length);
        const arraySnapshot = Object.create(null) as {
          type: "array";
          items: TypedRuntimeValue[];
        };
        arraySnapshot.type = "array";
        arraySnapshot.items = items;
        current.assign(arraySnapshot);
        for (let index = unsafeItems.length - 1; index >= 0; index -= 1) {
          work.push({
            source: unsafeItems[index],
            depth: current.depth + 1,
            assign(child) {
              items[index] = child;
            },
          });
        }
        break;
      }
      case "object": {
        assertExactKeys(value, ["type", "fields"], label);
        const unsafeFields = readOwnDataObject(
          ownDataValue(value, "fields"),
          `${label}.fields`,
        );
        if (unsafeFields.keys.length > MAX_RUNTIME_VALUE_NODES) {
          throw new CustomRuleReadinessInputError(
            `${label}.fields exceeds ${MAX_RUNTIME_VALUE_NODES} entries`,
          );
        }
        itemCount += unsafeFields.keys.length;
        assertRuntimeItemBudget(itemCount, label);
        const fields = Object.create(null) as Record<
          string,
          TypedRuntimeValue
        >;
        const objectSnapshot = Object.create(null) as {
          type: "object";
          fields: Record<string, TypedRuntimeValue>;
        };
        objectSnapshot.type = "object";
        objectSnapshot.fields = fields;
        current.assign(objectSnapshot);
        for (let index = unsafeFields.keys.length - 1; index >= 0; index -= 1) {
          const key = unsafeFields.keys[index];
          work.push({
            source: ownDataValue(unsafeFields, key),
            depth: current.depth + 1,
            assign(child) {
              fields[key] = child;
            },
          });
        }
        break;
      }
      default:
        throw new CustomRuleReadinessInputError(
          `${label}.type is unsupported`,
        );
    }
  }

  if (!snapshot) {
    throw new CustomRuleReadinessInputError(`${label} is missing`);
  }
  return deepFreezeRuntimeValue(snapshot);
}

function assertRuntimeItemBudget(itemCount: number, label: string): void {
  if (itemCount > MAX_RUNTIME_VALUE_NODES) {
    throw new CustomRuleReadinessInputError(
      `${label} exceeds maximum item count ${MAX_RUNTIME_VALUE_NODES}`,
    );
  }
}

function deepFreezeRuntimeValue(value: TypedRuntimeValue): TypedRuntimeValue {
  const work: unknown[] = [value];
  while (work.length > 0) {
    const current = work.pop();
    if (!current || typeof current !== "object" || Object.isFrozen(current)) {
      continue;
    }
    if (Array.isArray(current)) {
      work.push(...current);
    } else {
      const record = current as Record<string, unknown>;
      work.push(...Object.keys(record).map((key) => record[key]));
    }
    Object.freeze(current);
  }
  return value;
}

function readOwnDataObject(input: unknown, label: string): OwnDataObject {
  if (nodeTypes.isProxy(input)) {
    throw new CustomRuleReadinessInputError(`${label} must not be a Proxy`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CustomRuleReadinessInputError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CustomRuleReadinessInputError(
      `${label} must be a plain own-data object`,
    );
  }
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== "string")) {
    throw new CustomRuleReadinessInputError(
      `${label} must not contain symbol keys`,
    );
  }
  const descriptors: PropertyDescriptorMap =
    Object.getOwnPropertyDescriptors(input);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get ||
      descriptor.set
    ) {
      throw new CustomRuleReadinessInputError(
        `${label}.${key} must be an enumerable own data property`,
      );
    }
  }
  return { descriptors, keys: keys as string[] };
}

function readOwnDataArray(
  input: unknown,
  label: string,
  maximumLength: number,
): unknown[] {
  if (nodeTypes.isProxy(input)) {
    throw new CustomRuleReadinessInputError(`${label} must not be a Proxy`);
  }
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    throw new CustomRuleReadinessInputError(`${label} must be a plain array`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) {
    throw new CustomRuleReadinessInputError(
      `${label} must contain at most ${maximumLength} items`,
    );
  }
  const keys = Reflect.ownKeys(input);
  const allowedKeys = new Set<string>([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    keys.length !== allowedKeys.size ||
    keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
  ) {
    throw new CustomRuleReadinessInputError(
      `${label} must be dense and contain no extra properties`,
    );
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get ||
      descriptor.set
    ) {
      throw new CustomRuleReadinessInputError(
        `${label}[${index}] must be an enumerable own data property`,
      );
    }
    values.push(descriptor.value);
  }
  return values;
}

function ownDataValue(input: OwnDataObject, key: string): unknown {
  return input.descriptors[key]?.value;
}

function assertExactKeys(
  input: OwnDataObject,
  expectedKeys: readonly string[],
  label: string,
): void {
  assertAllowedKeys(input, expectedKeys, label);
  if (input.keys.length !== expectedKeys.length) {
    throw new CustomRuleReadinessInputError(
      `${label} is missing a required property`,
    );
  }
}

function assertAllowedKeys(
  input: OwnDataObject,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  if (input.keys.some((key) => !allowed.has(key))) {
    throw new CustomRuleReadinessInputError(
      `${label} contains an unknown property`,
    );
  }
}

function freezeNullRecord<T extends object>(value: T): T {
  const snapshot = Object.create(null) as T;
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: entry,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function validateCatalogCoverage(catalog: CustomRuleVariableCatalog): void {
  for (const variable of catalog.variables) {
    assertCoverageCounts(
      variable.id,
      variable.coverageNumerator,
      variable.coverageDenominator,
    );
  }
}

function hashReadinessState(input: {
  catalog: CustomRuleVariableCatalog;
  evaluated: EvaluatedInput[];
}): string {
  const canonical = canonicalJson({
    catalogVersion: input.catalog.version,
    scope: input.catalog.scope,
    executionGrain: input.catalog.executionGrain,
    businessTimezone: input.catalog.businessTimezone,
    businessTimezoneConfirmed:
      input.catalog.businessTimezoneConfirmed,
    businessTimezoneSource: input.catalog.businessTimezoneSource,
    hasHistory: input.catalog.hasHistory,
    inputs: input.evaluated.map((item) => ({
      variableId: item.readiness.variableId,
      required: item.readiness.required,
      status: item.readiness.status,
      ready: item.readiness.ready,
      coverageNumerator: item.readiness.coverageNumerator,
      coverageDenominator: item.readiness.coverageDenominator,
      code: item.readiness.code,
      missingDataPolicy: item.missingDataPolicy,
    })),
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function runtimeValueMatchesType(
  value: TypedRuntimeValue,
  expected: RuntimeValueType,
): boolean {
  if (expected.kind === "scalar") {
    return value.type === expected.scalarType;
  }
  if (expected.kind === "array") {
    return (
      value.type === "array" &&
      value.items.every((item) =>
        runtimeValueMatchesType(item, expected.itemType),
      )
    );
  }
  if (value.type !== "object") {
    return false;
  }

  const expectedKeys = Object.keys(expected.fields).sort();
  const actualKeys = Object.keys(value.fields).sort();
  return (
    canonicalJson(actualKeys) === canonicalJson(expectedKeys) &&
    expectedKeys.every((key) =>
      runtimeValueMatchesType(value.fields[key], expected.fields[key]),
    )
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
