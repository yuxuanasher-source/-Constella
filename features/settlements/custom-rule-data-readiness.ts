import { createHash } from "node:crypto";

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
]);

export function analyzeCustomRuleDataReadiness(input: {
  catalog: CustomRuleVariableCatalog;
  inputs: readonly CustomRuleInputRequirement[];
}): CustomRuleDataReadinessReport {
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

  if (
    policy.action === "use_explicit_default" &&
    EXPLICIT_DEFAULT_FORBIDDEN_VARIABLES.has(variable.id)
  ) {
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

  if (
    policy.action === "use_explicit_default" &&
    !runtimeValueMatchesType(policy.defaultValue, variable.runtimeType)
  ) {
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

  if (policy.action === "route_item_to_review") {
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
  }
  if (policy.action === "block_batch") {
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
