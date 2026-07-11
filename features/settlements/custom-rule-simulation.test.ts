import { describe, expect, it } from "vitest";

import type { BusinessRuleContract } from "./custom-rule-contract";
import type { CustomRuleDataReadinessReport } from "./custom-rule-data-readiness";
import {
  CustomRuleSimulationError,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type CustomRuleSimulationInput,
} from "./custom-rule-simulation";
import type { TypedRuntimeValue } from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";

describe("simulateCustomSettlementRule", () => {
  it("compares authorized history with checked decimal totals and converts legacy yuan exactly once", () => {
    const input = simulationInput();
    input.records = [
      record("private-streamer-b", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "3000",
        },
      }),
      record("private-streamer-a", {
        currentRuleResult: {
          unitSource: "legacy_yuan",
          amountYuan: 10,
        },
      }),
    ];
    input.sampleSelection.populationCount = 2;

    const result = simulateCustomSettlementRule(input);

    expect(result).toMatchObject({
      recordCount: 2,
      coverage: { totalCount: 2, evaluatedCount: 2, rateBps: 10_000 },
      uncoveredCount: 0,
      zeroPayCount: 0,
      reviewRoutedCount: 0,
      blockedCount: 0,
      totalOldCents: "4000",
      totalNewCents: "4000",
      totalDeltaCents: "0",
      marginImpactCents: "0",
      historicalVerification: {
        status: "verified",
        label: "已通过历史数据验证",
      },
      unitSources: ["current_rule_cents", "legacy_yuan"],
      largestIncreases: [
        {
          bucket: "authorized_ordinal:000001",
          deltaAmountCents: "1000",
          direction: "increase",
        },
      ],
      largestDecreases: [
        {
          bucket: "authorized_ordinal:000002",
          deltaAmountCents: "-1000",
          direction: "decrease",
        },
      ],
    });
    expect(result.dataSelectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.persistable.dataSelectionHash).toBe(result.dataSelectionHash);

    const persisted = JSON.stringify(result.persistable);
    expect(persisted).not.toContain("private-streamer-a");
    expect(persisted).not.toContain("private-streamer-b");
    expect(persisted).not.toContain("system_minutes");
    expect(persisted).not.toContain("evidence_level");
  });

  it("uses deterministic tie ordering and selection hashes independent of input record order", () => {
    const first = simulationInput();
    first.records = [
      record("record-b", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1000",
        },
      }),
      record("record-a", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1000",
        },
      }),
    ];
    first.sampleSelection.populationCount = 2;
    const second = structuredClone(first);
    second.records.reverse();

    const firstResult = simulateCustomSettlementRule(first);
    const secondResult = simulateCustomSettlementRule(second);

    expect(firstResult.dataSelectionHash).toBe(secondResult.dataSelectionHash);
    expect(firstResult.largestIncreases).toEqual([
      {
        bucket: "authorized_ordinal:000001",
        deltaAmountCents: "1000",
        direction: "increase",
      },
      {
        bucket: "authorized_ordinal:000002",
        deltaAmountCents: "1000",
        direction: "increase",
      },
    ]);
    expect(secondResult.largestIncreases).toEqual(
      firstResult.largestIncreases,
    );
  });

  it("keeps old and delta totals null and visibly labels projects with no history", () => {
    const input = simulationInput();
    input.records = [];
    input.sampleSelection.populationCount = 0;
    input.readiness = readiness(false);

    const result = simulateCustomSettlementRule(input);

    expect(result).toMatchObject({
      recordCount: 0,
      totalOldCents: null,
      totalNewCents: "0",
      totalDeltaCents: null,
      marginImpactCents: null,
      historicalVerification: {
        status: "unverified",
        label: "未经过历史数据验证",
      },
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_NO_HISTORICAL_COMPARISON" }),
    );
    expect(result.persistable.historicalTotals.payableAmountCents).toBeNull();
  });

  it("runs zero, every configured edge and maximum, every evidence level, every missing policy, and user examples", () => {
    const result = simulateCustomSettlementRule(simulationInput());

    expect(result.scenarios.map((scenario) => scenario.id)).toEqual([
      "synthetic:zero",
      "threshold:sixty_minutes:at",
      "maximum:configured_minutes",
      "evidence:green",
      "evidence:red",
      "evidence:yellow",
      "missing:block_batch:system_minutes",
      "missing:route_item_to_review:system_minutes",
      "missing:use_explicit_default:system_minutes",
      "user:adjustable-standard",
    ]);
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({
        id: "missing:route_item_to_review:system_minutes",
        outcome: "review_routed",
      }),
    );
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({
        id: "missing:block_batch:system_minutes",
        outcome: "blocked",
      }),
    );
    expect(result.persistable.scenarios).toHaveLength(10);
  });

  it("summarizes uncovered, zero-pay, review-routed, margin, risk, and warning counts", () => {
    const input = simulationInput("money_result({ final: yuan(0) })");
    input.records = [
      record("record-zero", {
        variables: {
          system_minutes: { type: "integer", value: 0 },
          evidence_level: { type: "string", value: "red" },
        },
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1000",
        },
      }),
      record("record-review", {
        missingInputs: [
          {
            variableId: "system_minutes",
            policy: { action: "route_item_to_review" },
          },
        ],
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "500",
        },
      }),
    ];
    input.sampleSelection.populationCount = 2;
    input.currentMarginCents = "250";

    const result = simulateCustomSettlementRule(input);

    expect(result).toMatchObject({
      recordCount: 2,
      uncoveredCount: 1,
      zeroPayCount: 1,
      reviewRoutedCount: 1,
      totalOldCents: "1000",
      totalNewCents: "0",
      totalDeltaCents: "-1000",
      marginImpactCents: "1000",
    });
    expect(result.riskFlags.map((flag) => flag.code)).toEqual([
      "CUSTOM_RULE_REVIEW_ROUTED_RECORDS",
      "CUSTOM_RULE_ZERO_PAY_RECORDS",
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_INCOMPLETE_COVERAGE" }),
    );
  });

  it("changes freshness hash for source version, timezone, catalog, formula, contract, or parameters", () => {
    const base = simulationInput();
    const baseHash = simulateCustomSettlementRule(base).dataSelectionHash;

    const sourceChanged = structuredClone(base);
    sourceChanged.records[0].sourceVersion.version = "locked-v2";

    const timezoneChanged = structuredClone(base);
    timezoneChanged.contract.businessTimezone = "Asia/Tokyo";
    timezoneChanged.readiness.businessTimezone = "Asia/Tokyo";
    timezoneChanged.contractHash = hashCustomRuleContract(
      timezoneChanged.contract,
    );

    const catalogChanged = structuredClone(base);
    catalogChanged.catalogVersion = "b".repeat(64);
    catalogChanged.readiness.catalogVersion = "b".repeat(64);

    const formulaChanged = simulationInput(
      "money_result({ final: yuan(21) })",
    );

    const contractChanged = structuredClone(base);
    contractChanged.contract.summary = "按每场直播计算二十一元主播应付金额。";
    contractChanged.contractHash = hashCustomRuleContract(
      contractChanged.contract,
    );

    const parameterChanged = structuredClone(base);
    parameterChanged.parameters.hourly_rate = {
      type: "money_cents",
      amountCents: 12_000,
    };
    parameterChanged.parameterHash = hashCustomRuleParameters(
      parameterChanged.parameters,
    );

    for (const changed of [
      sourceChanged,
      timezoneChanged,
      catalogChanged,
      formulaChanged,
      contractChanged,
      parameterChanged,
    ]) {
      expect(simulateCustomSettlementRule(changed).dataSelectionHash).not.toBe(
        baseHash,
      );
    }
  });

  it("fails closed on duplicates, cross-project rows, mutable versions, malformed inputs, and bounds", () => {
    const duplicate = simulationInput();
    duplicate.records = [record("same"), record("same")];
    duplicate.sampleSelection.populationCount = 2;

    const crossProject = simulationInput();
    crossProject.records[0].projectId = "project-other";

    const mutableVersion = simulationInput();
    mutableVersion.records[0].sourceVersion = {
      kind: "mutable",
      source: "live_report",
      version: "latest",
    } as never;

    const overflow = simulationInput();
    overflow.records = [
      record("overflow-a", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "9223372036854775807",
        },
      }),
      record("overflow-b", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1",
        },
      }),
    ];
    overflow.sampleSelection.populationCount = 2;

    const overLimit = simulationInput();
    overLimit.records = Array.from({ length: 501 }, (_, index) =>
      record(`record-${index}`),
    );
    overLimit.sampleSelection.populationCount = 501;

    const missingScenarioClass = simulationInput();
    missingScenarioClass.synthetic.evidenceLevels = [];

    const accessor = simulationInput();
    Object.defineProperty(accessor.records[0], "variables", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });

    const proxied = simulationInput();
    proxied.records[0] = new Proxy(proxied.records[0], {});

    for (const invalid of [
      duplicate,
      crossProject,
      mutableVersion,
      overflow,
      overLimit,
      missingScenarioClass,
      accessor,
      proxied,
    ]) {
      expect(() => simulateCustomSettlementRule(invalid)).toThrow(
        CustomRuleSimulationError,
      );
    }
  });

  it("fails closed when an injected engine returns malformed output", () => {
    expect(() =>
      simulateCustomSettlementRule(simulationInput(), {
        execute: () => ({
          result: {
            kind: "money_result",
            componentsCents: { final: "2000" },
          },
          trace: [],
        }),
        explain: () => "不应执行到这里",
      }),
    ).toThrow(CustomRuleSimulationError);
  });
});

