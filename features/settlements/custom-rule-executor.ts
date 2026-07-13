import { createHash } from "node:crypto";

import {
  composeCustomSettlementLayers,
  type ComposedCustomRuleResult,
  type ResolvedBaseLayer,
  type ResolvedCustomRuleLayer,
} from "./custom-rule-composition";
import {
  CustomRuleExecutionError as EngineExecutionError,
  executeCompiledCustomRule,
} from "./custom-rule-engine";
import {
  applyMissingDataPoliciesBeforeExecution,
  createCustomRuleExecutionError,
  runtimeValueMatchesType,
  type CustomRuleLayerLabel,
  type MissingDataDecision,
  type MissingDataVariableDeclaration,
  type PreparedExecution,
  type PreparedRuleException,
} from "./custom-rule-missing-data";
import type {
  CompiledAstNode,
  CustomRuleCompositionMode,
  CustomRuleExecutionUnit,
  CustomRuleTarget,
  NormalizedAstNode,
  TypedRuntimeValue,
} from "./custom-rule-types";

type MoneyCompositionMode = Extract<
  CustomRuleCompositionMode,
  "replace" | "add" | "multiply" | "clamp"
>;

export type ExecutableCustomRuleLayer = Readonly<{
  versionId: string;
  target: CustomRuleTarget;
  priority: number;
  composition: MoneyCompositionMode;
  formulaHash: string;
  contractHash: string;
  compiledAst?: CompiledAstNode;
  compiledAstHash: string;
  activeCompiledAstHash: string;
  declarations: readonly MissingDataVariableDeclaration[];
  parameters: Record<string, TypedRuntimeValue>;
  authorized: boolean;
}>;

export type ResolvedExecutableCustomRuleLayers = Readonly<{
  base: ExecutableCustomRuleLayer;
  groupLayers: readonly ExecutableCustomRuleLayer[];
  projectStreamerLayer?: ExecutableCustomRuleLayer;
}>;

export type CustomRuleExecutionSnapshot = ComposedCustomRuleResult &
  Readonly<{
    sourceReportIds: string[];
  }>;

export type CustomRulePipelineResult =
  | {
      kind: "completed";
      snapshots: CustomRuleExecutionSnapshot[];
      reviewExceptions: PreparedRuleException[];
    }
  | {
      kind: "review";
      snapshots: CustomRuleExecutionSnapshot[];
      exceptions: PreparedRuleException[];
    }
  | {
      kind: "blocked";
      error: ReturnType<typeof createCustomRuleExecutionError>;
    };

