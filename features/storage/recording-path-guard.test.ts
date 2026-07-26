import { describe, expect, it } from "vitest";

import { normalizeRecordingStoragePath } from "./recording-path-guard";

describe("normalizeRecordingStoragePath", () => {
  it("trims and returns an organization-owned recording path", () => {
    expect(
      normalizeRecordingStoragePath(
        "  org-1/recordings/project-1/demo.mp4  ",
        "org-1",
      ),
    ).toBe("org-1/recordings/project-1/demo.mp4");
  });

  it.each([
    "org-2/recordings/project-1/demo.mp4",
    "org-1/recordings/",
    "org-1/recordings/project-1//demo.mp4",
    "org-1/recordings/./demo.mp4",
    "org-1/recordings/../project-1/demo.mp4",
    "org-1/recordings\\project-1\\demo.mp4",
    "org-1/recordings/%2e%2e/demo.mp4",
    "org-1/recordings/project-1%2fdemo.mp4",
    "org-1/recordings/project-1%5cdemo.mp4",
    "org-1/recordings/%252e%252e/demo.mp4",
  ])("rejects an invalid recording path: %s", (path) => {
    expect(() => normalizeRecordingStoragePath(path, "org-1")).toThrow(
      "Invalid recording storage path",
    );
  });

  it("returns undefined for empty or blank values", () => {
    expect(normalizeRecordingStoragePath(undefined, "org-1")).toBeUndefined();
    expect(normalizeRecordingStoragePath("   ", "org-1")).toBeUndefined();
  });

  it("allows opaque filename segments that contain two dots", () => {
    expect(
      normalizeRecordingStoragePath(
        "org-1/recordings/project-1/review..final.mp4",
        "org-1",
      ),
    ).toBe("org-1/recordings/project-1/review..final.mp4");
  });
});
