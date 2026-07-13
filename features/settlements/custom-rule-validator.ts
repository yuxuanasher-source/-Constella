import { createHash } from "node:crypto";

import {
  compiledAstNodeSchema,
  runtimeValueTypeSchema,
} from "./custom-rule-contract";
import {
  parseCustomRuleFormula,
  type CustomRuleIssue,
  type CustomRuleSourceSpan,
} from "./custom-rule-parser";
import {
  CUSTOM_RULE_EXECUTION_GRAINS,
  CUSTOM_RULE_SCOPES,
  CUSTOM_RULE_COMPOSITION_MODES,
  percentToBpsStrict,
  yuanToCentsStrict,
} from "./custom-rule-types";
import type {
  CompiledAstNode,
  CustomRuleCompositionMode,
  CustomRuleExecutionGrain,
  CustomRuleScope,
  NormalizedAstNode,
  RuntimeScalarType,
  RuntimeValueType,
} from "./custom-rule-types";

export type ValidateCustomRuleFormulaOptions = {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  parameters?: ReadonlyArray<{
    name: string;
    valueType: RuntimeValueType;
  }>;
  compositionMode?: CustomRuleCompositionMode;
};

export type ValidateCustomRuleFormulaResult =
  | {
      ok: true;
      compiledAst: CompiledAstNode;
      variables: string[];
      parameters: string[];
      formulaHash: string;
    }
  | { ok: false; issues: CustomRuleIssue[] };

type VariableDefinition = {
  valueType: RuntimeValueType;
  scopes: readonly CustomRuleScope[];
  grains: readonly CustomRuleExecutionGrain[];
};

type CompileContext = {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  spansByPath: Record<string, CustomRuleSourceSpan>;
  rootSpan: CustomRuleSourceSpan;
  parameterTypes: ReadonlyMap<string, RuntimeValueType>;
  referencedVariables: Set<string>;
  referencedParameters: Set<string>;
  componentNames: ReadonlySet<string>;
  componentTypes: ReadonlyMap<string, RuntimeValueType>;
  compositionMode: CustomRuleCompositionMode | null;
};

type ComponentReference = {
  name: string;
  path: string;
};

type NumericConstantEvaluation =
  | { kind: "constant"; value: number }
  | { kind: "dynamic" }
  | { kind: "invalid" };

type ValidatedOptions = {
  scope: CustomRuleScope;
  executionGrain: CustomRuleExecutionGrain;
  parameterTypes: ReadonlyMap<string, RuntimeValueType>;
  compositionMode: CustomRuleCompositionMode | null;
};

const scalar = <ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } => ({
  kind: "scalar",
  scalarType,
});

const MONEY_TYPE = scalar("money_cents");
const RATE_TYPE = scalar("rate_bps");
const NUMBER_TYPE = scalar("number");
const INTEGER_TYPE = scalar("integer");
const BOOLEAN_TYPE = scalar("boolean");
const STRING_TYPE = scalar("string");
const TIMESTAMP_TYPE = scalar("timestamp");
const STRING_ARRAY_TYPE: RuntimeValueType = {
  kind: "array",
  itemType: STRING_TYPE,
};

const REPORT_GRAIN = ["report"] as const;
const ALL_GRAINS = [
  "report",
  "project_streamer_period",
  "batch",
  "project_period",
] as const;
const STREAMER_GRAINS = ["report", "project_streamer_period"] as const;
const PERIOD_GRAINS = [
  "project_streamer_period",
  "batch",
  "project_period",
] as const;
const PAYABLE_AND_RECEIVABLE = ["payable", "receivable"] as const;
const PAYABLE_ONLY = ["payable"] as const;
const RECEIVABLE_ONLY = ["receivable"] as const;
const EXTERNAL_COST_ONLY = ["external_cost"] as const;
const RECONCILIATION_ONLY = ["reconciliation"] as const;
const ALL_SCOPES = [
  "payable",
  "receivable",
  "external_cost",
  "reconciliation",
] as const;

