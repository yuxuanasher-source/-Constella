import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  defaultAuthCookieName,
} from "./supabase-server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ client: "ssr" })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ client: "admin" })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: () => {},
  })),
}));

const envSnapshot = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ADMISSION_SHARE_CAPABILITY_SECRET:
    process.env.ADMISSION_SHARE_CAPABILITY_SECRET,
  SUPABASE_INTERNAL_URL: process.env.SUPABASE_INTERNAL_URL,
};

describe("supabase server client factories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.ADMISSION_SHARE_CAPABILITY_SECRET = "s".repeat(64);
    delete process.env.SUPABASE_INTERNAL_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("derives the default auth cookie name from the public URL", () => {
    expect(defaultAuthCookieName("https://db.example.com")).toBe(
      "sb-db-auth-token",
    );
    expect(defaultAuthCookieName("http://127.0.0.1:54321")).toBe(
      "sb-127-auth-token",
    );
  });

  it("uses the public URL without cookie overrides when no internal URL is set", async () => {
    await createSupabaseServerClient();

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = vi.mocked(createServerClient).mock.calls[0];
    expect(url).toBe("https://db.example.com");
    expect(key).toBe("anon-key");
    expect(
      (options as { cookieOptions?: { name?: string } }).cookieOptions,
    ).toBeUndefined();
  });

  it("uses SUPABASE_INTERNAL_URL for the SSR client while pinning the public cookie name", async () => {
    process.env.SUPABASE_INTERNAL_URL = "http://127.0.0.1:8000";

    await createSupabaseServerClient();

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [url, , options] = vi.mocked(createServerClient).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000");
    // cookie 名必须仍按公网地址推导，否则读不到浏览器/中间件写入的会话。
    expect(
      (options as { cookieOptions?: { name?: string } }).cookieOptions,
    ).toEqual({ name: "sb-db-auth-token" });
  });

  it("uses SUPABASE_INTERNAL_URL for the admin client and falls back without it", () => {
    createSupabaseAdminClient();
    expect(vi.mocked(createClient).mock.calls[0][0]).toBe(
      "https://db.example.com",
    );

    process.env.SUPABASE_INTERNAL_URL = "http://127.0.0.1:8000";
    createSupabaseAdminClient();
    expect(vi.mocked(createClient).mock.calls[1][0]).toBe(
      "http://127.0.0.1:8000",
    );
    expect(vi.mocked(createClient).mock.calls[1][1]).toBe("service-role-key");
  });
});
