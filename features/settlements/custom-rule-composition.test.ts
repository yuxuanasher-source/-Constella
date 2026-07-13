import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  composeCustomSettlementLayers,
  type ResolvedBaseLayer,
  type ResolvedCustomRuleLayer,
} from "./custom-rule-composition";
import type {
  CustomRuleExecutionUnit,
  NormalizedAstNode,
  TypedRuntimeValue,
} from "./custom-rule-types";

const AST: NormalizedAstNode = { kind: "identifier", name: "money_result" };
const AST_HASH = createHash("sha256")
  .update(JSON.stringify(AST))
  .digest("hex");

describe("composeCustomSettlementLayers", () => {
  it("keeps the existing fixed base when no active project custom base exists", () => {
    const result = composeCustomSettlementLayers({
      base: fixedBase(12_345),
      groupLayers: [],
      executionUnit: unit(),
    });

    expect(result.finalAmountCents).toBe(12_345);
    expect(result.appliedLayers).toEqual([
      expect.objectContaining({
        versionId: null,
        target: { targetType: "project", targetId: null },
        composition: "replace",
        namedOutputs: {
          money_result: { type: "money_cents", amountCents: 12_345 },
        },
      }),
    ]);
    expect(result.deterministicExplanation).toContain(
      "unit-1: fixed base fixed-base replaced amount with 12345 cents",
    );
  });

  it("replaces the base with an active custom project layer before modifiers", () => {
    const result = composeCustomSettlementLayers({
      base: customBase("project-base", 20_000),
      groupLayers: [layer({ id: "group-add", amountCents: 500 })],
      executionUnit: unit(),
    });

    expect(result.finalAmountCents).toBe(20_500);
    expect(result.appliedLayers.map((applied) => applied.versionId)).toEqual([
      "project-base",
      "group-add",
    ]);
  });

  it("applies all matching groups by ascending priority and project-streamer last", () => {
    const result = composeCustomSettlementLayers({
      base: fixedBase(10_000),
      groupLayers: [
        layer({
          id: "group-priority-20",
          targetId: "group-b",
          priority: 20,
          amountCents: 700,
        }),
        layer({
          id: "group-priority-10",
          targetId: "group-a",
          priority: 10,
          amountCents: 300,
        }),
      ],
      projectStreamerLayer: layer({
        id: "streamer-last",
        targetType: "project_streamer",
        targetId: "ps-1",
        priority: 0,
        amountCents: 50,
      }),
      executionUnit: unit(),
    });

    expect(result.finalAmountCents).toBe(11_050);
    expect(result.appliedLayers.map((applied) => applied.versionId)).toEqual([
      null,
      "group-priority-10",
      "group-priority-20",
      "streamer-last",
    ]);
  });

  it("composes add, multiply, clamp, and replace outputs over integer cents", () => {
    const result = composeCustomSettlementLayers({
      base: fixedBase(10_000),
      groupLayers: [
        layer({
          id: "add-delta",
          composition: "add",
          priority: 10,
          amountCents: 333,
        }),
        layer({
          id: "multiply-absolute",
          composition: "multiply",
          priority: 20,
          amountCents: 12_345.5,
        }),
        layer({
          id: "clamp-absolute",
          composition: "clamp",
          priority: 30,
          amountCents: 12_000,
        }),
        layer({
          id: "replace-absolute",
          composition: "replace",
          priority: 40,
          amountCents: 11_111,
        }),
      ],
      executionUnit: unit(),
    });

    expect(result.finalAmountCents).toBe(11_111);
    expect(
      result.appliedLayers.find(
        (applied) => applied.versionId === "multiply-absolute",
      )?.outputAmountCents,
    ).toBe(12_346);
  });

  it("blocks tied group priorities before composing money", () => {
    expect(() =>
      composeCustomSettlementLayers({
        base: fixedBase(10_000),
        groupLayers: [
          layer({ id: "group-a", targetId: "group-a", priority: 10 }),
          layer({ id: "group-b", targetId: "group-b", priority: 10 }),
        ],
        executionUnit: unit(),
      }),
    ).toThrow(/ambiguous custom settlement group priority/i);
  });

  it("marks group-level replace as material risk", () => {
    const result = composeCustomSettlementLayers({
      base: fixedBase(10_000),
      groupLayers: [
        layer({
          id: "group-replace",
          targetId: "group-a",
          priority: 10,
          composition: "replace",
          amountCents: 8_000,
        }),
      ],
      executionUnit: unit(),
    });

    expect(result.finalAmountCents).toBe(8_000);
    expect(result.materialRiskCodes).toContain("group_level_replace");
  });

  it("returns the same amount and explanation regardless of database row order", () => {
    const first = composeCustomSettlementLayers({
      base: fixedBase(10_000),
      groupLayers: [
        layer({ id: "group-b", targetId: "group-b", priority: 20 }),
        layer({ id: "group-a", targetId: "group-a", priority: 10 }),
      ],
      executionUnit: unit(),
    });
    const second = composeCustomSettlementLayers({
      base: fixedBase(10_000),
      groupLayers: [
        layer({ id: "group-a", targetId: "group-a", priority: 10 }),
        layer({ id: "group-b", targetId: "group-b", priority: 20 }),
      ],
      executionUnit: unit(),
    });

    expect(second.finalAmountCents).toBe(first.finalAmountCents);
    expect(second.deterministicExplanation).toBe(
      first.deterministicExplanation,
    );
  });

  it("rejects active layers when the compiled AST hash does not match", () => {
    expect(() =>
      composeCustomSettlementLayers({
        base: fixedBase(10_000),
        groupLayers: [
          layer({
            id: "tampered-layer",
            compiledAstHash: "0".repeat(64),
          }),
        ],
        executionUnit: unit(),
      }),
    ).toThrow(/compiled AST hash mismatch/i);
  });
});

