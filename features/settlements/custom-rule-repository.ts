import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  businessRuleContractSchema,
  normalizedAstNodeSchema,
  typedRuntimeValueSchema,
  type BusinessRuleContract,
} from "./custom-rule-contract";
import type { NormalizedAstNode, TypedRuntimeValue } from "./custom-rule-types";

import {
  assertCoverageCounts,
  isConfirmedIanaTimezone,
  normalizeCustomRuleBusinessTimezoneSource,
  type CustomRuleBusinessTimezoneSource,
  type CustomRuleLatestSampledPeriod,
  type CustomRuleVariableCoverage,
  type ProjectVariableCoverage,
} from "./custom-rule-variable-catalog";

/** Canonical Gregorian business date, validated at runtime as YYYY-MM-DD. */
export type CustomRuleBusinessDate = string;

export type GetProjectVariableCoverageInput = {
  organizationId: string;
  projectId: string;
  periodStart?: CustomRuleBusinessDate;
  periodEnd?: CustomRuleBusinessDate;
};

export type CustomRuleReadRepository = {
  getProjectVariableCoverage(
    input: GetProjectVariableCoverageInput,
  ): Promise<ProjectVariableCoverage>;
};

export const SETTLEMENT_AI_DRAFT_STATUSES = [
  "clarifying",
  "contract_ready",
  "simulated",
  "failed",
  "superseded",
] as const;
export type SettlementAiDraftStatus =
  (typeof SETTLEMENT_AI_DRAFT_STATUSES)[number];
export type CreateSettlementAiDraftStatus = Exclude<
  SettlementAiDraftStatus,
  "simulated" | "superseded"
>;

export type SettlementAiTurnTrace = {
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
};

export type SettlementAiUnresolvedAmbiguity = {
  code: string;
  question: string;
  required: boolean;
};

export type SettlementAiResponse = {
  content: string;
  finishReason: "stop" | "length" | "content_filter" | "tool_call";
  providerRequestId: string | null;
};

export type SettlementAiFormulaDraft = {
  expression: string;
  normalizedAst: NormalizedAstNode;
};

export type SettlementAiGeneratedTestCase = {
  name: string;
  inputs: Record<string, TypedRuntimeValue>;
  expectedResult: TypedRuntimeValue;
};

export type SettlementAiSafetyFlag = {
  code: string;
  severity: "info" | "warning" | "block";
  message: string;
};

export type CreateCustomRuleDraftInput = {
  organizationId: string;
  projectId: string;
  conversationId: string;
  idempotencyKey: string;
  promptText: string;
  turnTrace: SettlementAiTurnTrace;
  businessContract: BusinessRuleContract;
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  variableCatalogVersion: string;
  aiResponse: SettlementAiResponse;
  generatedFormula: SettlementAiFormulaDraft;
  generatedExplanation: string;
  generatedTestCases: SettlementAiGeneratedTestCase[];
  model: string;
  safetyFlags: SettlementAiSafetyFlag[];
  contractHash: string;
  formulaHash: string;
  parameterHash: string;
  status: CreateSettlementAiDraftStatus;
};

export type CustomRuleDraft = Omit<
  CreateCustomRuleDraftInput,
  "status"
> & {
  id: string;
  status: SettlementAiDraftStatus;
  revisionNumber: number;
  createdBy: string;
  createdAt: string;
  supersedesDraftId: string | null;
  supersededByDraftId: string | null;
  supersededAt: string | null;
};

export type CreatedCustomRuleDraft = CustomRuleDraft & {
  duplicate: boolean;
};

export type ListCustomRuleDraftsInput = {
  organizationId: string;
  projectId: string;
  conversationId: string;
  /** Defaults to newest revision first. */
  revisionOrder?: "asc" | "desc";
  limit?: number;
};

export type GetCustomRuleDraftInput = {
  organizationId: string;
  projectId: string;
  conversationId: string;
  draftId: string;
};

export type SettlementSimulationOwner =
  | { kind: "rule_version"; id: string }
  | { kind: "ai_draft"; id: string };

export type SettlementSimulationSampleSource = {
  kind:
    | "historical_settlements"
    | "approved_operations"
    | "synthetic_scenarios";
};

export type SettlementSimulationSampleSelection = {
  periodStart: CustomRuleBusinessDate;
  periodEnd: CustomRuleBusinessDate;
  populationCount: number;
  sampledCount: number;
  criteria: string[];
};

export type SettlementSimulationCoverage = {
  totalRecords: number;
  evaluatedRecords: number;
  skippedRecords: number;
};

export type SettlementSimulationScenario = {
  name: string;
  kind: "normal" | "boundary" | "missing_data";
  result: "passed" | "warning" | "failed";
};

export type SettlementSimulationHistoricalTotals = {
  payableAmountCents: string | null;
  receivableAmountCents: string | null;
  recordCount: number;
};

export type SettlementSimulationDeltas = {
  payableAmountCents: string;
  receivableAmountCents: string;
  percentageBps: number;
};

export type SettlementSimulationLargestChange = {
  dimension: "rule_component" | "scenario" | "period";
  key: string;
  deltaAmountCents: string;
  direction: "increase" | "decrease" | "unchanged";
};

export type SettlementSimulationWarning = {
  code: string;
  severity: "info" | "warning" | "block";
  message: string;
};

export type InsertSettlementFormulaSimulationInput = {
  organizationId: string;
  projectId: string;
  owner: SettlementSimulationOwner;
  idempotencyKey: string;
  formulaHash: string;
  ruleContractHash: string;
  parameterHash: string;
  variableCatalogVersion: string;
  dataSelectionHash: string;
  sampleSource: SettlementSimulationSampleSource;
  sampleSelection: SettlementSimulationSampleSelection;
  coverage: SettlementSimulationCoverage;
  scenarios: SettlementSimulationScenario[];
  historicalTotals: SettlementSimulationHistoricalTotals;
  deltas: SettlementSimulationDeltas;
  largestChanges: SettlementSimulationLargestChange[];
  warnings: SettlementSimulationWarning[];
};

export type SettlementFormulaSimulation =
  InsertSettlementFormulaSimulationInput & {
    id: string;
    createdBy: string;
    createdAt: string;
  };

export type InsertedSettlementFormulaSimulation =
  SettlementFormulaSimulation & {
    duplicate: boolean;
  };

export type ListSettlementFormulaSimulationsInput = {
  organizationId: string;
  projectId: string;
  owner: SettlementSimulationOwner;
  limit?: number;
};

export type GetSettlementFormulaSimulationInput = {
  organizationId: string;
  projectId: string;
  simulationId: string;
  owner: SettlementSimulationOwner;
};

export type CustomRuleRepository = CustomRuleReadRepository & {
  createDraft(
    input: CreateCustomRuleDraftInput,
  ): Promise<CreatedCustomRuleDraft>;
  listDrafts(input: ListCustomRuleDraftsInput): Promise<CustomRuleDraft[]>;
  getDraft(input: GetCustomRuleDraftInput): Promise<CustomRuleDraft | null>;
  insertSimulation(
    input: InsertSettlementFormulaSimulationInput,
  ): Promise<InsertedSettlementFormulaSimulation>;
  listSimulations(
    input: ListSettlementFormulaSimulationsInput,
  ): Promise<SettlementFormulaSimulation[]>;
  getSimulation(
    input: GetSettlementFormulaSimulationInput,
  ): Promise<SettlementFormulaSimulation | null>;
};

export type ResolvedCustomRuleBusinessTimezone = {
  value: string | null;
  confirmed: boolean;
  source: CustomRuleBusinessTimezoneSource;
};

export type SupabaseCustomRuleReadRepositoryOptions = {
  maxRowsPerSource?: number;
  resolvedBusinessTimezone?: ResolvedCustomRuleBusinessTimezone;
};

export class CustomRuleCoverageInputError extends TypeError {
  readonly code = "CUSTOM_RULE_COVERAGE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CustomRuleCoverageInputError";
  }
}

export class CustomRuleCoverageQueryError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_QUERY_FAILED";

  constructor(
    readonly source: CoverageSource,
    readonly cause: unknown,
  ) {
    super(`Failed to read custom-rule coverage source: ${source}`);
    this.name = "CustomRuleCoverageQueryError";
  }
}

export class CustomRuleCoverageCountError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_COUNT_INVALID";

  constructor(readonly source: CoverageSource, message: string) {
    super(`${source}: ${message}`);
    this.name = "CustomRuleCoverageCountError";
  }
}

export class CustomRuleCoverageLimitError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED";

  constructor(readonly source: CoverageSource, readonly limit: number) {
    super(`${source}: exact row count exceeds the bounded limit of ${limit}`);
    this.name = "CustomRuleCoverageLimitError";
  }
}

export class CustomRuleCoveragePageError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_PAGE_INVALID";

  constructor(readonly source: CoverageSource, message: string) {
    super(`${source}: ${message}`);
    this.name = "CustomRuleCoveragePageError";
  }
}

export class CustomRulePersistenceInputError extends TypeError {
  readonly code = "CUSTOM_RULE_PERSISTENCE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CustomRulePersistenceInputError";
  }
}

