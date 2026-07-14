import { createHash } from "node:crypto";

import {
  executeCompiledCustomRule,
  type CustomRuleExecutionResult,
} from "./custom-rule-engine";
import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import type {
  CompiledAstNode,
  ReconciliationRuleResult,
  TypedRuntimeValue,
} from "./custom-rule-types";
import {
  DEFAULT_RECONCILIATION_CONFIG,
  type ReconciliationConfig,
  type ProjectSettlementReconciliationInput,
  type ProjectSettlementReconciliationResult,
  type ReconciliationCheck,
  type ReconciliationSeverity,
} from "./project-settlement-reconciliation";

export type ReconciliationCheckWithSource = {
  severity: ReconciliationSeverity;
  code: string;
  message: string;
  source: "core" | "custom_rule";
  ruleVersionId?: string;
  formulaHash?: string;
};

export type CustomReconciliationRuleSummary = {
  ruleVersionId: string;
  contractLabel: string;
  formulaHash: string;
};

export type CustomProjectSettlementReconciliationResult = Omit<
  ProjectSettlementReconciliationResult,
  "checks"
> & {
  checks: ReconciliationCheckWithSource[];
  customRule: CustomReconciliationRuleSummary;
};

export function buildReconciliationVariables(
  coreResult: ProjectSettlementReconciliationResult,
): Record<string, TypedRuntimeValue> {
  return {
    receivable_amount: money(coreResult.income.receivableCents),
    payable_amount: money(coreResult.cost.payableCents),
    external_cost_amount: money(coreResult.cost.externalCostCents),
    tax_amount: money(coreResult.tax.taxTotalCents),
    gross_margin: money(coreResult.profit.grossMarginCents),
    margin_rate: { type: "rate_bps", rateBps: coreResult.profit.marginRateBps },
    green_evidence_count: integer(coreResult.evidence.green),
    yellow_evidence_count: integer(coreResult.evidence.yellow),
    red_evidence_count: integer(coreResult.evidence.red),
  };
}

export function executeCustomRuleReconciliationChecks(input: {
  coreResult: ProjectSettlementReconciliationResult;
  ruleVersion: Pick<
    CustomSettlementRuleVersion,
    "id" | "formulaHash" | "compiledAst" | "parameters" | "ruleContract"
  >;
}): CustomProjectSettlementReconciliationResult {
  assertActiveAstFresh(input.ruleVersion);
  const variables = buildReconciliationVariables(input.coreResult);
  const result = executeCompiledCustomRule<CustomRuleExecutionResult>({
    ast: input.ruleVersion.compiledAst as unknown as CompiledAstNode,
    variables,
    parameters: typedParameterValues(input.ruleVersion.parameters),
  });
  if (result.kind !== "checks") {
    throw new Error("CUSTOM_RULE_RECONCILIATION_RULE_INVALID");
  }

  const coreChecks = input.coreResult.checks.map(coreCheckWithSource);
  const customChecks = customChecksWithSource(result, input.ruleVersion);
  const checks = [...coreChecks, ...customChecks];
  const hasBlocking = checks.some((check) => check.severity === "block");
  const hasWarning = checks.some((check) => check.severity === "warn");

  return deepFreeze({
    ...input.coreResult,
    checks,
    hasBlocking,
    hasWarning,
    canConfirm: !hasBlocking,
    canLock: !hasBlocking,
    customRule: {
      ruleVersionId: input.ruleVersion.id,
      contractLabel: input.ruleVersion.ruleContract.title,
      formulaHash: input.ruleVersion.formulaHash,
    },
  });
}

