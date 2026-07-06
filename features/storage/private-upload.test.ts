import { describe, expect, it } from "vitest";

import { buildPrivateUploadPath, toPublicSignedUrl } from "./private-upload";

describe("buildPrivateUploadPath", () => {
  it("creates organization-scoped private object paths", () => {
    expect(
      buildPrivateUploadPath({
        organizationId: "org-1",
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo video.mp4",
      }),
    ).toBe("org-1/recordings/application-1/demo_video.mp4");
  });

  it("rejects path traversal in scoped path segments", () => {
    expect(() =>
      buildPrivateUploadPath({
        organizationId: "org-1/../../other-org",
        category: "recordings",
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
    ).toThrow("Invalid upload path segment");

    expect(() =>
      buildPrivateUploadPath({
        organizationId: "org-1",
        category: "recordings",
        ownerId: "../application-1",
        fileName: "demo.mp4",
      }),
    ).toThrow("Invalid upload path segment");
  });

  it("rejects categories outside the upload whitelist", () => {
    expect(() =>
      buildPrivateUploadPath({
        organizationId: "org-1",
        category: "reports/../../recordings" as never,
        ownerId: "application-1",
        fileName: "demo.mp4",
      }),
    ).toThrow("Invalid upload category");
  });
});

describe("toPublicSignedUrl", () => {
  const env = {
    SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example.com",
  };

  it("rewrites the internal origin to the public origin, keeping path and query", () => {
    expect(
      toPublicSignedUrl(
        "http://127.0.0.1:8000/storage/v1/object/sign/jy-private/org-1/recordings/a/demo.mp4?token=abc123",
        env,
      ),
    ).toBe(
      "https://db.example.com/storage/v1/object/sign/jy-private/org-1/recordings/a/demo.mp4?token=abc123",
    );
  });

  it("returns the URL unchanged when SUPABASE_INTERNAL_URL is not configured", () => {
    const url = "https://db.example.com/storage/v1/object/sign/x?token=abc";
    expect(
      toPublicSignedUrl(url, {
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example.com",
      }),
    ).toBe(url);
  });

  it("returns the URL unchanged when it does not start with the internal origin", () => {
    const url = "https://db.example.com/storage/v1/object/sign/x?token=abc";
    expect(toPublicSignedUrl(url, env)).toBe(url);
  });

  it("does not rewrite lookalike origins sharing the internal prefix", () => {
    expect(
      toPublicSignedUrl("http://127.0.0.1:80001/storage/v1/object/x", env),
    ).toBe("http://127.0.0.1:80001/storage/v1/object/x");
  });

  it("returns the URL unchanged when the origins already match", () => {
    const url = "https://db.example.com/storage/v1/object/sign/x?token=abc";
    expect(
      toPublicSignedUrl(url, {
        SUPABASE_INTERNAL_URL: "https://db.example.com",
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example.com",
      }),
    ).toBe(url);
  });
});