export class CustomRulePersistenceQueryError extends Error {
  readonly code = "CUSTOM_RULE_PERSISTENCE_QUERY_FAILED";

  constructor(
    readonly operation: string,
    readonly cause: unknown,
  ) {
    super(`Failed custom-rule persistence operation: ${operation}`);
    this.name = "CustomRulePersistenceQueryError";
  }
}

export class CustomRulePersistenceDataError extends Error {
  readonly code = "CUSTOM_RULE_PERSISTENCE_DATA_INVALID";

  constructor(readonly entity: "draft" | "simulation", message: string) {
    super(`Invalid persisted custom-rule ${entity}: ${message}`);
    this.name = "CustomRulePersistenceDataError";
  }
}

type CoverageSource =
  | "live_reports"
  | "project_streamers"
  | "project_cost_items"
  | "settlement_batches"
  | "settlement_batch_items";

type LiveTaskRelation =
  | { system_started_at: string | null }
  | Array<{ system_started_at: string | null }>
  | null;

type LiveReportCoverageRow = {
  id: string;
  system_duration: number | null;
  screenshot_duration: number | null;
  settlement_duration: number | null;
  evidence_level: string | null;
  time_source: string | null;
  viewers: number | null;
  reviewed_at: string | null;
  created_at: string;
  live_tasks: LiveTaskRelation;
};

type StreamerRelation =
  | { source_type: string | null }
  | Array<{ source_type: string | null }>
  | null;

type ProjectStreamerCoverageRow = {
  id: string;
  streamer_id: string;
  hourly_rate: number | null;
  base_salary: number | null;
  cps_rate_bps: number | null;
  collaboration_id: string | null;
  joined_at: string | null;
  removed_at: string | null;
  streamers: StreamerRelation;
};

type NormalizedCostItemCoverageRow = {
  id: string;
  item_type: "gift" | "supplier_fee" | "traffic";
  live_report_id: string | null;
  created_at: string;
};

type SettlementBatchCoverageRow = {
  id: string;
  batch_type: "payable" | "receivable";
  period_start: string;
  period_end: string;
};

type SettlementBatchItemCoverageRow = {
  id: string;
  settlement_batch_id: string | null;
  streamer_id: string | null;
  live_report_id: string | null;
};

type SettlementCoverageRows = {
  batches: SettlementBatchCoverageRow[];
  items: SettlementBatchItemCoverageRow[];
};

type ResolvedCoverageQueryInput = GetProjectVariableCoverageInput & {
  periodStartInclusive?: string;
  periodEndExclusive?: string;
};

type CoverageQueryResult<Row> = {
  data: Row[] | null;
  error: unknown;
  count: number | null;
};

type CoverageKeysetSnapshot<Row> = {
  rows: Row[];
  exactCount: number;
};

const LIVE_REPORT_SELECT = [
  "id",
  "system_duration",
  "screenshot_duration",
  "settlement_duration",
  "evidence_level",
  "time_source",
  "viewers",
  "reviewed_at",
  "created_at",
  "live_tasks!inner(system_started_at)",
].join(", ");
const PROJECT_STREAMER_SELECT = [
  "id",
  "streamer_id",
  "hourly_rate",
  "base_salary",
  "cps_rate_bps",
  "collaboration_id",
  "joined_at",
  "removed_at",
  "streamers!inner(source_type)",
].join(", ");
const NORMALIZED_COST_ITEM_SELECT = [
  "id",
  "item_type",
  "live_report_id",
  "created_at",
].join(", ");
const SETTLEMENT_BATCH_SELECT = [
  "id",
  "batch_type",
  "period_start",
  "period_end",
].join(", ");
const SETTLEMENT_BATCH_ITEM_SELECT = [
  "id",
  "settlement_batch_id",
  "streamer_id",
  "live_report_id",
].join(", ");
const DEFAULT_MAX_ROWS_PER_SOURCE = 5_000;
const POSTGREST_PAGE_SIZE = 1_000;
const SETTLEMENT_BATCH_ID_CHUNK_SIZE = 100;
const DEFAULT_TIMEZONE: ResolvedCustomRuleBusinessTimezone = {
  value: "Asia/Shanghai",
  confirmed: true,
  source: "contract_default",
};
const ALLOWED_INPUT_KEYS = new Set([
  "organizationId",
  "projectId",
  "periodStart",
  "periodEnd",
]);
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const POSTGRES_BIGINT_MIN = BigInt("-9223372036854775808");
const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
// SQL remains authoritative at pg_column_size 256/64 KiB. These serialized
// input ceilings reserve 16 KiB total and 4 KiB per root for JSONB container
// metadata across the 300-node maximum; the byte measures are not equivalent.
const JSON_INPUT_CONSERVATIVE_MAX_TOTAL_BYTES = 240 * 1_024;
const JSON_INPUT_CONSERVATIVE_MAX_SUBCONTAINER_BYTES = 60 * 1_024;
const JSON_BUDGET_MAX_STRING_BYTES = 16_384;
const JSON_BUDGET_MAX_KEY_BYTES = 256;
const JSON_BUDGET_MAX_CONTAINER_ITEMS = 200;
const JSON_BUDGET_MAX_NODES = 300;
const JSON_BUDGET_MAX_DEPTH = 20;
const UTF8_ENCODER = new TextEncoder();
const FORBIDDEN_DRAFT_JSON_KEYS = new Set([
  "importpayload",
  "internalmargin",
  "parsedpayload",
  "payload",
  "rawpayload",
  "rawrows",
  "reportrows",
  "rows",
  "samplerows",
  "sourcepayload",
  "streameramounts",
  "tax",
]);
const FORBIDDEN_SIMULATION_JSON_KEYS = new Set([
  "amountcents",
  "conversationid",
  "importpayload",
  "internalmargin",
  "organizationid",
  "parsedpayload",
  "payload",
  "projectid",
  "rawpayload",
  "rawrows",
  "reportid",
  "reportrows",
  "rows",
  "samplerows",
  "sourcepayload",
  "streameramounts",
  "streamerid",
  "tax",
]);
const FORBIDDEN_SIMULATION_VALUE_KEYS = new Set([
  ...FORBIDDEN_SIMULATION_JSON_KEYS,
  "amountcents",
  "streamer",
  "streameramount",
]);
const FORBIDDEN_SIMULATION_CRITERIA_PATTERN =
  /(report|project|streamer)[_-]?id|amount[_-]?cents|internal[_-]?margin|tax|payload|rows/iu;
const DRAFT_SELECT = [
  "id",
  "organization_id",
  "project_id",
  "conversation_id",
  "prompt_text",
  "turn_trace",
  "business_contract",
  "unresolved_ambiguities",
  "variable_catalog_version",
  "ai_response",
  "generated_formula",
  "generated_explanation",
  "generated_test_cases",
  "model",
  "safety_flags",
  "contract_hash",
  "formula_hash",
  "parameter_hash",
  "status",
  "revision_number",
  "idempotency_key",
  "created_by",
  "created_at",
  "supersedes_draft_id",
  "superseded_by_draft_id",
  "superseded_at",
].join(", ");
const SIMULATION_SELECT = [
  "id",
  "organization_id",
  "project_id",
  "rule_version_id",
  "ai_draft_id",
  "formula_hash",
  "rule_contract_hash",
  "parameter_hash",
  "variable_catalog_version",
  "data_selection_hash",
  "sample_source",
  "sample_selection",
  "coverage",
  "scenarios",
  "historical_totals",
  "deltas",
  "largest_changes",
  "warnings",
  "idempotency_key",
  "created_by",
  "created_at",
].join(", ");

const uuidSchema = z.string().uuid();
const nonemptyTextSchema = z.string().trim().min(1);
const boundedTextSchema = nonemptyTextSchema.max(4_000);
const preservedBoundedTextSchema = z
  .string()
  .max(4_000)
  .refine((value) => value.trim().length > 0, "must contain non-whitespace text");
const hashSchema = z.string().regex(SHA256_PATTERN);
const timestampSchema = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "must be an ISO timestamp",
);
const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "must be a safe integer");
const signedSafeIntegerSchema = z
  .number()
  .int()
  .refine(Number.isSafeInteger, "must be a safe integer");
const postgresBigintDecimalSchema = z.string().refine(
  (value) => {
    if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) return false;
    try {
      const parsed = BigInt(value);
      return parsed >= POSTGRES_BIGINT_MIN && parsed <= POSTGRES_BIGINT_MAX;
    } catch {
      return false;
    }
  },
  "must be a canonical Postgres bigint decimal string",
);
const businessDateSchema = z
  .string()
  .refine(isValidBusinessDate, "must be a valid YYYY-MM-DD business date");
