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

  it.each([
    {
      name: "an array provider",
      gatewayContext: {
        ...trustedGatewayContext(),
        primaryProvider: ["deepseek"],
      },
    },
    {
      name: "an object provider",
      gatewayContext: {
        ...trustedGatewayContext(),
        primaryProvider: { toString: (): string => "deepseek" },
      },
    },
    {
      name: "an array message role",
      gatewayContext: {
        ...trustedGatewayContext(),
        messages: [
          { role: ["system"], content: "可信系统规则" },
          { role: "user", content: "冻结的业务事实" },
        ],
      },
    },
    {
      name: "an object message role",
      gatewayContext: {
        ...trustedGatewayContext(),
        messages: [
          {
            role: { toString: (): string => "system" },
            content: "可信系统规则",
          },
          { role: "user", content: "冻结的业务事实" },
        ],
      },
    },
  ])(
    "rejects frozen gateway context with $name",
    async ({ gatewayContext }) => {
      const store = persistence({
        getTurn: vi.fn().mockResolvedValue(
          storedTurn({
            contextSnapshot: frozenSnapshot(gatewayContext),
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

  it.each([
    {
      name: "more than five attachments",
      attachments: Array.from({ length: 6 }, (_, index) =>
        validAttachment(index),
      ),
    },
    {
      name: "an unsupported MIME type",
      attachments: [validAttachment(0, { mimeType: "application/zip" })],
    },
    {
      name: "a reported size above eight MiB",
      attachments: [validAttachment(0, { sizeBytes: 8 * 1024 * 1024 + 1 })],
    },
    {
      name: "text above the shared character limit",
      attachments: [
        validAttachment(0, { data: undefined, text: "x".repeat(200_001) }),
      ],
    },
    {
      name: "data above the shared character limit",
      attachments: [validAttachment(0, { data: "A".repeat(12_000_000) })],
    },
    {
      name: "no readable source",
      attachments: [validAttachment(0, { data: undefined })],
    },
    {
      name: "a MIME type that requires normalization",
      attachments: [validAttachment(0, { mimeType: " Application/PDF " })],
    },
  ])("rejects frozen gateway context with $name", async ({ attachments }) => {
    const store = persistence({
      getTurn: vi.fn().mockResolvedValue(
        storedTurn({
          contextSnapshot: frozenSnapshot({
            ...trustedGatewayContext(),
            attachments,
          }),
        }),
      ),
    });
    const service = createConversationService(store);

    const error = await service.prepareTurn(actor, "turn-1").then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toMatchObject({ code: "turn_state_conflict" });
    expect(store.listMessages).not.toHaveBeenCalled();
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it("restores a valid frozen attachment without normalizing it", async () => {
    const attachment = validAttachment(0);
    const snapshot = frozenSnapshot({
      ...trustedGatewayContext(),
      attachments: [attachment],
    });
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
    });
    const service = createConversationService(store);

    const prepared = await service.prepareTurn(actor, "turn-1");

    expect(prepared.snapshot.gatewayContext?.attachments).toEqual([attachment]);
    expect(store.listMessages).not.toHaveBeenCalled();
  });

  it("rejects custom prototypes anywhere in a persisted snapshot", async () => {
    const customGatewayContext = Object.assign(
      Object.create({ inherited: true }),
      trustedGatewayContext(),
    );
    const store = persistence({
      getTurn: vi.fn().mockResolvedValue(
        storedTurn({
          contextSnapshot: frozenSnapshot(customGatewayContext),
        }),
      ),
    });
    const service = createConversationService(store);

    await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
      code: "turn_state_conflict",
    });
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it("rejects accessors without invoking them", async () => {
    const gatewayContext = trustedGatewayContext();
    const providerGetter = vi.fn(() => "deepseek");
    Object.defineProperty(gatewayContext, "primaryProvider", {
      configurable: true,
      enumerable: true,
      get: providerGetter,
    });
    const store = persistence({
      getTurn: vi.fn().mockResolvedValue(
        storedTurn({
          contextSnapshot: frozenSnapshot(gatewayContext),
        }),
      ),
    });
    const service = createConversationService(store);

    await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
      code: "turn_state_conflict",
    });
    expect(providerGetter).not.toHaveBeenCalled();
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "cyclic metadata",
      gatewayContext: (() => {
        const gatewayContext = trustedGatewayContext();
        const metadata = gatewayContext.invocationMetadata as Record<
          string,
          unknown
        >;
        metadata.self = metadata;
        return gatewayContext;
      })(),
    },
    {
      name: "BigInt metadata",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { groundingFactCount: 0, unsafe: BigInt(1) },
      },
    },
  ])(
    "rejects capture with $name before hashing",
    async ({ gatewayContext }) => {
      const store = persistence();
      const service = createConversationService(store);
      const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
        version: 1,
        summaryVersion: 0,
        messageIds: ["message-user-1"],
        groundingRefs: ["dashboard:role-home"],
        assembledAt: "2026-07-11T03:00:00.000Z",
      };

      await expect(
        service.captureGatewayContext(
          actor,
          "turn-1",
          snapshot,
          gatewayContext,
        ),
      ).rejects.toMatchObject({ code: "turn_state_conflict" });
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

  it("owns persisted snapshots and isolates them from later mutations", async () => {
    const sourceGatewayContext = trustedGatewayContext();
    const sourceSnapshot = frozenSnapshot(sourceGatewayContext);
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: sourceSnapshot })),
    });
    const service = createConversationService(store);

    const prepared = await service.prepareTurn(actor, "turn-1");
    const persistedSnapshot = vi.mocked(store.transitionTurn).mock.calls[0]?.[0]
      .patch?.contextSnapshot;

    sourceSnapshot.messageIds.push("source-mutation");
    sourceGatewayContext.messages[0]!.content = "source mutation";
    expect(prepared.snapshot.messageIds).toEqual(["message-user-1"]);
    expect(prepared.snapshot.gatewayContext?.messages[0]?.content).toBe(
      "可信系统规则",
    );
    expect(persistedSnapshot?.messageIds).toEqual(["message-user-1"]);
    expect(persistedSnapshot?.gatewayContext?.messages[0]?.content).toBe(
      "可信系统规则",
    );

    prepared.snapshot.messageIds.push("return-mutation");
    prepared.snapshot.gatewayContext!.messages[0]!.content = "return mutation";
    expect(persistedSnapshot?.messageIds).toEqual(["message-user-1"]);
    expect(persistedSnapshot?.gatewayContext?.messages[0]?.content).toBe(
      "可信系统规则",
    );
  });

  it("owns capture inputs and isolates persistence from returned mutations", async () => {
    const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    };
    const gatewayContext = trustedGatewayContext();
    const store = persistence();
    const service = createConversationService(store);

    const captured = await service.captureGatewayContext(
      actor,
      "turn-1",
      snapshot,
      gatewayContext,
    );
    const persistedSnapshot = vi.mocked(store.transitionTurn).mock.calls[0]?.[0]
      .patch?.contextSnapshot;

    snapshot.messageIds.push("source-mutation");
    gatewayContext.messages[0]!.content = "source mutation";
    expect(captured.messageIds).toEqual(["message-user-1"]);
    expect(captured.gatewayContext?.messages[0]?.content).toBe("可信系统规则");
    expect(persistedSnapshot?.messageIds).toEqual(["message-user-1"]);
    expect(persistedSnapshot?.gatewayContext?.messages[0]?.content).toBe(
      "可信系统规则",
    );

    captured.messageIds.push("return-mutation");
    captured.gatewayContext!.messages[0]!.content = "return mutation";
    expect(persistedSnapshot?.messageIds).toEqual(["message-user-1"]);
    expect(persistedSnapshot?.gatewayContext?.messages[0]?.content).toBe(
      "可信系统规则",
    );
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

  it("restores a canonical frozen retry snapshot with a positive version above one", async () => {
    const snapshot = {
      ...frozenSnapshot(trustedGatewayContext()),
      version: 11,
      summaryVersion: 5,
    };
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
    });
    const service = createConversationService(store);

    const prepared = await service.prepareTurn(actor, "turn-1");

    expect(store.listMessages).not.toHaveBeenCalled();
    expect(prepared.snapshot).toEqual(snapshot);
    expect(store.transitionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "accepted",
        to: "grounding",
        patch: expect.objectContaining({ contextSnapshot: snapshot }),
      }),
    );
  });

  it.each([
    { name: "zero", version: 0 },
    { name: "negative", version: -1 },
    { name: "fractional", version: 1.5 },
    { name: "NaN", version: Number.NaN },
    { name: "non-number", version: "11" },
  ])("rejects a frozen snapshot with a $name version", async ({ version }) => {
    const snapshot = {
      ...frozenSnapshot(trustedGatewayContext()),
      version,
    } as unknown as NonNullable<StoredConversationTurn["contextSnapshot"]>;
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
    });
    const service = createConversationService(store);

    await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
      code: "turn_state_conflict",
    });
    expect(store.transitionTurn).not.toHaveBeenCalled();
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

function frozenSnapshot(gatewayContext: unknown) {
  return {
    version: 1,
    summaryVersion: 0,
    messageIds: ["message-user-1"],
    groundingRefs: ["dashboard:role-home"],
    assembledAt: "2026-07-11T03:00:00.000Z",
    gatewayContext,
  } as unknown as NonNullable<StoredConversationTurn["contextSnapshot"]>;
}

function validAttachment(index: number, patch: Record<string, unknown> = {}) {
  const attachment: Record<string, unknown> = {
    name: `brief-${index + 1}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    data: "cGRm",
    ...patch,
  };
  for (const key of Object.keys(attachment)) {
    if (attachment[key] === undefined) delete attachment[key];
  }
  return attachment;
}
