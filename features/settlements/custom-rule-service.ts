import { createHash } from "node:crypto";

import { z } from "zod";

import type { AiProviderName } from "@/features/ai/contracts";
import type { ConversationTurnStatus } from "@/features/ai/conversation-contracts";
import type { CreatedConversationTurn } from "@/features/ai/conversation-repository";
import type { AuditLogInput } from "@/lib/audit/audit";
import type { AppRole } from "@/lib/rbac/roles";

import type {
  PrepareSettlementAiInput,
  PreparedSettlementAiRequest,
  SettlementAiFailure,
  SettlementAiResult,
  SettlementConversationHistory,
  SettlementConversationPort,
  SettlementConversationTurn,
} from "./custom-rule-ai";
import { canonicalizeSettlementAmbiguities } from "./custom-rule-ai";
import {
  businessRuleContractSchema,
  diffBusinessRuleContracts,
  runtimeValueTypeSchema,
  type BusinessRuleContract,
  type BusinessRuleContractChange,
} from "./custom-rule-contract";
import {
  buildCustomRuleInputRequirements,
  calculateCustomRuleOptionalPolicyHash,
  type CustomRuleDataReadinessReport,
  type CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import type {
  ClarifyingCustomRuleDraftInput,
  ContractReadyCustomRuleDraftInput,
  ApplyAndSubmitCustomRuleInput,
  ApproveCustomRuleRepositoryInput,
  ArchiveCustomRuleRepositoryInput,
  CreateCustomRuleDraftInput,
  CreatedCustomRuleDraft,
  CustomRuleDraft,
  CustomRuleLifecycleResult,
  CustomRuleRepository,
  CustomRuleReviewTransitionInput,
  CustomSettlementRuleVersion,
  FailedCustomRuleDraftInput,
  FinalizeSettlementAiDraftTurnInput,
  FinalizeSettlementAiFailedTurnInput,
  FinalizeSettlementAiSimulationTurnInput,
  FinalizedSettlementAiSimulationTurn,
  InsertedSettlementFormulaSimulation,
  ForceApproveCustomRuleRepositoryInput,
  ListCustomRulesInput,
  CreateSettlementRuleGroupInput,
  ListSettlementRuleGroupsInput,
  ArchiveSettlementRuleGroupInput,
  ChangeSettlementGroupAssignmentInput,
  SettlementRuleGroup,
  SettlementGroupAssignmentChangeResult,
  RequestCustomRuleChangesInput,
  SaveCustomRuleDraftInput,
  SavedCustomRuleDraftResult,
  SettlementFormulaSimulation,
  SettlementAiGeneratedTestCase,
  SettlementAiSafetyFlag,
  SettlementAiTurnTrace,
  SettlementAiTurnCompletionInput,
  SettlementAiFailedTurnErrorCode,
  SettlementAiFailedTurnFailureSemantics,
  SettlementAiUnresolvedAmbiguity,
} from "./custom-rule-repository";
import { SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES } from "./custom-rule-repository";
import {
  calculateCustomRuleDataSelectionHash,
  calculateCustomRuleEvidenceHash,
  freezeAuthorizedCustomRuleSimulationEvidence,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  type AuthorizedCustomRuleSimulationEvidence,
  type CustomRuleSimulationCriteriaCode,
  type CustomRuleSimulationInput,
  type CustomRuleSimulationResult,
} from "./custom-rule-simulation";
import type { TypedRuntimeValue } from "./custom-rule-types";
import type { CustomRuleSimulationFreshnessHashes } from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import {
  assertCustomRuleApprovalAllowed,
  assertCustomRulePayloadEditable,
  assertCustomRuleTransition,
  assertSimulationFresh,
  canRolePerformCustomRuleGovernanceAction,
  CustomRuleGovernanceError,
} from "./custom-rule-governance";
import {
  analyzeSettlementGroupRuleConflicts,
  validateSettlementGroupRuleActivationReadiness,
  type SettlementGroupScopedRule,
} from "./custom-rule-groups";
import {
  analyzeCustomRuleMaterialRisk,
  type CustomRuleMaterialRiskConfiguration,
  type CustomRuleMaterialRiskInput,
} from "./custom-rule-risk";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CONFIRM_CONTRACT_AMBIGUITY = "confirm_contract";
const AI_PROVIDER_FAILURE_MESSAGE =
  "Settlement AI provider is temporarily unavailable.";
const simulationCriteriaCodeSchema = z.enum([
  "approved_reports",
  "period_overlap",
  "complete_evidence",
  "project_scope",
]);
const simulationSelectionSchema = z
  .strictObject({
    selectionToken: z.string().min(8).max(500).regex(CLIENT_REQUEST_ID_PATTERN),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    criteriaCodes: z.array(simulationCriteriaCodeSchema).min(1).max(4),
  })
  .superRefine((selection, context) => {
    if (selection.periodStart > selection.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodStart"],
        message: "selection period is invalid",
      });
    }
    if (
      new Set(selection.criteriaCodes).size !== selection.criteriaCodes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteriaCodes"],
        message: "selection criteria codes must be unique",
      });
    }
  });
const atomicCompletionMetadataSchema = z.strictObject({
  contextSnapshotVersion: z.number().int().nonnegative(),
  contextSummaryVersion: z.number().int().nonnegative(),
  contextMessageIds: z.array(z.string().min(1).max(500)).min(1).max(200),
  settlementIdempotencyKey: z.string().min(1).max(500),
  settlementInitialStatus: z.enum(["clarifying", "contract_ready", "failed"]),
});

export type CustomRuleAuthoringRepositoryPort = {
  finalizeDraftTurn(
    input: FinalizeSettlementAiDraftTurnInput,
  ): Promise<CreatedCustomRuleDraft>;
  finalizeSimulationTurn(
    input: FinalizeSettlementAiSimulationTurnInput,
  ): Promise<FinalizedSettlementAiSimulationTurn>;
  finalizeFailedTurn(
    input: FinalizeSettlementAiFailedTurnInput,
  ): Promise<CreatedCustomRuleDraft>;
  listDrafts: CustomRuleRepository["listDrafts"];
  getDraft: CustomRuleRepository["getDraft"];
  listSimulations: CustomRuleRepository["listSimulations"];
};

export type SettlementVariableCatalogPort = {
  getCatalog(input: {
    organizationId: string;
    projectId: string;
    scope: BusinessRuleContract["scope"];
    executionGrain: BusinessRuleContract["executionGrain"];
  }): Promise<CustomRuleVariableCatalog>;
};

export type SettlementRuleAiPort = {
  prepare(input: PrepareSettlementAiInput): PreparedSettlementAiRequest;
  restore(context: unknown): PreparedSettlementAiRequest;
  execute(prepared: PreparedSettlementAiRequest): Promise<SettlementAiResult>;
};

export type AuthorizedSimulationSelectionRequest = Readonly<{
  selectionToken: string;
  periodStart: string;
  periodEnd: string;
  criteriaCodes: readonly CustomRuleSimulationCriteriaCode[];
}>;

export type AuthorizedSimulationEvidencePort = {
  loadAuthorizedEvidence(input: {
    actor: { organizationId: string; userId: string };
    organizationId: string;
    projectId: string;
    selection: AuthorizedSimulationSelectionRequest;
    inputs?: readonly CustomRuleInputRequirement[];
  }): Promise<AuthorizedCustomRuleSimulationEvidence>;
};

export type CustomRuleReadinessAnalyzer = (input: {
  catalog: CustomRuleVariableCatalog;
  inputs: readonly CustomRuleInputRequirement[];
}) => CustomRuleDataReadinessReport;

export type CustomRuleSimulator = (
  input: CustomRuleSimulationInput,
) => CustomRuleSimulationResult;

export type StartCustomRuleSessionInput = {
  actor: { organizationId: string; userId: string };
  projectId: string;
  conversationId: string;
  title?: string;
  clientRequestId: string;
  promptText: string;
  seedContract: BusinessRuleContract;
  initialAmbiguities: SettlementAiUnresolvedAmbiguity[];
};

export type ReviseCustomRuleSessionInput = {
  actor: { organizationId: string; userId: string };
  projectId: string;
  conversationId: string;
  expectedDraftId: string;
  expectedRevisionNumber: number;
  clientRequestId: string;
  promptText: string;
};

export type ConfirmCustomRuleContractInput = ReviseCustomRuleSessionInput & {
  contractConfirmed: boolean;
  expectedContractHash: string;
  expectedCatalogVersion: string;
  expectedFormulaHash?: string;
  expectedEvidenceHash?: string;
  expectedDataSelectionHash?: string;
  simulationSelection: AuthorizedSimulationSelectionRequest;
};

export type RetryCustomRuleTurnInput = {
  actor: { organizationId: string; userId: string };
  projectId: string;
  conversationId: string;
  sourceTurnId: string;
  clientRequestId: string;
};

export type CustomRuleClarifyingSuccess = Readonly<{
  ok: true;
  kind: "clarifying";
  conversationId: string;
  draft: CustomRuleDraft;
  diff: BusinessRuleContractChange[];
  duplicate: boolean;
}>;

export type CustomRuleSimulatedSuccess = Readonly<{
  ok: true;
  kind: "simulated";
  conversationId: string;
  draft: CustomRuleDraft;
  simulation: InsertedSettlementFormulaSimulation;
  summary: CustomRuleSimulationResult;
  duplicate: boolean;
}>;

type CustomRuleRetryTurnDto = Readonly<{
  turnId: string;
  status: ConversationTurnStatus;
  attempt: number;
  duplicate: boolean;
}>;

export type CustomRuleRetryInProgress = Readonly<{
  ok: true;
  kind: "retry_in_progress";
  conversationId: string;
  turn: CustomRuleRetryTurnDto & {
    status: "accepted" | "grounding" | "generating" | "validating";
  };
}>;

export type CustomRuleRetryReadback = Readonly<{
  ok: true;
  kind: "retry_readback";
  conversationId: string;
  draft: CustomRuleDraft;
  turn: CustomRuleRetryTurnDto & { status: "completed" };
}>;

export type CustomRuleRetryFailed = Readonly<{
  ok: false;
  kind: "retry_failed";
  code: "conversation_failed";
  retryable: true;
  conversationId: string;
  sourceTurnId: string;
  failedDraft: CustomRuleDraft | null;
  turn: CustomRuleRetryTurnDto & { status: "failed" };
}>;

export type CustomRuleAiTransitionFailure = Readonly<{
  ok: false;
  code:
    | SettlementAiFailure["code"]
    | "persistence_failed"
    | "conversation_failed";
  retryable: true;
  conversationId: string;
  sourceTurnId: string;
  turnTrace: SettlementAiTurnTrace;
  failedDraft: CustomRuleDraft | null;
}>;

export type CustomRuleAuthoringResult =
  | CustomRuleClarifyingSuccess
  | CustomRuleSimulatedSuccess
  | CustomRuleAiTransitionFailure
  | CustomRuleRetryInProgress
  | CustomRuleRetryReadback
  | CustomRuleRetryFailed;

export type CustomRuleAuthoringServiceErrorCode =
  | "invalid_input"
  | "conversation_failed"
  | "conversation_reconciliation_failed"
  | "catalog_failed"
  | "persistence_failed"
  | "draft_not_found"
  | "invalid_transition"
  | "stale_revision"
  | "unresolved_ambiguities"
  | "duplicate_confirmation"
  | "contract_hash_mismatch"
  | "catalog_hash_mismatch"
  | "formula_hash_mismatch"
  | "evidence_hash_mismatch"
  | "selection_hash_mismatch"
  | "formula_validation_failed"
  | "readiness_failed"
  | "simulation_failed";

type TurnErrorDisposition = "not_owned" | "owned_unsettled" | "owned_settled";

export class CustomRuleAuthoringServiceError extends Error {
  constructor(
    readonly code: CustomRuleAuthoringServiceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: {
      cause?: unknown;
      sourceTurnId?: string;
      turnDisposition?: TurnErrorDisposition;
    },
  ) {
    super(message, options);
    this.name = "CustomRuleAuthoringServiceError";
    this.sourceTurnId = options?.sourceTurnId ?? null;
    this.turnDisposition = options?.turnDisposition ?? "not_owned";
  }

  readonly sourceTurnId: string | null;
  readonly turnDisposition: TurnErrorDisposition;
}

type ServiceDependencies = {
  conversation: SettlementConversationPort;
  ai: SettlementRuleAiPort;
  repository: CustomRuleAuthoringRepositoryPort;
  catalog: SettlementVariableCatalogPort;
  evidence: AuthorizedSimulationEvidencePort;
  analyzeReadiness: CustomRuleReadinessAnalyzer;
  simulate: CustomRuleSimulator;
  primaryProvider: AiProviderName;
  persistFailedRevisions?: boolean;
};

type ScopedTransition = {
  actor: { organizationId: string; userId: string };
  projectId: string;
  conversationId: string;
  clientRequestId: string;
  promptText: string;
};

type FrozenServiceRetryContext = {
  version: 1;
  action: "clarify" | "revise" | "confirm";
  organizationId: string;
  actorId: string;
  projectId: string;
  conversationId: string;
  promptText: string;
  draftIdempotencyKey: string;
  expectedRevisionNumber: number;
  expectedDraftId: string | null;
  expectedContractHash: string | null;
  expectedCatalogVersion: string | null;
  expectedFormulaHash: string | null;
  expectedEvidenceHash: string | null;
  expectedDataSelectionHash: string | null;
  simulationSelection: AuthorizedSimulationSelectionRequest | null;
};

const frozenServiceRetryContextSchema: z.ZodType<FrozenServiceRetryContext> =
  z.strictObject({
    version: z.literal(1),
    action: z.enum(["clarify", "revise", "confirm"]),
    organizationId: z.string().min(1).max(500),
    actorId: z.string().min(1).max(500),
    projectId: z.string().min(1).max(500),
    conversationId: z.string().min(1).max(500),
    promptText: z.string().min(1).max(4_000),
    draftIdempotencyKey: z.string().min(1).max(500),
    expectedRevisionNumber: z.number().int().safe().positive(),
    expectedDraftId: z.string().min(1).max(500).nullable(),
    expectedContractHash: z.string().regex(HASH_PATTERN).nullable(),
    expectedCatalogVersion: z.string().regex(HASH_PATTERN).nullable(),
    expectedFormulaHash: z.string().regex(HASH_PATTERN).nullable(),
    expectedEvidenceHash: z.string().regex(HASH_PATTERN).nullable(),
    expectedDataSelectionHash: z.string().regex(HASH_PATTERN).nullable(),
    simulationSelection: simulationSelectionSchema.nullable(),
  });

const leaseExpiredMessageMetadataSchema = z.strictObject({
  errorCode: z.literal("turn_lease_expired"),
  retryable: z.literal(true),
});
const recoveryMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().max(100_000),
});
const recoveryCatalogPeriodSchema = z.strictObject({
  start: z.string().min(1).max(100),
  end: z.string().min(1).max(100),
});
const recoveryCatalogVariableSchema = z.strictObject({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(500),
  runtimeType: runtimeValueTypeSchema,
  unit: z.string().min(1).max(100),
  sourceLabel: z.string().min(1).max(500),
  availability: z.enum(["available", "partial", "unavailable"]),
  coverageNumerator: z.number().int().safe().nonnegative(),
  coverageDenominator: z.number().int().safe().nonnegative(),
  latestSampledPeriod: recoveryCatalogPeriodSchema.nullable(),
});
const recoveryCatalogSchema = z.strictObject({
  scope: z.enum(["receivable", "payable", "external_cost", "reconciliation"]),
  executionGrain: z.enum([
    "report",
    "project_streamer_period",
    "batch",
    "project_period",
  ]),
  businessTimezone: z.string().min(1).max(100).nullable(),
  businessTimezoneConfirmed: z.boolean(),
  businessTimezoneSource: z.enum([
    "contract_default",
    "organization_setting",
    "confirmed_contract",
    "unresolved",
  ]),
  hasHistory: z.boolean(),
  version: z.string().regex(HASH_PATTERN),
  variables: z.array(recoveryCatalogVariableSchema).max(300),
});
const recoveryAmbiguitySchema = z.strictObject({
  code: z.string().min(1).max(120),
  question: z.string().min(1).max(500),
  required: z.boolean(),
});
const recoveryAiRetryContextSchema = z.strictObject({
  version: z.literal(1),
  action: z.enum(["clarify", "revise", "confirm"]),
  contractConfirmed: z.boolean(),
  currentContract: businessRuleContractSchema,
  unresolvedAmbiguities: z.array(recoveryAmbiguitySchema).max(100),
  catalog: recoveryCatalogSchema,
  messages: z.array(recoveryMessageSchema).max(202),
  promptHash: z.string().regex(HASH_PATTERN),
  contextHash: z.string().regex(HASH_PATTERN),
});
const recoveryGatewayContextSchema = z.strictObject({
  messages: z.array(recoveryMessageSchema).max(202),
  attachments: z.array(z.never()).length(0),
  mode: z.literal("fast"),
  primaryProvider: z.string().min(1).max(200),
  lastUserMessage: z.string().min(1).max(4_000),
  responseMetadata: z.strictObject({
    grounding: z.strictObject({
      catalogVersion: z.string().regex(HASH_PATTERN),
      scope: recoveryCatalogSchema.shape.scope,
      executionGrain: recoveryCatalogSchema.shape.executionGrain,
    }),
    knowledge: z.strictObject({}),
    retrospectiveDraft: z.null(),
  }),
  invocationMetadata: z.strictObject({
    promptHash: z.string().regex(HASH_PATTERN),
    contextHash: z.string().regex(HASH_PATTERN),
    snapshotVersion: z.number().int().nonnegative(),
    summaryVersion: z.number().int().nonnegative(),
    settlementAiRetryContext: recoveryAiRetryContextSchema,
    settlementServiceRetryContext: frozenServiceRetryContextSchema,
  }),
});

type OpenedAiTurn = {
  turnTrace: SettlementAiTurnTrace;
  prepared: PreparedSettlementAiRequest;
  snapshot: {
    version: number;
    summaryVersion: number;
    messageIds: string[];
  };
  serviceRetryContext: FrozenServiceRetryContext;
};

type OpenRetryTurnResult =
  | { kind: "opened"; opened: OpenedAiTurn }
  | {
      kind: "result";
      result:
        | CustomRuleRetryInProgress
        | CustomRuleRetryReadback
        | CustomRuleRetryFailed;
    };

type OpenStartTurnResult =
  | { kind: "opened"; opened: OpenedAiTurn }
  | {
      kind: "result";
      result:
        | CustomRuleClarifyingSuccess
        | CustomRuleAiTransitionFailure
        | CustomRuleRetryInProgress;
    };

type ContractReadyDraft = Extract<
  CustomRuleDraft,
  { initialStatus: "contract_ready" }
>;
type ClarifyingDraft = Extract<
  CustomRuleDraft,
  { initialStatus: "clarifying" }
>;
type FailedDraft = Extract<CustomRuleDraft, { initialStatus: "failed" }>;