const turnTraceSchema = z.strictObject({
  turnId: uuidSchema,
  userMessageId: uuidSchema,
  assistantMessageId: uuidSchema,
});
const unresolvedAmbiguitySchema = z.strictObject({
  code: nonemptyTextSchema.max(120),
  question: boundedTextSchema,
  required: z.boolean(),
});
const aiResponseSchema = z.strictObject({
  content: preservedBoundedTextSchema,
  finishReason: z.enum(["stop", "length", "content_filter", "tool_call"]),
  providerRequestId: nonemptyTextSchema.max(500).nullable(),
});
const generatedFormulaSchema = z.strictObject({
  expression: boundedTextSchema.max(20_000),
  normalizedAst: normalizedAstNodeSchema,
});
const generatedTestCaseSchema = z.strictObject({
  name: nonemptyTextSchema.max(200),
  inputs: z.record(z.string().regex(IDENTIFIER_PATTERN), typedRuntimeValueSchema),
  expectedResult: typedRuntimeValueSchema,
});
const safetyFlagSchema = z.strictObject({
  code: nonemptyTextSchema.max(120),
  severity: z.enum(["info", "warning", "block"]),
  message: boundedTextSchema,
});
const createDraftInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  conversationId: uuidSchema,
  idempotencyKey: nonemptyTextSchema.max(200),
  promptText: boundedTextSchema.max(100_000),
  turnTrace: turnTraceSchema,
  businessContract: businessRuleContractSchema,
  unresolvedAmbiguities: z.array(unresolvedAmbiguitySchema).max(100),
  variableCatalogVersion: hashSchema,
  aiResponse: aiResponseSchema,
  generatedFormula: generatedFormulaSchema,
  generatedExplanation: boundedTextSchema.max(100_000),
  generatedTestCases: z.array(generatedTestCaseSchema).min(1).max(200),
  model: nonemptyTextSchema.max(200),
  safetyFlags: z.array(safetyFlagSchema).max(100),
  contractHash: hashSchema,
  formulaHash: hashSchema,
  parameterHash: hashSchema,
  status: z.enum(["clarifying", "contract_ready", "failed"]),
});
const listDraftsInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  conversationId: uuidSchema,
  revisionOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(500).default(100),
});
const getDraftInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  conversationId: uuidSchema,
  draftId: uuidSchema,
});
const simulationOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rule_version"), id: uuidSchema }),
  z.strictObject({ kind: z.literal("ai_draft"), id: uuidSchema }),
]);
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
    sampledCount: nonnegativeSafeIntegerSchema,
    criteria: z.array(nonemptyTextSchema.max(200)).max(100),
  })
  .superRefine((selection, context) => {
    if (selection.periodStart > selection.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "periodStart must not be later than periodEnd",
      });
    }
    if (selection.sampledCount > selection.populationCount) {
      context.addIssue({
        code: "custom",
        path: ["sampledCount"],
        message: "sampledCount cannot exceed populationCount",
      });
    }
  });
const simulationCoverageSchema = z
  .strictObject({
    totalRecords: nonnegativeSafeIntegerSchema,
    evaluatedRecords: nonnegativeSafeIntegerSchema,
    skippedRecords: nonnegativeSafeIntegerSchema,
  })
  .superRefine((coverageValue, context) => {
    if (
      coverageValue.evaluatedRecords + coverageValue.skippedRecords !==
      coverageValue.totalRecords
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalRecords"],
        message: "evaluatedRecords plus skippedRecords must equal totalRecords",
      });
    }
  });
const simulationScenarioSchema = z.strictObject({
  name: nonemptyTextSchema.max(200),
  kind: z.enum(["normal", "boundary", "missing_data"]),
  result: z.enum(["passed", "warning", "failed"]),
});
const historicalTotalsSchema = z.strictObject({
  payableAmountCents: postgresBigintDecimalSchema.nullable(),
  receivableAmountCents: postgresBigintDecimalSchema.nullable(),
  recordCount: nonnegativeSafeIntegerSchema,
});
const simulationDeltasSchema = z.strictObject({
  payableAmountCents: postgresBigintDecimalSchema,
  receivableAmountCents: postgresBigintDecimalSchema,
  percentageBps: signedSafeIntegerSchema,
});
const largestChangeSchema = z.strictObject({
  dimension: z.enum(["rule_component", "scenario", "period"]),
  key: nonemptyTextSchema.max(200),
  deltaAmountCents: postgresBigintDecimalSchema,
  direction: z.enum(["increase", "decrease", "unchanged"]),
});
const simulationWarningSchema = z.strictObject({
  code: nonemptyTextSchema.max(120),
  severity: z.enum(["info", "warning", "block"]),
  message: boundedTextSchema,
});
const insertSimulationInputSchema = z
  .strictObject({
    organizationId: uuidSchema,
    projectId: uuidSchema,
    owner: simulationOwnerSchema,
    idempotencyKey: nonemptyTextSchema.max(200),
    formulaHash: hashSchema,
    ruleContractHash: hashSchema,
    parameterHash: hashSchema,
    variableCatalogVersion: hashSchema,
    dataSelectionHash: hashSchema,
    sampleSource: sampleSourceSchema,
    sampleSelection: sampleSelectionSchema,
    coverage: simulationCoverageSchema,
    scenarios: z.array(simulationScenarioSchema).min(1).max(200),
    historicalTotals: historicalTotalsSchema,
    deltas: simulationDeltasSchema,
    largestChanges: z.array(largestChangeSchema).max(100),
    warnings: z.array(simulationWarningSchema).max(100),
  })
  .superRefine((input, context) => {
    if (input.owner.kind === "rule_version") {
      context.addIssue({
        code: "custom",
        path: ["owner"],
        message: "rule-version simulation writes are not enabled in Phase 1",
      });
    }
  });
const listSimulationsInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  owner: simulationOwnerSchema,
  limit: z.number().int().min(1).max(500).default(100),
});
const getSimulationInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  simulationId: uuidSchema,
  owner: simulationOwnerSchema,
});

const DRAFT_ROW_SHAPE = {
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  conversation_id: uuidSchema,
  prompt_text: boundedTextSchema.max(100_000),
  turn_trace: turnTraceSchema,
  business_contract: businessRuleContractSchema,
  unresolved_ambiguities: z.array(unresolvedAmbiguitySchema).max(100),
  variable_catalog_version: hashSchema,
  ai_response: aiResponseSchema,
  generated_formula: generatedFormulaSchema,
  generated_explanation: boundedTextSchema.max(100_000),
  generated_test_cases: z.array(generatedTestCaseSchema).min(1).max(200),
  model: nonemptyTextSchema.max(200),
  safety_flags: z.array(safetyFlagSchema).max(100),
  contract_hash: hashSchema,
  formula_hash: hashSchema,
  parameter_hash: hashSchema,
  status: z.enum(SETTLEMENT_AI_DRAFT_STATUSES),
  revision_number: z.number().int().positive().refine(Number.isSafeInteger),
  idempotency_key: nonemptyTextSchema.max(200),
  created_by: uuidSchema,
  created_at: timestampSchema,
  supersedes_draft_id: uuidSchema.nullable(),
  superseded_by_draft_id: uuidSchema.nullable(),
  superseded_at: timestampSchema.nullable(),
};
const draftRowSchema = z.strictObject(DRAFT_ROW_SHAPE);
const createdDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_SHAPE,
  request_fingerprint: hashSchema,
  duplicate: z.boolean(),
});
const SIMULATION_ROW_SHAPE = {
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  rule_version_id: uuidSchema.nullable(),
  ai_draft_id: uuidSchema.nullable(),
  formula_hash: hashSchema,
  rule_contract_hash: hashSchema,
  parameter_hash: hashSchema,
  variable_catalog_version: hashSchema,
  data_selection_hash: hashSchema,
  sample_source: sampleSourceSchema,
  sample_selection: sampleSelectionSchema,
  coverage: simulationCoverageSchema,
  scenarios: z.array(simulationScenarioSchema).min(1).max(200),
  historical_totals: historicalTotalsSchema,
  deltas: simulationDeltasSchema,
  largest_changes: z.array(largestChangeSchema).max(100),
  warnings: z.array(simulationWarningSchema).max(100),
  idempotency_key: nonemptyTextSchema.max(200),
  created_by: uuidSchema,
  created_at: timestampSchema,
};
const simulationRowSchema = z
  .strictObject(SIMULATION_ROW_SHAPE)
  .superRefine(validateSimulationRowOwner);
const insertedSimulationRowSchema = z
  .strictObject({ ...SIMULATION_ROW_SHAPE, duplicate: z.boolean() })
  .superRefine(validateSimulationRowOwner);
type DraftRow = z.infer<typeof draftRowSchema>;
type CreatedDraftRow = z.infer<typeof createdDraftRowSchema>;
type SimulationRow = z.infer<typeof simulationRowSchema>;
type InsertedSimulationRow = z.infer<typeof insertedSimulationRowSchema>;