const VARIABLE_DEFINITIONS: Readonly<Record<string, VariableDefinition>> = {
  system_minutes: variable(INTEGER_TYPE, PAYABLE_AND_RECEIVABLE, REPORT_GRAIN),
  screenshot_minutes: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  settlement_minutes: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  evidence_level: variable(
    STRING_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  time_source: variable(STRING_TYPE, PAYABLE_AND_RECEIVABLE, REPORT_GRAIN),
  views: variable(INTEGER_TYPE, PAYABLE_AND_RECEIVABLE, REPORT_GRAIN),
  live_started_at: variable(
    TIMESTAMP_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  weekday: variable(INTEGER_TYPE, PAYABLE_AND_RECEIVABLE, REPORT_GRAIN),
  hour_of_day: variable(INTEGER_TYPE, PAYABLE_AND_RECEIVABLE, REPORT_GRAIN),
  approved_at: variable(
    TIMESTAMP_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  project_id: variable(STRING_TYPE, ALL_SCOPES, ALL_GRAINS),
  project_tags: variable(STRING_ARRAY_TYPE, ALL_SCOPES, ALL_GRAINS),
  streamer_id: variable(
    STRING_TYPE,
    PAYABLE_AND_RECEIVABLE,
    STREAMER_GRAINS,
  ),
  streamer_level: variable(STRING_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  streamer_source: variable(STRING_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  collaboration_id: variable(STRING_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  base_hourly_rate: variable(MONEY_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  base_salary: variable(MONEY_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  cps_rate: variable(RATE_TYPE, PAYABLE_ONLY, STREAMER_GRAINS),
  streamer_group_ids: variable(
    STRING_ARRAY_TYPE,
    PAYABLE_ONLY,
    STREAMER_GRAINS,
  ),
  sales_amount: variable(
    MONEY_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  orders_count: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  gift_amount: variable(
    MONEY_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  supplier_fee: variable(MONEY_TYPE, EXTERNAL_COST_ONLY, REPORT_GRAIN),
  traffic_cost: variable(MONEY_TYPE, EXTERNAL_COST_ONLY, REPORT_GRAIN),
  manual_adjustment: variable(
    MONEY_TYPE,
    PAYABLE_AND_RECEIVABLE,
    REPORT_GRAIN,
  ),
  period_system_minutes: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_settlement_minutes: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_sales_amount: variable(
    MONEY_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_orders_count: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_report_count: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  red_evidence_count: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  yellow_evidence_count: variable(
    INTEGER_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_payable_amount: variable(
    MONEY_TYPE,
    PAYABLE_ONLY,
    PERIOD_GRAINS,
  ),
  period_receivable_amount: variable(
    MONEY_TYPE,
    RECEIVABLE_ONLY,
    PERIOD_GRAINS,
  ),
  period_start: variable(
    TIMESTAMP_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  period_end: variable(
    TIMESTAMP_TYPE,
    PAYABLE_AND_RECEIVABLE,
    PERIOD_GRAINS,
  ),
  receivable_amount: variable(
    MONEY_TYPE,
    RECONCILIATION_ONLY,
    PERIOD_GRAINS,
  ),
  payable_amount: variable(
    MONEY_TYPE,
    RECONCILIATION_ONLY,
    PERIOD_GRAINS,
  ),
  external_cost_amount: variable(
    MONEY_TYPE,
    RECONCILIATION_ONLY,
    PERIOD_GRAINS,
  ),
  tax_amount: variable(MONEY_TYPE, RECONCILIATION_ONLY, PERIOD_GRAINS),
  gross_margin: variable(MONEY_TYPE, RECONCILIATION_ONLY, PERIOD_GRAINS),
  margin_rate: variable(RATE_TYPE, RECONCILIATION_ONLY, PERIOD_GRAINS),
  prior_layer_amount: variable(MONEY_TYPE, PAYABLE_AND_RECEIVABLE, PERIOD_GRAINS),
};

const ALLOWED_FUNCTIONS = new Set([
  "if",
  "min",
  "max",
  "clamp",
  "round_money",
  "tiered",
  "percent",
  "evidence_multiplier",
  "in",
  "contains",
  "yuan",
  "rate_percent",
  "parameter",
  "money_result",
]);
const DISABLED_FUNCTIONS = new Set([
  "cost_items",
  "block_if",
  "warn_if",
  "pass_if",
]);
const DISABLED_PHASE_ONE_SCOPES = new Set<CustomRuleScope>([
  "external_cost",
  "reconciliation",
]);
const MAX_PARAMETERS = 300;
const MAX_PARAMETER_TYPE_DEPTH = 20;
const MAX_PARAMETER_TYPE_NODES = 300;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_IDENTIFIERS = new Set([
  "amount",
  "__proto__",
  "prototype",
  "constructor",
]);

class ValidationFailure extends Error {
  constructor(readonly issue: CustomRuleIssue) {
    super(issue.message);
    this.name = "ValidationFailure";
  }
}

export function validateCustomRuleFormula(
  formula: string,
  options: ValidateCustomRuleFormulaOptions,
): ValidateCustomRuleFormulaResult {
  const optionSpan = { start: 0, end: formula.length };
  let validatedOptions: ValidatedOptions;
  try {
    validatedOptions = validateRuntimeOptions(options, optionSpan);
  } catch (error) {
    if (error instanceof ValidationFailure) {
      return { ok: false, issues: [error.issue] };
    }
    return validationFailure(
      "VALIDATION_INVALID_OPTIONS",
      "Validation options are invalid",
      optionSpan,
    );
  }

  const parsed = parseCustomRuleFormula(formula);
  if (!parsed.ok) {
    return parsed;
  }

  const rootSpan = parsed.spansByPath["$"] ?? {
    start: 0,
    end: formula.length,
  };

  if (
    parsed.scopePrefix !== null &&
    parsed.scopePrefix !== validatedOptions.scope
  ) {
    const prefixStart = formula.indexOf(parsed.scopePrefix);
    return validationFailure(
      "VALIDATION_SCOPE_MISMATCH",
      "Formula prefix does not match the requested settlement scope",
      {
        start: prefixStart < 0 ? 0 : prefixStart,
        end:
          (prefixStart < 0 ? 0 : prefixStart) + parsed.scopePrefix.length,
      },
    );
  }

  if (DISABLED_PHASE_ONE_SCOPES.has(validatedOptions.scope)) {
    return validationFailure(
      "VALIDATION_SCOPE_DISABLED",
      "This settlement scope is disabled in Phase 1",
      rootSpan,
    );
  }

  try {
    const context: CompileContext = {
      scope: validatedOptions.scope,
      executionGrain: validatedOptions.executionGrain,
      spansByPath: parsed.spansByPath,
      rootSpan,
      parameterTypes: validatedOptions.parameterTypes,
      referencedVariables: new Set(),
      referencedParameters: new Set(),
      componentNames: new Set(),
      componentTypes: new Map(),
      compositionMode: validatedOptions.compositionMode,
    };

    const compiledAst = compileTopLevel(parsed.ast, "$", context);
    validateModifierComposition(compiledAst, parsed.ast, "$", context);
    const schemaResult = compiledAstNodeSchema.safeParse(
      copyOwnData(compiledAst),
    );
    if (!schemaResult.success) {
      throw issue(
        "VALIDATION_COMPILED_AST_INVALID",
        "Compiled formula does not match the persisted AST contract",
        rootSpan,
      );
    }

    return {
      ok: true,
      compiledAst: schemaResult.data,
      variables: [...context.referencedVariables].sort(),
      parameters: [...context.referencedParameters].sort(),
      formulaHash: createHash("sha256")
        .update(canonicalJson(schemaResult.data), "utf8")
        .digest("hex"),
    };
  } catch (error) {
    if (error instanceof ValidationFailure) {
      return { ok: false, issues: [error.issue] };
    }
    throw error;
  }
}

function variable(
  valueType: RuntimeValueType,
  scopes: readonly CustomRuleScope[],
  grains: readonly CustomRuleExecutionGrain[],
): VariableDefinition {
  return { valueType, scopes, grains };
}

function validateRuntimeOptions(
  options: unknown,
  span: CustomRuleSourceSpan,
): ValidatedOptions {
  const optionValues = isPlainRecord(options)
    ? readOwnDataProperties(
      options,
      ["scope", "executionGrain", "parameters", "compositionMode"],
      ["scope", "executionGrain"],
    )
    : null;
  const scope = optionValues?.get("scope");
  const executionGrain = optionValues?.get("executionGrain");
  const parametersValue = optionValues?.has("parameters")
    ? optionValues.get("parameters")
    : [];
  const compositionMode = optionValues?.get("compositionMode");
  if (
    !optionValues ||
    !CUSTOM_RULE_SCOPES.includes(scope as CustomRuleScope) ||
    !CUSTOM_RULE_EXECUTION_GRAINS.includes(
      executionGrain as CustomRuleExecutionGrain,
    ) ||
    !Array.isArray(parametersValue) ||
    (compositionMode !== undefined &&
      !CUSTOM_RULE_COMPOSITION_MODES.includes(
        compositionMode as CustomRuleCompositionMode,
      ))
  ) {
    throw invalidOptions(span);
  }

  const parameters = parametersValue;
  if (parameters.length > MAX_PARAMETERS) {
    throw issue(
      "VALIDATION_PARAMETER_LIMIT",
      "Parameter count exceeds the validation limit",
      span,
    );
  }

  const parameterTypes = new Map<string, RuntimeValueType>();
  let parameterTypeNodeCount = 0;
  for (const parameter of parameters) {
    const parameterValues = isPlainRecord(parameter)
      ? readOwnDataProperties(
        parameter,
        ["name", "valueType"],
        ["name", "valueType"],
      )
      : null;
    const name = parameterValues?.get("name");
    const rawValueType = parameterValues?.get("valueType");
    if (
      !parameterValues ||
      typeof name !== "string" ||
      !IDENTIFIER_PATTERN.test(name) ||
      RESERVED_IDENTIFIERS.has(name.toLowerCase()) ||
      parameterTypes.has(name)
    ) {
      throw invalidOptions(span);
    }
    const copiedType = validateAndCopyParameterType(
      rawValueType,
      parameterTypeNodeCount,
      span,
    );
    parameterTypeNodeCount = copiedType.nodeCount;
    const valueType = runtimeValueTypeSchema.safeParse(copiedType.value);
    if (!valueType.success) {
      throw invalidOptions(span);
    }
    parameterTypes.set(name, valueType.data);
  }

  return {
    scope: scope as CustomRuleScope,
    executionGrain: executionGrain as CustomRuleExecutionGrain,
    parameterTypes,
    compositionMode:
      compositionMode === undefined
        ? null
        : (compositionMode as CustomRuleCompositionMode),
  };
}

function validateAndCopyParameterType(
  root: unknown,
  initialNodeCount: number,
  span: CustomRuleSourceSpan,
): { value: unknown; nodeCount: number } {
  const holder = Object.create(null) as Record<string, unknown>;
  const stack: Array<{
    source: unknown;
    depth: number;
    target: Record<string, unknown>;
    key: string;
  }> = [
    {
      source: root,
      depth: 1,
      target: holder,
      key: "value",
    },
  ];
  let nodeCount = initialNodeCount;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    if (current.depth > MAX_PARAMETER_TYPE_DEPTH) {
      throw parameterTypeLimit(span);
    }
    nodeCount += 1;
    if (nodeCount > MAX_PARAMETER_TYPE_NODES) {
      throw parameterTypeLimit(span);
    }

    const values = snapshotOwnEnumerableData(current.source);
    const kind = values?.get("kind");
    const copy = Object.create(null) as Record<string, unknown>;
    if (!values || typeof kind !== "string") {
      throw invalidOptions(span);
    }
    current.target[current.key] = copy;

    if (kind === "scalar") {
      if (
        !hasExactDataKeys(values, ["kind", "scalarType"]) ||
        typeof values.get("scalarType") !== "string"
      ) {
        throw invalidOptions(span);
      }
      copy.kind = kind;
      copy.scalarType = values.get("scalarType");
    } else if (kind === "array") {
      if (!hasExactDataKeys(values, ["kind", "itemType"])) {
        throw invalidOptions(span);
      }
      copy.kind = kind;
      stack.push({
        source: values.get("itemType"),
        depth: current.depth + 1,
        target: copy,
        key: "itemType",
      });
    } else if (kind === "object") {
      if (!hasExactDataKeys(values, ["kind", "fields"])) {
        throw invalidOptions(span);
      }
      const fieldValues = snapshotOwnEnumerableData(values.get("fields"));
      if (!fieldValues) {
        throw invalidOptions(span);
      }
      const fieldsCopy = Object.create(null) as Record<string, unknown>;
      copy.kind = kind;
      copy.fields = fieldsCopy;
      const fields = [...fieldValues.entries()];
      for (let index = fields.length - 1; index >= 0; index -= 1) {
        const field = fields[index];
        if (!field) {
          continue;
        }
        stack.push({
          source: field[1],
          depth: current.depth + 1,
          target: fieldsCopy,
          key: field[0],
        });
      }
    } else {
      throw invalidOptions(span);
    }
  }

  return { value: holder.value, nodeCount };
}

function parameterTypeLimit(span: CustomRuleSourceSpan): ValidationFailure {
  return issue(
    "VALIDATION_PARAMETER_TYPE_LIMIT",
    "Parameter type complexity exceeds the validation limit",
    span,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotOwnEnumerableData(
  value: unknown,
): ReadonlyMap<string, unknown> | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const values = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)?.value;
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return null;
    }
    values.set(key, descriptor.value);
  }
  return values;
}

function hasExactDataKeys(
  values: ReadonlyMap<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    values.size === keys.length &&
    keys.every((key) => values.has(key))
  );
}

function copyOwnData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyOwnData);
  }
  if (value !== null && typeof value === "object") {
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      copy[key] = copyOwnData((value as Record<string, unknown>)[key]);
    }
    return copy;
  }
  return value;
}

function readOwnDataProperties(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): ReadonlyMap<string, unknown> | null {
  const values = snapshotOwnEnumerableData(value);
  if (
    !values ||
    [...values.keys()].some((key) => !allowedKeys.includes(key))
  ) {
    return null;
  }
  return requiredKeys.every((key) => values.has(key)) ? values : null;
}

function invalidOptions(span: CustomRuleSourceSpan): ValidationFailure {
  return issue(
    "VALIDATION_INVALID_OPTIONS",
    "Validation options are invalid",
    span,
  );
}

function compileTopLevel(
  node: NormalizedAstNode,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  if (node.kind === "call") {
    assertKnownFunction(node.callee, path, context);
  }
  if (node.kind !== "call" || node.callee !== "money_result") {
    throw issueAt(
      "VALIDATION_INVALID_OUTPUT",
      "Phase 1 formulas must return money_result",
      path,
      context,
    );
  }
  return compileMoneyResult(node, path, context);
}

function compileMoneyResult(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 1, path, context);
  const sourceObject = node.arguments[0];
  if (!sourceObject || sourceObject.kind !== "object") {
    throw issueAt(
      "VALIDATION_INVALID_OUTPUT",
      "money_result requires one component object",
      path,
      context,
    );
  }

  const names = new Set<string>();
  for (const entry of sourceObject.entries) {
    if (names.has(entry.key)) {
      throw issueAt(
        "VALIDATION_DUPLICATE_COMPONENT",
        "money_result component names must be unique",
        path,
        context,
      );
    }
    names.add(entry.key);
  }
  if (!names.has("final")) {
    throw issueAt(
      "VALIDATION_COMPONENT_FINAL_REQUIRED",
      "money_result requires a final component",
      pathForArgument(path, 0),
      context,
    );
  }

  assertAcyclicComponents(sourceObject, names, pathForArgument(path, 0), context);

  const componentTypes = new Map<string, RuntimeValueType>();
  const componentContext: CompileContext = {
    ...context,
    componentNames: names,
    componentTypes,
    compositionMode: context.compositionMode,
  };
  const entries: Array<{ key: string; value: CompiledAstNode }> = [];
  const fields: Record<string, RuntimeValueType> = {};

  for (const [index, entry] of sourceObject.entries.entries()) {
    const valuePath = pathForObjectValue(pathForArgument(path, 0), index);
    const compiledValue = compileNode(entry.value, valuePath, componentContext);
    expectMoney(
      compiledValue,
      entry.value,
      valuePath,
      componentContext,
      entry.key === "final"
        ? "VALIDATION_INVALID_OUTPUT"
        : "VALIDATION_COMPONENT_TYPE",
    );
    entries.push({ key: entry.key, value: compiledValue });
    fields[entry.key] = MONEY_TYPE;
    componentTypes.set(entry.key, MONEY_TYPE);
  }

  const objectType: RuntimeValueType = { kind: "object", fields };
  const compiledObject: CompiledAstNode = {
    kind: "object",
    entries,
    inferredType: objectType,
  };
  return {
    kind: "call",
    callee: "money_result",
    arguments: [compiledObject],
    inferredType: objectType,
  };
}

function compileNode(
  node: NormalizedAstNode,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  switch (node.kind) {
    case "literal":
      return compileLiteral(node, path, context);
    case "identifier":
      return compileIdentifier(node, path, context);
    case "unary":
      return compileUnary(node, path, context);
    case "binary":
      return compileBinary(node, path, context);
    case "call":
      return compileCall(node, path, context);
    case "array":
      return compileArray(node, path, context);
    case "object":
      return compileObject(node, path, context);
  }
}

function compileLiteral(
  node: Extract<NormalizedAstNode, { kind: "literal" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  if (node.value === null) {
    throw issueAt(
      "VALIDATION_UNSUPPORTED_LITERAL",
      "null is allowed only as an unbounded tier limit",
      path,
      context,
    );
  }
  if (typeof node.value === "number") {
    if (Number.isSafeInteger(node.value)) {
      return {
        kind: "literal",
        inferredType: INTEGER_TYPE,
        value: node.value,
      };
    }
    return {
      kind: "literal",
      inferredType: NUMBER_TYPE,
      value: node.value,
    };
  }
  if (typeof node.value === "boolean") {
    return {
      kind: "literal",
      inferredType: BOOLEAN_TYPE,
      value: node.value,
    };
  }
  return {
    kind: "literal",
    inferredType: STRING_TYPE,
    value: node.value,
  };
}

function compileIdentifier(
  node: Extract<NormalizedAstNode, { kind: "identifier" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  if (context.componentNames.has(node.name)) {
    const componentType = context.componentTypes.get(node.name);
    if (!componentType) {
      throw issueAt(
        "VALIDATION_COMPONENT_FORWARD_REFERENCE",
        "Components may reference only earlier components",
        path,
        context,
      );
    }
    return {
      kind: "identifier",
      name: node.name,
      inferredType: componentType,
    };
  }

  const definition = Object.hasOwn(VARIABLE_DEFINITIONS, node.name)
    ? VARIABLE_DEFINITIONS[node.name]
    : undefined;
  if (
    node.name === "prior_layer_amount" &&
    !isModifierCompositionMode(context.compositionMode)
  ) {
    throw issueAt(
      "VALIDATION_UNKNOWN_VARIABLE",
      "Formula references an unknown variable",
      path,
      context,
    );
  }
  if (!definition) {
    throw issueAt(
      "VALIDATION_UNKNOWN_VARIABLE",
      "Formula references an unknown variable",
      path,
      context,
    );
  }
  if (!definition.scopes.includes(context.scope)) {
    throw issueAt(
      "VALIDATION_VARIABLE_SCOPE",
      "Variable is not available for this settlement scope",
      path,
      context,
    );
  }
  if (!definition.grains.includes(context.executionGrain)) {
    throw issueAt(
      "VALIDATION_VARIABLE_GRAIN",
      "Variable is not available at this execution grain",
      path,
      context,
    );
  }

  context.referencedVariables.add(node.name);
  return {
    kind: "identifier",
    name: node.name,
    inferredType: definition.valueType,
  };
}

function validateModifierComposition(
  compiledAst: CompiledAstNode,
  sourceAst: NormalizedAstNode,
  path: string,
  context: CompileContext,
): void {
  const mode = context.compositionMode;
  if (!mode) return;
  const finalEntry = finalMoneyResultEntry(compiledAst);
  const finalSource = finalMoneyResultSourceEntry(sourceAst);
  if (!finalEntry || !finalSource) return;

  if (mode !== "add" && isNegativeMoneyLiteral(finalEntry.value)) {
    throw issueAt(
      "VALIDATION_NEGATIVE_FINAL_AMOUNT",
      "Signed deltas are permitted only for add modifiers",
      finalSource.path,
      context,
    );
  }
  if (
    mode === "multiply" &&
    !isCallWithFirstIdentifier(finalEntry.value, "percent", "prior_layer_amount")
  ) {
    throw issueAt(
      "VALIDATION_MODIFIER_COMPOSITION",
      "Multiply modifiers must derive final from percent(prior_layer_amount, ...)",
      finalSource.path,
      context,
    );
  }
  if (
    mode === "clamp" &&
    !isCallWithFirstIdentifier(finalEntry.value, "clamp", "prior_layer_amount")
  ) {
    throw issueAt(
      "VALIDATION_MODIFIER_COMPOSITION",
      "Clamp modifiers must derive final from clamp(prior_layer_amount, ...)",
      finalSource.path,
      context,
    );
  }
}

function finalMoneyResultEntry(
  compiledAst: CompiledAstNode,
): { key: string; value: CompiledAstNode } | undefined {
  if (
    compiledAst.kind !== "call" ||
    compiledAst.callee !== "money_result" ||
    compiledAst.arguments[0]?.kind !== "object"
  ) {
    return undefined;
  }
  return compiledAst.arguments[0].entries.find((entry) => entry.key === "final");
}

function finalMoneyResultSourceEntry(
  sourceAst: NormalizedAstNode,
): { value: NormalizedAstNode; path: string } | undefined {
  if (
    sourceAst.kind !== "call" ||
    sourceAst.callee !== "money_result" ||
    sourceAst.arguments[0]?.kind !== "object"
  ) {
    return undefined;
  }
  const index = sourceAst.arguments[0].entries.findIndex(
    (entry) => entry.key === "final",
  );
  const entry = sourceAst.arguments[0].entries[index];
  return entry
    ? { value: entry.value, path: pathForObjectValue(pathForArgument("$", 0), index) }
    : undefined;
}

function isNegativeMoneyLiteral(node: CompiledAstNode): boolean {
  return node.kind === "literal" && "valueCents" in node && node.valueCents < 0;
}

function isCallWithFirstIdentifier(
  node: CompiledAstNode,
  callee: string,
  identifier: string,
): boolean {
  return (
    node.kind === "call" &&
    node.callee === callee &&
    node.arguments[0]?.kind === "identifier" &&
    node.arguments[0].name === identifier
  );
}

function isModifierCompositionMode(
  mode: CustomRuleCompositionMode | null,
): boolean {
  return (
    mode === "add" ||
    mode === "multiply" ||
    mode === "clamp" ||
    mode === "replace"
  );
}

function compileUnary(
  node: Extract<NormalizedAstNode, { kind: "unary" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  const argumentPath = path + ".argument";
  const argument = compileNode(node.argument, argumentPath, context);
  if (node.operator === "!") {
    expectExactType(
      argument,
      node.argument,
      BOOLEAN_TYPE,
      argumentPath,
      context,
    );
    return {
      kind: "unary",
      operator: node.operator,
      argument,
      inferredType: BOOLEAN_TYPE,
    };
  }
  if (
    (node.operator === "+" || node.operator === "-") &&
    isNumericScalar(argument.inferredType)
  ) {
    return {
      kind: "unary",
      operator: node.operator,
      argument,
      inferredType: argument.inferredType,
    };
  }
  throw issueAt(
    "VALIDATION_TYPE_MISMATCH",
    "Unary operator received an incompatible value",
    path,
    context,
  );
}

function compileBinary(
  node: Extract<NormalizedAstNode, { kind: "binary" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  const leftPath = path + ".left";
  const rightPath = path + ".right";
  const left = compileNode(node.left, leftPath, context);
  const right = compileNode(node.right, rightPath, context);
  if (node.operator === "/" || node.operator === "%") {
    const divisor = evaluateNumericConstant(right);
    if (divisor.kind === "invalid") {
      throw issueAt(
        "VALIDATION_INVALID_CONSTANT_ARITHMETIC",
        "Constant arithmetic is non-finite or unsafe",
        rightPath,
        context,
      );
    }
    if (divisor.kind === "constant" && divisor.value === 0) {
      throw issueAt(
        "VALIDATION_ZERO_DIVISOR",
        "Divisor cannot be statically zero",
        rightPath,
        context,
      );
    }
  }
  let inferredType: RuntimeValueType;

  if (node.operator === "&&" || node.operator === "||") {
    expectExactType(left, node.left, BOOLEAN_TYPE, leftPath, context);
    expectExactType(right, node.right, BOOLEAN_TYPE, rightPath, context);
    inferredType = BOOLEAN_TYPE;
  } else if (node.operator === "+" || node.operator === "-") {
    inferredType = additiveType(left, right, node.left, node.right, path, context);
  } else if (node.operator === "*") {
    inferredType = multiplicationType(
      left,
      right,
      node.left,
      node.right,
      path,
      context,
    );
  } else if (node.operator === "/") {
    inferredType = divisionType(left, right, path, context);
  } else if (node.operator === "%") {
    inferredType = generalNumericType(left, right, path, context);
  } else if (
    node.operator === "==" ||
    node.operator === "!=" ||
    node.operator === "===" ||
    node.operator === "!=="
  ) {
    assertComparable(left, right, path, context);
    inferredType = BOOLEAN_TYPE;
  } else if (
    node.operator === "<" ||
    node.operator === "<=" ||
    node.operator === ">" ||
    node.operator === ">="
  ) {
    assertOrdered(left, right, path, context);
    inferredType = BOOLEAN_TYPE;
  } else {
    throw issueAt(
      "VALIDATION_UNSUPPORTED_OPERATOR",
      "Operator is not supported by the typed compiler",
      path,
      context,
    );
  }

  return {
    kind: "binary",
    operator: node.operator,
    left,
    right,
    inferredType,
  };
}

function compileCall(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertKnownFunction(node.callee, path, context);

  switch (node.callee) {
    case "yuan":
      return compileUnitLiteral(node, path, context, "money_cents");
    case "rate_percent":
      return compileUnitLiteral(node, path, context, "rate_bps");
    case "parameter":
      return compileParameter(node, path, context);
    case "if":
      return compileIf(node, path, context);
    case "min":
    case "max":
      return compileMinMax(node, path, context);
    case "clamp":
      return compileClamp(node, path, context);
    case "round_money":
      return compileRoundMoney(node, path, context);
    case "tiered":
      return compileTiered(node, path, context);
    case "percent":
      return compilePercent(node, path, context);
    case "evidence_multiplier":
      return compileEvidenceMultiplier(node, path, context);
    case "in":
      return compileIn(node, path, context);
    case "contains":
      return compileContains(node, path, context);
    case "money_result":
      throw issueAt(
        "VALIDATION_INVALID_OUTPUT",
        "money_result may appear only at the formula root",
        path,
        context,
      );
  }

  throw issueAt(
    "VALIDATION_UNKNOWN_FUNCTION",
    "Formula calls an unknown function",
    path,
    context,
  );
}

function compileUnitLiteral(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
  unit: "money_cents" | "rate_bps",
): CompiledAstNode {
  assertArity(node, 1, path, context);
  const numericValue = readSignedNumericLiteral(node.arguments[0]);
  if (numericValue === null) {
    const argument = node.arguments[0];
    if (argument) {
      compileNode(argument, pathForArgument(path, 0), context);
    }
    throw issueAt(
      "VALIDATION_INVALID_UNIT_LITERAL",
      "Unit constructors require a finite numeric literal",
      pathForArgument(path, 0),
      context,
    );
  }

  try {
    if (unit === "money_cents") {
      return {
        kind: "literal",
        inferredType: MONEY_TYPE,
        valueCents: yuanToCentsStrict(numericValue),
      };
    }
    return {
      kind: "literal",
      inferredType: RATE_TYPE,
      valueBps: percentToBpsStrict(numericValue),
    };
  } catch {
    throw issueAt(
      "VALIDATION_INVALID_UNIT_LITERAL",
      "Unit literal cannot be represented exactly",
      pathForArgument(path, 0),
      context,
    );
  }
}

function compileParameter(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 1, path, context);
  const nameNode = node.arguments[0];
  if (
    !nameNode ||
    nameNode.kind !== "literal" ||
    typeof nameNode.value !== "string"
  ) {
    throw issueAt(
      "VALIDATION_INVALID_PARAMETER",
      "parameter requires a string literal name",
      pathForArgument(path, 0),
      context,
    );
  }
  const valueType = context.parameterTypes.get(nameNode.value);
  if (!valueType) {
    throw issueAt(
      "VALIDATION_UNKNOWN_PARAMETER",
      "Formula references an undeclared parameter",
      path,
      context,
    );
  }
  context.referencedParameters.add(nameNode.value);
  return {
    kind: "call",
    callee: "parameter",
    arguments: [compileLiteral(nameNode, pathForArgument(path, 0), context)],
    inferredType: valueType,
  };
}

function compileIf(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 3, path, context);
  const args = compileArguments(node, path, context);
  expectExactType(
    args[0],
    node.arguments[0],
    BOOLEAN_TYPE,
    pathForArgument(path, 0),
    context,
  );
  const branchType = commonType(
    args[1],
    args[2],
    node.arguments[1],
    node.arguments[2],
    path,
    context,
  );
  return compiledCall(node.callee, args, branchType);
}

function compileMinMax(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const args = compileArguments(node, path, context);
  const valueType = commonNumericType(
    args[0],
    args[1],
    node.arguments[0],
    node.arguments[1],
    path,
    context,
  );
  return compiledCall(node.callee, args, valueType);
}

function compileClamp(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 3, path, context);
  const args = compileArguments(node, path, context);
  const lowerType = commonNumericType(
    args[0],
    args[1],
    node.arguments[0],
    node.arguments[1],
    path,
    context,
  );
  const valueType = commonNumericType(
    { ...args[0], inferredType: lowerType } as CompiledAstNode,
    args[2],
    node.arguments[0],
    node.arguments[2],
    path,
    context,
  );
  return compiledCall(node.callee, args, valueType);
}

function compileRoundMoney(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 1, path, context);
  const args = compileArguments(node, path, context);
  expectMoney(
    args[0],
    node.arguments[0],
    pathForArgument(path, 0),
    context,
    "VALIDATION_UNIT_MISMATCH",
  );
  return compiledCall(node.callee, args, MONEY_TYPE);
}

function compilePercent(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const args = compileArguments(node, path, context);
  expectMoney(
    args[0],
    node.arguments[0],
    pathForArgument(path, 0),
    context,
    "VALIDATION_UNIT_MISMATCH",
  );
  expectRate(
    args[1],
    node.arguments[1],
    pathForArgument(path, 1),
    context,
  );
  return compiledCall(node.callee, args, MONEY_TYPE);
}

function compileTiered(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const minutesPath = pathForArgument(path, 0);
  const minutes = compileNode(node.arguments[0], minutesPath, context);
  if (!isGeneralNumeric(minutes.inferredType)) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "tiered minutes must be an integer or number",
      minutesPath,
      context,
    );
  }

  const tiersNode = node.arguments[1];
  const tiersPath = pathForArgument(path, 1);
  if (!tiersNode || tiersNode.kind !== "array" || tiersNode.elements.length === 0) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "tiered requires a nonempty tier array",
      tiersPath,
      context,
    );
  }

  const compiledTiers = tiersNode.elements.map((tier, index) =>
    compileTier(tier, pathForArrayElement(tiersPath, index), context, index, tiersNode.elements.length),
  );
  const tierItemType: RuntimeValueType = {
    kind: "object",
    fields: { rate_per_hour: MONEY_TYPE },
  };
  const tiers: CompiledAstNode = {
    kind: "array",
    elements: compiledTiers,
    inferredType: { kind: "array", itemType: tierItemType },
  };
  return compiledCall(node.callee, [minutes, tiers], MONEY_TYPE);
}

