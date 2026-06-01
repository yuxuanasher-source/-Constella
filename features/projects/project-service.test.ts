import { describe, expect, it, vi } from "vitest";

import {
  createProjectDraft,
  publishProject,
  updateProjectBasics,
  updateProjectSettlementRule,
} from "./project-service";

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
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
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
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
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

  it("updates non-financial project fields with normal audit", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "旧项目",
      code: "OLD",
      status: "draft" as const,
    };
    const after = { ...before, name: "新项目" };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn().mockResolvedValue(after),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updateProjectBasics({
      repo,
      audit,
      actor,
      projectId: before.id,
      input: { name: "新项目" },
    });

    expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
      name: "新项目",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: ["name"],
        isHighRisk: false,
      }),
    );
  });

  it("requires a reason when settlement fields change", async () => {
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue({
        id: "99999999-9999-9999-9999-999999999999",
        name: "项目",
        status: "draft",
      }),
      publish: vi.fn(),
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      updateProjectSettlementRule({
        repo,
        audit,
        actor: { ...actor, role: "ops_manager" },
        projectId: "99999999-9999-9999-9999-999999999999",
        input: { defaultHourlyRate: 80 },
        reason: "",
      }),
    ).rejects.toThrow("Settlement rule changes require a reason");
  });

  it("writes high-risk audit when settlement fields change", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      status: "draft" as const,
    };
    const after = { ...before, defaultHourlyRate: 80 };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn().mockResolvedValue(after),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await updateProjectSettlementRule({
      repo,
      audit,
      actor: { ...actor, role: "ops_manager" },
      projectId: before.id,
      input: { defaultHourlyRate: 80 },
      reason: "厂家临时调价，负责人已确认",
    });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: ["default_hourly_rate"],
        isHighRisk: true,
        reason: "厂家临时调价，负责人已确认",
      }),
    );
  });
});