export function createCustomRuleAuthoringService(
  dependencies: ServiceDependencies,
) {
  validateDependencies(dependencies);
  const persistFailedRevisions = dependencies.persistFailedRevisions ?? false;

  return Object.freeze({
    async startSession(
      unsafeInput: StartCustomRuleSessionInput,
    ): Promise<CustomRuleAuthoringResult> {
      const input = validateStartInput(unsafeInput);
      const conversationId = input.conversationId;
      const scope = { ...input, conversationId };
      const history = await requireConversationHistory(
        dependencies.conversation,
        input.actor,
        conversationId,
      );
      const idempotencyKey = draftIdempotencyKey("start", scope);
      const drafts = await listScopedDrafts(dependencies.repository, scope);
      const replay = drafts.find(
        (draft) => draft.idempotencyKey === idempotencyKey,
      );
      if (replay) {
        return replayStartDraftWithStableRead({
          dependencies,
          history,
          scope,
          currentContract: input.seedContract,
          currentAmbiguities: input.initialAmbiguities,
          draftIdempotencyKey: idempotencyKey,
          primaryProvider: dependencies.primaryProvider,
          draft: replay,
          drafts,
        });
      }
      if (drafts.length > 0) {
        throw serviceError(
          "invalid_transition",
          "conversation already owns a settlement authoring session",
          false,
        );
      }
      const opened = await openStartAiTurn({
        dependencies,
        scope,
        currentContract: input.seedContract,
        currentAmbiguities: input.initialAmbiguities,
        draftIdempotencyKey: idempotencyKey,
      });
      if (opened.kind === "result") return opened.result;
      return runClarifyingTransition({
        dependencies,
        persistFailedRevisions,
        operation: "start",
        scope,
        currentContract: input.seedContract,
        currentAmbiguities: input.initialAmbiguities,
        catalog: opened.opened.prepared.catalog,
        idempotencyKey,
        expectedRevisionNumber: 1,
        expectedDraftId: null,
        opened: opened.opened,
      });
    },

    async answerOrRevise(
      unsafeInput: ReviseCustomRuleSessionInput,
    ): Promise<CustomRuleAuthoringResult> {
      const input = validateRevisionInput(unsafeInput);
      await requireConversationHistory(
        dependencies.conversation,
        input.actor,
        input.conversationId,
      );
      const idempotencyKey = draftIdempotencyKey("revise", input);
      const drafts = await listScopedDrafts(dependencies.repository, input);
      const replay = drafts.find(
        (draft) => draft.idempotencyKey === idempotencyKey,
      );
      if (replay) {
        return replay.initialStatus === "failed"
          ? replayFailure(replay)
          : replayClarifying(replay, drafts);
      }
      const latest = requireLatestDraft(drafts);
      requireExpectedRevision(latest, input);
      if (
        latest.status !== "clarifying" &&
        latest.status !== "contract_ready" &&
        latest.status !== "simulated"
      ) {
        throw serviceError(
          "invalid_transition",
          "latest draft cannot be revised",
          false,
        );
      }
      const catalog = await loadCatalog(
        dependencies.catalog,
        input,
        latest.businessContract,
      );
      return runClarifyingTransition({
        dependencies,
        persistFailedRevisions,
        operation: "revise",
        scope: input,
        currentContract: latest.businessContract,
        currentAmbiguities: latest.unresolvedAmbiguities,
        catalog,
        idempotencyKey,
        expectedRevisionNumber: latest.revisionNumber + 1,
        expectedDraftId: latest.id,
      });
    },

    async retryTurn(
      unsafeInput: RetryCustomRuleTurnInput,
    ): Promise<CustomRuleAuthoringResult> {
      const input = validateRetryInput(unsafeInput);
      await requireConversationHistory(
        dependencies.conversation,
        input.actor,
        input.conversationId,
      );
      const drafts = await listScopedDrafts(dependencies.repository, input);
      const retryTurn = await openRetryTurn(dependencies, input, drafts);
      if (retryTurn.kind === "result") return retryTurn.result;
      const opened = retryTurn.opened;
      const retryContext = opened.serviceRetryContext;
      const scope: ScopedTransition = {
        actor: input.actor,
        projectId: input.projectId,
        conversationId: input.conversationId,
        clientRequestId: input.clientRequestId,
        promptText: retryContext.promptText,
      };
      return runOwnedOpenedTransition(dependencies, scope, opened, async () => {
        if (retryContext.action === "confirm") {
          return retryConfirmationTransition({
            dependencies,
            scope,
            opened,
            retryContext,
            drafts,
            sourceTurnId: input.sourceTurnId,
          });
        }
        const latest = drafts[0];
        const persisted = drafts.find(
          (draft) => draft.idempotencyKey === retryContext.draftIdempotencyKey,
        );
        if (persisted?.initialStatus === "clarifying") {
          throw atomicReconciliationError(
            opened,
            new Error(
              "accepted retry conflicts with an atomic clarifying artifact",
            ),
          );
        }
        let idempotencyKey = retryContext.draftIdempotencyKey;
        let expectedRevisionNumber = retryContext.expectedRevisionNumber;
        if (persisted?.initialStatus === "failed") {
          if (persisted.status !== "failed" || latest?.id !== persisted.id) {
            throw serviceError(
              "stale_revision",
              "durable failed retry artifact is no longer current",
              false,
            );
          }
          await assertFrozenFailedRetryArtifact({
            dependencies,
            scope,
            opened,
            retryContext,
            drafts,
            draft: persisted,
            sourceTurnId: input.sourceTurnId,
          });
          idempotencyKey = retryDraftIdempotencyKey(
            retryContext.draftIdempotencyKey,
            input.sourceTurnId,
            input.clientRequestId,
          );
          expectedRevisionNumber = persisted.revisionNumber + 1;
        } else if (
          retryContext.expectedRevisionNumber > 1 &&
          latest?.revisionNumber !== retryContext.expectedRevisionNumber - 1
        ) {
          throw serviceError(
            "stale_revision",
            "settlement draft revision changed before retry",
            false,
          );
        }
        return runClarifyingTransition({
          dependencies,
          persistFailedRevisions,
          operation: retryContext.action === "clarify" ? "start" : "revise",
          scope,
          currentContract: opened.prepared.currentContract,
          currentAmbiguities:
            opened.prepared.retryContext.unresolvedAmbiguities,
          catalog: opened.prepared.catalog,
          idempotencyKey,
          expectedRevisionNumber,
          expectedDraftId: persisted?.id ?? retryContext.expectedDraftId,
          opened,
        });
      });
    },

    async confirmContract(
      unsafeInput: ConfirmCustomRuleContractInput,
    ): Promise<CustomRuleAuthoringResult> {
      const input = validateConfirmationInput(unsafeInput);
      await requireConversationHistory(
        dependencies.conversation,
        input.actor,
        input.conversationId,
      );
      const drafts = await listScopedDrafts(dependencies.repository, input);
      const idempotencyKey = draftIdempotencyKey("confirm", input);
      const existing = drafts.find(
        (draft) => draft.idempotencyKey === idempotencyKey,
      );
      if (existing?.initialStatus === "contract_ready") {
        if (existing.status === "simulated") {
          return replaySimulatedConfirmation({
            dependencies,
            input,
            draft: existing,
          });
        }
        if (existing.status === "contract_ready") {
          throw serviceError(
            "conversation_reconciliation_failed",
            "Atomic confirmation has a partial contract-ready artifact.",
            false,
            undefined,
            existing.turnTrace.turnId,
          );
        }
      }
      if (existing) {
        throw serviceError(
          "duplicate_confirmation",
          "confirmation request has already been used",
          false,
        );
      }
      const latest = requireLatestDraft(drafts);
      if (latest.status === "contract_ready" || latest.status === "simulated") {
        throw serviceError(
          "duplicate_confirmation",
          "contract has already been confirmed",
          false,
        );
      }
      requireExpectedRevision(latest, input);
      if (!input.contractConfirmed || latest.status !== "clarifying") {
        throw serviceError(
          "invalid_transition",
          "confirmation requires an explicit clarifying draft transition",
          false,
        );
      }
      const ambiguities = latest.unresolvedAmbiguities;
      const consumesInternalConfirmation =
        ambiguities.length === 1 &&
        ambiguities[0]?.code === CONFIRM_CONTRACT_AMBIGUITY &&
        ambiguities[0].required;
      if (ambiguities.length > 0 && !consumesInternalConfirmation) {
        throw serviceError(
          "unresolved_ambiguities",
          "business ambiguities remain unresolved",
          false,
        );
      }
      const contractHash = hashCustomRuleContract(latest.businessContract);
      if (
        contractHash !== latest.contractHash ||
        contractHash !== input.expectedContractHash
      ) {
        throw serviceError(
          "contract_hash_mismatch",
          "confirmed contract hash is stale",
          false,
        );
      }
      const catalog = await loadCatalog(
        dependencies.catalog,
        input,
        latest.businessContract,
      );
      if (
        catalog.version !== latest.variableCatalogVersion ||
        catalog.version !== input.expectedCatalogVersion
      ) {
        throw serviceError(
          "catalog_hash_mismatch",
          "variable catalog version is stale",
          false,
        );
      }
      return runConfirmationTransition({
        dependencies,
        persistFailedRevisions,
        input,
        latest,
        catalog,
        contractHash,
        idempotencyKey,
      });
    },
  });
}

async function retryConfirmationTransition(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  retryContext: FrozenServiceRetryContext;
  drafts: CustomRuleDraft[];
  sourceTurnId: string;
}): Promise<CustomRuleAuthoringResult> {
  const context = input.retryContext;
  if (
    context.action !== "confirm" ||
    !context.expectedContractHash ||
    !context.expectedCatalogVersion ||
    !context.simulationSelection
  ) {
    throw serviceError(
      "conversation_failed",
      "confirmation retry context is incomplete",
      false,
    );
  }
  const existing = input.drafts.find(
    (draft) => draft.idempotencyKey === context.draftIdempotencyKey,
  );
  if (existing?.initialStatus === "contract_ready") {
    throw atomicReconciliationError(
      input.opened,
      new Error(
        "accepted retry conflicts with an atomic confirmation artifact",
      ),
    );
  }
  if (existing?.initialStatus === "failed") {
    const retryIdempotencyKey = retryDraftIdempotencyKey(
      context.draftIdempotencyKey,
      input.sourceTurnId,
      input.scope.clientRequestId,
    );
    const retriedDraft = input.drafts.find(
      (draft) => draft.idempotencyKey === retryIdempotencyKey,
    );
    if (retriedDraft?.initialStatus === "contract_ready") {
      throw atomicReconciliationError(
        input.opened,
        new Error("accepted retry conflicts with a retried atomic artifact"),
      );
    }
    if (retriedDraft) {
      throw serviceError(
        "invalid_transition",
        "confirmation retry key collided with an incompatible draft",
        false,
      );
    }
    if (
      existing.status !== "failed" ||
      input.drafts[0]?.id !== existing.id ||
      existing.revisionNumber !== context.expectedRevisionNumber ||
      hashCustomRuleContract(existing.businessContract) !==
        context.expectedContractHash ||
      existing.variableCatalogVersion !== context.expectedCatalogVersion
    ) {
      throw serviceError(
        "invalid_transition",
        "failed confirmation was already superseded by another semantic retry",
        false,
      );
    }
    const confirmation: ConfirmCustomRuleContractInput = {
      actor: input.scope.actor,
      projectId: input.scope.projectId,
      conversationId: input.scope.conversationId,
      expectedDraftId: existing.id,
      expectedRevisionNumber: existing.revisionNumber,
      clientRequestId: input.scope.clientRequestId,
      promptText: context.promptText,
      contractConfirmed: true,
      expectedContractHash: context.expectedContractHash,
      expectedCatalogVersion: context.expectedCatalogVersion,
      expectedFormulaHash: context.expectedFormulaHash ?? undefined,
      expectedEvidenceHash: context.expectedEvidenceHash ?? undefined,
      expectedDataSelectionHash: context.expectedDataSelectionHash ?? undefined,
      simulationSelection: context.simulationSelection,
    };
    return runConfirmationTransition({
      dependencies: input.dependencies,
      persistFailedRevisions: false,
      input: confirmation,
      latest: existing,
      catalog: input.opened.prepared.catalog,
      contractHash: context.expectedContractHash,
      idempotencyKey: retryIdempotencyKey,
      opened: input.opened,
    });
  }
  if (existing) {
    throw serviceError(
      "duplicate_confirmation",
      "confirmation retry collided with another draft state",
      false,
    );
  }
  const latest = requireLatestDraft(input.drafts);
  if (
    latest.status !== "clarifying" ||
    latest.revisionNumber + 1 !== context.expectedRevisionNumber ||
    hashCustomRuleContract(latest.businessContract) !==
      context.expectedContractHash ||
    latest.variableCatalogVersion !== context.expectedCatalogVersion
  ) {
    throw serviceError(
      "stale_revision",
      "confirmation context changed before retry",
      false,
    );
  }
  const onlyInternalConfirmation =
    latest.unresolvedAmbiguities.length === 1 &&
    latest.unresolvedAmbiguities[0]?.code === CONFIRM_CONTRACT_AMBIGUITY &&
    latest.unresolvedAmbiguities[0].required;
  if (latest.unresolvedAmbiguities.length > 0 && !onlyInternalConfirmation) {
    throw serviceError(
      "unresolved_ambiguities",
      "business ambiguities remain unresolved",
      false,
    );
  }
  if (
    input.opened.prepared.catalog.version !== context.expectedCatalogVersion ||
    hashCustomRuleContract(input.opened.prepared.currentContract) !==
      context.expectedContractHash
  ) {
    throw serviceError(
      "conversation_failed",
      "frozen confirmation context hash mismatch",
      false,
    );
  }
  const confirmation: ConfirmCustomRuleContractInput = {
    actor: input.scope.actor,
    projectId: input.scope.projectId,
    conversationId: input.scope.conversationId,
    expectedDraftId: latest.id,
    expectedRevisionNumber: latest.revisionNumber,
    clientRequestId: input.scope.clientRequestId,
    promptText: context.promptText,
    contractConfirmed: true,
    expectedContractHash: context.expectedContractHash,
    expectedCatalogVersion: context.expectedCatalogVersion,
    expectedFormulaHash: context.expectedFormulaHash ?? undefined,
    expectedEvidenceHash: context.expectedEvidenceHash ?? undefined,
    expectedDataSelectionHash: context.expectedDataSelectionHash ?? undefined,
    simulationSelection: context.simulationSelection,
  };
  return runConfirmationTransition({
    dependencies: input.dependencies,
    persistFailedRevisions: false,
    input: confirmation,
    latest,
    catalog: input.opened.prepared.catalog,
    contractHash: context.expectedContractHash,
    idempotencyKey: context.draftIdempotencyKey,
    opened: input.opened,
  });
}

async function assertFrozenFailedRetryArtifact(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  retryContext: FrozenServiceRetryContext;
  drafts: CustomRuleDraft[];
  draft: FailedDraft;
  sourceTurnId: string;
}): Promise<void> {
  const mismatch = frozenRetryArtifactMismatch(input, true);
  if (mismatch) {
    await rejectFrozenRetryArtifact(
      input.dependencies,
      input.scope,
      input.opened,
      mismatch,
    );
  }
}

function frozenRetryArtifactMismatch(
  input: {
    opened: OpenedAiTurn;
    retryContext: FrozenServiceRetryContext;
    drafts: CustomRuleDraft[];
    draft: ClarifyingDraft | FailedDraft;
    sourceTurnId: string;
  },
  requireUnchangedContract: boolean,
): string | null {
  const context = input.retryContext;
  if (
    context.action === "confirm" ||
    context.expectedContractHash === null ||
    context.expectedCatalogVersion === null ||
    input.draft.revisionNumber !== context.expectedRevisionNumber ||
    input.draft.idempotencyKey !== context.draftIdempotencyKey ||
    input.draft.promptText !== context.promptText ||
    input.draft.turnTrace.turnId !== input.sourceTurnId ||
    !input.opened.snapshot.messageIds.includes(
      input.draft.turnTrace.userMessageId,
    ) ||
    input.draft.variableCatalogVersion !== context.expectedCatalogVersion ||
    input.opened.prepared.catalog.version !== context.expectedCatalogVersion ||
    hashCustomRuleContract(input.opened.prepared.currentContract) !==
      context.expectedContractHash ||
    hashCustomRuleContract(input.draft.businessContract) !==
      input.draft.contractHash ||
    hashCustomRuleParameters(parameterValues(input.draft.businessContract)) !==
      input.draft.parameterHash ||
    (requireUnchangedContract &&
      input.draft.contractHash !== context.expectedContractHash)
  ) {
    return "persisted retry artifact does not match frozen operation hashes";
  }
  if (context.action === "clarify") {
    return context.expectedDraftId === null &&
      context.expectedRevisionNumber === 1 &&
      input.draft.supersedesDraftId === null
      ? null
      : "persisted start artifact has invalid revision lineage";
  }
  if (
    context.expectedDraftId === null ||
    context.expectedRevisionNumber <= 1 ||
    input.draft.supersedesDraftId !== context.expectedDraftId
  ) {
    return "persisted revision artifact has invalid revision lineage";
  }
  const previous = input.drafts.find(
    (draft) => draft.id === context.expectedDraftId,
  );
  if (
    !previous ||
    previous.revisionNumber !== context.expectedRevisionNumber - 1 ||
    previous.contractHash !== context.expectedContractHash ||
    hashCustomRuleContract(previous.businessContract) !== previous.contractHash
  ) {
    return "persisted revision base does not match frozen operation hashes";
  }
  return null;
}

async function rejectFrozenRetryArtifact(
  dependencies: ServiceDependencies,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  message: string,
): Promise<never> {
  try {
    await failConversationTurn(
      dependencies.conversation,
      scope,
      opened,
      "settlement_retry_artifact_mismatch",
      false,
      message,
    );
  } catch (error) {
    throw serviceError(
      "conversation_reconciliation_failed",
      "mismatched settlement retry artifact could not fail the generic turn",
      false,
      error,
      opened.turnTrace.turnId,
    );
  }
  throw serviceError(
    "conversation_failed",
    message,
    false,
    undefined,
    opened.turnTrace.turnId,
    "owned_settled",
  );
}

async function runClarifyingTransition(input: {
  dependencies: ServiceDependencies;
  persistFailedRevisions: boolean;
  operation: "start" | "revise";
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  idempotencyKey: string;
  expectedRevisionNumber: number;
  expectedDraftId: string | null;
  opened?: OpenedAiTurn;
}): Promise<CustomRuleAuthoringResult> {
  const opened =
    input.opened ??
    (await openAiTurn({
      dependencies: input.dependencies,
      scope: input.scope,
      action: input.operation === "start" ? "clarify" : "revise",
      contractConfirmed: false,
      currentContract: input.currentContract,
      currentAmbiguities: input.currentAmbiguities,
      catalog: input.catalog,
      serviceRetryContext: createServiceRetryContext({
        action: input.operation === "start" ? "clarify" : "revise",
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        expectedRevisionNumber: input.expectedRevisionNumber,
        expectedDraftId: input.expectedDraftId,
        expectedContractHash: hashCustomRuleContract(input.currentContract),
        expectedCatalogVersion: input.catalog.version,
      }),
    }));
  return runOwnedOpenedTransition(
    input.dependencies,
    input.scope,
    opened,
    async () => {
      const aiResult = await executeAi(input.dependencies.ai, opened.prepared);
      if (!aiResult.ok) {
        return handleAiFailure({
          dependencies: input.dependencies,
          persistFailedRevisions: input.persistFailedRevisions,
          scope: input.scope,
          opened,
          failure: aiResult,
          currentContract: input.currentContract,
          currentAmbiguities: input.currentAmbiguities,
          catalogVersion: input.catalog.version,
          idempotencyKey: input.idempotencyKey,
          expectedRevisionNumber: input.expectedRevisionNumber,
        });
      }
      await markValidating(
        input.dependencies.conversation,
        input.scope,
        opened,
      );
      const ambiguities = resolvedClarifyingAmbiguities(aiResult);
      const parameterHash = hashCustomRuleParameters(
        parameterValues(aiResult.contract),
      );
      const draftInput: ClarifyingCustomRuleDraftInput = {
        organizationId: input.scope.actor.organizationId,
        projectId: input.scope.projectId,
        conversationId: input.scope.conversationId,
        idempotencyKey: input.idempotencyKey,
        promptText: input.scope.promptText,
        turnTrace: opened.turnTrace,
        businessContract: aiResult.contract,
        unresolvedAmbiguities: ambiguities,
        variableCatalogVersion: input.catalog.version,
        aiResponse: {
          content: aiResult.nextQuestion ?? ambiguities[0].question,
          finishReason: "stop",
          providerRequestId: null,
        },
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        model: aiResult.providerName ?? input.dependencies.primaryProvider,
        safetyFlags: mapSafetyFlags(aiResult.safetyFlags),
        contractHash: hashCustomRuleContract(aiResult.contract),
        formulaHash: null,
        parameterHash,
        status: "clarifying",
      };
      const finalized = await finalizeDraftTurn({
        dependencies: input.dependencies,
        scope: input.scope,
        opened,
        draft: draftInput,
        expectedRevisionNumber: input.expectedRevisionNumber,
        providerName: aiResult.providerName,
      });
      if (!finalized.ok) return finalized.failure;
      const created = finalized.draft;
      return Object.freeze({
        ok: true,
        kind: "clarifying",
        conversationId: input.scope.conversationId,
        draft: created,
        diff: aiResult.diff,
        duplicate: created.duplicate,
      });
    },
  );
}