function compileTier(
  node: NormalizedAstNode,
  path: string,
  context: CompileContext,
  index: number,
  tierCount: number,
): CompiledAstNode {
  if (node.kind !== "object") {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Each tier must be an object",
      path,
      context,
    );
  }
  assertUniqueObjectKeys(node, path, context);
  const keys = new Set(node.entries.map((entry) => entry.key));
  if (
    keys.size !== 2 ||
    !keys.has("upto") ||
    !keys.has("rate_per_hour")
  ) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Each tier requires only upto and rate_per_hour",
      path,
      context,
    );
  }

  const entries: Array<{ key: string; value: CompiledAstNode }> = [];
  const fields: Record<string, RuntimeValueType> = {};
  for (const [entryIndex, entry] of node.entries.entries()) {
    const valuePath = pathForObjectValue(path, entryIndex);
    if (entry.key === "upto") {
      if (entry.value.kind === "literal" && entry.value.value === null) {
        if (index !== tierCount - 1) {
          throw issueAt(
            "VALIDATION_TYPE_MISMATCH",
            "Only the final tier may be unbounded",
            valuePath,
            context,
          );
        }
        continue;
      }
      const upto = compileNode(entry.value, valuePath, context);
      if (!isGeneralNumeric(upto.inferredType)) {
        throw issueAt(
          "VALIDATION_TYPE_MISMATCH",
          "Tier limits must be integers or numbers",
          valuePath,
          context,
        );
      }
      entries.push({ key: entry.key, value: upto });
      fields[entry.key] = upto.inferredType;
      continue;
    }

    const rate = compileNode(entry.value, valuePath, context);
    expectMoney(
      rate,
      entry.value,
      valuePath,
      context,
      "VALIDATION_UNIT_MISMATCH",
    );
    entries.push({ key: entry.key, value: rate });
    fields[entry.key] = MONEY_TYPE;
  }

  return {
    kind: "object",
    entries,
    inferredType: { kind: "object", fields },
  };
}

