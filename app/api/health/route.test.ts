import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

// 伪 admin client：organizations 的 head 计数探测按配置成功/失败。
function fakeAdminClient({ error = null }: { error?: Error | null }) {
  const limit = vi.fn(async () => ({
    count: error ? null : 1,
    error,
  }));
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return { from, select, limit };
}

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with a healthy database", async () => {
    const client = fakeAdminClient({});
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, db: true });
    expect(client.from).toHaveBeenCalledWith("organizations");
    // head 计数：探活不拉任何业务行。
    expect(client.select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
  });

  it("returns 503 without leaking details when the database probe fails", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      fakeAdminClient({
        error: new Error("connection refused at 10.0.0.5:5432"),
      }) as never,
    );

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ ok: false, db: false });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("returns 503 when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, db: false });
  });
});
