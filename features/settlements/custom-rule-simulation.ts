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
  SettlementSimulationGroupPopulation,
  SettlementAiGeneratedTestCase,
  SettlementSimulationPersistedFinding,
  SettlementSimulationWarning,
} from "./custom-rule-repository";
import {
  parsePostgresBigintCents,
  serializePostgresBigintCents,
  yuanToCentsStrict,
  type CompiledAstNode,
  type CustomRuleMissingDataPolicy,
  type RuntimeValueType,
  type TypedRuntimeValue,
} from "./custom-rule-types";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_RECORDS = 500;
const MAX_GROUP_POPULATION_IDS = 10_000;
const MAX_SCENARIOS = 200;
const MAX_CHANGE_BUCKETS = 10;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 200_000;
const MAX_SNAPSHOT_STRING_CHARACTERS = 2_000_000;

export const CUSTOM_RULE_SIMULATION_CRITERIA_CODES = [
  "approved_reports",
  "period_overlap",
  "complete_evidence",
  "project_scope",
] as const;
export type CustomRuleSimulationCriteriaCode =
  (typeof CUSTOM_RULE_SIMULATION_CRITERIA_CODES)[number];

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
const nonnegativeCanonicalBigintSchema = canonicalBigintSchema.refine(
  (value) => !value.startsWith("-"),
  { message: "must be a nonnegative canonical Postgres bigint decimal string" },
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
    amountCents: nonnegativeCanonicalBigintSchema,
  }),
  z.strictObject({
    unitSource: z.literal("legacy_yuan"),
    amountYuan: z.number().finite().nonnegative(),
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
const selectionCriteriaSchema = z.enum(CUSTOM_RULE_SIMULATION_CRITERIA_CODES);
const sampleSelectionGroupPopulationSchema = z.strictObject({
  assignedProjectStreamerIds: z
    .array(z.string().uuid())
    .max(MAX_GROUP_POPULATION_IDS),
  unassignedProjectStreamerIds: z
    .array(z.string().uuid())
    .max(MAX_GROUP_POPULATION_IDS),
  groupSnapshotHash: hashSchema,
});
const sampleSelectionSchema = z
  .strictObject({
    periodStart: businessDateSchema,
    periodEnd: businessDateSchema,
    populationCount: nonnegativeSafeIntegerSchema,
    criteria: z.array(selectionCriteriaSchema).min(1).max(4),
    groupPopulation: sampleSelectionGroupPopulationSchema.optional(),
  })
  .superRefine((selection, context) => {
    if (selection.periodStart > selection.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "sample period start must not be after period end",
      });
    }
    if (new Set(selection.criteria).size !== selection.criteria.length) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "selection criteria codes must be unique",
      });
    }
  });
