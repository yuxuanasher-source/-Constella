import { describe, expect, it } from "vitest";

import { buildPrivateUploadPath } from "./private-upload";

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
