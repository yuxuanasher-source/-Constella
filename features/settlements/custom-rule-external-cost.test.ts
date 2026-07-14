import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildExternalCostRuleExceptionReplay,
  executeExternalCostRuleForImport,
} from "./custom-rule-external-cost";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import type { ProjectCostImportBatchRecord } from "@/features/complex-cost/complex-cost-types";
import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import type {
  CompiledAstNode,
  RuntimeScalarType,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";

const ORG_ID = "org-1";
const PROJECT_ID = "project-1";

describe("executeExternalCostRuleForImport", () => {
  it("emits only pending-review system items for an active external-cost rule and supports multiple categories from one row", () => {
    const batch = importBatch([
      {
        salesAmountCents: 200_000,
        directAmountCents: 12_345,
        streamerId: "streamer-1",
        supplierOrganizationId: "supplier-1",
        liveReportId: "report-1",
        ignoredRawAmount: 999_999,
      },
    ]);
    const rule = externalRule(
      `external_cost = cost_items([
        { category: "traffic", amount: percent(sales_amount, rate_percent(10)), memo: "投流" },
        { category: "supplier_fee", amount: supplier_fee, memo: "供应商" }
      ])`,
      ["sales_amount", "supplier_fee"],
    );

    const result = executeExternalCostRuleForImport({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatch: batch,
      ruleVersion: rule,
      reason: "Finance confirmed.",
      createdBy: "user-1",
    });

    expect(result.kind).toBe("custom");
    expect(result.items).toHaveLength(2);
    expect(result.exceptions).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        importRowIndex: 0,
        ruleVersionId: "rule-v1",
        itemType: "traffic",
        amountCents: 20_000,
        status: "pending_review",
        evidenceLevel: "green",
        liveReportId: "report-1",
      }),
      expect.objectContaining({
        importRowIndex: 0,
        ruleVersionId: "rule-v1",
        itemType: "supplier_fee",
        amountCents: 12_345,
        status: "pending_review",
        evidenceLevel: "green",
        supplierOrganizationId: "supplier-1",
      }),
    ]);
    expect(result.items[0]?.sourcePayload).toMatchObject({
      provenance: { source: "custom_rule_import", importBatchId: "import-1" },
      evidence: { kind: "linked_report", liveReportId: "report-1" },
      row: batch.parsedPayload[0],
    });
    expect(JSON.stringify(result.items[0]?.sourcePayload)).toContain(
      "ignoredRawAmount",
    );
    expect(result.items[0]?.sourceExecutionKey).toBe(
      sha256([
        ORG_ID,
        PROJECT_ID,
        "import-1",
        0,
        "rule-v1",
        0,
        result.items[0]?.sourceInputHash,
      ]),
    );
  });

  it("confirms custom mode with zero emitted items and a stable input hash", () => {
    const rule = externalRule("external_cost = cost_items([])", []);

    const result = executeExternalCostRuleForImport({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatch: importBatch([{ directAmountCents: 0 }]),
      ruleVersion: rule,
      reason: "No cost this period.",
      createdBy: "user-1",
    });

    expect(result).toMatchObject({
      kind: "custom",
      items: [],
      exceptions: [],
      ruleVersionId: "rule-v1",
      inputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it.each([
    [
      "route_item_to_review",
      { action: "route_item_to_review" as const },
      "review",
    ],
    [
      "block_batch",
      { action: "block_batch" as const },
      "CUSTOM_RULE_MISSING_DATA_BLOCKED",
    ],
    [
      "use_explicit_default",
      {
        action: "use_explicit_default" as const,
        defaultValue: { type: "money_cents" as const, amountCents: 777 },
      },
      "custom",
    ],
  ])(
    "normalizes supported source variables and applies missing-data policy %s",
    (_label, missingDataPolicy, expected) => {
      const rule = externalRule(
        'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "供应商" }])',
        [{ name: "supplier_fee", required: false, missingDataPolicy }],
      );

      const action = () =>
        executeExternalCostRuleForImport({
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          importBatch: importBatch([
            {
              directAmountCents: undefined,
              unitCount: 3,
              salesAmountCents: 88_000,
              rateBps: 1200,
              streamerId: "streamer-1",
              arbitrary: 1_000_000,
            },
          ]),
          ruleVersion: rule,
          reason: "Finance confirmed.",
          createdBy: "user-1",
        });

      if (expected === "CUSTOM_RULE_MISSING_DATA_BLOCKED") {
        expect(action).toThrow("CUSTOM_RULE_MISSING_DATA_BLOCKED");
        return;
      }

      const result = action();
      if (expected === "review") {
        expect(result).toMatchObject({
          kind: "custom",
          items: [],
          exceptions: [
            {
              importRowIndex: 0,
              variableName: "supplier_fee",
              policy: "route_item_to_review",
              sourceContextSnapshot: expect.objectContaining({
                __source_context_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
                normalizedInputs: expect.objectContaining({
                  order_count: { type: "integer", value: 3 },
                  sales_amount: { type: "money_cents", amountCents: 88_000 },
                }),
              }),
            },
          ],
        });
        expect(
          JSON.stringify(
            result.exceptions[0]?.sourceContextSnapshot.normalizedInputs,
          ),
        ).not.toContain("arbitrary");
        return;
      }

      expect(result.items[0]).toMatchObject({
        itemType: "supplier_fee",
        amountCents: 777,
      });
    },
  );

  it("leaves formula failures unconfirmed by throwing before any items are produced", () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: yuan(10000001), memo: "超限" }])',
      [],
    );

    expect(() =>
      executeExternalCostRuleForImport({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatch: importBatch([{ directAmountCents: 100 }]),
        ruleVersion: rule,
        reason: "Finance confirmed.",
        createdBy: "user-1",
      }),
    ).toThrow("CUSTOM_RULE_EXECUTION_BLOCKED");
  });

  it("caps generated output count and amount through the compiled rule contract", () => {
    expect(() =>
      externalRule(
        `external_cost = cost_items([${Array.from(
          { length: 21 },
          () => '{ category: "traffic", amount: yuan(1), memo: "投流" }',
        ).join(",")}])`,
        [],
      ),
    ).toThrow("VALIDATION_COST_ITEM_LIMIT");

    const overAmountRule = externalRule(
      'external_cost = cost_items([{ category: "traffic", amount: yuan(10000001), memo: "超限" }])',
      [],
    );
    expect(() =>
      executeExternalCostRuleForImport({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        importBatch: importBatch([{}]),
        ruleVersion: overAmountRule,
        reason: "Finance confirmed.",
        createdBy: "user-1",
      }),
    ).toThrow("CUSTOM_RULE_EXECUTION_BLOCKED");
  });
});