const userExampleSchema = z.strictObject({
  id: canonicalTextSchema(120),
  inputs: runtimeValuesSchema,
  expectedResult: typedRuntimeValueSchema.refine(
    (value) => value.type === "money_cents",
    { message: "user examples must expect money" },
  ),
});
const aiTestCaseSchema = z.strictObject({
  name: canonicalTextSchema(200),
  inputs: runtimeValuesSchema,
  expectedResult: typedRuntimeValueSchema.refine(
    (value) => value.type === "money_cents",
    { message: "AI test cases must expect money" },
  ),
});
const evidenceProvenanceSchema = z.strictObject({
  organizationId: canonicalTextSchema(500),
  projectId: canonicalTextSchema(500),
  actorId: canonicalTextSchema(500),
  selectionToken: canonicalTextSchema(500).regex(/^[A-Za-z0-9._:-]+$/u),
  evidenceHash: hashSchema,
  optionalPolicyHash: hashSchema,
  immutableSourceVersions: z.array(immutableSourceVersionSchema).max(MAX_RECORDS),
});
const simulationEvidenceSchema = z.strictObject({
  provenance: evidenceProvenanceSchema,
  sampleSource: sampleSourceSchema,
  sampleSelection: sampleSelectionSchema,
  records: z.array(authorizedRecordSchema).max(MAX_RECORDS),
  userExamples: z.array(userExampleSchema).max(MAX_SCENARIOS),
  currentMarginCents: canonicalBigintSchema.nullable().optional(),
});
const simulationInputSchema = z.strictObject({
  organizationId: canonicalTextSchema(500),
  actorId: canonicalTextSchema(500),
  projectId: canonicalTextSchema(500),
  contract: businessRuleContractSchema,
  compiledAst: compiledAstNodeSchema,
  parameters: runtimeValuesSchema,
  formulaHash: hashSchema,
  contractHash: hashSchema,
  parameterHash: hashSchema,
  catalogVersion: hashSchema,
  readiness: readinessSchema,
  provenance: evidenceProvenanceSchema,
  sampleSource: sampleSourceSchema,
  sampleSelection: sampleSelectionSchema,
  records: z.array(authorizedRecordSchema).max(MAX_RECORDS),
  userExamples: z.array(userExampleSchema).max(MAX_SCENARIOS),
  aiTestCases: z.array(aiTestCaseSchema).min(1).max(MAX_SCENARIOS),
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
  )
  .refine(
    (result) =>
      !Object.prototype.hasOwnProperty.call(result.componentsCents, "final") ||
      result.componentsCents.final >= 0,
    { message: "engine final settlement amount must be nonnegative" },
  );
const executionOutputSchema = z.strictObject({
  result: moneyResultSchema,
  trace: z.array(executionTraceSchema).max(100_000),
});

export type CustomRuleSimulationInput = {
  organizationId: string;
  actorId: string;
  projectId: string;
  contract: BusinessRuleContract;
  compiledAst: CompiledAstNode;
  parameters: Record<string, TypedRuntimeValue>;
  formulaHash: string;
  contractHash: string;
  parameterHash: string;
  catalogVersion: string;
  readiness: CustomRuleDataReadinessReport;
  provenance: {
    organizationId: string;
    projectId: string;
    actorId: string;
    selectionToken: string;
    evidenceHash: string;
    optionalPolicyHash: string;
    immutableSourceVersions: Array<{
      kind: "immutable";
      source: string;
      version: string;
    }>;
  };
  sampleSource: { kind: "historical_settlements" | "approved_operations" | "synthetic_scenarios" };
  sampleSelection: {
    periodStart: string;
    periodEnd: string;
    populationCount: number;
    criteria: CustomRuleSimulationCriteriaCode[];
    groupPopulation?: SettlementSimulationGroupPopulation;
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
  userExamples: Array<{
    id: string;
    inputs: Record<string, TypedRuntimeValue>;
    expectedResult: TypedRuntimeValue;
  }>;
  aiTestCases: SettlementAiGeneratedTestCase[];
  currentMarginCents?: string | null;
};

export type AuthorizedCustomRuleSimulationEvidence = Pick<
  CustomRuleSimulationInput,
  | "sampleSource"
  | "sampleSelection"
  | "records"
  | "userExamples"
  | "currentMarginCents"
> & { provenance: CustomRuleSimulationInput["provenance"] };

export type CustomRuleSimulationEvidence =
  AuthorizedCustomRuleSimulationEvidence;

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
    | "contract_example"
    | "ai_test_case"
    | "user_example";
  outcome: "calculated" | "review_routed" | "blocked";
  amountCents: string | null;
  expectedAmountCents: string | null;
  passed: boolean;
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

export function freezeAuthorizedCustomRuleSimulationEvidence(
  unsafeEvidence: unknown,
): AuthorizedCustomRuleSimulationEvidence {
  const snapshot = snapshotOwnDataRoot(unsafeEvidence);
  const parsed = simulationEvidenceSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError(
      "authorized simulation evidence is invalid",
    );
  }
  validateEvidenceSourceVersions(parsed.data.provenance, parsed.data.records);
  validateEvidenceHash(parsed.data);
  return deepFreezeOwned(parsed.data);
}

export function calculateCustomRuleEvidenceHash(
  unsafeEvidence: AuthorizedCustomRuleSimulationEvidence,
): string {
  const snapshot = snapshotOwnDataRoot(unsafeEvidence);
  const parsed = simulationEvidenceSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError(
      "authorized simulation evidence is invalid",
    );
  }
  validateEvidenceSourceVersions(parsed.data.provenance, parsed.data.records);
  return hashEvidence(parsed.data);
}

