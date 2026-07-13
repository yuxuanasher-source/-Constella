import { describe, expect, it } from "vitest";

import type { BusinessRuleContract } from "./custom-rule-contract";
import {
  calculateCustomRuleOptionalPolicyHash,
  type CustomRuleDataReadinessReport,
  type CustomRuleInputRequirement,
} from "./custom-rule-data-readiness";
import {
  CustomRuleSimulationError,
  calculateCustomRuleEvidenceHash,
  hashCustomRuleContract,
  hashCustomRuleParameters,
  simulateCustomSettlementRule,
  type CustomRuleSimulationInput,
  type CustomRuleSimulationRuntime,
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

    const result = simulateAuthorized(input);

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

  it("preserves group population readiness metadata in persisted sample selection", () => {
    const input = simulationInput();
    input.sampleSelection = {
      ...input.sampleSelection,
      groupPopulation: {
        assignedProjectStreamerIds: [
          "11111111-1111-4111-8111-111111111111",
        ],
        unassignedProjectStreamerIds: [
          "22222222-2222-4222-8222-222222222222",
        ],
        groupSnapshotHash: "f".repeat(64),
      },
    } as typeof input.sampleSelection;

    const result = simulateAuthorized(input);

    expect(result.persistable.sampleSelection).toMatchObject({
      groupPopulation: {
        assignedProjectStreamerIds: [
          "11111111-1111-4111-8111-111111111111",
        ],
        unassignedProjectStreamerIds: [
          "22222222-2222-4222-8222-222222222222",
        ],
        groupSnapshotHash: "f".repeat(64),
      },
    });
  });

  it("decouples group population metadata limits from selected simulation records", () => {
    const assignedProjectStreamerIds = Array.from({ length: 600 }, (_, index) =>
      projectStreamerUuid(index + 1),
    );
    const unassignedProjectStreamerIds = Array.from(
      { length: 600 },
      (_, index) => projectStreamerUuid(index + 1_001),
    );
    const first = simulationInput();
    first.sampleSelection = {
      ...first.sampleSelection,
      groupPopulation: {
        assignedProjectStreamerIds: [...assignedProjectStreamerIds].reverse(),
        unassignedProjectStreamerIds: [
          ...unassignedProjectStreamerIds,
        ].reverse(),
        groupSnapshotHash: "f".repeat(64),
      },
    };
    const second = structuredClone(first);
    second.sampleSelection.groupPopulation = {
      assignedProjectStreamerIds,
      unassignedProjectStreamerIds,
      groupSnapshotHash: "f".repeat(64),
    };

    const firstResult = simulateAuthorized(first);
    const secondResult = simulateAuthorized(second);

    expect(first.records).toHaveLength(1);
    expect(firstResult.dataSelectionHash).toBe(secondResult.dataSelectionHash);
    expect(
      firstResult.persistable.sampleSelection.groupPopulation
        ?.assignedProjectStreamerIds,
    ).toEqual(assignedProjectStreamerIds);
    expect(
      firstResult.persistable.sampleSelection.groupPopulation
        ?.unassignedProjectStreamerIds,
    ).toEqual(unassignedProjectStreamerIds);
  });

  it("rejects unknown nested fields inside group population metadata", () => {
    const input = simulationInput();
    input.sampleSelection = {
      ...input.sampleSelection,
      groupPopulation: {
        assignedProjectStreamerIds: [
          "11111111-1111-4111-8111-111111111111",
        ],
        unassignedProjectStreamerIds: [
          "22222222-2222-4222-8222-222222222222",
        ],
        groupSnapshotHash: "f".repeat(64),
        privateStreamerAmounts: [],
      },
    } as typeof input.sampleSelection;

    expect(() => simulateAuthorized(input)).toThrow(
      CustomRuleSimulationError,
    );
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

    const firstResult = simulateAuthorized(first);
    const secondResult = simulateAuthorized(second);

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

    const result = simulateAuthorized(input);

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
    expect(result.persistable).toMatchObject({
      coverage: {
        summarySchemaVersion: 2,
        totalRecords: 0,
        evaluatedRecords: 0,
        skippedRecords: 0,
        uncoveredRecords: 0,
        zeroAmountRecords: 0,
        reviewRoutedRecords: 0,
        blockedRecords: 0,
      },
      historicalTotals: {
        oldPayableAmountCents: null,
        oldReceivableAmountCents: null,
        newPayableAmountCents: "0",
        newReceivableAmountCents: null,
        recordCount: 0,
        verificationStatus: "unverified",
      },
      deltas: {
        payableAmountCents: null,
        receivableAmountCents: null,
        percentageBps: null,
        marginImpactCents: null,
      },
    });
  });

  it("forces an empty authorized population to unverified even when readiness claims verified history", () => {
    const input = simulationInput();
    input.records = [];
    input.sampleSelection.populationCount = 0;
    input.readiness = readiness(true);

    const result = simulateAuthorized(input);

    expect(result.historicalVerification.status).toBe("unverified");
    expect(result.totalOldCents).toBeNull();
    expect(result.totalDeltaCents).toBeNull();
    expect(result.marginImpactCents).toBeNull();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_NO_HISTORICAL_COMPARISON" }),
    );
  });

  it("forces synthetic sample sources to unverified regardless of readiness and records", () => {
    const input = simulationInput();
    input.sampleSource = { kind: "synthetic_scenarios" };
    input.readiness = readiness(true);

    const result = simulateAuthorized(input);

    expect(result.historicalVerification).toEqual({
      status: "unverified",
      label: "未经过历史数据验证",
    });
    expect(result.totalOldCents).toBeNull();
    expect(result.totalDeltaCents).toBeNull();
    expect(result.marginImpactCents).toBeNull();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_NO_HISTORICAL_COMPARISON" }),
    );
  });

  it("runs derived zero and missing policies plus contract, AI, and user assertions", () => {
    const result = simulateAuthorized(simulationInput());

    expect(result.scenarios.map((scenario) => scenario.id)).toEqual([
      "synthetic:zero",
      "derived:missing:block_batch",
      "derived:missing:route_item_to_review",
      "derived:missing:use_explicit_default",
      "contract:000001",
      "contract:000002",
      "contract:000003",
      "ai:000001",
      expect.stringMatching(/^user:[a-f0-9]{16}$/),
    ]);
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({
        id: "derived:missing:route_item_to_review",
        outcome: "review_routed",
      }),
    );
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({
        id: "derived:missing:block_batch",
        outcome: "blocked",
      }),
    );
    expect(result.persistable.scenarios).toHaveLength(9);
  });

  it("derives tier, clamp, evidence, missing-policy, and zero scenarios instead of trusting caller kinds", () => {
    const formula = `money_result({ final: clamp(
      percent(
        tiered(system_minutes, [
          { upto: 60, rate_per_hour: yuan(10) },
          { upto: null, rate_per_hour: yuan(20) }
        ]),
        evidence_multiplier(evidence_level, {
          green: rate_percent(100),
          yellow: rate_percent(70),
          red: rate_percent(0)
        })
      ),
      yuan(0),
      yuan(30)
    ) })`;
    const input = simulationInput(formula);
    expect(input).not.toHaveProperty("synthetic");
    input.userExamples = [
      {
        id: "adjustable-standard",
        inputs: variables(90, "green"),
        expectedResult: { type: "money_cents", amountCents: 20_000 },
      },
    ];
    input.aiTestCases = [
      {
        name: "ai-standard",
        inputs: variables(60, "green"),
        expectedResult: { type: "money_cents", amountCents: 10_000 },
      },
    ];

    const result = simulateAuthorized(input);
    const ids = result.scenarios.map((scenario) => scenario.id);

    expect(ids).toContain("synthetic:zero");
    expect(ids.filter((id) => id.includes(":tier:") && id.endsWith(":below"))).toHaveLength(1);
    expect(ids.filter((id) => id.includes(":tier:") && id.endsWith(":at"))).toHaveLength(1);
    expect(ids.filter((id) => id.includes(":tier:") && id.endsWith(":above"))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith("derived:clamp:"))).toHaveLength(0);
    expect(ids.filter((id) => id.startsWith("derived:evidence:"))).toHaveLength(3);
    expect(ids.filter((id) => id.startsWith("derived:missing:"))).toHaveLength(3);
    expect(ids).toContain("contract:000001");
    expect(ids).toContain("ai:000001");
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({ category: "user_example" }),
    );
    expect(result.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "UNTESTABLE_CLAMP_BOUNDARY",
        severity: "block",
      }),
    );
  });

  it("drives an adjustable clamp parameter through real floor and cap trace branches", () => {
    const result = simulateAuthorized(parameterClampInput());
    const clampScenarios = result.scenarios.filter((scenario) =>
      scenario.id.startsWith("derived:clamp:"),
    );

    expect(clampScenarios).toEqual([
      expect.objectContaining({
        id: "derived:clamp:000001:floor",
        amountCents: "0",
        expectedAmountCents: "0",
        passed: true,
      }),
      expect.objectContaining({
        id: "derived:clamp:000001:cap",
        amountCents: "3000",
        expectedAmountCents: "3000",
        passed: true,
      }),
    ]);
    expect(result.riskFlags.map((flag) => flag.code)).not.toContain(
      "UNTESTABLE_CLAMP_BOUNDARY",
    );
    expect(result.riskFlags.map((flag) => flag.code)).not.toContain(
      "CUSTOM_RULE_SCENARIO_EXPECTATION_MISMATCH",
    );
  });

  it("blocks an unadjustable constant clamp instead of reporting fake passed boundaries", () => {
    const input = simulationInput(
      "money_result({ final: clamp(yuan(10), yuan(0), yuan(30)) })",
    );
    for (const example of input.contract.examples) {
      example.expectedResult = { type: "money_cents", amountCents: 1_000 };
    }
    input.contractHash = hashCustomRuleContract(input.contract);
    input.aiTestCases[0].expectedResult = {
      type: "money_cents",
      amountCents: 1_000,
    };
    input.userExamples[0].expectedResult = {
      type: "money_cents",
      amountCents: 1_000,
    };

    const result = simulateAuthorized(input);

    expect(
      result.scenarios.filter((scenario) =>
        scenario.id.startsWith("derived:clamp:"),
      ),
    ).toEqual([]);
    expect(result.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "UNTESTABLE_CLAMP_BOUNDARY",
        severity: "block",
      }),
    );
  });

  it("accepts an unadjustable clamp only when contract and user scenarios cover both trace branches", () => {
    const input = simulationInput(`money_result({ final: clamp(
      if(system_minutes == 0, yuan(-1), yuan(31)),
      yuan(0),
      yuan(30)
    ) })`);
    for (const example of input.contract.examples) {
      const minutes = example.inputs.system_minutes;
      example.expectedResult = {
        type: "money_cents",
        amountCents:
          minutes?.type === "integer" && minutes.value === 0 ? 0 : 3_000,
      };
    }
    input.contractHash = hashCustomRuleContract(input.contract);
    input.aiTestCases[0].expectedResult = {
      type: "money_cents",
      amountCents: 3_000,
    };
    input.userExamples[0].expectedResult = {
      type: "money_cents",
      amountCents: 3_000,
    };

    const result = simulateAuthorized(input);

    expect(
      result.scenarios.filter((scenario) =>
        scenario.id.startsWith("derived:clamp:"),
      ),
    ).toEqual([]);
    expect(result.riskFlags.map((flag) => flag.code)).not.toContain(
      "UNTESTABLE_CLAMP_BOUNDARY",
    );
    expect(result.riskFlags.map((flag) => flag.code)).not.toContain(
      "CUSTOM_RULE_SCENARIO_EXPECTATION_MISMATCH",
    );
  });

  it("executes expected results and emits a blocking risk when an AI or user assertion mismatches", () => {
    const input = simulationInput();
    expect(input).not.toHaveProperty("synthetic");
    input.aiTestCases = [
      {
        name: "wrong-ai-claim",
        inputs: variables(60, "green"),
        expectedResult: { type: "money_cents", amountCents: 99_999 },
      },
    ];
    input.userExamples = [
      {
        id: "wrong-user-claim",
        inputs: variables(60, "green"),
        expectedResult: { type: "money_cents", amountCents: 1 },
      },
    ];

    const result = simulateAuthorized(input);

    expect(result.scenarios).toContainEqual(
      expect.objectContaining({ category: "ai_test_case", passed: false }),
    );
    expect(result.scenarios).toContainEqual(
      expect.objectContaining({ category: "user_example", passed: false }),
    );
    expect(result.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM_RULE_SCENARIO_EXPECTATION_MISMATCH",
        severity: "block",
      }),
    );
  });

  it("rejects free-form selection criteria that could smuggle identifiers or amounts", () => {
    const input = simulationInput();
    const unsafe = {
      ...input,
      sampleSelection: {
        ...input.sampleSelection,
        criteria: ["streamerId=private-streamer-1 amountCents=10000"],
      },
    };

    expect(() =>
      Reflect.apply(simulateCustomSettlementRule, undefined, [unsafe]),
    ).toThrow(
      CustomRuleSimulationError,
    );
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

    const result = simulateAuthorized(input);

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
      "CUSTOM_RULE_SCENARIO_EXPECTATION_MISMATCH",
      "CUSTOM_RULE_ZERO_PAY_RECORDS",
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CUSTOM_RULE_INCOMPLETE_COVERAGE" }),
    );
  });

  it("blocks the entire batch without retaining partial totals when any record uses block_batch", () => {
    const input = simulationInput();
    input.records = [
      record("record-a-calculable", {
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "1000",
        },
      }),
      record("record-z-blocked", {
        missingInputs: [
          {
            variableId: "base_hourly_rate",
            policy: { action: "block_batch" },
          },
        ],
        currentRuleResult: {
          unitSource: "current_rule_cents",
          amountCents: "500",
        },
      }),
    ];
    input.sampleSelection.populationCount = 2;

    const result = simulateAuthorized(input);

    expect(result).toMatchObject({
      recordCount: 2,
      coverage: { totalCount: 2, evaluatedCount: 0, rateBps: 0 },
      uncoveredCount: 1,
      zeroPayCount: 0,
      reviewRoutedCount: 0,
      blockedCount: 2,
      largestIncreases: [],
      largestDecreases: [],
      totalOldCents: null,
      totalNewCents: "0",
      totalDeltaCents: null,
      marginImpactCents: null,
      historicalVerification: { status: "unverified" },
      unitSources: [],
    });
    expect(result.riskFlags).toContainEqual(
      expect.objectContaining({
        code: "CUSTOM_RULE_BLOCKED_RECORDS",
        severity: "block",
      }),
    );
    expect(result.persistable).toMatchObject({
      coverage: {
        totalRecords: 2,
        evaluatedRecords: 0,
        skippedRecords: 2,
        blockedRecords: 2,
      },
      historicalTotals: {
        oldPayableAmountCents: null,
        newPayableAmountCents: "0",
        verificationStatus: "unverified",
      },
      deltas: {
        payableAmountCents: null,
        percentageBps: null,
        marginImpactCents: null,
      },
      largestChanges: [],
    });
  });

  it("changes freshness hash for source version, timezone, catalog, formula, contract, or parameters", () => {
    const base = simulationInput();
    const baseHash = simulateAuthorized(base).dataSelectionHash;

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
      expect(simulateAuthorized(changed).dataSelectionHash).not.toBe(
        baseHash,
      );
    }
  });

  it("chains every result-affecting evidence field into evidence and final selection hashes", () => {
    const highMargin = simulationInput();
    highMargin.currentMarginCents = "2000";
    const lowMargin = simulationInput();
    lowMargin.currentMarginCents = "500";

    const highResult = simulateAuthorized(highMargin);
    const lowResult = simulateAuthorized(lowMargin);

    expect(highMargin.provenance.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(lowMargin.provenance.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(highMargin.provenance.evidenceHash).not.toBe(
      lowMargin.provenance.evidenceHash,
    );
    expect(highResult.dataSelectionHash).not.toBe(
      lowResult.dataSelectionHash,
    );
  });

  it("binds record missing-input policies into evidence and final selection hashes", () => {
    const routeToReview = simulationInput();
    routeToReview.records[0].missingInputs = [
      {
        variableId: "base_hourly_rate",
        policy: { action: "route_item_to_review" },
      },
    ];
    const blockBatch = structuredClone(routeToReview);
    blockBatch.records[0].missingInputs[0].policy = {
      action: "block_batch",
    };
    const routeResult = simulateAuthorized(routeToReview);
    const blockResult = simulateAuthorized(blockBatch);

    expect(routeToReview.provenance.evidenceHash).not.toBe(
      blockBatch.provenance.evidenceHash,
    );
    expect(routeResult.dataSelectionHash).not.toBe(
      blockResult.dataSelectionHash,
    );
  });

  it("changes evidence and selection freshness for declared policies even when every record has a value", () => {
    const requirements = (
      policy: CustomRuleInputRequirement & { required: false },
    ) => [policy];
    const routeRequirements = requirements({
      variableId: "base_hourly_rate",
      required: false,
      missingDataPolicy: { action: "route_item_to_review" },
    });
    const blockRequirements = requirements({
      variableId: "base_hourly_rate",
      required: false,
      missingDataPolicy: { action: "block_batch" },
    });
    const defaultRequirements = requirements({
      variableId: "base_hourly_rate",
      required: false,
      missingDataPolicy: {
        action: "use_explicit_default",
        defaultValue: { type: "money_cents", amountCents: 0 },
      },
    });
    const run = (declared: CustomRuleInputRequirement[]) => {
      const input = simulationInput();
      input.records[0].variables.base_hourly_rate = {
        type: "money_cents",
        amountCents: 10_000,
      };
      input.provenance.optionalPolicyHash =
        calculateCustomRuleOptionalPolicyHash(declared);
      return { input, result: simulateAuthorized(input) };
    };

    const route = run(routeRequirements);
    const block = run(blockRequirements);
    const explicitDefault = run(defaultRequirements);

    expect(route.input.records[0].missingInputs).toEqual([]);
    expect(block.input.records[0].missingInputs).toEqual([]);
    expect(explicitDefault.input.records[0].missingInputs).toEqual([]);
    expect(
      new Set([
        route.input.provenance.evidenceHash,
        block.input.provenance.evidenceHash,
        explicitDefault.input.provenance.evidenceHash,
      ]),
    ).toHaveLength(3);
    expect(
      new Set([
        route.result.dataSelectionHash,
        block.result.dataSelectionHash,
        explicitDefault.result.dataSelectionHash,
      ]),
    ).toHaveLength(3);
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
      accessor,
      proxied,
    ]) {
      expect(() => simulateAuthorized(invalid)).toThrow(
        CustomRuleSimulationError,
      );
    }
  });

  it("fails closed when an injected engine returns malformed output", () => {
    expect(() =>
      simulateAuthorized(simulationInput(), {
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

  it("rejects negative historical, scenario, and calculated settlement amounts", () => {
    const negativeHistory = simulationInput();
    negativeHistory.records[0] = record("private-streamer-a", {
      currentRuleResult: {
        unitSource: "current_rule_cents",
        amountCents: "-1",
      },
    });
    expect(() => simulateAuthorized(negativeHistory)).toThrow(
      CustomRuleSimulationError,
    );

    const negativeExpected = simulationInput();
    negativeExpected.userExamples[0] = {
      ...negativeExpected.userExamples[0],
      expectedResult: { type: "money_cents", amountCents: -1 },
    };
    expect(() => simulateAuthorized(negativeExpected)).toThrow(
      CustomRuleSimulationError,
    );

    expect(() =>
      simulateAuthorized(simulationInput(), {
        execute: () => ({
          result: {
            kind: "money_result",
            componentsCents: { final: -1 },
          },
          trace: [],
        }),
        explain: () => "负结算金额不允许持久化。",
      }),
    ).toThrow(CustomRuleSimulationError);
  });

  it.each([
    ["external_cost", "emit_items"],
    ["reconciliation", "check"],
  ] as const)(
    "summarizes %s typed-output simulations without old money-scope gates",
    (scope, compositionMode) => {
      const result = simulateAuthorized(
        typedOutputSimulationInput(scope, compositionMode),
      );

      expect(result.coverage).toMatchObject({
        totalCount: 1,
        evaluatedCount: 1,
      });
      expect(result.totalOldCents).toBeNull();
      expect(result.totalDeltaCents).toBeNull();
      expect(result.marginImpactCents).toBeNull();
      expect(result.historicalVerification.status).toBe("unverified");
      expect(result.persistable.historicalTotals).toMatchObject({
        oldPayableAmountCents: null,
        oldReceivableAmountCents: null,
        newPayableAmountCents: null,
        newReceivableAmountCents: null,
        verificationStatus: "unverified",
      });
      expect(result.persistable.coverage).toMatchObject({
        outputKind: scope === "external_cost" ? "cost_items" : "checks",
      });
      expect(result.persistable.deltas).toMatchObject({
        payableAmountCents: null,
        receivableAmountCents: null,
        percentageBps: null,
        marginImpactCents: null,
      });
    },
  );
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
    organizationId: "organization-1",
    actorId: "actor-1",
    projectId: "project-1",
    contract: businessContract,
    compiledAst: validated.compiledAst,
    parameters,
    formulaHash: validated.formulaHash,
    contractHash: hashCustomRuleContract(businessContract),
    parameterHash: hashCustomRuleParameters(parameters),
    catalogVersion: "a".repeat(64),
    readiness: readiness(true),
    provenance: {
      organizationId: "organization-1",
      projectId: "project-1",
      actorId: "actor-1",
      selectionToken: "selection-token-0001",
      evidenceHash: "0".repeat(64),
      optionalPolicyHash: calculateCustomRuleOptionalPolicyHash([]),
      immutableSourceVersions: [
        {
          kind: "immutable",
          source: "locked_settlement_item",
          version: "locked-v1",
        },
      ],
    },
    sampleSource: { kind: "historical_settlements" },
    sampleSelection: {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-10",
      populationCount: 1,
      criteria: ["approved_reports", "period_overlap", "project_scope"],
    },
    records: [record("record-1")],
    userExamples: [
      {
        id: "adjustable-standard",
        inputs: variables(90, "green"),
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    aiTestCases: [
      {
        name: "ai-standard",
        inputs: variables(60, "green"),
        expectedResult: { type: "money_cents", amountCents: 2_000 },
      },
    ],
    currentMarginCents: "5000",
  };
}

function typedOutputSimulationInput(
  scope: "external_cost" | "reconciliation",
  compositionMode: "emit_items" | "check",
): CustomRuleSimulationInput {
  const isExternalCost = scope === "external_cost";
  const businessContract = isExternalCost
    ? externalCostContract()
    : reconciliationContract();
  const formula = isExternalCost
    ? 'cost_items([{ category: "traffic", amount: yuan(500), memo: "7 月投流" }])'
    : 'block_if(margin_rate < rate_percent(10), "毛利率低于 10%")';
  const validated = validateCustomRuleFormula(formula, {
    scope,
    executionGrain: businessContract.executionGrain,
    compositionMode,
    parameters: businessContract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  if (!validated.ok) throw new Error("typed-output test formula must compile");
  const parameters = Object.fromEntries(
    businessContract.parameters.map((parameter) => [
      parameter.name,
      parameter.defaultValue,
    ]),
  );
  const recordVariables = isExternalCost
    ? {
        ...variables(60, "green"),
        import_row_index: { type: "integer" as const, value: 1 },
      }
    : {
        ...variables(60, "green"),
        margin_rate: { type: "rate_bps" as const, rateBps: 500 },
      };

  return {
    ...simulationInput(),
    contract: businessContract,
    compiledAst: validated.compiledAst,
    parameters,
    formulaHash: validated.formulaHash,
    contractHash: hashCustomRuleContract(businessContract),
    parameterHash: hashCustomRuleParameters(parameters),
    records: [
      record("record-1", {
        variables: recordVariables,
        currentRuleResult: null,
      }),
    ],
    userExamples: [],
    aiTestCases: [
      {
        name: isExternalCost ? "成本项" : "核对项",
        inputs: isExternalCost
          ? { import_row_index: { type: "integer" as const, value: 1 } }
          : { margin_rate: { type: "rate_bps" as const, rateBps: 500 } },
        expectedResult: isExternalCost
          ? costItemsExpectedResult()
          : checksExpectedResult(),
      },
    ],
  };
}

function projectStreamerUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function parameterClampInput(): CustomRuleSimulationInput {
  const input = simulationInput();
  const adjustableParameter = {
    name: "adjustable_amount",
    description: "可调试算金额",
    valueType: { kind: "scalar" as const, scalarType: "money_cents" as const },
    userFacingUnit: "元",
    defaultValue: { type: "money_cents" as const, amountCents: 2_000 },
  };
  input.contract.parameters.push(adjustableParameter);
  input.parameters.adjustable_amount = adjustableParameter.defaultValue;
  const formula = `money_result({ final: clamp(
    parameter("adjustable_amount"),
    yuan(0),
    yuan(30)
  ) })`;
  const validated = validateCustomRuleFormula(formula, {
    scope: input.contract.scope,
    executionGrain: input.contract.executionGrain,
    parameters: input.contract.parameters.map((parameter) => ({
      name: parameter.name,
      valueType: parameter.valueType,
    })),
  });
  if (!validated.ok) throw new Error("parameter clamp formula must compile");
  input.compiledAst = validated.compiledAst;
  input.formulaHash = validated.formulaHash;
  input.contractHash = hashCustomRuleContract(input.contract);
  input.parameterHash = hashCustomRuleParameters(input.parameters);
  return input;
}

function simulateAuthorized(
  input: CustomRuleSimulationInput,
  runtime?: CustomRuleSimulationRuntime,
) {
  const sourceVersions = new Map<
    string,
    CustomRuleSimulationInput["provenance"]["immutableSourceVersions"][number]
  >();
  for (const record of input.records) {
    sourceVersions.set(
      `${record.sourceVersion.source}\u0000${record.sourceVersion.version}`,
      record.sourceVersion,
    );
  }
  input.provenance.immutableSourceVersions = [...sourceVersions.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.version.localeCompare(right.version),
  );
  input.provenance.evidenceHash = "0".repeat(64);
  input.provenance.evidenceHash = calculateCustomRuleEvidenceHash({
    provenance: input.provenance,
    sampleSource: input.sampleSource,
    sampleSelection: input.sampleSelection,
    records: input.records,
    userExamples: input.userExamples,
    currentMarginCents: input.currentMarginCents,
  });
  return runtime
    ? simulateCustomSettlementRule(input, runtime)
    : simulateCustomSettlementRule(input);
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

function externalCostContract(): BusinessRuleContract {
  return {
    ...contract(),
    scope: "external_cost",
    compositionMode: "emit_items",
    title: "项目外部成本生成规则",
    summary: "按项目导入数据生成外部成本项。",
    calculationComponents: [
      {
        name: "items",
        description: "生成外部成本项",
        expression: "cost_items",
        resultType: {
          kind: "array",
          itemType: {
            kind: "object",
            fields: {
              category: { kind: "scalar", scalarType: "string" },
              amountCents: { kind: "scalar", scalarType: "money_cents" },
              memo: { kind: "scalar", scalarType: "string" },
            },
          },
        },
      },
    ],
    requiredInputs: [
      {
        name: "import_row_index",
        description: "标准化导入行号",
        source: "成本导入",
        valueType: { kind: "scalar", scalarType: "integer" },
        userFacingUnit: "行",
      },
    ],
    parameters: contract().parameters,
    compositionDescription: "为项目追加生成的外部成本项。",
    examples: ["标准成本", "零成本", "多成本"].map((name, index) => ({
      name,
      kind: index === 0 ? "normal" : "boundary",
      description: "生成投流成本项。",
      inputs: { import_row_index: { type: "integer", value: index + 1 } },
      expectedResult: index === 0 ? costItemsExpectedResult() : emptyArrayResult(),
    })),
  };
}

function reconciliationContract(): BusinessRuleContract {
  return {
    ...contract(),
    scope: "reconciliation",
    executionGrain: "project_period",
    compositionMode: "check",
    title: "项目周期结算核对规则",
    summary: "按项目周期输出结算核对项。",
    calculationComponents: [
      {
        name: "checks",
        description: "生成核对项",
        expression: "block_if",
        resultType: {
          kind: "array",
          itemType: {
            kind: "object",
            fields: {
              severity: { kind: "scalar", scalarType: "string" },
              message: { kind: "scalar", scalarType: "string" },
              condition: { kind: "scalar", scalarType: "boolean" },
            },
          },
        },
      },
    ],
    requiredInputs: [
      {
        name: "margin_rate",
        description: "项目周期毛利率",
        source: "结算核心结果",
        valueType: { kind: "scalar", scalarType: "rate_bps" },
        userFacingUnit: "%",
      },
    ],
    parameters: contract().parameters,
    compositionDescription: "仅输出项目周期核对项，不修改结算金额。",
    examples: [
      {
        name: "毛利过低",
        kind: "normal",
        description: "毛利率低于 10% 时阻断。",
        inputs: { margin_rate: { type: "rate_bps", rateBps: 500 } },
        expectedResult: checksExpectedResult(),
      },
      {
        name: "毛利达标",
        kind: "boundary",
        description: "毛利率达到阈值。",
        inputs: { margin_rate: { type: "rate_bps", rateBps: 1000 } },
        expectedResult: emptyArrayResult(),
      },
      {
        name: "毛利较高",
        kind: "boundary",
        description: "毛利率高于阈值。",
        inputs: { margin_rate: { type: "rate_bps", rateBps: 2000 } },
        expectedResult: emptyArrayResult(),
      },
    ],
  };
}

function emptyArrayResult(): TypedRuntimeValue {
  return { type: "array", items: [] };
}

function costItemsExpectedResult(): TypedRuntimeValue {
  return {
    type: "array",
    items: [
      {
        type: "object",
        fields: {
          category: { type: "string", value: "traffic" },
          amountCents: { type: "money_cents", amountCents: 50_000 },
          memo: { type: "string", value: "7 月投流" },
        },
      },
    ],
  };
}

function checksExpectedResult(): TypedRuntimeValue {
  return {
    type: "array",
    items: [
      {
        type: "object",
        fields: {
          severity: { type: "string", value: "block" },
          message: { type: "string", value: "毛利率低于 10%" },
          condition: { type: "boolean", value: true },
        },
      },
    ],
  };
}
