import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import { signHermesActorAssertion } from "./actor-assertion";
import {
  HERMES_EVIDENCE_REF_MAX_LENGTH,
  type HermesActorProfile,
} from "./contracts";
import {
  HERMES_READ_ENDPOINTS,
  authorizeAndExecuteHermesReadTool,
  authenticateHermesReadRequest,
  executeHermesReadTool,
  hermesReadSuccess,
} from "./read-api";

describe("Hermes product read API boundary", () => {
  it("authenticates service token and actor assertion before exposing a scope", async () => {
    const keys = rsaKeyPair();
    const actor = profile();
    const token = await signHermesActorAssertion(actor, {
      privateKeyPem: keys.privateKeyPem,
      kid: "kid-1",
      now: new Date(),
    });

    const result = await authenticateHermesReadRequest(
      new Request("http://localhost/api/internal/hermes/read/context", {
        method: "POST",
        headers: {
          Authorization: "Bearer read-service-token-that-is-long-enough",
          "X-Xingyao-Actor": token,
        },
      }),
      HERMES_READ_ENDPOINTS.xingyao_get_current_context,
      {
        XINGYAO_READ_API_SERVICE_TOKEN:
          "read-service-token-that-is-long-enough",
        XINGYAO_ACTOR_JWS_PUBLIC_KEY: keys.publicKeyPem,
        XINGYAO_ACTOR_JWS_KEY_ID: "kid-1",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      actor,
    });
  });

  it("fails closed when the actor lacks the route scope or role", async () => {
    const keys = rsaKeyPair();
    const token = await signHermesActorAssertion(
      profile({
        role: "finance",
        allowedReadScopes: ["context.read"],
      }),
      {
        privateKeyPem: keys.privateKeyPem,
        kid: "kid-1",
        now: new Date(),
      },
    );

    const result = await authenticateHermesReadRequest(
      new Request(
        "http://localhost/api/internal/hermes/read/live-reports/search",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer read-service-token-that-is-long-enough",
            "X-Xingyao-Actor": token,
          },
        },
      ),
      HERMES_READ_ENDPOINTS.xingyao_search_live_reports,
      {
        XINGYAO_READ_API_SERVICE_TOKEN:
          "read-service-token-that-is-long-enough",
        XINGYAO_ACTOR_JWS_PUBLIC_KEY: keys.publicKeyPem,
        XINGYAO_ACTOR_JWS_KEY_ID: "kid-1",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      envelope: {
        status: "error",
        error: { code: "permission_denied" },
        toolInvocationId: INVOCATION_ID,
      },
    });
  });

  it("queries product data with immutable organization scoping", async () => {
    const client = supabaseDouble([
      {
        id: PROJECT_ID,
        name: "Canonical project",
        status: "active",
      },
    ]);

    const result = await executeHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      { query: "Canonical", limit: 5, organizationId: "evil" },
    );

    expect(result).toBe("invalid_request");

    const ok = await executeHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      { query: "Canonical", limit: 5 },
    );
    expect(ok).toMatchObject({
      data: { rows: [{ id: PROJECT_ID, name: "Canonical project" }] },
      sourceLabels: ["project_record"],
    });
    expect(client.calls).toContainEqual([
      "projects",
      "select",
      "id, name, status, started_at:starts_at, ended_at:ends_at, created_at, updated_at",
    ]);
    expect(client.calls).toContainEqual([
      "projects",
      "eq",
      "organization_id",
      ORG_ID,
    ]);
    expect(client.calls).not.toContainEqual([
      "projects",
      "eq",
      "organization_id",
      "evil",
    ]);
  });

  it("queries project summaries with columns that exist on the project table", async () => {
    const client = supabaseDouble([
      {
        id: PROJECT_ID,
        name: "Canonical project",
        status: "active",
        default_settlement_method: "cpt",
      },
    ]);

    const result = await executeHermesReadTool(
      client as never,
      profile(),
      "xingyao_get_project_summary",
      { projectId: PROJECT_ID },
    );

    expect(result).toMatchObject({
      data: {
        project: {
          id: PROJECT_ID,
          name: "Canonical project",
          default_settlement_method: "cpt",
        },
      },
      sourceLabels: ["project_record"],
    });
    expect(client.calls).toContainEqual([
      "projects",
      "select",
      "id, name, status, started_at:starts_at, ended_at:ends_at, settlement_method:default_settlement_method, default_hourly_rate, default_base_salary, created_at, updated_at",
    ]);
  });

  it("emits the exact success envelope shape expected by the fork client", () => {
    const envelope = hermesReadSuccess(profile(), {
      data: { ok: true },
      evidenceRefs: ["project:1"],
      sourceLabels: ["project_record"],
    });

    expect(Object.keys(envelope).sort()).toEqual([
      "data",
      "evidenceRefs",
      "missingData",
      "permissionDenials",
      "sourceLabels",
      "status",
      "toolInvocationId",
      "traceId",
      "truncated",
      "updatedAt",
    ]);
    expect(envelope).toMatchObject({
      status: "ok",
      toolInvocationId: INVOCATION_ID,
      truncated: false,
    });
  });

  it("normalizes legacy physical evidence prefixes and sanitizes metadata", () => {
    const envelope = hermesReadSuccess(profile(), {
      data: {
        sourceRef: `recording_assets:${PROJECT_ID}`,
        note: "signed.actor.jws",
      },
      evidenceRefs: [
        `projects:${PROJECT_ID}`,
        `recording_assets:${PROJECT_ID}`,
        `settlement_batches:${PROJECT_ID}`,
        "Bearer metadata-secret",
      ],
      sourceLabels: ["project_record", "signed.actor.jws"],
      missingData: ["safe_missing", "select * from private_table"],
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope).toMatchObject({
      data: { sourceRef: `recording_review:${PROJECT_ID}` },
      evidenceRefs: [
        `project:${PROJECT_ID}`,
        `recording_review:${PROJECT_ID}`,
        `settlement_batch:${PROJECT_ID}`,
      ],
      sourceLabels: ["project_record"],
      missingData: ["safe_missing"],
    });
    expect(serialized).not.toContain("projects:");
    expect(serialized).not.toContain("recording_assets:");
    expect(serialized).not.toContain("settlement_batches:");
    expect(serialized).not.toContain("metadata-secret");
    expect(serialized).not.toContain("signed.actor.jws");
    expect(serialized).not.toContain("private_table");
  });

  it("preserves one safe knowledge chunk fragment while rejecting malformed fragments", () => {
    const envelope = hermesReadSuccess(profile(), {
      data: {
        passages: [
          { sourceRef: "knowledge_base:doc-1#chunk-1" },
          { sourceRef: "knowledge_base:doc-1#chunk-1#extra" },
          { sourceRef: "knowledge_base:#chunk-1" },
          { sourceRef: "knowledge_base:doc-1#" },
        ],
      },
      evidenceRefs: [
        "knowledge_base:doc-1#chunk-1",
        "knowledge_base:doc-1#chunk-1#extra",
        "knowledge_base:#chunk-1",
        "knowledge_base:doc-1#",
      ],
    });

    expect(envelope).toMatchObject({
      data: {
        passages: [{ sourceRef: "knowledge:doc-1#chunk-1" }, {}, {}, {}],
      },
      evidenceRefs: ["knowledge:doc-1#chunk-1"],
    });
  });

  it("keeps ordinary business text while redacting actual credential patterns", () => {
    const ordinaryText = [
      "Password rotation SOP",
      "Authorization workflow policy",
      "Secret shopper campaign",
      "Cookie consent policy",
    ];
    const envelope = hermesReadSuccess(profile(), {
      data: {
        ordinaryText,
        bearer: "Bearer actual-credential-value",
        jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        pem: "-----BEGIN PRIVATE KEY-----\nmaterial\n-----END PRIVATE KEY-----",
        passwordAssignment: "password=hunter2",
        secretAssignment: "api_secret: actual-secret-value",
        authorizationHeader: "Authorization: Basic dXNlcjpwYXNz",
        credentialUrl: "https://user:pass@example.invalid/path",
        internalRoute: "POST /api/internal/hermes/read",
        sql: "select * from private_table where id = 1",
        stack: "Error: failed\n at handler (server.ts:10:2)",
        authorization: "sensitive-key-value",
        sessionToken: "sensitive-token-value",
      },
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope).toMatchObject({ data: { ordinaryText } });
    for (const secret of [
      "actual-credential-value",
      "eyJhbGciOiJSUzI1NiJ9",
      "BEGIN PRIVATE KEY",
      "hunter2",
      "actual-secret-value",
      "dXNlcjpwYXNz",
      "user:pass",
      "/api/internal/",
      "private_table",
      "server.ts:10:2",
      "sensitive-key-value",
      "sensitive-token-value",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("preserves authorized current-context identity and page fields", async () => {
    const actor = profile({
      allowedReadScopes: ["context.read"],
      pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
    });
    const result = await authorizeAndExecuteHermesReadTool(
      supabaseDouble([]) as never,
      actor,
      "xingyao_get_current_context",
      {},
    );

    expect(result).toMatchObject({
      status: 200,
      envelope: {
        status: "ok",
        data: {
          organizationId: ORG_ID,
          role: "owner",
          conversationId: CONVERSATION_ID,
          pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
          allowedReadScopes: ["context.read"],
        },
        evidenceRefs: [`conversation:${CONVERSATION_ID}`],
      },
    });
  });

  it("sanitizes evidence content before allowing only public domain prefixes", () => {
    const validRefs = [
      `conversation:${CONVERSATION_ID}`,
      `project:${PROJECT_ID}`,
      `streamer:${USER_ID}`,
      `streamer_project_profile:${PROJECT_ID}`,
      `live_report:${PROJECT_ID}`,
      `recording_review:${PROJECT_ID}`,
      `knowledge:${PROJECT_ID}`,
      `settlement_batch:${PROJECT_ID}`,
    ];
    const envelope = hermesReadSuccess(profile(), {
      data: {
        refs: [
          { kind: "valid", sourceRef: validRefs[6] },
          {
            kind: "bearer",
            sourceRef: "projects:Bearer source-capability-secret",
          },
          {
            kind: "jws",
            sourceRef: "project:eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          },
          {
            kind: "route",
            sourceRef: "recording_review:/api/internal/hermes/read",
          },
          {
            kind: "sql",
            sourceRef: "live_report:select * from private_table",
          },
          {
            kind: "unknown",
            sourceRef: `private_payroll_rows:${PROJECT_ID}`,
          },
        ],
      },
      evidenceRefs: [
        ...validRefs,
        "projects:Bearer evidence-capability-secret",
        "project:eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
        "recording_review:/api/internal/hermes/read",
        "live_report:select * from private_table",
        `private_payroll_rows:${PROJECT_ID}`,
      ],
    });
    const serialized = JSON.stringify(envelope);

    expect(envelope).toMatchObject({
      data: {
        refs: [
          { kind: "valid", sourceRef: `knowledge:${PROJECT_ID}` },
          { kind: "bearer" },
          { kind: "jws" },
          { kind: "route" },
          { kind: "sql" },
          { kind: "unknown" },
        ],
      },
      evidenceRefs: validRefs,
    });
    for (const forbidden of [
      "source-capability-secret",
      "evidence-capability-secret",
      "eyJhbGciOiJSUzI1NiJ9",
      "/api/internal/",
      "select *",
      "private_table",
      "private_payroll_rows",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("accepts only bounded opaque public evidence identifiers", () => {
    const conversationPrefix = "conversation:";
    const maxLengthId = "a".repeat(
      HERMES_EVIDENCE_REF_MAX_LENGTH - conversationPrefix.length,
    );
    const validRefs = [
      `project:${PROJECT_ID}`,
      "live_report:123456",
      "knowledge:kb_mqu7f3_q42",
      `conversation:${maxLengthId}`,
    ];
    const invalidRefs = [
      "project:https://example.invalid/project/1",
      "knowledge:select pg_sleep(10)",
      "recording_review:folder/review-1",
      "recording_review:folder\\review-1",
      "settlement_batch:batch-1?expand=items",
      "project:project:child",
      "live_report:report-1\nnext",
      `${conversationPrefix}${"b".repeat(
        HERMES_EVIDENCE_REF_MAX_LENGTH - conversationPrefix.length + 1,
      )}`,
    ];
    const envelope = hermesReadSuccess(profile(), {
      data: {
        refs: [
          ...validRefs.map((sourceRef) => ({ sourceRef })),
          ...invalidRefs.map((sourceRef) => ({ sourceRef })),
        ],
      },
      evidenceRefs: [...validRefs, ...invalidRefs],
    });

    expect(envelope).toMatchObject({
      data: {
        refs: [
          ...validRefs.map((sourceRef) => ({ sourceRef })),
          ...invalidRefs.map(() => ({})),
        ],
      },
      evidenceRefs: validRefs,
    });
    const serialized = JSON.stringify(envelope);
    for (const forbidden of [
      "https://",
      "pg_sleep",
      "folder/review",
      "folder\\\\review",
      "?expand=",
      "project:child",
      "report-1\\nnext",
      "b".repeat(
        HERMES_EVIDENCE_REF_MAX_LENGTH - conversationPrefix.length + 1,
      ),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("uses one authorization and execution core for HTTP and Broker callers", async () => {
    const client = supabaseDouble([
      { id: PROJECT_ID, name: "Canonical project", status: "active" },
    ]);

    const result = await authorizeAndExecuteHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      { query: "Canonical", limit: 5 },
    );

    expect(result).toMatchObject({
      status: 200,
      envelope: {
        status: "ok",
        data: { rows: [{ id: PROJECT_ID, name: "Canonical project" }] },
        evidenceRefs: [`project:${PROJECT_ID}`],
        sourceLabels: ["project_record"],
        missingData: [],
        permissionDenials: [],
        truncated: false,
        toolInvocationId: INVOCATION_ID,
      },
    });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("keeps shared role and scope denials identical and dispatch-free", async () => {
    const client = supabaseDouble([]);
    const result = await authorizeAndExecuteHermesReadTool(
      client as never,
      profile({ role: "finance", allowedReadScopes: ["context.read"] }),
      "xingyao_search_live_reports",
      {},
    );

    expect(result).toMatchObject({
      status: 403,
      envelope: {
        status: "error",
        error: { code: "permission_denied" },
        toolInvocationId: INVOCATION_ID,
      },
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns upstream_unavailable as a scoped tool envelope", async () => {
    const client = supabaseErrorDouble();
    const result = await authorizeAndExecuteHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      {},
    );

    expect(result).toMatchObject({
      status: 503,
      envelope: {
        status: "error",
        error: { code: "upstream_unavailable" },
        toolInvocationId: INVOCATION_ID,
      },
    });
  });

  it("sanitizes malicious database fields and text at the shared success boundary", async () => {
    const client = supabaseDouble([
      {
        id: PROJECT_ID,
        name: "Visible project",
        authorization: "Bearer read-secret-that-must-not-leak",
        actorJws: "signed.actor.jws",
        password: "database-password",
        note: "select * from projects; Error at /api/internal/hermes/read",
        stack: "Error: private stack",
      },
    ]);

    const result = await authorizeAndExecuteHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      {},
    );
    const serialized = JSON.stringify(result.envelope);

    expect(result.status).toBe(200);
    expect(result.envelope).toMatchObject({
      status: "ok",
      data: { rows: [{ id: PROJECT_ID, name: "Visible project" }] },
      evidenceRefs: [`project:${PROJECT_ID}`],
    });
    for (const secret of [
      "read-secret-that-must-not-leak",
      "signed.actor.jws",
      "database-password",
      "select *",
      "projects;",
      "/api/internal/",
      "private stack",
      "authorization",
      "actorJws",
      "password",
      "stack",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("returns stable public evidence labels and preserves partial metadata", async () => {
    const client = supabaseDouble([
      { id: PROJECT_ID, name: "Project one" },
      { id: PROJECT_ID_TWO, name: "Project two" },
      { id: PROJECT_ID_THREE, name: "Project three" },
    ]);

    const result = await authorizeAndExecuteHermesReadTool(
      client as never,
      profile(),
      "xingyao_search_projects",
      { limit: 2 },
    );

    expect(result).toMatchObject({
      status: 200,
      envelope: {
        status: "partial",
        data: { rows: [{ id: PROJECT_ID }, { id: PROJECT_ID_TWO }] },
        evidenceRefs: [`project:${PROJECT_ID}`, `project:${PROJECT_ID_TWO}`],
        sourceLabels: ["project_record"],
        missingData: [],
        permissionDenials: [],
        truncated: true,
      },
    });
    expect(JSON.stringify(result.envelope)).not.toContain("projects:");
    expect(client.calls).toContainEqual(["projects", "limit", 3]);
  });
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID_TWO = "66666666-6666-4666-8666-666666666666";
const PROJECT_ID_THREE = "77777777-7777-4777-8777-777777777777";

function profile(
  overrides: Partial<HermesActorProfile> = {},
): HermesActorProfile {
  const enabledSkillVersions = overrides.enabledSkillVersions ?? [];
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: [
      "context.read",
      "projects.search",
      "projects.summary",
      "streamers.project_profile",
      "live_reports.search",
      "recording_reviews.search",
      "knowledge.search",
      "settlements.summary",
    ],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
    ...overrides,
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

function supabaseDouble(rows: unknown[]) {
  const calls: unknown[][] = [];
  const builder = {
    select: vi.fn((fields: string) => {
      calls.push(["projects", "select", fields]);
      return builder;
    }),
    eq: vi.fn((field: string, value: unknown) => {
      calls.push(["projects", "eq", field, value]);
      return builder;
    }),
    ilike: vi.fn((field: string, value: unknown) => {
      calls.push(["projects", "ilike", field, value]);
      return builder;
    }),
    order: vi.fn((field: string, value: unknown) => {
      calls.push(["projects", "order", field, value]);
      return builder;
    }),
    limit: vi.fn(async (limit: number) => {
      calls.push(["projects", "limit", limit]);
      return { data: rows, error: null };
    }),
    maybeSingle: vi.fn(async () => {
      calls.push(["projects", "maybeSingle"]);
      return { data: rows[0] ?? null, error: null };
    }),
  };
  return {
    calls,
    from: vi.fn((table: string) => {
      calls.push([table, "from"]);
      return builder;
    }),
  };
}

function supabaseErrorDouble() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({
      data: null,
      error: { message: "database unavailable" },
    })),
  };
  return {
    from: vi.fn(() => builder),
  };
}