export function calculateCustomRuleDataSelectionHash(
  unsafeInput: CustomRuleSimulationInput,
): string {
  const snapshot = snapshotOwnDataRoot(unsafeInput);
  const parsed = simulationInputSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new CustomRuleSimulationError("simulation input is invalid");
  }
  const records = [...parsed.data.records].sort((left, right) =>
    left.recordId.localeCompare(right.recordId),
  );
  validateEvidenceSourceVersions(parsed.data.provenance, records);
  validateEvidenceHash(parsed.data);
  return hashDataSelection(parsed.data);
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
  const dataSelectionHash = hashDataSelection(input);
  const batchBlocked = sortedRecords.some((record) =>
    record.missingInputs.some(
      (missing) => missing.policy.action === "block_batch",
    ),
  );
  const verified =
    !batchBlocked &&
    input.sampleSource.kind !== "synthetic_scenarios" &&
    input.readiness.historicalVerification === "verified" &&
    sortedRecords.length > 0 &&
    input.sampleSelection.populationCount > 0;
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

  if (batchBlocked) {
    uncoveredCount = sortedRecords.filter(
      (record) => record.missingInputs.length > 0,
    ).length;
    blockedCount = sortedRecords.length;
  }

  if (!batchBlocked) {
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
    delta === null ? null : calculatePercentageBps(delta, oldTotal);
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
  const scenarioRun = runSyntheticScenarios(input, runtime);
  const scenarios = scenarioRun.scenarios;
  const assertionMismatchCount = scenarios.filter(
    (scenario) => !scenario.passed,
  ).length;
  const warnings = buildWarnings({
    verified,
    totalRecords: sortedRecords.length,
    evaluatedCount,
    blockedCount,
  });
  const riskFlags = [
    ...buildRiskFlags({
      reviewRoutedCount,
      blockedCount,
      zeroPayCount,
      redEvidencePriced,
      delta,
      percentageBps,
      currentMarginCents: input.currentMarginCents ?? null,
      marginImpact,
      assertionMismatchCount,
    }),
    ...scenarioRun.riskFlags,
  ].sort((left, right) => left.code.localeCompare(right.code));
  if (
    input.contract.scope !== "payable" &&
    input.contract.scope !== "receivable"
  ) {
    throw new CustomRuleSimulationError(
      "Phase 1 simulation summaries require payable or receivable scope",
    );
  }
  const persistedWarnings = mergePersistedFindings(warnings, riskFlags);
  const payableScope = input.contract.scope === "payable";
  const groupPopulation = normalizeGroupPopulation(
    input.sampleSelection.groupPopulation,
  );
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
      criteria: [
        ...[...input.sampleSelection.criteria].sort((left, right) =>
          left.localeCompare(right),
        ),
        `selection_token_sha256:${sha256(input.provenance.selectionToken)}`,
      ],
      ...(groupPopulation ? { groupPopulation } : {}),
    },
    coverage: {
      summarySchemaVersion: 2,
      totalRecords: sortedRecords.length,
      evaluatedRecords: evaluatedCount,
      skippedRecords: sortedRecords.length - evaluatedCount,
      uncoveredRecords: uncoveredCount,
      zeroAmountRecords: zeroPayCount,
      reviewRoutedRecords: reviewRoutedCount,
      blockedRecords: blockedCount,
    },
    scenarios: scenarios.map((scenario) => ({ ...scenario })),
    historicalTotals: {
      oldPayableAmountCents: payableScope ? totalOldCents : null,
      oldReceivableAmountCents: payableScope ? null : totalOldCents,
      newPayableAmountCents: payableScope ? totalNewCents : null,
      newReceivableAmountCents: payableScope ? null : totalNewCents,
      recordCount: sortedRecords.length,
      verificationStatus: verified ? "verified" : "unverified",
    },
    deltas: {
      payableAmountCents: payableScope ? totalDeltaCents : null,
      receivableAmountCents: payableScope ? null : totalDeltaCents,
      percentageBps,
      marginImpactCents,
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
  if (sha256(canonicalCompiledAstJson(input.compiledAst)) !== input.formulaHash) {
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
  if (
    input.provenance.organizationId !== input.organizationId ||
    input.provenance.projectId !== input.projectId ||
    input.provenance.actorId !== input.actorId
  ) {
    throw new CustomRuleSimulationError(
      "authorized evidence provenance scope mismatch",
    );
  }
  validateEvidenceSourceVersions(input.provenance, input.records);
  validateEvidenceHash(input);

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
      input.sampleSource.kind !== "synthetic_scenarios" &&
      input.readiness.historicalVerification === "verified" &&
      record.currentRuleResult === null
    ) {
      throw new CustomRuleSimulationError(
        "verified history requires current-rule results",
      );
    }
  }

  if (
    input.contract.examples.length +
      input.aiTestCases.length +
      input.userExamples.length >
    MAX_SCENARIOS
  ) {
    throw new CustomRuleSimulationError("scenario limit exceeded");
  }
}

function hashDataSelection(
  input: z.infer<typeof simulationInputSchema>,
): string {
  return sha256(
    canonicalJson({
      actorId: input.actorId,
      businessTimezone: input.contract.businessTimezone,
      catalogVersion: input.catalogVersion,
      contractHash: input.contractHash,
      formulaHash: input.formulaHash,
      evidenceHash: input.provenance.evidenceHash,
      organizationId: input.organizationId,
      parameterHash: input.parameterHash,
      projectId: input.projectId,
      readinessHash: input.readiness.readinessHash,
      sampleSelection: {
        criteria: [...input.sampleSelection.criteria].sort((left, right) =>
          left.localeCompare(right),
        ),
        groupPopulation: normalizeGroupPopulation(
          input.sampleSelection.groupPopulation,
        ),
        periodEnd: input.sampleSelection.periodEnd,
        periodStart: input.sampleSelection.periodStart,
        populationCount: input.sampleSelection.populationCount,
        selectionTokenHash: sha256(input.provenance.selectionToken),
        source: input.sampleSource.kind,
      },
    }),
  );
}

function normalizeGroupPopulation(
  groupPopulation: SettlementSimulationGroupPopulation | undefined,
): SettlementSimulationGroupPopulation | undefined {
  if (groupPopulation === undefined) return undefined;
  return {
    assignedProjectStreamerIds: [
      ...groupPopulation.assignedProjectStreamerIds,
    ].sort(),
    unassignedProjectStreamerIds: [
      ...groupPopulation.unassignedProjectStreamerIds,
    ].sort(),
    groupSnapshotHash: groupPopulation.groupSnapshotHash,
  };
}

function hashEvidence(
  evidence: z.infer<typeof simulationEvidenceSchema>,
): string {
  return sha256(
    canonicalJson({
      provenance: {
        actorId: evidence.provenance.actorId,
        organizationId: evidence.provenance.organizationId,
        optionalPolicyHash: evidence.provenance.optionalPolicyHash,
        projectId: evidence.provenance.projectId,
        selectionToken: evidence.provenance.selectionToken,
        immutableSourceVersions: [
          ...evidence.provenance.immutableSourceVersions,
        ].sort(
          (left, right) =>
            left.source.localeCompare(right.source) ||
            left.version.localeCompare(right.version),
        ),
      },
      sampleSource: evidence.sampleSource,
      sampleSelection: {
        ...evidence.sampleSelection,
        criteria: [...evidence.sampleSelection.criteria].sort((left, right) =>
          left.localeCompare(right),
        ),
        groupPopulation: normalizeGroupPopulation(
          evidence.sampleSelection.groupPopulation,
        ),
      },
      records: [...evidence.records].sort((left, right) =>
        left.recordId.localeCompare(right.recordId),
      ),
      userExamples: [...evidence.userExamples].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      currentMarginCents: evidence.currentMarginCents ?? null,
    }),
  );
}