function compileEvidenceMultiplier(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const levelPath = pathForArgument(path, 0);
  const level = compileNode(node.arguments[0], levelPath, context);
  expectExactType(level, node.arguments[0], STRING_TYPE, levelPath, context);

  const ratesNode = node.arguments[1];
  const ratesPath = pathForArgument(path, 1);
  if (!ratesNode || ratesNode.kind !== "object") {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "evidence_multiplier requires a rate object",
      ratesPath,
      context,
    );
  }
  assertUniqueObjectKeys(ratesNode, ratesPath, context);
  const keys = [...ratesNode.entries.map((entry) => entry.key)].sort();
  if (canonicalJson(keys) !== canonicalJson(["green", "red", "yellow"])) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Evidence rates must define green, yellow, and red",
      ratesPath,
      context,
    );
  }

  const entries: Array<{ key: string; value: CompiledAstNode }> = [];
  const fields: Record<string, RuntimeValueType> = {};
  for (const [index, entry] of ratesNode.entries.entries()) {
    const valuePath = pathForObjectValue(ratesPath, index);
    const value = compileNode(entry.value, valuePath, context);
    expectRate(value, entry.value, valuePath, context);
    entries.push({ key: entry.key, value });
    fields[entry.key] = RATE_TYPE;
  }
  const rates: CompiledAstNode = {
    kind: "object",
    entries,
    inferredType: { kind: "object", fields },
  };
  return compiledCall(node.callee, [level, rates], RATE_TYPE);
}

