import { createHash } from "node:crypto";

import { z } from "zod";

import type { AiProviderName } from "@/features/ai/contracts";
import type {
  AiConversationTurnDto,
  ConversationTurnStatus,
} from "@/features/ai/conversation-contracts";
import type { CreatedConversationTurn } from "@/features/ai/conversation-repository";

import type {
  PrepareSettlementAiInput,
  PreparedSettlementAiRequest,
  SettlementAiFailure,
  SettlementAiResult,
  SettlementConversationPort,
} from "./custom-rule-ai";
import {
  diffBusinessRuleContracts,
  type BusinessRuleContract,
  type BusinessRuleContractChange,
} from "./custom-rule-contract";
import type {
  CustomRuleDataReadinessReport,
  CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import { buildCustomRuleTemplateExplanation } from "./custom-rule-explanation";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import type {
  ClarifyingCustomRuleDraftInput,
  ContractReadyCustomRuleDraftInput,
  CreateCustomRuleDraftInput,
  CreatedCustomRuleDraft,
  CustomRuleDraft,
  CustomRuleRepository,
  FailedCustomRuleDraftInput,
  FinalizeSettlementAiDraftTurnInput,
  FinalizeSettlementAiFailedTurnInput,
  FinalizeSettlementAiSimulationTurnInput,
  FinalizedSettlementAiSimulationTurn,
  InsertedSettlementFormulaSimulation,
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
import { validateCustomRuleFormula } from "./custom-rule-validator";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";

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

export class CustomRuleAuthoringServiceError extends Error {
  constructor(
    readonly code: CustomRuleAuthoringServiceErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown; sourceTurnId?: string },
  ) {
    super(message, options);
    this.name = "CustomRuleAuthoringServiceError";
    this.sourceTurnId = options?.sourceTurnId ?? null;
  }

  readonly sourceTurnId: string | null;
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
      await requireConversationHistory(
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
        return replay.initialStatus === "failed"
          ? replayFailure(replay)
          : replayClarifying(replay, drafts);
      }
      if (drafts.length > 0) {
        throw serviceError(
          "invalid_transition",
          "conversation already owns a settlement authoring session",
          false,
        );
      }
      const catalog = await loadCatalog(
        dependencies.catalog,
        scope,
        input.seedContract,
      );
      return runClarifyingTransition({
        dependencies,
        persistFailedRevisions,
        operation: "start",
        scope,
        currentContract: input.seedContract,
        currentAmbiguities: input.initialAmbiguities,
        catalog,
        idempotencyKey,
        expectedRevisionNumber: 1,
        expectedDraftId: null,
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
  const readiness = input.dependencies.analyzeReadiness({
    catalog: input.catalog,
    inputs: readinessRequirements(
      input.draft.businessContract,
      deterministic.variables,
    ),
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
  );
}

type ObservedConversationTurn = {
  history: Awaited<ReturnType<SettlementConversationPort["getHistory"]>>;
  turn: AiConversationTurnDto;
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
  observed: AiConversationTurnDto,
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
  try {
    if (
      accepted.conversationId !== input.scope.conversationId ||
      accepted.status !== "accepted" ||
      observed.turn.status !== "accepted"
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

function retryTurnDto(
  returned: CreatedConversationTurn,
  observed: AiConversationTurnDto,
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
    );
  }
  throw serviceError(
    input.code,
    input.message,
    input.retryable,
    input.cause,
    input.opened.turnTrace.turnId,
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
    if (!simulation) throw new Error("atomic simulation readback is partial");
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
  if (!simulation) {
    throw serviceError(
      "persistence_failed",
      "simulated draft has no matching immutable simulation",
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
  throw serviceError(code, message, retryable, cause, opened.turnTrace.turnId);
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
      error.sourceTurnId === opened.turnTrace.turnId
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
      );
    }
    throw serviceError(
      "conversation_failed",
      "Settlement authoring failed before atomic finalization.",
      true,
      error,
      opened.turnTrace.turnId,
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
    );
  }
}

async function requireConversationHistory(
  conversation: SettlementConversationPort,
  actor: { organizationId: string; userId: string },
  conversationId: string,
): Promise<void> {
  try {
    const history = await conversation.getHistory(actor, conversationId);
    if (
      history.conversation.id !== conversationId ||
      history.conversation.status !== "active"
    ) {
      throw new Error("conversation scope mismatch");
    }
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
): Promise<AuthorizedCustomRuleSimulationEvidence> {
  const unsafeEvidence = await port.loadAuthorizedEvidence({
    actor: scope.actor,
    organizationId: scope.actor.organizationId,
    projectId: scope.projectId,
    selection,
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
  const ids = new Set([
    ...contract.requiredInputs.map((required) => required.name),
    ...formulaVariables,
  ]);
  return [...ids]
    .sort((left, right) => left.localeCompare(right))
    .map((variableId) => ({ variableId, required: true as const }));
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
): CustomRuleAuthoringServiceError {
  return new CustomRuleAuthoringServiceError(code, message, retryable, {
    cause,
    sourceTurnId,
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
