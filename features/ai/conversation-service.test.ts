import { describe, expect, it, vi } from "vitest";

import type { AiConversationMessageDto } from "./conversation-contracts";
import {
  ConversationServiceError,
  createConversationService,
  type ConversationPersistence,
} from "./conversation-service";
import type {
  CreatedConversationTurn,
  StoredConversationTurn,
} from "./conversation-repository";

const actor = { organizationId: "org-1", userId: "user-1" };

const createdTurn: CreatedConversationTurn = {
  conversationId: "conversation-1",
  turnId: "turn-1",
  userMessageId: "message-user-1",
  assistantMessageId: "message-assistant-1",
  status: "accepted",
  attempt: 1,
  duplicate: false,
};

function storedTurn(
  patch: Partial<StoredConversationTurn> = {},
): StoredConversationTurn {
  return {
    id: "turn-1",
    conversationId: "conversation-1",
    userMessageId: "message-user-1",
    assistantMessageId: "message-assistant-1",
    mode: "fast",
    status: "accepted",
    attempt: 1,
    contextSnapshot: null,
    retryOfTurnId: null,
    regenerateOfTurnId: null,
    providerName: null,
    errorCode: null,
    errorSummary: null,
    retryable: true,
    ...patch,
  };
}

function persistence(
  overrides: Partial<ConversationPersistence> = {},
): ConversationPersistence {
  return {
    createConversation: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    getConversation: vi.fn(),
    listMessages: vi.fn().mockResolvedValue([]),
    listTurns: vi.fn().mockResolvedValue([]),
    createTurn: vi.fn().mockResolvedValue(createdTurn),
    getTurn: vi.fn().mockResolvedValue(storedTurn()),
    transitionTurn: vi.fn().mockResolvedValue(true),
    completeTurn: vi.fn().mockResolvedValue(true),
    failTurn: vi.fn().mockResolvedValue(true),
    renewLease: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("Xingyao conversation service", () => {
  it("accepts one user message as an idempotent turn", async () => {
    const store = persistence();
    const service = createConversationService(store);

    const result = await service.acceptTurn(actor, "conversation-1", {
      content: "解读当前风险",
      mode: "deep",
      clientRequestId: "request-123",
      attachments: [],
    });

    expect(store.createTurn).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      clientRequestId: "request-123",
      mode: "deep",
      kind: "user",
      content: "解读当前风险",
    });
    expect(result).toEqual(createdTurn);
  });

  it("retries a failed turn without creating another user message", async () => {
    const source = storedTurn({
      status: "failed",
      mode: "deep",
      retryable: true,
      contextSnapshot: {
        version: 1,
        summaryVersion: 0,
        messageIds: ["message-user-1"],
        groundingRefs: ["dashboard:role-home"],
        assembledAt: "2026-07-11T03:00:00.000Z",
      },
    });
    const store = persistence({ getTurn: vi.fn().mockResolvedValue(source) });
    const service = createConversationService(store);

    await service.retryTurn(actor, "turn-1", {
      clientRequestId: "retry-request-123",
    });

    expect(store.createTurn).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      clientRequestId: "retry-request-123",
      mode: "deep",
      kind: "retry",
      sourceTurnId: "turn-1",
    });
  });

  it("regenerates from a completed turn as a new assistant version", async () => {
    const source = storedTurn({ status: "completed", retryable: false });
    const store = persistence({ getTurn: vi.fn().mockResolvedValue(source) });
    const service = createConversationService(store);

    await service.regenerateTurn(actor, "turn-1", {
      clientRequestId: "regenerate-request-123",
    });

    expect(store.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "regenerate",
        sourceTurnId: "turn-1",
        conversationId: "conversation-1",
      }),
    );
  });

  it("rejects retry when the source turn is not failed and retryable", async () => {
    const store = persistence({
      getTurn: vi.fn().mockResolvedValue(storedTurn({ status: "completed" })),
    });
    const service = createConversationService(store);

    await expect(
      service.retryTurn(actor, "turn-1", {
        clientRequestId: "retry-request-123",
      }),
    ).rejects.toMatchObject({ code: "turn_not_retryable" });
    expect(store.createTurn).not.toHaveBeenCalled();
  });

  it("assembles only completed history and stores an immutable snapshot", async () => {
    const messages: AiConversationMessageDto[] = [
      message("message-user-old", 1, "user", "completed", "旧问题"),
      message("message-assistant-old", 2, "assistant", "completed", "旧回答"),
      message("message-assistant-failed", 3, "assistant", "failed", "部分内容"),
      message("message-user-1", 4, "user", "completed", "当前问题"),
      message("message-assistant-1", 5, "assistant", "pending", ""),
    ];
    const store = persistence({
      listMessages: vi.fn().mockResolvedValue(messages),
      getTurn: vi.fn().mockResolvedValue(storedTurn()),
    });
    const service = createConversationService(store, {
      now: () => new Date("2026-07-11T03:00:00.000Z"),
    });

    const prepared = await service.prepareTurn(actor, "turn-1", [
      "dashboard:role-home",
    ]);

    expect(prepared.messages).toEqual([
      { role: "user", content: "旧问题" },
      { role: "assistant", content: "旧回答" },
      { role: "user", content: "当前问题" },
    ]);
    expect(prepared.snapshot).toEqual({
      version: 1,
      summaryVersion: 0,
      messageIds: [
        "message-user-old",
        "message-assistant-old",
        "message-user-1",
      ],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    });
    expect(store.transitionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "accepted",
        to: "grounding",
        patch: expect.objectContaining({ contextSnapshot: prepared.snapshot }),
      }),
    );
  });

  it("normalizes an empty persisted snapshot before capturing gateway context", async () => {
    const messages: AiConversationMessageDto[] = [
      message("message-user-1", 1, "user", "completed", "当前问题"),
      message("message-assistant-1", 2, "assistant", "pending", ""),
    ];
    const store = persistence({
      listMessages: vi.fn().mockResolvedValue(messages),
      getTurn: vi.fn().mockResolvedValue(
        storedTurn({
          contextSnapshot: {} as unknown as NonNullable<
            StoredConversationTurn["contextSnapshot"]
          >,
        }),
      ),
    });
    const service = createConversationService(store, {
      now: () => new Date("2026-07-12T06:00:00.000Z"),
    });
    const gatewayContext = trustedGatewayContext();
    const expectedSnapshot = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-12T06:00:00.000Z",
    };

    const prepared = await service.prepareTurn(actor, "turn-1", [
      "dashboard:role-home",
      "dashboard:role-home",
    ]);

    expect(prepared.snapshot).toEqual(expectedSnapshot);
    expect(prepared.messages).toEqual([{ role: "user", content: "当前问题" }]);
    expect(store.transitionTurn).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
      from: "accepted",
      to: "grounding",
      patch: {
        contextSnapshot: expectedSnapshot,
        contextHash: expect.any(String),
      },
    });

    const captured = await service.captureGatewayContext(
      actor,
      "turn-1",
      prepared.snapshot,
      gatewayContext,
    );

    expect(captured).toEqual({ ...expectedSnapshot, gatewayContext });
    expect(store.transitionTurn).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
      from: "grounding",
      to: "grounding",
      patch: {
        contextSnapshot: { ...expectedSnapshot, gatewayContext },
        contextHash: expect.any(String),
      },
    });
  });

  it.each([
    {
      name: "missing required base fields",
      snapshot: {
        version: 1,
        summaryVersion: 0,
        messageIds: ["message-user-1"],
      },
    },
    {
      name: "gateway context without required base fields",
      snapshot: { gatewayContext: trustedGatewayContext() },
    },
  ])(
    "rejects a non-empty persisted snapshot with $name",
    async ({ snapshot }) => {
      const store = persistence({
        getTurn: vi.fn().mockResolvedValue(
          storedTurn({
            contextSnapshot: snapshot as unknown as NonNullable<
              StoredConversationTurn["contextSnapshot"]
            >,
          }),
        ),
      });
      const service = createConversationService(store);

      await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
        code: "turn_state_conflict",
      });
      expect(store.listMessages).not.toHaveBeenCalled();
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

  it("rejects gateway capture when the base snapshot is incomplete", async () => {
    const store = persistence();
    const service = createConversationService(store);
    const incompleteSnapshot = {
      gatewayContext: trustedGatewayContext(),
    } as unknown as NonNullable<StoredConversationTurn["contextSnapshot"]>;

    await expect(
      service.captureGatewayContext(
        actor,
        "turn-1",
        incompleteSnapshot,
        trustedGatewayContext(),
      ),
    ).rejects.toMatchObject({ code: "turn_state_conflict" });
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it("keeps the latest completed message when a long history exceeds the budget", async () => {
    const messages = Array.from({ length: 299 }, (_, index) =>
      message(
        `message-${index + 1}`,
        index + 1,
        index % 2 === 0 ? "user" : "assistant",
        "completed",
        "历史消息内容",
      ),
    );
    messages.push(
      message("message-user-latest", 300, "user", "completed", "最新问题"),
    );
    const store = persistence({
      listMessages: vi.fn().mockResolvedValue(messages),
    });
    const service = createConversationService(store, {
      contextCharacterBudget: 4,
    });

    const prepared = await service.prepareTurn(actor, "turn-1");

    expect(prepared.messages).toEqual([{ role: "user", content: "最新问题" }]);
    expect(prepared.snapshot.messageIds).toEqual(["message-user-latest"]);
  });

  it("uses the frozen gateway context without reloading a truncated message window", async () => {
    const gatewayContext = {
      messages: [
        { role: "system" as const, content: "冻结系统规则" },
        { role: "user" as const, content: "第 300 回合的冻结事实" },
      ],
      attachments: [],
      mode: "deep" as const,
      primaryProvider: "deepseek" as const,
      lastUserMessage: "第 300 回合的问题",
      responseMetadata: {
        grounding: { facts: [] },
        knowledge: { passages: [] },
        retrospectiveDraft: {},
      },
      invocationMetadata: { groundingFactCount: 0 },
    };
    const snapshot = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-older-than-window"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
      gatewayContext,
    };
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
    });
    const service = createConversationService(store);

    const prepared = await service.prepareTurn(actor, "turn-1");

    expect(store.listMessages).not.toHaveBeenCalled();
    expect(prepared.messages).toEqual(gatewayContext.messages);
    expect(prepared.snapshot).toEqual(snapshot);
  });

  it("refuses to commit punctuation-only assistant content", async () => {
    const store = persistence();
    const service = createConversationService(store);

    await expect(
      service.completeTurn(actor, "turn-1", {
        content: ".\n.",
        providerName: "deepseek",
      }),
    ).rejects.toBeInstanceOf(ConversationServiceError);
    expect(store.completeTurn).not.toHaveBeenCalled();
  });

  it("returns turn mappings with history so failed messages remain retryable after reload", async () => {
    const turn = storedTurn({ status: "failed", errorCode: "provider_failed" });
    const store = persistence({
      getConversation: vi.fn().mockResolvedValue({
        id: "conversation-1",
        title: "风险处置",
        status: "active",
        lastMessageAt: "2026-07-11T03:00:00.000Z",
        createdAt: "2026-07-11T03:00:00.000Z",
        updatedAt: "2026-07-11T03:00:00.000Z",
      }),
      listMessages: vi.fn().mockResolvedValue([]),
      listTurns: vi.fn().mockResolvedValue([turn]),
    });
    const service = createConversationService(store);

    const history = await service.getHistory(actor, "conversation-1");

    expect(history.turns).toEqual([turn]);
  });

  it("captures the exact trusted gateway context before generation", async () => {
    const store = persistence();
    const service = createConversationService(store);
    const snapshot = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    };
    const gatewayContext = {
      messages: [
        { role: "system" as const, content: "可信系统规则" },
        { role: "user" as const, content: "冻结的业务事实" },
      ],
      attachments: [],
      mode: "fast" as const,
      primaryProvider: "deepseek" as const,
      lastUserMessage: "冻结的业务事实",
      responseMetadata: {
        grounding: { facts: [] },
        knowledge: { passages: [] },
        retrospectiveDraft: {},
      },
      invocationMetadata: { groundingFactCount: 0 },
    };

    await service.captureGatewayContext(
      actor,
      "turn-1",
      snapshot,
      gatewayContext,
    );

    expect(store.transitionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn-1",
        from: "grounding",
        to: "grounding",
        patch: expect.objectContaining({
          contextSnapshot: { ...snapshot, gatewayContext },
        }),
      }),
    );
  });
});

function message(
  id: string,
  sequence: number,
  role: "user" | "assistant",
  status: AiConversationMessageDto["status"],
  content: string,
): AiConversationMessageDto {
  return {
    id,
    conversationId: "conversation-1",
    sequence,
    role,
    status,
    content,
    parentMessageId: null,
    createdAt: "2026-07-11T03:00:00.000Z",
    updatedAt: "2026-07-11T03:00:00.000Z",
  };
}

function trustedGatewayContext() {
  return {
    messages: [
      { role: "system" as const, content: "可信系统规则" },
      { role: "user" as const, content: "冻结的业务事实" },
    ],
    attachments: [],
    mode: "fast" as const,
    primaryProvider: "deepseek" as const,
    lastUserMessage: "冻结的业务事实",
    responseMetadata: {
      grounding: { facts: [] },
      knowledge: { passages: [] },
      retrospectiveDraft: {},
    },
    invocationMetadata: { groundingFactCount: 0 },
  };
}
