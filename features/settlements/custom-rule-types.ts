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

export const MATERIAL_RISK_CODES = Object.freeze([
  "negative_margin",
  "abnormal_total_increase",
  "red_evidence_payment",
  "money_changing_explicit_default",
  "group_level_replace",
  "overlapping_group_exception",
  "safety_cap_exceeded",
] as const);

export type MaterialRiskCode = (typeof MATERIAL_RISK_CODES)[number];

export type CustomRuleSimulationFreshnessHashes = Readonly<{
  formulaHash: string | null | undefined;
  contractHash: string | null | undefined;
  parameterHash: string | null | undefined;
  catalogHash: string | null | undefined;
  dataSelectionHash: string | null | undefined;
}>;

export type CustomRulePrimaryActionDto =
  | { state: "draft"; action: "apply_and_submit" }
  | { state: "pending_review"; action: "approve" }
  | { state: "changes_requested"; action: "revise_and_resimulate" }
  | { state: "active"; action: "create_new_version" }
  | { state: "archived"; action: "none" };

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
const CANONICAL_NUMBER_DECIMAL_PATTERN =
  /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/;
const SAFE_INTEGER_MIN_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_INTEGER_MAX_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const TWO_BIGINT = BigInt(2);
const FLOAT_NOISE_ULP_MULTIPLIER = 4;
const MAX_FLOAT_NOISE_IN_SCALED_UNITS = 1e-9;

class FractionalScaledValueError extends RangeError {
  constructor(
    message: string,
    readonly nearestInteger: bigint,
  ) {
    super(message);
    this.name = "FractionalScaledValueError";
  }
}

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
  return scaleLegacyNumberToSafeInteger(value, 2, "yuan", "cents");
}

export function centsToLegacyYuan(cents: number): number {
  const safeCents = assertSafeIntegerValue(cents, "cents");
  const yuan = safeCents / 100;

  if (scaleCanonicalDecimalExactly(yuan, 2, "yuan", "cents") !== safeCents) {
    throw new RangeError("cents cannot be represented losslessly as yuan");
  }

  return yuan;
}

export function percentToBpsStrict(value: number): number {
  return scaleLegacyNumberToSafeInteger(value, 2, "percent", "basis points");
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

function scaleLegacyNumberToSafeInteger(
  value: number,
  decimalPlaces: number,
  inputLabel: string,
  outputLabel: string,
): number {
  try {
    return scaleCanonicalDecimalExactly(
      value,
      decimalPlaces,
      inputLabel,
      outputLabel,
    );
  } catch (error) {
    if (!(error instanceof FractionalScaledValueError)) {
      throw error;
    }

    return recoverNormalFloatingNoise(
      value,
      decimalPlaces,
      inputLabel,
      outputLabel,
      error,
    );
  }
}

function scaleCanonicalDecimalExactly(
  value: number,
  decimalPlaces: number,
  inputLabel: string,
  outputLabel: string,
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${inputLabel} must be finite`);
  }

  const match = CANONICAL_NUMBER_DECIMAL_PATTERN.exec(value.toString());
  if (!match) {
    throw new TypeError(`${inputLabel} must use canonical decimal notation`);
  }

  const [, sign, wholeDigits, fractionalDigits = "", exponentText = "0"] =
    match;
  const digits = BigInt(`${wholeDigits}${fractionalDigits}`);
  const scaledExponent =
    Number(exponentText) - fractionalDigits.length + decimalPlaces;

  let magnitude: bigint;
  if (scaledExponent >= 0) {
    magnitude = digits * decimalPowerOfTen(scaledExponent);
  } else {
    const divisor = decimalPowerOfTen(-scaledExponent);
    const remainder = digits % divisor;
    if (remainder !== ZERO_BIGINT) {
      const nearestMagnitude =
        digits / divisor +
        (remainder * TWO_BIGINT >= divisor ? ONE_BIGINT : ZERO_BIGINT);
      const nearestInteger =
        sign === "-" ? -nearestMagnitude : nearestMagnitude;
      throw new FractionalScaledValueError(
        `${inputLabel} has a fractional ${outputLabel} value`,
        nearestInteger,
      );
    }
    magnitude = digits / divisor;
  }

  const scaled = sign === "-" ? -magnitude : magnitude;
  if (scaled < SAFE_INTEGER_MIN_BIGINT || scaled > SAFE_INTEGER_MAX_BIGINT) {
    throw new RangeError(`${outputLabel} must be a safe integer`);
  }

  return Number(scaled);
}

function recoverNormalFloatingNoise(
  value: number,
  decimalPlaces: number,
  inputLabel: string,
  outputLabel: string,
  fractionalError: FractionalScaledValueError,
): number {
  const nearestInteger = fractionalError.nearestInteger;
  if (
    nearestInteger < SAFE_INTEGER_MIN_BIGINT ||
    nearestInteger > SAFE_INTEGER_MAX_BIGINT
  ) {
    throw new RangeError(`${outputLabel} must be a safe integer`);
  }

  const candidateInteger = Number(nearestInteger);
  const decimalScale = Number(decimalPowerOfTen(decimalPlaces));
  const candidateValue = candidateInteger / decimalScale;

  let candidateRoundTrip: number;
  try {
    candidateRoundTrip = scaleCanonicalDecimalExactly(
      candidateValue,
      decimalPlaces,
      inputLabel,
      outputLabel,
    );
  } catch {
    throw fractionalError;
  }
  if (candidateRoundTrip !== candidateInteger) {
    throw fractionalError;
  }

  const relativeUlpTolerance =
    Number.EPSILON *
    Math.max(Math.abs(value), Math.abs(candidateValue)) *
    FLOAT_NOISE_ULP_MULTIPLIER;
  const scaledUnitCap = MAX_FLOAT_NOISE_IN_SCALED_UNITS / decimalScale;
  const tolerance = Math.min(relativeUlpTolerance, scaledUnitCap);
  if (Math.abs(value - candidateValue) > tolerance) {
    throw fractionalError;
  }

  return candidateInteger;
}

function decimalPowerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError("decimal exponent must be a nonnegative safe integer");
  }
  return BigInt(`1${"0".repeat(exponent)}`);
}
