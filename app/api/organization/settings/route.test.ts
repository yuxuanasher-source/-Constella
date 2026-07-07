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

const organizationRow = {
  id: "org-1",
  name: "旧组织",
  branding: { logoText: "旧" },
};

function buildAdminClient() {
  const selectMaybeSingle = vi.fn(async () => ({
    data: { name: organizationRow.name, branding: organizationRow.branding },
    error: null,
  }));
  const updateMaybeSingle = vi.fn(async () => ({
    data: {
      id: "org-1",
      name: "星耀 MCN",
      branding: {
        logoText: "星",
        brandName: "星耀经营舱",
        brandTagline: "XINGYAO OPS",
      },
    },
    error: null,
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

  it("updates organization branding for owner and writes an audit log", async () => {
    const admin = buildAdminClient();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      admin.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(
      jsonRequest({
        name: "星耀 MCN",
        logoText: "星",
        brandName: "星耀经营舱",
        brandTagline: "XINGYAO OPS",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organization: {
        id: "org-1",
        name: "星耀 MCN",
        branding: {
          logoText: "星",
          brandName: "星耀经营舱",
          brandTagline: "XINGYAO OPS",
        },
      },
    });
    expect(admin.update).toHaveBeenCalledWith({
      name: "星耀 MCN",
      branding: {
        logoText: "星",
        brandName: "星耀经营舱",
        brandTagline: "XINGYAO OPS",
      },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      admin.client,
      expect.objectContaining({
        organizationId: "org-1",
        action: "update",
        module: "organization",
        objectType: "organization_settings",
        changedFields: [
          "name",
          "branding.logoText",
          "branding.brandName",
          "branding.brandTagline",
        ],
      }),
    );
  });

  it("merges partial branding updates with the existing branding payload", async () => {
    const admin = buildAdminClient();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      admin.client as never,
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ brandName: "星耀经营舱" }));

    expect(response.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith({
      branding: { logoText: "旧", brandName: "星耀经营舱" },
    });
  });

  it("rejects non-owner roles", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-2",
      name: "Ops",
      role: "ops_manager",
      organizationId: "org-1",
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ brandName: "星耀经营舱" }));

    expect(response.status).toBe(403);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ brandName: "星耀经营舱" }));

    expect(response.status).toBe(401);
  });

  it("rejects an empty organization name", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(jsonRequest({ name: "   " }));

    expect(response.status).toBe(400);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects oversized brand fields through the schema", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      jsonRequest({ logoText: "太长的字标内容" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid request body",
    });
  });
});
