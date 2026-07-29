import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

describe("instrumentation register", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("STORAGE_BUCKET_PRIVATE", "jy-private");
    vi.stubEnv("ADMISSION_SHARE_CAPABILITY_SECRET", "s".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts complete runtime env config", async () => {
    await expect(register()).resolves.toBeUndefined();
  });

  it("fails fast when server runtime env config is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    await expect(register()).rejects.toThrow();
  });
});
