import { describe, expect, it } from "vitest";

import {
  CUSTOM_RULE_COMPOSITION_MODES,
  CUSTOM_RULE_EXECUTION_GRAINS,
  CUSTOM_RULE_SCOPES,
  CUSTOM_RULE_TARGET_TYPES,
  CUSTOM_RULE_VERSION_STATUSES,
  MATERIAL_RISK_CODES,
  RUNTIME_SCALAR_TYPES,
  assertSafeIntegerValue,
  centsToLegacyYuan,
  isCustomRuleTargetCompatible,
  parsePostgresBigintCents,
  percentToBpsStrict,
  serializePostgresBigintCents,
  yuanToCentsStrict,
} from "./custom-rule-types";
import type {
  CompiledAstNode,
  CustomRuleCompositionMode,
  CustomRuleExecutionGrain,
  CustomRulePrimaryActionDto,
  CustomRuleScope,
  CustomRuleSimulationFreshnessHashes,
  CustomRuleTargetType,
  CustomRuleVersionStatus,
  MaterialRiskCode,
  NormalizedAstNode,
  RuntimeScalarType,
} from "./custom-rule-types";

describe("custom rule narrow unions", () => {
  it("exposes every supported domain value without widening", () => {
    const scopes: readonly CustomRuleScope[] = CUSTOM_RULE_SCOPES;
    const targetTypes: readonly CustomRuleTargetType[] =
      CUSTOM_RULE_TARGET_TYPES;
    const grains: readonly CustomRuleExecutionGrain[] =
      CUSTOM_RULE_EXECUTION_GRAINS;
    const modes: readonly CustomRuleCompositionMode[] =
      CUSTOM_RULE_COMPOSITION_MODES;
    const statuses: readonly CustomRuleVersionStatus[] =
      CUSTOM_RULE_VERSION_STATUSES;
    const scalarTypes: readonly RuntimeScalarType[] = RUNTIME_SCALAR_TYPES;

    expect(scopes).toEqual([
      "receivable",
      "payable",
      "external_cost",
      "reconciliation",
    ]);
    expect(targetTypes).toEqual([
      "project",
      "streamer_group",
      "project_streamer",
    ]);
    expect(grains).toEqual([
      "report",
      "project_streamer_period",
      "batch",
      "project_period",
    ]);
    expect(modes).toEqual([
      "replace",
      "add",
      "multiply",
      "clamp",
      "emit_items",
      "check",
    ]);
    expect(statuses).toEqual([
      "draft",
      "pending_review",
      "changes_requested",
      "active",
      "archived",
    ]);
    expect(scalarTypes).toEqual([
      "money_cents",
      "rate_bps",
      "number",
      "integer",
      "boolean",
      "string",
      "timestamp",
    ]);
  });

  it("keeps material-risk and governance DTO contracts narrow", () => {
    const risks: readonly MaterialRiskCode[] = MATERIAL_RISK_CODES;
    const freshness: CustomRuleSimulationFreshnessHashes = {
      formulaHash: "formula",
      contractHash: "contract",
      parameterHash: "parameters",
      catalogHash: "catalog",
      dataSelectionHash: "selection",
    };
    const actions: CustomRulePrimaryActionDto[] = [
      { state: "draft", action: "apply_and_submit" },
      { state: "pending_review", action: "approve" },
      { state: "changes_requested", action: "revise_and_resimulate" },
      { state: "active", action: "create_new_version" },
      { state: "archived", action: "none" },
    ];

    expect(risks).toEqual([
      "negative_margin",
      "abnormal_total_increase",
      "red_evidence_payment",
      "money_changing_explicit_default",
      "group_level_replace",
      "overlapping_group_exception",
      "safety_cap_exceeded",
    ]);
    expect(Object.keys(freshness)).toEqual([
      "formulaHash",
      "contractHash",
      "parameterHash",
      "catalogHash",
      "dataSelectionHash",
    ]);
    expect(actions.map(({ action }) => action)).toEqual([
      "apply_and_submit",
      "approve",
      "revise_and_resimulate",
      "create_new_version",
      "none",
    ]);
  });

  it("encodes the first-release scope and target compatibility matrix", () => {
    for (const targetType of CUSTOM_RULE_TARGET_TYPES) {
      expect(isCustomRuleTargetCompatible("payable", targetType)).toBe(true);
    }

    for (const scope of [
      "receivable",
      "external_cost",
      "reconciliation",
    ] as const) {
      expect(isCustomRuleTargetCompatible(scope, "project")).toBe(true);
      expect(isCustomRuleTargetCompatible(scope, "streamer_group")).toBe(false);
      expect(isCustomRuleTargetCompatible(scope, "project_streamer")).toBe(
        false,
      );
    }
  });
});

