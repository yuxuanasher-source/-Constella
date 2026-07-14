import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  ConversationServiceError,
  createConversationService,
  type ConversationPersistence,
} from "@/features/ai/conversation-service";
import type {
  CompleteSettlementFormulaSimulation,
} from "@/features/settlements/custom-rule-repository";
import { getCustomRuleRouteContext } from "@/features/settlements/custom-rule-route-context";

vi.mock(
  "@/features/settlements/custom-rule-route-context",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/settlements/custom-rule-route-context")
      >();
    return { ...actual, getCustomRuleRouteContext: vi.fn() };
  },
);

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "12121212-1212-4121-8121-121212121212";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

function latestDraft() {
  return {
    id: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: SESSION_ID,
    revisionNumber: 4,
    createdBy: AUTHOR_ID,
    status: "simulated",
    initialStatus: "contract_ready",
    businessContract: { title: "最新确认合同" },
    unresolvedAmbiguities: [],
    generatedFormula: { expression: "money_result({ final: yuan(1) })" },
    generatedExplanation: "按确认公式计算。",
    generatedTestCases: [],
    safetyFlags: [],
    formulaHash: "a".repeat(64),
    contractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    variableCatalogVersion: "d".repeat(64),
    createdAt: "2026-07-12T03:00:00.000Z",
    promptText: "raw settlement prompt",
    aiResponse: { content: "raw model response", providerRequestId: "secret" },
    model: "private-model-stack",
  };
}

function latestSimulation(): CompleteSettlementFormulaSimulation {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    owner: { kind: "ai_draft", id: DRAFT_ID },
    idempotencyKey: "session-simulation-0001",
    formulaHash: "a".repeat(64),
    ruleContractHash: "b".repeat(64),
    parameterHash: "c".repeat(64),
    variableCatalogVersion: "d".repeat(64),
    createdAt: "2026-07-12T03:01:00.000Z",
    dataSelectionHash: "e".repeat(64),
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      populationCount: 1,
      sampledCount: 1,
      criteria: ["approved_reports"],
    },
    summarySchemaVersion: 2,
    summaryComplete: true,
    summaryStatus: "complete",
    coverage: {
      summarySchemaVersion: 2,
      totalRecords: 1,
      evaluatedRecords: 1,
      skippedRecords: 0,
      uncoveredRecords: 0,
      zeroAmountRecords: 0,
      reviewRoutedRecords: 0,
      blockedRecords: 0,
    },
    scenarios: [
      {
        id: "scenario:latest-session",
        category: "contract_example",
        outcome: "calculated",
        amountCents: "10100",
        expectedAmountCents: "10100",
        passed: true,
      },
    ],
    historicalTotals: {
      oldPayableAmountCents: "10000",
      oldReceivableAmountCents: null,
      newPayableAmountCents: "10100",
      newReceivableAmountCents: null,
      payableAmountCents: "10000",
      receivableAmountCents: null,
      recordCount: 1,
      verificationStatus: "verified",
    },
    deltas: {
      payableAmountCents: "100",
      receivableAmountCents: null,
      percentageBps: 100,
      marginImpactCents: "-100",
    },
    largestChanges: [],
    warnings: [
      {
        kind: "warning",
        code: "CUSTOM_RULE_SESSION_FIXTURE",
        severity: "info",
        message: "Fixture warning",
      },
    ],
    createdBy: AUTHOR_ID,
  };
}

