import jsep from "jsep";
import { describe, expect, it } from "vitest";

import { compiledAstNodeSchema } from "./custom-rule-contract";
import type {
  CustomRuleExecutionGrain,
  CustomRuleScope,
  RuntimeScalarType,
  RuntimeValueType,
} from "./custom-rule-types";
import {
  validateCustomRuleFormula,
  type ValidateCustomRuleFormulaOptions,
} from "./custom-rule-validator";

const scalar = (scalarType: RuntimeScalarType): RuntimeValueType => ({
  kind: "scalar",
  scalarType,
});

const DEFAULT_OPTIONS: ValidateCustomRuleFormulaOptions = {
  scope: "payable",
  executionGrain: "report",
};

function options(
  scope: CustomRuleScope = "payable",
  executionGrain: CustomRuleExecutionGrain = "report",
  overrides: Partial<ValidateCustomRuleFormulaOptions> = {},
): ValidateCustomRuleFormulaOptions {
  return { scope, executionGrain, ...overrides };
}

function nestedArrayType(depth: number): RuntimeValueType {
  let valueType: RuntimeValueType = scalar("money_cents");
  for (let currentDepth = 1; currentDepth < depth; currentDepth += 1) {
    valueType = { kind: "array", itemType: valueType };
  }
  return valueType;
}

function objectTypeWithNodeCount(nodeCount: number): RuntimeValueType {
  return {
    kind: "object",
    fields: Object.fromEntries(
      Array.from({ length: nodeCount - 1 }, (_, index) => [
        "field_" + index,
        scalar("money_cents"),
      ]),
    ),
  };
}

function optionsForRuntimeValueType(
  valueType: unknown,
): ValidateCustomRuleFormulaOptions {
  return options("payable", "report", {
    parameters: [
      {
        name: "nested_type",
        valueType: valueType as RuntimeValueType,
      },
    ],
  });
}

function expectValidationSuccess(
  formula: string,
  validationOptions: ValidateCustomRuleFormulaOptions = DEFAULT_OPTIONS,
) {
  const result = validateCustomRuleFormula(formula, validationOptions);

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(
      `Expected validation success, received ${result.issues[0]?.code}`,
    );
  }
  expect(compiledAstNodeSchema.safeParse(result.compiledAst).success).toBe(true);
  expect(result.formulaHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result;
}

function expectValidationIssue(
  formula: string,
  code: string,
  validationOptions: ValidateCustomRuleFormulaOptions = DEFAULT_OPTIONS,
) {
  const result = validateCustomRuleFormula(formula, validationOptions);

  expect(result).toMatchObject({
    ok: false,
    issues: [{ code }],
  });
  if (result.ok) {
    throw new Error("Expected validation failure");
  }
  expect(result.issues[0]?.span).toEqual({
    start: expect.any(Number),
    end: expect.any(Number),
  });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result.issues[0];
}

