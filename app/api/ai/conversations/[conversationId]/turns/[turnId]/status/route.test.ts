import { beforeEach, describe, expect, it, vi } from "vitest";

const getRouteContextMock = vi.fn();
const routeErrorResponseMock = vi.fn((error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Unexpected error" },
    { status: 500 },
  ),
);

vi.mock("@/app/api/ai/conversation-route-context", () => ({
  getAiConversationRouteContext: getRouteContextMock,
  conversationRouteErrorResponse: routeErrorResponseMock,
}));

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const TURN_ID = "00000000-0000-4000-8000-000000000004";
const ACTOR = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};

describe("GET /api/ai/conversations/:conversationId/turns/:turnId/status", () => {
  beforeEach(() => {
    vi.resetModules();
    getRouteContextMock.mockReset();
    routeErrorResponseMock.mockClear();
  });

  it("rejects malformed identifiers and cursors before storage access", async () => {
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue({ actor: ACTOR, service });
    const { GET } = await import("./route");

    for (const [conversationId, turnId, after] of [
      ["not-a-uuid", TURN_ID, "0"],
      [CONVERSATION_ID, "not-a-uuid", "0"],
      [CONVERSATION_ID, TURN_ID, "-1"],
      [CONVERSATION_ID, TURN_ID, "1.5"],
      [CONVERSATION_ID, TURN_ID, "infinity"],
    ]) {
      const response = await GET(
        request(after),
        params(conversationId, turnId),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }

    expect(service.getRecoverySnapshot).not.toHaveBeenCalled();
  });

  it("returns 404 when the actor-scoped recovery record is absent", async () => {
    const service = serviceDouble({
      getRecoverySnapshot: vi.fn().mockResolvedValue(null),
    });
    getRouteContextMock.mockResolvedValue({ actor: ACTOR, service });
    const { GET } = await import("./route");

    const response = await GET(request("0"), params());

    expect(response.status).toBe(404);
    expect(service.getRecoverySnapshot).toHaveBeenCalledWith(
      ACTOR,
      CONVERSATION_ID,
      TURN_ID,
    );
  });

  it("returns 204 for an unchanged active turn", async () => {
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue({ actor: ACTOR, service });
    const { GET } = await import("./route");

    const response = await GET(request("7"), params());

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("returns a newer public snapshot without internal control state", async () => {
    const service = serviceDouble();
    getRouteContextMock.mockResolvedValue({ actor: ACTOR, service });
    const { GET } = await import("./route");

    const response = await GET(request("6"), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      turnId: TURN_ID,
      status: "generating",
      eventSequence: 7,
      partialContent: "partial answer",
      updatedAt: "2026-08-03T16:06:00.000Z",
    });
    expect(body).not.toHaveProperty("controlState");
    expect(service.getHistory).not.toHaveBeenCalled();
    expect(service.getGatewayState).not.toHaveBeenCalled();
  });

  it("always returns terminal state even when the cursor is current", async () => {
    const terminalEvent = {
      type: "response.failed" as const,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      code: "gateway_timeout",
      retryable: true,
      message: "Gateway timed out",
    };
    const service = serviceDouble({
      getRecoverySnapshot: vi.fn().mockResolvedValue({
        turnId: TURN_ID,
        status: "failed",
        eventSequence: 8,
        partialContent: "partial answer",
        terminalEvent,
        updatedAt: "2026-08-03T16:07:00.000Z",
        controlState: { childSessionIds: [] },
      }),
    });
    getRouteContextMock.mockResolvedValue({ actor: ACTOR, service });
    const { GET } = await import("./route");

    const response = await GET(request("8"), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ terminalEvent });
  });

  it("passes authentication responses and maps storage failures", async () => {
    const unauthorized = Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    getRouteContextMock.mockResolvedValueOnce(unauthorized);
    const { GET } = await import("./route");
    const unauthorizedResponse = await GET(request(), params());
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("Cache-Control")).toBe("no-store");

    const service = serviceDouble({
      getRecoverySnapshot: vi
        .fn()
        .mockRejectedValue(new Error("storage failed")),
    });
    getRouteContextMock.mockResolvedValueOnce({ actor: ACTOR, service });
    const response = await GET(request(), params());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(routeErrorResponseMock).toHaveBeenCalledTimes(1);
  });
});

function request(after = "0") {
  return new Request(
    `http://localhost/api/ai/conversations/${CONVERSATION_ID}/turns/${TURN_ID}/status?after=${after}`,
  );
}

function params(conversationId = CONVERSATION_ID, turnId = TURN_ID) {
  return { params: Promise.resolve({ conversationId, turnId }) };
}

function serviceDouble(overrides: Record<string, unknown> = {}) {
  return {
    getRecoverySnapshot: vi.fn().mockResolvedValue({
      turnId: TURN_ID,
      status: "generating",
      eventSequence: 7,
      partialContent: "partial answer",
      updatedAt: "2026-08-03T16:06:00.000Z",
      controlState: { childSessionIds: ["private-child-session"] },
    }),
    getHistory: vi.fn(),
    getGatewayState: vi.fn(),
    ...overrides,
  };
}
