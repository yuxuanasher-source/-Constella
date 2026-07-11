import { createHash } from "node:crypto";

import { z } from "zod";

import type { AiProviderName } from "@/features/ai/contracts";

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
  InsertedSettlementFormulaSimulation,
  SettlementFormulaSimulation,
  SettlementAiGeneratedTestCase,
  SettlementAiSafetyFlag,
  SettlementAiTurnTrace,
  SettlementAiUnresolvedAmbiguity,
} from "./custom-rule-repository";
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
    if (new Set(selection.criteriaCodes).size !== selection.criteriaCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["criteriaCodes"],
        message: "selection criteria codes must be unique",
      });
    }
  });

export type CustomRuleAuthoringRepositoryPort = Pick<
  CustomRuleRepository,
  | "createDraft"
  | "listDrafts"
  | "getDraft"
  | "insertSimulation"
  | "listSimulations"
>;

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
  | CustomRuleAiTransitionFailure;

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
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CustomRuleAuthoringServiceError";
  }
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
    promptText: z.string().min(1).max(12_000),
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

type ContractReadyDraft = Extract<
  CustomRuleDraft,
  { initialStatus: "contract_ready" }
>;
type ClarifyingDraft = Extract<
  CustomRuleDraft,
  { initialStatus: "clarifying" }
>;
type FailedDraft = Extract<CustomRuleDraft, { initialStatus: "failed" }>;

