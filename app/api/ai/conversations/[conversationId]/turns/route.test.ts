import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();
const createConversationTurnStreamMock = vi.fn();
const executeNativeHermesAssistantMock = vi.fn();
const createGatewayTurnExecutorMock = vi.fn();
const createHermesGatewayClientMock = vi.fn();
const createLegacyTurnExecutorMock = vi.fn();

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const originalEnv = process.env;

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
  createHermesGatewayClient: createHermesGatewayClientMock,
}));

vi.mock("@/features/ai/native-assistant/legacy-turn-executor", () => ({
  createLegacyTurnExecutor: createLegacyTurnExecutorMock,
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
    createGatewayTurnExecutorMock.mockReset();
    createHermesGatewayClientMock.mockReset();
    createLegacyTurnExecutorMock.mockReset();
    process.env = {
      ...originalEnv,
      XINGYAO_HERMES_GATEWAY_ENABLED: "true",
      XINGYAO_HERMES_GATEWAY_ALLOWLIST: `${organizationId}/${userId}`,
      XINGYAO_HERMES_GATEWAY_BASE_URL: "ws://127.0.0.1:8788",
      XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
        "gateway-service-token-that-is-long-enough",
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "true",
    };
    createGatewayTurnExecutorMock.mockReturnValue({
      runtime: "gateway",
      execute: vi.fn(),
    });
    createHermesGatewayClientMock.mockReturnValue({
      createSession: vi.fn(),
      submitPrompt: vi.fn(),
    });
    createLegacyTurnExecutorMock.mockReturnValue({
      runtime: "legacy",
      execute: vi.fn(),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("selects Gateway once before accepting one idempotent user turn", async () => {
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
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service,
    });
    createConversationTurnStreamMock.mockReturnValue(
      new Response("stream", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const { POST, maxDuration } = await import("./route");
    const request = new Request(
      "http://localhost/api/ai/conversations/conversation-1/turns",
      {
        method: "POST",
        body: JSON.stringify({
          content: "瑙ｈ褰撳墠椋庨櫓",
          mode: "deep",
          clientRequestId: "request-123",
        }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });

    expect(maxDuration).toBe(330);
    expect(acceptTurn).toHaveBeenCalledWith(
      { organizationId, userId },
      "conversation-1",
      {
        content: "瑙ｈ褰撳墠椋庨櫓",
        mode: "deep",
        clientRequestId: "request-123",
        attachments: [],
      },
      {
        runtimeSelection: {
          runtime: "gateway",
          protocol: "xingyao-hermes-gateway-v2",
          profile: "hermes-xingyao-v2",
        },
      },
    );
    expect(createGatewayTurnExecutorMock).toHaveBeenCalledTimes(1);
    expect(createLegacyTurnExecutorMock).not.toHaveBeenCalled();
    expect(createConversationTurnStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        request,
        turn,
        attachments: [],
        service: expect.objectContaining({
          acceptTurn,
          prepareTurn: expect.any(Function),
          captureGatewayContext: expect.any(Function),
        }),
        executor: expect.objectContaining({ execute: expect.any(Function) }),
      }),
    );
    expect(createConversationTurnStreamMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "executeLegacyChat",
    );
    expect(executeNativeHermesAssistantMock).not.toHaveBeenCalled();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("rejects a turn without a client request id", async () => {
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { acceptTurn: vi.fn() },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({ content: "瑙ｈ褰撳墠椋庨櫓" }),
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
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { acceptTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({
          content: "瑙ｈ褰撳墠椋庨櫓",
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

  it("selects Legacy for non-allowlisted actors only when Legacy is enabled", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST = `${organizationId}/${otherUserId}`;
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
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { acceptTurn },
    });
    createConversationTurnStreamMock.mockReturnValue(new Response("stream"));
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({
          content: "瑙ｈ褰撳墠椋庨櫓",
          clientRequestId: "request-legacy",
        }),
      }),
      { params: Promise.resolve({ conversationId: "conversation-1" }) },
    );

    expect(response.status).toBe(200);
    expect(acceptTurn).toHaveBeenCalledWith(
      { organizationId, userId },
      "conversation-1",
      expect.any(Object),
      {
        runtimeSelection: {
          runtime: "legacy",
          protocol: "xingyao-legacy-chat-v1",
          profile: "hermes-xingyao-v1+skills.c1755ec71e802748",
        },
      },
    );
    expect(createLegacyTurnExecutorMock).toHaveBeenCalledTimes(1);
    expect(createGatewayTurnExecutorMock).not.toHaveBeenCalled();
  });

  it("returns stable runtime_disabled without accepting a turn when both paths are disabled", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ENABLED = "false";
    process.env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED = "false";
    const acceptTurn = vi.fn();
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { acceptTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({
          content: "瑙ｈ褰撳墠椋庨櫓",
          clientRequestId: "request-disabled",
        }),
      }),
      { params: Promise.resolve({ conversationId: "conversation-1" }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "runtime_disabled",
    });
    expect(acceptTurn).not.toHaveBeenCalled();
    expect(createConversationTurnStreamMock).not.toHaveBeenCalled();
  });

  it("returns a redacted runtime configuration failure without Legacy fallback", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST = `${organizationId}/not-a-user`;
    const acceptTurn = vi.fn();
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { acceptTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/ai/conversations/conversation-1/turns", {
        method: "POST",
        body: JSON.stringify({
          content: "瑙ｈ褰撳墠椋庨櫓",
          clientRequestId: "request-bad-config",
        }),
      }),
      { params: Promise.resolve({ conversationId: "conversation-1" }) },
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "runtime_configuration_invalid" });
    expect(JSON.stringify(body)).not.toContain("not-a-user");
    expect(JSON.stringify(body)).not.toContain("gateway-service-token");
    expect(acceptTurn).not.toHaveBeenCalled();
    expect(createLegacyTurnExecutorMock).not.toHaveBeenCalled();
  });
});