describe("validateCustomRuleFormula runtime options", () => {
  it.each([
    [
      "scope",
      { scope: "bogus", executionGrain: "report" },
    ],
    [
      "execution grain",
      { scope: "payable", executionGrain: "bogus" },
    ],
    [
      "unknown option key",
      { scope: "payable", executionGrain: "report", extra: true },
    ],
    [
      "non-array parameters",
      { scope: "payable", executionGrain: "report", parameters: "bad" },
    ],
    [
      "parameter identifier",
      {
        scope: "payable",
        executionGrain: "report",
        parameters: [
          { name: "bad-name", valueType: scalar("money_cents") },
        ],
      },
    ],
    [
      "parameter value type",
      {
        scope: "payable",
        executionGrain: "report",
        parameters: [
          {
            name: "bonus",
            valueType: { kind: "scalar", scalarType: "bogus" },
          },
        ],
      },
    ],
    [
      "unknown parameter key",
      {
        scope: "payable",
        executionGrain: "report",
        parameters: [
          {
            name: "bonus",
            valueType: scalar("money_cents"),
            extra: true,
          },
        ],
      },
    ],
  ])("rejects invalid %s before parsing", (_label, invalidOptions) => {
    const formula = "record.amount";
    const result = validateCustomRuleFormula(
      formula,
      invalidOptions as unknown as ValidateCustomRuleFormulaOptions,
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: "VALIDATION_INVALID_OPTIONS",
          message: "Validation options are invalid",
          span: { start: 0, end: formula.length },
        },
      ],
    });
  });

  it("enforces parameter type depth without recursive overflow", () => {
    const formula = "money_result({ final: yuan(1) })";

    expectValidationSuccess(
      formula,
      options("payable", "report", {
        parameters: [{ name: "deep", valueType: nestedArrayType(20) }],
      }),
    );
    expectValidationIssue(
      formula,
      "VALIDATION_PARAMETER_TYPE_LIMIT",
      options("payable", "report", {
        parameters: [{ name: "deep", valueType: nestedArrayType(21) }],
      }),
    );
    expectValidationIssue(
      formula,
      "VALIDATION_PARAMETER_TYPE_LIMIT",
      options("payable", "report", {
        parameters: [{ name: "deep", valueType: nestedArrayType(2_000) }],
      }),
    );
  });

  it("enforces the aggregate parameter type node budget at 300", () => {
    const formula = "money_result({ final: yuan(1) })";

    expectValidationSuccess(
      formula,
      options("payable", "report", {
        parameters: [
          { name: "wide", valueType: objectTypeWithNodeCount(300) },
        ],
      }),
    );
    expectValidationIssue(
      formula,
      "VALIDATION_PARAMETER_TYPE_LIMIT",
      options("payable", "report", {
        parameters: [
          { name: "wide", valueType: objectTypeWithNodeCount(301) },
        ],
      }),
    );
  });

  it("enforces the parameter count budget at 300", () => {
    const formula = "money_result({ final: yuan(1) })";
    const parameters = Array.from({ length: 301 }, (_, index) => ({
      name: "parameter_" + index,
      valueType: scalar("money_cents"),
    }));

    expectValidationSuccess(
      formula,
      options("payable", "report", { parameters: parameters.slice(0, 300) }),
    );
    expectValidationIssue(
      formula,
      "VALIDATION_PARAMETER_LIMIT",
      options("payable", "report", { parameters }),
    );
  });

  it("ignores Object.prototype parameters and restores the test pollution", () => {
    const propertyName = "parameters";
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      propertyName,
    );

    try {
      Object.defineProperty(Object.prototype, propertyName, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: [
          {
            name: "prototype_polluted_bonus",
            valueType: scalar("money_cents"),
          },
        ],
      });

      expect(
        validateCustomRuleFormula(
          "money_result({ final: yuan(1) })",
          DEFAULT_OPTIONS,
        ),
      ).toMatchObject({ ok: true });
      expectValidationIssue(
        'money_result({ final: parameter("prototype_polluted_bonus") })',
        "VALIDATION_UNKNOWN_PARAMETER",
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          Object.prototype,
          propertyName,
          originalDescriptor,
        );
      } else {
        delete (Object.prototype as Record<string, unknown>)[propertyName];
      }
    }
  });

  it("rejects inherited scope and execution grain properties", () => {
    const inheritedOptions = Object.create({
      scope: "payable",
      executionGrain: "report",
    }) as ValidateCustomRuleFormulaOptions;

    expectValidationIssue(
      "money_result({ final: yuan(1) })",
      "VALIDATION_INVALID_OPTIONS",
      inheritedOptions,
    );
  });

  it("rejects own scope and grain accessors without invoking them", () => {
    let accessorReads = 0;
    const accessorOptions = {};
    Object.defineProperties(accessorOptions, {
      scope: {
        enumerable: true,
        get() {
          accessorReads += 1;
          return "payable";
        },
      },
      executionGrain: {
        enumerable: true,
        get() {
          accessorReads += 1;
          return "report";
        },
      },
    });

    expectValidationIssue(
      "money_result({ final: yuan(1) })",
      "VALIDATION_INVALID_OPTIONS",
      accessorOptions as ValidateCustomRuleFormulaOptions,
    );
    expect(accessorReads).toBe(0);
  });

  it("rejects an own parameters accessor without invoking it", () => {
    let accessorReads = 0;
    const accessorOptions = {
      scope: "payable",
      executionGrain: "report",
    };
    Object.defineProperty(accessorOptions, "parameters", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return [];
      },
    });

    expectValidationIssue(
      "money_result({ final: yuan(1) })",
      "VALIDATION_INVALID_OPTIONS",
      accessorOptions as ValidateCustomRuleFormulaOptions,
    );
    expect(accessorReads).toBe(0);
  });

  it("never invokes nested RuntimeValueType accessors", () => {
    let getterReads = 0;
    let setterWrites = 0;

    const kindAccessor = { scalarType: "money_cents" };
    Object.defineProperty(kindAccessor, "kind", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "scalar";
      },
    });
    const nestedKindAccessor = {
      kind: "array",
      itemType: kindAccessor,
    };

    const itemTypeAccessor = { kind: "array" };
    Object.defineProperty(itemTypeAccessor, "itemType", {
      enumerable: true,
      get() {
        getterReads += 1;
        return scalar("money_cents");
      },
    });

    const fieldsAccessor = { kind: "object" };
    Object.defineProperty(fieldsAccessor, "fields", {
      enumerable: true,
      get() {
        getterReads += 1;
        return { nested: scalar("money_cents") };
      },
    });

    const accessorFields = {};
    Object.defineProperty(accessorFields, "nested", {
      enumerable: true,
      get() {
        getterReads += 1;
        return scalar("money_cents");
      },
    });
    const fieldEntryAccessor = {
      kind: "object",
      fields: accessorFields,
    };

    const setterOnly = { kind: "array" };
    Object.defineProperty(setterOnly, "itemType", {
      enumerable: true,
      set(value: unknown) {
        void value;
        setterWrites += 1;
      },
    });

    for (const valueType of [
      nestedKindAccessor,
      itemTypeAccessor,
      fieldsAccessor,
      fieldEntryAccessor,
      setterOnly,
    ]) {
      expectValidationIssue(
        "money_result({ final: yuan(1) })",
        "VALIDATION_INVALID_OPTIONS",
        optionsForRuntimeValueType(valueType),
      );
    }

    expect(getterReads).toBe(0);
    expect(setterWrites).toBe(0);
  });

  it("rejects unsafe RuntimeValueType object shapes", () => {
    const symbolKey = {
      kind: "scalar",
      scalarType: "money_cents",
      [Symbol("extra")]: true,
    };
    const nonEnumerableExtra = {
      kind: "scalar",
      scalarType: "money_cents",
    };
    Object.defineProperty(nonEnumerableExtra, "hidden", {
      enumerable: false,
      value: true,
    });
    const nonEnumerableRequired = { kind: "scalar" };
    Object.defineProperty(nonEnumerableRequired, "scalarType", {
      enumerable: false,
      value: "money_cents",
    });
    const extraField = {
      kind: "scalar",
      scalarType: "money_cents",
      extra: true,
    };
    class RuntimeTypeClass {
      readonly kind = "scalar";
      readonly scalarType = "money_cents";
    }

    for (const valueType of [
      symbolKey,
      nonEnumerableExtra,
      nonEnumerableRequired,
      extraField,
      new RuntimeTypeClass(),
    ]) {
      expectValidationIssue(
        "money_result({ final: yuan(1) })",
        "VALIDATION_INVALID_OPTIONS",
        optionsForRuntimeValueType(valueType),
      );
    }
  });

  it("accepts legal null-prototype RuntimeValueType objects", () => {
    const itemType = Object.assign(Object.create(null), {
      kind: "scalar",
      scalarType: "money_cents",
    }) as RuntimeValueType;
    const valueType = Object.assign(Object.create(null), {
      kind: "array",
      itemType,
    }) as RuntimeValueType;

    expectValidationSuccess(
      "money_result({ final: yuan(1) })",
      optionsForRuntimeValueType(valueType),
    );
  });
});

