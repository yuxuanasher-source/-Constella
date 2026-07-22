import { describe, expect, it, vi } from "vitest";

import type { AiConversationMessageDto } from "../conversation-contracts";
import {
  createGatewayTurnExecutor,
  createHermesGatewayClient,
} from "./gateway-executor";

const actor = {
  organizationId: "33333333-3333-4333-8333-333333333333",
  userId: "22222222-2222-4222-8222-222222222222",
};

const turn = {
  conversationId: "44444444-4444-4444-8444-444444444444",
  turnId: "66666666-6666-4666-8666-666666666666",
  userMessageId: "77777777-7777-4777-8777-777777777777",
  assistantMessageId: "88888888-8888-4888-8888-888888888888",
  status: "accepted" as const,
  attempt: 1,
  duplicate: false,
};

describe("native Hermes Gateway executor", () => {
  it("freezes actor context, rebuilds a missing Gateway session from the product ledger, and CASes provider state", async () => {
    const service = serviceDouble({
      messages: [
        message("m-user-1", 1, "user", "completed", "first question"),
        message("m-tool-1", 2, "tool", "completed", "tool transcript", {
          toolName: "projects.search",
          updatedAt: "2026-07-20T08:00:00.000Z",
          live: true,
        }),
        message("m-other-user", 3, "user", "completed", "attacker state", {
          ownerUserId: "attacker",
        }),
        message(turn.userMessageId, 4, "user", "completed", "current question"),
      ],
      gatewayGeneration: 4,
    });
    const gateway = gatewayDouble([
      { type: "activity", label: "Reading project summary", status: "running", reasoning: "private chain" },
      { type: "tool.started", toolCallId: "tool-1", toolName: "projects.search", label: "Project search" },
      {
        type: "tool.completed",
        toolCallId: "tool-1",
        toolName: "projects.search",
        status: "completed",
        label: "Project search",
        observedAt: "2026-07-22T09:00:00.000Z",
        evidenceRefs: ["project:1"],
      },
      { type: "text.delta", delta: "Based on the available record, " },
      {
        type: "tool.completed",
        toolCallId: "tool-2",
        toolName: "settlements.summary",
        status: "denied",
        label: "Settlement summary",
        observedAt: "2026-07-22T09:00:01.000Z",
        missing: ["settlements.summary"],
      },
      { type: "completed", sessionId: "session-rebuilt", summary: { text: "current question answered" } },
    ]);

    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
      now: () => new Date("2026-07-22T09:00:02.000Z"),
      personalMemoryRevision: 7,
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "current question", mode: "deep" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(service.captureGatewayContext).toHaveBeenCalledWith(
      actor,
      turn.turnId,
      expect.objectContaining({ version: 1 }),
      expect.objectContaining({
        messages: [
          { role: "user", content: "first question" },
          { role: "tool", content: "tool transcript" },
          { role: "user", content: "current question" },
        ],
        invocationMetadata: expect.objectContaining({
          personalMemoryRevision: 7,
          sessionId: "session-rebuilt",
          gatewayCheckpoint: expect.objectContaining({
            sessionId: "session-rebuilt",
            turnId: turn.turnId,
          }),
        }),
      }),
    );
    expect(gateway.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: actor.userId,
          organizationId: actor.organizationId,
          conversationId: turn.conversationId,
          invocationId: turn.turnId,
          pageContext: { pageType: "global", objectIds: [] },
        }),
        budget: expect.objectContaining({ maxIterations: 90 }),
        personalMemoryRevision: 7,
        transcript: [
          { role: "user", content: "first question" },
          {
            role: "tool",
            content: "tool transcript",
            metadata: expect.objectContaining({
              historical: true,
              updatedAt: "2026-07-20T08:00:00.000Z",
            }),
          },
          { role: "user", content: "current question" },
        ],
      }),
    );
    expect(service.compareAndSwapGatewayState).toHaveBeenCalledWith(
      actor,
      turn.conversationId,
      4,
      expect.objectContaining({
        generation: 5,
        sessionId: "session-rebuilt",
        provider: "hermes",
        model: "hermes-official-gateway",
      }),
    );
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "context.ready",
      "activity.updated",
      "tool.started",
      "tool.completed",
      "response.delta",
      "tool.completed",
      "response.completed",
    ]);
    expect(events[2]).not.toHaveProperty("reasoning");
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      outcome: "partial",
      evidence: ["project:1"],
      missing: ["settlements.summary"],
      observationTimes: {
        firstObservedAt: "2026-07-22T09:00:00.000Z",
        lastObservedAt: "2026-07-22T09:00:01.000Z",
      },
    });
    expect(service.finishTurnV2).toHaveBeenCalledWith(
      actor,
      turn.turnId,
      expect.objectContaining({
        outcome: "partial",
        content: "Based on the available record, ",
        providerName: "hermes",
        errorCode: null,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("root-capability-secret");
  });

  it("issues one root invocation capability per turn and passes it only to Gateway calls", async () => {
    const service = serviceDouble({
      messages: [
        message(turn.userMessageId, 1, "user", "completed", "current question"),
      ],
    });
    const gateway = gatewayDouble([
      { type: "text.delta", delta: "answer" },
      { type: "completed", sessionId: "session-rebuilt" },
    ]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
      now: () => new Date("2026-07-22T09:00:02.000Z"),
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "current question", mode: "deep" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(service.issueGatewayRootCapability).toHaveBeenCalledTimes(1);
    expect(service.issueGatewayRootCapability).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        actor: expect.objectContaining({ invocationId: turn.turnId }),
        mode: "deep",
        serverAllowedTools: expect.arrayContaining([
          "xingyao_get_current_context",
          "xingyao_get_settlement_summary",
        ]),
        aiStateWritesAllowed: false,
      }),
    );
    expect(gateway.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ invocationCapability: "root-capability-secret" }),
    );
    expect(gateway.submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ invocationCapability: "root-capability-secret" }),
    );
    expect(service.captureGatewayContext).toHaveBeenCalledWith(
      actor,
      turn.turnId,
      expect.anything(),
      expect.objectContaining({
        invocationMetadata: expect.objectContaining({
          capabilityId: "capability-1",
          capabilityExpiresAt: "2026-07-22T09:02:00.000Z",
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("root-capability-secret");
  });

  it("fails closed when root invocation capability issuance is unavailable", async () => {
    const service = serviceDouble({
      messages: [
        message(turn.userMessageId, 1, "user", "completed", "current question"),
      ],
    });
    service.issueGatewayRootCapability.mockRejectedValue(
      new Error("secret failure"),
    );
    const gateway = gatewayDouble([]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "current question", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(gateway.createSession).not.toHaveBeenCalled();
    expect(gateway.submitPrompt).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "response.failed",
      code: "gateway_capability_unavailable",
    });
    expect(JSON.stringify(events)).not.toContain("secret failure");
  });

  it("uses a persisted Gateway snapshot on resume so later messages cannot alter the turn", async () => {
    const frozenGatewayContext = {
      messages: [{ role: "user" as const, content: "frozen question" }],
      attachments: [],
      mode: "fast" as const,
      primaryProvider: "hermes" as const,
      lastUserMessage: "frozen question",
      responseMetadata: {
        grounding: {},
        knowledge: {},
        retrospectiveDraft: null,
      },
      invocationMetadata: {
        actor: { ...actor, role: "finance" },
        budget: { maxIterations: 24 },
        personalMemoryRevision: 3,
        sessionId: "session-frozen",
        gatewayCheckpoint: {
          sessionId: "session-frozen",
          turnId: turn.turnId,
          checkpointId: "checkpoint-frozen",
        },
      },
    };
    const service = serviceDouble({
      messages: [
        message(turn.userMessageId, 1, "user", "completed", "frozen question"),
        message("later-message", 2, "user", "completed", "late mutation"),
      ],
    });
    service.prepareTurn.mockResolvedValue({
      turn: { id: turn.turnId, conversationId: turn.conversationId, mode: "fast" },
      messages: [{ role: "user", content: "frozen question" }],
      snapshot: {
        version: 2,
        summaryVersion: 1,
        messageIds: [turn.userMessageId],
        groundingRefs: [],
        assembledAt: "2026-07-22T08:59:59.000Z",
        gatewayContext: frozenGatewayContext,
      },
    });
    const gateway = gatewayDouble([
      { type: "response.output_text.delta", delta: "frozen answer" },
      { type: "turn.terminal", status: "completed" },
    ]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    await collect(
      executor.execute({
        request: jsonRequest({ message: "late mutation", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(service.listMessages).not.toHaveBeenCalled();
    expect(service.captureGatewayContext).not.toHaveBeenCalled();
    expect(gateway.submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "frozen question",
        sessionId: "session-frozen",
      }),
    );
  });

  it("persists failed partial text with a stable trace code and never fabricates completion on provider failure", async () => {
    const service = serviceDouble({ messages: [message(turn.userMessageId, 1, "user", "completed", "hello")] });
    const gateway = gatewayDouble([
      { type: "text.delta", delta: "partial text" },
      { type: "failed", code: "model_timeout", retryable: true },
    ]);

    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "hello", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "context.ready",
      "response.delta",
      "response.failed",
    ]);
    expect(service.finishTurnV2).toHaveBeenCalledWith(
      actor,
      turn.turnId,
      expect.objectContaining({
        outcome: "failed",
        content: "partial text",
        providerName: "hermes",
        errorCode: "gateway_model_timeout",
        retryable: true,
        metadata: expect.objectContaining({
          traceCode: "gateway_model_timeout",
          provider: "hermes",
          model: "hermes-official-gateway",
        }),
      }),
    );
    expect(gateway.submitPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hermes", model: "hermes-official-gateway" }),
    );
    expect(gateway.submitPrompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "createSession rejection",
      gatewayPatch: {
        createSession: vi.fn().mockRejectedValue(new Error("network secret details")),
      },
      gatewayEvents: undefined,
      expectedCode: "gateway_session_create_failed",
    },
    {
      name: "CAS conflict",
      servicePatch: {
        compareAndSwapGatewayState: vi.fn().mockRejectedValue(new Error("hermes_state_conflict")),
      },
      gatewayEvents: undefined,
      expectedCode: "gateway_state_conflict",
    },
    {
      name: "iterator throw after delta",
      gatewayPatch: {
        submitPrompt: vi.fn().mockImplementation(async function* () {
          yield { type: "response.output_text.delta", delta: "partial" };
          throw new Error("provider stack trace");
        }),
      },
      servicePatch: undefined,
      expectedCode: "gateway_stream_failed",
      expectedContent: "partial",
    },
  ])(
    "persists response.failed for $name",
    async ({
      gatewayPatch,
      servicePatch,
      gatewayEvents,
      expectedCode,
      expectedContent = "",
    }) => {
      const service = serviceDouble({
        messages: [message(turn.userMessageId, 1, "user", "completed", "hello")],
      });
      Object.assign(service, servicePatch);
      const gateway = {
        ...gatewayDouble(
          gatewayEvents ?? [
            { type: "response.output_text.delta", delta: "unused" },
            { type: "turn.terminal", status: "completed" },
          ],
        ),
        ...gatewayPatch,
      };
      const executor = createGatewayTurnExecutor({
        service,
        gateway,
        auth: { ...actor, role: "finance" },
        provider: "hermes",
        model: "hermes-official-gateway",
      });

      const events = await collect(
        executor.execute({
          request: jsonRequest({ message: "hello", mode: "fast" }),
          actor,
          turn,
          attachments: [],
          service: {} as never,
        }),
      );

      expect(events.at(-1)).toMatchObject({
        type: "response.failed",
        code: expectedCode,
      });
      expect(service.finishTurnV2).toHaveBeenLastCalledWith(
        actor,
        turn.turnId,
        expect.objectContaining({
          outcome: "failed",
          content: expectedContent,
          errorCode: expectedCode,
          metadata: expect.not.objectContaining({
            error: expect.stringContaining("secret"),
          }),
        }),
      );
    },
  );

  it("does not advance summary if terminal completion persistence fails", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "hello")],
      gatewayGeneration: 8,
    });
    service.getGatewayState.mockResolvedValue({
      generation: 8,
      sessionId: "session-current",
      summaryVersion: 3,
      summary: { text: "previous" },
    });
    service.finishTurnV2
      .mockRejectedValueOnce(new Error("finish failed"))
      .mockResolvedValueOnce(undefined);
    const gateway = gatewayDouble([
      { type: "response.output_text.delta", delta: "answer" },
      { type: "turn.terminal", status: "completed", summary: { text: "next" } },
    ]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "hello", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(service.syncConversationSummary).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "response.failed",
      code: "gateway_terminal_persist_failed",
    });
  });

  it("emits the same terminal result that finishTurnV2 persisted when summary sync fails", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "hello")],
    });
    service.getGatewayState.mockResolvedValue({
      generation: 0,
      summaryVersion: 3,
      summary: { text: "previous" },
    });
    service.syncConversationSummary.mockRejectedValue(new Error("version conflict"));
    const gateway = gatewayDouble([
      { type: "text.delta", delta: "done" },
      { type: "completed", sessionId: "session-rebuilt", summary: { text: "next" } },
    ]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "hello", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(service.finishTurnV2.mock.invocationCallOrder[0]).toBeLessThan(
      service.syncConversationSummary.mock.invocationCallOrder[0],
    );
    const finalEvent = events.at(-1);
    const persisted = service.finishTurnV2.mock.calls[0]?.[2];
    expect(finalEvent).toMatchObject({
      type: "response.completed",
      outcome: persisted?.outcome,
      content: persisted?.content,
      meta: persisted?.metadata,
    });
    expect(finalEvent).not.toMatchObject({
      meta: expect.objectContaining({ summarySync: expect.anything() }),
    });
  });

  it("branches retry and regenerate attempts through the recorded Gateway session checkpoint", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "retry this")],
      gatewayGeneration: 2,
    });
    service.getSourceGatewayCheckpoint.mockResolvedValue({
      sessionId: "session-source",
      checkpointId: "checkpoint-source",
      turnId: "source-turn",
      conversationId: turn.conversationId,
      ownerUserId: actor.userId,
      organizationId: actor.organizationId,
    });
    const gateway = gatewayDouble([
      { type: "text.delta", delta: "branched answer" },
      { type: "completed", sessionId: "session-branch" },
    ]);
    gateway.branchSession.mockResolvedValue({ sessionId: "session-branch" });
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });
    const retryTurn = { ...turn, attempt: 2, retryOfTurnId: "source-turn" };

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "retry this", mode: "fast" }),
        actor,
        turn: retryTurn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(gateway.branchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-source",
        actor: expect.objectContaining({
          userId: actor.userId,
          organizationId: actor.organizationId,
        }),
        checkpoint: expect.objectContaining({
          checkpointId: "checkpoint-source",
          sourceTurnId: "source-turn",
        }),
      }),
    );
    expect(gateway.createSession).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      content: "branched answer",
    });
  });

  it("refuses to branch from another actor or conversation checkpoint", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "retry this")],
    });
    service.getSourceGatewayCheckpoint.mockResolvedValue({
      sessionId: "session-attacker",
      checkpointId: "checkpoint-attacker",
      turnId: "source-turn",
      conversationId: "attacker-conversation",
      ownerUserId: "attacker-user",
      organizationId: actor.organizationId,
    });
    const gateway = gatewayDouble([]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });
    const retryTurn = { ...turn, attempt: 2, retryOfTurnId: "source-turn" };

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "retry this", mode: "fast" }),
        actor,
        turn: retryTurn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(gateway.branchSession).not.toHaveBeenCalled();
    expect(gateway.createSession).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "response.failed",
      code: "gateway_checkpoint_invalid",
    });
  });

  it("adapts official HermesGatewayEvent envelopes into product outcome evidence", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "hello")],
    });
    const gateway = gatewayDouble([
      officialEvent("tool.start", {
        toolCallId: "11111111-1111-4111-8111-111111111111",
        name: "xingyao_get_settlement_summary",
        label: "Settlement summary",
      }),
      officialEvent("tool.complete", {
        toolCallId: "11111111-1111-4111-8111-111111111111",
        name: "xingyao_get_settlement_summary",
        status: "error",
        summary: "Settlement summary",
        todos: [],
        metadata: gatewayMetadata({
          missingData: ["settlement batch"],
          permissionDenials: ["settlements.summary"],
          updatedAt: "2026-07-22T09:00:03.000Z",
          evidenceRefs: ["project:1"],
        }),
      }),
      officialEvent("message.delta", { text: "limited answer" }),
      officialEvent("turn.terminal", {
        outcome: "partial",
        message: "limited answer",
        metadata: gatewayMetadata({
          missingData: ["settlement batch"],
          permissionDenials: ["settlements.summary"],
          updatedAt: "2026-07-22T09:00:03.000Z",
          evidenceRefs: ["project:1"],
        }),
      }),
    ]);
    const executor = createGatewayTurnExecutor({
      service,
      gateway,
      auth: { ...actor, role: "finance" },
      provider: "hermes",
      model: "hermes-official-gateway",
    });

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "hello", mode: "fast" }),
        actor,
        turn,
        attachments: [],
        service: {} as never,
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        status: "denied",
        evidence: ["project:1"],
        missing: ["settlement batch", "settlements.summary"],
        observedAt: "2026-07-22T09:00:03.000Z",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      outcome: "partial",
      evidence: ["project:1"],
      missing: ["settlement batch", "settlements.summary"],
      observationTimes: {
        firstObservedAt: "2026-07-22T09:00:03.000Z",
        lastObservedAt: "2026-07-22T09:00:03.000Z",
      },
    });
  });

  it("uses the official Gateway session adapter for production client calls", async () => {
    const session = {
      sessionId: "session-official",
      events: gatewayDouble([
        officialEvent("message.delta", { text: "official" }),
        officialEvent("turn.terminal", {
          outcome: "complete",
          message: "official",
          metadata: gatewayMetadata({ evidenceRefs: ["trace:1"] }),
        }),
      ]).submitPrompt({}),
      close: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const openSession = vi.fn().mockResolvedValue(session);
    const createActorAssertion = vi.fn().mockResolvedValue("actor.assertion");
    const client = createHermesGatewayClient({
      config: {
        url: "ws://127.0.0.1:8787",
        serviceToken: "gateway-service-token-that-is-long-enough",
        timeouts: {
          connectMs: 10,
          readyMs: 10,
          rpcMs: 10,
          idleMs: 10,
          heartbeatMs: 10,
        },
      },
      actorAssertionConfig: {
        baseUrl: "http://127.0.0.1:8788",
        serviceToken: "runtime-service-token-that-is-long-enough",
        privateKeyPem: "unused-by-test",
        keyId: "test-key",
      },
      openSession,
      createActorAssertion,
    });

    await client.createSession({
      actor: gatewayActor(),
      conversationId: turn.conversationId,
      invocationCapability: "root-capability-secret",
    });
    const events = await collect(
      client.submitPrompt({
        sessionId: "session-official",
        prompt: "hello",
        actor: gatewayActor(),
        provider: "hermes",
        model: "hermes-official-gateway",
        mode: "fast",
        conversationId: turn.conversationId,
        invocationCapability: "root-capability-secret",
      }),
    );

    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAssertion: "actor.assertion",
        invocationCapability: "root-capability-secret",
        conversationId: turn.conversationId,
      }),
    );
    expect(session.rpc).toHaveBeenCalledWith(
      "prompt.submit",
      expect.objectContaining({
        conversationId: turn.conversationId,
        text: "hello",
        mode: "fast",
      }),
    );
    expect(events).toHaveLength(2);
    expect(JSON.stringify(openSession.mock.calls)).not.toContain(
      "/v1/xingyao/gateway",
    );
  });

  it("reopens the branched official Gateway session before prompt submission", async () => {
    const sourceSession = {
      sessionId: "session-source",
      events: gatewayDouble([]).submitPrompt({}),
      close: vi.fn(),
      branch: vi.fn().mockResolvedValue({ sessionId: "session-branch" }),
      rpc: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const branchedSession = {
      sessionId: "session-branch",
      events: gatewayDouble([
        officialEvent("message.delta", { text: "branched" }),
        officialEvent("turn.terminal", {
          outcome: "complete",
          message: "branched",
          metadata: gatewayMetadata(),
        }),
      ]).submitPrompt({}),
      close: vi.fn(),
      branch: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ accepted: true }),
    };
    const openSession = vi
      .fn()
      .mockResolvedValueOnce(sourceSession)
      .mockResolvedValueOnce(branchedSession);
    const client = createHermesGatewayClient({
      config: {
        url: "ws://127.0.0.1:8787",
        serviceToken: "gateway-service-token-that-is-long-enough",
        timeouts: {
          connectMs: 10,
          readyMs: 10,
          rpcMs: 10,
          idleMs: 10,
          heartbeatMs: 10,
        },
      },
      actorAssertionConfig: {
        baseUrl: "http://127.0.0.1:8788",
        serviceToken: "runtime-service-token-that-is-long-enough",
        privateKeyPem: "unused-by-test",
        keyId: "test-key",
      },
      openSession,
      createActorAssertion: vi.fn().mockResolvedValue("actor.assertion"),
    });

    const branch = await client.branchSession?.({
      sessionId: "session-source",
      actor: gatewayActor(),
      conversationId: turn.conversationId,
      invocationCapability: "root-capability-secret",
    });
    const events = await collect(
      client.submitPrompt({
        sessionId: branch?.sessionId,
        prompt: "retry",
        actor: gatewayActor(),
        provider: "hermes",
        model: "hermes-official-gateway",
        mode: "fast",
        conversationId: turn.conversationId,
        invocationCapability: "root-capability-secret",
      }),
    );

    expect(branch).toEqual({ sessionId: "session-branch" });
    expect(openSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: "session-branch" }),
    );
    expect(sourceSession.rpc).not.toHaveBeenCalledWith(
      "prompt.submit",
      expect.anything(),
    );
    expect(branchedSession.rpc).toHaveBeenCalledWith(
      "prompt.submit",
      expect.objectContaining({ text: "retry" }),
    );
    expect((events.at(-1) as ReturnType<typeof officialEvent> | undefined)?.params).toMatchObject({
      type: "turn.terminal",
      sessionId: "session-official",
    });
  });

  it("classifies complete, partial, and blocked outcomes from tool observations", async () => {
    const cases = [
      {
        toolEvents: [] as unknown[],
        expected: "complete",
      },
      {
        toolEvents: [
          {
            type: "tool.completed",
            toolCallId: "tool-1",
            toolName: "projects.summary",
            status: "failed",
            missing: ["projects.summary"],
          },
          {
            type: "tool.completed",
            toolCallId: "tool-2",
            toolName: "projects.search",
            status: "completed",
            evidenceRefs: ["project:1"],
          },
        ],
        expected: "partial",
      },
      {
        toolEvents: [
          {
            type: "tool.completed",
            toolCallId: "tool-1",
            toolName: "settlements.summary",
            status: "denied",
            critical: true,
            missing: ["settlements.summary"],
          },
          {
            type: "tool.completed",
            toolCallId: "tool-2",
            toolName: "projects.summary",
            status: "failed",
            critical: true,
            missing: ["projects.summary"],
          },
        ],
        expected: "blocked",
      },
    ];

    for (const testCase of cases) {
      const service = serviceDouble({ messages: [message(turn.userMessageId, 1, "user", "completed", "hello")] });
      const gateway = gatewayDouble([
        ...testCase.toolEvents,
        { type: "text.delta", delta: "answer" },
        { type: "completed", sessionId: "session-1" },
      ]);
      const executor = createGatewayTurnExecutor({
        service,
        gateway,
        auth: { ...actor, role: "finance" },
        provider: "hermes",
        model: "hermes-official-gateway",
      });

      const events = await collect(
        executor.execute({
          request: jsonRequest({ message: "hello", mode: "fast" }),
          actor,
          turn,
          attachments: [],
          service: {} as never,
        }),
      );

      expect(events.at(-1)).toMatchObject({
        type: "response.completed",
        outcome: testCase.expected,
      });
    }
  });
});

