import { createHmac } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

// createServerClient mock 掉（避免真网络客户端），combineChunks /
// stringFromBase64URL 用真实实现——本地验签路径要靠它们解析会话 cookie。
vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: vi.fn(),
  };
});

const envSnapshot = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
};

function createRequest(pathname: string, cookies?: Record<string, string>) {
  const headers = new Headers();
  if (cookies) {
    headers.set(
      "cookie",
      Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    );
  }
  return new NextRequest(new URL(pathname, "https://preview.example.cn"), {
    headers,
  });
}

const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters";

function signAccessToken(payload: object): string {
  const head = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
}

// @supabase/ssr 的 cookie 值格式：base64- 前缀 + base64url(JSON 会话)。
function sessionCookieValue(accessToken: string): string {
  return `base64-${Buffer.from(
    JSON.stringify({ access_token: accessToken, token_type: "bearer" }),
  ).toString("base64url")}`;
}

describe("middleware auth boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_JWT_SECRET;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = envSnapshot.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      envSnapshot.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (envSnapshot.SUPABASE_JWT_SECRET === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = envSnapshot.SUPABASE_JWT_SECRET;
    }
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

  it("allows the mobile login route itself without Supabase config", async () => {
    const response = await middleware(createRequest("/m/login"));

    expect(response.status).toBe(200);
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

  describe("local JWT verification fast path (SUPABASE_JWT_SECRET)", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.cn";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
      process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
    });

    it("allows a valid session cookie without any GoTrue network call", async () => {
      const token = signAccessToken({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await middleware(
        createRequest("/console/projects", {
          "sb-supabase-auth-token": sessionCookieValue(token),
        }),
      );

      expect(response.status).toBe(200);
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it("reassembles chunked session cookies before verifying", async () => {
      const token = signAccessToken({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const value = sessionCookieValue(token);
      const middleIndex = Math.ceil(value.length / 2);

      const response = await middleware(
        createRequest("/console/projects", {
          "sb-supabase-auth-token.0": value.slice(0, middleIndex),
          "sb-supabase-auth-token.1": value.slice(middleIndex),
        }),
      );

      expect(response.status).toBe(200);
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it("falls back to the network path when the token is expired", async () => {
      vi.mocked(createServerClient).mockReturnValue({
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
          })),
        },
      } as never);
      const token = signAccessToken({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) - 60,
      });

      const response = await middleware(
        createRequest("/console/projects", {
          "sb-supabase-auth-token": sessionCookieValue(token),
        }),
      );

      // 过期 token 交回 getUser：这里 GoTrue 判定无会话 → 重定向登录；
      // 生产中若 refresh token 仍有效，getUser 会完成刷新并放行。
      expect(createServerClient).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://preview.example.cn/login?next=%2Fconsole%2Fprojects",
      );
    });

    it("falls back to the network path when the signature is invalid", async () => {
      vi.mocked(createServerClient).mockReturnValue({
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
          })),
        },
      } as never);
      const token = signAccessToken({
        sub: "user-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const [head, body] = token.split(".");
      const forged = `${head}.${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

      const response = await middleware(
        createRequest("/console/projects", {
          "sb-supabase-auth-token": sessionCookieValue(forged),
        }),
      );

      expect(createServerClient).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(307);
    });

    it("keeps the original network path when no session cookie exists", async () => {
      vi.mocked(createServerClient).mockReturnValue({
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
          })),
        },
      } as never);

      const response = await middleware(createRequest("/console/projects"));

      expect(createServerClient).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(307);
    });
  });
});
