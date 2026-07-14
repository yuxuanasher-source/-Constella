import { describe, expect, it, vi } from "vitest";

import type {
  ConfirmCostImportWithRuleItemsInput,
  ConfirmCostImportWithRuleItemsResult,
  ResolveExternalCostRuleExceptionInput,
  ResolveExternalCostRuleExceptionResult,
} from "@/features/complex-cost/complex-cost-repository";
import {
  confirmProjectCostImportBatch,
  createProjectCostImportBatch,
  resolveExternalCostRuleExceptionWithReplay,
  updateProjectCostItemStatus,
  type ComplexCostRepository,
  type CreateImportBatchRepoInput,
  type CreateProjectCostItemRepoInput,
  type CreateRuleVersionRepoInput,
  type ExternalCostRuleReadRepository,
} from "@/features/complex-cost/complex-cost-service";
import type {
  ComplexCostRuleVersionRecord,
  ExternalCostRuleExceptionRecord,
  ProjectComplexCostEntitlementRecord,
  ProjectCostImportBatchRecord,
  ProjectCostItemRecord,
  ProjectCostItemStatus,
  ReplayExternalCostRuleExceptionItemsInput,
  ReplayExternalCostRuleExceptionItemsResult,
  SettlementReconciliationRunRecord,
} from "@/features/complex-cost/complex-cost-types";
import type { ProjectFinancialSettings } from "@/features/complex-cost/project-financials";
import {
  runProjectSettlementReconciliation,
  type BatchTotals,
  type ConfirmedCostSummary,
  type PersistReconciliationRunInput,
  type PersistedSettlementReconciliationRun,
  type ReconciliationDataSource,
  type ReconciliationRunMetadata,
  type ReconciliationTransitionBatch,
} from "@/features/settlements/project-settlement-reconciliation-service";
import type {
  CustomSettlementRuleVersion,
  ResolvedExecutableCustomRuleLayers,
} from "@/features/settlements/custom-rule-repository";
import type {
  RuntimeScalarType,
  RuntimeValueType,
} from "@/features/settlements/custom-rule-types";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";
import {
  confirmSettlementBatch,
  lockSettlementBatch,
  type SettlementActor,
  type SettlementBatchAtomicItemInput,
  type SettlementBatchItemRecord,
  type SettlementBatchRecord,
  type SettlementBatchType,
  type SettlementRepository,
  type SettlementRuleRecord,
  type StreamerUserLink,
} from "@/features/settlements/settlement-service";

const ORG_ID = "org-task-8";
const PROJECT_ID = "project-task-8";
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-07-31";
const USER_ID = "user-owner";

const owner: SettlementActor = {
  userId: USER_ID,
  name: "Owner",
  role: "owner",
  organizationId: ORG_ID,
};

const finance: SettlementActor = {
  userId: "user-finance",
  name: "Finance",
  role: "finance",
  organizationId: ORG_ID,
};

const audit = vi.fn(async () => undefined);
const notify = vi.fn(async () => undefined);

