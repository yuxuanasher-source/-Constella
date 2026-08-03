import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();
const createSessionMock = vi.fn();
const issueAssertionMock = vi.fn();

vi.mock("@/app/api/ai/conversation-route-context", () => ({
  getAiConversationRouteContext: getRouteContextMock,
  conversationRouteErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    ),
}));

vi.mock("@/features/ai/hermes/gateway-client", () => ({
  createHermesGatewaySession: createSessionMock,
  resolveHermesGatewayConfig: () => ({
    url: "ws://127.0.0.1:8787",
    serviceToken: "x".repeat(32),
    timeouts: { connectMs: 1, readyMs: 1, rpcMs: 1, idleMs: 1, heartbeatMs: 1 },
  }),
}));

vi.mock("@/features/ai/hermes/runtime-client", () => ({
  createHermesActorAssertionForRun: issueAssertionMock,
  resolveHermesRuntimeConfig: () => ({
    baseUrl: "http://127.0.0.1:8788",
    serviceToken: "x".repeat(32),
    privateKeyPem: "private-key",
    keyId: "key-1",
  }),
}));

describe("POST /api/ai/conversations/:conversationId/turns/:turnId/clarify", () => {
  beforeEach(() => {
    vi.resetModules();
    getRouteContextMock.mockReset();
    createSessionMock.mockReset();
    issueAssertionMock.mockReset().mockResolvedValue("actor-jws");
  });

  it("requires the active turn pending clarifyId and allowed option policy", async () => {
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST, maxDuration } = await import("./route");

    const wrongId = await POST(
      request({ clarifyId: OTHER_CLARIFY_ID, answer: "project" }),
      params(),
    );
    const wrongAnswer = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "free text" }),
      params(),
    );

    expect(maxDuration).toBe(330);
    expect(wrongId.status).toBe(409);
    expect(wrongAnswer.status).toBe(422);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("prefers pending clarify from the turn recovery snapshot after restart", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble({
      getRecoverySnapshot: vi.fn().mockResolvedValue({
        turnId: TURN_ID,
        controlState: {
          childSessionIds: ["snapshot-child-session"],
          pendingClarify: {
            clarifyId: CLARIFY_ID,
            question: "Which scope?",
            choices: ["snapshot-choice"],
            allowFreeText: false,
          },
        },
      }),
      appendRecoveryEvent: vi.fn().mockResolvedValue({
        operationStatus: "claimed",
        eventSequence: 12,
      }),
    });
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "snapshot-choice" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(service.getRecoverySnapshot).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(service.appendRecoveryEvent).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
      expect.objectContaining({
        eventName: "clarify_answered",
        payload: expect.objectContaining({
          clarifyId: CLARIFY_ID,
          answerSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        controlState: {
          childSessionIds: ["snapshot-child-session"],
          pendingClarify: expect.objectContaining({
            turnId: TURN_ID,
            clarifyId: CLARIFY_ID,
            question: "Which scope?",
            response: expect.objectContaining({
              clarifyId: CLARIFY_ID,
              answerSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
          }),
        },
      }),
    );
    expect(service.claimClarifyResponse).not.toHaveBeenCalled();
    expect(session.respondToClarify).toHaveBeenCalledWith({
      requestId: CLARIFY_ID,
      answer: "snapshot-choice",
    });
  });

  it("falls back to legacy provider pending clarify during rollout", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble();
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(service.appendRecoveryEvent).toHaveBeenCalledTimes(2);
    expect(service.claimClarifyResponse).not.toHaveBeenCalled();
    expect(session.respondToClarify).toHaveBeenCalledTimes(1);
  });

  it("falls back for a migrated active turn whose recovery snapshot is still empty", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble({
      getRecoverySnapshot: vi.fn().mockResolvedValue({
        turnId: TURN_ID,
        eventSequence: 0,
        controlState: {},
      }),
    });
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(session.respondToClarify).toHaveBeenCalledWith({
      requestId: CLARIFY_ID,
      answer: "project",
    });
  });

  it("fails closed instead of writing clarify control into legacy provider state", async () => {
    const service = serviceDouble({
      appendRecoveryEvent: undefined,
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "turn_recovery_unavailable",
    });
    expect(service.claimClarifyResponse).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("rejects durable pending clarify state owned by a different turn", async () => {
    const service = serviceDouble({
      getGatewayState: vi
        .fn()
        .mockResolvedValue(
          gatewayState({ turnId: "99999999-9999-4999-8999-999999999999" }),
        ),
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(service.claimClarifyResponse).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("accepts free text only when pending clarify allows it", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble({
      getGatewayState: vi.fn().mockResolvedValue(
        gatewayState({
          allowFreeText: true,
          choices: ["project", "streamer"],
        }),
      ),
    });
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "custom answer" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(session.respondToClarify).toHaveBeenCalledWith({
      requestId: CLARIFY_ID,
      answer: "custom answer",
    });
  });

  it("treats duplicate clarify responses as idempotent and changed responses as conflicts", async () => {
    const service = serviceDouble({
      getGatewayState: vi.fn().mockResolvedValue(
        gatewayState({
          response: { clarifyId: CLARIFY_ID, answer: "project" },
        }),
      ),
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const duplicate = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );
    const changed = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "streamer" }),
      params(),
    );

    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true });
    expect(changed.status).toBe(409);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("claims the clarify answer before Gateway RPC and suppresses conflicting races", async () => {
    const service = serviceDouble({
      appendRecoveryEvent: vi
        .fn()
        .mockResolvedValue({ operationStatus: "conflict" }),
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(service.appendRecoveryEvent).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
      expect.objectContaining({
        eventName: "clarify_answered",
        payload: expect.objectContaining({
          clarifyId: CLARIFY_ID,
          answerSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        controlState: {
          childSessionIds: [],
          pendingClarify: expect.objectContaining({
            clarifyId: CLARIFY_ID,
            response: expect.objectContaining({
              clarifyId: CLARIFY_ID,
              answerSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
          }),
        },
      }),
    );
    expect(service.claimClarifyResponse).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("retries delivery for the same claimed answer after a Gateway failure", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble({
      appendRecoveryEvent: vi
        .fn()
        .mockResolvedValue({ operationStatus: "claimed" }),
    });
    createSessionMock
      .mockRejectedValueOnce(new Error("gateway_transport_failed"))
      .mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const first = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );
    const retry = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(first.status).toBe(500);
    expect(retry.status).toBe(200);
    expect(session.respondToClarify).toHaveBeenCalledOnce();
    expect(service.appendRecoveryEvent).toHaveBeenCalledTimes(3);
    expect(service.appendRecoveryEvent).toHaveBeenLastCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
      expect.objectContaining({
        payload: expect.objectContaining({ status: "delivered" }),
      }),
    );
  });

  it("opens a fresh authenticated control WebSocket from provider_state after product restart", async () => {
    const session = { respondToClarify: vi.fn(), close: vi.fn() };
    const service = serviceDouble();
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(issueAssertionMock).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "gateway" }),
    );
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-owned",
        actor: expect.objectContaining({
          organizationId: ACTOR.organizationId,
          userId: ACTOR.userId,
          conversationId: CONVERSATION_ID,
          invocationId: TURN_ID,
        }),
        actorAssertion: "actor-jws",
        invocationCapability: "fresh-capability",
      }),
    );
    expect(session.respondToClarify).toHaveBeenCalledWith({
      requestId: CLARIFY_ID,
      answer: "project",
    });
  });

  it("appends turn recovery without mutating reusable Gateway state when the stored session is gone", async () => {
    const service = serviceDouble({
      appendRecoveryEvent: vi.fn().mockResolvedValue({ eventSequence: 13 }),
    });
    createSessionMock.mockRejectedValue(
      new Error("hermes_gateway_session_mismatch"),
    );
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(
      request({ clarifyId: CLARIFY_ID, answer: "project" }),
      params(),
    );

    expect(response.status).toBe(202);
    expect(service.appendRecoveryEvent).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
      expect.objectContaining({
        eventName: "session_ready",
        payload: expect.objectContaining({
          recovery: "rebuild_required",
          reason: "gateway_session_missing",
        }),
      }),
    );
    expect(service.compareAndSwapGatewayState).not.toHaveBeenCalled();
  });
});

