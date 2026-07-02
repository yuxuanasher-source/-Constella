import { describe, expect, it, vi } from "vitest";

import { listProjects } from "./project-queries";

describe("listProjects", () => {
  it("applies an organization filter when an organization id is supplied", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: [], error: null })),
    };
    const supabase = {
      from: vi.fn(() => query),
    };

    await listProjects(supabase as never, { organizationId: "org-1" });

    expect(supabase.from).toHaveBeenCalledWith("projects");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(200);
  });
});
