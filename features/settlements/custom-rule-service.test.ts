import { describe, expect, it, vi } from "vitest";

import type {
  AiConversationMessageDto,
  AiConversationTurnDto,
} from "@/features/ai/conversation-contracts";
import type { AiGatewayResult } from "@/features/ai/contracts";

import { createSettlementRuleAiAdapter } from "./custom-rule-ai";
import type {
  SettlementConversationPort,
  SettlementStructuredGateway,
} from "./custom-rule-ai";
import type { BusinessRuleContract } from "./custom-rule-contract";
import { analyzeCustomRuleDataReadiness } from "./custom-rule-data-readiness";
import type {
  CreateCustomRuleDraftInput,
  CreatedCustomRuleDraft,
  CustomRuleDraft,
  CustomRuleRepository,
  FinalizeSettlementAiDraftTurnInput,
  FinalizeSettlementAiFailedTurnInput,
  FinalizeSettlementAiSimulationTurnInput,
  FinalizedSettlementAiSimulationTurn,
  InsertedSettlementFormulaSimulation,
  InsertSettlementFormulaSimulationInput,
  SettlementAiTurnCompletionInput,
  SettlementAiUnresolvedAmbiguity,
  SettlementFormulaSimulation,
} from "./custom-rule-repository";
import { SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES } from "./custom-rule-repository";
import { parseCustomRuleFormula } from "./custom-rule-parser";
import {
  createCustomRuleAuthoringService,
  type AuthorizedSimulationEvidencePort,
  type AuthorizedSimulationSelectionRequest,
  type CustomRuleAuthoringRepositoryPort,
  type SettlementVariableCatalogPort,
} from "./custom-rule-service";
import {
  calculateCustomRuleEvidenceHash,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type AuthorizedCustomRuleSimulationEvidence,
  type CustomRuleSimulationInput,
} from "./custom-rule-simulation";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";
import { validateCustomRuleFormula } from "./custom-rule-validator";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const FIRST_DRAFT_ID = "00000000-0000-4000-8000-000000000101";
const CATALOG_VERSION = "a".repeat(64);
const actor = { organizationId: ORGANIZATION_ID, userId: USER_ID };