export class SupabaseCustomRuleReadRepository
  implements CustomRuleRepository
{
  private readonly maxRowsPerSource: number;
  private readonly businessTimezone: ResolvedCustomRuleBusinessTimezone;

  constructor(
    private readonly client: SupabaseClient,
    options: SupabaseCustomRuleReadRepositoryOptions = {},
  ) {
    this.maxRowsPerSource = validateMaximumRows(
      options.maxRowsPerSource ?? DEFAULT_MAX_ROWS_PER_SOURCE,
    );
    this.businessTimezone = resolveBusinessTimezone(
      options.resolvedBusinessTimezone ?? DEFAULT_TIMEZONE,
    );
  }

  async createDraft(
    unsafeInput: CreateCustomRuleDraftInput,
  ): Promise<CreatedCustomRuleDraft> {
    assertSafeDraftPayloadInput(unsafeInput);
    const input = parsePersistenceInput(
      createDraftInputSchema,
      unsafeInput,
      "draft input",
    );
    const { data, error } = await this.client.rpc(
      "create_ai_settlement_rule_draft",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_conversation_id: input.conversationId,
        p_idempotency_key: input.idempotencyKey,
        p_prompt_text: input.promptText,
        p_turn_trace: input.turnTrace,
        p_business_contract: input.businessContract,
        p_unresolved_ambiguities: input.unresolvedAmbiguities,
        p_variable_catalog_version: input.variableCatalogVersion,
        p_ai_response: input.aiResponse,
        p_generated_formula: input.generatedFormula,
        p_generated_explanation: input.generatedExplanation,
        p_generated_test_cases: input.generatedTestCases,
        p_model: input.model,
        p_safety_flags: input.safetyFlags,
        p_contract_hash: input.contractHash,
        p_formula_hash: input.formulaHash,
        p_parameter_hash: input.parameterHash,
        p_status: input.status,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("create_draft", error);
    }
    const row = parsePersistenceRow(
      createdDraftRowSchema,
      data,
      "draft",
    );
    return { ...toCustomRuleDraft(row), duplicate: row.duplicate };
  }

  async listDrafts(
    unsafeInput: ListCustomRuleDraftsInput,
  ): Promise<CustomRuleDraft[]> {
    const input = parsePersistenceInput(
      listDraftsInputSchema,
      unsafeInput,
      "draft list input",
    );
    const { data, error } = await this.client
      .from("ai_settlement_rule_drafts")
      .select(DRAFT_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("conversation_id", input.conversationId)
      .order("revision_number", {
        ascending: input.revisionOrder === "asc",
      })
      .limit(input.limit)
      .returns<unknown[]>();
    if (error) {
      throw new CustomRulePersistenceQueryError("list_drafts", error);
    }
    if (!Array.isArray(data)) {
      throw new CustomRulePersistenceDataError(
        "draft",
        "list result must be an array",
      );
    }
    return data.map((row) =>
      toCustomRuleDraft(
        parsePersistenceRow(draftRowSchema, row, "draft"),
      ),
    );
  }

  async getDraft(
    unsafeInput: GetCustomRuleDraftInput,
  ): Promise<CustomRuleDraft | null> {
    const input = parsePersistenceInput(
      getDraftInputSchema,
      unsafeInput,
      "draft get input",
    );
    const { data, error } = await this.client
      .from("ai_settlement_rule_drafts")
      .select(DRAFT_SELECT)
      .eq("id", input.draftId)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("conversation_id", input.conversationId)
      .maybeSingle();
    if (error) {
      throw new CustomRulePersistenceQueryError("get_draft", error);
    }
    return data === null
      ? null
      : toCustomRuleDraft(
          parsePersistenceRow(draftRowSchema, data, "draft"),
        );
  }

  async insertSimulation(
    unsafeInput: InsertSettlementFormulaSimulationInput,
  ): Promise<InsertedSettlementFormulaSimulation> {
    assertSafeSimulationSummaryInput(unsafeInput);
    const input = parsePersistenceInput(
      insertSimulationInputSchema,
      unsafeInput,
      "simulation input",
    );
    const { data, error } = await this.client.rpc(
      "create_settlement_formula_simulation",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_rule_version_id:
          input.owner.kind === "rule_version" ? input.owner.id : null,
        p_ai_draft_id:
          input.owner.kind === "ai_draft" ? input.owner.id : null,
        p_idempotency_key: input.idempotencyKey,
        p_formula_hash: input.formulaHash,
        p_rule_contract_hash: input.ruleContractHash,
        p_parameter_hash: input.parameterHash,
        p_variable_catalog_version: input.variableCatalogVersion,
        p_data_selection_hash: input.dataSelectionHash,
        p_sample_source: input.sampleSource,
        p_sample_selection: input.sampleSelection,
        p_coverage: input.coverage,
        p_scenarios: input.scenarios,
        p_historical_totals: input.historicalTotals,
        p_deltas: input.deltas,
        p_largest_changes: input.largestChanges,
        p_warnings: input.warnings,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("insert_simulation", error);
    }
    const row = parsePersistenceRow(
      insertedSimulationRowSchema,
      data,
      "simulation",
    );
    return {
      ...toSettlementFormulaSimulation(row),
      duplicate: row.duplicate,
    };
  }

  async listSimulations(
    unsafeInput: ListSettlementFormulaSimulationsInput,
  ): Promise<SettlementFormulaSimulation[]> {
    const input = parsePersistenceInput(
      listSimulationsInputSchema,
      unsafeInput,
      "simulation list input",
    );
    let query = this.client
      .from("settlement_formula_simulations")
      .select(SIMULATION_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);
    query = scopeSimulationOwnerQuery(query, input.owner);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(input.limit)
      .returns<unknown[]>();
    if (error) {
      throw new CustomRulePersistenceQueryError("list_simulations", error);
    }
    if (!Array.isArray(data)) {
      throw new CustomRulePersistenceDataError(
        "simulation",
        "list result must be an array",
      );
    }
    return data.map((row) =>
      toSettlementFormulaSimulation(
        parsePersistenceRow(simulationRowSchema, row, "simulation"),
      ),
    );
  }

  async getSimulation(
    unsafeInput: GetSettlementFormulaSimulationInput,
  ): Promise<SettlementFormulaSimulation | null> {
    const input = parsePersistenceInput(
      getSimulationInputSchema,
      unsafeInput,
      "simulation get input",
    );
    let query = this.client
      .from("settlement_formula_simulations")
      .select(SIMULATION_SELECT)
      .eq("id", input.simulationId)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);
    query = scopeSimulationOwnerQuery(query, input.owner);
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new CustomRulePersistenceQueryError("get_simulation", error);
    }
    return data === null
      ? null
      : toSettlementFormulaSimulation(
          parsePersistenceRow(simulationRowSchema, data, "simulation"),
        );
  }

  async getProjectVariableCoverage(
    unsafeInput: GetProjectVariableCoverageInput,
  ): Promise<ProjectVariableCoverage> {
    const input = resolveCoverageQueryInput(
      validateCoverageInput(unsafeInput),
      this.businessTimezone,
    );
    const [reports, projectStreamers, normalizedCostItems, settlement] =
      await Promise.all([
        this.listApprovedReportCoverage(input),
        this.listProjectStreamerCoverage(input),
        this.listNormalizedCostItemCoverage(input),
        this.listSettlementCoverage(input),
      ]);

    return aggregateProjectVariableCoverage({
      reports,
      projectStreamers,
      normalizedCostItems,
      settlementBatches: settlement.batches,
      settlementItems: settlement.items,
      businessTimezone: this.businessTimezone,
    });
  }

  private async listApprovedReportCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<LiveReportCoverageRow[]> {
    const buildQuery = (columns: string) => {
      let query = this.client
        .from("live_reports")
        .select(columns, { count: "exact" })
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId)
        .eq("status", "approved");
      if (input.periodStartInclusive) {
        query = query.gte("created_at", input.periodStartInclusive);
      }
      if (input.periodEndExclusive) {
        query = query.lt("created_at", input.periodEndExclusive);
      }
      return query;
    };
    const snapshot = await readKeysetRows(
      "live_reports",
      this.maxRowsPerSource,
      () =>
        buildQuery("id")
          .order("id", { ascending: false })
          .limit(1)
          .returns<Array<{ id: string }>>(),
      (highWaterId, lastId) => {
        let query = buildQuery(LIVE_REPORT_SELECT).lte("id", highWaterId);
        if (lastId) {
          query = query.gt("id", lastId);
        }
        return query
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE)
          .returns<LiveReportCoverageRow[]>();
      },
    );
    return snapshot.rows;
  }

  private async listProjectStreamerCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<ProjectStreamerCoverageRow[]> {
    const buildQuery = (columns: string) => {
      let query = this.client
        .from("project_streamers")
        .select(columns, { count: "exact" })
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId)
        .not("joined_at", "is", null);
      if (input.periodEndExclusive) {
        query = query.lt("joined_at", input.periodEndExclusive);
      }
      if (input.periodStartInclusive) {
        query = query.or(
          `removed_at.is.null,removed_at.gte.${input.periodStartInclusive}`,
        );
      }
      return query;
    };
    const snapshot = await readKeysetRows(
      "project_streamers",
      this.maxRowsPerSource,
      () =>
        buildQuery("id")
          .order("id", { ascending: false })
          .limit(1)
          .returns<Array<{ id: string }>>(),
      (highWaterId, lastId) => {
        let query = buildQuery(PROJECT_STREAMER_SELECT).lte("id", highWaterId);
        if (lastId) {
          query = query.gt("id", lastId);
        }
        return query
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE)
          .returns<ProjectStreamerCoverageRow[]>();
      },
    );
    return snapshot.rows;
  }

  private async listNormalizedCostItemCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<NormalizedCostItemCoverageRow[]> {
    const buildQuery = (columns: string) => {
      let query = this.client
        .from("project_cost_items")
        .select(columns, { count: "exact" })
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId)
        .eq("source", "import")
        .eq("status", "confirmed")
        .in("item_type", ["gift", "supplier_fee", "traffic"]);
      if (input.periodStartInclusive) {
        query = query.gte("created_at", input.periodStartInclusive);
      }
      if (input.periodEndExclusive) {
        query = query.lt("created_at", input.periodEndExclusive);
      }
      return query;
    };
    const snapshot = await readKeysetRows(
      "project_cost_items",
      this.maxRowsPerSource,
      () =>
        buildQuery("id")
          .order("id", { ascending: false })
          .limit(1)
          .returns<Array<{ id: string }>>(),
      (highWaterId, lastId) => {
        let query = buildQuery(NORMALIZED_COST_ITEM_SELECT).lte(
          "id",
          highWaterId,
        );
        if (lastId) {
          query = query.gt("id", lastId);
        }
        return query
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE)
          .returns<NormalizedCostItemCoverageRow[]>();
      },
    );
    return snapshot.rows;
  }

  private async listSettlementCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<SettlementCoverageRows> {
    const batches = await this.listSettlementBatchCoverage(input);
    if (batches.length === 0) {
      return { batches, items: [] };
    }
    const items = await this.listSettlementItemCoverage(
      input,
      batches.map((batch) => batch.id),
    );
    return { batches, items };
  }

  private async listSettlementBatchCoverage(
    input: ResolvedCoverageQueryInput,
  ): Promise<SettlementBatchCoverageRow[]> {
    const buildQuery = (columns: string) => {
      let query = this.client
        .from("settlement_batches")
        .select(columns, { count: "exact" })
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId)
        .in("batch_type", ["payable", "receivable"])
        .in("status", ["confirmed", "locked"]);
      if (input.periodStart) {
        query = query.gte("period_end", input.periodStart);
      }
      if (input.periodEnd) {
        query = query.lte("period_start", input.periodEnd);
      }
      return query;
    };
    const snapshot = await readKeysetRows(
      "settlement_batches",
      this.maxRowsPerSource,
      () =>
        buildQuery("id")
          .order("id", { ascending: false })
          .limit(1)
          .returns<Array<{ id: string }>>(),
      (highWaterId, lastId) => {
        let query = buildQuery(SETTLEMENT_BATCH_SELECT).lte("id", highWaterId);
        if (lastId) {
          query = query.gt("id", lastId);
        }
        return query
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE)
          .returns<SettlementBatchCoverageRow[]>();
      },
    );
    return snapshot.rows;
  }

  private async listSettlementItemCoverage(
    input: ResolvedCoverageQueryInput,
    unsafeBatchIds: readonly string[],
  ): Promise<SettlementBatchItemCoverageRow[]> {
    const batchIds = [...new Set(unsafeBatchIds)].sort();
    if (batchIds.length === 0) {
      return [];
    }
    const rowsById = new Map<string, SettlementBatchItemCoverageRow>();
    let totalExactCount = 0;
    for (
      let offset = 0;
      offset < batchIds.length;
      offset += SETTLEMENT_BATCH_ID_CHUNK_SIZE
    ) {
      const batchIdChunk = batchIds.slice(
        offset,
        offset + SETTLEMENT_BATCH_ID_CHUNK_SIZE,
      );
      const snapshot = await this.listSettlementItemChunk(
        input,
        batchIdChunk,
      );
      totalExactCount += snapshot.exactCount;
      if (totalExactCount > this.maxRowsPerSource) {
        throw new CustomRuleCoverageLimitError(
          "settlement_batch_items",
          this.maxRowsPerSource,
        );
      }
      for (const row of snapshot.rows) {
        rowsById.set(readCoverageRowId("settlement_batch_items", row), row);
      }
    }
    if (rowsById.size !== totalExactCount) {
      throw new CustomRuleCoveragePageError(
        "settlement_batch_items",
        "global unique row count does not match chunk counts",
      );
    }
    return [...rowsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }

  private async listSettlementItemChunk(
    input: ResolvedCoverageQueryInput,
    batchIds: readonly string[],
  ): Promise<CoverageKeysetSnapshot<SettlementBatchItemCoverageRow>> {
    const buildQuery = (columns: string) =>
      this.client
        .from("settlement_batch_items")
        .select(columns, { count: "exact" })
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId)
        .in("settlement_batch_id", batchIds);
    return readKeysetRows(
      "settlement_batch_items",
      this.maxRowsPerSource,
      () =>
        buildQuery("id")
          .order("id", { ascending: false })
          .limit(1)
          .returns<Array<{ id: string }>>(),
      (highWaterId, lastId) => {
        let query = buildQuery(SETTLEMENT_BATCH_ITEM_SELECT).lte(
          "id",
          highWaterId,
        );
        if (lastId) {
          query = query.gt("id", lastId);
        }
        return query
          .order("id", { ascending: true })
          .limit(POSTGREST_PAGE_SIZE)
          .returns<SettlementBatchItemCoverageRow[]>();
      },
    );
  }
}