describe("validateCustomRuleFormula scope contract", () => {
  it("uses the explicitly requested scope when the formula has no prefix", () => {
    expectValidationSuccess(
      "money_result({ final: base_hourly_rate })",
      options("payable"),
    );
    expectValidationIssue(
      "money_result({ final: base_hourly_rate })",
      "VALIDATION_VARIABLE_SCOPE",
      options("receivable"),
    );
  });

  it("accepts a matching prefix and rejects a mismatched prefix", () => {
    expectValidationSuccess(
      "payable = money_result({ final: yuan(80) })",
      options("payable"),
    );
    const issue = expectValidationIssue(
      "receivable = money_result({ final: yuan(80) })",
      "VALIDATION_SCOPE_MISMATCH",
      options("payable"),
    );

    expect(issue.span).toEqual({ start: 0, end: "receivable".length });
  });

  it.each([
    ["external_cost", "external_cost = cost_items([])"],
    ["reconciliation", 'reconciliation = block_if(true, "stop")'],
  ] as const)("keeps the %s scope disabled in Phase 1", (scope, formula) => {
    expectValidationIssue(
      formula,
      "VALIDATION_SCOPE_DISABLED",
      options(scope),
    );
  });
});

describe("typed unit compilation", () => {
  it("lowers yuan and percentage literals and keeps percent money-typed", () => {
    const result = expectValidationSuccess(`money_result({
      base: yuan(80),
      commission: percent(yuan(100), rate_percent(80)),
      final: base + commission
    })`);
    const serialized = JSON.stringify(result.compiledAst);

    expect(serialized).toContain('"valueCents":8000');
    expect(serialized).toContain('"valueCents":10000');
    expect(serialized).toContain('"valueBps":8000');
    expect(serialized).not.toContain('"callee":"yuan"');
    expect(serialized).not.toContain('"callee":"rate_percent"');
    expect(serialized).toContain('"callee":"percent"');
    expect(serialized).toContain('"scalarType":"money_cents"');
  });

  it("uses the strict Task 2 decimal adapters", () => {
    const result = expectValidationSuccess(
      "money_result({ final: yuan(0.01) })",
    );

    expect(JSON.stringify(result.compiledAst)).toContain('"valueCents":1');
    expectValidationIssue(
      "money_result({ final: yuan(0.001) })",
      "VALIDATION_INVALID_UNIT_LITERAL",
    );
  });

  it("allows money plus money and rejects money plus rate", () => {
    expectValidationSuccess(
      "money_result({ final: yuan(80) + yuan(20) })",
    );
    expectValidationIssue(
      "money_result({ final: yuan(80) + rate_percent(20) })",
      "VALIDATION_UNIT_MISMATCH",
    );
  });

  it.each([
    ["division", "money_result({ final: yuan(1) * (1 / 0) })", "0"],
    ["remainder", "money_result({ final: yuan(1) * (5 % 0) })", "0"],
    [
      "negative zero",
      "money_result({ final: yuan(1) * (1 / (-0)) })",
      "(-0)",
    ],
    [
      "positive zero",
      "money_result({ final: yuan(1) * (1 / (+0)) })",
      "(+0)",
    ],
    [
      "parenthesized zero",
      "money_result({ final: yuan(1) * (1 / (((0)))) })",
      "(((0)))",
    ],
    [
      "rate literal zero",
      "money_result({ final: yuan(1) * (rate_percent(1) / rate_percent(0)) })",
      "rate_percent(0)",
    ],
    [
      "constant difference division",
      "money_result({ final: yuan(1) * (1 / (1 - 1)) })",
      "(1 - 1)",
    ],
    [
      "constant difference remainder",
      "money_result({ final: yuan(1) * (5 % (3 - 3)) })",
      "(3 - 3)",
    ],
  ])(
    "rejects a statically provable %s divisor",
    (_label, formula, divisorSource) => {
      const issue = expectValidationIssue(
        formula,
        "VALIDATION_ZERO_DIVISOR",
      );

      expect(formula.slice(issue.span.start, issue.span.end)).toBe(
        divisorSource,
      );
    },
  );

  it("allows nonzero constants and leaves dynamic zero checks to execution", () => {
    expectValidationSuccess(
      "money_result({ final: yuan(1) * (1 / -2) })",
    );
    expectValidationSuccess(
      "money_result({ final: yuan(1) * (1 / (3 - 1)) })",
    );
    expectValidationSuccess(
      "money_result({ final: yuan(1) * (rate_percent(1) / rate_percent(0.5)) })",
    );
    expectValidationSuccess(
      "money_result({ final: yuan(1) * (1 / system_minutes) })",
    );
  });

  it.each([
    [
      "non-finite",
      "money_result({ final: yuan(1) * (1 / (1e308 * 1e308)) })",
    ],
    [
      "unsafe",
      "money_result({ final: yuan(1) * (1 / (9007199254740991 + 1)) })",
    ],
  ])("fails closed for %s constant folding", (_label, formula) => {
    expectValidationIssue(
      formula,
      "VALIDATION_INVALID_CONSTANT_ARITHMETIC",
    );
  });

  it.each([
    "money_result({ final: 80 })",
    "money_result({ final: percent(80, rate_percent(10)) })",
    "money_result({ final: percent(yuan(80), 10) })",
  ])("rejects ambiguous raw money/rate numerics in %s", (formula) => {
    expectValidationIssue(formula, "VALIDATION_AMBIGUOUS_UNIT");
  });
});

