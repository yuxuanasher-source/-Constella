"use client";
import React from "react";

import { calculateSettlementItem } from "@/features/settlements/settlement-engine";

const PENALTY_TRIGGER_OPTIONS = [
  { value: "red_evidence", label: "红证据" },
  { value: "yellow_evidence", label: "黄证据" },
  { value: "non_system_time", label: "非系统计时" },
];

const PENALTY_MODE_OPTIONS = [
  { value: "percent", label: "按比例" },
  { value: "fixed", label: "固定金额" },
];

// ---- draft <-> payload conversion -----------------------------------------

export function builderRuleFromStored(value) {
  const record =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    hourlyTiers: Array.isArray(record.hourlyTiers)
      ? record.hourlyTiers.map((tier) => ({
          uptoMinutes:
            tier?.uptoMinutes == null ? "" : String(tier.uptoMinutes),
          ratePerHour:
            tier?.ratePerHour == null ? "" : String(tier.ratePerHour),
        }))
      : [],
    penalties: Array.isArray(record.penalties)
      ? record.penalties.map((penalty, index) => ({
          key: penalty?.key || `p-${index}`,
          trigger: penalty?.trigger || "red_evidence",
          mode: penalty?.mode === "fixed" ? "fixed" : "percent",
          value: penalty?.value == null ? "" : String(penalty.value),
          label: penalty?.label || "",
        }))
      : [],
    floorAmount: record.floorAmount == null ? "" : String(record.floorAmount),
    capAmount: record.capAmount == null ? "" : String(record.capAmount),
  };
}