function validateEvidenceHash(
  evidence: z.infer<typeof simulationEvidenceSchema>,
): void {
  if (hashEvidence(evidence) !== evidence.provenance.evidenceHash) {
    throw new CustomRuleSimulationError(
      "authorized evidence hash mismatch",
    );
  }
}

function validateEvidenceSourceVersions(
  provenance: z.infer<typeof evidenceProvenanceSchema>,
  records: z.infer<typeof authorizedRecordSchema>[],
): void {
  const declared = [...provenance.immutableSourceVersions].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.version.localeCompare(right.version),
  );
  const declaredKeys = declared.map(
    (version) => `${version.source}\u0000${version.version}`,
  );
  if (new Set(declaredKeys).size !== declaredKeys.length) {
    throw new CustomRuleSimulationError(
      "immutable source provenance contains duplicates",
    );
  }
  const actualByKey = new Map<
    string,
    z.infer<typeof immutableSourceVersionSchema>
  >();
  for (const record of records) {
    actualByKey.set(
      `${record.sourceVersion.source}\u0000${record.sourceVersion.version}`,
      record.sourceVersion,
    );
  }
  const actual = [...actualByKey.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.version.localeCompare(right.version),
  );
  if (canonicalJson(declared) !== canonicalJson(actual)) {
    throw new CustomRuleSimulationError(
      "immutable source provenance does not match selected records",
    );
  }
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
): {
  scenarios: CustomRuleSimulationScenario[];
  riskFlags: CustomRuleSimulationRiskFlag[];
} {
  const plan = deriveScenarioWork(input);
  const work = plan.work;
  if (work.length > MAX_SCENARIOS) {
    throw new CustomRuleSimulationError("scenario limit exceeded");
  }
  const ids = new Set<string>();
  const scenarios: CustomRuleSimulationScenario[] = [];
  const contractCoverage = new Map<string, Set<"floor" | "cap">>();
  for (const scenario of work) {
    if (ids.has(scenario.id)) {
      throw new CustomRuleSimulationError("duplicate scenario id rejected");
    }
    ids.add(scenario.id);
    const decision = scenario.missing
      ? applyMissingPolicies(scenario.variables, [scenario.missing])
      : { outcome: "calculated" as const, variables: scenario.variables };
    if (decision.outcome === "review_routed") {
      scenarios.push({
        ...scenarioIdentity(scenario),
        outcome: "review_routed",
        amountCents: null,
        expectedAmountCents: scenario.expectedAmountCents,
        passed: scenario.expectedAmountCents === null,
      });
      continue;
    }
    if (decision.outcome === "blocked") {
      scenarios.push({
        ...scenarioIdentity(scenario),
        outcome: "blocked",
        amountCents: null,
        expectedAmountCents: scenario.expectedAmountCents,
        passed: scenario.expectedAmountCents === null,
      });
      continue;
    }
    const execution = executeAndExplain(
      input.compiledAst,
      decision.variables,
      scenario.parameterOverrides
        ? { ...input.parameters, ...scenario.parameterOverrides }
        : input.parameters,
      runtime,
    );
    if (
      scenario.category === "contract_example" ||
      scenario.category === "user_example"
    ) {
      for (const trace of execution.trace) {
        if (
          trace.kind === "clamp" &&
          (trace.outcome === "floor" || trace.outcome === "cap")
        ) {
          const outcomes = contractCoverage.get(trace.path) ?? new Set();
          outcomes.add(trace.outcome);
          contractCoverage.set(trace.path, outcomes);
        }
      }
    }
    const amountCents = serializePostgresBigintCents(
      execution.result.componentsCents.final,
    );
    const clampPassed = scenario.clampExpectation
      ? execution.trace.some(
          (trace) =>
            trace.kind === "clamp" &&
            trace.path === scenario.clampExpectation?.path &&
            trace.outcome === scenario.clampExpectation.outcome &&
            trace.result === scenario.clampExpectation.result,
        )
      : true;
    scenarios.push({
      ...scenarioIdentity(scenario),
      outcome: "calculated",
      amountCents,
      expectedAmountCents: scenario.expectedAmountCents,
      passed:
        clampPassed &&
        (scenario.expectedAmountCents === null ||
          scenario.expectedAmountCents === amountCents),
    });
  }
  const hasUntestableClamp = plan.externallyCoveredClampPaths.some((path) => {
    const outcomes = contractCoverage.get(path);
    return !outcomes?.has("floor") || !outcomes.has("cap");
  });
  return {
    scenarios,
    riskFlags: hasUntestableClamp
      ? [
          {
            code: "UNTESTABLE_CLAMP_BOUNDARY",
            severity: "block",
            message:
              "Clamp floor and cap branches are not covered by deterministic contract or user scenarios.",
          },
        ]
      : [],
  };
}