async function runConfirmationTransition(input: {
  dependencies: ServiceDependencies;
  persistFailedRevisions: boolean;
  input: ConfirmCustomRuleContractInput;
  latest: CustomRuleDraft;
  catalog: CustomRuleVariableCatalog;
  contractHash: string;
  idempotencyKey: string;
  opened?: OpenedAiTurn;
}): Promise<CustomRuleAuthoringResult> {
  const scope = input.input;
  const opened =
    input.opened ??
    (await openAiTurn({
      dependencies: input.dependencies,
      scope,
      action: "confirm",
      contractConfirmed: true,
      currentContract: input.latest.businessContract,
      currentAmbiguities: [],
      catalog: input.catalog,
      serviceRetryContext: createServiceRetryContext({
        action: "confirm",
        scope,
        idempotencyKey: input.idempotencyKey,
        expectedRevisionNumber: input.latest.revisionNumber + 1,
        expectedDraftId: input.latest.id,
        expectedContractHash: input.contractHash,
        expectedCatalogVersion: input.catalog.version,
        expectedFormulaHash: scope.expectedFormulaHash ?? null,
        expectedEvidenceHash: scope.expectedEvidenceHash ?? null,
        expectedDataSelectionHash: scope.expectedDataSelectionHash ?? null,
        simulationSelection: scope.simulationSelection,
      }),
    }));
  return runOwnedOpenedTransition(
    input.dependencies,
    scope,
    opened,
    async () => {
      const aiResult = await executeAi(input.dependencies.ai, opened.prepared);
      if (!aiResult.ok) {
        return handleAiFailure({
          dependencies: input.dependencies,
          persistFailedRevisions: input.persistFailedRevisions,
          scope,
          opened,
          failure: aiResult,
          currentContract: input.latest.businessContract,
          currentAmbiguities: [],
          catalogVersion: input.catalog.version,
          idempotencyKey: input.idempotencyKey,
          expectedRevisionNumber: input.latest.revisionNumber + 1,
        });
      }
      await markValidating(input.dependencies.conversation, scope, opened);
      const failDomain = (
        code: CustomRuleAuthoringServiceErrorCode,
        message: string,
        retryable: boolean,
        cause?: unknown,
      ) =>
        handleDomainFailure({
          dependencies: input.dependencies,
          persistFailedRevisions: input.persistFailedRevisions,
          scope,
          opened,
          code,
          message,
          retryable,
          cause,
          currentContract: aiResult.contract,
          catalogVersion: input.catalog.version,
          idempotencyKey: input.idempotencyKey,
          expectedRevisionNumber: input.latest.revisionNumber + 1,
          providerName: aiResult.providerName,
        });
      if (aiResult.diff.length > 0) {
        return failDomain(
          "invalid_transition",
          "provider changed the contract during explicit confirmation",
          false,
        );
      }
      if (
        aiResult.formulaProposal === null ||
        aiResult.validation === null ||
        aiResult.testCases.length === 0
      ) {
        return failDomain(
          "formula_validation_failed",
          "confirmed response has no complete formula evidence",
          true,
        );
      }

      const deterministic = validateCustomRuleFormula(
        aiResult.formulaProposal,
        {
          scope: aiResult.contract.scope,
          executionGrain: aiResult.contract.executionGrain,
          parameters: aiResult.contract.parameters.map((parameter) => ({
            name: parameter.name,
            valueType: parameter.valueType,
          })),
        },
      );
      const normalized = parseCustomRuleFormula(aiResult.formulaProposal);
      if (
        !deterministic.ok ||
        !normalized.ok ||
        deterministic.formulaHash !== aiResult.validation.formulaHash ||
        canonicalJson(normalized.ast) !==
          canonicalJson(aiResult.validation.normalizedAst)
      ) {
        return failDomain(
          "formula_validation_failed",
          "formula failed authoritative deterministic validation",
          true,
        );
      }
      if (
        scope.expectedFormulaHash &&
        scope.expectedFormulaHash !== deterministic.formulaHash
      ) {
        return failDomain(
          "formula_hash_mismatch",
          "generated formula hash does not match the expected hash",
          false,
        );
      }

      let explanation: string;
      try {
        explanation = buildCustomRuleTemplateExplanation({
          ast: deterministic.compiledAst,
        });
      } catch (error) {
        return failDomain(
          "formula_validation_failed",
          "authoritative formula explanation failed",
          true,
          error,
        );
      }
      const parameters = parameterValues(aiResult.contract);
      const parameterHash = hashCustomRuleParameters(parameters);
      const requirements = readinessRequirements(
        aiResult.contract,
        deterministic.variables,
      );
      let readiness: CustomRuleDataReadinessReport;
      try {
        readiness = input.dependencies.analyzeReadiness({
          catalog: input.catalog,
          inputs: requirements,
        });
      } catch (error) {
        return failDomain(
          "readiness_failed",
          "data readiness analysis failed",
          true,
          error,
        );
      }
      if (
        !readiness.readyForSimulation ||
        readiness.catalogVersion !== input.catalog.version ||
        readiness.businessTimezone !== aiResult.contract.businessTimezone
      ) {
        return failDomain(
          "readiness_failed",
          "project data is not ready for deterministic simulation",
          false,
        );
      }

      let evidence: AuthorizedCustomRuleSimulationEvidence;
      try {
        evidence = await loadAuthorizedSimulationEvidence(
          input.dependencies.evidence,
          scope,
          scope.simulationSelection,
          requirements,
        );
      } catch (error) {
        return failDomain(
          "simulation_failed",
          "authorized simulation evidence is invalid",
          false,
          error,
        );
      }
      if (
        scope.expectedEvidenceHash &&
        scope.expectedEvidenceHash !== evidence.provenance.evidenceHash
      ) {
        return failDomain(
          "evidence_hash_mismatch",
          "authorized evidence hash does not match the expected hash",
          false,
        );
      }

      let summary: CustomRuleSimulationResult;
      let calculatedSelectionHash: string;
      try {
        const simulationInput: CustomRuleSimulationInput = {
          organizationId: scope.actor.organizationId,
          actorId: scope.actor.userId,
          projectId: scope.projectId,
          contract: aiResult.contract,
          compiledAst: deterministic.compiledAst,
          parameters,
          formulaHash: deterministic.formulaHash,
          contractHash: input.contractHash,
          parameterHash,
          catalogVersion: input.catalog.version,
          readiness,
          ...evidence,
          aiTestCases: aiResult.testCases,
        };
        calculatedSelectionHash =
          calculateCustomRuleDataSelectionHash(simulationInput);
        summary = input.dependencies.simulate(simulationInput);
      } catch (error) {
        return failDomain(
          "simulation_failed",
          "deterministic simulation failed",
          true,
          error,
        );
      }
      if (
        summary.persistable.formulaHash !== deterministic.formulaHash ||
        summary.persistable.ruleContractHash !== input.contractHash ||
        summary.persistable.parameterHash !== parameterHash ||
        summary.persistable.variableCatalogVersion !== input.catalog.version ||
        summary.persistable.dataSelectionHash !== summary.dataSelectionHash ||
        summary.dataSelectionHash !== calculatedSelectionHash
      ) {
        return failDomain(
          "simulation_failed",
          "simulation returned mismatched freshness hashes",
          false,
        );
      }
      if (
        scope.expectedDataSelectionHash &&
        scope.expectedDataSelectionHash !== summary.dataSelectionHash
      ) {
        return failDomain(
          "selection_hash_mismatch",
          "final data selection hash does not match the expected hash",
          false,
        );
      }
      if (summary.riskFlags.some((flag) => flag.severity === "block")) {
        return failDomain(
          "simulation_failed",
          "deterministic scenario assertions or risk checks blocked confirmation",
          false,
        );
      }

      const draftInput: ContractReadyCustomRuleDraftInput = {
        organizationId: scope.actor.organizationId,
        projectId: scope.projectId,
        conversationId: scope.conversationId,
        idempotencyKey: input.idempotencyKey,
        promptText: scope.promptText,
        turnTrace: opened.turnTrace,
        businessContract: aiResult.contract,
        unresolvedAmbiguities: [],
        variableCatalogVersion: input.catalog.version,
        aiResponse: {
          content: canonicalJson({
            formulaProposal: aiResult.formulaProposal,
            safetyFlags: aiResult.safetyFlags,
          }),
          finishReason: "stop",
          providerRequestId: null,
        },
        generatedFormula: {
          expression: aiResult.formulaProposal,
          normalizedAst: normalized.ast,
        },
        generatedExplanation: explanation,
        generatedTestCases: nonEmptyTestCases(aiResult.testCases),
        model: aiResult.providerName ?? input.dependencies.primaryProvider,
        safetyFlags: mapSafetyFlags(aiResult.safetyFlags),
        contractHash: input.contractHash,
        formulaHash: deterministic.formulaHash,
        parameterHash,
        status: "contract_ready",
      };
      const finalized = await finalizeSimulationTurn({
        dependencies: input.dependencies,
        scope,
        opened,
        draft: draftInput,
        summary,
        expectedRevisionNumber: input.latest.revisionNumber + 1,
        providerName: aiResult.providerName,
      });
      if (!finalized.ok) return finalized.failure;
      const { draft: simulatedDraft, simulation } = finalized.value;
      return Object.freeze({
        ok: true,
        kind: "simulated",
        conversationId: scope.conversationId,
        draft: simulatedDraft,
        simulation,
        summary,
        duplicate: simulatedDraft.duplicate || simulation.duplicate,
      });
    },
  );
}

async function replaySimulatedConfirmation(input: {
  dependencies: ServiceDependencies;
  input: ConfirmCustomRuleContractInput;
  draft: ContractReadyDraft;
}): Promise<CustomRuleAuthoringResult> {
  const catalog = await loadCatalog(
    input.dependencies.catalog,
    input.input,
    input.draft.businessContract,
  );
  if (
    catalog.version !== input.draft.variableCatalogVersion ||
    catalog.version !== input.input.expectedCatalogVersion
  ) {
    throw serviceError(
      "catalog_hash_mismatch",
      "variable catalog changed before idempotent readback",
      false,
    );
  }
  const summary = await buildExistingDraftSimulation({
    dependencies: input.dependencies,
    scope: input.input,
    draft: input.draft,
    catalog,
    selection: input.input.simulationSelection,
    expectedFormulaHash: input.input.expectedFormulaHash ?? null,
    expectedEvidenceHash: input.input.expectedEvidenceHash ?? null,
    expectedDataSelectionHash: input.input.expectedDataSelectionHash ?? null,
  });
  const simulation = await readExistingSimulation(
    input.dependencies,
    input.input,
    input.draft,
    summary,
  );
  const simulatedDraft = await getSimulatedDraft(
    input.dependencies,
    input.input,
    input.draft.id,
  );
  return Object.freeze({
    ok: true,
    kind: "simulated",
    conversationId: input.input.conversationId,
    draft: simulatedDraft,
    simulation,
    summary,
    duplicate: true,
  });
}

async function buildExistingDraftSimulation(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  draft: ContractReadyDraft;
  catalog: CustomRuleVariableCatalog;
  selection: AuthorizedSimulationSelectionRequest;
  expectedFormulaHash: string | null;
  expectedEvidenceHash: string | null;
  expectedDataSelectionHash: string | null;
}): Promise<CustomRuleSimulationResult> {
  if (
    input.draft.status !== "contract_ready" &&
    input.draft.status !== "simulated"
  ) {
    throw serviceError(
      "invalid_transition",
      "draft is not available for simulation recovery",
      false,
    );
  }
  const deterministic = validateCustomRuleFormula(
    input.draft.generatedFormula.expression,
    {
      scope: input.draft.businessContract.scope,
      executionGrain: input.draft.businessContract.executionGrain,
      parameters: input.draft.businessContract.parameters.map((parameter) => ({
        name: parameter.name,
        valueType: parameter.valueType,
      })),
    },
  );
  const normalized = parseCustomRuleFormula(
    input.draft.generatedFormula.expression,
  );
  if (
    !deterministic.ok ||
    !normalized.ok ||
    deterministic.formulaHash !== input.draft.formulaHash ||
    canonicalJson(normalized.ast) !==
      canonicalJson(input.draft.generatedFormula.normalizedAst) ||
    (input.expectedFormulaHash !== null &&
      input.expectedFormulaHash !== deterministic.formulaHash)
  ) {
    throw serviceError(
      "formula_hash_mismatch",
      "persisted formula failed deterministic recovery validation",
      false,
    );
  }
  const explanation = buildCustomRuleTemplateExplanation({
    ast: deterministic.compiledAst,
  });
  if (explanation !== input.draft.generatedExplanation) {
    throw serviceError(
      "formula_validation_failed",
      "persisted explanation no longer matches the formula",
      false,
    );
  }
  const parameters = parameterValues(input.draft.businessContract);
  const parameterHash = hashCustomRuleParameters(parameters);
  if (
    parameterHash !== input.draft.parameterHash ||
    hashCustomRuleContract(input.draft.businessContract) !==
      input.draft.contractHash ||
    input.catalog.version !== input.draft.variableCatalogVersion
  ) {
    throw serviceError(
      "formula_hash_mismatch",
      "persisted draft hashes are stale",
      false,
    );
  }
  const requirements = readinessRequirements(
    input.draft.businessContract,
    deterministic.variables,
  );
  const readiness = input.dependencies.analyzeReadiness({
    catalog: input.catalog,
    inputs: requirements,
  });
  if (
    !readiness.readyForSimulation ||
    readiness.catalogVersion !== input.catalog.version ||
    readiness.businessTimezone !== input.draft.businessContract.businessTimezone
  ) {
    throw serviceError(
      "readiness_failed",
      "frozen data catalog is not ready for simulation recovery",
      false,
    );
  }
  const evidence = await loadAuthorizedSimulationEvidence(
    input.dependencies.evidence,
    input.scope,
    input.selection,
    requirements,
  );
  if (
    input.expectedEvidenceHash !== null &&
    input.expectedEvidenceHash !== evidence.provenance.evidenceHash
  ) {
    throw serviceError(
      "evidence_hash_mismatch",
      "authorized evidence hash changed before recovery",
      false,
    );
  }
  const simulationInput: CustomRuleSimulationInput = {
    organizationId: input.scope.actor.organizationId,
    actorId: input.scope.actor.userId,
    projectId: input.scope.projectId,
    contract: input.draft.businessContract,
    compiledAst: deterministic.compiledAst,
    parameters,
    formulaHash: deterministic.formulaHash,
    contractHash: input.draft.contractHash,
    parameterHash,
    catalogVersion: input.catalog.version,
    readiness,
    ...evidence,
    aiTestCases: input.draft.generatedTestCases,
  };
  const calculatedSelectionHash =
    calculateCustomRuleDataSelectionHash(simulationInput);
  const summary = input.dependencies.simulate(simulationInput);
  if (
    summary.persistable.formulaHash !== input.draft.formulaHash ||
    summary.persistable.ruleContractHash !== input.draft.contractHash ||
    summary.persistable.parameterHash !== input.draft.parameterHash ||
    summary.persistable.variableCatalogVersion !==
      input.draft.variableCatalogVersion ||
    summary.persistable.dataSelectionHash !== summary.dataSelectionHash ||
    summary.dataSelectionHash !== calculatedSelectionHash ||
    summary.riskFlags.some((flag) => flag.severity === "block")
  ) {
    throw serviceError(
      "simulation_failed",
      "recovered simulation failed freshness or risk validation",
      false,
    );
  }
  if (
    input.expectedDataSelectionHash !== null &&
    input.expectedDataSelectionHash !== summary.dataSelectionHash
  ) {
    throw serviceError(
      "selection_hash_mismatch",
      "final data selection hash changed before recovery",
      false,
    );
  }
  return summary;
}

function createServiceRetryContext(input: {
  action: FrozenServiceRetryContext["action"];
  scope: ScopedTransition;
  idempotencyKey: string;
  expectedRevisionNumber: number;
  expectedDraftId: string | null;
  expectedContractHash?: string | null;
  expectedCatalogVersion?: string | null;
  expectedFormulaHash?: string | null;
  expectedEvidenceHash?: string | null;
  expectedDataSelectionHash?: string | null;
  simulationSelection?: AuthorizedSimulationSelectionRequest | null;
}): FrozenServiceRetryContext {
  const simulationSelection = input.simulationSelection
    ? Object.freeze({
        ...input.simulationSelection,
        criteriaCodes: Object.freeze([
          ...input.simulationSelection.criteriaCodes,
        ]),
      })
    : null;
  return Object.freeze({
    version: 1,
    action: input.action,
    organizationId: input.scope.actor.organizationId,
    actorId: input.scope.actor.userId,
    projectId: input.scope.projectId,
    conversationId: input.scope.conversationId,
    promptText: input.scope.promptText,
    draftIdempotencyKey: input.idempotencyKey,
    expectedRevisionNumber: input.expectedRevisionNumber,
    expectedDraftId: input.expectedDraftId,
    expectedContractHash: input.expectedContractHash ?? null,
    expectedCatalogVersion: input.expectedCatalogVersion ?? null,
    expectedFormulaHash: input.expectedFormulaHash ?? null,
    expectedEvidenceHash: input.expectedEvidenceHash ?? null,
    expectedDataSelectionHash: input.expectedDataSelectionHash ?? null,
    simulationSelection,
  });
}

async function rejectAcceptedTurn(
  conversation: SettlementConversationPort,
  actor: { organizationId: string; userId: string },
  accepted: CreatedConversationTurn,
  errorCode: string,
  publicMessage: string,
): Promise<never> {
  if (accepted.duplicate) {
    throw serviceError(
      "conversation_failed",
      "Duplicate generic conversation turn is owned by another request.",
      true,
      undefined,
      accepted.turnId,
    );
  }
  try {
    await conversation.failTurn(actor, accepted.turnId, {
      errorCode,
      errorSummary: publicMessage,
      retryable: true,
    });
  } catch {
    throw serviceError(
      "conversation_reconciliation_failed",
      "Accepted generic conversation turn could not be reconciled.",
      false,
      undefined,
      accepted.turnId,
    );
  }
  throw serviceError(
    "conversation_failed",
    publicMessage,
    true,
    undefined,
    accepted.turnId,
    "owned_settled",
  );
}

type ObservedConversationTurn = {
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>;
  turn: SettlementConversationTurn;
};

async function observeReturnedTurn(
  conversation: SettlementConversationPort,
  actor: { organizationId: string; userId: string },
  conversationId: string,
  returned: CreatedConversationTurn,
  retryOfTurnId?: string,
): Promise<ObservedConversationTurn> {
  const history = await conversation.getHistory(actor, conversationId);
  const turn = history.turns.find(
    (candidate) => candidate.id === returned.turnId,
  );
  if (
    history.conversation.id !== conversationId ||
    history.conversation.status !== "active" ||
    !turn ||
    turn.conversationId !== conversationId ||
    turn.userMessageId !== returned.userMessageId ||
    turn.assistantMessageId !== returned.assistantMessageId ||
    turn.attempt !== returned.attempt ||
    (retryOfTurnId !== undefined && turn.retryOfTurnId !== retryOfTurnId)
  ) {
    throw new Error("generic conversation turn readback mismatch");
  }
  return { history, turn };
}

function duplicateTurnConflict(
  returned: CreatedConversationTurn,
  observed: SettlementConversationTurn,
): never {
  const active = isActiveConversationTurnStatus(observed.status);
  throw serviceError(
    "conversation_failed",
    active
      ? "Generic conversation turn is already in progress."
      : "Generic conversation turn has already reached a terminal state.",
    active,
    undefined,
    returned.turnId,
  );
}

function isActiveConversationTurnStatus(
  status: ConversationTurnStatus,
): status is "accepted" | "grounding" | "generating" | "validating" {
  return (
    status === "accepted" ||
    status === "grounding" ||
    status === "generating" ||
    status === "validating"
  );
}

async function openStartAiTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  draftIdempotencyKey: string;
}): Promise<OpenStartTurnResult> {
  let accepted: CreatedConversationTurn;
  try {
    accepted = await input.dependencies.conversation.acceptTurn(
      input.scope.actor,
      input.scope.conversationId,
      {
        content: input.scope.promptText,
        mode: "fast",
        clientRequestId: input.scope.clientRequestId,
        attachments: [],
      },
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation turn could not be accepted",
      true,
      error,
    );
  }

  let observed: ObservedConversationTurn;
  try {
    observed = await observeReturnedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      input.scope.conversationId,
      accepted,
    );
  } catch (error) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate generic start turn could not be read back.",
        false,
        error,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      accepted,
      "settlement_turn_setup_failed",
      "Settlement authoring turn setup failed.",
    );
  }

  if (!accepted.duplicate) {
    const catalog = await loadCatalogAfterAcceptedTurn({
      dependencies: input.dependencies,
      scope: input.scope,
      accepted,
      contract: input.currentContract,
    });
    return {
      kind: "opened",
      opened: await prepareFreshAcceptedAiTurn({
        dependencies: input.dependencies,
        scope: input.scope,
        action: "clarify",
        contractConfirmed: false,
        currentContract: input.currentContract,
        currentAmbiguities: input.currentAmbiguities,
        catalog,
        serviceRetryContext: createServiceRetryContext({
          action: "clarify",
          scope: input.scope,
          idempotencyKey: input.draftIdempotencyKey,
          expectedRevisionNumber: 1,
          expectedDraftId: null,
          expectedContractHash: hashCustomRuleContract(input.currentContract),
          expectedCatalogVersion: catalog.version,
        }),
        accepted,
        observed,
      }),
    };
  }

  const drafts = await listScopedDrafts(
    input.dependencies.repository,
    input.scope,
  );
  const replay = drafts.find(
    (draft) => draft.idempotencyKey === input.draftIdempotencyKey,
  );
  if (replay) {
    return {
      kind: "result",
      result: await replayStartDraftWithStableRead({
        dependencies: input.dependencies,
        history: observed.history,
        scope: input.scope,
        currentContract: input.currentContract,
        currentAmbiguities: input.currentAmbiguities,
        draftIdempotencyKey: input.draftIdempotencyKey,
        primaryProvider: input.dependencies.primaryProvider,
        draft: replay,
        drafts,
        expectedDuplicate: accepted,
      }),
    };
  }
  if (drafts.length > 0) {
    throw serviceError(
      "invalid_transition",
      "conversation already owns a settlement authoring session",
      false,
    );
  }
  if (isActiveConversationTurnStatus(observed.turn.status)) {
    return {
      kind: "result",
      result: startTurnInProgress(input.scope, accepted, observed.turn),
    };
  }
  if (!isVerifiedExpiredStartDuplicate(input, accepted, observed)) {
    throw serviceError(
      "conversation_failed",
      "Terminal generic start turn cannot be recovered automatically.",
      false,
      undefined,
      accepted.turnId,
    );
  }
  return openExpiredStartRecovery({ ...input, source: observed });
}

async function loadCatalogAfterAcceptedTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  accepted: CreatedConversationTurn;
  contract: BusinessRuleContract;
}): Promise<CustomRuleVariableCatalog> {
  try {
    return await loadCatalog(
      input.dependencies.catalog,
      input.scope,
      input.contract,
    );
  } catch (error) {
    try {
      await input.dependencies.conversation.failTurn(
        input.scope.actor,
        input.accepted.turnId,
        {
          errorCode: "settlement_catalog_failed",
          errorSummary: "Settlement catalog could not be loaded.",
          retryable: true,
        },
      );
    } catch (reconciliationError) {
      throw serviceError(
        "conversation_reconciliation_failed",
        "Accepted settlement turn could not be reconciled after catalog failure.",
        false,
        reconciliationError,
        input.accepted.turnId,
      );
    }
    if (error instanceof CustomRuleAuthoringServiceError) {
      throw serviceError(
        error.code,
        error.message,
        error.retryable,
        error,
        input.accepted.turnId,
        "owned_settled",
      );
    }
    throw serviceError(
      "catalog_failed",
      "project variable catalog is unavailable",
      true,
      error,
      input.accepted.turnId,
      "owned_settled",
    );
  }
}

function startTurnInProgress(
  scope: ScopedTransition,
  returned: CreatedConversationTurn,
  observed: SettlementConversationTurn,
): CustomRuleRetryInProgress {
  if (!isActiveConversationTurnStatus(observed.status)) {
    throw new Error("start progress requires an active turn");
  }
  return Object.freeze({
    ok: true,
    kind: "retry_in_progress",
    conversationId: scope.conversationId,
    turn: {
      ...retryTurnDto(returned, observed),
      status: observed.status,
    },
  });
}

