import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  businessRuleContractSchema,
  normalizedAstNodeSchema,
  typedRuntimeValueSchema,
  type BusinessRuleContract,
} from "./custom-rule-contract";
import {
  CUSTOM_RULE_COMPOSITION_MODES,
  CUSTOM_RULE_EXECUTION_GRAINS,
  CUSTOM_RULE_SCOPES,
  CUSTOM_RULE_TARGET_TYPES,
  CUSTOM_RULE_VERSION_STATUSES,
  type CustomRuleScope,
  type CustomRuleTarget,
  type CustomRuleVersionStatus,
  type NormalizedAstNode,
  type TypedRuntimeValue,
} from "./custom-rule-types";
import type { SettlementGroupMembershipSnapshot } from "./custom-rule-groups";

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

export type CustomRuleDraftCommonInput = {
  organizationId: string;
  projectId: string;
  conversationId: string;
  idempotencyKey: string;
  promptText: string;
  turnTrace: SettlementAiTurnTrace;
  businessContract: BusinessRuleContract;
  variableCatalogVersion: string;
  aiResponse: SettlementAiResponse;
  model: string;
  safetyFlags: SettlementAiSafetyFlag[];
  contractHash: string;
  parameterHash: string;
};

export type ClarifyingCustomRuleDraftInput = CustomRuleDraftCommonInput & {
  status: "clarifying";
  unresolvedAmbiguities: [
    SettlementAiUnresolvedAmbiguity,
    ...SettlementAiUnresolvedAmbiguity[],
  ];
  generatedFormula: null;
  generatedExplanation: null;
  generatedTestCases: [];
  formulaHash: null;
};

export type ContractReadyCustomRuleDraftInput = CustomRuleDraftCommonInput & {
  status: "contract_ready";
  unresolvedAmbiguities: [];
  generatedFormula: SettlementAiFormulaDraft;
  generatedExplanation: string;
  generatedTestCases: [
    SettlementAiGeneratedTestCase,
    ...SettlementAiGeneratedTestCase[],
  ];
  formulaHash: string;
};

export type FailedCustomRuleDraftInput = CustomRuleDraftCommonInput & {
  status: "failed";
  unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
  generatedFormula: null;
  generatedExplanation: null;
  generatedTestCases: [];
  formulaHash: null;
};

export type CreateCustomRuleDraftInput =
  | ClarifyingCustomRuleDraftInput
  | ContractReadyCustomRuleDraftInput
  | FailedCustomRuleDraftInput;

type CustomRuleDraftFormulaStateMap = {
  clarifying: {
    unresolvedAmbiguities: [
      SettlementAiUnresolvedAmbiguity,
      ...SettlementAiUnresolvedAmbiguity[],
    ];
    generatedFormula: null;
    generatedExplanation: null;
    generatedTestCases: [];
    formulaHash: null;
  };
  failed: {
    unresolvedAmbiguities: SettlementAiUnresolvedAmbiguity[];
    generatedFormula: null;
    generatedExplanation: null;
    generatedTestCases: [];
    formulaHash: null;
  };
  contract_ready: {
    unresolvedAmbiguities: [];
    generatedFormula: SettlementAiFormulaDraft;
    generatedExplanation: string;
    generatedTestCases: [
      SettlementAiGeneratedTestCase,
      ...SettlementAiGeneratedTestCase[],
    ];
    formulaHash: string;
  };
};

type CustomRuleDraftCurrentStatusMap = {
  clarifying: "clarifying";
  failed: "failed";
  contract_ready: "contract_ready" | "simulated";
};

type CustomRuleDraftLifecycleState<
  CurrentStatus extends Exclude<SettlementAiDraftStatus, "superseded">,
> =
  | {
      status: CurrentStatus;
      supersededByDraftId: null;
      supersededAt: null;
    }
  | {
      status: "superseded";
      supersededByDraftId: string;
      supersededAt: string;
    };

type CustomRuleDraftState = {
  [InitialStatus in CreateSettlementAiDraftStatus]: {
    initialStatus: InitialStatus;
  } & CustomRuleDraftFormulaStateMap[InitialStatus] &
    CustomRuleDraftLifecycleState<
      CustomRuleDraftCurrentStatusMap[InitialStatus]
    >;
}[CreateSettlementAiDraftStatus];

type CustomRuleDraftMetadata = {
  id: string;
  revisionNumber: number;
  createdBy: string;
  createdAt: string;
  supersedesDraftId: string | null;
};

export type CustomRuleDraft = CustomRuleDraftCommonInput &
  CustomRuleDraftMetadata &
  CustomRuleDraftState;

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
  summarySchemaVersion: 2;
  totalRecords: number;
  evaluatedRecords: number;
  skippedRecords: number;
  uncoveredRecords: number;
  zeroAmountRecords: number;
  reviewRoutedRecords: number;
  blockedRecords: number;
};

export type SettlementSimulationScenario = {
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
};

export type SettlementSimulationHistoricalTotals = {
  oldPayableAmountCents: string | null;
  oldReceivableAmountCents: string | null;
  newPayableAmountCents: string | null;
  newReceivableAmountCents: string | null;
  recordCount: number;
  verificationStatus: "verified" | "unverified";
};

