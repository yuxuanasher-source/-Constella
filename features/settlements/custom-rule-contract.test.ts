import { describe, expect, it } from "vitest";

import {
  businessRuleContractPatchSchema,
  businessRuleContractSchema,
  customRuleCompositionModeSchema,
  customRuleExecutionGrainSchema,
  customRuleMissingDataPolicySchema,
  customRuleParameterDefinitionSchema,
  customRuleScopeSchema,
  customRuleSimulationRecordSchema,
  customRuleSimulationSummarySchema,
  customRuleTargetSchema,
  customRuleTargetTypeSchema,
  customRuleVersionStatusSchema,
  diffBusinessRuleContracts,
  reviseBusinessRuleContract,
  runtimeValueTypeSchema,
  typedRuntimeValueSchema,
  type BusinessRuleContractChange,
} from "./custom-rule-contract";
import {
  CUSTOM_RULE_COMPOSITION_MODES,
  CUSTOM_RULE_EXECUTION_GRAINS,
  CUSTOM_RULE_SCOPES,
  CUSTOM_RULE_TARGET_TYPES,
  CUSTOM_RULE_VERSION_STATUSES,
  RUNTIME_SCALAR_TYPES,
} from "./custom-rule-types";
import type {
  RuntimeScalarType,
  RuntimeValueType,
} from "./custom-rule-types";

function scalarType(scalarType: RuntimeScalarType): RuntimeValueType {
  return { kind: "scalar", scalarType };
}

type RuntimeSchema = {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean };
};

async function getRuntimeSchema(name: string): Promise<RuntimeSchema> {
  const contractModule = (await import(
    "./custom-rule-contract"
  )) as unknown as Record<string, unknown>;
  const schema = contractModule[name];

  expect(schema).toBeDefined();
  return schema as RuntimeSchema;
}

function issuePaths(
  result: ReturnType<typeof businessRuleContractSchema.safeParse>,
) {
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

function validContractInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    scope: "receivable",
    target: { targetType: "project", targetId: null },
    executionGrain: "project_period",
    compositionMode: "replace",
    title: "项目应收分成",
    summary: "计算项目应收金额，适用于指定项目。",
    calculationComponents: [
      {
        name: "netReceivable",
        description: "按平台分成比例计算项目应收",
        expression: "grossRevenue * platformRate",
        resultType: scalarType("money_cents"),
      },
    ],
    requiredInputs: [
      {
        name: "grossRevenue",
        description: "项目确认收入",
        source: "settlement_report.gross_revenue_cents",
        valueType: scalarType("money_cents"),
        userFacingUnit: "元",
      },
    ],
    parameters: [
      {
        name: "platformRate",
        description: "平台应收分成比例",
        valueType: scalarType("rate_bps"),
        userFacingUnit: "%",
        defaultValue: { type: "rate_bps", rateBps: 8000 },
      },
    ],
    effectiveStartAt: "2026-07-01T00:00:00+08:00",
    effectiveEndAt: null,
    missingDataPolicy: { action: "route_item_to_review" },
    compositionDescription: "替换项目周期的基础应收金额",
    businessTimezone: "Asia/Shanghai",
    examples: [
      {
        name: "标准项目分成",
        kind: "normal",
        description: "项目收入一百元时按八成计算",
        inputs: {
          grossRevenue: { type: "money_cents", amountCents: 10_000 },
        },
        expectedResult: { type: "money_cents", amountCents: 8_000 },
      },
      {
        name: "零收入边界",
        kind: "boundary",
        description: "项目没有收入时结果为零",
        inputs: {
          grossRevenue: { type: "money_cents", amountCents: 0 },
        },
        expectedResult: { type: "money_cents", amountCents: 0 },
      },
      {
        name: "一分收入边界",
        kind: "boundary",
        description: "最小货币单位仍按整数分处理",
        inputs: {
          grossRevenue: { type: "money_cents", amountCents: 1 },
        },
        expectedResult: { type: "money_cents", amountCents: 1 },
      },
    ],
    ...overrides,
  };
}