function isVerifiedExpiredStartDuplicate(
  input: {
    scope: ScopedTransition;
  },
  returned: CreatedConversationTurn,
  observed: ObservedConversationTurn,
): boolean {
  const user = observed.history.messages.find(
    (message) => message.id === returned.userMessageId,
  );
  const assistant = observed.history.messages.find(
    (message) => message.id === returned.assistantMessageId,
  );
  const failureMetadata = leaseExpiredMessageMetadataSchema.safeParse(
    assistant?.metadata,
  );
  return Boolean(
    returned.duplicate &&
    returned.status === "failed" &&
    observed.turn.status === "failed" &&
    observed.turn.errorCode === "turn_lease_expired" &&
    observed.turn.retryable &&
    observed.turn.attempt === 1 &&
    observed.turn.retryOfTurnId === null &&
    observed.turn.regenerateOfTurnId === null &&
    user &&
    user.conversationId === input.scope.conversationId &&
    user.role === "user" &&
    user.status === "completed" &&
    user.parentMessageId === null &&
    user.content === input.scope.promptText.trim() &&
    assistant &&
    assistant.conversationId === input.scope.conversationId &&
    assistant.role === "assistant" &&
    (assistant.status === "failed" || assistant.status === "superseded") &&
    assistant.parentMessageId === returned.userMessageId &&
    failureMetadata.success,
  );
}

async function openExpiredStartRecovery(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  draftIdempotencyKey: string;
  source: ObservedConversationTurn;
}): Promise<OpenStartTurnResult> {
  const sourceTurnId = input.source.turn.id;
  let accepted: CreatedConversationTurn;
  try {
    accepted = await input.dependencies.conversation.retryTurn(
      input.scope.actor,
      sourceTurnId,
      {
        clientRequestId: startRecoveryTurnIdempotencyKey(
          input.scope,
          sourceTurnId,
        ),
      },
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "expired settlement start recovery could not be accepted",
      true,
      error,
      sourceTurnId,
    );
  }

  let observed: ObservedConversationTurn;
  try {
    observed = await observeReturnedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      input.scope.conversationId,
      accepted,
      sourceTurnId,
    );
  } catch (error) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate settlement start recovery could not be read back.",
        false,
        error,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
  if (accepted.conversationId !== input.scope.conversationId) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate settlement start recovery returned a mismatched conversation.",
        false,
        undefined,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
  if (isActiveConversationTurnStatus(observed.turn.status)) {
    if (accepted.duplicate || observed.turn.status !== "accepted") {
      return {
        kind: "result",
        result: startTurnInProgress(input.scope, accepted, observed.turn),
      };
    }
  } else if (
    observed.turn.status === "completed" ||
    observed.turn.status === "failed"
  ) {
    return {
      kind: "result",
      result: await readStartRecoveryArtifact({
        ...input,
        accepted,
        sourceTurnId,
        terminalStatus: observed.turn.status,
      }),
    };
  } else {
    throw serviceError(
      "conversation_failed",
      "Settlement start recovery reached an unsupported terminal state.",
      false,
      undefined,
      accepted.turnId,
    );
  }

  if (
    accepted.duplicate ||
    accepted.status !== "accepted" ||
    observed.turn.status !== "accepted"
  ) {
    throw serviceError(
      "conversation_failed",
      "Settlement start recovery is not available for execution.",
      false,
      undefined,
      accepted.turnId,
    );
  }

  if (input.source.turn.contextSnapshot?.gatewayContext) {
    return {
      kind: "opened",
      opened: await prepareFrozenStartRecovery({
        ...input,
        accepted,
        observed,
        sourceTurnId,
      }),
    };
  }
  const catalog = await loadCatalogAfterAcceptedTurn({
    dependencies: input.dependencies,
    scope: input.scope,
    accepted,
    contract: input.currentContract,
  });
  return {
    kind: "opened",
    opened: await prepareFreshAcceptedAiTurn({
      dependencies: input.dependencies,
      scope: input.scope,
      action: "clarify",
      contractConfirmed: false,
      currentContract: input.currentContract,
      currentAmbiguities: input.currentAmbiguities,
      catalog,
      serviceRetryContext: createServiceRetryContext({
        action: "clarify",
        scope: input.scope,
        idempotencyKey: input.draftIdempotencyKey,
        expectedRevisionNumber: 1,
        expectedDraftId: null,
        expectedContractHash: hashCustomRuleContract(input.currentContract),
        expectedCatalogVersion: catalog.version,
      }),
      accepted,
      observed,
    }),
  };
}

async function prepareFrozenStartRecovery(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  draftIdempotencyKey: string;
  source: ObservedConversationTurn;
  sourceTurnId: string;
  accepted: CreatedConversationTurn;
  observed: ObservedConversationTurn;
}): Promise<OpenedAiTurn> {
  try {
    const preparedTurn = await input.dependencies.conversation.prepareTurn(
      input.scope.actor,
      input.accepted.turnId,
    );
    const gatewayContext = preparedTurn.snapshot.gatewayContext;
    if (!gatewayContext) {
      throw new Error("frozen settlement start recovery context is missing");
    }
    const serviceContextResult = frozenServiceRetryContextSchema.safeParse(
      gatewayContext.invocationMetadata.settlementServiceRetryContext,
    );
    if (!serviceContextResult.success) {
      throw new Error("frozen settlement start service context is invalid");
    }
    const serviceRetryContext = serviceContextResult.data;
    const contractHash = hashCustomRuleContract(input.currentContract);
    if (
      serviceRetryContext.action !== "clarify" ||
      serviceRetryContext.organizationId !== input.scope.actor.organizationId ||
      serviceRetryContext.actorId !== input.scope.actor.userId ||
      serviceRetryContext.projectId !== input.scope.projectId ||
      serviceRetryContext.conversationId !== input.scope.conversationId ||
      serviceRetryContext.promptText !== input.scope.promptText ||
      serviceRetryContext.draftIdempotencyKey !== input.draftIdempotencyKey ||
      serviceRetryContext.expectedRevisionNumber !== 1 ||
      serviceRetryContext.expectedDraftId !== null ||
      serviceRetryContext.expectedContractHash !== contractHash ||
      serviceRetryContext.expectedCatalogVersion === null ||
      serviceRetryContext.expectedFormulaHash !== null ||
      serviceRetryContext.expectedEvidenceHash !== null ||
      serviceRetryContext.expectedDataSelectionHash !== null ||
      serviceRetryContext.simulationSelection !== null
    ) {
      throw new Error("frozen settlement start service context mismatch");
    }
    const prepared = input.dependencies.ai.restore(
      gatewayContext.invocationMetadata.settlementAiRetryContext,
    );
    if (
      prepared.action !== "clarify" ||
      prepared.contractConfirmed ||
      hashCustomRuleContract(prepared.currentContract) !== contractHash ||
      canonicalJson(prepared.currentContract) !==
        canonicalJson(input.currentContract) ||
      prepared.catalog.version !== serviceRetryContext.expectedCatalogVersion ||
      gatewayContext.lastUserMessage !== input.scope.promptText ||
      gatewayContext.invocationMetadata.promptHash !== prepared.promptHash ||
      gatewayContext.invocationMetadata.contextHash !== prepared.contextHash ||
      canonicalJson(preparedTurn.messages) !==
        canonicalJson(gatewayContext.messages) ||
      canonicalJson(prepared.request.messages) !==
        canonicalJson(gatewayContext.messages)
    ) {
      throw new Error("frozen settlement start AI context mismatch");
    }
    await input.dependencies.conversation.markGenerating(
      input.scope.actor,
      input.accepted.turnId,
      input.dependencies.primaryProvider,
    );
    return {
      turnTrace: {
        turnId: input.accepted.turnId,
        userMessageId: input.accepted.userMessageId,
        assistantMessageId: input.accepted.assistantMessageId,
      },
      prepared,
      snapshot: {
        version: preparedTurn.snapshot.version,
        summaryVersion: preparedTurn.snapshot.summaryVersion,
        messageIds: [...preparedTurn.snapshot.messageIds],
      },
      serviceRetryContext,
    };
  } catch {
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      input.accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
}

type StartReplayVerificationInput = {
  history: SettlementConversationHistory;
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  draftIdempotencyKey: string;
  primaryProvider: AiProviderName;
  draft: CustomRuleDraft;
  drafts: CustomRuleDraft[];
  expectedDuplicate?: CreatedConversationTurn;
  expectedSourceTurnId?: string;
};

function replayVerifiedStartDraft(
  input: StartReplayVerificationInput,
): CustomRuleClarifyingSuccess | CustomRuleAiTransitionFailure {
  try {
    return verifiedStartReplayResult(input);
  } catch (error) {
    throwPublicStartReplayMismatch(error, input.draft.turnTrace.turnId);
  }
}

async function replayStartDraftWithStableRead(
  input: StartReplayVerificationInput & {
    dependencies: ServiceDependencies;
  },
): Promise<CustomRuleClarifyingSuccess | CustomRuleAiTransitionFailure> {
  try {
    return verifiedStartReplayResult(input);
  } catch (error) {
    if (!(error instanceof StartReplayMismatchError)) throw error;
  }

  let previousVerifiedFingerprint: string | null = null;
  let lastTurnId = input.draft.turnTrace.turnId;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const drafts = await listScopedDrafts(
      input.dependencies.repository,
      input.scope,
    );
    const history = await requireConversationHistory(
      input.dependencies.conversation,
      input.scope.actor,
      input.scope.conversationId,
    );
    const draft = drafts.find(
      (candidate) => candidate.idempotencyKey === input.draftIdempotencyKey,
    );
    if (!draft) {
      previousVerifiedFingerprint = null;
      continue;
    }
    lastTurnId = draft.turnTrace.turnId;
    const candidate = { ...input, drafts, history, draft };
    try {
      const result = verifiedStartReplayResult(candidate);
      const fingerprint = startReplayReadbackFingerprint(candidate);
      if (fingerprint === previousVerifiedFingerprint) return result;
      previousVerifiedFingerprint = fingerprint;
    } catch (error) {
      if (!(error instanceof StartReplayMismatchError)) throw error;
      previousVerifiedFingerprint = null;
    }
  }
  throwPublicStartReplayMismatch(
    new StartReplayMismatchError(lastTurnId),
    lastTurnId,
  );
}

function verifiedStartReplayResult(
  input: StartReplayVerificationInput,
): CustomRuleClarifyingSuccess | CustomRuleAiTransitionFailure {
  requireMatchingStartReplay(input);
  return input.draft.initialStatus === "failed"
    ? replayFailure(input.draft)
    : replayClarifying(input.draft, input.drafts);
}

function startReplayReadbackFingerprint(
  input: StartReplayVerificationInput,
): string {
  const successor = input.history.turns.find(
    (turn) => turn.id === input.draft.turnTrace.turnId,
  );
  const source = successor?.retryOfTurnId
    ? input.history.turns.find((turn) => turn.id === successor.retryOfTurnId)
    : null;
  const messageIds = new Set<string>([
    input.draft.turnTrace.userMessageId,
    input.draft.turnTrace.assistantMessageId,
  ]);
  if (source) {
    messageIds.add(source.userMessageId);
    messageIds.add(source.assistantMessageId);
  }
  for (const messageId of successor?.contextSnapshot?.messageIds ?? []) {
    messageIds.add(messageId);
  }
  return canonicalJson({
    draft: input.draft,
    drafts: input.drafts,
    messages: input.history.messages.filter((message) =>
      messageIds.has(message.id),
    ),
    source: source ?? null,
    successor: successor ?? null,
  });
}

function requireMatchingStartReplay(input: StartReplayVerificationInput): void {
  const successor = input.history.turns.find(
    (turn) => turn.id === input.draft.turnTrace.turnId,
  );
  if (!successor) startReplayMismatch(input.draft.turnTrace.turnId);
  requireMatchingStartDraftArtifact(input, successor);
  requireMatchingTerminalStartTurn(input.history, successor, input.draft);

  if (successor.retryOfTurnId === null) {
    if (
      input.expectedSourceTurnId !== undefined ||
      successor.attempt !== 1 ||
      successor.regenerateOfTurnId !== null ||
      (input.expectedDuplicate !== undefined &&
        !matchesReturnedTurn(input.expectedDuplicate, successor))
    ) {
      startReplayMismatch(successor.id);
    }
    return;
  }

  const source = input.history.turns.find(
    (turn) => turn.id === successor.retryOfTurnId,
  );
  if (
    !source ||
    (input.expectedSourceTurnId !== undefined &&
      source.id !== input.expectedSourceTurnId) ||
    (input.expectedDuplicate !== undefined &&
      !matchesReturnedTurn(input.expectedDuplicate, source))
  ) {
    startReplayMismatch(successor.id);
  }
  requireMatchingExpiredStartSource(input, source, successor);
  requireMatchingFrozenStartRecovery(input, source, successor);
}

function requireMatchingStartDraftArtifact(
  input: StartReplayVerificationInput,
  turn: SettlementConversationTurn,
): void {
  const draft = input.draft;
  if (
    draft.organizationId !== input.scope.actor.organizationId ||
    draft.projectId !== input.scope.projectId ||
    draft.conversationId !== input.scope.conversationId ||
    draft.createdBy !== input.scope.actor.userId ||
    draft.idempotencyKey !== input.draftIdempotencyKey ||
    draft.promptText !== input.scope.promptText ||
    draft.revisionNumber !== 1 ||
    draft.supersedesDraftId !== null ||
    (draft.initialStatus !== "clarifying" &&
      draft.initialStatus !== "failed") ||
    draft.contractHash !== hashCustomRuleContract(draft.businessContract) ||
    draft.parameterHash !==
      hashCustomRuleParameters(parameterValues(draft.businessContract)) ||
    !HASH_PATTERN.test(draft.variableCatalogVersion) ||
    turn.conversationId !== input.scope.conversationId ||
    turn.mode !== "fast" ||
    turn.userMessageId !== draft.turnTrace.userMessageId ||
    turn.assistantMessageId !== draft.turnTrace.assistantMessageId
  ) {
    startReplayMismatch(turn.id);
  }
}

function requireMatchingTerminalStartTurn(
  history: SettlementConversationHistory,
  turn: SettlementConversationTurn,
  draft: CustomRuleDraft,
): void {
  const user = history.messages.find(
    (message) => message.id === turn.userMessageId,
  );
  const assistant = history.messages.find(
    (message) => message.id === turn.assistantMessageId,
  );
  const completionMetadata = atomicCompletionMetadataSchema.safeParse(
    assistant?.metadata,
  );
  const snapshot = turn.contextSnapshot;
  const terminalMatches =
    draft.initialStatus === "clarifying"
      ? turn.status === "completed" &&
        turn.errorCode === null &&
        !turn.retryable &&
        assistant?.status === "completed"
      : turn.status === "failed" &&
        turn.errorCode !== null &&
        assistant?.status === "failed";
  if (
    !terminalMatches ||
    turn.regenerateOfTurnId !== null ||
    !user ||
    user.conversationId !== draft.conversationId ||
    user.role !== "user" ||
    user.status !== "completed" ||
    user.parentMessageId !== null ||
    user.content !== draft.promptText ||
    !assistant ||
    assistant.conversationId !== draft.conversationId ||
    assistant.role !== "assistant" ||
    assistant.parentMessageId !== user.id ||
    assistant.content !== draft.aiResponse.content ||
    !completionMetadata.success ||
    !snapshot ||
    completionMetadata.data.contextSnapshotVersion !== snapshot.version ||
    completionMetadata.data.contextSummaryVersion !== snapshot.summaryVersion ||
    canonicalJson(completionMetadata.data.contextMessageIds) !==
      canonicalJson(snapshot.messageIds) ||
    completionMetadata.data.settlementIdempotencyKey !== draft.idempotencyKey ||
    completionMetadata.data.settlementInitialStatus !== draft.initialStatus ||
    new Set(completionMetadata.data.contextMessageIds).size !==
      completionMetadata.data.contextMessageIds.length ||
    !completionMetadata.data.contextMessageIds.every((messageId) =>
      history.messages.some((message) => message.id === messageId),
    )
  ) {
    startReplayMismatch(turn.id);
  }
}

function requireMatchingExpiredStartSource(
  input: StartReplayVerificationInput,
  source: SettlementConversationTurn,
  successor: SettlementConversationTurn,
): void {
  const user = input.history.messages.find(
    (message) => message.id === source.userMessageId,
  );
  const assistant = input.history.messages.find(
    (message) => message.id === source.assistantMessageId,
  );
  const metadata = leaseExpiredMessageMetadataSchema.safeParse(
    assistant?.metadata,
  );
  const successorCount = input.history.turns.filter(
    (turn) => turn.retryOfTurnId === source.id,
  ).length;
  if (
    source.status !== "failed" ||
    source.errorCode !== "turn_lease_expired" ||
    !source.retryable ||
    source.attempt !== 1 ||
    source.retryOfTurnId !== null ||
    source.regenerateOfTurnId !== null ||
    source.userMessageId !== successor.userMessageId ||
    successor.attempt !== 2 ||
    successor.retryOfTurnId !== source.id ||
    successor.regenerateOfTurnId !== null ||
    successorCount !== 1 ||
    !user ||
    user.conversationId !== input.scope.conversationId ||
    user.role !== "user" ||
    user.status !== "completed" ||
    user.parentMessageId !== null ||
    user.content !== input.scope.promptText ||
    !assistant ||
    assistant.conversationId !== input.scope.conversationId ||
    assistant.role !== "assistant" ||
    assistant.status !== "superseded" ||
    assistant.content !== "" ||
    assistant.parentMessageId !== source.userMessageId ||
    !metadata.success
  ) {
    startReplayMismatch(successor.id);
  }
}

function requireMatchingFrozenStartRecovery(
  input: StartReplayVerificationInput,
  source: SettlementConversationTurn,
  successor: SettlementConversationTurn,
): void {
  const snapshot = successor.contextSnapshot;
  const gatewayResult = recoveryGatewayContextSchema.safeParse(
    snapshot?.gatewayContext,
  );
  if (!snapshot || !gatewayResult.success) {
    startReplayMismatch(successor.id);
  }
  const gateway = gatewayResult.data;
  const invocation = gateway.invocationMetadata;
  const aiContext = invocation.settlementAiRetryContext;
  const serviceContext = invocation.settlementServiceRetryContext;
  const expectedContractHash = hashCustomRuleContract(input.currentContract);
  const expectedPromptHash = sha256(canonicalJson(aiContext.messages));
  const expectedContextHash = sha256(
    canonicalJson({
      catalogVersion: aiContext.catalog.version,
      contract: aiContext.currentContract,
      messages: aiContext.messages,
      unresolvedAmbiguities: aiContext.unresolvedAmbiguities,
    }),
  );
  const sourceSnapshot = source.contextSnapshot;
  if (
    serviceContext.action !== "clarify" ||
    serviceContext.organizationId !== input.scope.actor.organizationId ||
    serviceContext.actorId !== input.scope.actor.userId ||
    serviceContext.projectId !== input.scope.projectId ||
    serviceContext.conversationId !== input.scope.conversationId ||
    serviceContext.promptText !== input.scope.promptText ||
    serviceContext.draftIdempotencyKey !== input.draftIdempotencyKey ||
    serviceContext.expectedRevisionNumber !== 1 ||
    serviceContext.expectedDraftId !== null ||
    serviceContext.expectedContractHash !== expectedContractHash ||
    serviceContext.expectedCatalogVersion !==
      input.draft.variableCatalogVersion ||
    serviceContext.expectedFormulaHash !== null ||
    serviceContext.expectedEvidenceHash !== null ||
    serviceContext.expectedDataSelectionHash !== null ||
    serviceContext.simulationSelection !== null ||
    aiContext.action !== "clarify" ||
    aiContext.contractConfirmed ||
    canonicalJson(aiContext.currentContract) !==
      canonicalJson(input.currentContract) ||
    canonicalJson(aiContext.unresolvedAmbiguities) !==
      canonicalJson(
        canonicalizeSettlementAmbiguities(input.currentAmbiguities),
      ) ||
    aiContext.catalog.version !== input.draft.variableCatalogVersion ||
    aiContext.catalog.scope !== input.currentContract.scope ||
    aiContext.catalog.executionGrain !== input.currentContract.executionGrain ||
    aiContext.promptHash !== expectedPromptHash ||
    aiContext.contextHash !== expectedContextHash ||
    invocation.promptHash !== expectedPromptHash ||
    invocation.contextHash !== expectedContextHash ||
    invocation.snapshotVersion !== snapshot.version ||
    invocation.summaryVersion !== snapshot.summaryVersion ||
    canonicalJson(gateway.messages) !== canonicalJson(aiContext.messages) ||
    gateway.mode !== "fast" ||
    gateway.primaryProvider !== input.primaryProvider ||
    gateway.lastUserMessage !== input.scope.promptText ||
    gateway.responseMetadata.grounding.catalogVersion !==
      input.draft.variableCatalogVersion ||
    gateway.responseMetadata.grounding.scope !== aiContext.catalog.scope ||
    gateway.responseMetadata.grounding.executionGrain !==
      aiContext.catalog.executionGrain ||
    (sourceSnapshot?.gatewayContext !== undefined &&
      canonicalJson(sourceSnapshot) !== canonicalJson(snapshot))
  ) {
    startReplayMismatch(successor.id);
  }
}

function matchesReturnedTurn(
  returned: CreatedConversationTurn,
  turn: SettlementConversationTurn,
): boolean {
  return (
    returned.duplicate &&
    returned.conversationId === turn.conversationId &&
    returned.turnId === turn.id &&
    returned.userMessageId === turn.userMessageId &&
    returned.assistantMessageId === turn.assistantMessageId &&
    returned.status === turn.status &&
    returned.attempt === turn.attempt
  );
}