function compileIn(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const value = compileNode(node.arguments[0], pathForArgument(path, 0), context);
  const candidatesNode = node.arguments[1];
  const candidatesPath = pathForArgument(path, 1);
  if (!candidatesNode || candidatesNode.kind !== "array") {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "in requires an array as its second argument",
      candidatesPath,
      context,
    );
  }
  const elements = candidatesNode.elements.map((element, index) => {
    const elementPath = pathForArrayElement(candidatesPath, index);
    const compiled = compileNode(element, elementPath, context);
    if (!sameType(compiled.inferredType, value.inferredType)) {
      throw issueAt(
        "VALIDATION_TYPE_MISMATCH",
        "in candidates must match the searched value type",
        elementPath,
        context,
      );
    }
    return compiled;
  });
  const candidates: CompiledAstNode = {
    kind: "array",
    elements,
    inferredType: {
      kind: "array",
      itemType: value.inferredType,
    },
  };
  return compiledCall(node.callee, [value, candidates], BOOLEAN_TYPE);
}

function compileContains(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertArity(node, 2, path, context);
  const args = compileArguments(node, path, context);
  const collectionType = args[0].inferredType;
  if (
    collectionType.kind !== "array" ||
    !sameType(collectionType.itemType, args[1].inferredType)
  ) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "contains requires an array and a matching item",
      path,
      context,
    );
  }
  return compiledCall(node.callee, args, BOOLEAN_TYPE);
}

