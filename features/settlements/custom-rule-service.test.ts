import { describe, expect, it, vi } from "vitest";

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
  InsertedSettlementFormulaSimulation,
  InsertSettlementFormulaSimulationInput,
  SettlementFormulaSimulation,
} from "./custom-rule-repository";
import {
  createCustomRuleAuthoringService,
  type CustomRuleAuthoringRepositoryPort,
  type SettlementVariableCatalogPort,
} from "./custom-rule-service";
import {
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type CustomRuleSimulationEvidence,
} from "./custom-rule-simulation";
import type { CustomRuleVariableCatalog } from "./custom-rule-variable-catalog";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const FIRST_DRAFT_ID = "00000000-0000-4000-8000-000000000101";
const CATALOG_VERSION = "a".repeat(64);
const actor = { organizationId: ORGANIZATION_ID, userId: USER_ID };

describe("custom rule authoring service", () => {
  it("starts a generic conversation and durably persists revision one before completing the turn", async () => {
    const harness = createHarness([
      clarificationOutput("请确认每小时结算单价？", "confirm_rate"),
    ]);
    const promptText = "  每场直播按时长结算，请逐项确认。\n";

    const result = await harness.service.startSession({
      actor,
      projectId: PROJECT_ID,
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
    const draftInput = harness.repository.createDraftCalls[0];
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
    expect(harness.events.indexOf("repository.createDraft")).toBeLessThan(
      harness.events.indexOf("conversation.completeTurn"),
    );
    expect(harness.conversation.completeTurn).toHaveBeenCalledWith(
      actor,
      "00000000-0000-4000-8000-000000000201",
      expect.objectContaining({
        metadata: expect.objectContaining({
          contextSnapshotVersion: 7,
          contextSummaryVersion: 3,
          contextMessageIds: [
            "00000000-0000-4000-8000-000000000301",
          ],
          settlementRevisionNumber: 1,
        }),
      }),
    );
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
      draft: { id: first.ok ? first.draft.id : "" },
    });
    expect(harness.conversation.acceptTurn).toHaveBeenCalledTimes(1);
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.events.indexOf("conversation.acceptTurn")).toBeLessThan(
      harness.events.indexOf("repository.createDraft"),
    );
    expect(previous.businessContract).toEqual(previousEvidence.businessContract);
    expect(previous.generatedFormula).toEqual(previousEvidence.generatedFormula);
    expect(previous.generatedTestCases).toEqual(previousEvidence.generatedTestCases);
  });

  it("records an explicitly owned failed revision before failing the generic turn", async () => {
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
    expect(harness.events.indexOf("repository.createDraft")).toBeLessThan(
      harness.events.indexOf("conversation.failTurn"),
    );
    expect(previous.businessContract).toEqual(priorSnapshot.businessContract);
    expect(previous.generatedFormula).toEqual(priorSnapshot.generatedFormula);
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

  it("confirms, validates, explains, checks readiness, persists contract-ready, inserts simulation, then completes", async () => {
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
      simulationEvidence: simulationEvidence(),
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
        totalOldCents: "1000",
        totalNewCents: "2000",
        totalDeltaCents: "1000",
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
    expectOrdered(harness.events, [
      "conversation.acceptTurn",
      "conversation.prepareTurn",
      "conversation.captureGatewayContext",
      "conversation.markGenerating",
      "conversation.markValidating",
      "repository.createDraft",
      "repository.insertSimulation",
      "repository.getDraft",
      "conversation.completeTurn",
    ]);
    expect(harness.conversation.captureGatewayContext).toHaveBeenCalledTimes(1);
    expect(harness.conversation.getHistory).toHaveBeenCalledWith(
      actor,
      CONVERSATION_ID,
    );
  });

  it("rejects invalid, stale, unresolved, and duplicate confirmation transitions before persistence", async () => {
    const falseConfirmation = createHarness([confirmedFormulaOutput()]);
    const falseDraft = falseConfirmation.repository.seedDraft(confirmableDraft());
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

    const duplicate = createHarness([confirmedFormulaOutput()]);
    const duplicateDraft = duplicate.repository.seedDraft(
      clarifyingDraft({ status: "simulated" }),
    );
    await expect(
      duplicate.service.confirmContract(confirmInput(duplicateDraft)),
    ).rejects.toMatchObject({ code: "duplicate_confirmation" });

    for (const harness of [falseConfirmation, stale, unresolved, duplicate]) {
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
  });

  it("does not claim completion when simulation persistence or readback fails", async () => {
    const harness = createHarness([confirmedFormulaOutput()], {
      failSimulationInsert: true,
    });
    const previous = harness.repository.seedDraft(confirmableDraft());

    await expect(
      harness.service.confirmContract(confirmInput(previous)),
    ).rejects.toMatchObject({ code: "persistence_failed" });
    expect(harness.repository.createDraftCalls).toHaveLength(1);
    expect(harness.repository.insertSimulationCalls).toHaveLength(1);
    expect(harness.conversation.completeTurn).not.toHaveBeenCalled();
    expect(harness.conversation.failTurn).toHaveBeenCalledTimes(1);
    expect(harness.events.indexOf("repository.insertSimulation")).toBeLessThan(
      harness.events.indexOf("conversation.failTurn"),
    );

    const readback = createHarness([confirmedFormulaOutput()], {
      skipSimulatedTransition: true,
    });
    const readbackDraft = readback.repository.seedDraft(confirmableDraft());
    await expect(
      readback.service.confirmContract(confirmInput(readbackDraft)),
    ).rejects.toMatchObject({ code: "persistence_failed" });
    expect(readback.repository.insertSimulationCalls).toHaveLength(1);
    expect(readback.conversation.completeTurn).not.toHaveBeenCalled();
    expect(readback.conversation.failTurn).toHaveBeenCalledTimes(1);
    expectOrdered(readback.events, [
      "repository.insertSimulation",
      "repository.getDraft",
      "conversation.failTurn",
    ]);
  });
});

type ProviderOutput =
  | Record<string, unknown>
  | { providerFailure: true };

function createHarness(
  outputs: ProviderOutput[],
  options: {
    persistFailedRevisions?: boolean;
    failSimulationInsert?: boolean;
    skipSimulatedTransition?: boolean;
  } = {},
) {
  const events: string[] = [];
  let acceptedContent = "";
  let turnNumber = 0;
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
        messages: [],
      };
    }),
    acceptTurn: vi.fn(async (_actor, _conversationId, command) => {
      events.push("conversation.acceptTurn");
      acceptedContent = command.content;
      turnNumber += 1;
      return {
        conversationId: CONVERSATION_ID,
        turnId: uuid(200 + turnNumber),
        userMessageId: uuid(300 + turnNumber),
        assistantMessageId: uuid(400 + turnNumber),
        status: "accepted" as const,
        attempt: 1,
        duplicate: false,
      };
    }),
    prepareTurn: vi.fn(async () => {
      events.push("conversation.prepareTurn");
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
    captureGatewayContext: vi.fn(async (_actor, _turnId, snapshot, gatewayContext) => {
      void _actor;
      void _turnId;
      events.push("conversation.captureGatewayContext");
      return { ...snapshot, gatewayContext };
    }),
    markGenerating: vi.fn(async () => {
      events.push("conversation.markGenerating");
    }),
    markValidating: vi.fn(async () => {
      events.push("conversation.markValidating");
    }),
    completeTurn: vi.fn(async () => {
      events.push("conversation.completeTurn");
    }),
    failTurn: vi.fn(async () => {
      events.push("conversation.failTurn");
    }),
  };

  const queue = [...outputs];
  const gateway: SettlementStructuredGateway = async () => {
    events.push("gateway.execute");
    const output = queue.shift();
    if (!output || "providerFailure" in output) {
      return gatewayResult(undefined, {
        status: "failed",
        errorSummary: "provider unavailable",
      });
    }
    return gatewayResult(output);
  };
  const repository = new InMemoryAuthoringRepository(events, options);
  const catalogPort: SettlementVariableCatalogPort = {
    getCatalog: vi.fn(async () => {
      events.push("catalog.getCatalog");
      return catalog();
    }),
  };
  const service = createCustomRuleAuthoringService({
    conversation,
    ai: createSettlementRuleAiAdapter({ gateway }),
    repository,
    catalog: catalogPort,
    analyzeReadiness: analyzeCustomRuleDataReadiness,
    simulate: simulateCustomSettlementRule,
    primaryProvider: "deterministic",
    persistFailedRevisions: options.persistFailedRevisions ?? false,
  });
  return { service, conversation, repository, catalogPort, events };
}

