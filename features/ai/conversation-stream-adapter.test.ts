import { describe, expect, it, vi } from "vitest";

import type { CreatedConversationTurn } from "./conversation-repository";
import { createConversationTurnStream } from "./conversation-stream-adapter";
import { createLegacyTurnExecutor } from "./native-assistant/legacy-turn-executor";

const turn: CreatedConversationTurn = {
  conversationId: "conversation-1",
  turnId: "turn-1",
  userMessageId: "message-user-1",
  assistantMessageId: "message-assistant-1",
  status: "accepted",
  attempt: 1,
  duplicate: false,
};

describe("conversation stream adapter", () => {
  it("rejects duplicate turns without mutating the original execution", async () => {
    const service = serviceDouble({ callOrder: [] });
    const executor = { execute: vi.fn() };
    const response = createConversationTurnStream({
      request: new Request("http://localhost/api/ai/turns"),
      actor: { organizationId: "org-1", userId: "user-1" },
      turn: { ...turn, duplicate: true, status: "generating" },
      attachments: [],
      service,
      executor,
    });

    expect(response.status).toBe(409);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("streams events from a typed ConversationTurnExecutor source", async () => {
    const service = serviceDouble({ callOrder: [] });
    const executor = {
      execute: vi.fn().mockImplementation(async function* () {
        yield {
          type: "turn.started",
          conversationId: "conversation-1",
          turnId: "turn-1",
          userMessageId: "message-user-1",
          assistantMessageId: "message-assistant-1",
        };
        yield {
          type: "response.cancelled",
          conversationId: "conversation-1",
          turnId: "turn-1",
          messageId: "message-assistant-1",
        };
      }),
    };

    const response = createConversationTurnStream({
      request: new Request("http://localhost/api/ai/turns"),
      actor: { organizationId: "org-1", userId: "user-1" },
      turn,
      attachments: [],
      service,
      executor,
    });

    const events = parseSseEvents(await response.text());
    expect(events.map((event) => event.event)).toEqual([
      "turn.started",
      "response.cancelled",
    ]);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        turn,
        service,
      }),
    );
  });

  it("maps legacy chat events to typed events and commits before completion", async () => {
    const callOrder: string[] = [];
    const service = serviceDouble({ callOrder });
    const executeLegacyChat = vi
      .fn()
      .mockImplementation(async (_request, options) => {
        await options.onContextReady({
          messages: [{ role: "user", content: "冻结上下文" }],
          attachments: [],
          mode: "deep",
          primaryProvider: "deepseek",
        });
        await options.onGenerationStarted("deepseek");
        return legacySseResponse([
          ["delta", { content: "处理", providerName: "deepseek" }],
          ["delta", { content: "建议", providerName: "deepseek" }],
          [
            "done",
            {
              message: { role: "assistant", content: "处理建议" },
              providerName: "deepseek",
              invocationId: "invocation-1",
              status: "succeeded",
              grounding: {
                projectHealth: { topProjects: [] },
                suggestedActions: [],
              },
            },
          ],
        ]);
      });

    const response = createConversationTurnStream({
      request: new Request(
        "http://localhost/api/ai/conversations/conversation-1/turns",
        { headers: { cookie: "session=1" } },
      ),
      actor: { organizationId: "org-1", userId: "user-1" },
      turn,
      attachments: [],
      service,
      executor: createLegacyTurnExecutor({ executeLegacyChat }),
    });
    const events = parseSseEvents(await response.text());

    expect(events.map((event) => event.event)).toEqual([
      "turn.started",
      "context.ready",
      "response.delta",
      "response.delta",
      "response.completed",
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      type: "response.completed",
      conversationId: "conversation-1",
      turnId: "turn-1",
      messageId: "message-assistant-1",
      content: "处理建议",
      meta: {
        grounding: {
          projectHealth: { topProjects: [] },
          suggestedActions: [],
        },
      },
    });
    expect(callOrder).toEqual([
      "prepare",
      "capture",
      "generating",
      "validating",
      "complete",
    ]);
    expect(service.prepareTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "turn-1",
      [
        "dashboard:role-home",
        "xingyao:feature-store",
        "knowledge-base",
        "web-search",
      ],
    );
    expect(service.completeTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "turn-1",
      expect.objectContaining({
        metadata: {
          grounding: {
            projectHealth: { topProjects: [] },
            suggestedActions: [],
          },
        },
        invocationId: "invocation-1",
      }),
    );
    const forwarded = await executeLegacyChat.mock.calls[0]?.[0].json();
    expect(executeLegacyChat.mock.calls[0]?.[1]).toMatchObject({
      nativeAssistant: {
        conversationId: "conversation-1",
        invocationId: "turn-1",
      },
    });
    expect(forwarded).toMatchObject({
      messages: [{ role: "user", content: "当前问题" }],
      mode: "deep",
      stream: true,
    });
  });

  it("persists a retryable failed turn before emitting response.failed", async () => {
    const callOrder: string[] = [];
    const service = serviceDouble({ callOrder });
    const executeLegacyChat = vi
      .fn()
      .mockResolvedValue(
        legacySseResponse([
          ["error", { error: "provider timeout", providerName: "deepseek" }],
        ]),
      );

    const response = createConversationTurnStream({
      request: new Request("http://localhost/api/ai/turns"),
      actor: { organizationId: "org-1", userId: "user-1" },
      turn,
      attachments: [],
      service,
      executor: createLegacyTurnExecutor({ executeLegacyChat }),
    });
    const events = parseSseEvents(await response.text());

    expect(events.at(-1)).toMatchObject({
      event: "response.failed",
      data: expect.objectContaining({
        type: "response.failed",
        code: "provider_failed",
        retryable: true,
      }),
    });
    expect(service.failTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "turn-1",
      expect.objectContaining({
        errorCode: "provider_failed",
        errorSummary: "provider timeout",
        retryable: true,
      }),
    );
    expect(callOrder.at(-1)).toBe("fail");
  });

  it("does not emit a terminal event when terminal persistence fails", async () => {
    const service = serviceDouble({ callOrder: [] });
    service.failTurn.mockRejectedValue(new Error("database unavailable"));
    const executeLegacyChat = vi
      .fn()
      .mockRejectedValue(new Error("socket closed"));

    const response = createConversationTurnStream({
      request: new Request("http://localhost/api/ai/turns"),
      actor: { organizationId: "org-1", userId: "user-1" },
      turn,
      attachments: [],
      service,
      executor: createLegacyTurnExecutor({ executeLegacyChat }),
    });

    await expect(response.text()).rejects.toThrow("terminal state");
  });
});

