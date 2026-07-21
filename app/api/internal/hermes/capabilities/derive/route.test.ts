import { describe, expect, it, vi } from "vitest";

import { createHermesActorFingerprint } from "@/features/ai/hermes/actor-fingerprint";
import {
  HERMES_PROFILE_VERSION,
  type HermesActorProfile,
} from "@/features/ai/hermes/contracts";
import {
  createHermesStateRepository,
  type HermesStateRepositoryClient,
} from "@/features/ai/hermes/hermes-state-repository";
import {
  deriveHermesChildRunCapability,
  revealHermesCapabilityToken,
  type HermesCapabilityDerivationDependencies,
  type HermesParentRunCapability,
} from "@/features/ai/hermes/run-capability";

import {
  createHermesCapabilityDeriveHandler,
  type HermesCapabilityDeriveTransport,
} from "./route";

const PARENT_INVOCATION_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_INVOCATION_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_CAPABILITY = "p".repeat(43);
const CHILD_CAPABILITY = "c".repeat(43);
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";
const TURN_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-07-22T00:00:00.000Z");

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

  it("preserves an atomic repository parallel limit as a sanitized 409", async () => {
    const databaseMessage = `capability_parallel_limit select * from secrets Bearer ${PARENT_CAPABILITY}`;
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: "P0001", message: databaseMessage },
    }));
    const repository = createHermesStateRepository({
      rpc,
      from: vi.fn(),
    } as unknown as HermesStateRepositoryClient);
    const parent = parentCapability();
    const markChildInvocationFailed = vi.fn(async () => undefined);
    const dependencies: HermesCapabilityDerivationDependencies = {
      repository,
      loadParentCapability: vi.fn(async () => parent),
      countActiveChildren: vi.fn(async () => 0),
      createChildInvocation: vi.fn(async () => undefined),
      markChildInvocationFailed,
      reauthorizeActor: vi.fn(async () => ({
        actor: parent.actor,
        actorFingerprint: parent.actorFingerprint,
      })),
    };
    const handler = createHermesCapabilityDeriveHandler({
      derive: async (input) => {
        const issued = await deriveHermesChildRunCapability({
          ...input,
          dependencies,
          now: NOW,
        });
        return {
          childInvocationId: issued.childInvocationId,
          invocationCapability: revealHermesCapabilityToken(issued.capability),
          expiresAt: issued.expiresAt,
        };
      },
    });

    const response = await handler(request(validBody(), PARENT_CAPABILITY));
    const body = JSON.stringify(await response.json());

    expect(rpc).toHaveBeenCalledWith(
      "issue_ai_hermes_run_capability",
      expect.any(Object),
    );
    expect(markChildInvocationFailed).toHaveBeenCalledWith({
      actor: parent.actor,
      childInvocationId: CHILD_INVOCATION_ID,
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toBe('{"error":{"code":"parallel_limit"}}');
    expect(body).not.toContain(PARENT_CAPABILITY);
    expect(body).not.toContain("capability_parallel_limit");
    expect(body.toLowerCase()).not.toContain("select");
  });
});

function parentCapability(): HermesParentRunCapability {
  const actor: HermesActorProfile = {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: PARENT_INVOCATION_ID,
    allowedReadScopes: ["context.read", "projects.search"],
    enabledSkillVersions: [],
    skillGrantsHash:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: { pageType: "global", objectIds: [] },
  };
  return {
    actor,
    actorFingerprint: createHermesActorFingerprint(actor),
    mode: "deep",
    turnId: TURN_ID,
    invocationId: PARENT_INVOCATION_ID,
    rootInvocationId: PARENT_INVOCATION_ID,
    allowedTools: ["xingyao_search_projects"],
    scopes: ["context.read", "projects.search"],
    skillDraftIds: [],
    depth: 0,
    expiresAt: "2026-07-22T00:02:00.000Z",
  };
}

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
