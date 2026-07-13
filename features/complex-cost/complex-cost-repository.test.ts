import { describe, expect, it, vi } from "vitest";

import type { ComplexCostRepository } from "./complex-cost-service";
import {
  mapCostItemRow,
  mapSettlementReconciliationRunRow,
  SupabaseComplexCostRepository,
} from "./complex-cost-repository";

const costItemRow = {
  id: "cost-1",
  organization_id: "org-1",
  project_id: "project-1",
  streamer_id: null,
  supplier_organization_id: null,
  live_report_id: null,
  settlement_batch_id: null,
  item_type: "supplier_fee" as const,
  amount_cents: 12_000,
  direction: "cost" as const,
  evidence_level: "yellow" as const,
  source: "import" as const,
  source_payload: { rowIndex: 0 },
  source_rule_version_id: "rule-version-1",
  source_import_batch_id: "import-1",
  source_execution_key: "import-1:0:supplier_fee",
  source_input_hash: "input-hash-1",
  source_explanation: "Supplier fee routed by approved custom rule.",
  reason: "Custom rule import confirmation.",
  status: "pending_review" as const,
  created_by: "user-1",
  created_at: "2026-07-14T00:00:00.000Z",
};

const exceptionRow = {
  id: "exception-1",
  organization_id: "org-1",
  project_id: "project-1",
  import_batch_id: "import-1",
  import_row_index: 0,
  rule_version_id: "rule-version-1",
  variable_name: "supplierBillAmountCents",
  policy: "route_item_to_review" as const,
  source_context_snapshot: { row: { supplierName: "Vendor A" } },
  status: "review_required" as const,
  resolution_value: null,
  resolution_reason: null,
  created_by: "user-1",
  resolved_by: null,
  created_at: "2026-07-14T00:00:00.000Z",
  resolved_at: null,
};

const reconciliationRunRow = {
  id: "run-1",
  organization_id: "org-1",
  project_id: "project-1",
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  trigger_type: "import_batch" as const,
  trigger_batch_id: "import-1",
  core_input_hash: "core-hash-1",
  core_result: { payableCents: 10_000 },
  rule_version_id: "rule-version-1",
  formula_hash: "formula-hash-1",
  custom_checks: { supplierFeeCents: 12_000 },
  final_checks: { balanced: true },
  blocked: false,
  warnings: [{ code: "open_exception" }],
  created_by: "user-1",
  created_at: "2026-07-14T00:00:00.000Z",
};

