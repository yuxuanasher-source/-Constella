import { types as nodeUtilTypes } from "node:util";

import {
  compiledAstNodeSchema,
  typedRuntimeValueSchema,
} from "./custom-rule-contract";
import type {
  CompiledAstNode,
  RuntimeScalarType,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";

export type CustomRuleExecutionIssue = Readonly<{
  code: string;
  message: string;
  path: string;
}>;

export class CustomRuleExecutionError extends Error {
  readonly issue: CustomRuleExecutionIssue;

  constructor(issue: CustomRuleExecutionIssue) {
    super(issue.message);
    this.name = "CustomRuleExecutionError";
    this.issue = Object.freeze({ ...issue });
  }
}

export type CustomRuleMoneyResult = Readonly<{
  kind: "money_result";
  componentsCents: Readonly<Record<string, number>>;
}>;

export type CustomRuleExecutionTraceEvent =
  | Readonly<{
      kind: "ast";
      path: "$";
      canonicalAst: string;
    }>
  | Readonly<{
      kind: "variable";
      path: string;
      name: string;
      value: TypedRuntimeValue;
    }>
  | Readonly<{
      kind: "parameter";
      path: string;
      name: string;
      value: TypedRuntimeValue;
    }>
  | Readonly<{
      kind: "branch";
      path: string;
      condition: boolean;
      selected: "when_true" | "when_false";
    }>
  | Readonly<{
      kind: "tier";
      path: string;
      tierIndex: number;
      minutesApplied: number;
      ratePerHourCents: number;
      exactAmountCents: Readonly<{
        numerator: string;
        denominator: string;
      }>;
      amountCents: number;
    }>
  | Readonly<{
      kind: "evidence";
      path: string;
      level: string;
      rateBps: number;
    }>
  | Readonly<{
      kind: "percent";
      path: string;
      amountCents: number;
      rateBps: number;
      resultCents: number;
    }>
  | Readonly<{
      kind: "clamp";
      path: string;
      outcome: "floor" | "cap" | "unchanged";
      value: number;
      floor: number;
      cap: number;
      result: number;
      scalarType: RuntimeScalarType;
    }>
  | Readonly<{
      kind: "component";
      path: string;
      name: string;
      amountCents: number;
    }>;

export type CustomRuleExecutionWithTrace = Readonly<{
  result: CustomRuleMoneyResult;
  trace: readonly CustomRuleExecutionTraceEvent[];
}>;

export type CustomRuleExecutionLimits = Readonly<{
  maxSteps: number;
  maxDepth: number;
}>;

export type ExecuteCompiledCustomRuleInput = Readonly<{
  ast: CompiledAstNode;
  variables: Readonly<Record<string, TypedRuntimeValue>>;
  parameters: Readonly<Record<string, TypedRuntimeValue>>;
  limits?: CustomRuleExecutionLimits;
}>;

type PreparedInput = Readonly<{
  ast: CompiledAstNode;
  variables: ReadonlyMap<string, TypedRuntimeValue>;
  parameters: ReadonlyMap<string, TypedRuntimeValue>;
  limits: CustomRuleExecutionLimits;
}>;

type EngineContext = {
  readonly variables: ReadonlyMap<string, TypedRuntimeValue>;
  readonly parameters: ReadonlyMap<string, TypedRuntimeValue>;
  readonly limits: CustomRuleExecutionLimits;
  readonly trace: CustomRuleExecutionTraceEvent[];
  readonly componentNames: ReadonlySet<string>;
  readonly components: Map<string, TypedRuntimeValue>;
  steps: number;
};

type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;

type WorkBudget = {
  readonly limit: number;
  used: number;
};

type AstPreflightState = {
  readonly maxSteps: number;
  readonly maxDepth: number;
  nodes: number;
};

const DEFAULT_LIMITS: CustomRuleExecutionLimits = Object.freeze({
  maxSteps: 10_000,
  maxDepth: 64,
});
const MAX_CALLER_STEPS = 100_000;
const MAX_CALLER_DEPTH = 128;
export const CUSTOM_RULE_MAX_EXECUTION_LIMITS: CustomRuleExecutionLimits =
  Object.freeze({
    maxSteps: MAX_CALLER_STEPS,
    maxDepth: MAX_CALLER_DEPTH,
  });
const SNAPSHOT_MAX_DEPTH = 256;
const SNAPSHOT_MAX_NODES = 200_000;
const SNAPSHOT_STEP_MULTIPLIER = 16;
const MAX_RATIONAL_BITS = 256;
const MAX_DECIMAL_SCALE = 36;
const RATE_DENOMINATOR = BigInt(10_000);
const MINUTES_PER_HOUR = BigInt(60);

class DataSnapshotFailure extends Error {}

export function isCustomRuleProxy(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    nodeUtilTypes.isProxy(value)
  );
}

export function executeCompiledCustomRule(
  input: ExecuteCompiledCustomRuleInput,
): CustomRuleMoneyResult {
  return executeCompiledCustomRuleWithTrace(input).result;
}

export function executeCompiledCustomRuleWithTrace(
  input: ExecuteCompiledCustomRuleInput,
): CustomRuleExecutionWithTrace {
  const prepared = prepareInput(input);
  const trace: CustomRuleExecutionTraceEvent[] = [
    {
      kind: "ast",
      path: "$",
      canonicalAst: canonicalJson(prepared.ast),
    },
  ];
  const context: EngineContext = {
    variables: prepared.variables,
    parameters: prepared.parameters,
    limits: prepared.limits,
    trace,
    componentNames: new Set(),
    components: new Map(),
    steps: 0,
  };
  const result = evaluateMoneyResult(prepared.ast, context);

  return deepFreezeOwned({ result, trace });
}

function prepareInput(input: unknown): PreparedInput {
  if (!isPlainRecord(input)) {
    invalidExecutionInput();
  }
  const limitsDescriptor = Object.getOwnPropertyDescriptor(input, "limits");
  if (
    limitsDescriptor &&
    (limitsDescriptor.enumerable !== true ||
      !Object.hasOwn(limitsDescriptor, "value"))
  ) {
    invalidExecutionInput();
  }
  const limits = parseLimits(limitsDescriptor?.value);
  const outer = readOwnDataRecord(
    input,
    createSnapshotBudget(limits.maxSteps),
    "$",
  );
  if (
    !outer ||
    !hasExactOrOptionalKeys(outer, ["ast", "variables", "parameters"], [
      "limits",
    ])
  ) {
    invalidExecutionInput();
  }

  const runtimeSnapshotBudget = createSnapshotBudget(limits.maxSteps);
  const variables = parseRuntimeRecord(
    outer.get("variables"),
    "$.variables",
    runtimeSnapshotBudget,
  );
  const parameters = parseRuntimeRecord(
    outer.get("parameters"),
    "$.parameters",
    runtimeSnapshotBudget,
  );
  const ast = parseCompiledAst(
    outer.get("ast"),
    createSnapshotBudget(limits.maxSteps),
  );
  preflightParsedCustomRuleAst(ast, limits);

  return { ast, variables, parameters, limits };
}

function invalidExecutionInput(): never {
  executionFailure(
    "EXECUTION_INVALID_INPUT",
    "Execution input must contain only own data properties",
    "$",
  );
}

function parseLimits(value: unknown): CustomRuleExecutionLimits {
  if (value === undefined) {
    return DEFAULT_LIMITS;
  }
  const values = readOwnDataRecord(
    value,
    { limit: 8, used: 0 },
    "$.limits",
  );
  if (!values || !hasExactOrOptionalKeys(values, ["maxSteps", "maxDepth"], [])) {
    invalidLimits();
  }
  const maxSteps = values.get("maxSteps");
  const maxDepth = values.get("maxDepth");
  if (
    !Number.isSafeInteger(maxSteps) ||
    !Number.isSafeInteger(maxDepth) ||
    (maxSteps as number) <= 0 ||
    (maxDepth as number) < 0 ||
    (maxSteps as number) > MAX_CALLER_STEPS ||
    (maxDepth as number) > MAX_CALLER_DEPTH
  ) {
    invalidLimits();
  }
  return { maxSteps: maxSteps as number, maxDepth: maxDepth as number };
}

function invalidLimits(): never {
  executionFailure(
    "EXECUTION_INVALID_LIMITS",
    "Execution limits must be bounded safe integers",
    "$.limits",
  );
}

function parseRuntimeRecord(
  value: unknown,
  path: string,
  budget: WorkBudget,
): ReadonlyMap<string, TypedRuntimeValue> {
  let snapshot: unknown;
  try {
    snapshot = snapshotOwnData(
      value,
      SNAPSHOT_MAX_DEPTH,
      SNAPSHOT_MAX_NODES,
      budget,
      path,
    );
  } catch (error) {
    if (error instanceof CustomRuleExecutionError) {
      throw error;
    }
    invalidRuntimeInput(path);
  }
  if (!isPlainRecord(snapshot)) {
    invalidRuntimeInput(path);
  }

  const result = new Map<string, TypedRuntimeValue>();
  for (const key of Object.keys(snapshot)) {
    const parsed = typedRuntimeValueSchema.safeParse(snapshot[key]);
    if (!parsed.success) {
      invalidRuntimeInput(`${path}.${key}`);
    }
    result.set(key, parsed.data);
  }
  return result;
}

function invalidRuntimeInput(path: string): never {
  executionFailure(
    "EXECUTION_INVALID_INPUT",
    "Runtime context must contain valid own-data typed values",
    path,
  );
}

