"use client";

// AI 草稿确认台（L2 落地 UI）。消费 /api/ai/drafts*：列出本组织 AI 草稿、
// 生成结算批次草稿、人工确认 / 弃用。确认是人的动作（铁律 2）——AI 只出草稿，
// 这里的「确认」按钮对应 confirmed_by 入审计。数字直接来自结构化 payload，不改口径。

import * as React from "react";

import {
  draftHeadline,
  draftStatusLabel,
  draftTypeLabel,
  formatYuan,
  readRetrospectiveDraft,
  readSettlementDraft,
} from "@/features/ai/draft-view";

const STATUS_TABS = [
  { key: "pending", label: "待确认" },
  { key: "confirmed", label: "已确认" },
  { key: "discarded", label: "已弃用" },
];

const STATUS_TONE = {
  pending: { bg: "#fef6e7", fg: "#a86a00", bd: "#f3e2bd" },
  confirmed: { bg: "#e7f5ee", fg: "#0e8a4d", bd: "#bfe6cf" },
  discarded: { bg: "#f1f2f5", fg: "#6b7280", bd: "#e3e5ea" },
};

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.discarded;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.bd}`,
      }}
    >
      {draftStatusLabel(status)}
    </span>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: accent || "var(--ink-900)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SettlementDraftBody({ payload }) {
  const view = readSettlementDraft(payload);
  const isReceivable = view.scope?.batchType === "receivable";
  const amountLabel = isReceivable ? "应收" : "应付";
  const totalAmount = isReceivable
    ? view.totals.receivableCents
    : view.totals.payableCents;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <Metric label="项目数" value={view.groups.length} />
        <Metric label="条目数" value={view.totals.itemCount} />
        <Metric label={amountLabel + "合计"} value={formatYuan(totalAmount)} accent="var(--blue-600)" />
        <Metric label="可计 CPT" value={view.totals.cptEligibleCount} accent="#0e8a4d" />
        <Metric
          label="弱证据"
          value={`${view.totals.weakEvidenceCount} · ${formatYuan(view.totals.weakEvidenceCents)}`}
          accent={view.totals.weakEvidenceCount > 0 ? "#a86a00" : undefined}
        />
      </div>
      {view.groups.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-soft, #f7f8fb)", color: "var(--ink-400)" }}>
                <th style={th}>项目</th>
                <th style={thNum}>条目</th>
                <th style={thNum}>{amountLabel}</th>
                <th style={thNum}>可计 CPT</th>
                <th style={thNum}>弱证据金额</th>
              </tr>
            </thead>
            <tbody>
              {view.groups.map((g, i) => (
                <tr key={g.projectName + i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={td}>{g.projectName}</td>
                  <td style={tdNum}>{g.itemCount}</td>
                  <td style={tdNum}>
                    {formatYuan(isReceivable ? g.receivableCents : g.payableCents)}
                  </td>
                  <td style={tdNum}>{g.cptEligibleCount}</td>
                  <td style={{ ...tdNum, color: g.weakEvidenceCents > 0 ? "#a86a00" : "var(--ink-700)" }}>
                    {formatYuan(g.weakEvidenceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RetrospectiveDraftBody({ payload }) {
  const view = readRetrospectiveDraft(payload);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {view.metrics.length > 0 && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {view.metrics.map((m, i) => (
            <div key={m.label + i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Metric label={m.label} value={`${m.value}${m.unit ?? ""}`} />
              <span style={{ fontSize: 11, color: "var(--ink-400)" }}>来源 {m.sourceRef}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {view.sections.map((s) => (
          <div key={s.key} style={{ fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{s.title}</span>
            <span style={{ color: "var(--ink-400)", marginLeft: 8 }}>{s.prompt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DraftCard({ draft, onConfirm, onDiscard, busy }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}>
            {draftTypeLabel(draft.draftType)}
          </span>
          <StatusBadge status={draft.status} />
          <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
            {draftHeadline(draft)}
          </span>
        </div>
        {draft.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDiscard(draft.id)}
              style={btn("danger", busy)}
            >
              弃用
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(draft.id)}
              style={btn("primary", busy)}
            >
              确认生成
            </button>
          </div>
        )}
      </div>
      <div style={{ padding: 16 }}>
        {draft.draftType === "settlement_batch" ? (
          <SettlementDraftBody payload={draft.payload} />
        ) : draft.draftType === "retrospective" ? (
          <RetrospectiveDraftBody payload={draft.payload} />
        ) : (
          <pre style={{ fontSize: 12, color: "var(--ink-700)", margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(draft.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function AiDraftsPanel() {
  const [status, setStatus] = React.useState("pending");
  const [drafts, setDrafts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [periodStart, setPeriodStart] = React.useState(monthStart);
  const [periodEnd, setPeriodEnd] = React.useState(today);
  const [batchType, setBatchType] = React.useState("payable");
  const [notice, setNotice] = React.useState(null);

  const load = React.useCallback(async (next) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/drafts?status=${next}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "加载失败");
      setDrafts(Array.isArray(json.drafts) ? json.drafts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    // 拉取属于「向外部系统订阅」：用微任务推迟，避免在 effect 体内同步 setState。
    queueMicrotask(() => {
      if (!cancelled) load(status);
    });
    return () => {
      cancelled = true;
    };
  }, [status, load]);

  async function act(url, okMsg) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "操作失败");
      setNotice({ kind: "ok", text: okMsg });
      await load(status);
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "操作失败" });
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ai/drafts/settlement-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, batchType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "生成失败");
      setNotice({ kind: "ok", text: "已生成结算批次草稿，待人工确认" });
      setStatus("pending");
      await load("pending");
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "生成失败" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 生成区：从结算池按周期生成应付/应收草稿（走 RLS）。 */}
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: 10,
          boxShadow: "var(--shadow-card)",
          padding: 16,
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Field label="周期起">
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={input} />
        </Field>
        <Field label="周期止">
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} style={input} />
        </Field>
        <Field label="类型">
          <select value={batchType} onChange={(e) => setBatchType(e.target.value)} style={input}>
            <option value="payable">应付（主播）</option>
            <option value="receivable">应收（厂家）</option>
          </select>
        </Field>
        <button type="button" disabled={busy} onClick={generate} style={btn("primary", busy)}>
          {busy ? "处理中…" : "生成结算批次草稿"}
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
          AI 仅按确定性口径聚合并出草稿；确认后才生成正式批次。
        </span>
      </div>

      {notice && (
        <div
          style={{
            fontSize: 13,
            padding: "8px 12px",
            borderRadius: 8,
            background: notice.kind === "ok" ? "#e7f5ee" : "#fdecec",
            color: notice.kind === "ok" ? "#0e8a4d" : "#c0303a",
            border: `1px solid ${notice.kind === "ok" ? "#bfe6cf" : "#f3c4c9"}`,
          }}
        >
          {notice.text}
        </div>
      )}

      {/* 状态切换 */}
      <div style={{ display: "flex", gap: 4 }}>
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatus(t.key)}
            style={{
              height: 32,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid var(--line-strong)",
              background: status === t.key ? "var(--blue-600)" : "#fff",
              color: status === t.key ? "#fff" : "var(--ink-700)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Empty text="加载中…" />
      ) : error ? (
        <Empty text={error} tone="error" />
      ) : drafts.length === 0 ? (
        <Empty text="暂无草稿" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              busy={busy}
              onConfirm={(id) => act(`/api/ai/drafts/${id}/confirm`, "已确认草稿")}
              onDiscard={(id) => act(`/api/ai/drafts/${id}/discard`, "已弃用草稿")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</span>
      {children}
    </label>
  );
}

function Empty({ text, tone }) {
  return (
    <div
      style={{
        padding: "40px 0",
        textAlign: "center",
        fontSize: 13,
        color: tone === "error" ? "#c0303a" : "var(--ink-400)",
      }}
    >
      {text}
    </div>
  );
}

const th = { textAlign: "left", padding: "8px 12px", fontWeight: 500, fontSize: 12 };
const thNum = { ...th, textAlign: "right" };
const td = { padding: "8px 12px", color: "var(--ink-900)" };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-700)" };
const input = {
  height: 32,
  padding: "0 10px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--line-strong)",
  background: "#fff",
  color: "var(--ink-900)",
};

function btn(kind, disabled) {
  const base = {
    height: 32,
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
  if (kind === "primary") {
    return { ...base, background: "var(--blue-600)", color: "#fff", border: "1px solid var(--blue-600)" };
  }
  if (kind === "danger") {
    return { ...base, background: "#fff", color: "#c0303a", border: "1px solid #f3c4c9" };
  }
  return { ...base, background: "#fff", color: "var(--ink-700)", border: "1px solid var(--line-strong)" };
}
