import { describe, expect, it } from "vitest";

import { resolvePlanEntitlements } from "@/features/billing/billing-gates";
import { calculateComplexCostPreview } from "@/features/complex-cost/complex-cost-calculator";
import {
  approveComplexCostRuleVersion,
  attachProjectCostItemsToSettlementBatch,
  confirmProjectCostImportBatch,
  createProjectCostImportBatch,
  saveComplexCostRuleDraft,
  type ComplexCostRepository,
  type CreateImportBatchRepoInput,
  type CreateProjectCostItemRepoInput,
  type CreateRuleVersionRepoInput,
} from "@/features/complex-cost/complex-cost-service";
import { toComplexCostDashboardDto } from "@/features/complex-cost/complex-cost-ui-dto";
import type {
  ComplexCostRuleVersionRecord,
  ProjectComplexCostEntitlementRecord,
  ProjectCostImportBatchRecord,
  ProjectCostItemRecord,
} from "@/features/complex-cost/complex-cost-types";

describe("complex cost golden path", () => {
  it("covers enable rule -> preview -> import cps -> attach to settlement -> export-safe summary", async () => {
    const result = await runComplexCostGoldenPath({
      planTier: "pro",
      includedComplexProjects: 5,
      projectId: "project-1",
      salesAmountCents: 200000,
      cpsRateBps: 1500,
    });

    expect(result.entitlement).toMatchObject({ billingMode: "included" });
    expect(result.preview.grossMarginCents).toBeGreaterThan(0);
    expect(result.confirmedCostItem).toMatchObject({
      itemType: "cps",
      amountCents: 30000,
    });
    expect(result.settlementBatch.costItems).toHaveLength(1);
    expect(result.streamerSafeBill).not.toHaveProperty("grossMarginCents");
  });
});

async function runComplexCostGoldenPath(input: {
  planTier: "free" | "basic" | "pro" | "enterprise";
  includedComplexProjects: number;
  projectId: string;
  salesAmountCents: number;
  cpsRateBps: number;
}) {
  const entitlements = resolvePlanEntitlements({
    planTier: input.planTier,
    featureAddons: [],
  });
  const repo = new InMemoryComplexCostRepository({
    organizationId: "org-1",
    projectId: input.projectId,
    enabled: entitlements.complex_cost_rules,
  });
  const actor = {
    userId: "owner-1",
    name: "Owner",
    role: "owner" as const,
    organizationId: "org-1",
  };
  const audit = async () => undefined;

  const draft = await saveComplexCostRuleDraft({
    repo,
    audit,
    actor,
    input: {
      projectId: input.projectId,
      rulePayload: { scenario: "cps", cpsRateBps: input.cpsRateBps },
    },
  });
  await approveComplexCostRuleVersion({
    repo,
    audit,
    actor,
    versionId: draft.id,
    reason: "Enable CPS complex cost rule.",
  });
  const preview = calculateComplexCostPreview({
    expectedReceivableCents: 500000,
    streamerCount: 2,
    estimatedMinutesPerStreamer: 120,
    streamerHourlyCostCents: 8000,
    supplierCostCents: 10000,
    trafficCostCents: 5000,
    platformFeeBps: 500,
  });
  const importBatch = await createProjectCostImportBatch({
    repo,
    audit,
    actor,
    input: {
      projectId: input.projectId,
      importType: "cps",
      parsedPayload: [
        {
          itemType: "cps",
          salesAmountCents: input.salesAmountCents,
          rateBps: input.cpsRateBps,
        },
      ],
    },
  });
  const confirmed = await confirmProjectCostImportBatch({
    repo,
    audit,
    actor,
    batchId: importBatch.id,
    reason: "Finance confirmed CPS import.",
  });
  const attached = await attachProjectCostItemsToSettlementBatch({
    repo,
    audit,
    actor,
    input: {
      projectId: input.projectId,
      settlementBatchId: "settlement-1",
      costItemIds: confirmed.items.map((item) => item.id),
      reason: "Attach confirmed CPS cost.",
    },
  });

  return {
    entitlement: repo.entitlement,
    preview,
    confirmedCostItem: confirmed.items[0],
    settlementBatch: { id: "settlement-1", costItems: attached },
    streamerSafeBill: toComplexCostDashboardDto(
      {
        expectedReceivableCents: preview.expectedReceivableCents,
        supplierCostCents: preview.supplierCostCents,
        grossMarginCents: preview.grossMarginCents,
        items: attached,
      },
      "streamer",
    ),
  };
}