function parseCompiledAst(value: unknown, budget: WorkBudget): CompiledAstNode {
  let snapshot: unknown;
  try {
    snapshot = snapshotOwnData(
      value,
      SNAPSHOT_MAX_DEPTH,
      SNAPSHOT_MAX_NODES,
      budget,
      "$.ast",
    );
  } catch (error) {
    if (error instanceof CustomRuleExecutionError) {
      throw error;
    }
    invalidAst();
  }

  try {
    const parsed = compiledAstNodeSchema.safeParse(snapshot);
    if (!parsed.success) {
      invalidAst();
    }
    return parsed.data;
  } catch {
    invalidAst();
  }
}

export function preflightCompiledCustomRuleAst(
  value: unknown,
  limits: CustomRuleExecutionLimits = CUSTOM_RULE_MAX_EXECUTION_LIMITS,
): CompiledAstNode {
  const validatedLimits = parseLimits(limits);
  const ast = parseCompiledAst(
    value,
    createSnapshotBudget(validatedLimits.maxSteps),
  );
  preflightParsedCustomRuleAst(ast, validatedLimits);
  return ast;
}

function preflightParsedCustomRuleAst(
  ast: CompiledAstNode,
  limits: CustomRuleExecutionLimits,
): void {
  const state: AstPreflightState = {
    nodes: 0,
    maxSteps: limits.maxSteps,
    maxDepth: limits.maxDepth,
  };
  preflightMoneyResultAst(ast, state);
}

function preflightMoneyResultAst(
  ast: CompiledAstNode,
  state: AstPreflightState,
): void {
  preflightEnter(state, "$", 0);
  if (
    ast.kind !== "call" ||
    ast.callee !== "money_result" ||
    ast.arguments.length !== 1 ||
    ast.arguments[0]?.kind !== "object" ||
    ast.inferredType.kind !== "object"
  ) {
    invalidAstContext("Formula root must be one money_result call", "$.ast");
  }

  const objectNode = ast.arguments[0];
  preflightEnter(state, "$.arguments[0]", 1);
  const componentNames = objectNode.entries.map((entry) => entry.key);
  if (
    componentNames.length === 0 ||
    new Set(componentNames).size !== componentNames.length ||
    componentNames.filter((name) => name === "final").length !== 1
  ) {
    invalidAstContext(
      "money_result requires unique components and exactly one final",
      "$.arguments[0]",
    );
  }
  assertMoneyResultType(objectNode.inferredType, componentNames, "$.arguments[0]");
  assertMoneyResultType(ast.inferredType, componentNames, "$");

  const allComponents = new Set(componentNames);
  const availableComponents = new Set<string>();
  for (const [index, entry] of objectNode.entries.entries()) {
    const path = `$.arguments[0].entries[${index}].value`;
    const valueType = preflightNode(entry.value, path, 2, state, {
      allComponents,
      availableComponents,
    });
    if (scalarTypeOf(valueType) !== "money_cents") {
      invalidAstContext("money_result components must be money", path);
    }
    availableComponents.add(entry.key);
  }
}

type AstPreflightComponents = Readonly<{
  allComponents: ReadonlySet<string>;
  availableComponents: ReadonlySet<string>;
}>;

function preflightNode(
  node: CompiledAstNode,
  path: string,
  depth: number,
  state: AstPreflightState,
  components: AstPreflightComponents,
): RuntimeValueType {
  preflightEnter(state, path, depth);

  switch (node.kind) {
    case "literal":
      return node.inferredType;
    case "identifier":
      if (
        components.allComponents.has(node.name) &&
        !components.availableComponents.has(node.name)
      ) {
        invalidAstContext(
          "Component references must point to earlier components",
          path,
        );
      }
      if (
        components.availableComponents.has(node.name) &&
        scalarTypeOf(node.inferredType) !== "money_cents"
      ) {
        invalidAstContext(
          "Component identifier type must be money",
          path,
        );
      }
      return node.inferredType;
    case "unary": {
      const argumentType = preflightNode(
        node.argument,
        `${path}.argument`,
        depth + 1,
        state,
        components,
      );
      let expectedType: RuntimeValueType;
      if (node.operator === "!") {
        assertScalarType(argumentType, "boolean", path);
        expectedType = scalarRuntimeType("boolean");
      } else if (node.operator === "+" || node.operator === "-") {
        if (!isNumericRuntimeType(argumentType)) {
          invalidAstContext("Unary arithmetic requires a numeric type", path);
        }
        expectedType = argumentType;
      } else {
        unknownOperator(path);
      }
      assertDeclaredType(node.inferredType, expectedType, path);
      return node.inferredType;
    }
    case "binary": {
      if (!isKnownBinaryOperator(node.operator)) {
        unknownOperator(path);
      }
      const leftType = preflightNode(
        node.left,
        `${path}.left`,
        depth + 1,
        state,
        components,
      );
      const rightType = preflightNode(
        node.right,
        `${path}.right`,
        depth + 1,
        state,
        components,
      );
      const expectedType = preflightBinaryType(
        node.operator,
        leftType,
        rightType,
        path,
      );
      assertDeclaredType(node.inferredType, expectedType, path);
      return node.inferredType;
    }
    case "call":
      return preflightCall(node, path, depth, state, components);
    case "array": {
      if (node.inferredType.kind !== "array") {
        invalidAstContext("Array node must declare an array type", path);
      }
      for (const [index, element] of node.elements.entries()) {
        const elementType = preflightNode(
          element,
          `${path}.elements[${index}]`,
          depth + 1,
          state,
          components,
        );
        assertDeclaredType(
          elementType,
          node.inferredType.itemType,
          `${path}.elements[${index}]`,
        );
      }
      return node.inferredType;
    }
    case "object": {
      if (node.inferredType.kind !== "object") {
        invalidAstContext("Object node must declare an object type", path);
      }
      const objectType = node.inferredType;
      const entryNames = node.entries.map((entry) => entry.key);
      const fieldNames = Object.keys(objectType.fields);
      if (
        new Set(entryNames).size !== entryNames.length ||
        entryNames.length !== fieldNames.length ||
        entryNames.some((name) => !Object.hasOwn(objectType.fields, name))
      ) {
        invalidAstContext(
          "Object inferred fields must match property keys exactly",
          path,
        );
      }
      for (const [index, entry] of node.entries.entries()) {
        const entryType = preflightNode(
          entry.value,
          `${path}.entries[${index}].value`,
          depth + 1,
          state,
          components,
        );
        assertDeclaredType(
          entryType,
          objectType.fields[entry.key],
          `${path}.entries[${index}].value`,
        );
      }
      return node.inferredType;
    }
  }
}