function simulationInput(
  formula = "money_result({ final: yuan(20) })",
): CustomRuleSimulationInput {
  const validated = validateCustomRuleFormula(formula, {
    scope: "payable",
    executionGrain: "report",
    parameters: [
      {
        name: "hourly_rate",
        valueType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
  });
  if (!validated.ok) throw new Error("test formula must compile");
  const businessContract = contract();
  const parameters = {
    hourly_rate: {
      type: "money_cents" as const,
      amountCents: 10_000,
    },
  };

  return {
    projectId: "project-1",
    contract: businessContract,
    compiledAst: validated.compiledAst,
    parameters,
    formulaHash: validated.formulaHash,
    contractHash: hashCustomRuleContract(businessContract),
    parameterHash: hashCustomRuleParameters(parameters),
    catalogVersion: "a".repeat(64),
    readiness: readiness(true),
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      populationCount: 1,
      criteria: ["locked settlement comparison"],
    },
    records: [record("record-1")],
    synthetic: {
      zero: {
        variables: variables(0, "green"),
      },
      thresholdEdges: [
        {
          thresholdId: "sixty_minutes",
          edge: "at",
          variables: variables(60, "green"),
        },
      ],
      configuredMaximums: [
        {
          maximumId: "configured_minutes",
          variables: variables(600, "green"),
        },
      ],
      evidenceLevels: [
        { level: "yellow", variables: variables(60, "yellow") },
        { level: "green", variables: variables(60, "green") },
        { level: "red", variables: variables(60, "red") },
      ],
      missingDataPolicies: [
        {
          variableId: "system_minutes",
          policy: { action: "route_item_to_review" },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
        {
          variableId: "system_minutes",
          policy: { action: "block_batch" },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
        {
          variableId: "system_minutes",
          policy: {
            action: "use_explicit_default",
            defaultValue: { type: "integer", value: 0 },
          },
          variables: { evidence_level: { type: "string", value: "green" } },
        },
      ],
    },
    userExamples: [
      {
        id: "adjustable-standard",
        variables: variables(90, "green"),
      },
    ],
    currentMarginCents: "5000",
  };
}

function record(
  recordId: string,
  overrides: Partial<CustomRuleSimulationInput["records"][number]> = {},
): CustomRuleSimulationInput["records"][number] {
  return {
    recordId,
    projectId: "project-1",
    sourceVersion: {
      kind: "immutable",
      source: "locked_settlement_item",
      version: "locked-v1",
    },
    variables: variables(60, "green"),
    missingInputs: [],
    currentRuleResult: {
      unitSource: "current_rule_cents",
      amountCents: "1000",
    },
    ...overrides,
  };
}

function variables(
  minutes: number,
  evidenceLevel: string,
): Record<string, TypedRuntimeValue> {
  return {
    system_minutes: { type: "integer", value: minutes },
    evidence_level: { type: "string", value: evidenceLevel },
  };
}

function readiness(hasHistory: boolean): CustomRuleDataReadinessReport {
  return {
    catalogVersion: "a".repeat(64),
    readinessHash: "b".repeat(64),
    businessTimezone: "Asia/Shanghai",
    businessTimezoneConfirmed: true,
    businessTimezoneSource: "confirmed_contract",
    historicalVerification: hasHistory ? "verified" : "unverified",
    readyForSimulation: true,
    readyForActivation: hasHistory,
    inputs: [
      {
        variableId: "system_minutes",
        required: true,
        status: "available",
        ready: true,
        coverageNumerator: hasHistory ? 1 : 0,
        coverageDenominator: hasHistory ? 1 : 0,
        code: hasHistory
          ? "CUSTOM_RULE_INPUT_AVAILABLE"
          : "CUSTOM_RULE_INPUT_SCHEMA_READY_NO_HISTORY",
        reasonZh: hasHistory ? "历史数据完整。" : "结构可用但暂无历史数据。",
      },
    ],
    warnings: hasHistory
      ? []
      : [
          {
            code: "CUSTOM_RULE_PROJECT_NO_HISTORY",
            reasonZh: "项目暂无历史数据，只能使用结构校验、合成边界和用户示例试算。",
          },
        ],
  };
}

function contract(): BusinessRuleContract {
  return {
    schemaVersion: 1,
    scope: "payable",
    target: { targetType: "project", targetId: null },
    executionGrain: "report",
    compositionMode: "replace",
    title: "项目主播按场计费",
    summary: "按每场直播计算二十元主播应付金额。",
    calculationComponents: [
      {
        name: "final",
        description: "计算最终应付金额",
        expression: "每场固定二十元",
        resultType: { kind: "scalar", scalarType: "money_cents" },
      },
    ],
    requiredInputs: [
      {
        name: "system_minutes",
        description: "系统直播时长",
        source: "直播报告系统计时",
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "分钟",
      },
    ],
    parameters: [
      {
        name: "hourly_rate",
        description: "每小时结算单价",
        valueType: { kind: "scalar", scalarType: "money_cents" },
        userFacingUnit: "元/小时",
        defaultValue: { type: "money_cents", amountCents: 10_000 },
      },
    ],
    effectiveStartAt: "2026-07-12T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目级基础应付规则。",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准场景",
        kind: "normal",
        description: "标准直播场景返回二十元。",
        inputs: { system_minutes: { type: "integer", value: 60 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "零时长",
        kind: "boundary",
        description: "零时长边界仍按已确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 0 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
      {
        name: "最大时长",
        kind: "boundary",
        description: "最大配置时长仍按已确认规则计算。",
        inputs: { system_minutes: { type: "integer", value: 600 } },
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
  };
}