describe("SupabaseComplexCostRepository custom import confirmation", () => {
  it("delegates all-or-nothing custom imports to the atomic RPC and maps provenance", async () => {
    const from = vi.fn();
    const rpc = vi.fn(async () => ({
      data: {
        import_batch: {
          id: "import-1",
          organization_id: "org-1",
          project_id: "project-1",
          import_type: "supplier_bill",
          file_url: null,
          row_count: 1,
          parsed_payload: [{ supplierName: "Vendor A" }],
          status: "confirmed",
          created_by: "user-1",
          created_at: "2026-07-14T00:00:00.000Z",
        },
        items: [costItemRow],
        exceptions: [exceptionRow],
        idempotency_status: "created",
      },
      error: null,
    }));
    const repo = new SupabaseComplexCostRepository({ rpc, from } as never);

    const result = await repo.confirmCostImportWithRuleItems({
      organizationId: "org-1",
      projectId: "project-1",
      importBatchId: "import-1",
      idempotencyKey: "confirm-1",
      inputHash: "input-hash-1",
      mode: "custom",
      reason: "Custom rule import confirmation.",
      createdBy: "user-1",
      customItems: [
        {
          importRowIndex: 0,
          ruleVersionId: "rule-version-1",
          itemType: "supplier_fee",
          amountCents: 12_000,
          direction: "cost",
          evidenceLevel: "yellow",
          sourcePayload: { rowIndex: 0 },
          sourceExecutionKey: "import-1:0:supplier_fee",
          sourceInputHash: "input-hash-1",
          sourceExplanation: "Supplier fee routed by approved custom rule.",
          status: "pending_review",
        },
      ],
      exceptions: [
        {
          importRowIndex: 0,
          ruleVersionId: "rule-version-1",
          variableName: "supplierBillAmountCents",
          policy: "route_item_to_review",
          sourceContextSnapshot: { row: { supplierName: "Vendor A" } },
        },
      ],
    });

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("confirm_cost_import_with_rule_items", {
      p_organization_id: "org-1",
      p_project_id: "project-1",
      p_import_batch_id: "import-1",
      p_idempotency_key: "confirm-1",
      p_input_hash: "input-hash-1",
      p_mode: "custom",
      p_reason: "Custom rule import confirmation.",
      p_created_by: "user-1",
      p_legacy_items: null,
      p_custom_items: [
        expect.objectContaining({
          import_row_index: 0,
          rule_version_id: "rule-version-1",
          source_execution_key: "import-1:0:supplier_fee",
          source_input_hash: "input-hash-1",
        }),
      ],
      p_exceptions: [
        expect.objectContaining({
          variable_name: "supplierBillAmountCents",
          source_context_snapshot: { row: { supplierName: "Vendor A" } },
        }),
      ],
    });
    expect(result.idempotencyStatus).toBe("created");
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "cost-1",
        sourceRuleVersionId: "rule-version-1",
        sourceImportBatchId: "import-1",
        sourceExecutionKey: "import-1:0:supplier_fee",
        sourceInputHash: "input-hash-1",
        sourceExplanation: "Supplier fee routed by approved custom rule.",
      }),
    ]);
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        id: "exception-1",
        variableName: "supplierBillAmountCents",
        status: "review_required",
      }),
    ]);
  });

  it("returns existing results for duplicate idempotency keys", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        import_batch: {
          id: "import-1",
          organization_id: "org-1",
          project_id: "project-1",
          import_type: "supplier_bill",
          file_url: null,
          row_count: 1,
          parsed_payload: [],
          status: "confirmed",
          created_by: "user-1",
          created_at: "2026-07-14T00:00:00.000Z",
        },
        items: [costItemRow],
        exceptions: [],
        idempotency_status: "existing",
      },
      error: null,
    }));
    const repo = new SupabaseComplexCostRepository({ rpc } as never);

    const result = await repo.confirmCostImportWithRuleItems({
      organizationId: "org-1",
      projectId: "project-1",
      importBatchId: "import-1",
      idempotencyKey: "confirm-1",
      inputHash: "input-hash-1",
      mode: "custom",
      reason: "Retry same request.",
      createdBy: "user-1",
      customItems: [],
      exceptions: [],
    });

    expect(result.idempotencyStatus).toBe("existing");
    expect(result.items).toHaveLength(1);
  });

  it("propagates changed-hash conflicts from the RPC", async () => {
    const repo = new SupabaseComplexCostRepository({
      rpc: vi.fn(async () => ({
        data: null,
        error: new Error("confirm_cost_import_idempotency_conflict"),
      })),
    } as never);

    await expect(
      repo.confirmCostImportWithRuleItems({
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        idempotencyKey: "confirm-1",
        inputHash: "changed-hash",
        mode: "custom",
        reason: "Retry changed request.",
        createdBy: "user-1",
        customItems: [],
        exceptions: [],
      }),
    ).rejects.toThrow("confirm_cost_import_idempotency_conflict");
  });

  it("propagates cross-organization source id rejections from the RPC", async () => {
    const repo = new SupabaseComplexCostRepository({
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "confirm_cost_import_source_scope_mismatch" },
      })),
    } as never);

    await expect(
      repo.confirmCostImportWithRuleItems({
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        idempotencyKey: "confirm-1",
        inputHash: "input-hash-1",
        mode: "legacy",
        reason: "Legacy confirmation.",
        createdBy: "user-1",
        legacyItems: [
          {
            itemType: "supplier_fee",
            amountCents: 12_000,
            direction: "cost",
            evidenceLevel: "yellow",
            sourcePayload: { supplierOrganizationId: "org-2" },
            sourceExecutionKey: "import-1:legacy:0",
            sourceInputHash: "input-hash-1",
            status: "confirmed",
          },
        ],
      }),
    ).rejects.toThrow("confirm_cost_import_source_scope_mismatch");
  });

  it("rejects requests that would create both legacy and custom rows", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseComplexCostRepository({ rpc } as never);

    await expect(
      repo.confirmCostImportWithRuleItems({
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        idempotencyKey: "confirm-1",
        inputHash: "input-hash-1",
        mode: "custom",
        reason: "Invalid mixed request.",
        createdBy: "user-1",
        legacyItems: [
          {
            itemType: "supplier_fee",
            amountCents: 12_000,
            direction: "cost",
            evidenceLevel: "yellow",
            sourcePayload: {},
            sourceExecutionKey: "legacy-key",
            sourceInputHash: "input-hash-1",
            status: "confirmed",
          },
        ],
        customItems: [
          {
            importRowIndex: 0,
            ruleVersionId: "rule-version-1",
            itemType: "supplier_fee",
            amountCents: 12_000,
            direction: "cost",
            evidenceLevel: "yellow",
            sourcePayload: {},
            sourceExecutionKey: "custom-key",
            sourceInputHash: "input-hash-1",
            status: "pending_review",
          },
        ],
      }),
    ).rejects.toThrow("Confirm cost import accepts either legacy or custom mode");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects legacy mode when exception payloads are supplied", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseComplexCostRepository({ rpc } as never);

    await expect(
      repo.confirmCostImportWithRuleItems({
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        idempotencyKey: "confirm-1",
        inputHash: "input-hash-1",
        mode: "legacy",
        reason: "Invalid mixed request.",
        createdBy: "user-1",
        legacyItems: [
          {
            itemType: "supplier_fee",
            amountCents: 12_000,
            direction: "cost",
            evidenceLevel: "yellow",
            sourcePayload: {},
            sourceExecutionKey: "legacy-key",
            sourceInputHash: "input-hash-1",
            status: "confirmed",
          },
        ],
        exceptions: [
          {
            importRowIndex: 0,
            ruleVersionId: "rule-version-1",
            variableName: "supplierBillAmountCents",
            policy: "route_item_to_review",
            sourceContextSnapshot: {},
          },
        ],
      }),
    ).rejects.toThrow("Confirm cost import accepts exceptions only in custom mode");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SupabaseComplexCostRepository exception resolution", () => {
  it("maps reviewed exception resolution and defers Task 3 replay insertion", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        exception: {
          ...exceptionRow,
          status: "resolved",
          resolution_value: { amountCents: 12_000 },
          resolution_reason: "Finance reviewed supplier bill.",
          resolved_by: "user-2",
          resolved_at: "2026-07-14T01:00:00.000Z",
        },
        items: [],
        replayed: false,
        replay_deferred: true,
      },
      error: null,
    }));
    const repo = new SupabaseComplexCostRepository({ rpc } as never);

    const result = await repo.resolveExternalCostRuleException({
      organizationId: "org-1",
      exceptionId: "exception-1",
      resolutionValue: { amountCents: 12_000 },
      resolutionReason: "Finance reviewed supplier bill.",
      resolvedBy: "user-2",
    });

    expect(rpc).toHaveBeenCalledWith("resolve_external_cost_rule_exception", {
      p_organization_id: "org-1",
      p_exception_id: "exception-1",
      p_resolution_value: { amountCents: 12_000 },
      p_resolution_reason: "Finance reviewed supplier bill.",
      p_resolved_by: "user-2",
    });
    expect(result.replayed).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.exception).toEqual(
      expect.objectContaining({
        status: "resolved",
        resolvedBy: "user-2",
      }),
    );
  });
});