export type SettlementSimulationDeltas = {
  payableAmountCents: string | null;
  receivableAmountCents: string | null;
  percentageBps: number | null;
  marginImpactCents: string | null;
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

export type SettlementSimulationPersistedFinding =
  SettlementSimulationWarning & {
    kind: "warning" | "risk";
  };

export type SettlementSimulationPersistedFindingInput =
  SettlementSimulationWarning & {
    kind?: "warning" | "risk";
  };

export type LegacySettlementSimulationScenario = {
  name: string;
  kind: "normal" | "boundary" | "missing_data";
  result: "passed" | "warning" | "failed";
};

export type LegacySettlementSimulationWarning = SettlementSimulationWarning & {
  kind: "legacy";
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
  warnings: SettlementSimulationPersistedFindingInput[];
};

type SettlementFormulaSimulationBase = Pick<
  InsertSettlementFormulaSimulationInput,
  | "organizationId"
  | "projectId"
  | "owner"
  | "idempotencyKey"
  | "formulaHash"
  | "ruleContractHash"
  | "parameterHash"
  | "variableCatalogVersion"
  | "dataSelectionHash"
  | "sampleSource"
  | "sampleSelection"
  | "largestChanges"
> & {
  id: string;
  createdBy: string;
  createdAt: string;
};

export type CompleteSettlementFormulaSimulation =
  SettlementFormulaSimulationBase & {
    summarySchemaVersion: 2;
    summaryComplete: true;
    summaryStatus: "complete";
    coverage: SettlementSimulationCoverage;
    scenarios: SettlementSimulationScenario[];
    historicalTotals: SettlementSimulationHistoricalTotals & {
      payableAmountCents: string | null;
      receivableAmountCents: string | null;
    };
    deltas: SettlementSimulationDeltas;
    warnings: SettlementSimulationPersistedFinding[];
  };

export type LegacySettlementFormulaSimulation =
  SettlementFormulaSimulationBase & {
    summarySchemaVersion: 1;
    summaryComplete: false;
    summaryStatus: "legacy";
    coverage: {
      summarySchemaVersion: 1;
      totalRecords: number;
      evaluatedRecords: number;
      skippedRecords: number;
      uncoveredRecords: null;
      zeroAmountRecords: null;
      reviewRoutedRecords: null;
      blockedRecords: null;
    };
    scenarios: LegacySettlementSimulationScenario[];
    historicalTotals: {
      oldPayableAmountCents: string | null;
      oldReceivableAmountCents: string | null;
      newPayableAmountCents: null;
      newReceivableAmountCents: null;
      recordCount: number;
      verificationStatus: "legacy_unknown";
      payableAmountCents: string | null;
      receivableAmountCents: string | null;
    };
    deltas: SettlementSimulationDeltas;
    warnings: LegacySettlementSimulationWarning[];
  };

export type SettlementFormulaSimulation =
  | CompleteSettlementFormulaSimulation
  | LegacySettlementFormulaSimulation;

export type InsertedSettlementFormulaSimulation =
  CompleteSettlementFormulaSimulation & {
    duplicate: boolean;
  };

export type SettlementAiJsonValue =
  | string
  | number
  | boolean
  | null
  | SettlementAiJsonValue[]
  | { [key: string]: SettlementAiJsonValue };

export type SettlementAiTurnCompletionInput = {
  providerName: string;
  content: string;
  aiInvocationId: string | null;
  metadata: Record<string, SettlementAiJsonValue>;
};

export const SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES = {
  SETTLEMENT_AI_PROVIDER_FAILED:
    "Settlement AI provider is temporarily unavailable.",
  SETTLEMENT_AI_OUTPUT_INVALID: "Settlement AI output did not pass validation.",
  SETTLEMENT_AI_CONTRACT_INVALID:
    "Settlement AI contract did not pass validation.",
  SETTLEMENT_AI_FORMULA_INVALID:
    "Settlement AI formula did not pass validation.",
  invalid_input: "Settlement AI input is invalid.",
  conversation_failed: "Settlement AI conversation failed.",
  conversation_reconciliation_failed:
    "Settlement AI conversation reconciliation failed.",
  catalog_failed: "Settlement AI variable catalog failed.",
  persistence_failed: "Settlement AI persistence failed.",
  draft_not_found: "Settlement AI draft was not found.",
  invalid_transition: "Settlement AI transition is invalid.",
  stale_revision: "Settlement AI draft revision is stale.",
  unresolved_ambiguities: "Settlement AI requires ambiguity resolution.",
  duplicate_confirmation: "Settlement AI confirmation was already processed.",
  contract_hash_mismatch: "Settlement AI contract freshness check failed.",
  catalog_hash_mismatch:
    "Settlement AI variable catalog freshness check failed.",
  formula_hash_mismatch: "Settlement AI formula freshness check failed.",
  evidence_hash_mismatch: "Settlement AI evidence freshness check failed.",
  selection_hash_mismatch: "Settlement AI selection freshness check failed.",
  formula_validation_failed: "Settlement AI formula validation failed.",
  readiness_failed: "Settlement AI data readiness check failed.",
  simulation_failed: "Settlement AI simulation failed.",
  settlement_ai_generation_failed: "Settlement AI generation failed.",
} as const;

export type SettlementAiFailedTurnErrorCode =
  keyof typeof SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES;
export type SettlementAiFailedTurnFailureSemantics = {
  errorCode: SettlementAiFailedTurnErrorCode;
  errorSummary: (typeof SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES)[SettlementAiFailedTurnErrorCode];
  retryable: boolean;
};

export type FinalizeSettlementAiDraftTurnInput = {
  draft: ClarifyingCustomRuleDraftInput | ContractReadyCustomRuleDraftInput;
  completion: SettlementAiTurnCompletionInput;
};

export type FinalizeSettlementAiFailedTurnInput = {
  draft: FailedCustomRuleDraftInput;
  completion: SettlementAiTurnCompletionInput;
} & SettlementAiFailedTurnFailureSemantics;

export type FinalizeSettlementAiSimulationSummaryInput = Omit<
  InsertSettlementFormulaSimulationInput,
  | "organizationId"
  | "projectId"
  | "owner"
  | "formulaHash"
  | "ruleContractHash"
  | "parameterHash"
  | "variableCatalogVersion"
>;

export type FinalizeSettlementAiSimulationTurnInput = {
  draft: ContractReadyCustomRuleDraftInput;
  completion: SettlementAiTurnCompletionInput;
  simulation: FinalizeSettlementAiSimulationSummaryInput;
};

export type FinalizedSettlementAiSimulationTurn = {
  draft: CreatedCustomRuleDraft;
  simulation: InsertedSettlementFormulaSimulation;
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

export type CustomRuleLifecycleSource =
  | { kind: "ai_draft"; id: string }
  | { kind: "saved_draft"; id: string };

export type ApplyAndSubmitCustomRuleInput = {
  organizationId: string;
  projectId: string;
  source: CustomRuleLifecycleSource;
  sourceSimulationId: string;
  destinationVersionId: string;
  destinationSimulationId: string;
  scope: CustomRuleScope;
  target: CustomRuleTarget;
  effectiveFrom: string;
  reason: string;
  clientRequestId: string;
  submissionEventType?: "submitted" | "resubmitted";
};

export type CustomRuleDraftPayload = {
  priority: number;
  formula: string;
  compiledAst: NormalizedAstNode;
  variables: SettlementAiJsonValue[];
  parameters: Record<string, SettlementAiJsonValue>;
  ruleContract: BusinessRuleContract;
  systemExplanationTemplate: string;
  missingDataPolicy: Record<string, SettlementAiJsonValue>;
  testCases: SettlementAiJsonValue[];
  formulaHash: string;
  contractHash: string;
  parameterHash: string;
  catalogHash: string;
  dataSelectionHash: string;
};

export type SaveCustomRuleDraftInput = {
  organizationId: string;
  projectId: string;
  sourceAiDraftId: string | null;
  sourceSimulationId: string;
  ruleVersionId: string;
  versionSimulationId: string;
  scope: CustomRuleScope;
  target: CustomRuleTarget;
  draft: CustomRuleDraftPayload;
  reason: string;
  clientRequestId: string;
};

export type CustomRuleReviewTransitionInput = {
  organizationId: string;
  projectId: string;
  ruleVersionId: string;
  reason: string;
  clientRequestId: string;
};

export type RequestCustomRuleChangesInput = CustomRuleReviewTransitionInput & {
  comment: string;
};

export type CustomRuleActivationFailureInput =
  CustomRuleReviewTransitionInput & {
    errorMessage: string;
  };

export type ApproveCustomRuleRepositoryInput =
  CustomRuleReviewTransitionInput & {
    effectiveFrom: string;
    riskSummary: Record<string, SettlementAiJsonValue>;
  };

export type ForceApproveCustomRuleRepositoryInput =
  ApproveCustomRuleRepositoryInput & {
    acknowledgment: string;
  };

export type ArchiveCustomRuleRepositoryInput =
  CustomRuleReviewTransitionInput & {
    effectiveUntil: string;
    fallbackProof: {
      simulationId: string;
      proofKind: "remaining_custom_layers" | "fixed_fallback";
      remainingCustomLayerCount: number;
      fixedFallbackAvailable: boolean;
      lockedBatchCount: number;
      lockedBatchExclusion: {
        excluded: true;
        lockedBatchCount: number;
      };
    };
  };

export type ListCustomRulesInput = {
  organizationId: string;
  projectId: string;
  status?: CustomRuleVersionStatus;
};

export type ListCustomRuleReviewEventsInput = {
  organizationId: string;
  projectId: string;
  ruleVersionId: string;
};

export type CreateSettlementRuleGroupInput = {
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  reason: string;
  clientRequestId: string;
};

export type ListSettlementRuleGroupsInput = {
  organizationId: string;
  projectId: string;
  includeArchived?: boolean;
};

export type ArchiveSettlementRuleGroupInput = {
  organizationId: string;
  projectId: string;
  groupId: string;
  archivedAt: string;
  reason: string;
  clientRequestId: string;
};

export type ChangeSettlementGroupAssignmentInput = {
  organizationId: string;
  projectId: string;
  projectStreamerId: string;
  groupId: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  clientRequestId: string;
};

export type SettlementRuleGroup = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
  assignmentCount: number;
  activeRuleCount: number;
  pendingRuleCount: number;
  futureAssignmentCount: number;
};

export type ProjectStreamerSettlementGroupAssignment = {
  id: string;
  organizationId: string;
  projectId: string;
  projectStreamerId: string;
  groupId: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  assignedBy: string;
  reason: string;
  createdAt: string;
};

export type SettlementGroupAssignmentChangeResult = {
  insertedAssignment: ProjectStreamerSettlementGroupAssignment;
  closedAssignmentIds: string[];
  newGroupSnapshotHash: SettlementGroupMembershipSnapshot["snapshotHash"];
};

export type CustomSettlementRuleVersion = z.infer<
  typeof customSettlementRuleVersionSchema
>;
export type CustomSettlementRuleReviewEvent = z.infer<
  typeof customSettlementRuleReviewEventSchema
>;
export type CustomRuleLifecycleResult = {
  version: CustomSettlementRuleVersion;
  simulation: CompleteSettlementFormulaSimulation;
  event: CustomSettlementRuleReviewEvent | null;
};
export type SavedCustomRuleDraftResult = Omit<
  CustomRuleLifecycleResult,
  "event"
>;

export type CustomRuleRepository = CustomRuleReadRepository & {
  finalizeDraftTurn(
    input: FinalizeSettlementAiDraftTurnInput,
  ): Promise<CreatedCustomRuleDraft>;
  finalizeSimulationTurn(
    input: FinalizeSettlementAiSimulationTurnInput,
  ): Promise<FinalizedSettlementAiSimulationTurn>;
  finalizeFailedTurn(
    input: FinalizeSettlementAiFailedTurnInput,
  ): Promise<CreatedCustomRuleDraft>;
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
  applyAndSubmitCustomRule(
    input: ApplyAndSubmitCustomRuleInput,
  ): Promise<CustomRuleLifecycleResult>;
  saveCustomRuleDraft(
    input: SaveCustomRuleDraftInput,
  ): Promise<SavedCustomRuleDraftResult>;
  requestCustomRuleChanges(
    input: RequestCustomRuleChangesInput,
  ): Promise<CustomRuleLifecycleResult>;
  reopenRequestedChangesAsDraft(
    input: CustomRuleReviewTransitionInput,
  ): Promise<CustomRuleLifecycleResult>;
  resubmitCustomRule(
    input: ApplyAndSubmitCustomRuleInput,
  ): Promise<CustomRuleLifecycleResult>;
  approveCustomRule(
    input: ApproveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult>;
  forceApproveCustomRule(
    input: ForceApproveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult>;
  recordCustomRuleActivationFailure(
    input: CustomRuleActivationFailureInput,
  ): Promise<CustomRuleLifecycleResult>;
  archiveCustomRule(
    input: ArchiveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult>;
  listCustomRules(
    input: ListCustomRulesInput,
  ): Promise<CustomSettlementRuleVersion[]>;
  listCustomRuleReviewEvents(
    input: ListCustomRuleReviewEventsInput,
  ): Promise<CustomSettlementRuleReviewEvent[]>;
  createSettlementRuleGroup(
    input: CreateSettlementRuleGroupInput,
  ): Promise<SettlementRuleGroup>;
  listSettlementRuleGroups(
    input: ListSettlementRuleGroupsInput,
  ): Promise<SettlementRuleGroup[]>;
  archiveSettlementRuleGroup(
    input: ArchiveSettlementRuleGroupInput,
  ): Promise<SettlementRuleGroup>;
  changeSettlementGroupAssignment(
    input: ChangeSettlementGroupAssignmentInput,
  ): Promise<SettlementGroupAssignmentChangeResult>;
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

  constructor(
    readonly source: CoverageSource,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = "CustomRuleCoverageCountError";
  }
}

export class CustomRuleCoverageLimitError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_LIMIT_EXCEEDED";

  constructor(
    readonly source: CoverageSource,
    readonly limit: number,
  ) {
    super(`${source}: exact row count exceeds the bounded limit of ${limit}`);
    this.name = "CustomRuleCoverageLimitError";
  }
}

export class CustomRuleCoveragePageError extends Error {
  readonly code = "CUSTOM_RULE_COVERAGE_PAGE_INVALID";

  constructor(
    readonly source: CoverageSource,
    message: string,
  ) {
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

  constructor(
    readonly entity:
      | "draft"
      | "simulation"
      | "lifecycle"
      | "group"
      | "assignment",
    message: string,
  ) {
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
  "initial_status",
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
  .refine(
    (value) => value.trim().length > 0,
    "must contain non-whitespace text",
  );
const hashSchema = z.string().regex(SHA256_PATTERN);
const timestampSchema = z
  .string()
  .refine(
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
const postgresBigintDecimalSchema = z.string().refine((value) => {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed >= POSTGRES_BIGINT_MIN && parsed <= POSTGRES_BIGINT_MAX;
  } catch {
    return false;
  }
}, "must be a canonical Postgres bigint decimal string");
const nonnegativePostgresBigintDecimalSchema =
  postgresBigintDecimalSchema.refine(
    (value) => !value.startsWith("-"),
    "must be a nonnegative canonical Postgres bigint decimal string",
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
  inputs: z.record(
    z.string().regex(IDENTIFIER_PATTERN),
    typedRuntimeValueSchema,
  ),
  expectedResult: typedRuntimeValueSchema,
});
const safetyFlagSchema = z.strictObject({
  code: nonemptyTextSchema.max(120),
  severity: z.enum(["info", "warning", "block"]),
  message: boundedTextSchema,
});
const CREATE_DRAFT_COMMON_INPUT_SHAPE = {
  organizationId: uuidSchema,
  projectId: uuidSchema,
  conversationId: uuidSchema,
  idempotencyKey: nonemptyTextSchema.max(200),
  promptText: boundedTextSchema.max(100_000),
  turnTrace: turnTraceSchema,
  businessContract: businessRuleContractSchema,
  variableCatalogVersion: hashSchema,
  aiResponse: aiResponseSchema,
  model: nonemptyTextSchema.max(200),
  safetyFlags: z.array(safetyFlagSchema).max(100),
  contractHash: hashSchema,
  parameterHash: hashSchema,
};
const clarifyingDraftInputSchema = z.strictObject({
  ...CREATE_DRAFT_COMMON_INPUT_SHAPE,
  status: z.literal("clarifying"),
  unresolvedAmbiguities: z.array(unresolvedAmbiguitySchema).min(1).max(100),
  generatedFormula: z.null(),
  generatedExplanation: z.null(),
  generatedTestCases: z.tuple([]),
  formulaHash: z.null(),
});
const contractReadyDraftInputSchema = z.strictObject({
  ...CREATE_DRAFT_COMMON_INPUT_SHAPE,
  status: z.literal("contract_ready"),
  unresolvedAmbiguities: z.tuple([]),
  generatedFormula: generatedFormulaSchema,
  generatedExplanation: boundedTextSchema.max(100_000),
  generatedTestCases: z.array(generatedTestCaseSchema).min(1).max(200),
  formulaHash: hashSchema,
});
const failedDraftInputSchema = z.strictObject({
  ...CREATE_DRAFT_COMMON_INPUT_SHAPE,
  status: z.literal("failed"),
  unresolvedAmbiguities: z.array(unresolvedAmbiguitySchema).max(100),
  generatedFormula: z.null(),
  generatedExplanation: z.null(),
  generatedTestCases: z.tuple([]),
  formulaHash: z.null(),
});
const createDraftInputSchema = z.discriminatedUnion("status", [
  clarifyingDraftInputSchema,
  contractReadyDraftInputSchema,
  failedDraftInputSchema,
]);
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
const legacySimulationCoverageSchema = z
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
const simulationCoverageSchema = z
  .strictObject({
    summarySchemaVersion: z.literal(2),
    totalRecords: nonnegativeSafeIntegerSchema,
    evaluatedRecords: nonnegativeSafeIntegerSchema,
    skippedRecords: nonnegativeSafeIntegerSchema,
    uncoveredRecords: nonnegativeSafeIntegerSchema,
    zeroAmountRecords: nonnegativeSafeIntegerSchema,
    reviewRoutedRecords: nonnegativeSafeIntegerSchema,
    blockedRecords: nonnegativeSafeIntegerSchema,
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
    if (coverageValue.uncoveredRecords > coverageValue.totalRecords) {
      context.addIssue({
        code: "custom",
        path: ["uncoveredRecords"],
        message: "uncoveredRecords cannot exceed totalRecords",
      });
    }
    if (coverageValue.zeroAmountRecords > coverageValue.evaluatedRecords) {
      context.addIssue({
        code: "custom",
        path: ["zeroAmountRecords"],
        message: "zeroAmountRecords cannot exceed evaluatedRecords",
      });
    }
    if (
      coverageValue.reviewRoutedRecords + coverageValue.blockedRecords !==
      coverageValue.skippedRecords
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewRoutedRecords"],
        message: "review-routed and blocked records must equal skippedRecords",
      });
    }
  });
const legacySimulationScenarioSchema = z.strictObject({
  name: nonemptyTextSchema.max(200),
  kind: z.enum(["normal", "boundary", "missing_data"]),
  result: z.enum(["passed", "warning", "failed"]),
});
const simulationScenarioSchema = z
  .strictObject({
    id: nonemptyTextSchema.max(120),
    category: z.enum([
      "zero",
      "threshold_edge",
      "configured_maximum",
      "evidence_level",
      "missing_data_policy",
      "contract_example",
      "ai_test_case",
      "user_example",
    ]),
    outcome: z.enum(["calculated", "review_routed", "blocked"]),
    amountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
    expectedAmountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
    passed: z.boolean(),
  })
  .superRefine((scenario, context) => {
    if (
      (scenario.outcome === "calculated") !==
      (scenario.amountCents !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["amountCents"],
        message:
          "calculated scenarios require an amount; routed scenarios forbid it",
      });
    }
  });
const legacyHistoricalTotalsSchema = z.strictObject({
  payableAmountCents: postgresBigintDecimalSchema.nullable(),
  receivableAmountCents: postgresBigintDecimalSchema.nullable(),
  recordCount: nonnegativeSafeIntegerSchema,
});
const historicalTotalsSchema = z.strictObject({
  oldPayableAmountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
  oldReceivableAmountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
  newPayableAmountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
  newReceivableAmountCents: nonnegativePostgresBigintDecimalSchema.nullable(),
  recordCount: nonnegativeSafeIntegerSchema,
  verificationStatus: z.enum(["verified", "unverified"]),
});
const legacySimulationDeltasSchema = z.strictObject({
  payableAmountCents: postgresBigintDecimalSchema,
  receivableAmountCents: postgresBigintDecimalSchema,
  percentageBps: signedSafeIntegerSchema,
});
const simulationDeltasSchema = z.strictObject({
  payableAmountCents: postgresBigintDecimalSchema.nullable(),
  receivableAmountCents: postgresBigintDecimalSchema.nullable(),
  percentageBps: signedSafeIntegerSchema.nullable(),
  marginImpactCents: postgresBigintDecimalSchema.nullable(),
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
const persistedSimulationFindingSchema = simulationWarningSchema.extend({
  kind: z.enum(["warning", "risk"]),
});
const persistedSimulationFindingInputSchema = simulationWarningSchema.extend({
  kind: z.enum(["warning", "risk"]).default("warning"),
});
const SIMULATION_SUMMARY_INPUT_SHAPE = {
  idempotencyKey: nonemptyTextSchema.max(200),
  dataSelectionHash: hashSchema,
  sampleSource: sampleSourceSchema,
  sampleSelection: sampleSelectionSchema,
  coverage: simulationCoverageSchema,
  scenarios: z.array(simulationScenarioSchema).min(1).max(200),
  historicalTotals: historicalTotalsSchema,
  deltas: simulationDeltasSchema,
  largestChanges: z.array(largestChangeSchema).max(100),
  warnings: z.array(persistedSimulationFindingInputSchema).max(100),
};
const insertSimulationInputSchema = z
  .strictObject({
    organizationId: uuidSchema,
    projectId: uuidSchema,
    owner: simulationOwnerSchema,
    formulaHash: hashSchema,
    ruleContractHash: hashSchema,
    parameterHash: hashSchema,
    variableCatalogVersion: hashSchema,
    ...SIMULATION_SUMMARY_INPUT_SHAPE,
  })
  .superRefine(validateSimulationV2SummaryConsistency)
  .superRefine((input, context) => {
    if (input.owner.kind === "rule_version") {
      context.addIssue({
        code: "custom",
        path: ["owner"],
        message: "rule-version simulation writes are not enabled in Phase 1",
      });
    }
  });
const jsonValueSchema: z.ZodType<SettlementAiJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const customRuleScopeSchema = z.enum(CUSTOM_RULE_SCOPES);
const customRuleTargetSchema = z.discriminatedUnion("targetType", [
  z.strictObject({ targetType: z.literal("project"), targetId: z.null() }),
  z.strictObject({
    targetType: z.literal("streamer_group"),
    targetId: uuidSchema,
  }),
  z.strictObject({
    targetType: z.literal("project_streamer"),
    targetId: uuidSchema,
  }),
]);
const lifecycleSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ai_draft"), id: uuidSchema }),
  z.strictObject({ kind: z.literal("saved_draft"), id: uuidSchema }),
]);
const applyAndSubmitCustomRuleInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  source: lifecycleSourceSchema,
  sourceSimulationId: uuidSchema,
  destinationVersionId: uuidSchema,
  destinationSimulationId: uuidSchema,
  scope: customRuleScopeSchema,
  target: customRuleTargetSchema,
  effectiveFrom: timestampSchema,
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
  submissionEventType: z.enum(["submitted", "resubmitted"]).optional(),
});
const customRuleDraftPayloadSchema = z.strictObject({
  priority: nonnegativeSafeIntegerSchema.max(1_000_000),
  formula: boundedTextSchema,
  compiledAst: normalizedAstNodeSchema,
  variables: z.array(jsonValueSchema),
  parameters: z.record(z.string(), jsonValueSchema),
  ruleContract: businessRuleContractSchema,
  systemExplanationTemplate: boundedTextSchema,
  missingDataPolicy: z.record(z.string(), jsonValueSchema),
  testCases: z.array(jsonValueSchema),
  formulaHash: hashSchema,
  contractHash: hashSchema,
  parameterHash: hashSchema,
  catalogHash: hashSchema,
  dataSelectionHash: hashSchema,
});
const saveCustomRuleDraftInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  sourceAiDraftId: uuidSchema.nullable(),
  sourceSimulationId: uuidSchema,
  ruleVersionId: uuidSchema,
  versionSimulationId: uuidSchema,
  scope: customRuleScopeSchema,
  target: customRuleTargetSchema,
  draft: customRuleDraftPayloadSchema,
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
});
const customRuleReviewTransitionInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  ruleVersionId: uuidSchema,
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
});
const requestCustomRuleChangesInputSchema =
  customRuleReviewTransitionInputSchema.extend({ comment: boundedTextSchema });
