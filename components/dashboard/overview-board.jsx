"use client";

/* eslint-disable */
// 经营总览看板 v2 —— 依据设计稿用 HeroUI 重建，1:1 还原排版/交互/指标结构。
// 仅用于「智能作战台 / 经营闭环看板」总览页，其余页面不受影响。
// 数据全部为真实业务数据：服务端 dashboard（kpis/panels/queue/risks，按角色计算）
// + 实时 projects/tasks/reports/batches。缺数据的区块自动隐藏。
// 按用户确认：只展示当前登录角色的看板；无历史时序，故走势线只画能算出的真实曲线
//（如「今日排班按小时累计」），算不出的就不画/不编造环比。

import * as React from "react";
import { Card, Button } from "@heroui/react";
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
  primary: "#5566e6",
  primaryGrad: "linear-gradient(120deg,#5566e6,#7b54ec)",
  heroGrad: "linear-gradient(125deg,#515da8 0%,#62568f 100%)",
  danger: "#ef5b46",
  dangerBg: "#fde9e5",
  ok: "#2f9e6f",
  warn: "#c5860c",
};

const TONE = {
  ok: { color: C.ok, bg: "#e7f5ef" },
  good: { color: C.ok, bg: "#e7f5ef" },
  green: { color: C.ok, bg: "#e7f5ef" },
  info: { color: C.primary, bg: "#ecedfb" },
  blue: { color: C.primary, bg: "#ecedfb" },
  primary: { color: C.primary, bg: "#ecedfb" },
  violet: { color: "#7b54ec", bg: "#efeafe" },
  neutral: { color: C.ink2, bg: "#eef0f5" },
  warn: { color: C.warn, bg: "#fbf1da" },
  warning: { color: C.warn, bg: "#fbf1da" },
  amber: { color: C.warn, bg: "#fbf1da" },
  danger: { color: C.danger, bg: C.dangerBg },
  bad: { color: C.danger, bg: C.dangerBg },
  red: { color: C.danger, bg: C.dangerBg },
};
const tone = (t) => TONE[t] || TONE.neutral;
const toneColor = (t) => {
  const c = tone(t).color;
  return c === C.ink2 ? C.ink : c;
};

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
const routeLabel = (r) => ROUTE_LABELS[r] || "查看";

