import { describe, expect, it } from "vitest";

import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import {
  buildReconciliationVariables,
  calculateCustomReconciliationInputHash,
  executeCustomRuleReconciliationChecks,
} from "./custom-rule-reconciliation";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import {
  DEFAULT_RECONCILIATION_CONFIG,
  type ProjectSettlementReconciliationResult,
} from "./project-settlement-reconciliation";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const RULE_ID = "00000000-0000-4000-8000-000000000004";
const SIMULATION_ID = "00000000-0000-4000-8000-000000000005";

describe("custom reconciliation rule execution", () => {
  it("builds typed variables from finalized core reconciliation amounts and evidence", () => {
    const variables = buildReconciliationVariables(coreResult());

    expect(variables).toEqual({
      receivable_amount: { type: "money_cents", amountCents: 1_000_000 },
      payable_amount: { type: "money_cents", amountCents: 400_000 },
      external_cost_amount: { type: "money_cents", amountCents: 100_000 },
      tax_amount: { type: "money_cents", amountCents: 0 },
      gross_margin: { type: "money_cents", amountCents: 500_000 },
      margin_rate: { type: "rate_bps", rateBps: 5_000 },
      green_evidence_count: { type: "integer", value: 8 },
      yellow_evidence_count: { type: "integer", value: 1 },
      red_evidence_count: { type: "integer", value: 1 },
    });
  });

  it("appends triggered pass, warn, and block messages after core checks with provenance", () => {
    const ruleVersion = reconciliationRule(
      `[
        pass_if(gross_margin >= yuan(0), "毛利非负"),
        warn_if(red_evidence_count > 0, "存在红证据场次"),
        block_if(margin_rate < rate_percent(50.01), "毛利率低于 50.01%")
      ]`,
    );

    const result = executeCustomRuleReconciliationChecks({
      coreResult: coreResult({
        checks: [
          {
            key: "pool_consistency",
            severity: "warn",
            message: "core first",
          },
        ],
      }),
      ruleVersion,
    });

    expect(result.checks).toEqual([
      {
        severity: "warn",
        code: "pool_consistency",
        message: "core first",
        source: "core",
      },
      {
        severity: "pass",
        code: `custom_rule:${RULE_ID}:0`,
        message: "毛利非负",
        source: "custom_rule",
        ruleVersionId: RULE_ID,
        formulaHash: ruleVersion.formulaHash,
      },
      {
        severity: "warn",
        code: `custom_rule:${RULE_ID}:1`,
        message: "存在红证据场次",
        source: "custom_rule",
        ruleVersionId: RULE_ID,
        formulaHash: ruleVersion.formulaHash,
      },
      {
        severity: "block",
        code: `custom_rule:${RULE_ID}:2`,
        message: "毛利率低于 50.01%",
        source: "custom_rule",
        ruleVersionId: RULE_ID,
        formulaHash: ruleVersion.formulaHash,
      },
    ]);
    expect(result.hasBlocking).toBe(true);
    expect(result.hasWarning).toBe(true);
    expect(result.canConfirm).toBe(false);
    expect(result.canLock).toBe(false);
  });

  it("does not append false check messages at the boundary margin rate", () => {
    const ruleVersion = reconciliationRule(
      `[
        warn_if(margin_rate < rate_percent(50), "低于 50%"),
        pass_if(margin_rate >= rate_percent(50), "达到 50%")
      ]`,
    );

    const result = executeCustomRuleReconciliationChecks({
      coreResult: coreResult(),
      ruleVersion,
    });

    expect(result.checks.map((check) => check.message)).toEqual([
      "达到 50%",
    ]);
    expect(result.checks[0]?.severity).toBe("pass");
  });

  it("fails closed for stale or invalid active AST snapshots", () => {
    const ruleVersion = reconciliationRule(
      'pass_if(true, "核对通过")',
      { formulaHash: "0".repeat(64) },
    );

    expect(() =>
      executeCustomRuleReconciliationChecks({
        coreResult: coreResult(),
        ruleVersion,
      }),
    ).toThrow(/CUSTOM_RULE_RECONCILIATION_RULE_STALE/);
  });

  it("hashes money, evidence, financial values, and active rule identity", () => {
    const ruleVersion = reconciliationRule('pass_if(true, "核对通过")');
    const base = calculateCustomReconciliationInputHash({
      coreInput: coreInput(),
      activeRule: ruleVersion,
    });

    expect(base).toMatch(/^[a-f0-9]{64}$/);
    expect(
      calculateCustomReconciliationInputHash({
        coreInput: coreInput({
          evidence: { green: 8, yellow: 1, red: 2, unknown: 0 },
        }),
        activeRule: ruleVersion,
      }),
    ).not.toBe(base);
    expect(
      calculateCustomReconciliationInputHash({
        coreInput: coreInput(),
        activeRule: { id: ruleVersion.id, formulaHash: "f".repeat(64) },
      }),
    ).not.toBe(base);
  });

  it("hashes force approval and normalized reconciliation config", () => {
    const ruleVersion = reconciliationRule('pass_if(true, "鏍稿閫氳繃")');
    const base = calculateCustomReconciliationInputHash({
      coreInput: coreInput(),
      activeRule: ruleVersion,
    });

    expect(
      calculateCustomReconciliationInputHash({
        coreInput: coreInput({ forceApproved: true }),
        activeRule: ruleVersion,
      }),
    ).not.toBe(base);
    expect(
      calculateCustomReconciliationInputHash({
        coreInput: coreInput({ config: { marginRateFloorBps: 1_500 } }),
        activeRule: ruleVersion,
      }),
    ).not.toBe(base);
    expect(
      calculateCustomReconciliationInputHash({
        coreInput: coreInput({
          config: {
            warnOnRedEvidence: DEFAULT_RECONCILIATION_CONFIG.warnOnRedEvidence,
            yellowRatioWarnBps: DEFAULT_RECONCILIATION_CONFIG.yellowRatioWarnBps,
            marginRateFloorBps: DEFAULT_RECONCILIATION_CONFIG.marginRateFloorBps,
            blockOnNegativeMargin:
              DEFAULT_RECONCILIATION_CONFIG.blockOnNegativeMargin,
            allowZeroReceivable: DEFAULT_RECONCILIATION_CONFIG.allowZeroReceivable,
          },
        }),
        activeRule: ruleVersion,
      }),
    ).toBe(base);
  });
});

