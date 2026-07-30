import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

import {
  authenticatePublicAdmissionShareAccess,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";

vi.mock(
  "@/features/applications/admission-share-board",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/applications/admission-share-board")
      >();
    return {
      ...actual,
      SupabaseAdmissionShareBoardRepository: vi
        .fn()
        .mockImplementation(function () {
          return { repo: "share-repo" };
        }),
      authenticatePublicAdmissionShareAccess: vi.fn(),
    };
  },
);

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "supabase" };

describe("public admission share access route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(authenticatePublicAdmissionShareAccess).mockResolvedValue({
      sessionToken: "opaque-session-token",
      expiresAt: "2026-08-05T10:00:00.000Z",
    });
  });

  it("exchanges an access code for an opaque HttpOnly session", async () => {
    const response = await POST(
      new Request(
        "https://example.com/api/public/admission-share/plain-token/access",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "vitest",
            "x-forwarded-for": "203.0.113.8",
          },
          body: JSON.stringify({ accessCode: "246810" }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      expiresAt: "2026-08-05T10:00:00.000Z",
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("opaque-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("246810");
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(authenticatePublicAdmissionShareAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { repo: "share-repo" },
        accessStore: { store: "access-store" },
        token: "plain-token",
        accessCode: "246810",
        clientFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("returns a localized stable error when the code is invalid", async () => {
    vi.mocked(authenticatePublicAdmissionShareAccess).mockRejectedValue(
      new Error("Access code is invalid"),
    );

    const response = await POST(
      new Request(
        "https://example.com/api/public/admission-share/plain-token/access",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessCode: "wrong-code" }),
        },
      ),
      { params },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "ACCESS_CODE_INVALID",
      error: "访问码不正确，请重新输入。",
    });
  });
});