function preflightCall(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  state: AstPreflightState,
  components: AstPreflightComponents,
): RuntimeValueType {
  switch (node.callee) {
    case "parameter": {
      assertPreflightArity(node, 1, path);
      const nameNode = node.arguments[0];
      if (
        nameNode?.kind !== "literal" ||
        nameNode.inferredType.scalarType !== "string" ||
        !("value" in nameNode) ||
        typeof nameNode.value !== "string"
      ) {
        invalidAstContext("parameter requires one compiled string literal", path);
      }
      preflightNode(
        nameNode,
        `${path}.arguments[0]`,
        depth + 1,
        state,
        components,
      );
      return node.inferredType;
    }
    case "if": {
      assertPreflightArity(node, 3, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      assertScalarType(argumentTypes[0], "boolean", path);
      const branchType = commonPreflightType(
        argumentTypes[1],
        argumentTypes[2],
        path,
      );
      assertDeclaredType(node.inferredType, branchType, path);
      return node.inferredType;
    }
    case "min":
    case "max": {
      assertPreflightArity(node, 2, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      const expectedType = commonPreflightNumericType(
        argumentTypes[0],
        argumentTypes[1],
        path,
      );
      assertDeclaredType(node.inferredType, expectedType, path);
      return node.inferredType;
    }
    case "clamp": {
      assertPreflightArity(node, 3, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      const lowerType = commonPreflightNumericType(
        argumentTypes[0],
        argumentTypes[1],
        path,
      );
      const expectedType = commonPreflightNumericType(
        lowerType,
        argumentTypes[2],
        path,
      );
      assertDeclaredType(node.inferredType, expectedType, path);
      return node.inferredType;
    }
    case "round_money": {
      assertPreflightArity(node, 1, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      assertScalarType(argumentTypes[0], "money_cents", path);
      assertScalarType(node.inferredType, "money_cents", path);
      return node.inferredType;
    }
    case "tiered":
      return preflightTieredCall(node, path, depth, state, components);
    case "percent": {
      assertPreflightArity(node, 2, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      assertScalarType(argumentTypes[0], "money_cents", path);
      assertScalarType(argumentTypes[1], "rate_bps", path);
      assertScalarType(node.inferredType, "money_cents", path);
      return node.inferredType;
    }
    case "evidence_multiplier": {
      assertPreflightArity(node, 2, path);
      const levelType = preflightNode(
        node.arguments[0],
        `${path}.arguments[0]`,
        depth + 1,
        state,
        components,
      );
      assertScalarType(levelType, "string", path);
      const ratesNode = node.arguments[1];
      if (ratesNode?.kind !== "object") {
        invalidAstContext(
          "evidence_multiplier requires a compiled rate object",
          path,
        );
      }
      const ratesType = preflightNode(
        ratesNode,
        `${path}.arguments[1]`,
        depth + 1,
        state,
        components,
      );
      if (ratesType.kind !== "object") {
        invalidAstContext("Evidence rates must declare an object type", path);
      }
      const keys = Object.keys(ratesType.fields).sort();
      if (canonicalJson(keys) !== canonicalJson(["green", "red", "yellow"])) {
        invalidAstContext("Evidence rates must define green, yellow, and red", path);
      }
      for (const key of keys) {
        assertScalarType(ratesType.fields[key], "rate_bps", path);
      }
      assertScalarType(node.inferredType, "rate_bps", path);
      return node.inferredType;
    }
    case "in": {
      assertPreflightArity(node, 2, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      if (
        argumentTypes[1].kind !== "array" ||
        !sameRuntimeType(argumentTypes[0], argumentTypes[1].itemType)
      ) {
        invalidAstContext("in candidates must match the searched value type", path);
      }
      assertScalarType(node.inferredType, "boolean", path);
      return node.inferredType;
    }
    case "contains": {
      assertPreflightArity(node, 2, path);
      const argumentTypes = preflightArguments(
        node,
        path,
        depth,
        state,
        components,
      );
      if (
        argumentTypes[0].kind !== "array" ||
        !sameRuntimeType(argumentTypes[0].itemType, argumentTypes[1])
      ) {
        invalidAstContext("contains requires an array and matching item", path);
      }
      assertScalarType(node.inferredType, "boolean", path);
      return node.inferredType;
    }
    case "money_result":
    case "yuan":
    case "rate_percent":
      invalidAstContext("Compiled call is not valid in this AST position", path);
    default:
      executionFailure(
        "EXECUTION_UNKNOWN_FUNCTION",
        "Compiled AST calls an unknown function",
        path,
      );
  }
}

function preflightTieredCall(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  state: AstPreflightState,
  components: AstPreflightComponents,
): RuntimeValueType {
  assertPreflightArity(node, 2, path);
  const minutesType = preflightNode(
    node.arguments[0],
    `${path}.arguments[0]`,
    depth + 1,
    state,
    components,
  );
  if (!isGeneralNumericRuntimeType(minutesType)) {
    invalidAstContext("tiered minutes must be integer or number", path);
  }
  const tiersNode = node.arguments[1];
  if (
    tiersNode?.kind !== "array" ||
    tiersNode.elements.length === 0 ||
    tiersNode.inferredType.kind !== "array" ||
    tiersNode.inferredType.itemType.kind !== "object" ||
    !sameRuntimeType(
      tiersNode.inferredType.itemType,
      objectRuntimeType({ rate_per_hour: scalarRuntimeType("money_cents") }),
    )
  ) {
    invalidAstContext("tiered requires a valid compiled tier array", path);
  }
  preflightEnter(state, `${path}.arguments[1]`, depth + 1);
  for (const [index, tierNode] of tiersNode.elements.entries()) {
    const tierPath = `${path}.arguments[1].elements[${index}]`;
    if (tierNode.kind !== "object") {
      invalidAstContext("Each tier must be an object", tierPath);
    }
    const tierType = preflightNode(
      tierNode,
      tierPath,
      depth + 2,
      state,
      components,
    );
    if (tierType.kind !== "object") {
      invalidAstContext("Each tier must declare an object type", tierPath);
    }
    const keys = Object.keys(tierType.fields).sort();
    const isFinal = index === tiersNode.elements.length - 1;
    const validKeys =
      canonicalJson(keys) === canonicalJson(["rate_per_hour", "upto"]) ||
      (isFinal && canonicalJson(keys) === canonicalJson(["rate_per_hour"]));
    if (!validKeys) {
      invalidAstContext("Tier fields do not match the compiled contract", tierPath);
    }
    assertScalarType(tierType.fields.rate_per_hour, "money_cents", tierPath);
    if (Object.hasOwn(tierType.fields, "upto")) {
      if (!isGeneralNumericRuntimeType(tierType.fields.upto)) {
        invalidAstContext("Tier limits must be integer or number", tierPath);
      }
    }
  }
  assertScalarType(node.inferredType, "money_cents", path);
  return node.inferredType;
}

function preflightArguments(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  state: AstPreflightState,
  components: AstPreflightComponents,
): RuntimeValueType[] {
  return node.arguments.map((argument, index) =>
    preflightNode(
      argument,
      `${path}.arguments[${index}]`,
      depth + 1,
      state,
      components,
    ),
  );
}

function preflightBinaryType(
  operator: string,
  leftType: RuntimeValueType,
  rightType: RuntimeValueType,
  path: string,
): RuntimeValueType {
  if (operator === "&&" || operator === "||") {
    assertScalarType(leftType, "boolean", path);
    assertScalarType(rightType, "boolean", path);
    return scalarRuntimeType("boolean");
  }
  if (operator === "+" || operator === "-") {
    if (sameRuntimeType(leftType, rightType) && isNumericRuntimeType(leftType)) {
      return leftType;
    }
    if (
      isGeneralNumericRuntimeType(leftType) &&
      isGeneralNumericRuntimeType(rightType)
    ) {
      return scalarRuntimeType("number");
    }
    invalidAstContext("Addition requires compatible numeric units", path);
  }
  if (operator === "*") {
    const leftScalar = scalarTypeOf(leftType);
    const rightScalar = scalarTypeOf(rightType);
    if (
      (leftScalar === "money_cents" && rightScalar === "rate_bps") ||
      (leftScalar === "rate_bps" && rightScalar === "money_cents")
    ) {
      return scalarRuntimeType("money_cents");
    }
    if (
      (leftScalar === "money_cents" && isGeneralNumericRuntimeType(rightType)) ||
      (rightScalar === "money_cents" && isGeneralNumericRuntimeType(leftType))
    ) {
      return scalarRuntimeType("money_cents");
    }
    if (
      (leftScalar === "rate_bps" && isGeneralNumericRuntimeType(rightType)) ||
      (rightScalar === "rate_bps" && isGeneralNumericRuntimeType(leftType))
    ) {
      return scalarRuntimeType("rate_bps");
    }
    if (
      isGeneralNumericRuntimeType(leftType) &&
      isGeneralNumericRuntimeType(rightType)
    ) {
      return leftScalar === "integer" && rightScalar === "integer"
        ? scalarRuntimeType("integer")
        : scalarRuntimeType("number");
    }
    invalidAstContext("Multiplication received incompatible units", path);
  }
  if (operator === "/") {
    const leftScalar = scalarTypeOf(leftType);
    const rightScalar = scalarTypeOf(rightType);
    if (leftScalar === "money_cents" || rightScalar === "money_cents") {
      invalidAstContext("General division cannot accept money values", path);
    }
    if (leftScalar === "rate_bps" && isGeneralNumericRuntimeType(rightType)) {
      return scalarRuntimeType("rate_bps");
    }
    if (
      (leftScalar === "rate_bps" && rightScalar === "rate_bps") ||
      (isGeneralNumericRuntimeType(leftType) &&
        isGeneralNumericRuntimeType(rightType))
    ) {
      return scalarRuntimeType("number");
    }
    invalidAstContext("Division received incompatible units", path);
  }
  if (operator === "%") {
    if (
      !isGeneralNumericRuntimeType(leftType) ||
      !isGeneralNumericRuntimeType(rightType)
    ) {
      invalidAstContext("Modulo requires unitless numeric values", path);
    }
    return scalarTypeOf(leftType) === "integer" &&
      scalarTypeOf(rightType) === "integer"
      ? scalarRuntimeType("integer")
      : scalarRuntimeType("number");
  }
  if (["==", "!=", "===", "!=="].includes(operator)) {
    if (
      !sameRuntimeType(leftType, rightType) &&
      !(
        isGeneralNumericRuntimeType(leftType) &&
        isGeneralNumericRuntimeType(rightType)
      )
    ) {
      invalidAstContext("Equality requires compatible types", path);
    }
    return scalarRuntimeType("boolean");
  }
  if (["<", "<=", ">", ">="].includes(operator)) {
    const leftScalar = scalarTypeOf(leftType);
    const ordered = new Set<RuntimeScalarType>([
      "money_cents",
      "rate_bps",
      "number",
      "integer",
      "string",
      "timestamp",
    ]);
    if (
      !(
        (sameRuntimeType(leftType, rightType) &&
          leftScalar !== null &&
          ordered.has(leftScalar)) ||
        (isGeneralNumericRuntimeType(leftType) &&
          isGeneralNumericRuntimeType(rightType))
      )
    ) {
      invalidAstContext("Ordered comparison requires compatible scalar types", path);
    }
    return scalarRuntimeType("boolean");
  }
  unknownOperator(path);
}

function commonPreflightNumericType(
  leftType: RuntimeValueType,
  rightType: RuntimeValueType,
  path: string,
): RuntimeValueType {
  if (!isNumericRuntimeType(leftType) || !isNumericRuntimeType(rightType)) {
    invalidAstContext("Function requires numeric types", path);
  }
  return commonPreflightType(leftType, rightType, path);
}

function commonPreflightType(
  leftType: RuntimeValueType,
  rightType: RuntimeValueType,
  path: string,
): RuntimeValueType {
  if (sameRuntimeType(leftType, rightType)) {
    return leftType;
  }
  if (
    isGeneralNumericRuntimeType(leftType) &&
    isGeneralNumericRuntimeType(rightType)
  ) {
    return scalarRuntimeType("number");
  }
  invalidAstContext("Compiled branches require one compatible type", path);
}

function assertPreflightArity(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  arity: number,
  path: string,
): void {
  if (node.arguments.length !== arity) {
    invalidAstContext("Compiled function has an invalid argument count", path);
  }
}

function assertDeclaredType(
  actual: RuntimeValueType,
  expected: RuntimeValueType | undefined,
  path: string,
): void {
  if (!expected || !sameRuntimeType(actual, expected)) {
    invalidAstContext(
      "Compiled node inferred type does not match child semantics",
      path,
    );
  }
}

function assertScalarType(
  type: RuntimeValueType | undefined,
  scalarType: RuntimeScalarType,
  path: string,
): void {
  if (scalarTypeOf(type) !== scalarType) {
    invalidAstContext(
      `Compiled node must declare ${scalarType}`,
      path,
    );
  }
}

function sameRuntimeType(
  left: RuntimeValueType,
  right: RuntimeValueType,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "scalar" && right.kind === "scalar") {
    return left.scalarType === right.scalarType;
  }
  if (left.kind === "array" && right.kind === "array") {
    return sameRuntimeType(left.itemType, right.itemType);
  }
  if (left.kind !== "object" || right.kind !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left.fields).sort();
  const rightKeys = Object.keys(right.fields).sort();
  return (
    canonicalJson(leftKeys) === canonicalJson(rightKeys) &&
    leftKeys.every((key) =>
      sameRuntimeType(left.fields[key], right.fields[key]),
    )
  );
}

function scalarRuntimeType(scalarType: RuntimeScalarType): RuntimeValueType {
  return { kind: "scalar", scalarType };
}

function objectRuntimeType(
  fields: Record<string, RuntimeValueType>,
): RuntimeValueType {
  return { kind: "object", fields };
}

function isNumericRuntimeType(type: RuntimeValueType): boolean {
  return ["money_cents", "rate_bps", "number", "integer"].includes(
    scalarTypeOf(type) ?? "",
  );
}

function isGeneralNumericRuntimeType(type: RuntimeValueType): boolean {
  const scalarType = scalarTypeOf(type);
  return scalarType === "number" || scalarType === "integer";
}

function isKnownBinaryOperator(operator: string): boolean {
  return [
    "&&",
    "||",
    "+",
    "-",
    "*",
    "/",
    "%",
    "==",
    "!=",
    "===",
    "!==",
    "<",
    "<=",
    ">",
    ">=",
  ].includes(operator);
}

function preflightEnter(
  state: AstPreflightState,
  path: string,
  depth: number,
): void {
  state.nodes += 1;
  if (depth > state.maxDepth) {
    executionFailure(
      "EXECUTION_MAX_DEPTH",
      "Compiled AST preflight exceeded maxDepth",
      path,
    );
  }
  if (state.nodes > state.maxSteps) {
    executionFailure(
      "EXECUTION_MAX_STEPS",
      "Compiled AST preflight exceeded maxSteps",
      path,
    );
  }
}

function invalidAst(): never {
  executionFailure(
    "EXECUTION_INVALID_AST",
    "Compiled AST does not match the persisted Task 2 contract",
    "$.ast",
  );
}

function createSnapshotBudget(maxSteps: number): WorkBudget {
  return {
    limit: Math.min(SNAPSHOT_MAX_NODES, maxSteps * SNAPSHOT_STEP_MULTIPLIER),
    used: 0,
  };
}

function consumeWorkBudget(
  budget: WorkBudget,
  path: string,
  units = 1,
): void {
  if (units < 0 || !Number.isSafeInteger(units)) {
    executionFailure(
      "EXECUTION_INVALID_LIMITS",
      "Work budget units must be a non-negative safe integer",
      path,
    );
  }
  if (budget.used > budget.limit - units) {
    executionFailure(
      "EXECUTION_MAX_STEPS",
      "Execution preparation exceeded the bounded work budget",
      path,
    );
  }
  budget.used += units;
}

function readOwnDataRecord(
  value: unknown,
  budget: WorkBudget,
  path: string,
): ReadonlyMap<string, unknown> | null {
  if (isCustomRuleProxy(value)) {
    return null;
  }
  if (!isPlainRecord(value)) {
    return null;
  }
  const values = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    consumeWorkBudget(budget, path);
    if (typeof key !== "string") {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
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

function hasExactOrOptionalKeys(
  values: ReadonlyMap<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => values.has(key)) &&
    [...values.keys()].every((key) => allowed.has(key))
  );
}

function snapshotOwnData(
  value: unknown,
  maxDepth: number,
  maxNodes: number,
  budget: WorkBudget,
  rootPath: string,
): unknown {
  const ancestors = new WeakSet<object>();
  const state = { nodes: 0 };

  const visit = (current: unknown, depth: number, path: string): unknown => {
    state.nodes += 1;
    if (depth > maxDepth || state.nodes > maxNodes) {
      throw new DataSnapshotFailure();
    }
    if (isCustomRuleProxy(current)) {
      throw new DataSnapshotFailure();
    }
    consumeWorkBudget(budget, path);
    if (current === null || typeof current !== "object") {
      if (
        typeof current === "function" ||
        typeof current === "symbol" ||
        typeof current === "bigint" ||
        typeof current === "undefined"
      ) {
        throw new DataSnapshotFailure();
      }
      return current;
    }
    if (ancestors.has(current)) {
      throw new DataSnapshotFailure();
    }
    ancestors.add(current);

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        throw new DataSnapshotFailure();
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      if (
        !lengthDescriptor ||
        !Object.hasOwn(lengthDescriptor, "value") ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > maxNodes
      ) {
        throw new DataSnapshotFailure();
      }
      const length = lengthDescriptor.value as number;
      const names = Object.getOwnPropertyNames(current);
      if (
        names.length !== length + 1 ||
        names.some(
          (name) =>
            name !== "length" &&
            (!/^\d+$/.test(name) || Number(name) >= length),
        ) ||
        Object.getOwnPropertySymbols(current).length > 0
      ) {
        throw new DataSnapshotFailure();
      }
      const copy: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, "value")
        ) {
          throw new DataSnapshotFailure();
        }
        copy.push(
          visit(descriptor.value, depth + 1, `${path}[${index}]`),
        );
      }
      ancestors.delete(current);
      return copy;
    }

    if (!isPlainRecord(current)) {
      throw new DataSnapshotFailure();
    }
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") {
        throw new DataSnapshotFailure();
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        throw new DataSnapshotFailure();
      }
      copy[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
    }
    ancestors.delete(current);
    return copy;
  };

  return visit(value, 0, rootPath);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isCustomRuleProxy(value) ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function evaluateMoneyResult(
  ast: CompiledAstNode,
  context: EngineContext,
): CustomRuleMoneyResult {
  enterNode(context, "$", 0);
  if (
    ast.kind !== "call" ||
    ast.callee !== "money_result" ||
    ast.arguments.length !== 1 ||
    ast.arguments[0]?.kind !== "object" ||
    ast.inferredType.kind !== "object"
  ) {
    invalidAstContext("Formula root must be one money_result call", "$.ast");
  }

  const objectNode = ast.arguments[0];
  enterNode(context, "$.arguments[0]", 1);
  const componentNames = objectNode.entries.map((entry) => entry.key);
  if (
    componentNames.length === 0 ||
    new Set(componentNames).size !== componentNames.length ||
    componentNames.filter((name) => name === "final").length !== 1
  ) {
    invalidAstContext(
      "money_result requires unique components and exactly one final",
      "$.arguments[0]",
    );
  }
  assertMoneyResultType(objectNode.inferredType, componentNames, "$.arguments[0]");
  assertMoneyResultType(ast.inferredType, componentNames, "$");

  const scopedContext: EngineContext = {
    ...context,
    componentNames: new Set(componentNames),
    components: new Map(),
  };
  const componentsCents: Record<string, number> = {};

  for (const [index, entry] of objectNode.entries.entries()) {
    const path = `$.arguments[0].entries[${index}].value`;
    const value = evaluateNode(entry.value, path, 2, scopedContext);
    if (value.type !== "money_cents") {
      invalidAstContext("money_result components must be money", path);
    }
    scopedContext.components.set(entry.key, value);
    componentsCents[entry.key] = value.amountCents;
    scopedContext.trace.push({
      kind: "component",
      path,
      name: entry.key,
      amountCents: value.amountCents,
    });
  }

  const finalCents = componentsCents.final;
  if (finalCents === undefined) {
    invalidAstContext("money_result final component is missing", "$.result.final");
  }
  if (finalCents < 0) {
    executionFailure(
      "EXECUTION_NEGATIVE_FINAL",
      "Final money result cannot be negative",
      "$.result.final",
    );
  }

  context.steps = scopedContext.steps;
  return { kind: "money_result", componentsCents };
}

function assertMoneyResultType(
  valueType: RuntimeValueType,
  componentNames: readonly string[],
  path: string,
): void {
  if (valueType.kind !== "object") {
    invalidAstContext("money_result must have an object output type", path);
  }
  const fieldNames = Object.keys(valueType.fields);
  if (
    fieldNames.length !== componentNames.length ||
    componentNames.some(
      (name) =>
        !Object.hasOwn(valueType.fields, name) ||
        scalarTypeOf(valueType.fields[name]) !== "money_cents",
    )
  ) {
    invalidAstContext("money_result output type does not match components", path);
  }
}

function evaluateNode(
  node: CompiledAstNode,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  enterNode(context, path, depth);

  switch (node.kind) {
    case "literal":
      return evaluateLiteral(node);
    case "identifier":
      return evaluateIdentifier(node, path, context);
    case "unary":
      return evaluateUnary(node, path, depth, context);
    case "binary":
      return evaluateBinary(node, path, depth, context);
    case "call":
      return evaluateCall(node, path, depth, context);
    case "array":
      return {
        type: "array",
        items: node.elements.map((element, index) =>
          evaluateNode(element, `${path}.elements[${index}]`, depth + 1, context),
        ),
      };
    case "object": {
      const fields: Record<string, TypedRuntimeValue> = {};
      const names = new Set<string>();
      for (const [index, entry] of node.entries.entries()) {
        if (names.has(entry.key)) {
          invalidAstContext("Compiled object keys must be unique", path);
        }
        names.add(entry.key);
        fields[entry.key] = evaluateNode(
          entry.value,
          `${path}.entries[${index}].value`,
          depth + 1,
          context,
        );
      }
      return { type: "object", fields };
    }
  }
}

function evaluateLiteral(
  node: Extract<CompiledAstNode, { kind: "literal" }>,
): TypedRuntimeValue {
  if ("valueCents" in node) {
    return { type: "money_cents", amountCents: node.valueCents };
  }
  if ("valueBps" in node) {
    return { type: "rate_bps", rateBps: node.valueBps };
  }
  if (node.inferredType.scalarType === "number" && typeof node.value === "number") {
    return { type: "number", value: node.value };
  }
  if (node.inferredType.scalarType === "integer" && typeof node.value === "number") {
    return { type: "integer", value: node.value };
  }
  if (node.inferredType.scalarType === "boolean" && typeof node.value === "boolean") {
    return { type: "boolean", value: node.value };
  }
  if (node.inferredType.scalarType === "string" && typeof node.value === "string") {
    return { type: "string", value: node.value };
  }
  if (node.inferredType.scalarType === "timestamp" && typeof node.value === "string") {
    return { type: "timestamp", value: node.value };
  }
  invalidAstContext("Compiled literal value does not match its type", "$.ast");
}

function evaluateIdentifier(
  node: Extract<CompiledAstNode, { kind: "identifier" }>,
  path: string,
  context: EngineContext,
): TypedRuntimeValue {
  if (context.componentNames.has(node.name)) {
    const component = context.components.get(node.name);
    if (!component) {
      invalidAstContext(
        "Component references must point to earlier components",
        path,
      );
    }
    assertRuntimeType(component, node.inferredType, path);
    return component;
  }

  const value = context.variables.get(node.name);
  if (!value) {
    executionFailure(
      "EXECUTION_MISSING_VARIABLE",
      "Required runtime variable is missing",
      path,
    );
  }
  assertRuntimeType(value, node.inferredType, path);
  context.trace.push({ kind: "variable", path, name: node.name, value });
  return value;
}

function evaluateUnary(
  node: Extract<CompiledAstNode, { kind: "unary" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  const argument = evaluateNode(node.argument, `${path}.argument`, depth + 1, context);
  let result: TypedRuntimeValue;
  if (node.operator === "!") {
    if (argument.type !== "boolean") {
      invalidAstContext("Logical negation requires a boolean", path);
    }
    result = { type: "boolean", value: !argument.value };
  } else if (node.operator === "+" || node.operator === "-") {
    if (!isNumericValue(argument)) {
      invalidAstContext("Unary arithmetic requires a numeric value", path);
    }
    result =
      node.operator === "+"
        ? argument
        : createNumericValue(
            argument.type,
            -numericPrimitive(argument),
            path,
          );
  } else {
    unknownOperator(path);
  }
  assertRuntimeType(result, node.inferredType, path, true);
  return result;
}

function evaluateBinary(
  node: Extract<CompiledAstNode, { kind: "binary" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  if (node.operator === "&&" || node.operator === "||") {
    if (
      scalarTypeOf(node.left.inferredType) !== "boolean" ||
      scalarTypeOf(node.right.inferredType) !== "boolean" ||
      scalarTypeOf(node.inferredType) !== "boolean"
    ) {
      invalidAstContext("Logical operators require boolean AST types", path);
    }
    const left = evaluateNode(node.left, `${path}.left`, depth + 1, context);
    if (left.type !== "boolean") {
      invalidAstContext("Logical operators require booleans", path);
    }
    if (node.operator === "&&" && !left.value) {
      return { type: "boolean", value: false };
    }
    if (node.operator === "||" && left.value) {
      return { type: "boolean", value: true };
    }
    const right = evaluateNode(node.right, `${path}.right`, depth + 1, context);
    if (right.type !== "boolean") {
      invalidAstContext("Logical operators require booleans", path);
    }
    return { type: "boolean", value: right.value };
  }

  const left = evaluateNode(node.left, `${path}.left`, depth + 1, context);
  const right = evaluateNode(node.right, `${path}.right`, depth + 1, context);
  let result: TypedRuntimeValue;

  switch (node.operator) {
    case "+":
    case "-":
      result = evaluateAdditive(node.operator, left, right, path);
      break;
    case "*":
      result = evaluateMultiplication(left, right, path);
      break;
    case "/":
      result = evaluateDivision(left, right, path);
      break;
    case "%":
      result = evaluateModulo(left, right, path);
      break;
    case "==":
    case "===":
      assertComparableValues(left, right, path);
      result = {
        type: "boolean",
        value: runtimeValuesEqual(left, right, context, path),
      };
      break;
    case "!=":
    case "!==":
      assertComparableValues(left, right, path);
      result = {
        type: "boolean",
        value: !runtimeValuesEqual(left, right, context, path),
      };
      break;
    case "<":
    case "<=":
    case ">":
    case ">=":
      result = {
        type: "boolean",
        value: evaluateOrderedComparison(
          node.operator,
          left,
          right,
          path,
        ),
      };
      break;
    default:
      unknownOperator(path);
  }

  assertRuntimeType(result, node.inferredType, path, true);
  return result;
}

function evaluateAdditive(
  operator: "+" | "-",
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): TypedRuntimeValue {
  if (!isNumericValue(left) || !isNumericValue(right)) {
    invalidAstContext("Addition and subtraction require numeric values", path);
  }
  if (
    left.type !== right.type &&
    !(isGeneralNumericValue(left) && isGeneralNumericValue(right))
  ) {
    invalidAstContext("Addition and subtraction require compatible units", path);
  }
  const resultType =
    left.type === right.type
      ? left.type
      : ("number" as const);
  if (
    resultType === "money_cents" ||
    resultType === "rate_bps" ||
    resultType === "integer"
  ) {
    const leftInteger = BigInt(numericPrimitive(left));
    const rightInteger = BigInt(numericPrimitive(right));
    const result =
      operator === "+" ? leftInteger + rightInteger : leftInteger - rightInteger;
    return createNumericValue(
      resultType,
      checkedBigIntToSafeNumber(result, path),
      path,
    );
  }
  const value =
    operator === "+"
      ? numericPrimitive(left) + numericPrimitive(right)
      : numericPrimitive(left) - numericPrimitive(right);
  return createNumericValue("number", value, path);
}

function evaluateMultiplication(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): TypedRuntimeValue {
  if (!isNumericValue(left) || !isNumericValue(right)) {
    invalidAstContext("Multiplication requires numeric values", path);
  }
  if (left.type === "money_cents" && right.type === "rate_bps") {
    return moneyValue(
      roundCheckedRatio(
        BigInt(left.amountCents) * BigInt(right.rateBps),
        RATE_DENOMINATOR,
        path,
      ),
      path,
    );
  }
  if (left.type === "rate_bps" && right.type === "money_cents") {
    return moneyValue(
      roundCheckedRatio(
        BigInt(right.amountCents) * BigInt(left.rateBps),
        RATE_DENOMINATOR,
        path,
      ),
      path,
    );
  }
  if (left.type === "money_cents" && isGeneralNumericValue(right)) {
    return moneyValue(scaleInteger(left.amountCents, right, path), path);
  }
  if (right.type === "money_cents" && isGeneralNumericValue(left)) {
    return moneyValue(scaleInteger(right.amountCents, left, path), path);
  }
  if (left.type === "rate_bps" && isGeneralNumericValue(right)) {
    return rateValue(scaleInteger(left.rateBps, right, path), path);
  }
  if (right.type === "rate_bps" && isGeneralNumericValue(left)) {
    return rateValue(scaleInteger(right.rateBps, left, path), path);
  }
  if (isGeneralNumericValue(left) && isGeneralNumericValue(right)) {
    if (left.type === "integer" && right.type === "integer") {
      return {
        type: "integer",
        value: checkedBigIntToSafeNumber(
          BigInt(left.value) * BigInt(right.value),
          path,
        ),
      };
    }
    return createNumericValue(
      "number",
      numericPrimitive(left) * numericPrimitive(right),
      path,
    );
  }
  invalidAstContext("Multiplication received incompatible units", path);
}

function evaluateDivision(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): TypedRuntimeValue {
  if (!isNumericValue(left) || !isNumericValue(right)) {
    invalidAstContext("Division requires numeric values", path);
  }
  if (numericPrimitive(right) === 0) {
    executionFailure(
      "EXECUTION_DIVISION_BY_ZERO",
      "Division by zero is not allowed",
      path,
    );
  }
  if (left.type === "money_cents" || right.type === "money_cents") {
    invalidAstContext("General division cannot accept money values", path);
  }
  if (left.type === "rate_bps" && isGeneralNumericValue(right)) {
    const divisor = numberToRational(numericPrimitive(right), path);
    return rateValue(
      rationalToRoundedSafeInteger(
        divideRational(
          { numerator: BigInt(left.rateBps), denominator: BigInt(1) },
          divisor,
          path,
        ),
        path,
      ),
      path,
    );
  }
  if (
    (left.type === "rate_bps" && right.type === "rate_bps") ||
    (isGeneralNumericValue(left) && isGeneralNumericValue(right))
  ) {
    return createNumericValue(
      "number",
      numericPrimitive(left) / numericPrimitive(right),
      path,
    );
  }
  invalidAstContext("Division received incompatible units", path);
}

function evaluateModulo(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): TypedRuntimeValue {
  if (!isGeneralNumericValue(left) || !isGeneralNumericValue(right)) {
    invalidAstContext("Modulo requires unitless numeric values", path);
  }
  if (numericPrimitive(right) === 0) {
    executionFailure(
      "EXECUTION_MODULO_BY_ZERO",
      "Modulo by zero is not allowed",
      path,
    );
  }
  const resultType =
    left.type === "integer" && right.type === "integer" ? "integer" : "number";
  return createNumericValue(
    resultType,
    numericPrimitive(left) % numericPrimitive(right),
    path,
  );
}

function evaluateCall(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  switch (node.callee) {
    case "parameter":
      return evaluateParameter(node, path, context);
    case "if":
      return evaluateIf(node, path, depth, context);
    case "min":
    case "max":
      return evaluateMinMax(node, path, depth, context);
    case "clamp":
      return evaluateClamp(node, path, depth, context);
    case "round_money":
      return evaluateRoundMoney(node, path, depth, context);
    case "tiered":
      return evaluateTiered(node, path, depth, context);
    case "percent":
      return evaluatePercent(node, path, depth, context);
    case "evidence_multiplier":
      return evaluateEvidenceMultiplier(node, path, depth, context);
    case "in":
      return evaluateIn(node, path, depth, context);
    case "contains":
      return evaluateContains(node, path, depth, context);
    case "money_result":
    case "yuan":
    case "rate_percent":
      invalidAstContext("Compiled call is not valid in this AST position", path);
    default:
      executionFailure(
        "EXECUTION_UNKNOWN_FUNCTION",
        "Compiled AST calls an unknown function",
        path,
      );
  }
}

function evaluateParameter(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  context: EngineContext,
): TypedRuntimeValue {
  const nameNode = node.arguments[0];
  if (
    node.arguments.length !== 1 ||
    nameNode?.kind !== "literal" ||
    nameNode.inferredType.scalarType !== "string" ||
    !("value" in nameNode) ||
    typeof nameNode.value !== "string"
  ) {
    invalidAstContext("parameter requires one compiled string literal", path);
  }
  const name = nameNode.value;
  const value = context.parameters.get(name);
  if (!value) {
    executionFailure(
      "EXECUTION_MISSING_PARAMETER",
      "Required runtime parameter is missing",
      path,
    );
  }
  assertRuntimeType(value, node.inferredType, path);
  context.trace.push({ kind: "parameter", path, name, value });
  return value;
}

function evaluateIf(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 3, path);
  const condition = evaluateNode(
    node.arguments[0],
    `${path}.arguments[0]`,
    depth + 1,
    context,
  );
  if (condition.type !== "boolean") {
    invalidAstContext("if condition must be boolean", path);
  }
  const selectedIndex = condition.value ? 1 : 2;
  context.trace.push({
    kind: "branch",
    path,
    condition: condition.value,
    selected: condition.value ? "when_true" : "when_false",
  });
  const selected = evaluateNode(
    node.arguments[selectedIndex],
    `${path}.arguments[${selectedIndex}]`,
    depth + 1,
    context,
  );
  const result = coerceGeneralNumeric(selected, node.inferredType, path);
  assertRuntimeType(result, node.inferredType, path, true);
  return result;
}

function evaluateMinMax(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const left = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const right = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  assertCompatibleNumericValues(left, right, path);
  const comparison = compareNumericValues(left, right);
  const selected = node.callee === "min"
    ? comparison <= 0
      ? left
      : right
    : comparison >= 0
      ? left
      : right;
  const result = coerceGeneralNumeric(selected, node.inferredType, path);
  assertRuntimeType(result, node.inferredType, path, true);
  return result;
}

function evaluateClamp(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 3, path);
  const value = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const floor = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  const cap = evaluateNode(node.arguments[2], `${path}.arguments[2]`, depth + 1, context);
  assertCompatibleNumericValues(value, floor, path);
  assertCompatibleNumericValues(value, cap, path);
  if (compareNumericValues(floor, cap) > 0) {
    executionFailure(
      "EXECUTION_INVALID_CONTEXT",
      "Clamp floor cannot exceed cap",
      path,
    );
  }
  const outcome =
    compareNumericValues(value, floor) < 0
      ? "floor"
      : compareNumericValues(value, cap) > 0
        ? "cap"
        : "unchanged";
  const selected = outcome === "floor" ? floor : outcome === "cap" ? cap : value;
  const result = coerceGeneralNumeric(selected, node.inferredType, path);
  if (!isNumericValue(result)) {
    invalidAstContext("Clamp result must be numeric", path);
  }
  context.trace.push({
    kind: "clamp",
    path,
    outcome,
    value: numericPrimitive(value as NumericRuntimeValue),
    floor: numericPrimitive(floor as NumericRuntimeValue),
    cap: numericPrimitive(cap as NumericRuntimeValue),
    result: numericPrimitive(result),
    scalarType: result.type,
  });
  assertRuntimeType(result, node.inferredType, path, true);
  return result;
}

function evaluateRoundMoney(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 1, path);
  const value = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  if (value.type !== "money_cents" || scalarTypeOf(node.inferredType) !== "money_cents") {
    invalidAstContext("round_money requires and returns money", path);
  }
  return value;
}

