import { describe, expect, it, vi } from "vitest";

import type { CustomSettlementRuleVersion } from "./custom-rule-repository";
import { validateCustomRuleFormula } from "./custom-rule-validator";
import {
  runProjectSettlementReconciliation,
  SupabaseReconciliationDataSource,
  type ReconciliationDataSource,
} from "./project-settlement-reconciliation-service";
import type { SettlementActor } from "./settlement-service";

const actor: SettlementActor = {
  userId: "user-1",
  name: "运营经理",
  role: "ops_manager",
  organizationId: "org-1",
};
const UUID_ORG = "00000000-0000-4000-8000-000000000001";
const UUID_PROJECT = "00000000-0000-4000-8000-000000000002";
const UUID_USER = "00000000-0000-4000-8000-000000000003";
const UUID_RULE = "00000000-0000-4000-8000-000000000004";
const UUID_SIMULATION = "00000000-0000-4000-8000-000000000005";

function createSource(
  overrides: Partial<{
    receivable: { totals: Totals; evidence: Evidence };
    payable: { totals: Totals; evidence: Evidence };
    cost: { costCents: number; revenueOffsetCents: number; adjustmentCents: number };
    settings: {
      isInvoiced: boolean;
      outputVatRateBps: number;
      surtaxRateBps: number;
      procurementCostCents: number;
    };
  }> = {},
): ReconciliationDataSource {
  const zeroEvidence = { green: 0, yellow: 0, red: 0, unknown: 0 };
  const receivable = overrides.receivable ?? {
    totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
    evidence: { green: 8, yellow: 0, red: 0, unknown: 0 },
  };
  const payable = overrides.payable ?? {
    totals: { computedCents: 400_000, manualCents: 0, adjustmentCents: 0 },
    evidence: zeroEvidence,
  };
  const cost = overrides.cost ?? {
    costCents: 100_000,
    revenueOffsetCents: 0,
    adjustmentCents: 0,
  };
  const settings = overrides.settings ?? {
    isInvoiced: false,
    outputVatRateBps: 0,
    surtaxRateBps: 0,
    procurementCostCents: 0,
  };

  return {
    getBatchTotals: vi.fn(async ({ batchType }) =>
      batchType === "receivable" ? receivable : payable,
    ),
    getConfirmedCostSummary: vi.fn(async () => cost),
    getFinancialSettings: vi.fn(async () => settings),
  };
}

type Totals = { computedCents: number; manualCents: number; adjustmentCents: number };
type Evidence = { green: number; yellow: number; red: number; unknown?: number };