export function createCustomRuleAuthoringService(dependencies: ServiceDependencies) {
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
      if (replay) return replayClarifying(replay, drafts);
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
      const opened = await openRetryTurn(dependencies, input);
      const retryContext = opened.serviceRetryContext;
      const scope: ScopedTransition = {
        actor: input.actor,
        projectId: input.projectId,
        conversationId: input.conversationId,
        clientRequestId: input.clientRequestId,
        promptText: retryContext.promptText,
      };
      const drafts = await listScopedDrafts(dependencies.repository, scope);
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
        if (persisted.status !== "clarifying" || latest?.id !== persisted.id) {
          throw serviceError(
            "stale_revision",
            "durable clarifying retry artifact is no longer current",
            false,
          );
        }
        return resumeClarifyingCompletion({
          dependencies,
          scope,
          opened,
          retryContext,
          drafts,
          draft: persisted,
          sourceTurnId: input.sourceTurnId,
        });
      }
      let idempotencyKey = retryContext.draftIdempotencyKey;
      let expectedRevisionNumber = retryContext.expectedRevisionNumber;
      if (
        persisted?.initialStatus === "failed"
      ) {
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
          const opened = await openRetryTurn(dependencies, {
            actor: input.actor,
            projectId: input.projectId,
            conversationId: input.conversationId,
            sourceTurnId: existing.turnTrace.turnId,
            clientRequestId: technicalRetryClientRequestId(
              input.clientRequestId,
              existing.turnTrace.turnId,
            ),
          });
          return retryConfirmationTransition({
            dependencies,
            scope: input,
            opened,
            retryContext: opened.serviceRetryContext,
            drafts,
            sourceTurnId: existing.turnTrace.turnId,
          });
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
    return resumeContractReadyConfirmation({
      dependencies: input.dependencies,
      scope: input.scope,
      opened: input.opened,
      draft: existing,
      catalog: input.opened.prepared.catalog,
      selection: context.simulationSelection,
      expectedFormulaHash: context.expectedFormulaHash,
      expectedEvidenceHash: context.expectedEvidenceHash,
      expectedDataSelectionHash: context.expectedDataSelectionHash,
    });
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
      return resumeContractReadyConfirmation({
        dependencies: input.dependencies,
        scope: input.scope,
        opened: input.opened,
        draft: retriedDraft,
        catalog: input.opened.prepared.catalog,
        selection: context.simulationSelection,
        expectedFormulaHash: context.expectedFormulaHash,
        expectedEvidenceHash: context.expectedEvidenceHash,
        expectedDataSelectionHash: context.expectedDataSelectionHash,
      });
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
      expectedDataSelectionHash:
        context.expectedDataSelectionHash ?? undefined,
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
  if (
    latest.unresolvedAmbiguities.length > 0 &&
    !onlyInternalConfirmation
  ) {
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
    expectedDataSelectionHash:
      context.expectedDataSelectionHash ?? undefined,
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

async function resumeClarifyingCompletion(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  retryContext: FrozenServiceRetryContext;
  drafts: CustomRuleDraft[];
  draft: ClarifyingDraft;
  sourceTurnId: string;
}): Promise<CustomRuleAuthoringResult> {
  const mismatch = frozenClarifyingArtifactMismatch(input);
  if (mismatch) {
    return rejectFrozenRetryArtifact(
      input.dependencies,
      input.scope,
      input.opened,
      mismatch,
    );
  }
  await markValidating(
    input.dependencies.conversation,
    input.scope,
    input.opened,
  );
  const completionFailure = await completeConversationTurn(
    input.dependencies.conversation,
    input.scope,
    input.opened,
    input.draft,
    input.draft.aiResponse.content,
  );
  if (completionFailure) return completionFailure;
  return replayClarifying(input.draft, input.drafts);
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

function frozenClarifyingArtifactMismatch(input: {
  opened: OpenedAiTurn;
  retryContext: FrozenServiceRetryContext;
  drafts: CustomRuleDraft[];
  draft: ClarifyingDraft;
  sourceTurnId: string;
}): string | null {
  const mismatch = frozenRetryArtifactMismatch(input, false);
  if (mismatch) return mismatch;
  if (
    input.draft.unresolvedAmbiguities.length === 0 ||
    input.draft.aiResponse.content !==
      input.draft.unresolvedAmbiguities[0]?.question
  ) {
    return "persisted clarifying content does not match its focused question";
  }
  return null;
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
    );
  }
  throw serviceError("conversation_failed", message, false);
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
  const opened = input.opened ?? await openAiTurn({
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
  });
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
  await markValidating(input.dependencies.conversation, input.scope, opened);
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
  const created = await persistDraftOrFailTurn(
    input.dependencies,
    input.scope,
    opened,
    draftInput,
  );
  verifyCreatedDraft(created, input.scope, {
    initialStatus: "clarifying",
    revisionNumber: input.expectedRevisionNumber,
    idempotencyKey: input.idempotencyKey,
  });
  const completionFailure = await completeConversationTurn(
    input.dependencies.conversation,
    input.scope,
    opened,
    created,
    draftInput.aiResponse.content,
    aiResult.providerName,
  );
  if (completionFailure) return completionFailure;
  return Object.freeze({
    ok: true,
    kind: "clarifying",
    conversationId: input.scope.conversationId,
    draft: created,
    diff: aiResult.diff,
    duplicate: created.duplicate,
  });
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
  const opened = input.opened ?? await openAiTurn({
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
  });
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
  if (aiResult.diff.length > 0) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "formula_validation_failed",
      "confirmed response has no complete formula evidence",
      true,
    );
  }

  const deterministic = validateCustomRuleFormula(aiResult.formulaProposal, {
    scope: aiResult.contract.scope,
    executionGrain: aiResult.contract.executionGrain,
    parameters: aiResult.contract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  const normalized = parseCustomRuleFormula(aiResult.formulaProposal);
  if (
    !deterministic.ok ||
    !normalized.ok ||
    deterministic.formulaHash !== aiResult.validation.formulaHash ||
    canonicalJson(normalized.ast) !==
      canonicalJson(aiResult.validation.normalizedAst)
  ) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "formula_validation_failed",
      "formula failed authoritative deterministic validation",
      true,
    );
  }
  if (
    scope.expectedFormulaHash &&
    scope.expectedFormulaHash !== deterministic.formulaHash
  ) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    calculatedSelectionHash = calculateCustomRuleDataSelectionHash(simulationInput);
    summary = input.dependencies.simulate(simulationInput);
  } catch (error) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "simulation_failed",
      "simulation returned mismatched freshness hashes",
      false,
    );
  }
  if (
    scope.expectedDataSelectionHash &&
    scope.expectedDataSelectionHash !== summary.dataSelectionHash
  ) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "selection_hash_mismatch",
      "final data selection hash does not match the expected hash",
      false,
    );
  }
  if (summary.riskFlags.some((flag) => flag.severity === "block")) {
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
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
  const created = await persistDraftOrFailTurn(
    input.dependencies,
    scope,
    opened,
    draftInput,
  );
  verifyCreatedDraft(created, scope, {
    initialStatus: "contract_ready",
    revisionNumber: input.latest.revisionNumber + 1,
    idempotencyKey: input.idempotencyKey,
  });

  let simulation: InsertedSettlementFormulaSimulation;
  try {
    simulation = await input.dependencies.repository.insertSimulation({
      organizationId: scope.actor.organizationId,
      projectId: scope.projectId,
      owner: { kind: "ai_draft", id: created.id },
      idempotencyKey: simulationIdempotencyKey(created.id, summary),
      ...summary.persistable,
    });
  } catch (error) {
    await failConversationTurn(
      input.dependencies.conversation,
      scope,
      opened,
      "settlement_simulation_persistence_failed",
      true,
      "immutable simulation persistence failed",
    );
    void error;
    return recoverablePersistenceFailure(scope, opened, created);
  }
  verifySimulation(simulation, scope, created, summary);
  let simulatedDraft: CustomRuleDraft;
  try {
    simulatedDraft = await getSimulatedDraft(
      input.dependencies,
      scope,
      created.id,
    );
  } catch (error) {
    await failConversationTurn(
      input.dependencies.conversation,
      scope,
      opened,
      "settlement_simulation_readback_failed",
      true,
      "simulated draft readback did not confirm the durable transition",
    );
    void error;
    return recoverablePersistenceFailure(scope, opened, created);
  }
  const completionFailure = await completeConversationTurn(
    input.dependencies.conversation,
    scope,
    opened,
    simulatedDraft,
    explanation,
    aiResult.providerName,
  );
  if (completionFailure) return completionFailure;
  return Object.freeze({
    ok: true,
    kind: "simulated",
    conversationId: scope.conversationId,
    draft: simulatedDraft,
    simulation,
    summary,
    duplicate: created.duplicate || simulation.duplicate,
  });
}

