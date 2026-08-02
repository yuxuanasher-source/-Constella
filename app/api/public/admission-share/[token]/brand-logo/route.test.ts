import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const signedUrl =
  `https://storage.example/storage/v1/object/sign/jy-private/${privateLogoPath}` +
  `?token=upstream-secret&path=${encodeURIComponent(privateLogoPath)}`;
const upstreamBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const upstreamFetch = vi.fn();

function request(asset = false) {
  return new Request(
    `http://localhost/api/public/admission-share/plain-token/brand-logo${asset ? "?asset=1" : ""}`,
  );
}

function expectNoPrivateLocation(response: Response) {
  const location = response.headers.get("location") ?? "";
  const decodedLocation = decodeURIComponent(location);
  expect(location).not.toContain(privateLogoPath);
  expect(location).not.toContain(encodeURIComponent(privateLogoPath));
  expect(decodedLocation).not.toContain(privateLogoPath);
  expect(location).not.toContain("jy-private");
  expect(location).not.toContain("upstream-secret");
  expect(location).not.toContain("storage.example");
}

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
      signedUrl,
    } as never);
    upstreamFetch.mockResolvedValue(
      new Response(upstreamBytes, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Set-Cookie": "upstream-secret=1",
          "X-Internal-Source": signedUrl,
        },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects only to the same-origin opaque asset stage before signing or fetching", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/public/admission-share/plain-token/brand-logo?accessCode=must-not-be-read&private=must-not-survive",
      ),
      { params },
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBe(
      "http://localhost/api/public/admission-share/plain-token/brand-logo?asset=1",
    );
    expectNoPrivateLocation(response);
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
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("revalidates access and streams a whitelisted image without exposing upstream details", async () => {
    const initial = await GET(request(), { params });
    const location = initial.headers.get("location");
    expect(location).toBeTruthy();

    const asset = await GET(new Request(location!), { params });

    expect(asset.status).toBe(200);
    expect(asset.headers.get("location")).toBeNull();
    expect(asset.headers.get("content-type")).toBe("image/webp");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("cache-control")).toBe(
      "private, max-age=300, must-revalidate",
    );
    expect(asset.headers.get("set-cookie")).toBeNull();
    expect(asset.headers.get("x-internal-source")).toBeNull();
    await expect(asset.arrayBuffer()).resolves.toEqual(upstreamBytes.buffer);
    expect(getPublicAdmissionShareBrandLogoPath).toHaveBeenCalledTimes(2);
    expect(getPublicAdmissionShareBrandLogoPath).toHaveBeenLastCalledWith({
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
    expect(upstreamFetch).toHaveBeenCalledWith(signedUrl, {
      cache: "no-store",
      redirect: "error",
    });
    expectNoPrivateLocation(asset);
    expect(JSON.stringify([...asset.headers])).not.toContain(privateLogoPath);
    expect(JSON.stringify([...asset.headers])).not.toContain(signedUrl);
  });

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "streams the allowed brand image MIME: %s",
    async (contentType) => {
      upstreamFetch.mockResolvedValueOnce(
        new Response(upstreamBytes, {
          status: 200,
          headers: { "Content-Type": `${contentType}; charset=binary` },
        }),
      );

      const response = await GET(request(true), { params });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("returns 404 without a redirect when the snapshot has no logo", async () => {
    vi.mocked(getPublicAdmissionShareBrandLogoPath).mockResolvedValue(null);

    const response = await GET(request(), { params });

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(await response.json())).not.toContain(
      privateLogoPath,
    );
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "/relative.webp"])(
    "refuses an unsafe signed URL in the asset stage without leaking the private path: %s",
    async (unsafeSignedUrl) => {
      vi.mocked(createSignedDownloadUrl).mockResolvedValue({
        signedUrl: unsafeSignedUrl,
      } as never);

      const response = await GET(request(true), { params });
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(serialized).not.toContain(privateLogoPath);
      expect(serialized).not.toContain(unsafeSignedUrl);
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "signer",
      () =>
        vi
          .mocked(createSignedDownloadUrl)
          .mockRejectedValue(new Error(`failed ${privateLogoPath}`)),
    ],
    [
      "fetch",
      () => upstreamFetch.mockRejectedValue(new Error(`failed ${signedUrl}`)),
    ],
    [
      "non-ok upstream",
      () =>
        upstreamFetch.mockResolvedValue(
          new Response(privateLogoPath, { status: 403 }),
        ),
    ],
    [
      "unsafe MIME",
      () =>
        upstreamFetch.mockResolvedValue(
          new Response(`<svg>${privateLogoPath}</svg>`, {
            status: 200,
            headers: { "Content-Type": "image/svg+xml" },
          }),
        ),
    ],
    [
      "empty body",
      () =>
        upstreamFetch.mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: { "Content-Type": "image/webp" },
          }),
        ),
    ],
  ] as const)(
    "sanitizes %s failures without returning or logging storage details",
    async (_label, prepareFailure) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      prepareFailure();

      const response = await GET(request(true), { params });
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(serialized).not.toContain(privateLogoPath);
      expect(serialized).not.toContain(signedUrl);
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it.each([
    ["SHARE_NOT_AVAILABLE", 404, "opaque-session-token"],
    ["SHARE_EXPIRED", 410, "opaque-session-token"],
    ["SHARE_REVOKED", 410, "opaque-session-token"],
    ["ACCESS_CODE_REQUIRED", 401, null],
    ["ACCESS_CODE_INVALID", 401, "expired-session-token"],
  ] as const)(
    "rechecks and preserves %s failures in the asset stage",
    async (code, statusCode, sessionToken) => {
      vi.mocked(readAdmissionShareAccessSession).mockReturnValue(sessionToken);
      vi.mocked(getPublicAdmissionShareBrandLogoPath).mockRejectedValue(
        new PublicAdmissionShareError(code, "private failure", statusCode),
      );

      const response = await GET(request(true), { params });

      expect(response.status).toBe(statusCode);
      expect(response.headers.get("location")).toBeNull();
      expect(JSON.stringify(await response.json())).not.toContain(
        "private failure",
      );
      expect(getPublicAdmissionShareBrandLogoPath).toHaveBeenCalledWith(
        expect.objectContaining({ sessionToken: sessionToken ?? undefined }),
      );
      expect(createSignedDownloadUrl).not.toHaveBeenCalled();
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );
});
