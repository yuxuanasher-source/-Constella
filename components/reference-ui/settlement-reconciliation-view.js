// Pure presentation helpers for the single-project settlement reconciliation
// panel (PRD §3.4). Kept out of the ops-reference monolith so the formatting
// and the confirm/lock gate logic can be unit-tested in isolation.

const SEVERITY_TONE = { block: "red", warn: "amber", pass: "green" };
const SEVERITY_LABEL = { block: "阻断", warn: "告警", pass: "通过" };
const SOURCE_LABEL = {
  core: "系统校验",
  system: "系统校验",
  custom: "自定义规则校验",
  custom_rule: "自定义规则校验",
};
const BLOCK_CATEGORY_LABEL = {
  missing_data: "缺少数据",
  unresolved_exception: "未解决异常",
  custom_rule_condition: "自定义规则条件",
};
const SEVERITY_ORDER = { block: 0, warn: 1, pass: 2 };

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

function formatRunDate(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}

function sourceLabel(check) {
  const source = check?.source;
  if (source && typeof source === "object") {
    return source.label || SOURCE_LABEL[source.kind] || "自定义规则校验";
  }
  return SOURCE_LABEL[source] || SOURCE_LABEL[check?.sourceKind] || "系统校验";
}

function blockCategoryLabel(check) {
  return BLOCK_CATEGORY_LABEL[check?.blockCategory] ?? "";
}

function ruleVersionLabel(check) {
  const version = check?.ruleVersion;
  if (!version) return "";
  const title =
    version.contractTitle ||
    version.title ||
    version.label ||
    "内部规则版本";
  const number =
    version.versionNumber != null
      ? ` v${version.versionNumber}`
      : version.version != null
        ? ` v${version.version}`
        : "";
  const hash = version.contractHash ? ` · 合同 ${String(version.contractHash).slice(0, 8)}` : "";
  return `${title}${number}${hash}`;
}

function actionableCheckReason(check) {
  const prefix = blockCategoryLabel(check);
  return prefix ? `${prefix}：${check.message}` : check.message;
}

export function reconciliationRunMeta(reconciliation) {
  const freshness = reconciliation?.inputFreshness ?? {};
  const stale = Boolean(freshness.stale);
  const reason = freshness.reason || "校验输入已更新";
  return {
    runAtLabel: `运行时间 ${formatRunDate(reconciliation?.runAt)}`,
    freshnessLabel: stale ? `输入已过期：${reason}` : "输入新鲜",
    stale,
  };
}

export function buildReconciliationCheckGroups(reconciliation) {
  const checks = Array.isArray(reconciliation?.checks)
    ? reconciliation.checks
    : [];
  const grouped = new Map();
  checks.forEach((check, index) => {
    const label = sourceLabel(check);
    if (!grouped.has(label)) {
      grouped.set(label, { key: label, label, checks: [] });
    }
    const severityLabel = SEVERITY_LABEL[check.severity] ?? "校验";
    const categoryLabel = blockCategoryLabel(check);
    const versionLabel = ruleVersionLabel(check);
    const accessibleParts = [
      severityLabel,
      label,
      categoryLabel,
      check.message,
      versionLabel,
    ].filter(Boolean);
    grouped.get(label).checks.push({
      ...check,
      order: check.order ?? index,
      sourceLabel: label,
      severityLabel,
      categoryLabel,
      ruleVersionLabel: versionLabel,
      actionableReason: actionableCheckReason(check),
      accessibleText: accessibleParts.join(" · "),
    });
  });
  return Array.from(grouped.values()).map((group) => ({
    ...group,
    checks: group.checks.sort((left, right) => {
      const severity =
        (SEVERITY_ORDER[left.severity] ?? 9) -
        (SEVERITY_ORDER[right.severity] ?? 9);
      if (severity !== 0) return severity;
      return left.order - right.order;
    }),
  }));
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
    return {
      evaluated: false,
      canLock: false,
      hasBlocking: false,
      stale: false,
      blocking: [],
      warnings: [],
      disabledReasons: ["锁定前请先运行「单项目结算校验」"],
    };
  }
  const checks = Array.isArray(reconciliation.checks) ? reconciliation.checks : [];
  const blocking = checks.filter((check) => check.severity === "block");
  const warnings = checks.filter((check) => check.severity === "warn");
  const runMeta = reconciliationRunMeta(reconciliation);
  const disabledReasons = [
    ...(runMeta.stale ? [runMeta.freshnessLabel] : []),
    ...blocking.map(actionableCheckReason),
  ];
  return {
    evaluated: true,
    canLock: disabledReasons.length === 0,
    hasBlocking: blocking.length > 0,
    stale: runMeta.stale,
    blocking,
    warnings,
    disabledReasons,
  };
}

// One-line message describing why a lock is blocked, for use in alerts/hints.
export function reconciliationBlockMessage(reconciliation) {
  const gate = reconciliationGate(reconciliation);
  if (gate.disabledReasons.length === 0) return "";
  if (!gate.evaluated) return gate.disabledReasons[0];
  return `结算校验未通过，无法锁定：${gate.disabledReasons.join("；")}`;
}