describe("custom settlement cost reconciliation golden paths", () => {
  it("preserves a legacy confirmed import when no external-cost rule is active", async () => {
    const repo = new CostReconciliationHarness();
    const importBatch = await repo.createImport([
      { directAmountCents: 12_345, supplierOrganizationId: "supplier-1" },
    ]);

    const result = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "Finance confirmed legacy import.",
    });

    expect(result.importBatch.status).toBe("confirmed");
    expect(result.items).toEqual([
      expect.objectContaining({
        itemType: "supplier_fee",
        amountCents: 12_345,
        source: "import",
        status: "confirmed",
        sourceRuleVersionId: null,
        sourceImportBatchId: importBatch.id,
      }),
    ]);
    expect(repo.costItems()).toHaveLength(1);
  });

  it("emits two pending-review system cost items and no legacy duplicate when an external-cost rule is active", async () => {
    const repo = new CostReconciliationHarness();
    repo.activeExternalCostRule = externalRule(
      `external_cost = cost_items([
        { category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "traffic" },
        { category: "supplier_fee", amount: supplier_fee, memo: "supplier" }
      ])`,
      ["sales_amount", "supplier_fee"],
      { id: "external-v1" },
    );
    const importBatch = await repo.createImport([
      {
        salesAmountCents: 200_000,
        directAmountCents: 12_345,
        liveReportId: "report-cost-1",
        supplierOrganizationId: "supplier-1",
      },
    ]);

    const result = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "Finance confirmed custom import.",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        itemType: "traffic",
        amountCents: 20_000,
        source: "system",
        status: "pending_review",
        sourceRuleVersionId: "external-v1",
      }),
      expect.objectContaining({
        itemType: "supplier_fee",
        amountCents: 12_345,
        source: "system",
        status: "pending_review",
        sourceRuleVersionId: "external-v1",
      }),
    ]);
    expect(result.items.filter((item) => item.source === "import")).toEqual([]);
    expect(repo.costItems()).toHaveLength(2);
  });

  it("routes missing import fields to row exceptions and replays final siblings once", async () => {
    const repo = new CostReconciliationHarness();
    repo.activeExternalCostRule = externalRule(
      `external_cost = cost_items([
        { category: "supplier_fee", amount: supplier_fee, memo: "supplier" },
        { category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "traffic" }
      ])`,
      [
        {
          name: "supplier_fee",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
        {
          name: "sales_amount",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
      ],
      { id: "external-missing-v1" },
    );
    const importBatch = await repo.createImport([
      { supplierOrganizationId: "supplier-1", liveReportId: "report-cost-2" },
    ]);

    const confirmed = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "Route missing row to review.",
    });
    expect(confirmed.items).toEqual([]);
    expect(repo.exceptionsForBatch(importBatch.id)).toEqual([
      expect.objectContaining({
        variableName: "sales_amount",
        status: "review_required",
      }),
      expect.objectContaining({
        variableName: "supplier_fee",
        status: "review_required",
      }),
    ]);

    const [salesException, supplierException] =
      repo.exceptionsForBatch(importBatch.id);
    await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor: finance,
      exceptionId: supplierException.id,
      resolutionValue: { type: "money_cents", amountCents: 3_456 },
      resolutionReason: "Supplier invoice matched.",
    });
    expect(repo.costItems()).toEqual([]);

    const replayed = await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor: finance,
      exceptionId: salesException.id,
      resolutionValue: { type: "money_cents", amountCents: 88_000 },
      resolutionReason: "Sales report matched.",
    });

    expect(replayed.replayed).toBe(true);
    expect(replayed.items).toEqual([
      expect.objectContaining({
        itemType: "supplier_fee",
        amountCents: 3_456,
        status: "pending_review",
      }),
      expect.objectContaining({
        itemType: "traffic",
        amountCents: 8_800,
        status: "pending_review",
      }),
    ]);
    expect(repo.costItems()).toHaveLength(2);
  });

  it("keeps exception replay retry idempotent", async () => {
    const repo = new CostReconciliationHarness();
    repo.activeExternalCostRule = externalRule(
      `external_cost = cost_items([
        { category: "supplier_fee", amount: supplier_fee, memo: "supplier" },
        { category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "traffic" }
      ])`,
      [
        {
          name: "supplier_fee",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
        {
          name: "sales_amount",
          required: false,
          missingDataPolicy: { action: "route_item_to_review" },
        },
      ],
      { id: "external-retry-v1" },
    );
    const importBatch = await repo.createImport([
      { supplierOrganizationId: "supplier-1", liveReportId: "report-cost-3" },
    ]);

    await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "Route retry row to review.",
    });
    const [salesException, supplierException] =
      repo.exceptionsForBatch(importBatch.id);
    await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor: finance,
      exceptionId: salesException.id,
      resolutionValue: { type: "money_cents", amountCents: 88_000 },
      resolutionReason: "Sales report matched.",
    });
    await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor: finance,
      exceptionId: supplierException.id,
      resolutionValue: { type: "money_cents", amountCents: 3_456 },
      resolutionReason: "Supplier invoice matched.",
    });

    const retry = await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor: finance,
      exceptionId: supplierException.id,
      resolutionValue: { type: "money_cents", amountCents: 3_456 },
      resolutionReason: "Retry after timeout.",
    });
    expect(retry.replay?.idempotencyStatus).toBe("existing");
    expect(repo.costItems()).toHaveLength(2);
  });

  it("does not confirm an import or create items when external-cost formula execution fails", async () => {
    const repo = new CostReconciliationHarness();
    repo.activeExternalCostRule = externalRule(
      'external_cost = cost_items([{ category: "traffic", amount: yuan(10000001), memo: "too high" }])',
      [],
      { id: "external-failing-v1" },
    );
    const importBatch = await repo.createImport([{ directAmountCents: 1 }]);

    await expect(
      confirmProjectCostImportBatch({
        repo,
        customRuleRepo: repo,
        audit,
        actor: owner,
        batchId: importBatch.id,
        reason: "Formula should fail.",
      }),
    ).rejects.toThrow("CUSTOM_RULE_EXECUTION_BLOCKED");

    expect(repo.importBatch(importBatch.id)?.status).toBe("parsed");
    expect(repo.costItems()).toEqual([]);
    expect(repo.confirmAttempts).toBe(0);
  });

  it("changes reconciliation input after pending-review cost items are confirmed", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches();
    repo.activeExternalCostRule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "supplier" }])',
      ["supplier_fee"],
      { id: "external-review-v1" },
    );
    const importBatch = await repo.createImport([{ directAmountCents: 12_345 }]);
    const confirmed = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "Create pending cost.",
    });

    const beforeReview = await repo.runReconciliation();
    await updateProjectCostItemStatus({
      repo,
      audit,
      actor: owner,
      itemId: confirmed.items[0].id,
      status: "confirmed",
      reason: "Finance confirmed generated cost.",
    });
    const afterReview = await repo.runReconciliation();

    expect(beforeReview.cost.externalCostCents).toBe(0);
    expect(afterReview.cost.externalCostCents).toBe(12_345);
    expect(afterReview.run?.inputHash).not.toBe(beforeReview.run?.inputHash);
  });

  it("allows settlement confirmation when a custom reconciliation rule only warns", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches({ payableStatus: "generated" });
    repo.seedConfirmedCostItem({ amountCents: 5_000 });
    repo.activeReconciliationRule = reconciliationRule(
      'warn_if(external_cost_amount > yuan(0), "external cost review required")',
      { id: "recon-warn-v1" },
    );
    const gate = repo.settlementGate();

    const confirmed = await confirmSettlementBatch({
      repo,
      audit,
      notify,
      actor: finance,
      batchId: "payable-batch",
      reason: "Finance accepts warning.",
      gate,
    });

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.reconciliation).toMatchObject({
      warningCheckCodes: ["custom_rule:recon-warn-v1:0"],
      blockedCheckCodes: [],
      trigger: "confirm",
    });
  });

  it("blocks settlement confirmation and locking when a custom reconciliation rule blocks", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches({ payableStatus: "generated" });
    repo.seedConfirmedCostItem({ amountCents: 5_000 });
    repo.activeReconciliationRule = reconciliationRule(
      'block_if(external_cost_amount > yuan(0), "external cost blocks exit")',
      { id: "recon-block-v1" },
    );
    const gate = repo.settlementGate();

    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: finance,
        batchId: "payable-batch",
        reason: "Finance tries to confirm.",
        gate,
      }),
    ).rejects.toThrow("Settlement batch reconciliation blocked");
    expect(repo.settlementBatch("payable-batch")?.status).toBe("generated");

    repo.updateSettlementBatchForTest("payable-batch", { status: "confirmed" });
    await expect(
      lockSettlementBatch({
        repo,
        audit,
        notify,
        actor: owner,
        batchId: "payable-batch",
        reason: "Owner tries to lock.",
        gate,
        now: "2026-07-31T12:00:00.000Z",
      }),
    ).rejects.toThrow("Settlement batch reconciliation blocked");
    expect(repo.settlementBatch("payable-batch")?.status).toBe("confirmed");
    expect(repo.settlementBatch("payable-batch")?.lockedAt).toBeNull();
  });

  it("allows transition after a reconciliation rule revision and a new run", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches({ payableStatus: "generated" });
    repo.seedConfirmedCostItem({ amountCents: 5_000 });
    repo.activeReconciliationRule = reconciliationRule(
      'block_if(external_cost_amount > yuan(0), "external cost blocks exit")',
      { id: "recon-block-v1" },
    );

    await expect(
      confirmSettlementBatch({
        repo,
        audit,
        notify,
        actor: finance,
        batchId: "payable-batch",
        reason: "Blocked by v1.",
        gate: repo.settlementGate(),
      }),
    ).rejects.toThrow("Settlement batch reconciliation blocked");

    const blockedRun = repo.reconciliationRuns().at(-1);
    repo.activeReconciliationRule = reconciliationRule(
      'warn_if(external_cost_amount > yuan(0), "external cost reviewed")',
      { id: "recon-warn-v2" },
    );
    const confirmed = await confirmSettlementBatch({
      repo,
      audit,
      notify,
      actor: finance,
      batchId: "payable-batch",
      reason: "Approved after rule revision.",
      gate: repo.settlementGate(),
    });

    const allowedRun = repo.reconciliationRuns().at(-1);
    expect(confirmed.status).toBe("confirmed");
    expect(blockedRun?.ruleVersionId).toBe("recon-block-v1");
    expect(allowedRun?.ruleVersionId).toBe("recon-warn-v2");
    expect(allowedRun?.coreInputHash).not.toBe(blockedRun?.coreInputHash);
  });

  it("keeps locked batch and historical cost provenance unchanged after later rules run", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches({ payableStatus: "generated" });
    repo.seedConfirmedCostItem({ amountCents: 5_000, ruleVersionId: "external-v1" });
    repo.activeReconciliationRule = reconciliationRule(
      'warn_if(external_cost_amount > yuan(0), "reviewed")',
      { id: "recon-history-v1" },
    );

    await confirmSettlementBatch({
      repo,
      audit,
      notify,
      actor: finance,
      batchId: "payable-batch",
      reason: "Confirm before lock.",
      gate: repo.settlementGate(),
    });
    const locked = await lockSettlementBatch({
      repo,
      audit,
      notify,
      actor: owner,
      batchId: "payable-batch",
      reason: "Lock historical batch.",
      gate: repo.settlementGate(),
      now: "2026-07-31T12:00:00.000Z",
    });
    expect(locked.reconciliation).toBeDefined();
    const historicalBatch = structuredClone(repo.settlementBatch("payable-batch"));
    const historicalCost = structuredClone(repo.costItems()[0]);

    repo.activeExternalCostRule = externalRule(
      'external_cost = cost_items([{ category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "traffic" }])',
      ["sales_amount"],
      { id: "external-v2" },
    );
    repo.activeReconciliationRule = reconciliationRule(
      'warn_if(external_cost_amount > yuan(0), "reviewed after revision")',
      { id: "recon-history-v2" },
    );
    const importBatch = await repo.createImport([{ salesAmountCents: 90_000 }]);
    await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: repo,
      audit,
      actor: owner,
      batchId: importBatch.id,
      reason: "New period import under v2.",
    });
    await repo.runReconciliation();

    expect(repo.settlementBatch("payable-batch")).toEqual(historicalBatch);
    expect(repo.costItems()[0]).toEqual(historicalCost);
    expect(repo.costItems().at(-1)).toMatchObject({
      sourceRuleVersionId: "external-v2",
      status: "pending_review",
    });
  });

  it("keeps totals in integer cents across settlement, cost, tax, and reconciliation boundaries", async () => {
    const repo = new CostReconciliationHarness();
    repo.seedFinalizedSettlementBatches({
      receivableAmountYuan: 1234.56,
      payableAmountYuan: 345.67,
    });
    repo.seedConfirmedCostItem({ amountCents: 8_901 });
    repo.financialSettings = {
      isInvoiced: true,
      outputVatRateBps: 600,
      surtaxRateBps: 1200,
      procurementCostCents: 7_777,
    };

    const result = await repo.runReconciliation();

    const cents = [
      result.income.receivableCents,
      result.cost.payableCents,
      result.cost.externalCostCents,
      result.cost.procurementCents,
      result.cost.totalCents,
      result.tax.outputVatCents,
      result.tax.surtaxCents,
      result.tax.taxTotalCents,
      result.tax.invoiceAmountCents,
      result.profit.grossMarginCents,
      result.profit.manualAdjustmentCents,
    ];
    expect(cents.every(Number.isInteger)).toBe(true);
    expect(result.income.receivableCents).toBe(123_456);
    expect(result.cost.payableCents).toBe(34_567);
    expect(result.tax.outputVatCents).toBe(7_407);
  });
});

