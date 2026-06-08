import { describe, expect, it, vi } from "vitest";

import { SupabaseApplicationRepository } from "./application-repository";

describe("SupabaseApplicationRepository", () => {
  it("reads public project recording metadata from the streamer announcement view", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: "project-1",
        name: "Public Project",
        organization_id: "org-1",
        status: "recruiting",
      },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const repo = new SupabaseApplicationRepository({ from } as never);

    await expect(
      repo.getPublicProjectForRecording("project-1"),
    ).resolves.toEqual({
      id: "project-1",
      name: "Public Project",
      organizationId: "org-1",
      status: "recruiting",
      isPublicToStreamers: true,
    });
    expect(from).toHaveBeenCalledWith("streamer_public_project_announcements");
    expect(select).toHaveBeenCalledWith("id, name, organization_id, status");
    expect(eq).toHaveBeenCalledWith("id", "project-1");
  });
});
