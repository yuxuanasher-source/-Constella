import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();
const createConversationTurnStreamMock = vi.fn();
const executeNativeHermesAssistantMock = vi.fn();

vi.mock("@/app/api/ai/conversation-route-context", () => ({
  getAiConversationRouteContext: getRouteContextMock,
  conversationRouteErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    ),
}));

vi.mock("@/features/ai/conversation-stream-adapter", () => ({
  createConversationTurnStream: createConversationTurnStreamMock,
}));

vi.mock("@/features/ai/native-assistant/executor", () => ({
  executeNativeHermesAssistant: executeNativeHermesAssistantMock,
}));

describe("POST /api/ai/conversations/:conversationId/turns", () => {
  beforeEach(() => {
    vi.resetModules();
    getRouteContextMock.mockReset();
    createConversationTurnStreamMock.mockReset();
    executeNativeHermesAssistantMock.mockReset();
  });

  it("accepts one idempotent user turn and starts the protocol stream", async () => {
    const turn = {
      conversationId: "conversation-1",
      turnId: "turn-1",
      userMessageId: "message-user-1",
      assistantMessageId: "message-assistant-1",
      status: "accepted",
      attempt: 1,
      duplicate: false,
    };
    const acceptTurn = vi.fn().mockResolvedValue(turn);
    const service = { acceptTurn };
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service,
    });
    createConversationTurnStreamMock.mockReturnValue(
      new Response("stream", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const { POST } = await import("./route");
    const request = new Request(
      "http://localhost/api/ai/conversations/conversation-1/turns",
      {
        method: "POST",
        body: JSON.stringify({
          content: "解读当前风险",
          mode: "deep",
          clientRequestId: "request-123",
        }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });

    expect(acceptTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "conversation-1",
      {
        content: "解读当前风险",
        mode: "deep",
        clientRequestId: "request-123",
        attachments: [],
      },
    );
    expect(createConversationTurnStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request,
        turn,
        attachments: [],
        service,
        executeLegacyChat: executeNativeHermesAssistantMock,
      }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("rejects a turn without a client request id", async () => {
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service: { acceptTurn: vi.fn() },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({ content: "解读当前风险" }),
      }),
      { params: Promise.resolve({ conversationId: "conversation-1" }) },
    );

    expect(response.status).toBe(400);
    expect(createConversationTurnStreamMock).not.toHaveBeenCalled();
  });

  it("does not execute the model twice for a duplicate idempotency key", async () => {
    const acceptTurn = vi.fn().mockResolvedValue({
      conversationId: "conversation-1",
      turnId: "turn-existing",
      userMessageId: "message-user-existing",
      assistantMessageId: "message-assistant-existing",
      status: "completed",
      attempt: 1,
      duplicate: true,
    });
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service: { acceptTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({
          content: "解读当前风险",
          clientRequestId: "request-duplicate",
        }),
      }),
      { params: Promise.resolve({ conversationId: "conversation-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      reloadConversation: true,
      turn: { turnId: "turn-existing", duplicate: true },
    });
    expect(createConversationTurnStreamMock).not.toHaveBeenCalled();
  });
});
