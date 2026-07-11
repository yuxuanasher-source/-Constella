import { describe, expect, it } from "vitest";

import type {
  CompiledAstNode,
  RuntimeScalarType,
  RuntimeValueType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import {
  executeCompiledCustomRuleWithTrace,
  type CustomRuleExecutionWithTrace,
} from "./custom-rule-engine";
import {
  buildCustomRuleExecutionExplanation,
  buildCustomRuleTemplateExplanation,
  CustomRuleExplanationError,
  DEFAULT_CUSTOM_RULE_LABEL_REGISTRY,
  type CustomRuleLabelRegistry,
} from "./custom-rule-explanation";

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

function compileFormula(
  formula: string,
  parameters: ReadonlyArray<{
    name: string;
    valueType: RuntimeValueType;
  }> = [],
): CompiledAstNode {
  const result = validateCustomRuleFormula(formula, {
    scope: "payable",
    executionGrain: "report",
    parameters,
  });
  if (!result.ok) {
    throw new Error(
      `Test formula did not compile: ${result.issues[0]?.code ?? "unknown"}`,
    );
  }
  return result.compiledAst;
}

function executionFor(input: {
  ast: CompiledAstNode;
  variables?: Readonly<Record<string, TypedRuntimeValue>>;
  parameters?: Readonly<Record<string, TypedRuntimeValue>>;
}): CustomRuleExecutionWithTrace {
  return executeCompiledCustomRuleWithTrace({
    ast: input.ast,
    variables: input.variables ?? {},
    parameters: input.parameters ?? {},
  });
}

function labels(
  overrides: Partial<{
    variables: Readonly<Record<string, string>>;
    functions: Readonly<Record<string, string>>;
    parameters: Readonly<Record<string, string>>;
    components: Readonly<Record<string, string>>;
    values: Readonly<Record<string, string>>;
  }> = {},
): CustomRuleLabelRegistry {
  return {
    variables: {
      ...DEFAULT_CUSTOM_RULE_LABEL_REGISTRY.variables,
      ...overrides.variables,
    },
    functions: {
      ...DEFAULT_CUSTOM_RULE_LABEL_REGISTRY.functions,
      ...overrides.functions,
    },
    parameters: {
      ...DEFAULT_CUSTOM_RULE_LABEL_REGISTRY.parameters,
      ...overrides.parameters,
    },
    components: {
      ...DEFAULT_CUSTOM_RULE_LABEL_REGISTRY.components,
      ...overrides.components,
    },
    values: {
      ...DEFAULT_CUSTOM_RULE_LABEL_REGISTRY.values,
      ...overrides.values,
    },
  };
}

function expectExplanationIssue(
  operation: () => unknown,
  code: string,
): CustomRuleExplanationError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(CustomRuleExplanationError);
    const explanationError = error as CustomRuleExplanationError;
    expect(explanationError).toMatchObject({
      name: "CustomRuleExplanationError",
      issue: {
        code,
        message: expect.any(String),
        path: expect.any(String),
      },
    });
    expect(JSON.parse(JSON.stringify(explanationError.issue))).toEqual(
      explanationError.issue,
    );
    return explanationError;
  }
  throw new Error(`Expected ${code}`);
}

function cptAst(untriggeredBonusYuan = 99): CompiledAstNode {
  return compileFormula(
    `money_result({
      base: tiered(system_minutes, [
        { upto: null, rate_per_hour: yuan(80) }
      ]),
      bonus: if(
        streamer_level == "S",
        parameter("s_bonus"),
        yuan(${untriggeredBonusYuan})
      ),
      penalty: yuan(0),
      final: base + bonus - penalty
    })`,
    [{ name: "s_bonus", valueType: scalar("money_cents") }],
  );
}

