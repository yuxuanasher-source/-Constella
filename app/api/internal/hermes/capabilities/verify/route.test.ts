import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseAdminClientMock, rpcMock } = vi.hoisted(() => ({
  createSupabaseAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

import { POST } from "./route";

const CAPABILITY = "c".repeat(43);
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "55555555-5555-4555-8555-555555555555";
const ACTOR_FINGERPRINT = "a".repeat(64);
const EXPIRES_AT = "2099-08-03T12:05:00.000Z";
const RPC_NAME = "verify_ai_hermes_invocation_capability";

describe("Hermes capability verification route", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    createSupabaseAdminClientMock.mockReset();
    createSupabaseAdminClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("matches Gateway's empty-body contract through exactly one transactional RPC", async () => {
    rpcMock.mockResolvedValue({ data: [validRow()], error: null });

    const response = await POST(request({}, CAPABILITY));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      capability: {
        organizationId: ORGANIZATION_ID,
        ownerUserId: USER_ID,
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: ACTOR_FINGERPRINT,
        expiresAt: EXPIRES_AT,
        revokedAt: null,
      },
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(RPC_NAME, {
      p_token_sha256: createHash("sha256")
        .update(CAPABILITY, "utf8")
        .digest("hex"),
    });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain(CAPABILITY);
  });

  it.each([
    "stale after discovery",
    "revoked",
    "expired",
    "invalid child lineage",
    "inactive conversation",
  ])("maps %s verification rejection to a sanitized 403", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "capability_invalid" },
    });

    const response = await POST(request({}, CAPABILITY));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "capability_invalid" },
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("maps a fabricated capability to a sanitized 404", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "capability_not_found" },
    });

    const response = await POST(request({}, CAPABILITY));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "capability_not_found" },
    });
  });

  it("fails closed on an unknown RPC error or malformed row", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "database internals" },
      })
      .mockResolvedValueOnce({
        data: [{ ...validRow(), root_invocation_id: INVOCATION_ID }],
        error: null,
      });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(request({}, CAPABILITY));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: { code: "persistence_unavailable" },
      });
    }
  });

  it.each([
    undefined,
    "not-bearer",
    "Bearer short",
    `Bearer ${"a".repeat(42)}=`,
    `Basic ${CAPABILITY}`,
  ])("rejects bad internal authorization", async (authorization) => {
    const response = await POST(request({}, authorization));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized" },
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires Gateway's exact empty JSON body", async () => {
    for (const body of [null, [], { invocationId: INVOCATION_ID }]) {
      const response = await POST(request(body, CAPABILITY));
      expect(response.status).toBe(400);
    }

    const malformed = await POST(
      new Request("http://localhost/api/internal/hermes/capabilities/verify", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CAPABILITY}`,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);

    const wrongContentType = await POST(
      new Request("http://localhost/api/internal/hermes/capabilities/verify", {
        method: "POST",
        headers: { authorization: `Bearer ${CAPABILITY}` },
        body: "{}",
      }),
    );
    expect(wrongContentType.status).toBe(415);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not accept the capability from JSON or the query string", async () => {
    const bodyResponse = await POST(
      request({ invocationCapability: CAPABILITY }),
    );
    const queryResponse = await POST(
      new Request(
        `http://localhost/api/internal/hermes/capabilities/verify?capability=${CAPABILITY}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      ),
    );

    expect(bodyResponse.status).toBe(401);
    expect(queryResponse.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("never logs or reflects the raw capability on an RPC failure", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    rpcMock.mockRejectedValue(new Error(`Bearer ${CAPABILITY}`));

    try {
      const response = await POST(request({}, CAPABILITY));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(body).toBe('{"error":{"code":"persistence_unavailable"}}');
      expect(body).not.toContain(CAPABILITY);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it("fails closed when the service-role client is unavailable", async () => {
    createSupabaseAdminClientMock.mockReturnValue(null);

    const response = await POST(request({}, CAPABILITY));

    expect(response.status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

function validRow() {
  return {
    organization_id: ORGANIZATION_ID,
    owner_user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    invocation_id: INVOCATION_ID,
    actor_fingerprint: ACTOR_FINGERPRINT,
    expires_at: EXPIRES_AT,
    revoked_at: null,
  };
}

function request(body: unknown, authorization?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authorization) {
    headers.authorization = authorization.startsWith("Bearer ")
      ? authorization
      : authorization === CAPABILITY
        ? `Bearer ${authorization}`
        : authorization;
  }
  return new Request(
    "http://localhost/api/internal/hermes/capabilities/verify",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}