class StartReplayMismatchError extends Error {
  constructor(readonly sourceTurnId: string) {
    super("settlement start replay mismatch");
    this.name = "StartReplayMismatchError";
  }
}

function startReplayMismatch(sourceTurnId: string): never {
  throw new StartReplayMismatchError(sourceTurnId);
}

function throwPublicStartReplayMismatch(
  error: unknown,
  fallbackTurnId: string,
): never {
  if (!(error instanceof StartReplayMismatchError)) throw error;
  throw serviceError(
    "conversation_failed",
    "Settlement start replay does not match its durable recovery lineage.",
    false,
    undefined,
    error.sourceTurnId || fallbackTurnId,
  );
}

async function readStartRecoveryArtifact(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  draftIdempotencyKey: string;
  accepted: CreatedConversationTurn;
  sourceTurnId: string;
  terminalStatus: "completed" | "failed";
}): Promise<CustomRuleClarifyingSuccess | CustomRuleAiTransitionFailure> {
  let previousFingerprint: string | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [drafts, observed] = await Promise.all([
      listScopedDrafts(input.dependencies.repository, input.scope),
      observeReturnedTurn(
        input.dependencies.conversation,
        input.scope.actor,
        input.scope.conversationId,
        input.accepted,
        input.sourceTurnId,
      ),
    ]);
    const draft = retryDomainDraft(drafts, input.accepted);
    if (draft) {
      if (
        draft.idempotencyKey !== input.draftIdempotencyKey ||
        draft.revisionNumber !== 1
      ) {
        throw serviceError(
          "conversation_failed",
          "Settlement start recovery artifact does not match its operation.",
          false,
          undefined,
          input.accepted.turnId,
        );
      }
      if (
        input.terminalStatus === "completed" &&
        draft.initialStatus === "clarifying" &&
        draft.status === "clarifying"
      ) {
        return replayVerifiedStartDraft({
          history: observed.history,
          scope: input.scope,
          currentContract: input.currentContract,
          currentAmbiguities: input.currentAmbiguities,
          draftIdempotencyKey: input.draftIdempotencyKey,
          primaryProvider: input.dependencies.primaryProvider,
          draft,
          drafts,
          expectedSourceTurnId: input.sourceTurnId,
        });
      }
      if (
        input.terminalStatus === "failed" &&
        draft.initialStatus === "failed" &&
        draft.status === "failed"
      ) {
        return replayVerifiedStartDraft({
          history: observed.history,
          scope: input.scope,
          currentContract: input.currentContract,
          currentAmbiguities: input.currentAmbiguities,
          draftIdempotencyKey: input.draftIdempotencyKey,
          primaryProvider: input.dependencies.primaryProvider,
          draft,
          drafts,
          expectedSourceTurnId: input.sourceTurnId,
        });
      }
      throw serviceError(
        "conversation_failed",
        "Settlement start recovery terminal state conflicts with its artifact.",
        false,
        undefined,
        input.accepted.turnId,
      );
    }
    const assistant = observed.history.messages.find(
      (message) => message.id === input.accepted.assistantMessageId,
    );
    const fingerprint = canonicalJson({
      assistant: assistant ?? null,
      terminalStatus: observed.turn.status,
    });
    if (fingerprint === previousFingerprint) break;
    previousFingerprint = fingerprint;
  }
  throw serviceError(
    "conversation_failed",
    "Terminal settlement start recovery has no durable draft.",
    false,
    undefined,
    input.accepted.turnId,
  );
}

async function openAiTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  action: "clarify" | "revise" | "confirm";
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  serviceRetryContext: FrozenServiceRetryContext;
}): Promise<OpenedAiTurn> {
  let accepted;
  try {
    accepted = await input.dependencies.conversation.acceptTurn(
      input.scope.actor,
      input.scope.conversationId,
      {
        content: input.scope.promptText,
        mode: "fast",
        clientRequestId: input.scope.clientRequestId,
        attachments: [],
      },
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation turn could not be accepted",
      true,
      error,
    );
  }
  let observed: ObservedConversationTurn;
  try {
    observed = await observeReturnedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      input.scope.conversationId,
      accepted,
    );
  } catch (error) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate generic conversation turn could not be read back.",
        false,
        error,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      accepted,
      "settlement_turn_setup_failed",
      "Settlement authoring turn setup failed.",
    );
  }
  if (accepted.duplicate) {
    duplicateTurnConflict(accepted, observed.turn);
  }
  return prepareFreshAcceptedAiTurn({
    ...input,
    accepted,
    observed,
  });
}

async function prepareFreshAcceptedAiTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  action: "clarify" | "revise" | "confirm";
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
  serviceRetryContext: FrozenServiceRetryContext;
  accepted: CreatedConversationTurn;
  observed: ObservedConversationTurn;
}): Promise<OpenedAiTurn> {
  const { accepted } = input;
  try {
    if (
      accepted.conversationId !== input.scope.conversationId ||
      accepted.duplicate ||
      accepted.status !== "accepted" ||
      input.observed.turn.status !== "accepted"
    ) {
      throw new Error("accepted conversation turn scope or status mismatch");
    }
    const preparedTurn = await input.dependencies.conversation.prepareTurn(
      input.scope.actor,
      accepted.turnId,
      [
        `settlement-catalog:${input.catalog.version}`,
        `settlement-contract:${hashCustomRuleContract(input.currentContract)}`,
      ],
    );
    const prepared = input.dependencies.ai.prepare({
      action: input.action,
      contractConfirmed: input.contractConfirmed,
      userMessage: input.scope.promptText,
      currentContract: input.currentContract,
      unresolvedAmbiguities: input.currentAmbiguities,
      catalog: input.catalog,
      conversationMessages: preparedTurn.messages,
    });
    const gatewayContext = {
      messages: prepared.request.messages.map((message) => ({ ...message })),
      attachments: [],
      mode: "fast" as const,
      primaryProvider: input.dependencies.primaryProvider,
      lastUserMessage: input.scope.promptText,
      responseMetadata: {
        grounding: {
          catalogVersion: input.catalog.version,
          scope: input.catalog.scope,
          executionGrain: input.catalog.executionGrain,
        },
        knowledge: {},
        retrospectiveDraft: null,
      },
      invocationMetadata: {
        promptHash: prepared.promptHash,
        contextHash: prepared.contextHash,
        snapshotVersion: preparedTurn.snapshot.version,
        summaryVersion: preparedTurn.snapshot.summaryVersion,
        settlementAiRetryContext: prepared.retryContext,
        settlementServiceRetryContext: input.serviceRetryContext,
      },
    };
    const captured =
      await input.dependencies.conversation.captureGatewayContext(
        input.scope.actor,
        accepted.turnId,
        preparedTurn.snapshot,
        gatewayContext,
      );
    await input.dependencies.conversation.markGenerating(
      input.scope.actor,
      accepted.turnId,
      input.dependencies.primaryProvider,
    );
    return {
      turnTrace: {
        turnId: accepted.turnId,
        userMessageId: accepted.userMessageId,
        assistantMessageId: accepted.assistantMessageId,
      },
      prepared,
      snapshot: {
        version: captured.version,
        summaryVersion: captured.summaryVersion,
        messageIds: [...captured.messageIds],
      },
      serviceRetryContext: input.serviceRetryContext,
    };
  } catch {
    return rejectAcceptedTurn(
      input.dependencies.conversation,
      input.scope.actor,
      accepted,
      "settlement_turn_setup_failed",
      "Settlement authoring turn setup failed.",
    );
  }
}

async function openRetryTurn(
  dependencies: ServiceDependencies,
  input: RetryCustomRuleTurnInput,
  drafts: CustomRuleDraft[],
): Promise<OpenRetryTurnResult> {
  let accepted;
  try {
    accepted = await dependencies.conversation.retryTurn(
      input.actor,
      input.sourceTurnId,
      { clientRequestId: input.clientRequestId },
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation retry could not be accepted",
      true,
      error,
    );
  }
  let observed: ObservedConversationTurn;
  try {
    observed = await observeReturnedTurn(
      dependencies.conversation,
      input.actor,
      input.conversationId,
      accepted,
      input.sourceTurnId,
    );
  } catch (error) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate generic retry could not be read back.",
        false,
        error,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      dependencies.conversation,
      input.actor,
      accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
  if (accepted.conversationId !== input.conversationId) {
    if (accepted.duplicate) {
      throw serviceError(
        "conversation_failed",
        "Duplicate generic retry returned a mismatched conversation.",
        false,
        undefined,
        accepted.turnId,
      );
    }
    return rejectAcceptedTurn(
      dependencies.conversation,
      input.actor,
      accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
  const turn = retryTurnDto(accepted, observed.turn);
  if (
    observed.turn.status === "grounding" ||
    observed.turn.status === "generating" ||
    observed.turn.status === "validating" ||
    (observed.turn.status === "accepted" && accepted.duplicate)
  ) {
    return {
      kind: "result",
      result: Object.freeze({
        ok: true,
        kind: "retry_in_progress",
        conversationId: input.conversationId,
        turn: { ...turn, status: observed.turn.status },
      }),
    };
  }
  if (observed.turn.status === "completed") {
    const refreshedDrafts = await listScopedDrafts(
      dependencies.repository,
      input,
    );
    const draft = retryDomainDraft(refreshedDrafts, accepted);
    if (
      !draft ||
      (draft.initialStatus === "clarifying" && draft.status !== "clarifying") ||
      (draft.initialStatus === "contract_ready" &&
        draft.status !== "simulated") ||
      draft.initialStatus === "failed"
    ) {
      throw serviceError(
        "conversation_failed",
        "completed generic retry has no matching durable settlement artifact",
        false,
        undefined,
        accepted.turnId,
      );
    }
    requireMatchingCompletedRetry(
      observed,
      accepted,
      input.sourceTurnId,
      draft,
    );
    requireMatchingManualRetrySemanticKey(observed, drafts, input, draft);
    return {
      kind: "result",
      result: Object.freeze({
        ok: true,
        kind: "retry_readback",
        conversationId: input.conversationId,
        draft,
        turn: { ...turn, status: "completed" as const },
      }),
    };
  }
  if (observed.turn.status === "failed") {
    if (!observed.turn.retryable) {
      throw serviceError(
        "conversation_failed",
        "generic retry is already failed and not retryable",
        false,
        undefined,
        accepted.turnId,
      );
    }
    const failedDraft = retryDomainDraft(drafts, accepted);
    return {
      kind: "result",
      result: Object.freeze({
        ok: false,
        kind: "retry_failed",
        code: "conversation_failed",
        retryable: true,
        conversationId: input.conversationId,
        sourceTurnId: accepted.turnId,
        failedDraft,
        turn: { ...turn, status: "failed" as const },
      }),
    };
  }
  if (observed.turn.status === "cancelled") {
    throw serviceError(
      "conversation_failed",
      "generic retry is cancelled",
      false,
      undefined,
      accepted.turnId,
    );
  }
  if (observed.turn.status !== "accepted") {
    throw serviceError(
      "conversation_failed",
      "generic retry returned an unsupported turn state",
      false,
      undefined,
      accepted.turnId,
    );
  }
  try {
    const preparedTurn = await dependencies.conversation.prepareTurn(
      input.actor,
      accepted.turnId,
    );
    const gatewayContext = preparedTurn.snapshot.gatewayContext;
    if (!gatewayContext) {
      throw new Error("generic retry has no frozen gateway context");
    }
    const serviceContextResult = frozenServiceRetryContextSchema.safeParse(
      gatewayContext.invocationMetadata.settlementServiceRetryContext,
    );
    if (!serviceContextResult.success) {
      throw new Error("settlement retry metadata is invalid");
    }
    const serviceRetryContext = serviceContextResult.data;
    if (
      serviceRetryContext.organizationId !== input.actor.organizationId ||
      serviceRetryContext.actorId !== input.actor.userId ||
      serviceRetryContext.projectId !== input.projectId ||
      serviceRetryContext.conversationId !== input.conversationId ||
      (serviceRetryContext.action === "confirm") !==
        (serviceRetryContext.simulationSelection !== null)
    ) {
      throw new Error("settlement retry metadata scope mismatch");
    }
    const prepared = dependencies.ai.restore(
      gatewayContext.invocationMetadata.settlementAiRetryContext,
    );
    if (
      prepared.action !== serviceRetryContext.action ||
      canonicalJson(preparedTurn.messages) !==
        canonicalJson(gatewayContext.messages) ||
      canonicalJson(prepared.request.messages) !==
        canonicalJson(gatewayContext.messages)
    ) {
      throw new Error("frozen settlement retry context mismatch");
    }
    await dependencies.conversation.markGenerating(
      input.actor,
      accepted.turnId,
      dependencies.primaryProvider,
    );
    return {
      kind: "opened",
      opened: {
        turnTrace: {
          turnId: accepted.turnId,
          userMessageId: accepted.userMessageId,
          assistantMessageId: accepted.assistantMessageId,
        },
        prepared,
        snapshot: {
          version: preparedTurn.snapshot.version,
          summaryVersion: preparedTurn.snapshot.summaryVersion,
          messageIds: [...preparedTurn.snapshot.messageIds],
        },
        serviceRetryContext,
      },
    };
  } catch {
    return rejectAcceptedTurn(
      dependencies.conversation,
      input.actor,
      accepted,
      "settlement_retry_setup_failed",
      "Settlement authoring retry setup failed.",
    );
  }
}

function requireMatchingManualRetrySemanticKey(
  observed: ObservedConversationTurn,
  drafts: CustomRuleDraft[],
  input: RetryCustomRuleTurnInput,
  draft: CustomRuleDraft,
): void {
  const sourceFailedDraft = drafts.find(
    (candidate) =>
      candidate.turnTrace.turnId === input.sourceTurnId &&
      candidate.initialStatus === "failed",
  );
  if (!sourceFailedDraft) return;
  const source = observed.history.turns.find(
    (turn) => turn.id === input.sourceTurnId,
  );
  const serviceContextResult = frozenServiceRetryContextSchema.safeParse(
    source?.contextSnapshot?.gatewayContext?.invocationMetadata
      .settlementServiceRetryContext,
  );
  if (!source || !serviceContextResult.success) {
    throw serviceError(
      "conversation_failed",
      "completed retry source context is unavailable",
      false,
      undefined,
      draft.turnTrace.turnId,
    );
  }
  const expectedKey = retryDraftIdempotencyKey(
    serviceContextResult.data.draftIdempotencyKey,
    input.sourceTurnId,
    input.clientRequestId,
  );
  if (draft.idempotencyKey !== expectedKey) {
    throw serviceError(
      serviceContextResult.data.action === "confirm"
        ? "invalid_transition"
        : "stale_revision",
      "retry request does not match the completed semantic successor",
      false,
      undefined,
      draft.turnTrace.turnId,
    );
  }
}

function retryTurnDto(
  returned: CreatedConversationTurn,
  observed: SettlementConversationTurn,
): CustomRuleRetryTurnDto {
  return Object.freeze({
    turnId: returned.turnId,
    status: observed.status,
    attempt: observed.attempt,
    duplicate: returned.duplicate,
  });
}

function retryDomainDraft(
  drafts: CustomRuleDraft[],
  returned: CreatedConversationTurn,
): CustomRuleDraft | null {
  return (
    drafts.find(
      (draft) =>
        draft.turnTrace.turnId === returned.turnId &&
        draft.turnTrace.userMessageId === returned.userMessageId &&
        draft.turnTrace.assistantMessageId === returned.assistantMessageId,
    ) ?? null
  );
}

function requireMatchingCompletedRetry(
  observed: ObservedConversationTurn,
  returned: CreatedConversationTurn,
  sourceTurnId: string,
  draft: CustomRuleDraft,
): void {
  const assistant = observed.history.messages.find(
    (message) => message.id === returned.assistantMessageId,
  );
  const metadata = atomicCompletionMetadataSchema.safeParse(
    assistant?.metadata,
  );
  const snapshot = observed.turn.contextSnapshot;
  if (
    observed.turn.status !== "completed" ||
    observed.turn.retryOfTurnId !== sourceTurnId ||
    observed.turn.errorCode !== null ||
    observed.turn.retryable ||
    draft.turnTrace.turnId !== returned.turnId ||
    draft.turnTrace.userMessageId !== returned.userMessageId ||
    draft.turnTrace.assistantMessageId !== returned.assistantMessageId ||
    !assistant ||
    assistant.conversationId !== returned.conversationId ||
    assistant.role !== "assistant" ||
    assistant.status !== "completed" ||
    assistant.parentMessageId !== returned.userMessageId ||
    assistant.content !== draft.aiResponse.content ||
    !metadata.success ||
    !snapshot ||
    metadata.data.contextSnapshotVersion !== snapshot.version ||
    metadata.data.contextSummaryVersion !== snapshot.summaryVersion ||
    canonicalJson(metadata.data.contextMessageIds) !==
      canonicalJson(snapshot.messageIds) ||
    metadata.data.settlementIdempotencyKey !== draft.idempotencyKey ||
    metadata.data.settlementInitialStatus !== draft.initialStatus ||
    new Set(metadata.data.contextMessageIds).size !==
      metadata.data.contextMessageIds.length ||
    !metadata.data.contextMessageIds.every((messageId) =>
      observed.history.messages.some((message) => message.id === messageId),
    )
  ) {
    throw serviceError(
      "conversation_failed",
      "completed generic retry readback does not match its durable artifact",
      false,
      undefined,
      returned.turnId,
    );
  }
}

async function executeAi(
  ai: SettlementRuleAiPort,
  prepared: PreparedSettlementAiRequest,
): Promise<SettlementAiResult> {
  try {
    return await ai.execute(prepared);
  } catch {
    return {
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
      message: AI_PROVIDER_FAILURE_MESSAGE,
      promptHash: prepared.promptHash,
      contextHash: prepared.contextHash,
    };
  }
}

async function handleAiFailure(input: {
  dependencies: ServiceDependencies;
  persistFailedRevisions: boolean;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  failure: SettlementAiFailure;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalogVersion: string;
  idempotencyKey: string;
  expectedRevisionNumber: number;
}): Promise<CustomRuleAiTransitionFailure> {
  let failedDraft: CustomRuleDraft | null = null;
  if (input.persistFailedRevisions) {
    await markValidating(
      input.dependencies.conversation,
      input.scope,
      input.opened,
    );
    const failedInput: FailedCustomRuleDraftInput = {
      organizationId: input.scope.actor.organizationId,
      projectId: input.scope.projectId,
      conversationId: input.scope.conversationId,
      idempotencyKey: input.idempotencyKey,
      promptText: input.scope.promptText,
      turnTrace: input.opened.turnTrace,
      businessContract: input.currentContract,
      unresolvedAmbiguities: [...input.currentAmbiguities],
      variableCatalogVersion: input.catalogVersion,
      aiResponse: {
        content: input.failure.message,
        finishReason: "stop",
        providerRequestId: null,
      },
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      model: input.failure.providerName ?? input.dependencies.primaryProvider,
      safetyFlags: [
        {
          code: "ai_generation_failed",
          severity: "warning",
          message: input.failure.message,
        },
      ],
      contractHash: hashCustomRuleContract(input.currentContract),
      formulaHash: null,
      parameterHash: hashCustomRuleParameters(
        parameterValues(input.currentContract),
      ),
      status: "failed",
    };
    const finalized = await finalizeFailedTurn({
      dependencies: input.dependencies,
      scope: input.scope,
      opened: input.opened,
      draft: failedInput,
      expectedRevisionNumber: input.expectedRevisionNumber,
      providerName: input.failure.providerName,
      failureSemantics: failedTurnSemantics(
        input.failure.code,
        input.failure.retryable,
      ),
    });
    if (!finalized.ok) return finalized.failure;
    failedDraft = finalized.draft;
  } else {
    await failConversationTurn(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      input.failure.code,
      input.failure.retryable,
      input.failure.message,
      input.failure.providerName,
    );
  }
  return Object.freeze({
    ok: false,
    code: input.failure.code,
    retryable: true,
    conversationId: input.scope.conversationId,
    sourceTurnId: input.opened.turnTrace.turnId,
    turnTrace: input.opened.turnTrace,
    failedDraft,
  });
}

async function handleDomainFailure(input: {
  dependencies: ServiceDependencies;
  persistFailedRevisions: boolean;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  code: CustomRuleAuthoringServiceErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
  currentContract: BusinessRuleContract;
  catalogVersion: string;
  idempotencyKey: string;
  expectedRevisionNumber: number;
  providerName?: AiProviderName;
}): Promise<never> {
  if (!input.persistFailedRevisions) {
    return failAndThrow(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      input.code,
      input.message,
      input.retryable,
      input.cause,
    );
  }
  const failedInput: FailedCustomRuleDraftInput = {
    organizationId: input.scope.actor.organizationId,
    projectId: input.scope.projectId,
    conversationId: input.scope.conversationId,
    idempotencyKey: input.idempotencyKey,
    promptText: input.scope.promptText,
    turnTrace: input.opened.turnTrace,
    businessContract: input.currentContract,
    unresolvedAmbiguities: [],
    variableCatalogVersion: input.catalogVersion,
    aiResponse: {
      content: input.message,
      finishReason: "stop",
      providerRequestId: null,
    },
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    model: input.providerName ?? input.dependencies.primaryProvider,
    safetyFlags: [
      {
        code: `domain_${input.code}`,
        severity: "warning",
        message: input.message,
      },
    ],
    contractHash: hashCustomRuleContract(input.currentContract),
    formulaHash: null,
    parameterHash: hashCustomRuleParameters(
      parameterValues(input.currentContract),
    ),
    status: "failed",
  };
  const finalized = await finalizeFailedTurn({
    dependencies: input.dependencies,
    scope: input.scope,
    opened: input.opened,
    draft: failedInput,
    expectedRevisionNumber: input.expectedRevisionNumber,
    providerName: input.providerName,
    failureSemantics: failedTurnSemantics(input.code, input.retryable),
  });
  if (!finalized.ok) {
    throw serviceError(
      "persistence_failed",
      "Atomic failed revision did not commit.",
      true,
      input.cause,
      input.opened.turnTrace.turnId,
      "owned_settled",
    );
  }
  throw serviceError(
    input.code,
    input.message,
    input.retryable,
    input.cause,
    input.opened.turnTrace.turnId,
    "owned_settled",
  );
}

type AtomicDraftFinalization =
  | { ok: true; draft: CreatedCustomRuleDraft }
  | { ok: false; failure: CustomRuleAiTransitionFailure };

type AtomicSimulationFinalization =
  | { ok: true; value: FinalizedSettlementAiSimulationTurn }
  | { ok: false; failure: CustomRuleAiTransitionFailure };

async function finalizeDraftTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: ClarifyingCustomRuleDraftInput;
  expectedRevisionNumber: number;
  providerName?: AiProviderName;
}): Promise<AtomicDraftFinalization> {
  const completion = atomicTurnCompletion(
    input.dependencies,
    input.opened,
    input.draft,
    input.providerName,
  );
  try {
    const draft = await input.dependencies.repository.finalizeDraftTurn({
      draft: input.draft,
      completion,
    });
    verifyAtomicDraft(draft, input.scope, input.draft, {
      initialStatus: "clarifying",
      currentStatus: "clarifying",
      revisionNumber: input.expectedRevisionNumber,
    });
    return { ok: true, draft };
  } catch (error) {
    return reconcileAtomicDraftFailure({
      ...input,
      completion,
      terminalStatus: "completed",
      cause: error,
    });
  }
}