function serviceDouble({
  messages,
  gatewayGeneration = 0,
}: {
  messages: AiConversationMessageDto[];
  gatewayGeneration?: number;
}) {
  return {
    prepareTurn: vi.fn().mockResolvedValue({
      turn: {
        id: turn.turnId,
        conversationId: turn.conversationId,
        userMessageId: turn.userMessageId,
        assistantMessageId: turn.assistantMessageId,
        mode: "deep",
      },
      messages: [],
      snapshot: {
        version: 1,
        summaryVersion: 0,
        messageIds: messages.map((item) => item.id),
        groundingRefs: [],
        assembledAt: "2026-07-22T08:59:59.000Z",
      },
    }),
    listMessages: vi.fn().mockResolvedValue(messages),
    getGatewayState: vi.fn().mockResolvedValue({ generation: gatewayGeneration }),
    compareAndSwapGatewayState: vi.fn().mockResolvedValue(gatewayGeneration + 1),
    syncConversationSummary: vi.fn().mockResolvedValue(true),
    captureGatewayContext: vi.fn().mockImplementation(async (_actor, _turnId, snapshot, gatewayContext) => ({
      ...snapshot,
      gatewayContext,
    })),
    issueGatewayRootCapability: vi.fn().mockResolvedValue({
      capabilityId: "capability-1",
      invocationCapability: "root-capability-secret",
      expiresAt: "2026-07-22T09:02:00.000Z",
    }),
    getSourceGatewayCheckpoint: vi.fn().mockResolvedValue(null),
    finishTurnV2: vi.fn().mockResolvedValue(undefined),
    renewLeaseV2: vi.fn().mockResolvedValue(undefined),
  };
}