function coreResult(
  overrides: Partial<ProjectSettlementReconciliationResult> = {},
): ProjectSettlementReconciliationResult {
  return {
    income: { receivableCents: 1_000_000 },
    cost: {
      payableCents: 400_000,
      externalCostCents: 100_000,
      procurementCents: 0,
      totalCents: 500_000,
    },
    tax: {
      isInvoiced: false,
      outputVatCents: 0,
      surtaxCents: 0,
      taxTotalCents: 0,
      invoiceAmountCents: 1_000_000,
    },
    profit: {
      grossMarginCents: 500_000,
      marginRateBps: 5_000,
      manualAdjustmentCents: 0,
    },
    evidence: { green: 8, yellow: 1, red: 1, unknown: 0 },
    checks: [],
    hasBlocking: false,
    hasWarning: false,
    canConfirm: true,
    canLock: true,
    ...overrides,
  };
}

function coreInput(overrides: Record<string, unknown> = {}) {
  return {
    receivableComputedCents: 1_000_000,
    receivableManualCents: 0,
    payableTotalCents: 400_000,
    externalCostCents: 100_000,
    manualAdjustmentCents: 0,
    financialSettings: {
      isInvoiced: false,
      outputVatRateBps: 0,
      surtaxRateBps: 0,
      procurementCostCents: 0,
    },
    evidence: { green: 8, yellow: 1, red: 1, unknown: 0 },
    ...overrides,
  };
}

function reconciliationRule(
  formula: string,
  overrides: Partial<CustomSettlementRuleVersion> = {},
): CustomSettlementRuleVersion {
  const validation = validateCustomRuleFormula(formula, {
    scope: "reconciliation",
    executionGrain: "project_period",
    compositionMode: "check",
  });
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.code ?? "validation failed");
  }
  return {
    id: RULE_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    scope: "reconciliation",
    target: { targetType: "project", targetId: null },
    executionGrain: "project_period",
    compositionMode: "check",
    priority: 0,
    versionNumber: 1,
    status: "active",
    formula,
    compiledAst:
      validation.compiledAst as unknown as CustomSettlementRuleVersion["compiledAst"],
    variables: [],
    parameters: {},
    ruleContract: {
      schemaVersion: 1,
      scope: "reconciliation",
      target: { targetType: "project", targetId: null },
      executionGrain: "project_period",
      compositionMode: "check",
      title: "毛利复核",
      summary: "项目周期毛利复核",
      calculationComponents: [],
      requiredInputs: [],
      parameters: [],
      effectiveStartAt: "2026-07-01T00:00:00.000Z",
      effectiveEndAt: null,
      missingDataPolicy: { action: "block_batch" },
      compositionDescription: "追加复核检查",
      businessTimezone: "Asia/Shanghai",
      examples: [],
    },
    systemExplanationTemplate: "",
    missingDataPolicy: {},
    testCases: [],
    simulationSummary: {},
    formulaHash: validation.formulaHash,
    contractHash: HASH_A,
    parameterHash: HASH_B,
    catalogHash: HASH_C,
    dataSelectionHash: HASH_D,
    simulationId: SIMULATION_ID,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: USER_ID,
    approvedBy: USER_ID,
    aiDraftId: null,
    reason: "activate",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}
