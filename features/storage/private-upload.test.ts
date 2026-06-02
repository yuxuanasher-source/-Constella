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
});