describe("custom rule template explanation", () => {
  it("derives a deterministic Chinese template from AST and ID labels", () => {
    const ast = cptAst();
    const registry = labels({ parameters: { s_bonus: "S级奖励" } });

    const first = buildCustomRuleTemplateExplanation({ ast, labels: registry });
    const second = buildCustomRuleTemplateExplanation({ ast, labels: registry });

    expect(second).toBe(first);
    expect([...new TextEncoder().encode(second)]).toEqual([
      ...new TextEncoder().encode(first),
    ]);
    expect(first).toBe(
      "结算公式按组件顺序输出：基础金额、奖励、扣减、最终金额。计算使用：分段计费、条件判断、业务参数。金额以元显示，比例以%显示。",
    );
  });

  it("uses registry overrides by variable and function ID in stable order", () => {
    const ast = cptAst();
    const registry = labels({
      variables: { system_minutes: "平台计时" },
      functions: { tiered: "阶梯小时费" },
    });

    const template = buildCustomRuleTemplateExplanation({
      ast,
      labels: registry,
    });

    expect(template).toContain("阶梯小时费");
    expect(JSON.stringify(registry)).toContain("平台计时");
    expect(template.indexOf("阶梯小时费")).toBeLessThan(
      template.indexOf("条件判断"),
    );
  });

  it("rejects root and nested semantic AST type forgeries", () => {
    const wrongRootType = structuredClone(cptAst());
    wrongRootType.inferredType = scalar("money_cents");
    expectExplanationIssue(
      () =>
        buildCustomRuleTemplateExplanation({
          ast: wrongRootType,
          labels: labels(),
        }),
      "EXPLANATION_INVALID_AST",
    );

    const wrongNestedArray = structuredClone(
      compileFormula(`money_result({
        final: if(in(streamer_level, ["S", "A"]), yuan(1), yuan(2))
      })`),
    );
    if (
      wrongNestedArray.kind !== "call" ||
      wrongNestedArray.arguments[0]?.kind !== "object" ||
      wrongNestedArray.arguments[0].entries[0]?.value.kind !== "call" ||
      wrongNestedArray.arguments[0].entries[0].value.arguments[0]?.kind !==
        "call" ||
      wrongNestedArray.arguments[0].entries[0].value.arguments[0].arguments[1]
        ?.kind !== "array" ||
      wrongNestedArray.arguments[0].entries[0].value.arguments[0].arguments[1]
        .inferredType.kind !== "array"
    ) {
      throw new Error("Expected a compiled nested in array");
    }
    wrongNestedArray.arguments[0].entries[0].value.arguments[0].arguments[1].inferredType.itemType =
      scalar("integer");

    expectExplanationIssue(
      () =>
        buildCustomRuleTemplateExplanation({
          ast: wrongNestedArray,
          labels: labels(),
        }),
      "EXPLANATION_INVALID_AST",
    );
  });
});