export function executeCustomSettlementRulePipeline(input: {
  planExecutionUnits: () => readonly CustomRuleExecutionUnit[];
  resolveLayers: (
    unit: CustomRuleExecutionUnit,
  ) => ResolvedExecutableCustomRuleLayers;
  buildExecutionContext: (
    unit: CustomRuleExecutionUnit,
  ) => Record<string, TypedRuntimeValue>;
  onPolicy?: (
    layer: ExecutableCustomRuleLayer,
    prepared: PreparedExecution,
  ) => void;
  onExecute?: (layer: ExecutableCustomRuleLayer) => void;
  onCompose?: (unit: CustomRuleExecutionUnit) => void;
}): CustomRulePipelineResult {
  const snapshots: CustomRuleExecutionSnapshot[] = [];
  const reviewExceptions: PreparedRuleException[] = [];
  let units: CustomRuleExecutionUnit[];
  try {
    units = [...input.planExecutionUnits()].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  } catch {
    return {
      kind: "blocked",
      error: genericBlock("unexpected"),
    };
  }

  for (const unit of units) {
    let resolvedLayers: ResolvedExecutableCustomRuleLayers;
    try {
      resolvedLayers = input.resolveLayers(unit);
    } catch {
      return {
        kind: "blocked",
        error: genericBlock("unexpected", unit),
      };
    }
    let contextVariables: Record<string, TypedRuntimeValue>;
    try {
      contextVariables = input.buildExecutionContext(unit);
    } catch {
      return {
        kind: "blocked",
        error: blockLayer("unexpected", resolvedLayers.base, unit),
      };
    }
    const baseVariables = {
      ...unit.variables,
      ...contextVariables,
    };
    const executableLayers = orderedExecutableLayers(resolvedLayers);
    const executedLayers: Array<ResolvedBaseLayer | ResolvedCustomRuleLayer> =
      [];
    let runningAmountCents = 0;
    let unitRoutedToReview = false;

    for (const [layerIndex, layer] of executableLayers.entries()) {
      const staticError = validateLayerBeforeExecution(layer, unit);
      if (staticError) {
        return { kind: "blocked", error: staticError };
      }

      const variables = {
        ...baseVariables,
        prior_layer_amount: {
          type: "money_cents",
          amountCents: runningAmountCents,
        } satisfies TypedRuntimeValue,
      };
      const typeError = validateDeclaredRuntimeTypes(layer, unit, variables);
      if (typeError) {
        return { kind: "blocked", error: typeError };
      }

      const prepared = applyMissingDataPoliciesBeforeExecution({
        ruleVersionId: layer.versionId,
        target: layer.target,
        layer: layerLabel(layer),
        executionUnitKey: unit.key,
        variables,
        declarations: layer.declarations,
      });
      try {
        input.onPolicy?.(layer, prepared);
      } catch {
        return {
          kind: "blocked",
          error: blockLayer("unexpected", layer, unit),
        };
      }

      if (prepared.kind === "blocked") {
        return { kind: "blocked", error: prepared.error };
      }
      if (prepared.kind === "review") {
        reviewExceptions.push(
          ...prepared.exceptions.map((exception) =>
            exceptionWithReplaySnapshot({
              exception,
              layer,
              variables,
              replayLayers: executableLayers.slice(layerIndex),
            }),
          ),
        );
        unitRoutedToReview = true;
        break;
      }

      let namedOutputs: Record<string, TypedRuntimeValue>;
      try {
        input.onExecute?.(layer);
        namedOutputs = executeLayerAst(layer, prepared.variables);
      } catch (error) {
        return {
          kind: "blocked",
          error: executionFailureForCaughtError(error, layer, unit),
        };
      }

      const resolvedLayer = resolvedLayerForComposition({
        layer,
        unit,
        variables: prepared.variables,
        namedOutputs,
        decisions: prepared.decisions,
      });
      executedLayers.push(resolvedLayer);
      runningAmountCents = composeRunningAmount(
        runningAmountCents,
        moneyResultCents(namedOutputs),
        layer.composition,
      );
    }

    if (unitRoutedToReview) {
      continue;
    }

    const [base, ...modifiers] = executedLayers;
    if (!base || base.target.targetType !== "project") {
      return {
        kind: "blocked",
        error: blockLayer("composition", resolvedLayers.base, unit),
      };
    }
    const groupLayers = modifiers.filter(
      (layer): layer is ResolvedCustomRuleLayer =>
        layer.target.targetType === "streamer_group",
    );
    const projectStreamerLayer = modifiers.find(
      (layer): layer is ResolvedCustomRuleLayer =>
        layer.target.targetType === "project_streamer",
    );

    try {
      input.onCompose?.(unit);
      const composed = composeCustomSettlementLayers({
        base: base as ResolvedBaseLayer,
        groupLayers,
        ...(projectStreamerLayer ? { projectStreamerLayer } : {}),
        executionUnit: unit,
      });
      snapshots.push({
        ...composed,
        sourceReportIds: [...unit.sourceReportIds].sort(),
      });
    } catch {
      return {
        kind: "blocked",
        error: blockLayer("composition", resolvedLayers.base, unit),
      };
    }
  }

  if (reviewExceptions.length > 0) {
    return { kind: "review", snapshots, exceptions: reviewExceptions };
  }

  return { kind: "completed", snapshots, reviewExceptions: [] };
}

