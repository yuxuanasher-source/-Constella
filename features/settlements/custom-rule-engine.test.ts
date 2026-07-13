import { describe, expect, it } from "vitest";

import type {
  CompiledAstNode,
  CustomRuleExecutionGrain,
  CustomRuleScope,
  RuntimeScalarType,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import {
  CustomRuleExecutionError,
  type CustomRuleExecutionResult,
  type CustomRuleMoneyResult,
  executeCompiledCustomRule,
  executeCompiledCustomRuleWithTrace,
  preflightCompiledCustomRuleAst,
} from "./custom-rule-engine";

const scalar = <ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } => ({
  kind: "scalar",
  scalarType,
});

const integer = (value: number): TypedRuntimeValue => ({
  type: "integer",
  value,
});

const numberValue = (value: number): TypedRuntimeValue => ({
  type: "number",
  value,
});

const money = (amountCents: number): TypedRuntimeValue => ({
  type: "money_cents",
  amountCents,
});

const rate = (rateBps: number): TypedRuntimeValue => ({
  type: "rate_bps",
  rateBps,
});

const stringValue = (value: string): TypedRuntimeValue => ({
  type: "string",
  value,
});

const timestamp = (value: string): TypedRuntimeValue => ({
  type: "timestamp",
  value,
});

const stringArray = (...values: string[]): TypedRuntimeValue => ({
  type: "array",
  items: values.map(stringValue),
});

function compileFormula(
  formula: string,
  parameters: ReadonlyArray<{
    name: string;
    valueType: RuntimeValueType;
  }> = [],
  scope: CustomRuleScope = "payable",
  executionGrain: CustomRuleExecutionGrain = "report",
  compositionMode?: "replace" | "add" | "multiply" | "clamp" | "emit_items" | "check",
): CompiledAstNode {
  const result = validateCustomRuleFormula(formula, {
    scope,
    executionGrain,
    parameters,
    ...(compositionMode === undefined ? {} : { compositionMode }),
  });

  if (!result.ok) {
    throw new Error(
      `Test formula did not compile: ${result.issues[0]?.code ?? "unknown"}`,
    );
  }
  return result.compiledAst;
}

