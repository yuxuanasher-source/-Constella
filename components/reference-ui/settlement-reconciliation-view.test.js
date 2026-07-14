import { describe, expect, it } from "vitest";

import {
  buildReconciliationCheckGroups,
  buildReconciliationRows,
  formatBpsAsPercent,
  formatYuanFromCents,
  reconciliationRunMeta,
  reconciliationBlockMessage,
  reconciliationGate,
  reconciliationSeverityTone,
} from "./settlement-reconciliation-view";

const sample = {
  income: { receivableCents: 1_020_000 },
  cost: {
    payableCents: 410_000,
    externalCostCents: 70_000,
    procurementCents: 50_000,
    totalCents: 530_000,
  },
  tax: {
    outputVatCents: 61_200,
    surtaxCents: 7_344,
    taxTotalCents: 68_544,
    invoiceAmountCents: 1_081_200,
  },
  profit: { grossMarginCents: 421_456, marginRateBps: 4132, manualAdjustmentCents: 0 },
  checks: [
    { key: "evidence_red", severity: "warn", message: "存在红证据" },
  ],
};

describe("settlement-reconciliation-view", () => {
  it("formats cents as yuan and bps as percent", () => {
    expect(formatYuanFromCents(123_456)).toBe("¥1,234.56");
    expect(formatYuanFromCents(-987_654)).toBe("¥-9,876.54");
    expect(formatYuanFromCents(0)).toBe("¥0.00");
    expect(formatBpsAsPercent(4132)).toBe("41.3%");
    expect(formatBpsAsPercent(125)).toBe("1.3%");
  });

  it("maps severities to tones", () => {
    expect(reconciliationSeverityTone("block")).toBe("red");
    expect(reconciliationSeverityTone("warn")).toBe("amber");
    expect(reconciliationSeverityTone("pass")).toBe("green");
  });

  it("builds statement rows and flags a negative margin red", () => {
    const rows = buildReconciliationRows(sample);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.receivable.value).toBe("¥10,200.00");
    expect(byKey.invoice.value).toBe("¥10,812.00");
    expect(byKey.gross_margin.tone).toBe("green");

    const losing = buildReconciliationRows({
      ...sample,
      profit: { grossMarginCents: -5000, marginRateBps: -200 },
    });
    expect(losing.find((r) => r.key === "gross_margin").tone).toBe("red");
  });

  it("treats a not-yet-run reconciliation as non-blocking but un-evaluated", () => {
    const gate = reconciliationGate(null);
    expect(gate.evaluated).toBe(false);
    expect(gate.canLock).toBe(false);
    expect(gate.hasBlocking).toBe(false);
    expect(gate.disabledReasons).toEqual([
      "锁定前请先运行「单项目结算校验」",
    ]);
  });

  it("blocks locking when a block-level check is present", () => {
    const blocked = {
      inputFreshness: { stale: false },
      checks: [
        {
          key: "income_configured",
          severity: "block",
          message: "未配置应收单价",
          blockCategory: "missing_data",
        },
        { key: "evidence_red", severity: "warn", message: "存在红证据" },
      ],
    };
    const gate = reconciliationGate(blocked);
    expect(gate.evaluated).toBe(true);
    expect(gate.canLock).toBe(false);
    expect(gate.hasBlocking).toBe(true);
    expect(gate.blocking).toHaveLength(1);
    expect(gate.warnings).toHaveLength(1);
    expect(gate.disabledReasons).toEqual([
      "缺少数据：未配置应收单价",
    ]);
    expect(reconciliationBlockMessage(blocked)).toBe(
      "结算校验未通过，无法锁定：缺少数据：未配置应收单价",
    );
  });

  it("warns but allows locking when only warnings are present", () => {
    const gate = reconciliationGate(sample);
    expect(gate.canLock).toBe(true);
    expect(gate.warnings).toHaveLength(1);
    expect(reconciliationBlockMessage(sample)).toBe("");
  });

  it("groups core and custom checks with accessible source, severity, category, and rule labels", () => {
    const groups = buildReconciliationCheckGroups({
      checks: [
        {
          key: "gross_margin_positive",
          source: "core",
          severity: "pass",
          message: "毛利为正",
        },
        {
          key: "custom_over_cap",
          source: { kind: "custom_rule", label: "项目风险规则" },
          severity: "block",
          blockCategory: "custom_rule_condition",
          message: "主播应付超过应收上限",
          ruleVersion: {
            id: "rule-risk-v3",
            versionNumber: 3,
            contractTitle: "应付上限校验",
            contractHash: "abcdef1234567890",
            formula: "payable > receivable",
            ast: { type: "binary" },
          },
        },
        {
          key: "exception_open",
          source: { kind: "custom_rule", label: "项目风险规则" },
          severity: "warn",
          blockCategory: "unresolved_exception",
          message: "存在一条待复核异常",
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual([
      "系统校验",
      "项目风险规则",
    ]);
    expect(groups[1].checks.map((check) => check.severityLabel)).toEqual([
      "阻断",
      "告警",
    ]);
    expect(groups[1].checks[0].categoryLabel).toBe("自定义规则条件");
    expect(groups[1].checks[0].ruleVersionLabel).toBe(
      "应付上限校验 v3 · 合同 abcdef12",
    );
    expect(groups[1].checks[0].accessibleText).toBe(
      "阻断 · 项目风险规则 · 自定义规则条件 · 主播应付超过应收上限 · 应付上限校验 v3 · 合同 abcdef12",
    );
    expect(groups[1].checks[0].ruleVersionLabel).not.toContain("payable");
    expect(groups[1].checks[0].ruleVersionLabel).not.toContain("binary");
  });

  it("marks stale reconciliation runs as non-lockable with an exact reason", () => {
    const stale = {
      runAt: "2026-07-12T01:02:00.000Z",
      inputFreshness: {
        stale: true,
        reason: "结算输入已在校验后更新",
        updatedAt: "2026-07-12T01:05:00.000Z",
      },
      checks: [{ key: "all_good", severity: "pass", message: "校验通过" }],
    };

    expect(reconciliationRunMeta(stale)).toEqual({
      runAtLabel: "运行时间 2026-07-12 01:02",
      freshnessLabel: "输入已过期：结算输入已在校验后更新",
      stale: true,
    });
    expect(reconciliationGate(stale)).toMatchObject({
      evaluated: true,
      canLock: false,
      hasBlocking: false,
      stale: true,
      disabledReasons: ["输入已过期：结算输入已在校验后更新"],
    });
  });
});
