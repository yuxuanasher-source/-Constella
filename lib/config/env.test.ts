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
      }),
    ).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      STORAGE_BUCKET_PRIVATE: "jy-private",
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
    ).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      STORAGE_BUCKET_PRIVATE: "jy-private",
    });
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
