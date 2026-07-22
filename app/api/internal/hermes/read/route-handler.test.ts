import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createSupabaseAdminClientMock } = vi.hoisted(() => ({
  createSupabaseAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: createSupabaseAdminClientMock,
}));

import { computeHermesSkillGrantsHash } from "@/features/ai/hermes/actor-fingerprint";
import { signHermesActorAssertion } from "@/features/ai/hermes/actor-assertion";
import type { HermesActorProfile } from "@/features/ai/hermes/contracts";

import { handleHermesReadRoute } from "./route-handler";

const SERVICE_TOKEN = "read-service-token-that-is-long-enough";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Hermes HTTP Read route handler", () => {
  it("never returns malicious database fields, secret text, or table evidence", async () => {
    const keys = rsaKeyPair();
    vi.stubEnv("XINGYAO_READ_API_SERVICE_TOKEN", SERVICE_TOKEN);
    vi.stubEnv("XINGYAO_ACTOR_JWS_PUBLIC_KEY", keys.publicKeyPem);
    vi.stubEnv("XINGYAO_ACTOR_JWS_KEY_ID", "kid-read");
    createSupabaseAdminClientMock.mockReturnValue(
      supabaseDouble([
        {
          id: PROJECT_ID,
          name: "Visible project",
          authorization: "Bearer route-secret",
          privateKey: "private-key-material",
          cookie: "session=cookie-secret",
          note: "select * from projects at /api/internal/hermes/read",
          stack: "Error: internal stack",
        },
      ]),
    );
    const actor = profile();
    const actorJws = await signHermesActorAssertion(actor, {
      privateKeyPem: keys.privateKeyPem,
      kid: "kid-read",
      now: new Date(),
    });

    const response = await handleHermesReadRoute(
      new Request("http://localhost/api/internal/hermes/read/projects/search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SERVICE_TOKEN}`,
          "x-xingyao-actor": actorJws,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      "xingyao_search_projects",
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      data: { rows: [{ id: PROJECT_ID, name: "Visible project" }] },
      evidenceRefs: [`project:${PROJECT_ID}`],
    });
    for (const forbidden of [
      "route-secret",
      "private-key-material",
      "cookie-secret",
      "select *",
      "projects:",
      "/api/internal/",
      "internal stack",
      "authorization",
      "privateKey",
      "cookie",
      "stack",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

function profile(): HermesActorProfile {
  const enabledSkillVersions: HermesActorProfile["enabledSkillVersions"] = [];
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: ["projects.search"],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
    pageContext: { pageType: "projects", objectIds: [] },
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
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return { from: vi.fn(() => builder) };
}