describe("custom rule authoring service", () => {
  it("atomically finalizes revision one without directly completing the turn", async () => {
    const harness = createHarness([
      clarificationOutput("请确认每小时结算单价？", "confirm_rate"),
    ]);
    const promptText = "  每场直播按时长结算，请逐项确认。\n";

    const result = await harness.service.startSession({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      title: "AI 结算规则",
      clientRequestId: "start-request-0001",
      promptText,
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "请确认每小时结算单价？",
          required: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "clarifying",
      conversationId: CONVERSATION_ID,
      draft: {
        revisionNumber: 1,
        initialStatus: "clarifying",
        status: "clarifying",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
    });
    const atomicInput = harness.repository.finalizeDraftTurnCalls[0];
    const draftInput = atomicInput.draft;
    expect(draftInput).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      promptText,
      status: "clarifying",
      turnTrace: {
        turnId: "00000000-0000-4000-8000-000000000201",
        userMessageId: "00000000-0000-4000-8000-000000000301",
        assistantMessageId: "00000000-0000-4000-8000-000000000401",
      },
      generatedFormula: null,
      generatedExplanation: null,
      generatedTestCases: [],
      formulaHash: null,
    });
    expect(harness.conversation.acceptTurn).toHaveBeenCalledWith(
      actor,
      CONVERSATION_ID,
      expect.objectContaining({ content: promptText }),
    );
    expect(harness.conversation.createConversation).not.toHaveBeenCalled();
    expect(atomicInput.completion).toMatchObject({
      providerName: "deterministic",
      content: draftInput.aiResponse.content,
      aiInvocationId: null,
      metadata: {
        contextSnapshotVersion: 7,
        contextSummaryVersion: 3,
        contextMessageIds: ["00000000-0000-4000-8000-000000000301"],
        settlementIdempotencyKey: draftInput.idempotencyKey,
        settlementInitialStatus: "clarifying",
      },
    });
    expectOrdered(harness.events, [
      "conversation.markValidating",
      "repository.finalizeDraftTurn",
    ]);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("requires an existing conversation id and replays the same durable start key", async () => {
    const invalid = createHarness([
      clarificationOutput("Confirm hourly rate?", "confirm_rate"),
    ]);
    await expect(
      invalid.service.startSession({
        actor,
        projectId: PROJECT_ID,
        conversationId: "",
        clientRequestId: "start-request-invalid",
        promptText: "Clarify the settlement rule.",
        seedContract: contract(),
        initialAmbiguities: [
          {
            code: "confirm_rate",
            question: "Confirm hourly rate?",
            required: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(invalid.conversation.createConversation).not.toHaveBeenCalled();
    expect(invalid.repository.createDraftCalls).toHaveLength(0);

    const replay = createHarness([
      clarificationOutput("Confirm hourly rate?", "confirm_rate"),
    ]);
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "start-request-replay",
      promptText: "Clarify the settlement rule.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm hourly rate?",
          required: true,
        },
      ],
    };
    const first = await replay.service.startSession(input);
    const second = await replay.service.startSession(input);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(replay.repository.createDraftCalls).toHaveLength(1);
    expect(replay.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(replay.conversation.createConversation).not.toHaveBeenCalled();
  });

  it("replays a failed initial draft as a failure and rejects prompts over 4000 before AI", async () => {
    const failedStart = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
    });
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "failed-start-replay-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };

    const first = await failedStart.service.startSession(input);
    const replay = await failedStart.service.startSession(input);

    expect(first).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", revisionNumber: 1 },
    });
    expect(replay).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", revisionNumber: 1 },
    });
    expect(failedStart.repository.createDraftCalls).toHaveLength(1);
    expect(failedStart.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(
      failedStart.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);

    const oversized = createHarness([
      clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
    ]);
    await expect(
      oversized.service.startSession({
        ...input,
        clientRequestId: "oversized-start-prompt-0001",
        promptText: "x".repeat(4_001),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(oversized.conversation.getHistory).not.toHaveBeenCalled();
    expect(oversized.conversation.acceptTurn).not.toHaveBeenCalled();
    expect(oversized.events).not.toContain("gateway.execute");
  });

  it("reconciles unknown atomic start commits and retries rollback with the frozen operation key", async () => {
    const harness = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { atomicDraftFailure: "after_commit" },
    );
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "start-completion-only-0001",
      promptText: "Clarify the settlement rule.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };

    const committed = await harness.service.startSession(input);
    expect(committed).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: { revisionNumber: 1, status: "clarifying" },
    });
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();

    const rolledBack = createHarness(
      [
        clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
        clarificationOutput("Confirm the hourly rate?", "confirm_rate"),
      ],
      { atomicDraftFailure: "before_write" },
    );
    const failed = await rolledBack.service.startSession({
      ...input,
      clientRequestId: "start-atomic-rollback-0001",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      retryable: true,
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    if (failed.ok)
      throw new Error("atomic rollback fixture unexpectedly passed");
    expect(rolledBack.repository.atomicFailureSnapshots).toEqual([
      {
        kind: "draft",
        draftCount: 0,
        simulationCount: 0,
        turnStatus: "validating",
      },
    ]);

    const recovered = await rolledBack.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "start-atomic-rollback-retry-0001",
    });

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
      draft: { revisionNumber: 1 },
    });
    expect(
      rolledBack.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(rolledBack.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(rolledBack.conversation.captureGatewayContext).toHaveBeenCalledTimes(
      1,
    );
    expect(rolledBack.repository.finalizeDraftTurnCalls).toHaveLength(2);
    expect(
      rolledBack.repository.finalizeDraftTurnCalls[1].draft.idempotencyKey,
    ).toBe(
      rolledBack.repository.finalizeDraftTurnCalls[0].draft.idempotencyKey,
    );
    expect(
      rolledBack.evidencePort.loadAuthorizedEvidence,
    ).not.toHaveBeenCalled();
    expect(rolledBack.conversation.completeTurn).not.toHaveBeenCalled();

    const nonrecoverable = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { atomicDraftFailure: "before_write", failFailTurn: true },
    );
    await expect(
      nonrecoverable.service.startSession({
        ...input,
        clientRequestId: "start-atomic-nonrecoverable-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
  });

  it("revises by appending the generic turn first, preserves prior evidence, and replays idempotently", async () => {
    const harness = createHarness([
      {
        contractPatch: {
          summary: "每场直播按系统时长结算，其他已确认条件保持不变。",
        },
        unresolvedAmbiguities: [],
        nextQuestion: "请确认以上业务规则无误？",
        formulaProposal: null,
        testCases: [],
        safetyFlags: [],
      },
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const previousEvidence = structuredClone(previous);

    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-request-0001",
      promptText: "只调整摘要，其他条件不变。",
    };
    const first = await harness.service.answerOrRevise(input);
    const replay = await harness.service.answerOrRevise(input);

    expect(first).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: false,
      draft: {
        revisionNumber: 2,
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
        unresolvedAmbiguities: [
          {
            code: "confirm_contract",
            question: "请确认以上业务规则无误？",
            required: true,
          },
        ],
      },
      diff: [
        {
          field: "summary",
          before: previous.businessContract.summary,
          after: "每场直播按系统时长结算，其他已确认条件保持不变。",
        },
      ],
    });
    expect(replay).toMatchObject({
      ok: true,
      duplicate: true,
      draft: {
        id: first.ok && first.kind === "clarifying" ? first.draft.id : "",
      },
    });
    expect(harness.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.events.indexOf("conversation.acceptTurn")).toBeLessThan(
      harness.events.indexOf("repository.finalizeDraftTurn"),
    );
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(previous.businessContract).toEqual(
      previousEvidence.businessContract,
    );
    expect(previous.generatedFormula).toEqual(
      previousEvidence.generatedFormula,
    );
    expect(previous.generatedTestCases).toEqual(
      previousEvidence.generatedTestCases,
    );
  });

  it("reads back a matching atomic revision after the commit response is lost", async () => {
    const output = {
      contractPatch: {
        summary: "每场直播按系统时长结算，其他已确认条件保持不变。",
      },
      unresolvedAmbiguities: [],
      nextQuestion: "请确认以上业务规则无误？",
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    };
    const harness = createHarness([output], {
      atomicDraftFailure: "after_commit",
    });
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const revision = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-completion-only-0001",
      promptText: "Update only the summary.",
    };

    const recovered = await harness.service.answerOrRevise(revision);
    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
      draft: {
        revisionNumber: 2,
        initialStatus: "clarifying",
        status: "clarifying",
      },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();

    const mismatch = createHarness([structuredClone(output)], {
      atomicDraftFailure: "partial",
    });
    const mismatchPrevious = mismatch.repository.seedDraft(clarifyingDraft());
    await expect(
      mismatch.service.answerOrRevise({
        ...revision,
        expectedDraftId: mismatchPrevious.id,
        clientRequestId: "revise-atomic-partial-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(
      mismatch.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(mismatch.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(mismatch.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
  });

  it("atomically completes with the selected question and rejects tampered readback", async () => {
    const selectedQuestion = "请确认规则生效日期？";
    const output = {
      contractPatch: {},
      unresolvedAmbiguities: [
        {
          code: "b_date",
          question: selectedQuestion,
          required: true,
        },
        {
          code: "a_rate",
          question: "请确认每小时费率？",
          required: true,
        },
      ],
      nextQuestion: selectedQuestion,
      formulaProposal: null,
      testCases: [],
      safetyFlags: [],
    };
    const harness = createHarness([output]);
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const result = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "revise-selected-question-0001",
      promptText: "Keep both ambiguities and ask about the date first.",
    });
    expect(result).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: {
        aiResponse: { content: selectedQuestion },
        unresolvedAmbiguities: [{ code: "a_rate" }, { code: "b_date" }],
      },
    });
    expect(harness.repository.finalizeDraftTurnCalls[0]).toMatchObject({
      draft: { aiResponse: { content: selectedQuestion } },
      completion: { content: selectedQuestion },
    });
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.repository.finalizeDraftTurnCalls).toHaveLength(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.repository.insertSimulationCalls).toHaveLength(0);

    const tampered = createHarness([structuredClone(output)], {
      atomicDraftFailure: "after_commit",
      tamperAtomicDraftAfterCommit: "content",
    });
    const tamperedPrevious = tampered.repository.seedDraft(clarifyingDraft());
    await expect(
      tampered.service.answerOrRevise({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        expectedDraftId: tamperedPrevious.id,
        expectedRevisionNumber: 1,
        clientRequestId: "revise-selected-question-tampered-0001",
        promptText: "Keep both ambiguities and ask about the date first.",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
    });
    expect(
      tampered.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(tampered.repository.finalizeDraftTurnCalls).toHaveLength(1);
  });

  it("atomically records an explicitly owned failed revision and generic failure", async () => {
    const harness = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
    });
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const priorSnapshot = structuredClone(previous);

    const result = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-revision-request-0001",
      promptText: "继续生成规则。",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
      failedDraft: {
        initialStatus: "failed",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
    });
    expect(harness.repository.createDraftCalls[0].status).toBe("failed");
    expect(harness.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(harness.repository.finalizeFailedTurnCalls[0]).toMatchObject({
      draft: { status: "failed" },
      completion: {
        content: "Settlement AI provider is temporarily unavailable.",
      },
      errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
      errorSummary:
        SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES.SETTLEMENT_AI_PROVIDER_FAILED,
      retryable: true,
    });
    expectOrdered(harness.events, [
      "conversation.markValidating",
      "repository.finalizeFailedTurn",
    ]);
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    const providerFailureHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      providerFailureHistory.turns.find((turn) => turn.id === uuid(201)),
    ).toMatchObject({
      status: "failed",
      errorCode: "SETTLEMENT_AI_PROVIDER_FAILED",
      retryable: true,
    });
    expect(previous.businessContract).toEqual(priorSnapshot.businessContract);
    expect(previous.generatedFormula).toEqual(priorSnapshot.generatedFormula);
  });

  it("reconciles failed-turn atomic transport outcomes without split writes", async () => {
    const committed = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
      atomicFailedFailure: "after_commit",
    });
    const committedPrevious = committed.repository.seedDraft(clarifyingDraft());

    const readback = await committed.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: committedPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-atomic-readback-0001",
      promptText: "Continue authoring the rule.",
    });

    expect(readback).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      failedDraft: { initialStatus: "failed", duplicate: true },
    });
    expect(committed.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(committed.conversation.failTurn).not.toHaveBeenCalled();
    expect(committed.conversation.completeTurn).not.toHaveBeenCalled();

    const rolledBack = createHarness([{ providerFailure: true }], {
      persistFailedRevisions: true,
      atomicFailedFailure: "before_write",
    });
    const rolledBackPrevious =
      rolledBack.repository.seedDraft(clarifyingDraft());
    const failed = await rolledBack.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: rolledBackPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "failed-atomic-rollback-0001",
      promptText: "Continue authoring the rule.",
    });

    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    expect(rolledBack.repository.drafts).toHaveLength(1);
    expect(rolledBack.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(rolledBack.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("retries a provider failure from the public frozen conversation turn without live re-grounding", async () => {
    const harness = createHarness([
      { providerFailure: true },
      clarificationOutput("Confirm the final contract?", "confirm_contract"),
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "provider-failure-request-0001",
      promptText: "Continue authoring the rule.",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
    });
    if (failed.ok)
      throw new Error("provider failure fixture unexpectedly passed");

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "provider-retry-request-0001",
    });

    expect(retried).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { revisionNumber: 2 },
    });
    expect(harness.conversation.retryTurn).toHaveBeenCalledWith(
      actor,
      uuid(201),
      { clientRequestId: "provider-retry-request-0001" },
    );
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("retries a persisted failed revision before applying normal stale checks", async () => {
    const harness = createHarness(
      [
        { providerFailure: true },
        clarificationOutput("Confirm the final contract?", "confirm_contract"),
      ],
      { persistFailedRevisions: true },
    );
    const previous = harness.repository.seedDraft(clarifyingDraft());

    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "persisted-revise-failure-0001",
      promptText: "Continue the frozen revision.",
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
      failedDraft: {
        revisionNumber: 2,
        initialStatus: "failed",
        status: "failed",
      },
    });
    if (failed.ok || !failed.failedDraft) {
      throw new Error("persisted revision failure fixture unexpectedly passed");
    }

    const recovered = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "persisted-revise-retry-0001",
    });

    expect(recovered).toMatchObject({
      ok: true,
      kind: "clarifying",
      draft: { revisionNumber: 3, initialStatus: "clarifying" },
    });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(harness.repository.createDraftCalls[1].idempotencyKey).toMatch(
      /^settlement-retry:/u,
    );
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "persisted-revise-stale-retry-0001",
      }),
    ).rejects.toMatchObject({ code: "stale_revision", retryable: false });
    expect(harness.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(203),
      expect.objectContaining({
        errorCode: "settlement_post_open_validation_failed",
        retryable: false,
      }),
    );
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("returns reconciliation failure when post-open stale compensation cannot persist", async () => {
    const harness = createHarness(
      [
        { providerFailure: true },
        clarificationOutput("Confirm the final contract?", "confirm_contract"),
      ],
      { persistFailedRevisions: true, failFailTurn: true },
    );
    const previous = harness.repository.seedDraft(clarifyingDraft());
    const failed = await harness.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "post-open-reconciliation-source-0001",
      promptText: "Continue the frozen revision.",
    });
    if (failed.ok) throw new Error("post-open source unexpectedly passed");
    await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "post-open-reconciliation-success-0001",
    });

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "post-open-reconciliation-failure-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(203),
    });
  });

  it("retries a failed confirmation provider turn from frozen context and runs AI only once more", async () => {
    const harness = createHarness([
      { providerFailure: true },
      confirmedFormulaOutput(),
    ]);
    const previous = harness.repository.seedDraft(confirmableDraft());

    const failed = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
    });
    if (failed.ok) throw new Error("confirmation failure unexpectedly passed");

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "confirm-provider-retry-0001",
    });

    expect(retried).toMatchObject({ ok: true, kind: "simulated" });
    expect(harness.catalogPort.getCatalog).toHaveBeenCalledTimes(1);
    expect(harness.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("appends a new semantic retry revision after a persisted failed confirmation", async () => {
    const harness = createHarness(
      [{ providerFailure: true }, confirmedFormulaOutput()],
      { persistFailedRevisions: true },
    );
    const previous = harness.repository.seedDraft(confirmableDraft());

    const failed = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(failed).toMatchObject({
      ok: false,
      code: "SETTLEMENT_AI_PROVIDER_FAILED",
      sourceTurnId: uuid(201),
      failedDraft: {
        revisionNumber: 2,
        initialStatus: "failed",
        status: "failed",
      },
    });
    if (failed.ok || !failed.failedDraft) {
      throw new Error("persisted failure fixture unexpectedly passed");
    }

    const retried = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "persisted-confirm-retry-0001",
    });

    expect(retried).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: { revisionNumber: 3, initialStatus: "contract_ready" },
    });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(harness.repository.createDraftCalls[1].idempotencyKey).toMatch(
      /^settlement-retry:/u,
    );
    expect(harness.repository.createDraftCalls[1].idempotencyKey).not.toBe(
      harness.repository.createDraftCalls[0].idempotencyKey,
    );
    const supersededFailure = harness.repository.drafts.find(
      (draft) => draft.id === failed.failedDraft?.id,
    );
    expect(supersededFailure).toMatchObject({
      initialStatus: "failed",
      status: "superseded",
      supersededByDraftId:
        retried.ok && retried.kind === "simulated" ? retried.draft.id : null,
      supersededAt: expect.any(String),
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);

    await expect(
      harness.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: failed.sourceTurnId,
        clientRequestId: "persisted-confirm-retry-conflict",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    expect(harness.repository.createDraftCalls).toHaveLength(2);
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
  });

  it("fails closed when the public conversation API fails and never falls back to local draft history", async () => {
    const harness = createHarness([
      clarificationOutput("请确认每小时结算单价？", "confirm_rate"),
    ]);
    const previous = harness.repository.seedDraft(clarifyingDraft());
    vi.mocked(harness.conversation.getHistory).mockRejectedValueOnce(
      new Error("conversation unavailable"),
    );

    await expect(
      harness.service.answerOrRevise({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        expectedDraftId: previous.id,
        expectedRevisionNumber: 1,
        clientRequestId: "conversation-failure-0001",
        promptText: "继续。",
      }),
    ).rejects.toMatchObject({
      name: "CustomRuleAuthoringServiceError",
      code: "conversation_failed",
    });
    expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
    expect(harness.repository.createDraftCalls).toHaveLength(0);
  });

  it("best-effort fails every accepted turn when setup or frozen restore fails", async () => {
    const startInput = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "accepted-setup-failure-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };
    for (const failure of [
      "prepare_turn",
      "ai_prepare",
      "capture",
      "mark_generating",
      "mark_validating",
    ] as const) {
      const harness = createHarness(
        [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
        { acceptedSetupFailure: failure },
      );
      await expect(
        harness.service.startSession({
          ...startInput,
          clientRequestId: `accepted-${failure}-0001`,
        }),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        sourceTurnId: uuid(201),
      });
      expect(harness.conversation.failTurn).toHaveBeenCalledWith(
        actor,
        uuid(201),
        expect.objectContaining({
          errorCode: "settlement_turn_setup_failed",
          retryable: true,
        }),
      );
      expect(
        JSON.stringify(vi.mocked(harness.conversation.failTurn).mock.calls),
      ).not.toContain("raw-secret-provider-body");
      expect(harness.repository.createDraftCalls).toHaveLength(0);
    }

    const reconciliation = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { acceptedSetupFailure: "capture", failFailTurn: true },
    );
    await expect(
      reconciliation.service.startSession({
        ...startInput,
        clientRequestId: "accepted-reconciliation-failure-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });

    const restore = createHarness([{ providerFailure: true }], {
      acceptedSetupFailure: "ai_restore",
    });
    const previous = restore.repository.seedDraft(clarifyingDraft());
    const providerFailure = await restore.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "restore-source-failure-0001",
      promptText: "Continue the settlement draft.",
    });
    if (providerFailure.ok)
      throw new Error("restore source unexpectedly passed");
    await expect(
      restore.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: providerFailure.sourceTurnId,
        clientRequestId: "restore-compensation-retry-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      sourceTurnId: uuid(202),
    });
    expect(restore.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({ errorCode: "settlement_retry_setup_failed" }),
    );

    const mismatch = createHarness([{ providerFailure: true }], {
      retryConversationMismatch: true,
    });
    const mismatchPrevious = mismatch.repository.seedDraft(clarifyingDraft());
    const mismatchSource = await mismatch.service.answerOrRevise({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: mismatchPrevious.id,
      expectedRevisionNumber: 1,
      clientRequestId: "retry-scope-source-0001",
      promptText: "Continue the settlement draft.",
    });
    if (mismatchSource.ok)
      throw new Error("retry scope source unexpectedly passed");
    await expect(
      mismatch.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: mismatchSource.sourceTurnId,
        clientRequestId: "retry-scope-mismatch-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      sourceTurnId: uuid(202),
    });
    expect(mismatch.conversation.prepareTurn).toHaveBeenCalledTimes(1);
    expect(mismatch.conversation.failTurn).toHaveBeenLastCalledWith(
      actor,
      uuid(202),
      expect.objectContaining({ errorCode: "settlement_retry_setup_failed" }),
    );
  });

  it("never terminates an active turn returned as a concurrent duplicate", async () => {
    const gatewayControl: { release?: () => void } = {};
    const gatewayGate = new Promise<void>((resolve) => {
      gatewayControl.release = resolve;
    });
    const duplicateStart = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      { gatewayGate },
    );
    const input = {
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "concurrent-duplicate-start-0001",
      promptText: "Start a duplicate settlement request.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    };
    const owner = duplicateStart.service.startSession(input);
    await vi.waitFor(() => {
      expect(duplicateStart.conversation.markGenerating).toHaveBeenCalledTimes(
        1,
      );
    });
    const prepareCallsBeforeDuplicate = vi.mocked(
      duplicateStart.conversation.prepareTurn,
    ).mock.calls.length;
    await expect(
      duplicateStart.service.startSession(input),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      retryable: true,
      sourceTurnId: uuid(201),
    });
    expect(duplicateStart.conversation.prepareTurn).toHaveBeenCalledTimes(
      prepareCallsBeforeDuplicate,
    );
    expect(duplicateStart.conversation.failTurn).not.toHaveBeenCalled();
    expect(duplicateStart.repository.finalizeDraftTurnCalls).toHaveLength(0);
    const releaseGateway = gatewayControl.release;
    if (!releaseGateway) throw new Error("gateway release was not initialized");
    releaseGateway();
    await expect(owner).resolves.toMatchObject({
      ok: true,
      kind: "clarifying",
    });
    expect(duplicateStart.repository.finalizeDraftTurnCalls).toHaveLength(1);

    const duplicateRetry = createHarness([], {
      retryTurnDuplicate: true,
      retryTurnStatus: "generating",
    });
    const pending = await duplicateRetry.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: uuid(210),
      clientRequestId: "concurrent-duplicate-retry-0001",
    });
    expect(pending).toMatchObject({
      ok: true,
      kind: "retry_in_progress",
      turn: { status: "generating", duplicate: true },
    });
    expect(duplicateRetry.conversation.prepareTurn).not.toHaveBeenCalled();
    expect(duplicateRetry.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("branches on history-backed retry status before preparing accepted context", async () => {
    for (const status of ["grounding", "generating", "validating"] as const) {
      const active = createHarness([], {
        retryTurnStatus: status,
        retryTurnDuplicate: true,
      });
      const result = await active.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: `active-${status}-retry-0001`,
      });
      expect(result).toMatchObject({
        ok: true,
        kind: "retry_in_progress",
        turn: { status, duplicate: true, attempt: 2 },
      });
      expect(active.conversation.prepareTurn).not.toHaveBeenCalled();
    }

    const completedIdempotencyKey = "completed-retry-draft-key-0001";
    const completedContent = "Exact completed retry assistant content.";
    const completed = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
      retryTerminalCompletion: {
        providerName: "deterministic",
        content: completedContent,
        aiInvocationId: null,
        metadata: {
          contextSnapshotVersion: 7,
          contextSummaryVersion: 3,
          contextMessageIds: [uuid(301)],
          settlementIdempotencyKey: completedIdempotencyKey,
          settlementInitialStatus: "clarifying",
        },
      },
    });
    const completedDraft = completed.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completedIdempotencyKey,
        aiResponseContent: completedContent,
        turnTrace: {
          turnId: uuid(201),
          userMessageId: uuid(301),
          assistantMessageId: uuid(401),
        },
      }),
    );
    const readback = await completed.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: completedDraft.turnTrace.turnId,
      clientRequestId: "completed-retry-readback-0001",
    });
    expect(readback).toMatchObject({
      ok: true,
      kind: "retry_readback",
      draft: { id: completedDraft.id },
      turn: { status: "completed", duplicate: true, attempt: 2 },
    });
    expect(completed.conversation.prepareTurn).not.toHaveBeenCalled();

    const retryableFailure = createHarness([], {
      retryTurnStatus: "failed",
      retryTurnDuplicate: true,
      retryTurnRetryable: true,
    });
    const failed = await retryableFailure.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: uuid(210),
      clientRequestId: "failed-retry-readback-0001",
    });
    expect(failed).toMatchObject({
      ok: false,
      kind: "retry_failed",
      code: "conversation_failed",
      retryable: true,
      turn: { status: "failed", duplicate: true, attempt: 2 },
    });
    expect(retryableFailure.conversation.prepareTurn).not.toHaveBeenCalled();

    const conflict = createHarness([], {
      retryTurnStatus: "failed",
      retryTurnDuplicate: true,
      retryTurnRetryable: false,
    });
    await expect(
      conflict.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "failed-retry-conflict-0001",
      }),
    ).rejects.toMatchObject({
      code: "conversation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(conflict.conversation.prepareTurn).not.toHaveBeenCalled();
  });

  it("fails closed on pending assistants and source-bound drafts during completed retry readback", async () => {
    const completionIdempotencyKey = "completed-retry-key-0002";
    const completionContent = "Completed retry content.";
    const completion: SettlementAiTurnCompletionInput = {
      providerName: "deterministic",
      content: completionContent,
      aiInvocationId: null,
      metadata: {
        contextSnapshotVersion: 7,
        contextSummaryVersion: 3,
        contextMessageIds: [uuid(301)],
        settlementIdempotencyKey: completionIdempotencyKey,
        settlementInitialStatus: "clarifying",
      },
    };
    const pending = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
    });
    pending.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completionIdempotencyKey,
        aiResponseContent: completionContent,
        turnTrace: {
          turnId: uuid(201),
          userMessageId: uuid(301),
          assistantMessageId: uuid(401),
        },
      }),
    );
    await expect(
      pending.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "completed-pending-assistant-0001",
      }),
    ).rejects.toMatchObject({ code: "conversation_failed", retryable: false });
    expect(pending.conversation.failTurn).not.toHaveBeenCalled();

    const sourceBound = createHarness([], {
      retryTurnStatus: "completed",
      retryTurnDuplicate: true,
      retryTerminalCompletion: completion,
    });
    sourceBound.repository.seedDraft(
      clarifyingDraft({
        idempotencyKey: completionIdempotencyKey,
        aiResponseContent: completionContent,
      }),
    );
    await expect(
      sourceBound.service.retryTurn({
        actor,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        sourceTurnId: uuid(210),
        clientRequestId: "completed-source-bound-draft-0001",
      }),
    ).rejects.toMatchObject({ code: "conversation_failed", retryable: false });
    expect(sourceBound.conversation.failTurn).not.toHaveBeenCalled();

    for (const tamper of ["content", "metadata"] as const) {
      const expectedKey = `completed-retry-${tamper}-key-0001`;
      const expectedContent = `Expected ${tamper} retry content.`;
      const terminalCompletion: SettlementAiTurnCompletionInput = {
        providerName: "deterministic",
        content:
          tamper === "content" ? "Tampered retry content." : expectedContent,
        aiInvocationId: null,
        metadata: {
          contextSnapshotVersion: 7,
          contextSummaryVersion: 3,
          contextMessageIds: [uuid(301)],
          settlementIdempotencyKey:
            tamper === "metadata" ? "wrong-retry-key-0001" : expectedKey,
          settlementInitialStatus: "clarifying",
        },
      };
      const harness = createHarness([], {
        retryTurnStatus: "completed",
        retryTurnDuplicate: true,
        retryTerminalCompletion: terminalCompletion,
      });
      harness.repository.seedDraft(
        clarifyingDraft({
          idempotencyKey: expectedKey,
          aiResponseContent: expectedContent,
          turnTrace: {
            turnId: uuid(201),
            userMessageId: uuid(301),
            assistantMessageId: uuid(401),
          },
        }),
      );
      await expect(
        harness.service.retryTurn({
          actor,
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          sourceTurnId: uuid(210),
          clientRequestId: `completed-${tamper}-mismatch-0001`,
        }),
      ).rejects.toMatchObject({
        code: "conversation_failed",
        retryable: false,
      });
      expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    }
  });

  it("atomically finalizes a validated contract, simulation, and generic turn", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const previous = harness.repository.seedDraft(confirmableDraft());

    const result = await harness.service.confirmContract({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      expectedDraftId: previous.id,
      expectedRevisionNumber: 1,
      clientRequestId: "confirm-request-0001",
      promptText: "我确认以上业务规则。",
      contractConfirmed: true,
      expectedContractHash: previous.contractHash,
      expectedCatalogVersion: CATALOG_VERSION,
      simulationSelection: safeSelection(),
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: {
        revisionNumber: 2,
        initialStatus: "contract_ready",
        status: "simulated",
        unresolvedAmbiguities: [],
        generatedFormula: {
          expression: "payable = money_result({ final: yuan(20) })",
        },
        generatedExplanation: expect.stringContaining("结算公式按组件顺序输出"),
        generatedTestCases: [{ name: "确认后的标准场景" }],
        formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      simulation: {
        owner: { kind: "ai_draft" },
        formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      summary: {
        recordCount: 1,
        totalOldCents: "1600",
        totalNewCents: "2000",
        totalDeltaCents: "400",
      },
    });
    const readyInput = harness.repository.createDraftCalls[0];
    expect(readyInput).toMatchObject({
      status: "contract_ready",
      unresolvedAmbiguities: [],
      generatedFormula: {
        expression: "payable = money_result({ final: yuan(20) })",
      },
      generatedExplanation: expect.stringContaining("金额以元显示"),
      generatedTestCases: [{ name: "确认后的标准场景" }],
      formulaHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(harness.repository.insertSimulationCalls[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      owner: { kind: "ai_draft", id: expect.any(String) },
      formulaHash: readyInput.formulaHash,
      ruleContractHash: readyInput.contractHash,
      parameterHash: readyInput.parameterHash,
      variableCatalogVersion: CATALOG_VERSION,
    });
    expect(harness.repository.finalizeSimulationTurnCalls[0]).toMatchObject({
      draft: readyInput,
      completion: { content: readyInput.aiResponse.content },
      simulation: {
        idempotencyKey: expect.stringMatching(/^settlement-simulation:/),
        dataSelectionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expectOrdered(harness.events, [
      "conversation.acceptTurn",
      "conversation.prepareTurn",
      "conversation.captureGatewayContext",
      "conversation.markGenerating",
      "conversation.markValidating",
      "repository.finalizeSimulationTurn",
    ]);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(harness.conversation.getHistory).toHaveBeenCalledWith(
      actor,
      CONVERSATION_ID,
    );
    expect(harness.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledWith({
      actor,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      selection: safeSelection(),
    });
    expect(harness.simulationInputs).toHaveLength(1);
    expect(Object.isFrozen(harness.simulationInputs[0].records)).toBe(true);
    expect(harness.simulationInputs[0].provenance).toMatchObject({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      actorId: USER_ID,
      selectionToken: "selection-token-0001",
    });
  });

  it("returns an idempotent simulated success for the same durable confirmation key", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const previous = harness.repository.seedDraft(confirmableDraft());
    const confirmation = confirmInput(previous);

    const first = await harness.service.confirmContract(confirmation);
    const replay = await harness.service.confirmContract(confirmation);

    expect(first).toMatchObject({ ok: true, kind: "simulated" });
    expect(replay).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(harness.repository.listSimulationCalls).toHaveLength(1);
    expect(harness.conversation.retryTurn).not.toHaveBeenCalled();
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
  });

  it("rejects invalid, stale, unresolved, and duplicate confirmation transitions before persistence", async () => {
    const falseConfirmation = createHarness([confirmedFormulaOutput()]);
    const falseDraft =
      falseConfirmation.repository.seedDraft(confirmableDraft());
    await expect(
      falseConfirmation.service.confirmContract({
        ...confirmInput(falseDraft),
        contractConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });

    const stale = createHarness([confirmedFormulaOutput()]);
    const staleDraft = stale.repository.seedDraft(confirmableDraft());
    await expect(
      stale.service.confirmContract({
        ...confirmInput(staleDraft),
        expectedRevisionNumber: 2,
      }),
    ).rejects.toMatchObject({ code: "stale_revision" });

    const unresolved = createHarness([confirmedFormulaOutput()]);
    const unresolvedDraft = unresolved.repository.seedDraft(
      clarifyingDraft({
        unresolvedAmbiguities: [
          {
            code: "confirm_rate",
            question: "请确认每小时结算单价？",
            required: true,
          },
        ],
      }),
    );
    await expect(
      unresolved.service.confirmContract(confirmInput(unresolvedDraft)),
    ).rejects.toMatchObject({ code: "unresolved_ambiguities" });

    const optional = createHarness([confirmedFormulaOutput()]);
    const optionalDraft = optional.repository.seedDraft(
      clarifyingDraft({
        unresolvedAmbiguities: [
          {
            code: "optional_rounding_note",
            question: "Confirm the optional rounding note?",
            required: false,
          },
        ],
      }),
    );
    await expect(
      optional.service.confirmContract(confirmInput(optionalDraft)),
    ).rejects.toMatchObject({ code: "unresolved_ambiguities" });

    const duplicate = createHarness([confirmedFormulaOutput()]);
    const duplicateDraft = duplicate.repository.seedDraft(simulatedDraft());
    await expect(
      duplicate.service.confirmContract(confirmInput(duplicateDraft)),
    ).rejects.toMatchObject({ code: "duplicate_confirmation" });

    for (const harness of [
      falseConfirmation,
      stale,
      unresolved,
      optional,
      duplicate,
    ]) {
      expect(harness.repository.createDraftCalls).toHaveLength(0);
      expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
    }
  });

  it("rejects formula, catalog, and selection hash mismatches without completing the generic turn", async () => {
    const formula = createHarness([confirmedFormulaOutput()]);
    const formulaDraft = formula.repository.seedDraft(confirmableDraft());
    await expect(
      formula.service.confirmContract({
        ...confirmInput(formulaDraft),
        expectedFormulaHash: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "formula_hash_mismatch" });
    expect(formula.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(formula.conversation.completeTurn).not.toHaveBeenCalled();
    expect(formula.repository.createDraftCalls).toHaveLength(0);

    const catalog = createHarness([confirmedFormulaOutput()]);
    const catalogDraft = catalog.repository.seedDraft(confirmableDraft());
    await expect(
      catalog.service.confirmContract({
        ...confirmInput(catalogDraft),
        expectedCatalogVersion: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "catalog_hash_mismatch" });
    expect(catalog.conversation.acceptTurn).not.toHaveBeenCalled();

    const evidence = createHarness([confirmedFormulaOutput()]);
    const evidenceDraft = evidence.repository.seedDraft(confirmableDraft());
    await expect(
      evidence.service.confirmContract({
        ...confirmInput(evidenceDraft),
        expectedEvidenceHash: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "evidence_hash_mismatch" });
    expect(evidence.evidencePort.loadAuthorizedEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(evidence.simulationInputs).toHaveLength(0);

    const selection = createHarness([confirmedFormulaOutput()]);
    const selectionDraft = selection.repository.seedDraft(confirmableDraft());
    await expect(
      selection.service.confirmContract({
        ...confirmInput(selectionDraft),
        expectedDataSelectionHash: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "selection_hash_mismatch" });
    expect(selection.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(selection.repository.createDraftCalls).toHaveLength(0);
    expect(selection.simulationInputs).toHaveLength(1);
  });

  it("changes evidence, final selection, and simulation idempotency hashes when authorized margin changes", async () => {
    const high = createHarness([confirmedFormulaOutput()], {
      currentMarginCents: "2000",
    });
    const low = createHarness([confirmedFormulaOutput()], {
      currentMarginCents: "500",
    });
    const highDraft = high.repository.seedDraft(confirmableDraft());
    const lowDraft = low.repository.seedDraft(confirmableDraft());

    const highResult = await high.service.confirmContract(
      confirmInput(highDraft),
    );
    const lowResult = await low.service.confirmContract(confirmInput(lowDraft));
    if (
      !highResult.ok ||
      highResult.kind !== "simulated" ||
      !lowResult.ok ||
      lowResult.kind !== "simulated"
    ) {
      throw new Error("margin hash fixtures must simulate successfully");
    }

    expect(high.simulationInputs[0].provenance.evidenceHash).not.toBe(
      low.simulationInputs[0].provenance.evidenceHash,
    );
    expect(highResult.summary.dataSelectionHash).not.toBe(
      lowResult.summary.dataSelectionHash,
    );
    expect(high.repository.insertSimulationCalls[0].idempotencyKey).not.toBe(
      low.repository.insertSimulationCalls[0].idempotencyKey,
    );
  });

  it("rejects unsafe free-form selection criteria before the evidence port is called", async () => {
    const harness = createHarness([confirmedFormulaOutput()]);
    const draft = harness.repository.seedDraft(confirmableDraft());
    const unsafe = {
      ...confirmInput(draft),
      simulationSelection: {
        ...safeSelection(),
        criteria: ["streamerId=private-1 amountCents=10000"],
      },
    };

    await expect(
      Reflect.apply(harness.service.confirmContract, undefined, [unsafe]),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(harness.evidencePort.loadAuthorizedEvidence).not.toHaveBeenCalled();
    expect(harness.conversation.acceptTurn).not.toHaveBeenCalled();
  });

  it("fails closed on authorized evidence scope, token, or provenance hash mismatch", async () => {
    for (const evidenceFailure of [
      "scope",
      "selection_token",
      "hash",
    ] as const) {
      const harness = createHarness([confirmedFormulaOutput()], {
        evidenceFailure,
      });
      const draft = harness.repository.seedDraft(confirmableDraft());

      await expect(
        harness.service.confirmContract(confirmInput(draft)),
      ).rejects.toMatchObject({ code: "simulation_failed" });
      expect(harness.simulationInputs).toHaveLength(0);
      expect(harness.repository.createDraftCalls).toHaveLength(0);
      expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
    }
  });

  it("blocks confirmation when an AI expected result disagrees with deterministic execution", async () => {
    const output = confirmedFormulaOutput();
    output.testCases[0].expectedResult.amountCents = 99_999;
    const harness = createHarness([output]);
    const draft = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(draft)),
    ).rejects.toMatchObject({ code: "simulation_failed" });
    expect(harness.repository.createDraftCalls).toHaveLength(0);
    expect(harness.repository.insertSimulationCalls).toHaveLength(0);
    expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
  });

  it("atomically persists a failed revision for a deterministic domain failure", async () => {
    const output = confirmedFormulaOutput();
    output.testCases[0].expectedResult.amountCents = 99_999;
    const harness = createHarness([output], {
      persistFailedRevisions: true,
    });
    const draft = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(draft)),
    ).rejects.toMatchObject({ code: "simulation_failed" });

    expect(harness.repository.finalizeFailedTurnCalls).toHaveLength(1);
    expect(harness.repository.finalizeFailedTurnCalls[0]).toMatchObject({
      draft: {
        status: "failed",
        generatedFormula: null,
        generatedExplanation: null,
        generatedTestCases: [],
        formulaHash: null,
      },
      completion: {
        content:
          "deterministic scenario assertions or risk checks blocked confirmation",
      },
      errorCode: "simulation_failed",
      errorSummary: SETTLEMENT_AI_FAILED_TURN_ERROR_SUMMARIES.simulation_failed,
      retryable: false,
    });
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(0);
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    const domainFailureHistory = await harness.conversation.getHistory(
      actor,
      CONVERSATION_ID,
    );
    expect(
      domainFailureHistory.turns.find((turn) => turn.id === uuid(201)),
    ).toMatchObject({
      status: "failed",
      errorCode: "simulation_failed",
      retryable: false,
    });
  });

  it("retries a rollback-like atomic simulation failure with the same keys", async () => {
    const harness = createHarness(
      [confirmedFormulaOutput(), confirmedFormulaOutput()],
      {
        atomicSimulationFailure: "before_write",
      },
    );
    const previous = harness.repository.seedDraft(confirmableDraft());
    const confirmation = confirmInput(previous);

    const failed = await harness.service.confirmContract(confirmation);
    expect(failed).toMatchObject({
      ok: false,
      code: "persistence_failed",
      retryable: true,
      sourceTurnId: uuid(201),
      failedDraft: null,
    });
    if (failed.ok)
      throw new Error("atomic simulation rollback unexpectedly passed");
    expect(harness.repository.drafts).toHaveLength(1);
    expect(harness.repository.simulations).toHaveLength(0);
    expect(harness.repository.atomicFailureSnapshots).toEqual([
      {
        kind: "simulation",
        draftCount: 1,
        simulationCount: 0,
        turnStatus: "validating",
      },
    ]);
    expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();

    const recovered = await harness.service.retryTurn({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      sourceTurnId: failed.sourceTurnId,
      clientRequestId: "atomic-simulation-retry-0001",
    });
    expect(recovered).toMatchObject({
      ok: true,
      kind: "simulated",
      draft: { initialStatus: "contract_ready", status: "simulated" },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(2);
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(2);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(
      harness.repository.finalizeSimulationTurnCalls[0].draft.idempotencyKey,
    ).toBe(
      harness.repository.finalizeSimulationTurnCalls[1].draft.idempotencyKey,
    );
    expect(
      harness.repository.finalizeSimulationTurnCalls[0].simulation
        .idempotencyKey,
    ).toBe(
      harness.repository.finalizeSimulationTurnCalls[1].simulation
        .idempotencyKey,
    );

    const nonrecoverable = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "before_write",
      failFailTurn: true,
    });
    const nonrecoverableDraft =
      nonrecoverable.repository.seedDraft(confirmableDraft());
    await expect(
      nonrecoverable.service.confirmContract(confirmInput(nonrecoverableDraft)),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
  });

  it("reads back a completed atomic simulation when the RPC response is lost", async () => {
    const harness = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "after_commit",
    });
    const previous = harness.repository.seedDraft(confirmableDraft());

    const result = await harness.service.confirmContract(
      confirmInput(previous),
    );
    expect(result).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
      draft: { status: "simulated" },
    });
    expect(
      harness.events.filter((event) => event === "gateway.execute"),
    ).toHaveLength(1);
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(
      harness.repository.listSimulationCalls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("boundedly re-reads transient mixed atomic snapshots before reconciling", async () => {
    const draftLag = createHarness(
      [clarificationOutput("Confirm the hourly rate?", "confirm_rate")],
      {
        atomicDraftFailure: "after_commit",
        transientDraftReadbackMisses: 1,
      },
    );
    const draftResult = await draftLag.service.startSession({
      actor,
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      clientRequestId: "transient-draft-readback-0001",
      promptText: "Start a settlement draft.",
      seedContract: contract(),
      initialAmbiguities: [
        {
          code: "confirm_rate",
          question: "Confirm the hourly rate?",
          required: true,
        },
      ],
    });
    expect(draftResult).toMatchObject({
      ok: true,
      kind: "clarifying",
      duplicate: true,
    });
    expect(
      draftLag.events.filter((event) => event === "repository.listDrafts")
        .length,
    ).toBeGreaterThanOrEqual(3);

    const simulationLag = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "after_commit",
      transientSimulationReadbackMisses: 1,
    });
    const previous = simulationLag.repository.seedDraft(confirmableDraft());
    const simulationResult = await simulationLag.service.confirmContract(
      confirmInput(previous),
    );
    expect(simulationResult).toMatchObject({
      ok: true,
      kind: "simulated",
      duplicate: true,
    });
    expect(
      simulationLag.repository.listSimulationCalls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(simulationLag.conversation.failTurn).not.toHaveBeenCalled();
  });

  it("fails closed on an impossible partial atomic simulation state", async () => {
    const harness = createHarness([confirmedFormulaOutput()], {
      atomicSimulationFailure: "partial",
    });
    const previous = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(previous)),
    ).rejects.toMatchObject({
      code: "conversation_reconciliation_failed",
      retryable: false,
      sourceTurnId: uuid(201),
    });
    expect(harness.repository.finalizeSimulationTurnCalls).toHaveLength(1);
    expect(harness.repository.drafts).toHaveLength(2);
    expect(harness.repository.simulations).toHaveLength(0);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).not.toHaveBeenCalled();
  });
});

type ProviderOutput = Record<string, unknown> | { providerFailure: true };

function createHarness(
  outputs: ProviderOutput[],
  options: {
    persistFailedRevisions?: boolean;
    atomicDraftFailure?: "before_write" | "after_commit" | "partial";
    tamperAtomicDraftAfterCommit?: "content" | "hash";
    atomicSimulationFailure?: "before_write" | "after_commit" | "partial";
    atomicFailedFailure?: "before_write" | "after_commit" | "partial";
    transientDraftReadbackMisses?: number;
    transientSimulationReadbackMisses?: number;
    evidenceFailure?: "scope" | "hash" | "selection_token";
    currentMarginCents?: string;
    failFailTurn?: boolean;
    acceptedSetupFailure?:
      | "prepare_turn"
      | "ai_prepare"
      | "capture"
      | "mark_generating"
      | "mark_validating"
      | "ai_restore";
    retryTurnStatus?:
      | "accepted"
      | "grounding"
      | "generating"
      | "validating"
      | "completed"
      | "failed"
      | "cancelled";
    retryReturnedStatus?: AiConversationTurnDto["status"];
    retryTurnDuplicate?: boolean;
    retryTurnRetryable?: boolean;
    retryTerminalCompletion?: SettlementAiTurnCompletionInput;
    gatewayGate?: Promise<void>;
    retryConversationMismatch?: boolean;
  } = {},
) {
  const events: string[] = [];
  let acceptedContent = "";
  let turnNumber = 0;
  const capturedSnapshots = new Map<
    string,
    Awaited<ReturnType<SettlementConversationPort["captureGatewayContext"]>>
  >();
  const retrySources = new Map<string, string>();
  const acceptedRequests = new Map<
    string,
    Awaited<ReturnType<SettlementConversationPort["acceptTurn"]>>
  >();
  const turns = new Map<string, AiConversationTurnDto>();
  const messages = new Map<string, AiConversationMessageDto>();
  const registerTurn = (input: {
    turnId: string;
    userMessageId: string;
    assistantMessageId: string;
    status: AiConversationTurnDto["status"];
    attempt: number;
    retryOfTurnId: string | null;
    retryable?: boolean;
    userContent?: string;
  }) => {
    turns.set(input.turnId, {
      id: input.turnId,
      conversationId: CONVERSATION_ID,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      mode: "fast",
      status: input.status,
      attempt: input.attempt,
      retryOfTurnId: input.retryOfTurnId,
      regenerateOfTurnId: null,
      errorCode: null,
      retryable: input.retryable ?? false,
    });
    messages.set(input.userMessageId, {
      id: input.userMessageId,
      conversationId: CONVERSATION_ID,
      sequence: turnNumber * 2 - 1,
      role: "user",
      status: "completed",
      content: input.userContent ?? "Retry requested.",
      parentMessageId: null,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
    messages.set(input.assistantMessageId, {
      id: input.assistantMessageId,
      conversationId: CONVERSATION_ID,
      sequence: turnNumber * 2,
      role: "assistant",
      status: "pending",
      content: "",
      parentMessageId: input.userMessageId,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    });
  };
  const transitionTurn = (
    turnId: string,
    status: AiConversationTurnDto["status"],
    completion?: SettlementAiTurnCompletionInput,
    failure?: { errorCode: string; retryable: boolean },
  ) => {
    const turn = turns.get(turnId);
    if (!turn) throw new Error("atomic fixture turn is missing");
    turns.set(turnId, {
      ...turn,
      status,
      errorCode:
        status === "failed"
          ? (failure?.errorCode ?? "conversation_failed")
          : null,
      retryable: status === "failed" && (failure?.retryable ?? false),
    });
    if (completion) {
      const assistant = messages.get(turn.assistantMessageId);
      if (!assistant) throw new Error("atomic fixture assistant is missing");
      messages.set(turn.assistantMessageId, {
        ...assistant,
        status: status === "failed" ? "failed" : "completed",
        content: completion.content,
        metadata: structuredClone(completion.metadata),
        updatedAt: "2026-07-12T00:00:01.000Z",
      });
    }
  };
  const conversation: SettlementConversationPort = {
    createConversation: vi.fn(async () => {
      events.push("conversation.createConversation");
      return {
        id: CONVERSATION_ID,
        title: "AI 结算规则",
        status: "active" as const,
        lastMessageAt: "2026-07-12T00:00:00.000Z",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      };
    }),
    getHistory: vi.fn(async () => {
      events.push("conversation.getHistory");
      return {
        conversation: {
          id: CONVERSATION_ID,
          title: "AI 结算规则",
          status: "active" as const,
          lastMessageAt: "2026-07-12T00:00:00.000Z",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        messages: [...messages.values()].map((message) =>
          structuredClone(message),
        ),
        turns: [...turns.values()].map((turn) => structuredClone(turn)),
      };
    }),
    acceptTurn: vi.fn(async (_actor, _conversationId, command) => {
      events.push("conversation.acceptTurn");
      const existing = acceptedRequests.get(command.clientRequestId);
      if (existing) {
        const duplicate: Awaited<
          ReturnType<SettlementConversationPort["acceptTurn"]>
        > = { ...existing, status: "accepted", duplicate: true };
        return duplicate;
      }
      acceptedContent = command.content;
      turnNumber += 1;
      const result = {
        conversationId: CONVERSATION_ID,
        turnId: uuid(200 + turnNumber),
        userMessageId: uuid(300 + turnNumber),
        assistantMessageId: uuid(400 + turnNumber),
        status: "accepted" as const,
        attempt: 1,
        duplicate: false,
      };
      registerTurn({
        turnId: result.turnId,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        status: result.status,
        attempt: result.attempt,
        retryOfTurnId: null,
        userContent: command.content,
      });
      acceptedRequests.set(command.clientRequestId, result);
      return result;
    }),
    retryTurn: vi.fn(async (_actor, sourceTurnId, command) => {
      events.push("conversation.retryTurn");
      void command;
      turnNumber += 1;
      const turnId = uuid(200 + turnNumber);
      retrySources.set(turnId, sourceTurnId);
      const result = {
        conversationId: options.retryConversationMismatch
          ? uuid(999)
          : CONVERSATION_ID,
        turnId,
        userMessageId: uuid(300 + turnNumber),
        assistantMessageId: uuid(400 + turnNumber),
        status: options.retryReturnedStatus ?? "accepted",
        attempt: 2,
        duplicate: options.retryTurnDuplicate ?? false,
      };
      registerTurn({
        turnId: result.turnId,
        userMessageId: result.userMessageId,
        assistantMessageId: result.assistantMessageId,
        status: options.retryTurnStatus ?? result.status,
        attempt: result.attempt,
        retryOfTurnId: sourceTurnId,
        retryable: options.retryTurnRetryable,
      });
      if (
        (options.retryTurnStatus ?? result.status) === "completed" &&
        options.retryTerminalCompletion
      ) {
        transitionTurn(turnId, "completed", options.retryTerminalCompletion);
      }
      return result;
    }),
    prepareTurn: vi.fn(async (_actor, turnId) => {
      events.push("conversation.prepareTurn");
      if (options.acceptedSetupFailure === "prepare_turn") {
        throw new Error("raw-secret-provider-body");
      }
      const sourceTurnId = retrySources.get(turnId);
      if (sourceTurnId) {
        const frozen = capturedSnapshots.get(sourceTurnId);
        if (!frozen?.gatewayContext) {
          throw new Error("retry source has no frozen gateway context");
        }
        transitionTurn(turnId, "grounding");
        return {
          messages: frozen.gatewayContext.messages,
          snapshot: structuredClone(frozen),
        };
      }
      transitionTurn(turnId, "grounding");
      return {
        messages: [{ role: "user" as const, content: acceptedContent }],
        snapshot: {
          version: 7,
          summaryVersion: 3,
          messageIds: [uuid(300 + turnNumber)],
          groundingRefs: [],
          assembledAt: "2026-07-12T00:00:00.000Z",
        },
      };
    }),
    captureGatewayContext: vi.fn(
      async (_actor, turnId, snapshot, gatewayContext) => {
        void _actor;
        events.push("conversation.captureGatewayContext");
        if (options.acceptedSetupFailure === "capture") {
          throw new Error("raw-secret-provider-body");
        }
        const captured = { ...snapshot, gatewayContext };
        capturedSnapshots.set(turnId, structuredClone(captured));
        return captured;
      },
    ),
    markGenerating: vi.fn(async (_actor, turnId) => {
      events.push("conversation.markGenerating");
      if (options.acceptedSetupFailure === "mark_generating") {
        throw new Error("raw-secret-provider-body");
      }
      transitionTurn(turnId, "generating");
    }),
    markValidating: vi.fn(async (_actor, turnId) => {
      events.push("conversation.markValidating");
      if (options.acceptedSetupFailure === "mark_validating") {
        throw new Error("raw-secret-provider-body");
      }
      transitionTurn(turnId, "validating");
    }),
    completeTurn: vi.fn(async (_actor, turnId, input) => {
      events.push("conversation.completeTurn");
      transitionTurn(turnId, "completed", {
        providerName: input.providerName ?? "deterministic",
        content: input.content,
        aiInvocationId: input.invocationId ?? null,
        metadata: (input.metadata ??
          {}) as SettlementAiTurnCompletionInput["metadata"],
      });
    }),
    failTurn: vi.fn(async (_actor, turnId, input) => {
      events.push("conversation.failTurn");
      if (options.failFailTurn)
        throw new Error("conversation failure persistence failed");
      transitionTurn(turnId, "failed", undefined, {
        errorCode: input.errorCode,
        retryable: input.retryable,
      });
    }),
  };

  const queue = [...outputs];
  const gateway: SettlementStructuredGateway = async () => {
    events.push("gateway.execute");
    if (options.gatewayGate) await options.gatewayGate;
    const output = queue.shift();
    if (!output || "providerFailure" in output) {
      return gatewayResult(undefined, {
        status: "failed",
        errorSummary: "provider unavailable",
      });
    }
    return gatewayResult(output);
  };
  const repository = new InMemoryAuthoringRepository(
    events,
    options,
    transitionTurn,
  );
  const catalogPort: SettlementVariableCatalogPort = {
    getCatalog: vi.fn(async () => {
      events.push("catalog.getCatalog");
      return catalog();
    }),
  };
  const evidencePort: AuthorizedSimulationEvidencePort = {
    loadAuthorizedEvidence: vi.fn(async (input) => {
      events.push("evidence.loadAuthorizedEvidence");
      const evidence = structuredClone(
        authorizedEvidence(input, options.currentMarginCents ?? "5000"),
      );
      if (options.evidenceFailure === "scope") {
        evidence.provenance.projectId = uuid(999);
      } else if (options.evidenceFailure === "hash") {
        evidence.provenance.evidenceHash = "f".repeat(64);
      } else if (options.evidenceFailure === "selection_token") {
        evidence.provenance.selectionToken = "selection-token-other";
      }
      return deepFreezeFixture(evidence);
    }),
  };
  const simulationInputs: CustomRuleSimulationInput[] = [];
  const adapter = createSettlementRuleAiAdapter({ gateway });
  const service = createCustomRuleAuthoringService({
    conversation,
    ai: {
      prepare(input) {
        if (options.acceptedSetupFailure === "ai_prepare") {
          throw new Error("raw-secret-provider-body");
        }
        return adapter.prepare(input);
      },
      restore(context) {
        if (options.acceptedSetupFailure === "ai_restore") {
          throw new Error("raw-secret-provider-body");
        }
        return adapter.restore(context);
      },
      execute: adapter.execute,
    },
    repository,
    catalog: catalogPort,
    evidence: evidencePort,
    analyzeReadiness: analyzeCustomRuleDataReadiness,
    simulate: (input) => {
      simulationInputs.push(input);
      return simulateCustomSettlementRule(input);
    },
    primaryProvider: "deterministic",
    persistFailedRevisions: options.persistFailedRevisions ?? false,
  });
  return {
    service,
    conversation,
    repository,
    catalogPort,
    evidencePort,
    simulationInputs,
    events,
  };
}

class InMemoryAuthoringRepository implements CustomRuleAuthoringRepositoryPort {
  readonly drafts: CustomRuleDraft[] = [];
  readonly simulations: SettlementFormulaSimulation[] = [];
  readonly createDraftCalls: CreateCustomRuleDraftInput[] = [];
  readonly insertSimulationCalls: InsertSettlementFormulaSimulationInput[] = [];
  readonly finalizeDraftTurnCalls: FinalizeSettlementAiDraftTurnInput[] = [];
  readonly finalizeSimulationTurnCalls: FinalizeSettlementAiSimulationTurnInput[] =
    [];
  readonly finalizeFailedTurnCalls: FinalizeSettlementAiFailedTurnInput[] = [];
  readonly atomicFailureSnapshots: Array<{
    kind: "draft" | "simulation" | "failed";
    draftCount: number;
    simulationCount: number;
    turnStatus: AiConversationTurnDto["status"];
  }> = [];
  readonly listSimulationCalls: Parameters<
    CustomRuleRepository["listSimulations"]
  >[0][] = [];
  private atomicDraftFailures = 0;
  private atomicSimulationFailures = 0;
  private atomicFailedFailures = 0;
  private hiddenDraftIdempotencyKey: string | null = null;
  private hiddenSimulationIdempotencyKey: string | null = null;
  private remainingDraftReadbackMisses = 0;
  private remainingSimulationReadbackMisses = 0;

  constructor(
    private readonly events: string[],
    private readonly options: {
      atomicDraftFailure?: "before_write" | "after_commit" | "partial";
      tamperAtomicDraftAfterCommit?: "content" | "hash";
      atomicSimulationFailure?: "before_write" | "after_commit" | "partial";
      atomicFailedFailure?: "before_write" | "after_commit" | "partial";
      transientDraftReadbackMisses?: number;
      transientSimulationReadbackMisses?: number;
      evidenceFailure?: "scope" | "hash" | "selection_token";
      currentMarginCents?: string;
      failFailTurn?: boolean;
      acceptedSetupFailure?:
        | "prepare_turn"
        | "ai_prepare"
        | "capture"
        | "mark_generating"
        | "mark_validating"
        | "ai_restore";
      retryTurnStatus?:
        | "accepted"
        | "grounding"
        | "generating"
        | "validating"
        | "completed"
        | "failed"
        | "cancelled";
      retryReturnedStatus?: AiConversationTurnDto["status"];
      retryTurnDuplicate?: boolean;
      retryTurnRetryable?: boolean;
      retryTerminalCompletion?: SettlementAiTurnCompletionInput;
      gatewayGate?: Promise<void>;
      retryConversationMismatch?: boolean;
    },
    private readonly transitionTurn: (
      turnId: string,
      status: AiConversationTurnDto["status"],
      completion?: SettlementAiTurnCompletionInput,
      failure?: { errorCode: string; retryable: boolean },
    ) => void,
  ) {}

  seedDraft(draft: CustomRuleDraft): CustomRuleDraft {
    const copy = structuredClone(draft);
    this.drafts.push(copy);
    return copy;
  }

  async finalizeDraftTurn(
    input: FinalizeSettlementAiDraftTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    this.events.push("repository.finalizeDraftTurn");
    this.finalizeDraftTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("draft");
    if (failure === "before_write") {
      this.recordAtomicFailure("draft");
      throw new Error("atomic draft transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic draft partial-state fixture");
    }
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "completed",
      input.completion,
    );
    if (this.options.tamperAtomicDraftAfterCommit) {
      const stored = this.drafts.find((draft) => draft.id === created.id);
      if (!stored) throw new Error("atomic draft tamper fixture is missing");
      if (this.options.tamperAtomicDraftAfterCommit === "content") {
        stored.aiResponse.content = "tampered persisted assistant content";
      } else {
        stored.contractHash = "f".repeat(64);
      }
    }
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      throw new Error("atomic draft response lost after commit");
    }
    return created;
  }

  async finalizeSimulationTurn(
    input: FinalizeSettlementAiSimulationTurnInput,
  ): Promise<FinalizedSettlementAiSimulationTurn> {
    this.events.push("repository.finalizeSimulationTurn");
    this.finalizeSimulationTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("simulation");
    if (failure === "before_write") {
      this.recordAtomicFailure("simulation");
      throw new Error("atomic simulation transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic simulation partial-state fixture");
    }
    const simulationInput: InsertSettlementFormulaSimulationInput = {
      organizationId: input.draft.organizationId,
      projectId: input.draft.projectId,
      owner: { kind: "ai_draft", id: created.id },
      formulaHash: input.draft.formulaHash,
      ruleContractHash: input.draft.contractHash,
      parameterHash: input.draft.parameterHash,
      variableCatalogVersion: input.draft.variableCatalogVersion,
      ...input.simulation,
    };
    this.insertSimulationCalls.push(structuredClone(simulationInput));
    const simulation = this.persistSimulation(simulationInput);
    const draft = this.drafts.find((candidate) => candidate.id === created.id);
    if (!draft || draft.initialStatus !== "contract_ready") {
      throw new Error("atomic simulation draft fixture is invalid");
    }
    draft.status = "simulated";
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "completed",
      input.completion,
    );
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      this.hiddenSimulationIdempotencyKey = input.simulation.idempotencyKey;
      this.remainingSimulationReadbackMisses =
        this.options.transientSimulationReadbackMisses ?? 0;
      throw new Error("atomic simulation response lost after commit");
    }
    return {
      draft: { ...structuredClone(draft), duplicate: created.duplicate },
      simulation,
    };
  }

  async finalizeFailedTurn(
    input: FinalizeSettlementAiFailedTurnInput,
  ): Promise<CreatedCustomRuleDraft> {
    this.events.push("repository.finalizeFailedTurn");
    this.finalizeFailedTurnCalls.push(structuredClone(input));
    this.createDraftCalls.push(structuredClone(input.draft));
    const failure = this.takeAtomicFailure("failed");
    if (failure === "before_write") {
      this.recordAtomicFailure("failed");
      throw new Error("atomic failed-turn transport failure before commit");
    }
    const created = this.persistDraft(input.draft);
    if (failure === "partial") {
      throw new Error("atomic failed-turn partial-state fixture");
    }
    this.transitionTurn(
      input.draft.turnTrace.turnId,
      "failed",
      input.completion,
      { errorCode: input.errorCode, retryable: input.retryable },
    );
    if (failure === "after_commit") {
      this.hideCommittedDraftForTransientReadback(input.draft.idempotencyKey);
      throw new Error("atomic failed-turn response lost after commit");
    }
    return created;
  }

  private persistDraft(
    input: CreateCustomRuleDraftInput,
  ): CreatedCustomRuleDraft {
    const duplicate = this.drafts.find(
      (draft) => draft.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) return { ...structuredClone(duplicate), duplicate: true };
    const previous = this.drafts
      .filter((draft) => draft.conversationId === input.conversationId)
      .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
    const revisionNumber = (previous?.revisionNumber ?? 0) + 1;
    const id = uuid(100 + revisionNumber);
    const created = createStoredDraft(input, {
      id,
      revisionNumber,
      createdBy: USER_ID,
      createdAt: "2026-07-12T00:00:00.000Z",
      supersedesDraftId: previous?.id ?? null,
    });
    if (previous) {
      const previousIndex = this.drafts.indexOf(previous);
      this.drafts[previousIndex] = supersedeDraft(previous, id);
    }
    this.drafts.push(created);
    return { ...structuredClone(created), duplicate: false };
  }

  async listDrafts(
    input: Parameters<CustomRuleRepository["listDrafts"]>[0],
  ): Promise<CustomRuleDraft[]> {
    this.events.push("repository.listDrafts");
    const hiddenKey =
      this.remainingDraftReadbackMisses > 0
        ? this.hiddenDraftIdempotencyKey
        : null;
    if (this.remainingDraftReadbackMisses > 0) {
      this.remainingDraftReadbackMisses -= 1;
    }
    return this.drafts
      .filter(
        (draft) =>
          draft.organizationId === input.organizationId &&
          draft.projectId === input.projectId &&
          draft.conversationId === input.conversationId &&
          draft.idempotencyKey !== hiddenKey,
      )
      .sort((left, right) =>
        input.revisionOrder === "asc"
          ? left.revisionNumber - right.revisionNumber
          : right.revisionNumber - left.revisionNumber,
      )
      .slice(0, input.limit ?? 100)
      .map((draft) => structuredClone(draft));
  }

  async getDraft(
    input: Parameters<CustomRuleRepository["getDraft"]>[0],
  ): Promise<CustomRuleDraft | null> {
    this.events.push("repository.getDraft");
    const draft = this.drafts.find(
      (candidate) =>
        candidate.id === input.draftId &&
        candidate.organizationId === input.organizationId &&
        candidate.projectId === input.projectId &&
        candidate.conversationId === input.conversationId,
    );
    return draft ? structuredClone(draft) : null;
  }

  private persistSimulation(
    input: InsertSettlementFormulaSimulationInput,
  ): InsertedSettlementFormulaSimulation {
    const existing = this.simulations.find(
      (simulation) => simulation.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { ...structuredClone(existing), duplicate: true };
    const simulation: SettlementFormulaSimulation = {
      ...structuredClone(input),
      id: uuid(500 + this.simulations.length + 1),
      createdBy: USER_ID,
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    this.simulations.push(simulation);
    if (input.owner.kind === "ai_draft") {
      const draft = this.drafts.find(
        (candidate) => candidate.id === input.owner.id,
      );
      if (draft && draft.status === "contract_ready")
        draft.status = "simulated";
    }
    return { ...structuredClone(simulation), duplicate: false };
  }

  private takeAtomicFailure(
    kind: "draft" | "simulation" | "failed",
  ): "before_write" | "after_commit" | "partial" | undefined {
    if (kind === "draft") {
      if (this.atomicDraftFailures > 0) return undefined;
      this.atomicDraftFailures += 1;
      return this.options.atomicDraftFailure;
    }
    if (kind === "simulation") {
      if (this.atomicSimulationFailures > 0) return undefined;
      this.atomicSimulationFailures += 1;
      return this.options.atomicSimulationFailure;
    }
    if (this.atomicFailedFailures > 0) return undefined;
    this.atomicFailedFailures += 1;
    return this.options.atomicFailedFailure;
  }

  private hideCommittedDraftForTransientReadback(idempotencyKey: string): void {
    this.hiddenDraftIdempotencyKey = idempotencyKey;
    this.remainingDraftReadbackMisses =
      this.options.transientDraftReadbackMisses ?? 0;
  }

  private recordAtomicFailure(kind: "draft" | "simulation" | "failed"): void {
    this.atomicFailureSnapshots.push({
      kind,
      draftCount: this.drafts.length,
      simulationCount: this.simulations.length,
      turnStatus: "validating",
    });
  }

  async listSimulations(
    input: Parameters<CustomRuleRepository["listSimulations"]>[0],
  ): Promise<SettlementFormulaSimulation[]> {
    this.events.push("repository.listSimulations");
    this.listSimulationCalls.push(structuredClone(input));
    const hiddenKey =
      this.remainingSimulationReadbackMisses > 0
        ? this.hiddenSimulationIdempotencyKey
        : null;
    if (this.remainingSimulationReadbackMisses > 0) {
      this.remainingSimulationReadbackMisses -= 1;
    }
    return this.simulations
      .filter(
        (simulation) =>
          simulation.organizationId === input.organizationId &&
          simulation.projectId === input.projectId &&
          simulation.owner.kind === input.owner.kind &&
          simulation.owner.id === input.owner.id &&
          simulation.idempotencyKey !== hiddenKey,
      )
      .slice(0, input.limit ?? 100)
      .map((simulation) => structuredClone(simulation));
  }
}

type StoredDraftMetadata = {
  id: string;
  revisionNumber: number;
  createdBy: string;
  createdAt: string;
  supersedesDraftId: string | null;
};

function createStoredDraft(
  input: CreateCustomRuleDraftInput,
  metadata: StoredDraftMetadata,
): CustomRuleDraft {
  switch (input.status) {
    case "clarifying":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "clarifying",
        status: "clarifying",
        supersededByDraftId: null,
        supersededAt: null,
      };
    case "failed":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "failed",
        status: "failed",
        supersededByDraftId: null,
        supersededAt: null,
      };
    case "contract_ready":
      return {
        ...structuredClone(input),
        ...metadata,
        initialStatus: "contract_ready",
        status: "contract_ready",
        supersededByDraftId: null,
        supersededAt: null,
      };
  }
}

function supersedeDraft(
  draft: CustomRuleDraft,
  supersededByDraftId: string,
): CustomRuleDraft {
  const lifecycle: {
    status: "superseded";
    supersededByDraftId: string;
    supersededAt: string;
  } = {
    status: "superseded",
    supersededByDraftId,
    supersededAt: "2026-07-12T00:00:00.000Z",
  };
  switch (draft.initialStatus) {
    case "clarifying":
      return { ...draft, ...lifecycle };
    case "failed":
      return { ...draft, ...lifecycle };
    case "contract_ready":
      return { ...draft, ...lifecycle };
  }
}

function confirmInput(draft: CustomRuleDraft) {
  return {
    actor,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    expectedDraftId: draft.id,
    expectedRevisionNumber: draft.revisionNumber,
    clientRequestId: "confirm-request-0001",
    promptText: "我确认以上业务规则。",
    contractConfirmed: true as const,
    expectedContractHash: draft.contractHash,
    expectedCatalogVersion: CATALOG_VERSION,
    simulationSelection: safeSelection(),
  };
}

function clarificationOutput(question: string, code: string) {
  return {
    contractPatch: {},
    unresolvedAmbiguities: [{ code, question, required: true }],
    nextQuestion: question,
    formulaProposal: null,
    testCases: [],
    safetyFlags: [],
  };
}

function confirmedFormulaOutput() {
  return {
    contractPatch: {},
    unresolvedAmbiguities: [],
    nextQuestion: null,
    formulaProposal: "payable = money_result({ final: yuan(20) })",
    testCases: [
      {
        name: "确认后的标准场景",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    safetyFlags: ["仅用于草案试算"],
  };
}

function clarifyingDraft(
  options: {
    unresolvedAmbiguities?: [
      SettlementAiUnresolvedAmbiguity,
      ...SettlementAiUnresolvedAmbiguity[],
    ];
    turnTrace?: {
      turnId: string;
      userMessageId: string;
      assistantMessageId: string;
    };
    idempotencyKey?: string;
    aiResponseContent?: string;
  } = {},
): CustomRuleDraft {
  const businessContract = contract();
  const parameters = Object.fromEntries(
    businessContract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  return {
    id: FIRST_DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    idempotencyKey: options.idempotencyKey ?? "seed-draft-request-0001",
    promptText: "每场直播按时长结算。",
    turnTrace: options.turnTrace ?? {
      turnId: uuid(210),
      userMessageId: uuid(310),
      assistantMessageId: uuid(410),
    },
    businessContract,
    unresolvedAmbiguities: options.unresolvedAmbiguities ?? [
      {
        code: "confirm_rate",
        question: "请确认每小时结算单价？",
        required: true,
      },
    ],
    variableCatalogVersion: CATALOG_VERSION,
    aiResponse: {
      content: options.aiResponseContent ?? "请确认每小时结算单价？",
      finishReason: "stop",
      providerRequestId: null,
    },
    generatedFormula: null,
    generatedExplanation: null,
    generatedTestCases: [],
    model: "deterministic",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(businessContract),
    formulaHash: null,
    parameterHash: hashCustomRuleParameters(parameters),
    initialStatus: "clarifying",
    status: "clarifying",
    revisionNumber: 1,
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
  };
}

function confirmableDraft(): CustomRuleDraft {
  return clarifyingDraft({
    unresolvedAmbiguities: [
      {
        code: "confirm_contract",
        question: "请确认以上业务规则无误？",
        required: true,
      },
    ],
  });
}

function simulatedDraft(): CustomRuleDraft {
  const businessContract = contract();
  const expression = "payable = money_result({ final: yuan(20) })";
  const parsed = parseCustomRuleFormula(expression);
  const validated = validateCustomRuleFormula(expression, {
    scope: businessContract.scope,
    executionGrain: businessContract.executionGrain,
    parameters: businessContract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  if (!parsed.ok || !validated.ok) {
    throw new Error("simulated draft fixture formula must be valid");
  }
  const parameters = Object.fromEntries(
    businessContract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  return {
    id: FIRST_DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    idempotencyKey: "seed-simulated-draft-request-0001",
    promptText: "我确认以上业务规则。",
    turnTrace: {
      turnId: uuid(211),
      userMessageId: uuid(311),
      assistantMessageId: uuid(411),
    },
    businessContract,
    unresolvedAmbiguities: [],
    variableCatalogVersion: CATALOG_VERSION,
    aiResponse: {
      content: "已生成并试算确认后的规则。",
      finishReason: "stop",
      providerRequestId: null,
    },
    generatedFormula: {
      expression,
      normalizedAst: parsed.ast,
    },
    generatedExplanation: "公式已经过确定性校验和试算。",
    generatedTestCases: [
      {
        name: "确认后的标准场景",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    model: "deterministic",
    safetyFlags: [],
    contractHash: hashCustomRuleContract(businessContract),
    formulaHash: validated.formulaHash,
    parameterHash: hashCustomRuleParameters(parameters),
    initialStatus: "contract_ready",
    status: "simulated",
    revisionNumber: 1,
    createdBy: USER_ID,
    createdAt: "2026-07-12T00:00:00.000Z",
    supersedesDraftId: null,
    supersededByDraftId: null,
    supersededAt: null,
  };
}

function catalog(): CustomRuleVariableCatalog {
  return {
    scope: "payable",
    executionGrain: "report",
    businessTimezone: "Asia/Shanghai",
    businessTimezoneConfirmed: true,
    businessTimezoneSource: "confirmed_contract",
    hasHistory: true,
    version: CATALOG_VERSION,
    variables: [
      {
        id: "system_minutes",
        label: "系统直播时长",
        runtimeType: { kind: "scalar", scalarType: "integer" },
        unit: "分钟",
        sourceLabel: "直播报告系统计时",
        availability: "available",
        coverageNumerator: 1,
        coverageDenominator: 1,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
      {
        id: "evidence_level",
        label: "凭证等级",
        runtimeType: { kind: "scalar", scalarType: "string" },
        unit: "等级",
        sourceLabel: "直播报告凭证等级",
        availability: "available",
        coverageNumerator: 1,
        coverageDenominator: 1,
        latestSampledPeriod: { start: "2026-07-01", end: "2026-07-10" },
      },
    ],
  };
}

function safeSelection(): AuthorizedSimulationSelectionRequest {
  return {
    selectionToken: "selection-token-0001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-10",
    criteriaCodes: ["approved_reports", "period_overlap", "project_scope"],
  };
}

function authorizedEvidence(
  input: Parameters<
    AuthorizedSimulationEvidencePort["loadAuthorizedEvidence"]
  >[0],
  currentMarginCents: string,
): AuthorizedCustomRuleSimulationEvidence {
  const evidence: AuthorizedCustomRuleSimulationEvidence = {
    provenance: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorId: input.actor.userId,
      selectionToken: input.selection.selectionToken,
      evidenceHash: "0".repeat(64),
      immutableSourceVersions: [
        {
          kind: "immutable",
          source: "locked_settlement_item",
          version: "locked-v1",
        },
      ],
    },
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: input.selection.periodStart,
      periodEnd: input.selection.periodEnd,
      populationCount: 1,
      criteria: [...input.selection.criteriaCodes],
    },
    records: [
      {
        recordId: "authorized-record-1",
        projectId: input.projectId,
        sourceVersion: {
          kind: "immutable",
          source: "locked_settlement_item",
          version: "locked-v1",
        },
        variables: {
          system_minutes: { type: "integer", value: 60 },
          evidence_level: { type: "string", value: "green" },
        },
        missingInputs: [],
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1600",
        },
      },
    ],
    userExamples: [
      {
        id: "adjustable-standard",
        inputs: {
          system_minutes: { type: "integer", value: 90 },
          evidence_level: { type: "string", value: "green" },
        },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    currentMarginCents,
  };
  evidence.provenance.evidenceHash = calculateCustomRuleEvidenceHash(evidence);
  return deepFreezeFixture(evidence);
}

function deepFreezeFixture<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if ("value" in descriptor) deepFreezeFixture(descriptor.value);
  }
  return Object.freeze(value);
}

function contract(): BusinessRuleContract {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    title: "项目主播按场计费",
    summary: "每场直播按系统时长计算主播应付金额。",
    calculationComponents: [
      {
        name: "final",
        description: "计算最终应付金额",
        expression: "按确认业务规则计算最终金额",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: "system_minutes",
        description: "系统直播时长",
        source: "直播报告系统计时",
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "分钟",
      },
    ],
    parameters: [
      {
        name: "hourly_rate",
        description: "每小时结算单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元/小时",
        defaultValue: { type: "money_cents", amountCents: 10_000 },
      },
    ],
    effectiveStartAt: "2026-07-12T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目级基础应付规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准场景",
        kind: "normal",
        description: "标准直播场景返回二十元。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "零时长边界仍按确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "最大时长",
        kind: "boundary",
        description: "最大时长边界仍按确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 600 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
  };
}

function gatewayResult(
  structuredOutput?: unknown,
  overrides: Partial<AiGatewayResult> = {},
): AiGatewayResult {
  return {
    status: "succeeded",
    structuredOutput,
    providerName: "deterministic",
    fallbackUsed: false,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    latencyMs: 5,
    costCents: 0,
    ...overrides,
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

function expectOrdered(events: string[], expected: string[]): void {
  let previous = -1;
  for (const event of expected) {
    const index = events.indexOf(event, previous + 1);
    expect(index, `${event} missing from ${events.join(", ")}`).toBeGreaterThan(
      previous,
    );
    previous = index;
  }
}
