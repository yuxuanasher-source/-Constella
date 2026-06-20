import {
  calculateProjectFinancials,
  type ProjectFinancialSettings,
} from "@/features/complex-cost/project-financials";

// Single-project settlement reconciliation (PRD §3.4).
//
// Merges the three actual lines of a project for one settlement period —
// income (receivable batches), cost (payable batch + confirmed external cost
// items + procurement) and tax (project financial settings) — into one
// statement plus a pass/warn/block verdict. The verdict gates whether the
// settlement batches may move generated -> confirmed -> locked.
//
// Pure and side-effect free: all amounts in cents, all rates in bps. It reuses
// calculateProjectFinancials for VAT/surtax so the tax math has a single home.

export type ReconciliationSeverity = "pass" | "warn" | "block";

export type ReconciliationCheckKey =
  | "income_configured"
  | "tax_complete"
  | "margin_floor"
  | "evidence_red"
  | "evidence_yellow_ratio"
  | "pool_consistency";

export type ReconciliationCheck = {
  key: ReconciliationCheckKey;
  severity: ReconciliationSeverity;
  message: string;
};

export type ReconciliationConfig = {
  // Block confirmation when the gross margin is negative.
  blockOnNegativeMargin: boolean;
  // Block confirmation when marginRateBps falls below this floor (after the
  // negative-margin check). 0 = only negative margin blocks.
  marginRateFloorBps: number;
  // Warn when the yellow-evidence share of priced reports exceeds this ratio.
  yellowRatioWarnBps: number;
  // Warn when any red-evidence report is present.
  warnOnRedEvidence: boolean;
  // Treat a zero receivable as an explicit "no receivable this period" instead
  // of a misconfiguration (skips the income_configured block).
  allowZeroReceivable: boolean;
};

export const DEFAULT_RECONCILIATION_CONFIG: ReconciliationConfig = {
  blockOnNegativeMargin: true,
  marginRateFloorBps: 0,
  yellowRatioWarnBps: 2000, // 20%
  warnOnRedEvidence: true,
  allowZeroReceivable: false,
};

export type ReconciliationEvidence = {
  green: number;
  yellow: number;
  red: number;
  unknown?: number;
};

export type ProjectSettlementReconciliationInput = {
  // Income line.
  receivableComputedCents: number;
  receivableManualCents?: number;
  // Cost line.
  payableTotalCents: number; // payable batch: computed + manual + adjustment
  externalCostCents: number; // confirmed cost items: cost - revenue_offset
  manualAdjustmentCents?: number; // direction=adjustment, surfaced separately
  // Tax line (procurement lives here and is counted into cost, not tax).
  financialSettings: ProjectFinancialSettings;
  // Governance signals.
  evidence?: ReconciliationEvidence;
  poolMismatchReportIds?: string[];
  // When the owner force-releases, a margin block is downgraded to a warning so
  // the batch can be confirmed; non-margin blocks are never overridable.
  forceApproved?: boolean;
  config?: Partial<ReconciliationConfig>;
};

export type ProjectSettlementReconciliationResult = {
  income: {
    receivableCents: number; // R (computed + manual, ex-tax)
  };
  cost: {
    payableCents: number;
    externalCostCents: number;
    procurementCents: number;
    totalCents: number; // COST = payable + external + procurement
  };
  tax: {
    isInvoiced: boolean;
    outputVatCents: number;
    surtaxCents: number;
    taxTotalCents: number; // VAT + surtax
    invoiceAmountCents: number; // R + VAT (face value billed to the client)
  };
  profit: {
    grossMarginCents: number; // GM = R - COST - TAX
    marginRateBps: number; // GM / R
    manualAdjustmentCents: number;
  };
  evidence: ReconciliationEvidence;
  checks: ReconciliationCheck[];
  hasBlocking: boolean;
  hasWarning: boolean;
  canConfirm: boolean;
  canLock: boolean;
};

