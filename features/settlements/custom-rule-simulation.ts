import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

import { z } from "zod";

import {
  businessRuleContractSchema,
  compiledAstNodeSchema,
  customRuleMissingDataPolicySchema,
  runtimeScalarTypeSchema,
  typedRuntimeValueSchema,
  type BusinessRuleContract,
} from "./custom-rule-contract";
import type { CustomRuleDataReadinessReport } from "./custom-rule-data-readiness";
import {
  executeCompiledCustomRuleWithTrace,
  type ExecuteCompiledCustomRuleInput,
} from "./custom-rule-engine";
import { buildCustomRuleExecutionExplanation } from "./custom-rule-explanation";
import type {
  InsertSettlementFormulaSimulationInput,
  SettlementSimulationWarning,
} from "./custom-rule-repository";
import {
  parsePostgresBigintCents,
  serializePostgresBigintCents,
  yuanToCentsStrict,
  type CompiledAstNode,
  type CustomRuleMissingDataPolicy,
  type TypedRuntimeValue,
} from "./custom-rule-types";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_RECORDS = 500;
const MAX_SCENARIOS = 200;
const MAX_CHANGE_BUCKETS = 10;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 200_000;
const MAX_SNAPSHOT_STRING_CHARACTERS = 2_000_000;

const canonicalTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "text must already be canonical",
    });
const safeIntegerSchema = z.number().refine(Number.isSafeInteger, {
  message: "must be a safe integer",
});
const nonnegativeSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { message: "must be a nonnegative safe integer" },
);
const hashSchema = z.string().regex(HASH_PATTERN);
const canonicalBigintSchema = z.string().refine(
  (value) => {
    try {
      return serializePostgresBigintCents(value) === value;
    } catch {
      return false;
    }
  },
  { message: "must be a canonical Postgres bigint decimal string" },
);
const businessDateSchema = z.string().refine(isValidBusinessDate, {
  message: "must be a valid YYYY-MM-DD business date",
});
const runtimeValuesSchema = z.record(
  z.string().regex(IDENTIFIER_PATTERN),
  typedRuntimeValueSchema,
);

const immutableSourceVersionSchema = z.strictObject({
  kind: z.literal("immutable"),
  source: canonicalTextSchema(120),
  version: canonicalTextSchema(500),
});
const currentRuleResultSchema = z.discriminatedUnion("unitSource", [
  z.strictObject({
    unitSource: z.literal("current_rule_cents"),
    amountCents: canonicalBigintSchema,
  }),
  z.strictObject({
    unitSource: z.literal("legacy_yuan"),
    amountYuan: z.number().finite(),
  }),
]);
const missingInputSchema = z.strictObject({
  variableId: z.string().regex(IDENTIFIER_PATTERN),
  policy: customRuleMissingDataPolicySchema,
});
const authorizedRecordSchema = z
  .strictObject({
    recordId: canonicalTextSchema(500),
    projectId: canonicalTextSchema(500),
    sourceVersion: immutableSourceVersionSchema,
    variables: runtimeValuesSchema,
    missingInputs: z.array(missingInputSchema).max(100),
    currentRuleResult: currentRuleResultSchema.nullable(),
  })
  .superRefine((record, context) => {
    const ids = new Set<string>();
    for (const [index, missing] of record.missingInputs.entries()) {
      if (ids.has(missing.variableId)) {
        context.addIssue({
          code: "custom",
          path: ["missingInputs", index, "variableId"],
          message: "missing input ids must be unique",
        });
      }
      ids.add(missing.variableId);
    }
  });

const readinessInputSchema = z.strictObject({
  variableId: z.string().regex(IDENTIFIER_PATTERN),
  required: z.boolean(),
  status: z.enum(["available", "partial", "unavailable", "not_applicable"]),
  ready: z.boolean(),
  coverageNumerator: nonnegativeSafeIntegerSchema,
  coverageDenominator: nonnegativeSafeIntegerSchema,
  code: canonicalTextSchema(200),
  reasonZh: canonicalTextSchema(2_000),
});
const readinessSchema = z.strictObject({
  catalogVersion: hashSchema,
  readinessHash: hashSchema,
  businessTimezone: z.string().min(1).max(100).nullable(),
  businessTimezoneConfirmed: z.boolean(),
  businessTimezoneSource: z.enum([
    "contract_default",
    "organization_setting",
    "confirmed_contract",
    "unresolved",
  ]),
  historicalVerification: z.enum(["verified", "unverified"]),
  readyForSimulation: z.boolean(),
  readyForActivation: z.boolean(),
  inputs: z.array(readinessInputSchema).max(300),
  warnings: z
    .array(
      z.strictObject({
        code: z.literal("CUSTOM_RULE_PROJECT_NO_HISTORY"),
        reasonZh: canonicalTextSchema(2_000),
      }),
    )
    .max(100),
});
const sampleSourceSchema = z.strictObject({
  kind: z.enum([
    "historical_settlements",
    "approved_operations",
    "synthetic_scenarios",
  ]),
});
const sampleSelectionSchema = z
  .strictObject({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    populationCount: nonnegativeSafeIntegerSchema,
    criteria: z.array(canonicalTextSchema(200)).max(100),
  })
  .refine(
    (selection) => selection.periodStart <= selection.periodEnd,
    { message: "sample period start must not be after period end" },
  );
