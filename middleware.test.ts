import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

const envSnapshot = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

function createRequest(pathname: string) {
  return new NextRequest(new URL(pathname, "https://preview.example.cn"));
}

describe("middleware auth boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = envSnapshot.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      envSnapshot.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("redirects protected routes to login when Supabase config is missing", async () => {
    const response = await middleware(createRequest("/console/projects"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/login?next=%2Fconsole%2Fprojects&error=config",
    );
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("allows non-protected routes without Supabase config", async () => {
    const response = await middleware(createRequest("/public"));

    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("redirects protected mobile routes to mobile login when Supabase config is missing", async () => {
    const response = await middleware(createRequest("/m/tasks"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/login?next=%2Fm%2Ftasks&error=config",
    );
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated protected mobile routes to mobile login", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.cn";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
        })),
      },
    } as never);

    const response = await middleware(createRequest("/m/tasks"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/login?next=%2Fm%2Ftasks",
    );
  });

  it("redirects protected routes when Supabase auth is unavailable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.cn";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    vi.mocked(createServerClient).mockReturnValue({
      auth: {
        getUser: vi.fn(async () => {
          throw new Error("network unavailable");
        }),
      },
    } as never);

    const response = await middleware(createRequest("/console/projects"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/login?next=%2Fconsole%2Fprojects&error=auth",
    );
  });
});
