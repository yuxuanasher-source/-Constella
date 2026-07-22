import { describe, expect, it, vi } from "vitest";

import type { AiConversationMessageDto } from "../conversation-contracts";
import { createGatewayTurnExecutor } from "./gateway-executor";

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

  it("branches retry and regenerate attempts through the recorded Gateway session checkpoint", async () => {
    const service = serviceDouble({
      messages: [message(turn.userMessageId, 1, "user", "completed", "retry this")],
      gatewayGeneration: 2,
    });
    service.getGatewayState.mockResolvedValue({
      generation: 2,
      sessionId: "session-source",
      summaryVersion: 1,
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

    const events = await collect(
      executor.execute({
        request: jsonRequest({ message: "retry this", mode: "fast" }),
        actor,
        turn: { ...turn, attempt: 2 },
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
        checkpoint: expect.objectContaining({ attempt: 2 }),
      }),
    );
    expect(gateway.createSession).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "response.completed",
      content: "branched answer",
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