async function readKeysetRows<Row>(
  source: CoverageSource,
  limit: number,
  readHighWater: () => PromiseLike<CoverageQueryResult<{ id: string }>>,
  readPage: (
    highWaterId: string,
    lastId: string | null,
  ) => PromiseLike<CoverageQueryResult<Row>>,
): Promise<CoverageKeysetSnapshot<Row>> {
  const highWaterResult = await readHighWater();
  if (highWaterResult.error) {
    throw new CustomRuleCoverageQueryError(source, highWaterResult.error);
  }
  const exactCount = validateExactCoverageCount(
    source,
    highWaterResult.count,
  );
  if (exactCount > limit) {
    throw new CustomRuleCoverageLimitError(source, limit);
  }
  if (!Array.isArray(highWaterResult.data)) {
    throw new CustomRuleCoveragePageError(
      source,
      "high-water rows must be an array",
    );
  }
  if (exactCount === 0) {
    if (highWaterResult.data.length !== 0) {
      throw new CustomRuleCoveragePageError(
        source,
        "empty snapshot returned a high-water row",
      );
    }
    return { rows: [], exactCount };
  }
  if (highWaterResult.data.length !== 1) {
    throw new CustomRuleCoveragePageError(
      source,
      "nonempty snapshot must return exactly one high-water row",
    );
  }
  const highWaterId = readCoverageRowId(source, highWaterResult.data[0]);
  const rows: Row[] = [];
  const rowIds = new Set<string>();
  let lastId: string | null = null;

  while (rows.length < exactCount) {
    const result = await readPage(highWaterId, lastId);
    if (result.error) {
      throw new CustomRuleCoverageQueryError(source, result.error);
    }
    const remainingCount = exactCount - rows.length;
    const pageCount = validateExactCoverageCount(source, result.count);
    if (pageCount !== remainingCount) {
      throw new CustomRuleCoveragePageError(
        source,
        "bounded keyset count drifted during pagination",
      );
    }
    if (!Array.isArray(result.data)) {
      throw new CustomRuleCoveragePageError(
        source,
        "page rows must be an array",
      );
    }

    const expectedPageLength = Math.min(
      POSTGREST_PAGE_SIZE,
      remainingCount,
    );
    if (result.data.length !== expectedPageLength) {
      throw new CustomRuleCoveragePageError(
        source,
        `expected ${expectedPageLength} rows after key ${lastId ?? "<start>"}`,
      );
    }
    for (const row of result.data) {
      const rowId = readCoverageRowId(source, row);
      if (
        (lastId !== null && rowId.localeCompare(lastId) <= 0) ||
        rowId.localeCompare(highWaterId) > 0
      ) {
        throw new CustomRuleCoveragePageError(
          source,
          "page row IDs must be strictly increasing within the high-water",
        );
      }
      if (rowIds.has(rowId)) {
        throw new CustomRuleCoveragePageError(
          source,
          "duplicate row id across keyset pages",
        );
      }
      rowIds.add(rowId);
      rows.push(row);
      lastId = rowId;
    }
  }
  if (rowIds.size !== exactCount) {
    throw new CustomRuleCoveragePageError(
      source,
      "final unique row count does not match the initial exact count",
    );
  }
  return { rows, exactCount };
}

function validateExactCoverageCount(
  source: CoverageSource,
  count: number | null,
): number {
  if (!Number.isSafeInteger(count) || (count ?? -1) < 0) {
    throw new CustomRuleCoverageCountError(
      source,
      "exact count must be a nonnegative safe integer",
    );
  }
  return count as number;
}