function context(role: string) {
  return {
    supabase: { client: "supabase" },
    auth: { userId: USER_ID, organizationId: ORGANIZATION_ID, role },
    actor: { userId: USER_ID, organizationId: ORGANIZATION_ID },
    requireProjectAccess: vi.fn().mockResolvedValue(undefined),
    conversation: {
      getHistory: vi.fn().mockResolvedValue({
        conversation: {
          id: SESSION_ID,
          title: "结算规则会话",
          status: "active",
          lastMessageAt: "2026-07-12T03:00:00.000Z",
          createdAt: "2026-07-12T02:00:00.000Z",
          updatedAt: "2026-07-12T03:00:00.000Z",
        },
        messages: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            conversationId: SESSION_ID,
            sequence: 1,
            role: "user",
            status: "completed",
            content: "按时长结算",
            parentMessageId: null,
            metadata: { providerKey: "must-not-leak" },
            createdAt: "2026-07-12T02:00:00.000Z",
            updatedAt: "2026-07-12T02:00:00.000Z",
          },
        ],
        turns: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            conversationId: SESSION_ID,
            userMessageId: "77777777-7777-4777-8777-777777777777",
            assistantMessageId: "99999999-9999-4999-8999-999999999999",
            mode: "deep",
            status: "completed",
            attempt: 1,
            contextSnapshot: { gatewayContext: { rawPrompt: "secret" } },
            retryOfTurnId: null,
            regenerateOfTurnId: null,
            providerName: "deepseek",
            errorCode: null,
            errorSummary: null,
            retryable: false,
          },
        ],
      }),
    },
    repository: {
      listDrafts: vi.fn().mockResolvedValue([latestDraft()]),
      listSimulations: vi.fn().mockResolvedValue([latestSimulation()]),
    },
  };
}

function routeParams() {
  return Promise.resolve({ projectId: PROJECT_ID, sessionId: SESSION_ID });
}

describe("settlement rule AI session detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["owner", "ops_manager", "operator_business", "finance"])(
    "allows %s to restore the authoritative session state",
    async (role) => {
      const routeContext = context(role);
      vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
        routeContext as never,
      );

      const response = await GET(new Request("http://localhost"), {
        params: routeParams(),
      });

      expect(response.status).toBe(200);
      expect(routeContext.requireProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(routeContext.conversation.getHistory).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID, userId: AUTHOR_ID },
        SESSION_ID,
      );
      expect(routeContext.repository.listDrafts).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: SESSION_ID,
        revisionOrder: "desc",
        limit: 1,
      });
      expect(routeContext.repository.listSimulations).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        owner: { kind: "ai_draft", id: DRAFT_ID },
        limit: 1,
      });
    },
  );

  it("composes safe history, the latest scoped draft, and latest summary", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const first = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });
    const second = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });
    const payload = await first.json();
    const serialized = JSON.stringify(payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(payload.session).toMatchObject({
      conversation: { id: SESSION_ID },
      messages: [{ content: "按时长结算" }],
      turns: [{ status: "completed", attempt: 1 }],
      draft: { id: DRAFT_ID, revisionNumber: 4, status: "simulated" },
      simulation: {
        version: 2,
        complete: true,
        status: "complete",
        id: "66666666-6666-4666-8666-666666666666",
        summary: { totalOldYuan: "100.00", totalNewYuan: "101.00" },
      },
    });
    expect(routeContext.conversation.getHistory).toHaveBeenCalledTimes(2);
    expect(routeContext.repository.listDrafts).toHaveBeenCalledTimes(2);
    expect(serialized).not.toContain("raw settlement prompt");
    expect(serialized).not.toContain("raw model response");
    expect(serialized).not.toContain("providerName");
    expect(serialized).not.toContain("contextSnapshot");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("amountCents");
    expect(serialized).not.toContain("percentageBps");
  });

  it("returns unknown generic conversations as a stable 404", async () => {
    const routeContext = context("finance");
    routeContext.conversation.getHistory.mockRejectedValue(
      new ConversationServiceError(
        "conversation_not_found",
        "Conversation not found",
      ),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CUSTOM_RULE_SESSION_NOT_FOUND",
        message: "Settlement rule session not found",
        retryable: false,
      },
    });
  });

  it("does not treat a generic conversation without a scoped draft as a session", async () => {
    const routeContext = context("finance");
    routeContext.repository.listDrafts.mockResolvedValue([]);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(404);
    expect(routeContext.repository.listSimulations).not.toHaveBeenCalled();
  });

  it("validates both project and session params through Zod", async () => {
    const routeContext = context("finance");
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID, sessionId: "bad" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST", path: ["sessionId"] },
    });
    expect(routeContext.conversation.getHistory).not.toHaveBeenCalled();
  });

  it("checks project scope before loading conversation or drafts", async () => {
    const routeContext = context("finance");
    const { CustomRuleRouteError } =
      await import("@/features/settlements/custom-rule-route-context");
    routeContext.requireProjectAccess.mockRejectedValue(
      new CustomRuleRouteError({
        code: "CUSTOM_RULE_PROJECT_NOT_FOUND",
        message: "Project not found",
        status: 404,
        retryable: false,
      }),
    );
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(404);
    expect(routeContext.conversation.getHistory).not.toHaveBeenCalled();
    expect(routeContext.repository.listDrafts).not.toHaveBeenCalled();
  });

  it("restores author-owned generic history for an authorized finance viewer", async () => {
    const conversation = createRealConversationService();
    await conversation.createConversation(
      { organizationId: ORGANIZATION_ID, userId: AUTHOR_ID },
      "结算规则会话",
    );
    const getHistory = vi.spyOn(conversation, "getHistory");
    const routeContext = context("finance");
    routeContext.conversation = conversation as never;
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(200);
    expect(getHistory).toHaveBeenCalledWith(
      { organizationId: ORGANIZATION_ID, userId: AUTHOR_ID },
      SESSION_ID,
    );
    expect(getHistory).not.toHaveBeenCalledWith(routeContext.actor, SESSION_ID);
  });

  it.each([
    ["organizationId", "99999999-9999-4999-8999-999999999999"],
    ["projectId", "99999999-9999-4999-8999-999999999999"],
    ["conversationId", "99999999-9999-4999-8999-999999999999"],
  ])("rejects a persisted draft with mismatched %s", async (field, value) => {
    const conversation = createRealConversationService();
    const getHistory = vi.spyOn(conversation, "getHistory");
    const routeContext = context("finance");
    routeContext.conversation = conversation as never;
    routeContext.repository.listDrafts.mockResolvedValue([
      { ...latestDraft(), [field]: value },
    ]);
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      routeContext as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(404);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("preserves the streamer denial from route context", async () => {
    vi.mocked(getCustomRuleRouteContext).mockResolvedValue(
      Response.json(
        {
          error: {
            code: "CUSTOM_RULE_FORBIDDEN",
            message: "Settlement rule authoring is limited to MCN staff",
            retryable: false,
          },
        },
        { status: 403 },
      ) as never,
    );

    const response = await GET(new Request("http://localhost"), {
      params: routeParams(),
    });

    expect(response.status).toBe(403);
  });
});