const thresholdScenarioSchema = z.strictObject({
  thresholdId: canonicalTextSchema(120),
  edge: z.enum(["below", "at", "above"]),
  variables: runtimeValuesSchema,
});
const maximumScenarioSchema = z.strictObject({
  maximumId: canonicalTextSchema(120),
  variables: runtimeValuesSchema,
});
const evidenceScenarioSchema = z.strictObject({
  level: z.enum(["green", "yellow", "red"]),
  variables: runtimeValuesSchema,
});
const missingPolicyScenarioSchema = z.strictObject({
  variableId: z.string().regex(IDENTIFIER_PATTERN),
  policy: customRuleMissingDataPolicySchema,
  variables: runtimeValuesSchema,
});
const syntheticSchema = z.strictObject({
  zero: z.strictObject({ variables: runtimeValuesSchema }),
  thresholdEdges: z.array(thresholdScenarioSchema).min(1).max(MAX_SCENARIOS),
  configuredMaximums: z.array(maximumScenarioSchema).min(1).max(MAX_SCENARIOS),
  evidenceLevels: z.array(evidenceScenarioSchema).max(3),
  missingDataPolicies: z.array(missingPolicyScenarioSchema).max(3),
});
const userExampleSchema = z.strictObject({
  id: canonicalTextSchema(120),
  variables: runtimeValuesSchema,
});
const simulationInputSchema = z.strictObject({
  projectId: canonicalTextSchema(500),
  contract: businessRuleContractSchema,
  compiledAst: compiledAstNodeSchema,
  parameters: runtimeValuesSchema,
  formulaHash: hashSchema,
  contractHash: hashSchema,
  parameterHash: hashSchema,
  catalogVersion: hashSchema,
  readiness: readinessSchema,
  sampleSource: sampleSourceSchema,
  sampleSelection: sampleSelectionSchema,
  records: z.array(authorizedRecordSchema).max(MAX_RECORDS),
  synthetic: syntheticSchema,
  userExamples: z.array(userExampleSchema).min(1).max(MAX_SCENARIOS),
  currentMarginCents: canonicalBigintSchema.nullable().optional(),
});

const executionTraceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ast"),
    path: z.literal("$"),
    canonicalAst: z.string(),
  }),
  z.strictObject({
    kind: z.literal("variable"),
    path: z.string(),
    name: z.string().regex(IDENTIFIER_PATTERN),
    value: typedRuntimeValueSchema,
  }),
  z.strictObject({
    kind: z.literal("parameter"),
    path: z.string(),
    name: z.string().regex(IDENTIFIER_PATTERN),
    value: typedRuntimeValueSchema,
  }),
  z.strictObject({
    kind: z.literal("branch"),
    path: z.string(),
    condition: z.boolean(),
    selected: z.enum(["when_true", "when_false"]),
  }),
  z.strictObject({
    kind: z.literal("tier"),
    path: z.string(),
    tierIndex: nonnegativeSafeIntegerSchema,
    minutesApplied: safeIntegerSchema,
    ratePerHourCents: safeIntegerSchema,
    exactAmountCents: z.strictObject({
      numerator: z.string().regex(/^-?\d+$/u),
      denominator: z.string().regex(/^\d+$/u),
    }),
    amountCents: safeIntegerSchema,
  }),
  z.strictObject({
    kind: z.literal("evidence"),
    path: z.string(),
    level: z.string(),
    rateBps: safeIntegerSchema,
  }),
  z.strictObject({
    kind: z.literal("percent"),
    path: z.string(),
    amountCents: safeIntegerSchema,
    rateBps: safeIntegerSchema,
    resultCents: safeIntegerSchema,
  }),
  z.strictObject({
    kind: z.literal("clamp"),
    path: z.string(),
    outcome: z.enum(["floor", "cap", "unchanged"]),
    value: safeIntegerSchema,
    floor: safeIntegerSchema,
    cap: safeIntegerSchema,
    result: safeIntegerSchema,
    scalarType: runtimeScalarTypeSchema,
  }),
  z.strictObject({
    kind: z.literal("component"),
    path: z.string(),
    name: z.string().regex(IDENTIFIER_PATTERN),
    amountCents: safeIntegerSchema,
  }),
]);
const moneyResultSchema = z
  .strictObject({
    kind: z.literal("money_result"),
    componentsCents: z.record(
      z.string().regex(IDENTIFIER_PATTERN),
      safeIntegerSchema,
    ),
  })
  .refine(
    (result) =>
      Object.prototype.hasOwnProperty.call(result.componentsCents, "final"),
    { message: "engine output must include final" },
  );
const executionOutputSchema = z.strictObject({
  result: moneyResultSchema,
  trace: z.array(executionTraceSchema).max(100_000),
});