async function finalizeSimulationTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: ContractReadyCustomRuleDraftInput;
  summary: CustomRuleSimulationResult;
  expectedRevisionNumber: number;
  providerName?: AiProviderName;
}): Promise<AtomicSimulationFinalization> {
  const completion = atomicTurnCompletion(
    input.dependencies,
    input.opened,
    input.draft,
    input.providerName,
  );
  const simulation = atomicSimulationSummary(input.draft, input.summary);
  try {
    const value = await input.dependencies.repository.finalizeSimulationTurn({
      draft: input.draft,
      completion,
      simulation,
    });
    verifyAtomicDraft(value.draft, input.scope, input.draft, {
      initialStatus: "contract_ready",
      currentStatus: "simulated",
      revisionNumber: input.expectedRevisionNumber,
    });
    verifySimulation(value.simulation, input.scope, value.draft, input.summary);
    return { ok: true, value };
  } catch (error) {
    return reconcileAtomicSimulationFailure({
      ...input,
      completion,
      simulation,
      cause: error,
    });
  }
}

async function finalizeFailedTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: FailedCustomRuleDraftInput;
  expectedRevisionNumber: number;
  providerName?: AiProviderName;
  failureSemantics: SettlementAiFailedTurnFailureSemantics;
}): Promise<AtomicDraftFinalization> {
  const completion = atomicTurnCompletion(
    input.dependencies,
    input.opened,
    input.draft,
    input.providerName,
  );
  try {
    const draft = await input.dependencies.repository.finalizeFailedTurn({
      draft: input.draft,
      completion,
      ...input.failureSemantics,
    });
    verifyAtomicDraft(draft, input.scope, input.draft, {
      initialStatus: "failed",
      currentStatus: "failed",
      revisionNumber: input.expectedRevisionNumber,
    });
    return { ok: true, draft };
  } catch (error) {
    return reconcileAtomicDraftFailure({
      ...input,
      completion,
      terminalStatus: "failed",
      failureSemantics: input.failureSemantics,
      cause: error,
    });
  }
}

function failedTurnSemantics(
  errorCode: SettlementAiFailedTurnErrorCode,
  retryable: boolean,
): SettlementAiFailedTurnFailureSemantics {
  return {
    errorCode,
    errorSummary: SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES[errorCode],
    retryable,
  };
}

function atomicTurnCompletion(
  dependencies: ServiceDependencies,
  opened: OpenedAiTurn,
  draft: CreateCustomRuleDraftInput,
  providerName?: AiProviderName,
): SettlementAiTurnCompletionInput {
  return {
    providerName: providerName ?? dependencies.primaryProvider,
    content: draft.aiResponse.content,
    aiInvocationId: null,
    metadata: {
      contextSnapshotVersion: opened.snapshot.version,
      contextSummaryVersion: opened.snapshot.summaryVersion,
      contextMessageIds: [...opened.snapshot.messageIds],
      settlementIdempotencyKey: draft.idempotencyKey,
      settlementInitialStatus: draft.status,
    },
  };
}

function atomicSimulationSummary(
  draft: ContractReadyCustomRuleDraftInput,
  summary: CustomRuleSimulationResult,
): FinalizeSettlementAiSimulationTurnInput["simulation"] {
  return {
    idempotencyKey: simulationIdempotencyKey(draft.idempotencyKey, summary),
    dataSelectionHash: summary.persistable.dataSelectionHash,
    sampleSource: summary.persistable.sampleSource,
    sampleSelection: summary.persistable.sampleSelection,
    coverage: summary.persistable.coverage,
    scenarios: summary.persistable.scenarios,
    historicalTotals: summary.persistable.historicalTotals,
    deltas: summary.persistable.deltas,
    largestChanges: summary.persistable.largestChanges,
    warnings: summary.persistable.warnings,
  };
}

async function reconcileAtomicDraftFailure(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: ClarifyingCustomRuleDraftInput | FailedCustomRuleDraftInput;
  expectedRevisionNumber: number;
  completion: SettlementAiTurnCompletionInput;
  terminalStatus: "completed" | "failed";
  failureSemantics?: SettlementAiFailedTurnFailureSemantics;
  cause: unknown;
}): Promise<AtomicDraftFinalization> {
  const readback = await readAtomicState(input);
  const persisted = readback.drafts.find(
    (draft) => draft.idempotencyKey === input.draft.idempotencyKey,
  );
  if (persisted) {
    try {
      verifyAtomicDraft(persisted, input.scope, input.draft, {
        initialStatus: input.draft.status,
        currentStatus: input.draft.status,
        revisionNumber: input.expectedRevisionNumber,
      });
      requireMatchingTerminalTurn(
        readback.history,
        input.opened,
        input.completion,
        input.terminalStatus,
        input.failureSemantics,
      );
      return {
        ok: true,
        draft: { ...persisted, duplicate: true },
      };
    } catch (error) {
      throw atomicReconciliationError(input.opened, error);
    }
  }
  if (hasTurnBoundDraft(readback.drafts, input.opened.turnTrace.turnId)) {
    throw atomicReconciliationError(input.opened, input.cause);
  }
  if (isActiveAtomicTurn(readback.history, input.opened)) {
    return {
      ok: false,
      failure: await failUncommittedAtomicTurn(input),
    };
  }
  throw atomicReconciliationError(input.opened, input.cause);
}

async function reconcileAtomicSimulationFailure(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: ContractReadyCustomRuleDraftInput;
  summary: CustomRuleSimulationResult;
  expectedRevisionNumber: number;
  completion: SettlementAiTurnCompletionInput;
  simulation: FinalizeSettlementAiSimulationTurnInput["simulation"];
  cause: unknown;
}): Promise<AtomicSimulationFinalization> {
  const readback = await readAtomicState(input);
  const persisted = readback.drafts.find(
    (draft) => draft.idempotencyKey === input.draft.idempotencyKey,
  );
  if (!persisted) {
    if (hasTurnBoundDraft(readback.drafts, input.opened.turnTrace.turnId)) {
      throw atomicReconciliationError(input.opened, input.cause);
    }
    if (isActiveAtomicTurn(readback.history, input.opened)) {
      return {
        ok: false,
        failure: await failUncommittedAtomicTurn(input),
      };
    }
    throw atomicReconciliationError(input.opened, input.cause);
  }
  try {
    verifyAtomicDraft(persisted, input.scope, input.draft, {
      initialStatus: "contract_ready",
      currentStatus: "simulated",
      revisionNumber: input.expectedRevisionNumber,
    });
    const simulation = await readStableAtomicSimulation(
      input.dependencies.repository,
      input.scope,
      persisted,
      input.simulation.idempotencyKey,
    );
    if (
      !simulation ||
      simulation.summarySchemaVersion !== 2 ||
      !simulation.summaryComplete
    ) {
      throw new Error("atomic simulation readback is incomplete or legacy");
    }
    const duplicateSimulation = { ...simulation, duplicate: true };
    verifySimulation(
      duplicateSimulation,
      input.scope,
      persisted,
      input.summary,
    );
    requireMatchingTerminalTurn(
      readback.history,
      input.opened,
      input.completion,
      "completed",
    );
    return {
      ok: true,
      value: {
        draft: { ...persisted, duplicate: true },
        simulation: duplicateSimulation,
      },
    };
  } catch (error) {
    throw atomicReconciliationError(input.opened, error);
  }
}

async function readStableAtomicSimulation(
  repository: CustomRuleAuthoringRepositoryPort,
  scope: ScopedTransition,
  draft: CustomRuleDraft,
  idempotencyKey: string,
): Promise<SettlementFormulaSimulation | null> {
  let previousFingerprint: string | null = null;
  let latest: SettlementFormulaSimulation | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const simulations = await repository.listSimulations({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      owner: { kind: "ai_draft", id: draft.id },
      limit: 100,
    });
    latest =
      simulations.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      ) ?? null;
    const fingerprint = canonicalJson(latest);
    if (fingerprint === previousFingerprint) return latest;
    previousFingerprint = fingerprint;
  }
  return latest;
}

async function readAtomicState(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: { idempotencyKey: string };
}): Promise<{
  drafts: CustomRuleDraft[];
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>;
}> {
  let previousFingerprint: string | null = null;
  let latest: {
    drafts: CustomRuleDraft[];
    history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>;
  } | null = null;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [drafts, history] = await Promise.all([
        listScopedDrafts(input.dependencies.repository, input.scope),
        input.dependencies.conversation.getHistory(
          input.scope.actor,
          input.scope.conversationId,
        ),
      ]);
      if (
        history.conversation.id !== input.scope.conversationId ||
        history.conversation.status !== "active"
      ) {
        throw new Error("atomic conversation readback scope mismatch");
      }
      latest = { drafts, history };
      const fingerprint = atomicReadbackFingerprint(input, latest);
      if (fingerprint === previousFingerprint) return latest;
      previousFingerprint = fingerprint;
    }
    if (latest) return latest;
    throw new Error("atomic readback returned no snapshots");
  } catch (error) {
    throw atomicReconciliationError(input.opened, error);
  }
}

function atomicReadbackFingerprint(
  input: {
    opened: OpenedAiTurn;
    draft: { idempotencyKey: string };
  },
  state: {
    drafts: CustomRuleDraft[];
    history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>;
  },
): string {
  const turn = state.history.turns.find(
    (candidate) => candidate.id === input.opened.turnTrace.turnId,
  );
  const assistant = state.history.messages.find(
    (message) => message.id === input.opened.turnTrace.assistantMessageId,
  );
  const drafts = state.drafts.filter(
    (draft) =>
      draft.idempotencyKey === input.draft.idempotencyKey ||
      draft.turnTrace.turnId === input.opened.turnTrace.turnId,
  );
  return canonicalJson({
    assistant: assistant ?? null,
    drafts,
    turn: turn ?? null,
  });
}

function requireMatchingTerminalTurn(
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>,
  opened: OpenedAiTurn,
  completion: SettlementAiTurnCompletionInput,
  expectedStatus: "completed" | "failed",
  failureSemantics?: SettlementAiFailedTurnFailureSemantics,
): void {
  const turn = history.turns.find(
    (candidate) => candidate.id === opened.turnTrace.turnId,
  );
  const assistant = history.messages.find(
    (message) => message.id === opened.turnTrace.assistantMessageId,
  );
  if (
    !turn ||
    turn.conversationId !== history.conversation.id ||
    turn.userMessageId !== opened.turnTrace.userMessageId ||
    turn.assistantMessageId !== opened.turnTrace.assistantMessageId ||
    turn.status !== expectedStatus ||
    (expectedStatus === "failed" &&
      (!failureSemantics ||
        turn.errorCode !== failureSemantics.errorCode ||
        turn.retryable !== failureSemantics.retryable)) ||
    !assistant ||
    assistant.conversationId !== history.conversation.id ||
    assistant.status !== expectedStatus ||
    assistant.content !== completion.content ||
    canonicalJson(assistant.metadata ?? {}) !==
      canonicalJson(completion.metadata)
  ) {
    throw new Error("atomic generic turn readback mismatch");
  }
}

function isActiveAtomicTurn(
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>,
  opened: OpenedAiTurn,
): boolean {
  const turn = history.turns.find(
    (candidate) => candidate.id === opened.turnTrace.turnId,
  );
  return Boolean(
    turn &&
    turn.conversationId === history.conversation.id &&
    turn.userMessageId === opened.turnTrace.userMessageId &&
    turn.assistantMessageId === opened.turnTrace.assistantMessageId &&
    (turn.status === "accepted" ||
      turn.status === "grounding" ||
      turn.status === "generating" ||
      turn.status === "validating"),
  );
}

function hasTurnBoundDraft(drafts: CustomRuleDraft[], turnId: string): boolean {
  return drafts.some((draft) => draft.turnTrace.turnId === turnId);
}

async function failUncommittedAtomicTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
}): Promise<CustomRuleAiTransitionFailure> {
  try {
    await failConversationTurn(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      "settlement_atomic_finalize_failed",
      true,
      "Atomic settlement finalization did not commit.",
    );
  } catch (error) {
    throw serviceError(
      "conversation_reconciliation_failed",
      "Atomic settlement failure could not reconcile the generic turn.",
      false,
      error,
      input.opened.turnTrace.turnId,
    );
  }
  return recoverableTurnFailure(
    "persistence_failed",
    input.scope,
    input.opened,
    null,
  );
}

function atomicReconciliationError(
  opened: OpenedAiTurn,
  cause: unknown,
): CustomRuleAuthoringServiceError {
  return serviceError(
    "conversation_reconciliation_failed",
    "Atomic settlement finalization could not be reconciled.",
    false,
    cause,
    opened.turnTrace.turnId,
    "owned_unsettled",
  );
}

function verifyAtomicDraft(
  draft: CustomRuleDraft,
  scope: ScopedTransition,
  input: CreateCustomRuleDraftInput,
  expected: {
    initialStatus: CustomRuleDraft["initialStatus"];
    currentStatus: "clarifying" | "failed" | "simulated";
    revisionNumber: number;
  },
): void {
  verifyCreatedDraft({ ...draft, duplicate: false }, scope, {
    initialStatus: expected.initialStatus,
    revisionNumber: expected.revisionNumber,
    idempotencyKey: input.idempotencyKey,
  });
  if (
    draft.status !== expected.currentStatus ||
    canonicalJson(draftInputEnvelope(draft)) !==
      canonicalJson(draftInputEnvelope(input))
  ) {
    throw serviceError(
      "persistence_failed",
      "repository returned a mismatched atomic draft",
      false,
    );
  }
}

function draftInputEnvelope(
  draft: CreateCustomRuleDraftInput | CustomRuleDraft,
): Record<string, unknown> {
  const status = "initialStatus" in draft ? draft.initialStatus : draft.status;
  return {
    organizationId: draft.organizationId,
    projectId: draft.projectId,
    conversationId: draft.conversationId,
    idempotencyKey: draft.idempotencyKey,
    promptText: draft.promptText,
    turnTrace: draft.turnTrace,
    businessContract: draft.businessContract,
    unresolvedAmbiguities: draft.unresolvedAmbiguities,
    variableCatalogVersion: draft.variableCatalogVersion,
    aiResponse: draft.aiResponse,
    generatedFormula: draft.generatedFormula,
    generatedExplanation: draft.generatedExplanation,
    generatedTestCases: draft.generatedTestCases,
    model: draft.model,
    safetyFlags: draft.safetyFlags,
    contractHash: draft.contractHash,
    formulaHash: draft.formulaHash,
    parameterHash: draft.parameterHash,
    status,
  };
}

async function getSimulatedDraft(
  dependencies: ServiceDependencies,
  scope: ScopedTransition,
  draftId: string,
): Promise<CustomRuleDraft> {
  let draft: CustomRuleDraft | null;
  try {
    draft = await dependencies.repository.getDraft({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      conversationId: scope.conversationId,
      draftId,
    });
  } catch (error) {
    throw serviceError(
      "persistence_failed",
      "simulated draft readback failed",
      true,
      error,
    );
  }
  if (!draft || draft.status !== "simulated") {
    throw serviceError(
      "persistence_failed",
      "simulation did not durably transition the draft",
      true,
    );
  }
  return draft;
}

async function readExistingSimulation(
  dependencies: ServiceDependencies,
  scope: ScopedTransition,
  draft: CustomRuleDraft,
  summary: CustomRuleSimulationResult,
): Promise<InsertedSettlementFormulaSimulation> {
  let simulations: SettlementFormulaSimulation[];
  try {
    simulations = await dependencies.repository.listSimulations({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      owner: { kind: "ai_draft", id: draft.id },
      limit: 100,
    });
  } catch (error) {
    throw serviceError(
      "persistence_failed",
      "durable simulation readback failed",
      true,
      error,
    );
  }
  const idempotencyKey = simulationIdempotencyKey(
    draft.idempotencyKey,
    summary,
  );
  const simulation = simulations.find(
    (candidate) => candidate.idempotencyKey === idempotencyKey,
  );
  if (
    !simulation ||
    simulation.summarySchemaVersion !== 2 ||
    !simulation.summaryComplete
  ) {
    throw serviceError(
      "persistence_failed",
      "simulated draft has no matching complete v2 simulation",
      true,
    );
  }
  const readback = { ...simulation, duplicate: true };
  verifySimulation(readback, scope, draft, summary);
  return readback;
}

async function failConversationTurn(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  errorCode: string,
  retryable: boolean,
  errorSummary: string,
  providerName?: AiProviderName,
): Promise<void> {
  try {
    await conversation.failTurn(scope.actor, opened.turnTrace.turnId, {
      providerName,
      errorCode,
      errorSummary,
      retryable,
    });
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation failure could not be persisted",
      true,
      error,
    );
  }
}

async function failAndThrow(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  code: CustomRuleAuthoringServiceErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
): Promise<never> {
  await failConversationTurn(
    conversation,
    scope,
    opened,
    code,
    retryable,
    message,
  );
  throw serviceError(
    code,
    message,
    retryable,
    cause,
    opened.turnTrace.turnId,
    "owned_settled",
  );
}

async function runOwnedOpenedTransition<Result>(
  dependencies: ServiceDependencies,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  transition: () => Promise<Result>,
): Promise<Result> {
  try {
    return await transition();
  } catch (error) {
    if (
      error instanceof CustomRuleAuthoringServiceError &&
      error.turnDisposition === "owned_settled"
    ) {
      throw error;
    }
    const retryable =
      error instanceof CustomRuleAuthoringServiceError ? error.retryable : true;
    try {
      await failConversationTurn(
        dependencies.conversation,
        scope,
        opened,
        "settlement_post_open_validation_failed",
        retryable,
        "Settlement authoring validation failed before finalization.",
      );
    } catch (compensationError) {
      throw serviceError(
        "conversation_reconciliation_failed",
        "Post-open settlement failure could not reconcile the generic turn.",
        false,
        compensationError,
        opened.turnTrace.turnId,
      );
    }
    if (error instanceof CustomRuleAuthoringServiceError) {
      throw serviceError(
        error.code,
        error.message,
        error.retryable,
        error,
        opened.turnTrace.turnId,
        "owned_settled",
      );
    }
    throw serviceError(
      "conversation_failed",
      "Settlement authoring failed before atomic finalization.",
      true,
      error,
      opened.turnTrace.turnId,
      "owned_settled",
    );
  }
}

async function markValidating(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
): Promise<void> {
  try {
    await conversation.markValidating(scope.actor, opened.turnTrace.turnId);
  } catch (error) {
    try {
      await failConversationTurn(
        conversation,
        scope,
        opened,
        "settlement_turn_setup_failed",
        true,
        "Settlement authoring turn setup failed.",
      );
    } catch (reconciliationError) {
      throw serviceError(
        "conversation_reconciliation_failed",
        "Generic turn validation setup could not be reconciled.",
        false,
        reconciliationError,
        opened.turnTrace.turnId,
      );
    }
    throw serviceError(
      "conversation_failed",
      "generic conversation could not enter validation",
      true,
      error,
      opened.turnTrace.turnId,
      "owned_settled",
    );
  }
}

async function requireConversationHistory(
  conversation: SettlementConversationPort,
  actor: { organizationId: string; userId: string },
  conversationId: string,
): Promise<SettlementConversationHistory> {
  try {
    const history = await conversation.getHistory(actor, conversationId);
    if (
      history.conversation.id !== conversationId ||
      history.conversation.status !== "active"
    ) {
      throw new Error("conversation scope mismatch");
    }
    return history;
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation history is unavailable",
      true,
      error,
    );
  }
}

async function listScopedDrafts(
  repository: CustomRuleAuthoringRepositoryPort,
  scope: Pick<ScopedTransition, "actor" | "projectId" | "conversationId">,
): Promise<CustomRuleDraft[]> {
  let drafts: CustomRuleDraft[];
  try {
    drafts = await repository.listDrafts({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      conversationId: scope.conversationId,
      revisionOrder: "desc",
      limit: 100,
    });
  } catch (error) {
    throw serviceError(
      "persistence_failed",
      "settlement draft history is unavailable",
      true,
      error,
    );
  }
  if (
    drafts.some(
      (draft) =>
        draft.organizationId !== scope.actor.organizationId ||
        draft.projectId !== scope.projectId ||
        draft.conversationId !== scope.conversationId,
    )
  ) {
    throw serviceError(
      "persistence_failed",
      "repository returned a cross-scope draft",
      false,
    );
  }
  return [...drafts].sort(
    (left, right) => right.revisionNumber - left.revisionNumber,
  );
}

