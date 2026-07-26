import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  preparePublicAdmissionShareAccess,
  verifyPublicAdmissionShareAccessCode,
} from "@/features/applications/admission-share-board";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock("@/features/applications/admission-share-board", () => ({
  SupabaseAdmissionShareBoardRepository: vi
    .fn()
    .mockImplementation(function () {
      return { repo: "share-repo" };
    }),
  preparePublicAdmissionShareAccess: vi.fn(),
  verifyPublicAdmissionShareAccessCode: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const params = Promise.resolve({ token: "plain-token" });
const rpc = vi.fn();
const supabase = { rpc };
const preparedAccess = {
  token: "plain-token",
  tokenHash: "a".repeat(64),
  access: {
    id: "share-1",
    tokenHash: "a".repeat(64),
    accessCodeHash: "b".repeat(64),
    accessCodeSalt: "c".repeat(32),
    accessCodeHashVersion: "scrypt_v1" as const,
    accessCodeHashParams: { N: 16384, r: 8, p: 1, keyLength: 32 },
    accessCodeFailureCount: 0,
    accessCodeFailureVersion: 3,
    accessCodeLockedUntil: null,
    status: "active" as const,
    expiresAt: "2026-07-27T01:30:00.000Z",
  },
};

describe("public admission share unlock route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    rpc.mockResolvedValue({
      data: [{ allowed: true, retry_after_seconds: 0, remaining: 4 }],
      error: null,
    });
    vi.mocked(preparePublicAdmissionShareAccess).mockResolvedValue(
      preparedAccess as never,
    );
    vi.mocked(verifyPublicAdmissionShareAccessCode).mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the code only in JSON and issues a scoped HttpOnly capability cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/unlock",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: "2468" }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    expect(verifyPublicAdmissionShareAccessCode).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      access: preparedAccess.access,
      accessCode: "2468",
      now: expect.any(String),
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("admission_share_capability=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/api/public/admission-share/plain-token");
    expect(cookie).not.toContain("2468");
  });

  it("rate-limits before access lookup and code verification", async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 99, remaining: 0 }],
      error: null,
    });

    const response = await POST(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/unlock",
        {
          method: "POST",
          body: JSON.stringify({ accessCode: "2468" }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("99");
    expect(rpc).toHaveBeenCalledWith(
      "consume_admission_share_rate_limit",
      expect.objectContaining({ p_limit: 5, p_window_seconds: 600 }),
    );
    expect(preparePublicAdmissionShareAccess).not.toHaveBeenCalled();
    expect(verifyPublicAdmissionShareAccessCode).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: "database unavailable" }, null],
    [null, []],
  ])(
    "fails closed when rate-limit RPC is unavailable or malformed",
    async (error, data) => {
      rpc.mockResolvedValue({ data, error });

      const response = await POST(
        new Request(
          "http://localhost/api/public/admission-share/plain-token/unlock",
          {
            method: "POST",
            body: JSON.stringify({ accessCode: "2468" }),
          },
        ),
        { params },
      );

      expect(response.status).toBe(503);
      expect(preparePublicAdmissionShareAccess).not.toHaveBeenCalled();
      expect(verifyPublicAdmissionShareAccessCode).not.toHaveBeenCalled();
    },
  );
});
