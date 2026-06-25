import { describe, expect, it, vi } from "vitest";

import type { ProjectCostItemRecord } from "./complex-cost-types";
import {
  attachProjectCostItemsToSettlementBatch,
  approveComplexCostRuleVersion,
  createManualProjectCostItem,
  saveComplexCostRuleDraft,
  updateProjectCostItemStatus,
} from "./complex-cost-service";

const actor = {
  userId: "user-1",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

describe("complex cost service", () => {
  it("requires complex cost entitlement before saving a project rule draft", async () => {
    const repo = {
      getProjectEntitlement: vi.fn(async () => null),
      createRuleVersion: vi.fn(),
      getNextRuleVersionNo: vi.fn(async () => 1),
    };

    await expect(
      saveComplexCostRuleDraft({
        repo,
        audit: vi.fn(),
        actor,
        input: { projectId: "project-1", rulePayload: { scenario: "cps" } },
      }),
    ).rejects.toThrow("Complex cost rules are not enabled for this project");
  });

  it("approves a draft rule version and writes high-risk audit", async () => {
    const repo = {
      getRuleVersionById: vi.fn(async () => ({
        id: "version-1",
        organizationId: "org-1",
        projectId: "project-1",
        versionNo: 1,
        status: "draft" as const,
        rulePayload: {},
      })),
      updateRuleVersion: vi.fn(async () => ({
        id: "version-1",
        organizationId: "org-1",
        projectId: "project-1",
        versionNo: 1,
        status: "active" as const,
        rulePayload: {},
      })),
      archiveActiveRuleVersions: vi.fn(async () => undefined),
    };
    const audit = vi.fn();

    await approveComplexCostRuleVersion({
      repo,
      audit,
      actor,
      versionId: "version-1",
      reason: "Enable CPS and supplier cost template.",
    });

    expect(repo.archiveActiveRuleVersions).toHaveBeenCalledWith({
      projectId: "project-1",
      exceptVersionId: "version-1",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true }),
    );
  });

  it("creates a manual project cost item with reason and yellow evidence", async () => {
    const repo = {
      getProjectEntitlement: vi.fn(async () => ({
        organizationId: "org-1",
        projectId: "project-1",
        enabledSource: "plan" as const,
        billingMode: "included" as const,
      })),
      createProjectCostItem: vi.fn(async () => ({
        id: "cost-1",
        organizationId: "org-1",
        projectId: "project-1",
        itemType: "supplier_fee" as const,
        amountCents: 12000,
        direction: "cost" as const,
        evidenceLevel: "yellow" as const,
        source: "manual" as const,
        sourcePayload: {},
        reason: "Supplier bill confirmed by finance.",
        status: "pending_review" as const,
      })),
    };

    await expect(
      createManualProjectCostItem({
        repo,
        audit: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          itemType: "supplier_fee",
          amountCents: 12000,
          direction: "cost",
          evidenceLevel: "yellow",
          reason: "Supplier bill confirmed by finance.",
        },
      }),
    ).resolves.toMatchObject({ id: "cost-1" });
  });

  it("rejects partial settlement attachment when any requested cost item is missing or unconfirmed", async () => {
    const repo = {
      attachCostItemsToSettlementBatch: vi.fn(async () => [
        {
          id: "cost-1",
          organizationId: "org-1",
          projectId: "project-1",
          itemType: "traffic" as const,
          amountCents: 1000,
          direction: "cost" as const,
          evidenceLevel: "yellow" as const,
          source: "import" as const,
          sourcePayload: {},
          reason: "Attach confirmed traffic cost.",
          status: "confirmed" as const,
        },
      ]),
      listProjectCostItems: vi.fn(),
    };

    await expect(
      attachProjectCostItemsToSettlementBatch({
        repo,
        audit: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          settlementBatchId: "batch-1",
          costItemIds: ["cost-1", "cost-missing"],
          reason: "Attach confirmed project costs.",
        },
      }),
    ).rejects.toThrow(
      "Some project cost items could not be attached to the settlement batch",
    );
  });
});

describe("updateProjectCostItemStatus", () => {
  const entitlement = {
    id: "ent-1",
    organizationId: "org-1",
    projectId: "project-1",
    enabledSource: "plan" as const,
    billingMode: "included" as const,
  };
  const pendingItem: ProjectCostItemRecord = {
    id: "item-1",
    organizationId: "org-1",
    projectId: "project-1",
    streamerId: null,
    supplierOrganizationId: null,
    liveReportId: null,
    settlementBatchId: null,
    itemType: "supplier_fee",
    amountCents: 12_000,
    direction: "cost",
    evidenceLevel: "yellow",
    source: "manual",
    sourcePayload: {},
    reason: "供应商账单",
    status: "pending_review",
    createdBy: "user-1",
  };

  function createRepo(item: ProjectCostItemRecord = pendingItem) {
    return {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getProjectCostItemById: vi.fn(async () => item),
      updateProjectCostItem: vi.fn(
        async (_id: string, patch: { status: ProjectCostItemRecord["status"] }) => ({
          ...item,
          status: patch.status,
        }),
      ),
    };
  }

  it("confirms a pending item and writes a high-risk approve audit", async () => {
    const repo = createRepo();
    const audit = vi.fn();

    const result = await updateProjectCostItemStatus({
      repo,
      audit,
      actor,
      itemId: "item-1",
      status: "confirmed",
      reason: "财务核对入账",
    });

    expect(result.status).toBe("confirmed");
    expect(repo.updateProjectCostItem).toHaveBeenCalledWith("item-1", {
      status: "confirmed",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        objectType: "project_cost_item",
        changedFields: ["status"],
        isHighRisk: true,
      }),
    );
  });

  it("voids a confirmed item", async () => {
    const repo = createRepo({ ...pendingItem, status: "confirmed" });
    const result = await updateProjectCostItemStatus({
      repo,
      audit: vi.fn(),
      actor,
      itemId: "item-1",
      status: "voided",
      reason: "录入错误作废",
    });
    expect(result.status).toBe("voided");
  });

  it("rejects confirming an already-confirmed item", async () => {
    const repo = createRepo({ ...pendingItem, status: "confirmed" });
    await expect(
      updateProjectCostItemStatus({
        repo,
        audit: vi.fn(),
        actor,
        itemId: "item-1",
        status: "confirmed",
        reason: "再次确认",
      }),
    ).rejects.toThrow(/Cannot confirm/);
    expect(repo.updateProjectCostItem).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const repo = createRepo();
    await expect(
      updateProjectCostItemStatus({
        repo,
        audit: vi.fn(),
        actor,
        itemId: "item-1",
        status: "confirmed",
        reason: "   ",
      }),
    ).rejects.toThrow(/requires a reason/);
  });

  it("rejects operator_business (review is owner/ops_manager only)", async () => {
    const repo = createRepo();
    await expect(
      updateProjectCostItemStatus({
        repo,
        audit: vi.fn(),
        actor: { ...actor, role: "operator_business" as const },
        itemId: "item-1",
        status: "confirmed",
        reason: "确认",
      }),
    ).rejects.toThrow(/cannot review/i);
    expect(repo.getProjectCostItemById).not.toHaveBeenCalled();
  });
});