async function loadCatalog(
  catalogPort: SettlementVariableCatalogPort,
  scope: Pick<ScopedTransition, "actor" | "projectId">,
  contract: BusinessRuleContract,
): Promise<CustomRuleVariableCatalog> {
  try {
    const catalog = await catalogPort.getCatalog({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      scope: contract.scope,
      executionGrain: contract.executionGrain,
    });
    if (
      catalog.scope !== contract.scope ||
      catalog.executionGrain !== contract.executionGrain
    ) {
      throw new Error("catalog scope mismatch");
    }
    return catalog;
  } catch (error) {
    throw serviceError(
      "catalog_failed",
      "project variable catalog is unavailable",
      true,
      error,
    );
  }
}

async function loadAuthorizedSimulationEvidence(
  port: AuthorizedSimulationEvidencePort,
  scope: Pick<ScopedTransition, "actor" | "projectId">,
  selection: AuthorizedSimulationSelectionRequest,
  inputs: readonly CustomRuleInputRequirement[],
): Promise<AuthorizedCustomRuleSimulationEvidence> {
  const unsafeEvidence = await port.loadAuthorizedEvidence({
    actor: scope.actor,
    organizationId: scope.actor.organizationId,
    projectId: scope.projectId,
    selection,
    inputs,
  });
  const evidence = freezeAuthorizedCustomRuleSimulationEvidence(unsafeEvidence);
  if (
    evidence.provenance.organizationId !== scope.actor.organizationId ||
    evidence.provenance.projectId !== scope.projectId ||
    evidence.provenance.actorId !== scope.actor.userId ||
    evidence.provenance.selectionToken !== selection.selectionToken ||
    evidence.sampleSelection.periodStart !== selection.periodStart ||
    evidence.sampleSelection.periodEnd !== selection.periodEnd ||
    canonicalJson([...evidence.sampleSelection.criteria].sort()) !==
      canonicalJson([...selection.criteriaCodes].sort())
  ) {
    throw new Error("authorized evidence scope or selection mismatch");
  }
  if (
    evidence.provenance.optionalPolicyHash !==
    calculateCustomRuleOptionalPolicyHash(inputs)
  ) {
    throw new Error("authorized evidence optional-policy hash mismatch");
  }
  if (
    calculateCustomRuleEvidenceHash(evidence) !==
    evidence.provenance.evidenceHash
  ) {
    throw new Error("authorized evidence provenance hash mismatch");
  }
  return evidence;
}

function resolvedClarifyingAmbiguities(
  input: Extract<SettlementAiResult, { ok: true }>,
): [SettlementAiUnresolvedAmbiguity, ...SettlementAiUnresolvedAmbiguity[]] {
  if (input.unresolvedAmbiguities.length > 0) {
    const [first, ...rest] = input.unresolvedAmbiguities;
    return [first, ...rest];
  }
  if (!input.nextQuestion) {
    throw serviceError(
      "invalid_transition",
      "unconfirmed contract must retain a confirmation question",
      false,
    );
  }
  return [
    {
      code: CONFIRM_CONTRACT_AMBIGUITY,
      question: input.nextQuestion,
      required: true,
    },
  ];
}

function readinessRequirements(
  contract: BusinessRuleContract,
  formulaVariables: string[],
): CustomRuleInputRequirement[] {
  return buildCustomRuleInputRequirements({
    requiredVariableIds: contract.requiredInputs.map(
      (required) => required.name,
    ),
    formulaVariableIds: formulaVariables,
    missingDataPolicy: contract.missingDataPolicy,
  });
}

function parameterValues(
  contract: BusinessRuleContract,
): Record<string, TypedRuntimeValue> {
  return Object.fromEntries(
    [...contract.parameters]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((parameter) => [parameter.name, parameter.defaultValue]),
  );
}

function nonEmptyTestCases(
  testCases: SettlementAiGeneratedTestCase[],
): [SettlementAiGeneratedTestCase, ...SettlementAiGeneratedTestCase[]] {
  const [first, ...rest] = testCases;
  if (!first) {
    throw serviceError(
      "formula_validation_failed",
      "confirmed formula requires at least one test case",
      false,
    );
  }
  return [first, ...rest];
}

function mapSafetyFlags(flags: string[]): SettlementAiSafetyFlag[] {
  return [...new Set(flags)]
    .sort((left, right) => left.localeCompare(right))
    .map((message) => ({
      code: `ai_${sha256(message).slice(0, 24)}`,
      severity: "warning" as const,
      message,
    }));
}

function requireLatestDraft(drafts: CustomRuleDraft[]): CustomRuleDraft {
  const latest = drafts[0];
  if (!latest) {
    throw serviceError("draft_not_found", "settlement draft not found", false);
  }
  return latest;
}

function requireExpectedRevision(
  latest: CustomRuleDraft,
  input: Pick<
    ReviseCustomRuleSessionInput,
    "expectedDraftId" | "expectedRevisionNumber"
  >,
): void {
  if (
    latest.id !== input.expectedDraftId ||
    latest.revisionNumber !== input.expectedRevisionNumber
  ) {
    throw serviceError(
      "stale_revision",
      "settlement draft revision is stale",
      false,
    );
  }
}

function verifyCreatedDraft(
  created: CreatedCustomRuleDraft,
  scope: ScopedTransition,
  expected: {
    initialStatus: "clarifying" | "contract_ready" | "failed";
    revisionNumber: number;
    idempotencyKey: string;
  },
): void {
  if (
    created.organizationId !== scope.actor.organizationId ||
    created.projectId !== scope.projectId ||
    created.conversationId !== scope.conversationId ||
    created.initialStatus !== expected.initialStatus ||
    created.revisionNumber !== expected.revisionNumber ||
    created.idempotencyKey !== expected.idempotencyKey
  ) {
    throw serviceError(
      "persistence_failed",
      "repository returned a mismatched draft revision",
      false,
    );
  }
}

function verifySimulation(
  simulation: InsertedSettlementFormulaSimulation,
  scope: ScopedTransition,
  draft: CustomRuleDraft,
  summary: CustomRuleSimulationResult,
): void {
  if (
    simulation.organizationId !== scope.actor.organizationId ||
    simulation.projectId !== scope.projectId ||
    simulation.owner.kind !== "ai_draft" ||
    simulation.owner.id !== draft.id ||
    simulation.formulaHash !== summary.persistable.formulaHash ||
    simulation.ruleContractHash !== summary.persistable.ruleContractHash ||
    simulation.parameterHash !== summary.persistable.parameterHash ||
    simulation.variableCatalogVersion !==
      summary.persistable.variableCatalogVersion ||
    simulation.dataSelectionHash !== summary.dataSelectionHash
  ) {
    throw serviceError(
      "persistence_failed",
      "repository returned a mismatched immutable simulation",
      false,
    );
  }
}

function replayClarifying(
  draft: CustomRuleDraft,
  drafts: CustomRuleDraft[],
): CustomRuleClarifyingSuccess {
  const previous = drafts.find(
    (candidate) => candidate.revisionNumber === draft.revisionNumber - 1,
  );
  return Object.freeze({
    ok: true,
    kind: "clarifying",
    conversationId: draft.conversationId,
    draft,
    diff: previous
      ? diffBusinessRuleContracts(
          previous.businessContract,
          draft.businessContract,
        )
      : [],
    duplicate: true,
  });
}

function replayFailure(draft: CustomRuleDraft): CustomRuleAiTransitionFailure {
  return Object.freeze({
    ok: false,
    code: "SETTLEMENT_AI_PROVIDER_FAILED",
    retryable: true,
    conversationId: draft.conversationId,
    sourceTurnId: draft.turnTrace.turnId,
    turnTrace: draft.turnTrace,
    failedDraft: draft,
  });
}

function recoverableTurnFailure(
  code: "persistence_failed" | "conversation_failed",
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  draft: CustomRuleDraft | null,
): CustomRuleAiTransitionFailure {
  return Object.freeze({
    ok: false,
    code,
    retryable: true,
    conversationId: scope.conversationId,
    sourceTurnId: opened.turnTrace.turnId,
    turnTrace: opened.turnTrace,
    failedDraft: draft,
  });
}

function draftIdempotencyKey(
  operation: "start" | "revise" | "confirm",
  scope: ScopedTransition,
): string {
  return `settlement-${operation}:${sha256(
    canonicalJson({
      clientRequestId: scope.clientRequestId,
      conversationId: scope.conversationId,
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
    }),
  )}`;
}

function simulationIdempotencyKey(
  draftIdempotencyKey: string,
  summary: CustomRuleSimulationResult,
): string {
  return `settlement-simulation:${sha256(
    canonicalJson({
      dataSelectionHash: summary.dataSelectionHash,
      draftIdempotencyKey,
      formulaHash: summary.persistable.formulaHash,
    }),
  )}`;
}

function retryDraftIdempotencyKey(
  originalIdempotencyKey: string,
  sourceTurnId: string,
  clientRequestId: string,
): string {
  return `settlement-retry:${sha256(
    canonicalJson({ clientRequestId, originalIdempotencyKey, sourceTurnId }),
  )}`;
}

function startRecoveryTurnIdempotencyKey(
  scope: ScopedTransition,
  sourceTurnId: string,
): string {
  return `settlement-start-recovery:${sha256(
    canonicalJson({
      clientRequestId: scope.clientRequestId,
      conversationId: scope.conversationId,
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      sourceTurnId,
    }),
  )}`;
}

function validateDependencies(input: ServiceDependencies): void {
  if (
    !input ||
    typeof input.conversation?.getHistory !== "function" ||
    typeof input.conversation?.retryTurn !== "function" ||
    typeof input.ai?.prepare !== "function" ||
    typeof input.ai?.restore !== "function" ||
    typeof input.repository?.finalizeDraftTurn !== "function" ||
    typeof input.repository?.finalizeSimulationTurn !== "function" ||
    typeof input.repository?.finalizeFailedTurn !== "function" ||
    typeof input.repository?.listDrafts !== "function" ||
    typeof input.repository?.getDraft !== "function" ||
    typeof input.repository?.listSimulations !== "function" ||
    typeof input.catalog?.getCatalog !== "function" ||
    typeof input.evidence?.loadAuthorizedEvidence !== "function" ||
    typeof input.analyzeReadiness !== "function" ||
    typeof input.simulate !== "function"
  ) {
    throw serviceError(
      "invalid_input",
      "custom rule authoring dependencies are invalid",
      false,
    );
  }
}

function validateStartInput(
  input: StartCustomRuleSessionInput,
): StartCustomRuleSessionInput {
  validateScopeInput(input);
  if (
    !canonicalText(input.conversationId, 500) ||
    !input.seedContract ||
    input.initialAmbiguities.length === 0
  ) {
    throw serviceError(
      "invalid_input",
      "start session requires a seed contract and initial ambiguity",
      false,
    );
  }
  return input;
}

function validateRevisionInput(
  input: ReviseCustomRuleSessionInput,
): ReviseCustomRuleSessionInput {
  validateScopeInput(input);
  if (
    !canonicalText(input.conversationId, 500) ||
    !canonicalText(input.expectedDraftId, 500) ||
    !Number.isSafeInteger(input.expectedRevisionNumber) ||
    input.expectedRevisionNumber < 1
  ) {
    throw serviceError("invalid_input", "revision input is invalid", false);
  }
  return input;
}

function validateConfirmationInput(
  input: ConfirmCustomRuleContractInput,
): ConfirmCustomRuleContractInput {
  validateRevisionInput(input);
  if (
    typeof input.contractConfirmed !== "boolean" ||
    !HASH_PATTERN.test(input.expectedContractHash) ||
    !HASH_PATTERN.test(input.expectedCatalogVersion) ||
    (input.expectedFormulaHash !== undefined &&
      !HASH_PATTERN.test(input.expectedFormulaHash)) ||
    (input.expectedEvidenceHash !== undefined &&
      !HASH_PATTERN.test(input.expectedEvidenceHash)) ||
    (input.expectedDataSelectionHash !== undefined &&
      !HASH_PATTERN.test(input.expectedDataSelectionHash)) ||
    !simulationSelectionSchema.safeParse(input.simulationSelection).success
  ) {
    throw serviceError("invalid_input", "confirmation input is invalid", false);
  }
  return input;
}

function validateRetryInput(
  input: RetryCustomRuleTurnInput,
): RetryCustomRuleTurnInput {
  validateScopeInput({
    actor: input.actor,
    projectId: input.projectId,
    clientRequestId: input.clientRequestId,
    promptText: "technical retry",
  });
  if (
    !canonicalText(input.conversationId, 500) ||
    !canonicalText(input.sourceTurnId, 500)
  ) {
    throw serviceError("invalid_input", "retry input is invalid", false);
  }
  return input;
}

function validateScopeInput(input: {
  actor: { organizationId: string; userId: string };
  projectId: string;
  clientRequestId: string;
  promptText: string;
}): void {
  if (
    !canonicalText(input.actor?.organizationId, 500) ||
    !canonicalText(input.actor?.userId, 500) ||
    !canonicalText(input.projectId, 500) ||
    !canonicalText(input.promptText, 4_000) ||
    !canonicalText(input.clientRequestId, 128) ||
    input.clientRequestId.length < 8 ||
    !CLIENT_REQUEST_ID_PATTERN.test(input.clientRequestId)
  ) {
    throw serviceError(
      "invalid_input",
      "authoring scope input is invalid",
      false,
    );
  }
}

function canonicalText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    value.trim().length > 0
  );
}

function serviceError(
  code: CustomRuleAuthoringServiceErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown,
  sourceTurnId?: string,
  turnDisposition?: TurnErrorDisposition,
): CustomRuleAuthoringServiceError {
  return new CustomRuleAuthoringServiceError(code, message, retryable, {
    cause,
    sourceTurnId,
    turnDisposition,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
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

export type CustomRuleLifecycleAuditWriter = (
  input: AuditLogInput,
) => Promise<void>;

export type CustomRuleLifecycleGovernanceContext = {
  actor: { organizationId: string; userId: string; role: AppRole };
  version?: CustomSettlementRuleVersion;
  simulation?: CustomRuleSimulationFreshnessHashes & {
    id: string;
    createdAt: string;
  };
  expectedFreshness?: CustomRuleSimulationFreshnessHashes;
  eligibleApprovers?: readonly {
    userId: string;
    role: "owner" | "ops_manager";
  }[];
  creatorUserId?: string;
  simulationFacts?: CustomRuleMaterialRiskInput["simulation"];
  currentMarginCents?: string | null;
  contractFacts?: CustomRuleMaterialRiskInput["contract"];
  riskConfiguration?: CustomRuleMaterialRiskConfiguration;
  reopenedAt?: string | null;
  archiveSafety?: {
    proofKind: "remaining_custom_layers" | "fixed_fallback";
    fallbackSimulation: CustomRuleSimulationFreshnessHashes & {
      id: string;
      createdAt: string;
    };
    remainingCustomLayerCount: number;
    fixedFallbackAvailable: boolean;
    lockedBatchCount: number;
  };
  groupGovernance?: {
    assignedProjectStreamerIds: readonly string[];
    unassignedProjectStreamerIds: readonly string[];
    currentGroupSnapshotHash: string;
    simulationPopulation: {
      assignedProjectStreamerIds: readonly string[];
      unassignedProjectStreamerIds: readonly string[];
      groupSnapshotHash: string;
    };
    activePendingRules: readonly SettlementGroupScopedRule[];
  };
};

export type CustomRuleLifecycleRepositoryPort = Pick<
  CustomRuleRepository,
  | "saveCustomRuleDraft"
  | "applyAndSubmitCustomRule"
  | "requestCustomRuleChanges"
  | "reopenRequestedChangesAsDraft"
  | "resubmitCustomRule"
  | "approveCustomRule"
  | "forceApproveCustomRule"
  | "archiveCustomRule"
  | "listCustomRules"
> & {
  getCustomRuleGovernanceContext(input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
    ruleVersionId?: string;
    source?: ApplyAndSubmitCustomRuleInput["source"];
    sourceSimulationId?: string;
  }): Promise<CustomRuleLifecycleGovernanceContext>;
  recordCustomRuleActivationFailure(
    input: CustomRuleReviewTransitionInput & {
      errorMessage: string;
    },
  ): Promise<CustomRuleLifecycleResult>;
};

export type CustomRuleExecutionCapability = Readonly<{ enabled: boolean }>;

type LifecycleActorInput = Readonly<{
  organizationId: string;
  userId: string;
  role?: AppRole;
}>;

type LifecycleServiceInput<
  Input,
  ServerOwned extends keyof Input = never,
> = Omit<Input, "organizationId" | "projectId" | ServerOwned> & {
  actor: LifecycleActorInput;
  projectId: string;
};

type UntrustedApprovalHints = Readonly<{
  isMaterialRisk?: boolean;
  approverCount?: number;
  creatorId?: string;
  hashes?: Readonly<Record<string, unknown>>;
  totals?: Readonly<Record<string, unknown>>;
}>;

type ApproveLifecycleServiceInput = LifecycleServiceInput<
  ApproveCustomRuleRepositoryInput,
  "riskSummary"
> &
  UntrustedApprovalHints;

type ForceApproveLifecycleServiceInput = LifecycleServiceInput<
  ForceApproveCustomRuleRepositoryInput,
  "riskSummary"
> &
  UntrustedApprovalHints;

type ArchiveLifecycleServiceInput = LifecycleServiceInput<
  ArchiveCustomRuleRepositoryInput,
  "fallbackProof"
> &
  Readonly<{
    remainingCustomLayerCount?: number;
    fixedFallbackAvailable?: boolean;
    lockedBatchCount?: number;
  }>;

export type CustomRuleLifecycleListDto = CustomSettlementRuleVersion & {
  effectiveNow: boolean;
  scheduled: boolean;
};

export type CustomRuleLifecycleService = {
  saveCustomRuleDraft(
    input: LifecycleServiceInput<SaveCustomRuleDraftInput>,
  ): Promise<SavedCustomRuleDraftResult>;
  applyAndSubmitCustomRule(
    input: LifecycleServiceInput<ApplyAndSubmitCustomRuleInput>,
  ): Promise<CustomRuleLifecycleResult>;
  requestCustomRuleChanges(
    input: LifecycleServiceInput<RequestCustomRuleChangesInput>,
  ): Promise<CustomRuleLifecycleResult>;
  reopenRequestedChangesAsDraft(
    input: LifecycleServiceInput<CustomRuleReviewTransitionInput>,
  ): Promise<CustomRuleLifecycleResult>;
  resubmitCustomRule(
    input: LifecycleServiceInput<ApplyAndSubmitCustomRuleInput>,
  ): Promise<CustomRuleLifecycleResult>;
  approveCustomRule(
    input: ApproveLifecycleServiceInput,
  ): Promise<CustomRuleLifecycleResult>;
  forceApproveCustomRule(
    input: ForceApproveLifecycleServiceInput,
  ): Promise<CustomRuleLifecycleResult>;
  archiveCustomRule(
    input: ArchiveLifecycleServiceInput,
  ): Promise<CustomRuleLifecycleResult>;
  listCustomRules(input: {
    actor: LifecycleActorInput;
    projectId: string;
    status?: ListCustomRulesInput["status"];
  }): Promise<CustomRuleLifecycleListDto[]>;
};

export type SettlementGroupMembershipRepositoryPort = Pick<
  CustomRuleRepository,
  | "createSettlementRuleGroup"
  | "listSettlementRuleGroups"
  | "archiveSettlementRuleGroup"
  | "changeSettlementGroupAssignment"
> & {
  getCustomRuleGovernanceContext(input: {
    organizationId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<Pick<CustomRuleLifecycleGovernanceContext, "actor">>;
};

type GroupServiceInput<Input> = Omit<Input, "organizationId" | "projectId"> & {
  actor: LifecycleActorInput;
  projectId: string;
};

export type SettlementGroupMembershipGovernanceService = {
  createSettlementRuleGroup(
    input: GroupServiceInput<CreateSettlementRuleGroupInput>,
  ): Promise<SettlementRuleGroup>;
  listSettlementRuleGroups(input: {
    actor: LifecycleActorInput;
    projectId: string;
    includeArchived?: ListSettlementRuleGroupsInput["includeArchived"];
  }): Promise<SettlementRuleGroup[]>;
  archiveSettlementRuleGroup(
    input: GroupServiceInput<ArchiveSettlementRuleGroupInput>,
  ): Promise<SettlementRuleGroup>;
  changeSettlementGroupAssignment(
    input: GroupServiceInput<ChangeSettlementGroupAssignmentInput>,
  ): Promise<SettlementGroupAssignmentChangeResult>;
};

export function createSettlementGroupMembershipGovernanceService(dependencies: {
  repository: SettlementGroupMembershipRepositoryPort;
}): SettlementGroupMembershipGovernanceService {
  const repository = dependencies.repository;

  const loadActorContext = async (input: {
    actor: LifecycleActorInput;
    projectId: string;
  }) => {
    const context = await repository.getCustomRuleGovernanceContext({
      organizationId: input.actor.organizationId,
      projectId: input.projectId,
      actorUserId: input.actor.userId,
    });
    if (
      context.actor.organizationId !== input.actor.organizationId ||
      context.actor.userId !== input.actor.userId
    ) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned settlement group context does not match the request scope",
      );
    }
    return context;
  };

  const requireCapability = (
    role: AppRole,
    capability: Parameters<typeof canRolePerformCustomRuleGovernanceAction>[1],
  ): void => {
    if (!canRolePerformCustomRuleGovernanceAction(role, capability)) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_ACTION_NOT_ALLOWED",
        `Server role ${role} cannot perform ${capability}`,
      );
    }
  };

  return {
    async createSettlementRuleGroup(input) {
      const context = await loadActorContext(input);
      requireCapability(context.actor.role, "manage_groups");
      return repository.createSettlementRuleGroup({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        reason: input.reason,
        clientRequestId: input.clientRequestId,
      });
    },

    async listSettlementRuleGroups(input) {
      const context = await loadActorContext(input);
      requireCapability(context.actor.role, "view_internal");
      return repository.listSettlementRuleGroups({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        includeArchived: input.includeArchived,
      });
    },

    async archiveSettlementRuleGroup(input) {
      const context = await loadActorContext(input);
      requireCapability(context.actor.role, "manage_groups");
      const groups = await repository.listSettlementRuleGroups({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        includeArchived: false,
      });
      const group = groups.find((candidate) => candidate.id === input.groupId);
      if (
        group?.id === input.groupId &&
        (group.activeRuleCount > 0 ||
          group.pendingRuleCount > 0 ||
          group.futureAssignmentCount > 0)
      ) {
        throw new CustomRuleGovernanceError(
          "SETTLEMENT_GROUP_ARCHIVE_BLOCKED",
          "Settlement group archive requires no active or pending group rules and no future assignments",
        );
      }
      return repository.archiveSettlementRuleGroup({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        groupId: input.groupId,
        archivedAt: input.archivedAt,
        reason: input.reason,
        clientRequestId: input.clientRequestId,
      });
    },

    async changeSettlementGroupAssignment(input) {
      const context = await loadActorContext(input);
      requireCapability(context.actor.role, "assign_groups");
      return repository.changeSettlementGroupAssignment({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        projectStreamerId: input.projectStreamerId,
        groupId: input.groupId,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        reason: input.reason,
        clientRequestId: input.clientRequestId,
      });
    },
  };
}