class InMemoryAuthoringRepository implements CustomRuleAuthoringRepositoryPort {
  readonly drafts: CustomRuleDraft[] = [];
  readonly simulations: SettlementFormulaSimulation[] = [];
  readonly createDraftCalls: CreateCustomRuleDraftInput[] = [];
  readonly insertSimulationCalls: InsertSettlementFormulaSimulationInput[] = [];

  constructor(
    private readonly events: string[],
    private readonly options: {
      failSimulationInsert?: boolean;
      skipSimulatedTransition?: boolean;
    },
  ) {}

  seedDraft(draft: CustomRuleDraft): CustomRuleDraft {
    const copy = structuredClone(draft);
    this.drafts.push(copy);
    return copy;
  }

  async createDraft(
    input: CreateCustomRuleDraftInput,
  ): Promise<CreatedCustomRuleDraft> {
    this.events.push("repository.createDraft");
    this.createDraftCalls.push(structuredClone(input));
    const duplicate = this.drafts.find(
      (draft) => draft.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) return { ...structuredClone(duplicate), duplicate: true };
    const previous = this.drafts
      .filter((draft) => draft.conversationId === input.conversationId)
      .sort((left, right) => right.revisionNumber - left.revisionNumber)[0];
    const revisionNumber = (previous?.revisionNumber ?? 0) + 1;
    const id = uuid(100 + revisionNumber);
    const created: CustomRuleDraft = {
      ...structuredClone(input),
      id,
      initialStatus: input.status,
      status: input.status,
      revisionNumber,
      createdBy: USER_ID,
      createdAt: "2026-07-12T00:00:00.000Z",
      supersedesDraftId: previous?.id ?? null,
      supersededByDraftId: null,
      supersededAt: null,
    };
    if (previous) {
      previous.status = "superseded";
      previous.supersededByDraftId = id;
      previous.supersededAt = "2026-07-12T00:00:00.000Z";
    }
    this.drafts.push(created);
    return { ...structuredClone(created), duplicate: false };
  }