async function resumeContractReadyConfirmation(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  opened: OpenedAiTurn;
  draft: ContractReadyDraft;
  catalog: CustomRuleVariableCatalog;
  selection: AuthorizedSimulationSelectionRequest;
  expectedFormulaHash: string | null;
  expectedEvidenceHash: string | null;
  expectedDataSelectionHash: string | null;
}): Promise<CustomRuleAuthoringResult> {
  await markValidating(
    input.dependencies.conversation,
    input.scope,
    input.opened,
  );
  let summary: CustomRuleSimulationResult;
  try {
    summary = await buildExistingDraftSimulation({
      dependencies: input.dependencies,
      scope: input.scope,
      draft: input.draft,
      catalog: input.catalog,
      selection: input.selection,
      expectedFormulaHash: input.expectedFormulaHash,
      expectedEvidenceHash: input.expectedEvidenceHash,
      expectedDataSelectionHash: input.expectedDataSelectionHash,
    });
  } catch (error) {
    const failure =
      error instanceof CustomRuleAuthoringServiceError
        ? error
        : serviceError(
            "simulation_failed",
            "contract-ready simulation recovery failed",
            true,
            error,
          );
    return failAndThrow(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      failure.code,
      failure.message,
      failure.retryable,
      failure,
    );
  }
  let simulation: InsertedSettlementFormulaSimulation;
  if (input.draft.status === "simulated") {
    try {
      simulation = await readExistingSimulation(
        input.dependencies,
        input.scope,
        input.draft,
        summary,
      );
    } catch (error) {
      const failure =
        error instanceof CustomRuleAuthoringServiceError
          ? error
          : serviceError(
              "persistence_failed",
              "durable simulation readback failed during retry",
              true,
              error,
            );
      return failAndThrow(
        input.dependencies.conversation,
        input.scope,
        input.opened,
        failure.code,
        failure.message,
        failure.retryable,
        failure,
      );
    }
    const simulatedDraft = await getSimulatedDraft(
      input.dependencies,
      input.scope,
      input.draft.id,
    );
    const completionFailure = await completeConversationTurn(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      simulatedDraft,
      input.draft.generatedExplanation,
    );
    if (completionFailure) return completionFailure;
    return Object.freeze({
      ok: true,
      kind: "simulated",
      conversationId: input.scope.conversationId,
      draft: simulatedDraft,
      simulation,
      summary,
      duplicate: true,
    });
  }
  try {
    simulation = await input.dependencies.repository.insertSimulation({
      organizationId: input.scope.actor.organizationId,
      projectId: input.scope.projectId,
      owner: { kind: "ai_draft", id: input.draft.id },
      idempotencyKey: simulationIdempotencyKey(input.draft.id, summary),
      ...summary.persistable,
    });
  } catch (error) {
    await failConversationTurn(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      "settlement_simulation_persistence_failed",
      true,
      "immutable simulation persistence failed during retry",
    );
    void error;
    return recoverablePersistenceFailure(
      input.scope,
      input.opened,
      input.draft,
    );
  }
  verifySimulation(simulation, input.scope, input.draft, summary);
  let simulatedDraft: CustomRuleDraft;
  try {
    simulatedDraft = await getSimulatedDraft(
      input.dependencies,
      input.scope,
      input.draft.id,
    );
  } catch (error) {
    await failConversationTurn(
      input.dependencies.conversation,
      input.scope,
      input.opened,
      "settlement_simulation_readback_failed",
      true,
      "simulated draft readback failed during retry",
    );
    void error;
    return recoverablePersistenceFailure(
      input.scope,
      input.opened,
      input.draft,
    );
  }
  const completionFailure = await completeConversationTurn(
    input.dependencies.conversation,
    input.scope,
    input.opened,
    simulatedDraft,
    input.draft.generatedExplanation,
  );
  if (completionFailure) return completionFailure;
  return Object.freeze({
    ok: true,
    kind: "simulated",
    conversationId: input.scope.conversationId,
    draft: simulatedDraft,
    simulation,
    summary,
    duplicate: true,
  });
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
    expectedDataSelectionHash:
      input.input.expectedDataSelectionHash ?? null,
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
  if (accepted.conversationId !== input.scope.conversationId) {
    throw serviceError(
      "conversation_failed",
      "generic conversation returned a mismatched conversation",
      false,
    );
  }
  let preparedTurn;
  try {
    preparedTurn = await input.dependencies.conversation.prepareTurn(
      input.scope.actor,
      accepted.turnId,
      [
        `settlement-catalog:${input.catalog.version}`,
        `settlement-contract:${hashCustomRuleContract(input.currentContract)}`,
      ],
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation context could not be prepared",
      true,
      error,
    );
  }
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
  let captured;
  try {
    captured = await input.dependencies.conversation.captureGatewayContext(
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
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation could not freeze gateway context",
      true,
      error,
    );
  }
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
}

