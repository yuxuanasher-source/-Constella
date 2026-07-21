import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { computeHermesSkillGrantsHash } from "./actor-fingerprint";
import { signHermesActorAssertion } from "./actor-assertion";
import type { HermesActorProfile } from "./contracts";
import {
  HERMES_READ_ENDPOINTS,
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
      new Request("http://localhost/api/internal/hermes/read/live-reports/search", {
        method: "POST",
        headers: {
          Authorization: "Bearer read-service-token-that-is-long-enough",
          "X-Xingyao-Actor": token,
        },
      }),
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
    expect(client.calls).toContainEqual(["projects", "eq", "organization_id", ORG_ID]);
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
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

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
