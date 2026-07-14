import { describe, expect, it, vi } from "vitest";

import {
  createCustomRuleExecutionCapability,
  createProductionCustomSettlementExecutionPort,
} from "./custom-rule-service";
import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import type { SettlementPoolReport } from "./settlement-service";

const report: SettlementPoolReport = {
  id: "report-1",
  organizationId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  streamerId: "00000000-0000-4000-8000-000000000003",
  liveTaskId: "00000000-0000-4000-8000-000000000004",
  status: "approved",
  settlementDuration: 60,
  timeSource: "system",
  evidenceLevel: "green",
  settledBatchItemId: null,
  createdAt: "2026-07-12T00:00:00.000Z",
  projectStreamerId: "00000000-0000-4000-8000-000000000005",
  settlementGroups: [
    {
      id: "00000000-0000-4000-8000-000000000006",
      name: "Gold",
      assignmentId: "00000000-0000-4000-8000-000000000007",
    },
  ],
};

describe("custom settlement production execution", () => {
  it("uses the same exact server flag shape as approval capability", () => {
    expect(
      createCustomRuleExecutionCapability({
        CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED: "true",
      }),
    ).toEqual({ enabled: true });
    expect(
      createCustomRuleExecutionCapability({
        CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED: "TRUE",
      }),
    ).toEqual({ enabled: false });
    expect(createCustomRuleExecutionCapability({})).toEqual({
      enabled: false,
    });
  });

  it("returns no_custom_layers when production lookup finds no active layer", async () => {
    const repository = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: null,
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };
    const port = createProductionCustomSettlementExecutionPort({
      repository,
      executionCapability: { enabled: true },
    });

    await expect(
      port.resolveAndExecute({
        organizationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        reports: [report],
      }),
    ).resolves.toBe("no_custom_layers");

    expect(repository.resolveExecutableCustomRuleLayers).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        scope: "payable",
      }),
    );
  });

  it("blocks disabled generation when an effective custom rule already exists", async () => {
    const repository = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: { id: "rule-version-1" },
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };
    const port = createProductionCustomSettlementExecutionPort({
      repository: repository as never,
      executionCapability: { enabled: false },
    });

    await expect(
      port.resolveAndExecute({
        organizationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        batchType: "payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        reports: [report],
      }),
    ).rejects.toMatchObject({
      message: "Production custom settlement rule execution is disabled",
    });
  });

  it("applies group modifiers over the legacy fixed base using membership snapshots and real AST hashes", async () => {
    const repository = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: null,
        groupVersions: [
          {
            groupId: "00000000-0000-4000-8000-000000000006",
            version: customRuleVersion({
              id: "00000000-0000-4000-8000-000000000106",
              target: {
                targetType: "streamer_group",
                targetId: "00000000-0000-4000-8000-000000000006",
              },
              compositionMode: "add",
              formula: "money_result({ final: yuan(5) })",
            }),
          },
        ],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {
          "report:00000000-0000-4000-8000-000000000002:report-1": [
            {
              unitKey:
                "report:00000000-0000-4000-8000-000000000002:report-1",
              projectStreamerId: "00000000-0000-4000-8000-000000000005",
              groupId: "00000000-0000-4000-8000-000000000006",
              assignmentId: "00000000-0000-4000-8000-000000000007",
              effectiveFrom: "2026-07-01T00:00:00.000Z",
              effectiveUntil: null,
            },
          ],
        },
      })),
    };
    const port = createProductionCustomSettlementExecutionPort({
      repository,
      executionCapability: { enabled: true },
    });

    const result = await port.resolveAndExecute({
      organizationId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      batchType: "payable",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      reports: [report],
      legacyComputedAmountCentsByReportId: { "report-1": 1000 },
    });

    expect(result).not.toBe("no_custom_layers");
    if (result === "no_custom_layers") return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        computedAmountCents: 1500,
        sourceReportIds: ["report-1"],
      }),
    );
    expect(result.items[0]?.evidenceSnapshot.ruleEngine).toEqual(
      expect.objectContaining({
        membershipAssignmentIds: [
          "00000000-0000-4000-8000-000000000007",
        ],
        namedOutputsCents: expect.objectContaining({
          "fixed-base:money_result": 1000,
          "00000000-0000-4000-8000-000000000106:money_result": 500,
        }),
      }),
    );
    expect(repository.resolveExecutableCustomRuleLayers).toHaveBeenCalledWith(
      expect.objectContaining({
        executionUnits: [
          expect.objectContaining({
            membershipSnapshot: expect.objectContaining({
              groups: [
                {
                  id: "00000000-0000-4000-8000-000000000006",
                  name: "Gold",
                  assignmentId: "00000000-0000-4000-8000-000000000007",
                },
              ],
            }),
          }),
        ],
      }),
    );
  });

  it("creates one aggregate item for project-period rules", async () => {
    const repository = {
      resolveExecutableCustomRuleLayers: vi.fn(async () => ({
        projectBaseVersion: customRuleVersion({
          executionGrain: "project_period",
          formula: "money_result({ final: yuan(7) })",
        }),
        groupVersions: [],
        projectStreamerVersions: [],
        assignmentsByUnitKey: {},
      })),
    };
    const port = createProductionCustomSettlementExecutionPort({
      repository,
      executionCapability: { enabled: true },
    });

    const result = await port.resolveAndExecute({
      organizationId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      batchType: "payable",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      reports: [report, { ...report, id: "report-2" }],
      legacyComputedAmountCentsByReportId: { "report-1": 1000, "report-2": 2000 },
    });

    expect(result).not.toBe("no_custom_layers");
    if (result === "no_custom_layers") return;
    expect(result.items).toEqual([
      expect.objectContaining({
        computedAmountCents: 700,
        sourceReportIds: ["report-1", "report-2"],
      }),
    ]);
    expect(repository.resolveExecutableCustomRuleLayers).toHaveBeenCalledTimes(2);
  });
});