describe("product-owned AST contracts", () => {
  it("keeps every normalized node kind small and JSON-serializable", () => {
    const nodes: NormalizedAstNode[] = [
      { kind: "literal", value: 10 },
      { kind: "identifier", name: "grossRevenue" },
      {
        kind: "unary",
        operator: "-",
        argument: { kind: "literal", value: 1 },
      },
      {
        kind: "binary",
        operator: "*",
        left: { kind: "identifier", name: "grossRevenue" },
        right: { kind: "literal", value: 0.8 },
      },
      {
        kind: "call",
        callee: "min",
        arguments: [
          { kind: "identifier", name: "grossRevenue" },
          { kind: "literal", value: 100 },
        ],
      },
      {
        kind: "array",
        elements: [{ kind: "literal", value: true }],
      },
      {
        kind: "object",
        entries: [{ key: "eligible", value: { kind: "literal", value: true } }],
      },
    ];

    expect(nodes.map((node) => node.kind)).toEqual([
      "literal",
      "identifier",
      "unary",
      "binary",
      "call",
      "array",
      "object",
    ]);
    expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
  });

  it("uses inferred types and explicit normalized unit fields in compiled nodes", () => {
    const nodes: CompiledAstNode[] = [
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "money_cents" },
        valueCents: 2900,
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "rate_bps" },
        valueBps: 8000,
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "number" },
        value: 1.25,
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "integer" },
        value: 2,
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "boolean" },
        value: true,
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "string" },
        value: "eligible",
      },
      {
        kind: "literal",
        inferredType: { kind: "scalar", scalarType: "timestamp" },
        value: "2026-07-01T00:00:00+08:00",
      },
      {
        kind: "call",
        callee: "sum",
        arguments: [
          {
            kind: "identifier",
            name: "lineItems",
            inferredType: {
              kind: "array",
              itemType: { kind: "scalar", scalarType: "money_cents" },
            },
          },
        ],
        inferredType: { kind: "scalar", scalarType: "money_cents" },
      },
    ];

    expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
    expect(JSON.stringify(nodes)).not.toContain('"amount"');
    expect(nodes[0]).toMatchObject({ valueCents: 2900 });
    expect(nodes[1]).toMatchObject({ valueBps: 8000 });
  });

  it("ties each compiled literal value to its inferred scalar type", () => {
    // @ts-expect-error boolean literals cannot persist string values
    const invalidBoolean: CompiledAstNode = {
      kind: "literal",
      inferredType: { kind: "scalar", scalarType: "boolean" },
      value: "true",
    };
    // @ts-expect-error string literals cannot persist number values
    const invalidString: CompiledAstNode = {
      kind: "literal",
      inferredType: { kind: "scalar", scalarType: "string" },
      value: 1,
    };
    // @ts-expect-error number literals cannot persist string values
    const invalidNumber: CompiledAstNode = {
      kind: "literal",
      inferredType: { kind: "scalar", scalarType: "number" },
      value: "1",
    };
    // @ts-expect-error money literals must use valueCents
    const invalidMoney: CompiledAstNode = {
      kind: "literal",
      inferredType: { kind: "scalar", scalarType: "money_cents" },
      value: 100,
    };
    // @ts-expect-error rate literals must use valueBps
    const invalidRate: CompiledAstNode = {
      kind: "literal",
      inferredType: { kind: "scalar", scalarType: "rate_bps" },
      value: 8000,
    };

    expect([
      invalidBoolean,
      invalidString,
      invalidNumber,
      invalidMoney,
      invalidRate,
    ]).toHaveLength(5);
  });
});

