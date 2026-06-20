import { describe, expect, it } from "vitest";

import {
  buildReconciliationRows,
  formatBpsAsPercent,
  formatYuanFromCents,
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
    expect(formatYuanFromCents(0)).toBe("¥0.00");
    expect(formatBpsAsPercent(4132)).toBe("41.3%");
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
    expect(gate.canLock).toBe(true);
    expect(gate.hasBlocking).toBe(false);
  });

  it("blocks locking when a block-level check is present", () => {
    const blocked = {
      checks: [
        { key: "income_configured", severity: "block", message: "未配置应收单价" },
        { key: "evidence_red", severity: "warn", message: "存在红证据" },
      ],
    };
    const gate = reconciliationGate(blocked);
    expect(gate.evaluated).toBe(true);
    expect(gate.canLock).toBe(false);
    expect(gate.hasBlocking).toBe(true);
    expect(gate.blocking).toHaveLength(1);
    expect(gate.warnings).toHaveLength(1);
    expect(reconciliationBlockMessage(blocked)).toContain("未配置应收单价");
  });

  it("warns but allows locking when only warnings are present", () => {
    const gate = reconciliationGate(sample);
    expect(gate.canLock).toBe(true);
    expect(gate.warnings).toHaveLength(1);
    expect(reconciliationBlockMessage(sample)).toBe("");
  });
});
