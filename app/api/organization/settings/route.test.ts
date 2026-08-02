import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeAuditLog } from "@/lib/audit/audit";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/audit/audit", () => ({
  writeAuditLog: vi.fn(),
}));

function buildAdminClient(options?: {
  current?: { id: string; name: string } | null;
  currentError?: unknown;
  updateError?: unknown;
}) {
  const current =
    options?.current === undefined
      ? { id: "org-1", name: "旧组织" }
      : options.current;
  const selectMaybeSingle = vi.fn(async () => ({
    data: current,
    error: options?.currentError ?? null,
  }));
  const updateMaybeSingle = vi.fn(async () => ({
    data: options?.updateError ? null : { id: "org-1", name: "星耀 MCN" },
    error: options?.updateError ?? null,
  }));
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ maybeSingle: updateMaybeSingle })),
    })),
  }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: selectMaybeSingle })),
  }));
  const from = vi.fn(() => ({ select, update }));
  return { client: { from }, update };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/organization/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/organization/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      name: "Owner",
      role: "owner",
      organizationId: "org-1",
      organizationName: "旧组织",
    } as never);
  });

  it("updates only the exact-auth organization name and audits only name", async () => {
    const admin = buildAdminClient();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀 MCN" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organization: { id: "org-1", name: "星耀 MCN" },
    });
    expect(admin.update).toHaveBeenCalledWith({ name: "星耀 MCN" });
    expect(writeAuditLog).toHaveBeenCalledWith(
      admin.client,
      expect.objectContaining({
        organizationId: "org-1",
        before: { name: "旧组织" },
        after: { name: "星耀 MCN" },
        changedFields: ["name"],
      }),
    );
  });

  it.each(["logoText", "brandName", "brandTagline"])(
    "returns BRAND_STUDIO_REQUIRED before any mutation for legacy %s",
    async (field) => {
      const admin = buildAdminClient();
      vi.mocked(createSupabaseAdminClient).mockReturnValue(
        admin.client as never,
      );
      const { PATCH } = await import("./route");
      const response = await PATCH(
        jsonRequest({ name: "不应写入", [field]: "旧值" }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Brand settings have moved to Brand Studio",
        code: "BRAND_STUDIO_REQUIRED",
      });
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
      expect(admin.update).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    },
  );

  it("does not let unknown-field stripping bypass the legacy-field guard", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      jsonRequest({ brandName: "旧入口", unexpected: "ignored?" }),
    );

    expect(response.status).toBe(409);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unrelated unknown fields", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ unexpected: true }));

    expect(response.status).toBe(400);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns 503 when the authenticated server client is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀" }));

    expect(response.status).toBe(503);
    expect(getAuthContext).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀" }));

    expect(response.status).toBe(401);
  });

  it("returns 403 for non-owner roles before parsing or mutation", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-2",
      name: "Ops",
      role: "ops_manager",
      organizationId: "org-1",
    } as never);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ brandName: "旧入口" }));

    expect(response.status).toBe(403);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects an empty organization name", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "   " }));

    expect(response.status).toBe(400);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("returns 503 when the admin client is not configured", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀" }));

    expect(response.status).toBe(503);
  });

  it("returns 404 when the exact organization does not exist", async () => {
    const admin = buildAdminClient({ current: null });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀" }));

    expect(response.status).toBe(404);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it("maps database failures to a safe 503 without raw details", async () => {
    const admin = buildAdminClient({
      currentError: { message: "raw database diagnostics" },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin.client as never);
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "星耀" }));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("raw database");
  });
});
