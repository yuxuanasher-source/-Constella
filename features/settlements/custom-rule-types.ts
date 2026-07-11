export const CUSTOM_RULE_SCOPES = [
  "receivable",
  "payable",
  "external_cost",
  "reconciliation",
] as const;

export type CustomRuleScope = (typeof CUSTOM_RULE_SCOPES)[number];

export const CUSTOM_RULE_TARGET_TYPES = [
  "project",
  "streamer_group",
  "project_streamer",
] as const;

export type CustomRuleTargetType = (typeof CUSTOM_RULE_TARGET_TYPES)[number];

export const CUSTOM_RULE_EXECUTION_GRAINS = [
  "report",
  "project_streamer_period",
  "batch",
  "project_period",
] as const;

export type CustomRuleExecutionGrain =
  (typeof CUSTOM_RULE_EXECUTION_GRAINS)[number];

export const CUSTOM_RULE_COMPOSITION_MODES = [
  "replace",
  "add",
  "multiply",
  "clamp",
  "emit_items",
  "check",
] as const;

export type CustomRuleCompositionMode =
  (typeof CUSTOM_RULE_COMPOSITION_MODES)[number];

export const CUSTOM_RULE_VERSION_STATUSES = [
  "draft",
  "pending_review",
  "changes_requested",
  "active",
  "archived",
] as const;

export type CustomRuleVersionStatus =
  (typeof CUSTOM_RULE_VERSION_STATUSES)[number];

export const RUNTIME_SCALAR_TYPES = [
  "money_cents",
  "rate_bps",
  "number",
  "integer",
  "boolean",
  "string",
  "timestamp",
] as const;

export type RuntimeScalarType = (typeof RUNTIME_SCALAR_TYPES)[number];

export type CustomRuleTarget =
  | { targetType: "project"; targetId: null }
  | { targetType: "streamer_group"; targetId: string }
  | { targetType: "project_streamer"; targetId: string };

export type RuntimeValueType =
  | { kind: "scalar"; scalarType: RuntimeScalarType }
  | { kind: "array"; itemType: RuntimeValueType }
  | { kind: "object"; fields: Record<string, RuntimeValueType> };

export type TypedRuntimeValue =
  | { type: "money_cents"; amountCents: number }
  | { type: "rate_bps"; rateBps: number }
  | { type: "number"; value: number }
  | { type: "integer"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "string"; value: string }
  | { type: "timestamp"; value: string }
  | { type: "array"; items: TypedRuntimeValue[] }
  | { type: "object"; fields: Record<string, TypedRuntimeValue> };

export type CustomRuleMissingDataPolicy =
  | { action: "route_item_to_review" }
  | { action: "block_batch" }
  | {
      action: "use_explicit_default";
      defaultValue: TypedRuntimeValue;
    };

export type NormalizedLiteralValue = string | number | boolean | null;

export type NormalizedAstNode =
  | { kind: "literal"; value: NormalizedLiteralValue }
  | { kind: "identifier"; name: string }
  | { kind: "unary"; operator: string; argument: NormalizedAstNode }
  | {
      kind: "binary";
      operator: string;
      left: NormalizedAstNode;
      right: NormalizedAstNode;
    }
  | { kind: "call"; callee: string; arguments: NormalizedAstNode[] }
  | { kind: "array"; elements: NormalizedAstNode[] }
  | {
      kind: "object";
      entries: Array<{ key: string; value: NormalizedAstNode }>;
    };

type CompiledLiteralAstNode =
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "money_cents" };
      valueCents: number;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "rate_bps" };
      valueBps: number;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "number" };
      value: number;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "integer" };
      value: number;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "boolean" };
      value: boolean;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "string" };
      value: string;
    }
  | {
      kind: "literal";
      inferredType: { kind: "scalar"; scalarType: "timestamp" };
      value: string;
    };

export type CompiledAstNode =
  | CompiledLiteralAstNode
  | { kind: "identifier"; name: string; inferredType: RuntimeValueType }
  | {
      kind: "unary";
      operator: string;
      argument: CompiledAstNode;
      inferredType: RuntimeValueType;
    }
  | {
      kind: "binary";
      operator: string;
      left: CompiledAstNode;
      right: CompiledAstNode;
      inferredType: RuntimeValueType;
    }
  | {
      kind: "call";
      callee: string;
      arguments: CompiledAstNode[];
      inferredType: RuntimeValueType;
    }
  | {
      kind: "array";
      elements: CompiledAstNode[];
      inferredType: RuntimeValueType;
    }
  | {
      kind: "object";
      entries: Array<{ key: string; value: CompiledAstNode }>;
      inferredType: RuntimeValueType;
    };

const POSTGRES_BIGINT_MIN = BigInt("-9223372036854775808");
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const POSTGRES_BIGINT_DECIMAL_PATTERN = /^-?\d+$/;
const MAX_SCALED_INTEGER_DRIFT = 1e-6;

export function isCustomRuleTargetCompatible(
  scope: CustomRuleScope,
  targetType: CustomRuleTargetType,
): boolean {
  return scope === "payable" || targetType === "project";
}

export function assertSafeIntegerValue(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return value;
}

export function yuanToCentsStrict(value: number): number {
  return scaleToSafeInteger(value, 100, "yuan", "cents");
}

export function centsToLegacyYuan(cents: number): number {
  return assertSafeIntegerValue(cents, "cents") / 100;
}

export function percentToBpsStrict(value: number): number {
  return scaleToSafeInteger(value, 100, "percent", "basis points");
}

export function parsePostgresBigintCents(
  value: string | bigint | number,
): bigint {
  let parsed: bigint;

  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    parsed = BigInt(assertSafeIntegerValue(value, "Postgres bigint cents"));
  } else {
    if (!POSTGRES_BIGINT_DECIMAL_PATTERN.test(value)) {
      throw new TypeError("Postgres bigint cents must be a decimal integer");
    }
    parsed = BigInt(value);
  }

  if (parsed < POSTGRES_BIGINT_MIN || parsed > POSTGRES_BIGINT_MAX) {
    throw new RangeError("Postgres bigint cents are outside the bigint range");
  }

  return parsed;
}

export function serializePostgresBigintCents(
  value: string | bigint | number,
): string {
  return parsePostgresBigintCents(value).toString(10);
}

function scaleToSafeInteger(
  value: number,
  scale: number,
  inputLabel: string,
  outputLabel: string,
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${inputLabel} must be finite`);
  }

  const scaled = value * scale;
  if (!Number.isFinite(scaled)) {
    throw new RangeError(`${outputLabel} overflowed`);
  }

  const rounded = assertSafeIntegerValue(Math.round(scaled), outputLabel);
  const tolerance = Math.min(
    Number.EPSILON * Math.abs(scaled) * Math.max(2, scale / 25),
    MAX_SCALED_INTEGER_DRIFT,
  );
  if (Math.abs(scaled - rounded) > tolerance) {
    throw new RangeError(`${inputLabel} has a fractional ${outputLabel} value`);
  }

  return rounded;
}