export type CustomRuleSimulationInput = {
  projectId: string;
  contract: BusinessRuleContract;
  compiledAst: CompiledAstNode;
  parameters: Record<string, TypedRuntimeValue>;
  formulaHash: string;
  contractHash: string;
  parameterHash: string;
  catalogVersion: string;
  readiness: CustomRuleDataReadinessReport;
  sampleSource: { kind: "historical_settlements" | "approved_operations" | "synthetic_scenarios" };
  sampleSelection: {
    periodStart: string;
    periodEnd: string;
    populationCount: number;
    criteria: string[];
  };
  records: Array<{
    recordId: string;
    projectId: string;
    sourceVersion: {
      kind: "immutable";
      source: string;
      version: string;
    };
    variables: Record<string, TypedRuntimeValue>;
    missingInputs: Array<{
      variableId: string;
      policy: CustomRuleMissingDataPolicy;
    }>;
    currentRuleResult:
      | { unitSource: "current_rule_cents"; amountCents: string }
      | { unitSource: "legacy_yuan"; amountYuan: number }
      | null;
  }>;
  synthetic: {
    zero: { variables: Record<string, TypedRuntimeValue> };
    thresholdEdges: Array<{
      thresholdId: string;
      edge: "below" | "at" | "above";
      variables: Record<string, TypedRuntimeValue>;
    }>;
    configuredMaximums: Array<{
      maximumId: string;
      variables: Record<string, TypedRuntimeValue>;
    }>;
    evidenceLevels: Array<{
      level: "green" | "yellow" | "red";
      variables: Record<string, TypedRuntimeValue>;
    }>;
    missingDataPolicies: Array<{
      variableId: string;
      policy: CustomRuleMissingDataPolicy;
      variables: Record<string, TypedRuntimeValue>;
    }>;
  };
  userExamples: Array<{
    id: string;
    variables: Record<string, TypedRuntimeValue>;
  }>;
  currentMarginCents?: string | null;
};

export type CustomRuleSimulationEvidence = Pick<
  CustomRuleSimulationInput,
  | "sampleSource"
  | "sampleSelection"
  | "records"
  | "synthetic"
  | "userExamples"
  | "currentMarginCents"
>;

export type CustomRuleSimulationRuntime = {
  execute(input: ExecuteCompiledCustomRuleInput): unknown;
  explain(input: {
    ast: CompiledAstNode;
    trace: z.infer<typeof executionTraceSchema>[];
    result: z.infer<typeof moneyResultSchema>;
  }): unknown;
};

export type CustomRuleSimulationScenario = Readonly<{
  id: string;
  category:
    | "zero"
    | "threshold_edge"
    | "configured_maximum"
    | "evidence_level"
    | "missing_data_policy"
    | "user_example";
  outcome: "calculated" | "review_routed" | "blocked";
  amountCents: string | null;
}>;

export type CustomRuleSimulationRiskFlag = Readonly<{
  code: string;
  severity: "info" | "warning" | "block";
  message: string;
}>;

export type CustomRuleSimulationChange = Readonly<{
  bucket: string;
  deltaAmountCents: string;
  direction: "increase" | "decrease";
}>;

export type PersistableCustomRuleSimulationSummary = Omit<
  InsertSettlementFormulaSimulationInput,
  "organizationId" | "projectId" | "owner" | "idempotencyKey"
>;

export type CustomRuleSimulationResult = Readonly<{
  recordCount: number;
  coverage: Readonly<{
    totalCount: number;
    evaluatedCount: number;
    rateBps: number;
  }>;
  uncoveredCount: number;
  zeroPayCount: number;
  reviewRoutedCount: number;
  blockedCount: number;
  largestIncreases: readonly CustomRuleSimulationChange[];
  largestDecreases: readonly CustomRuleSimulationChange[];
  totalOldCents: string | null;
  totalNewCents: string;
  totalDeltaCents: string | null;
  marginImpactCents: string | null;
  historicalVerification: Readonly<{
    status: "verified" | "unverified";
    label: "已通过历史数据验证" | "未经过历史数据验证";
  }>;
  unitSources: readonly ("current_rule_cents" | "legacy_yuan")[];
  dataSelectionHash: string;
  riskFlags: readonly CustomRuleSimulationRiskFlag[];
  warnings: readonly SettlementSimulationWarning[];
  scenarios: readonly CustomRuleSimulationScenario[];
  persistable: PersistableCustomRuleSimulationSummary;
}>;

export class CustomRuleSimulationError extends Error {
  readonly code = "CUSTOM_RULE_SIMULATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CustomRuleSimulationError";
  }
}

const DEFAULT_RUNTIME: CustomRuleSimulationRuntime = Object.freeze({
  execute: executeCompiledCustomRuleWithTrace,
  explain: buildCustomRuleExecutionExplanation,
});

export function hashCustomRuleContract(contract: BusinessRuleContract): string {
  const snapshot = snapshotOwnDataRoot(contract);
  const parsed = businessRuleContractSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError("business contract is invalid");
  }
  return sha256(canonicalJson(parsed.data));
}