function serviceDouble({ callOrder }: { callOrder: string[] }) {
  return {
    prepareTurn: vi.fn().mockImplementation(async () => {
      callOrder.push("prepare");
      return {
        turn: {
          id: "turn-1",
          conversationId: "conversation-1",
          userMessageId: "message-user-1",
          assistantMessageId: "message-assistant-1",
          mode: "deep",
        },
        messages: [{ role: "user", content: "当前问题" }],
        snapshot: {
          version: 1,
          summaryVersion: 0,
          messageIds: ["message-user-1"],
          groundingRefs: ["dashboard:role-home"],
          assembledAt: "2026-07-11T03:00:00.000Z",
        },
      };
    }),
    markGenerating: vi.fn().mockImplementation(async () => {
      callOrder.push("generating");
    }),
    markValidating: vi.fn().mockImplementation(async () => {
      callOrder.push("validating");
    }),
    completeTurn: vi.fn().mockImplementation(async () => {
      callOrder.push("complete");
    }),
    failTurn: vi.fn().mockImplementation(async () => {
      callOrder.push("fail");
    }),
    renewLease: vi.fn().mockResolvedValue(undefined),
    captureGatewayContext: vi.fn().mockImplementation(async () => {
      callOrder.push("capture");
    }),
  };
}

function legacySseResponse(
  events: Array<[string, Record<string, unknown>]>,
): Response {
  return new Response(
    events
      .map(
        ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function parseSseEvents(body: string) {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}
