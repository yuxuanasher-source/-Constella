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

describe("POST /api/ai/conversations/:conversationId/turns/:turnId/cancel", () => {
  beforeEach(async () => {
    vi.resetModules();
    getRouteContextMock.mockReset();
    createSessionMock.mockReset();
    issueAssertionMock.mockReset().mockResolvedValue("actor-jws");
    const { activeHermesRunRegistry } = await import(
      "@/features/ai/hermes/active-run-registry"
    );
    activeHermesRunRegistry.clear();
  });

  it("authenticates the durable control session before cancellation and interrupts afterward", async () => {
    const order: string[] = [];
    const service = serviceDouble({
      cancelTurn: vi.fn(async () => {
        order.push("persist-cancel");
        return cancelResult();
      }),
      issueGatewayRootCapability: vi.fn(async () => {
        order.push("issue-capability");
        return {
          capabilityId: CAPABILITY_ID,
          invocationCapability: "fresh-capability",
          expiresAt: "2026-07-22T09:05:00.000Z",
        };
      }),
    });
    createSessionMock.mockImplementation(async () => {
      order.push("resume-session");
      return {
        interrupt: vi.fn(async () => order.push("interrupt")),
        close: vi.fn(),
      };
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST, maxDuration } = await import("./route");

    const response = await POST(request(), params());

    expect(maxDuration).toBe(330);
    expect(response.status).toBe(200);
    expect(service.cancelTurn).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
    );
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-owned",
        conversationId: CONVERSATION_ID,
        invocationCapability: "fresh-capability",
      }),
    );
    expect(order).toEqual([
      "issue-capability",
      "resume-session",
      "persist-cancel",
      "interrupt",
    ]);
  });

  it("closes the pre-authenticated session without interrupting when cancellation races with a terminal turn", async () => {
    const session = {
      interrupt: vi.fn(),
      close: vi.fn(),
    };
    const service = serviceDouble({
      cancelTurn: vi.fn().mockResolvedValue({
        ...cancelResult(),
        status: "completed",
        outcome: null,
        cancelRequested: false,
        alreadyTerminal: true,
      }),
    });
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ alreadyTerminal: true });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(session.interrupt).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh authenticated control WebSocket from provider_state after product restart", async () => {
    const session = { interrupt: vi.fn(), close: vi.fn() };
    const service = serviceDouble();
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    await POST(request(), params());

    expect(issueAssertionMock).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "gateway" }),
    );
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          organizationId: ACTOR.organizationId,
          userId: ACTOR.userId,
          conversationId: CONVERSATION_ID,
          invocationId: TURN_ID,
        }),
        actorAssertion: "actor-jws",
        sessionId: "session-owned",
      }),
    );
    expect(session.interrupt).toHaveBeenCalledTimes(1);
  });

  it("marks provider recovery deterministically when the stored Gateway session is gone", async () => {
    const service = serviceDouble();
    createSessionMock.mockRejectedValue(new Error("hermes_gateway_session_mismatch"));
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    expect(service.cancelTurn).toHaveBeenCalledTimes(1);
    expect(service.compareAndSwapGatewayState).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      7,
      expect.objectContaining({
        generation: 8,
        recovery: expect.objectContaining({
          status: "rebuild_required",
          reason: "gateway_session_missing",
        }),
      }),
    );
  });

  it("returns recovery after cancellation persists when the durable control session cannot be opened", async () => {
    const service = serviceDouble();
    createSessionMock.mockRejectedValue(new Error("gateway_connect_failed"));
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      cancelRequested: true,
      interrupted: false,
      recoveryRequired: true,
    });
    expect(service.cancelTurn).toHaveBeenCalledTimes(1);
    expect(service.compareAndSwapGatewayState).toHaveBeenCalledTimes(1);
  });

  it("returns recovery without a state write when cancellation reveals an unprepared child session", async () => {
    const service = serviceDouble({
      getGatewayState: vi.fn().mockResolvedValue(null),
      cancelTurn: vi.fn().mockResolvedValue({
        ...cancelResult(),
        childSessions: ["late-child-session"],
      }),
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      interrupted: false,
      recoveryRequired: true,
    });
    expect(service.compareAndSwapGatewayState).not.toHaveBeenCalled();
  });

  it("interrupts child sessions and reports revoked capabilities from the authoritative cancellation result", async () => {
    const interrupts: string[] = [];
    const service = serviceDouble({
      getGatewayState: vi.fn().mockResolvedValue(
        gatewayState(["child-session"]),
      ),
      cancelTurn: vi.fn().mockResolvedValue({
        ...cancelResult(),
        childSessions: ["child-session"],
        revokedCapabilityIds: [CAPABILITY_ID],
      }),
    });
    createSessionMock.mockImplementation(async ({ sessionId }) => ({
      interrupt: vi.fn(async () => interrupts.push(sessionId)),
      close: vi.fn(),
    }));
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      revokedCapabilityIds: [CAPABILITY_ID],
    });
    expect(service.issueGatewayRootCapability).toHaveBeenCalledTimes(1);
    expect(interrupts).toEqual(["child-session", "session-owned"]);
  });

  it("does not interrupt the parent session twice when child control data repeats it", async () => {
    const interrupts: string[] = [];
    const service = serviceDouble({
      getGatewayState: vi.fn().mockResolvedValue(
        gatewayState(["session-owned", "child-session", "session-owned"]),
      ),
      cancelTurn: vi.fn().mockResolvedValue({
        ...cancelResult(),
        childSessions: ["session-owned", "child-session", "session-owned"],
        revokedCapabilityIds: [CAPABILITY_ID],
      }),
    });
    createSessionMock.mockImplementation(async ({ sessionId }) => ({
      interrupt: vi.fn(async () => interrupts.push(sessionId)),
      close: vi.fn(),
    }));
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(interrupts).toEqual(["child-session", "session-owned"]);
  });

  it("skips durable parent interrupt when the live registry parent was already interrupted", async () => {
    const { activeHermesRunRegistry } = await import(
      "@/features/ai/hermes/active-run-registry"
    );
    const parentInterrupt = vi.fn().mockResolvedValue({ interrupted: true });
    activeHermesRunRegistry.register({
      actor: ACTOR,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      sessionId: "session-owned",
      session: {
        interrupt: parentInterrupt,
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(parentInterrupt).toHaveBeenCalledTimes(1);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns recovery when a local session interrupt fails after cancellation persists", async () => {
    const { activeHermesRunRegistry } = await import(
      "@/features/ai/hermes/active-run-registry"
    );
    activeHermesRunRegistry.register({
      actor: ACTOR,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      sessionId: "session-owned",
      session: {
        interrupt: vi.fn().mockRejectedValue(new Error("interrupt_failed")),
        respondToClarify: vi.fn(),
        close: vi.fn(),
      },
    });
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      interrupted: false,
      recoveryRequired: true,
    });
    expect(service.cancelTurn).toHaveBeenCalledTimes(1);
  });

  it("allows a cancelled turn to retry best-effort cleanup", async () => {
    const service = serviceDouble({
      getHistory: vi.fn().mockResolvedValue({
        turns: [{ id: TURN_ID, status: "cancelled", mode: "deep" }],
      }),
      cancelTurn: vi.fn().mockResolvedValue({
        ...cancelResult(),
        alreadyTerminal: true,
      }),
    });
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      alreadyTerminal: true,
      recoveryRequired: true,
    });
    expect(service.cancelTurn).toHaveBeenCalledTimes(1);
    expect(service.issueGatewayRootCapability).not.toHaveBeenCalled();
  });

  it("preserves the cancellation response when the recovery state write fails", async () => {
    const service = serviceDouble({
      compareAndSwapGatewayState: vi
        .fn()
        .mockRejectedValue(new Error("recovery_write_failed")),
    });
    createSessionMock.mockRejectedValue(new Error("gateway_connect_failed"));
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      recoveryRequired: true,
      recoveryStatePersisted: false,
    });
  });

  it("preserves the cancellation response when closing a control session fails", async () => {
    createSessionMock.mockResolvedValue({
      interrupt: vi.fn(),
      close: vi.fn(() => {
        throw new Error("close_failed");
      }),
    });
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "cancelled",
      interrupted: true,
    });
  });

  it("durable-interrupts the parent session when the registry misses the live run", async () => {
    const session = { interrupt: vi.fn(), close: vi.fn() };
    const service = serviceDouble();
    createSessionMock.mockResolvedValue(session);
    getRouteContextMock.mockResolvedValue(routeContext(service));
    const { POST } = await import("./route");

    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-owned" }),
    );
    expect(session.interrupt).toHaveBeenCalledTimes(1);
  });
});