function readCoverageRowId(source: CoverageSource, row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new CustomRuleCoveragePageError(source, "page row must be an object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(row, "id");
  if (
    !descriptor ||
    descriptor.get ||
    descriptor.set ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0
  ) {
    throw new CustomRuleCoveragePageError(
      source,
      "page row must have an own nonempty id",
    );
  }
  return descriptor.value;
}

function aggregateProjectVariableCoverage(input: {
  reports: LiveReportCoverageRow[];
  projectStreamers: ProjectStreamerCoverageRow[];
  normalizedCostItems: NormalizedCostItemCoverageRow[];
  settlementBatches: SettlementBatchCoverageRow[];
  settlementItems: SettlementBatchItemCoverageRow[];
  businessTimezone: ResolvedCustomRuleBusinessTimezone;
}): ProjectVariableCoverage {
  const reportCount = input.reports.length;
  const approvedReportIds = new Set(
    input.reports.map((row) => row.id).filter(isNonemptyString),
  );
  const projectStreamerIds = new Set(
    input.projectStreamers
      .map((row) => row.streamer_id)
      .filter(isNonemptyString),
  );
  const streamerCount = projectStreamerIds.size;
  const reportPeriod = sampledPeriod(
    input.reports.map((row) => row.created_at),
  );
  const streamerPeriod = sampledPeriod(
    input.projectStreamers.flatMap((row) =>
      [row.joined_at, row.removed_at].filter(isString),
    ),
  );
  const liveStartedCount = countPresent(input.reports, (row) =>
    firstRelation(row.live_tasks)?.system_started_at,
  );
  const normalizedByType = (itemType: NormalizedCostItemCoverageRow["item_type"]) =>
    input.normalizedCostItems.filter((row) => row.item_type === itemType);
  const giftItems = normalizedByType("gift");
  const supplierItems = normalizedByType("supplier_fee");
  const trafficItems = normalizedByType("traffic");
  const settlementBatchesById = new Map(
    input.settlementBatches.map((batch) => [batch.id, batch]),
  );
  const settlementRows = input.settlementItems
    .filter(
      (row) =>
        row.live_report_id !== null &&
        approvedReportIds.has(row.live_report_id),
    )
    .flatMap((row) => {
      const batch = row.settlement_batch_id
        ? settlementBatchesById.get(row.settlement_batch_id)
        : undefined;
      return batch ? [{ row, batch }] : [];
    });
  const payableItems = settlementRows.filter(
    ({ batch, row }) =>
      batch.batch_type === "payable" &&
      row.streamer_id !== null &&
      projectStreamerIds.has(row.streamer_id),
  );
  const receivableItems = settlementRows.filter(
    ({ batch }) => batch.batch_type === "receivable",
  );
  const periodPresence = reportCount > 0 ? 1 : 0;

  const variables: Record<string, CustomRuleVariableCoverage> = {
    system_minutes: coverage(
      "system_minutes",
      countPresent(input.reports, (row) => row.system_duration),
      reportCount,
      reportPeriod,
    ),
    screenshot_minutes: coverage(
      "screenshot_minutes",
      countPresent(input.reports, (row) => row.screenshot_duration),
      reportCount,
      reportPeriod,
    ),
    settlement_minutes: coverage(
      "settlement_minutes",
      countPresent(input.reports, (row) => row.settlement_duration),
      reportCount,
      reportPeriod,
    ),
    evidence_level: coverage(
      "evidence_level",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    time_source: coverage(
      "time_source",
      countPresent(input.reports, (row) => row.time_source),
      reportCount,
      reportPeriod,
    ),
    views: coverage(
      "views",
      countPresent(input.reports, (row) => row.viewers),
      reportCount,
      reportPeriod,
    ),
    live_started_at: coverage(
      "live_started_at",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    weekday: coverage(
      "weekday",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    hour_of_day: coverage(
      "hour_of_day",
      liveStartedCount,
      reportCount,
      reportPeriod,
    ),
    approved_at: coverage(
      "approved_at",
      countPresent(input.reports, (row) => row.reviewed_at),
      reportCount,
      reportPeriod,
    ),
    project_id: coverage("project_id", 1, 1, reportPeriod),
    project_tags: coverage("project_tags", 0, 1, null),
    streamer_id: coverage(
      "streamer_id",
      streamerCount,
      streamerCount,
      streamerPeriod,
    ),
    streamer_level: coverage(
      "streamer_level",
      0,
      streamerCount,
      null,
    ),
    streamer_source: coverage(
      "streamer_source",
      countPresent(input.projectStreamers, (row) =>
        firstRelation(row.streamers)?.source_type,
      ),
      streamerCount,
      streamerPeriod,
    ),
    collaboration_id: coverage(
      "collaboration_id",
      countPresent(input.projectStreamers, (row) => row.collaboration_id),
      streamerCount,
      streamerPeriod,
    ),
    base_hourly_rate: coverage(
      "base_hourly_rate",
      countPresent(input.projectStreamers, (row) => row.hourly_rate),
      streamerCount,
      streamerPeriod,
    ),
    base_salary: coverage(
      "base_salary",
      countPresent(input.projectStreamers, (row) => row.base_salary),
      streamerCount,
      streamerPeriod,
    ),
    cps_rate: coverage(
      "cps_rate",
      countPresent(input.projectStreamers, (row) => row.cps_rate_bps),
      streamerCount,
      streamerPeriod,
    ),
    streamer_group_ids: coverage(
      "streamer_group_ids",
      0,
      streamerCount,
      null,
    ),
    sales_amount: coverage("sales_amount", 0, reportCount, null),
    orders_count: coverage("orders_count", 0, reportCount, null),
    gift_amount: normalizedCoverage(
      "gift_amount",
      giftItems,
      reportCount,
      approvedReportIds,
    ),
    supplier_fee: normalizedCoverage(
      "supplier_fee",
      supplierItems,
      reportCount,
      approvedReportIds,
    ),
    traffic_cost: normalizedCoverage(
      "traffic_cost",
      trafficItems,
      reportCount,
      approvedReportIds,
    ),
    manual_adjustment: coverage(
      "manual_adjustment",
      0,
      reportCount,
      null,
    ),
    period_system_minutes: coverage(
      "period_system_minutes",
      countPresent(input.reports, (row) => row.system_duration),
      reportCount,
      reportPeriod,
    ),
    period_settlement_minutes: coverage(
      "period_settlement_minutes",
      countPresent(input.reports, (row) => row.settlement_duration),
      reportCount,
      reportPeriod,
    ),
    period_sales_amount: coverage(
      "period_sales_amount",
      0,
      reportCount,
      null,
    ),
    period_orders_count: coverage(
      "period_orders_count",
      0,
      reportCount,
      null,
    ),
    period_report_count: coverage(
      "period_report_count",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
    red_evidence_count: coverage(
      "red_evidence_count",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    yellow_evidence_count: coverage(
      "yellow_evidence_count",
      countPresent(input.reports, (row) => row.evidence_level),
      reportCount,
      reportPeriod,
    ),
    period_payable_amount: coverage(
      "period_payable_amount",
      uniqueNonNullCount(payableItems.map(({ row }) => row.streamer_id)),
      streamerCount,
      settlementPeriod(payableItems.map(({ batch }) => batch)),
    ),
    period_receivable_amount: coverage(
      "period_receivable_amount",
      uniqueNonNullCount(
        receivableItems.map(({ row }) => row.live_report_id),
      ),
      reportCount,
      settlementPeriod(receivableItems.map(({ batch }) => batch)),
    ),
    period_start: coverage(
      "period_start",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
    period_end: coverage(
      "period_end",
      periodPresence,
      periodPresence,
      reportPeriod,
    ),
  };

  return {
    hasHistory: reportCount > 0,
    businessTimezone: input.businessTimezone.value,
    businessTimezoneConfirmed: input.businessTimezone.confirmed,
    businessTimezoneSource: input.businessTimezone.source,
    variables,
  };
}

function normalizedCoverage(
  variableId: string,
  rows: NormalizedCostItemCoverageRow[],
  denominator: number,
  approvedReportIds: ReadonlySet<string>,
): CustomRuleVariableCoverage {
  const approvedRows = rows.filter(
    (row) =>
      row.live_report_id !== null &&
      approvedReportIds.has(row.live_report_id),
  );
  return coverage(
    variableId,
    uniqueNonNullCount(approvedRows.map((row) => row.live_report_id)),
    denominator,
    sampledPeriod(approvedRows.map((row) => row.created_at)),
  );
}

function coverage(
  variableId: string,
  numerator: number,
  denominator: number,
  latestSampledPeriod: CustomRuleLatestSampledPeriod | null,
): CustomRuleVariableCoverage {
  assertCoverageCounts(variableId, numerator, denominator);
  return { numerator, denominator, latestSampledPeriod };
}

function countPresent<Row>(
  rows: readonly Row[],
  select: (row: Row) => unknown,
): number {
  return rows.reduce((count, row) => {
    const value = select(row);
    return value === null || value === undefined ? count : count + 1;
  }, 0);
}

function uniqueNonNullCount(values: ReadonlyArray<string | null>): number {
  const unique = new Set(
    values.filter((value): value is string => Boolean(value)),
  );
  return unique.size;
}

function firstRelation<Row>(row: Row | Row[] | null): Row | null {
  if (Array.isArray(row)) {
    return row[0] ?? null;
  }
  return row;
}

function sampledPeriod(
  values: readonly string[],
): CustomRuleLatestSampledPeriod | null {
  const ordered = values
    .filter((value) => Number.isFinite(Date.parse(value)))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.value.localeCompare(right.value),
    );
  if (ordered.length === 0) {
    return null;
  }
  return {
    start: ordered[0].value,
    end: ordered[ordered.length - 1].value,
  };
}

function settlementPeriod(
  batches: ReadonlyArray<{
    period_start: string;
    period_end: string;
  }>,
): CustomRuleLatestSampledPeriod | null {
  const starts = sampledPeriod(batches.map((batch) => batch.period_start));
  const ends = sampledPeriod(batches.map((batch) => batch.period_end));
  return starts && ends ? { start: starts.start, end: ends.end } : null;
}

function validateCoverageInput(
  input: unknown,
): GetProjectVariableCoverageInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CustomRuleCoverageInputError("input must be an own-data object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CustomRuleCoverageInputError(
      "input must not inherit organization or project data",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key),
    )
  ) {
    throw new CustomRuleCoverageInputError("input contains an unknown key");
  }
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new CustomRuleCoverageInputError(
        "input properties must be own data properties",
      );
    }
  }

  const organizationId = nonemptyOwnString(
    descriptors,
    "organizationId",
  );
  const projectId = nonemptyOwnString(descriptors, "projectId");
  const periodStart = optionalPeriod(descriptors, "periodStart");
  const periodEnd = optionalPeriod(descriptors, "periodEnd");
  if (
    periodStart &&
    periodEnd &&
    periodStart > periodEnd
  ) {
    throw new CustomRuleCoverageInputError(
      "periodStart must not be later than periodEnd",
    );
  }

  return {
    organizationId,
    projectId,
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
  };
}

function nonemptyOwnString(
  descriptors: PropertyDescriptorMap,
  key: "organizationId" | "projectId",
): string {
  const value = descriptors[key]?.value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CustomRuleCoverageInputError(`${key} must be a nonempty string`);
  }
  return value.trim();
}

