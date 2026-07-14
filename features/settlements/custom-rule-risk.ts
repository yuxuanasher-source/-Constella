import {
  MATERIAL_RISK_CODES,
  parsePostgresBigintCents,
  type CustomRuleCompositionMode,
  type CustomRuleMissingDataPolicy,
  type CustomRuleTarget,
  type MaterialRiskCode,
} from "./custom-rule-types";

/** Default: flag comparable total increases above 20%. */
export const DEFAULT_ABNORMAL_TOTAL_INCREASE_BPS = 2_000;

/** Default: require material-risk review above CNY 1,000 per simulated output. */
export const DEFAULT_CUSTOM_RULE_SAFETY_CAP_CENTS = "100000";

export type CustomRuleMaterialRiskThresholds = Readonly<{
  abnormalTotalIncreaseBps?: number | null;
  safetyCapCents?: string | null;
}>;

export type CustomRuleMaterialRiskConfiguration = Readonly<{
  organization?: CustomRuleMaterialRiskThresholds | null;
  project?: CustomRuleMaterialRiskThresholds | null;
}>;

export type CustomRuleMissingDataImpactFact = Readonly<{
  policyAction: CustomRuleMissingDataPolicy["action"];
  amountDeltaCents: string | null;
}>;

export type CustomRuleGroupConflictFact = Readonly<{
  resolution: "none" | "explicit_exception";
  conflictingGroupIds: readonly string[];
}>;

export type CustomRuleMaterialRiskInput = Readonly<{
  simulation: Readonly<{
    totalOldCents: string | null;
    totalNewCents: string;
    marginImpactCents: string | null;
    riskFlags: readonly Readonly<{ code: string }>[];
    scenarios: readonly Readonly<{ amountCents: string | null }>[];
    missingDataImpact: CustomRuleMissingDataImpactFact;
  }>;
  currentMarginCents: string | null;
  contract: Readonly<{
    target: CustomRuleTarget;
    compositionMode: CustomRuleCompositionMode;
    missingDataPolicy: CustomRuleMissingDataPolicy;
    groupConflict: CustomRuleGroupConflictFact;
  }>;
  configuration?: CustomRuleMaterialRiskConfiguration;
}>;

type ThresholdSource = "project" | "organization" | "server_default";

export type CustomRuleMaterialRiskSummary = Readonly<{
  material: boolean;
  codes: readonly MaterialRiskCode[];
  findings: readonly Readonly<{ code: MaterialRiskCode; reason: string }>[];
  configuration: Readonly<{
    abnormalTotalIncreaseBps: Readonly<{
      value: number;
      source: ThresholdSource;
    }>;
    safetyCapCents: Readonly<{
      value: string;
      source: ThresholdSource;
    }>;
  }>;
}>;

const RISK_REASONS: Readonly<Record<MaterialRiskCode, string>> = Object.freeze({
  negative_margin: "Projected margin is negative after applying the rule.",
  abnormal_total_increase:
    "Comparable simulated settlement total exceeds the configured increase threshold.",
  red_evidence_payment:
    "At least one red-evidence record produces a non-zero payment.",
  money_changing_explicit_default:
    "An explicit missing-data default can change the settlement amount.",
  group_level_replace:
    "A streamer-group rule replaces the project settlement layer.",
  overlapping_group_exception:
    "The rule relies on an overlapping group exception.",
  safety_cap_exceeded:
    "At least one simulated output exceeds the configured project safety cap.",
});

