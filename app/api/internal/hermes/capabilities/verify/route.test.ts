import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseAdminClientMock } = vi.hoisted(() => ({
  createSupabaseAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "@/features/ai/hermes/actor-fingerprint";
import {
  HERMES_PROFILE_VERSION,
  type HermesActorProfile,
} from "@/features/ai/hermes/contracts";

import {
  POST,
  createHermesCapabilityVerifyHandler,
  verifyHermesCapabilityWithProductPersistence,
  type HermesCapabilityVerificationClient,
} from "./route";

const CAPABILITY = "c".repeat(43);
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const TURN_ID = "44444444-4444-4444-8444-444444444444";
const INVOCATION_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-08-03T12:00:00.000Z");
const EXPIRES_AT = "2099-08-03T12:05:00.000Z";

describe("Hermes capability verification route", () => {
  beforeEach(() => {
    createSupabaseAdminClientMock.mockReset();
  });

  it("matches the Gateway request and minimal response contract", async () => {
    const fixture = databaseFixture();
    const handler = createHermesCapabilityVerifyHandler({
      verify: ({ capabilityToken }) =>
        verifyHermesCapabilityWithProductPersistence({
          client: fixture.client,
          capabilityToken,
          now: NOW,
        }),
    });

    const response = await handler(request({}, CAPABILITY));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      capability: {
        organizationId: ORGANIZATION_ID,
        ownerUserId: USER_ID,
        conversationId: CONVERSATION_ID,
        invocationId: INVOCATION_ID,
        actorFingerprint: fixture.actorFingerprint,
        expiresAt: EXPIRES_AT,
        revokedAt: null,
      },
    });

    const serializedQueries = JSON.stringify(fixture.queries);
    expect(serializedQueries).toContain(
      createHash("sha256").update(CAPABILITY).digest("hex"),
    );
    expect(serializedQueries).not.toContain(CAPABILITY);
  });

  it("uses the service-role client in the exported POST route", async () => {
    const fixture = databaseFixture();
    createSupabaseAdminClientMock.mockReturnValue(fixture.client);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    try {
      const response = await POST(request({}, CAPABILITY));

      expect(response.status).toBe(200);
      expect(createSupabaseAdminClientMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    undefined,
    "not-bearer",
    "Bearer short",
    `Bearer ${"a".repeat(42)}=`,
    `Basic ${CAPABILITY}`,
  ])("rejects bad internal service authorization", async (authorization) => {
    const verify = vi.fn();
    const handler = createHermesCapabilityVerifyHandler({ verify });

    const response = await handler(request({}, authorization));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized" },
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("does not accept a capability from JSON or the query string", async () => {
    const verify = vi.fn();
    const handler = createHermesCapabilityVerifyHandler({ verify });

    const bodyResponse = await handler(
      request({ invocationCapability: CAPABILITY }),
    );
    const queryResponse = await handler(
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
    expect(verify).not.toHaveBeenCalled();
  });

  it("requires the Gateway's exact empty JSON body", async () => {
    const verify = vi.fn();
    const handler = createHermesCapabilityVerifyHandler({ verify });

    for (const body of [null, [], { organizationId: ORGANIZATION_ID }]) {
      const response = await handler(request(body, CAPABILITY));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_request" },
      });
    }

    const malformed = await handler(
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

    const wrongContentType = await handler(
      new Request("http://localhost/api/internal/hermes/capabilities/verify", {
        method: "POST",
        headers: { authorization: `Bearer ${CAPABILITY}` },
        body: "{}",
      }),
    );
    expect(wrongContentType.status).toBe(415);
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a fabricated capability", async () => {
    const fixture = databaseFixture({ capability: null });

    const response = await verifiedResponse(fixture);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "capability_not_found" },
    });
    expect(fixture.queries).toHaveLength(1);
  });

  it.each([
    ["expired", { expires_at: "2026-08-03T11:59:59.000Z" }],
    ["revoked", { revoked_at: "2026-08-03T11:59:00.000Z" }],
  ])("rejects an %s capability", async (_label, capabilityOverride) => {
    const fixture = databaseFixture({ capabilityOverride });

    const response = await verifiedResponse(fixture);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "capability_invalid" },
    });
    expect(fixture.queries).toHaveLength(1);
  });

  it.each([
    [
      "organization",
      { organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ],
    ["user", { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    [
      "conversation",
      { conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ],
  ])("rejects a mismatched %s binding", async (_label, actorOverride) => {
    const fixture = databaseFixture({ actorOverride });

    const response = await verifiedResponse(fixture);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "capability_invalid" },
    });
  });

  it("rejects mismatched or completed invocations", async () => {
    const mismatched = databaseFixture({
      invocationOverride: {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    });
    const completed = databaseFixture({
      invocationOverride: { status: "succeeded" },
    });

    expect((await verifiedResponse(mismatched)).status).toBe(403);
    expect((await verifiedResponse(completed)).status).toBe(403);
  });

  it.each([
    ["actor fingerprint", { actor_fingerprint: "f".repeat(64) }],
    ["memory generation", { memory_snapshot_generation: 9 }],
  ])("rejects a mismatched %s", async (_label, capabilityOverride) => {
    const fixture = databaseFixture({ capabilityOverride });

    const response = await verifiedResponse(fixture);

    expect(response.status).toBe(403);
  });

  it("fails closed on a database error without exposing its details", async () => {
    const fixture = databaseFixture({
      capabilityError: {
        message: `select * from secrets Bearer ${CAPABILITY}`,
      },
    });

    const response = await verifiedResponse(fixture);
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":{"code":"persistence_unavailable"}}');
    expect(body).not.toContain(CAPABILITY);
    expect(body.toLowerCase()).not.toContain("select");
  });

  it("normalizes a thrown database failure to the same sanitized response", async () => {
    const fixture = databaseFixture({
      capabilityFailure: new Error(`connection failed Bearer ${CAPABILITY}`),
    });

    const response = await verifiedResponse(fixture);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "persistence_unavailable" },
    });
  });

  it("never logs or reflects the capability when verification throws", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const handler = createHermesCapabilityVerifyHandler({
      verify: async () => {
        throw new Error(`Bearer ${CAPABILITY}`);
      },
    });

    try {
      const response = await handler(request({}, CAPABILITY));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toBe('{"error":{"code":"internal_error"}}');
      expect(body).not.toContain(CAPABILITY);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});