describe("strict unit adapters", () => {
  it("scales canonical decimal yuan and percent values exactly", () => {
    expect(yuanToCentsStrict(0.01)).toBe(1);
    expect(yuanToCentsStrict(1e-2)).toBe(1);
    expect(yuanToCentsStrict(0.29)).toBe(29);
    expect(yuanToCentsStrict(0.1 + 0.2)).toBe(30);
    expect(yuanToCentsStrict(0.7 + 0.1)).toBe(80);
    expect(yuanToCentsStrict(10_000_000.03)).toBe(1_000_000_003);
    expect(yuanToCentsStrict(-10_000_000.03)).toBe(-1_000_000_003);
    expect(yuanToCentsStrict(10_000_000_000.03)).toBe(1_000_000_000_003);
    expect(yuanToCentsStrict(-10_000_000_000.03)).toBe(-1_000_000_000_003);
    expect(centsToLegacyYuan(29)).toBe(0.29);
    expect(percentToBpsStrict(80)).toBe(8000);
    expect(percentToBpsStrict(0.01)).toBe(1);
    expect(percentToBpsStrict(1e-2)).toBe(1);
    expect(percentToBpsStrict(-0.01)).toBe(-1);
    expect(percentToBpsStrict(0.1 + 0.2)).toBe(30);
    expect(percentToBpsStrict(0.7 + 0.1)).toBe(80);
    expect(percentToBpsStrict(10_000_000_000.03)).toBe(1_000_000_000_003);
    expect(percentToBpsStrict(-10_000_000_000.03)).toBe(-1_000_000_000_003);
    expect(assertSafeIntegerValue(42, "test value")).toBe(42);
  });

  it("uses the canonical decimal string at the safe-integer boundary", () => {
    const largestClearlySafeYuan = 90_071_992_547_409.9;

    expect(largestClearlySafeYuan.toString()).toBe("90071992547409.9");
    expect(yuanToCentsStrict(largestClearlySafeYuan)).toBe(
      Number.MAX_SAFE_INTEGER - 1,
    );
    expect(yuanToCentsStrict(-largestClearlySafeYuan)).toBe(
      Number.MIN_SAFE_INTEGER + 1,
    );
    expect(() => yuanToCentsStrict(90_071_992_547_410)).toThrow();
    expect(() => yuanToCentsStrict(-90_071_992_547_410)).toThrow();
    expect(() => percentToBpsStrict(90_071_992_547_410)).toThrow();
  });

  it("returns legacy yuan only when cents round-trip without loss", () => {
    const largestLosslessCents = Number.MAX_SAFE_INTEGER - 1;
    const smallestLosslessCents = Number.MIN_SAFE_INTEGER + 1;

    expect(centsToLegacyYuan(1)).toBe(0.01);
    expect(centsToLegacyYuan(-1)).toBe(-0.01);
    expect(centsToLegacyYuan(largestLosslessCents)).toBe(90_071_992_547_409.9);
    expect(centsToLegacyYuan(smallestLosslessCents)).toBe(
      -90_071_992_547_409.9,
    );
    expect(() => centsToLegacyYuan(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => centsToLegacyYuan(Number.MIN_SAFE_INTEGER)).toThrow();
  });

  it("rejects real fractional, nonfinite, and unsafe conversions", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => yuanToCentsStrict(value)).toThrow();
      expect(() => percentToBpsStrict(value)).toThrow();
    }

    expect(() => yuanToCentsStrict(0.001)).toThrow();
    expect(() => yuanToCentsStrict(1e-3)).toThrow();
    expect(() => yuanToCentsStrict(0.291)).toThrow();
    expect(() => yuanToCentsStrict(1e-18)).toThrow();
    expect(() => yuanToCentsStrict(-1e-18)).toThrow();
    expect(() => yuanToCentsStrict(10_000_000_000_000.002)).toThrow();
    expect(() => percentToBpsStrict(80.001)).toThrow();
    expect(() => percentToBpsStrict(0.001)).toThrow();
    expect(() => percentToBpsStrict(1e-3)).toThrow();
    expect(() => percentToBpsStrict(1e-18)).toThrow();
    expect(() => percentToBpsStrict(-1e-18)).toThrow();
    expect(() => yuanToCentsStrict(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => percentToBpsStrict(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => centsToLegacyYuan(1.5)).toThrow();
    expect(() => centsToLegacyYuan(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => assertSafeIntegerValue(1.5, "test value")).toThrow(
      "test value",
    );
  });
});

describe("Postgres bigint cents boundary", () => {
  it("round-trips aggregate cents above Number.MAX_SAFE_INTEGER", () => {
    const stored = "9007199254740993123";
    const parsed = parsePostgresBigintCents(stored);

    expect(parsed).toBe(BigInt(stored));
    expect(serializePostgresBigintCents(parsed)).toBe(stored);
    expect(serializePostgresBigintCents(`000${stored}`)).toBe(stored);
    expect(serializePostgresBigintCents("-00042")).toBe("-42");
  });

  it("accepts only exact PostgreSQL bigint representations", () => {
    expect(parsePostgresBigintCents(Number.MAX_SAFE_INTEGER)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
    expect(() =>
      parsePostgresBigintCents(Number.MAX_SAFE_INTEGER + 1),
    ).toThrow();
    expect(() => parsePostgresBigintCents(1.5)).toThrow();
    expect(() => parsePostgresBigintCents("1.5")).toThrow();
    expect(() => parsePostgresBigintCents("1e3")).toThrow();
    expect(() => parsePostgresBigintCents("9223372036854775808")).toThrow();
    expect(() => parsePostgresBigintCents("-9223372036854775809")).toThrow();
  });
});
