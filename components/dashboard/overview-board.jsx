"use client";

/* eslint-disable */
// 经营总览看板 v2 —— 依据设计稿用 HeroUI 重建。
// 仅用于「智能作战台 / 经营闭环看板」总览页，其余页面不受影响。
// 数据来源：服务端 dashboard（kpis / panels / queue / risks）+ 实时
// projects / tasks / reports，缺数据的区块自动隐藏。

import * as React from "react";
import {
  Card,
  Chip,
  Button,
  Avatar,
  Separator,
} from "@heroui/react";
import "@heroui/react/styles";

// ——— 设计稿调色板 ———
const C = {
  page: "#fafbff",
  card: "#ffffff",
  soft: "#f7f8fb",
  soft2: "#f3f4f8",
  line: "#eceef4",
  ink: "#1b1f2a",
  ink2: "#5b6170",
  muted: "#9aa0ad",
  faint: "#aeb3c0",
  primary: "#5566e6",
  primary2: "#7b54ec",
  primaryGrad: "linear-gradient(120deg,#5566e6,#7b54ec)",
  heroGrad: "linear-gradient(125deg,#515da8 0%,#62568f 100%)",
  danger: "#ef5b46",
  dangerBg: "#fde9e5",
  ok: "#2f9e6f",
  warn: "#c5860c",
};

const TONE = {
  good: { color: C.ok, bg: "#e7f6ef" },
  ok: { color: C.ok, bg: "#e7f6ef" },
  info: { color: C.primary, bg: "#eef0ff" },
  neutral: { color: C.ink2, bg: C.soft2 },
  warn: { color: C.warn, bg: "#fdf3e0" },
  warning: { color: C.warn, bg: "#fdf3e0" },
  danger: { color: C.danger, bg: C.dangerBg },
  bad: { color: C.danger, bg: C.dangerBg },
};

function tone(t) {
  return TONE[t] || TONE.neutral;
}

const ROUTE_LABELS = {
  project: "项目",
  projects: "项目",
  streamers: "主播",
  tasks: "任务",
  reports: "报数",
  settle: "结算",
  audit: "审计",
  notifications: "通知",
};
function routeLabel(route) {
  return ROUTE_LABELS[route] || "查看";
}

const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("zh-CN")}`;
};
const num = (n) => (Number(n) || 0).toLocaleString("zh-CN");

// 依据标签生成一条确定性的装饰性走势线（非真实历史数据，仅作视觉点缀）。
function sparkPoints(seed, w = 120, h = 34, n = 14) {
  let s = 0;
  for (let i = 0; i < String(seed).length; i += 1)
    s = (s * 31 + String(seed).charCodeAt(i)) % 9973;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const r = (s % 1000) / 1000;
    const y = h - 4 - r * (h - 8);
    pts.push(`${(i / (n - 1)) * w},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

function Spark({ seed, color = C.primary, w = 120, h = 34 }) {
  const pts = sparkPoints(seed, w, h);
  const id = `sg-${String(seed).replace(/\W/g, "").slice(0, 8)}`;
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ——— 通用区块卡片 ———
function SectionCard({ title, hint, right, children, pad = true }) {
  return (
    <Card
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 20,
        boxShadow: "0 1px 2px rgba(20,24,40,.04)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 20px",
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>
          {title}
        </h3>
        {right ||
          (hint ? (
            <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>
          ) : null)}
      </div>
      <div style={{ padding: pad ? 16 : 0 }}>{children}</div>
    </Card>
  );
}

function StatusChip({ label, t }) {
  const c = tone(t);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 9,
        fontSize: 11.5,
        fontWeight: 600,
        color: c.color,
        background: c.bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function RowButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        border: 0,
        borderBottom: `1px solid ${C.line}`,
        background: C.card,
        padding: "12px 16px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ——— KPI 卡 ———
function KpiCard({ item, accent }) {
  return (
    <Card
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 16,
        borderTop: `3px solid ${accent}`,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12.5, color: C.ink2, marginBottom: 8 }}>
        {item.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: C.ink }}>
          {String(item.value)}
        </span>
        {item.unit ? (
          <span style={{ fontSize: 12, color: C.muted }}>{item.unit}</span>
        ) : null}
      </div>
      {item.hint ? (
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.muted }}>
          {item.hint}
        </div>
      ) : null}
    </Card>
  );
}

const KPI_ACCENTS = [C.primary, C.primary2, C.ok, C.warn, C.danger, "#3b82f6"];

