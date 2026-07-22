import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

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
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
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
