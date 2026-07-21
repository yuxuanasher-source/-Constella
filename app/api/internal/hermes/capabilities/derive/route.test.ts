import { describe, expect, it, vi } from "vitest";

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
  createHermesStateRepository,
  type HermesStateRepositoryClient,
} from "@/features/ai/hermes/hermes-state-repository";
import {
  deriveHermesChildRunCapability,
  revealHermesCapabilityToken,
  type HermesCapabilityDerivationDependencies,
  type HermesParentRunCapability,
} from "@/features/ai/hermes/run-capability";
import { getAllowedReadScopesForRole } from "@/features/ai/hermes/read-scopes";
import { evaluateHermesSkillGrantsForActor } from "@/features/ai/hermes/skill-governance";

import {
  POST,
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

  it.each([
    "ai_hermes_run_capabilities",
    "ai_chat_turns",
    "ai_invocations",
    "organization_members",
  ] as const)("returns 503 when the %s query fails", async (errorTable) => {
    const { client } = persistenceClient({ errorTable });
    createSupabaseAdminClientMock.mockReturnValue(client);

    const response = await POST(request(validBody(), PARENT_CAPABILITY));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":{"code":"persistence_failed"}}');
    expect(body).not.toContain(PARENT_CAPABILITY);
    expect(body.toLowerCase()).not.toContain("select");
  });

  it("keeps a genuinely missing parent distinct from loader failure", async () => {
    const { client } = persistenceClient({ missingParent: true });
    createSupabaseAdminClientMock.mockReturnValue(client);

    const response = await POST(request(validBody(), PARENT_CAPABILITY));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "parent_not_found" },
    });
  });

  it("keeps genuinely inactive membership as actor_changed", async () => {
    const { client } = persistenceClient({ inactiveMembership: true });
    createSupabaseAdminClientMock.mockReturnValue(client);

    const response = await POST(request(validBody(), PARENT_CAPABILITY));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "actor_changed" },
    });
  });

  it("pre-counts only started or queued child invocations", async () => {
    const { client, queries } = persistenceClient({ countError: true });
    createSupabaseAdminClientMock.mockReturnValue(client);

    const response = await POST(request(validBody(), PARENT_CAPABILITY));
    const capabilityQueries = queries.filter(
      (query) => query.table === "ai_hermes_run_capabilities",
    );

    expect(response.status).toBe(503);
    expect(capabilityQueries).toHaveLength(2);
    expect(capabilityQueries[1]?.select).toContain(
      "child_invocation:ai_invocations!ai_hermes_run_capabilities_invocation_id_fkey!inner(id)",
    );
    expect(capabilityQueries[1]?.filters).toContainEqual([
      "in",
      "child_invocation.status",
      ["started", "queued"],
    ]);
  });
});

function parentCapability(): HermesParentRunCapability {
  const allowedReadScopes = getAllowedReadScopesForRole("owner");
  const enabledSkillVersions = evaluateHermesSkillGrantsForActor({
    role: "owner",
    allowedReadScopes,
  }).enabledSkillVersions;
  const actor: HermesActorProfile = {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: PARENT_INVOCATION_ID,
    allowedReadScopes,
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
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
    expiresAt: "2099-07-22T00:02:00.000Z",
  };
}

type PersistenceTable =
  | "ai_hermes_run_capabilities"
  | "ai_chat_turns"
  | "ai_invocations"
  | "organization_members";

type PersistenceQuery = {
  table: string;
  select: string;
  filters: Array<[string, string, unknown]>;
};

function persistenceClient(
  options: {
    errorTable?: PersistenceTable;
    missingParent?: boolean;
    inactiveMembership?: boolean;
    countError?: boolean;
  } = {},
) {
  const parent = parentCapability();
  const tableCalls = new Map<string, number>();
  const queries: PersistenceQuery[] = [];
  const queryError = {
    code: "PGRST000",
    message: `select failed Bearer ${PARENT_CAPABILITY}`,
  };
  const successRows: Record<PersistenceTable, unknown> = {
    ai_hermes_run_capabilities: {
      organization_id: ORGANIZATION_ID,
      owner_user_id: USER_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      invocation_id: PARENT_INVOCATION_ID,
      root_invocation_id: PARENT_INVOCATION_ID,
      actor_fingerprint: parent.actorFingerprint,
      allowed_tools: parent.allowedTools,
      scopes: parent.scopes,
      skill_draft_ids: parent.skillDraftIds,
      depth: parent.depth,
      expires_at: parent.expiresAt,
    },
    ai_chat_turns: {
      mode: parent.mode,
      status: "accepted",
      lease_expires_at: "2099-07-22T00:02:00.000Z",
      context_snapshot: { hermesActor: parent.actor },
      ai_invocation_id: PARENT_INVOCATION_ID,
    },
    ai_invocations: { metadata: { hermesActor: parent.actor } },
    organization_members: { role: parent.actor.role },
  };

  const client = {
    from(table: PersistenceTable) {
      const callIndex = tableCalls.get(table) ?? 0;
      tableCalls.set(table, callIndex + 1);
      const query: PersistenceQuery = { table, select: "", filters: [] };
      queries.push(query);
      const isCount = table === "ai_hermes_run_capabilities" && callIndex > 0;
      const result = isCount
        ? {
            data: null,
            error: options.countError ? queryError : null,
            count: options.countError ? null : 0,
          }
        : {
            data:
              table === "ai_hermes_run_capabilities" && options.missingParent
                ? null
                : table === "organization_members" &&
                    options.inactiveMembership
                  ? null
                  : successRows[table],
            error: options.errorTable === table ? queryError : null,
          };
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push(["is", column, value]);
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
        maybeSingle() {
          return Promise.resolve(result);
        },
        then<TResult1 = typeof result, TResult2 = never>(
          onfulfilled?: ((value: typeof result) => TResult1) | null,
          onrejected?: ((reason: unknown) => TResult2) | null,
        ) {
          return Promise.resolve(result).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
    rpc: vi.fn(),
  };
  return { client, queries };
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