function evaluatePercent(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const amount = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const rate = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  if (
    amount.type !== "money_cents" ||
    rate.type !== "rate_bps" ||
    scalarTypeOf(node.inferredType) !== "money_cents"
  ) {
    invalidAstContext("percent requires money and a rate", path);
  }
  const resultCents = roundCheckedRatio(
    BigInt(amount.amountCents) * BigInt(rate.rateBps),
    RATE_DENOMINATOR,
    path,
  );
  const result = moneyValue(resultCents, path);
  context.trace.push({
    kind: "percent",
    path,
    amountCents: amount.amountCents,
    rateBps: rate.rateBps,
    resultCents,
  });
  return result;
}

function evaluateEvidenceMultiplier(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const level = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const rates = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  if (level.type !== "string" || rates.type !== "object") {
    invalidAstContext("evidence_multiplier requires a string and rate object", path);
  }
  const keys = Object.keys(rates.fields).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["green", "red", "yellow"])) {
    invalidAstContext("Evidence rates must define green, yellow, and red", path);
  }
  if (!Object.hasOwn(rates.fields, level.value)) {
    executionFailure(
      "EXECUTION_INVALID_CONTEXT",
      "Evidence level is not supported by the compiled rate map",
      path,
    );
  }
  const selected = rates.fields[level.value];
  if (selected?.type !== "rate_bps") {
    invalidAstContext("Evidence entries must be rates", path);
  }
  context.trace.push({
    kind: "evidence",
    path,
    level: level.value,
    rateBps: selected.rateBps,
  });
  if (scalarTypeOf(node.inferredType) !== "rate_bps") {
    invalidAstContext("evidence_multiplier must return a rate", path);
  }
  return selected;
}

