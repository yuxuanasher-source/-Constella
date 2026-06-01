import { describe, expect, it } from "vitest";

import { canCreateProjectDraft, canPublishProject } from "./permissions";

describe("project permissions", () => {
  it("allows operator_business to create drafts but not publish", () => {
    expect(canCreateProjectDraft("operator_business")).toBe(true);
    expect(canPublishProject("operator_business")).toBe(false);
  });

  it("allows owner and ops_manager to publish projects", () => {
    expect(canPublishProject("owner")).toBe(true);
    expect(canPublishProject("ops_manager")).toBe(true);
  });
});