export function reconcileProjectSettlement(
  input: ProjectSettlementReconciliationInput,
): ProjectSettlementReconciliationResult {
  const config = { ...DEFAULT_RECONCILIATION_CONFIG, ...input.config };

  const receivableCents =
    nonNegative(input.receivableComputedCents) +
    nonNegative(input.receivableManualCents);
  const payableCents = nonNegative(input.payableTotalCents);
  const externalCostCents = signed(input.externalCostCents);
  const procurementCents = nonNegative(
    input.financialSettings.procurementCostCents,
  );
  const manualAdjustmentCents = signed(input.manualAdjustmentCents);

  // Tax: reuse the shared engine. It also returns procurement, but we count
  // procurement into the cost line below, so tax here is VAT + surtax only.
  const financials = calculateProjectFinancials({
    expectedReceivableCents: receivableCents,
    settings: input.financialSettings,
  });
  const outputVatCents = financials.outputVatCents;
  const surtaxCents = financials.surtaxCents;
  const taxTotalCents = outputVatCents + surtaxCents;
  const invoiceAmountCents = receivableCents + outputVatCents;

  const totalCostCents = payableCents + externalCostCents + procurementCents;
  const grossMarginCents = receivableCents - totalCostCents - taxTotalCents;
  const marginRateBps =
    receivableCents > 0
      ? Math.round((grossMarginCents * 10000) / receivableCents)
      : 0;

  const evidence: ReconciliationEvidence = {
    green: nonNegative(input.evidence?.green),
    yellow: nonNegative(input.evidence?.yellow),
    red: nonNegative(input.evidence?.red),
    unknown: nonNegative(input.evidence?.unknown),
  };

  const checks = buildChecks({
    config,
    receivableCents,
    grossMarginCents,
    marginRateBps,
    isInvoiced: financials.isInvoiced,
    outputVatRateBps: financials.outputVatRateBps,
    evidence,
    poolMismatchReportIds: input.poolMismatchReportIds ?? [],
    forceApproved: Boolean(input.forceApproved),
  });

  const hasBlocking = checks.some((check) => check.severity === "block");
  const hasWarning = checks.some((check) => check.severity === "warn");
  const canConfirm = !hasBlocking;

  return {
    income: { receivableCents },
    cost: {
      payableCents,
      externalCostCents,
      procurementCents,
      totalCents: totalCostCents,
    },
    tax: {
      isInvoiced: financials.isInvoiced,
      outputVatCents,
      surtaxCents,
      taxTotalCents,
      invoiceAmountCents,
    },
    profit: {
      grossMarginCents,
      marginRateBps,
      manualAdjustmentCents,
    },
    evidence,
    checks,
    hasBlocking,
    hasWarning,
    // Locking requires a confirmable, non-loss batch unless force-released.
    canConfirm,
    canLock: canConfirm,
  };
}

function buildChecks({
  config,
  receivableCents,
  grossMarginCents,
  marginRateBps,
  isInvoiced,
  outputVatRateBps,
  evidence,
  poolMismatchReportIds,
  forceApproved,
}: {
  config: ReconciliationConfig;
  receivableCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  isInvoiced: boolean;
  outputVatRateBps: number;
  evidence: ReconciliationEvidence;
  poolMismatchReportIds: string[];
  forceApproved: boolean;
}): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];

  // 1. Income configured.
  if (receivableCents <= 0 && !config.allowZeroReceivable) {
    checks.push({
      key: "income_configured",
      severity: "block",
      message: "项目未配置应收单价或本期应收为 0，请先配置应收规则",
    });
  }

  // 2. Tax completeness: invoiced projects must carry a VAT rate.
  if (isInvoiced && outputVatRateBps <= 0) {
    checks.push({
      key: "tax_complete",
      severity: "block",
      message: "项目已标记开票，但销项增值税率为 0，请补充税率",
    });
  }

  // 3. Margin floor. Force-release downgrades a margin block to a warning.
  const marginBlocked =
    (config.blockOnNegativeMargin && grossMarginCents < 0) ||
    (receivableCents > 0 && marginRateBps < config.marginRateFloorBps);
  if (marginBlocked) {
    checks.push({
      key: "margin_floor",
      severity: forceApproved ? "warn" : "block",
      message:
        grossMarginCents < 0
          ? "项目毛利为负，需 owner 填写理由后强制放行"
          : "项目毛利率低于阈值，需 owner 填写理由后强制放行",
    });
  }

  // 4. Red evidence present.
  if (config.warnOnRedEvidence && evidence.red > 0) {
    checks.push({
      key: "evidence_red",
      severity: "warn",
      message: `存在 ${evidence.red} 条红证据报告，CPT 不计费，请复核`,
    });
  }

  // 5. Yellow evidence ratio.
  const priced = evidence.green + evidence.yellow + evidence.red;
  if (priced > 0) {
    const yellowRatioBps = Math.round((evidence.yellow * 10000) / priced);
    if (yellowRatioBps > config.yellowRatioWarnBps) {
      checks.push({
        key: "evidence_yellow_ratio",
        severity: "warn",
        message: `黄证据占比 ${(yellowRatioBps / 100).toFixed(1)}% 偏高，请复核`,
      });
    }
  }

  // 6. Pool consistency between receivable and payable coverage.
  if (poolMismatchReportIds.length > 0) {
    checks.push({
      key: "pool_consistency",
      severity: "warn",
      message: `应收/应付覆盖报告不一致，差异 ${poolMismatchReportIds.length} 条`,
    });
  }

  return checks;
}

function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.trunc(value as number)
    : 0;
}

function signed(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}