type ScenarioWork = {
  id: string;
  category: CustomRuleSimulationScenario["category"];
  variables: Record<string, TypedRuntimeValue>;
  expectedAmountCents: string | null;
  parameterOverrides?: Record<string, TypedRuntimeValue>;
  clampExpectation?: {
    path: string;
    outcome: "floor" | "cap";
    result: number;
  };
  missing?: {
    variableId: string;
    policy: CustomRuleMissingDataPolicy;
  };
};

function deriveScenarioWork(
  input: z.infer<typeof simulationInputSchema>,
): {
  work: ScenarioWork[];
  externallyCoveredClampPaths: string[];
} {
  const variableTypes = collectVariableTypes(input.compiledAst);
  for (const required of input.contract.requiredInputs) {
    variableTypes.set(required.name, required.valueType);
  }
  const orderedContractExamples = [...input.contract.examples].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      canonicalJson(left).localeCompare(canonicalJson(right)),
  );
  const baseline = completeVariables(
    orderedContractExamples[0]?.inputs ?? {},
    variableTypes,
    input.contract.effectiveStartAt,
  );
  const zero = zeroVariables(
    variableTypes,
    input.contract.effectiveStartAt,
  );
  const clampPlan = deriveClampScenarioWork(
    input.compiledAst,
    baseline,
    input.parameters,
  );
  const work: ScenarioWork[] = [
    {
      id: "synthetic:zero",
      category: "zero",
      variables: zero,
      expectedAmountCents: null,
    },
    ...deriveTierScenarioWork(input.compiledAst, baseline, input.parameters),
    ...clampPlan.work,
  ];

  if (variableTypes.has("evidence_level")) {
    for (const level of ["green", "red", "yellow"] as const) {
      work.push({
        id: `derived:evidence:${level}`,
        category: "evidence_level",
        variables: {
          ...baseline,
          evidence_level: { type: "string", value: level },
        },
        expectedAmountCents: null,
      });
    }
  }

  const missingVariable = [...variableTypes.keys()]
    .filter((name) => name !== "evidence_level")
    .sort((left, right) => left.localeCompare(right))[0];
  if (missingVariable) {
    const missingType = variableTypes.get(missingVariable);
    if (!missingType) {
      throw new CustomRuleSimulationError("missing scenario type is unavailable");
    }
    const withoutMissing = { ...baseline };
    delete withoutMissing[missingVariable];
    const policies: CustomRuleMissingDataPolicy[] = [
      { action: "block_batch" },
      { action: "route_item_to_review" },
      {
        action: "use_explicit_default",
        defaultValue: defaultRuntimeValue(
          missingType,
          missingVariable,
          input.contract.effectiveStartAt,
        ),
      },
    ];
    for (const policy of policies) {
      work.push({
        id: `derived:missing:${policy.action}`,
        category: "missing_data_policy",
        variables: withoutMissing,
        expectedAmountCents: null,
        missing: { variableId: missingVariable, policy },
      });
    }
  }

  orderedContractExamples.forEach((example, index) => {
    work.push({
      id: `contract:${String(index + 1).padStart(6, "0")}`,
      category: "contract_example",
      variables: completeVariables(
        { ...baseline, ...example.inputs },
        variableTypes,
        input.contract.effectiveStartAt,
      ),
      expectedAmountCents: expectedMoneyCents(example.expectedResult),
    });
  });
  [...input.aiTestCases]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        canonicalJson(left).localeCompare(canonicalJson(right)),
    )
    .forEach((testCase, index) => {
      work.push({
        id: `ai:${String(index + 1).padStart(6, "0")}`,
        category: "ai_test_case",
        variables: completeVariables(
          { ...baseline, ...testCase.inputs },
          variableTypes,
          input.contract.effectiveStartAt,
        ),
        expectedAmountCents: expectedMoneyCents(testCase.expectedResult),
      });
    });
  [...input.userExamples]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((example) => {
      work.push({
        id: `user:${sha256(example.id).slice(0, 16)}`,
        category: "user_example",
        variables: completeVariables(
          { ...baseline, ...example.inputs },
          variableTypes,
          input.contract.effectiveStartAt,
        ),
        expectedAmountCents: expectedMoneyCents(example.expectedResult),
      });
    });
  return {
    work,
    externallyCoveredClampPaths: clampPlan.externallyCoveredPaths,
  };
}

function collectVariableTypes(ast: CompiledAstNode): Map<string, RuntimeValueType> {
  const types = new Map<string, RuntimeValueType>();
  walkCompiledAst(ast, "$", (node) => {
    if (node.kind === "identifier") {
      const existing = types.get(node.name);
      if (existing && canonicalJson(existing) !== canonicalJson(node.inferredType)) {
        throw new CustomRuleSimulationError(
          "compiled AST declares inconsistent variable types",
        );
      }
      types.set(node.name, node.inferredType);
    }
  });
  return types;
}