// ——— 漏斗 ———
function FunnelPanel({ funnel, go, onPick }) {
  if (!funnel?.stages?.length) return null;
  const max = Math.max(...funnel.stages.map((s) => Number(s.value) || 0), 1);
  return (
    <SectionCard title={funnel.title} hint={funnel.subtitle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {funnel.stages.map((s) => {
          const pct = Math.round(((Number(s.value) || 0) / max) * 100);
          const c = tone(s.tone || "info");
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                funnel.target?.route
                  ? go?.(funnel.target.route, funnel.target.id)
                  : onPick?.({ kind: "funnel", title: s.label, item: s, tag: funnel.title })
              }
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 84px",
                alignItems: "center",
                gap: 12,
                border: 0,
                background: "transparent",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 12.5, color: C.ink2, textAlign: "left" }}>
                {s.label}
              </span>
              <span
                style={{
                  height: 22,
                  borderRadius: 8,
                  background: C.soft2,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.max(pct, 6)}%`,
                    background: c.color,
                    opacity: 0.85,
                    borderRadius: 8,
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.ink,
                  textAlign: "right",
                }}
              >
                {num(s.value)}
                {s.rate != null ? (
                  <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>
                    {s.rate}%
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ——— 批次泳道 ———
function LanesPanel({ data, onPick }) {
  if (!data?.lanes?.length) return null;
  return (
    <SectionCard title={data.title} hint={data.subtitle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 12,
        }}
      >
        {data.lanes.map((L) => {
          const c = tone(L.tone || "info");
          return (
            <div
              key={L.key}
              style={{
                background: C.soft,
                border: `1px solid ${C.line}`,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: c.color,
                  }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                  {L.label}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
                  {L.count}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onPick?.({ kind: "lane", title: L.label, item: L, tag: data.title })}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  background: C.card,
                  borderRadius: 10,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>
                  {money(L.amount)}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>批次金额</div>
              </button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ——— 金额风险榜 ———
function AmountRiskPanel({ data, go, onPick }) {
  if (!data?.rows?.length) return null;
  return (
    <SectionCard title={data.title} hint={data.subtitle}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {data.rows.map((r) => (
          <RowButton
            key={r.key}
            onClick={() =>
              r.target?.route
                ? go?.(r.target.route, r.target.id)
                : onPick?.({ kind: "amountRisk", title: r.label, item: r, tag: data.title })
            }
          >
            <span
              style={{
                width: 6,
                height: 30,
                borderRadius: 3,
                background: tone(r.tone || "danger").color,
              }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {r.label}
              </span>
              {r.hint ? (
                <span style={{ fontSize: 11.5, color: C.muted }}>{r.hint}</span>
              ) : null}
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: C.danger }}>
              {money(r.amount)}
            </span>
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 项目经营排行 ———
function RankingPanel({ data, go, onPick }) {
  if (!data?.rows?.length) return null;
  const max = Math.max(...data.rows.map((r) => Number(r.value) || 0), 1);
  return (
    <SectionCard title={data.title} hint={data.subtitle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.rows.map((r, i) => {
          const pct = Math.round((Math.max(Number(r.value), 0) / max) * 100);
          return (
            <button
              key={r.key}
              type="button"
              onClick={() =>
                r.target?.route
                  ? go?.(r.target.route, r.target.id)
                  : onPick?.({ kind: "rank", title: r.title, item: r, tag: data.title })
              }
              style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 5,
                }}
              >
                <span style={{ fontSize: 12, color: C.muted, width: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>
                  {r.title}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: tone(r.tone || "good").color }}>
                  {money(r.value)}
                </span>
                {r.hint ? (
                  <span style={{ fontSize: 11.5, color: C.muted }}>{r.hint}</span>
                ) : null}
              </div>
              <span
                style={{
                  display: "block",
                  height: 7,
                  borderRadius: 99,
                  background: C.soft2,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.max(pct, 4)}%`,
                    background: C.primaryGrad,
                    borderRadius: 99,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ——— 列表型区块（卡点队列 / 风险流 / 常用入口）———
// 行带目标的直接钻取到对应闭环页面；右侧徽标显示目标页面（项目/任务/报数…）。
function QueuePanel({ title, hint, items, go }) {
  if (!items?.length) return null;
  return (
    <SectionCard title={title} hint={hint} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((it) => (
          <RowButton
            key={it.key}
            onClick={() => go?.(it.target?.route || "warroom", it.target?.id)}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: tone(it.tone).color,
              }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {it.title}
              </span>
              {it.subtitle ? (
                <span style={{ fontSize: 11.5, color: C.muted }}>{it.subtitle}</span>
              ) : null}
            </span>
            <StatusChip label={routeLabel(it.target?.route)} t="info" />
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 今日直播时间轴（来自 tasks）———
function TimelinePanel({ tasks, onPick }) {
  const rows = (tasks || [])
    .filter((t) => Number.isFinite(t?.startHour))
    .slice()
    .sort((a, b) => (a.startHour || 0) - (b.startHour || 0))
    .slice(0, 8);
  if (!rows.length) return null;
  const statusTone = (s) =>
    s === "live" || s === "进行中"
      ? "good"
      : s === "anomaly"
        ? "danger"
        : "neutral";
  return (
    <SectionCard title="今日直播时间轴" hint={`${rows.length} 场`} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => (
          <RowButton
            key={t.id}
            onClick={() => onPick?.({ kind: "task", title: t.title || t.streamer, item: t, tag: "直播任务", target: { route: "tasks", id: t.id } })}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, width: 52 }}>
              {Number.isFinite(t.startHour) ? `${t.startHour}:00` : "—"}
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {t.streamer || t.anchor || "未指派主播"}
              </span>
              <span style={{ fontSize: 11.5, color: C.muted }}>
                {t.project || t.projectName || t.title || "—"}
              </span>
            </span>
            <StatusChip
              label={t.anomaly ? "异常" : t.statusLabel || t.status || "待开播"}
              t={t.anomaly ? "danger" : statusTone(t.status)}
            />
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 我的今日任务流（来自 tasks）———
function TaskStreamPanel({ tasks, onPick }) {
  const rows = (tasks || []).slice(0, 8);
  if (!rows.length) return null;
  return (
    <SectionCard title="我的今日任务流" hint={`${rows.length} 项待处理`} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => (
          <RowButton
            key={`ts-${t.id}`}
            onClick={() => onPick?.({ kind: "task", title: t.title || t.streamer, item: t, tag: "任务", target: { route: "tasks", id: t.id } })}
          >
            <span style={{ fontSize: 12, color: C.muted, width: 52 }}>
              {Number.isFinite(t.startHour) ? `${t.startHour}:00` : "全天"}
            </span>
            <StatusChip label={t.kind || t.type || "排班"} t="info" />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {t.title || t.streamer || "任务"}
              </span>
              <span style={{ fontSize: 11.5, color: C.muted }}>
                {t.project || t.projectName || ""}
              </span>
            </span>
            <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>处理 →</span>
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 待审核报数（来自 reports）———
function ReviewQueuePanel({ reports, onPick }) {
  const rows = (reports || [])
    .filter((r) => r?.status === "pending_review")
    .slice(0, 8);
  if (!rows.length) return null;
  const cell = { fontSize: 12.5, color: C.ink2 };
  return (
    <SectionCard
      title="待审核报数 · 证据核验"
      hint="系统时长 vs 截图时长"
      pad={false}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr 1fr",
          gap: 0,
          padding: "8px 16px",
          background: C.soft,
          fontSize: 11,
          color: C.muted,
          fontWeight: 600,
        }}
      >
        <span>主播 / 项目</span>
        <span>系统时长</span>
        <span>截图时长</span>
        <span>偏差</span>
        <span>证据 / 动作</span>
      </div>
      {rows.map((r) => {
        const sys = Number(r.systemDurationHours ?? r.duration ?? 0);
        const shot = Number(r.screenDurationHours ?? r.duration ?? 0);
        const dev = sys > 0 ? Math.round(((shot - sys) / sys) * 100) : 0;
        const bad = Math.abs(dev) >= 10;
        return (
          <button
            key={`rv-${r.id}`}
            type="button"
            onClick={() => onPick?.({ kind: "report", title: r.streamer, item: r, tag: "待审报数", target: { route: "reports", id: r.id } })}
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr 1fr",
              alignItems: "center",
              gap: 0,
              padding: "11px 16px",
              border: 0,
              borderBottom: `1px solid ${C.line}`,
              background: C.card,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {r.streamer || "—"}
              </span>
              <span style={{ fontSize: 11, color: C.muted }}>{r.project || ""}</span>
            </span>
            <span style={cell}>{sys ? `${sys} 小时` : "—"}</span>
            <span style={cell}>{shot ? `${shot} 小时` : "—"}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: bad ? C.danger : C.ok }}>
              {dev > 0 ? "+" : ""}
              {dev}%
            </span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <StatusChip label={bad ? "弱证据" : "可信"} t={bad ? "danger" : "good"} />
              <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>审</span>
            </span>
          </button>
        );
      })}
    </SectionCard>
  );
}

// ——— 低 / 负毛利项目（来自 projects）———
function LowMarginPanel({ projects, onPick }) {
  const rows = (projects || [])
    .map((p) => ({ p, rate: Number(p?.metrics?.margin ?? 0) }))
    .filter((x) => x.rate > 0 && x.rate < 20)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <SectionCard title="低 / 负毛利项目" hint="复盘重点" pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(({ p, rate }) => (
          <RowButton
            key={`lm-${p.id}`}
            onClick={() => onPick?.({ kind: "project", title: p.name, item: p, tag: "低毛利", target: { route: "project", id: p.id } })}
          >
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>
                {p.name}
              </span>
              <span style={{ fontSize: 11.5, color: C.muted }}>
                {p.product || p.vendor || "—"}
              </span>
            </span>
            <StatusChip label={`毛利率 ${rate.toFixed(0)}%`} t={rate < 10 ? "danger" : "warn"} />
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 详情抽屉 ———
function DetailDrawer({ open, data, onClose, go }) {
  if (!open || !data) return null;
  const fields = data.fields || [];
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60 }}
      onClick={onClose}
      role="presentation"
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,24,40,.28)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={data.title}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(420px, 92vw)",
          background: C.card,
          boxShadow: "-24px 0 60px rgba(11,23,51,.18)",
          display: "flex",
          flexDirection: "column",
          animation: "drawerin .22s ease",
        }}
      >
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <StatusChip label={data.tag || "明细"} t="info" />
            <button
              type="button"
              onClick={onClose}
              style={{ border: 0, background: "transparent", fontSize: 20, color: C.muted, cursor: "pointer" }}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
          <h2 style={{ margin: "12px 0 4px", fontSize: 18, color: C.ink }}>{data.title}</h2>
          {data.sub ? <div style={{ fontSize: 12.5, color: C.muted }}>{data.sub}</div> : null}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {fields.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {fields.map((f, i) => (
                <div key={i} style={{ background: C.soft, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted }}>{f.k}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3 }}>
                    {f.v}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.muted }}>暂无更多明细字段。</div>
          )}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10 }}>
          <Button
            onPress={onClose}
            style={{
              flex: 1,
              border: `1px solid ${C.line}`,
              background: C.card,
              color: C.ink2,
              borderRadius: 12,
              padding: "10px 0",
              fontWeight: 600,
            }}
          >
            关闭
          </Button>
          {data.target?.route ? (
            <Button
              onPress={() => {
                go?.(data.target.route, data.target.id);
                onClose();
              }}
              style={{
                flex: 1,
                border: 0,
                background: C.primaryGrad,
                color: "#fff",
                borderRadius: 12,
                padding: "10px 0",
                fontWeight: 700,
              }}
            >
              {data.cta || "去处理"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fieldsFor(pick) {
  const it = pick?.item || {};
  if (pick.kind === "queue" || pick.kind === "task") {
    return [
      { k: "状态", v: it.statusLabel || it.status || pick.tag },
      { k: "项目", v: it.project || it.projectName || "—" },
      { k: "主播", v: it.streamer || it.anchor || "—" },
      { k: "时间", v: Number.isFinite(it.startHour) ? `${it.startHour}:00` : "—" },
    ];
  }
  if (pick.kind === "report") {
    return [
      { k: "主播", v: it.streamer || "—" },
      { k: "项目", v: it.project || "—" },
      { k: "系统时长", v: `${it.systemDurationHours ?? it.duration ?? 0} 小时` },
      { k: "日期", v: it.date || "—" },
    ];
  }
  if (pick.kind === "project") {
    return [
      { k: "项目", v: it.name || "—" },
      { k: "产品", v: it.product || "—" },
      { k: "毛利率", v: `${Number(it?.metrics?.margin ?? 0).toFixed(0)}%` },
      { k: "状态", v: it.statusLabel || it.status || "—" },
    ];
  }
  if (pick.kind === "amountRisk")
    return [
      { k: "类型", v: it.label },
      { k: "金额", v: money(it.amount) },
      { k: "说明", v: it.hint || "—" },
    ];
  if (pick.kind === "rank")
    return [
      { k: "项目", v: it.title },
      { k: "毛利贡献", v: money(it.value) },
      { k: "毛利率", v: it.hint || "—" },
    ];
  if (pick.kind === "lane")
    return [
      { k: "阶段", v: it.label },
      { k: "批次金额", v: money(it.amount) },
      { k: "批次数", v: String(it.count) },
    ];
  if (pick.kind === "funnel")
    return [
      { k: "阶段", v: it.label },
      { k: "数量", v: num(it.value) },
      { k: "转化", v: it.rate != null ? `${it.rate}%` : "—" },
    ];
  return [];
}

export function OverviewBoard({ dashboard, go, projects, tasks, reports }) {
  const [pick, setPick] = React.useState(null);
  const d = dashboard || {};
  const profile = d.profile || {};
  const panels = d.panels || {};
  const generatedAt = d.generatedAt
    ? new Date(d.generatedAt).toLocaleString("zh-CN")
    : "";
  const riskCount = (d.risks || []).length;
  const kpis = d.kpis || [];
  const hero = kpis[0] || null;
  const restKpis = kpis.slice(1);

  const onPick = React.useCallback((p) => {
    setPick({ ...p, sub: p.tag, fields: fieldsFor(p) });
  }, []);

  return (
    <div style={{ background: C.page, minHeight: "100%" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 1440,
          margin: "0 auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.ink }}>
                {profile.title || "经营总览看板"}
              </h1>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: C.ok,
                  background: "#e7f6ef",
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: C.ok,
                    animation: "livepulse 1.6s infinite",
                  }}
                />
                实时
              </span>
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: C.ink2 }}>
              {profile.subtitle || "经营闭环 · 全链路实时盘"}
            </div>
          </div>
          {profile.scopeLabel ? (
            <StatusChip label={profile.scopeLabel} t="info" />
          ) : null}
        </div>

        {/* 风险提醒条 */}
        {riskCount > 0 ? (
          <button
            type="button"
            onClick={() => go?.("warroom")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${C.dangerBg}`,
              background: "#fff6f4",
              borderRadius: 16,
              padding: "12px 16px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: C.dangerBg,
                color: C.danger,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
              }}
            >
              !
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                {riskCount} 条风险待处理
              </span>
              <span style={{ marginLeft: 8, fontSize: 12, color: C.ink2 }}>
                命中风险规则 · 需人工核验
              </span>
            </span>
            <span style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>立即处理 →</span>
          </button>
        ) : null}

        {d.emptyState ? (
          <SectionCard title={d.emptyState.title}>
            <div style={{ fontSize: 13, color: C.muted }}>{d.emptyState.hint}</div>
          </SectionCard>
        ) : null}

        {/* 经营数据：头部 Hero 大数（首个 KPI）+ 其余 KPI 卡 */}
        {hero ? (
          <Card
            style={{
              background: C.heroGrad,
              border: "1px solid transparent",
              borderRadius: 20,
              padding: 20,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.82)" }}>
                {hero.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                <span style={{ fontSize: 34, fontWeight: 800 }}>{String(hero.value)}</span>
                {hero.unit ? (
                  <span style={{ fontSize: 14, opacity: 0.85 }}>{hero.unit}</span>
                ) : null}
              </div>
              {hero.hint ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,.78)", marginTop: 6 }}>
                  {hero.hint}
                </div>
              ) : null}
            </div>
            <Spark seed={hero.key} color="#ffffff" w={220} h={48} />
          </Card>
        ) : null}

        {restKpis.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: 12,
            }}
          >
            {restKpis.map((it, i) => (
              <KpiCard key={it.key} item={it} accent={KPI_ACCENTS[i % KPI_ACCENTS.length]} />
            ))}
          </div>
        ) : null}

        {/* 深度分析区块（按角色 / 数据门控，缺数据自动隐藏） */}
        <FunnelPanel funnel={panels.admissionFunnel} go={go} onPick={onPick} />
        <FunnelPanel funnel={panels.settlementFunnel} go={go} onPick={onPick} />
        <TimelinePanel tasks={tasks} onPick={onPick} />
        <QueuePanel title="项目卡点队列" hint="按卡住时长" items={d.queue} go={go} />
        <TaskStreamPanel tasks={tasks} onPick={onPick} />
        <ReviewQueuePanel reports={reports} onPick={onPick} />
        <LanesPanel data={panels.batchLanes} onPick={onPick} />
        <AmountRiskPanel data={panels.amountRisks} go={go} onPick={onPick} />
        <RankingPanel data={panels.projectRanking} go={go} onPick={onPick} />
        <LowMarginPanel projects={projects} onPick={onPick} />
        <QueuePanel title="风险告警流" hint={`${riskCount} 未处理`} items={d.risks} go={go} />
        <QueuePanel title="常用入口" hint="一键进入对应闭环阶段" items={d.drilldowns} go={go} />

        {generatedAt ? (
          <div style={{ fontSize: 12, color: C.muted }}>数据更新时间：{generatedAt}</div>
        ) : null}
      </div>

      <DetailDrawer open={!!pick} data={pick} onClose={() => setPick(null)} go={go} />
    </div>
  );
}

export default OverviewBoard;