function createRealConversationService() {
  let conversation: {
    id: string;
    organizationId: string;
    ownerUserId: string;
    title: string;
    status: "active";
    lastMessageAt: string;
    createdAt: string;
    updatedAt: string;
  } | null = null;
  const persistence: ConversationPersistence = {
    async createConversation(input) {
      const now = "2026-07-12T02:00:00.000Z";
      conversation = {
        id: SESSION_ID,
        organizationId: input.organizationId,
        ownerUserId: input.ownerUserId,
        title: input.title,
        status: "active",
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      return {
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
    },
    async listConversations(input) {
      return conversation &&
        conversation.organizationId === input.organizationId &&
        conversation.ownerUserId === input.ownerUserId
        ? [
            {
              id: conversation.id,
              title: conversation.title,
              status: conversation.status,
              lastMessageAt: conversation.lastMessageAt,
              createdAt: conversation.createdAt,
              updatedAt: conversation.updatedAt,
            },
          ]
        : [];
    },
    async getConversation(input) {
      return conversation &&
        conversation.id === input.conversationId &&
        conversation.organizationId === input.organizationId &&
        conversation.ownerUserId === input.ownerUserId
        ? {
            id: conversation.id,
            title: conversation.title,
            status: conversation.status,
            lastMessageAt: conversation.lastMessageAt,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          }
        : null;
    },
    async listMessages() {
      return [];
    },
    async listTurns() {
      return [];
    },
    async createTurn() {
      return null;
    },
    async getTurn() {
      return null;
    },
    async transitionTurn() {
      return false;
    },
    async completeTurn() {
      return false;
    },
    async failTurn() {
      return false;
    },
    async renewLease() {
      return false;
    },
  };
  return createConversationService(persistence);
}
