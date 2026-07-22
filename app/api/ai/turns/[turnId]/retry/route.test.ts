import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();
const createConversationTurnStreamMock = vi.fn();
const createGatewayTurnExecutorMock = vi.fn();

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

vi.mock("@/features/ai/native-assistant/gateway-executor", () => ({
  createGatewayTurnExecutor: createGatewayTurnExecutorMock,
}));

describe("POST /api/ai/turns/:turnId/retry", () => {
  beforeEach(() => {
    vi.resetModules();
    getRouteContextMock.mockReset();
    createConversationTurnStreamMock.mockReset();
    createGatewayTurnExecutorMock.mockReset();
  });

  it("retries the source turn without accepting a new user message", async () => {
    const retriedTurn = {
      conversationId: "conversation-1",
      turnId: "turn-2",
      userMessageId: "message-user-1",
      assistantMessageId: "message-assistant-2",
      status: "accepted",
      attempt: 2,
      duplicate: false,
    };
    const retryTurn = vi.fn().mockResolvedValue(retriedTurn);
    const acceptTurn = vi.fn();
    const service = { retryTurn, acceptTurn };
    const executor = { execute: vi.fn() };
    createGatewayTurnExecutorMock.mockReturnValue(executor);
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId: "org-1", userId: "user-1" },
      service,
    });
    createConversationTurnStreamMock.mockReturnValue(new Response("stream"));
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/ai/turns/turn-1/retry", {
      method: "POST",
      body: JSON.stringify({ clientRequestId: "retry-request-123" }),
    });

    await POST(request, { params: Promise.resolve({ turnId: "turn-1" }) });

    expect(retryTurn).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      "turn-1",
      { clientRequestId: "retry-request-123" },
    );
    expect(acceptTurn).not.toHaveBeenCalled();
    expect(createConversationTurnStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: retriedTurn,
        attachments: [],
        executor,
      }),
    );
    expect(createGatewayTurnExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({ service }),
    );
  });
});
