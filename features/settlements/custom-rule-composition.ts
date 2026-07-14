import { createHash } from "node:crypto";

import type {
  CustomRuleCompositionMode,
  CustomRuleExecutionUnit,
  CustomRuleTarget,
  MaterialRiskCode,
  NormalizedAstNode,
  TypedRuntimeValue,
} from "./custom-rule-types";

type MoneyCompositionMode = Extract<
  CustomRuleCompositionMode,
  "replace" | "add" | "multiply" | "clamp"
>;

export type CustomRuleMissingDataDecisionSnapshot = Readonly<{
  variableName: string;
  action: string;
  reason?: string;
  value?: TypedRuntimeValue;
}>;

type ResolvedLayerCommon = Readonly<{
  versionId: string | null;
  target: CustomRuleTarget;
  priority: number;
  composition: MoneyCompositionMode;
  formulaHash: string;
  contractHash: string;
  parameters?: Record<string, TypedRuntimeValue>;
  compiledAst?: NormalizedAstNode;
  compiledAstHash?: string;
  activeCompiledAstHash?: string;
  typedInputs: Record<string, TypedRuntimeValue>;
  namedOutputs: Record<string, TypedRuntimeValue>;
  missingDataDecisions: readonly CustomRuleMissingDataDecisionSnapshot[];
}>;

export type ResolvedBaseLayer = ResolvedLayerCommon &
  Readonly<{
    kind: "fixed_base" | "custom_project_base";
    target: { targetType: "project"; targetId: null };
    composition: "replace";
  }>;

export type ResolvedCustomRuleLayer = ResolvedLayerCommon &
  Readonly<{
    versionId: string;
    target:
      | { targetType: "streamer_group"; targetId: string }
      | { targetType: "project_streamer"; targetId: string };
  }>;

export type AppliedCustomRuleLayerSnapshot = Readonly<{
  versionId: string | null;
  target: CustomRuleTarget;
  priority: number;
  composition: MoneyCompositionMode;
  formulaHash: string;
  contractHash: string;
  parameters?: Record<string, TypedRuntimeValue>;
  typedInputs: Record<string, TypedRuntimeValue>;
  namedOutputs: Record<string, TypedRuntimeValue>;
  missingDataDecisions: readonly CustomRuleMissingDataDecisionSnapshot[];
  inputAmountCents: number;
  outputAmountCents: number;
  resultAmountCents: number;
  deterministicExplanation: string;
}>;

export type ComposedCustomRuleResult = Readonly<{
  executionUnitKey: string;
  finalAmountCents: number;
  appliedLayers: AppliedCustomRuleLayerSnapshot[];
  materialRiskCodes: MaterialRiskCode[];
  deterministicExplanation: string;
}>;

export function composeCustomSettlementLayers(input: {
  base: ResolvedBaseLayer;
  groupLayers: ResolvedCustomRuleLayer[];
  projectStreamerLayer?: ResolvedCustomRuleLayer;
  executionUnit: CustomRuleExecutionUnit;
}): ComposedCustomRuleResult {
  const materialRiskCodes = new Set<MaterialRiskCode>();
  const orderedGroups = orderGroupLayers(input.groupLayers);
  const layers: Array<ResolvedBaseLayer | ResolvedCustomRuleLayer> = [
    input.base,
    ...orderedGroups,
  ];
  if (input.projectStreamerLayer !== undefined) {
    layers.push(input.projectStreamerLayer);
  }

  const appliedLayers: AppliedCustomRuleLayerSnapshot[] = [];
  let runningAmountCents = 0;

  for (const layer of layers) {
    assertCompiledAstHash(layer);
    const inputAmountCents = runningAmountCents;
    const outputAmountCents = moneyResultCents(layer);
    const resultAmountCents = composeAmount({
      inputAmountCents,
      outputAmountCents,
      composition: layer.composition,
    });
    if (
      layer.target.targetType === "streamer_group" &&
      layer.composition === "replace"
    ) {
      materialRiskCodes.add("group_level_replace");
    }

    const explanation = explainLayer({
      executionUnitKey: input.executionUnit.key,
      layer,
      outputAmountCents,
      resultAmountCents,
    });
    appliedLayers.push({
      versionId: layer.versionId,
      target: layer.target,
      priority: layer.priority,
      composition: layer.composition,
      formulaHash: layer.formulaHash,
      contractHash: layer.contractHash,
      ...(layer.parameters ? { parameters: layer.parameters } : {}),
      typedInputs: layer.typedInputs,
      namedOutputs: layer.namedOutputs,
      missingDataDecisions: layer.missingDataDecisions,
      inputAmountCents,
      outputAmountCents,
      resultAmountCents,
      deterministicExplanation: explanation,
    });
    runningAmountCents = resultAmountCents;
  }

  if (runningAmountCents < 0) {
    throw new Error("custom settlement composition produced a negative amount");
  }

  return {
    executionUnitKey: input.executionUnit.key,
    finalAmountCents: runningAmountCents,
    appliedLayers,
    materialRiskCodes: [...materialRiskCodes].sort(),
    deterministicExplanation: appliedLayers
      .map((layer) => layer.deterministicExplanation)
      .join(" -> "),
  };
}

