import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns ok with a healthy database", async () => {
    const client = fakeAdminClient({});
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
    process.env.XINGYAO_HERMES_GATEWAY_ENABLED = "true";
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST =
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
    process.env.XINGYAO_HERMES_GATEWAY_BASE_URL = "ws://127.0.0.1:8788";
    process.env.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN =
      "gateway-service-token-that-is-long-enough";
    process.env.XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED = "true";
    process.env.RELEASE_SHA = "704595bf4a7a216801881a46e78d9c8ece225351";

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      db: true,
      hermesRuntime: {
        gatewayEnabled: true,
        gatewayConfigured: true,
        gatewayAllowlistConfigured: true,
        legacyEnabled: true,
        compatibilityStatus: "gateway_v2_ready",
      },
      release: {
        sha: "704595bf4a7a216801881a46e78d9c8ece225351",
      },
    });
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    expect(JSON.stringify(body)).not.toContain("gateway-service-token");
    expect(JSON.stringify(body)).not.toContain("11111111-1111");
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
    expect(body).toMatchObject({ ok: false, db: false });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("returns 503 when the admin client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      db: false,
    });
  });

  it("returns a redacted 503 when Hermes runtime configuration is malformed", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      fakeAdminClient({}) as never,
    );
    process.env.XINGYAO_HERMES_GATEWAY_ENABLED = "true";
    process.env.XINGYAO_HERMES_GATEWAY_ALLOWLIST =
      "11111111-1111-4111-8111-111111111111/not-a-user";
    process.env.XINGYAO_HERMES_GATEWAY_BASE_URL = "ws://127.0.0.1:8788";
    process.env.XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN =
      "gateway-service-token-that-is-long-enough";

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      db: true,
      hermesRuntime: {
        gatewayEnabled: false,
        gatewayConfigured: false,
        gatewayAllowlistConfigured: false,
        legacyEnabled: false,
        compatibilityStatus: "configuration_error",
      },
      release: { sha: null },
    });
    expect(JSON.stringify(body)).not.toContain("not-a-user");
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    expect(JSON.stringify(body)).not.toContain("gateway-service-token");
  });
});