describe("Phase 1 function allowlist", () => {
  it("compiles every allowed calculation helper", () => {
    const result = expectValidationSuccess(`money_result({
      base: min(yuan(100), max(yuan(80), yuan(90))),
      clamped: clamp(base, yuan(0), yuan(200)),
      rounded: round_money(clamped),
      tier: tiered(system_minutes, [
        { upto: 180, rate_per_hour: yuan(80) },
        { upto: null, rate_per_hour: yuan(120) }
      ]),
      discounted: percent(rounded, rate_percent(80)),
      evidenced: percent(discounted, evidence_multiplier(
        evidence_level,
        { green: rate_percent(100), yellow: rate_percent(80), red: rate_percent(0) }
      )),
      bonus: if(
        in(streamer_level, ["S", "A"]) && contains(project_tags, "featured"),
        yuan(50),
        yuan(0)
      ),
      final: evidenced + bonus + tier
    })`);

    for (const callee of [
      "if",
      "min",
      "max",
      "clamp",
      "round_money",
      "tiered",
      "percent",
      "evidence_multiplier",
      "in",
      "contains",
      "money_result",
    ]) {
      expect(JSON.stringify(result.compiledAst)).toContain(`"callee":"${callee}"`);
    }
  });

  it("rejects unknown and future output functions with stable codes", () => {
    const unknownFormula = "money_result({ final: mystery(yuan(1)) })";
    const unknownIssue = expectValidationIssue(
      unknownFormula,
      "VALIDATION_UNKNOWN_FUNCTION",
    );
    expect(unknownIssue.span.start).toBe(unknownFormula.indexOf("mystery"));
    expect(unknownIssue.span.end).toBeGreaterThan(unknownIssue.span.start);

    expectValidationIssue(
      "money_result({ final: cost_items([]) })",
      "VALIDATION_FUNCTION_DISABLED",
    );
  });

  it("rejects incorrect argument counts with a located issue", () => {
    const formula = "money_result({ final: percent(yuan(1)) })";
    const issue = expectValidationIssue(formula, "VALIDATION_WRONG_ARITY");

    expect(issue.span.start).toBe(formula.indexOf("percent"));
  });
});

