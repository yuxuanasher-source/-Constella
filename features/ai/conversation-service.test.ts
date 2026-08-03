import { describe, expect, it, vi } from "vitest";

import type { AiConversationMessageDto } from "./conversation-contracts";
import {
  ConversationServiceError,
  createConversationService,
  type ConversationPersistence,
} from "./conversation-service";
import { HermesStateRepositoryError } from "./hermes/hermes-state-repository";
import type {
  CreatedConversationTurn,
  StoredConversationTurn,
} from "./conversation-repository";

const actor = { organizationId: "org-1", userId: "user-1" };
const gatewayRuntimeSelection = {
  runtime: "gateway" as const,
  protocol: "xingyao-hermes-gateway-v2",
  profile: "hermes-xingyao-v2",
};

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
    outcome: null,
    cancelRequestedAt: null,
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
    listContextMessages: vi.fn().mockResolvedValue([]),
    listTurns: vi.fn().mockResolvedValue([]),
    createTurn: vi.fn().mockResolvedValue(createdTurn),
    getTurn: vi.fn().mockResolvedValue(storedTurn()),
    transitionTurn: vi.fn().mockResolvedValue(true),
    completeTurn: vi.fn().mockResolvedValue(true),
    failTurn: vi.fn().mockResolvedValue(true),
    renewLease: vi.fn().mockResolvedValue(true),
    finishTurnV2: vi.fn().mockResolvedValue(undefined),
    finishTurnV3: vi.fn().mockResolvedValue({
      completed: true,
      memoryStatus: "ready",
      summaryVersion: 1,
    }),
    cancelTurnV2: vi.fn().mockResolvedValue({
      turnId: "turn-1",
      status: "cancelled",
      outcome: "cancelled",
      cancelRequested: true,
      alreadyTerminal: false,
    }),
    renewLeaseV2: vi.fn().mockResolvedValue(undefined),
    compareAndSwapGatewayState: vi.fn().mockResolvedValue(2),
    getGatewayState: vi.fn().mockResolvedValue(null),
    syncConversationSummary: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("Xingyao conversation service", () => {
  it("loads Gateway context messages through actor scope and a sequence cursor", async () => {
    const listContextMessages = vi.fn().mockResolvedValue([]);
    const service = createConversationService(
      persistence({ listContextMessages }),
    );

    await service.listContextMessages(actor, "conversation-1", 200);

    expect(listContextMessages).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      afterSequence: 200,
    });
  });

  it("keeps legacy persistence implementations compatible with deterministic context filtering", async () => {
    const messages: AiConversationMessageDto[] = [
      message("message-recent-2", 12, "assistant", "completed", "recent 2"),
      message("message-pending", 13, "assistant", "pending", "pending"),
      {
        ...message("message-pinned-old", 4, "user", "completed", "pinned"),
        metadata: { pinned: true },
      },
      message("message-compacted", 3, "user", "completed", "compacted"),
      message("message-recent-1", 11, "user", "completed", "recent 1"),
    ];
    const store = persistence({
      listMessages: vi.fn().mockResolvedValue(messages),
    });
    delete store.listContextMessages;
    const service = createConversationService(store);

    await expect(
      service.listContextMessages(actor, "conversation-1", 10),
    ).resolves.toEqual([
      expect.objectContaining({ id: "message-pinned-old" }),
      expect.objectContaining({ id: "message-recent-1" }),
      expect.objectContaining({ id: "message-recent-2" }),
    ]);
    expect(store.listMessages).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      limit: Number.MAX_SAFE_INTEGER,
    });
  });

  it("forwards turn-stage telemetry through actor and conversation boundaries", async () => {
    const observedAt = "2026-08-03T16:00:00.000Z";
    const recordTurnStage = vi.fn().mockResolvedValue({
      turnId: "turn-1",
      stage: "session_ready",
      observedAt,
      sessionAction: "resumed",
    });
    const service = createConversationService(persistence({ recordTurnStage }));

    await expect(
      service.recordTurnStage(actor, "conversation-1", "turn-1", {
        stage: "session_ready",
        observedAt,
        sessionAction: "resumed",
      }),
    ).resolves.toEqual({
      turnId: "turn-1",
      stage: "session_ready",
      observedAt,
      sessionAction: "resumed",
    });
    expect(recordTurnStage).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      stage: "session_ready",
      observedAt,
      sessionAction: "resumed",
    });
  });

  it("treats an unavailable optional stage persistence as a no-op", async () => {
    const store = persistence();
    delete store.recordTurnStage;
    const service = createConversationService(store);

    await expect(
      service.recordTurnStage(actor, "conversation-1", "turn-1", {
        stage: "accepted",
        observedAt: "2026-08-03T16:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("normalizes unknown stage persistence failures without leaking internals", async () => {
    const service = createConversationService(
      persistence({
        recordTurnStage: vi
          .fn()
          .mockRejectedValue(new Error("secret database response")),
      }),
    );

    const error = await service
      .recordTurnStage(actor, "conversation-1", "turn-1", {
        stage: "terminal",
        observedAt: "2026-08-03T16:00:00.000Z",
      })
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toMatchObject({
      code: "conversation_turn_stage_persist_failed",
    });
    expect(String(error)).not.toContain("secret database response");
  });

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

  it("passes selected runtime into accepted turn persistence", async () => {
    const store = persistence();
    const service = createConversationService(store, {
      now: () => new Date("2026-07-11T03:00:00.000Z"),
    });

    await service.acceptTurn(
      actor,
      "conversation-1",
      {
        content: "瑙ｈ褰撳墠椋庨櫓",
        mode: "deep",
        clientRequestId: "request-123",
        attachments: [],
      },
      { runtimeSelection: gatewayRuntimeSelection },
    );

    expect(store.createTurn).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      clientRequestId: "request-123",
      mode: "deep",
      kind: "user",
      content: "瑙ｈ褰撳墠椋庨櫓",
      contextSnapshot: {
        version: 1,
        summaryVersion: 0,
        messageIds: [],
        groundingRefs: [],
        assembledAt: "2026-07-11T03:00:00.000Z",
        runtimeSelection: gatewayRuntimeSelection,
      },
    });
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

  it("keeps persisted runtime selection when Gateway setup fails before capture", async () => {
    const messages: AiConversationMessageDto[] = [
      message("message-user-1", 1, "user", "completed", "褰撳墠闂"),
      message("message-assistant-1", 2, "assistant", "pending", ""),
    ];
    const runtimeSeed = {
      version: 1,
      summaryVersion: 0,
      messageIds: [],
      groundingRefs: [],
      assembledAt: "2026-07-11T03:00:00.000Z",
      runtimeSelection: gatewayRuntimeSelection,
    };
    const store = persistence({
      listMessages: vi.fn().mockResolvedValue(messages),
      getTurn: vi.fn().mockResolvedValue(
        storedTurn({
          contextSnapshot: runtimeSeed,
        }),
      ),
    });
    const service = createConversationService(store, {
      now: () => new Date("2026-07-12T06:00:00.000Z"),
    });

    const prepared = await service.prepareTurn(actor, "turn-1", [
      "dashboard:role-home",
    ]);

    expect(prepared.snapshot).toEqual({
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-12T06:00:00.000Z",
      runtimeSelection: gatewayRuntimeSelection,
    });
    expect(store.transitionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          contextSnapshot: prepared.snapshot,
        }),
      }),
    );
  });

  it("keeps a rejected turn transition as a state conflict", async () => {
    const store = persistence({
      transitionTurn: vi.fn().mockResolvedValue(false),
    });
    const service = createConversationService(store);

    await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
      code: "turn_state_conflict",
    });
    expect(store.transitionTurn).toHaveBeenCalledTimes(1);
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
        code: "invalid_conversation_context",
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
    ).rejects.toMatchObject({ code: "invalid_conversation_context" });
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
        code: "invalid_conversation_context",
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

    expect(error).toMatchObject({ code: "invalid_conversation_context" });
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
      code: "invalid_conversation_context",
    });
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "root",
      buildSnapshot: () =>
        new Proxy(frozenSnapshot(trustedGatewayContext()), {}),
    },
    {
      name: "nested",
      buildSnapshot: () =>
        frozenSnapshot({
          ...trustedGatewayContext(),
          invocationMetadata: new Proxy({ groundingFactCount: 0 }, {}),
        }),
    },
  ])(
    "rejects a transparent $name proxy before transition",
    async ({ buildSnapshot }) => {
      const store = persistence({
        getTurn: vi.fn().mockResolvedValue(
          storedTurn({
            contextSnapshot: buildSnapshot(),
          }),
        ),
      });
      const service = createConversationService(store);

      await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
        code: "invalid_conversation_context",
      });
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "getPrototypeOf trap on the root",
      buildSnapshot: (trap: () => never) =>
        new Proxy(frozenSnapshot(trustedGatewayContext()), {
          getPrototypeOf: trap,
        }),
    },
    {
      name: "ownKeys trap on a nested object",
      buildSnapshot: (trap: () => never) =>
        frozenSnapshot({
          ...trustedGatewayContext(),
          invocationMetadata: new Proxy(
            { groundingFactCount: 0 },
            { ownKeys: trap },
          ),
        }),
    },
  ])(
    "rejects a hostile $name without executing it",
    async ({ buildSnapshot }) => {
      const trap = vi.fn((): never => {
        throw new Error("Proxy trap executed");
      });
      const store = persistence({
        getTurn: vi.fn().mockResolvedValue(
          storedTurn({
            contextSnapshot: buildSnapshot(trap),
          }),
        ),
      });
      const service = createConversationService(store);

      await expect(service.prepareTurn(actor, "turn-1")).rejects.toMatchObject({
        code: "invalid_conversation_context",
      });
      expect(trap).not.toHaveBeenCalled();
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

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
      code: "invalid_conversation_context",
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
      ).rejects.toMatchObject({ code: "invalid_conversation_context" });
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "NUL in attachment text",
      gatewayContext: {
        ...trustedGatewayContext(),
        attachments: [
          {
            name: "nul.txt",
            mimeType: "text/plain",
            text: "prefix\u0000suffix",
          },
        ],
      },
    },
    {
      name: "NUL in an object key",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { ["nul\u0000key"]: "value" },
      },
    },
    {
      name: "an unpaired high surrogate in a value",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { unsafe: "high-\uD800" },
      },
    },
    {
      name: "an unpaired low surrogate in a value",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { unsafe: "low-\uDC00" },
      },
    },
    {
      name: "an unpaired high surrogate in a key",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { ["high-\uD800"]: "value" },
      },
    },
    {
      name: "an unpaired low surrogate in a key",
      gatewayContext: {
        ...trustedGatewayContext(),
        invocationMetadata: { ["low-\uDC00"]: "value" },
      },
    },
  ])(
    "rejects capture with $name before transition",
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
          gatewayContext as unknown as Parameters<
            typeof service.captureGatewayContext
          >[3],
        ),
      ).rejects.toMatchObject({ code: "invalid_conversation_context" });
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
  );

  it("accepts paired emoji and non-NUL JSON control escapes", async () => {
    const emojiKey = "emoji-\uD83D\uDE80";
    const gatewayContext = {
      ...trustedGatewayContext(),
      invocationMetadata: {
        [emojiKey]: "paired-\uD83D\uDE80",
        controls: "line\ncolumn\tunit-\u0001",
      },
    };
    const store = persistence();
    const service = createConversationService(store);
    const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    };

    const captured = await service.captureGatewayContext(
      actor,
      "turn-1",
      snapshot,
      gatewayContext,
    );

    expect(captured.gatewayContext?.invocationMetadata).toEqual(
      gatewayContext.invocationMetadata,
    );
    expect(store.transitionTurn).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "a tree deeper than the context limit",
      buildMetadata: () => {
        let tree: Record<string, unknown> = { leaf: "value" };
        for (let depth = 0; depth < 70; depth += 1) tree = { child: tree };
        return { tree };
      },
    },
    {
      name: "an array beyond the expanded-node limit",
      buildMetadata: () => ({
        values: Array.from({ length: 100_001 }, () => 0),
      }),
    },
    {
      name: "an object beyond the visited-node limit",
      buildMetadata: () => {
        const values: Record<string, unknown> = {};
        for (let index = 0; index < 100_001; index += 1) {
          values[`key-${index}`] = index;
        }
        return { values };
      },
    },
    {
      name: "a compact shared-reference DAG",
      buildMetadata: () => {
        let node: Record<string, unknown> = { leaf: "value" };
        for (let depth = 0; depth < 16; depth += 1) {
          node = { left: node, right: node };
        }
        return { node };
      },
    },
    {
      name: "serialized JSON beyond the byte budget",
      buildMetadata: () => ({
        payload: "\u0001".repeat(Math.floor((128 * 1024 * 1024) / 6) + 1),
      }),
    },
  ])(
    "rejects capture with $name before transition",
    async ({ buildMetadata }) => {
      const store = persistence();
      const service = createConversationService(store);
      const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
        version: 1,
        summaryVersion: 0,
        messageIds: ["message-user-1"],
        groundingRefs: ["dashboard:role-home"],
        assembledAt: "2026-07-11T03:00:00.000Z",
      };
      const gatewayContext = {
        ...trustedGatewayContext(),
        invocationMetadata: buildMetadata(),
      };

      const error = await service
        .captureGatewayContext(actor, "turn-1", snapshot, gatewayContext)
        .then(
          () => null,
          (reason: unknown) => reason,
        );

      expect(error).toMatchObject({ code: "invalid_conversation_context" });
      expect(store.transitionTurn).not.toHaveBeenCalled();
    },
    30_000,
  );

  it("admits the shared five-attachment maximum within the JSON byte budget", async () => {
    const maxDataChars = Math.ceil((8 * 1024 * 1024 * 4) / 3) + 1024;
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      name: `max-${index + 1}.txt`,
      mimeType: "text/plain",
      sizeBytes: 8 * 1024 * 1024,
      text: "t".repeat(200_000),
      data: "A".repeat(maxDataChars),
    }));
    const store = persistence();
    const service = createConversationService(store);
    const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    };

    const captured = await service.captureGatewayContext(
      actor,
      "turn-1",
      snapshot,
      { ...trustedGatewayContext(), attachments },
    );

    expect(captured.gatewayContext?.attachments).toHaveLength(5);
    expect(store.transitionTurn).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("accepts a near-normal context comfortably within resource bounds", async () => {
    let nested: Record<string, unknown> = { leaf: "value" };
    for (let depth = 0; depth < 12; depth += 1) nested = { child: nested };
    const gatewayContext = {
      ...trustedGatewayContext(),
      invocationMetadata: {
        nested,
        rows: Array.from({ length: 250 }, (_, index) => ({
          index,
          label: `row-${index}`,
        })),
      },
    };
    const store = persistence();
    const service = createConversationService(store);
    const snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]> = {
      version: 1,
      summaryVersion: 0,
      messageIds: ["message-user-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
    };

    const captured = await service.captureGatewayContext(
      actor,
      "turn-1",
      snapshot,
      gatewayContext,
    );

    expect(captured.gatewayContext?.invocationMetadata).toEqual(
      gatewayContext.invocationMetadata,
    );
    expect(store.transitionTurn).toHaveBeenCalledTimes(1);
  });

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

  it("hashes reordered snapshot objects canonically and still detects semantic changes", async () => {
    const gatewayA = {
      ...trustedGatewayContext(),
      responseMetadata: {
        grounding: { alpha: 1, nested: { first: "A", second: "B" } },
        knowledge: { passages: [], source: "kb" },
        retrospectiveDraft: { status: "draft", score: 9 },
      },
      invocationMetadata: {
        requestId: "request-1",
        nested: { first: "A", second: "B" },
      },
    };
    const gatewayB = {
      invocationMetadata: {
        nested: { second: "B", first: "A" },
        requestId: "request-1",
      },
      responseMetadata: {
        retrospectiveDraft: { score: 9, status: "draft" },
        knowledge: { source: "kb", passages: [] },
        grounding: { nested: { second: "B", first: "A" }, alpha: 1 },
      },
      lastUserMessage: "冻结的业务事实",
      primaryProvider: "deepseek" as const,
      mode: "fast" as const,
      attachments: [],
      messages: [
        { content: "可信系统规则", role: "system" as const },
        { content: "冻结的业务事实", role: "user" as const },
      ],
    };
    const snapshotA = {
      version: 11,
      summaryVersion: 5,
      messageIds: ["message-user-1", "message-assistant-1"],
      groundingRefs: ["dashboard:role-home"],
      assembledAt: "2026-07-11T03:00:00.000Z",
      gatewayContext: gatewayA,
    };
    const snapshotB = {
      gatewayContext: gatewayB,
      assembledAt: "2026-07-11T03:00:00.000Z",
      groundingRefs: ["dashboard:role-home"],
      messageIds: ["message-user-1", "message-assistant-1"],
      summaryVersion: 5,
      version: 11,
    };
    const changedSnapshot = {
      ...snapshotB,
      gatewayContext: {
        ...gatewayB,
        invocationMetadata: {
          ...gatewayB.invocationMetadata,
          nested: { second: "changed", first: "A" },
        },
      },
    };
    const reorderedArraySnapshot = {
      ...snapshotB,
      messageIds: ["message-assistant-1", "message-user-1"],
    };
    const transitionHash = async (
      snapshot: NonNullable<StoredConversationTurn["contextSnapshot"]>,
    ) => {
      const store = persistence({
        getTurn: vi
          .fn()
          .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
      });
      const service = createConversationService(store);

      await service.prepareTurn(actor, "turn-1");

      return vi.mocked(store.transitionTurn).mock.calls[0]?.[0].patch
        ?.contextHash;
    };

    const hashA = await transitionHash(snapshotA);
    const hashB = await transitionHash(snapshotB);
    const changedHash = await transitionHash(changedSnapshot);
    const reorderedArrayHash = await transitionHash(reorderedArraySnapshot);

    expect(hashA).toEqual(expect.any(String));
    expect(hashA).toBe(hashB);
    expect(changedHash).not.toBe(hashA);
    expect(reorderedArrayHash).not.toBe(hashA);
  });

  it.each([
    { name: "zero", version: 0 },
    { name: "negative", version: -1 },
    { name: "fractional", version: 1.5 },
    { name: "NaN", version: Number.NaN },
    { name: "non-number", version: "11" },
    { name: "PostgreSQL integer overflow", version: 2_147_483_648 },
    { name: "unsafe huge integer", version: Number.MAX_SAFE_INTEGER + 1 },
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
      code: "invalid_conversation_context",
    });
    expect(store.transitionTurn).not.toHaveBeenCalled();
  });

  it("restores the maximum PostgreSQL integer snapshot version", async () => {
    const snapshot = {
      ...frozenSnapshot(trustedGatewayContext()),
      version: 2_147_483_647,
      summaryVersion: 5,
    };
    const store = persistence({
      getTurn: vi
        .fn()
        .mockResolvedValue(storedTurn({ contextSnapshot: snapshot })),
    });
    const service = createConversationService(store);

    const prepared = await service.prepareTurn(actor, "turn-1");

    expect(prepared.snapshot.version).toBe(2_147_483_647);
    expect(store.transitionTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ contextSnapshot: snapshot }),
      }),
    );
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

  it("returns turn mappings and pending clarify with history for reload", async () => {
    const turn = storedTurn({ status: "failed", errorCode: "provider_failed" });
    const pendingClarify = {
      turnId: "turn-1",
      clarifyId: "66666666-6666-4666-8666-666666666666",
      requestId: "clarify-request-1",
      question: "Which scope should be reviewed?",
      choices: ["Current month", "Current week"],
      allowFreeText: true,
    };
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
      getGatewayState: vi.fn().mockResolvedValue({
        generation: 3,
        summary: {},
        summaryVersion: 0,
        pendingClarify,
      }),
    });
    const service = createConversationService(store);

    const history = await service.getHistory(actor, "conversation-1");

    expect(history.turns).toEqual([{ ...turn, pendingClarify }]);
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

  it("injects actor ownership into Hermes finish, cancel, lease, and state calls", async () => {
    const store = persistence();
    const service = createConversationService(store);

    await service.finishTurnV2(actor, "turn-1", {
      invocationId: "invocation-1",
      outcome: "partial",
      content: "基于部分可用数据。",
      providerName: "deepseek",
      errorCode: null,
      errorSummary: null,
      retryable: false,
      metadata: { missingData: ["settlement"] },
    });
    expect(store.finishTurnV2).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
      invocationId: "invocation-1",
      outcome: "partial",
      content: "基于部分可用数据。",
      providerName: "deepseek",
      errorCode: null,
      errorSummary: null,
      retryable: false,
      metadata: { missingData: ["settlement"] },
    });

    await service.cancelTurn(actor, "conversation-1", "turn-1");
    expect(store.cancelTurnV2).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
    });

    await service.renewLeaseV2(actor, "turn-1");
    expect(store.renewLeaseV2).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
    });

    await expect(
      service.compareAndSwapGatewayState(actor, "conversation-1", 1, {
        generation: 2,
        sessionId: "session-1",
        organizationId: "attacker-org",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(store.compareAndSwapGatewayState).not.toHaveBeenCalled();

    await expect(
      service.compareAndSwapGatewayState(actor, "conversation-1", 1, {
        generation: 2,
        sessionId: "session-1",
      }),
    ).resolves.toBe(2);
    expect(store.compareAndSwapGatewayState).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      expectedGeneration: 1,
      nextState: { generation: 2, sessionId: "session-1" },
    });
  });

  it("injects ownership and validated memory into the atomic v3 finish", async () => {
    const store = persistence();
    const service = createConversationService(store);
    const memoryDelta = {
      goals: [],
      confirmedFacts: [],
      decisions: [],
      unresolvedQuestions: [],
      throughSequence: 4,
    };

    await expect(
      service.finishTurnV3(actor, "turn-1", {
        invocationId: "invocation-1",
        outcome: "complete",
        content: "Completed answer",
        providerName: "deepseek",
        retryable: false,
        metadata: {},
        expectedSummaryVersion: 3,
        memoryDelta,
      }),
    ).resolves.toMatchObject({ memoryStatus: "ready", summaryVersion: 1 });
    expect(store.finishTurnV3).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
      invocationId: "invocation-1",
      outcome: "complete",
      content: "Completed answer",
      providerName: "deepseek",
      errorCode: undefined,
      errorSummary: undefined,
      retryable: false,
      metadata: {},
      expectedSummaryVersion: 3,
      memoryDelta,
    });
  });

  it("tenant-scopes Gateway state, Session search inputs, and summary synchronization", async () => {
    const store = persistence({
      getGatewayState: vi.fn().mockResolvedValue({
        generation: 2,
        sessionId: "session-1",
        summaryVersion: 4,
        summary: { text: "old" },
      }),
      syncConversationSummary: vi.fn().mockResolvedValue(true),
    });
    const service = createConversationService(store);

    await expect(
      service.getGatewayState(actor, "conversation-1"),
    ).resolves.toMatchObject({ generation: 2, sessionId: "session-1" });
    expect(store.getGatewayState).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
    });

    await expect(
      service.syncConversationSummary(actor, "conversation-1", {
        expectedSummaryVersion: 4,
        summary: { text: "official compression" },
      }),
    ).resolves.toBeUndefined();
    expect(store.syncConversationSummary).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      conversationId: "conversation-1",
      expectedSummaryVersion: 4,
      summary: { text: "official compression" },
    });
  });

  it("does not let a runtime finish payload override verified identity or turn", async () => {
    const store = persistence();
    const service = createConversationService(store);
    const maliciousInput = {
      invocationId: "invocation-1",
      outcome: "complete" as const,
      content: "可信回答",
      providerName: "deepseek" as const,
      errorCode: null,
      errorSummary: null,
      retryable: false,
      metadata: {},
      organizationId: "attacker-org",
      ownerUserId: "attacker-user",
      turnId: "attacker-turn",
    };

    await service.finishTurnV2(actor, "turn-1", maliciousInput);

    expect(store.finishTurnV2).toHaveBeenCalledWith({
      organizationId: "org-1",
      ownerUserId: "user-1",
      turnId: "turn-1",
      invocationId: "invocation-1",
      outcome: "complete",
      content: "可信回答",
      providerName: "deepseek",
      errorCode: null,
      errorSummary: null,
      retryable: false,
      metadata: {},
    });
  });

  it("normalizes unknown Hermes persistence failures without leaking internals", async () => {
    const store = persistence({
      cancelTurnV2: vi
        .fn()
        .mockRejectedValue(new Error("cancel_ai_chat_turn SQL failed")),
    });
    const service = createConversationService(store);

    const error = await service
      .cancelTurn(actor, "conversation-1", "turn-1")
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(HermesStateRepositoryError);
    expect(error).toMatchObject({ code: "state_conflict" });
    expect(String(error)).not.toContain("cancel_ai_chat_turn");
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