class InMemoryComplexCostRepository implements ComplexCostRepository {
  entitlement: ProjectComplexCostEntitlementRecord | null;
  private ruleVersions: ComplexCostRuleVersionRecord[] = [];
  private costItems: ProjectCostItemRecord[] = [];
  private importBatches: ProjectCostImportBatchRecord[] = [];

  constructor(input: {
    organizationId: string;
    projectId: string;
    enabled: boolean;
  }) {
    this.entitlement = input.enabled
      ? {
          id: "entitlement-1",
          organizationId: input.organizationId,
          projectId: input.projectId,
          enabledSource: "plan",
          billingMode: "included",
        }
      : null;
  }

  async getProjectEntitlement() {
    return this.entitlement;
  }

  async getNextRuleVersionNo(projectId: string) {
    return (
      this.ruleVersions.filter((version) => version.projectId === projectId)
        .length + 1
    );
  }

  async createRuleVersion(input: CreateRuleVersionRepoInput) {
    const version = {
      id: `rule-${this.ruleVersions.length + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      versionNo: input.versionNo,
      status: input.status,
      rulePayload: input.rulePayload,
      createdBy: input.createdBy,
    };
    this.ruleVersions.push(version);
    return version;
  }

  async getRuleVersionById(versionId: string) {
    return (
      this.ruleVersions.find((version) => version.id === versionId) ?? null
    );
  }

  async updateRuleVersion(
    versionId: string,
    patch: Partial<ComplexCostRuleVersionRecord>,
  ) {
    const version = await this.getRuleVersionById(versionId);
    if (!version) {
      throw new Error("Complex cost rule version not found");
    }
    Object.assign(version, patch);
    return version;
  }

  async archiveActiveRuleVersions(input: {
    projectId: string;
    exceptVersionId: string;
  }) {
    this.ruleVersions = this.ruleVersions.map((version) =>
      version.projectId === input.projectId &&
      version.status === "active" &&
      version.id !== input.exceptVersionId
        ? { ...version, status: "archived" }
        : version,
    );
  }

  async createProjectCostItem(input: CreateProjectCostItemRepoInput) {
    const item = {
      id: `cost-${this.costItems.length + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      supplierOrganizationId: input.supplierOrganizationId,
      liveReportId: input.liveReportId,
      settlementBatchId: input.settlementBatchId,
      itemType: input.itemType,
      amountCents: input.amountCents,
      direction: input.direction,
      evidenceLevel: input.evidenceLevel,
      source: input.source,
      sourcePayload: input.sourcePayload,
      reason: input.reason,
      status: input.status,
      createdBy: input.createdBy,
    };
    this.costItems.push(item);
    return item;
  }

  async listProjectCostItems() {
    return this.costItems;
  }

  async getProjectCostItemById(itemId: string) {
    return this.costItems.find((item) => item.id === itemId) ?? null;
  }

  async updateProjectCostItem(
    itemId: string,
    patch: { status: ProjectCostItemRecord["status"] },
  ) {
    let updated: ProjectCostItemRecord | null = null;
    this.costItems = this.costItems.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      updated = { ...item, status: patch.status };
      return updated;
    });
    if (!updated) {
      throw new Error("cost item not found");
    }
    return updated;
  }

  async createImportBatch(input: CreateImportBatchRepoInput) {
    const batch = {
      id: `import-${this.importBatches.length + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      importType: input.importType,
      fileUrl: input.fileUrl,
      rowCount: input.rowCount,
      parsedPayload: input.parsedPayload,
      status: input.status,
      createdBy: input.createdBy,
    };
    this.importBatches.push(batch);
    return batch;
  }

  async getImportBatchById(batchId: string) {
    return this.importBatches.find((batch) => batch.id === batchId) ?? null;
  }

  async updateImportBatch(
    batchId: string,
    patch: Partial<ProjectCostImportBatchRecord>,
  ) {
    const batch = await this.getImportBatchById(batchId);
    if (!batch) {
      throw new Error("Project cost import batch not found");
    }
    Object.assign(batch, patch);
    return batch;
  }

  async attachCostItemsToSettlementBatch(input: {
    organizationId: string;
    projectId: string;
    costItemIds: string[];
    settlementBatchId: string;
  }) {
    this.costItems = this.costItems.map((item) =>
      item.organizationId === input.organizationId &&
      item.projectId === input.projectId &&
      input.costItemIds.includes(item.id)
        ? { ...item, settlementBatchId: input.settlementBatchId }
        : item,
    );
    return this.costItems.filter((item) => input.costItemIds.includes(item.id));
  }

  async listSettlementReconciliationRuns() {
    return [];
  }
}