export function hashCustomRuleParameters(
  parameters: Record<string, TypedRuntimeValue>,
): string {
  const snapshot = snapshotOwnDataRoot(parameters);
  const parsed = runtimeValuesSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError("rule parameters are invalid");
  }
  return sha256(canonicalJson(parsed.data));
}

export function simulateCustomSettlementRule(
  unsafeInput: CustomRuleSimulationInput,
  runtime: CustomRuleSimulationRuntime = DEFAULT_RUNTIME,
): CustomRuleSimulationResult {
  if (
    !runtime ||
    typeof runtime.execute !== "function" ||
    typeof runtime.explain !== "function"
  ) {
    throw new CustomRuleSimulationError("simulation runtime is invalid");
  }
  const snapshot = snapshotOwnDataRoot(unsafeInput);
  const parsed = simulationInputSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError("simulation input is invalid");
  }
  const input = parsed.data;
  validateSimulationState(input);

  const sortedRecords = [...input.records].sort((left, right) =>
    left.recordId.localeCompare(right.recordId),
  );
  const dataSelectionHash = hashDataSelection(input, sortedRecords);
  const verified = input.readiness.historicalVerification === "verified";
  const unitSources = new Set<"current_rule_cents" | "legacy_yuan">();
  const changes: Array<{
    bucket: string;
    delta: bigint;
  }> = [];
  let oldTotal = BigInt(0);
  let newTotal = BigInt(0);
  let evaluatedCount = 0;
  let uncoveredCount = 0;
  let zeroPayCount = 0;
  let reviewRoutedCount = 0;
  let blockedCount = 0;
  let redEvidencePriced = false;

  for (const [index, record] of sortedRecords.entries()) {
    const missingDecision = applyMissingPolicies(
      record.variables,
      record.missingInputs,
    );
    if (record.missingInputs.length > 0) uncoveredCount += 1;
    if (missingDecision.outcome === "review_routed") {
      reviewRoutedCount += 1;
      continue;
    }
    if (missingDecision.outcome === "blocked") {
      blockedCount += 1;
      continue;
    }

    const execution = executeAndExplain(
      input.compiledAst,
      missingDecision.variables,
      input.parameters,
      runtime,
    );
    const nextAmount = BigInt(execution.result.componentsCents.final);
    newTotal = checkedAdd(newTotal, nextAmount);
    evaluatedCount += 1;
    if (nextAmount === BigInt(0)) zeroPayCount += 1;
    if (
      nextAmount > BigInt(0) &&
      missingDecision.variables.evidence_level?.type === "string" &&
      missingDecision.variables.evidence_level.value === "red"
    ) {
      redEvidencePriced = true;
    }

    if (verified) {
      if (record.currentRuleResult === null) {
        throw new CustomRuleSimulationError(
          "verified records require a current-rule result",
        );
      }
      const previousAmount = parseCurrentRuleResult(record.currentRuleResult);
      unitSources.add(record.currentRuleResult.unitSource);
      oldTotal = checkedAdd(oldTotal, previousAmount);
      const delta = nextAmount - previousAmount;
      if (delta !== BigInt(0)) {
        changes.push({
          bucket: `authorized_ordinal:${String(index + 1).padStart(6, "0")}`,
          delta,
        });
      }
    }
  }

  const totalOldCents = verified ? serializePostgresBigintCents(oldTotal) : null;
  const totalNewCents = serializePostgresBigintCents(newTotal);
  const delta = verified ? newTotal - oldTotal : null;
  const totalDeltaCents =
    delta === null ? null : serializePostgresBigintCents(delta);
  const marginImpact =
    delta === null
      ? null
      : input.contract.scope === "payable"
        ? -delta
        : input.contract.scope === "receivable"
          ? delta
          : null;
  const marginImpactCents =
    marginImpact === null
      ? null
      : serializePostgresBigintCents(marginImpact);
  const percentageBps =
    delta === null ? 0 : calculatePercentageBps(delta, oldTotal);
  const largestIncreases = changes
    .filter((change) => change.delta > BigInt(0))
    .sort(
      (left, right) =>
        compareBigint(right.delta, left.delta) ||
        left.bucket.localeCompare(right.bucket),
    )
    .slice(0, MAX_CHANGE_BUCKETS)
    .map(toIncrease);
  const largestDecreases = changes
    .filter((change) => change.delta < BigInt(0))
    .sort(
      (left, right) =>
        compareBigint(left.delta, right.delta) ||
        left.bucket.localeCompare(right.bucket),
    )
    .slice(0, MAX_CHANGE_BUCKETS)
    .map(toDecrease);
  const scenarios = runSyntheticScenarios(input, runtime);
  const warnings = buildWarnings({
    verified,
    totalRecords: sortedRecords.length,
    evaluatedCount,
    blockedCount,
  });
  const riskFlags = buildRiskFlags({
    reviewRoutedCount,
    blockedCount,
    zeroPayCount,
    redEvidencePriced,
    delta,
    percentageBps,
    currentMarginCents: input.currentMarginCents ?? null,
    marginImpact,
  });
  const persistedWarnings = mergePersistedWarnings(warnings, riskFlags);
  const persistedDelta = totalDeltaCents ?? "0";
  const persistable: PersistableCustomRuleSimulationSummary = {
    formulaHash: input.formulaHash,
    ruleContractHash: input.contractHash,
    parameterHash: input.parameterHash,
    variableCatalogVersion: input.catalogVersion,
    dataSelectionHash,
    sampleSource: input.sampleSource,
    sampleSelection: {
      periodStart: input.sampleSelection.periodStart,
      periodEnd: input.sampleSelection.periodEnd,
      populationCount: input.sampleSelection.populationCount,
      sampledCount: sortedRecords.length,
      criteria: [...input.sampleSelection.criteria].sort((left, right) =>
        left.localeCompare(right),
      ),
    },
    coverage: {
      totalRecords: sortedRecords.length,
      evaluatedRecords: evaluatedCount,
      skippedRecords: sortedRecords.length - evaluatedCount,
    },
    scenarios: scenarios.map((scenario, index) => ({
      name: `scenario:${String(index + 1).padStart(6, "0")}`,
      kind:
        scenario.category === "user_example"
          ? "normal"
          : scenario.category === "missing_data_policy"
            ? "missing_data"
            : "boundary",
      result:
        scenario.outcome === "blocked"
          ? "failed"
          : scenario.outcome === "review_routed" ||
              scenario.id.includes("use_explicit_default")
            ? "warning"
            : "passed",
    })),
    historicalTotals: {
      payableAmountCents:
        input.contract.scope === "payable" ? totalOldCents : null,
      receivableAmountCents:
        input.contract.scope === "receivable" ? totalOldCents : null,
      recordCount: sortedRecords.length,
    },
    deltas: {
      payableAmountCents:
        input.contract.scope === "payable" ? persistedDelta : "0",
      receivableAmountCents:
        input.contract.scope === "receivable" ? persistedDelta : "0",
      percentageBps,
    },
    largestChanges: [...largestIncreases, ...largestDecreases].map(
      (change) => ({
        dimension: "period" as const,
        key: change.bucket,
        deltaAmountCents: change.deltaAmountCents,
        direction: change.direction,
      }),
    ),
    warnings: persistedWarnings,
  };

  return deepFreezeOwned({
    recordCount: sortedRecords.length,
    coverage: {
      totalCount: sortedRecords.length,
      evaluatedCount,
      rateBps: calculateCoverageBps(evaluatedCount, sortedRecords.length),
    },
    uncoveredCount,
    zeroPayCount,
    reviewRoutedCount,
    blockedCount,
    largestIncreases,
    largestDecreases,
    totalOldCents,
    totalNewCents,
    totalDeltaCents,
    marginImpactCents,
    historicalVerification: verified
      ? { status: "verified" as const, label: "已通过历史数据验证" as const }
      : { status: "unverified" as const, label: "未经过历史数据验证" as const },
    unitSources: [...unitSources].sort((left, right) =>
      left.localeCompare(right),
    ),
    dataSelectionHash,
    riskFlags,
    warnings,
    scenarios,
    persistable,
  });
}

