import { describe, expect, it, vi } from "vitest";

import type { ProjectCostItemRecord } from "./complex-cost-types";
import {
  attachProjectCostItemsToSettlementBatch,
  approveComplexCostRuleVersion,
  confirmProjectCostImportBatch,
  createManualProjectCostItem,
  resolveExternalCostRuleExceptionWithReplay,
  saveComplexCostRuleDraft,
  updateProjectCostItemStatus,
} from "./complex-cost-service";
import { executeExternalCostRuleForImport } from "@/features/settlements/custom-rule-external-cost";
import { validateCustomRuleFormula } from "@/features/settlements/custom-rule-validator";

const actor = {
  userId: "user-1",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

const entitlement = {
  id: "ent-1",
  organizationId: "org-1",
  projectId: "project-1",
  enabledSource: "plan" as const,
  billingMode: "included" as const,
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

describe("confirmProjectCostImportBatch custom external-cost execution", () => {
  const parsedBatch = {
    id: "import-1",
    organizationId: "org-1",
    projectId: "project-1",
    importType: "supplier_bill" as const,
    rowCount: 1,
    parsedPayload: [
      {
        directAmountCents: 12_000,
        salesAmountCents: 200_000,
        liveReportId: "report-1",
      },
    ],
    status: "parsed" as const,
    createdBy: "user-1",
    createdAt: "2026-07-14T00:00:00.000Z",
  };

  it("keeps the legacy calculation/status path when no active custom external-cost rule applies", async () => {
    const repo = {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getImportBatchById: vi.fn(async () => parsedBatch),
      confirmCostImportWithRuleItems: vi.fn(async (input) => ({
        importBatch: { ...parsedBatch, status: "confirmed" as const },
        items: input.legacyItems.map((item: Record<string, unknown>, index: number) => ({
          id: `item-${index}`,
          organizationId: "org-1",
          projectId: "project-1",
          itemType: item.itemType,
          amountCents: item.amountCents,
          direction: item.direction,
          evidenceLevel: item.evidenceLevel,
          source: "import",
          sourcePayload: item.sourcePayload,
          reason: "Finance confirmed.",
          status: item.status,
        })),
        exceptions: [],
        idempotencyStatus: "created" as const,
      })),
      createProjectCostItem: vi.fn(),
      updateImportBatch: vi.fn(),
    };
    const customRuleRepo = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: null,
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };

    const result = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: customRuleRepo as never,
      audit: vi.fn(),
      actor,
      batchId: "import-1",
      reason: "Finance confirmed.",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        itemType: "supplier_fee",
        amountCents: 12_000,
        status: "confirmed",
      }),
    ]);
    expect(repo.confirmCostImportWithRuleItems).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "legacy",
        legacyItems: [
          expect.objectContaining({
            itemType: "supplier_fee",
            amountCents: 12_000,
            status: "confirmed",
          }),
        ],
      }),
    );
    expect(repo.createProjectCostItem).not.toHaveBeenCalled();
    expect(repo.updateImportBatch).not.toHaveBeenCalled();
  });

  it("uses the custom atomic RPC with pending-review generated items when an active external-cost rule applies", async () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "投流" }])',
      ["sales_amount"],
    );
    const repo = {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getImportBatchById: vi.fn(async () => parsedBatch),
      confirmCostImportWithRuleItems: vi.fn(async (input) => ({
        importBatch: { ...parsedBatch, status: "confirmed" as const },
        items: input.customItems.map((item: Record<string, unknown>, index: number) => ({
          id: `item-${index}`,
          organizationId: "org-1",
          projectId: "project-1",
          itemType: item.itemType,
          amountCents: item.amountCents,
          direction: item.direction,
          evidenceLevel: item.evidenceLevel,
          source: "system",
          sourcePayload: item.sourcePayload,
          sourceRuleVersionId: item.ruleVersionId,
          sourceExecutionKey: item.sourceExecutionKey,
          sourceInputHash: item.sourceInputHash,
          reason: "Finance confirmed.",
          status: item.status,
        })),
        exceptions: [],
        idempotencyStatus: "created" as const,
      })),
    };
    const customRuleRepo = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: rule,
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };
    const audit = vi.fn();

    const result = await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: customRuleRepo as never,
      audit,
      actor,
      batchId: "import-1",
      reason: "Finance confirmed.",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        itemType: "traffic",
        amountCents: 20_000,
        status: "pending_review",
      }),
    ]);
    expect(repo.confirmCostImportWithRuleItems).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "custom",
        customItems: [
          expect.objectContaining({
            ruleVersionId: "rule-v1",
            itemType: "traffic",
            amountCents: 20_000,
            status: "pending_review",
          }),
        ],
        exceptions: [],
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({
          mode: "custom",
          ruleVersionId: "rule-v1",
          itemCount: 1,
          inputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        }),
      }),
    );
  });

  it("does not confirm or create items when custom formula execution fails", async () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "traffic", amount: yuan(10000001), memo: "超限" }])',
      [],
    );
    const repo = {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getImportBatchById: vi.fn(async () => parsedBatch),
      confirmCostImportWithRuleItems: vi.fn(),
    };
    const customRuleRepo = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: rule,
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };

    await expect(
      confirmProjectCostImportBatch({
        repo,
        customRuleRepo: customRuleRepo as never,
        audit: vi.fn(),
        actor,
        batchId: "import-1",
        reason: "Finance confirmed.",
      }),
    ).rejects.toThrow("CUSTOM_RULE_EXECUTION_BLOCKED");
    expect(repo.confirmCostImportWithRuleItems).not.toHaveBeenCalled();
  });

  it("uses trusted batch createdAt for effective rule selection instead of row sourceTimestamp", async () => {
    const v1 = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "v1" }])',
      ["supplier_fee"],
    );
    const v2 = { ...v1, id: "rule-v2" };
    const batch = {
      ...parsedBatch,
      createdAt: "2026-07-10T00:00:00.000Z",
      parsedPayload: [
        {
          directAmountCents: 12_000,
          sourceTimestamp: "2026-08-10T00:00:00.000Z",
        },
      ],
    };
    const repo = {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getImportBatchById: vi.fn(async () => batch),
      confirmCostImportWithRuleItems: vi.fn(async (input) => ({
        importBatch: { ...batch, status: "confirmed" as const },
        items: input.customItems.map((item: Record<string, unknown>, index: number) => ({
          id: `item-${index}`,
          organizationId: "org-1",
          projectId: "project-1",
          itemType: item.itemType,
          amountCents: item.amountCents,
          direction: item.direction,
          evidenceLevel: item.evidenceLevel,
          source: "system",
          sourcePayload: item.sourcePayload,
          reason: "Finance confirmed.",
          status: item.status,
        })),
        exceptions: [],
        idempotencyStatus: "created" as const,
      })),
    };
    const customRuleRepo = {
      resolveExecutableCustomRuleLayers: vi.fn(async (input) => ({
        projectBaseVersion:
          input.executionTimestamp >= "2026-08-01T00:00:00.000Z" ? v2 : v1,
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };

    await confirmProjectCostImportBatch({
      repo,
      customRuleRepo: customRuleRepo as never,
      audit: vi.fn(),
      actor,
      batchId: "import-1",
      reason: "Finance confirmed.",
    });

    expect(customRuleRepo.resolveExecutableCustomRuleLayers).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTimestamp: "2026-07-10T00:00:00.000Z",
      }),
    );
    expect(repo.confirmCostImportWithRuleItems).toHaveBeenCalledWith(
      expect.objectContaining({
        customItems: [
          expect.objectContaining({
            ruleVersionId: "rule-v1",
          }),
        ],
      }),
    );
  });
});