export function createCustomRuleLifecycleService(dependencies: {
  repository: CustomRuleLifecycleRepositoryPort;
  audit: CustomRuleLifecycleAuditWriter;
  executionCapability?: CustomRuleExecutionCapability;
  now?: () => string;
}): CustomRuleLifecycleService {
  const repository = dependencies.repository;
  const executionCapability = dependencies.executionCapability ?? {
    enabled: false,
  };
  const now = dependencies.now ?? (() => new Date().toISOString());

  type VersionContext = CustomRuleLifecycleGovernanceContext & {
    version: CustomSettlementRuleVersion;
  };
  type SimulationContext = CustomRuleLifecycleGovernanceContext & {
    simulation: CustomRuleSimulationFreshnessHashes & {
      id: string;
      createdAt: string;
    };
    expectedFreshness: CustomRuleSimulationFreshnessHashes;
  };
  type ApprovalContext = VersionContext &
    SimulationContext & {
      eligibleApprovers: readonly {
        userId: string;
        role: "owner" | "ops_manager";
      }[];
      creatorUserId: string;
      simulationFacts: CustomRuleMaterialRiskInput["simulation"];
      currentMarginCents: string | null;
      contractFacts: CustomRuleMaterialRiskInput["contract"];
    };
  type ArchiveContext = VersionContext &
    SimulationContext & {
      archiveSafety: NonNullable<
        CustomRuleLifecycleGovernanceContext["archiveSafety"]
      >;
    };

  const loadContext = async (input: {
    actor: LifecycleActorInput;
    projectId: string;
    ruleVersionId?: string;
    source?: ApplyAndSubmitCustomRuleInput["source"];
    sourceSimulationId?: string;
  }): Promise<CustomRuleLifecycleGovernanceContext> => {
    const context = await repository.getCustomRuleGovernanceContext({
      organizationId: input.actor.organizationId,
      projectId: input.projectId,
      actorUserId: input.actor.userId,
      ruleVersionId: input.ruleVersionId,
      source: input.source,
      sourceSimulationId: input.sourceSimulationId,
    });
    if (
      context.actor.organizationId !== input.actor.organizationId ||
      context.actor.userId !== input.actor.userId
    ) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context does not match the request scope",
      );
    }
    if (context.version !== undefined) {
      if (
        context.version.organizationId !== input.actor.organizationId ||
        context.version.projectId !== input.projectId ||
        (input.ruleVersionId !== undefined &&
          context.version.id !== input.ruleVersionId)
      ) {
        throw new CustomRuleGovernanceError(
          "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
          "Server-owned custom settlement rule context does not match the request scope",
        );
      }
    } else if (input.ruleVersionId !== undefined) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context does not match the request scope",
      );
    }
    return context;
  };

  const requireCapability = (
    role: AppRole,
    capability: Parameters<typeof canRolePerformCustomRuleGovernanceAction>[1],
  ): void => {
    if (!canRolePerformCustomRuleGovernanceAction(role, capability)) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_ACTION_NOT_ALLOWED",
        `Server role ${role} cannot perform ${capability}`,
      );
    }
  };

  const requireVersionContext: (
    context: CustomRuleLifecycleGovernanceContext,
  ) => asserts context is VersionContext = (context) => {
    if (context.version === undefined) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context is missing the version record",
      );
    }
  };

  const requireSimulationContext: (
    context: CustomRuleLifecycleGovernanceContext,
  ) => asserts context is SimulationContext = (context) => {
    if (
      context.simulation === undefined ||
      context.expectedFreshness === undefined
    ) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context is missing simulation freshness",
      );
    }
  };

  const requireApprovalContext: (
    context: CustomRuleLifecycleGovernanceContext,
  ) => asserts context is ApprovalContext = (context) => {
    requireVersionContext(context);
    requireSimulationContext(context);
    if (
      context.eligibleApprovers === undefined ||
      context.creatorUserId === undefined ||
      context.simulationFacts === undefined ||
      context.currentMarginCents === undefined ||
      context.contractFacts === undefined
    ) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context is missing approval facts",
      );
    }
  };

  const requireArchiveContext: (
    context: CustomRuleLifecycleGovernanceContext,
  ) => asserts context is ArchiveContext = (context) => {
    requireVersionContext(context);
    requireSimulationContext(context);
    if (context.archiveSafety === undefined) {
      throw new CustomRuleGovernanceError(
        "CUSTOM_RULE_SERVER_CONTEXT_MISMATCH",
        "Server-owned custom settlement rule context is missing archive safety evidence",
      );
    }
  };

  const isGroupTarget = (
    target: CustomRuleMaterialRiskInput["contract"]["target"],
  ): target is Extract<
    CustomRuleMaterialRiskInput["contract"]["target"],
    { targetType: "streamer_group" }
  > => target.targetType === "streamer_group";

  const requireGroupGovernance = (
    context: CustomRuleLifecycleGovernanceContext,
  ): NonNullable<CustomRuleLifecycleGovernanceContext["groupGovernance"]> => {
    const target = context.version?.target ?? context.contractFacts?.target;
    if (!target || !isGroupTarget(target)) {
      return {
        assignedProjectStreamerIds: [],
        unassignedProjectStreamerIds: [],
        currentGroupSnapshotHash: "0".repeat(64),
        simulationPopulation: {
          assignedProjectStreamerIds: [],
          unassignedProjectStreamerIds: [],
          groupSnapshotHash: "0".repeat(64),
        },
        activePendingRules: [],
      };
    }
    if (context.groupGovernance === undefined) {
      throw new CustomRuleGovernanceError(
        "SETTLEMENT_GROUP_GOVERNANCE_CONTEXT_MISSING",
        "Group-targeted settlement rules require server-owned group governance context",
      );
    }
    return context.groupGovernance;
  };

  const assertGroupReadiness = (
    context: CustomRuleLifecycleGovernanceContext,
  ): void => {
    const target = context.version?.target ?? context.contractFacts?.target;
    if (!target || !isGroupTarget(target)) return;
    const governance = requireGroupGovernance(context);
    try {
      validateSettlementGroupRuleActivationReadiness({
        targetGroupId: target.targetId,
        assignedProjectStreamerIds: governance.assignedProjectStreamerIds,
        unassignedProjectStreamerIds: governance.unassignedProjectStreamerIds,
        simulationPopulation: governance.simulationPopulation,
        currentGroupSnapshotHash: governance.currentGroupSnapshotHash,
      });
    } catch (error) {
      throw new CustomRuleGovernanceError(
        "SETTLEMENT_GROUP_SIMULATION_POPULATION_INCOMPLETE",
        error instanceof Error
          ? error.message
          : "Group simulation population is incomplete",
      );
    }
  };

  const assertNoBlockingGroupConflicts = (
    context: CustomRuleLifecycleGovernanceContext,
  ): void => {
    const target = context.version?.target ?? context.contractFacts?.target;
    if (!target || !isGroupTarget(target)) return;
    const conflict = analyzeSettlementGroupRuleConflicts(
      requireGroupGovernance(context).activePendingRules,
    );
    if (conflict.blocking) {
      throw new CustomRuleGovernanceError(
        "SETTLEMENT_GROUP_RULE_CONFLICT_BLOCKING",
        `Blocking settlement group rule conflict: ${conflict.blockingCodes.join(", ")}`,
      );
    }
  };

  const auditTransition = async (input: {
    action: AuditLogInput["action"];
    context: CustomRuleLifecycleGovernanceContext;
    projectId: string;
    versionId: string;
    transition: string;
    reason: string;
    result?: "success" | "failure";
    errorMessage?: string;
    beforeStatus?: string;
  }): Promise<void> => {
    await dependencies.audit({
      organizationId: input.context.actor.organizationId,
      actorUserId: input.context.actor.userId,
      actorRole: input.context.actor.role,
      action: input.action,
      module: "settlements",
      objectType: `custom_settlement_rule:${input.transition}`,
      objectId: input.versionId,
      projectId: input.projectId,
      before: {
        status:
          input.beforeStatus ?? input.context.version?.status ?? "unknown",
      },
      after: { transition: input.transition },
      changedFields: ["status"],
      reason: input.reason,
      isHighRisk: true,
      result: input.result ?? "success",
      errorMessage: input.errorMessage,
    });
  };

  const approve = async (
    input: ApproveLifecycleServiceInput | ForceApproveLifecycleServiceInput,
    force: boolean,
  ): Promise<CustomRuleLifecycleResult> => {
    const context = await loadContext({
      actor: input.actor,
      projectId: input.projectId,
      ruleVersionId: input.ruleVersionId,
    });
    requireApprovalContext(context);
    assertCustomRuleTransition(context.version.status, "active");
    assertSimulationFresh({
      expected: context.expectedFreshness,
      simulation: context.simulation,
    });
    assertGroupReadiness(context);
    assertNoBlockingGroupConflicts(context);
    const risk = analyzeCustomRuleMaterialRisk({
      simulation: context.simulationFacts,
      currentMarginCents: context.currentMarginCents,
      contract: context.contractFacts,
      configuration: context.riskConfiguration,
    });
    const forceInput = input as ForceApproveLifecycleServiceInput;
    assertCustomRuleApprovalAllowed(
      force
        ? {
            mode: "force",
            actor: context.actor,
            creatorUserId: context.creatorUserId,
            eligibleApprovers: context.eligibleApprovers,
            materialRiskCodes: risk.codes,
            acknowledgement: forceInput.acknowledgment,
            reason: input.reason,
          }
        : {
            mode: "standard",
            actor: context.actor,
            creatorUserId: context.creatorUserId,
            eligibleApprovers: context.eligibleApprovers,
            materialRiskCodes: risk.codes,
          },
    );
    const riskSummary = {
      material: risk.material,
      codes: [...risk.codes],
      findings: risk.findings.map((finding) => ({ ...finding })),
      configuration: risk.configuration,
      force,
      ...(force ? { acknowledgment: forceInput.acknowledgment } : {}),
    };
    if (!executionCapability.enabled) {
      const error = new CustomRuleGovernanceError(
        "CUSTOM_RULE_EXECUTION_DISABLED",
        "Production custom settlement rule execution is disabled",
      );
      await repository.recordCustomRuleActivationFailure({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
        reason: input.reason,
        clientRequestId: lifecycleActivationFailureRequestId(
          input.clientRequestId,
        ),
        errorMessage: error.message,
      });
      await auditTransition({
        action: "approve",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: "pending_review->active",
        reason: input.reason,
        result: "failure",
        errorMessage: error.message,
      });
      throw error;
    }
    try {
      const result = force
        ? await repository.forceApproveCustomRule({
            organizationId: context.actor.organizationId,
            projectId: input.projectId,
            ruleVersionId: input.ruleVersionId,
            effectiveFrom: input.effectiveFrom,
            reason: input.reason,
            acknowledgment: forceInput.acknowledgment,
            riskSummary,
            clientRequestId: input.clientRequestId,
          })
        : await repository.approveCustomRule({
            organizationId: context.actor.organizationId,
            projectId: input.projectId,
            ruleVersionId: input.ruleVersionId,
            effectiveFrom: input.effectiveFrom,
            reason: input.reason,
            riskSummary,
            clientRequestId: input.clientRequestId,
          });
      await auditTransition({
        action: "approve",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: "pending_review->active",
        reason: input.reason,
      });
      return result;
    } catch (error) {
      const errorMessage = lifecycleErrorMessage(error);
      try {
        await repository.recordCustomRuleActivationFailure({
          organizationId: context.actor.organizationId,
          projectId: input.projectId,
          ruleVersionId: input.ruleVersionId,
          reason: input.reason,
          clientRequestId: lifecycleActivationFailureRequestId(
            input.clientRequestId,
          ),
          errorMessage,
        });
      } catch {
        // The atomic activation error remains the primary failure.
      }
      await auditTransition({
        action: "approve",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: "pending_review->activation_failed",
        reason: input.reason,
        result: "failure",
        errorMessage,
      });
      throw error;
    }
  };

  return {
    async saveCustomRuleDraft(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
        sourceSimulationId: input.sourceSimulationId,
      });
      requireCapability(context.actor.role, "edit_draft");
      requireVersionContext(context);
      requireSimulationContext(context);
      assertCustomRulePayloadEditable(context.version.status);
      assertSimulationFresh({
        expected: context.expectedFreshness,
        simulation: context.simulation,
      });
      assertDraftMatchesSimulation(input.draft, context.simulation);
      const result = await repository.saveCustomRuleDraft(
        lifecycleRepositoryInput(input, context.actor.organizationId),
      );
      await auditTransition({
        action: "create",
        context,
        projectId: input.projectId,
        versionId: result.version.id,
        transition: "draft_saved",
        reason: input.reason,
      });
      return result;
    },

    async applyAndSubmitCustomRule(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        source: input.source,
        sourceSimulationId: input.sourceSimulationId,
      });
      requireCapability(context.actor.role, "submit_review");
      requireSimulationContext(context);
      assertSimulationFresh({
        expected: context.expectedFreshness,
        simulation: context.simulation,
      });
      assertGroupReadiness(context);
      assertNoBlockingGroupConflicts(context);
      const result = await repository.applyAndSubmitCustomRule(
        lifecycleRepositoryInput(input, context.actor.organizationId),
      );
      await auditTransition({
        action: "create",
        context,
        projectId: input.projectId,
        versionId: result.version.id,
        transition: "draft->pending_review",
        reason: input.reason,
      });
      return result;
    },

    async requestCustomRuleChanges(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
      });
      requireCapability(context.actor.role, "request_changes");
      requireVersionContext(context);
      assertCustomRuleTransition(context.version.status, "changes_requested");
      const result = await repository.requestCustomRuleChanges(
        lifecycleRepositoryInput(input, context.actor.organizationId),
      );
      await auditTransition({
        action: "reject",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: "pending_review->changes_requested",
        reason: input.reason,
      });
      return result;
    },

    async reopenRequestedChangesAsDraft(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
      });
      requireCapability(context.actor.role, "edit_draft");
      requireVersionContext(context);
      assertCustomRuleTransition(context.version.status, "draft");
      const result = await repository.reopenRequestedChangesAsDraft(
        lifecycleRepositoryInput(input, context.actor.organizationId),
      );
      await auditTransition({
        action: "update",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: "changes_requested->draft",
        reason: input.reason,
      });
      return result;
    },

    async resubmitCustomRule(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        source: input.source,
        sourceSimulationId: input.sourceSimulationId,
        ruleVersionId:
          input.source.kind === "saved_draft" ? input.source.id : undefined,
      });
      requireCapability(context.actor.role, "submit_review");
      requireVersionContext(context);
      requireSimulationContext(context);
      assertCustomRuleTransition(context.version.status, "pending_review");
      assertSimulationFresh({
        expected: context.expectedFreshness,
        simulation: context.simulation,
      });
      assertGroupReadiness(context);
      assertNoBlockingGroupConflicts(context);
      if (
        input.source.kind !== "saved_draft" ||
        context.reopenedAt === undefined ||
        context.reopenedAt === null ||
        Date.parse(context.simulation.createdAt) <=
          Date.parse(context.reopenedAt)
      ) {
        throw new CustomRuleGovernanceError(
          "CUSTOM_RULE_RESUBMIT_SIMULATION_REQUIRED",
          "Resubmission requires a new simulation created after reopening",
        );
      }
      const result = await repository.resubmitCustomRule(
        lifecycleRepositoryInput(input, context.actor.organizationId),
      );
      await auditTransition({
        action: "update",
        context,
        projectId: input.projectId,
        versionId: result.version.id,
        transition: "draft->pending_review:resubmitted",
        reason: input.reason,
      });
      return result;
    },

    approveCustomRule(input) {
      return approve(input, false);
    },

    forceApproveCustomRule(input) {
      return approve(input, true);
    },

    async archiveCustomRule(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
      });
      requireCapability(context.actor.role, "archive_rule");
      requireArchiveContext(context);
      assertCustomRuleTransition(context.version.status, "archived");
      if (context.version.status === "active") {
        const fallbackSimulation = context.archiveSafety.fallbackSimulation;
        if (
          fallbackSimulation.id === context.version.simulationId ||
          fallbackSimulation.id === context.simulation.id
        ) {
          throw new CustomRuleGovernanceError(
            "CUSTOM_RULE_ARCHIVE_FALLBACK_SIMULATION_REQUIRED",
            "Active rule archival requires a separate fresh fallback or remaining-layer simulation",
          );
        }
        assertSimulationFresh({
          expected: context.expectedFreshness,
          simulation: fallbackSimulation,
        });
        if (
          context.archiveSafety.remainingCustomLayerCount === 0 &&
          !context.archiveSafety.fixedFallbackAvailable
        ) {
          throw new CustomRuleGovernanceError(
            "CUSTOM_RULE_ARCHIVE_FALLBACK_REQUIRED",
            "Active rule archival requires a remaining custom layer or fixed fallback",
          );
        }
      }
      const result = await repository.archiveCustomRule({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        ruleVersionId: input.ruleVersionId,
        effectiveUntil: input.effectiveUntil,
        reason: input.reason,
        fallbackProof: {
          simulationId: context.archiveSafety.fallbackSimulation.id,
          proofKind: context.archiveSafety.proofKind,
          remainingCustomLayerCount:
            context.archiveSafety.remainingCustomLayerCount,
          fixedFallbackAvailable: context.archiveSafety.fixedFallbackAvailable,
          lockedBatchCount: context.archiveSafety.lockedBatchCount,
          lockedBatchExclusion: {
            excluded: true,
            lockedBatchCount: context.archiveSafety.lockedBatchCount,
          },
        },
        clientRequestId: input.clientRequestId,
      });
      await auditTransition({
        action: "void",
        context,
        projectId: input.projectId,
        versionId: input.ruleVersionId,
        transition: `${context.version.status}->archived`,
        reason: input.reason,
      });
      return result;
    },

    async listCustomRules(input) {
      const context = await loadContext({
        actor: input.actor,
        projectId: input.projectId,
      });
      requireCapability(context.actor.role, "view_internal");
      const rules = await repository.listCustomRules({
        organizationId: context.actor.organizationId,
        projectId: input.projectId,
        status: input.status,
      });
      const currentTime = Date.parse(now());
      return rules.map((rule) => {
        const start =
          rule.effectiveFrom === null ? null : Date.parse(rule.effectiveFrom);
        const end =
          rule.effectiveUntil === null ? null : Date.parse(rule.effectiveUntil);
        const approved = rule.approvedAt !== null;
        return {
          ...rule,
          effectiveNow:
            approved &&
            start !== null &&
            start <= currentTime &&
            (end === null || currentTime < end),
          scheduled: approved && start !== null && start > currentTime,
        };
      });
    },
  };
}

function lifecycleRepositoryInput<Input extends { actor: unknown }>(
  input: Input,
  organizationId: string,
): Omit<Input, "actor"> & { organizationId: string } {
  const { actor: _actor, ...rest } = input;
  void _actor;
  return { ...rest, organizationId };
}

function assertDraftMatchesSimulation(
  draft: SaveCustomRuleDraftInput["draft"],
  simulation: CustomRuleSimulationFreshnessHashes,
): void {
  assertSimulationFresh({
    expected: {
      formulaHash: draft.formulaHash,
      contractHash: draft.contractHash,
      parameterHash: draft.parameterHash,
      catalogHash: draft.catalogHash,
      dataSelectionHash: draft.dataSelectionHash,
    },
    simulation,
  });
}

function lifecycleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown activation failure";
}

function lifecycleActivationFailureRequestId(clientRequestId: string): string {
  const suffix = ":activation_failed";
  if (clientRequestId.length + suffix.length <= 120) {
    return `${clientRequestId}${suffix}`;
  }
  return `activation_failed:${sha256(clientRequestId)}`;
}