function orderGroupLayers(
  groupLayers: readonly ResolvedCustomRuleLayer[],
): ResolvedCustomRuleLayer[] {
  const seenPriorities = new Map<number, ResolvedCustomRuleLayer>();
  for (const layer of groupLayers) {
    const existing = seenPriorities.get(layer.priority);
    if (existing !== undefined) {
      throw new Error(
        `ambiguous custom settlement group priority ${layer.priority} for ${existing.versionId} and ${layer.versionId}`,
      );
    }
    seenPriorities.set(layer.priority, layer);
  }

  return [...groupLayers].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.target.targetId.localeCompare(right.target.targetId) ||
      left.versionId.localeCompare(right.versionId),
  );
}

function composeAmount(input: {
  inputAmountCents: number;
  outputAmountCents: number;
  composition: MoneyCompositionMode;
}): number {
  if (input.composition === "add") {
    return input.inputAmountCents + input.outputAmountCents;
  }
  return input.outputAmountCents;
}

function moneyResultCents(layer: ResolvedLayerCommon): number {
  const output = layer.namedOutputs.money_result;
  if (output?.type !== "money_cents") {
    throw new Error(
      `custom settlement layer ${layer.versionId ?? "fixed-base"} did not provide a money_result output`,
    );
  }
  if (!Number.isFinite(output.amountCents)) {
    throw new Error("custom settlement money_result must be finite cents");
  }
  return Math.round(output.amountCents);
}

function assertCompiledAstHash(layer: ResolvedLayerCommon): void {
  if (layer.versionId !== null) {
    if (
      layer.compiledAst === undefined ||
      layer.compiledAstHash === undefined ||
      layer.activeCompiledAstHash === undefined
    ) {
      throw new Error(
        `active compiled AST hash is required for custom settlement layer ${layer.versionId}`,
      );
    }
    if (layer.activeCompiledAstHash !== layer.compiledAstHash) {
      throw new Error(
        `compiled AST hash mismatch for custom settlement layer ${layer.versionId}`,
      );
    }
  }
  if (layer.compiledAst === undefined || layer.compiledAstHash === undefined) {
    return;
  }

  const computedHash = createHash("sha256")
    .update(JSON.stringify(layer.compiledAst))
    .digest("hex");
  if (computedHash !== layer.compiledAstHash) {
    throw new Error(
      `compiled AST hash mismatch for custom settlement layer ${layer.versionId ?? "fixed-base"}`,
    );
  }
}

function explainLayer(input: {
  executionUnitKey: string;
  layer: ResolvedLayerCommon;
  outputAmountCents: number;
  resultAmountCents: number;
}): string {
  const layerId = input.layer.versionId ?? "fixed-base";
  const verb =
    input.layer.composition === "add"
      ? "added"
      : `${input.layer.composition}d amount with`;
  return `${input.executionUnitKey}: ${targetLabel(
    input.layer.target,
  )} ${layerId} ${verb} ${input.outputAmountCents} cents = ${input.resultAmountCents} cents`;
}

function targetLabel(target: CustomRuleTarget): string {
  if (target.targetType === "project") return "fixed base";
  return target.targetType;
}