describe("runProjectSettlementReconciliation", () => {
  it("composes batch, cost and tax inputs into the reconciliation result", async () => {
    const source = createSource({
      receivable: {
        totals: { computedCents: 1_000_000, manualCents: 20_000, adjustmentCents: 0 },
        evidence: { green: 9, yellow: 1, red: 0, unknown: 0 },
      },
      payable: {
        totals: { computedCents: 400_000, manualCents: 0, adjustmentCents: 10_000 },
        evidence: { green: 0, yellow: 0, red: 0, unknown: 0 },
      },
      cost: { costCents: 100_000, revenueOffsetCents: 30_000, adjustmentCents: 5_000 },
      settings: {
        isInvoiced: true,
        outputVatRateBps: 600,
        surtaxRateBps: 1200,
        procurementCostCents: 50_000,
      },
    });

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    // R = 1,000,000 + 20,000 manual.
    expect(result.income.receivableCents).toBe(1_020_000);
    // payable = 400,000 + 10,000 adjustment.
    expect(result.cost.payableCents).toBe(410_000);
    // external = cost 100,000 - revenue_offset 30,000.
    expect(result.cost.externalCostCents).toBe(70_000);
    expect(result.cost.procurementCents).toBe(50_000);
    expect(result.profit.manualAdjustmentCents).toBe(5_000);
    // VAT = 1,020,000 * 6% = 61,200.
    expect(result.tax.outputVatCents).toBe(61_200);
    expect(result.evidence.yellow).toBe(1);
    expect(result.canConfirm).toBe(true);
  });

  it("falls back to payable evidence when no receivable batch exists yet", async () => {
    const source = createSource({
      receivable: {
        totals: { computedCents: 500_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 0, yellow: 0, red: 0, unknown: 0 },
      },
      payable: {
        totals: { computedCents: 100_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 3, yellow: 0, red: 2, unknown: 0 },
      },
    });

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(result.evidence.red).toBe(2);
    expect(
      result.checks.some((c) => "key" in c && c.key === "evidence_red"),
    ).toBe(true);
  });

  it("rejects non-MCN roles", async () => {
    const source = createSource();
    await expect(
      runProjectSettlementReconciliation({
        source,
        actor: { ...actor, role: "streamer" },
        projectId: "p-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).rejects.toThrow(/MCN staff/);
    expect(source.getBatchTotals).not.toHaveBeenCalled();
  });

  it("rejects an inverted period", async () => {
    const source = createSource();
    await expect(
      runProjectSettlementReconciliation({
        source,
        actor,
        projectId: "p-1",
        periodStart: "2026-06-30",
        periodEnd: "2026-06-01",
      }),
    ).rejects.toThrow(/period end cannot be earlier/);
  });

  it("keeps the no-active-rule DTO byte-compatible except immutable run metadata", async () => {
    const source = createSource() as ReconciliationDataSource &
      Record<string, ReturnType<typeof vi.fn>>;
    source.resolveActiveReconciliationRule = vi.fn(async () => null);
    source.persistReconciliationRun = vi.fn(async (snapshot: any) => ({
      id: "run-1",
      createdAt: "2026-07-14T00:00:00.000Z",
      inputHash: snapshot.inputHash,
      result: snapshot.result,
    }));

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    const { run, ...withoutRun } = result as typeof result & { run?: unknown };
    void run;

    const coreOnly = await runProjectSettlementReconciliation({
      source: createSource(),
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(JSON.stringify(withoutRun)).toBe(JSON.stringify(coreOnly));
    expect(source.persistReconciliationRun).toHaveBeenCalledOnce();
  });

  it("loads inputs, computes core, builds variables, executes custom checks, appends, and persists one snapshot in order", async () => {
    const events: string[] = [];
    const rule = reconciliationRule(
      '[warn_if(red_evidence_count > 0, "存在红证据"), block_if(margin_rate < rate_percent(60), "毛利率低于 60%")]',
    );
    const source = createSource({
      receivable: {
        totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 7, yellow: 0, red: 1, unknown: 0 },
      },
    }) as ReconciliationDataSource & Record<string, ReturnType<typeof vi.fn>>;
    vi.mocked(source.getBatchTotals).mockImplementation(async ({ batchType }) => {
      events.push(`load:${batchType}`);
      return batchType === "receivable"
        ? {
            totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
            evidence: { green: 7, yellow: 0, red: 1, unknown: 0 },
          }
        : {
            totals: { computedCents: 400_000, manualCents: 0, adjustmentCents: 0 },
            evidence: { green: 0, yellow: 0, red: 0, unknown: 0 },
          };
    });
    vi.mocked(source.getConfirmedCostSummary).mockImplementation(async () => {
      events.push("load:external_cost");
      return { costCents: 100_000, revenueOffsetCents: 0, adjustmentCents: 0 };
    });
    vi.mocked(source.getFinancialSettings).mockImplementation(async () => {
      events.push("load:financial");
      return {
        isInvoiced: false,
        outputVatRateBps: 0,
        surtaxRateBps: 0,
        procurementCostCents: 0,
      };
    });
    source.resolveActiveReconciliationRule = vi.fn(async () => {
      events.push("load:active_rule");
      return rule;
    });
    source.persistReconciliationRun = vi.fn(async (snapshot: any) => {
      events.push("persist:run");
      expect(
        snapshot.finalChecks.map((check: { source: string }) => check.source),
      ).toEqual(["core", "custom_rule", "custom_rule"]);
      return {
        id: "run-1",
        createdAt: "2026-07-14T00:00:00.000Z",
        inputHash: snapshot.inputHash,
        result: snapshot.result,
      };
    });

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      onStep: (step) => events.push(step),
    });

    expect(events).toEqual([
      "load:receivable",
      "load:payable",
      "load:external_cost",
      "load:financial",
      "load:active_rule",
      "compute:core",
      "build:variables",
      "execute:custom_rule",
      "append:custom_checks",
      "persist:run",
    ]);
    expect(result.checks.map((check) => check.message)).toEqual([
      expect.stringContaining("红"),
      "存在红证据",
      "毛利率低于 60%",
    ]);
    expect(result.canConfirm).toBe(false);
    expect(source.persistReconciliationRun).toHaveBeenCalledOnce();
  });

  it("reuses a cached immutable run only when the full input hash matches", async () => {
    const source = createSource() as ReconciliationDataSource &
      Record<string, ReturnType<typeof vi.fn>>;
    source.resolveActiveReconciliationRule = vi.fn(async () => null);
    source.getCachedReconciliationRun = vi.fn(async ({ inputHash }: any) => ({
      id: "cached-run",
      inputHash,
      result: {
        ...cachedCoreResult(),
        run: { id: "cached-run", inputHash },
      },
      createdAt: "2026-07-14T00:00:00.000Z",
    }));
    source.persistReconciliationRun = vi.fn();

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(result.run?.id).toBe("cached-run");
    expect(Object.isFrozen(result)).toBe(true);
    expect(source.persistReconciliationRun).not.toHaveBeenCalled();
  });

  it("requires finalized money, evidence, and financial inputs before persisting", async () => {
    const source = createSource({
      receivable: {
        totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
        evidence: { green: 0, yellow: 0, red: 0, unknown: 1 },
      },
    }) as ReconciliationDataSource & Record<string, ReturnType<typeof vi.fn>>;
    vi.mocked(source.getBatchTotals).mockResolvedValueOnce({
      totals: { computedCents: 1_000_000, manualCents: 0, adjustmentCents: 0 },
      evidence: { green: 0, yellow: 0, red: 0, unknown: 1 },
      finalized: false,
    });
    source.persistReconciliationRun = vi.fn();

    await expect(
      runProjectSettlementReconciliation({
        source,
        actor,
        projectId: "p-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).rejects.toThrow(/finalized inputs/);
    expect(source.persistReconciliationRun).not.toHaveBeenCalled();
  });

  it("verifies the caller hash for confirm or lock style rechecks and does not expose formula or AST", async () => {
    const source = createSource() as ReconciliationDataSource &
      Record<string, ReturnType<typeof vi.fn>>;
    source.resolveActiveReconciliationRule = vi.fn(async () =>
      reconciliationRule('pass_if(true, "核对通过")'),
    );
    source.persistReconciliationRun = vi.fn(async (snapshot: any) => ({
      id: "run-1",
      inputHash: snapshot.inputHash,
      createdAt: "2026-07-14T00:00:00.000Z",
      result: snapshot.result,
    }));

    await expect(
      runProjectSettlementReconciliation({
        source,
        actor,
        projectId: "p-1",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        expectedInputHash: "0".repeat(64),
      }),
    ).rejects.toThrow(/input hash changed/);

    const result = await runProjectSettlementReconciliation({
      source,
      actor,
      projectId: "p-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    expect(JSON.stringify(result)).not.toMatch(/compiledAst|formula":/);
    expect(JSON.stringify(result)).toContain(UUID_RULE);
  });
});

function cachedCoreResult() {
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
    evidence: { green: 8, yellow: 0, red: 0, unknown: 0 },
    checks: [],
    hasBlocking: false,
    hasWarning: false,
    canConfirm: true,
    canLock: true,
  };
}

function reconciliationRule(formula: string): CustomSettlementRuleVersion {
  const validation = validateCustomRuleFormula(formula, {
    scope: "reconciliation",
    executionGrain: "project_period",
    compositionMode: "check",
  });
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.code ?? "validation failed");
  }
  return {
    id: UUID_RULE,
    organizationId: UUID_ORG,
    projectId: UUID_PROJECT,
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
    contractHash: "a".repeat(64),
    parameterHash: "b".repeat(64),
    catalogHash: "c".repeat(64),
    dataSelectionHash: "d".repeat(64),
    simulationId: UUID_SIMULATION,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveUntil: null,
    createdBy: UUID_USER,
    approvedBy: UUID_USER,
    aiDraftId: null,
    reason: "activate",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
  };
}

describe("SupabaseReconciliationDataSource", () => {
  it("normalizes numeric(12,2) yuan batch amounts to cents", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: function () {
            return this;
          },
          neq: function () {
            return this;
          },
          lte: function () {
            return this;
          },
          gte: function () {
            return this;
          },
          returns: async () =>
            table === "settlement_batches"
              ? {
                  data: [
                    {
                      computed_amount: 1234.56,
                      manual_amount: 10.0,
                      adjustment_amount: 0,
                      evidence_summary: { green: 3, yellow: 1, red: 0 },
                    },
                  ],
                  error: null,
                }
              : { data: [], error: null },
        }),
      }),
    };

    const source = new SupabaseReconciliationDataSource(client as never);
    const { totals, evidence } = await source.getBatchTotals({
      organizationId: "org-1",
      projectId: "p-1",
      batchType: "receivable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    // 1234.56 yuan -> 123456 cents; 10.00 yuan -> 1000 cents.
    expect(totals.computedCents).toBe(123_456);
    expect(totals.manualCents).toBe(1_000);
    expect(evidence.green).toBe(3);
    expect(evidence.yellow).toBe(1);
  });
});