function validateSimulationState(
  input: z.infer<typeof simulationInputSchema>,
): void {
  if (sha256(canonicalJson(input.compiledAst)) !== input.formulaHash) {
    throw new CustomRuleSimulationError("formula hash does not match compiled AST");
  }
  if (hashCustomRuleContract(input.contract) !== input.contractHash) {
    throw new CustomRuleSimulationError("contract hash does not match contract");
  }
  if (hashCustomRuleParameters(input.parameters) !== input.parameterHash) {
    throw new CustomRuleSimulationError("parameter hash does not match parameters");
  }
  if (
    input.catalogVersion !== input.readiness.catalogVersion ||
    !input.readiness.readyForSimulation ||
    !input.readiness.businessTimezoneConfirmed ||
    input.readiness.businessTimezone !== input.contract.businessTimezone
  ) {
    throw new CustomRuleSimulationError(
      "readiness or catalog state is stale for this contract",
    );
  }
  if (input.sampleSelection.populationCount < input.records.length) {
    throw new CustomRuleSimulationError(
      "sample population cannot be smaller than selected records",
    );
  }

  const recordIds = new Set<string>();
  for (const record of input.records) {
    if (record.projectId !== input.projectId) {
      throw new CustomRuleSimulationError("cross-project sample record rejected");
    }
    if (recordIds.has(record.recordId)) {
      throw new CustomRuleSimulationError("duplicate sample record id rejected");
    }
    recordIds.add(record.recordId);
    if (
      input.readiness.historicalVerification === "verified" &&
      record.currentRuleResult === null
    ) {
      throw new CustomRuleSimulationError(
        "verified history requires current-rule results",
      );
    }
  }

  assertExactCoverage(
    input.synthetic.evidenceLevels.map((scenario) => scenario.level),
    ["green", "red", "yellow"],
    "evidence levels",
  );
  assertExactCoverage(
    input.synthetic.missingDataPolicies.map(
      (scenario) => scenario.policy.action,
    ),
    ["block_batch", "route_item_to_review", "use_explicit_default"],
    "missing-data policies",
  );
  const scenarioCount =
    1 +
    input.synthetic.thresholdEdges.length +
    input.synthetic.configuredMaximums.length +
    input.synthetic.evidenceLevels.length +
    input.synthetic.missingDataPolicies.length +
    input.userExamples.length;
  if (scenarioCount > MAX_SCENARIOS) {
    throw new CustomRuleSimulationError("scenario limit exceeded");
  }
}

