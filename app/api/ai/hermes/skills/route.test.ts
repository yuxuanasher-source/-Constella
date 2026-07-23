import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  computeHermesSkillBundleSha256,
  type HermesSkillDraftApprovalRow,
} from "@/features/ai/hermes/approved-skill-registry";
import {
  loadHermesSkillSigningKeyFromEnv,
  signHermesSkillApproval,
} from "@/features/ai/hermes/skill-signing";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

describe("GET /api/ai/hermes/skills", () => {
  const originalEnv = { ...process.env };
  let signingKey: ReturnType<typeof testSigningKey>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    createSupabaseServerClientMock.mockReset();
    getAuthContextMock.mockReset();
    createSupabaseServerClientMock.mockResolvedValue({ from: vi.fn() });
    getAuthContextMock.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      role: "finance",
    });
    signingKey = testSigningKey("skill-key-2026-07");
    process.env.XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY =
      signingKey.privateKeyPem;
    process.env.XINGYAO_HERMES_SKILL_SIGNING_PUBLIC_KEY =
      signingKey.publicKeyPem;
    process.env.XINGYAO_HERMES_SKILL_SIGNING_KEY_ID = "skill-key-2026-07";
  });

  it("returns the governed Skill catalog for the current actor role", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      assistant: "xingyao-ai",
      kernelId: "hermes-agent-fork",
      profileVersion: "hermes-xingyao-v1+skills.c1755ec71e802748",
      role: "finance",
      enabledSkillIds: ["business-context", "settlement-analysis"],
    });
    expect(body.skills).toEqual([
      expect.objectContaining({
        skillId: "business-context",
        enabled: true,
        artifact: expect.objectContaining({
          path: "builtin-skills/business-context/SKILL.md",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
      expect.objectContaining({
        skillId: "project-review",
        enabled: false,
        reason: "role_not_allowed",
      }),
      expect.objectContaining({
        skillId: "report-precheck",
        enabled: false,
        reason: "role_not_allowed",
      }),
      expect.objectContaining({
        skillId: "settlement-analysis",
        enabled: true,
      }),
    ]);
  });

  it("returns only safe artifact metadata and public keys", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.signingPublicKeys).toEqual([
      expect.objectContaining({
        keyId: "skill-key-2026-07",
        publicKeyPem: expect.stringContaining("BEGIN PUBLIC KEY"),
      }),
    ]);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("skill_manage");
    expect(serialized).not.toContain("skill_install");
    expect(serialized).not.toContain("skill_repair");
    expect(serialized).not.toContain("skill_enable");
    expect(serialized).not.toContain("skill_publish");
    expect(serialized).not.toContain("externalRegistryUrl");
    expect(serialized).not.toContain("/api/internal/");
    expect(body.skills[0]).not.toHaveProperty("bundle");
  });

  it("merges only approved signed draft Skill grants for the current actor", async () => {
    const approved = approvedDraftRow(signingKey);
    createSupabaseServerClientMock.mockResolvedValue(
      supabaseWithSkillDraftRows([
        approved,
        { ...approved, id: "44444444-4444-4444-8444-444444444441", status: "rejected" },
        { ...approved, id: "44444444-4444-4444-8444-444444444442", status: "superseded" },
        { ...approved, id: "44444444-4444-4444-8444-444444444443", status: "revoked" },
        { ...approved, id: "44444444-4444-4444-8444-444444444444", signature: null },
        { ...approved, id: "44444444-4444-4444-8444-444444444445", bundle_sha256: "b".repeat(64) },
        { ...approved, id: "44444444-4444-4444-8444-444444444446", organization_id: "55555555-5555-4555-8555-555555555555" },
      ]),
    );
    getAuthContextMock.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      role: "owner",
    });
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.enabledSkillIds).toContain("risk-review");
    expect(body.enabledSkillVersions).toContainEqual({
      skillId: "risk-review",
      version: "1.0.0",
      bundleSha256: approved.bundle_sha256,
    });
    expect(
      body.skills.find((skill: { skillId: string }) => skill.skillId === "risk-review"),
    ).toMatchObject({
      skillId: "risk-review",
      enabled: true,
      artifact: {
        source: "approved-draft",
        sha256: approved.bundle_sha256,
      },
    });
    expect(serialized).not.toContain(String(approved.bundle));
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("skill_install");
    expect(serialized).not.toContain("externalRegistryUrl");
  });

  it("rejects non-MCN staff before exposing the catalog", async () => {
    getAuthContextMock.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      role: "brand",
    });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    getAuthContextMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(401);
  });
});

function supabaseWithSkillDraftRows(rows: HermesSkillDraftApprovalRow[]) {
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({ data: rows, error: null })),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => query),
    })),
  };
}

function approvedDraftRow(signingKey: ReturnType<typeof testSigningKey>) {
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
    signingKey: signingKey.private,
  });
  return {
    id: "44444444-4444-4444-8444-444444444440",
    organization_id: "33333333-3333-4333-8333-333333333333",
    owner_user_id: "22222222-2222-4222-8222-222222222222",
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
  return { private: loaded, privateKeyPem, publicKeyPem };
}
