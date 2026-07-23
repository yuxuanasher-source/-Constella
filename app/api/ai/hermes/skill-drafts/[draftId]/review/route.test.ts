import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeHermesSkillBundleSha256 } from "@/features/ai/hermes/approved-skill-registry";
import { verifyHermesSkillApproval } from "@/features/ai/hermes/skill-signing";

const createSupabaseServerClientMock = vi.fn();
const getAuthContextMock = vi.fn();

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: getAuthContextMock,
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const MANIFEST = {
  skillId: "risk-review",
  version: "1.0.0",
  allowedRoles: ["owner"],
  requiredReadScopes: ["projects.summary"],
};
const BUNDLE = "# Risk review";

describe("POST /api/ai/hermes/skill-drafts/[draftId]/review", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    createSupabaseServerClientMock.mockReset();
    getAuthContextMock.mockReset();
    getAuthContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "owner",
    });
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY = privateKey.export({
      type: "pkcs8",
      format: "pem",
    }) as string;
    process.env.XINGYAO_HERMES_SKILL_SIGNING_KEY_ID = "skill-key-2026-07";
  });

  it("approves pending drafts as owner and sends a detached signature to the review RPC", async () => {
    const client = supabaseClient(draftRow());
    createSupabaseServerClientMock.mockResolvedValue(client);
    const { POST } = await import("./route");

    const response = await POST(
      request({ decision: "approved", reviewNote: "Looks safe" }),
      { params: Promise.resolve({ draftId: DRAFT_ID }) },
    );
    const body = await response.json();
    const rpcCall = client.rpc.mock.calls.at(0);
    expect(rpcCall).toBeDefined();
    const rpcArgs = rpcCall?.[1] as Record<string, string>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      draftId: DRAFT_ID,
      status: "approved",
      signingKeyId: "skill-key-2026-07",
      publicKeyPem: expect.stringContaining("BEGIN PUBLIC KEY"),
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "review_ai_hermes_skill_draft",
      expect.objectContaining({
        p_draft_id: DRAFT_ID,
        p_next_status: "approved",
        p_review_note: "Looks safe",
        p_signing_key_id: "skill-key-2026-07",
        p_signature: expect.any(String),
      }),
    );
    expect(
      verifyHermesSkillApproval({
        manifest: MANIFEST,
        bundleSha256: computeHermesSkillBundleSha256(BUNDLE),
        signingKeyId: rpcArgs.p_signing_key_id,
        signature: rpcArgs.p_signature,
        publicKeys: { "skill-key-2026-07": body.publicKeyPem },
      }),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  });

  it("rejects pending drafts without signing them", async () => {
    const client = supabaseClient(draftRow());
    createSupabaseServerClientMock.mockResolvedValue(client);
    const { POST } = await import("./route");

    const response = await POST(request({ decision: "rejected" }), {
      params: Promise.resolve({ draftId: DRAFT_ID }),
    });

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith(
      "review_ai_hermes_skill_draft",
      expect.objectContaining({
        p_next_status: "rejected",
        p_signature: null,
        p_signing_key_id: null,
      }),
    );
  });

  it.each([
    ["non-owner", { role: "ops_manager" }, {}],
    ["non-staff", { role: "streamer" }, {}],
    ["model actor", { role: "owner" }, { "x-hermes-actor-type": "model" }],
  ])("forbids %s review attempts", async (_label, authOverride, headers) => {
    getAuthContextMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORG_ID,
      ...authOverride,
      role: typeof authOverride.role === "string" ? authOverride.role : "owner",
    });
    const client = supabaseClient(draftRow());
    createSupabaseServerClientMock.mockResolvedValue(client);
    const { POST } = await import("./route");

    const response = await POST(request({ decision: "approved" }, headers), {
      params: Promise.resolve({ draftId: DRAFT_ID }),
    });

    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ai/hermes/skill-drafts/draft/review", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    organization_id: ORG_ID,
    owner_user_id: USER_ID,
    skill_id: "risk-review",
    version: 1,
    manifest: MANIFEST,
    bundle: BUNDLE,
    bundle_sha256: computeHermesSkillBundleSha256(BUNDLE),
    status: "pending_review",
    ...overrides,
  };
}

function supabaseClient(row: Record<string, unknown>) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq, maybeSingle }));
  const rpc = vi.fn(
    async (_fn: string, _args: Record<string, unknown>) => ({
      data: { draft_id: DRAFT_ID, status: "approved" },
      error: null,
    }),
  );
  return {
    from: vi.fn(() => ({ select })),
    rpc,
  };
}