const num = (n) => (Number(n) || 0).toLocaleString("zh-CN");
const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("zh-CN")}`;
};
function fmtKpi(value, unit) {
  if (unit === "元") {
    const v = Number(value) || 0;
    return { value: Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) : String(v), unit: Math.abs(v) >= 10000 ? "万" : "元" };
  }
  return { value: String(value), unit: unit || "" };
}

const cnt = (arr, fn) => (arr || []).filter(fn).length;
const pStatus = (p, s) => p?.status === s;
const margin = (p) => Number(p?.metrics?.margin);
const isLive = (t) => t?.status === "live" || t?.statusLabel === "直播中";
const isNotStarted = (t) => ["pending_live", "not_started", "scheduled"].includes(t?.status);
const isDone = (t) => t?.status === "completed" || t?.status === "done" || t?.status === "已完成";
const isAnomaly = (t) => t?.anomaly || t?.status === "abnormal";

// 今日直播任务按小时的累计场次（真实曲线，对应设计稿 Hero 走势）。
function scheduleSeries(tasks) {
  const byHour = Array(24).fill(0);
  let any = false;
  (tasks || []).forEach((t) => {
    const h = Number(t?.startHour);
    if (Number.isFinite(h)) {
      byHour[Math.max(0, Math.min(23, Math.round(h)))] += 1;
      any = true;
    }
  });
  if (!any) return null;
  const out = [];
  let acc = 0;
  for (let h = 6; h <= 23; h += 1) {
    acc += byHour[h];
    out.push(acc);
  }
  return out.length >= 2 ? out : null;
}

// 按角色计算「待办」分组（真实计数；无则为 0）。
function computeTodoGroups(role, { projects = [], tasks = [], reports = [], batches = [] }) {
  const bs = (s) => cnt(batches, (b) => b.status === s || b.statusKey === s);
  const pendReports = cnt(reports, (r) => r.status === "pending_review");
  const anomalies = cnt(tasks, isAnomaly);
  const notStarted = cnt(tasks, isNotStarted);
  const recordingPending = (projects || []).reduce((s, p) => s + (p?.streamers?.pendingReview ?? 0), 0);
  const gapProjects = cnt(projects, (p) => (p?.streamers?.candidate ?? 0) > 0);
  const G = (title, items) => ({ title, items });
  const I = (label, value, t, route) => ({ label, value: String(value), tone: t, target: route ? { route } : undefined });

  if (role.includes("operator")) {
    return [
      G("今日任务", [I("待处理", cnt(tasks, (t) => !isDone(t)), "primary", "tasks"), I("已完成", cnt(tasks, isDone), "ok", "tasks")]),
      G("直播待办", [I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"), I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks")]),
      G("报数待办", [I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"), I("总报数", reports.length, "neutral", "reports")]),
    ];
  }
  if (role.includes("finance")) {
    return [
      G("批次待办", [I("待生成", bs("draft"), "neutral", "settle"), I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle")]),
      G("锁定待办", [I("已锁定", bs("locked"), "ok", "settle"), I("已导出", bs("exported"), "neutral", "settle")]),
      G("风险待办", [I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"), I("待审报数", pendReports, pendReports ? "warn" : "neutral", "reports")]),
    ];
  }
  if (role.includes("ops")) {
    return [
      G("项目待办", [I("执行中", cnt(projects, (p) => pStatus(p, "active")), "primary", "projects"), I("招募中", cnt(projects, (p) => pStatus(p, "recruiting")), "neutral", "projects")]),
      G("准入待办", [I("录屏待审", recordingPending, "warn", "projects"), I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects")]),
      G("直播待办", [I("今日排班", tasks.length, "ok", "tasks"), I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks")]),
      G("报数待办", [I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"), I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks")]),
      G("结算待办", [I("待生成", bs("draft"), "neutral", "settle"), I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle")]),
    ];
  }
  // owner / 默认
  return [
    G("项目待办", [I("进行中", cnt(projects, (p) => pStatus(p, "active")), "primary", "projects"), I("招募中", cnt(projects, (p) => pStatus(p, "recruiting")), "neutral", "projects")]),
    G("复盘待办", [I("低毛利", cnt(projects, (p) => margin(p) >= 0 && margin(p) < 20), "warn", "projects"), I("负毛利", cnt(projects, (p) => margin(p) < 0), "bad", "projects")]),
    G("结算待办", [I("待生成", bs("draft"), "neutral", "settle"), I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle")]),
    G("审计待办", [I("高风险", cnt(projects, (p) => p.risk === "high"), "bad", "audit"), I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle")]),
  ];
}

// ——— 真实数据走势线（仅用于能算出的曲线，如排班累计） ———
function Spark({ series, color = C.primary, w = 300, h = 60, pad = 8 }) {
  if (!series || series.length < 2) return null;
  const mn = Math.min(...series);
  const mx = Math.max(...series);
  const rng = mx - mn || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `sk-${color.replace(/[^a-z0-9]/gi, "")}-${series.length}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ——— 通用区块卡片 ———
function SectionCard({ title, hint, children, pad = true }) {
  return (
    <Card style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: "0 1px 2px rgba(20,24,40,.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "15px 20px", borderBottom: `1px solid ${C.line}` }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>{title}</h3>
        {hint ? <span style={{ fontSize: 12, color: C.muted }}>{hint}</span> : null}
      </div>
      <div style={{ padding: pad ? 16 : 0 }}>{children}</div>
    </Card>
  );
}

function StatusChip({ label, t }) {
  const c = tone(t);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 9, fontSize: 11.5, fontWeight: 600, color: c.color, background: c.bg, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function RowButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", border: 0, borderBottom: `1px solid ${C.line}`, background: C.card, padding: "12px 16px", cursor: "pointer" }}>
      {children}
    </button>
  );
}