function assertExactCoverage(
  actual: string[],
  expected: string[],
  label: string,
): void {
  const ordered = [...actual].sort((left, right) => left.localeCompare(right));
  if (
    ordered.length !== expected.length ||
    ordered.some((value, index) => value !== expected[index])
  ) {
    throw new CustomRuleSimulationError(`${label} are incomplete or duplicated`);
  }
}

function hashDataSelection(
  input: z.infer<typeof simulationInputSchema>,
  records: z.infer<typeof authorizedRecordSchema>[],
): string {
  return sha256(
    canonicalJson({
      businessTimezone: input.contract.businessTimezone,
      catalogVersion: input.catalogVersion,
      contractHash: input.contractHash,
      formulaHash: input.formulaHash,
      parameterHash: input.parameterHash,
      readinessHash: input.readiness.readinessHash,
      sampleSelection: {
        criteria: [...input.sampleSelection.criteria].sort((left, right) =>
          left.localeCompare(right),
        ),
        periodEnd: input.sampleSelection.periodEnd,
        periodStart: input.sampleSelection.periodStart,
        populationCount: input.sampleSelection.populationCount,
        records: records.map((record) => ({
          recordId: record.recordId,
          source: record.sourceVersion.source,
          version: record.sourceVersion.version,
        })),
        source: input.sampleSource.kind,
      },
    }),
  );
}

function applyMissingPolicies(
  originalVariables: Record<string, TypedRuntimeValue>,
  missingInputs: Array<{
    variableId: string;
    policy: CustomRuleMissingDataPolicy;
  }>,
):
  | { outcome: "calculated"; variables: Record<string, TypedRuntimeValue> }
  | { outcome: "review_routed" }
  | { outcome: "blocked" } {
  if (missingInputs.some((missing) => missing.policy.action === "block_batch")) {
    return { outcome: "blocked" };
  }
  if (
    missingInputs.some(
      (missing) => missing.policy.action === "route_item_to_review",
    )
  ) {
    return { outcome: "review_routed" };
  }
  const variables = { ...originalVariables };
  for (const missing of missingInputs) {
    if (missing.policy.action === "use_explicit_default") {
      variables[missing.variableId] = missing.policy.defaultValue;
    }
  }
  return { outcome: "calculated", variables };
}

function executeAndExplain(
  ast: CompiledAstNode,
  variables: Record<string, TypedRuntimeValue>,
  parameters: Record<string, TypedRuntimeValue>,
  runtime: CustomRuleSimulationRuntime,
): z.infer<typeof executionOutputSchema> {
  let rawExecution: unknown;
  try {
    rawExecution = runtime.execute({ ast, variables, parameters });
  } catch {
    throw new CustomRuleSimulationError("deterministic engine execution failed");
  }
  const executionSnapshot = snapshotOwnDataRoot(rawExecution);
  const parsed = executionOutputSchema.safeParse(executionSnapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError("deterministic engine output is malformed");
  }
  let explanation: unknown;
  try {
    explanation = runtime.explain({
      ast,
      trace: parsed.data.trace,
      result: parsed.data.result,
    });
  } catch {
    throw new CustomRuleSimulationError(
      "authoritative execution explanation failed",
    );
  }
  if (
    typeof explanation !== "string" ||
    explanation.trim().length === 0 ||
    explanation.length > 100_000
  ) {
    throw new CustomRuleSimulationError(
      "authoritative execution explanation is malformed",
    );
  }
  return parsed.data;
}

