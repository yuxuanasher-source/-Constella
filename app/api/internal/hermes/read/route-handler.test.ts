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
          businessInstruction: "Select one project from the current queue",
          businessSelection: "Select the active project from the review queue",
          singleIdentifierSql: "SELECT id FROM projects",
          qualifiedIdentifierSql: "SELECT projects.id FROM public.projects;",
          credentialAssignments: [
            "OPENAI_API_KEY=route-openai-secret",
            "AWS_SECRET_ACCESS_KEY=route-aws-secret",
            "XINGYAO_READ_API_SERVICE_TOKEN=route-service-token",
          ],
          stack: "Error: internal stack",
          sourceRef: `private_payroll_rows:${PROJECT_ID}`,
          publicEvidence: { sourceRef: `project:${PROJECT_ID}` },
          numericEvidence: { sourceRef: "live_report:123456" },
          knowledgeEvidence: { sourceRef: "knowledge:kb_mqu7f3_q42" },
          bearerEvidence: {
            sourceRef: "projects:Bearer route-source-secret",
          },
          jwsEvidence: {
            sourceRef: "project:eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
          },
          routeEvidence: {
            sourceRef: "recording_review:/api/internal/hermes/read/source",
          },
          sqlEvidence: {
            sourceRef: "live_report:select * from private_evidence",
          },
          urlEvidence: {
            sourceRef: "project:https://example.invalid/project/1",
          },
          queryEvidence: {
            sourceRef: "settlement_batch:batch-1?expand=items",
          },
          functionEvidence: {
            sourceRef: "knowledge:select pg_sleep(10)",
          },
          controlEvidence: {
            sourceRef: "live_report:report-1\nnext",
          },
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
      data: {
        rows: [
          {
            id: PROJECT_ID,
            name: "Visible project",
            businessInstruction: "Select one project from the current queue",
            businessSelection:
              "Select the active project from the review queue",
            singleIdentifierSql: "[REDACTED]",
            qualifiedIdentifierSql: "[REDACTED]",
            credentialAssignments: ["[REDACTED]", "[REDACTED]", "[REDACTED]"],
            publicEvidence: { sourceRef: `project:${PROJECT_ID}` },
            numericEvidence: { sourceRef: "live_report:123456" },
            knowledgeEvidence: { sourceRef: "knowledge:kb_mqu7f3_q42" },
          },
        ],
      },
      evidenceRefs: [`project:${PROJECT_ID}`],
    });
    for (const forbidden of [
      "route-secret",
      "private-key-material",
      "cookie-secret",
      "route-openai-secret",
      "route-aws-secret",
      "route-service-token",
      "SELECT id FROM projects",
      "SELECT projects.id FROM public.projects",
      "select *",
      "projects:",
      "/api/internal/",
      "internal stack",
      "authorization",
      "privateKey",
      "cookie",
      "stack",
      "route-source-secret",
      "eyJhbGciOiJSUzI1NiJ9",
      "private_evidence",
      "private_payroll_rows",
      "https://",
      "?expand=",
      "pg_sleep",
      "report-1\\nnext",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("keeps current-context fields identical to the shared Read core", async () => {
    const keys = rsaKeyPair();
    vi.stubEnv("XINGYAO_READ_API_SERVICE_TOKEN", SERVICE_TOKEN);
    vi.stubEnv("XINGYAO_ACTOR_JWS_PUBLIC_KEY", keys.publicKeyPem);
    vi.stubEnv("XINGYAO_ACTOR_JWS_KEY_ID", "kid-read");
    createSupabaseAdminClientMock.mockReturnValue(supabaseDouble([]));
    const actor = profile({
      allowedReadScopes: ["context.read"],
      pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
    });
    const actorJws = await signHermesActorAssertion(actor, {
      privateKeyPem: keys.privateKeyPem,
      kid: "kid-read",
      now: new Date(),
    });

    const response = await handleHermesReadRoute(
      new Request("http://localhost/api/internal/hermes/read/context", {
        method: "POST",
        headers: {
          authorization: `Bearer ${SERVICE_TOKEN}`,
          "x-xingyao-actor": actorJws,
          "content-type": "application/json",
        },
        body: "{}",
      }),
      "xingyao_get_current_context",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      data: {
        organizationId: ORGANIZATION_ID,
        role: "owner",
        conversationId: CONVERSATION_ID,
        pageContext: { pageType: "project", objectIds: [PROJECT_ID] },
        allowedReadScopes: ["context.read"],
      },
      evidenceRefs: [`conversation:${CONVERSATION_ID}`],
    });
  });
});

function profile(
  overrides: Partial<HermesActorProfile> = {},
): HermesActorProfile {
  const enabledSkillVersions = overrides.enabledSkillVersions ?? [];
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
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return { from: vi.fn(() => builder) };
}
