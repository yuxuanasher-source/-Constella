import { describe, expect, it, vi } from "vitest";

import { createProjectDraft, publishProject } from "./project-service";

const actor = {
  userId: "33333333-3333-3333-3333-333333333333",
  name: "次级运营",
  role: "operator_business" as const,
  organizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

describe("project service", () => {
  it("creates project drafts for operator_business", async () => {
    const repo = {
      createDraft: vi.fn().mockResolvedValue({
        id: "99999999-9999-9999-9999-999999999999",
        name: "新游项目",
        status: "draft",
      }),
      getById: vi.fn(),
      publish: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    const project = await createProjectDraft({
      repo,
      audit,
      actor,
      input: { name: "新游项目", code: "PRJ-1" },
    });

    expect(project.status).toBe("draft");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", objectType: "project" }),
    );
  });

  it("rejects publish attempts from operator_business", async () => {
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn(),
      publish: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      publishProject({
        repo,
        audit,
        actor,
        projectId: "99999999-9999-9999-9999-999999999999",
      }),
    ).rejects.toThrow("Only owner and ops_manager can publish projects");
  });
});
