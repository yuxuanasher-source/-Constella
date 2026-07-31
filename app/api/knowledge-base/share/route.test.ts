import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import {
  KnowledgeShareCreationError,
  createKnowledgeShare,
  createKnowledgeShareRepository,
  listActiveKnowledgeShares,
} from "@/features/knowledge-base/knowledge-share";
import { getPublicEnv } from "@/lib/config/env";
import { writeAuditLog } from "@/lib/audit/audit";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";
import { cosPutJson, isCosConfigured } from "@/lib/storage/tencent-cos";

import * as route from "./route";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/features/knowledge-base/knowledge-share", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/features/knowledge-base/knowledge-share")
  >();
  return {
    ...original,
    createKnowledgeShare: vi.fn(),
    createKnowledgeShareRepository: vi.fn(),
    listActiveKnowledgeShares: vi.fn(),
  };
});
vi.mock("@/lib/config/env", () => ({
  getPublicEnv: vi.fn(),
}));
vi.mock("@/lib/audit/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/storage/tencent-cos", () => ({
  cosDeleteObject: vi.fn(),
  cosGetJson: vi.fn(),
  cosPutJson: vi.fn(),
  isCosConfigured: vi.fn(),
}));

const auth = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  name: "Owner",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Org",
  role: "owner" as const,
};

describe("knowledge share route", () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(getPublicEnv).mockReturnValue({
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
    } as never);
    vi.mocked(isCosConfigured).mockReturnValue(true);
    vi.mocked(cosPutJson).mockResolvedValue(undefined);
    vi.mocked(createKnowledgeShareRepository).mockReturnValue({} as never);
    vi.mocked(createKnowledgeShare).mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      token: Buffer.alloc(32, 7).toString("base64url"),
      expiresAt: "2026-08-07T12:00:00.000Z",
    });
    vi.mocked(listActiveKnowledgeShares).mockResolvedValue([]);
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses a 32-byte base64url token but never places it in the COS key", async () => {
    const token = Buffer.alloc(32, 7).toString("base64url");
    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-share-1",
        },
        body: JSON.stringify({
          title: "Review",
          contentMd: "# Safe snapshot",
          sourceDocumentId: "doc-1",
          expiresInDays: 7,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      url: `https://app.example.test/share/kb/${token}`,
      expiresAt: "2026-08-07T12:00:00.000Z",
    });
    expect(payload).not.toHaveProperty("token");
    expect(createKnowledgeShare).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        sourceDocumentId: "doc-1",
        requestKey: "create-share-1",
        expiresInDays: 7,
      }),
      expect.objectContaining({
        putSnapshot: cosPutJson,
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "create_knowledge_share",
        organizationId: auth.organizationId,
        objectId: "33333333-3333-4333-8333-333333333333",
        after: expect.objectContaining({
          expiresAt: "2026-08-07T12:00:00.000Z",
          sourceDocumentId: "doc-1",
        }),
      }),
    );
    expect(JSON.stringify(vi.mocked(writeAuditLog).mock.calls)).not.toContain(
      token,
    );
  });

  it("rejects unsupported expiry values", async () => {
    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-share-sensitive-error",
        },
        body: JSON.stringify({
          title: "Review",
          contentMd: "content",
          expiresInDays: 2,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(cosPutJson).not.toHaveBeenCalled();
  });

  it("requires a caller-stable idempotency key", async () => {
    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Review",
          contentMd: "content",
          expiresInDays: 7,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(createKnowledgeShare).not.toHaveBeenCalled();
  });

  it("does not lose the one-time share URL when supplemental auditing fails", async () => {
    vi.mocked(writeAuditLog).mockRejectedValue(new Error("audit database secret"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const token = Buffer.alloc(32, 7).toString("base64url");

    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-share-audit-fail",
        },
        body: JSON.stringify({
          title: "Review",
          contentMd: "content",
          sourceDocumentId: "doc-1",
          expiresInDays: 7,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty("token");
    expect(payload.url).toBe(`https://app.example.test/share/kb/${token}`);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("database secret");
    consoleError.mockRestore();
  });

  it("fails closed when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-share-sensitive-error",
        },
        body: JSON.stringify({ title: "Review", contentMd: "content" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Sharing unavailable" });
    expect(cosPutJson).not.toHaveBeenCalled();
  });

  it("does not expose provider or database error details", async () => {
    vi.mocked(createKnowledgeShare).mockRejectedValue(
      new KnowledgeShareCreationError(),
    );

    const response = await route.POST(
      new Request("http://local/api/knowledge-base/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "create-share-sensitive-error",
        },
        body: JSON.stringify({ title: "Review", contentMd: "content" }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Unable to create share");
    expect(body).not.toContain("AKID-sensitive");
    expect(body).not.toContain("bucket-internal");
  });

  it("lists only minimal active-share fields through the scoped service", async () => {
    vi.mocked(listActiveKnowledgeShares).mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Review",
        createdAt: "2026-07-31T12:00:00.000Z",
        expiresAt: "2026-08-07T12:00:00.000Z",
      },
    ]);

    const response = await (route as typeof route & { GET: typeof route.POST }).GET(
      new Request(
        "http://local/api/knowledge-base/share?sourceDocumentId=doc-1",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listActiveKnowledgeShares).toHaveBeenCalledWith(
      {
        organizationId: auth.organizationId,
        sourceDocumentId: "doc-1",
      },
      expect.any(Object),
    );
    expect(payload).toEqual({
      shares: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Review",
          createdAt: "2026-07-31T12:00:00.000Z",
          expiresAt: "2026-08-07T12:00:00.000Z",
        },
      ],
    });
  });
});