function optionalPeriod(
  descriptors: PropertyDescriptorMap,
  key: "periodStart" | "periodEnd",
): string | undefined {
  const value = descriptors[key]?.value;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError(
      `${key} must be a valid YYYY-MM-DD business date`,
    );
  }
  return value;
}

function resolveCoverageQueryInput(
  input: GetProjectVariableCoverageInput,
  businessTimezone: ResolvedCustomRuleBusinessTimezone,
): ResolvedCoverageQueryInput {
  if (!input.periodStart && !input.periodEnd) {
    return input;
  }
  if (!businessTimezone.confirmed || !businessTimezone.value) {
    throw new CustomRuleCoverageInputError(
      "period filtering requires a confirmed IANA business timezone",
    );
  }

  return {
    ...input,
    ...(input.periodStart
      ? {
          periodStartInclusive: businessDateBoundary(
            input.periodStart,
            businessTimezone.value,
          ),
        }
      : {}),
    ...(input.periodEnd
      ? {
          periodEndExclusive: businessDateBoundary(
            nextBusinessDate(input.periodEnd),
            businessTimezone.value,
          ),
        }
      : {}),
  };
}

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

type CalendarDateTimeParts = CalendarDateParts & {
  hour: number;
  minute: number;
  second: number;
};

function isValidBusinessDate(value: string): boolean {
  const parts = parseBusinessDate(value);
  return (
    parts !== null &&
    parts.year >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month)
  );
}

function parseBusinessDate(value: string): CalendarDateParts | null {
  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function nextBusinessDate(value: string): string {
  const parsed = parseBusinessDate(value);
  if (!parsed || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError("invalid business-date boundary");
  }
  let { year, month, day } = parsed;
  day += 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  if (year > 9_999) {
    throw new CustomRuleCoverageInputError(
      "periodEnd cannot produce a supported exclusive boundary",
    );
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function businessDateBoundary(value: string, timezone: string): string {
  const parsed = parseBusinessDate(value);
  if (!parsed || !isValidBusinessDate(value)) {
    throw new CustomRuleCoverageInputError("invalid business-date boundary");
  }
  const targetEpoch = utcEpoch({ ...parsed, hour: 0, minute: 0, second: 0 });
  let instant = targetEpoch;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const local = zonedDateTimeParts(instant, timezone);
    const adjustment = targetEpoch - utcEpoch(local);
    instant += adjustment;
    if (adjustment === 0) {
      break;
    }
  }

  const local = zonedDateTimeParts(instant, timezone);
  if (
    local.year !== parsed.year ||
    local.month !== parsed.month ||
    local.day !== parsed.day ||
    local.hour !== 0 ||
    local.minute !== 0 ||
    local.second !== 0
  ) {
    throw new CustomRuleCoverageInputError(
      "business-date midnight does not exist in the resolved timezone",
    );
  }
  const offsetMinutes = (targetEpoch - instant) / 60_000;
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 24 * 60) {
    throw new CustomRuleCoverageInputError(
      "business timezone produced an unsupported UTC offset",
    );
  }
  return `${value}T00:00:00.000${formatOffset(offsetMinutes)}`;
}

function zonedDateTimeParts(
  epochMilliseconds: number,
  timezone: string,
): CalendarDateTimeParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw new CustomRuleCoverageInputError(
      "business timezone cannot resolve period boundaries",
    );
  }

  const values = new Map<string, number>();
  for (const part of formatter.formatToParts(new Date(epochMilliseconds))) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values.set(part.type, Number(part.value));
    }
  }
  const result = {
    year: values.get("year"),
    month: values.get("month"),
    day: values.get("day"),
    hour: values.get("hour"),
    minute: values.get("minute"),
    second: values.get("second"),
  };
  if (Object.values(result).some((part) => !Number.isInteger(part))) {
    throw new CustomRuleCoverageInputError(
      "business timezone returned an invalid calendar boundary",
    );
  }
  return result as CalendarDateTimeParts;
}

function utcEpoch(parts: CalendarDateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function validateMaximumRows(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CustomRuleCoverageInputError(
      "maxRowsPerSource must be a positive safe integer",
    );
  }
  return value;
}

function resolveBusinessTimezone(
  timezone: ResolvedCustomRuleBusinessTimezone,
): ResolvedCustomRuleBusinessTimezone {
  const source = normalizeCustomRuleBusinessTimezoneSource(timezone.source);
  return {
    value: timezone.value,
    source,
    confirmed: isConfirmedIanaTimezone({
      businessTimezone: timezone.value,
      businessTimezoneConfirmed: timezone.confirmed,
      businessTimezoneSource: source,
    }),
  };
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function isNonemptyString(value: string): boolean {
  return value.length > 0;
}

function validateSimulationRowOwner(
  row: { rule_version_id: string | null; ai_draft_id: string | null },
  context: z.RefinementCtx,
): void {
  const ownerCount = Number(row.rule_version_id !== null) +
    Number(row.ai_draft_id !== null);
  if (ownerCount !== 1) {
    context.addIssue({
      code: "custom",
      path: ["rule_version_id"],
      message: "exactly one simulation owner is required",
    });
  }
}

function parsePersistenceInput<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
  label: string,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CustomRulePersistenceInputError(
      `${label}: ${formatPersistenceIssues(result.error.issues)}`,
    );
  }
  return result.data;
}

function parsePersistenceRow<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
  entity: "draft" | "simulation",
): Output {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CustomRulePersistenceDataError(
      entity,
      formatPersistenceIssues(result.error.issues),
    );
  }
  return result.data;
}

function formatPersistenceIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

type JsonBudgetEntry = {
  value: unknown;
  path: string;
  rootPath: string;
  depth: number;
  ancestors: readonly object[];
};
type JsonBudgetOptions = {
  forbiddenKeys: ReadonlySet<string>;
  validateString?: (value: string, path: string) => void;
};

function assertSafeDraftPayloadInput(value: unknown): void {
  const entries = collectPersistenceJsonFields(
    value,
    "draft input",
    [
      "turnTrace",
      "businessContract",
      "unresolvedAmbiguities",
      "aiResponse",
      "generatedFormula",
      "generatedTestCases",
      "safetyFlags",
    ],
  );
  assertJsonCollectionWithinBudget(entries, {
    forbiddenKeys: FORBIDDEN_DRAFT_JSON_KEYS,
  });
}

function assertSafeSimulationSummaryInput(value: unknown): void {
  const entries = collectPersistenceJsonFields(
    value,
    "simulation input",
    [
      "sampleSource",
      "sampleSelection",
      "coverage",
      "scenarios",
      "historicalTotals",
      "deltas",
      "largestChanges",
      "warnings",
    ],
  );
  assertJsonCollectionWithinBudget(entries, {
    forbiddenKeys: FORBIDDEN_SIMULATION_JSON_KEYS,
    validateString: validateSimulationSummaryString,
  });
}

function collectPersistenceJsonFields(
  value: unknown,
  label: string,
  keys: readonly string[],
): JsonBudgetEntry[] {
  const descriptors = getPlainObjectDescriptors(value, label);
  const entries: JsonBudgetEntry[] = [];
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new CustomRulePersistenceInputError(
        `${label}.${key} must be an own data property`,
      );
    }
    entries.push({
      value: descriptor.value,
      path: key,
      rootPath: key,
      depth: 0,
      ancestors: [],
    });
  }
  return entries;
}