function runSyntheticScenarios(
  input: z.infer<typeof simulationInputSchema>,
  runtime: CustomRuleSimulationRuntime,
): CustomRuleSimulationScenario[] {
  const work: Array<{
    id: string;
    category: CustomRuleSimulationScenario["category"];
    variables: Record<string, TypedRuntimeValue>;
    missing?: {
      variableId: string;
      policy: CustomRuleMissingDataPolicy;
    };
  }> = [
    {
      id: "synthetic:zero",
      category: "zero",
      variables: input.synthetic.zero.variables,
    },
    ...[...input.synthetic.thresholdEdges]
      .sort(
        (left, right) =>
          left.thresholdId.localeCompare(right.thresholdId) ||
          left.edge.localeCompare(right.edge),
      )
      .map((scenario) => ({
        id: `threshold:${scenario.thresholdId}:${scenario.edge}`,
        category: "threshold_edge" as const,
        variables: scenario.variables,
      })),
    ...[...input.synthetic.configuredMaximums]
      .sort((left, right) => left.maximumId.localeCompare(right.maximumId))
      .map((scenario) => ({
        id: `maximum:${scenario.maximumId}`,
        category: "configured_maximum" as const,
        variables: scenario.variables,
      })),
    ...[...input.synthetic.evidenceLevels]
      .sort((left, right) => left.level.localeCompare(right.level))
      .map((scenario) => ({
        id: `evidence:${scenario.level}`,
        category: "evidence_level" as const,
        variables: scenario.variables,
      })),
    ...[...input.synthetic.missingDataPolicies]
      .sort(
        (left, right) =>
          left.policy.action.localeCompare(right.policy.action) ||
          left.variableId.localeCompare(right.variableId),
      )
      .map((scenario) => ({
        id: `missing:${scenario.policy.action}:${scenario.variableId}`,
        category: "missing_data_policy" as const,
        variables: scenario.variables,
        missing: {
          variableId: scenario.variableId,
          policy: scenario.policy,
        },
      })),
    ...[...input.userExamples]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((scenario) => ({
        id: `user:${scenario.id}`,
        category: "user_example" as const,
        variables: scenario.variables,
      })),
  ];
  const ids = new Set<string>();
  const scenarios: CustomRuleSimulationScenario[] = [];
  for (const scenario of work) {
    if (ids.has(scenario.id)) {
      throw new CustomRuleSimulationError("duplicate scenario id rejected");
    }
    ids.add(scenario.id);
    const decision = scenario.missing
      ? applyMissingPolicies(scenario.variables, [scenario.missing])
      : { outcome: "calculated" as const, variables: scenario.variables };
    if (decision.outcome === "review_routed") {
      scenarios.push({ ...scenarioIdentity(scenario), outcome: "review_routed", amountCents: null });
      continue;
    }
    if (decision.outcome === "blocked") {
      scenarios.push({ ...scenarioIdentity(scenario), outcome: "blocked", amountCents: null });
      continue;
    }
    const execution = executeAndExplain(
      input.compiledAst,
      decision.variables,
      input.parameters,
      runtime,
    );
    scenarios.push({
      ...scenarioIdentity(scenario),
      outcome: "calculated",
      amountCents: serializePostgresBigintCents(
        execution.result.componentsCents.final,
      ),
    });
  }
  return scenarios;
}

function scenarioIdentity(scenario: {
  id: string;
  category: CustomRuleSimulationScenario["category"];
}): Pick<CustomRuleSimulationScenario, "id" | "category"> {
  return { id: scenario.id, category: scenario.category };
}

function parseCurrentRuleResult(
  result:
    | { unitSource: "current_rule_cents"; amountCents: string }
    | { unitSource: "legacy_yuan"; amountYuan: number },
): bigint {
  if (result.unitSource === "current_rule_cents") {
    return parsePostgresBigintCents(result.amountCents);
  }
  return BigInt(yuanToCentsStrict(result.amountYuan));
}

function checkedAdd(left: bigint, right: bigint): bigint {
  try {
    return parsePostgresBigintCents(left + right);
  } catch {
    throw new CustomRuleSimulationError(
      "aggregate cents exceed the persisted bigint range",
    );
  }
}

function calculateCoverageBps(evaluated: number, total: number): number {
  if (total === 0) return 0;
  return Number((BigInt(evaluated) * BigInt(10_000)) / BigInt(total));
}

function calculatePercentageBps(delta: bigint, oldTotal: bigint): number {
  if (oldTotal === BigInt(0)) return 0;
  const raw = (delta * BigInt(10_000)) / absBigint(oldTotal);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new CustomRuleSimulationError("percentage delta exceeds safe range");
  }
  return value;
}

function toIncrease(change: {
  bucket: string;
  delta: bigint;
}): CustomRuleSimulationChange {
  return {
    bucket: change.bucket,
    deltaAmountCents: serializePostgresBigintCents(change.delta),
    direction: "increase",
  };
}

function toDecrease(change: {
  bucket: string;
  delta: bigint;
}): CustomRuleSimulationChange {
  return {
    bucket: change.bucket,
    deltaAmountCents: serializePostgresBigintCents(change.delta),
    direction: "decrease",
  };
}

function buildWarnings(input: {
  verified: boolean;
  totalRecords: number;
  evaluatedCount: number;
  blockedCount: number;
}): SettlementSimulationWarning[] {
  const warnings: SettlementSimulationWarning[] = [];
  if (!input.verified) {
    warnings.push({
      code: "CUSTOM_RULE_NO_HISTORICAL_COMPARISON",
      severity: "warning",
      message: "项目暂无可比较历史，结果未经过历史数据验证。",
    });
  }
  if (input.evaluatedCount < input.totalRecords) {
    warnings.push({
      code: "CUSTOM_RULE_INCOMPLETE_COVERAGE",
      severity: "warning",
      message: "部分授权样本未进入新旧金额比较。",
    });
  }
  if (input.blockedCount > 0) {
    warnings.push({
      code: "CUSTOM_RULE_BLOCKED_RECORDS",
      severity: "block",
      message: "部分样本触发阻断策略。",
    });
  }
  return warnings.sort((left, right) => left.code.localeCompare(right.code));
}