function customRuleVersion(input: {
  id?: string;
  target?: { targetType: "project"; targetId: null } | {
    targetType: "streamer_group" | "project_streamer";
    targetId: string;
  };
  executionGrain?: "report" | "project_streamer_period" | "batch" | "project_period";
  compositionMode?: "replace" | "add" | "multiply" | "clamp";
  formula?: string;
}): CustomSettlementRuleVersion {
  const formula = input.formula ?? "money_result({ final: yuan(1) })";
  const executionGrain = input.executionGrain ?? "report";
  const compositionMode = input.compositionMode ?? "replace";
  const compiled = validateCustomRuleFormula(formula, {
    scope: "payable",
    executionGrain,
    compositionMode,
  });
  if (!compiled.ok) {
    throw new Error("test formula should compile");
  }
  return {
    id: input.id ?? "00000000-0000-4000-8000-000000000100",
    organizationId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    scope: "payable",
    target: input.target ?? { targetType: "project", targetId: null },
    priority: 10,
    versionNumber: 1,
    status: "active",
    executionGrain,
    compositionMode,
    formula,
    formulaHash: "f".repeat(64),
    contractHash: "c".repeat(64),
    compiledAst:
      compiled.compiledAst as unknown as CustomSettlementRuleVersion["compiledAst"],
    variables: [],
    ruleContract: {
      schemaVersion: 1,
      scope: "payable",
      target: input.target ?? { targetType: "project", targetId: null },
      executionGrain,
      compositionMode,
      title: "测试结算规则",
      summary: "用于生产执行测试。",
      calculationComponents: [
        {
          name: "final",
          description: "最终金额",
          expression: "final",
          resultType: { kind: "scalar", scalarType: "money_cents" },
        },
      ],
      businessTimezone: "Asia/Shanghai",
      requiredInputs: [],
      parameters: [],
      effectiveStartAt: "2026-07-01T00:00:00.000+00:00",
      effectiveEndAt: null,
      missingDataPolicy: { action: "block_batch" },
      compositionDescription: "替换或叠加金额。",
      examples: [],
    } as CustomSettlementRuleVersion["ruleContract"],
    systemExplanationTemplate: "按自定义规则计算。",
    missingDataPolicy: { action: "block_batch" },
    testCases: [],
    simulationSummary: {},
    parameters: {},
    parameterHash: "p".repeat(64),
    catalogHash: "v".repeat(64),
    dataSelectionHash: "d".repeat(64),
    simulationId: null,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: "00000000-0000-4000-8000-000000000001",
    approvedBy: "00000000-0000-4000-8000-000000000001",
    aiDraftId: null,
    reason: "Approved for production test",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  };
}
