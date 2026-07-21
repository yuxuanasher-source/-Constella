import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

describe("GET /api/ai/hermes/skills", () => {
  beforeEach(() => {
    vi.resetModules();
    createSupabaseServerClientMock.mockReset();
    getAuthContextMock.mockReset();
    createSupabaseServerClientMock.mockResolvedValue({ from: vi.fn() });
    getAuthContextMock.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      role: "finance",
    });
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