function buildRiskFlags(input: {
  reviewRoutedCount: number;
  blockedCount: number;
  zeroPayCount: number;
  redEvidencePriced: boolean;
  delta: bigint | null;
  percentageBps: number;
  currentMarginCents: string | null;
  marginImpact: bigint | null;
}): CustomRuleSimulationRiskFlag[] {
  const flags: CustomRuleSimulationRiskFlag[] = [];
  if (input.blockedCount > 0) {
    flags.push({
      code: "CUSTOM_RULE_BLOCKED_RECORDS",
      severity: "block",
      message: "存在触发整批阻断策略的样本。",
    });
  }
  if (input.percentageBps > 5_000 && input.delta !== null && input.delta > BigInt(0)) {
    flags.push({
      code: "CUSTOM_RULE_ABNORMAL_INCREASE",
      severity: "warning",
      message: "新规则在可比样本中的金额增幅超过百分之五十。",
    });
  }
  if (input.redEvidencePriced) {
    flags.push({
      code: "CUSTOM_RULE_RED_EVIDENCE_PRICED",
      severity: "warning",
      message: "红色凭证样本产生了非零结算金额。",
    });
  }
  if (input.reviewRoutedCount > 0) {
    flags.push({
      code: "CUSTOM_RULE_REVIEW_ROUTED_RECORDS",
      severity: "warning",
      message: "存在转人工复核且未计入比较总额的样本。",
    });
  }
  if (input.zeroPayCount > 0) {
    flags.push({
      code: "CUSTOM_RULE_ZERO_PAY_RECORDS",
      severity: "warning",
      message: "新规则产生了零应付样本。",
    });
  }
  if (input.currentMarginCents !== null && input.marginImpact !== null) {
    const projectedMargin = checkedAdd(
      parsePostgresBigintCents(input.currentMarginCents),
      input.marginImpact,
    );
    if (projectedMargin < BigInt(0)) {
      flags.push({
        code: "CUSTOM_RULE_NEGATIVE_MARGIN",
        severity: "block",
        message: "规则变化后的汇总毛利为负。",
      });
    }
  }
  return flags.sort((left, right) => left.code.localeCompare(right.code));
}

function mergePersistedWarnings(
  warnings: SettlementSimulationWarning[],
  riskFlags: CustomRuleSimulationRiskFlag[],
): SettlementSimulationWarning[] {
  const byCode = new Map<string, SettlementSimulationWarning>();
  for (const item of [...warnings, ...riskFlags]) {
    const existing = byCode.get(item.code);
    if (!existing || severityRank(item.severity) > severityRank(existing.severity)) {
      byCode.set(item.code, { ...item });
    }
  }
  return [...byCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
}

function severityRank(severity: "info" | "warning" | "block"): number {
  return severity === "block" ? 2 : severity === "warning" ? 1 : 0;
}

function compareBigint(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function absBigint(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

function snapshotOwnDataRoot(value: unknown): unknown {
  const budget = { nodes: 0, stringCharacters: 0 };
  try {
    return snapshotOwnData(value, budget, 0);
  } catch (error) {
    if (error instanceof CustomRuleSimulationError) throw error;
    throw new CustomRuleSimulationError("simulation data is not inert own data");
  }
}

function snapshotOwnData(
  value: unknown,
  budget: { nodes: number; stringCharacters: number },
  depth: number,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    throw new CustomRuleSimulationError("simulation snapshot budget exceeded");
  }
  if (typeof value === "string") {
    budget.stringCharacters += value.length;
    if (budget.stringCharacters > MAX_SNAPSHOT_STRING_CHARACTERS) {
      throw new CustomRuleSimulationError("simulation string budget exceeded");
    }
    return value;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CustomRuleSimulationError("non-finite values are forbidden");
    }
    return value;
  }
  if (typeof value !== "object" || nodeTypes.isProxy(value)) {
    throw new CustomRuleSimulationError("only inert data values are accepted");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CustomRuleSimulationError("symbol properties are forbidden");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor)) {
        throw new CustomRuleSimulationError(
          "sparse or accessor arrays are forbidden",
        );
      }
      output.push(snapshotOwnData(descriptor.value, budget, depth + 1));
    }
    const extras = Object.keys(descriptors).filter(
      (key) => key !== "length" && !/^\d+$/u.test(key),
    );
    if (extras.length > 0) {
      throw new CustomRuleSimulationError("array properties are forbidden");
    }
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CustomRuleSimulationError("class instances are forbidden");
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new CustomRuleSimulationError("unsafe property name rejected");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new CustomRuleSimulationError(
        "accessors and hidden properties are forbidden",
      );
    }
    output[key] = snapshotOwnData(descriptor.value, budget, depth + 1);
  }
  return output;
}

function deepFreezeOwned<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreezeOwned(descriptor.value);
  }
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isValidBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