const customRuleActivationFailureInputSchema =
  customRuleReviewTransitionInputSchema.extend({
    errorMessage: boundedTextSchema,
  });
const approveCustomRuleRepositoryInputSchema =
  customRuleReviewTransitionInputSchema.extend({
    effectiveFrom: timestampSchema,
    riskSummary: z.record(z.string(), jsonValueSchema),
  });
const forceApproveCustomRuleRepositoryInputSchema =
  approveCustomRuleRepositoryInputSchema.extend({
    acknowledgment: boundedTextSchema,
  });
const archiveCustomRuleRepositoryInputSchema =
  customRuleReviewTransitionInputSchema.extend({
    effectiveUntil: timestampSchema,
    fallbackProof: z.strictObject({
      simulationId: uuidSchema,
      proofKind: z.enum(["remaining_custom_layers", "fixed_fallback"]),
      remainingCustomLayerCount: nonnegativeSafeIntegerSchema,
      fixedFallbackAvailable: z.boolean(),
      lockedBatchCount: nonnegativeSafeIntegerSchema,
      lockedBatchExclusion: z.strictObject({
        excluded: z.literal(true),
        lockedBatchCount: nonnegativeSafeIntegerSchema,
      }),
    }),
  });
const listCustomRulesInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  status: z.enum(CUSTOM_RULE_VERSION_STATUSES).optional(),
});
const listCustomRuleReviewEventsInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  ruleVersionId: uuidSchema,
});
const createSettlementRuleGroupInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  name: nonemptyTextSchema.max(120),
  description: boundedTextSchema.max(2_000).nullable(),
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
});
const listSettlementRuleGroupsInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  includeArchived: z.boolean().optional(),
});
const archiveSettlementRuleGroupInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  groupId: uuidSchema,
  archivedAt: timestampSchema,
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
});
const changeSettlementGroupAssignmentInputSchema = z.strictObject({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  projectStreamerId: uuidSchema,
  groupId: uuidSchema,
  effectiveFrom: timestampSchema,
  effectiveUntil: timestampSchema.nullable(),
  reason: boundedTextSchema,
  clientRequestId: nonemptyTextSchema.max(120),
});
const turnCompletionInputSchema = z.strictObject({
  providerName: nonemptyTextSchema.max(200),
  content: preservedBoundedTextSchema,
  aiInvocationId: uuidSchema.nullable(),
  metadata: z.record(z.string(), jsonValueSchema),
});
const failedTurnErrorCodeSchema = z.enum(
  Object.keys(SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES) as [
    SettlementAiFailedTurnErrorCode,
    ...SettlementAiFailedTurnErrorCode[],
  ],
);
const finalizeDraftTurnInputSchema = z
  .strictObject({
    draft: z.union([clarifyingDraftInputSchema, contractReadyDraftInputSchema]),
    completion: turnCompletionInputSchema,
  })
  .superRefine(validateAtomicCompletionContent);