export function calculateCustomReconciliationInputHash(input: {
  coreInput: ProjectSettlementReconciliationInput;
  activeRule: Pick<CustomSettlementRuleVersion, "id" | "formulaHash"> | null;
}): string {
  return sha256({
    version: 2,
    receivableComputedCents: integerNumber(input.coreInput.receivableComputedCents),
    receivableManualCents: integerNumber(input.coreInput.receivableManualCents),
    payableTotalCents: integerNumber(input.coreInput.payableTotalCents),
    externalCostCents: integerNumber(input.coreInput.externalCostCents),
    manualAdjustmentCents: integerNumber(input.coreInput.manualAdjustmentCents),
    forceApproved: Boolean(input.coreInput.forceApproved),
    config: normalizedReconciliationConfig(input.coreInput.config),
    financialSettings: {
      isInvoiced: Boolean(input.coreInput.financialSettings.isInvoiced),
      outputVatRateBps: integerNumber(
        input.coreInput.financialSettings.outputVatRateBps,
      ),
      surtaxRateBps: integerNumber(input.coreInput.financialSettings.surtaxRateBps),
      procurementCostCents: integerNumber(
        input.coreInput.financialSettings.procurementCostCents,
      ),
    },
    evidence: {
      green: integerNumber(input.coreInput.evidence?.green),
      yellow: integerNumber(input.coreInput.evidence?.yellow),
      red: integerNumber(input.coreInput.evidence?.red),
      unknown: integerNumber(input.coreInput.evidence?.unknown),
    },
    activeRule: input.activeRule
      ? {
          id: input.activeRule.id,
          formulaHash: input.activeRule.formulaHash,
        }
      : null,
  });
}

function normalizedReconciliationConfig(
  config: ProjectSettlementReconciliationInput["config"],
): ReconciliationConfig {
  const normalized = { ...DEFAULT_RECONCILIATION_CONFIG, ...config };
  return {
    blockOnNegativeMargin: Boolean(normalized.blockOnNegativeMargin),
    marginRateFloorBps: integerNumber(normalized.marginRateFloorBps),
    yellowRatioWarnBps: integerNumber(normalized.yellowRatioWarnBps),
    warnOnRedEvidence: Boolean(normalized.warnOnRedEvidence),
    allowZeroReceivable: Boolean(normalized.allowZeroReceivable),
  };
}

export function coreCheckWithSource(
  check: ReconciliationCheck,
): ReconciliationCheckWithSource {
  return {
    severity: check.severity,
    code: check.key,
    message: check.message,
    source: "core",
  };
}

export function finalChecksWithCoreSource(
  result: ProjectSettlementReconciliationResult,
): ReconciliationCheckWithSource[] {
  return result.checks.map(coreCheckWithSource);
}

function customChecksWithSource(
  result: Readonly<ReconciliationRuleResult>,
  ruleVersion: Pick<CustomSettlementRuleVersion, "id" | "formulaHash">,
): ReconciliationCheckWithSource[] {
  return result.checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check.condition)
    .map(({ check, index }) => ({
      severity: check.severity,
      code: `custom_rule:${ruleVersion.id}:${index}`,
      message: check.message,
      source: "custom_rule" as const,
      ruleVersionId: ruleVersion.id,
      formulaHash: ruleVersion.formulaHash,
    }));
}

function assertActiveAstFresh(
  ruleVersion: Pick<CustomSettlementRuleVersion, "compiledAst" | "formulaHash">,
): void {
  if (sha256CanonicalAst(ruleVersion.compiledAst) !== ruleVersion.formulaHash) {
    throw new Error("CUSTOM_RULE_RECONCILIATION_RULE_STALE");
  }
}

function typedParameterValues(
  parameters: CustomSettlementRuleVersion["parameters"],
): Record<string, TypedRuntimeValue> {
  return Object.fromEntries(
    Object.entries(parameters ?? {}).filter(
      (entry): entry is [string, TypedRuntimeValue] =>
        isTypedRuntimeValue(entry[1]),
    ),
  );
}

function isTypedRuntimeValue(value: unknown): value is TypedRuntimeValue {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string";
}

function money(amountCents: number): TypedRuntimeValue {
  return { type: "money_cents", amountCents: integerNumber(amountCents) };
}

function integer(value: number): TypedRuntimeValue {
  return { type: "integer", value: integerNumber(value) };
}

function integerNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

function sha256CanonicalAst(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => {
          let child = record[key];
          if (
            key === "entries" &&
            record.kind === "object" &&
            Array.isArray(child)
          ) {
            child = [...child].sort((left, right) => {
              const leftKey = entryKey(left);
              const rightKey = entryKey(right);
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            });
          }
          return JSON.stringify(key) + ":" + canonicalJson(child);
        })
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value) ?? "undefined";
}

function entryKey(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string"
    ? (value as { key: string }).key
    : "";
}

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
