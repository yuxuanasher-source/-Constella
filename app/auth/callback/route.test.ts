import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { GET } from "./route";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

function request(path: string) {
  return new NextRequest(new URL(path, "https://preview.example.cn"));
}

describe("OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges the OAuth code and sends mobile streamers to mobile tasks", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
      organizationName: "Org",
      requiresOnboarding: false,
    } as never);

    const response = await GET(
      request(
        "/auth/callback?code=oauth-code&entryPoint=mobile&roleIntent=streamer",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/tasks",
    );
  });

  it("rejects unsafe next URLs and falls back by real role", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "owner@example.cn",
      name: "Owner",
      role: "owner",
      organizationId: "org-1",
      organizationName: "Org",
      requiresOnboarding: false,
    } as never);

    const response = await GET(
      request("/auth/callback?code=oauth-code&next=https://evil.test/console"),
    );

    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/console/projects",
    );
  });

  it("returns to the matching login page when the code is missing", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn() },
    } as never);

    const response = await GET(request("/auth/callback?entryPoint=mobile"));

    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/login?error=auth",
    );
  });

  it("returns to login when Supabase rejects the code exchange", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi
          .fn()
          .mockResolvedValue({ error: { message: "expired code" } }),
      },
    } as never);

    const response = await GET(
      request("/auth/callback?code=expired&entryPoint=desktop"),
    );

    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/login?error=auth",
    );
    expect(getAuthContext).not.toHaveBeenCalled();
  });
});