const finalizeFailedTurnInputSchema = z
  .strictObject({
    draft: failedDraftInputSchema,
    completion: turnCompletionInputSchema,
    errorCode: failedTurnErrorCodeSchema,
    errorSummary: z.string().min(1).max(120),
    retryable: z.boolean(),
  })
  .superRefine(validateAtomicCompletionContent)
  .superRefine((input, context) => {
    if (
      input.errorSummary !==
      SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES[input.errorCode]
    ) {
      context.addIssue({
        code: "custom",
        path: ["errorSummary"],
        message: "must match the allowlisted summary for errorCode",
      });
    }
  });
const finalizeSimulationSummaryInputSchema = z
  .strictObject(SIMULATION_SUMMARY_INPUT_SHAPE)
  .superRefine(validateSimulationV2SummaryConsistency);
const finalizeSimulationTurnInputSchema = z
  .strictObject({
    draft: contractReadyDraftInputSchema,
    completion: turnCompletionInputSchema,
    simulation: finalizeSimulationSummaryInputSchema,
  })
  .superRefine(validateAtomicCompletionContent);
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

function validateSimulationV2SummaryConsistency(
  input: {
    sampleSource: SettlementSimulationSampleSource;
    sampleSelection: SettlementSimulationSampleSelection;
    coverage: SettlementSimulationCoverage;
    scenarios: SettlementSimulationScenario[];
    historicalTotals: SettlementSimulationHistoricalTotals;
    deltas: SettlementSimulationDeltas;
    warnings: SettlementSimulationPersistedFindingInput[];
  },
  context: z.RefinementCtx,
): void {
  const issue = (path: PropertyKey[], message: string): void => {
    context.addIssue({ code: "custom", path, message });
  };
  if (input.sampleSelection.sampledCount !== input.coverage.totalRecords) {
    issue(
      ["sampleSelection", "sampledCount"],
      "sampledCount must equal coverage.totalRecords",
    );
  }
  if (input.historicalTotals.recordCount !== input.coverage.totalRecords) {
    issue(
      ["historicalTotals", "recordCount"],
      "recordCount must equal coverage.totalRecords",
    );
  }

  const totals = input.historicalTotals;
  const deltas = input.deltas;
  const payableActive = totals.newPayableAmountCents !== null;
  const receivableActive = totals.newReceivableAmountCents !== null;
  if (payableActive === receivableActive) {
    issue(
      ["historicalTotals"],
      "exactly one new payable or receivable total is required",
    );
    return;
  }

  if (totals.verificationStatus === "unverified") {
    if (
      totals.oldPayableAmountCents !== null ||
      totals.oldReceivableAmountCents !== null
    ) {
      issue(
        ["historicalTotals"],
        "unverified summaries must keep both old totals null",
      );
    }
    if (
      deltas.payableAmountCents !== null ||
      deltas.receivableAmountCents !== null ||
      deltas.percentageBps !== null ||
      deltas.marginImpactCents !== null
    ) {
      issue(["deltas"], "unverified summaries must keep every delta null");
    }
  } else {
    const oldAmount = payableActive
      ? totals.oldPayableAmountCents
      : totals.oldReceivableAmountCents;
    const newAmount = payableActive
      ? totals.newPayableAmountCents
      : totals.newReceivableAmountCents;
    const deltaAmount = payableActive
      ? deltas.payableAmountCents
      : deltas.receivableAmountCents;
    const inactiveOldAmount = payableActive
      ? totals.oldReceivableAmountCents
      : totals.oldPayableAmountCents;
    const inactiveDeltaAmount = payableActive
      ? deltas.receivableAmountCents
      : deltas.payableAmountCents;
    if (
      input.sampleSource.kind === "synthetic_scenarios" ||
      totals.recordCount === 0 ||
      oldAmount === null ||
      newAmount === null ||
      deltaAmount === null ||
      deltas.percentageBps === null ||
      deltas.marginImpactCents === null ||
      inactiveOldAmount !== null ||
      inactiveDeltaAmount !== null
    ) {
      issue(
        ["historicalTotals"],
        "verified summaries require one complete active comparison",
      );
    } else {
      const oldValue = BigInt(oldAmount);
      const newValue = BigInt(newAmount);
      const deltaValue = BigInt(deltaAmount);
      if (newValue - oldValue !== deltaValue) {
        issue(["deltas"], "active delta must equal new total minus old total");
      }
      const expectedMargin = payableActive ? -deltaValue : deltaValue;
      if (BigInt(deltas.marginImpactCents) !== expectedMargin) {
        issue(
          ["deltas", "marginImpactCents"],
          "margin impact must match the active settlement scope",
        );
      }
      const expectedPercentage =
        oldValue === BigInt(0)
          ? BigInt(0)
          : (deltaValue * BigInt(10_000)) /
            (oldValue < BigInt(0) ? -oldValue : oldValue);
      if (BigInt(deltas.percentageBps) !== expectedPercentage) {
        issue(
          ["deltas", "percentageBps"],
          "percentageBps must match the checked active comparison",
        );
      }
    }
  }

  if (
    new Set(input.scenarios.map((scenario) => scenario.id)).size !==
    input.scenarios.length
  ) {
    issue(["scenarios"], "scenario ids must be unique");
  }
  const findingKeys = input.warnings.map(
    (finding) => `${finding.kind ?? "warning"}\u0000${finding.code}`,
  );
  if (new Set(findingKeys).size !== findingKeys.length) {
    issue(["warnings"], "finding kind and code pairs must be unique");
  }
}

const DRAFT_ROW_COMMON_SHAPE = {
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  conversation_id: uuidSchema,
  prompt_text: boundedTextSchema.max(100_000),
  turn_trace: turnTraceSchema,
  business_contract: businessRuleContractSchema,
  variable_catalog_version: hashSchema,
  ai_response: aiResponseSchema,
  model: nonemptyTextSchema.max(200),
  safety_flags: z.array(safetyFlagSchema).max(100),
  contract_hash: hashSchema,
  parameter_hash: hashSchema,
  revision_number: z.number().int().positive().refine(Number.isSafeInteger),
  idempotency_key: nonemptyTextSchema.max(200),
  created_by: uuidSchema,
  created_at: timestampSchema,
  supersedes_draft_id: uuidSchema.nullable(),
};
const CLARIFYING_DRAFT_ROW_SHAPE = {
  initial_status: z.literal("clarifying"),
  unresolved_ambiguities: z.array(unresolvedAmbiguitySchema).min(1).max(100),
  generated_formula: z.null(),
  generated_explanation: z.null(),
  generated_test_cases: z.tuple([]),
  formula_hash: z.null(),
};
const FAILED_DRAFT_ROW_SHAPE = {
  initial_status: z.literal("failed"),
  unresolved_ambiguities: z.array(unresolvedAmbiguitySchema).max(100),
  generated_formula: z.null(),
  generated_explanation: z.null(),
  generated_test_cases: z.tuple([]),
  formula_hash: z.null(),
};
const READY_DRAFT_ROW_SHAPE = {
  initial_status: z.literal("contract_ready"),
  unresolved_ambiguities: z.tuple([]),
  generated_formula: generatedFormulaSchema,
  generated_explanation: boundedTextSchema.max(100_000),
  generated_test_cases: z.array(generatedTestCaseSchema).min(1).max(200),
  formula_hash: hashSchema,
};
const SUPERSEDED_DRAFT_ROW_SHAPE = {
  status: z.literal("superseded"),
  superseded_by_draft_id: uuidSchema,
  superseded_at: timestampSchema,
};
const ACTIVE_DRAFT_ROW_SHAPE = {
  superseded_by_draft_id: z.null(),
  superseded_at: z.null(),
};

const clarifyingDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...CLARIFYING_DRAFT_ROW_SHAPE,
  ...ACTIVE_DRAFT_ROW_SHAPE,
  status: z.literal("clarifying"),
});
const supersededClarifyingDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...CLARIFYING_DRAFT_ROW_SHAPE,
  ...SUPERSEDED_DRAFT_ROW_SHAPE,
});
const failedDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...FAILED_DRAFT_ROW_SHAPE,
  ...ACTIVE_DRAFT_ROW_SHAPE,
  status: z.literal("failed"),
});
const supersededFailedDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...FAILED_DRAFT_ROW_SHAPE,
  ...SUPERSEDED_DRAFT_ROW_SHAPE,
});
const readyDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...READY_DRAFT_ROW_SHAPE,
  ...ACTIVE_DRAFT_ROW_SHAPE,
  status: z.enum(["contract_ready", "simulated"]),
});
const supersededReadyDraftRowSchema = z.strictObject({
  ...DRAFT_ROW_COMMON_SHAPE,
  ...READY_DRAFT_ROW_SHAPE,
  ...SUPERSEDED_DRAFT_ROW_SHAPE,
});
const DRAFT_ROW_SCHEMAS = [
  clarifyingDraftRowSchema,
  supersededClarifyingDraftRowSchema,
  failedDraftRowSchema,
  supersededFailedDraftRowSchema,
  readyDraftRowSchema,
  supersededReadyDraftRowSchema,
] as const;
const draftRowSchema = z.union(DRAFT_ROW_SCHEMAS);
const CREATED_DRAFT_ROW_SHAPE = {
  request_fingerprint: hashSchema,
  duplicate: z.boolean(),
};
const createdDraftRowSchema = z.union([
  clarifyingDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededClarifyingDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  failedDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededFailedDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  readyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededReadyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
]);
const createdSuccessfulDraftRowSchema = z.union([
  clarifyingDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededClarifyingDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  readyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededReadyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
]);
const createdFailedDraftRowSchema = z.union([
  failedDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  supersededFailedDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
]);
const SIMULATION_ROW_BASE_SHAPE = {
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
  largest_changes: z.array(largestChangeSchema).max(100),
  idempotency_key: nonemptyTextSchema.max(200),
  created_by: uuidSchema,
  created_at: timestampSchema,
};
const LEGACY_SIMULATION_ROW_SHAPE = {
  ...SIMULATION_ROW_BASE_SHAPE,
  coverage: legacySimulationCoverageSchema,
  scenarios: z.array(legacySimulationScenarioSchema).min(1).max(200),
  historical_totals: legacyHistoricalTotalsSchema,
  deltas: legacySimulationDeltasSchema,
  warnings: z.array(simulationWarningSchema).max(100),
};
const COMPLETE_SIMULATION_ROW_SHAPE = {
  ...SIMULATION_ROW_BASE_SHAPE,
  coverage: simulationCoverageSchema,
  scenarios: z.array(simulationScenarioSchema).min(1).max(200),
  historical_totals: historicalTotalsSchema,
  deltas: simulationDeltasSchema,
  warnings: z.array(persistedSimulationFindingSchema).max(100),
};
const legacySimulationRowSchema = z
  .strictObject(LEGACY_SIMULATION_ROW_SHAPE)
  .superRefine(validateSimulationRowOwner);
const completeSimulationRowSchema = z
  .strictObject(COMPLETE_SIMULATION_ROW_SHAPE)
  .superRefine(validateSimulationRowOwner)
  .superRefine((row, context) => {
    validateSimulationV2SummaryConsistency(
      {
        sampleSource: row.sample_source,
        sampleSelection: row.sample_selection,
        coverage: row.coverage,
        scenarios: row.scenarios,
        historicalTotals: row.historical_totals,
        deltas: row.deltas,
        warnings: row.warnings,
      },
      context,
    );
  });
const simulationRowSchema = z.union([
  completeSimulationRowSchema,
  legacySimulationRowSchema,
]);
const insertedSimulationRowSchema = z
  .strictObject({
    ...COMPLETE_SIMULATION_ROW_SHAPE,
    duplicate: z.boolean(),
  })
  .superRefine(validateSimulationRowOwner)
  .superRefine((row, context) => {
    validateSimulationV2SummaryConsistency(
      {
        sampleSource: row.sample_source,
        sampleSelection: row.sample_selection,
        coverage: row.coverage,
        scenarios: row.scenarios,
        historicalTotals: row.historical_totals,
        deltas: row.deltas,
        warnings: row.warnings,
      },
      context,
    );
  });
const finalizedSimulationTurnRowSchema = z.strictObject({
  draft: z.union([
    readyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
    supersededReadyDraftRowSchema.extend(CREATED_DRAFT_ROW_SHAPE),
  ]),
  simulation: insertedSimulationRowSchema,
});
const lifecycleVersionRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  scope: z.enum(CUSTOM_RULE_SCOPES),
  target_type: z.enum(CUSTOM_RULE_TARGET_TYPES),
  target_id: uuidSchema.nullable(),
  execution_grain: z.enum(CUSTOM_RULE_EXECUTION_GRAINS),
  composition_mode: z.enum(CUSTOM_RULE_COMPOSITION_MODES),
  priority: nonnegativeSafeIntegerSchema,
  version_number: z.number().int().positive(),
  status: z.enum(CUSTOM_RULE_VERSION_STATUSES),
  formula: boundedTextSchema,
  compiled_ast: normalizedAstNodeSchema,
  variables: z.array(jsonValueSchema),
  parameters: z.record(z.string(), jsonValueSchema),
  rule_contract: businessRuleContractSchema,
  system_explanation_template: boundedTextSchema,
  missing_data_policy: z.record(z.string(), jsonValueSchema),
  test_cases: z.array(jsonValueSchema),
  simulation_summary: z.record(z.string(), jsonValueSchema),
  formula_hash: hashSchema,
  rule_contract_hash: hashSchema,
  parameter_hash: hashSchema,
  variable_catalog_version: hashSchema,
  data_selection_hash: hashSchema,
  simulation_id: uuidSchema,
  effective_from: timestampSchema.nullable(),
  effective_until: timestampSchema.nullable(),
  created_by: uuidSchema,
  approved_by: uuidSchema.nullable(),
  ai_draft_id: uuidSchema.nullable(),
  reason: boundedTextSchema.nullable(),
  created_at: timestampSchema,
  approved_at: timestampSchema.nullable(),
  archived_at: timestampSchema.nullable(),
});
const lifecycleReviewEventRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  rule_version_id: uuidSchema,
  event_type: z.enum([
    "submitted",
    "changes_requested",
    "resubmitted",
    "approved",
    "force_approved",
    "archived",
    "activation_failed",
  ]),
  actor_id: uuidSchema,
  actor_role: z.enum(["owner", "ops_manager", "operator_business", "finance"]),
  reason: boundedTextSchema.nullable(),
  comment: boundedTextSchema.nullable(),
  before_status: z.enum(CUSTOM_RULE_VERSION_STATUSES).nullable(),
  after_status: z.enum(CUSTOM_RULE_VERSION_STATUSES).nullable(),
  risk_summary: z.record(z.string(), jsonValueSchema),
  formula_hash: hashSchema,
  rule_contract_hash: hashSchema,
  parameter_hash: hashSchema,
  variable_catalog_version: hashSchema,
  data_selection_hash: hashSchema,
  created_at: timestampSchema,
});
const lifecycleResultRowSchema = z.strictObject({
  version: lifecycleVersionRowSchema,
  simulation: completeSimulationRowSchema,
  event: lifecycleReviewEventRowSchema.optional().nullable(),
});
const savedDraftResultRowSchema = lifecycleResultRowSchema.omit({
  event: true,
});
const settlementRuleGroupRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  name: nonemptyTextSchema.max(120),
  description: boundedTextSchema.max(2_000).nullable(),
  status: z.enum(["active", "archived"]),
  created_by: uuidSchema,
  created_at: timestampSchema,
  archived_at: timestampSchema.nullable(),
  assignment_count: nonnegativeSafeIntegerSchema.default(0),
  active_rule_count: nonnegativeSafeIntegerSchema.default(0),
  pending_rule_count: nonnegativeSafeIntegerSchema.default(0),
  future_assignment_count: nonnegativeSafeIntegerSchema.default(0),
});
const settlementGroupAssignmentRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  project_id: uuidSchema,
  project_streamer_id: uuidSchema,
  group_id: uuidSchema,
  effective_from: timestampSchema,
  effective_until: timestampSchema.nullable(),
  assigned_by: uuidSchema,
  reason: boundedTextSchema,
  created_at: timestampSchema,
});
const settlementGroupAssignmentChangeRowSchema = z.strictObject({
  inserted_assignment: settlementGroupAssignmentRowSchema,
  closed_assignment_ids: z.array(uuidSchema),
  new_group_snapshot_hash: hashSchema,
});

const LIFECYCLE_VERSION_SELECT = Object.keys(
  lifecycleVersionRowSchema.shape,
).join(", ");
const LIFECYCLE_REVIEW_EVENT_SELECT = Object.keys(
  lifecycleReviewEventRowSchema.shape,
).join(", ");
const SETTLEMENT_RULE_GROUP_SELECT = [
  "id",
  "organization_id",
  "project_id",
  "name",
  "description",
  "status",
  "created_by",
  "created_at",
  "archived_at",
].join(", ");

export const customSettlementRuleVersionSchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  scope: z.enum(CUSTOM_RULE_SCOPES),
  target: customRuleTargetSchema,
  executionGrain: z.enum(CUSTOM_RULE_EXECUTION_GRAINS),
  compositionMode: z.enum(CUSTOM_RULE_COMPOSITION_MODES),
  priority: nonnegativeSafeIntegerSchema,
  versionNumber: z.number().int().positive(),
  status: z.enum(CUSTOM_RULE_VERSION_STATUSES),
  formula: boundedTextSchema,
  compiledAst: normalizedAstNodeSchema,
  variables: z.array(jsonValueSchema),
  parameters: z.record(z.string(), jsonValueSchema),
  ruleContract: businessRuleContractSchema,
  systemExplanationTemplate: boundedTextSchema,
  missingDataPolicy: z.record(z.string(), jsonValueSchema),
  testCases: z.array(jsonValueSchema),
  simulationSummary: z.record(z.string(), jsonValueSchema),
  formulaHash: hashSchema,
  contractHash: hashSchema,
  parameterHash: hashSchema,
  catalogHash: hashSchema,
  dataSelectionHash: hashSchema,
  simulationId: uuidSchema,
  effectiveFrom: timestampSchema.nullable(),
  effectiveUntil: timestampSchema.nullable(),
  createdBy: uuidSchema,
  approvedBy: uuidSchema.nullable(),
  aiDraftId: uuidSchema.nullable(),
  reason: boundedTextSchema.nullable(),
  createdAt: timestampSchema,
  approvedAt: timestampSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});
export const customSettlementRuleReviewEventSchema = z.strictObject({
  id: uuidSchema,
  organizationId: uuidSchema,
  projectId: uuidSchema,
  ruleVersionId: uuidSchema,
  eventType: lifecycleReviewEventRowSchema.shape.event_type,
  actorId: uuidSchema,
  actorRole: lifecycleReviewEventRowSchema.shape.actor_role,
  reason: boundedTextSchema.nullable(),
  comment: boundedTextSchema.nullable(),
  beforeStatus: z.enum(CUSTOM_RULE_VERSION_STATUSES).nullable(),
  afterStatus: z.enum(CUSTOM_RULE_VERSION_STATUSES).nullable(),
  riskSummary: z.record(z.string(), jsonValueSchema),
  formulaHash: hashSchema,
  contractHash: hashSchema,
  parameterHash: hashSchema,
  catalogHash: hashSchema,
  dataSelectionHash: hashSchema,
  createdAt: timestampSchema,
});
type DraftRow = z.infer<typeof draftRowSchema>;
type CreatedDraftRow = z.infer<typeof createdDraftRowSchema>;
type LegacySimulationRow = z.infer<typeof legacySimulationRowSchema>;
type CompleteSimulationRow = z.infer<typeof completeSimulationRowSchema>;
type SimulationRow = z.infer<typeof simulationRowSchema>;
type InsertedSimulationRow = z.infer<typeof insertedSimulationRowSchema>;

