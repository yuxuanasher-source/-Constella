import { describe, expect, it, vi } from "vitest";

import { HermesToolBrokerError } from "@/features/ai/hermes/tool-broker";

import { createHermesToolExecuteHandler } from "./route";

const CAPABILITY = "c".repeat(43);
const INVOCATION_ID = "11111111-1111-4111-8111-111111111111";

describe("Hermes Tool Broker execute route", () => {
  it("accepts an opaque Bearer and strict Broker body with no-store", async () => {
    const envelope = successEnvelope();
    const execute = vi.fn(async () => envelope);
    const handler = createHermesToolExecuteHandler({ execute });

    const response = await handler(request(validBody(), CAPABILITY));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(envelope);
    expect(execute).toHaveBeenCalledWith({
      capabilityToken: CAPABILITY,
      request: validBody(),
    });
  });

  it.each([
    undefined,
    "not-bearer",
    "Bearer short",
    `Bearer ${"a".repeat(42)}=`,
    `Basic ${CAPABILITY}`,
  ])(
    "rejects missing or malformed capabilities identically",
    async (authorization) => {
      const execute = vi.fn();
      const handler = createHermesToolExecuteHandler({ execute });

      const response = await handler(request(validBody(), authorization));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "unauthorized" },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON, media types, and extra identity fields", async () => {
    const execute = vi.fn();
    const handler = createHermesToolExecuteHandler({ execute });
    const extraIdentity = await handler(
      request({ ...validBody(), sessionId: "guessed-session" }, CAPABILITY),
    );
    const malformed = await handler(
      new Request("http://localhost/api/internal/hermes/tools/execute", {
        method: "POST",
        headers: {
          authorization: `Bearer ${CAPABILITY}`,
          "content-type": "application/json",
        },
        body: "{",
      }),
    );
    const wrongType = await handler(
      new Request("http://localhost/api/internal/hermes/tools/execute", {
        method: "POST",
        headers: { authorization: `Bearer ${CAPABILITY}` },
        body: JSON.stringify(validBody()),
      }),
    );

    expect(extraIdentity.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(wrongType.status).toBe(415);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", 401],
    ["permission_denied", 403],
    ["idempotency_conflict", 409],
    ["lease_unavailable", 409],
    ["persistence_unavailable", 503],
    ["upstream_unavailable", 502],
    ["internal_error", 500],
  ] as const)(
    "maps %s without leaking tenancy or internals",
    async (code, status) => {
      const execute = vi.fn(async () => {
        throw new HermesToolBrokerError(code);
      });
      const handler = createHermesToolExecuteHandler({ execute });

      const response = await handler(request(validBody(), CAPABILITY));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(body).toBe(JSON.stringify({ error: { code } }));
      expect(body).not.toContain(CAPABILITY);
      expect(body).not.toContain("organization");
      expect(body).not.toContain("conversation");
      expect(body.toLowerCase()).not.toContain("select");
    },
  );

  it("returns an upstream tool result as HTTP 200 instead of a run failure", async () => {
    const execute = vi.fn(async () => ({
      status: "error" as const,
      error: { code: "upstream_unavailable" as const },
      evidenceRefs: [],
      sourceLabels: [],
      updatedAt: "2026-07-22T00:00:00.000Z",
      observedAt: "2026-07-22T00:00:00.000Z",
      missingData: [],
      permissionDenials: [],
      truncated: false,
      invocationId: INVOCATION_ID,
      toolCallId: "gateway-call-1",
      toolName: "xingyao_search_projects" as const,
      traceId: "trace-upstream",
    }));
    const handler = createHermesToolExecuteHandler({ execute });

    const response = await handler(request(validBody(), CAPABILITY));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      error: { code: "upstream_unavailable" },
    });
  });

  it("uses a stable internal envelope for unexpected secret-bearing failures", async () => {
    const execute = vi.fn(async () => {
      throw new Error(
        `Bearer ${CAPABILITY} signed.actor.jws select * from private_table`,
      );
    });
    const handler = createHermesToolExecuteHandler({ execute });

    const response = await handler(request(validBody(), CAPABILITY));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toBe('{"error":{"code":"internal_error"}}');
    expect(body).not.toContain(CAPABILITY);
    expect(body).not.toContain("signed.actor.jws");
    expect(body.toLowerCase()).not.toContain("select");
  });
});

function request(body: unknown, authorization?: string): Request {
  return new Request("http://localhost/api/internal/hermes/tools/execute", {
    method: "POST",
    headers: {
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    arguments: {},
  };
}

function successEnvelope() {
  return {
    status: "ok" as const,
    data: { rows: [] },
    evidenceRefs: [],
    sourceLabels: ["project_record"],
    updatedAt: "2026-07-21T23:59:00.000Z",
    observedAt: "2026-07-22T00:00:00.000Z",
    missingData: [],
    permissionDenials: [],
    truncated: false,
    invocationId: INVOCATION_ID,
    toolCallId: "gateway-call-1",
    toolName: "xingyao_search_projects" as const,
    traceId: "trace-read",
  };
}