describe("resolveExternalCostRuleExceptionWithReplay", () => {
  it("resolves an exception and replays once when all row siblings are resolved", async () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "供应商" }])',
      [{ name: "supplier_fee", required: false, missingDataPolicy: { action: "route_item_to_review" } }],
    );
    const initial = executeExternalCostRuleForImportFixture(rule);
    const resolvedException = {
      ...initial.exceptions[0]!,
      id: "exception-1",
      organizationId: "org-1",
      projectId: "project-1",
      importBatchId: "import-1",
      status: "resolved" as const,
      resolutionValue: { type: "money_cents" as const, amountCents: 3456 },
    };
    const repo = {
      getProjectEntitlement: vi.fn(async () => entitlement),
      getExternalCostRuleExceptionById: vi.fn(async () => ({
        ...initial.exceptions[0]!,
        id: "exception-1",
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        status: "review_required" as const,
      })),
      resolveExternalCostRuleException: vi.fn(async () => ({
        exception: resolvedException,
        items: [],
        replayed: false,
        replayDeferred: true,
        openSiblingCount: 0,
        needsReplay: true,
      })),
      listExternalCostRuleExceptionsForImportRow: vi.fn(async () => [
        resolvedException,
      ]),
      replayExternalCostRuleExceptionItems: vi.fn(async (input) => ({
        items: input.items.map((item: Record<string, unknown>) => ({
          id: "item-1",
          organizationId: "org-1",
          projectId: "project-1",
          itemType: item.itemType,
          amountCents: item.amountCents,
          direction: item.direction,
          evidenceLevel: item.evidenceLevel,
          source: "system",
          sourcePayload: item.sourcePayload,
          reason: "Replay.",
          status: item.status,
        })),
        idempotencyStatus: "created" as const,
      })),
    };
    const audit = vi.fn();

    const result = await resolveExternalCostRuleExceptionWithReplay({
      repo,
      audit,
      actor,
      exceptionId: "exception-1",
      resolutionValue: { type: "money_cents", amountCents: 3456 },
      resolutionReason: "补录供应商金额",
    });

    expect(repo.resolveExternalCostRuleException).toHaveBeenCalledOnce();
    expect(repo.listExternalCostRuleExceptionsForImportRow).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      importBatchId: "import-1",
      importRowIndex: 0,
    });
    expect(repo.replayExternalCostRuleExceptionItems).toHaveBeenCalledOnce();
    expect(repo.replayExternalCostRuleExceptionItems).toHaveBeenCalledWith(
      expect.objectContaining({
        inputHash:
          initial.exceptions[0]!.sourceContextSnapshot.__source_context_hash,
        items: [
          expect.objectContaining({
            sourceInputHash:
              initial.exceptions[0]!.sourceContextSnapshot.__source_context_hash,
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      replayed: true,
      replay: { idempotencyStatus: "created" },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        objectType: "external_cost_rule_exception",
        objectId: "exception-1",
        isHighRisk: true,
        after: expect.objectContaining({
          importBatchId: "import-1",
          importRowIndex: 0,
          ruleVersionId: "rule-v1",
          needsReplay: true,
          openSiblingCount: 0,
          replayedItemCount: 1,
          sourceContextHash:
            initial.exceptions[0]!.sourceContextSnapshot.__source_context_hash,
          replayInputHash:
            initial.exceptions[0]!.sourceContextSnapshot.__source_context_hash,
        }),
      }),
    );
    expect(JSON.stringify(audit.mock.calls[0]?.[0])).not.toContain(
      "compiledAst",
    );
    expect(JSON.stringify(audit.mock.calls[0]?.[0])).not.toContain(
      "supplierOrganizationId",
    );
  });

  it("requires entitlement before mutating an exception resolution", async () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "supplier" }])',
      [{ name: "supplier_fee", required: false, missingDataPolicy: { action: "route_item_to_review" } }],
    );
    const initial = executeExternalCostRuleForImportFixture(rule);
    const repo = {
      getProjectEntitlement: vi.fn(async () => null),
      getExternalCostRuleExceptionById: vi.fn(async () => ({
        ...initial.exceptions[0]!,
        id: "exception-1",
        organizationId: "org-1",
        projectId: "project-1",
        importBatchId: "import-1",
        status: "review_required" as const,
      })),
      resolveExternalCostRuleException: vi.fn(),
      listExternalCostRuleExceptionsForImportRow: vi.fn(),
      replayExternalCostRuleExceptionItems: vi.fn(),
    };

    await expect(
      resolveExternalCostRuleExceptionWithReplay({
        repo,
        audit: vi.fn(),
        actor,
        exceptionId: "exception-1",
        resolutionValue: { type: "money_cents", amountCents: 3456 },
        resolutionReason: "Record supplier amount.",
      }),
    ).rejects.toThrow("Complex cost rules are not enabled for this project");

    expect(repo.getExternalCostRuleExceptionById).toHaveBeenCalledWith({
      organizationId: "org-1",
      exceptionId: "exception-1",
    });
    expect(repo.resolveExternalCostRuleException).not.toHaveBeenCalled();
  });
});