async function openRetryTurn(
  dependencies: ServiceDependencies,
  input: RetryCustomRuleTurnInput,
): Promise<OpenedAiTurn> {
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
  if (accepted.conversationId !== input.conversationId) {
    throw serviceError(
      "conversation_failed",
      "generic retry returned a mismatched conversation",
      false,
    );
  }
  let preparedTurn;
  try {
    preparedTurn = await dependencies.conversation.prepareTurn(
      input.actor,
      accepted.turnId,
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic retry context could not be restored",
      true,
      error,
    );
  }
  const gatewayContext = preparedTurn.snapshot.gatewayContext;
  if (!gatewayContext) {
    throw serviceError(
      "conversation_failed",
      "generic retry has no frozen gateway context",
      false,
    );
  }
  const serviceContextResult = frozenServiceRetryContextSchema.safeParse(
    gatewayContext.invocationMetadata.settlementServiceRetryContext,
  );
  if (!serviceContextResult.success) {
    throw serviceError(
      "conversation_failed",
      "settlement retry metadata is invalid",
      false,
    );
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
    throw serviceError(
      "conversation_failed",
      "settlement retry metadata scope mismatch",
      false,
    );
  }
  let prepared: PreparedSettlementAiRequest;
  try {
    prepared = dependencies.ai.restore(
      gatewayContext.invocationMetadata.settlementAiRetryContext,
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "frozen settlement AI context could not be restored",
      false,
      error,
    );
  }
  if (
    prepared.action !== serviceRetryContext.action ||
    canonicalJson(preparedTurn.messages) !==
      canonicalJson(gatewayContext.messages) ||
    canonicalJson(prepared.request.messages) !==
      canonicalJson(gatewayContext.messages)
  ) {
    throw serviceError(
      "conversation_failed",
      "frozen settlement retry context mismatch",
      false,
    );
  }
  try {
    await dependencies.conversation.markGenerating(
      input.actor,
      accepted.turnId,
      dependencies.primaryProvider,
    );
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic retry could not enter generation",
      true,
      error,
    );
  }
  return {
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
  };
}