describe("mapCostItemRow", () => {
  it("preserves nullable provenance for existing cost item consumers", () => {
    expect(
      mapCostItemRow({
        ...costItemRow,
        source_rule_version_id: null,
        source_import_batch_id: null,
        source_execution_key: null,
        source_input_hash: null,
        source_explanation: null,
      }),
    ).toEqual(
      expect.objectContaining({
        sourceRuleVersionId: null,
        sourceImportBatchId: null,
        sourceExecutionKey: null,
        sourceInputHash: null,
        sourceExplanation: null,
      }),
    );
  });
});

describe("settlement reconciliation run repository mapping", () => {
  it("maps reconciliation run rows into the complex-cost DTO", () => {
    expect(mapSettlementReconciliationRunRow(reconciliationRunRow)).toEqual({
      id: "run-1",
      organizationId: "org-1",
      projectId: "project-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      triggerType: "import_batch",
      triggerBatchId: "import-1",
      coreInputHash: "core-hash-1",
      coreResult: { payableCents: 10_000 },
      ruleVersionId: "rule-version-1",
      formulaHash: "formula-hash-1",
      customChecks: { supplierFeeCents: 12_000 },
      finalChecks: { balanced: true },
      blocked: false,
      warnings: [{ code: "open_exception" }],
      createdBy: "user-1",
      createdAt: "2026-07-14T00:00:00.000Z",
    });
  });

  it("lists reconciliation runs scoped to organization and project", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      returns: vi.fn(async () => ({ data: [reconciliationRunRow], error: null })),
    };
    const from = vi.fn(() => query);
    const repo = new SupabaseComplexCostRepository({ from } as never);
    const contractRepo: Pick<
      ComplexCostRepository,
      "listSettlementReconciliationRuns"
    > = repo;

    await expect(
      contractRepo.listSettlementReconciliationRuns({
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "run-1",
        triggerType: "import_batch",
        coreInputHash: "core-hash-1",
      }),
    ]);

    expect(from).toHaveBeenCalledWith("settlement_reconciliation_runs");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });
});
