import { describe, expect, it, vi } from "vitest";

import {
  createHermesCapabilityDeriveHandler,
  type HermesCapabilityDeriveTransport,
} from "./route";

const PARENT_INVOCATION_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_INVOCATION_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_CAPABILITY = "p".repeat(43);
const CHILD_CAPABILITY = "c".repeat(43);

describe("Hermes capability derivation route", () => {
  it("accepts only an internal parent capability Bearer and returns no-store", async () => {
    const derive = vi.fn(
      async (): Promise<HermesCapabilityDeriveTransport> => ({
        childInvocationId: CHILD_INVOCATION_ID,
        invocationCapability: CHILD_CAPABILITY,
        expiresAt: "2099-07-22T00:02:00.000Z",
      }),
    );
    const handler = createHermesCapabilityDeriveHandler({ derive });

    const response = await handler(request(validBody(), PARENT_CAPABILITY));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      childInvocationId: CHILD_INVOCATION_ID,
      invocationCapability: CHILD_CAPABILITY,
      expiresAt: "2099-07-22T00:02:00.000Z",
    });
    expect(derive).toHaveBeenCalledWith({
      parentCapabilityToken: PARENT_CAPABILITY,
      request: validBody(),
    });
  });

  it.each([
    undefined,
    "not-bearer",
    "Bearer short",
    `Bearer ${"a".repeat(42)}=`,
    `Basic ${PARENT_CAPABILITY}`,
  ])(
    "rejects missing or malformed internal authorization",
    async (authorization) => {
      const derive = vi.fn();
      const handler = createHermesCapabilityDeriveHandler({ derive });
      const response = await handler(request(validBody(), authorization));

      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: { code: "unauthorized" },
      });
      expect(derive).not.toHaveBeenCalled();
    },
  );

  it("rejects every forbidden or unknown body key rather than ignoring it", async () => {
    const derive = vi.fn();
    const handler = createHermesCapabilityDeriveHandler({ derive });

    for (const forbiddenKey of [
      "organizationId",
      "userId",
      "ownerUserId",
      "role",
      "scopes",
      "skills",
      "model",
      "provider",
      "tools",
      "allowedTools",
      "parentCapabilityToken",
      "extra",
    ]) {
      const response = await handler(
        request(
          { ...validBody(), [forbiddenKey]: "client-controlled" },
          PARENT_CAPABILITY,
        ),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request" },
      });
    }
    expect(derive).not.toHaveBeenCalled();
  });

  it("requires strict JSON and UUID/array fields", async () => {
    const derive = vi.fn();
    const handler = createHermesCapabilityDeriveHandler({ derive });
    const mutations = [
      { ...validBody(), parentInvocationId: "not-a-uuid" },
      { ...validBody(), childInvocationId: "not-a-uuid" },
      { ...validBody(), requestedToolNames: "xingyao_search_projects" },
      { ...validBody(), requestedScopes: ["unknown.scope"] },
      {
        ...validBody(),
        requestedToolNames: [
          "xingyao_search_projects",
          "xingyao_search_projects",
        ],
      },
    ];

    for (const body of mutations) {
      const response = await handler(request(body, PARENT_CAPABILITY));
      expect(response.status).toBe(400);
    }

    const malformed = await handler(
      new Request("http://localhost/api/internal/hermes/capabilities/derive", {
        method: "POST",
        headers: {
          authorization: `Bearer ${PARENT_CAPABILITY}`,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);

    const wrongContentType = await handler(
      new Request("http://localhost/api/internal/hermes/capabilities/derive", {
        method: "POST",
        headers: { authorization: `Bearer ${PARENT_CAPABILITY}` },
        body: JSON.stringify(validBody()),
      }),
    );
    expect(wrongContentType.status).toBe(415);
    expect(derive).not.toHaveBeenCalled();
  });

  it("never reflects Bearer, JWS, or SQL details from failures", async () => {
    const derive = vi.fn(async () => {
      throw new Error(
        `Bearer ${PARENT_CAPABILITY} signed.actor.jws select * from secrets`,
      );
    });
    const handler = createHermesCapabilityDeriveHandler({ derive });

    const response = await handler(request(validBody(), PARENT_CAPABILITY));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toBe('{"error":{"code":"internal_error"}}');
    expect(body).not.toContain(PARENT_CAPABILITY);
    expect(body).not.toContain("signed.actor.jws");
    expect(body.toLowerCase()).not.toContain("select");
  });
});

function validBody() {
  return {
    parentInvocationId: PARENT_INVOCATION_ID,
    childInvocationId: CHILD_INVOCATION_ID,
    requestedToolNames: ["xingyao_search_projects"],
    requestedScopes: ["projects.search"],
  };
}

function request(
  body: Record<string, unknown>,
  authorization?: string,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authorization)
    headers.authorization = authorization.startsWith("Bearer ")
      ? authorization
      : authorization === PARENT_CAPABILITY
        ? `Bearer ${authorization}`
        : authorization;
  return new Request(
    "http://localhost/api/internal/hermes/capabilities/derive",
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}
