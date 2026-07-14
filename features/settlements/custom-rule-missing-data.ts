import type {
  CustomRuleMissingDataPolicy,
  CustomRuleTarget,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";

export type MissingDataVariableCategory =
  | "formula_input"
  | "optional_input"
  | "identity"
  | "evidence"
  | "authorization"
  | "provider_data";

export type CustomRuleExecutionErrorCategory =
  | MissingDataVariableCategory
  | "parser"
  | "type"
  | "unit"
  | "ast_hash"
  | "parameter"
  | "composition"
  | "unexpected";

export type CustomRuleLayerLabel =
  | "project_base"
  | "streamer_group"
  | "project_streamer"
  | "fixed_base";

export type CustomRuleSafeErrorContext = Readonly<{
  ruleVersionId: string | null;
  target: CustomRuleTarget;
  layer: CustomRuleLayerLabel;
  executionUnitKey: string;
  variable?: string;
  category: CustomRuleExecutionErrorCategory;
}>;

export type CustomRuleExecutionIssue = Readonly<{
  code: string;
  message: string;
  context: CustomRuleSafeErrorContext;
}>;

export class CustomRuleExecutionError extends Error {
  readonly issue: CustomRuleExecutionIssue;
  readonly noTransactionAttempted: boolean;

  constructor(
    issue: CustomRuleExecutionIssue,
    options: { noTransactionAttempted?: boolean } = {},
  ) {
    super(issue.message);
    this.name = "CustomRuleExecutionError";
    this.issue = deepFreezeOwned({ ...issue });
    this.noTransactionAttempted = options.noTransactionAttempted ?? false;
  }
}

export type MissingDataVariableDeclaration = Readonly<{
  name: string;
  required: boolean;
  category: MissingDataVariableCategory;
  valueType: RuntimeValueType;
  missingDataPolicy?: CustomRuleMissingDataPolicy;
}>;

export type MissingDataDecision = Readonly<{
  ruleVersionId: string | null;
  target: CustomRuleTarget;
  layer: CustomRuleLayerLabel;
  executionUnitKey: string;
  variable: string;
  category: MissingDataVariableCategory;
  action: CustomRuleMissingDataPolicy["action"];
  value?: TypedRuntimeValue;
}>;

export type PreparedRuleException = Readonly<{
  ruleVersionId: string | null;
  target: CustomRuleTarget;
  layer: CustomRuleLayerLabel;
  executionUnitKey: string;
  variable: string;
  category: MissingDataVariableCategory;
  policy: "route_item_to_review";
  placeholderAmountCents: 0;
  contributionCents: 0;
  status: "review_required";
  layerSnapshot?: Record<string, unknown>;
}>;

export type PreparedExecution =
  | {
      kind: "ready";
      variables: Record<string, TypedRuntimeValue>;
      decisions: MissingDataDecision[];
    }
  | { kind: "review"; exceptions: PreparedRuleException[] }
  | { kind: "blocked"; error: CustomRuleExecutionError };

export function applyMissingDataPoliciesBeforeExecution(input: {
  ruleVersionId: string | null;
  target: CustomRuleTarget;
  layer: CustomRuleLayerLabel;
  executionUnitKey: string;
  variables: Record<string, TypedRuntimeValue>;
  declarations: readonly MissingDataVariableDeclaration[];
}): PreparedExecution {
  const missing = input.declarations
    .filter((declaration) => input.variables[declaration.name] === undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (missing.length === 0) {
    return { kind: "ready", variables: { ...input.variables }, decisions: [] };
  }

  const blockers = missing
    .map((declaration) => blockerForMissingDeclaration(input, declaration))
    .filter((error): error is CustomRuleExecutionError => error !== null);
  if (blockers.length > 0) {
    blockers.sort(compareExecutionErrors);
    return { kind: "blocked", error: blockers[0] };
  }

  const reviewDeclarations = missing.filter(
    (declaration) =>
      declaration.missingDataPolicy?.action === "route_item_to_review",
  );
  if (reviewDeclarations.length > 0) {
    return {
      kind: "review",
      exceptions: reviewDeclarations.map((declaration) => ({
        ruleVersionId: input.ruleVersionId,
        target: input.target,
        layer: input.layer,
        executionUnitKey: input.executionUnitKey,
        variable: declaration.name,
        category: declaration.category,
        policy: "route_item_to_review",
        placeholderAmountCents: 0,
        contributionCents: 0,
        status: "review_required",
      })),
    };
  }

  const variables = { ...input.variables };
  const decisions: MissingDataDecision[] = [];
  for (const declaration of missing) {
    const policy = declaration.missingDataPolicy;
    if (policy?.action !== "use_explicit_default") {
      continue;
    }
    variables[declaration.name] = policy.defaultValue;
    decisions.push({
      ruleVersionId: input.ruleVersionId,
      target: input.target,
      layer: input.layer,
      executionUnitKey: input.executionUnitKey,
      variable: declaration.name,
      category: declaration.category,
      action: "use_explicit_default",
      value: policy.defaultValue,
    });
  }

  return { kind: "ready", variables, decisions };
}

export function createCustomRuleExecutionError(input: {
  code: string;
  message: string;
  context: CustomRuleSafeErrorContext;
  noTransactionAttempted?: boolean;
}): CustomRuleExecutionError {
  return new CustomRuleExecutionError(
    {
      code: input.code,
      message: input.message,
      context: input.context,
    },
    { noTransactionAttempted: input.noTransactionAttempted },
  );
}

export function runtimeValueMatchesType(
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

function blockerForMissingDeclaration(
  input: {
    ruleVersionId: string | null;
    target: CustomRuleTarget;
    layer: CustomRuleLayerLabel;
    executionUnitKey: string;
  },
  declaration: MissingDataVariableDeclaration,
): CustomRuleExecutionError | null {
  const context = {
    ruleVersionId: input.ruleVersionId,
    target: input.target,
    layer: input.layer,
    executionUnitKey: input.executionUnitKey,
    variable: declaration.name,
    category: declaration.category,
  } satisfies CustomRuleSafeErrorContext;
  if (declaration.required) {
    return createCustomRuleExecutionError({
      code: "CUSTOM_RULE_REQUIRED_INPUT_MISSING",
      message: "Required custom settlement input is missing",
      context,
      noTransactionAttempted: true,
    });
  }

  const policy = declaration.missingDataPolicy;
  if (policy === undefined) {
    return createCustomRuleExecutionError({
      code: "CUSTOM_RULE_UNDECLARED_MISSING_DATA_POLICY",
      message: "Optional custom settlement input is missing without a policy",
      context,
      noTransactionAttempted: true,
    });
  }

  if (policy.action === "block_batch") {
    return createCustomRuleExecutionError({
      code: "CUSTOM_RULE_MISSING_DATA_BLOCKED",
      message: "Missing custom settlement input blocks batch generation",
      context,
      noTransactionAttempted: true,
    });
  }

  if (policy.action === "route_item_to_review") {
    if (declaration.category !== "optional_input") {
      return createCustomRuleExecutionError({
        code: "CUSTOM_RULE_REVIEW_POLICY_NOT_ALLOWED",
        message:
          "Review routing is only allowed for exact optional input misses",
        context,
        noTransactionAttempted: true,
      });
    }
    return null;
  }

  if (isDefaultForbiddenCategory(declaration.category)) {
    return createCustomRuleExecutionError({
      code: "CUSTOM_RULE_FORBIDDEN_EXPLICIT_DEFAULT",
      message: "This custom settlement field cannot use an explicit default",
      context,
      noTransactionAttempted: true,
    });
  }
  if (!runtimeValueMatchesType(policy.defaultValue, declaration.valueType)) {
    return createCustomRuleExecutionError({
      code: "CUSTOM_RULE_DEFAULT_TYPE_MISMATCH",
      message: "Explicit default does not match the declared runtime type",
      context,
      noTransactionAttempted: true,
    });
  }
  return null;
}

function isDefaultForbiddenCategory(
  category: MissingDataVariableCategory,
): boolean {
  return (
    category === "identity" ||
    category === "evidence" ||
    category === "authorization" ||
    category === "provider_data"
  );
}

function compareExecutionErrors(
  left: CustomRuleExecutionError,
  right: CustomRuleExecutionError,
): number {
  return (
    severity(left.issue.code) - severity(right.issue.code) ||
    (left.issue.context.variable ?? "").localeCompare(
      right.issue.context.variable ?? "",
    )
  );
}

function severity(code: string): number {
  switch (code) {
    case "CUSTOM_RULE_REQUIRED_INPUT_MISSING":
      return 0;
    case "CUSTOM_RULE_MISSING_DATA_BLOCKED":
      return 1;
    case "CUSTOM_RULE_FORBIDDEN_EXPLICIT_DEFAULT":
    case "CUSTOM_RULE_REVIEW_POLICY_NOT_ALLOWED":
    case "CUSTOM_RULE_DEFAULT_TYPE_MISMATCH":
      return 2;
    case "CUSTOM_RULE_UNDECLARED_MISSING_DATA_POLICY":
      return 3;
    default:
      return 4;
  }
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