function compileArray(
  node: Extract<NormalizedAstNode, { kind: "array" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  if (node.elements.length === 0) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "An empty array has no inferable item type",
      path,
      context,
    );
  }
  const elements = node.elements.map((element, index) =>
    compileNode(element, pathForArrayElement(path, index), context),
  );
  const itemType = elements[0].inferredType;
  if (!elements.every((element) => sameType(element.inferredType, itemType))) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Array elements must share one type",
      path,
      context,
    );
  }
  return {
    kind: "array",
    elements,
    inferredType: { kind: "array", itemType },
  };
}

function compileObject(
  node: Extract<NormalizedAstNode, { kind: "object" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode {
  assertUniqueObjectKeys(node, path, context);
  const entries = node.entries.map((entry, index) => ({
    key: entry.key,
    value: compileNode(entry.value, pathForObjectValue(path, index), context),
  }));
  const fields: Record<string, RuntimeValueType> = {};
  for (const entry of entries) {
    fields[entry.key] = entry.value.inferredType;
  }
  return {
    kind: "object",
    entries,
    inferredType: { kind: "object", fields },
  };
}

function assertKnownFunction(
  callee: string,
  path: string,
  context: CompileContext,
): void {
  if (DISABLED_FUNCTIONS.has(callee)) {
    throw issueAt(
      "VALIDATION_FUNCTION_DISABLED",
      "Function is reserved for a later phase",
      path,
      context,
    );
  }
  if (!ALLOWED_FUNCTIONS.has(callee)) {
    throw issueAt(
      "VALIDATION_UNKNOWN_FUNCTION",
      "Formula calls an unknown function",
      path,
      context,
    );
  }
}

function assertArity(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  expected: number,
  path: string,
  context: CompileContext,
): void {
  if (node.arguments.length !== expected) {
    throw issueAt(
      "VALIDATION_WRONG_ARITY",
      node.callee + " expects " + expected + " arguments",
      path,
      context,
    );
  }
}

function compileArguments(
  node: Extract<NormalizedAstNode, { kind: "call" }>,
  path: string,
  context: CompileContext,
): CompiledAstNode[] {
  return node.arguments.map((argument, index) =>
    compileNode(argument, pathForArgument(path, index), context),
  );
}

function compiledCall(
  callee: string,
  args: CompiledAstNode[],
  inferredType: RuntimeValueType,
): CompiledAstNode {
  return {
    kind: "call",
    callee,
    arguments: args,
    inferredType,
  };
}

function readSignedNumericLiteral(node: NormalizedAstNode | undefined): number | null {
  if (!node) {
    return null;
  }
  if (
    node.kind === "literal" &&
    typeof node.value === "number" &&
    Number.isFinite(node.value)
  ) {
    return node.value;
  }
  if (
    node.kind === "unary" &&
    (node.operator === "+" || node.operator === "-") &&
    node.argument.kind === "literal" &&
    typeof node.argument.value === "number" &&
    Number.isFinite(node.argument.value)
  ) {
    return node.operator === "-" ? -node.argument.value : node.argument.value;
  }
  return null;
}

function additiveType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  leftSource: NormalizedAstNode,
  rightSource: NormalizedAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (sameType(left.inferredType, right.inferredType)) {
    if (isNumericScalar(left.inferredType)) {
      return left.inferredType;
    }
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Addition and subtraction require numeric values",
      path,
      context,
    );
  }
  if (
    isGeneralNumeric(left.inferredType) &&
    isGeneralNumeric(right.inferredType)
  ) {
    return NUMBER_TYPE;
  }
  throwUnitOrTypeMismatch(
    left,
    right,
    leftSource,
    rightSource,
    path,
    context,
  );
}