export class SupabaseCustomRuleReadRepository implements CustomRuleRepository {
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

  async finalizeDraftTurn(
    unsafeInput: FinalizeSettlementAiDraftTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    assertSafeAtomicDraftTurnInput(unsafeInput);
    const input = parsePersistenceInput(
      finalizeDraftTurnInputSchema,
      unsafeInput,
      "atomic draft turn input",
    );
    const { data, error } = await this.client.rpc(
      "finalize_settlement_ai_draft_turn",
      { p_draft: input.draft, p_completion: input.completion },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("finalize_draft_turn", error);
    }
    const row = parsePersistenceRow(
      createdSuccessfulDraftRowSchema,
      data,
      "draft",
    );
    return { ...toCustomRuleDraft(row), duplicate: row.duplicate };
  }

  async finalizeSimulationTurn(
    unsafeInput: FinalizeSettlementAiSimulationTurnInput,
  ): Promise<FinalizedSettlementAiSimulationTurn> {
    assertSafeAtomicSimulationTurnInput(unsafeInput);
    const input = parsePersistenceInput(
      finalizeSimulationTurnInputSchema,
      unsafeInput,
      "atomic simulation turn input",
    );
    const { data, error } = await this.client.rpc(
      "finalize_settlement_ai_simulation_turn",
      {
        p_draft: input.draft,
        p_completion: input.completion,
        p_simulation: input.simulation,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError(
        "finalize_simulation_turn",
        error,
      );
    }
    const row = parsePersistenceRow(
      finalizedSimulationTurnRowSchema,
      data,
      "simulation",
    );
    return {
      draft: {
        ...toCustomRuleDraft(row.draft),
        duplicate: row.draft.duplicate,
      },
      simulation: {
        ...toSettlementFormulaSimulation(row.simulation),
        duplicate: row.simulation.duplicate,
      },
    };
  }

  async finalizeFailedTurn(
    unsafeInput: FinalizeSettlementAiFailedTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    assertSafeAtomicDraftTurnInput(unsafeInput);
    const input = parsePersistenceInput(
      finalizeFailedTurnInputSchema,
      unsafeInput,
      "atomic failed turn input",
    );
    const { data, error } = await this.client.rpc(
      "finalize_settlement_ai_failed_turn",
      {
        p_draft: input.draft,
        p_completion: input.completion,
        p_error_code: input.errorCode,
        p_error_summary: input.errorSummary,
        p_retryable: input.retryable,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("finalize_failed_turn", error);
    }
    const row = parsePersistenceRow(createdFailedDraftRowSchema, data, "draft");
    return { ...toCustomRuleDraft(row), duplicate: row.duplicate };
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
    const row = parsePersistenceRow(createdDraftRowSchema, data, "draft");
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
      toCustomRuleDraft(parsePersistenceRow(draftRowSchema, row, "draft")),
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
      : toCustomRuleDraft(parsePersistenceRow(draftRowSchema, data, "draft"));
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
        p_ai_draft_id: input.owner.kind === "ai_draft" ? input.owner.id : null,
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

  async applyAndSubmitCustomRule(
    unsafeInput: ApplyAndSubmitCustomRuleInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      applyAndSubmitCustomRuleInputSchema,
      unsafeInput,
      "apply and submit custom rule input",
    );
    const { data, error } = await this.client.rpc(
      "apply_and_submit_custom_settlement_rule",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_source_ai_draft_id:
          input.source.kind === "ai_draft" ? input.source.id : null,
        p_source_rule_version_id:
          input.source.kind === "saved_draft" ? input.source.id : null,
        p_source_simulation_id: input.sourceSimulationId,
        p_rule_version_id: input.destinationVersionId,
        p_version_simulation_id: input.destinationSimulationId,
        p_scope: input.scope,
        p_target_type: input.target.targetType,
        p_target_id: input.target.targetId,
        p_effective_from: input.effectiveFrom,
        p_reason: input.reason,
        p_submission_event_type: input.submissionEventType ?? "submitted",
        p_client_request_id: input.clientRequestId,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("apply_and_submit_rule", error);
    }
    const row = parsePersistenceRow(
      lifecycleResultRowSchema,
      data,
      "lifecycle",
    );
    if (row.event === null || row.event === undefined) {
      throw new CustomRulePersistenceDataError(
        "lifecycle",
        "apply-and-submit result must include a review event",
      );
    }
    return {
      version: toCustomSettlementRuleVersion(row.version),
      simulation: toSettlementFormulaSimulation(row.simulation),
      event: toCustomSettlementRuleReviewEvent(row.event),
    };
  }

  async saveCustomRuleDraft(
    unsafeInput: SaveCustomRuleDraftInput,
  ): Promise<SavedCustomRuleDraftResult> {
    const input = parsePersistenceInput(
      saveCustomRuleDraftInputSchema,
      unsafeInput,
      "save custom rule draft input",
    );
    const { data, error } = await this.client.rpc(
      "save_custom_settlement_rule_draft",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_source_ai_draft_id: input.sourceAiDraftId,
        p_source_simulation_id: input.sourceSimulationId,
        p_rule_version_id: input.ruleVersionId,
        p_version_simulation_id: input.versionSimulationId,
        p_scope: input.scope,
        p_target_type: input.target.targetType,
        p_target_id: input.target.targetId,
        p_draft: input.draft,
        p_reason: input.reason,
        p_client_request_id: input.clientRequestId,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError("save_rule_draft", error);
    }
    const row = parsePersistenceRow(
      savedDraftResultRowSchema,
      data,
      "lifecycle",
    );
    return {
      version: toCustomSettlementRuleVersion(row.version),
      simulation: toSettlementFormulaSimulation(row.simulation),
    };
  }

  async requestCustomRuleChanges(
    unsafeInput: RequestCustomRuleChangesInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      requestCustomRuleChangesInputSchema,
      unsafeInput,
      "request custom rule changes input",
    );
    return this.reviewCustomRule(
      input,
      "request_changes",
      null,
      input.comment,
      false,
      null,
      {},
      "request_rule_changes",
    );
  }

  async reopenRequestedChangesAsDraft(
    unsafeInput: CustomRuleReviewTransitionInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      customRuleReviewTransitionInputSchema,
      unsafeInput,
      "reopen custom rule draft input",
    );
    return this.reviewCustomRule(
      input,
      "reopen",
      null,
      null,
      false,
      null,
      {},
      "reopen_rule_draft",
    );
  }

  async resubmitCustomRule(
    input: ApplyAndSubmitCustomRuleInput,
  ): Promise<CustomRuleLifecycleResult> {
    return this.applyAndSubmitCustomRule({
      ...input,
      submissionEventType: "resubmitted",
    });
  }

