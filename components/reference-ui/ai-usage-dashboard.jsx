"use client";
/* eslint-disable */
import React from "react";

const RANGE_OPTIONS = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
];

const SCENE_LABELS = {
  business_analysis: "经营分析",
  casting_advice: "选播建议",
  pricing_tradeoff: "定价权衡",
  script_optimization: "话术优化",
  streamer_diagnosis: "主播诊断",
  m10_copilot: "Copilot",
  project_review: "项目复盘",
  unknown: "未分类",
};

const PROVIDER_LABELS = {
  hunyuan: "混元 Hunyuan",
  openai: "OpenAI",
  deterministic: "确定性回退",
  tencent_ocr: "腾讯 OCR",
  unknown: "未知",
};

const STATUS_META = {
  succeeded: { label: "成功", color: "var(--ok-600)", bg: "var(--ok-50)" },
  failed: { label: "失败", color: "var(--danger-600)", bg: "var(--danger-50)" },
  degraded: { label: "降级", color: "var(--warn-600)", bg: "var(--warn-50)" },
  started: { label: "进行中", color: "var(--ink-500)", bg: "var(--ink-50)" },
  queued: { label: "排队中", color: "var(--ink-500)", bg: "var(--ink-50)" },
};

function sceneLabel(scene) {
  return SCENE_LABELS[scene] || scene;
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

function formatYuan(cents) {
  const yuan = (Number(cents) || 0) / 100;
  return `¥${yuan.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function formatInt(value) {
  return (Number(value) || 0).toLocaleString("zh-CN");
}

function formatPercentFromBps(bps) {
  return `${((Number(bps) || 0) / 100).toFixed(1)}%`;
}

function formatLatency(ms) {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mi = `${date.getMinutes()}`.padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
        padding: "16px 18px",
        flex: "1 1 160px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 24,
          fontWeight: 700,
          color: accent || "var(--ink-900)",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-400)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Panel({ title, hint, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}>
          {title}
        </div>
        {hint && (
          <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{hint}</div>
        )}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function TrendChart({ points }) {
  const max = points.reduce((m, p) => Math.max(m, p.costCents), 0);
  if (points.length === 0) {
    return <Empty text="暂无趋势数据" />;
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 120,
        }}
      >
        {points.map((p) => {
          const ratio = max > 0 ? p.costCents / max : 0;
          const heightPx = max > 0 ? Math.max(2, Math.round(ratio * 112)) : 2;
          return (
            <div
              key={p.date}
              title={`${p.date} · ${formatYuan(p.costCents)} · ${formatInt(
                p.invocations,
              )} 次`}
              style={{
                flex: 1,
                minWidth: 2,
                height: heightPx,
                background:
                  p.costCents > 0 ? "var(--blue-700)" : "var(--ink-100)",
                borderRadius: 2,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 11,
          color: "var(--ink-400)",
        }}
      >
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function BreakdownBars({ rows, max, renderLabel, renderValue }) {
  if (rows.length === 0) {
    return <Empty text="暂无数据" />;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((row, idx) => {
        const ratio = max > 0 ? row._bar / max : 0;
        return (
          <div key={row._key ?? idx}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--ink-700)",
                marginBottom: 4,
              }}
            >
              <span>{renderLabel(row)}</span>
              <span style={{ color: "var(--ink-500)" }}>
                {renderValue(row)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: "var(--ink-50)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(2, Math.round(ratio * 100))}%`,
                  height: "100%",
                  background: "var(--blue-700)",
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || {
    label: status,
    color: "var(--ink-500)",
    bg: "var(--ink-50)",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 12,
        color: meta.color,
        background: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}

function Empty({ text }) {
  return (
    <div
      style={{
        padding: "24px 0",
        textAlign: "center",
        color: "var(--ink-400)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

export default function AiUsageDashboard({ fetcher }) {
  const doFetch = fetcher || ((url) => fetch(url));
  const [rangeDays, setRangeDays] = React.useState(30);
  const [state, setState] = React.useState({
    status: "loading",
    usage: null,
    error: null,
  });

  React.useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    doFetch(`/api/ai/usage?rangeDays=${rangeDays}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error || "加载用量数据失败");
        }
        if (active) {
          setState({ status: "ready", usage: body.usage, error: null });
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            status: "error",
            usage: null,
            error: error.message || "加载用量数据失败",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [rangeDays]);

  const usage = state.usage;

  return (
    <div
      style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--ink-400)" }}>
          数据来源：AI 调用台账（ai_invocations）
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {RANGE_OPTIONS.map((option) => {
            const active = option.value === rangeDays;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setRangeDays(option.value)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  border: `1px solid ${active ? "var(--blue-700)" : "var(--line)"}`,
                  background: active ? "var(--blue-700)" : "#fff",
                  color: active ? "#fff" : "var(--ink-700)",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.status === "loading" && <Empty text="加载中…" />}

      {state.status === "error" && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--danger-600)",
            background: "var(--danger-50)",
            color: "var(--danger-600)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {state.error}
        </div>
      )}

      {state.status === "ready" && usage && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <StatCard
              label="调用次数"
              value={formatInt(usage.totals.invocations)}
              sub={`成功 ${formatInt(usage.totals.succeeded)} · 失败 ${formatInt(
                usage.totals.failed,
              )}`}
            />
            <StatCard
              label="成功率"
              value={formatPercentFromBps(usage.totals.successRateBps)}
              sub={`降级 ${formatInt(usage.totals.degraded)}`}
              accent={
                usage.totals.successRateBps >= 9000
                  ? "var(--ok-600)"
                  : usage.totals.successRateBps >= 7000
                    ? "var(--warn-600)"
                    : "var(--danger-600)"
              }
            />
            <StatCard
              label="总成本"
              value={formatYuan(usage.totals.costCents)}
              sub="按台账记账成本累计"
            />
            <StatCard
              label="总 Token"
              value={formatTokens(usage.totals.totalTokens)}
              sub={`输入 ${formatTokens(
                usage.totals.promptTokens,
              )} · 输出 ${formatTokens(usage.totals.completionTokens)}`}
            />
            <StatCard
              label="平均时延"
              value={formatLatency(usage.totals.avgLatencyMs)}
              sub="模型调用响应"
            />
          </div>

          <Panel title="每日成本趋势" hint={`近 ${usage.rangeDays} 天`}>
            <TrendChart points={usage.dailyTrend} />
          </Panel>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            <Panel title="按场景成本" hint="Top 场景">
              <BreakdownBars
                rows={usage.byScene.map((s) => ({
                  ...s,
                  _key: s.scene,
                  _bar: s.costCents,
                }))}
                max={usage.byScene.reduce(
                  (m, s) => Math.max(m, s.costCents),
                  0,
                )}
                renderLabel={(row) => (
                  <span>
                    {sceneLabel(row.scene)}
                    <span
                      style={{
                        marginLeft: 8,
                        color: "var(--ink-400)",
                        fontSize: 12,
                      }}
                    >
                      {formatInt(row.invocations)} 次
                    </span>
                  </span>
                )}
                renderValue={(row) => formatYuan(row.costCents)}
              />
            </Panel>

            <Panel title="按模型供应商" hint="调用量">
              <BreakdownBars
                rows={usage.byProvider.map((p) => ({
                  ...p,
                  _key: p.provider,
                  _bar: p.invocations,
                }))}
                max={usage.byProvider.reduce(
                  (m, p) => Math.max(m, p.invocations),
                  0,
                )}
                renderLabel={(row) => providerLabel(row.provider)}
                renderValue={(row) =>
                  `${formatInt(row.invocations)} 次 · ${formatYuan(
                    row.costCents,
                  )}`
                }
              />
            </Panel>
          </div>

          <Panel title="最近调用" hint={`最新 ${usage.recent.length} 条`}>
            {usage.recent.length === 0 ? (
              <Empty text="暂无调用记录" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ color: "var(--ink-400)", textAlign: "left" }}>
                      <th style={thStyle}>时间</th>
                      <th style={thStyle}>场景</th>
                      <th style={thStyle}>供应商</th>
                      <th style={thStyle}>状态</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Token</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>成本</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>时延</th>
                      <th style={thStyle}>操作人</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.recent.map((row) => (
                      <tr
                        key={row.id}
                        style={{ borderTop: "1px solid var(--line)" }}
                      >
                        <td style={tdStyle}>{formatTime(row.createdAt)}</td>
                        <td style={tdStyle}>{sceneLabel(row.scene)}</td>
                        <td style={tdStyle}>{providerLabel(row.provider)}</td>
                        <td style={tdStyle}>
                          <StatusPill status={row.status} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {formatTokens(row.totalTokens)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {formatYuan(row.costCents)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {formatLatency(row.latencyMs)}
                        </td>
                        <td style={tdStyle}>{row.actorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

const thStyle = {
  padding: "8px 10px",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "8px 10px",
  color: "var(--ink-700)",
  whiteSpace: "nowrap",
};