function deriveTierScenarioWork(
  ast: CompiledAstNode,
  baseline: Record<string, TypedRuntimeValue>,
  parameters: Record<string, TypedRuntimeValue>,
): ScenarioWork[] {
  const thresholds: Array<{
    path: string;
    variableName: string;
    variableType: RuntimeValueType;
    value: number;
  }> = [];
  walkCompiledAst(ast, "$", (node, path) => {
    if (node.kind !== "call" || node.callee !== "tiered") return;
    const variable = node.arguments[0];
    const tiers = node.arguments[1];
    if (variable?.kind !== "identifier" || tiers?.kind !== "array") {
      throw new CustomRuleSimulationError(
        "tier scenarios require a direct typed variable and compiled tiers",
      );
    }
    for (const [index, tier] of tiers.elements.entries()) {
      if (tier.kind !== "object") {
        throw new CustomRuleSimulationError("compiled tier is malformed");
      }
      const limit = tier.entries.find((entry) => entry.key === "upto")?.value;
      if (!limit) continue;
      thresholds.push({
        path: `${path}.arguments[1].elements[${index}]`,
        variableName: variable.name,
        variableType: variable.inferredType,
        value: resolveNumericNode(limit, parameters),
      });
    }
  });
  thresholds.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.value - right.value,
  );
  const result: ScenarioWork[] = [];
  thresholds.forEach((threshold, index) => {
    const values = thresholdEdgeValues(threshold.value, threshold.variableType);
    for (const edge of ["below", "at", "above"] as const) {
      result.push({
        id: `derived:tier:${String(index + 1).padStart(6, "0")}:${edge}`,
        category: "threshold_edge",
        variables: {
          ...baseline,
          [threshold.variableName]: values[edge],
        },
        expectedAmountCents: null,
      });
    }
  });
  return result;
}

function deriveClampScenarioWork(
  ast: CompiledAstNode,
  baseline: Record<string, TypedRuntimeValue>,
  parameters: Record<string, TypedRuntimeValue>,
): { work: ScenarioWork[]; externallyCoveredPaths: string[] } {
  const clamps: Array<{
    node: Extract<CompiledAstNode, { kind: "call" }>;
    path: string;
  }> = [];
  walkCompiledAst(ast, "$", (node, path) => {
    if (node.kind === "call" && node.callee === "clamp") {
      clamps.push({ node, path });
    }
  });
  clamps.sort((left, right) => left.path.localeCompare(right.path));
  const finalNode = finalComponentNode(ast);
  const work: ScenarioWork[] = [];
  const externallyCoveredPaths: string[] = [];

  clamps.forEach(({ node, path }, index) => {
    const valueNode = node.arguments[0];
    const floorNode = node.arguments[1];
    const capNode = node.arguments[2];
    const target = valueNode ? adjustableClampTarget(valueNode) : null;
    const floor = floorNode
      ? resolveStaticNumericNode(floorNode, parameters)
      : null;
    const cap = capNode ? resolveStaticNumericNode(capNode, parameters) : null;
    const floorProbe = floor === null ? null : checkedBoundaryProbe(floor, -1);
    const capProbe = cap === null ? null : checkedBoundaryProbe(cap, 1);
    if (
      !target ||
      floor === null ||
      cap === null ||
      floor > cap ||
      floorProbe === null ||
      capProbe === null
    ) {
      externallyCoveredPaths.push(path);
      return;
    }
    const floorValue = numericRuntimeValue(target.valueType, floorProbe);
    const capValue = numericRuntimeValue(target.valueType, capProbe);
    if (!floorValue || !capValue) {
      externallyCoveredPaths.push(path);
      return;
    }
    const directMoneyResult =
      node === finalNode &&
      node.inferredType.kind === "scalar" &&
      node.inferredType.scalarType === "money_cents";
    const prefix = `derived:clamp:${String(index + 1).padStart(6, "0")}`;
    work.push(
      clampBoundaryScenario({
        id: `${prefix}:floor`,
        baseline,
        target,
        targetValue: floorValue,
        path,
        outcome: "floor",
        result: floor,
        expectedAmountCents: directMoneyResult
          ? serializePostgresBigintCents(floor)
          : null,
      }),
      clampBoundaryScenario({
        id: `${prefix}:cap`,
        baseline,
        target,
        targetValue: capValue,
        path,
        outcome: "cap",
        result: cap,
        expectedAmountCents: directMoneyResult
          ? serializePostgresBigintCents(cap)
          : null,
      }),
    );
  });
  return { work, externallyCoveredPaths };
}

type AdjustableClampTarget =
  | {
      kind: "variable";
      name: string;
      valueType: RuntimeValueType;
    }
  | {
      kind: "parameter";
      name: string;
      valueType: RuntimeValueType;
    };

function adjustableClampTarget(node: CompiledAstNode): AdjustableClampTarget | null {
  if (node.kind === "identifier") {
    return { kind: "variable", name: node.name, valueType: node.inferredType };
  }
  if (node.kind === "call" && node.callee === "parameter") {
    const name = compiledParameterName(node);
    return name
      ? { kind: "parameter", name, valueType: node.inferredType }
      : null;
  }
  return null;
}

function clampBoundaryScenario(input: {
  id: string;
  baseline: Record<string, TypedRuntimeValue>;
  target: AdjustableClampTarget;
  targetValue: TypedRuntimeValue;
  path: string;
  outcome: "floor" | "cap";
  result: number;
  expectedAmountCents: string | null;
}): ScenarioWork {
  return {
    id: input.id,
    category: "configured_maximum",
    variables:
      input.target.kind === "variable"
        ? { ...input.baseline, [input.target.name]: input.targetValue }
        : input.baseline,
    parameterOverrides:
      input.target.kind === "parameter"
        ? { [input.target.name]: input.targetValue }
        : undefined,
    expectedAmountCents: input.expectedAmountCents,
    clampExpectation: {
      path: input.path,
      outcome: input.outcome,
      result: input.result,
    },
  };
}