function gatewayDouble(events: unknown[]) {
  return {
    createSession: vi.fn().mockResolvedValue({ sessionId: "session-rebuilt" }),
    branchSession: vi.fn(),
    submitPrompt: vi.fn().mockImplementation(async function* () {
      for (const event of events) yield event;
    }),
  };
}

function message(
  id: string,
  sequence: number,
  role: AiConversationMessageDto["role"],
  status: AiConversationMessageDto["status"],
  content: string,
  metadata: Record<string, unknown> = {},
): AiConversationMessageDto {
  return {
    id,
    conversationId: turn.conversationId,
    sequence,
    role,
    status,
    content,
    parentMessageId: null,
    metadata,
    createdAt: "2026-07-22T08:00:00.000Z",
    updatedAt: "2026-07-22T08:00:00.000Z",
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/turns", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function gatewayActor() {
  return {
    userId: actor.userId,
    organizationId: actor.organizationId,
    role: "finance" as const,
    conversationId: turn.conversationId,
    invocationId: turn.turnId,
    allowedReadScopes: ["context.read", "settlements.summary"] as const,
    enabledSkillVersions: [],
    skillGrantsHash:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    profileVersion: "hermes-xingyao-v2",
    pageContext: { pageType: "global", objectIds: [] },
  };
}

function officialEvent(type: string, payload: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      type,
      sessionId: "session-official",
      invocationId: turn.turnId,
      sequence: 1,
      payload,
    },
  };
}

function gatewayMetadata(
  overrides: Partial<{
    evidenceRefs: string[];
    sourceLabels: string[];
    updatedAt: string;
    missingData: string[];
    permissionDenials: string[];
    truncated: boolean;
  }> = {},
) {
  return {
    evidenceRefs: [],
    sourceLabels: [],
    updatedAt: "2026-07-22T09:00:03.000Z",
    missingData: [],
    permissionDenials: [],
    truncated: false,
    ...overrides,
  };
}