function num(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Convert the editable draft into the API payload (numbers, dropping blanks).
export function serializeBuilderRule(draft) {
  const hourlyTiers = (draft.hourlyTiers || [])
    .map((tier) => ({
      uptoMinutes: num(tier.uptoMinutes),
      ratePerHour: num(tier.ratePerHour),
    }))
    .filter((tier) => tier.ratePerHour != null && tier.ratePerHour >= 0);

  const penalties = (draft.penalties || [])
    .map((penalty, index) => ({
      key: penalty.key || `${penalty.trigger}-${index}`,
      trigger: penalty.trigger,
      mode: penalty.mode === "fixed" ? "fixed" : "percent",
      value: num(penalty.value),
      label: penalty.label?.trim() || undefined,
    }))
    .filter((penalty) => penalty.value != null && penalty.value >= 0);

  const payload = {};
  if (hourlyTiers.length > 0) payload.hourlyTiers = hourlyTiers;
  if (penalties.length > 0) payload.penalties = penalties;
  const floorAmount = num(draft.floorAmount);
  const capAmount = num(draft.capAmount);
  if (floorAmount != null) payload.floorAmount = floorAmount;
  if (capAmount != null) payload.capAmount = capAmount;
  return payload;
}

// ---- preview ---------------------------------------------------------------

function formatMoney(value) {
  return `¥${(Number(value) || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function previewRow({
  label,
  durationMinutes,
  evidenceLevel,
  timeSource,
  rule,
  flatHourlyRate,
  method,
}) {
  const item = calculateSettlementItem({
    report: {
      id: "preview",
      settlementDuration: durationMinutes,
      timeSource,
      evidenceLevel,
    },
    rule: {
      settlementMethod: method || "cpt",
      hourlyRate: flatHourlyRate,
      baseSalary: 0,
      ...rule,
    },
  });
  return { label, item };
}

// ---- UI atoms --------------------------------------------------------------

const cellInput = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
};

const sectionTitle = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink-900)",
  marginBottom: 8,
};

const hint = { fontSize: 12, color: "var(--ink-400)", marginBottom: 8 };

function SmallButton({ children, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 10px",
        fontSize: 12,
        borderRadius: 6,
        cursor: "pointer",
        border: `1px solid ${tone === "danger" ? "var(--danger-600)" : "var(--line)"}`,
        background: "#fff",
        color: tone === "danger" ? "var(--danger-600)" : "var(--ink-700)",
      }}
    >
      {children}
    </button>
  );
}

export default function SettlementRuleBuilder({
  value,
  onChange,
  flatHourlyRate = 0,
  method = "cpt",
}) {
  const draft = value;
  const [sampleMinutes, setSampleMinutes] = React.useState("180");

  const update = (next) => onChange(next);

  const setTier = (index, field, fieldValue) => {
    const hourlyTiers = draft.hourlyTiers.map((tier, i) =>
      i === index ? { ...tier, [field]: fieldValue } : tier,
    );
    update({ ...draft, hourlyTiers });
  };
  const addTier = () =>
    update({
      ...draft,
      hourlyTiers: [...draft.hourlyTiers, { uptoMinutes: "", ratePerHour: "" }],
    });
  const removeTier = (index) =>
    update({
      ...draft,
      hourlyTiers: draft.hourlyTiers.filter((_, i) => i !== index),
    });

  const setPenalty = (index, field, fieldValue) => {
    const penalties = draft.penalties.map((penalty, i) =>
      i === index ? { ...penalty, [field]: fieldValue } : penalty,
    );
    update({ ...draft, penalties });
  };
  const addPenalty = () =>
    update({
      ...draft,
      penalties: [
        ...draft.penalties,
        {
          key: `p-${Date.now()}`,
          trigger: "red_evidence",
          mode: "percent",
          value: "",
          label: "",
        },
      ],
    });
  const removePenalty = (index) =>
    update({
      ...draft,
      penalties: draft.penalties.filter((_, i) => i !== index),
    });

  const serialized = serializeBuilderRule(draft);
  const sampleDuration = Number(sampleMinutes) || 0;
  const previews = [
    previewRow({
      label: "正常(系统计时 · 绿证据)",
      durationMinutes: sampleDuration,
      evidenceLevel: "green",
      timeSource: "system",
      rule: serialized,
      flatHourlyRate,
      method,
    }),
    previewRow({
      label: "异常(红证据)",
      durationMinutes: sampleDuration,
      evidenceLevel: "red",
      timeSource: "system",
      rule: serialized,
      flatHourlyRate,
      method,
    }),
  ];

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 14,
        background: "var(--bg-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {/* 阶梯小时单价 */}
      <div>
        <div style={sectionTitle}>阶梯小时单价</div>
        <div style={hint}>
          按直播时长分档计价(仅系统计时 + 绿证据生效)。留空则使用上面的「CPT
          小时单价」。最后一档「时长上限」留空表示不封顶。
        </div>
        {draft.hourlyTiers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.hourlyTiers.map((tier, index) => (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  type="number"
                  min="0"
                  placeholder="时长上限(分钟,留空=不封顶)"
                  value={tier.uptoMinutes}
                  onChange={(e) =>
                    setTier(index, "uptoMinutes", e.target.value)
                  }
                  style={cellInput}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="单价 / 小时"
                  value={tier.ratePerHour}
                  onChange={(e) =>
                    setTier(index, "ratePerHour", e.target.value)
                  }
                  style={cellInput}
                />
                <SmallButton tone="danger" onClick={() => removeTier(index)}>
                  删除
                </SmallButton>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <SmallButton onClick={addTier}>+ 增加档位</SmallButton>
        </div>
      </div>

      {/* 扣罚规则 */}
      <div>
        <div style={sectionTitle}>扣罚规则</div>
        <div style={hint}>
          命中触发条件时,从系统结算金额中扣减(按比例为系统金额的百分比,固定为金额)。
        </div>
        {draft.penalties.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.penalties.map((penalty, index) => (
              <div
                key={penalty.key || index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr 1.4fr auto",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <select
                  value={penalty.trigger}
                  onChange={(e) => setPenalty(index, "trigger", e.target.value)}
                  style={cellInput}
                >
                  {PENALTY_TRIGGER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={penalty.mode}
                  onChange={(e) => setPenalty(index, "mode", e.target.value)}
                  style={cellInput}
                >
                  {PENALTY_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step={penalty.mode === "percent" ? "1" : "0.01"}
                  placeholder={penalty.mode === "percent" ? "百分比 %" : "金额"}
                  value={penalty.value}
                  onChange={(e) => setPenalty(index, "value", e.target.value)}
                  style={cellInput}
                />
                <input
                  type="text"
                  placeholder="备注(可选)"
                  value={penalty.label}
                  onChange={(e) => setPenalty(index, "label", e.target.value)}
                  style={cellInput}
                />
                <SmallButton tone="danger" onClick={() => removePenalty(index)}>
                  删除
                </SmallButton>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <SmallButton onClick={addPenalty}>+ 增加扣罚</SmallButton>
        </div>
        <div style={{ ...hint, marginTop: 6, marginBottom: 0 }}>
          注:扣罚比例以 0–100 的百分比填写(如 50 表示扣 50%)。
        </div>
      </div>

      {/* 保底与封顶 */}
      <div>
        <div style={sectionTitle}>保底与封顶</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <label style={{ fontSize: 12, color: "var(--ink-500)" }}>
            单场保底(留空=不保底)
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.floorAmount}
              onChange={(e) =>
                update({ ...draft, floorAmount: e.target.value })
              }
              style={{ ...cellInput, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: "var(--ink-500)" }}>
            单场封顶(留空=不封顶)
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.capAmount}
              onChange={(e) => update({ ...draft, capAmount: e.target.value })}
              style={{ ...cellInput, marginTop: 4 }}
            />
          </label>
        </div>
      </div>

      {/* 实时预览 */}
      <div
        style={{
          borderTop: "1px dashed var(--line)",
          paddingTop: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={sectionTitle}>实时预览</div>
          <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
            样例时长
          </span>
          <input
            type="number"
            min="0"
            value={sampleMinutes}
            onChange={(e) => setSampleMinutes(e.target.value)}
            style={{ ...cellInput, width: 90 }}
          />
          <span style={{ fontSize: 12, color: "var(--ink-400)" }}>分钟</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {previews.map((preview) => (
            <div
              key={preview.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--ink-700)",
                background: "#fff",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <span>{preview.label}</span>
              <span>
                <span style={{ color: "var(--ink-400)", marginRight: 10 }}>
                  基础 {formatMoney(preview.item.breakdown.baseAmount)}
                  {preview.item.breakdown.penaltyAmount > 0
                    ? ` · 扣罚 -${formatMoney(preview.item.breakdown.penaltyAmount)}`
                    : ""}
                  {preview.item.breakdown.floorApplied ? " · 触发保底" : ""}
                  {preview.item.breakdown.capApplied ? " · 触发封顶" : ""}
                </span>
                <strong>{formatMoney(preview.item.computedAmount)}</strong>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
