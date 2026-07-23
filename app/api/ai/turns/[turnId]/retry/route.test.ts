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

describe("POST /api/ai/turns/:turnId/retry", () => {
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

  it("selects Gateway for an allowlisted retry before creating the retry turn", async () => {
    const retriedTurn = acceptedTurn();
    const retryTurn = vi.fn().mockResolvedValue(retriedTurn);
    const acceptTurn = vi.fn();
    const service = { retryTurn, acceptTurn };
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service,
    });
    createConversationTurnStreamMock.mockReturnValue(new Response("stream"));
    const { POST } = await import("./route");

    const response = await POST(retryRequest("retry-request-123"), {
      params: Promise.resolve({ turnId: "turn-1" }),
    });

    expect(response.status).toBe(200);
    expect(retryTurn).toHaveBeenCalledWith(
      { organizationId, userId },
      "turn-1",
      { clientRequestId: "retry-request-123" },
      {
        runtimeSelection: {
          runtime: "gateway",
          protocol: "xingyao-hermes-gateway-v2",
          profile: "hermes-xingyao-v2",
        },
      },
    );
    expect(acceptTurn).not.toHaveBeenCalled();
    expect(createGatewayTurnExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceTurnId: "turn-1" }),
    );
    expect(createLegacyTurnExecutorMock).not.toHaveBeenCalled();
    expect(createConversationTurnStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: retriedTurn,
        attachments: [],
        service,
        executor: expect.objectContaining({ execute: expect.any(Function) }),
      }),
    );
    expect(createConversationTurnStreamMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "executeLegacyChat",
    );
    expect(executeNativeHermesAssistantMock).not.toHaveBeenCalled();
  });

  it("selects Legacy for a retry when Gateway is disabled and Legacy is enabled", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ENABLED = "false";
    process.env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED = "true";
    const retryTurn = vi.fn().mockResolvedValue(acceptedTurn());
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { retryTurn },
    });
    createConversationTurnStreamMock.mockReturnValue(new Response("stream"));
    const { POST } = await import("./route");

    const response = await POST(retryRequest("retry-request-legacy"), {
      params: Promise.resolve({ turnId: "turn-1" }),
    });

    expect(response.status).toBe(200);
    expect(retryTurn).toHaveBeenCalledWith(
      { organizationId, userId },
      "turn-1",
      { clientRequestId: "retry-request-legacy" },
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

  it("fails closed before retryTurn for malformed Gateway allowlist", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST = `${organizationId}/not-a-user`;
    const retryTurn = vi.fn();
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { retryTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(retryRequest("retry-request-bad-config"), {
      params: Promise.resolve({ turnId: "turn-1" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "runtime_configuration_invalid",
    });
    expect(retryTurn).not.toHaveBeenCalled();
    expect(createConversationTurnStreamMock).not.toHaveBeenCalled();
  });

  it("fails closed before retryTurn for non-allowlisted actors when Legacy is disabled", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST = `${organizationId}/${otherUserId}`;
    process.env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED = "false";
    const retryTurn = vi.fn();
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { retryTurn },
    });
    const { POST } = await import("./route");

    const response = await POST(retryRequest("retry-request-disabled"), {
      params: Promise.resolve({ turnId: "turn-1" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "runtime_disabled",
    });
    expect(retryTurn).not.toHaveBeenCalled();
  });

  it("uses Legacy for non-allowlisted retry actors when Legacy is enabled", async () => {
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST = `${organizationId}/${otherUserId}`;
    process.env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED = "true";
    const retryTurn = vi.fn().mockResolvedValue(acceptedTurn());
    getRouteContextMock.mockResolvedValue({
      actor: { organizationId, userId },
      auth: { organizationId, userId, role: "finance" },
      service: { retryTurn },
    });
    createConversationTurnStreamMock.mockReturnValue(new Response("stream"));
    const { POST } = await import("./route");

    const response = await POST(retryRequest("retry-request-fallback-legacy"), {
      params: Promise.resolve({ turnId: "turn-1" }),
    });

    expect(response.status).toBe(200);
    expect(retryTurn).toHaveBeenCalledWith(
      { organizationId, userId },
      "turn-1",
      { clientRequestId: "retry-request-fallback-legacy" },
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
});

function retryRequest(clientRequestId: string) {
  return new Request("http://localhost/api/ai/turns/turn-1/retry", {
    method: "POST",
    body: JSON.stringify({ clientRequestId }),
  });
}

function acceptedTurn() {
  return {
    conversationId: "conversation-1",
    turnId: "turn-2",
    userMessageId: "message-user-1",
    assistantMessageId: "message-assistant-2",
    status: "accepted",
    attempt: 2,
    duplicate: false,
  };
}
