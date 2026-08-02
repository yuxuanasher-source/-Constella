import { describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";

import { AuthContextUnavailableError, getAuthContext } from "./context";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
}

function clientWithQueryResults(input: {
  profile: { data: unknown; error: unknown };
  membership: { data: unknown; error: unknown };
}) {
  const profileQuery = {
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(async () => input.profile),
  };
  const membershipQuery = {
    eq: vi.fn(() => membershipQuery),
    order: vi.fn(() => membershipQuery),
    returns: vi.fn(async () => input.membership),
  };
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-errors", email: "user@example.cn" } },
        error: null,
      })),
    },
    from: vi.fn((table: string) =>
      table === "profiles"
        ? { select: vi.fn(() => profileQuery) }
        : { select: vi.fn(() => membershipQuery) },
    ),
  };
}

function clientWithAuthError(error: unknown) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: null },
        error,
      })),
    },
    from: vi.fn(),
  };
}

describe("getAuthContext", () => {
  it("returns null for the documented missing-session auth error", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: new AuthSessionMissingError(),
        })),
      },
      from: vi.fn(),
    };

    await expect(getAuthContext(client as never)).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["bad JWT", new AuthApiError("raw bad JWT", 401, "bad_jwt")],
    ["invalid JWT", new AuthInvalidJwtError("raw invalid JWT")],
    [
      "missing session",
      new AuthApiError("raw session missing", 401, "session_not_found"),
    ],
    [
      "expired session",
      new AuthApiError("raw session expired", 400, "session_expired"),
    ],
    [
      "missing refresh token",
      new AuthApiError(
        "raw refresh token missing",
        400,
        "refresh_token_not_found",
      ),
    ],
    [
      "used refresh token",
      new AuthApiError(
        "raw refresh token reused",
        400,
        "refresh_token_already_used",
      ),
    ],
    [
      "missing authorization",
      new AuthApiError("raw authorization missing", 401, "no_authorization"),
    ],
    [
      "generic unauthorized session rejection",
      new AuthApiError("raw unauthorized session", 401, "unexpected_session"),
    ],
    [
      "generic forbidden session rejection",
      new AuthApiError("raw forbidden session", 403, "unexpected_session"),
    ],
  ])("returns null for a %s auth rejection", async (_label, error) => {
    const client = clientWithAuthError(error);

    await expect(getAuthContext(client as never)).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws a stable safe error for a resolved auth infrastructure failure", async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: null },
          error: new AuthRetryableFetchError(
            "raw auth backend database password",
            503,
          ),
        })),
      },
      from: vi.fn(),
    };

    const failure = await getAuthContext(client as never).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AuthContextUnavailableError);
    expect(failure).toMatchObject({
      name: "AuthContextUnavailableError",
      message: "Authentication context is unavailable",
    });
    expect(JSON.stringify(failure)).not.toContain("password");
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    [
      "server failure",
      new AuthApiError("raw auth server password", 503, "unexpected_failure"),
    ],
    [
      "request timeout",
      new AuthApiError("raw auth timeout password", 504, "request_timeout"),
    ],
    [
      "rate limit",
      new AuthApiError(
        "raw auth rate-limit password",
        429,
        "over_request_rate_limit",
      ),
    ],
    [
      "unknown auth failure",
      new AuthUnknownError(
        "raw unknown auth password",
        new Error("raw network password"),
      ),
    ],
  ])("throws a stable safe error for a resolved %s", async (_label, error) => {
    const client = clientWithAuthError(error);

    const failure = await getAuthContext(client as never).catch(
      (caught: unknown) => caught,
    );

    expect(failure).toBeInstanceOf(AuthContextUnavailableError);
    expect(failure).toMatchObject({
      name: "AuthContextUnavailableError",
      message: "Authentication context is unavailable",
    });
    expect(JSON.stringify(failure)).not.toContain("password");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws a stable safe error when the profile query returns an error", async () => {
    const client = clientWithQueryResults({
      profile: {
        data: null,
        error: {
          code: "XX000",
          message: "raw profile database password",
          details: "private",
          hint: null,
        },
      },
      membership: { data: [], error: null },
    });

    await expect(getAuthContext(client as never)).rejects.toEqual(
      expect.objectContaining({
        name: "AuthContextUnavailableError",
        message: "Authentication context is unavailable",
      }),
    );
  });

  it("throws a stable safe error when the membership query returns an error", async () => {
    const client = clientWithQueryResults({
      profile: {
        data: { full_name: "User", requires_onboarding: false },
        error: null,
      },
      membership: {
        data: null,
        error: {
          code: "XX000",
          message: "raw membership database password",
          details: "private",
          hint: null,
        },
      },
    });

    const failure = await getAuthContext(client as never).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AuthContextUnavailableError);
    expect(JSON.stringify(failure)).not.toContain("password");
  });

  it("loads profile and active membership in parallel after resolving the session user", async () => {
    const profileResult = deferred<{
      data: { full_name: string; requires_onboarding: boolean };
      error: null;
    }>();
    const membershipResult = deferred<{
      data: Array<{
        organization_id: string;
        role: string;
        organizations: { name: string };
      }>;
      error: null;
    }>();

    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(() => profileResult.promise),
    };
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      returns: vi.fn(() => membershipResult.promise),
    };
    const from = vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => profileQuery),
        };
      }
      if (table === "organization_members") {
        return {
          select: vi.fn(() => membershipQuery),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: { id: "user-1", email: "streamer@example.cn" },
          },
        })),
      },
      from,
    };

    const contextPromise = getAuthContext(client as never);
    // 多冲几个微任务：getUser 结果经 getAuthenticatedUser（React.cache 包装）
    // 中转，多一层 await。profileResult 仍未 resolve，断言语义不变——
    // 「成员查询在 profile 结果返回之前就已发出」。
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }

    const membershipWasRequestedBeforeProfileResolved = from.mock.calls
      .map(([table]) => table)
      .includes("organization_members");

    profileResult.resolve({
      data: { full_name: "Ada", requires_onboarding: true },
      error: null,
    });
    membershipResult.resolve({
      data: [
        {
          organization_id: "org-1",
          role: "streamer",
          organizations: { name: "Org One" },
        },
      ],
      error: null,
    });

    await expect(contextPromise).resolves.toMatchObject({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Ada",
      organizationId: "org-1",
      organizationName: "Org One",
      role: "streamer",
      requiresOnboarding: true,
    });
    expect(membershipWasRequestedBeforeProfileResolved).toBe(true);
  });

  it("resolves the most privileged role when a user holds multiple roles in one org", async () => {
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      returns: vi.fn(async () => ({
        // Same org, both active — streamer row returned first.
        data: [
          {
            organization_id: "org-9",
            role: "streamer",
            organizations: { name: "Org Nine" },
          },
          {
            organization_id: "org-9",
            role: "owner",
            organizations: { name: "Org Nine" },
          },
        ],
        error: null,
      })),
    };
    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(async () => ({
        data: { full_name: "Boss", requires_onboarding: false },
        error: null,
      })),
    };
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-9", email: "boss@example.cn" } },
        })),
      },
      from: vi.fn((table: string) =>
        table === "profiles"
          ? { select: vi.fn(() => profileQuery) }
          : { select: vi.fn(() => membershipQuery) },
      ),
    };

    await expect(getAuthContext(client as never)).resolves.toMatchObject({
      organizationId: "org-9",
      role: "owner",
    });
  });

  it("normalizes legacy organization branding after resolving its identity", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const membershipQuery = {
      eq: vi.fn(() => membershipQuery),
      order: vi.fn(() => membershipQuery),
      returns: vi.fn(async () => ({
        data: [
          {
            organization_id: organizationId,
            role: "owner",
            organizations: {
              name: "北辰机构",
              branding: {
                logoText: " 北辰 ",
                brandName: " 北辰经营舱 ",
                brandTagline: " 稳健增长 ",
                primaryColor: "#fff000",
                logoStoragePath:
                  "22222222-2222-4222-8222-222222222222/brand-logos/33333333-3333-4333-8333-333333333333.webp",
              },
            },
          },
        ],
        error: null,
      })),
    };
    const profileQuery = {
      eq: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(async () => ({
        data: { full_name: "Owner", requires_onboarding: false },
        error: null,
      })),
    };
    const client = {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-brand", email: "owner@example.cn" } },
        })),
      },
      from: vi.fn((table: string) =>
        table === "profiles"
          ? { select: vi.fn(() => profileQuery) }
          : { select: vi.fn(() => membershipQuery) },
      ),
    };

    await expect(getAuthContext(client as never)).resolves.toMatchObject({
      organizationId,
      organizationName: "北辰机构",
      organizationBranding: {
        schemaVersion: 1,
        version: 0,
        logoText: "北辰",
        logoStoragePath: null,
        brandName: "北辰经营舱",
        brandTagline: "稳健增长",
        primaryColor: "#FFF000",
        publishedAt: null,
        semantic: {
          success: "#00B42A",
          warning: "#FF7D00",
          danger: "#F53F3F",
          info: "#165DFF",
        },
      },
    });
  });
});
