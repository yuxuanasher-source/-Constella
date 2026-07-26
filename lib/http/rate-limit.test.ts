import { describe, expect, it, vi } from "vitest";

import {
  ADMISSION_SHARE_RATE_LIMITS,
  enforceAdmissionShareRateLimit,
  RateLimitDeniedError,
  RateLimitUnavailableError,
} from "./rate-limit";

describe("admission share public rate limiting", () => {
  it("consumes independent hashed token and client-IP buckets", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0, remaining: 9 }],
      error: null,
    });

    await enforceAdmissionShareRateLimit({
      client: { rpc },
      request: new Request("https://example.test/share", {
        headers: {
          "x-vercel-forwarded-for": " 203.0.113.9, 10.0.0.1 ",
        },
      }),
      token: "plain-share-token",
      policy: ADMISSION_SHARE_RATE_LIMITS.review,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "consume_admission_share_rate_limit",
      expect.objectContaining({
        p_scope: "admission-share-review:ip",
        p_limit: 10,
        p_window_seconds: 600,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "consume_admission_share_rate_limit",
      expect.objectContaining({
        p_scope: "admission-share-review:token",
        p_limit: 10,
        p_window_seconds: 600,
      }),
    );

    const serializedCalls = JSON.stringify(rpc.mock.calls);
    expect(serializedCalls).not.toContain("plain-share-token");
    expect(serializedCalls).not.toContain("203.0.113.9");
    expect(serializedCalls).toMatch(/[a-f0-9]{64}/);
  });

  it("throws a typed denial with the database retry interval", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 37, remaining: 0 }],
      error: null,
    });

    await expect(
      enforceAdmissionShareRateLimit({
        client: { rpc },
        request: new Request("https://example.test/share"),
        token: "plain-share-token",
        policy: ADMISSION_SHARE_RATE_LIMITS.board,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RateLimitDeniedError>>({
        name: "RateLimitDeniedError",
        retryAfterSeconds: 37,
        dimension: "ip",
      }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a typed unavailable error when the RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(
      enforceAdmissionShareRateLimit({
        client: { rpc },
        request: new Request("https://example.test/share"),
        token: "plain-share-token",
        policy: ADMISSION_SHARE_RATE_LIMITS.board,
      }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });
});