describe("buildExternalCostRuleExceptionReplay", () => {
  it("waits for all row exceptions to be resolved, then replays the original snapshotted rule with resolution-bound idempotency", () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "供应商" }])',
      [{ name: "supplier_fee", required: false, missingDataPolicy: { action: "route_item_to_review" } }],
    );
    const initial = executeExternalCostRuleForImport({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatch: importBatch([{ supplierOrganizationId: "supplier-1" }]),
      ruleVersion: rule,
      reason: "Finance confirmed.",
      createdBy: "user-1",
    });
    const unresolved = buildExternalCostRuleExceptionReplay({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatchId: "import-1",
      importRowIndex: 0,
      createdBy: "user-1",
      exceptions: [
        {
          ...initial.exceptions[0]!,
          id: "exception-1",
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          importBatchId: "import-1",
          status: "review_required",
        },
      ],
    });
    expect(unresolved).toBeNull();

    const replay = buildExternalCostRuleExceptionReplay({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatchId: "import-1",
      importRowIndex: 0,
      createdBy: "user-1",
      exceptions: [
        {
          ...initial.exceptions[0]!,
          id: "exception-1",
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          importBatchId: "import-1",
          status: "resolved",
          resolutionValue: { type: "money_cents", amountCents: 3456 },
        },
      ],
    });

    expect(replay).toMatchObject({
      importBatchId: "import-1",
      importRowIndex: 0,
      createdBy: "user-1",
      items: [
        {
          itemType: "supplier_fee",
          amountCents: 3456,
          status: "pending_review",
          sourcePayload: expect.objectContaining({
            provenance: expect.objectContaining({ replayedFromExceptions: ["exception-1"] }),
          }),
        },
      ],
    });
    if (!replay) {
      throw new Error("expected replay payload");
    }
    expect(replay.idempotencyKey).toBe(
      sha256([
        ORG_ID,
        PROJECT_ID,
        "import-1",
        0,
        "rule-v1",
        "exception-1",
        replay.inputHash,
      ]),
    );
  });

  it("uses the stored source context hash for Task 2 replay input and item hashes", () => {
    const rule = externalRule(
      'external_cost = cost_items([{ category: "supplier_fee", amount: supplier_fee, memo: "供应商" }])',
      [{ name: "supplier_fee", required: false, missingDataPolicy: { action: "route_item_to_review" } }],
    );
    const initial = executeExternalCostRuleForImport({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatch: importBatch([{ supplierOrganizationId: "supplier-1" }]),
      ruleVersion: rule,
      reason: "Finance confirmed.",
      createdBy: "user-1",
    });
    const storedSourceContextHash = String(
      initial.exceptions[0]?.sourceContextSnapshot.__source_context_hash,
    );

    const replay = buildExternalCostRuleExceptionReplay({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      importBatchId: "import-1",
      importRowIndex: 0,
      createdBy: "user-1",
      exceptions: [
        {
          ...initial.exceptions[0]!,
          id: "exception-1",
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          importBatchId: "import-1",
          status: "resolved",
          resolutionValue: { type: "money_cents", amountCents: 3456 },
        },
      ],
    });

    expect(replay).toMatchObject({
      inputHash: storedSourceContextHash,
      items: [
        expect.objectContaining({
          sourceInputHash: storedSourceContextHash,
          sourcePayload: expect.objectContaining({
            provenance: expect.objectContaining({
              resolutionHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
            }),
          }),
        }),
      ],
    });
  });
});