function multiplicationType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  leftSource: NormalizedAstNode,
  rightSource: NormalizedAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (
    (isMoney(left.inferredType) && isRate(right.inferredType)) ||
    (isRate(left.inferredType) && isMoney(right.inferredType))
  ) {
    return MONEY_TYPE;
  }
  if (
    (isMoney(left.inferredType) && isGeneralNumeric(right.inferredType)) ||
    (isGeneralNumeric(left.inferredType) && isMoney(right.inferredType))
  ) {
    return MONEY_TYPE;
  }
  if (
    (isRate(left.inferredType) && isGeneralNumeric(right.inferredType)) ||
    (isGeneralNumeric(left.inferredType) && isRate(right.inferredType))
  ) {
    return RATE_TYPE;
  }
  if (
    isGeneralNumeric(left.inferredType) &&
    isGeneralNumeric(right.inferredType)
  ) {
    return generalNumericType(left, right, path, context);
  }
  throwUnitOrTypeMismatch(
    left,
    right,
    leftSource,
    rightSource,
    path,
    context,
  );
}

function divisionType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (isMoney(left.inferredType) || isMoney(right.inferredType)) {
    throw issueAt(
      "VALIDATION_UNIT_MISMATCH",
      "General division cannot accept money values",
      path,
      context,
    );
  }
  if (
    isRate(left.inferredType) &&
    isGeneralNumeric(right.inferredType)
  ) {
    return RATE_TYPE;
  }
  if (
    (isRate(left.inferredType) && isRate(right.inferredType)) ||
    (isGeneralNumeric(left.inferredType) &&
      isGeneralNumeric(right.inferredType))
  ) {
    return NUMBER_TYPE;
  }
  throw issueAt(
    "VALIDATION_TYPE_MISMATCH",
    "Division requires compatible numeric values",
    path,
    context,
  );
}

function generalNumericType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (
    !isGeneralNumeric(left.inferredType) ||
    !isGeneralNumeric(right.inferredType)
  ) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Operator requires unitless numeric values",
      path,
      context,
    );
  }
  return isInteger(left.inferredType) && isInteger(right.inferredType)
    ? INTEGER_TYPE
    : NUMBER_TYPE;
}

function assertComparable(
  left: CompiledAstNode,
  right: CompiledAstNode,
  path: string,
  context: CompileContext,
): void {
  if (
    sameType(left.inferredType, right.inferredType) ||
    (isGeneralNumeric(left.inferredType) &&
      isGeneralNumeric(right.inferredType))
  ) {
    return;
  }
  throw issueAt(
    "VALIDATION_TYPE_MISMATCH",
    "Equality operands must have compatible types",
    path,
    context,
  );
}

function assertOrdered(
  left: CompiledAstNode,
  right: CompiledAstNode,
  path: string,
  context: CompileContext,
): void {
  if (
    (sameType(left.inferredType, right.inferredType) &&
      isOrderedScalar(left.inferredType)) ||
    (isGeneralNumeric(left.inferredType) &&
      isGeneralNumeric(right.inferredType))
  ) {
    return;
  }
  throw issueAt(
    "VALIDATION_TYPE_MISMATCH",
    "Ordered comparison requires compatible scalar values",
    path,
    context,
  );
}

function commonType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  leftSource: NormalizedAstNode,
  rightSource: NormalizedAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (sameType(left.inferredType, right.inferredType)) {
    return left.inferredType;
  }
  if (
    isGeneralNumeric(left.inferredType) &&
    isGeneralNumeric(right.inferredType)
  ) {
    return NUMBER_TYPE;
  }
  throwUnitOrTypeMismatch(
    left,
    right,
    leftSource,
    rightSource,
    path,
    context,
  );
}

function commonNumericType(
  left: CompiledAstNode,
  right: CompiledAstNode,
  leftSource: NormalizedAstNode,
  rightSource: NormalizedAstNode,
  path: string,
  context: CompileContext,
): RuntimeValueType {
  if (
    !isNumericScalar(left.inferredType) ||
    !isNumericScalar(right.inferredType)
  ) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Function requires numeric arguments",
      path,
      context,
    );
  }
  return commonType(
    left,
    right,
    leftSource,
    rightSource,
    path,
    context,
  );
}

function expectMoney(
  compiled: CompiledAstNode,
  source: NormalizedAstNode | undefined,
  path: string,
  context: CompileContext,
  mismatchCode: string,
): void {
  if (isMoney(compiled.inferredType)) {
    return;
  }
  if (source && isRawNumericSource(source)) {
    throw issueAt(
      "VALIDATION_AMBIGUOUS_UNIT",
      "Raw numeric money values must use yuan",
      path,
      context,
    );
  }
  throw issueAt(
    mismatchCode,
    "Expected a money value in cents",
    path,
    context,
  );
}

function expectRate(
  compiled: CompiledAstNode,
  source: NormalizedAstNode | undefined,
  path: string,
  context: CompileContext,
): void {
  if (isRate(compiled.inferredType)) {
    return;
  }
  if (source && isRawNumericSource(source)) {
    throw issueAt(
      "VALIDATION_AMBIGUOUS_UNIT",
      "Raw numeric rates must use rate_percent",
      path,
      context,
    );
  }
  throw issueAt(
    "VALIDATION_UNIT_MISMATCH",
    "Expected a basis-point rate",
    path,
    context,
  );
}

function expectExactType(
  compiled: CompiledAstNode | undefined,
  source: NormalizedAstNode | undefined,
  expected: RuntimeValueType,
  path: string,
  context: CompileContext,
): void {
  if (!compiled || !source || !sameType(compiled.inferredType, expected)) {
    throw issueAt(
      "VALIDATION_TYPE_MISMATCH",
      "Expression has an incompatible type",
      path,
      context,
    );
  }
}

function throwUnitOrTypeMismatch(
  left: CompiledAstNode,
  right: CompiledAstNode,
  leftSource: NormalizedAstNode,
  rightSource: NormalizedAstNode,
  path: string,
  context: CompileContext,
): never {
  if (
    (isUnitType(left.inferredType) && isRawNumericSource(rightSource)) ||
    (isUnitType(right.inferredType) && isRawNumericSource(leftSource))
  ) {
    throw issueAt(
      "VALIDATION_AMBIGUOUS_UNIT",
      "Raw numerics cannot stand in for money or rate values",
      path,
      context,
    );
  }
  if (isUnitType(left.inferredType) || isUnitType(right.inferredType)) {
    throw issueAt(
      "VALIDATION_UNIT_MISMATCH",
      "Money and rate units are incompatible",
      path,
      context,
    );
  }
  throw issueAt(
    "VALIDATION_TYPE_MISMATCH",
    "Expression operands have incompatible types",
    path,
    context,
  );
}

function isRawNumericSource(node: NormalizedAstNode): boolean {
  return (
    (node.kind === "literal" && typeof node.value === "number") ||
    (node.kind === "unary" &&
      (node.operator === "+" || node.operator === "-") &&
      node.argument.kind === "literal" &&
      typeof node.argument.value === "number")
  );
}