function evaluateTiered(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const minutes = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const tiers = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  if (
    !isGeneralNumericValue(minutes) ||
    tiers.type !== "array" ||
    tiers.items.length === 0 ||
    scalarTypeOf(node.inferredType) !== "money_cents"
  ) {
    invalidAstContext("tiered requires numeric minutes and nonempty tiers", path);
  }

  const totalMinutes = numberToRational(numericPrimitive(minutes), path);
  if (compareRational(totalMinutes, zeroRational(), path) < 0) {
    executionFailure(
      "EXECUTION_INVALID_CONTEXT",
      "Tiered minutes cannot be negative",
      path,
    );
  }

  let previousLimit = zeroRational();
  let totalAmount = zeroRational();
  let sawUnbounded = false;
  const triggeredTiers: Array<{
    tierIndex: number;
    minutesApplied: number;
    ratePerHourCents: number;
    exactAmount: Rational;
  }> = [];

  for (const [index, tier] of tiers.items.entries()) {
    consumeExecutionWork(
      context,
      `${path}.arguments[1].elements[${index}]`,
    );
    if (tier.type !== "object") {
      invalidAstContext("Each tier must be an object", path);
    }
    const keys = Object.keys(tier.fields).sort();
    const isFinal = index === tiers.items.length - 1;
    const allowedKeys = isFinal
      ? [["rate_per_hour"], ["rate_per_hour", "upto"]]
      : [["rate_per_hour", "upto"]];
    if (!allowedKeys.some((allowed) => JSON.stringify(keys) === JSON.stringify(allowed))) {
      invalidAstContext("Tier fields do not match the compiled contract", path);
    }
    const ratePerHour = tier.fields.rate_per_hour;
    if (ratePerHour?.type !== "money_cents" || ratePerHour.amountCents < 0) {
      executionFailure(
        "EXECUTION_INVALID_CONTEXT",
        "Tier rates must be non-negative money values",
        `${path}.arguments[1].elements[${index}]`,
      );
    }

    let upperLimit: Rational | null = null;
    if (Object.hasOwn(tier.fields, "upto")) {
      const upto = tier.fields.upto;
      if (!upto || !isGeneralNumericValue(upto)) {
        invalidAstContext("Tier limits must be numeric", path);
      }
      upperLimit = numberToRational(numericPrimitive(upto), path);
      if (compareRational(upperLimit, previousLimit, path) <= 0) {
        executionFailure(
          "EXECUTION_INVALID_CONTEXT",
          "Tier thresholds must increase strictly",
          `${path}.arguments[1].elements[${index}]`,
        );
      }
    } else if (!isFinal || sawUnbounded) {
      invalidAstContext("Only the final tier may omit upto", path);
    } else {
      sawUnbounded = true;
    }

    const abovePrevious = subtractRational(totalMinutes, previousLimit, path);
    let applied =
      compareRational(abovePrevious, zeroRational(), path) > 0
        ? abovePrevious
        : zeroRational();
    if (upperLimit) {
      const tierWidth = subtractRational(upperLimit, previousLimit, path);
      if (compareRational(applied, tierWidth, path) > 0) {
        applied = tierWidth;
      }
    }

    if (compareRational(applied, zeroRational(), path) > 0) {
      const tierAmount = multiplyRational(
        applied,
        {
          numerator: BigInt(ratePerHour.amountCents),
          denominator: MINUTES_PER_HOUR,
        },
        path,
      );
      totalAmount = addRational(totalAmount, tierAmount, path);
      triggeredTiers.push({
        tierIndex: index,
        minutesApplied: rationalToFiniteNumber(applied, path),
        ratePerHourCents: ratePerHour.amountCents,
        exactAmount: tierAmount,
      });
    }

    if (!upperLimit) {
      break;
    }
    previousLimit = upperLimit;
  }

  const totalCents = rationalToRoundedSafeInteger(totalAmount, path);
  const allocatedAmounts = allocateTierTraceAmounts(
    triggeredTiers.map((tier) => tier.exactAmount),
    totalCents,
    context,
    path,
  );
  for (const [index, tier] of triggeredTiers.entries()) {
    context.trace.push({
      kind: "tier",
      path,
      tierIndex: tier.tierIndex,
      minutesApplied: tier.minutesApplied,
      ratePerHourCents: tier.ratePerHourCents,
      exactAmountCents: {
        numerator: tier.exactAmount.numerator.toString(),
        denominator: tier.exactAmount.denominator.toString(),
      },
      amountCents: allocatedAmounts[index],
    });
  }
  return moneyValue(totalCents, path);
}

