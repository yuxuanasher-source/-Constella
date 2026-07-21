import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import type { HermesActorProfile, HermesSkillGrant } from "./contracts";
import {
  createHermesActorAssertionForRun,
  readHermesRunEvents,
  resolveHermesRuntimeConfig,
  startHermesRun,
} from "./runtime-client";

describe("Hermes runtime client", () => {
  it("resolves only a fixed runtime origin with service credentials", () => {
    const keys = rsaKeyPair();

    expect(
      resolveHermesRuntimeConfig({
        XINGYAO_HERMES_RUNTIME_BASE_URL: "https://hermes.internal",
        HERMES_XINGYAO_SERVICE_TOKEN: "service-token-that-is-long-enough",
        XINGYAO_ACTOR_JWS_PRIVATE_KEY: keys.privateKeyPem,
        XINGYAO_ACTOR_JWS_KEY_ID: "kid-1",
      }),
    ).toMatchObject({
      baseUrl: "https://hermes.internal",
      serviceToken: "service-token-that-is-long-enough",
      keyId: "kid-1",
    });
    expect(
      resolveHermesRuntimeConfig({
        XINGYAO_HERMES_RUNTIME_BASE_URL: "https://hermes.internal/v1",
        HERMES_XINGYAO_SERVICE_TOKEN: "service-token-that-is-long-enough",
        XINGYAO_ACTOR_JWS_PRIVATE_KEY: keys.privateKeyPem,
        XINGYAO_ACTOR_JWS_KEY_ID: "kid-1",
      }),
    ).toBeNull();
  });

  it("starts a run with actor assertion and idempotency key", async () => {
    const keys = rsaKeyPair();
    const config = resolveHermesRuntimeConfig({
      XINGYAO_HERMES_RUNTIME_BASE_URL: "https://hermes.internal",
      HERMES_XINGYAO_SERVICE_TOKEN: "service-token-that-is-long-enough",
      XINGYAO_ACTOR_JWS_PRIVATE_KEY: keys.privateKeyPem,
      XINGYAO_ACTOR_JWS_KEY_ID: "kid-1",
    });
    expect(config).not.toBeNull();
    const actor = profile();
    const assertion = await createHermesActorAssertionForRun({
      actor,
      config: config!,
      now: new Date(),
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json(
        {
          runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sessionId: "xsession_1",
          status: "queued",
        },
        { status: 202 },
      ),
    );

    await expect(
      startHermesRun({
        actor,
        input: "hello",
        conversationHistory: [{ role: "assistant", content: "prior" }],
        config: config!,
        actorAssertion: assertion,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sessionId: "xsession_1",
      status: "queued",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hermes.internal/v1/xingyao/runs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"input\":\"hello\""),
      }),
    );
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe(
      "Bearer service-token-that-is-long-enough",
    );
    expect(headers.get("Idempotency-Key")).toBe(INVOCATION_ID);
    expect(headers.get("X-Xingyao-Actor")).toBe(assertion);
  });

  it("parses Hermes run SSE events", async () => {
    const body = [
      sse("run.started", { sessionId: "xsession_1" }),
      sse("message.delta", { delta: "hello" }),
      sse("run.completed", {}),
    ].join("");

    const events = [];
    for await (const event of readHermesRunEvents(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "run.started", data: { sessionId: "xsession_1" } },
      { event: "message.delta", data: { delta: "hello" } },
      { event: "run.completed", data: {} },
    ]);
  });
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

function profile(): HermesActorProfile {
  const enabledSkillVersions: HermesSkillGrant[] = [];
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["context.read", "projects.search"],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
  };
}

function rsaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function sse(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify({
    protocolVersion: "xingyao-runs-v1",
    event,
    runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sequence: 1,
    timestamp: "2026-07-20T00:00:00.000Z",
    data,
  })}\n\n`;
}
