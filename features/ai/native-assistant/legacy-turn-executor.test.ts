import { describe, expect, it, vi } from "vitest";

import { createLegacyTurnExecutor } from "./legacy-turn-executor";

describe("legacy conversation turn executor", () => {
  it("wraps the existing /api/ai/chat stream without changing its behavior", async () => {
    const service = serviceDouble();
    const executeLegacyChat = vi.fn().mockResolvedValue(
      legacySseResponse([
        ["delta", { content: "hello ", providerName: "hermes" }],
        [
          "done",
          {
            message: { role: "assistant", content: "hello world" },
            providerName: "hermes",
            invocationId: "invocation-1",
            grounding: { source: "legacy" },
          },
        ],
      ]),
    );
    const executor = createLegacyTurnExecutor({ executeLegacyChat });

    const events = await collect(
      executor.execute({
        request: new Request("http://localhost/api/ai/turns", {
          headers: { cookie: "session=1" },
        }),
        actor: { organizationId: "org-1", userId: "user-1" },
        turn: {
          conversationId: "conversation-1",
          turnId: "turn-1",
          userMessageId: "message-user-1",
          assistantMessageId: "message-assistant-1",
          status: "accepted",
          attempt: 1,
          duplicate: false,
        },
        attachments: [],
        service,
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "context.ready",
      "response.delta",
      "response.completed",
    ]);
    expect(service.completeTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "turn-1",
      expect.objectContaining({
        content: "hello world",
        invocationId: "invocation-1",
      }),
    );
    expect(await executeLegacyChat.mock.calls[0]?.[0].json()).toMatchObject({
      messages: [{ role: "user", content: "question" }],
      stream: true,
    });
  });
});

function serviceDouble() {
  return {
    prepareTurn: vi.fn().mockResolvedValue({
      turn: { mode: "fast" },
      messages: [{ role: "user", content: "question" }],
      snapshot: {
        version: 1,
        summaryVersion: 0,
        messageIds: ["message-user-1"],
        groundingRefs: [],
        assembledAt: "2026-07-22T08:00:00.000Z",
      },
    }),
    captureGatewayContext: vi.fn().mockResolvedValue(undefined),
    markGenerating: vi.fn().mockResolvedValue(undefined),
    markValidating: vi.fn().mockResolvedValue(undefined),
    completeTurn: vi.fn().mockResolvedValue(undefined),
    failTurn: vi.fn().mockResolvedValue(undefined),
    renewLease: vi.fn().mockResolvedValue(undefined),
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

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