async function executeAi(
  ai: SettlementRuleAiPort,
  prepared: PreparedSettlementAiRequest,
): Promise<SettlementAiResult> {
  try {
    return await ai.execute(prepared);
  } catch (error) {
    return {
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
      message:
        error instanceof Error ? error.message : "settlement AI adapter failed",
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
    try {
      const created = await input.dependencies.repository.createDraft(failedInput);
      verifyCreatedDraft(created, input.scope, {
        initialStatus: "failed",
        revisionNumber: input.expectedRevisionNumber,
        idempotencyKey: input.idempotencyKey,
      });
      failedDraft = created;
    } catch (error) {
      await failConversationTurn(
        input.dependencies.conversation,
        input.scope,
        input.opened,
        "settlement_ai_failed_revision_persistence",
        true,
        input.failure.message,
      );
      throw serviceError(
        "persistence_failed",
        "failed AI revision could not be persisted",
        true,
        error,
      );
    }
  }
  await failConversationTurn(
    input.dependencies.conversation,
    input.scope,
    input.opened,
    input.failure.code,
    input.failure.retryable,
    input.failure.message,
    input.failure.providerName,
  );
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

async function persistDraftOrFailTurn(
  dependencies: ServiceDependencies,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  input: CreateCustomRuleDraftInput,
): Promise<CreatedCustomRuleDraft> {
  try {
    return await dependencies.repository.createDraft(input);
  } catch (error) {
    await failConversationTurn(
      dependencies.conversation,
      scope,
      opened,
      "settlement_draft_persistence_failed",
      true,
      "settlement draft persistence failed",
    );
    throw serviceError(
      "persistence_failed",
      "settlement draft persistence failed",
      true,
      error,
    );
  }
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
  const idempotencyKey = simulationIdempotencyKey(draft.id, summary);
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

async function completeConversationTurn(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  draft: CustomRuleDraft,
  content: string,
  providerName?: AiProviderName,
): Promise<CustomRuleAiTransitionFailure | null> {
  try {
    await conversation.completeTurn(scope.actor, opened.turnTrace.turnId, {
      content,
      providerName,
      metadata: {
        contextSnapshotVersion: opened.snapshot.version,
        contextSummaryVersion: opened.snapshot.summaryVersion,
        contextMessageIds: [...opened.snapshot.messageIds],
        settlementDraftId: draft.id,
        settlementRevisionNumber: draft.revisionNumber,
        settlementInitialStatus: draft.initialStatus,
      },
    });
    return null;
  } catch (error) {
    try {
      await failConversationTurn(
        conversation,
        scope,
        opened,
        "settlement_turn_completion_failed",
        true,
        "durable settlement artifacts exist but turn completion failed",
        providerName,
      );
    } catch (reconciliationError) {
      throw serviceError(
        "conversation_reconciliation_failed",
        "generic turn could not be reconciled after durable settlement persistence",
        false,
        reconciliationError,
      );
    }
    void error;
    return recoverableTurnFailure("conversation_failed", scope, opened, draft);
  }
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
  throw serviceError(code, message, retryable, cause);
}

async function markValidating(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
): Promise<void> {
  try {
    await conversation.markValidating(scope.actor, opened.turnTrace.turnId);
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation could not enter validation",
      true,
      error,
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
  if (calculateCustomRuleEvidenceHash(evidence) !== evidence.provenance.evidenceHash) {
    throw new Error("authorized evidence provenance hash mismatch");
  }
  return evidence;
}

function resolvedClarifyingAmbiguities(input: Extract<SettlementAiResult, { ok: true }> ):
  [SettlementAiUnresolvedAmbiguity, ...SettlementAiUnresolvedAmbiguity[]] {
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

function recoverablePersistenceFailure(
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  draft: CustomRuleDraft,
): CustomRuleAiTransitionFailure {
  return recoverableTurnFailure("persistence_failed", scope, opened, draft);
}

function recoverableTurnFailure(
  code: "persistence_failed" | "conversation_failed",
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  draft: CustomRuleDraft,
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
  draftId: string,
  summary: CustomRuleSimulationResult,
): string {
  return `settlement-simulation:${sha256(
    canonicalJson({
      dataSelectionHash: summary.dataSelectionHash,
      draftId,
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

function technicalRetryClientRequestId(
  clientRequestId: string,
  sourceTurnId: string,
): string {
  return `settlement-confirm-retry:${sha256(
    canonicalJson({ clientRequestId, sourceTurnId }),
  )}`;
}

function validateDependencies(input: ServiceDependencies): void {
  if (
    !input ||
    typeof input.conversation?.getHistory !== "function" ||
    typeof input.conversation?.retryTurn !== "function" ||
    typeof input.ai?.prepare !== "function" ||
    typeof input.ai?.restore !== "function" ||
    typeof input.repository?.createDraft !== "function" ||
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
    !canonicalText(input.promptText, 12_000) ||
    !canonicalText(input.clientRequestId, 128) ||
    input.clientRequestId.length < 8 ||
    !CLIENT_REQUEST_ID_PATTERN.test(input.clientRequestId)
  ) {
    throw serviceError("invalid_input", "authoring scope input is invalid", false);
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
): CustomRuleAuthoringServiceError {
  return new CustomRuleAuthoringServiceError(code, message, retryable, {
    cause,
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