describe("custom rule enum schemas", () => {
  it("accepts every narrow union member", () => {
    for (const value of CUSTOM_RULE_SCOPES) {
      expect(customRuleScopeSchema.parse(value)).toBe(value);
    }
    for (const value of CUSTOM_RULE_TARGET_TYPES) {
      expect(customRuleTargetTypeSchema.parse(value)).toBe(value);
    }
    for (const value of CUSTOM_RULE_EXECUTION_GRAINS) {
      expect(customRuleExecutionGrainSchema.parse(value)).toBe(value);
    }
    for (const value of CUSTOM_RULE_COMPOSITION_MODES) {
      expect(customRuleCompositionModeSchema.parse(value)).toBe(value);
    }
    for (const value of CUSTOM_RULE_VERSION_STATUSES) {
      expect(customRuleVersionStatusSchema.parse(value)).toBe(value);
    }
    for (const scalarTypeValue of RUNTIME_SCALAR_TYPES) {
      expect(
        runtimeValueTypeSchema.parse({
          kind: "scalar",
          scalarType: scalarTypeValue,
        }),
      ).toEqual({ kind: "scalar", scalarType: scalarTypeValue });
    }
  });
});

describe("target and runtime value contracts", () => {
  it("enforces null project IDs and required non-project IDs", () => {
    expect(
      customRuleTargetSchema.parse({ targetType: "project", targetId: null }),
    ).toEqual({ targetType: "project", targetId: null });
    expect(
      customRuleTargetSchema.parse({
        targetType: "streamer_group",
        targetId: "group-1",
      }),
    ).toEqual({ targetType: "streamer_group", targetId: "group-1" });
    expect(
      customRuleTargetSchema.parse({
        targetType: "project_streamer",
        targetId: "streamer-1",
      }),
    ).toEqual({ targetType: "project_streamer", targetId: "streamer-1" });

    expect(
      customRuleTargetSchema.safeParse({
        targetType: "project",
        targetId: "project-1",
      }).success,
    ).toBe(false);
    expect(
      customRuleTargetSchema.safeParse({
        targetType: "streamer_group",
        targetId: null,
      }).success,
    ).toBe(false);
    expect(
      customRuleTargetSchema.safeParse({
        targetType: "project_streamer",
        targetId: "",
      }).success,
    ).toBe(false);
  });

  it("validates every scalar plus typed arrays and objects", () => {
    const values: unknown[] = [
      { type: "money_cents", amountCents: 100 },
      { type: "rate_bps", rateBps: 8000 },
      { type: "number", value: 1.25 },
      { type: "integer", value: 2 },
      { type: "boolean", value: true },
      { type: "string", value: "project-a" },
      { type: "timestamp", value: "2026-07-01T12:30:00+08:00" },
      {
        type: "array",
        items: [
          { type: "money_cents", amountCents: 100 },
          { type: "money_cents", amountCents: 200 },
        ],
      },
      {
        type: "object",
        fields: {
          revenueAmountCents: { type: "money_cents", amountCents: 100 },
          shareRateBps: { type: "rate_bps", rateBps: 8000 },
        },
      },
    ];

    for (const value of values) {
      expect(typedRuntimeValueSchema.parse(value)).toEqual(value);
    }

    expect(
      runtimeValueTypeSchema.parse({
        kind: "array",
        itemType: scalarType("money_cents"),
      }),
    ).toEqual({
      kind: "array",
      itemType: scalarType("money_cents"),
    });
    expect(
      runtimeValueTypeSchema.parse({
        kind: "object",
        fields: {
          eligible: scalarType("boolean"),
          totals: {
            kind: "array",
            itemType: scalarType("money_cents"),
          },
        },
      }),
    ).toEqual({
      kind: "object",
      fields: {
        eligible: scalarType("boolean"),
        totals: {
          kind: "array",
          itemType: scalarType("money_cents"),
        },
      },
    });
  });

  it("rejects ambiguous unit fields, unsafe integers, and local timestamps", () => {
    expect(
      typedRuntimeValueSchema.safeParse({ type: "money_cents", amount: 100 })
        .success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({ type: "rate_bps", value: 8000 })
        .success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({
        type: "money_cents",
        amountCents: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({ type: "integer", value: 1.5 })
        .success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({
        type: "timestamp",
        value: "2026-07-01T12:30:00",
      }).success,
    ).toBe(false);
  });

  it("rejects bare amount identifiers in nested runtime type and value objects", () => {
    expect(
      runtimeValueTypeSchema.safeParse({
        kind: "object",
        fields: { amount: scalarType("money_cents") },
      }).success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({
        type: "object",
        fields: {
          amount: { type: "money_cents", amountCents: 100 },
        },
      }).success,
    ).toBe(false);
    expect(
      typedRuntimeValueSchema.safeParse({
        type: "object",
        fields: {
          nested: {
            type: "object",
            fields: {
              amount: { type: "money_cents", amountCents: 100 },
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects noncanonical, ambiguous, and dangerous persisted identifiers", () => {
    expect(
      customRuleParameterDefinitionSchema.safeParse({
        name: " platformRate ",
        description: "平台应收分成比例",
        valueType: scalarType("rate_bps"),
        userFacingUnit: "%",
        defaultValue: { type: "rate_bps", rateBps: 8000 },
      }).success,
    ).toBe(false);
    expect(
      runtimeValueTypeSchema.safeParse({
        kind: "object",
        fields: {
          foo: scalarType("number"),
          " foo ": scalarType("number"),
        },
      }).success,
    ).toBe(false);

    for (const key of [
      "Amount",
      "AMOUNT",
      "__proto__",
      "prototype",
      "constructor",
    ]) {
      const fields = Object.fromEntries([[key, scalarType("money_cents")]]);
      expect(
        runtimeValueTypeSchema.safeParse({ kind: "object", fields }).success,
        key,
      ).toBe(false);
    }
  });
});

describe("product-owned AST runtime schemas", () => {
  it("validates normalized AST nodes without transforming identifiers", async () => {
    const normalizedAstNodeSchema = await getRuntimeSchema(
      "normalizedAstNodeSchema",
    );
    const ast = {
      kind: "binary",
      operator: "+",
      left: { kind: "identifier", name: "grossRevenue" },
      right: { kind: "literal", value: 1.25 },
    };

    expect(normalizedAstNodeSchema.parse(ast)).toEqual(ast);
    expect(
      JSON.parse(JSON.stringify(normalizedAstNodeSchema.parse(ast))),
    ).toEqual(ast);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        normalizedAstNodeSchema.safeParse({ kind: "literal", value }).success,
      ).toBe(false);
    }
    for (const name of [" amount ", "Amount", "__proto__", "constructor"]) {
      expect(
        normalizedAstNodeSchema.safeParse({ kind: "identifier", name })
          .success,
      ).toBe(false);
    }
    expect(
      normalizedAstNodeSchema.safeParse({
        kind: "identifier",
        name: "grossRevenue",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("validates compiled AST units and JSON-safe recursive nodes", async () => {
    const compiledAstNodeSchema = await getRuntimeSchema(
      "compiledAstNodeSchema",
    );
    const ast = {
      kind: "call",
      callee: "sum",
      arguments: [
        {
          kind: "literal",
          inferredType: { kind: "scalar", scalarType: "money_cents" },
          valueCents: 100,
        },
        {
          kind: "literal",
          inferredType: { kind: "scalar", scalarType: "rate_bps" },
          valueBps: 8000,
        },
      ],
      inferredType: { kind: "scalar", scalarType: "money_cents" },
    };

    expect(compiledAstNodeSchema.parse(ast)).toEqual(ast);
    expect(
      JSON.parse(JSON.stringify(compiledAstNodeSchema.parse(ast))),
    ).toEqual(ast);
    for (const valueCents of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        compiledAstNodeSchema.safeParse({
          kind: "literal",
          inferredType: { kind: "scalar", scalarType: "money_cents" },
          valueCents,
        }).success,
      ).toBe(false);
    }
    for (const valueBps of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        compiledAstNodeSchema.safeParse({
          kind: "literal",
          inferredType: { kind: "scalar", scalarType: "rate_bps" },
          valueBps,
        }).success,
      ).toBe(false);
    }
    expect(
      compiledAstNodeSchema.safeParse({
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "number" },
        value: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      compiledAstNodeSchema.safeParse({
        kind: "identifier",
        name: " grossRevenue ",
        inferredType: scalarType("money_cents"),
      }).success,
    ).toBe(false);
    expect(
      compiledAstNodeSchema.safeParse({
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "rate_bps" },
        valueBps: 8000,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("strict component schemas", () => {
  it("validates typed parameter defaults", () => {
    const parameter = {
      name: "platformRate",
      description: "平台应收分成比例",
      valueType: scalarType("rate_bps"),
      userFacingUnit: "%",
      defaultValue: { type: "rate_bps", rateBps: 8000 },
    };

    expect(customRuleParameterDefinitionSchema.parse(parameter)).toEqual(
      parameter,
    );
    expect(
      customRuleParameterDefinitionSchema.safeParse({
        ...parameter,
        defaultValue: { type: "money_cents", amountCents: 8000 },
      }).success,
    ).toBe(false);
  });

  it("supports every missing-data behavior with a typed explicit default", () => {
    expect(
      customRuleMissingDataPolicySchema.parse({
        action: "route_item_to_review",
      }),
    ).toEqual({ action: "route_item_to_review" });
    expect(
      customRuleMissingDataPolicySchema.parse({ action: "block_batch" }),
    ).toEqual({ action: "block_batch" });
    expect(
      customRuleMissingDataPolicySchema.parse({
        action: "use_explicit_default",
        defaultValue: {
          type: "array",
          items: [{ type: "money_cents", amountCents: 0 }],
        },
      }),
    ).toEqual({
      action: "use_explicit_default",
      defaultValue: {
        type: "array",
        items: [{ type: "money_cents", amountCents: 0 }],
      },
    });
    expect(
      customRuleMissingDataPolicySchema.safeParse({
        action: "use_explicit_default",
      }).success,
    ).toBe(false);
  });

  it("validates simulation summaries and records", () => {
    const summary = {
      totalRecords: 3,
      calculatedRecords: 1,
      routedToReviewRecords: 1,
      blockedRecords: 1,
      aggregateAmountCents: "9007199254740993123",
    };
    const record = {
      recordId: "record-1",
      status: "calculated",
      inputValues: {
        grossRevenue: { type: "money_cents", amountCents: 10_000 },
      },
      result: { type: "money_cents", amountCents: 8_000 },
      diagnostics: [],
    };

    expect(customRuleSimulationSummarySchema.parse(summary)).toEqual(summary);
    expect(customRuleSimulationRecordSchema.parse(record)).toEqual(record);
    expect(
      customRuleSimulationSummarySchema.safeParse({
        ...summary,
        calculatedRecords: 2,
      }).success,
    ).toBe(false);
    expect(
      customRuleSimulationSummarySchema.safeParse({
        ...summary,
        aggregateAmountCents: "09007199254740993123",
      }).success,
    ).toBe(false);
  });

  it("ties simulation result presence to calculation status", () => {
    const base = {
      recordId: "record-status",
      inputValues: {
        grossRevenue: { type: "money_cents", amountCents: 10_000 },
      },
      diagnostics: [],
    };

    expect(
      customRuleSimulationRecordSchema.safeParse({
        ...base,
        status: "calculated",
        result: null,
      }).success,
    ).toBe(false);
    for (const status of ["routed_to_review", "blocked"] as const) {
      expect(
        customRuleSimulationRecordSchema.safeParse({
          ...base,
          status,
          result: null,
        }).success,
      ).toBe(true);
      expect(
        customRuleSimulationRecordSchema.safeParse({
          ...base,
          status,
          result: { type: "money_cents", amountCents: 8_000 },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown keys on every persisted object schema", () => {
    expect(
      customRuleTargetSchema.safeParse({
        targetType: "project",
        targetId: null,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      customRuleParameterDefinitionSchema.safeParse({
        name: "platformRate",
        description: "平台应收分成比例",
        valueType: scalarType("rate_bps"),
        userFacingUnit: "%",
        defaultValue: { type: "rate_bps", rateBps: 8000 },
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      customRuleMissingDataPolicySchema.safeParse({
        action: "block_batch",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      customRuleSimulationSummarySchema.safeParse({
        totalRecords: 0,
        calculatedRecords: 0,
        routedToReviewRecords: 0,
        blockedRecords: 0,
        aggregateAmountCents: null,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      customRuleSimulationRecordSchema.safeParse({
        recordId: "record-1",
        status: "blocked",
        inputValues: {},
        result: null,
        diagnostics: ["missing input"],
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse({
        ...validContractInput(),
        amount: 100,
      }).success,
    ).toBe(false);
    expect(
      businessRuleContractPatchSchema.safeParse({ unexpected: true }).success,
    ).toBe(false);
  });

  it("rejects bare amount identifiers at every nested contract entry point", () => {
    expect(
      customRuleParameterDefinitionSchema.safeParse({
        name: "amount",
        description: "平台应收分成金额",
        valueType: scalarType("money_cents"),
        userFacingUnit: "元",
        defaultValue: { type: "money_cents", amountCents: 0 },
      }).success,
    ).toBe(false);
    expect(
      customRuleSimulationRecordSchema.safeParse({
        recordId: "record-amount",
        status: "calculated",
        inputValues: {
          amount: { type: "money_cents", amountCents: 100 },
        },
        result: { type: "money_cents", amountCents: 100 },
        diagnostics: [],
      }).success,
    ).toBe(false);

    for (const section of [
      "calculationComponents",
      "requiredInputs",
      "parameters",
    ] as const) {
      const input = validContractInput();
      const entries = input[section] as Array<Record<string, unknown>>;
      entries[0] = { ...entries[0], name: "amount" };
      expect(businessRuleContractSchema.safeParse(input).success).toBe(false);
    }

    const exampleInput = validContractInput();
    const examples = exampleInput.examples as Array<Record<string, unknown>>;
    examples[0] = {
      ...examples[0],
      inputs: {
        amount: { type: "money_cents", amountCents: 10_000 },
      },
    };
    expect(businessRuleContractSchema.safeParse(exampleInput).success).toBe(
      false,
    );
  });
});

describe("business rule contract", () => {
  it("accepts a complete project contract", () => {
    const parsed = businessRuleContractSchema.parse(validContractInput());

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      scope: "receivable",
      target: { targetType: "project", targetId: null },
      executionGrain: "project_period",
      compositionMode: "replace",
      businessTimezone: "Asia/Shanghai",
    });
    expect(parsed.calculationComponents).toHaveLength(1);
    expect(parsed.requiredInputs[0]).toMatchObject({
      source: "settlement_report.gross_revenue_cents",
      userFacingUnit: "元",
    });
    expect(parsed.parameters[0].name).toBe("platformRate");
    expect(parsed.examples.filter((example) => example.kind === "normal")).toHaveLength(1);
    expect(
      parsed.examples.filter((example) => example.kind === "boundary"),
    ).toHaveLength(2);
  });

  it("allows all payable targets and keeps other scopes project-only", () => {
    const payableTargets = [
      { targetType: "project", targetId: null },
      { targetType: "streamer_group", targetId: "group-1" },
      { targetType: "project_streamer", targetId: "streamer-1" },
    ];

    for (const target of payableTargets) {
      expect(
        businessRuleContractSchema.safeParse(
          validContractInput({ scope: "payable", target }),
        ).success,
      ).toBe(true);
    }

    for (const scope of [
      "receivable",
      "external_cost",
      "reconciliation",
    ] as const) {
      expect(
        businessRuleContractSchema.safeParse(
          validContractInput({
            scope,
            target: { targetType: "project", targetId: null },
          }),
        ).success,
      ).toBe(true);
      expect(
        businessRuleContractSchema.safeParse(
          validContractInput({
            scope,
            target: { targetType: "streamer_group", targetId: "group-1" },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it("requires every contract section and complete input metadata", () => {
    const requiredFields = [
      "scope",
      "target",
      "executionGrain",
      "compositionMode",
      "title",
      "summary",
      "calculationComponents",
      "requiredInputs",
      "parameters",
      "effectiveStartAt",
      "effectiveEndAt",
      "missingDataPolicy",
      "compositionDescription",
      "examples",
    ];
    const acceptedMissingFields: string[] = [];

    for (const field of requiredFields) {
      const input = validContractInput();
      delete input[field];
      if (businessRuleContractSchema.safeParse(input).success) {
        acceptedMissingFields.push(field);
      }
    }

    expect(acceptedMissingFields).toEqual([]);

    const missingSource = validContractInput();
    delete (missingSource.requiredInputs as Array<Record<string, unknown>>)[0]
      .source;
    expect(businessRuleContractSchema.safeParse(missingSource).success).toBe(
      false,
    );

    const missingUnit = validContractInput();
    delete (missingUnit.requiredInputs as Array<Record<string, unknown>>)[0]
      .userFacingUnit;
    expect(businessRuleContractSchema.safeParse(missingUnit).success).toBe(
      false,
    );
  });

  it("rejects input and parameter symbol collisions with a located issue", () => {
    const input = validContractInput();
    const parameters = input.parameters as Array<Record<string, unknown>>;
    parameters[0] = { ...parameters[0], name: "grossRevenue" };

    const result = businessRuleContractSchema.safeParse(input);

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("parameters.0.name");
  });

  it("requires every example input and validates its declared runtime type", () => {
    const missingInput = validContractInput();
    const missingExamples = missingInput.examples as Array<
      Record<string, unknown>
    >;
    missingExamples[0] = { ...missingExamples[0], inputs: {} };

    const missingResult = businessRuleContractSchema.safeParse(missingInput);
    expect(missingResult.success).toBe(false);
    expect(issuePaths(missingResult)).toContain(
      "examples.0.inputs.grossRevenue",
    );

    const mismatchedInput = validContractInput();
    const mismatchedExamples = mismatchedInput.examples as Array<
      Record<string, unknown>
    >;
    mismatchedExamples[1] = {
      ...mismatchedExamples[1],
      inputs: {
        grossRevenue: { type: "rate_bps", rateBps: 5000 },
      },
    };

    const mismatchedResult =
      businessRuleContractSchema.safeParse(mismatchedInput);
    expect(mismatchedResult.success).toBe(false);
    expect(issuePaths(mismatchedResult)).toContain(
      "examples.1.inputs.grossRevenue",
    );
  });

  it("requires one normal and two boundary examples", () => {
    const examples = validContractInput().examples as Array<
      Record<string, unknown>
    >;

    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({ examples: examples.slice(0, 2) }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({
          examples: examples.map((example) => ({
            ...example,
            kind: "boundary",
          })),
        }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({
          examples: [
            { ...examples[0], kind: "normal" },
            { ...examples[1], kind: "normal" },
            { ...examples[2], kind: "boundary" },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("defaults the valid business timezone and rejects invalid time rules", () => {
    const withoutTimezone = validContractInput();
    delete withoutTimezone.businessTimezone;

    expect(
      businessRuleContractSchema.parse(withoutTimezone).businessTimezone,
    ).toBe("Asia/Shanghai");
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({ businessTimezone: "Mars/Olympus" }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({
          effectiveStartAt: "2026-07-01T00:00:00",
        }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({
          effectiveEndAt: "2026-06-30T23:59:59+08:00",
        }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({ title: "Project receivable" }),
      ).success,
    ).toBe(false);
    expect(
      businessRuleContractSchema.safeParse(
        validContractInput({ summary: "Calculate project receivable." }),
      ).success,
    ).toBe(false);
  });
});

describe("business rule revisions", () => {
  it("keeps diff fields correlated with their before and after values", () => {
    const targetValue = {
      targetType: "project",
      targetId: null,
    } as const;
    const validChange: BusinessRuleContractChange = {
      field: "scope",
      before: "receivable",
      after: "payable",
    };
    // @ts-expect-error scope changes cannot carry target values
    const invalidChange: BusinessRuleContractChange = {
      field: "scope",
      before: targetValue,
      after: "payable",
    };

    expect(validChange.field).toBe("scope");
    expect(invalidChange.field).toBe("scope");
  });

  it("changes one known field while preserving every unaffected field", () => {
    const before = businessRuleContractSchema.parse(validContractInput());
    const revisedSummary = "计算项目净应收金额，仍仅适用于指定项目。";
    const after = reviseBusinessRuleContract(before, {
      summary: revisedSummary,
    });

    expect(after).toEqual({ ...before, summary: revisedSummary });
    expect(before.summary).toBe("计算项目应收金额，适用于指定项目。");
    expect(diffBusinessRuleContracts(before, after)).toEqual([
      {
        field: "summary",
        before: "计算项目应收金额，适用于指定项目。",
        after: revisedSummary,
      },
    ]);
  });

  it("rejects unknown or invalid patches", () => {
    const before = businessRuleContractSchema.parse(validContractInput());

    expect(() =>
      reviseBusinessRuleContract(before, { unexpected: true } as never),
    ).toThrow();
    expect(() =>
      reviseBusinessRuleContract(before, {
        target: { targetType: "streamer_group", targetId: "group-1" },
      }),
    ).toThrow();
  });

  it("returns changed fields in deterministic contract order", () => {
    const before = businessRuleContractSchema.parse(validContractInput());
    const after = reviseBusinessRuleContract(before, {
      summary: "计算调整后的项目应收金额，适用于指定项目。",
      title: "调整后项目应收分成",
    });

    expect(
      diffBusinessRuleContracts(before, after).map((change) => change.field),
    ).toEqual(["title", "summary"]);
  });
});
