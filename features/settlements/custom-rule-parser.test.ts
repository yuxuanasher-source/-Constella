import { describe, expect, it } from "vitest";

import { normalizedAstNodeSchema } from "./custom-rule-contract";
import { parseCustomRuleFormula } from "./custom-rule-parser";

function expectParseSuccess(formula: string) {
  const result = parseCustomRuleFormula(formula);

  expect(result).toMatchObject({ ok: true });
  if (!result.ok) {
    throw new Error(`Expected parse success, received ${result.issues[0]?.code}`);
  }

  expect(normalizedAstNodeSchema.safeParse(result.ast).success).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result;
}

function expectParseIssue(formula: string, code: string) {
  const result = parseCustomRuleFormula(formula);

  expect(result).toMatchObject({
    ok: false,
    issues: [{ code }],
  });
  if (result.ok) {
    throw new Error("Expected parse failure");
  }

  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]?.span).toEqual(
    expect.objectContaining({
      start: expect.any(Number),
      end: expect.any(Number),
    }),
  );
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  return result.issues[0];
}

describe("parseCustomRuleFormula", () => {
  it.each([
    "payable",
    "receivable",
    "external_cost",
    "reconciliation",
  ] as const)("accepts the optional %s prefix with reasonable whitespace", (scope) => {
    const formula = `  ${scope} \t=\n money_result({ final: yuan(80) })  `;
    const result = expectParseSuccess(formula);

    expect(result.scopePrefix).toBe(scope);
    expect(result.ast).toEqual({
      kind: "call",
      callee: "money_result",
      arguments: [
        {
          kind: "object",
          entries: [
            {
              key: "final",
              value: {
                kind: "call",
                callee: "yuan",
                arguments: [{ kind: "literal", value: 80 }],
              },
            },
          ],
        },
      ],
    });
    expect(result.spansByPath["$"]).toEqual({
      start: formula.indexOf("money_result"),
      end: formula.lastIndexOf(")") + 1,
    });
    expect(result.spansByPath["$.arguments[0].entries[0].value"]).toEqual({
      start: formula.indexOf("yuan"),
      end: formula.indexOf("yuan") + "yuan(80)".length,
    });
  });

  it("leaves a prefixless formula explicitly unscoped", () => {
    const result = expectParseSuccess("money_result({ final: yuan(80) })");

    expect(result.scopePrefix).toBeNull();
  });

  it("rejects arbitrary assignment-like prefixes", () => {
    const issue = expectParseIssue(
      "streamer_payable = money_result({ final: yuan(80) })",
      "PARSE_INVALID_PREFIX",
    );

    expect(issue.span).toEqual({ start: 0, end: "streamer_payable".length });
  });

  it("normalizes money_result objects, tier arrays, and multiplier objects", () => {
    const result = expectParseSuccess(`payable = money_result({
      base: tiered(system_minutes, [
        { upto: 180, rate_per_hour: yuan(80) },
        { upto: null, rate_per_hour: yuan(120) }
      ]),
      adjusted: base * evidence_multiplier(
        evidence_level,
        { green: rate_percent(100), yellow: rate_percent(80), red: rate_percent(0) }
      ),
      final: adjusted
    })`);

    expect(result.ast.kind).toBe("call");
    if (result.ast.kind !== "call") {
      throw new Error("Expected call AST");
    }
    expect(result.ast.arguments[0]).toMatchObject({
      kind: "object",
      entries: expect.arrayContaining([
        {
          key: "base",
          value: {
            kind: "call",
            callee: "tiered",
            arguments: [
              { kind: "identifier", name: "system_minutes" },
              {
                kind: "array",
                elements: [
                  {
                    kind: "object",
                    entries: [
                      { key: "upto", value: { kind: "literal", value: 180 } },
                      {
                        key: "rate_per_hour",
                        value: expect.objectContaining({
                          kind: "call",
                          callee: "yuan",
                        }),
                      },
                    ],
                  },
                  {
                    kind: "object",
                    entries: [
                      { key: "upto", value: { kind: "literal", value: null } },
                      {
                        key: "rate_per_hour",
                        value: expect.objectContaining({
                          kind: "call",
                          callee: "yuan",
                        }),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]),
    });
  });

  it("accepts the controlled arithmetic, comparison, boolean, and unary operators", () => {
    const result = expectParseSuccess(
      "!blocked && -adjustment + +bonus * 2 / 4 % 3 >= 0 || level === \"S\"",
    );

    expect(result.ast).toMatchObject({
      kind: "binary",
      operator: "||",
      right: {
        kind: "binary",
        operator: "===",
      },
    });
  });

  it.each([
    [
      "top-level",
      "money_result?.({ final: yuan(1) })",
      "money_result?.({ final: yuan(1) })",
    ],
    [
      "nested",
      "money_result({ final: yuan?.(1) })",
      "yuan?.(1)",
    ],
  ])("rejects %s optional calls with the call span", (_label, formula, call) => {
    const issue = expectParseIssue(formula, "PARSE_UNSUPPORTED_NODE");
    const start = formula.indexOf(call);

    expect(issue.span).toEqual({ start, end: start + call.length });
  });

  it.each([
    ["member access", "record.amount", "PARSE_UNSUPPORTED_NODE"],
    ["computed access", 'record["amount"]', "PARSE_UNSUPPORTED_NODE"],
    ["assignment", "if(flag = true, yuan(1), yuan(0))", "PARSE_SYNTAX_ERROR"],
    ["statements", "yuan(1); yuan(2)", "PARSE_UNSUPPORTED_NODE"],
    ["blocks", "if (true) { final: yuan(1) }", "PARSE_SYNTAX_ERROR"],
    ["sequence expressions", "(yuan(1), yuan(2))", "PARSE_UNSUPPORTED_NODE"],
    ["arrow functions", "value => value", "PARSE_SYNTAX_ERROR"],
    ["function expressions", "function value() { return 1 }", "PARSE_SYNTAX_ERROR"],
    ["constructors", "new Date()", "PARSE_SYNTAX_ERROR"],
    ["constructor identifiers", "constructor()", "PARSE_INVALID_IDENTIFIER"],
    ["templates", "`yuan(1)`", "PARSE_SYNTAX_ERROR"],
    ["spread", "[...values]", "PARSE_SYNTAX_ERROR"],
    ["updates", "value++", "PARSE_SYNTAX_ERROR"],
    ["regex", "/value/", "PARSE_SYNTAX_ERROR"],
    ["optional chains", "record?.amount", "PARSE_UNSUPPORTED_NODE"],
    ["unrecognized jsep nodes", "flag ? yuan(1) : yuan(0)", "PARSE_UNSUPPORTED_NODE"],
    ["bitwise operators", "left | right", "PARSE_UNSUPPORTED_OPERATOR"],
  ])("rejects %s", (_label, formula, code) => {
    expectParseIssue(formula, code);
  });

  it("rejects formulas larger than 16 KiB by UTF-8 bytes", () => {
    const exactLimit = `'${"a".repeat(16 * 1024 - 2)}'`;
    const overLimit = `'${"你".repeat(5_461)}'`;

    expect(Buffer.byteLength(exactLimit, "utf8")).toBe(16 * 1024);
    expect(Buffer.byteLength(overLimit, "utf8")).toBeGreaterThan(16 * 1024);
    expectParseSuccess(exactLimit);
    expectParseIssue(overLimit, "PARSE_FORMULA_TOO_LARGE");
  });

  it("rejects normalized AST depth over 20", () => {
    expectParseSuccess(`${"!".repeat(19)}true`);
    expectParseIssue(`${"!".repeat(20)}true`, "PARSE_AST_TOO_DEEP");
  });

  it("rejects normalized AST node count over 300", () => {
    expectParseSuccess(`[${Array.from({ length: 299 }, () => "1").join(",")}]`);
    expectParseIssue(
      `[${Array.from({ length: 300 }, () => "1").join(",")}]`,
      "PARSE_AST_TOO_LARGE",
    );
  });
});