describe("scope and grain variable allowlists", () => {
  it("accepts payable report variables and returns them sorted", () => {
    const result = expectValidationSuccess(
      "money_result({ final: sales_amount + base_hourly_rate })",
    );

    expect(result.variables).toEqual(["base_hourly_rate", "sales_amount"]);
  });

  it("rejects a variable belonging to another scope", () => {
    const formula = "money_result({ final: base_hourly_rate })";
    const issue = expectValidationIssue(
      formula,
      "VALIDATION_VARIABLE_SCOPE",
      options("receivable"),
    );

    expect(issue.span).toEqual({
      start: formula.indexOf("base_hourly_rate"),
      end: formula.indexOf("base_hourly_rate") + "base_hourly_rate".length,
    });
  });

  it("rejects report variables at aggregate grains", () => {
    expectValidationIssue(
      "money_result({ final: percent(yuan(1), rate_percent(system_minutes)) })",
      "VALIDATION_VARIABLE_GRAIN",
      options("payable", "project_streamer_period"),
    );
  });

  it("allows period aggregates only at compatible aggregate grains", () => {
    expectValidationSuccess(
      "money_result({ final: period_payable_amount })",
      options("payable", "project_streamer_period"),
    );
    expectValidationIssue(
      "money_result({ final: period_payable_amount })",
      "VALIDATION_VARIABLE_GRAIN",
      options("payable", "report"),
    );
  });

  it("rejects unknown variables with a stable located issue", () => {
    const formula = "money_result({ final: invented_amount })";
    const issue = expectValidationIssue(
      formula,
      "VALIDATION_UNKNOWN_VARIABLE",
    );

    expect(issue.span).toEqual({
      start: formula.indexOf("invented_amount"),
      end: formula.indexOf("invented_amount") + "invented_amount".length,
    });
  });

  it.each(["toString", "hasOwnProperty", "valueOf"])(
    "treats Object.prototype identifier %s as an unknown variable",
    (identifier) => {
      const formula = "money_result({ final: " + identifier + " })";
      const issue = expectValidationIssue(
        formula,
        "VALIDATION_UNKNOWN_VARIABLE",
      );
      const start = formula.indexOf(identifier);

      expect(issue.span).toEqual({
        start,
        end: start + identifier.length,
      });
    },
  );
});