const ACTOR = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
};
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const CAPABILITY_ID = "55555555-5555-4555-8555-555555555555";

function request() {
  return new Request(
    `http://localhost/api/ai/conversations/${CONVERSATION_ID}/turns/${TURN_ID}/cancel`,
    { method: "POST", body: "{}" },
  );
}

function params() {
  return { params: Promise.resolve({ conversationId: CONVERSATION_ID, turnId: TURN_ID }) };
}

function routeContext(service: ReturnType<typeof serviceDouble>) {
  return { actor: ACTOR, auth: { ...ACTOR, role: "finance" }, service };
}

function cancelResult() {
  return {
    turnId: TURN_ID,
    status: "cancelled",
    outcome: "cancelled",
    cancelRequested: true,
    alreadyTerminal: false,
  };
}

function serviceDouble(overrides: Record<string, unknown> = {}) {
  return {
    getHistory: vi.fn().mockResolvedValue({
      turns: [{ id: TURN_ID, status: "generating", mode: "deep" }],
    }),
    getGatewayState: vi.fn().mockResolvedValue(gatewayState()),
    cancelTurn: vi.fn().mockResolvedValue(cancelResult()),
    issueGatewayRootCapability: vi.fn().mockResolvedValue({
      capabilityId: CAPABILITY_ID,
      invocationCapability: "fresh-capability",
      expiresAt: "2026-07-22T09:05:00.000Z",
    }),
    compareAndSwapGatewayState: vi.fn().mockResolvedValue(8),
    ...overrides,
  };
}

function gatewayState(childSessions: string[] = []) {
  return {
    generation: 7,
    sessionId: "session-owned",
    childSessions,
    summary: {},
    summaryVersion: 0,
  };
}