type QueryResult = { data: unknown; error: unknown };
type QueryRecord = {
  table: string;
  selected: string;
  filters: Array<[string, string, unknown]>;
};

type FixtureOptions = {
  actorOverride?: Partial<HermesActorProfile>;
  capability?: unknown;
  capabilityError?: unknown;
  capabilityFailure?: Error;
  capabilityOverride?: Record<string, unknown>;
  invocationOverride?: Record<string, unknown>;
  turnOverride?: Record<string, unknown>;
};

function databaseFixture(options: FixtureOptions = {}) {
  const actor = actorProfile(options.actorOverride);
  const actorFingerprint = createHermesActorFingerprint(actor);
  const capability =
    options.capability === null
      ? null
      : {
          organization_id: ORGANIZATION_ID,
          owner_user_id: USER_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          invocation_id: INVOCATION_ID,
          root_invocation_id: INVOCATION_ID,
          actor_fingerprint: actorFingerprint,
          skill_grants_hash: createHash("sha256").update("[]").digest("hex"),
          skill_draft_ids: [],
          depth: 0,
          memory_snapshot_generation: 3,
          expires_at: EXPIRES_AT,
          revoked_at: null,
          ...options.capabilityOverride,
        };
  const results: Record<string, QueryResult[]> = {
    ai_hermes_run_capabilities: [
      {
        data: capability,
        error: options.capabilityError ?? null,
      },
    ],
    ai_chat_turns: [
      {
        data: {
          status: "generating",
          lease_expires_at: "2099-08-03T12:01:00.000Z",
          cancel_requested_at: null,
          ai_invocation_id: INVOCATION_ID,
          memory_snapshot_generation: 3,
          context_snapshot: { hermesActor: actor },
          ...options.turnOverride,
        },
        error: null,
      },
    ],
    ai_invocations: [
      {
        data: {
          id: INVOCATION_ID,
          status: "started",
          organization_id: ORGANIZATION_ID,
          actor_user_id: USER_ID,
          metadata: { hermesActor: actor },
          ...options.invocationOverride,
        },
        error: null,
      },
    ],
  };
  const queries: QueryRecord[] = [];

  const client: HermesCapabilityVerificationClient = {
    from(table) {
      const query: QueryRecord = { table, selected: "", filters: [] };
      queries.push(query);
      const builder = {
        select(selected: string) {
          query.selected = selected;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        gt(column: string, value: unknown) {
          query.filters.push(["gt", column, value]);
          return builder;
        },
        in(column: string, value: unknown) {
          query.filters.push(["in", column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push(["is", column, value]);
          return builder;
        },
        async maybeSingle() {
          if (
            table === "ai_hermes_run_capabilities" &&
            options.capabilityFailure
          ) {
            throw options.capabilityFailure;
          }
          return results[table]?.shift() ?? { data: null, error: null };
        },
      };
      return builder;
    },
  };

  return { actor, actorFingerprint, client, queries };
}

function actorProfile(
  override: Partial<HermesActorProfile> = {},
): HermesActorProfile {
  const enabledSkillVersions = [
    {
      skillId: "settlement-reader",
      version: "2.0.0",
      bundleSha256: "a".repeat(64),
    },
  ];
  return {
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    role: "operator_business",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["context.read", "settlements.summary"],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: HERMES_PROFILE_VERSION,
    pageContext: { pageType: "settlement", objectIds: [] },
    ...override,
  };
}

async function verifiedResponse(
  fixture: ReturnType<typeof databaseFixture>,
): Promise<Response> {
  const handler = createHermesCapabilityVerifyHandler({
    verify: ({ capabilityToken }) =>
      verifyHermesCapabilityWithProductPersistence({
        client: fixture.client,
        capabilityToken,
        now: NOW,
      }),
  });
  return handler(request({}, CAPABILITY));
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