function externalRule(
  formula: string,
  requirements:
    | string[]
    | Array<{
        name: string;
        required: boolean;
        missingDataPolicy?: unknown;
      }>,
) {
  const validation = validateCustomRuleFormula(formula, {
    scope: "external_cost",
    executionGrain: "report",
    compositionMode: "emit_items",
  });
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.code ?? "formula invalid");
  }
  return {
    id: "rule-v1",
    organizationId: "org-1",
    projectId: "project-1",
    scope: "external_cost" as const,
    target: { targetType: "project" as const, targetId: null },
    executionGrain: "report" as const,
    compositionMode: "emit_items" as const,
    priority: 0,
    versionNumber: 1,
    status: "active" as const,
    formula,
    compiledAst: validation.compiledAst,
    variables: requirements.map((requirement) =>
      typeof requirement === "string"
        ? inputRequirement(requirement, true)
        : inputRequirement(
            requirement.name,
            requirement.required,
            requirement.missingDataPolicy,
          ),
    ),
    parameters: {},
    ruleContract: {
      businessTimezone: "Asia/Shanghai",
      requiredInputs: [],
      parameters: [],
      missingDataPolicy: { action: "block_batch" as const },
    },
    formulaHash: validation.formulaHash,
    contractHash: "contract-hash",
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
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
    valueType:
      name === "order_count"
        ? { kind: "scalar" as const, scalarType: "integer" as const }
        : { kind: "scalar" as const, scalarType: "money_cents" as const },
    ...(missingDataPolicy ? { missingDataPolicy } : {}),
  };
}

function executeExternalCostRuleForImportFixture(
  rule: ReturnType<typeof externalRule>,
) {
  return executeExternalCostRuleForImport({
    organizationId: "org-1",
    projectId: "project-1",
    importBatch: {
      id: "import-1",
      organizationId: "org-1",
      projectId: "project-1",
      importType: "supplier_bill",
      rowCount: 1,
      parsedPayload: [{ supplierOrganizationId: "supplier-1" }],
      status: "parsed",
      createdBy: "user-1",
      createdAt: "2026-07-14T00:00:00.000Z",
    },
    ruleVersion: rule as never,
    reason: "Finance confirmed.",
    createdBy: "user-1",
  });
}