function finalComponentNode(ast: CompiledAstNode): CompiledAstNode | null {
  if (ast.kind !== "call" || ast.callee !== "money_result") return null;
  const components = ast.arguments[0];
  if (components?.kind !== "object") return null;
  return components.entries.find((entry) => entry.key === "final")?.value ?? null;
}

function checkedBoundaryProbe(value: number, direction: -1 | 1): number | null {
  const probe = value + direction;
  return Number.isSafeInteger(probe) ? probe : null;
}

function resolveStaticNumericNode(
  node: CompiledAstNode,
  parameters: Record<string, TypedRuntimeValue>,
): number | null {
  if (node.kind === "literal" && node.inferredType.kind === "scalar") {
    switch (node.inferredType.scalarType) {
      case "money_cents":
        return "valueCents" in node ? node.valueCents : null;
      case "rate_bps":
        return "valueBps" in node ? node.valueBps : null;
      case "integer":
      case "number":
        return "value" in node &&
          typeof node.value === "number" &&
          Number.isSafeInteger(node.value)
          ? node.value
          : null;
      case "boolean":
      case "string":
      case "timestamp":
        return null;
    }
  }
  if (node.kind === "unary" && node.operator === "-") {
    const value = resolveStaticNumericNode(node.argument, parameters);
    return value === null || !Number.isSafeInteger(-value) ? null : -value;
  }
  if (node.kind === "call" && node.callee === "parameter") {
    const name = compiledParameterName(node);
    return name ? numericRuntimePrimitive(parameters[name]) : null;
  }
  return null;
}

function compiledParameterName(
  node: Extract<CompiledAstNode, { kind: "call" }>,
): string | null {
  const name = node.arguments[0];
  return name?.kind === "literal" &&
    name.inferredType.kind === "scalar" &&
    name.inferredType.scalarType === "string" &&
    "value" in name &&
    typeof name.value === "string"
    ? name.value
    : null;
}

function numericRuntimePrimitive(value: TypedRuntimeValue | undefined): number | null {
  if (!value) return null;
  switch (value.type) {
    case "money_cents":
      return value.amountCents;
    case "rate_bps":
      return value.rateBps;
    case "integer":
    case "number":
      return Number.isSafeInteger(value.value) ? value.value : null;
    case "boolean":
    case "string":
    case "timestamp":
    case "array":
    case "object":
      return null;
  }
}

function numericRuntimeValue(
  valueType: RuntimeValueType,
  value: number,
): TypedRuntimeValue | null {
  if (valueType.kind !== "scalar" || !Number.isSafeInteger(value)) return null;
  switch (valueType.scalarType) {
    case "money_cents":
      return { type: "money_cents", amountCents: value };
    case "rate_bps":
      return { type: "rate_bps", rateBps: value };
    case "integer":
      return { type: "integer", value };
    case "number":
      return { type: "number", value };
    case "boolean":
    case "string":
    case "timestamp":
      return null;
  }
}

function walkCompiledAst(
  node: CompiledAstNode,
  path: string,
  visit: (node: CompiledAstNode, path: string) => void,
): void {
  visit(node, path);
  switch (node.kind) {
    case "unary":
      walkCompiledAst(node.argument, `${path}.argument`, visit);
      return;
    case "binary":
      walkCompiledAst(node.left, `${path}.left`, visit);
      walkCompiledAst(node.right, `${path}.right`, visit);
      return;
    case "call":
      node.arguments.forEach((argument, index) =>
        walkCompiledAst(argument, `${path}.arguments[${index}]`, visit),
      );
      return;
    case "array":
      node.elements.forEach((element, index) =>
        walkCompiledAst(element, `${path}.elements[${index}]`, visit),
      );
      return;
    case "object":
      node.entries.forEach((entry, index) =>
        walkCompiledAst(entry.value, `${path}.entries[${index}].value`, visit),
      );
      return;
    case "identifier":
    case "literal":
      return;
  }
}

function resolveNumericNode(
  node: CompiledAstNode,
  parameters: Record<string, TypedRuntimeValue>,
): number {
  if (
    node.kind === "literal" &&
    "value" in node &&
    typeof node.value === "number" &&
    (node.inferredType.scalarType === "integer" ||
      node.inferredType.scalarType === "number")
  ) {
    return node.value;
  }
  if (node.kind === "unary" && node.operator === "-") {
    return -resolveNumericNode(node.argument, parameters);
  }
  if (node.kind === "call" && node.callee === "parameter") {
    const name = node.arguments[0];
    if (
      name?.kind === "literal" &&
      "value" in name &&
      typeof name.value === "string" &&
      name.inferredType.scalarType === "string"
    ) {
      const value = parameters[name.value];
      if (value?.type === "integer" || value?.type === "number") {
        return value.value;
      }
    }
  }
  throw new CustomRuleSimulationError(
    "tier threshold is not a deterministic numeric literal or parameter",
  );
}