describe("parameters and money_result components", () => {
  it("types declared parameters and returns deterministic sorted references", () => {
    const result = expectValidationSuccess(
      `money_result({
        bonus: parameter("bonus"),
        commission: percent(sales_amount, parameter("share_rate")),
        final: bonus + commission
      })`,
      options("payable", "report", {
        parameters: [
          { name: "share_rate", valueType: scalar("rate_bps") },
          { name: "bonus", valueType: scalar("money_cents") },
        ],
      }),
    );

    expect(result.parameters).toEqual(["bonus", "share_rate"]);
  });

  it("rejects unknown parameters", () => {
    expectValidationIssue(
      'money_result({ final: parameter("missing") })',
      "VALIDATION_UNKNOWN_PARAMETER",
    );
  });

  it("requires a final component and allows references only to earlier components", () => {
    expectValidationIssue(
      "money_result({ base: yuan(80) })",
      "VALIDATION_COMPONENT_FINAL_REQUIRED",
    );
    expectValidationSuccess(
      "money_result({ base: yuan(80), bonus: yuan(20), final: base + bonus })",
    );
    expectValidationIssue(
      "money_result({ final: base, base: yuan(80) })",
      "VALIDATION_COMPONENT_FORWARD_REFERENCE",
    );
  });

  it("rejects component dependency cycles before forward-reference diagnostics", () => {
    expectValidationIssue(
      "money_result({ base: bonus, bonus: base, final: base })",
      "VALIDATION_COMPONENT_CYCLE",
    );
    expectValidationIssue(
      "money_result({ base: base, final: base })",
      "VALIDATION_COMPONENT_CYCLE",
    );
  });
});

describe("deterministic output", () => {
  it("keeps compiled AST and hash stable across external jsep precedence changes", () => {
    const formula = "money_result({ final: yuan(1) + yuan(2) * 3 })";
    const baseline = expectValidationSuccess(formula);
    const originalPrecedence = jsep.binary_ops["+"] ?? 0;
    const originalAssociativity = jsep.right_associative.has("+");

    try {
      jsep.addBinaryOp("+", 20, true);

      const first = expectValidationSuccess(formula);
      const second = expectValidationSuccess(formula);

      expect(first.compiledAst).toEqual(baseline.compiledAst);
      expect(first.formulaHash).toBe(baseline.formulaHash);
      expect(second).toEqual(first);
      expect(jsep.binary_ops["+"]).toBe(20);
      expect(jsep.right_associative.has("+")).toBe(true);
    } finally {
      jsep.addBinaryOp("+", originalPrecedence, originalAssociativity);
    }
  });

  it("hashes canonical compiled JSON independently of object insertion order", () => {
    const first = expectValidationSuccess(`money_result({ final:
      percent(yuan(100), evidence_multiplier(evidence_level, {
        green: rate_percent(100), yellow: rate_percent(80), red: rate_percent(0)
      }))
    })`);
    const second = expectValidationSuccess(`money_result({ final:
      percent(yuan(100), evidence_multiplier(evidence_level, {
        red: rate_percent(0), green: rate_percent(100), yellow: rate_percent(80)
      }))
    })`);

    expect(second.formulaHash).toBe(first.formulaHash);
  });

  it("returns the same hash and sorted references on repeat validation", () => {
    const formula = "money_result({ final: sales_amount + base_hourly_rate })";

    expect(validateCustomRuleFormula(formula, DEFAULT_OPTIONS)).toEqual(
      validateCustomRuleFormula(formula, DEFAULT_OPTIONS),
    );
  });

  it("requires the Phase 1 money output contract", () => {
    expectValidationIssue("yuan(80)", "VALIDATION_INVALID_OUTPUT");
  });

  it("propagates parser issues without exposing jsep nodes", () => {
    const result = validateCustomRuleFormula(
      "money_result({ final: record.amount })",
      DEFAULT_OPTIONS,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "PARSE_UNSUPPORTED_NODE" }],
    });
    expect(JSON.stringify(result)).not.toContain("MemberExpression");
  });
});