export function analyzeCustomRuleMaterialRisk(
  input: CustomRuleMaterialRiskInput,
): CustomRuleMaterialRiskSummary {
  const configuration = resolveRiskConfiguration(input.configuration);
  const codes = new Set<MaterialRiskCode>();
  const currentMargin = parseOptionalCents(
    input.currentMarginCents,
    "currentMarginCents",
  );
  const marginImpact = parseOptionalCents(
    input.simulation.marginImpactCents,
    "marginImpactCents",
  );
  if (
    currentMargin !== null &&
    marginImpact !== null &&
    currentMargin + marginImpact < BigInt(0)
  ) {
    codes.add("negative_margin");
  }

  const oldTotal = parseNonnegativeCents(
    input.simulation.totalOldCents,
    "totalOldCents",
  );
  const newTotal = parseRequiredNonnegativeCents(
    input.simulation.totalNewCents,
    "totalNewCents",
  );
  if (
    oldTotal !== null &&
    isAbnormalIncrease(
      oldTotal,
      newTotal,
      configuration.abnormalTotalIncreaseBps.value,
    )
  ) {
    codes.add("abnormal_total_increase");
  }

  if (
    input.simulation.riskFlags.some(
      (flag) =>
        flag.code === "CUSTOM_RULE_RED_EVIDENCE_PRICED" ||
        flag.code === "red_evidence_payment",
    )
  ) {
    codes.add("red_evidence_payment");
  }
  const explicitDefaultImpact = resolveExplicitDefaultImpact(input);
  if (explicitDefaultImpact !== null && explicitDefaultImpact !== BigInt(0)) {
    codes.add("money_changing_explicit_default");
  }
  if (
    input.contract.target.targetType === "streamer_group" &&
    input.contract.compositionMode === "replace"
  ) {
    codes.add("group_level_replace");
  }
  if (hasExplicitOverlappingGroupException(input)) {
    codes.add("overlapping_group_exception");
  }

  const safetyCap = parseRequiredNonnegativeCents(
    configuration.safetyCapCents.value,
    "safetyCapCents",
  );
  if (
    input.simulation.scenarios.some((scenario, index) => {
      const amount = parseNonnegativeCents(
        scenario.amountCents,
        `scenarios[${index}].amountCents`,
      );
      return amount !== null && amount > safetyCap;
    })
  ) {
    codes.add("safety_cap_exceeded");
  }

  const orderedCodes = MATERIAL_RISK_CODES.filter((code) => codes.has(code));
  return {
    material: orderedCodes.length > 0,
    codes: orderedCodes,
    findings: orderedCodes.map((code) => ({
      code,
      reason: RISK_REASONS[code],
    })),
    configuration,
  };
}

function resolveExplicitDefaultImpact(
  input: CustomRuleMaterialRiskInput,
): bigint | null {
  const impact = input.simulation.missingDataImpact;
  if (!impact || typeof impact !== "object") {
    throw new TypeError("simulation.missingDataImpact is required");
  }

  const policyAction = input.contract.missingDataPolicy.action;
  if (impact.policyAction !== policyAction) {
    throw new RangeError(
      "simulation missing-data policy action does not match the contract",
    );
  }

  if (policyAction === "use_explicit_default") {
    return parseRequiredCents(
      impact.amountDeltaCents,
      "missingDataImpact.amountDeltaCents",
    );
  }
  if (impact.amountDeltaCents !== null) {
    throw new RangeError(
      "missingDataImpact.amountDeltaCents must be null without an explicit default",
    );
  }
  return null;
}

function hasExplicitOverlappingGroupException(
  input: CustomRuleMaterialRiskInput,
): boolean {
  const conflict = input.contract.groupConflict;
  if (!conflict || typeof conflict !== "object") {
    throw new TypeError("contract.groupConflict is required");
  }
  if (!Array.isArray(conflict.conflictingGroupIds)) {
    throw new TypeError("groupConflict.conflictingGroupIds must be an array");
  }

  const conflictingGroupIds = conflict.conflictingGroupIds.map((groupId) => {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new TypeError(
        "groupConflict.conflictingGroupIds must contain non-empty strings",
      );
    }
    return groupId.trim();
  });

  if (conflict.resolution === "none") {
    if (conflictingGroupIds.length > 0) {
      throw new RangeError(
        "groupConflict resolution none requires no conflictingGroupIds",
      );
    }
    return false;
  }
  if (conflict.resolution !== "explicit_exception") {
    throw new TypeError("groupConflict resolution is unsupported");
  }
  if (
    input.contract.target.targetType !== "streamer_group" ||
    input.contract.target.targetId.trim().length === 0
  ) {
    throw new RangeError(
      "An overlapping group exception requires a streamer-group target",
    );
  }
  if (conflictingGroupIds.length === 0) {
    throw new RangeError(
      "An explicit group exception requires non-empty conflictingGroupIds",
    );
  }
  return true;
}