function assertJsonCollectionWithinBudget(
  roots: JsonBudgetEntry[],
  options: JsonBudgetOptions,
): void {
  const stack = [...roots];
  let nodeCount = 0;
  let serializedBytes = 2 + Math.max(0, roots.length - 1);
  const serializedBytesByRoot = new Map(
    roots.map(({ rootPath }) => [rootPath, 0]),
  );
  const addSerializedBytes = (entry: JsonBudgetEntry, bytes: number): void => {
    serializedBytes += bytes;
    const rootBytes = (serializedBytesByRoot.get(entry.rootPath) ?? 0) + bytes;
    if (rootBytes > JSON_INPUT_CONSERVATIVE_MAX_SUBCONTAINER_BYTES) {
      throw new CustomRulePersistenceInputError(
        `${entry.rootPath} exceeds the conservative ${JSON_INPUT_CONSERVATIVE_MAX_SUBCONTAINER_BYTES}-byte JSON input subcontainer budget`,
      );
    }
    serializedBytesByRoot.set(entry.rootPath, rootBytes);
    if (serializedBytes > JSON_INPUT_CONSERVATIVE_MAX_TOTAL_BYTES) {
      throw new CustomRulePersistenceInputError(
        `JSON payload exceeds the conservative ${JSON_INPUT_CONSERVATIVE_MAX_TOTAL_BYTES}-byte input budget`,
      );
    }
  };

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    nodeCount += 1;
    if (nodeCount > JSON_BUDGET_MAX_NODES) {
      throw new CustomRulePersistenceInputError(
        `${entry.path} exceeds the ${JSON_BUDGET_MAX_NODES}-node JSON budget`,
      );
    }
    if (entry.depth > JSON_BUDGET_MAX_DEPTH) {
      throw new CustomRulePersistenceInputError(
        `${entry.path} exceeds the JSON depth budget`,
      );
    }

    const { value, path, rootPath, depth, ancestors } = entry;
    if (value === null) {
      addSerializedBytes(entry, 4);
    } else if (typeof value === "string") {
      const rawBytes = utf8ByteLength(value);
      const encodedBytes = utf8ByteLength(JSON.stringify(value));
      if (rawBytes > JSON_BUDGET_MAX_STRING_BYTES) {
        throw new CustomRulePersistenceInputError(
          `${path} exceeds the raw string byte budget`,
        );
      }
      options.validateString?.(value, path);
      addSerializedBytes(entry, encodedBytes);
    } else if (typeof value === "boolean") {
      addSerializedBytes(entry, value ? 4 : 5);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      addSerializedBytes(entry, utf8ByteLength(JSON.stringify(value)));
    } else if (Array.isArray(value)) {
      if (ancestors.includes(value)) {
        throw new CustomRulePersistenceInputError(`${path} must not be cyclic`);
      }
      const childAncestors = [...ancestors, value];
      const descriptors = getArrayDescriptors(value, path);
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new CustomRulePersistenceInputError(
          `${path} has an invalid array length`,
        );
      }
      if (length > JSON_BUDGET_MAX_CONTAINER_ITEMS) {
        throw new CustomRulePersistenceInputError(
          `${path} exceeds the array item budget`,
        );
      }
      addSerializedBytes(entry, 2 + Math.max(0, length - 1));
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
          throw new CustomRulePersistenceInputError(
            `${path}[${index}] must be an own data property`,
          );
        }
        stack.push({
          value: descriptor.value,
          path: `${path}[${index}]`,
          rootPath,
          depth: depth + 1,
          ancestors: childAncestors,
        });
      }
    } else if (typeof value === "object") {
      if (ancestors.includes(value)) {
        throw new CustomRulePersistenceInputError(`${path} must not be cyclic`);
      }
      const childAncestors = [...ancestors, value];
      const descriptors = getPlainObjectDescriptors(value, path);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.some((key) => typeof key !== "string")) {
        throw new CustomRulePersistenceInputError(
          `${path} must not contain symbol keys`,
        );
      }
      const keys = ownKeys as string[];
      if (keys.length > JSON_BUDGET_MAX_CONTAINER_ITEMS) {
        throw new CustomRulePersistenceInputError(
          `${path} exceeds the object key budget`,
        );
      }
      addSerializedBytes(entry, 2 + Math.max(0, keys.length - 1));
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) continue;
        const descriptor = descriptors[key];
        if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
          throw new CustomRulePersistenceInputError(
            `${path}.${key} must be an own data property`,
          );
        }
        if (utf8ByteLength(key) > JSON_BUDGET_MAX_KEY_BYTES) {
          throw new CustomRulePersistenceInputError(
            `${path}.${key} exceeds the key byte budget`,
          );
        }
        const normalizedKey = normalizeSafetyKey(key);
        if (options.forbiddenKeys.has(normalizedKey)) {
          throw new CustomRulePersistenceInputError(
            `${path}.${key} is forbidden summary data`,
          );
        }
        addSerializedBytes(
          entry,
          utf8ByteLength(JSON.stringify(key)) + 1,
        );
        stack.push({
          value: descriptor.value,
          path: `${path}.${key}`,
          rootPath,
          depth: depth + 1,
          ancestors: childAncestors,
        });
      }
    } else {
      throw new CustomRulePersistenceInputError(
        `${path} must contain JSON own-data values only`,
      );
    }

  }
}

function getPlainObjectDescriptors(
  value: unknown,
  path: string,
): PropertyDescriptorMap {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CustomRulePersistenceInputError(
        `${path} must be a plain own-data object`,
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CustomRulePersistenceInputError(
        `${path} must be a plain own-data object`,
      );
    }
    return Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (error instanceof CustomRulePersistenceInputError) throw error;
    throw new CustomRulePersistenceInputError(
      `${path} could not be inspected safely`,
    );
  }
}

function getArrayDescriptors(
  value: unknown[],
  path: string,
): Record<string, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new CustomRulePersistenceInputError(
      `${path} could not be inspected safely`,
    );
  }
}

function validateSimulationSummaryString(value: string, path: string): void {
  if (
    /^sampleSelection\.criteria\[[0-9]+\]$/u.test(path) &&
    FORBIDDEN_SIMULATION_CRITERIA_PATTERN.test(value)
  ) {
    throw new CustomRulePersistenceInputError(
      `${path} contains forbidden row-level criteria`,
    );
  }
  if (
    /^largestChanges\[[0-9]+\]\.key$/u.test(path) &&
    FORBIDDEN_SIMULATION_VALUE_KEYS.has(normalizeSafetyKey(value))
  ) {
    throw new CustomRulePersistenceInputError(
      `${path} identifies forbidden row-level data`,
    );
  }
}

function normalizeSafetyKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function toCustomRuleDraft(row: DraftRow | CreatedDraftRow): CustomRuleDraft {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    idempotencyKey: row.idempotency_key,
    promptText: row.prompt_text,
    turnTrace: row.turn_trace,
    businessContract: row.business_contract,
    unresolvedAmbiguities: row.unresolved_ambiguities,
    variableCatalogVersion: row.variable_catalog_version,
    aiResponse: row.ai_response,
    generatedFormula: row.generated_formula,
    generatedExplanation: row.generated_explanation,
    generatedTestCases: row.generated_test_cases,
    model: row.model,
    safetyFlags: row.safety_flags,
    contractHash: row.contract_hash,
    formulaHash: row.formula_hash,
    parameterHash: row.parameter_hash,
    status: row.status,
    revisionNumber: row.revision_number,
    createdBy: row.created_by,
    createdAt: row.created_at,
    supersedesDraftId: row.supersedes_draft_id,
    supersededByDraftId: row.superseded_by_draft_id,
    supersededAt: row.superseded_at,
  };
}

function toSettlementFormulaSimulation(
  row: SimulationRow | InsertedSimulationRow,
): SettlementFormulaSimulation {
  const owner: SettlementSimulationOwner = row.ai_draft_id !== null
    ? { kind: "ai_draft", id: row.ai_draft_id }
    : { kind: "rule_version", id: row.rule_version_id as string };
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    owner,
    idempotencyKey: row.idempotency_key,
    formulaHash: row.formula_hash,
    ruleContractHash: row.rule_contract_hash,
    parameterHash: row.parameter_hash,
    variableCatalogVersion: row.variable_catalog_version,
    dataSelectionHash: row.data_selection_hash,
    sampleSource: row.sample_source,
    sampleSelection: row.sample_selection,
    coverage: row.coverage,
    scenarios: row.scenarios,
    historicalTotals: row.historical_totals,
    deltas: row.deltas,
    largestChanges: row.largest_changes,
    warnings: row.warnings,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function scopeSimulationOwnerQuery<
  Query extends { eq(column: string, value: string): Query },
>(query: Query, owner: SettlementSimulationOwner): Query {
  return owner.kind === "ai_draft"
    ? query.eq("ai_draft_id", owner.id)
    : query.eq("rule_version_id", owner.id);
}