class CostReconciliationHarness
  implements
    ComplexCostRepository,
    SettlementRepository,
    ReconciliationDataSource,
    ExternalCostRuleReadRepository
{
  activeExternalCostRule: CustomSettlementRuleVersion | null = null;
  activeReconciliationRule: CustomSettlementRuleVersion | null = null;
  financialSettings: ProjectFinancialSettings = {
    isInvoiced: false,
    outputVatRateBps: 0,
    surtaxRateBps: 0,
    procurementCostCents: 0,
  };
  confirmAttempts = 0;

  private readonly entitlement: ProjectComplexCostEntitlementRecord = {
    id: "entitlement-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    enabledSource: "plan",
    billingMode: "included",
  };
  private readonly imports = new Map<string, ProjectCostImportBatchRecord>();
  private readonly items = new Map<string, ProjectCostItemRecord>();
  private readonly exceptions = new Map<string, ExternalCostRuleExceptionRecord>();
  private readonly batches = new Map<string, SettlementBatchRecord>();
  private readonly settlementItems = new Map<string, SettlementBatchItemRecord[]>();
  private readonly idempotentImports = new Map<
    string,
    ConfirmCostImportWithRuleItemsResult
  >();
  private readonly idempotentReplays = new Map<
    string,
    ReplayExternalCostRuleExceptionItemsResult
  >();
  private readonly persistedRuns = new Map<string, PersistedSettlementReconciliationRun>();
  private readonly runs: SettlementReconciliationRunRecord[] = [];

  async createImport(
    parsedPayload: Array<Record<string, unknown>>,
  ): Promise<ProjectCostImportBatchRecord> {
    return createProjectCostImportBatch({
      repo: this,
      audit,
      actor: owner,
      input: {
        projectId: PROJECT_ID,
        importType: "supplier_bill",
        parsedPayload,
      },
    });
  }

  costItems(): ProjectCostItemRecord[] {
    return [...this.items.values()];
  }

  exceptionsForBatch(importBatchId: string): ExternalCostRuleExceptionRecord[] {
    return [...this.exceptions.values()]
      .filter((exception) => exception.importBatchId === importBatchId)
      .sort((left, right) => left.variableName.localeCompare(right.variableName));
  }

  importBatch(id: string): ProjectCostImportBatchRecord | null {
    return this.imports.get(id) ?? null;
  }

  settlementBatch(id: string): SettlementBatchRecord | null {
    return this.batches.get(id) ?? null;
  }

  reconciliationRuns(): SettlementReconciliationRunRecord[] {
    return this.runs;
  }

  seedFinalizedSettlementBatches(input: {
    receivableAmountYuan?: number;
    payableAmountYuan?: number;
    payableStatus?: SettlementBatchRecord["status"];
  } = {}): void {
    const receivable = settlementBatch({
      id: "receivable-batch",
      batchType: "receivable",
      status: "confirmed",
      computedAmount: input.receivableAmountYuan ?? 2_000,
    });
    const payable = settlementBatch({
      id: "payable-batch",
      batchType: "payable",
      status: input.payableStatus ?? "confirmed",
      computedAmount: input.payableAmountYuan ?? 500,
    });
    this.batches.set(receivable.id, receivable);
    this.batches.set(payable.id, payable);
  }

  seedConfirmedCostItem(input: {
    amountCents: number;
    ruleVersionId?: string | null;
  }): ProjectCostItemRecord {
    const item = projectCostItem({
      id: `seed-cost-${this.items.size + 1}`,
      amountCents: input.amountCents,
      status: "confirmed",
      source: input.ruleVersionId ? "system" : "manual",
      sourceRuleVersionId: input.ruleVersionId ?? null,
      sourceImportBatchId: input.ruleVersionId ? "historical-import" : null,
      sourceExecutionKey: input.ruleVersionId ? "historical-key" : null,
      sourceInputHash: input.ruleVersionId ? "historical-hash" : null,
    });
    this.items.set(item.id, item);
    return item;
  }

  updateSettlementBatchForTest(
    batchId: string,
    patch: Partial<SettlementBatchRecord>,
  ): void {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("Settlement batch not found");
    this.batches.set(batchId, { ...batch, ...patch });
  }

  settlementGate() {
    return {
      assertNoOpenRuleExceptions: async () => undefined,
      evaluateReconciliation: async (input: {
        batchId: string;
        actor: SettlementActor;
        trigger: "confirm" | "lock";
      }) => {
        const batch = this.batches.get(input.batchId);
        if (!batch) throw new Error("Settlement batch not found");
        return this.runReconciliation({
          actor: input.actor,
          triggerType: "settlement_batch",
          triggerBatchId: input.batchId,
          transitionBatch: {
            id: batch.id,
            batchType: batch.batchType,
            status: input.trigger === "confirm" ? "confirmed" : "locked",
          },
        });
      },
    };
  }

  runReconciliation(input: {
    actor?: SettlementActor;
    triggerType?: "manual" | "import_batch" | "settlement_batch" | "scheduled";
    triggerBatchId?: string | null;
    transitionBatch?: ReconciliationTransitionBatch | null;
  } = {}) {
    return runProjectSettlementReconciliation({
      source: this,
      actor: input.actor ?? owner,
      projectId: PROJECT_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      triggerType: input.triggerType ?? "manual",
      triggerBatchId: input.triggerBatchId ?? null,
      transitionBatch: input.transitionBatch ?? null,
    });
  }

  async getProjectEntitlement() {
    return this.entitlement;
  }

  async getNextRuleVersionNo() {
    return 1;
  }

  async createRuleVersion(
    input: CreateRuleVersionRepoInput,
  ): Promise<ComplexCostRuleVersionRecord> {
    return {
      id: "complex-rule-1",
      organizationId: input.organizationId,
      projectId: input.projectId,
      versionNo: input.versionNo,
      status: input.status,
      rulePayload: input.rulePayload,
      createdBy: input.createdBy,
    };
  }

  async getRuleVersionById() {
    return null;
  }

  async updateRuleVersion(): Promise<ComplexCostRuleVersionRecord> {
    throw new Error("not used");
  }

  async archiveActiveRuleVersions(): Promise<void> {}

  async createProjectCostItem(
    input: CreateProjectCostItemRepoInput,
  ): Promise<ProjectCostItemRecord> {
    const item = projectCostItem({
      id: `cost-${this.items.size + 1}`,
      ...input,
    });
    this.items.set(item.id, item);
    return item;
  }

  async getProjectCostItemById(
    itemId: string,
  ): Promise<ProjectCostItemRecord | null> {
    return this.items.get(itemId) ?? null;
  }

  async updateProjectCostItem(
    itemId: string,
    patch: { status: ProjectCostItemStatus },
  ): Promise<ProjectCostItemRecord> {
    const before = this.items.get(itemId);
    if (!before) throw new Error("Project cost item not found");
    const after = { ...before, status: patch.status };
    this.items.set(itemId, after);
    return after;
  }

  async listProjectCostItems(input: {
    organizationId: string;
    projectId: string;
    status?: ProjectCostItemStatus;
  }): Promise<ProjectCostItemRecord[]> {
    return [...this.items.values()].filter(
      (item) =>
        item.organizationId === input.organizationId &&
        item.projectId === input.projectId &&
        (!input.status || item.status === input.status),
    );
  }

  async createImportBatch(
    input: CreateImportBatchRepoInput,
  ): Promise<ProjectCostImportBatchRecord> {
    const batch: ProjectCostImportBatchRecord = {
      id: `import-${this.imports.size + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      importType: input.importType,
      fileUrl: input.fileUrl,
      rowCount: input.rowCount,
      parsedPayload: input.parsedPayload,
      status: input.status,
      createdBy: input.createdBy,
      createdAt: "2026-07-14T00:00:00.000Z",
    };
    this.imports.set(batch.id, batch);
    return batch;
  }

  async listImportBatches(): Promise<ProjectCostImportBatchRecord[]> {
    return [...this.imports.values()];
  }

  async getImportBatchById(
    batchId: string,
  ): Promise<ProjectCostImportBatchRecord | null> {
    return this.imports.get(batchId) ?? null;
  }

  async updateImportBatch(
    batchId: string,
    patch: Partial<ProjectCostImportBatchRecord>,
  ): Promise<ProjectCostImportBatchRecord> {
    const before = this.imports.get(batchId);
    if (!before) throw new Error("Project cost import batch not found");
    const after = { ...before, ...patch };
    this.imports.set(batchId, after);
    return after;
  }

  async attachCostItemsToSettlementBatch(): Promise<ProjectCostItemRecord[]> {
    return [];
  }

  async listSettlementReconciliationRuns(): Promise<
    SettlementReconciliationRunRecord[]
  > {
    return this.runs;
  }

  async getExternalCostRuleExceptionById(input: {
    exceptionId: string;
  }): Promise<ExternalCostRuleExceptionRecord | null> {
    return this.exceptions.get(input.exceptionId) ?? null;
  }

  async resolveExternalCostRuleException(
    input: ResolveExternalCostRuleExceptionInput,
  ): Promise<ResolveExternalCostRuleExceptionResult> {
    const before = this.exceptions.get(input.exceptionId);
    if (!before) throw new Error("External cost rule exception not found");
    const sameResolution =
      JSON.stringify(before.resolutionValue) ===
      JSON.stringify(input.resolutionValue);
    if (before.status === "resolved") {
      if (!sameResolution) {
        throw new Error(
          "Settlement rule exception was already resolved with a different value",
        );
      }
      return this.exceptionResolutionResult(before);
    }

    const after: ExternalCostRuleExceptionRecord = {
      ...before,
      status: "resolved",
      resolutionValue: input.resolutionValue,
      resolutionReason: input.resolutionReason,
      resolvedBy: input.resolvedBy,
      resolvedAt: "2026-07-14T00:10:00.000Z",
    };
    this.exceptions.set(after.id, after);
    return this.exceptionResolutionResult(after);
  }

  private exceptionResolutionResult(
    exception: ExternalCostRuleExceptionRecord,
  ): ResolveExternalCostRuleExceptionResult {
    const siblings = this.exceptionsForBatch(exception.importBatchId).filter(
      (candidate) => candidate.importRowIndex === exception.importRowIndex,
    );
    const openSiblingCount = siblings.filter(
      (candidate) => candidate.status === "review_required",
    ).length;
    return {
      exception,
      items: [],
      replayed: false,
      replayDeferred: openSiblingCount === 0,
      openSiblingCount,
      needsReplay: openSiblingCount === 0,
    };
  }

  async listExternalCostRuleExceptionsForImportRow(input: {
    importBatchId: string;
    importRowIndex: number;
  }): Promise<ExternalCostRuleExceptionRecord[]> {
    return [...this.exceptions.values()].filter(
      (exception) =>
        exception.importBatchId === input.importBatchId &&
        exception.importRowIndex === input.importRowIndex,
    );
  }

  async listExternalCostRuleExceptionsForImportBatch(input: {
    importBatchId: string;
    status?: ExternalCostRuleExceptionRecord["status"];
  }): Promise<ExternalCostRuleExceptionRecord[]> {
    return [...this.exceptions.values()].filter(
      (exception) =>
        exception.importBatchId === input.importBatchId &&
        (!input.status || exception.status === input.status),
    );
  }

  async listExternalCostRuleExceptionBatchSummaries() {
    return [];
  }

  async replayExternalCostRuleExceptionItems(
    input: ReplayExternalCostRuleExceptionItemsInput,
  ): Promise<ReplayExternalCostRuleExceptionItemsResult> {
    const existing = this.idempotentReplays.get(input.idempotencyKey);
    if (existing) {
      return { ...existing, idempotencyStatus: "existing" };
    }
    const items = input.items.map((source) => {
      const item = projectCostItem({
        id: `cost-${this.items.size + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        streamerId: source.streamerId,
        supplierOrganizationId: source.supplierOrganizationId,
        liveReportId: source.liveReportId,
        settlementBatchId: null,
        itemType: source.itemType,
        amountCents: source.amountCents,
        direction: source.direction,
        evidenceLevel: source.evidenceLevel,
        source: "system",
        sourcePayload: source.sourcePayload,
        sourceRuleVersionId: source.ruleVersionId,
        sourceImportBatchId: input.importBatchId,
        sourceExecutionKey: source.sourceExecutionKey,
        sourceInputHash: source.sourceInputHash,
        sourceExplanation: source.sourceExplanation,
        reason: "Replay resolved external-cost rule exceptions.",
        status: source.status,
        createdBy: input.createdBy,
      });
      this.items.set(item.id, item);
      return item;
    });
    const result = { items, idempotencyStatus: "created" as const };
    this.idempotentReplays.set(input.idempotencyKey, result);
    return result;
  }

  async confirmCostImportWithRuleItems(
    input: ConfirmCostImportWithRuleItemsInput,
  ): Promise<ConfirmCostImportWithRuleItemsResult> {
    this.confirmAttempts += 1;
    const existing = this.idempotentImports.get(input.idempotencyKey);
    if (existing) {
      return { ...existing, idempotencyStatus: "existing" };
    }

    const batch = this.imports.get(input.importBatchId);
    if (!batch) throw new Error("Project cost import batch not found");
    const sourceItems =
      input.mode === "custom" ? input.customItems ?? [] : input.legacyItems ?? [];
    const items = sourceItems.map((source) => {
      const item = projectCostItem({
        id: `cost-${this.items.size + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        streamerId: source.streamerId,
        supplierOrganizationId: source.supplierOrganizationId,
        liveReportId: source.liveReportId,
        settlementBatchId: null,
        itemType: source.itemType,
        amountCents: source.amountCents,
        direction: source.direction,
        evidenceLevel: source.evidenceLevel,
        source: input.mode === "custom" ? "system" : "import",
        sourcePayload: source.sourcePayload,
        sourceRuleVersionId: source.ruleVersionId ?? null,
        sourceImportBatchId: input.importBatchId,
        sourceExecutionKey: source.sourceExecutionKey,
        sourceInputHash: source.sourceInputHash,
        sourceExplanation: source.sourceExplanation,
        reason: input.reason,
        status: source.status,
        createdBy: input.createdBy,
      });
      this.items.set(item.id, item);
      return item;
    });
    const exceptions = (input.exceptions ?? []).map((source) => {
      const exception: ExternalCostRuleExceptionRecord = {
        id: `exception-${this.exceptions.size + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        importBatchId: input.importBatchId,
        importRowIndex: source.importRowIndex,
        ruleVersionId: source.ruleVersionId ?? null,
        variableName: source.variableName,
        policy: source.policy,
        sourceContextSnapshot: source.sourceContextSnapshot,
        status: "review_required",
        resolutionValue: null,
        resolutionReason: null,
        createdBy: input.createdBy,
        resolvedBy: null,
        createdAt: "2026-07-14T00:05:00.000Z",
        resolvedAt: null,
      };
      this.exceptions.set(exception.id, exception);
      return exception;
    });
    const importBatch = { ...batch, status: "confirmed" as const };
    this.imports.set(batch.id, importBatch);
    const result = {
      importBatch,
      items,
      exceptions,
      idempotencyStatus: "created" as const,
    };
    this.idempotentImports.set(input.idempotencyKey, result);
    return result;
  }

  async resolveExecutableCustomRuleLayers(): Promise<ResolvedExecutableCustomRuleLayers> {
    return {
      projectBaseVersion: this.activeExternalCostRule,
      groupVersions: [],
      projectStreamerVersions: [],
      assignmentsByUnitKey: {},
    };
  }

  async getBatchTotals(input: {
    batchType: SettlementBatchType;
    transitionBatch?: ReconciliationTransitionBatch | null;
  }): Promise<{ totals: BatchTotals; evidence: { green: number; yellow: number; red: number; unknown: number }; finalized: boolean; present: boolean }> {
    const totals: BatchTotals = {
      computedCents: 0,
      manualCents: 0,
      adjustmentCents: 0,
    };
    const evidence = { green: 0, yellow: 0, red: 0, unknown: 0 };
    let finalized = true;
    let present = false;
    for (const batch of this.batches.values()) {
      if (batch.batchType !== input.batchType) continue;
      present = true;
      const status =
        input.transitionBatch?.id === batch.id &&
        input.transitionBatch.batchType === batch.batchType
          ? input.transitionBatch.status
          : batch.status;
      if (status !== "confirmed" && status !== "locked") {
        finalized = false;
        continue;
      }
      totals.computedCents += yuanToCents(batch.computedAmount);
      totals.manualCents += yuanToCents(batch.manualAmount);
      totals.adjustmentCents += yuanToCents(batch.adjustmentAmount);
      evidence.green += count(batch.evidenceSummary.green);
      evidence.yellow += count(batch.evidenceSummary.yellow);
      evidence.red += count(batch.evidenceSummary.red);
      evidence.unknown += count(batch.evidenceSummary.unknown);
    }
    return { totals, evidence, finalized, present };
  }

  async getConfirmedCostSummary(): Promise<ConfirmedCostSummary> {
    const summary = {
      costCents: 0,
      revenueOffsetCents: 0,
      adjustmentCents: 0,
      finalized: true,
    };
    for (const item of this.items.values()) {
      if (item.status !== "confirmed") continue;
      if (item.direction === "cost") summary.costCents += item.amountCents;
      if (item.direction === "revenue_offset") {
        summary.revenueOffsetCents += item.amountCents;
      }
      if (item.direction === "adjustment") {
        summary.adjustmentCents += item.amountCents;
      }
    }
    return summary;
  }

  async getFinancialSettings(): Promise<ProjectFinancialSettings & { finalized: boolean }> {
    return { ...this.financialSettings, finalized: true };
  }

  async resolveActiveReconciliationRule(): Promise<CustomSettlementRuleVersion | null> {
    return this.activeReconciliationRule;
  }

  async getCachedReconciliationRun(input: {
    inputHash: string;
  }): Promise<PersistedSettlementReconciliationRun | null> {
    return this.persistedRuns.get(input.inputHash) ?? null;
  }

  async persistReconciliationRun(
    input: PersistReconciliationRunInput,
  ): Promise<PersistedSettlementReconciliationRun | ReconciliationRunMetadata> {
    const record: SettlementReconciliationRunRecord = {
      id: `recon-run-${this.runs.length + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      triggerType: input.triggerType,
      triggerBatchId: input.triggerBatchId,
      coreInputHash: input.inputHash,
      coreResult: input.coreResult as unknown as Record<string, unknown>,
      ruleVersionId: input.ruleVersionId,
      formulaHash: input.formulaHash,
      customChecks: { checks: input.customChecks },
      finalChecks: { checks: input.finalChecks },
      blocked: input.blocked,
      warnings: input.warnings,
      createdBy: input.createdBy,
      createdAt: "2026-07-14T00:20:00.000Z",
    };
    this.runs.push(record);
    const persisted = {
      id: record.id,
      inputHash: input.inputHash,
      createdAt: record.createdAt,
      result: {
        ...input.result,
        run: {
          id: record.id,
          inputHash: input.inputHash,
          createdAt: record.createdAt,
        },
      },
    };
    this.persistedRuns.set(input.inputHash, persisted);
    return persisted;
  }

  async listSettlementPoolReports() {
    return [];
  }

  async getSettlementRules(): Promise<SettlementRuleRecord[]> {
    return [];
  }

  async getProjectSettlementRule() {
    return null;
  }

  async createSettlementBatch(): Promise<SettlementBatchRecord> {
    throw new Error("not used");
  }

  async createSettlementBatchItem(): Promise<SettlementBatchItemRecord> {
    throw new Error("not used");
  }

  async createSettlementBatchAtomic(input: {
    items: SettlementBatchAtomicItemInput[];
  }): Promise<{ batch: SettlementBatchRecord; items: SettlementBatchItemRecord[] }> {
    const batch = settlementBatch({
      id: `settlement-${this.batches.size + 1}`,
      batchType: "payable",
      status: "generated",
    });
    const items = input.items.map((source, index) =>
      settlementItem({
        id: `settlement-item-${index + 1}`,
        settlementBatchId: batch.id,
        ...source,
      }),
    );
    this.batches.set(batch.id, batch);
    this.settlementItems.set(batch.id, items);
    return { batch, items };
  }

  async markReportSettled(): Promise<void> {}

  async getSettlementBatchById(
    batchId: string,
  ): Promise<SettlementBatchRecord | null> {
    return this.batches.get(batchId) ?? null;
  }

  async updateSettlementBatch(
    batchId: string,
    patch: Partial<SettlementBatchRecord>,
  ): Promise<SettlementBatchRecord> {
    const before = this.batches.get(batchId);
    if (!before) throw new Error("Settlement batch not found");
    const after = { ...before, ...patch };
    this.batches.set(batchId, after);
    return after;
  }

  async listSettlementBatchItems(
    batchId: string,
  ): Promise<SettlementBatchItemRecord[]> {
    return this.settlementItems.get(batchId) ?? [];
  }

  async listStreamerUserLinks(): Promise<StreamerUserLink[]> {
    return [];
  }
}

function projectCostItem(
  input: Partial<ProjectCostItemRecord> & {
    id: string;
    amountCents: number;
  },
): ProjectCostItemRecord {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    streamerId: null,
    supplierOrganizationId: null,
    liveReportId: null,
    settlementBatchId: null,
    itemType: "supplier_fee",
    direction: "cost",
    evidenceLevel: "yellow",
    source: "manual",
    sourcePayload: {},
    sourceRuleVersionId: null,
    sourceImportBatchId: null,
    sourceExecutionKey: null,
    sourceInputHash: null,
    sourceExplanation: null,
    reason: "fixture",
    status: "pending_review",
    createdBy: USER_ID,
    createdAt: "2026-07-14T00:00:00.000Z",
    ...input,
  };
}

function settlementBatch(
  input: Partial<SettlementBatchRecord> & {
    id: string;
    batchType: SettlementBatchType;
  },
): SettlementBatchRecord {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    status: "confirmed",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    computedAmount: 0,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceSummary: { green: 1, yellow: 0, red: 0, unknown: 0 },
    createdBy: USER_ID,
    lockedAt: null,
    lockReason: null,
    reopenReason: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...input,
  };
}

function settlementItem(
  input: Partial<SettlementBatchItemRecord> & {
    id: string;
    settlementBatchId: string;
  },
): SettlementBatchItemRecord {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    streamerId: "streamer-1",
    liveReportId: null,
    itemType: "live_report_payable",
    computedAmount: 0,
    manualAmount: 0,
    adjustmentAmount: 0,
    evidenceLevel: "green",
    evidenceSnapshot: {},
    createdAt: "2026-07-14T00:00:00.000Z",
    ...input,
  };
}

function externalRule(
  formula: string,
  requirements:
    | string[]
    | Array<{
        name: string;
        required: boolean;
        missingDataPolicy?: unknown;
      }>,
  overrides: CustomRuleVersionOverrides = {},
): CustomSettlementRuleVersion {
  return customRuleVersion({
    scope: "external_cost",
    executionGrain: "report",
    compositionMode: "emit_items",
    formula,
    requirements,
    ...overrides,
  });
}

function reconciliationRule(
  formula: string,
  overrides: CustomRuleVersionOverrides = {},
): CustomSettlementRuleVersion {
  return customRuleVersion({
    scope: "reconciliation",
    executionGrain: "project_period",
    compositionMode: "check",
    formula,
    requirements: [],
    ...overrides,
  });
}

type CustomRuleVersionOverrides = Partial<
  Pick<CustomSettlementRuleVersion, "id" | "versionNumber" | "parameters">
>;

type CustomRuleVersionFixtureInput = CustomRuleVersionOverrides & {
  formula: string;
  scope: "external_cost" | "reconciliation";
  executionGrain: "report" | "project_period";
  compositionMode: "emit_items" | "check";
  requirements:
    | string[]
    | Array<{
        name: string;
        required: boolean;
        missingDataPolicy?: unknown;
      }>;
};

function customRuleVersion(
  input: CustomRuleVersionFixtureInput,
): CustomSettlementRuleVersion {
  const validation = validateCustomRuleFormula(input.formula, {
    scope: input.scope,
    executionGrain: input.executionGrain,
    compositionMode: input.compositionMode,
  });
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.code ?? "validation failed");
  }
  const requirements = input.requirements.map((requirement) =>
    typeof requirement === "string"
      ? inputRequirement(requirement, true)
      : inputRequirement(
          requirement.name,
          requirement.required,
          requirement.missingDataPolicy,
        ),
  );
  return {
    id: input.id ?? `${input.scope}-rule-v1`,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    scope: input.scope,
    target: { targetType: "project", targetId: null },
    executionGrain: input.executionGrain,
    compositionMode: input.compositionMode,
    priority: 0,
    versionNumber: input.versionNumber ?? 1,
    status: "active",
    formula: input.formula,
    compiledAst:
      validation.compiledAst as unknown as CustomSettlementRuleVersion["compiledAst"],
    variables: requirements as unknown as CustomSettlementRuleVersion["variables"],
    parameters: input.parameters ?? {},
    ruleContract: {
      schemaVersion: 1,
      scope: input.scope,
      target: { targetType: "project", targetId: null },
      executionGrain: input.executionGrain,
      compositionMode: input.compositionMode,
      title: input.id ?? input.scope,
      summary: "Task 8 regression fixture",
      calculationComponents: [],
      requiredInputs: [],
      parameters: [],
      missingDataPolicy: { action: "block_batch" },
      compositionDescription: "Task 8 regression fixture",
      businessTimezone: "Asia/Shanghai",
      effectiveStartAt: "2026-07-01T00:00:00.000Z",
      effectiveEndAt: null,
      examples: [],
    },
    formulaHash: validation.formulaHash,
    contractHash: "contract-hash",
    parameterHash: "parameter-hash",
    catalogHash: "catalog-hash",
    dataSelectionHash: "data-selection-hash",
    systemExplanationTemplate: "Task 8 regression fixture",
    missingDataPolicy: { action: "block_batch" },
    testCases: [],
    simulationSummary: {},
    simulationId: null,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: USER_ID,
    approvedBy: USER_ID,
    aiDraftId: null,
    reason: "approved",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function inputRequirement(
  name: string,
  required: boolean,
  missingDataPolicy?: unknown,
) {
  return {
    variableId: name,
    name,
    required,
    category: required ? "formula_input" : "optional_input",
    valueType: valueTypeFor(name),
    ...(missingDataPolicy ? { missingDataPolicy } : {}),
  };
}

function valueTypeFor(name: string): RuntimeValueType {
  if (name === "import_row_index" || name === "order_count") {
    return scalar("integer");
  }
  if (name.endsWith("_id") || name === "supplier_id" || name === "report_id") {
    return scalar("string");
  }
  return scalar("money_cents");
}

function scalar<ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } {
  return { kind: "scalar", scalarType };
}

function yuanToCents(value: number): number {
  return Math.round(value * 100);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}
