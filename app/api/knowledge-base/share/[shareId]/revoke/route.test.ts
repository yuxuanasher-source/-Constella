import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createKnowledgeShareRepository,
  revokeKnowledgeShare,
} from "@/features/knowledge-base/knowledge-share";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { cosDeleteObject } from "@/lib/storage/tencent-cos";
import { writeAuditLog } from "@/lib/audit/audit";

import { POST } from "./route";

vi.mock("@/features/knowledge-base/knowledge-share", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/features/knowledge-base/knowledge-share")
  >();
  return {
    ...original,
    createKnowledgeShareRepository: vi.fn(),
    revokeKnowledgeShare: vi.fn(),
  };
});
vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/storage/tencent-cos", () => ({
  cosDeleteObject: vi.fn(),
}));
vi.mock("@/lib/audit/audit", () => ({ writeAuditLog: vi.fn() }));

const shareId = "33333333-3333-4333-8333-333333333333";
const auth = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  name: "Owner",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Org",
  role: "owner" as const,
};

describe("knowledge share revoke route", () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createKnowledgeShareRepository).mockReturnValue({} as never);
    vi.mocked(revokeKnowledgeShare).mockResolvedValue({
      id: shareId,
      cleanupPending: false,
    });
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("scopes an idempotent revoke to the authenticated organization", async () => {
    const response = await POST(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ shareId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revokeKnowledgeShare).toHaveBeenCalledWith(
      {
        id: shareId,
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
      },
      expect.objectContaining({ deleteSnapshot: cosDeleteObject }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "revoke_knowledge_share",
        organizationId: auth.organizationId,
        objectId: shareId,
        after: { revoked: true, cleanupPending: false },
      }),
    );
  });

  it("does not disclose whether a foreign or unknown share exists", async () => {
    vi.mocked(revokeKnowledgeShare).mockResolvedValue(null);

    const response = await POST(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ shareId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Share not found" });
  });

  it("rejects roles that cannot manage knowledge shares before mutation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role: "finance" });

    const response = await POST(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ shareId }),
    });

    expect(response.status).toBe(403);
    expect(revokeKnowledgeShare).not.toHaveBeenCalled();
  });

  it("fails closed without the admin client", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await POST(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ shareId }),
    });

    expect(response.status).toBe(503);
    expect(revokeKnowledgeShare).not.toHaveBeenCalled();
  });

  it("returns a desensitized error", async () => {
    vi.mocked(revokeKnowledgeShare).mockRejectedValue(
      new Error("secret COS bucket path"),
    );

    const response = await POST(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ shareId }),
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Unable to revoke share");
    expect(body).not.toContain("secret COS");
  });
});