function executeFormula(
  formula: string,
  options: {
    variableValues?: Readonly<Record<string, TypedRuntimeValue>>;
    parameterDefinitions?: ReadonlyArray<{
      name: string;
      valueType: RuntimeValueType;
    }>;
    parameterValues?: Readonly<Record<string, TypedRuntimeValue>>;
    limits?: { maxSteps: number; maxDepth: number };
  } = {},
): CustomRuleMoneyResult {
  return executeCompiledCustomRule({
    ast: compileFormula(formula, options.parameterDefinitions),
    variables: options.variableValues ?? {},
    parameters: options.parameterValues ?? {},
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}

function executeScopedFormula(
  formula: string,
  scope: CustomRuleScope,
  executionGrain: CustomRuleExecutionGrain,
  compositionMode: "emit_items" | "check",
  options: {
    variableValues?: Readonly<Record<string, TypedRuntimeValue>>;
    parameterDefinitions?: ReadonlyArray<{
      name: string;
      valueType: RuntimeValueType;
    }>;
    parameterValues?: Readonly<Record<string, TypedRuntimeValue>>;
    limits?: { maxSteps: number; maxDepth: number };
  } = {},
): CustomRuleExecutionResult {
  return executeCompiledCustomRule<CustomRuleExecutionResult>({
    ast: compileFormula(
      formula,
      options.parameterDefinitions ?? [],
      scope,
      executionGrain,
      compositionMode,
    ),
    variables: options.variableValues ?? {},
    parameters: options.parameterValues ?? {},
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}

function expectExecutionIssue(
  operation: () => unknown,
  code: string,
): CustomRuleExecutionError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(CustomRuleExecutionError);
    const executionError = error as CustomRuleExecutionError;
    expect(executionError).toMatchObject({
      name: "CustomRuleExecutionError",
      issue: {
        code,
        message: expect.any(String),
        path: expect.any(String),
      },
    });
    expect(JSON.parse(JSON.stringify(executionError.issue))).toEqual(
      executionError.issue,
    );
    return executionError;
  }

  throw new Error(`Expected ${code}`);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function countingProxy<Target extends object>(target: Target): {
  proxy: Target;
  reads: () => number;
} {
  let reads = 0;
  const recordRead = () => {
    reads += 1;
  };
  const proxy = new Proxy(target, {
    get(current, property, receiver) {
      recordRead();
      return Reflect.get(current, property, receiver);
    },
    getOwnPropertyDescriptor(current, property) {
      recordRead();
      return Reflect.getOwnPropertyDescriptor(current, property);
    },
    getPrototypeOf(current) {
      recordRead();
      return Reflect.getPrototypeOf(current);
    },
    has(current, property) {
      recordRead();
      return Reflect.has(current, property);
    },
    ownKeys(current) {
      recordRead();
      return Reflect.ownKeys(current);
    },
  });
  return { proxy, reads: () => reads };
}

type ExactFraction = { numerator: bigint; denominator: bigint };

function addExactFractions(
  left: ExactFraction,
  right: ExactFraction,
): ExactFraction {
  return {
    numerator:
      left.numerator * right.denominator +
      right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function roundExactFraction(value: ExactFraction): bigint {
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;
  return remainder * BigInt(2) >= value.denominator
    ? quotient + BigInt(1)
    : quotient;
}

function replaceFinalNode(
  ast: CompiledAstNode,
  replacement: CompiledAstNode,
): CompiledAstNode {
  const copy = structuredClone(ast);
  if (
    copy.kind !== "call" ||
    copy.arguments[0]?.kind !== "object"
  ) {
    throw new Error("Expected a compiled money_result AST");
  }
  const finalEntry = copy.arguments[0].entries.find(
    (entry) => entry.key === "final",
  );
  if (!finalEntry) {
    throw new Error("Expected a final component");
  }
  finalEntry.value = replacement;
  return copy;
}

function readFinalNode(ast: CompiledAstNode): CompiledAstNode {
  if (ast.kind !== "call" || ast.arguments[0]?.kind !== "object") {
    throw new Error("Expected a compiled money_result AST");
  }
  const finalEntry = ast.arguments[0].entries.find(
    (entry) => entry.key === "final",
  );
  if (!finalEntry) {
    throw new Error("Expected a final component");
  }
  return finalEntry.value;
}

describe("executeCompiledCustomRule calculations", () => {
  it("executes CPT plus a named bonus with stable ordered components", () => {
    const ast = compileFormula(
      `money_result({
        base: tiered(system_minutes, [
          { upto: null, rate_per_hour: yuan(80) }
        ]),
        bonus: if(streamer_level == "S", parameter("s_bonus"), yuan(0)),
        penalty: yuan(0),
        final: base + bonus - penalty
      })`,
      [{ name: "s_bonus", valueType: scalar("money_cents") }],
    );
    const input = deepFreeze({
      ast,
      variables: {
        system_minutes: integer(180),
        streamer_level: stringValue("S"),
      },
      parameters: { s_bonus: money(5_000) },
    });
    const before = JSON.stringify(input);

    const result = executeCompiledCustomRule(input);

    expect(result).toEqual({
      kind: "money_result",
      componentsCents: {
        base: 24_000,
        bonus: 5_000,
        penalty: 0,
        final: 29_000,
      },
    });
    expect(Object.keys(result.componentsCents)).toEqual([
      "base",
      "bonus",
      "penalty",
      "final",
    ]);
    expect(JSON.stringify(input)).toBe(before);
    expect(executeCompiledCustomRule(input)).toEqual(result);
  });

  it("applies progressive tiers at zero and exact threshold boundaries", () => {
    const ast = compileFormula(`money_result({
      final: tiered(system_minutes, [
        { upto: 60, rate_per_hour: yuan(60) },
        { upto: 120, rate_per_hour: yuan(120) },
        { upto: null, rate_per_hour: yuan(180) }
      ])
    })`);
    const amountAt = (minutes: number) =>
      executeCompiledCustomRule({
        ast,
        variables: { system_minutes: integer(minutes) },
        parameters: {},
      }).componentsCents.final;

    expect([
      amountAt(0),
      amountAt(60),
      amountAt(120),
      amountAt(121),
      amountAt(180),
    ]).toEqual([0, 6_000, 18_000, 18_300, 36_000]);

    const execution = executeCompiledCustomRuleWithTrace({
      ast,
      variables: { system_minutes: integer(120) },
      parameters: {},
    });
    expect(
      execution.trace
        .filter((event) => event.kind === "tier")
        .map((event) => event.tierIndex),
    ).toEqual([0, 1]);
  });

  it("allocates tier rounding residue so trace amounts reconcile to the rounded total", () => {
    const ast = compileFormula(`money_result({
      final: tiered(system_minutes, [
        { upto: 30, rate_per_hour: yuan(0.01) },
        { upto: 60, rate_per_hour: yuan(0.01) }
      ])
    })`);
    const runAt = (minutes: number) =>
      executeCompiledCustomRuleWithTrace({
        ast,
        variables: { system_minutes: integer(minutes) },
        parameters: {},
      });

    const atThreshold = runAt(30);
    expect(
      atThreshold.trace
        .filter((event) => event.kind === "tier")
        .map((event) => event.amountCents),
    ).toEqual([1]);

    const acrossTwoTiers = runAt(60);
    const tierEvents = acrossTwoTiers.trace.filter(
      (event) => event.kind === "tier",
    );
    const tierAmounts = tierEvents.map((event) => event.amountCents);
    expect(tierAmounts).toEqual([1, 0]);
    expect(tierEvents.map((event) => event.exactAmountCents)).toEqual([
      { numerator: "1", denominator: "2" },
      { numerator: "1", denominator: "2" },
    ]);
    expect(tierAmounts.reduce((sum, amount) => sum + amount, 0)).toBe(
      acrossTwoTiers.result.componentsCents.final,
    );
    const exactTotal = tierEvents
      .map((event) => ({
        numerator: BigInt(event.exactAmountCents.numerator),
        denominator: BigInt(event.exactAmountCents.denominator),
      }))
      .reduce(addExactFractions, {
        numerator: BigInt(0),
        denominator: BigInt(1),
      });
    expect(Number(roundExactFraction(exactTotal))).toBe(
      acrossTwoTiers.result.componentsCents.final,
    );
    expect(acrossTwoTiers.result.componentsCents.final).toBe(1);
  });

  it("records exact no-residue tiers and deterministically allocates multi-tier residue", () => {
    const exactAst = compileFormula(`money_result({
      final: tiered(system_minutes, [
        { upto: null, rate_per_hour: yuan(60) }
      ])
    })`);
    const exactExecution = executeCompiledCustomRuleWithTrace({
      ast: exactAst,
      variables: { system_minutes: integer(60) },
      parameters: {},
    });
    const exactTier = exactExecution.trace.find(
      (event) => event.kind === "tier",
    );
    expect(exactTier).toMatchObject({
      kind: "tier",
      exactAmountCents: { numerator: "6000", denominator: "1" },
      amountCents: 6_000,
    });

    const residueAst = compileFormula(`money_result({
      final: tiered(system_minutes, [
        { upto: 30, rate_per_hour: yuan(0.01) },
        { upto: 60, rate_per_hour: yuan(0.01) },
        { upto: 90, rate_per_hour: yuan(0.01) }
      ])
    })`);
    const runResidue = () =>
      executeCompiledCustomRuleWithTrace({
        ast: residueAst,
        variables: { system_minutes: integer(90) },
        parameters: {},
      });
    const first = runResidue();
    const second = runResidue();
    expect(
      first.trace
        .filter((event) => event.kind === "tier")
        .map((event) => event.amountCents),
    ).toEqual([1, 1, 0]);
    expect(first.result.componentsCents.final).toBe(2);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("applies evidence discounts and rounds signed exact half-cents away from zero", () => {
    const ast = compileFormula(`money_result({
      discounted: percent(sales_amount, evidence_multiplier(
        evidence_level,
        {
          green: rate_percent(100),
          yellow: rate_percent(50),
          red: rate_percent(0)
        }
      )),
      modifier: percent(manual_adjustment, rate_percent(50)),
      final: discounted
    })`);
    const run = (level: string, amountCents: number) =>
      executeCompiledCustomRule({
        ast,
        variables: {
          sales_amount: money(amountCents),
          evidence_level: stringValue(level),
          manual_adjustment: money(-1),
        },
        parameters: {},
      });

    expect(run("green", 10_001).componentsCents.discounted).toBe(10_001);
    expect(run("yellow", 1).componentsCents).toEqual({
      discounted: 1,
      modifier: -1,
      final: 1,
    });
    expect(run("red", 10_001).componentsCents.discounted).toBe(0);
  });

  it("rounds just below and exactly at positive and negative half-cent boundaries", () => {
    const formula = `money_result({
      positive: percent(sales_amount, parameter("share_rate")),
      negative: percent(manual_adjustment, parameter("share_rate")),
      final: positive
    })`;
    const parameterDefinitions = [
      { name: "share_rate", valueType: scalar("rate_bps") },
    ];
    const componentsAt = (rateBps: number) =>
      executeFormula(formula, {
        variableValues: {
          sales_amount: money(1),
          manual_adjustment: money(-1),
        },
        parameterDefinitions,
        parameterValues: { share_rate: rate(rateBps) },
      }).componentsCents;

    expect(componentsAt(4_999)).toEqual({
      positive: 0,
      negative: 0,
      final: 0,
    });
    expect(componentsAt(5_000)).toEqual({
      positive: 1,
      negative: -1,
      final: 1,
    });
  });

  it("calculates CPS percent with a named rate and applies floor and cap", () => {
    const formula = `money_result({
      final: clamp(
        percent(sales_amount, parameter("cps_rate")),
        yuan(10),
        yuan(100)
      )
    })`;
    const definitions = [
      { name: "cps_rate", valueType: scalar("rate_bps") },
    ];
    const amountFor = (amountCents: number) =>
      executeFormula(formula, {
        variableValues: { sales_amount: money(amountCents) },
        parameterDefinitions: definitions,
        parameterValues: { cps_rate: rate(1_000) },
      }).componentsCents.final;

    expect([amountFor(0), amountFor(50_000), amountFor(200_000)]).toEqual([
      1_000,
      5_000,
      10_000,
    ]);
  });

  it("keeps BigInt intermediates exact at maximum configured safe values", () => {
    expect(
      executeFormula(
        "money_result({ final: percent(sales_amount, rate_percent(100)) })",
        { variableValues: { sales_amount: money(Number.MAX_SAFE_INTEGER) } },
      ).componentsCents.final,
    ).toBe(Number.MAX_SAFE_INTEGER);

    expect(
      executeFormula(
        `money_result({ final: tiered(system_minutes, [
          { upto: null, rate_per_hour: yuan(0.60) }
        ]) })`,
        {
          variableValues: {
            system_minutes: integer(Number.MAX_SAFE_INTEGER),
          },
        },
      ).componentsCents.final,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("executes every Task 3 calculation helper and supported operator", () => {
    const result = executeFormula(`money_result({
      selected: if(
        ((system_minutes >= 60 && system_minutes <= 120) || system_minutes == 0) &&
          !(streamer_level != "S") &&
          in(streamer_level, ["S", "A"]) &&
          contains(project_tags, "featured"),
        round_money(clamp(
          max(yuan(8), min(yuan(12), yuan(10))),
          yuan(9),
          yuan(11)
        )),
        yuan(99)
      ),
      final: selected
    })`, {
      variableValues: {
        system_minutes: integer(60),
        streamer_level: stringValue("S"),
        project_tags: stringArray("featured", "priority"),
      },
    });

    expect(result.componentsCents).toEqual({ selected: 1_000, final: 1_000 });
  });

  it("does not evaluate an untriggered if branch", () => {
    expect(
      executeFormula(`money_result({
        final: if(
          system_minutes == 0,
          yuan(1),
          percent(sales_amount, rate_percent(10))
        )
      })`, {
        variableValues: { system_minutes: integer(0) },
      }).componentsCents.final,
    ).toBe(100);
  });

  it("preflights but does not execute dynamic zero division in an unselected branch", () => {
    expect(
      executeFormula(`money_result({
        final: if(
          true,
          yuan(1),
          yuan(1) * (1 / system_minutes)
        )
      })`, {
        variableValues: { system_minutes: integer(0) },
      }).componentsCents.final,
    ).toBe(100);
  });

  it("returns a byte-stable immutable detailed execution trace", () => {
    const ast = compileFormula(
      "money_result({ final: percent(sales_amount, rate_percent(10)) })",
    );
    const input = {
      ast,
      variables: { sales_amount: money(12_345) },
      parameters: {},
    };

    const first = executeCompiledCustomRuleWithTrace(input);
    const second = executeCompiledCustomRuleWithTrace(input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.result).toEqual(executeCompiledCustomRule(input));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.trace)).toBe(true);
    expect(Object.isFrozen(first.result.componentsCents)).toBe(true);
  });
});

describe("executeCompiledCustomRule typed Phase 4 outputs", () => {
  it("emits bounded external cost items from typed money expressions", () => {
    const result = executeScopedFormula(
      `cost_items([
        { category: "traffic", amount: yuan(500), memo: "7 月投流" },
        { category: "supplier_fee", amount: supplier_fee, memo: "供应商账单" }
      ])`,
      "external_cost",
      "report",
      "emit_items",
      { variableValues: { supplier_fee: money(12_345) } },
    );

    expect(result).toEqual({
      kind: "cost_items",
      items: [
        { category: "traffic", amountCents: 50_000, memo: "7 月投流" },
        { category: "supplier_fee", amountCents: 12_345, memo: "供应商账单" },
      ],
    });
    if (result.kind !== "cost_items") {
      throw new Error("Expected cost_items result");
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
  });

  it("rejects generated cost amounts that are negative, unsafe, or above the project cap", () => {
    expectExecutionIssue(
      () =>
        executeScopedFormula(
          'cost_items([{ category: "traffic", amount: -yuan(0.01), memo: "负数" }])',
          "external_cost",
          "report",
          "emit_items",
        ),
      "EXECUTION_INVALID_COST_ITEM",
    );
    expectExecutionIssue(
      () =>
        executeScopedFormula(
          'cost_items([{ category: "traffic", amount: yuan(10000001), memo: "超上限" }])',
          "external_cost",
          "report",
          "emit_items",
        ),
      "EXECUTION_COST_ITEM_CAP_EXCEEDED",
    );
  });

  it("returns reconciliation checks with severity derived from the condition", () => {
    const result = executeScopedFormula(
      `[
        block_if(margin_rate < rate_percent(10), "毛利率低于 10%"),
        warn_if(red_evidence_count > 0, "存在红证据场次"),
        pass_if(gross_margin >= yuan(0), "毛利非负")
      ]`,
      "reconciliation",
      "project_period",
      "check",
      {
        variableValues: {
          margin_rate: rate(800),
          red_evidence_count: integer(1),
          gross_margin: money(20_000),
        },
      },
    );

    expect(result).toEqual({
      kind: "checks",
      checks: [
        { severity: "block", condition: true, message: "毛利率低于 10%" },
        { severity: "warn", condition: true, message: "存在红证据场次" },
        { severity: "pass", condition: true, message: "毛利非负" },
      ],
    });
  });
});

describe("executeCompiledCustomRule arithmetic failures", () => {
  it.each([
    ["division", "1 / system_minutes", "EXECUTION_DIVISION_BY_ZERO"],
    ["modulo", "5 % system_minutes", "EXECUTION_MODULO_BY_ZERO"],
  ])("rejects dynamic %s by zero", (_label, expression, code) => {
    expectExecutionIssue(
      () =>
        executeFormula(`money_result({ final: yuan(1) * (${expression}) })`, {
          variableValues: { system_minutes: integer(0) },
        }),
      code,
    );
  });

  it("rejects general division when a compiled operand is money", () => {
    const moneyType = scalar("money_cents");
    const ast = replaceFinalNode(
      compileFormula("money_result({ final: yuan(1) })"),
      {
        kind: "binary",
        operator: "/",
        left: { kind: "literal", inferredType: moneyType, valueCents: 100 },
        right: {
          kind: "literal",
          inferredType: scalar("integer"),
          value: 1,
        },
        inferredType: moneyType,
      },
    );

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("rejects a negative final money output", () => {
    expectExecutionIssue(
      () => executeFormula("money_result({ final: -yuan(0.01) })"),
      "EXECUTION_NEGATIVE_FINAL",
    );
  });

  it("rejects non-finite general arithmetic before it reaches money", () => {
    const definitions = [
      { name: "left", valueType: scalar("number") },
      { name: "right", valueType: scalar("number") },
    ];

    expectExecutionIssue(
      () =>
        executeFormula(
          `money_result({
            final: yuan(1) * (parameter("left") * parameter("right"))
          })`,
          {
            parameterDefinitions: definitions,
            parameterValues: {
              left: numberValue(Number.MAX_VALUE),
              right: numberValue(2),
            },
          },
        ),
      "EXECUTION_NON_FINITE",
    );
  });

  it("rejects unsafe integer outputs", () => {
    expectExecutionIssue(
      () =>
        executeFormula("money_result({ final: yuan(2) * system_minutes })", {
          variableValues: {
            system_minutes: integer(Number.MAX_SAFE_INTEGER),
          },
        }),
      "EXECUTION_UNSAFE_INTEGER",
    );
  });

  it("rejects an excessive exact-decimal intermediate before Number conversion", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          'money_result({ final: yuan(1) * parameter("tiny") })',
          {
            parameterDefinitions: [
              { name: "tiny", valueType: scalar("number") },
            ],
            parameterValues: { tiny: numberValue(1e-100) },
          },
        ),
      "EXECUTION_ARITHMETIC_OVERFLOW",
    );
  });
});

describe("executeCompiledCustomRule timestamp semantics", () => {
  it("uses normalized epoch values for equality and ordering", () => {
    const variables = {
      live_started_at: timestamp("2026-07-11T12:00:00+08:00"),
      approved_at: timestamp("2026-07-11T04:00:00Z"),
    };

    expect(
      executeFormula(
        `money_result({
          final: if(
            live_started_at == approved_at &&
              live_started_at <= approved_at &&
              live_started_at >= approved_at &&
              !(live_started_at != approved_at),
            yuan(1),
            yuan(0)
          )
        })`,
        { variableValues: variables },
      ).componentsCents.final,
    ).toBe(100);
  });

  it("fails closed on an invalid runtime timestamp", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          "money_result({ final: if(live_started_at == approved_at, yuan(1), yuan(0)) })",
          {
            variableValues: {
              live_started_at: timestamp("not-a-timestamp"),
              approved_at: timestamp("2026-07-11T04:00:00Z"),
            },
          },
        ),
      "EXECUTION_INVALID_INPUT",
    );
  });
});

describe("executeCompiledCustomRule trust boundary", () => {
  it("rejects an unknown function hidden in an unselected branch during preflight", () => {
    const ast = structuredClone(
      compileFormula("money_result({ final: if(true, yuan(1), yuan(2)) })"),
    );
    const finalNode = readFinalNode(ast);
    if (finalNode.kind !== "call" || finalNode.callee !== "if") {
      throw new Error("Expected a compiled if call");
    }
    finalNode.arguments[2] = {
      kind: "call",
      callee: "mystery",
      arguments: [
        {
          kind: "literal",
          inferredType: scalar("money_cents"),
          valueCents: 100,
        },
      ],
      inferredType: scalar("money_cents"),
    };

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_UNKNOWN_FUNCTION",
    );
  });

  it("rejects an unknown operator hidden in an unselected branch during preflight", () => {
    const ast = structuredClone(
      compileFormula(
        "money_result({ final: if(true, yuan(1), yuan(2) + yuan(3)) })",
      ),
    );
    const finalNode = readFinalNode(ast);
    if (
      finalNode.kind !== "call" ||
      finalNode.arguments[2]?.kind !== "binary"
    ) {
      throw new Error("Expected an unselected compiled binary expression");
    }
    finalNode.arguments[2].operator = "**";

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_UNKNOWN_OPERATOR",
    );
  });

  it("rejects a malformed node hidden in an unselected branch during preflight", () => {
    const ast = structuredClone(
      compileFormula("money_result({ final: if(true, yuan(1), yuan(2)) })"),
    );
    const finalNode = readFinalNode(ast);
    if (finalNode.kind !== "call" || finalNode.callee !== "if") {
      throw new Error("Expected a compiled if call");
    }
    finalNode.arguments[2] = { kind: "mystery" } as unknown as CompiledAstNode;

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST",
    );
  });

  it("rejects forged array inferred types recursively", () => {
    const makeAst = () =>
      structuredClone(
        compileFormula(`money_result({
          final: if(in(streamer_level, ["S", "A"]), yuan(1), yuan(2))
        })`),
      );

    const wrongContainerType = makeAst();
    const wrongContainerFinal = readFinalNode(wrongContainerType);
    if (
      wrongContainerFinal.kind !== "call" ||
      wrongContainerFinal.arguments[0]?.kind !== "call" ||
      wrongContainerFinal.arguments[0].arguments[1]?.kind !== "array"
    ) {
      throw new Error("Expected a compiled in array");
    }
    wrongContainerFinal.arguments[0].arguments[1].inferredType =
      scalar("money_cents");

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongContainerType,
          variables: { streamer_level: stringValue("S") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );

    const wrongItemType = makeAst();
    const wrongItemFinal = readFinalNode(wrongItemType);
    if (
      wrongItemFinal.kind !== "call" ||
      wrongItemFinal.arguments[0]?.kind !== "call" ||
      wrongItemFinal.arguments[0].arguments[1]?.kind !== "array" ||
      wrongItemFinal.arguments[0].arguments[1].inferredType.kind !== "array"
    ) {
      throw new Error("Expected a compiled in array");
    }
    wrongItemFinal.arguments[0].arguments[1].inferredType.itemType =
      scalar("integer");

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongItemType,
          variables: { streamer_level: stringValue("S") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );

    const wrongChildType = makeAst();
    const wrongChildFinal = readFinalNode(wrongChildType);
    if (
      wrongChildFinal.kind !== "call" ||
      wrongChildFinal.arguments[0]?.kind !== "call" ||
      wrongChildFinal.arguments[0].arguments[1]?.kind !== "array"
    ) {
      throw new Error("Expected a compiled in array");
    }
    wrongChildFinal.arguments[0].arguments[1].elements[1] = {
      kind: "literal",
      inferredType: scalar("integer"),
      value: 1,
    };

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongChildType,
          variables: { streamer_level: stringValue("S") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("rejects forged object inferred types recursively", () => {
    const makeAst = () =>
      structuredClone(
        compileFormula(`money_result({
          final: percent(yuan(1), evidence_multiplier(evidence_level, {
            green: rate_percent(100),
            yellow: rate_percent(80),
            red: rate_percent(0)
          }))
        })`),
      );
    const readRates = (ast: CompiledAstNode) => {
      const finalNode = readFinalNode(ast);
      if (
        finalNode.kind !== "call" ||
        finalNode.arguments[1]?.kind !== "call" ||
        finalNode.arguments[1].arguments[1]?.kind !== "object"
      ) {
        throw new Error("Expected a compiled evidence rate object");
      }
      return finalNode.arguments[1].arguments[1];
    };

    const wrongContainerType = makeAst();
    readRates(wrongContainerType).inferredType = scalar("money_cents");
    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongContainerType,
          variables: { evidence_level: stringValue("green") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );

    const wrongFieldSet = makeAst();
    const wrongFieldSetRates = readRates(wrongFieldSet);
    if (wrongFieldSetRates.inferredType.kind !== "object") {
      throw new Error("Expected an object inferred type");
    }
    delete wrongFieldSetRates.inferredType.fields.red;
    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongFieldSet,
          variables: { evidence_level: stringValue("green") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );

    const wrongFieldType = makeAst();
    const wrongFieldTypeRates = readRates(wrongFieldType);
    if (wrongFieldTypeRates.inferredType.kind !== "object") {
      throw new Error("Expected an object inferred type");
    }
    wrongFieldTypeRates.inferredType.fields.green = scalar("money_cents");
    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: wrongFieldType,
          variables: { evidence_level: stringValue("green") },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("rejects a forged declared type in an unselected binary subtree", () => {
    const ast = structuredClone(
      compileFormula(
        "money_result({ final: if(true, yuan(1), yuan(2) + yuan(3)) })",
      ),
    );
    const finalNode = readFinalNode(ast);
    if (
      finalNode.kind !== "call" ||
      finalNode.arguments[2]?.kind !== "binary"
    ) {
      throw new Error("Expected an unselected compiled binary expression");
    }
    finalNode.arguments[2].inferredType = scalar("boolean");

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("throws stable issues for missing variables and parameters", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          "money_result({ final: yuan(1) * system_minutes })",
        ),
      "EXECUTION_MISSING_VARIABLE",
    );

    expectExecutionIssue(
      () =>
        executeFormula(
          'money_result({ final: parameter("bonus") })',
          {
            parameterDefinitions: [
              { name: "bonus", valueType: scalar("money_cents") },
            ],
          },
        ),
      "EXECUTION_MISSING_PARAMETER",
    );
  });

  it("rejects wrong variable and parameter runtime types", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          "money_result({ final: yuan(1) * system_minutes })",
          { variableValues: { system_minutes: stringValue("60") } },
        ),
      "EXECUTION_RUNTIME_TYPE_MISMATCH",
    );

    expectExecutionIssue(
      () =>
        executeFormula(
          'money_result({ final: parameter("bonus") })',
          {
            parameterDefinitions: [
              { name: "bonus", valueType: scalar("money_cents") },
            ],
            parameterValues: { bonus: rate(5_000) },
          },
        ),
      "EXECUTION_RUNTIME_TYPE_MISMATCH",
    );
  });

  it("rejects unsafe runtime integers through the Task 3 schema", () => {
    const ast = compileFormula(
      "money_result({ final: yuan(1) * system_minutes })",
    );

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: {
            system_minutes: {
              type: "integer",
              value: Number.MAX_SAFE_INTEGER + 1,
            },
          },
          parameters: {},
        }),
      "EXECUTION_INVALID_INPUT",
    );
  });

  it.each([
    [
      "unknown node",
      { kind: "mystery" },
      "EXECUTION_INVALID_AST",
    ],
    [
      "malformed money literal",
      {
        kind: "literal",
        inferredType: scalar("money_cents"),
        value: 100,
      },
      "EXECUTION_INVALID_AST",
    ],
  ])("fails closed for an %s", (_label, invalidNode, code) => {
    const ast = replaceFinalNode(
      compileFormula("money_result({ final: yuan(1) })"),
      invalidNode as CompiledAstNode,
    );

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      code,
    );
  });

  it("rejects unknown compiled calls even when structurally schema-valid", () => {
    const ast = replaceFinalNode(
      compileFormula("money_result({ final: yuan(1) })"),
      {
        kind: "call",
        callee: "mystery",
        arguments: [],
        inferredType: scalar("money_cents"),
      },
    );

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_UNKNOWN_FUNCTION",
    );
  });

  it("rejects unknown compiled operators even when structurally schema-valid", () => {
    const moneyType = scalar("money_cents");
    const ast = replaceFinalNode(
      compileFormula("money_result({ final: yuan(1) })"),
      {
        kind: "binary",
        operator: "**",
        left: { kind: "literal", inferredType: moneyType, valueCents: 100 },
        right: { kind: "literal", inferredType: moneyType, valueCents: 100 },
        inferredType: moneyType,
      },
    );

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_UNKNOWN_OPERATOR",
    );
  });

  it("requires money_result with a final component at the root", () => {
    const ast: CompiledAstNode = {
      kind: "literal",
      inferredType: scalar("money_cents"),
      valueCents: 100,
    };

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("rejects a schema-valid money_result with a missing or duplicate final component", () => {
    const missing = structuredClone(
      compileFormula("money_result({ final: yuan(1) })"),
    );
    if (missing.kind !== "call" || missing.arguments[0]?.kind !== "object") {
      throw new Error("Expected a compiled money_result AST");
    }
    missing.arguments[0].entries = [];
    if (missing.arguments[0].inferredType.kind === "object") {
      missing.arguments[0].inferredType.fields = {};
    }
    if (missing.inferredType.kind === "object") {
      missing.inferredType.fields = {};
    }

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({ ast: missing, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );

    const duplicate = structuredClone(
      compileFormula("money_result({ final: yuan(1) })"),
    );
    if (duplicate.kind !== "call" || duplicate.arguments[0]?.kind !== "object") {
      throw new Error("Expected a compiled money_result AST");
    }
    const finalEntry = duplicate.arguments[0].entries[0];
    if (!finalEntry) {
      throw new Error("Expected a final component");
    }
    duplicate.arguments[0].entries.push(structuredClone(finalEntry));

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: duplicate,
          variables: {},
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("treats an omitted final tier upto as unbounded", () => {
    expect(
      executeFormula(
        `money_result({ final: tiered(system_minutes, [
          { upto: 60, rate_per_hour: yuan(60) },
          { upto: null, rate_per_hour: yuan(120) }
        ]) })`,
        { variableValues: { system_minutes: integer(90) } },
      ).componentsCents.final,
    ).toBe(12_000);
  });

  it("rejects an omitted upto before the final tier", () => {
    const ast = compileFormula(`money_result({
      final: tiered(system_minutes, [
        { upto: 60, rate_per_hour: yuan(60) },
        { upto: null, rate_per_hour: yuan(120) }
      ])
    })`);
    const copy = structuredClone(ast);
    if (
      copy.kind !== "call" ||
      copy.arguments[0]?.kind !== "object" ||
      copy.arguments[0].entries[0]?.value.kind !== "call" ||
      copy.arguments[0].entries[0].value.arguments[1]?.kind !== "array" ||
      copy.arguments[0].entries[0].value.arguments[1].elements[0]?.kind !==
        "object"
    ) {
      throw new Error("Expected tiered compiled AST");
    }
    const firstTier =
      copy.arguments[0].entries[0].value.arguments[1].elements[0];
    firstTier.entries = firstTier.entries.filter(
      (entry) => entry.key !== "upto",
    );
    if (firstTier.inferredType.kind === "object") {
      delete firstTier.inferredType.fields.upto;
    }

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: copy,
          variables: { system_minutes: integer(90) },
          parameters: {},
        }),
      "EXECUTION_INVALID_AST_CONTEXT",
    );
  });

  it("rejects non-increasing dynamic tier thresholds", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          `money_result({ final: tiered(system_minutes, [
            { upto: parameter("first"), rate_per_hour: yuan(60) },
            { upto: parameter("second"), rate_per_hour: yuan(120) },
            { upto: null, rate_per_hour: yuan(180) }
          ]) })`,
          {
            variableValues: { system_minutes: integer(90) },
            parameterDefinitions: [
              { name: "first", valueType: scalar("integer") },
              { name: "second", valueType: scalar("integer") },
            ],
            parameterValues: {
              first: integer(100),
              second: integer(50),
            },
          },
        ),
      "EXECUTION_INVALID_CONTEXT",
    );
  });

  it("does not read inherited values or invoke runtime accessors", () => {
    const ast = compileFormula(
      "money_result({ final: yuan(1) * system_minutes })",
    );
    let reads = 0;
    const accessorVariables = {};
    Object.defineProperty(accessorVariables, "system_minutes", {
      enumerable: true,
      get() {
        reads += 1;
        return integer(60);
      },
    });

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: accessorVariables as Record<string, TypedRuntimeValue>,
          parameters: {},
        }),
      "EXECUTION_INVALID_INPUT",
    );
    expect(reads).toBe(0);

    const inheritedVariables = Object.create({
      system_minutes: integer(60),
    }) as Record<string, TypedRuntimeValue>;
    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: inheritedVariables,
          parameters: {},
        }),
      "EXECUTION_INVALID_INPUT",
    );
  });

  it("does not invoke accessors nested inside runtime values", () => {
    const ast = compileFormula(
      "money_result({ final: yuan(1) * system_minutes })",
    );
    let reads = 0;
    const accessorValue = {};
    Object.defineProperty(accessorValue, "type", {
      enumerable: true,
      get() {
        reads += 1;
        return "integer";
      },
    });
    Object.defineProperty(accessorValue, "value", {
      enumerable: true,
      value: 60,
    });

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: {
            system_minutes: accessorValue as TypedRuntimeValue,
          },
          parameters: {},
        }),
      "EXECUTION_INVALID_INPUT",
    );
    expect(reads).toBe(0);
  });

  it("does not invoke accessors nested inside the compiled AST", () => {
    const ast = structuredClone(
      compileFormula("money_result({ final: yuan(1) })"),
    );
    if (ast.kind !== "call" || ast.arguments[0]?.kind !== "object") {
      throw new Error("Expected a compiled money_result AST");
    }
    const finalEntry = ast.arguments[0].entries[0];
    if (!finalEntry) {
      throw new Error("Expected a final component");
    }
    let reads = 0;
    const accessorNode = {};
    Object.defineProperty(accessorNode, "kind", {
      enumerable: true,
      get() {
        reads += 1;
        return "literal";
      },
    });
    finalEntry.value = accessorNode as CompiledAstNode;

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_INVALID_AST",
    );
    expect(reads).toBe(0);
  });

  it("rejects inherited compiled AST nodes", () => {
    const inheritedAst = Object.create(
      compileFormula("money_result({ final: yuan(1) })"),
    ) as CompiledAstNode;

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast: inheritedAst,
          variables: {},
          parameters: {},
        }),
      "EXECUTION_INVALID_AST",
    );
  });

  it.each([
    { ast: null, variables: {}, parameters: {} },
    {
      ast: { kind: "literal" },
      variables: null,
      parameters: {},
    },
    {
      ast: { kind: "literal" },
      variables: {},
      parameters: [],
    },
  ])("rejects malformed outer runtime context %#", (input) => {
    expectExecutionIssue(
      () =>
        executeCompiledCustomRule(
          input as unknown as Parameters<typeof executeCompiledCustomRule>[0],
        ),
      input.ast === null ? "EXECUTION_INVALID_AST" : "EXECUTION_INVALID_INPUT",
    );
  });

  it("does not invoke an accessor on the outer execution input", () => {
    let reads = 0;
    const input = { variables: {}, parameters: {} };
    Object.defineProperty(input, "ast", {
      enumerable: true,
      get() {
        reads += 1;
        return compileFormula("money_result({ final: yuan(1) })");
      },
    });

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule(
          input as unknown as Parameters<typeof executeCompiledCustomRule>[0],
        ),
      "EXECUTION_INVALID_INPUT",
    );
    expect(reads).toBe(0);
  });

  it("rejects proxies at every engine trust-boundary layer without invoking traps", () => {
    const minuteAst = compileFormula(
      "money_result({ final: yuan(1) * system_minutes })",
    );
    const baseInput = {
      ast: minuteAst,
      variables: { system_minutes: integer(60) },
      parameters: {},
    };
    const outerInput = countingProxy(baseInput);
    const variables = countingProxy(baseInput.variables);
    const parameters = countingProxy(baseInput.parameters);
    const rootAst = countingProxy(minuteAst);
    const nestedRuntimeValue = countingProxy(integer(60) as object);

    const tagsAst = compileFormula(`money_result({
      final: if(contains(project_tags, "featured"), yuan(1), yuan(0))
    })`);
    const nestedItems = countingProxy([stringValue("featured")]);

    const nestedAst = structuredClone(minuteAst);
    if (
      nestedAst.kind !== "call" ||
      nestedAst.arguments[0]?.kind !== "object" ||
      nestedAst.arguments[0].entries[0]?.value.kind !== "binary"
    ) {
      throw new Error("Expected a compiled multiplication");
    }
    const nestedAstNode = countingProxy(
      nestedAst.arguments[0].entries[0].value.left,
    );
    nestedAst.arguments[0].entries[0].value.left = nestedAstNode.proxy;

    const cases: Array<{
      operation: () => unknown;
      code: string;
      reads: () => number;
    }> = [
      {
        operation: () =>
          executeCompiledCustomRule(
            outerInput.proxy as Parameters<typeof executeCompiledCustomRule>[0],
          ),
        code: "EXECUTION_INVALID_INPUT",
        reads: outerInput.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ...baseInput,
            variables: variables.proxy,
          }),
        code: "EXECUTION_INVALID_INPUT",
        reads: variables.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ...baseInput,
            parameters: parameters.proxy,
          }),
        code: "EXECUTION_INVALID_INPUT",
        reads: parameters.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ...baseInput,
            ast: rootAst.proxy,
          }),
        code: "EXECUTION_INVALID_AST",
        reads: rootAst.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ...baseInput,
            variables: {
              system_minutes:
                nestedRuntimeValue.proxy as TypedRuntimeValue,
            },
          }),
        code: "EXECUTION_INVALID_INPUT",
        reads: nestedRuntimeValue.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ast: tagsAst,
            variables: {
              project_tags: {
                type: "array",
                items:
                  nestedItems.proxy as unknown as TypedRuntimeValue[],
              },
            },
            parameters: {},
          }),
        code: "EXECUTION_INVALID_INPUT",
        reads: nestedItems.reads,
      },
      {
        operation: () =>
          executeCompiledCustomRule({
            ast: nestedAst,
            variables: { system_minutes: integer(60) },
            parameters: {},
          }),
        code: "EXECUTION_INVALID_AST",
        reads: nestedAstNode.reads,
      },
    ];

    for (const testCase of cases) {
      expectExecutionIssue(testCase.operation, testCase.code);
      expect(testCase.reads()).toBe(0);
    }
  });
});