const ACTOR = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const CLARIFY_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_CLARIFY_ID = "66666666-6666-4666-8666-666666666666";
const CAPABILITY_ID = "77777777-7777-4777-8777-777777777777";

function request(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/ai/conversations/${CONVERSATION_ID}/turns/${TURN_ID}/clarify`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

function params() {
  return {
    params: Promise.resolve({
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
    }),
  };
}

function routeContext(service: ReturnType<typeof serviceDouble>) {
  return { actor: ACTOR, auth: { ...ACTOR, role: "finance" }, service };
}

function serviceDouble(overrides: Record<string, unknown> = {}) {
  return {
    getHistory: vi.fn().mockResolvedValue({
      turns: [{ id: TURN_ID, status: "generating", mode: "deep" }],
    }),
    getGatewayState: vi.fn().mockResolvedValue(gatewayState()),
    getRecoverySnapshot: vi.fn().mockResolvedValue(null),
    issueGatewayRootCapability: vi.fn().mockResolvedValue({
      capabilityId: CAPABILITY_ID,
      invocationCapability: "fresh-capability",
      expiresAt: "2026-07-22T09:05:00.000Z",
    }),
    claimClarifyResponse: vi.fn().mockResolvedValue({ status: "claimed" }),
    appendRecoveryEvent: vi.fn().mockResolvedValue({
      operationStatus: "claimed",
      eventSequence: 8,
    }),
    compareAndSwapGatewayState: vi.fn().mockResolvedValue(8),
    ...overrides,
  };
}

function gatewayState(pending: Record<string, unknown> = {}) {
  return {
    generation: 7,
    sessionId: "session-owned",
    summary: {},
    summaryVersion: 0,
    pendingClarify: {
      turnId: TURN_ID,
      clarifyId: CLARIFY_ID,
      question: "Which scope?",
      choices: ["project", "streamer"],
      allowFreeText: false,
      ...pending,
    },
  };
}
