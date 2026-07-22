import { describe, expect, it, vi } from "vitest";

import * as envConfig from "./env";

const parsePublicEnv = envConfig.parsePublicEnv;

describe("parsePublicEnv", () => {
  it("accepts a local Supabase URL and anon key", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key");
  });
});

describe("parseServerEnv", () => {
  it("accepts the service role key and documented private storage bucket", () => {
    const parseServerEnv = (envConfig as Record<string, unknown>)
      .parseServerEnv;

    expect(parseServerEnv).toBeTypeOf("function");
    expect(
      (
        parseServerEnv as (
          env: Record<string, string | undefined>,
        ) => Record<string, string>
      )({
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        STORAGE_BUCKET_PRIVATE: "jy-private",
        XINGYAO_HERMES_GATEWAY_ENABLED: "true",
        XINGYAO_HERMES_GATEWAY_ALLOWLIST:
          "11111111-1111-4111-8111-111111111111/*",
        XINGYAO_HERMES_GATEWAY_BASE_URL: "ws://127.0.0.1:8788",
        XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
          "gateway-service-token-that-is-long-enough",
        XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: "false",
      }),
    ).toMatchObject({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      STORAGE_BUCKET_PRIVATE: "jy-private",
      XINGYAO_HERMES_GATEWAY_ENABLED: true,
      XINGYAO_HERMES_GATEWAY_ALLOWLIST:
        "11111111-1111-4111-8111-111111111111/*",
      XINGYAO_HERMES_GATEWAY_BASE_URL: "ws://127.0.0.1:8788",
      XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN:
        "gateway-service-token-that-is-long-enough",
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: false,
    });
  });

  it("defaults the documented private storage bucket", () => {
    const parseServerEnv = (envConfig as Record<string, unknown>)
      .parseServerEnv as (
      env: Record<string, string | undefined>,
    ) => Record<string, string>;

    expect(
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      }),
    ).toMatchObject({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      STORAGE_BUCKET_PRIVATE: "jy-private",
      XINGYAO_HERMES_GATEWAY_ENABLED: false,
      XINGYAO_HERMES_GATEWAY_ALLOWLIST: "",
      XINGYAO_HERMES_GATEWAY_BASE_URL: null,
      XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN: null,
      XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED: false,
    });
  });

  it("rejects malformed Hermes Gateway server-only env instead of silently defaulting", () => {
    const parseServerEnv = (envConfig as Record<string, unknown>)
      .parseServerEnv as (
      env: Record<string, string | undefined>,
    ) => Record<string, unknown>;

    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        XINGYAO_HERMES_GATEWAY_ENABLED: "yes",
      }),
    ).toThrow();
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        XINGYAO_HERMES_GATEWAY_ALLOWLIST:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow();
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        XINGYAO_HERMES_GATEWAY_BASE_URL: "not-a-url",
      }),
    ).toThrow();
  });
});

describe("getSupabaseInternalUrl", () => {
  it("returns the internal URL when configured", () => {
    expect(
      envConfig.getSupabaseInternalUrl({
        SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
      }),
    ).toBe("http://127.0.0.1:8000");
  });

  it("returns null when the env is absent", () => {
    expect(envConfig.getSupabaseInternalUrl({})).toBeNull();
  });

  it("ignores invalid values and warns instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      envConfig.getSupabaseInternalUrl({
        SUPABASE_INTERNAL_URL: "not-a-url",
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("recording resource gate env", () => {
  it("defaults the recording duration and file size limits", () => {
    expect(envConfig.getRecordingMaxDurationMinutes({})).toBe(15);
    expect(envConfig.getRecordingMaxFileBytes({})).toBe(314572800);
  });

  it("reads overrides and falls back on invalid values", () => {
    expect(
      envConfig.getRecordingMaxDurationMinutes({
        RECORDING_MAX_DURATION_MINUTES: "30",
      }),
    ).toBe(30);
    expect(
      envConfig.getRecordingMaxFileBytes({
        RECORDING_MAX_FILE_BYTES: "1048576",
      }),
    ).toBe(1048576);
    expect(
      envConfig.getRecordingMaxDurationMinutes({
        RECORDING_MAX_DURATION_MINUTES: "not-a-number",
      }),
    ).toBe(15);
    expect(
      envConfig.getRecordingMaxFileBytes({
        RECORDING_MAX_FILE_BYTES: "-1",
      }),
    ).toBe(314572800);
  });
});

describe("recording AI monthly quota env", () => {
  it("defaults the monthly quota to 100", () => {
    expect(envConfig.getRecordingAiMonthlyQuota({})).toBe(100);
  });

  it("reads overrides and falls back on invalid values", () => {
    expect(
      envConfig.getRecordingAiMonthlyQuota({
        RECORDING_AI_MONTHLY_QUOTA: "20",
      }),
    ).toBe(20);
    // 配额必须是正整数：0、负数、小数、非数字一律回退默认值。
    for (const invalid of ["0", "-5", "1.5", "not-a-number"]) {
      expect(
        envConfig.getRecordingAiMonthlyQuota({
          RECORDING_AI_MONTHLY_QUOTA: invalid,
        }),
      ).toBe(100);
    }
  });
});