describe("custom rule execution explanation", () => {
  it("is byte-stable, includes units and ordered components, and omits the untriggered branch", () => {
    const ast = cptAst();
    const execution = executionFor({
      ast,
      variables: {
        system_minutes: integer(180),
        streamer_level: stringValue("S"),
      },
      parameters: { s_bonus: money(5_000) },
    });
    const registry = labels({ parameters: { s_bonus: "S级奖励" } });
    const input = {
      ast,
      trace: execution.trace,
      result: execution.result,
      labels: registry,
    };

    const first = buildCustomRuleExecutionExplanation(input);
    const second = buildCustomRuleExecutionExplanation(input);

    expect(second).toBe(first);
    expect([...new TextEncoder().encode(second)]).toEqual([
      ...new TextEncoder().encode(first),
    ]);
    expect(first).toBe(
      "系统直播时长：180 分钟。分段计费第1档：180 分钟 × 80.00 元/小时 = 240.00 元。主播等级：“S”。条件判断：满足条件，采用已触发分支。S级奖励：50.00 元。基础金额：240.00 元；奖励：50.00 元；扣减：0.00 元；最终金额：290.00 元。",
    );
    expect(first).not.toContain("99.00 元");
  });

  it("describes only the selected evidence branch and percentage", () => {
    const ast = compileFormula(`money_result({
      discounted: percent(
        sales_amount,
        evidence_multiplier(evidence_level, {
          green: rate_percent(100),
          yellow: rate_percent(80),
          red: rate_percent(0)
        })
      ),
      final: discounted
    })`);
    const execution = executionFor({
      ast,
      variables: {
        sales_amount: money(10_000),
        evidence_level: stringValue("yellow"),
      },
    });

    const explanation = buildCustomRuleExecutionExplanation({
      ast,
      trace: execution.trace,
      result: execution.result,
      labels: labels(),
    });

    expect(explanation).toContain("凭证等级：“黄色”");
    expect(explanation).toContain("凭证折扣：黄色，采用 80.00%");
    expect(explanation).toContain(
      "比例计算：100.00 元 × 80.00% = 80.00 元",
    );
    expect(explanation).not.toContain("绿色，采用");
    expect(explanation).not.toContain("红色，采用");
  });

  it("reports only the floor or cap that actually triggered", () => {
    const ast = compileFormula(`money_result({
      final: clamp(
        percent(sales_amount, parameter("cps_rate")),
        yuan(10),
        yuan(100)
      )
    })`, [{ name: "cps_rate", valueType: scalar("rate_bps") }]);
    const explainAt = (amountCents: number) => {
      const execution = executionFor({
        ast,
        variables: { sales_amount: money(amountCents) },
        parameters: { cps_rate: rate(1_000) },
      });
      return buildCustomRuleExecutionExplanation({
        ast,
        trace: execution.trace,
        result: execution.result,
        labels: labels({ parameters: { cps_rate: "CPS比例" } }),
      });
    };

    const floorExplanation = explainAt(0);
    expect(floorExplanation).toContain("触发下限 10.00 元");
    expect(floorExplanation).not.toContain("触发上限");

    const capExplanation = explainAt(200_000);
    expect(capExplanation).toContain("触发上限 100.00 元");
    expect(capExplanation).not.toContain("触发下限");
  });

  it("rejects free-form AI prose instead of treating it as authoritative", () => {
    const ast = cptAst();
    const execution = executionFor({
      ast,
      variables: {
        system_minutes: integer(180),
        streamer_level: stringValue("S"),
      },
      parameters: { s_bonus: money(5_000) },
    });

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast,
          trace: execution.trace,
          result: execution.result,
          labels: labels(),
          aiDraft: "请直接相信这段模型生成文本",
        } as unknown as Parameters<
          typeof buildCustomRuleExecutionExplanation
        >[0]),
      "EXPLANATION_INVALID_INPUT",
    );
  });

  it("fails closed when AST, trace, or result does not describe the same execution", () => {
    const ast = cptAst();
    const execution = executionFor({
      ast,
      variables: {
        system_minutes: integer(180),
        streamer_level: stringValue("S"),
      },
      parameters: { s_bonus: money(5_000) },
    });
    const registry = labels();

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast: cptAst(98),
          trace: execution.trace,
          result: execution.result,
          labels: registry,
        }),
      "EXPLANATION_EXECUTION_MISMATCH",
    );

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast,
          trace: execution.trace.filter((event) => event.kind !== "branch"),
          result: execution.result,
          labels: registry,
        }),
      "EXPLANATION_EXECUTION_MISMATCH",
    );

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast,
          trace: execution.trace,
          result: {
            kind: "money_result",
            componentsCents: {
              ...execution.result.componentsCents,
              final: execution.result.componentsCents.final + 1,
            },
          },
          labels: registry,
        }),
      "EXPLANATION_EXECUTION_MISMATCH",
    );
  });

  it("fails closed on malformed AST, trace, and result shapes", () => {
    const ast = cptAst();
    const execution = executionFor({
      ast,
      variables: {
        system_minutes: integer(180),
        streamer_level: stringValue("S"),
      },
      parameters: { s_bonus: money(5_000) },
    });
    const registry = labels();

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast: { kind: "mystery" } as unknown as CompiledAstNode,
          trace: execution.trace,
          result: execution.result,
          labels: registry,
        }),
      "EXPLANATION_INVALID_AST",
    );

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast,
          trace: [
            ...execution.trace,
            { kind: "mystery" } as unknown as (typeof execution.trace)[number],
          ],
          result: execution.result,
          labels: registry,
        }),
      "EXPLANATION_INVALID_TRACE",
    );

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast,
          trace: execution.trace,
          result: {
            kind: "money_result",
            componentsCents: { final: Number.NaN },
          },
          labels: registry,
        }),
      "EXPLANATION_INVALID_RESULT",
    );
  });

  it("rejects semantic AST forgeries before explaining an execution", () => {
    const ast = compileFormula(`money_result({
      final: percent(yuan(1), evidence_multiplier(evidence_level, {
        green: rate_percent(100),
        yellow: rate_percent(80),
        red: rate_percent(0)
      }))
    })`);
    const execution = executionFor({
      ast,
      variables: { evidence_level: stringValue("green") },
    });

    const wrongRootType = structuredClone(ast);
    wrongRootType.inferredType = scalar("money_cents");
    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast: wrongRootType,
          trace: execution.trace,
          result: execution.result,
          labels: labels(),
        }),
      "EXPLANATION_INVALID_AST",
    );

    const wrongNestedObject = structuredClone(ast);
    if (
      wrongNestedObject.kind !== "call" ||
      wrongNestedObject.arguments[0]?.kind !== "object" ||
      wrongNestedObject.arguments[0].entries[0]?.value.kind !== "call" ||
      wrongNestedObject.arguments[0].entries[0].value.arguments[1]?.kind !==
        "call" ||
      wrongNestedObject.arguments[0].entries[0].value.arguments[1].arguments[1]
        ?.kind !== "object"
    ) {
      throw new Error("Expected a compiled evidence rate object");
    }
    wrongNestedObject.arguments[0].entries[0].value.arguments[1].arguments[1].inferredType =
      scalar("money_cents");

    expectExplanationIssue(
      () =>
        buildCustomRuleExecutionExplanation({
          ast: wrongNestedObject,
          trace: execution.trace,
          result: execution.result,
          labels: labels(),
        }),
      "EXPLANATION_INVALID_AST",
    );
  });
});