function resolveRiskConfiguration(
  configured: CustomRuleMaterialRiskConfiguration | undefined,
): CustomRuleMaterialRiskSummary["configuration"] {
  for (const thresholds of [configured?.organization, configured?.project]) {
    validateRiskThresholds(thresholds);
  }

  const abnormalTotalIncreaseBps = resolveThreshold(
    configured?.project?.abnormalTotalIncreaseBps,
    configured?.organization?.abnormalTotalIncreaseBps,
    DEFAULT_ABNORMAL_TOTAL_INCREASE_BPS,
  );
  const safetyCapCents = resolveThreshold(
    configured?.project?.safetyCapCents,
    configured?.organization?.safetyCapCents,
    DEFAULT_CUSTOM_RULE_SAFETY_CAP_CENTS,
  );

  return {
    abnormalTotalIncreaseBps,
    safetyCapCents,
  };
}

function validateRiskThresholds(
  thresholds: CustomRuleMaterialRiskThresholds | null | undefined,
): void {
  const increase = thresholds?.abnormalTotalIncreaseBps;
  if (
    increase !== undefined &&
    increase !== null &&
    (!Number.isSafeInteger(increase) || increase < 0 || increase > 1_000_000)
  ) {
    throw new RangeError(
      "abnormalTotalIncreaseBps must be a nonnegative safe integer no greater than 1000000",
    );
  }

  const cap = thresholds?.safetyCapCents;
  if (cap !== undefined && cap !== null) {
    parseRequiredNonnegativeCents(cap, "safetyCapCents");
  }
}

function resolveThreshold<T>(
  projectValue: T | null | undefined,
  organizationValue: T | null | undefined,
  serverDefault: T,
): Readonly<{ value: T; source: ThresholdSource }> {
  if (projectValue !== undefined && projectValue !== null) {
    return { value: projectValue, source: "project" };
  }
  if (organizationValue !== undefined && organizationValue !== null) {
    return { value: organizationValue, source: "organization" };
  }
  return { value: serverDefault, source: "server_default" };
}

function isAbnormalIncrease(
  oldTotal: bigint,
  newTotal: bigint,
  thresholdBps: number,
): boolean {
  if (newTotal <= oldTotal) return false;
  if (oldTotal === BigInt(0)) return true;
  return (
    (newTotal - oldTotal) * BigInt(10_000) > oldTotal * BigInt(thresholdBps)
  );
}

function parseOptionalCents(
  value: string | null,
  label: string,
): bigint | null {
  if (value === null) return null;
  try {
    return parsePostgresBigintCents(value);
  } catch {
    throw new TypeError(`${label} must be PostgreSQL bigint cents`);
  }
}

function parseRequiredCents(
  value: string | null | undefined,
  label: string,
): bigint {
  if (value === null || value === undefined) {
    throw new TypeError(`${label} is required`);
  }
  try {
    return parsePostgresBigintCents(value);
  } catch {
    throw new TypeError(`${label} must be PostgreSQL bigint cents`);
  }
}

function parseNonnegativeCents(
  value: string | null,
  label: string,
): bigint | null {
  const parsed = parseOptionalCents(value, label);
  if (parsed !== null && parsed < BigInt(0)) {
    throw new RangeError(`${label} must be nonnegative`);
  }
  return parsed;
}

function parseRequiredNonnegativeCents(value: string, label: string): bigint {
  const parsed = parseNonnegativeCents(value, label);
  if (parsed === null) {
    throw new TypeError(`${label} is required`);
  }
  return parsed;
}