function evaluateNumericConstant(
  node: CompiledAstNode,
): NumericConstantEvaluation {
  if (node.kind === "literal") {
    if (
      "value" in node &&
      typeof node.value === "number" &&
      (node.inferredType.scalarType === "number" ||
        node.inferredType.scalarType === "integer")
    ) {
      return constantNumber(node.value);
    }
    if (
      "valueBps" in node &&
      node.inferredType.scalarType === "rate_bps"
    ) {
      return constantNumber(node.valueBps);
    }
    return { kind: "dynamic" };
  }
  if (
    node.kind === "unary" &&
    (node.operator === "+" || node.operator === "-")
  ) {
    const argument = evaluateNumericConstant(node.argument);
    if (argument.kind !== "constant") {
      return argument;
    }
    return constantNumber(
      node.operator === "-" ? -argument.value : argument.value,
    );
  }
  if (
    node.kind !== "binary" ||
    !["+", "-", "*", "/", "%"].includes(node.operator)
  ) {
    return { kind: "dynamic" };
  }

  const left = evaluateNumericConstant(node.left);
  const right = evaluateNumericConstant(node.right);
  if (left.kind === "dynamic" || right.kind === "dynamic") {
    return { kind: "dynamic" };
  }
  if (left.kind === "invalid" || right.kind === "invalid") {
    return { kind: "invalid" };
  }
  if (
    (node.operator === "/" || node.operator === "%") &&
    right.value === 0
  ) {
    return { kind: "invalid" };
  }

  let value: number;
  switch (node.operator) {
    case "+":
      value = left.value + right.value;
      break;
    case "-":
      value = left.value - right.value;
      break;
    case "*":
      value = left.value * right.value;
      break;
    case "/":
      value = left.value / right.value;
      break;
    case "%":
      value = left.value % right.value;
      break;
    default:
      return { kind: "dynamic" };
  }
  return constantNumber(value);
}

function constantNumber(value: number): NumericConstantEvaluation {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? { kind: "constant", value }
    : { kind: "invalid" };
}

function isMoney(valueType: RuntimeValueType): boolean {
  return isScalar(valueType, "money_cents");
}

function isRate(valueType: RuntimeValueType): boolean {
  return isScalar(valueType, "rate_bps");
}

function isInteger(valueType: RuntimeValueType): boolean {
  return isScalar(valueType, "integer");
}

function isGeneralNumeric(valueType: RuntimeValueType): boolean {
  return isScalar(valueType, "integer") || isScalar(valueType, "number");
}

function isNumericScalar(valueType: RuntimeValueType): boolean {
  return (
    isGeneralNumeric(valueType) ||
    isMoney(valueType) ||
    isRate(valueType)
  );
}

function isUnitType(valueType: RuntimeValueType): boolean {
  return isMoney(valueType) || isRate(valueType);
}

function isOrderedScalar(valueType: RuntimeValueType): boolean {
  return (
    isNumericScalar(valueType) ||
    isScalar(valueType, "string") ||
    isScalar(valueType, "timestamp")
  );
}

function isScalar(
  valueType: RuntimeValueType,
  scalarType: RuntimeScalarType,
): boolean {
  return valueType.kind === "scalar" && valueType.scalarType === scalarType;
}

function sameType(
  left: RuntimeValueType,
  right: RuntimeValueType,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertUniqueObjectKeys(
  node: Extract<NormalizedAstNode, { kind: "object" }>,
  path: string,
  context: CompileContext,
): void {
  const keys = new Set<string>();
  for (const entry of node.entries) {
    if (keys.has(entry.key)) {
      throw issueAt(
        "VALIDATION_DUPLICATE_OBJECT_KEY",
        "Object keys must be unique",
        path,
        context,
      );
    }
    keys.add(entry.key);
  }
}

function assertAcyclicComponents(
  objectNode: Extract<NormalizedAstNode, { kind: "object" }>,
  componentNames: ReadonlySet<string>,
  objectPath: string,
  context: CompileContext,
): void {
  const graph = new Map<string, ComponentReference[]>();
  for (const [index, entry] of objectNode.entries.entries()) {
    graph.set(
      entry.key,
      collectComponentReferences(
        entry.value,
        pathForObjectValue(objectPath, index),
        componentNames,
      ),
    );
  }

  const states = new Map<string, "visiting" | "visited">();
  const visit = (name: string): void => {
    states.set(name, "visiting");
    for (const reference of graph.get(name) ?? []) {
      const state = states.get(reference.name);
      if (state === "visiting") {
        throw issueAt(
          "VALIDATION_COMPONENT_CYCLE",
          "money_result components contain a dependency cycle",
          reference.path,
          context,
        );
      }
      if (state !== "visited") {
        visit(reference.name);
      }
    }
    states.set(name, "visited");
  };

  for (const name of graph.keys()) {
    if (!states.has(name)) {
      visit(name);
    }
  }
}

function collectComponentReferences(
  node: NormalizedAstNode,
  path: string,
  componentNames: ReadonlySet<string>,
): ComponentReference[] {
  switch (node.kind) {
    case "literal":
      return [];
    case "identifier":
      return componentNames.has(node.name) ? [{ name: node.name, path }] : [];
    case "unary":
      return collectComponentReferences(
        node.argument,
        path + ".argument",
        componentNames,
      );
    case "binary":
      return [
        ...collectComponentReferences(
          node.left,
          path + ".left",
          componentNames,
        ),
        ...collectComponentReferences(
          node.right,
          path + ".right",
          componentNames,
        ),
      ];
    case "call":
      return node.arguments.flatMap((argument, index) =>
        collectComponentReferences(
          argument,
          pathForArgument(path, index),
          componentNames,
        ),
      );
    case "array":
      return node.elements.flatMap((element, index) =>
        collectComponentReferences(
          element,
          pathForArrayElement(path, index),
          componentNames,
        ),
      );
    case "object":
      return node.entries.flatMap((entry, index) =>
        collectComponentReferences(
          entry.value,
          pathForObjectValue(path, index),
          componentNames,
        ),
      );
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => {
          let child = record[key];
          if (
            key === "entries" &&
            record.kind === "object" &&
            Array.isArray(child)
          ) {
            child = [...child].sort((left, right) => {
              const leftKey =
                typeof left === "object" &&
                left !== null &&
                typeof (left as { key?: unknown }).key === "string"
                  ? (left as { key: string }).key
                  : "";
              const rightKey =
                typeof right === "object" &&
                right !== null &&
                typeof (right as { key?: unknown }).key === "string"
                  ? (right as { key: string }).key
                  : "";
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
          }
          return JSON.stringify(key) + ":" + canonicalJson(child);
        })
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "undefined";
}

function pathForArgument(path: string, index: number): string {
  return path + ".arguments[" + index + "]";
}

function pathForArrayElement(path: string, index: number): string {
  return path + ".elements[" + index + "]";
}

function pathForObjectValue(path: string, index: number): string {
  return path + ".entries[" + index + "].value";
}

function issueAt(
  code: string,
  message: string,
  path: string,
  context: CompileContext,
): ValidationFailure {
  return issue(code, message, context.spansByPath[path] ?? context.rootSpan, path);
}

function issue(
  code: string,
  message: string,
  span: CustomRuleSourceSpan,
  path?: string,
): ValidationFailure {
  return new ValidationFailure({
    code,
    message,
    span,
    ...(path === undefined ? {} : { path }),
  });
}

function validationFailure(
  code: string,
  message: string,
  span: CustomRuleSourceSpan,
): ValidateCustomRuleFormulaResult {
  return { ok: false, issues: [{ code, message, span }] };
}
