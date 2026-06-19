"use client";
import React from "react";

import { calculateProjectFinancials } from "@/features/complex-cost/project-financials";

const cellInput = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};

const labelStyle = { fontSize: 12, color: "var(--ink-500)" };

function num(value) {
  if (value === "" || value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatYuan(cents) {
  return `¥${((Number(cents) || 0) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// draft <-> payload helpers (rates stored as bps, shown as percent)
export function financialDraftFromProject(project) {
  return {
    isInvoiced: Boolean(project?.isInvoiced),
    outputVatRatePct:
      project?.outputVatRateBps != null
        ? String(project.outputVatRateBps / 100)
        : "",
    surtaxRatePct:
      project?.surtaxRateBps != null ? String(project.surtaxRateBps / 100) : "",
    procurementCostYuan:
      project?.procurementCostCents != null
        ? String(project.procurementCostCents / 100)
        : "",
  };
}

export function serializeFinancialDraft(draft) {
  return {
    isInvoiced: Boolean(draft.isInvoiced),
    outputVatRateBps: Math.round(num(draft.outputVatRatePct) * 100),
    surtaxRateBps: Math.round(num(draft.surtaxRatePct) * 100),
    procurementCostCents: Math.round(num(draft.procurementCostYuan) * 100),
  };
}

export default function ProjectFinancialSettings({
  value,
  onChange,
  expectedReceivableCents = 0,
}) {
  const draft = value;
  const set = (field, fieldValue) =>
    onChange({ ...draft, [field]: fieldValue });

  const settings = serializeFinancialDraft(draft);
  const result = calculateProjectFinancials({
    expectedReceivableCents,
    settings,
  });

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 14,
        background: "var(--bg-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--ink-700)",
        }}
      >
        <input
          type="checkbox"
          checked={draft.isInvoiced}
          onChange={(e) => set("isInvoiced", e.target.checked)}
        />
        需要开票(开票才计销项税)
      </label>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(120px, 1fr))",
          gap: 10,
        }}
      >
        <label style={labelStyle}>
          销项税率(%)
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.outputVatRatePct}
            onChange={(e) => set("outputVatRatePct", e.target.value)}
            style={{ ...cellInput, marginTop: 4 }}
            disabled={!draft.isInvoiced}
          />
        </label>
        <label style={labelStyle}>
          附加税率(% · 基于销项税)
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.surtaxRatePct}
            onChange={(e) => set("surtaxRatePct", e.target.value)}
            style={{ ...cellInput, marginTop: 4 }}
            disabled={!draft.isInvoiced}
          />
        </label>
        <label style={labelStyle}>
          采购成本(元)
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.procurementCostYuan}
            onChange={(e) => set("procurementCostYuan", e.target.value)}
            style={{ ...cellInput, marginTop: 4 }}
          />
        </label>
      </div>

      <div
        style={{
          borderTop: "1px dashed var(--line)",
          paddingTop: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          fontSize: 13,
        }}
      >
        <span style={{ color: "var(--ink-500)" }}>
          销项税{" "}
          <strong style={{ color: "var(--ink-900)" }}>
            {formatYuan(result.outputVatCents)}
          </strong>
        </span>
        <span style={{ color: "var(--ink-500)" }}>
          附加税{" "}
          <strong style={{ color: "var(--ink-900)" }}>
            {formatYuan(result.surtaxCents)}
          </strong>
        </span>
        <span style={{ color: "var(--ink-500)" }}>
          采购成本{" "}
          <strong style={{ color: "var(--ink-900)" }}>
            {formatYuan(result.procurementCostCents)}
          </strong>
        </span>
        <span style={{ color: "var(--ink-500)" }}>
          税费+采购合计{" "}
          <strong style={{ color: "var(--danger-600)" }}>
            {formatYuan(result.totalFinancialCostCents)}
          </strong>
        </span>
      </div>
    </div>
  );
}
