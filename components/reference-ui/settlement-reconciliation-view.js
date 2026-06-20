// Pure presentation helpers for the single-project settlement reconciliation
// panel (PRD §3.4). Kept out of the ops-reference monolith so the formatting
// and the confirm/lock gate logic can be unit-tested in isolation.

const SEVERITY_TONE = { block: "red", warn: "amber", pass: "green" };

export function reconciliationSeverityTone(severity) {
  return SEVERITY_TONE[severity] ?? "default";
}

export function formatYuanFromCents(cents) {
  const yuan = (Number(cents) || 0) / 100;
  return `¥${yuan.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatBpsAsPercent(bps) {
  return `${((Number(bps) || 0) / 100).toFixed(1)}%`;
}

// Build the statement rows (income / cost / tax / profit) for display.
export function buildReconciliationRows(reconciliation) {
  if (!reconciliation) return [];
  const { income, cost, tax, profit } = reconciliation;
  return [
    { key: "receivable", label: "应收 (不含税)", value: formatYuanFromCents(income?.receivableCents) },
    { key: "payable", label: "主播应付", value: formatYuanFromCents(cost?.payableCents) },
    { key: "external", label: "外部成本", value: formatYuanFromCents(cost?.externalCostCents) },
    { key: "procurement", label: "采购成本", value: formatYuanFromCents(cost?.procurementCents) },
    { key: "cost_total", label: "成本合计", value: formatYuanFromCents(cost?.totalCents) },
    { key: "vat", label: "销项增值税", value: formatYuanFromCents(tax?.outputVatCents) },
    { key: "surtax", label: "附加税", value: formatYuanFromCents(tax?.surtaxCents) },
    { key: "tax_total", label: "税费合计", value: formatYuanFromCents(tax?.taxTotalCents) },
    { key: "invoice", label: "开票金额 (含税)", value: formatYuanFromCents(tax?.invoiceAmountCents) },
    {
      key: "gross_margin",
      label: "毛利",
      value: formatYuanFromCents(profit?.grossMarginCents),
      tone: (profit?.grossMarginCents ?? 0) < 0 ? "red" : "green",
    },
    {
      key: "margin_rate",
      label: "毛利率",
      value: formatBpsAsPercent(profit?.marginRateBps),
      tone: (profit?.marginRateBps ?? 0) < 0 ? "red" : "default",
    },
  ];
}

// Derive the confirm/lock gate from a reconciliation result. When no
// reconciliation has been run yet the gate is "unknown" and does not block, so
// the operator must run the check to see the verdict.
export function reconciliationGate(reconciliation) {
  if (!reconciliation) {
    return { evaluated: false, canLock: true, hasBlocking: false, blocking: [], warnings: [] };
  }
  const checks = Array.isArray(reconciliation.checks) ? reconciliation.checks : [];
  const blocking = checks.filter((check) => check.severity === "block");
  const warnings = checks.filter((check) => check.severity === "warn");
  return {
    evaluated: true,
    canLock: blocking.length === 0,
    hasBlocking: blocking.length > 0,
    blocking,
    warnings,
  };
}

// One-line message describing why a lock is blocked, for use in alerts/hints.
export function reconciliationBlockMessage(reconciliation) {
  const { blocking } = reconciliationGate(reconciliation);
  if (blocking.length === 0) return "";
  return `结算校验未通过，无法锁定：${blocking.map((check) => check.message).join("；")}`;
}