function importBatch(
  parsedPayload: ProjectCostImportBatchRecord["parsedPayload"],
): ProjectCostImportBatchRecord {
  return {
    id: "import-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    importType: "supplier_bill",
    rowCount: parsedPayload.length,
    parsedPayload,
    status: "parsed",
    createdBy: "user-1",
    createdAt: "2026-07-14T00:00:00.000Z",
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
): CustomSettlementRuleVersion {
  const validation = validateCustomRuleFormula(formula, {
    scope: "external_cost",
    executionGrain: "report",
    compositionMode: "emit_items",
  });
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.code ?? "formula invalid");
  }
  const requiredInputs = (Array.isArray(requirements) ? requirements : []).map(
    (requirement) =>
      typeof requirement === "string"
        ? inputRequirement(requirement, true)
        : inputRequirement(
            requirement.name,
            requirement.required,
            requirement.missingDataPolicy,
          ),
  );
  const stringRequirements = requirements.filter(
    (requirement): requirement is string => typeof requirement === "string",
  );
  return {
    id: "rule-v1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    scope: "external_cost",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "emit_items",
    priority: 0,
    versionNumber: 1,
    status: "active",
    formula,
    compiledAst: validation.compiledAst as unknown as CustomSettlementRuleVersion["compiledAst"],
    variables: [
      ...stringRequirements.map((name) => inputRequirement(name, true)),
      ...requiredInputs,
    ] as unknown as CustomSettlementRuleVersion["variables"],
    parameters: {},
    ruleContract: {
      schemaVersion: 1,
      scope: "external_cost",
      target: { targetType: "project", targetId: null },
      executionGrain: "report",
      compositionMode: "emit_items",
      title: "外部成本规则",
      summary: "外部成本规则",
      calculationComponents: [
        {
          name: "final",
          description: "最终结果",
          expression: "cost_items",
          resultType: { kind: "object", fields: {} },
        },
      ],
      requiredInputs: [],
      parameters: [
        {
          name: "noop",
          description: "占位参数",
          valueType: scalar("integer"),
          userFacingUnit: "count",
          defaultValue: { type: "integer", value: 0 },
        },
      ],
      effectiveStartAt: "2026-07-01T00:00:00+08:00",
      effectiveEndAt: null,
      missingDataPolicy: { action: "block_batch" },
      compositionDescription: "emit cost items",
      businessTimezone: "Asia/Shanghai",
      examples: [
        example("正常一"),
        example("边界一", "boundary"),
        example("边界二", "boundary"),
      ],
    },
    systemExplanationTemplate: "外部成本规则",
    missingDataPolicy: {},
    testCases: [],
    simulationSummary: {
      totalRecords: 1,
      calculatedRecords: 1,
      routedToReviewRecords: 0,
      blockedRecords: 0,
      aggregateAmountCents: "0",
    },
    formulaHash: validation.formulaHash,
    contractHash: "contract-hash",
    parameterHash: "parameter-hash",
    catalogHash: "catalog-hash",
    dataSelectionHash: "data-selection-hash",
    simulationId: null,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: "user-1",
    approvedBy: "user-1",
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
    category: "optional_input",
    valueType: valueTypeFor(name),
    ...(missingDataPolicy ? { missingDataPolicy } : {}),
  };
}

function valueTypeFor(name: string): RuntimeValueType {
  if (name === "order_count" || name === "import_row_index") return scalar("integer");
  if (name === "cps_rate") return scalar("rate_bps");
  if (name.endsWith("_id") || name === "supplier_id" || name === "report_id" || name === "import_type") {
    return scalar("string");
  }
  return scalar("money_cents");
}

function scalar<ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } {
  return { kind: "scalar", scalarType };
}

function example(name: string, kind: "normal" | "boundary" = "normal") {
  return {
    name,
    kind,
    description: "示例说明",
    inputs: {},
    expectedResult: { type: "array", items: [] } satisfies TypedRuntimeValue,
  };
}

function sha256(parts: unknown[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}