function allocateTierTraceAmounts(
  exactAmounts: readonly Rational[],
  roundedTotal: number,
  context: EngineContext,
  path: string,
): number[] {
  if (exactAmounts.length === 0) {
    return [];
  }
  const allocations: number[] = [];
  let floorSum = BigInt(0);
  const rankedRemainders = exactAmounts.map((amount, index) => {
    consumeExecutionWork(context, `${path}.tierAllocation[${index}]`);
    if (amount.numerator < BigInt(0)) {
      invalidAstContext("Tier trace allocation requires non-negative amounts", path);
    }
    const floor = amount.numerator / amount.denominator;
    floorSum = checkedBigInt(floorSum + floor, path);
    allocations.push(checkedBigIntToSafeNumber(floor, path));
    return {
      index,
      remainder: normalizeRational(
        amount.numerator % amount.denominator,
        amount.denominator,
        path,
      ),
    };
  });
  rankedRemainders.sort((left, right) => {
    consumeExecutionWork(context, `${path}.tierAllocation.sort`);
    const comparison = compareRational(
      left.remainder,
      right.remainder,
      path,
    );
    return comparison === 0 ? left.index - right.index : -comparison;
  });

  const remainderUnits = BigInt(roundedTotal) - floorSum;
  if (
    remainderUnits < BigInt(0) ||
    remainderUnits > BigInt(rankedRemainders.length)
  ) {
    executionFailure(
      "EXECUTION_ARITHMETIC_OVERFLOW",
      "Tier trace residue cannot reconcile to the rounded total",
      path,
    );
  }
  const unitCount = Number(remainderUnits);
  for (let index = 0; index < unitCount; index += 1) {
    consumeExecutionWork(context, `${path}.tierAllocation.remainder`);
    const target = rankedRemainders[index];
    if (!target) {
      executionFailure(
        "EXECUTION_ARITHMETIC_OVERFLOW",
        "Tier trace residue allocation is incomplete",
        path,
      );
    }
    allocations[target.index] += 1;
  }
  return allocations;
}

