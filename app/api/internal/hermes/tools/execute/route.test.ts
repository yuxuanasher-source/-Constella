import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  computeHermesSkillGrantsHash,
  createHermesActorFingerprint,
} from "@/features/ai/hermes/actor-fingerprint";
import {
  computeHermesSkillBundleSha256,
  type HermesSkillDraftApprovalRow,
} from "@/features/ai/hermes/approved-skill-registry";
import type { HermesActorProfile } from "@/features/ai/hermes/contracts";
import { HermesLiveActorAuthorizationError } from "@/features/ai/hermes/live-actor-authorization";
import {
  loadHermesSkillSigningKeyFromEnv,
  signHermesSkillApproval,
} from "@/features/ai/hermes/skill-signing";
import { evaluateHermesSkillGrantsForActor } from "@/features/ai/hermes/skill-governance";
import {
  executeHermesToolBrokerCall,
  HermesToolBrokerError,
} from "@/features/ai/hermes/tool-broker";

import {
  createHermesProductToolBrokerDependencies,
  createHermesToolExecuteHandler,
} from "./route";

const CAPABILITY = "c".repeat(43);
const INVOCATION_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_MESSAGE_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_READ_SCOPES = [
  "context.read",
  "projects.search",
  "projects.summary",
  "streamers.project_profile",
  "live_reports.search",
  "recording_reviews.search",
  "knowledge.search",
  "settlements.summary",
] as const;

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

  it("keeps a rejected memory tool-local and accepts only its strict body", async () => {
    const body = {
      invocationId: INVOCATION_ID,
      toolCallId: "memory-call-1",
      toolName: "xingyao_memory_remember" as const,
      arguments: {
        memoryType: "preference" as const,
        content: "sensitive content",
        parentInvocationId: INVOCATION_ID,
        sourceMessageId: SOURCE_MESSAGE_ID,
      },
    };
    const envelope = {
      status: "error" as const,
      error: { code: "memory_content_rejected" as const },
      evidenceRefs: [],
      sourceLabels: ["actor_private_memory"],
      updatedAt: "2026-07-22T00:00:00.000Z",
      observedAt: "2026-07-22T00:00:00.000Z",
      missingData: [],
      permissionDenials: ["memory_content_rejected"],
      truncated: false,
      invocationId: INVOCATION_ID,
      toolCallId: "memory-call-1",
      toolName: "xingyao_memory_remember" as const,
      traceId: "memory-call-1",
    };
    const execute = vi.fn(async () => envelope);
    const handler = createHermesToolExecuteHandler({ execute });

    const response = await handler(request(body, CAPABILITY));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(envelope);
    expect(execute).toHaveBeenCalledWith({
      capabilityToken: CAPABILITY,
      request: body,
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

  it("reauthorizes approved draft Skill grants with the same signed grant resolver used by production skill_view", async () => {
    const key = testSigningKey("skill-key-2026-07");
    const row = approvedDraftRow(key);
    const grants = signedGrantsForRow(row, key);
    const actor = actorSnapshot(grants);
    const dependencies = createHermesProductToolBrokerDependencies({
      client: productClient({ skillRows: [row] }),
      publicKeys: { [key.private.keyId]: key.publicKeyPem },
    });

    await expect(
      dependencies.reauthorizeActor({
        actorSnapshot: actor,
        expectedActorFingerprint: createHermesActorFingerprint(actor),
      }),
    ).resolves.toMatchObject({
      actor: expect.objectContaining({
        enabledSkillVersions: grants,
        skillGrantsHash: computeHermesSkillGrantsHash(grants),
      }),
      actorFingerprint: createHermesActorFingerprint(actor),
    });

    await expect(
      dependencies.loadApprovedSkillArtifact?.({
        actor,
        skillId: "risk-review",
      }),
    ).resolves.toMatchObject({
      skillId: "risk-review",
      version: "1.0.0",
      bundle: row.bundle,
      bundleSha256: row.bundle_sha256,
      source: "draft",
    });
  });

  it("keeps approved draft grant hashes through production dependencies during skill_view execute", async () => {
    const key = testSigningKey("skill-key-2026-07");
    const row = approvedDraftRow(key);
    const grants = signedGrantsForRow(row, key);
    const actor = actorSnapshot(grants);
    const actorFingerprint = createHermesActorFingerprint(actor);
    const dependencies = createHermesProductToolBrokerDependencies({
      client: productClient({ skillRows: [row] }),
      publicKeys: { [key.private.keyId]: key.publicKeyPem },
    });
    dependencies.repository = brokerRepository();
    dependencies.loadCapability = vi.fn(async () => ({
      actor,
      actorFingerprint,
      turnId: "77777777-7777-4777-8777-777777777777",
      invocationId: INVOCATION_ID,
      rootInvocationId: INVOCATION_ID,
      allowedTools: ["xingyao_skill_view"] as const,
      scopes: ["projects.summary"] as const,
      depth: 0,
      aiStateWritesAllowed: true,
      memorySnapshotGeneration: 0,
    }));

    await expect(
      executeHermesToolBrokerCall({
        capabilityToken: CAPABILITY,
        request: skillViewBody("risk-review"),
        dependencies,
        now: new Date("2026-07-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "ok",
      data: {
        skillId: "risk-review",
        version: "1.0.0",
        bundle: row.bundle,
        bundleSha256: row.bundle_sha256,
        source: "draft",
      },
    });
  });

  it.each([
    ["bad signature", (row: ReturnType<typeof approvedDraftRow>) => ({ ...row, signature: "00" })],
    ["bad hash", (row: ReturnType<typeof approvedDraftRow>) => ({ ...row, bundle_sha256: "b".repeat(64) })],
    ["revoked", (row: ReturnType<typeof approvedDraftRow>) => ({ ...row, status: "revoked" })],
  ])("fails reauthorization for %s draft grants", async (_label, mutate) => {
    const key = testSigningKey("skill-key-2026-07");
    const row = approvedDraftRow(key);
    const actor = actorSnapshot(signedGrantsForRow(row, key));
    const dependencies = createHermesProductToolBrokerDependencies({
      client: productClient({ skillRows: [mutate(row)] }),
      publicKeys: { [key.private.keyId]: key.publicKeyPem },
    });

    await expect(
      dependencies.reauthorizeActor({
        actorSnapshot: actor,
        expectedActorFingerprint: createHermesActorFingerprint(actor),
      }),
    ).rejects.toMatchObject({
      code: "actor_changed" satisfies HermesLiveActorAuthorizationError["code"],
    });
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

function skillViewBody(skillId: string) {
  return {
    invocationId: INVOCATION_ID,
    toolCallId: "skill-call-1",
    toolName: "xingyao_skill_view" as const,
    arguments: { skillId },
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

function actorSnapshot(
  enabledSkillVersions: HermesActorProfile["enabledSkillVersions"],
): HermesActorProfile {
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: "owner",
    conversationId: CONVERSATION_ID,
    invocationId: INVOCATION_ID,
    allowedReadScopes: [...OWNER_READ_SCOPES],
    enabledSkillVersions,
    skillGrantsHash: computeHermesSkillGrantsHash(enabledSkillVersions),
    profileVersion: "hermes-xingyao-v2",
    pageContext: { pageType: "projects", objectIds: [] },
  };
}

function signedGrantsForRow(
  row: ReturnType<typeof approvedDraftRow>,
  key: ReturnType<typeof testSigningKey>,
) {
  return evaluateHermesSkillGrantsForActor({
    role: "owner",
    allowedReadScopes: OWNER_READ_SCOPES,
    actor: { organizationId: ORGANIZATION_ID, userId: USER_ID },
    approvedDraftRows: [row],
    publicKeys: { [key.private.keyId]: key.publicKeyPem },
  }).enabledSkillVersions;
}

function approvedDraftRow(key: ReturnType<typeof testSigningKey>) {
  const manifest = {
    skillId: "risk-review",
    version: "1.0.0",
    allowedRoles: ["owner"],
    requiredReadScopes: ["projects.summary"],
  };
  const bundle = "# Risk review";
  const bundleSha256 = computeHermesSkillBundleSha256(bundle);
  const signed = signHermesSkillApproval({
    manifest,
    bundleSha256,
    signingKey: key.private,
  });
  return {
    id: "66666666-6666-4666-8666-666666666666",
    organization_id: ORGANIZATION_ID,
    owner_user_id: USER_ID,
    skill_id: "risk-review",
    version: 1,
    manifest,
    bundle,
    bundle_sha256: bundleSha256,
    status: "approved",
    signing_key_id: signed.signingKeyId,
    signature: signed.signature,
  };
}

function productClient({ skillRows }: { skillRows: HermesSkillDraftApprovalRow[] }) {
  const skillQuery = {
    eq: vi.fn(() => skillQuery),
    order: vi.fn(async () => ({ data: skillRows, error: null })),
  };
  const membershipQuery = {
    eq: vi.fn(() => membershipQuery),
    maybeSingle: vi.fn(async () => ({ data: { role: "owner" }, error: null })),
  };
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() =>
        table === "ai_hermes_skill_drafts" ? skillQuery : membershipQuery,
      ),
    })),
  };
}

function brokerRepository() {
  return {
    claimBrokerCall: vi.fn(async () => ({
      brokerCallId: "88888888-8888-4888-8888-888888888888",
      status: "claimed" as const,
      execute: true,
      reused: false,
      fencingToken: 1,
      sanitizedResponseEnvelope: null,
    })),
    completeBrokerCall: vi.fn(async () => ({
      brokerCallId: "88888888-8888-4888-8888-888888888888",
      status: "completed" as const,
      reused: false,
      fencingToken: 1,
      messageId: "99999999-9999-4999-8999-999999999999",
      sequence: 1,
    })),
    completeMemoryBrokerCall: vi.fn(),
    loadActiveMemories: vi.fn(async () => []),
    rememberMemory: vi.fn(),
    forgetMemory: vi.fn(),
  };
}

function testSigningKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const loaded = loadHermesSkillSigningKeyFromEnv({
    XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY: privateKeyPem,
    XINGYAO_HERMES_SKILL_SIGNING_KEY_ID: keyId,
  });
  return { private: loaded, publicKeyPem };
}