function unit(): CustomRuleExecutionUnit {
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
      effectiveAt: "2026-07-10T00:00:00.000Z",
      groups: [
        { id: "group-a", name: "A", assignmentId: "assignment-a" },
        { id: "group-b", name: "B", assignmentId: "assignment-b" },
      ],
      snapshotHash: "membership-hash",
    },
    variables: {
      prior_layer_amount: { type: "money_cents", amountCents: 10_000 },
    },
  };
}

function fixedBase(amountCents: number): ResolvedBaseLayer {
  return {
    kind: "fixed_base",
    versionId: null,
    target: { targetType: "project", targetId: null },
    priority: 0,
    composition: "replace",
    formulaHash: "fixed-formula",
    contractHash: "fixed-contract",
    compiledAst: AST,
    compiledAstHash: AST_HASH,
    typedInputs: {
      legacy_base: { type: "money_cents", amountCents },
    },
    namedOutputs: {
      money_result: { type: "money_cents", amountCents },
    },
    missingDataDecisions: [],
  };
}

function customBase(id: string, amountCents: number): ResolvedBaseLayer {
  return {
    ...fixedBase(amountCents),
    kind: "custom_project_base",
    versionId: id,
    formulaHash: `${id}-formula`,
    contractHash: `${id}-contract`,
  };
}

function layer(
  overrides: Partial<ResolvedCustomRuleLayer> & {
    id?: string;
    targetType?: "streamer_group" | "project_streamer";
    targetId?: string;
    amountCents?: number;
  } = {},
): ResolvedCustomRuleLayer {
  const amountCents = overrides.amountCents ?? 100;
  const versionId = overrides.id ?? "group-layer";
  const namedOutputs: Record<string, TypedRuntimeValue> = {
    money_result: { type: "money_cents", amountCents },
  };
  return {
    versionId,
    target: {
      targetType: overrides.targetType ?? "streamer_group",
      targetId: overrides.targetId ?? "group-a",
    },
    priority: overrides.priority ?? 10,
    composition: overrides.composition ?? "add",
    formulaHash: overrides.formulaHash ?? `${versionId}-formula`,
    contractHash: overrides.contractHash ?? `${versionId}-contract`,
    compiledAst: overrides.compiledAst ?? AST,
    compiledAstHash: overrides.compiledAstHash ?? AST_HASH,
    typedInputs: overrides.typedInputs ?? {
      prior_layer_amount: { type: "money_cents", amountCents: 10_000 },
    },
    namedOutputs: overrides.namedOutputs ?? namedOutputs,
    missingDataDecisions: overrides.missingDataDecisions ?? [],
  };
}
