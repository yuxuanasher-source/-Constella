import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  executeCustomSettlementRulePipeline,
  type ExecutableCustomRuleLayer,
} from "./custom-rule-executor";
import type {
  CompiledAstNode,
  CustomRuleExecutionUnit,
  RuntimeScalarType,
  TypedRuntimeValue,
} from "./custom-rule-types";
import { validateCustomRuleFormula } from "./custom-rule-validator";

describe("executeCustomSettlementRulePipeline", () => {
  it("runs planning, layer resolution, context, policy, AST execution, composition, and snapshot deterministically", () => {
    const calls: string[] = [];
    const unit = executionUnit();
    const base = layer({
      versionId: "base-v1",
      target: { targetType: "project", targetId: null },
      priority: 0,
      composition: "replace",
      formula: "money_result({ final: yuan(1) * settlement_minutes })",
      declarations: [
        {
          name: "settlement_minutes",
          required: true,
          category: "formula_input",
          valueType: scalar("integer"),
        },
      ],
    });
    const group = layer({
      versionId: "group-bonus",
      target: { targetType: "streamer_group", targetId: "group-1" },
      priority: 10,
      composition: "add",
      formula: "money_result({ final: gift_amount })",
      declarations: [
        {
          name: "gift_amount",
          required: false,
          category: "optional_input",
          valueType: scalar("money_cents"),
          missingDataPolicy: {
            action: "use_explicit_default",
            defaultValue: { type: "money_cents", amountCents: 600 },
          },
        },
      ],
    });

    const result = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => {
        calls.push("plan");
        return [unit];
      },
      resolveLayers: (resolvedUnit) => {
        calls.push(`resolve:${resolvedUnit.key}`);
        return { base, groupLayers: [group] };
      },
      buildExecutionContext: (resolvedUnit) => {
        calls.push(`context:${resolvedUnit.key}`);
        return {
          settlement_minutes: { type: "integer", value: 60 },
        };
      },
      onPolicy: (resolvedLayer, prepared) => {
        calls.push(`policy:${resolvedLayer.versionId}:${prepared.kind}`);
      },
      onExecute: (resolvedLayer) => {
        calls.push(`execute:${resolvedLayer.versionId}`);
      },
      onCompose: (resolvedUnit) => {
        calls.push(`compose:${resolvedUnit.key}`);
      },
    });

    expect(result).toMatchObject({
      kind: "completed",
      snapshots: [
        {
          executionUnitKey: "unit-1",
          finalAmountCents: 6_600,
          sourceReportIds: ["report-1"],
          appliedLayers: [
            {
              versionId: "base-v1",
              namedOutputs: {
                money_result: { type: "money_cents", amountCents: 6_000 },
              },
              missingDataDecisions: [],
            },
            {
              versionId: "group-bonus",
              namedOutputs: {
                money_result: { type: "money_cents", amountCents: 600 },
              },
              missingDataDecisions: [
                {
                  variableName: "gift_amount",
                  action: "use_explicit_default",
                  value: { type: "money_cents", amountCents: 600 },
                },
              ],
            },
          ],
        },
      ],
      reviewExceptions: [],
    });
    expect(calls).toEqual([
      "plan",
      "resolve:unit-1",
      "context:unit-1",
      "policy:base-v1:ready",
      "execute:base-v1",
      "policy:group-bonus:ready",
      "execute:group-bonus",
      "compose:unit-1",
    ]);
  });

  it("keeps calculated snapshots while collecting review placeholders", () => {
    const calls: string[] = [];
    const calculatedUnit = executionUnit({
      key: "unit-0",
      sourceReportIds: ["report-0"],
    });
    const reviewUnit = executionUnit({
      key: "unit-1",
      sourceReportIds: ["report-1"],
    });
    const calculatedLayer = baseLayer();
    const reviewLayer = layer({
      versionId: "review-v1",
      target: { targetType: "project", targetId: null },
      priority: 0,
      composition: "replace",
      formula: "money_result({ final: gift_amount })",
      declarations: [
        {
          name: "gift_amount",
          required: false,
          category: "optional_input",
          valueType: scalar("money_cents"),
          missingDataPolicy: { action: "route_item_to_review" },
        },
      ],
    });

    const result = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => [reviewUnit, calculatedUnit],
      resolveLayers: (unit) => ({
        base: unit.key === "unit-0" ? calculatedLayer : reviewLayer,
        groupLayers: [],
      }),
      buildExecutionContext: (unit) =>
        unit.key === "unit-0"
          ? { settlement_minutes: { type: "integer", value: 60 } }
          : ({} as Record<string, TypedRuntimeValue>),
      onExecute: (resolvedLayer) =>
        calls.push(`execute:${resolvedLayer.versionId}`),
      onCompose: (resolvedUnit) => calls.push(`compose:${resolvedUnit.key}`),
    });

    expect(result).toMatchObject({
      kind: "review",
      snapshots: [
        {
          executionUnitKey: "unit-0",
          finalAmountCents: 6_000,
          sourceReportIds: ["report-0"],
        },
      ],
      exceptions: [
        {
          ruleVersionId: "review-v1",
          variable: "gift_amount",
          placeholderAmountCents: 0,
          contributionCents: 0,
          layerSnapshot: expect.objectContaining({
            versionId: "review-v1",
            compiledAst: expect.any(Object),
            compiledAstHash: reviewLayer.compiledAstHash,
            activeCompiledAstHash: reviewLayer.activeCompiledAstHash,
            typedInputs: expect.objectContaining({
              prior_layer_amount: { type: "money_cents", amountCents: 0 },
            }),
          }),
        },
      ],
    });
    expect(calls).toEqual(["execute:base-v1", "compose:unit-0"]);
  });

  it("blocks plan and layer resolution failures with stable safe context", () => {
    const planFailure = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => {
        throw new Error("provider-secret from streamer-2");
      },
      resolveLayers: () => ({ base: baseLayer(), groupLayers: [] }),
      buildExecutionContext: () => ({}),
    });
    const resolveFailure = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => [executionUnit()],
      resolveLayers: () => {
        throw new Error("money_result({ final: provider-secret })");
      },
      buildExecutionContext: () => ({}),
    });

    for (const result of [planFailure, resolveFailure]) {
      expect(result).toMatchObject({
        kind: "blocked",
        error: {
          issue: {
            code: "CUSTOM_RULE_EXECUTION_BLOCKED",
            context: {
              category: "unexpected",
            },
          },
        },
      });
      if (result.kind !== "blocked") throw new Error("expected blocked");
      expect(JSON.stringify(result.error.issue)).not.toContain("streamer-2");
      expect(JSON.stringify(result.error.issue)).not.toContain(
        "provider-secret",
      );
      expect(JSON.stringify(result.error.issue)).not.toContain("money_result");
    }
  });

  it("blocks parser, type, unit, AST hash, parameter, composition, authorization, and unexpected errors with safe context", () => {
    const blockingFailures: Array<{
      category:
        | "parser"
        | "type"
        | "unit"
        | "ast_hash"
        | "parameter"
        | "composition"
        | "authorization"
        | "unexpected";
      configure: (
        layer: ExecutableCustomRuleLayer,
      ) => ExecutableCustomRuleLayer;
    }> = [
      {
        category: "parser",
        configure: (base) => ({ ...base, compiledAst: undefined }),
      },
      {
        category: "type",
        configure: (base) => ({
          ...base,
          declarations: [
            {
              name: "settlement_minutes",
              required: true,
              category: "formula_input",
              valueType: scalar("money_cents"),
            },
          ],
        }),
      },
      {
        category: "unit",
        configure: (base) => ({
          ...base,
          formulaHash: "",
        }),
      },
      {
        category: "ast_hash",
        configure: (base) => ({
          ...base,
          compiledAstHash: "0".repeat(64),
        }),
      },
      {
        category: "parameter",
        configure: () =>
          layer({
            versionId: "parameter-v1",
            target: { targetType: "project", targetId: null },
            priority: 0,
            composition: "replace",
            formula: 'money_result({ final: parameter("bonus") })',
            parameterDefinitions: [
              { name: "bonus", valueType: scalar("money_cents") },
            ],
            parameters: {},
            declarations: [],
          }),
      },
      {
        category: "composition",
        configure: (base) => ({ ...base, composition: "add" }),
      },
      {
        category: "authorization",
        configure: (base) => ({ ...base, authorized: false }),
      },
      {
        category: "parser",
        configure: (base) => {
          const compiledAst = {
            kind: "call",
            callee: "money_result",
            arguments: [],
            inferredType: { kind: "object", fields: {} },
          } as CompiledAstNode;
          const compiledAstHash = hash(compiledAst);
          return {
            ...base,
            compiledAst,
            compiledAstHash,
            activeCompiledAstHash: compiledAstHash,
          };
        },
      },
    ];

    for (const failure of blockingFailures) {
      const badLayer = failure.configure(baseLayer());
      const result = executeCustomSettlementRulePipeline({
        planExecutionUnits: () => [executionUnit()],
        resolveLayers: () => ({ base: badLayer, groupLayers: [] }),
        buildExecutionContext: () => ({
          settlement_minutes: { type: "integer", value: 60 },
        }),
      });

      expect(result).toMatchObject({
        kind: "blocked",
        error: {
          issue: {
            code: "CUSTOM_RULE_EXECUTION_BLOCKED",
            context: {
              ruleVersionId: badLayer.versionId,
              executionUnitKey: "unit-1",
              category: failure.category,
            },
          },
        },
      });
      if (result.kind !== "blocked") throw new Error("expected blocked");
      expect(JSON.stringify(result.error.issue)).not.toContain("money_result");
      expect(JSON.stringify(result.error.issue)).not.toContain("streamer-2");
      expect(JSON.stringify(result.error.issue)).not.toContain(
        "provider-secret",
      );
    }

    const unexpected = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => [executionUnit()],
      resolveLayers: () => ({ base: baseLayer(), groupLayers: [] }),
      buildExecutionContext: () => {
        throw new Error("provider-secret from streamer-2");
      },
    });

    expect(unexpected).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_EXECUTION_BLOCKED",
          context: {
            ruleVersionId: "base-v1",
            executionUnitKey: "unit-1",
            category: "unexpected",
          },
        },
      },
    });
    if (unexpected.kind !== "blocked") throw new Error("expected blocked");
    expect(JSON.stringify(unexpected.error.issue)).not.toContain("streamer-2");
    expect(JSON.stringify(unexpected.error.issue)).not.toContain(
      "provider-secret",
    );

    const policyFailure = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => [executionUnit()],
      resolveLayers: () => ({ base: baseLayer(), groupLayers: [] }),
      buildExecutionContext: () => ({
        settlement_minutes: { type: "integer", value: 60 },
      }),
      onPolicy: () => {
        throw new Error("provider-secret money_result streamer-2");
      },
    });

    expect(policyFailure).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_EXECUTION_BLOCKED",
          context: {
            ruleVersionId: "base-v1",
            executionUnitKey: "unit-1",
            category: "unexpected",
          },
        },
      },
    });
    if (policyFailure.kind !== "blocked") throw new Error("expected blocked");
    expect(JSON.stringify(policyFailure.error.issue)).not.toContain(
      "provider-secret",
    );
    expect(JSON.stringify(policyFailure.error.issue)).not.toContain(
      "money_result",
    );
    expect(JSON.stringify(policyFailure.error.issue)).not.toContain(
      "streamer-2",
    );
  });

  it("blocks component names that would collide with reserved executor outputs", () => {
    const badLayer = layer({
      versionId: "reserved-output",
      target: { targetType: "project", targetId: null },
      priority: 0,
      composition: "replace",
      formula: "money_result({ money_result: yuan(1), final: yuan(2) })",
      declarations: [],
    });

    const result = executeCustomSettlementRulePipeline({
      planExecutionUnits: () => [executionUnit()],
      resolveLayers: () => ({ base: badLayer, groupLayers: [] }),
      buildExecutionContext: () => ({}),
    });

    expect(result).toMatchObject({
      kind: "blocked",
      error: {
        issue: {
          code: "CUSTOM_RULE_EXECUTION_BLOCKED",
          context: {
            ruleVersionId: "reserved-output",
            category: "composition",
          },
        },
      },
    });
  });

  it("keeps pure executor modules free of database and framework imports", () => {
    const files = [
      "custom-rule-missing-data.ts",
      "custom-rule-executor.ts",
    ].map((file) => readFileSync(path.join(__dirname, file), "utf8"));

    for (const source of files) {
      expect(source).not.toMatch(/from\s+["'](?:@\/)?lib\/db/);
      expect(source).not.toMatch(/from\s+["'][^"']*repository/);
      expect(source).not.toMatch(/from\s+["']@supabase\//);
      expect(source).not.toMatch(/from\s+["']next\//);
    }
  });
});

function baseLayer(): ExecutableCustomRuleLayer {
  return layer({
    versionId: "base-v1",
    target: { targetType: "project", targetId: null },
    priority: 0,
    composition: "replace",
    formula: "money_result({ final: yuan(1) * settlement_minutes })",
    declarations: [
      {
        name: "settlement_minutes",
        required: true,
        category: "formula_input",
        valueType: scalar("integer"),
      },
    ],
  });
}

function layer(input: {
  versionId: string;
  target: ExecutableCustomRuleLayer["target"];
  priority: number;
  composition: ExecutableCustomRuleLayer["composition"];
  formula: string;
  declarations: ExecutableCustomRuleLayer["declarations"];
  parameters?: Record<string, TypedRuntimeValue>;
  parameterDefinitions?: Array<{
    name: string;
    valueType: { kind: "scalar"; scalarType: RuntimeScalarType };
  }>;
  authorized?: boolean;
}): ExecutableCustomRuleLayer {
  const compiledAst = compileFormula(input.formula, input.parameterDefinitions);
  const compiledAstHash = hash(compiledAst);
  return {
    versionId: input.versionId,
    target: input.target,
    priority: input.priority,
    composition: input.composition,
    formulaHash: `${input.versionId}-formula-hash`,
    contractHash: `${input.versionId}-contract-hash`,
    compiledAst,
    compiledAstHash,
    activeCompiledAstHash: compiledAstHash,
    declarations: input.declarations,
    parameters: input.parameters ?? {},
    authorized: input.authorized ?? true,
  };
}

function executionUnit(
  overrides: Partial<CustomRuleExecutionUnit> = {},
): CustomRuleExecutionUnit {
  return {
    key: "unit-1",
    grain: "report",
    projectId: "project-1",
    projectStreamerId: "ps-1",
    streamerId: "streamer-1",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    sourceReportIds: ["report-1"],
    membershipSnapshot: {
      projectStreamerId: "ps-1",
      effectiveAt: "2026-07-01T00:00:00.000Z",
      groups: [{ id: "group-1", name: "A", assignmentId: "assignment-1" }],
      snapshotHash: "membership-hash",
    },
    variables: {},
    ...overrides,
  };
}

function compileFormula(
  formula: string,
  parameters: Array<{
    name: string;
    valueType: { kind: "scalar"; scalarType: RuntimeScalarType };
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

function scalar<ScalarType extends RuntimeScalarType>(
  scalarType: ScalarType,
): { kind: "scalar"; scalarType: ScalarType } {
  return { kind: "scalar", scalarType };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