function exceptionWithReplaySnapshot(input: {
  exception: PreparedRuleException;
  layer: ExecutableCustomRuleLayer;
  variables: Record<string, TypedRuntimeValue>;
  replayLayers: ExecutableCustomRuleLayer[];
}): PreparedRuleException {
  return {
    ...input.exception,
    layerSnapshot: {
      versionId: input.layer.versionId,
      target: input.layer.target,
      layer: input.exception.layer,
      executionUnitKey: input.exception.executionUnitKey,
      category: input.exception.category,
      composition: input.layer.composition,
      formulaHash: input.layer.formulaHash,
      contractHash: input.layer.contractHash,
      compiledAst: input.layer.compiledAst,
      compiledAstHash: input.layer.compiledAstHash,
      activeCompiledAstHash: input.layer.activeCompiledAstHash,
      parameters: input.layer.parameters,
      typedInputs: input.variables,
      replayLayers: input.replayLayers.map((layer) => ({
        versionId: layer.versionId,
        target: layer.target,
        priority: layer.priority,
        composition: layer.composition,
        formulaHash: layer.formulaHash,
        contractHash: layer.contractHash,
        compiledAst: layer.compiledAst,
        compiledAstHash: layer.compiledAstHash,
        activeCompiledAstHash: layer.activeCompiledAstHash,
        parameters: layer.parameters,
      })),
    },
  };
}

function orderedExecutableLayers(
  layers: ResolvedExecutableCustomRuleLayers,
): ExecutableCustomRuleLayer[] {
  const orderedGroups = [...layers.groupLayers].sort(
    (left, right) =>
      left.priority - right.priority ||
      targetSortKey(left.target).localeCompare(targetSortKey(right.target)) ||
      left.versionId.localeCompare(right.versionId),
  );
  return [
    layers.base,
    ...orderedGroups,
    ...(layers.projectStreamerLayer ? [layers.projectStreamerLayer] : []),
  ];
}

function validateLayerBeforeExecution(
  layer: ExecutableCustomRuleLayer,
  unit: CustomRuleExecutionUnit,
): ReturnType<typeof createCustomRuleExecutionError> | null {
  if (!layer.authorized) {
    return blockLayer("authorization", layer, unit);
  }
  if (!layer.formulaHash || !layer.contractHash) {
    return blockLayer("unit", layer, unit);
  }
  if (!layer.compiledAst) {
    return blockLayer("parser", layer, unit);
  }
  if (
    layer.target.targetType === "project" &&
    layer.composition !== "replace"
  ) {
    return blockLayer("composition", layer, unit);
  }
  if (
    layer.activeCompiledAstHash !== layer.compiledAstHash ||
    hash(layer.compiledAst) !== layer.compiledAstHash
  ) {
    return blockLayer("ast_hash", layer, unit);
  }
  return null;
}

function validateDeclaredRuntimeTypes(
  layer: ExecutableCustomRuleLayer,
  unit: CustomRuleExecutionUnit,
  variables: Record<string, TypedRuntimeValue>,
): ReturnType<typeof createCustomRuleExecutionError> | null {
  for (const declaration of [...layer.declarations].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const value = variables[declaration.name];
    if (value === undefined) continue;
    if (!runtimeValueMatchesType(value, declaration.valueType)) {
      return blockLayer("type", layer, unit, declaration.name);
    }
  }
  return null;
}

function executeLayerAst(
  layer: ExecutableCustomRuleLayer,
  variables: Record<string, TypedRuntimeValue>,
): Record<string, TypedRuntimeValue> {
  if (!layer.compiledAst) {
    throw new Error("compiled AST missing");
  }
  const result = executeCompiledCustomRule({
    ast: layer.compiledAst,
    variables,
    parameters: layer.parameters,
  });
  if (
    Object.prototype.hasOwnProperty.call(result.componentsCents, "money_result")
  ) {
    throw new ReservedOutputNameError();
  }
  const outputs: Record<string, TypedRuntimeValue> = {};
  for (const [name, amountCents] of Object.entries(result.componentsCents)) {
    outputs[name] = { type: "money_cents", amountCents };
  }
  const final = result.componentsCents.final;
  if (final === undefined) {
    throw new Error("money_result final component missing");
  }
  outputs.money_result = { type: "money_cents", amountCents: final };
  return outputs;
}

class ReservedOutputNameError extends Error {
  constructor() {
    super("money_result is a reserved executor output");
    this.name = "ReservedOutputNameError";
  }
}

