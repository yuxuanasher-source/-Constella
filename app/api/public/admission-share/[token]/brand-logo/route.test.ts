import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import {
  getPublicAdmissionShareBrandLogoPath,
  PublicAdmissionShareError,
  SupabaseAdmissionShareBoardRepository,
} from "@/features/applications/admission-share-board";
import { SupabaseAdmissionShareAccessStore } from "@/features/applications/admission-share-access-store";
import { createSignedDownloadUrl } from "@/features/storage/private-upload";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseAdminClient } from "@/lib/db/supabase-server";
import { readAdmissionShareAccessSession } from "@/lib/http/admission-share-access-session";

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
      getPublicAdmissionShareBrandLogoPath: vi.fn(),
    };
  },
);

vi.mock("@/features/storage/private-upload", () => ({
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/features/applications/admission-share-access-store", () => ({
  SupabaseAdmissionShareAccessStore: vi.fn().mockImplementation(function () {
    return { store: "access-store" };
  }),
}));

vi.mock("@/lib/http/admission-share-access-session", () => ({
  readAdmissionShareAccessSession: vi.fn(),
}));

const params = Promise.resolve({ token: "plain-token" });
const supabase = { client: "supabase", storage: {} };
const privateLogoPath =
  "9d4ba455-c58a-4e31-a3e8-c42a760ea54c/brand-logos/8732c883-7ea9-4db0-9b29-4a77e1f8c79e.webp";

describe("public admission share brand logo route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never);
    vi.mocked(readAdmissionShareAccessSession).mockReturnValue(
      "opaque-session-token",
    );
    vi.mocked(getPrivateStorageBucket).mockReturnValue("jy-private");
    vi.mocked(getPublicAdmissionShareBrandLogoPath).mockResolvedValue(
      privateLogoPath,
    );
    vi.mocked(createSignedDownloadUrl).mockResolvedValue({
      signedUrl: "https://download.example/share-logo.webp",
    } as never);
  });

  it("redirects to a normalized signed URL only after token and access-session gating", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/brand-logo?accessCode=must-not-be-read",
      ),
      { params },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://download.example/share-logo.webp",
    );
    expect(SupabaseAdmissionShareBoardRepository).toHaveBeenCalledWith(
      supabase,
    );
    expect(SupabaseAdmissionShareAccessStore).toHaveBeenCalledWith(supabase);
    expect(getPublicAdmissionShareBrandLogoPath).toHaveBeenCalledWith({
      repo: { repo: "share-repo" },
      accessStore: { store: "access-store" },
      token: "plain-token",
      sessionToken: "opaque-session-token",
    });
    expect(createSignedDownloadUrl).toHaveBeenCalledWith({
      client: supabase,
      bucket: "jy-private",
      path: privateLogoPath,
      expiresInSeconds: 3600,
    });
  });

  it("returns 404 without a Location header when the snapshot has no logo", async () => {
    vi.mocked(getPublicAdmissionShareBrandLogoPath).mockResolvedValue(null);

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/brand-logo",
      ),
      { params },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain(
      privateLogoPath,
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "/relative.webp"])(
    "refuses an unsafe signed URL without leaking the private path: %s",
    async (signedUrl) => {
      vi.mocked(createSignedDownloadUrl).mockResolvedValue({
        signedUrl,
      } as never);

      const response = await GET(
        new Request(
          "http://localhost/api/public/admission-share/plain-token/brand-logo",
        ),
        { params },
      );
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(serialized).not.toContain(privateLogoPath);
      expect(serialized).not.toContain(signedUrl);
    },
  );

  it("sanitizes signer failures instead of returning or logging the storage path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createSignedDownloadUrl).mockRejectedValue(
      new Error(`download failed for ${privateLogoPath}`),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/brand-logo",
      ),
      { params },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(404);
    expect(serialized).not.toContain(privateLogoPath);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    ["SHARE_NOT_AVAILABLE", 404],
    ["SHARE_EXPIRED", 410],
    ["SHARE_REVOKED", 410],
    ["ACCESS_CODE_REQUIRED", 401],
    ["ACCESS_CODE_INVALID", 401],
  ] as const)("preserves %s access failures", async (code, statusCode) => {
    vi.mocked(getPublicAdmissionShareBrandLogoPath).mockRejectedValue(
      new PublicAdmissionShareError(code, "private failure", statusCode),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/brand-logo",
      ),
      { params },
    );

    expect(response.status).toBe(statusCode);
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain(
      "private failure",
    );
  });
});
