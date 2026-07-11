import { createHash } from "node:crypto";

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
  SettlementAiGeneratedTestCase,
  SettlementAiSafetyFlag,
  SettlementAiTurnTrace,
  SettlementAiUnresolvedAmbiguity,
} from "./custom-rule-repository";
import {
  hashCustomRuleContract,
  hashCustomRuleParameters,
  type CustomRuleSimulationEvidence,
  type CustomRuleSimulationInput,
  type CustomRuleSimulationResult,
} from "./custom-rule-simulation";
import type { TypedRuntimeValue } from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CONFIRM_CONTRACT_AMBIGUITY = "confirm_contract";

export type CustomRuleAuthoringRepositoryPort = Pick<
  CustomRuleRepository,
  "createDraft" | "listDrafts" | "getDraft" | "insertSimulation"
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
  execute(prepared: PreparedSettlementAiRequest): Promise<SettlementAiResult>;
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
  conversationId?: string;
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
  expectedDataSelectionHash?: string;
  simulationEvidence: CustomRuleSimulationEvidence;
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
  code: SettlementAiFailure["code"];
  retryable: true;
  conversationId: string;
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

type OpenedAiTurn = {
  turnTrace: SettlementAiTurnTrace;
  prepared: PreparedSettlementAiRequest;
  snapshot: {
    version: number;
    summaryVersion: number;
    messageIds: string[];
  };
};

export function createCustomRuleAuthoringService(dependencies: ServiceDependencies) {
  validateDependencies(dependencies);
  const persistFailedRevisions = dependencies.persistFailedRevisions ?? false;

  return Object.freeze({
    async startSession(
      unsafeInput: StartCustomRuleSessionInput,
    ): Promise<CustomRuleAuthoringResult> {
      const input = validateStartInput(unsafeInput);
      const conversationId = input.conversationId
        ? input.conversationId
        : await createConversation(
            dependencies.conversation,
            input.actor,
            input.title,
          );
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
      const unresolvedRequired = latest.unresolvedAmbiguities.filter(
        (ambiguity) =>
          ambiguity.required && ambiguity.code !== CONFIRM_CONTRACT_AMBIGUITY,
      );
      if (unresolvedRequired.length > 0) {
        throw serviceError(
          "unresolved_ambiguities",
          "required business ambiguities remain unresolved",
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
      const idempotencyKey = draftIdempotencyKey("confirm", input);
      if (drafts.some((draft) => draft.idempotencyKey === idempotencyKey)) {
        throw serviceError(
          "duplicate_confirmation",
          "confirmation request has already been used",
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
}): Promise<CustomRuleAuthoringResult> {
  const opened = await openAiTurn({
    dependencies: input.dependencies,
    scope: input.scope,
    action: input.operation === "start" ? "clarify" : "revise",
    contractConfirmed: false,
    currentContract: input.currentContract,
    currentAmbiguities: input.currentAmbiguities,
    catalog: input.catalog,
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
  await completeConversationTurn(
    input.dependencies.conversation,
    input.scope,
    opened,
    created,
    draftInput.aiResponse.content,
    aiResult.providerName,
  );
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
}): Promise<CustomRuleAuthoringResult> {
  const scope = input.input;
  const opened = await openAiTurn({
    dependencies: input.dependencies,
    scope,
    action: "confirm",
    contractConfirmed: true,
    currentContract: input.latest.businessContract,
    currentAmbiguities: [],
    catalog: input.catalog,
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

  let summary: CustomRuleSimulationResult;
  try {
    summary = input.dependencies.simulate({
      projectId: scope.projectId,
      contract: aiResult.contract,
      compiledAst: deterministic.compiledAst,
      parameters,
      formulaHash: deterministic.formulaHash,
      contractHash: input.contractHash,
      parameterHash,
      catalogVersion: input.catalog.version,
      readiness,
      ...scope.simulationEvidence,
    });
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
    summary.persistable.dataSelectionHash !== summary.dataSelectionHash
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
      "simulation selection hash does not match the expected hash",
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "persistence_failed",
      "immutable simulation persistence failed",
      true,
      error,
    );
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
    return failAndThrow(
      input.dependencies.conversation,
      scope,
      opened,
      "persistence_failed",
      "simulated draft readback did not confirm the durable transition",
      true,
      error,
    );
  }
  await completeConversationTurn(
    input.dependencies.conversation,
    scope,
    opened,
    simulatedDraft,
    explanation,
    aiResult.providerName,
  );
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

async function openAiTurn(input: {
  dependencies: ServiceDependencies;
  scope: ScopedTransition;
  action: "clarify" | "revise" | "confirm";
  contractConfirmed: boolean;
  currentContract: BusinessRuleContract;
  currentAmbiguities: SettlementAiUnresolvedAmbiguity[];
  catalog: CustomRuleVariableCatalog;
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

async function completeConversationTurn(
  conversation: SettlementConversationPort,
  scope: ScopedTransition,
  opened: OpenedAiTurn,
  draft: CustomRuleDraft,
  content: string,
  providerName?: AiProviderName,
): Promise<void> {
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
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "durable draft exists but generic turn completion failed",
      true,
      error,
    );
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

async function createConversation(
  conversation: SettlementConversationPort,
  actor: { organizationId: string; userId: string },
  title?: string,
): Promise<string> {
  try {
    const created = await conversation.createConversation(actor, title);
    return created.id;
  } catch (error) {
    throw serviceError(
      "conversation_failed",
      "generic conversation could not be created",
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
    turnTrace: draft.turnTrace,
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

function validateDependencies(input: ServiceDependencies): void {
  if (
    !input ||
    typeof input.conversation?.createConversation !== "function" ||
    typeof input.ai?.prepare !== "function" ||
    typeof input.repository?.createDraft !== "function" ||
    typeof input.catalog?.getCatalog !== "function" ||
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
  if (!input.seedContract || input.initialAmbiguities.length === 0) {
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
    (input.expectedDataSelectionHash !== undefined &&
      !HASH_PATTERN.test(input.expectedDataSelectionHash))
  ) {
    throw serviceError("invalid_input", "confirmation input is invalid", false);
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