function resolvedLayerForComposition(input: {
  layer: ExecutableCustomRuleLayer;
  unit: CustomRuleExecutionUnit;
  variables: Record<string, TypedRuntimeValue>;
  namedOutputs: Record<string, TypedRuntimeValue>;
  decisions: MissingDataDecision[];
}): ResolvedBaseLayer | ResolvedCustomRuleLayer {
  const common = {
    versionId: input.layer.versionId,
    target: input.layer.target,
    priority: input.layer.priority,
    composition: input.layer.composition,
    formulaHash: input.layer.formulaHash,
    contractHash: input.layer.contractHash,
    parameters: input.layer.parameters,
    compiledAst: input.layer.compiledAst as unknown as NormalizedAstNode,
    compiledAstHash: input.layer.compiledAstHash,
    activeCompiledAstHash: input.layer.activeCompiledAstHash,
    typedInputs: input.variables,
    namedOutputs: input.namedOutputs,
    missingDataDecisions: input.decisions.map((decision) => ({
      variableName: decision.variable,
      action: decision.action,
      ...(decision.value ? { value: decision.value } : {}),
    })),
  };
  if (input.layer.target.targetType === "project") {
    return {
      ...common,
      kind: "custom_project_base",
      target: { targetType: "project", targetId: null },
      composition: "replace",
    };
  }
  return {
    ...common,
    versionId: input.layer.versionId,
    target: input.layer.target,
  };
}

function executionFailureForCaughtError(
  error: unknown,
  layer: ExecutableCustomRuleLayer,
  unit: CustomRuleExecutionUnit,
): ReturnType<typeof createCustomRuleExecutionError> {
  if (
    error instanceof EngineExecutionError &&
    error.issue.code.includes("PARAMETER")
  ) {
    return blockLayer("parameter", layer, unit);
  }
  if (
    error instanceof EngineExecutionError &&
    error.issue.code.includes("TYPE")
  ) {
    return blockLayer("type", layer, unit);
  }
  if (
    error instanceof EngineExecutionError &&
    error.issue.code.includes("AST")
  ) {
    return blockLayer("parser", layer, unit);
  }
  if (error instanceof ReservedOutputNameError) {
    return blockLayer("composition", layer, unit);
  }
  return blockLayer("unexpected", layer, unit);
}

function blockLayer(
  category:
    | "parser"
    | "type"
    | "unit"
    | "ast_hash"
    | "parameter"
    | "composition"
    | "authorization"
    | "unexpected",
  layer: ExecutableCustomRuleLayer,
  unit: CustomRuleExecutionUnit,
  variable?: string,
): ReturnType<typeof createCustomRuleExecutionError> {
  return createCustomRuleExecutionError({
    code: "CUSTOM_RULE_EXECUTION_BLOCKED",
    message: "Custom settlement rule execution blocked",
    context: {
      ruleVersionId: layer.versionId,
      target: layer.target,
      layer: layerLabel(layer),
      executionUnitKey: unit.key,
      ...(variable ? { variable } : {}),
      category,
    },
    noTransactionAttempted: true,
  });
}

function genericBlock(
  category: "unexpected",
  unit?: CustomRuleExecutionUnit,
): ReturnType<typeof createCustomRuleExecutionError> {
  return createCustomRuleExecutionError({
    code: "CUSTOM_RULE_EXECUTION_BLOCKED",
    message: "Custom settlement rule execution blocked",
    context: {
      ruleVersionId: null,
      target: { targetType: "project", targetId: null },
      layer: "project_base",
      executionUnitKey: unit?.key ?? "unknown",
      category,
    },
    noTransactionAttempted: true,
  });
}

function layerLabel(layer: ExecutableCustomRuleLayer): CustomRuleLayerLabel {
  if (layer.target.targetType === "project") return "project_base";
  return layer.target.targetType;
}

function targetSortKey(target: CustomRuleTarget): string {
  return `${target.targetType}:${target.targetId ?? ""}`;
}

function composeRunningAmount(
  inputAmountCents: number,
  outputAmountCents: number,
  composition: MoneyCompositionMode,
): number {
  if (composition === "add") {
    return inputAmountCents + outputAmountCents;
  }
  return outputAmountCents;
}

function moneyResultCents(outputs: Record<string, TypedRuntimeValue>): number {
  const result = outputs.money_result;
  if (result?.type !== "money_cents") {
    throw new Error("money_result output is required");
  }
  return result.amountCents;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