  async approveCustomRule(
    unsafeInput: ApproveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      approveCustomRuleRepositoryInputSchema,
      unsafeInput,
      "approve custom rule input",
    );
    return this.reviewCustomRule(
      input,
      "approve",
      input.effectiveFrom,
      null,
      false,
      null,
      input.riskSummary,
      "approve_rule",
    );
  }

  async forceApproveCustomRule(
    unsafeInput: ForceApproveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      forceApproveCustomRuleRepositoryInputSchema,
      unsafeInput,
      "force approve custom rule input",
    );
    return this.reviewCustomRule(
      input,
      "approve",
      input.effectiveFrom,
      null,
      true,
      input.acknowledgment,
      input.riskSummary,
      "force_approve_rule",
    );
  }

  async recordCustomRuleActivationFailure(
    unsafeInput: CustomRuleActivationFailureInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      customRuleActivationFailureInputSchema,
      unsafeInput,
      "record activation failure input",
    );
    return this.reviewCustomRule(
      input,
      "activation_failed",
      null,
      input.errorMessage,
      false,
      null,
      {},
      "record_activation_failure",
    );
  }

  async archiveCustomRule(
    unsafeInput: ArchiveCustomRuleRepositoryInput,
  ): Promise<CustomRuleLifecycleResult> {
    const input = parsePersistenceInput(
      archiveCustomRuleRepositoryInputSchema,
      unsafeInput,
      "archive custom rule input",
    );
    const { data, error } = await this.client.rpc(
      "archive_custom_settlement_rule",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_rule_version_id: input.ruleVersionId,
        p_effective_until: input.effectiveUntil,
        p_reason: input.reason,
        p_fallback_proof: input.fallbackProof,
        p_client_request_id: input.clientRequestId,
      },
    );
    return parseLifecycleRpcResult(data, error, "archive_rule");
  }

  async listCustomRules(
    unsafeInput: ListCustomRulesInput,
  ): Promise<CustomSettlementRuleVersion[]> {
    const input = parsePersistenceInput(
      listCustomRulesInputSchema,
      unsafeInput,
      "list custom rules input",
    );
    let query = this.client
      .from("custom_settlement_rule_versions")
      .select(LIFECYCLE_VERSION_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);
    if (input.status !== undefined) query = query.eq("status", input.status);
    const { data, error } = await query
      .order("version_number", { ascending: false })
      .order("id", { ascending: false })
      .returns<unknown[]>();
    if (error) {
      throw new CustomRulePersistenceQueryError("list_rule_versions", error);
    }
    if (!Array.isArray(data)) {
      throw new CustomRulePersistenceDataError(
        "lifecycle",
        "rule list result must be an array",
      );
    }
    return data.map((row) =>
      toCustomSettlementRuleVersion(
        parsePersistenceRow(lifecycleVersionRowSchema, row, "lifecycle"),
      ),
    );
  }

  async listCustomRuleReviewEvents(
    unsafeInput: ListCustomRuleReviewEventsInput,
  ): Promise<CustomSettlementRuleReviewEvent[]> {
    const input = parsePersistenceInput(
      listCustomRuleReviewEventsInputSchema,
      unsafeInput,
      "list custom rule review events input",
    );
    const { data, error } = await this.client
      .from("custom_settlement_rule_review_events")
      .select(LIFECYCLE_REVIEW_EVENT_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId)
      .eq("rule_version_id", input.ruleVersionId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .returns<unknown[]>();
    if (error) {
      throw new CustomRulePersistenceQueryError("list_review_events", error);
    }
    if (!Array.isArray(data)) {
      throw new CustomRulePersistenceDataError(
        "lifecycle",
        "review event list result must be an array",
      );
    }
    return data.map((row) =>
      toCustomSettlementRuleReviewEvent(
        parsePersistenceRow(lifecycleReviewEventRowSchema, row, "lifecycle"),
      ),
    );
  }

  async createSettlementRuleGroup(
    unsafeInput: CreateSettlementRuleGroupInput,
  ): Promise<SettlementRuleGroup> {
    const input = parsePersistenceInput(
      createSettlementRuleGroupInputSchema,
      unsafeInput,
      "create settlement rule group input",
    );
    const { data, error } = await this.client.rpc(
      "create_settlement_rule_group",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_name: input.name,
        p_description: input.description,
        p_reason: input.reason,
        p_client_request_id: input.clientRequestId,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError(
        "create_settlement_rule_group",
        error,
      );
    }
    return toSettlementRuleGroup(
      parsePersistenceRow(settlementRuleGroupRowSchema, data, "group"),
    );
  }

  async listSettlementRuleGroups(
    unsafeInput: ListSettlementRuleGroupsInput,
  ): Promise<SettlementRuleGroup[]> {
    const input = parsePersistenceInput(
      listSettlementRuleGroupsInputSchema,
      unsafeInput,
      "list settlement rule groups input",
    );
    let query = this.client
      .from("settlement_rule_groups")
      .select(SETTLEMENT_RULE_GROUP_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("project_id", input.projectId);
    if (!input.includeArchived) query = query.eq("status", "active");
    const { data, error } = await query
      .order("status", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .returns<unknown[]>();
    if (error) {
      throw new CustomRulePersistenceQueryError(
        "list_settlement_rule_groups",
        error,
      );
    }
    if (!Array.isArray(data)) {
      throw new CustomRulePersistenceDataError(
        "group",
        "group list result must be an array",
      );
    }
    return data.map((row) =>
      toSettlementRuleGroup(
        parsePersistenceRow(settlementRuleGroupRowSchema, row, "group"),
      ),
    );
  }

  async archiveSettlementRuleGroup(
    unsafeInput: ArchiveSettlementRuleGroupInput,
  ): Promise<SettlementRuleGroup> {
    const input = parsePersistenceInput(
      archiveSettlementRuleGroupInputSchema,
      unsafeInput,
      "archive settlement rule group input",
    );
    const { data, error } = await this.client.rpc(
      "archive_settlement_rule_group",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_group_id: input.groupId,
        p_archived_at: input.archivedAt,
        p_reason: input.reason,
        p_client_request_id: input.clientRequestId,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError(
        "archive_settlement_rule_group",
        error,
      );
    }
    return toSettlementRuleGroup(
      parsePersistenceRow(settlementRuleGroupRowSchema, data, "group"),
    );
  }

  async changeSettlementGroupAssignment(
    unsafeInput: ChangeSettlementGroupAssignmentInput,
  ): Promise<SettlementGroupAssignmentChangeResult> {
    const input = parsePersistenceInput(
      changeSettlementGroupAssignmentInputSchema,
      unsafeInput,
      "change settlement group assignment input",
    );
    const { data, error } = await this.client.rpc(
      "change_settlement_group_assignment",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_project_streamer_id: input.projectStreamerId,
        p_group_id: input.groupId,
        p_effective_from: input.effectiveFrom,
        p_effective_until: input.effectiveUntil,
        p_reason: input.reason,
        p_client_request_id: input.clientRequestId,
      },
    );
    if (error) {
      throw new CustomRulePersistenceQueryError(
        "change_settlement_group_assignment",
        error,
      );
    }
    return toSettlementGroupAssignmentChange(
      parsePersistenceRow(
        settlementGroupAssignmentChangeRowSchema,
        data,
        "assignment",
      ),
    );
  }

  private async reviewCustomRule(
    input: CustomRuleReviewTransitionInput,
    action: "request_changes" | "reopen" | "approve" | "activation_failed",
    effectiveFrom: string | null,
    comment: string | null,
    force: boolean,
    acknowledgment: string | null,
    riskSummary: Record<string, SettlementAiJsonValue>,
    operation: string,
  ): Promise<CustomRuleLifecycleResult> {
    const { data, error } = await this.client.rpc(
      "review_custom_settlement_rule",
      {
        p_organization_id: input.organizationId,
        p_project_id: input.projectId,
        p_rule_version_id: input.ruleVersionId,
        p_action: action,
        p_effective_from: effectiveFrom,
        p_reason: input.reason,
        p_comment: comment,
        p_force: force,
        p_acknowledgment: acknowledgment,
        p_risk_summary: riskSummary,
        p_client_request_id: input.clientRequestId,
      },
    );
    return parseLifecycleRpcResult(data, error, operation);
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
      const snapshot = await this.listSettlementItemChunk(input, batchIdChunk);
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
  const exactCount = validateExactCoverageCount(source, highWaterResult.count);
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

    const expectedPageLength = Math.min(POSTGREST_PAGE_SIZE, remainingCount);
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
  const liveStartedCount = countPresent(
    input.reports,
    (row) => firstRelation(row.live_tasks)?.system_started_at,
  );
  const normalizedByType = (
    itemType: NormalizedCostItemCoverageRow["item_type"],
  ) => input.normalizedCostItems.filter((row) => row.item_type === itemType);
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
    weekday: coverage("weekday", liveStartedCount, reportCount, reportPeriod),
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
    streamer_level: coverage("streamer_level", 0, streamerCount, null),
    streamer_source: coverage(
      "streamer_source",
      countPresent(
        input.projectStreamers,
        (row) => firstRelation(row.streamers)?.source_type,
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
    streamer_group_ids: coverage("streamer_group_ids", 0, streamerCount, null),
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
    manual_adjustment: coverage("manual_adjustment", 0, reportCount, null),
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
    period_sales_amount: coverage("period_sales_amount", 0, reportCount, null),
    period_orders_count: coverage("period_orders_count", 0, reportCount, null),
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
      uniqueNonNullCount(receivableItems.map(({ row }) => row.live_report_id)),
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
      row.live_report_id !== null && approvedReportIds.has(row.live_report_id),
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
    keys.some((key) => typeof key !== "string" || !ALLOWED_INPUT_KEYS.has(key))
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

  const organizationId = nonemptyOwnString(descriptors, "organizationId");
  const projectId = nonemptyOwnString(descriptors, "projectId");
  const periodStart = optionalPeriod(descriptors, "periodStart");
  const periodEnd = optionalPeriod(descriptors, "periodEnd");
  if (periodStart && periodEnd && periodStart > periodEnd) {
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
  const ownerCount =
    Number(row.rule_version_id !== null) + Number(row.ai_draft_id !== null);
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
  entity: "draft" | "simulation" | "lifecycle" | "group" | "assignment",
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
  enforceSubcontainerBudget?: boolean;
};

function validateAtomicCompletionContent(
  input: {
    draft: { aiResponse: { content: string } };
    completion: { content: string };
  },
  context: z.RefinementCtx,
): void {
  if (input.completion.content !== input.draft.aiResponse.content) {
    context.addIssue({
      code: "custom",
      path: ["completion", "content"],
      message: "must exactly match the turn-bound AI response content",
    });
  }
}

function assertSafeAtomicDraftTurnInput(value: unknown): void {
  const draft = getRequiredOwnDataValue(value, "atomic turn input", "draft");
  const completion = getRequiredOwnDataValue(
    value,
    "atomic turn input",
    "completion",
  );
  assertSafeDraftPayloadInput(draft);
  assertSafeCompletionInput(completion);
  assertJsonCollectionWithinBudget(
    [jsonBudgetRoot(draft, "draft"), jsonBudgetRoot(completion, "completion")],
    {
      forbiddenKeys: FORBIDDEN_DRAFT_JSON_KEYS,
      enforceSubcontainerBudget: false,
    },
  );
}

function assertSafeAtomicSimulationTurnInput(value: unknown): void {
  const draft = getRequiredOwnDataValue(
    value,
    "atomic simulation turn input",
    "draft",
  );
  const completion = getRequiredOwnDataValue(
    value,
    "atomic simulation turn input",
    "completion",
  );
  const simulation = getRequiredOwnDataValue(
    value,
    "atomic simulation turn input",
    "simulation",
  );
  assertSafeDraftPayloadInput(draft);
  assertSafeCompletionInput(completion);
  assertSafeSimulationSummaryInput(simulation);
  assertJsonCollectionWithinBudget(
    [
      jsonBudgetRoot(draft, "draft"),
      jsonBudgetRoot(completion, "completion"),
      jsonBudgetRoot(simulation, "simulation"),
    ],
    {
      forbiddenKeys: FORBIDDEN_DRAFT_JSON_KEYS,
      enforceSubcontainerBudget: false,
    },
  );
}

function assertSafeCompletionInput(value: unknown): void {
  assertJsonCollectionWithinBudget([jsonBudgetRoot(value, "completion")], {
    forbiddenKeys: FORBIDDEN_DRAFT_JSON_KEYS,
  });
}

function jsonBudgetRoot(value: unknown, path: string): JsonBudgetEntry {
  return { value, path, rootPath: path, depth: 0, ancestors: [] };
}

function getRequiredOwnDataValue(
  value: unknown,
  label: string,
  key: string,
): unknown {
  const descriptors = getPlainObjectDescriptors(value, label);
  const descriptor = descriptors[key];
  if (
    !descriptor ||
    descriptor.get ||
    descriptor.set ||
    !("value" in descriptor)
  ) {
    throw new CustomRulePersistenceInputError(
      `${label}.${key} must be an own data property`,
    );
  }
  return descriptor.value;
}

function assertSafeDraftPayloadInput(value: unknown): void {
  const entries = collectPersistenceJsonFields(value, "draft input", [
    "turnTrace",
    "businessContract",
    "unresolvedAmbiguities",
    "aiResponse",
    "generatedFormula",
    "generatedTestCases",
    "safetyFlags",
  ]);
  assertJsonCollectionWithinBudget(entries, {
    forbiddenKeys: FORBIDDEN_DRAFT_JSON_KEYS,
  });
}

function assertSafeSimulationSummaryInput(value: unknown): void {
  const entries = collectPersistenceJsonFields(value, "simulation input", [
    "sampleSource",
    "sampleSelection",
    "coverage",
    "scenarios",
    "historicalTotals",
    "deltas",
    "largestChanges",
    "warnings",
  ]);
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
    if (
      options.enforceSubcontainerBudget !== false &&
      rootBytes > JSON_INPUT_CONSERVATIVE_MAX_SUBCONTAINER_BYTES
    ) {
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
        if (
          !descriptor ||
          descriptor.get ||
          descriptor.set ||
          !("value" in descriptor)
        ) {
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
        if (
          !descriptor ||
          descriptor.get ||
          descriptor.set ||
          !("value" in descriptor)
        ) {
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
        addSerializedBytes(entry, utf8ByteLength(JSON.stringify(key)) + 1);
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
  const common = {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    idempotencyKey: row.idempotency_key,
    promptText: row.prompt_text,
    turnTrace: row.turn_trace,
    businessContract: row.business_contract,
    variableCatalogVersion: row.variable_catalog_version,
    aiResponse: row.ai_response,
    model: row.model,
    safetyFlags: row.safety_flags,
    contractHash: row.contract_hash,
    parameterHash: row.parameter_hash,
    revisionNumber: row.revision_number,
    createdBy: row.created_by,
    createdAt: row.created_at,
    supersedesDraftId: row.supersedes_draft_id,
  };

  if (row.initial_status === "clarifying") {
    const unresolvedAmbiguities = requireNonemptyDraftArray(
      row.unresolved_ambiguities,
      "clarifying ambiguities",
    );
    const state = {
      initialStatus: row.initial_status,
      unresolvedAmbiguities,
      generatedFormula: row.generated_formula,
      generatedExplanation: row.generated_explanation,
      generatedTestCases: row.generated_test_cases,
      formulaHash: row.formula_hash,
    };
    return row.status === "superseded"
      ? {
          ...common,
          ...state,
          status: row.status,
          supersededByDraftId: row.superseded_by_draft_id,
          supersededAt: row.superseded_at,
        }
      : {
          ...common,
          ...state,
          status: row.status,
          supersededByDraftId: row.superseded_by_draft_id,
          supersededAt: row.superseded_at,
        };
  }

  if (row.initial_status === "failed") {
    const state = {
      initialStatus: row.initial_status,
      unresolvedAmbiguities: row.unresolved_ambiguities,
      generatedFormula: row.generated_formula,
      generatedExplanation: row.generated_explanation,
      generatedTestCases: row.generated_test_cases,
      formulaHash: row.formula_hash,
    };
    return row.status === "superseded"
      ? {
          ...common,
          ...state,
          status: row.status,
          supersededByDraftId: row.superseded_by_draft_id,
          supersededAt: row.superseded_at,
        }
      : {
          ...common,
          ...state,
          status: row.status,
          supersededByDraftId: row.superseded_by_draft_id,
          supersededAt: row.superseded_at,
        };
  }

  const generatedTestCases = requireNonemptyDraftArray(
    row.generated_test_cases,
    "contract-ready test cases",
  );
  const state = {
    initialStatus: row.initial_status,
    unresolvedAmbiguities: row.unresolved_ambiguities,
    generatedFormula: row.generated_formula,
    generatedExplanation: row.generated_explanation,
    generatedTestCases,
    formulaHash: row.formula_hash,
  };
  return row.status === "superseded"
    ? {
        ...common,
        ...state,
        status: row.status,
        supersededByDraftId: row.superseded_by_draft_id,
        supersededAt: row.superseded_at,
      }
    : {
        ...common,
        ...state,
        status: row.status,
        supersededByDraftId: row.superseded_by_draft_id,
        supersededAt: row.superseded_at,
      };
}

function requireNonemptyDraftArray<Value>(
  values: Value[],
  label: string,
): [Value, ...Value[]] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new CustomRulePersistenceDataError(
      "draft",
      `${label} unexpectedly empty after validation`,
    );
  }
  return [first, ...rest];
}

function toSettlementFormulaSimulation(
  row: CompleteSimulationRow | InsertedSimulationRow,
): CompleteSettlementFormulaSimulation;
function toSettlementFormulaSimulation(
  row: LegacySimulationRow,
): LegacySettlementFormulaSimulation;
function toSettlementFormulaSimulation(
  row: SimulationRow | InsertedSimulationRow,
): SettlementFormulaSimulation;
function toSettlementFormulaSimulation(
  row: SimulationRow | InsertedSimulationRow,
): SettlementFormulaSimulation {
  const owner: SettlementSimulationOwner =
    row.ai_draft_id !== null
      ? { kind: "ai_draft", id: row.ai_draft_id }
      : { kind: "rule_version", id: row.rule_version_id as string };
  const common = {
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
    largestChanges: row.largest_changes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
  if (isCompleteSimulationRow(row)) {
    return {
      ...common,
      summarySchemaVersion: 2,
      summaryComplete: true,
      summaryStatus: "complete",
      coverage: row.coverage,
      scenarios: row.scenarios,
      historicalTotals: {
        ...row.historical_totals,
        payableAmountCents: row.historical_totals.oldPayableAmountCents,
        receivableAmountCents: row.historical_totals.oldReceivableAmountCents,
      },
      deltas: row.deltas,
      warnings: row.warnings,
    };
  }

  const hasPayableHistory = row.historical_totals.payableAmountCents !== null;
  const hasReceivableHistory =
    row.historical_totals.receivableAmountCents !== null;
  return {
    ...common,
    summarySchemaVersion: 1,
    summaryComplete: false,
    summaryStatus: "legacy",
    coverage: {
      summarySchemaVersion: 1,
      totalRecords: row.coverage.totalRecords,
      evaluatedRecords: row.coverage.evaluatedRecords,
      skippedRecords: row.coverage.skippedRecords,
      uncoveredRecords: null,
      zeroAmountRecords: null,
      reviewRoutedRecords: null,
      blockedRecords: null,
    },
    scenarios: row.scenarios,
    historicalTotals: {
      oldPayableAmountCents: row.historical_totals.payableAmountCents,
      oldReceivableAmountCents: row.historical_totals.receivableAmountCents,
      newPayableAmountCents: null,
      newReceivableAmountCents: null,
      recordCount: row.historical_totals.recordCount,
      verificationStatus: "legacy_unknown",
      payableAmountCents: row.historical_totals.payableAmountCents,
      receivableAmountCents: row.historical_totals.receivableAmountCents,
    },
    deltas: {
      payableAmountCents: hasPayableHistory
        ? row.deltas.payableAmountCents
        : null,
      receivableAmountCents: hasReceivableHistory
        ? row.deltas.receivableAmountCents
        : null,
      percentageBps:
        hasPayableHistory || hasReceivableHistory
          ? row.deltas.percentageBps
          : null,
      marginImpactCents: null,
    },
    warnings: row.warnings.map((warning) => ({
      kind: "legacy" as const,
      ...warning,
    })),
  };
}

function isCompleteSimulationRow(
  row: SimulationRow | InsertedSimulationRow,
): row is CompleteSimulationRow | InsertedSimulationRow {
  return (
    "summarySchemaVersion" in row.coverage &&
    row.coverage.summarySchemaVersion === 2
  );
}

function scopeSimulationOwnerQuery<
  Query extends { eq(column: string, value: string): Query },
>(query: Query, owner: SettlementSimulationOwner): Query {
  return owner.kind === "ai_draft"
    ? query.eq("ai_draft_id", owner.id)
    : query.eq("rule_version_id", owner.id);
}

function toSettlementRuleGroup(
  row: z.infer<typeof settlementRuleGroupRowSchema>,
): SettlementRuleGroup {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    assignmentCount: row.assignment_count,
    activeRuleCount: row.active_rule_count,
    pendingRuleCount: row.pending_rule_count,
    futureAssignmentCount: row.future_assignment_count,
  };
}

function toProjectStreamerSettlementGroupAssignment(
  row: z.infer<typeof settlementGroupAssignmentRowSchema>,
): ProjectStreamerSettlementGroupAssignment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectStreamerId: row.project_streamer_id,
    groupId: row.group_id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    assignedBy: row.assigned_by,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function toSettlementGroupAssignmentChange(
  row: z.infer<typeof settlementGroupAssignmentChangeRowSchema>,
): SettlementGroupAssignmentChangeResult {
  return {
    insertedAssignment: toProjectStreamerSettlementGroupAssignment(
      row.inserted_assignment,
    ),
    closedAssignmentIds: [...row.closed_assignment_ids].sort(),
    newGroupSnapshotHash: row.new_group_snapshot_hash,
  };
}

function toCustomSettlementRuleVersion(
  row: z.infer<typeof lifecycleVersionRowSchema>,
): CustomSettlementRuleVersion {
  const target = {
    targetType: row.target_type,
    targetId: row.target_id,
  } as CustomRuleTarget;
  return customSettlementRuleVersionSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    scope: row.scope,
    target,
    executionGrain: row.execution_grain,
    compositionMode: row.composition_mode,
    priority: row.priority,
    versionNumber: row.version_number,
    status: row.status,
    formula: row.formula,
    compiledAst: row.compiled_ast,
    variables: row.variables,
    parameters: row.parameters,
    ruleContract: row.rule_contract,
    systemExplanationTemplate: row.system_explanation_template,
    missingDataPolicy: row.missing_data_policy,
    testCases: row.test_cases,
    simulationSummary: row.simulation_summary,
    formulaHash: row.formula_hash,
    contractHash: row.rule_contract_hash,
    parameterHash: row.parameter_hash,
    catalogHash: row.variable_catalog_version,
    dataSelectionHash: row.data_selection_hash,
    simulationId: row.simulation_id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    aiDraftId: row.ai_draft_id,
    reason: row.reason,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    archivedAt: row.archived_at,
  });
}

function toCustomSettlementRuleReviewEvent(
  row: z.infer<typeof lifecycleReviewEventRowSchema>,
): CustomSettlementRuleReviewEvent {
  return customSettlementRuleReviewEventSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    ruleVersionId: row.rule_version_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    reason: row.reason,
    comment: row.comment,
    beforeStatus: row.before_status,
    afterStatus: row.after_status,
    riskSummary: row.risk_summary,
    formulaHash: row.formula_hash,
    contractHash: row.rule_contract_hash,
    parameterHash: row.parameter_hash,
    catalogHash: row.variable_catalog_version,
    dataSelectionHash: row.data_selection_hash,
    createdAt: row.created_at,
  });
}

function parseLifecycleRpcResult(
  data: unknown,
  error: unknown,
  operation: string,
): CustomRuleLifecycleResult {
  if (error) throw new CustomRulePersistenceQueryError(operation, error);
  const row = parsePersistenceRow(lifecycleResultRowSchema, data, "lifecycle");
  return {
    version: toCustomSettlementRuleVersion(row.version),
    simulation: toSettlementFormulaSimulation(row.simulation),
    event:
      row.event === null || row.event === undefined
        ? null
        : toCustomSettlementRuleReviewEvent(row.event),
  };
}
