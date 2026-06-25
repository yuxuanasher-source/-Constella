import { describe, expect, it } from "vitest";

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