function thresholdEdgeValues(
  threshold: number,
  valueType: RuntimeValueType,
): Record<"below" | "at" | "above", TypedRuntimeValue> {
  if (valueType.kind !== "scalar") {
    throw new CustomRuleSimulationError("tier variable must be scalar");
  }
  const below = threshold - 1;
  const above = threshold + 1;
  if (
    !Number.isSafeInteger(below) ||
    !Number.isSafeInteger(threshold) ||
    !Number.isSafeInteger(above)
  ) {
    throw new CustomRuleSimulationError(
      "tier threshold edges exceed deterministic safe integers",
    );
  }
  if (valueType.scalarType === "integer") {
    return {
      below: { type: "integer", value: below },
      at: { type: "integer", value: threshold },
      above: { type: "integer", value: above },
    };
  }
  if (valueType.scalarType === "number") {
    return {
      below: { type: "number", value: below },
      at: { type: "number", value: threshold },
      above: { type: "number", value: above },
    };
  }
  throw new CustomRuleSimulationError(
    "tier threshold variable must be integer or number",
  );
}

function completeVariables(
  source: Record<string, TypedRuntimeValue>,
  variableTypes: Map<string, RuntimeValueType>,
  timestampFallback: string,
): Record<string, TypedRuntimeValue> {
  const result = { ...source };
  for (const [name, valueType] of [...variableTypes.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!Object.hasOwn(result, name)) {
      result[name] = defaultRuntimeValue(valueType, name, timestampFallback);
    }
  }
  return result;
}

function zeroVariables(
  variableTypes: Map<string, RuntimeValueType>,
  timestampFallback: string,
): Record<string, TypedRuntimeValue> {
  const result: Record<string, TypedRuntimeValue> = {};
  for (const [name, valueType] of [...variableTypes.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    result[name] = defaultRuntimeValue(valueType, name, timestampFallback);
  }
  return result;
}

function defaultRuntimeValue(
  valueType: RuntimeValueType,
  name: string,
  timestampFallback: string,
): TypedRuntimeValue {
  if (valueType.kind === "array") return { type: "array", items: [] };
  if (valueType.kind === "object") {
    return {
      type: "object",
      fields: Object.fromEntries(
        Object.entries(valueType.fields)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([field, fieldType]) => [
            field,
            defaultRuntimeValue(fieldType, field, timestampFallback),
          ]),
      ),
    };
  }
  switch (valueType.scalarType) {
    case "money_cents":
      return { type: "money_cents", amountCents: 0 };
    case "rate_bps":
      return { type: "rate_bps", rateBps: 0 };
    case "number":
      return { type: "number", value: 0 };
    case "integer":
      return { type: "integer", value: 0 };
    case "boolean":
      return { type: "boolean", value: false };
    case "string":
      return { type: "string", value: name === "evidence_level" ? "green" : "synthetic" };
    case "timestamp":
      return { type: "timestamp", value: timestampFallback };
  }
}

function expectedMoneyCents(value: TypedRuntimeValue): string {
  if (value.type !== "money_cents") {
    throw new CustomRuleSimulationError(
      "scenario expected result must be money cents",
    );
  }
  const amountCents = serializePostgresBigintCents(value.amountCents);
  if (amountCents.startsWith("-")) {
    throw new CustomRuleSimulationError(
      "scenario expected settlement amount must be nonnegative",
    );
  }
  return amountCents;
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
  percentageBps: number | null;
  currentMarginCents: string | null;
  marginImpact: bigint | null;
  assertionMismatchCount: number;
}): CustomRuleSimulationRiskFlag[] {
  const flags: CustomRuleSimulationRiskFlag[] = [];
  if (input.assertionMismatchCount > 0) {
    flags.push({
      code: "CUSTOM_RULE_SCENARIO_EXPECTATION_MISMATCH",
      severity: "block",
      message: "One or more contract, AI, or user scenario expectations did not match deterministic execution.",
    });
  }
  if (input.blockedCount > 0) {
    flags.push({
      code: "CUSTOM_RULE_BLOCKED_RECORDS",
      severity: "block",
      message: "存在触发整批阻断策略的样本。",
    });
  }
  if (
    input.percentageBps !== null &&
    input.percentageBps > 5_000 &&
    input.delta !== null &&
    input.delta > BigInt(0)
  ) {
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

function mergePersistedFindings(
  warnings: SettlementSimulationWarning[],
  riskFlags: CustomRuleSimulationRiskFlag[],
): SettlementSimulationPersistedFinding[] {
  const bySourceAndCode = new Map<
    string,
    SettlementSimulationPersistedFinding
  >();
  for (const [kind, items] of [
    ["warning", warnings],
    ["risk", riskFlags],
  ] as const) {
    for (const item of items) {
      const key = `${kind}\u0000${item.code}`;
      const existing = bySourceAndCode.get(key);
      if (
        !existing ||
        severityRank(item.severity) > severityRank(existing.severity)
      ) {
        bySourceAndCode.set(key, { kind, ...item });
      }
    }
  }
  return [...bySourceAndCode.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.code.localeCompare(right.code),
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

function canonicalCompiledAstJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalCompiledAstJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        let child = record[key];
        if (
          key === "entries" &&
          record.kind === "object" &&
          Array.isArray(child)
        ) {
          child = [...child].sort((left, right) => {
            const leftKey = objectEntryKey(left);
            const rightKey = objectEntryKey(right);
            return leftKey.localeCompare(rightKey);
          });
        }
        return `${JSON.stringify(key)}:${canonicalCompiledAstJson(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function objectEntryKey(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const descriptor = Object.getOwnPropertyDescriptor(value, "key");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : "";
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
