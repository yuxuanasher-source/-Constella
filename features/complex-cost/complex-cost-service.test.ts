import { describe, expect, it, vi } from "vitest";

import {
  attachProjectCostItemsToSettlementBatch,
  approveComplexCostRuleVersion,
  createManualProjectCostItem,
  saveComplexCostRuleDraft,
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
