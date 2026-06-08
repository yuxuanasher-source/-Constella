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
    expect(repo.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        ownerUserId: actor.userId,
      }),
    );
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

  it("updates project status through the existing transition guard", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      code: "OLD",
      status: "active" as const,
    };
    const after = { ...before, status: "paused" as const };
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
      input: { status: "paused" },
    });

    expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
      status: "paused",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: ["status"],
      }),
    );
  });

  it("updates project profile fields from settings", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      code: "OLD",
      status: "draft" as const,
    };
    const after = {
      ...before,
      vendor_name: "厂商 A",
      product_name: "产品 A",
      agent_name: "代理商 A",
      supplier_name: "供应商 A",
      description: "项目说明 A",
    };
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
      input: {
        vendorName: "厂商 A",
        productName: "产品 A",
        agentName: "代理商 A",
        supplierName: "供应商 A",
        description: "项目说明 A",
      },
    });

    expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
      vendor_name: "厂商 A",
      product_name: "产品 A",
      agent_name: "代理商 A",
      supplier_name: "供应商 A",
      description: "项目说明 A",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: [
          "vendor_name",
          "product_name",
          "agent_name",
          "supplier_name",
          "description",
        ],
      }),
    );
  });

  it("updates public streamer announcement fields with normal audit", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "Project",
      code: "PUB",
      status: "recruiting" as const,
    };
    const after = {
      ...before,
      is_public_to_streamers: true,
      public_summary: "Streamer-facing brief",
      game_download_url: "https://download.example.com/game",
    };
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
      input: {
        isPublicToStreamers: true,
        publicSummary: "Streamer-facing brief",
        gameDownloadUrl: "https://download.example.com/game",
      },
    });

    expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
      is_public_to_streamers: true,
      public_summary: "Streamer-facing brief",
      game_download_url: "https://download.example.com/game",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: [
          "is_public_to_streamers",
          "public_summary",
          "game_download_url",
        ],
        isHighRisk: false,
      }),
    );
  });

  it("rejects non-http game download URLs", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "Project",
      code: "PUB",
      status: "recruiting" as const,
    };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await expect(
      updateProjectBasics({
        repo,
        audit,
        actor,
        projectId: before.id,
        input: { gameDownloadUrl: "ftp://download.example.com/game" },
      }),
    ).rejects.toThrow("Game download URL must be an http(s) URL");
    expect(repo.updateBasics).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects illegal project status transitions from settings", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      code: "OLD",
      status: "active" as const,
    };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await expect(
      updateProjectBasics({
        repo,
        audit,
        actor,
        projectId: before.id,
        input: { status: "settling" },
      }),
    ).rejects.toThrow("Illegal project status transition: active -> settling");
    expect(repo.updateBasics).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejects publishing draft projects through basic settings", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "Project",
      code: "OLD",
      status: "draft" as const,
    };
    const after = { ...before, status: "recruiting" as const };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn().mockResolvedValue(after),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn().mockResolvedValue(undefined);

    await expect(
      updateProjectBasics({
        repo,
        audit,
        actor,
        projectId: before.id,
        input: { status: "recruiting" },
      }),
    ).rejects.toThrow(
      "Draft projects must be published with the publish action",
    );
    expect(repo.updateBasics).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("allows owner and ops_manager to assign the project owner", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      code: "OLD",
      status: "draft" as const,
      owner_id: actor.userId,
    };
    const after = {
      ...before,
      owner_id: "44444444-4444-4444-4444-444444444444",
    };
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
      actor: { ...actor, role: "ops_manager" },
      projectId: before.id,
      input: { ownerId: "44444444-4444-4444-4444-444444444444" },
    });

    expect(repo.updateBasics).toHaveBeenCalledWith(before.id, {
      owner_id: "44444444-4444-4444-4444-444444444444",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        changedFields: ["owner_id"],
      }),
    );
  });

  it("rejects project owner assignment from operator_business", async () => {
    const before = {
      id: "99999999-9999-9999-9999-999999999999",
      name: "项目",
      code: "OLD",
      status: "draft" as const,
      owner_id: actor.userId,
    };
    const repo = {
      createDraft: vi.fn(),
      getById: vi.fn().mockResolvedValue(before),
      publish: vi.fn(),
      updateBasics: vi.fn(),
      updateSettlementRule: vi.fn(),
    };
    const audit = vi.fn();

    await expect(
      updateProjectBasics({
        repo,
        audit,
        actor,
        projectId: before.id,
        input: { ownerId: "44444444-4444-4444-4444-444444444444" },
      }),
    ).rejects.toThrow("Only owner and ops_manager can assign project owners");
    expect(repo.updateBasics).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
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
