import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import { createGovernedExport } from "@/features/exports/export-service";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock("@/features/exports/export-service", () => ({
  createGovernedExport: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("exports route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(createGovernedExport).mockResolvedValue({
      kind: "audit_logs",
      filename: "audit_logs-2026-06-02.csv",
      content: "模块,动作\nsettlement,lock",
      fieldCount: 2,
      rowCount: 1,
    });
  });

  it("creates a governed export preview for MCN staff", async () => {
    const response = await POST(
      new Request("http://localhost/api/exports", {
        method: "POST",
        body: JSON.stringify({
          kind: "audit_logs",
          rows: [{ module: "settlement", action: "lock" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      export: {
        kind: "audit_logs",
        filename: "audit_logs-2026-06-02.csv",
        content: "模块,动作\nsettlement,lock",
        fieldCount: 2,
        rowCount: 1,
      },
    });
    expect(createGovernedExport).toHaveBeenCalledWith({
      client: { client: "supabase" },
      actor: auth,
      kind: "audit_logs",
      rows: [{ module: "settlement", action: "lock" }],
    });
  });

  it("blocks streamers from creating operations exports", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await POST(
      new Request("http://localhost/api/exports", {
        method: "POST",
        body: JSON.stringify({ kind: "audit_logs" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createGovernedExport).not.toHaveBeenCalled();
  });
});