// ——— 待办分组：一整行平铺，组间分隔（对应设计稿顶部待办条，精确样式） ———
const TODO_BAD = (t) => t === "bad" || t === "danger" || t === "red";
function TodoStrip({ groups, go }) {
  if (!groups?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #ebedf2", borderRadius: 16, padding: "18px 8px", display: "flex", alignItems: "stretch", boxShadow: "0 1px 2px rgba(20,24,40,.04)" }}>
      {groups.map((g, gi) => (
        <div key={g.title} style={{ flex: 1, minWidth: 0, padding: "0 16px", borderRight: gi === groups.length - 1 ? "none" : "1px solid #f0f1f5", display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#6b7180" }}>{g.title}</div>
          <div style={{ display: "flex", gap: 18 }}>
            {g.items.map((it) => (
              <button key={it.label} type="button" onClick={() => it.target?.route && go?.(it.target.route, it.target.id)} style={{ border: 0, background: "transparent", padding: 0, cursor: it.target ? "pointer" : "default", textAlign: "left" }}>
                <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: TODO_BAD(it.tone) ? "#d3705f" : "#2b2f3a" }}>{it.value}</div>
                <div style={{ fontSize: 11, color: "#9aa0ad", fontWeight: 600, marginTop: 6 }}>{it.label}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ——— 经营数据卡：标题栏 + 指标条（对应设计稿「经营数据」面板，精确样式） ———
function BizDataCard({ metrics, updatedAt, liveLabel }) {
  if (!metrics?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #ebedf2", borderRadius: 16, padding: "18px 22px", boxShadow: "0 1px 2px rgba(20,24,40,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.ink }}>经营数据</h3>
        <span style={{ fontSize: 11, color: "#aeb3c0", fontWeight: 700, border: "1px solid #ebedf2", borderRadius: 6, padding: "2px 8px" }}>自定义数据</span>
        {updatedAt ? <span style={{ fontSize: 11.5, color: "#aeb3c0", fontWeight: 600 }}>更新时间 {updatedAt}</span> : null}
        {liveLabel ? (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: "#ef5b46" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef5b46", animation: "livepulse 1.6s ease-in-out infinite" }} />
            {liveLabel}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {metrics.map((m, i) => {
          const f = fmtKpi(m.value, m.unit);
          return (
            <div key={m.key} style={{ flex: 1, minWidth: 0, padding: "0 16px", borderRight: i === metrics.length - 1 ? "none" : "1px solid #f0f1f5" }}>
              <div style={{ fontSize: 12, color: "#9aa0ad", fontWeight: 700 }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 9 }}>
                <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px", fontVariantNumeric: "tabular-nums", color: toneColor(m.tone) }}>{f.value}</span>
                {f.unit ? <span style={{ fontSize: 12, fontWeight: 700, color: "#9aa0ad" }}>{f.unit}</span> : null}
              </div>
              {m.hint ? <div style={{ fontSize: 11.5, fontWeight: 700, color: tone(m.tone).color, marginTop: 8 }}>{m.hint}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ——— Hero（真实排班累计走势）+ 两张趋势卡（真实漏斗走势），精确样式 ———
function HeroRow({ hero, sparkCards }) {
  if (!hero) return null;
  const f = fmtKpi(hero.value, hero.unit);
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ flex: 1.5, minWidth: 0, background: "linear-gradient(125deg,#515da8 0%,#62568f 100%)", borderRadius: 16, padding: "20px 22px", color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 6px 18px rgba(70,70,130,.16)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>{hero.label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 10 }}>
          <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}>{f.value}</span>
          {f.unit ? <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.85 }}>{f.unit}</span> : null}
        </div>
        {hero.sub ? <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.82, marginTop: 6 }}>{hero.sub}</div> : null}
        {hero.series ? (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, opacity: 0.9, pointerEvents: "none" }}>
            <Spark series={hero.series} color="#ffffff" w={360} h={64} pad={6} />
          </div>
        ) : null}
        {hero.stats?.length ? (
          <div style={{ position: "relative", display: "flex", gap: 26, marginTop: 18 }}>
            {hero.stats.map((s) => (
              <div key={s.k}>
                <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.82, marginTop: 3 }}>{s.k}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {(sparkCards || []).map((c) => (
        <div key={c.label} style={{ flex: 1, minWidth: 0, background: "#fff", border: "1px solid #ebedf2", borderRadius: 16, padding: "18px 18px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12.5, color: "#9aa0ad", fontWeight: 700 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 9 }}>
            <span style={{ fontSize: 25, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{c.value}</span>
            {c.delta ? <span style={{ fontSize: 11.5, fontWeight: 800, color: tone(c.tone).color }}>{c.delta}</span> : null}
          </div>
          <div style={{ marginTop: "auto" }}>
            {c.series ? <Spark series={c.series} color={tone(c.tone).color} w={240} h={56} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ——— 漏斗 ———
function FunnelPanel({ funnel, go, onPick }) {
  if (!funnel?.stages?.length) return null;
  const max = Math.max(...funnel.stages.map((s) => Number(s.value) || 0), 1);
  return (
    <SectionCard title={funnel.title} hint={funnel.subtitle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {funnel.stages.map((s) => {
          const pct = Math.round(((Number(s.value) || 0) / max) * 100);
          return (
            <button key={s.key} type="button" onClick={() => (funnel.target?.route ? go?.(funnel.target.route, funnel.target.id) : onPick?.({ kind: "funnel", title: s.label, item: s, tag: funnel.title }))} style={{ display: "grid", gridTemplateColumns: "120px 1fr 96px", alignItems: "center", gap: 12, border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
              <span style={{ fontSize: 12.5, color: C.ink2, textAlign: "left" }}>{s.label}</span>
              <span style={{ height: 22, borderRadius: 8, background: C.soft2, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.max(pct, 6)}%`, background: tone(s.tone || "info").color, opacity: 0.85, borderRadius: 8 }} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, textAlign: "right" }}>
                {num(s.value)}{s.rate != null ? <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>{s.rate}%</span> : null}
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        {data.lanes.map((L) => (
          <div key={L.key} style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: tone(L.tone || "info").color }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{L.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>{L.count}</span>
            </div>
            <button type="button" onClick={() => onPick?.({ kind: "lane", title: L.label, item: L, tag: data.title })} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: C.card, borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{money(L.amount)}</div>
              <div style={{ fontSize: 11, color: C.muted }}>批次金额</div>
            </button>
          </div>
        ))}
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
          <RowButton key={r.key} onClick={() => (r.target?.route ? go?.(r.target.route, r.target.id) : onPick?.({ kind: "amountRisk", title: r.label, item: r, tag: data.title }))}>
            <span style={{ width: 6, height: 30, borderRadius: 3, background: tone(r.tone || "danger").color }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{r.label}</span>
              {r.hint ? <span style={{ fontSize: 11.5, color: C.muted }}>{r.hint}</span> : null}
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: C.danger }}>{money(r.amount)}</span>
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
            <button key={r.key} type="button" onClick={() => (r.target?.route ? go?.(r.target.route, r.target.id) : onPick?.({ kind: "rank", title: r.title, item: r, tag: data.title }))} style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: C.muted, width: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>{r.title}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: tone(r.tone || "good").color }}>{money(r.value)}</span>
                {r.hint ? <span style={{ fontSize: 11.5, color: C.muted }}>{r.hint}</span> : null}
              </div>
              <span style={{ display: "block", height: 7, borderRadius: 99, background: C.soft2, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.max(pct, 4)}%`, background: C.primaryGrad, borderRadius: 99 }} />
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ——— 列表型区块（卡点队列 / 风险流 / 常用入口）———
function QueuePanel({ title, hint, items, go }) {
  if (!items?.length) return null;
  return (
    <SectionCard title={title} hint={hint} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((it) => (
          <RowButton key={it.key} onClick={() => go?.(it.target?.route || "warroom", it.target?.id)}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: tone(it.tone).color }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{it.title}</span>
              {it.subtitle ? <span style={{ fontSize: 11.5, color: C.muted }}>{it.subtitle}</span> : null}
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
  const rows = (tasks || []).filter((t) => Number.isFinite(t?.startHour)).slice().sort((a, b) => (a.startHour || 0) - (b.startHour || 0)).slice(0, 8);
  if (!rows.length) return null;
  return (
    <SectionCard title="今日直播时间轴" hint={`${rows.length} 场`} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => (
          <RowButton key={t.id} onClick={() => onPick?.({ kind: "task", title: t.streamer || t.title, item: t, tag: "直播任务", target: { route: "tasks", id: t.id } })}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, width: 52 }}>{Number.isFinite(t.startHour) ? `${t.startHour}:00` : "—"}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{t.streamer || t.anchor || "未指派主播"}</span>
              <span style={{ fontSize: 11.5, color: C.muted }}>{t.project || t.projectName || t.title || "—"}</span>
            </span>
            <StatusChip label={isAnomaly(t) ? "异常" : t.statusLabel || t.status || "待开播"} t={isAnomaly(t) ? "danger" : isLive(t) ? "ok" : "neutral"} />
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
    <SectionCard title="我的今日任务流" hint={`${rows.length} 项`} pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => (
          <RowButton key={`ts-${t.id}`} onClick={() => onPick?.({ kind: "task", title: t.title || t.streamer, item: t, tag: "任务", target: { route: "tasks", id: t.id } })}>
            <span style={{ fontSize: 12, color: C.muted, width: 52 }}>{Number.isFinite(t.startHour) ? `${t.startHour}:00` : "全天"}</span>
            <StatusChip label={t.kind || t.type || "排班"} t="info" />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{t.title || t.streamer || "任务"}</span>
              <span style={{ fontSize: 11.5, color: C.muted }}>{t.project || t.projectName || ""}</span>
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
  const rows = (reports || []).filter((r) => r?.status === "pending_review").slice(0, 8);
  if (!rows.length) return null;
  const cell = { fontSize: 12.5, color: C.ink2 };
  return (
    <SectionCard title="待审核报数 · 证据核验" hint="系统时长 vs 截图时长" pad={false}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr 1fr", padding: "8px 16px", background: C.soft, fontSize: 11, color: C.muted, fontWeight: 600 }}>
        <span>主播 / 项目</span><span>系统时长</span><span>截图时长</span><span>偏差</span><span>证据 / 动作</span>
      </div>
      {rows.map((r) => {
        const sys = Number(r.systemDurationHours ?? r.duration ?? 0);
        const shot = Number(r.screenDurationHours ?? r.duration ?? 0);
        const dev = sys > 0 ? Math.round(((shot - sys) / sys) * 100) : 0;
        const bad = Math.abs(dev) >= 10;
        return (
          <button key={`rv-${r.id}`} type="button" onClick={() => onPick?.({ kind: "report", title: r.streamer, item: r, tag: "待审报数", target: { route: "reports", id: r.id } })} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 0.9fr 1fr", alignItems: "center", padding: "11px 16px", border: 0, borderBottom: `1px solid ${C.line}`, background: C.card, cursor: "pointer", textAlign: "left" }}>
            <span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{r.streamer || "—"}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{r.project || ""}</span>
            </span>
            <span style={cell}>{sys ? `${sys} 小时` : "—"}</span>
            <span style={cell}>{shot ? `${shot} 小时` : "—"}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: bad ? C.danger : C.ok }}>{dev > 0 ? "+" : ""}{dev}%</span>
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
function LowMarginPanel({ projects, go }) {
  const rows = (projects || []).map((p) => ({ p, rate: margin(p) })).filter((x) => Number.isFinite(x.rate) && x.rate < 20).sort((a, b) => a.rate - b.rate).slice(0, 6);
  if (!rows.length) return null;
  return (
    <SectionCard title="低 / 负毛利项目" hint="复盘重点" pad={false}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(({ p, rate }) => (
          <RowButton key={`lm-${p.id}`} onClick={() => go?.("project", p.id)}>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.ink }}>{p.name}</span>
              <span style={{ fontSize: 11.5, color: C.muted }}>{p.product || p.vendor || "—"}</span>
            </span>
            <StatusChip label={`毛利率 ${rate.toFixed(0)}%`} t={rate < 10 ? "danger" : "warn"} />
          </RowButton>
        ))}
      </div>
    </SectionCard>
  );
}

// ——— 详情抽屉 ———
function fieldsFor(pick) {
  const it = pick?.item || {};
  if (pick.kind === "task")
    return [
      { k: "状态", v: it.statusLabel || it.status || pick.tag },
      { k: "项目", v: it.project || it.projectName || "—" },
      { k: "主播", v: it.streamer || it.anchor || "—" },
      { k: "时间", v: Number.isFinite(it.startHour) ? `${it.startHour}:00` : "—" },
    ];
  if (pick.kind === "report")
    return [
      { k: "主播", v: it.streamer || "—" },
      { k: "项目", v: it.project || "—" },
      { k: "系统时长", v: `${it.systemDurationHours ?? it.duration ?? 0} 小时` },
      { k: "日期", v: it.date || "—" },
    ];
  if (pick.kind === "amountRisk") return [{ k: "类型", v: it.label }, { k: "金额", v: money(it.amount) }, { k: "说明", v: it.hint || "—" }];
  if (pick.kind === "rank") return [{ k: "项目", v: it.title }, { k: "毛利贡献", v: money(it.value) }, { k: "毛利率", v: it.hint || "—" }];
  if (pick.kind === "lane") return [{ k: "阶段", v: it.label }, { k: "批次金额", v: money(it.amount) }, { k: "批次数", v: String(it.count) }];
  if (pick.kind === "funnel") return [{ k: "阶段", v: it.label }, { k: "数量", v: num(it.value) }, { k: "转化", v: it.rate != null ? `${it.rate}%` : "—" }];
  return [];
}

function DetailDrawer({ open, data, onClose, go }) {
  if (!open || !data) return null;
  const fields = data.fields || [];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }} onClick={onClose} role="presentation">
      <div style={{ position: "absolute", inset: 0, background: "rgba(20,24,40,.28)" }} />
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={data.title} style={{ position: "absolute", top: 0, right: 0, height: "100%", width: "min(420px, 92vw)", background: C.card, boxShadow: "-24px 0 60px rgba(11,23,51,.18)", display: "flex", flexDirection: "column", animation: "drawerin .22s ease" }}>
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <StatusChip label={data.tag || "明细"} t="info" />
            <button type="button" onClick={onClose} style={{ border: 0, background: "transparent", fontSize: 20, color: C.muted, cursor: "pointer" }} aria-label="关闭">×</button>
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
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3 }}>{f.v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.muted }}>暂无更多明细字段。</div>
          )}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10 }}>
          <Button onPress={onClose} style={{ flex: 1, border: `1px solid ${C.line}`, background: C.card, color: C.ink2, borderRadius: 12, padding: "10px 0", fontWeight: 600 }}>关闭</Button>
          {data.target?.route ? (
            <Button onPress={() => { go?.(data.target.route, data.target.id); onClose(); }} style={{ flex: 1, border: 0, background: C.primaryGrad, color: "#fff", borderRadius: 12, padding: "10px 0", fontWeight: 700 }}>去处理</Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function useUpdatedLabel(generatedAt) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 5000);
    return () => clearInterval(id);
  }, []);
  if (!generatedAt) return "";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
  return diff < 60 ? `${diff} 秒前更新` : `${Math.floor(diff / 60)} 分钟前更新`;
}

// 由真实漏斗算「准入通过率 / 结算转化率」（末段 / 首段），无则不展示。
function funnelRate(funnel) {
  const st = funnel?.stages;
  if (!st?.length) return null;
  const first = Number(st[0]?.value) || 0;
  const last = Number(st[st.length - 1]?.value) || 0;
  if (first <= 0) return null;
  return Math.round((last / first) * 100);
}

export function OverviewBoard({ dashboard, go, projects, tasks, reports, batches }) {
  const [pick, setPick] = React.useState(null);
  const d = dashboard || {};
  const profile = d.profile || {};
  const role = String(profile.role || "owner");
  const panels = d.panels || {};
  const kpis = d.kpis || [];
  const heroKpi = kpis[0] || null;
  const riskCount = (d.risks || []).length;

  // 给经营数据每个指标补一条真实的二级信息（设计稿第三行），均由实时数据算出。
  const bizMetrics = React.useMemo(() => {
    const recruiting = cnt(projects, (p) => pStatus(p, "recruiting"));
    const active = cnt(projects, (p) => pStatus(p, "active"));
    const live = cnt(tasks, isLive);
    const notStarted = cnt(tasks, isNotStarted);
    const anomalies = cnt(tasks, isAnomaly);
    const gap = cnt(projects, (p) => (p?.streamers?.candidate ?? 0) > 0);
    const recPending = (projects || []).reduce((s, p) => s + (p?.streamers?.pendingReview ?? 0), 0);
    const pendReports = cnt(reports, (r) => r?.status === "pending_review");
    const bs = (s) => cnt(batches, (b) => b.status === s);
    const HINT = {
      activeProjects: active || recruiting ? `招募 ${recruiting}` : "",
      vendorReceivable: active ? `${active} 个项目` : "",
      estimatedGross: "",
      grossMarginRate: "",
      highRiskItems: bs("reopened") ? `重开 ${bs("reopened")}` : "",
      deliveryProgress: "",
      streamerGapProjects: gap ? `${gap} 项告急` : "",
      recordingsPending: recPending ? `录屏待审 ${recPending}` : "",
      pendingReports: pendReports ? `待审 ${pendReports}` : "",
      anomalyTasks: notStarted ? `未开播 ${notStarted}` : "",
      myTodayTasks: `进行中 ${live}`,
      notStartedTasks: anomalies ? `异常 ${anomalies}` : "",
      streamerReminders: "",
      settlementPoolAmount: "",
      settlementPoolCount: "",
      draftBatches: bs("pending_confirm") ? `待确认 ${bs("pending_confirm")}` : "",
      weakEvidenceAmount: "",
      reopenedBatches: "",
    };
    return kpis.slice(1).map((k) => ({ ...k, hint: k.hint || HINT[k.key] || "" }));
  }, [kpis, projects, tasks, reports, batches]);
  const updatedLabel = useUpdatedLabel(d.generatedAt);
  const updatedAt = d.generatedAt ? new Date(d.generatedAt).toLocaleString("zh-CN") : "";
  const isOperator = role.includes("operator");

  const todoGroups = React.useMemo(
    () => computeTodoGroups(role, { projects, tasks, reports, batches }),
    [role, projects, tasks, reports, batches],
  );

  // Hero：用首个真实 KPI 作为大数；为直播相关角色补「按小时排班累计」真实走势与实时分解。
  const hero = React.useMemo(() => {
    if (!heroKpi) return null;
    const series = scheduleSeries(tasks);
    const live = cnt(tasks, isLive);
    const notStarted = cnt(tasks, isNotStarted);
    const done = cnt(tasks, isDone);
    const anomalies = cnt(tasks, isAnomaly);
    const pendingReports = cnt(reports, (r) => r?.status === "pending_review");
    const taskish = (tasks || []).length > 0;
    return {
      label: heroKpi.label,
      value: heroKpi.value,
      unit: heroKpi.unit,
      sub: taskish ? `进行中 ${live} · 待开播 ${notStarted} · 已完成 ${done} · 异常 ${anomalies}` : heroKpi.hint || "",
      stats: taskish
        ? [
            { k: "进行中", v: String(live) },
            { k: "待报数", v: String(pendingReports) },
            { k: "异常", v: String(anomalies) },
          ]
        : null,
      series: isOperator || role.includes("ops") ? series : null,
    };
  }, [heroKpi, tasks, reports, role, isOperator]);

  // 两张趋势卡：用真实漏斗算通过率/转化率，走势线用漏斗各阶段真实数值（非编造）。
  const sparkCards = React.useMemo(() => {
    const cards = [];
    const af = panels.admissionFunnel;
    const ar = funnelRate(af);
    if (ar != null) {
      cards.push({
        label: "准入通过率",
        value: `${ar}%`,
        tone: ar >= 70 ? "ok" : "warn",
        series: (af.stages || []).map((s) => Number(s.value) || 0),
      });
    }
    const sf = panels.settlementFunnel;
    const sr = funnelRate(sf);
    if (sr != null) {
      cards.push({
        label: "结算池转化率",
        value: `${sr}%`,
        tone: sr >= 70 ? "ok" : "warn",
        series: (sf.stages || []).map((s) => Number(s.value) || 0),
      });
    }
    return cards;
  }, [panels.admissionFunnel, panels.settlementFunnel]);

  const liveLabel = isOperator ? "任务实时刷新" : role.includes("finance") ? "结算池实时变动" : "直播执行实时盘";
  const onPick = React.useCallback((p) => setPick({ ...p, sub: p.tag, fields: fieldsFor(p) }), []);

  return (
    <div style={{ background: C.page, minHeight: "100%" }}>
      <div style={{ width: "100%", maxWidth: 1440, margin: "0 auto", padding: 20, display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.ink }}>{profile.title || "经营总览看板"}</h1>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.ok, background: "#e7f5ef", padding: "3px 9px", borderRadius: 999, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: C.ok, animation: "livepulse 1.6s infinite" }} />实时
              </span>
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: C.ink2 }}>{profile.subtitle || "经营闭环 · 全链路实时盘"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {profile.scopeLabel ? <StatusChip label={profile.scopeLabel} t="info" /> : null}
            {updatedLabel ? <span style={{ fontSize: 11.5, color: C.muted }}>{updatedLabel}</span> : null}
          </div>
        </div>

        {/* 风险提醒条（真实风险计数） */}
        {riskCount > 0 ? (
          <button type="button" onClick={() => go?.("warroom")} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${C.dangerBg}`, background: "#fff6f4", borderRadius: 16, padding: "12px 16px", cursor: "pointer", textAlign: "left" }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: C.dangerBg, color: C.danger, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>!</span>
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{riskCount} 条风险待处理</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: C.ink2 }}>命中风险规则 · 需人工核验</span>
            </span>
            <span style={{ fontSize: 12, color: C.danger, fontWeight: 700 }}>立即处理 →</span>
          </button>
        ) : null}

        {d.emptyState ? (
          <SectionCard title={d.emptyState.title}>
            <div style={{ fontSize: 13, color: C.muted }}>{d.emptyState.hint}</div>
          </SectionCard>
        ) : null}

        {/* 待办分组（平铺一行，真实计数） */}
        <TodoStrip groups={todoGroups} go={go} />

        {/* 经营数据卡（标题栏 + 指标条，真实 KPI） */}
        <BizDataCard metrics={bizMetrics} updatedAt={updatedAt} liveLabel={liveLabel} />

        {/* Hero（真实排班累计走势）+ 两张趋势卡（真实通过率/转化率） */}
        <HeroRow hero={hero} sparkCards={sparkCards} />

        {/* 深度分析区块（按角色/数据门控，缺数据自动隐藏） */}
        <FunnelPanel funnel={panels.admissionFunnel} go={go} onPick={onPick} />
        <FunnelPanel funnel={panels.settlementFunnel} go={go} onPick={onPick} />
        <TimelinePanel tasks={tasks} onPick={onPick} />
        <QueuePanel title="项目卡点队列" hint="按卡住时长" items={d.queue} go={go} />
        {isOperator ? <TaskStreamPanel tasks={tasks} onPick={onPick} /> : null}
        <ReviewQueuePanel reports={reports} onPick={onPick} />
        <LanesPanel data={panels.batchLanes} onPick={onPick} />
        <AmountRiskPanel data={panels.amountRisks} go={go} onPick={onPick} />
        <RankingPanel data={panels.projectRanking} go={go} onPick={onPick} />
        <LowMarginPanel projects={projects} go={go} />
        <QueuePanel title="风险告警流" hint={`${riskCount} 未处理`} items={d.risks} go={go} />
        <QueuePanel title="常用入口" hint="一键进入对应闭环阶段" items={d.drilldowns} go={go} />

        {updatedAt ? <div style={{ fontSize: 12, color: C.muted }}>数据更新时间：{updatedAt}</div> : null}
      </div>

      <DetailDrawer open={!!pick} data={pick} onClose={() => setPick(null)} go={go} />
    </div>
  );
}

export default OverviewBoard;