function evaluateIn(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const value = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const candidates = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  if (candidates.type !== "array") {
    invalidAstContext("in requires an array", path);
  }
  let result = false;
  for (const [index, candidate] of candidates.items.entries()) {
    assertComparableValues(value, candidate, path);
    if (
      runtimeValuesEqual(
        value,
        candidate,
        context,
        `${path}.candidates[${index}]`,
      )
    ) {
      result = true;
      break;
    }
  }
  if (scalarTypeOf(node.inferredType) !== "boolean") {
    invalidAstContext("in must return a boolean", path);
  }
  return { type: "boolean", value: result };
}

function evaluateContains(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  path: string,
  depth: number,
  context: EngineContext,
): TypedRuntimeValue {
  assertArity(node, 2, path);
  const collection = evaluateNode(node.arguments[0], `${path}.arguments[0]`, depth + 1, context);
  const item = evaluateNode(node.arguments[1], `${path}.arguments[1]`, depth + 1, context);
  if (collection.type !== "array") {
    invalidAstContext("contains requires an array", path);
  }
  let found = false;
  for (const [index, candidate] of collection.items.entries()) {
    assertComparableValues(candidate, item, path);
    if (
      runtimeValuesEqual(
        candidate,
        item,
        context,
        `${path}.collection[${index}]`,
      )
    ) {
      found = true;
      break;
    }
  }
  if (scalarTypeOf(node.inferredType) !== "boolean") {
    invalidAstContext("contains must return a boolean", path);
  }
  return {
    type: "boolean",
    value: found,
  };
}

function assertArity(
  node: Extract<CompiledAstNode, { kind: "call" }>,
  arity: number,
  path: string,
): void {
  if (node.arguments.length !== arity) {
    invalidAstContext("Compiled function has an invalid argument count", path);
  }
}

function enterNode(context: EngineContext, path: string, depth: number): void {
  if (depth > context.limits.maxDepth) {
    executionFailure(
      "EXECUTION_MAX_DEPTH",
      "Execution exceeded the configured maximum depth",
      path,
    );
  }
  consumeExecutionWork(context, path);
}

function consumeExecutionWork(
  context: EngineContext,
  path: string,
  units = 1,
): void {
  if (
    !Number.isSafeInteger(units) ||
    units < 0 ||
    context.steps > context.limits.maxSteps - units
  ) {
    executionFailure(
      "EXECUTION_MAX_STEPS",
      "Execution exceeded the configured maximum steps",
      path,
    );
  }
  context.steps += units;
}

type NumericRuntimeValue = Extract<
  TypedRuntimeValue,
  { type: "money_cents" | "rate_bps" | "number" | "integer" }
>;

function isNumericValue(value: TypedRuntimeValue): value is NumericRuntimeValue {
  return (
    value.type === "money_cents" ||
    value.type === "rate_bps" ||
    value.type === "number" ||
    value.type === "integer"
  );
}

function isGeneralNumericValue(
  value: TypedRuntimeValue,
): value is Extract<TypedRuntimeValue, { type: "number" | "integer" }> {
  return value.type === "number" || value.type === "integer";
}

function numericPrimitive(value: NumericRuntimeValue): number {
  switch (value.type) {
    case "money_cents":
      return value.amountCents;
    case "rate_bps":
      return value.rateBps;
    case "number":
    case "integer":
      return value.value;
  }
}

function createNumericValue(
  type: NumericRuntimeValue["type"],
  value: number,
  path: string,
): NumericRuntimeValue {
  if (!Number.isFinite(value)) {
    executionFailure(
      "EXECUTION_NON_FINITE",
      "Arithmetic produced a non-finite value",
      path,
    );
  }
  if (type !== "number" && !Number.isSafeInteger(value)) {
    executionFailure(
      "EXECUTION_UNSAFE_INTEGER",
      "Integer arithmetic exceeded the safe integer range",
      path,
    );
  }
  switch (type) {
    case "money_cents":
      return { type, amountCents: value };
    case "rate_bps":
      return { type, rateBps: value };
    case "number":
    case "integer":
      return { type, value };
  }
}

function moneyValue(value: number, path: string): NumericRuntimeValue {
  return createNumericValue("money_cents", value, path);
}

function rateValue(value: number, path: string): NumericRuntimeValue {
  return createNumericValue("rate_bps", value, path);
}

function coerceGeneralNumeric(
  value: TypedRuntimeValue,
  expectedType: RuntimeValueType,
  path: string,
): TypedRuntimeValue {
  if (
    value.type === "integer" &&
    scalarTypeOf(expectedType) === "number"
  ) {
    return createNumericValue("number", value.value, path);
  }
  return value;
}

function assertCompatibleNumericValues(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): asserts left is NumericRuntimeValue {
  if (!isNumericValue(left) || !isNumericValue(right)) {
    invalidAstContext("Function requires numeric values", path);
  }
  if (
    left.type !== right.type &&
    !(isGeneralNumericValue(left) && isGeneralNumericValue(right))
  ) {
    invalidAstContext("Function requires compatible numeric units", path);
  }
}