  async listDrafts(
    input: Parameters<CustomRuleRepository["listDrafts"]>[0],
  ): Promise<CustomRuleDraft[]> {
    this.events.push("repository.listDrafts");
    return this.drafts
      .filter(
        (draft) =>
          draft.organizationId === input.organizationId &&
          draft.projectId === input.projectId &&
          draft.conversationId === input.conversationId,
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

  async insertSimulation(
    input: InsertSettlementFormulaSimulationInput,
  ): Promise<InsertedSettlementFormulaSimulation> {
    this.events.push("repository.insertSimulation");
    this.insertSimulationCalls.push(structuredClone(input));
    if (this.options.failSimulationInsert) {
      throw new Error("simulation persistence failed");
    }
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
    if (input.owner.kind === "ai_draft" && !this.options.skipSimulatedTransition) {
      const draft = this.drafts.find((candidate) => candidate.id === input.owner.id);
      if (draft && draft.status === "contract_ready") draft.status = "simulated";
    }
    return { ...structuredClone(simulation), duplicate: false };
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
    simulationEvidence: simulationEvidence(),
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
  overrides: Partial<CustomRuleDraft> = {},
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
    idempotencyKey: "seed-draft-request-0001",
    promptText: "每场直播按时长结算。",
    turnTrace: {
      turnId: uuid(210),
      userMessageId: uuid(310),
      assistantMessageId: uuid(410),
    },
    businessContract,
    unresolvedAmbiguities: [
      {
        code: "confirm_rate",
        question: "请确认每小时结算单价？",
        required: true,
      },
    ],
    variableCatalogVersion: CATALOG_VERSION,
    aiResponse: {
      content: "请确认每小时结算单价？",
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
    ...overrides,
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

function simulationEvidence(): CustomRuleSimulationEvidence {
  return {
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      populationCount: 1,
      criteria: ["locked settlement comparison"],
    },
    records: [
      {
        recordId: "authorized-record-1",
        projectId: PROJECT_ID,
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
          amountCents: "1000",
        },
      },
    ],
    synthetic: {
      zero: {
        variables: {
          system_minutes: { type: "integer", value: 0 },
          evidence_level: { type: "string", value: "green" },
        },
      },
      thresholdEdges: [
        {
          thresholdId: "sixty_minutes",
          edge: "at",
          variables: {
            system_minutes: { type: "integer", value: 60 },
            evidence_level: { type: "string", value: "green" },
          },
        },
      ],
      configuredMaximums: [
        {
          maximumId: "configured_minutes",
          variables: {
            system_minutes: { type: "integer", value: 600 },
            evidence_level: { type: "string", value: "green" },
          },
        },
      ],
      evidenceLevels: (["green", "yellow", "red"] as const).map((level) => ({
        level,
        variables: {
          system_minutes: { type: "integer" as const, value: 60 },
          evidence_level: { type: "string" as const, value: level },
        },
      })),
      missingDataPolicies: [
        {
          variableId: "system_minutes",
          policy: { action: "block_batch" },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
        {
          variableId: "system_minutes",
          policy: { action: "route_item_to_review" },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
        {
          variableId: "system_minutes",
          policy: {
            action: "use_explicit_default",
            defaultValue: { type: "integer", value: 0 },
          },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
      ],
    },
    userExamples: [
      {
        id: "adjustable-standard",
        variables: {
          system_minutes: { type: "integer", value: 90 },
          evidence_level: { type: "string", value: "green" },
        },
      },
    ],
    currentMarginCents: "5000",
  };
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