describe("executeCompiledCustomRule limits", () => {
  it.each([
    [{ maxSteps: 0, maxDepth: 20 }],
    [{ maxSteps: 100, maxDepth: -1 }],
    [{ maxSteps: Number.POSITIVE_INFINITY, maxDepth: 20 }],
    [{ maxSteps: 100, maxDepth: Number.NaN }],
    [{ maxSteps: Number.MAX_SAFE_INTEGER + 1, maxDepth: 20 }],
    [{ maxSteps: 1_000_000, maxDepth: 20 }],
    [{ maxSteps: 100, maxDepth: 1_000_000 }],
  ])("rejects invalid or disabling limits", (limits) => {
    expectExecutionIssue(
      () =>
        executeFormula("money_result({ final: yuan(1) })", { limits }),
      "EXECUTION_INVALID_LIMITS",
    );
  });

  it("enforces max steps", () => {
    expectExecutionIssue(
      () =>
        executeFormula("money_result({ final: yuan(1) + yuan(2) })", {
          limits: { maxSteps: 1, maxDepth: 20 },
        }),
      "EXECUTION_MAX_STEPS",
    );
  });

  it("enforces max depth", () => {
    expectExecutionIssue(
      () =>
        executeFormula(
          "money_result({ final: min(max(yuan(1), yuan(2)), yuan(3)) })",
          { limits: { maxSteps: 100, maxDepth: 1 } },
        ),
      "EXECUTION_MAX_DEPTH",
    );
  });

  it("enforces a finite default max depth when limits are omitted", () => {
    const moneyType = scalar("money_cents");
    let finalNode: CompiledAstNode = {
      kind: "literal",
      inferredType: moneyType,
      valueCents: 100,
    };
    for (let index = 0; index < 80; index += 1) {
      finalNode = {
        kind: "unary",
        operator: "+",
        argument: finalNode,
        inferredType: moneyType,
      };
    }
    const ast = replaceFinalNode(
      compileFormula("money_result({ final: yuan(1) })"),
      finalNode,
    );

    expectExecutionIssue(
      () => executeCompiledCustomRule({ ast, variables: {}, parameters: {} }),
      "EXECUTION_MAX_DEPTH",
    );
  });

  it("exhausts bounded snapshot work before traversing a huge runtime array", () => {
    const ast = compileFormula(`money_result({
      final: if(contains(project_tags, "target"), yuan(1), yuan(0))
    })`);
    const items = Array.from({ length: 50_000 }, () => stringValue("other"));
    const sentinel = countingProxy(stringValue("target") as object);
    items[100] = sentinel.proxy as TypedRuntimeValue;

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: { project_tags: { type: "array", items } },
          parameters: {},
          limits: { maxSteps: 8, maxDepth: 20 },
        }),
      "EXECUTION_MAX_STEPS",
    );
    expect(sentinel.reads()).toBe(0);
  });

  it("charges primitive and null snapshot visits before schema validation", () => {
    const ast = compileFormula(`money_result({
      final: if(contains(project_tags, "target"), yuan(1), yuan(0))
    })`);
    const junk = Array.from({ length: 50_000 }, (_, index) =>
      index % 2 === 0 ? "junk" : null,
    ) as unknown as TypedRuntimeValue[];

    expectExecutionIssue(
      () =>
        executeCompiledCustomRule({
          ast,
          variables: {
            project_tags: { type: "array", items: junk },
          },
          parameters: {},
          limits: { maxSteps: 8, maxDepth: 20 },
        }),
      "EXECUTION_MAX_STEPS",
    );
  });

  it("keeps maxSteps eight usable for a minimal valid execution", () => {
    expect(
      executeFormula("money_result({ final: yuan(1) })", {
        limits: { maxSteps: 8, maxDepth: 20 },
      }).componentsCents.final,
    ).toBe(100);
  });

  it("allows normal small arrays within the work budget", () => {
    expect(
      executeFormula(
        `money_result({
          final: if(contains(project_tags, "target"), yuan(1), yuan(0))
        })`,
        {
          variableValues: {
            project_tags: stringArray("other", "target"),
          },
          limits: { maxSteps: 100, maxDepth: 20 },
        },
      ).componentsCents.final,
    ).toBe(100);
  });

  it("bounds snapshot and preflight work with caller maxSteps", () => {
    const ast = structuredClone(
      compileFormula(`money_result({
        final: if(true, yuan(1), if(in(streamer_level, ["S"]), yuan(2), yuan(3)))
      })`),
    );
    const finalNode = readFinalNode(ast);
    if (
      finalNode.kind !== "call" ||
      finalNode.arguments[2]?.kind !== "call" ||
      finalNode.arguments[2].arguments[0]?.kind !== "call" ||
      finalNode.arguments[2].arguments[0].arguments[1]?.kind !== "array"
    ) {
      throw new Error("Expected a hidden compiled in array");
    }
    const candidates = finalNode.arguments[2].arguments[0].arguments[1];
    candidates.elements = Array.from({ length: 100 }, () => ({
      kind: "literal" as const,
      inferredType: scalar("string"),
      value: "S",
    }));

    expectExecutionIssue(
      () =>
        preflightCompiledCustomRuleAst(ast, {
          maxSteps: 8,
          maxDepth: 20,
        }),
      "EXECUTION_MAX_STEPS",
    );
  });

  it("charges deep equality work against maxSteps", () => {
    const fieldNames = Array.from(
      { length: 40 },
      (_, index) => `field_${index.toString().padStart(2, "0")}`,
    );
    const valueType: RuntimeValueType = {
      kind: "object",
      fields: Object.fromEntries(
        fieldNames.map((name) => [name, scalar("string")]),
      ),
    };
    const objectValue = (lastValue: string): TypedRuntimeValue => ({
      type: "object",
      fields: Object.fromEntries(
        fieldNames.map((name, index) => [
          name,
          stringValue(index === fieldNames.length - 1 ? lastValue : "same"),
        ]),
      ),
    });
    const candidateExpression = Array.from(
      { length: 5 },
      () => 'parameter("candidate")',
    ).join(", ");

    expectExecutionIssue(
      () =>
        executeFormula(
          `money_result({
            final: if(
              in(parameter("needle"), [${candidateExpression}]),
              yuan(1),
              yuan(0)
            )
          })`,
          {
            parameterDefinitions: [
              { name: "needle", valueType },
              { name: "candidate", valueType },
            ],
            parameterValues: {
              needle: objectValue("needle"),
              candidate: objectValue("candidate"),
            },
            limits: { maxSteps: 100, maxDepth: 20 },
          },
        ),
      "EXECUTION_MAX_STEPS",
    );
  });
});