function compareNumericValues(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
): number {
  if (!isNumericValue(left) || !isNumericValue(right)) {
    return Number.NaN;
  }
  const leftValue = numericPrimitive(left);
  const rightValue = numericPrimitive(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function assertComparableValues(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): void {
  if (left.type === right.type) {
    return;
  }
  if (isGeneralNumericValue(left) && isGeneralNumericValue(right)) {
    return;
  }
  invalidAstContext("Comparison requires compatible runtime types", path);
}

function evaluateOrderedComparison(
  operator: "<" | "<=" | ">" | ">=",
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  path: string,
): boolean {
  assertComparableValues(left, right, path);
  let comparison: number;
  if (isNumericValue(left) && isNumericValue(right)) {
    comparison = compareNumericValues(left, right);
  } else if (left.type === "string" && right.type === "string") {
    comparison = left.value.localeCompare(right.value, "en");
  } else if (left.type === "timestamp" && right.type === "timestamp") {
    const leftTime = timestampEpoch(left.value, path);
    const rightTime = timestampEpoch(right.value, path);
    comparison = leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
  } else {
    invalidAstContext("Ordered comparison requires ordered scalar values", path);
  }
  switch (operator) {
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
  }
}

function timestampEpoch(value: string, path: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) {
    executionFailure(
      "EXECUTION_INVALID_CONTEXT",
      "Timestamp cannot be normalized to a finite epoch",
      path,
    );
  }
  return epoch;
}

function runtimeValuesEqual(
  left: TypedRuntimeValue,
  right: TypedRuntimeValue,
  context: EngineContext,
  path: string,
): boolean {
  consumeExecutionWork(context, path);
  if (isGeneralNumericValue(left) && isGeneralNumericValue(right)) {
    return left.value === right.value;
  }
  if (left.type !== right.type) {
    return false;
  }
  switch (left.type) {
    case "money_cents":
      return right.type === left.type && left.amountCents === right.amountCents;
    case "rate_bps":
      return right.type === left.type && left.rateBps === right.rateBps;
    case "number":
    case "integer":
    case "boolean":
    case "string":
      return right.type === left.type && left.value === right.value;
    case "timestamp":
      return (
        right.type === "timestamp" &&
        timestampEpoch(left.value, path) === timestampEpoch(right.value, path)
      );
    case "array":
      return (
        right.type === "array" &&
        left.items.length === right.items.length &&
        left.items.every((item, index) =>
          runtimeValuesEqual(
            item,
            right.items[index],
            context,
            `${path}.items[${index}]`,
          ),
        )
      );
    case "object": {
      if (right.type !== "object") {
        return false;
      }
      const leftKeys = Object.keys(left.fields).sort();
      const rightKeys = Object.keys(right.fields).sort();
      return (
        JSON.stringify(leftKeys) === JSON.stringify(rightKeys) &&
        leftKeys.every((key) =>
          runtimeValuesEqual(
            left.fields[key],
            right.fields[key],
            context,
            `${path}.fields.${key}`,
          ),
        )
      );
    }
  }
}

function assertRuntimeType(
  value: TypedRuntimeValue,
  expectedType: RuntimeValueType,
  path: string,
  astContext = false,
): void {
  if (!runtimeValueMatchesType(value, expectedType)) {
    executionFailure(
      astContext
        ? "EXECUTION_INVALID_AST_CONTEXT"
        : "EXECUTION_RUNTIME_TYPE_MISMATCH",
      astContext
        ? "Compiled AST inferred type does not match execution semantics"
        : "Runtime value does not match the compiled AST type",
      path,
    );
  }
}

function runtimeValueMatchesType(
  value: TypedRuntimeValue,
  expectedType: RuntimeValueType,
): boolean {
  if (expectedType.kind === "scalar") {
    return value.type === expectedType.scalarType;
  }
  if (expectedType.kind === "array") {
    return (
      value.type === "array" &&
      value.items.every((item) =>
        runtimeValueMatchesType(item, expectedType.itemType),
      )
    );
  }
  if (value.type !== "object") {
    return false;
  }
  const expectedKeys = Object.keys(expectedType.fields).sort();
  const actualKeys = Object.keys(value.fields).sort();
  return (
    JSON.stringify(expectedKeys) === JSON.stringify(actualKeys) &&
    expectedKeys.every((key) =>
      runtimeValueMatchesType(value.fields[key], expectedType.fields[key]),
    )
  );
}

function scalarTypeOf(type: RuntimeValueType | undefined): RuntimeScalarType | null {
  return type?.kind === "scalar" ? type.scalarType : null;
}

function scaleInteger(
  integer: number,
  multiplier: Extract<TypedRuntimeValue, { type: "number" | "integer" }>,
  path: string,
): number {
  const rational = numberToRational(multiplier.value, path);
  const product = multiplyRational(
    { numerator: BigInt(integer), denominator: BigInt(1) },
    rational,
    path,
  );
  return rationalToRoundedSafeInteger(product, path);
}

function numberToRational(value: number, path: string): Rational {
  if (!Number.isFinite(value)) {
    executionFailure(
      "EXECUTION_NON_FINITE",
      "Arithmetic received a non-finite number",
      path,
    );
  }
  if (Object.is(value, -0) || value === 0) {
    return zeroRational();
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(
    value.toString(),
  );
  if (!match) {
    arithmeticOverflow(path);
  }
  const sign = match[1] === "-" ? BigInt(-1) : BigInt(1);
  const integerDigits = match[2] ?? "0";
  const fractionalDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  const scale = fractionalDigits.length - exponent;
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > MAX_DECIMAL_SCALE) {
    arithmeticOverflow(path);
  }
  let numerator = sign * BigInt(integerDigits + fractionalDigits);
  let denominator = BigInt(1);
  if (scale > 0) {
    denominator = checkedPowerOfTen(scale, path);
  } else if (scale < 0) {
    numerator = checkedBigInt(numerator * checkedPowerOfTen(-scale, path), path);
  }
  return normalizeRational(numerator, denominator, path);
}

function checkedPowerOfTen(power: number, path: string): bigint {
  if (power < 0 || power > MAX_DECIMAL_SCALE) {
    arithmeticOverflow(path);
  }
  return checkedBigInt(BigInt(10) ** BigInt(power), path);
}

function zeroRational(): Rational {
  return { numerator: BigInt(0), denominator: BigInt(1) };
}

function normalizeRational(
  numerator: bigint,
  denominator: bigint,
  path: string,
): Rational {
  if (denominator === BigInt(0)) {
    executionFailure(
      "EXECUTION_DIVISION_BY_ZERO",
      "Division by zero is not allowed",
      path,
    );
  }
  let normalizedNumerator = numerator;
  let normalizedDenominator = denominator;
  if (normalizedDenominator < BigInt(0)) {
    normalizedNumerator = -normalizedNumerator;
    normalizedDenominator = -normalizedDenominator;
  }
  const divisor = greatestCommonDivisor(
    absoluteBigInt(normalizedNumerator),
    normalizedDenominator,
  );
  return {
    numerator: checkedBigInt(normalizedNumerator / divisor, path),
    denominator: checkedBigInt(normalizedDenominator / divisor, path),
  };
}

function addRational(left: Rational, right: Rational, path: string): Rational {
  const leftNumerator = checkedBigInt(
    left.numerator * right.denominator,
    path,
  );
  const rightNumerator = checkedBigInt(
    right.numerator * left.denominator,
    path,
  );
  return normalizeRational(
    checkedBigInt(leftNumerator + rightNumerator, path),
    checkedBigInt(left.denominator * right.denominator, path),
    path,
  );
}

function subtractRational(
  left: Rational,
  right: Rational,
  path: string,
): Rational {
  return addRational(
    left,
    { numerator: -right.numerator, denominator: right.denominator },
    path,
  );
}

function multiplyRational(
  left: Rational,
  right: Rational,
  path: string,
): Rational {
  return normalizeRational(
    checkedBigInt(left.numerator * right.numerator, path),
    checkedBigInt(left.denominator * right.denominator, path),
    path,
  );
}

function divideRational(
  left: Rational,
  right: Rational,
  path: string,
): Rational {
  if (right.numerator === BigInt(0)) {
    executionFailure(
      "EXECUTION_DIVISION_BY_ZERO",
      "Division by zero is not allowed",
      path,
    );
  }
  return normalizeRational(
    checkedBigInt(left.numerator * right.denominator, path),
    checkedBigInt(left.denominator * right.numerator, path),
    path,
  );
}

function compareRational(left: Rational, right: Rational, path: string): number {
  const leftScaled = checkedBigInt(left.numerator * right.denominator, path);
  const rightScaled = checkedBigInt(right.numerator * left.denominator, path);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function rationalToRoundedSafeInteger(value: Rational, path: string): number {
  return roundCheckedRatio(value.numerator, value.denominator, path);
}

function roundCheckedRatio(
  numerator: bigint,
  denominator: bigint,
  path: string,
): number {
  const normalized = normalizeRational(numerator, denominator, path);
  const quotient = normalized.numerator / normalized.denominator;
  const remainder = normalized.numerator % normalized.denominator;
  const doubledRemainder = checkedBigInt(
    absoluteBigInt(remainder) * BigInt(2),
    path,
  );
  const rounded =
    doubledRemainder >= normalized.denominator
      ? quotient + (normalized.numerator < BigInt(0) ? BigInt(-1) : BigInt(1))
      : quotient;
  return checkedBigIntToSafeNumber(rounded, path);
}

function rationalToFiniteNumber(value: Rational, path: string): number {
  const result = Number(value.numerator) / Number(value.denominator);
  if (!Number.isFinite(result)) {
    executionFailure(
      "EXECUTION_NON_FINITE",
      "Arithmetic produced a non-finite value",
      path,
    );
  }
  return result;
}

function checkedBigInt(value: bigint, path: string): bigint {
  const bits = absoluteBigInt(value).toString(2).length;
  if (bits > MAX_RATIONAL_BITS) {
    arithmeticOverflow(path);
  }
  return value;
}

function checkedBigIntToSafeNumber(value: bigint, path: string): number {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    executionFailure(
      "EXECUTION_UNSAFE_INTEGER",
      "Integer arithmetic exceeded the safe integer range",
      path,
    );
  }
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    executionFailure(
      "EXECUTION_UNSAFE_INTEGER",
      "Integer conversion was not exact",
      path,
    );
  }
  return converted;
}

function arithmeticOverflow(path: string): never {
  executionFailure(
    "EXECUTION_ARITHMETIC_OVERFLOW",
    "Exact arithmetic exceeded the configured intermediate bound",
    path,
  );
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === BigInt(0) ? BigInt(1) : a;
}

function absoluteBigInt(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

function unknownOperator(path: string): never {
  executionFailure(
    "EXECUTION_UNKNOWN_OPERATOR",
    "Compiled AST uses an unknown operator",
    path,
  );
}

function invalidAstContext(message: string, path: string): never {
  executionFailure("EXECUTION_INVALID_AST_CONTEXT", message, path);
}

function executionFailure(code: string, message: string, path: string): never {
  throw new CustomRuleExecutionError({ code, message, path });
}

function deepFreezeOwned<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreezeOwned(child);
    }
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
