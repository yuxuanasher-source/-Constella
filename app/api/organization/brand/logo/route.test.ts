import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { getPrivateStorageBucket } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  BrandLogoError,
  normalizeBrandLogo,
} from "@/lib/storage/organization-brand-logo";

import { POST } from "./route";

vi.mock("@/lib/auth/context", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/config/env", () => ({
  getPrivateStorageBucket: vi.fn(() => "jy-private"),
}));
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/storage/organization-brand-logo", async (load) => {
  const actual =
    await load<typeof import("@/lib/storage/organization-brand-logo")>();
  return { ...actual, normalizeBrandLogo: vi.fn() };
});

const auth = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Demo Organization",
};

const normalized = {
  body: Buffer.from("normalized-webp"),
  contentType: "image/webp" as const,
  path: `${auth.organizationId}/brand-logos/44444444-4444-4444-8444-444444444444.webp`,
};

const upload = vi.fn(async () => ({
  data: { path: normalized.path },
  error: null,
}));
const fromBucket = vi.fn(() => ({ upload }));
const fromTable = vi.fn();
const supabase = {
  storage: { from: fromBucket },
  from: fromTable,
};

function multipartRequest(
  entries: Array<[string, FormDataEntryValue]> = [
    ["logo", new File(["image"], "logo.png", { type: "image/png" })],
  ],
) {
  const form = new FormData();
  for (const [key, value] of entries) {
    form.append(key, value);
  }
  const request = new Request("http://localhost/api/organization/brand/logo", {
    method: "POST",
  });
  vi.spyOn(request, "formData").mockResolvedValue(form);
  return request;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/organization/brand/logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/organization/brand/logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(getPrivateStorageBucket).mockReturnValue("jy-private");
    vi.mocked(normalizeBrandLogo).mockResolvedValue(normalized);
  });

  it("returns a safe 503 when the server client is unavailable", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(null);

    const response = await POST(multipartRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Organization brand logo service is unavailable",
      code: "ORGANIZATION_BRAND_LOGO_UNAVAILABLE",
    });
    expect(getAuthContext).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated request", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null);

    const response = await POST(multipartRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
    expect(normalizeBrandLogo).not.toHaveBeenCalled();
  });

  it("returns a safe 503 when authentication bootstrap fails", async () => {
    vi.mocked(getAuthContext).mockRejectedValue(
      new Error("raw membership database password"),
    );

    const response = await POST(multipartRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Organization brand logo service is unavailable",
      code: "ORGANIZATION_BRAND_LOGO_UNAVAILABLE",
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it.each([
    ["member", "streamer"],
    ["finance", "finance"],
  ] as const)("returns 403 for a %s", async (_label, role) => {
    vi.mocked(getAuthContext).mockResolvedValue({ ...auth, role });

    const response = await POST(multipartRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only organization owners can upload brand logos",
      code: "ORGANIZATION_BRAND_FORBIDDEN",
    });
    expect(normalizeBrandLogo).not.toHaveBeenCalled();
    expect(fromBucket).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON content", jsonRequest({ logo: "not-a-file" })],
    ["missing logo", multipartRequest([])],
    ["non-file logo", multipartRequest([["logo", "not-a-file"]])],
    [
      "duplicate logo",
      multipartRequest([
        ["logo", new File(["one"], "one.png", { type: "image/png" })],
        ["logo", new File(["two"], "two.png", { type: "image/png" })],
      ]),
    ],
  ])("rejects malformed multipart input: %s", async (_label, request) => {
    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A single logo file is required",
      code: "BRAND_LOGO_INVALID_REQUEST",
    });
    expect(normalizeBrandLogo).not.toHaveBeenCalled();
    expect(fromBucket).not.toHaveBeenCalled();
  });

  it.each(["path", "storagePath", "bucket", "organizationId"])(
    "rejects client-controlled %s metadata",
    async (field) => {
      const response = await POST(
        multipartRequest([
          ["logo", new File(["image"], "logo.png", { type: "image/png" })],
          [field, "attacker/brand-logos/logo.webp"],
        ]),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "A single logo file is required",
        code: "BRAND_LOGO_INVALID_REQUEST",
      });
      expect(normalizeBrandLogo).not.toHaveBeenCalled();
      expect(fromBucket).not.toHaveBeenCalled();
    },
  );

  it("maps a normalized file validation error without leaking implementation details", async () => {
    vi.mocked(normalizeBrandLogo).mockRejectedValue(
      new BrandLogoError(
        "BRAND_LOGO_INVALID_CONTENT",
        "The logo content is invalid",
        422,
      ),
    );

    const response = await POST(multipartRequest());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "The logo content is invalid",
      code: "BRAND_LOGO_INVALID_CONTENT",
    });
    expect(fromBucket).not.toHaveBeenCalled();
  });

  it("uploads normalized WebP to the configured private bucket and returns only its path", async () => {
    const request = multipartRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      logoStoragePath: normalized.path,
      contentType: "image/webp",
    });
    expect(normalizeBrandLogo).toHaveBeenCalledWith(
      expect.objectContaining({ name: "logo.png", type: "image/png" }),
      auth.organizationId,
    );
    expect(getPrivateStorageBucket).toHaveBeenCalledOnce();
    expect(fromBucket).toHaveBeenCalledWith("jy-private");
    expect(upload).toHaveBeenCalledWith(normalized.path, normalized.body, {
      contentType: "image/webp",
      upsert: false,
    });
    expect(fromTable).not.toHaveBeenCalled();
  });

  it("returns a safe 503 when private storage upload fails and never mutates a draft", async () => {
    upload.mockResolvedValueOnce({
      data: null,
      error: new Error("private bucket credentials leaked"),
    } as never);

    const response = await POST(multipartRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      error: "Organization brand logo upload failed",
      code: "BRAND_LOGO_UPLOAD_FAILED",
    });
    expect(JSON.stringify(body)).not.toContain("credentials");
    expect(fromTable).not.toHaveBeenCalled();
  });
});
