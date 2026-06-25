"use client";

/* eslint-disable */
// 经营总览看板 v2 —— 依据设计稿用 HeroUI 重建，像素级 1:1 还原排版/交互/指标结构。
// 仅用于「智能作战台 / 经营闭环看板」总览页，其余页面不受影响。
// 数据全部为真实业务数据：服务端 dashboard（kpis/panels/queue/risks，按角色计算）
// + 实时 projects/tasks/reports/batches。缺数据的区块自动隐藏。
// 按用户确认：只展示当前登录角色的看板；无历史时序，故走势线只画能算出的真实曲线
//（如「今日排班按小时累计」、漏斗各阶段），算不出的就不画/不编造环比。

import * as React from "react";
import { Button } from "@heroui/react";
import "@heroui/react/styles";

// ——— 设计稿调色板 ———
const C = {
  page: "#fafbff",
  card: "#ffffff",
  border: "#ebedf2",
  divider: "#f0f1f5",
  divider2: "#f3f4f8",
  track: "#f0f1f6",
  soft: "#f7f8fb",
  ink: "#1b1f2a",
  ink2: "#5b6170",
  ink3: "#6b7180",
  muted: "#9aa0ad",
  faint: "#aeb3c0",
  primary: "#5566e6",
  primaryGrad: "linear-gradient(120deg,#5566e6,#7b54ec)",
  heroGrad: "linear-gradient(125deg,#515da8 0%,#62568f 100%)",
  danger: "#ef5b46",
  dangerBg: "#fde9e5",
  ok: "#2f9e6f",
  warn: "#c5860c",
};
const GRAD_PRIMARY = "linear-gradient(90deg,#6e79cf,#8088d6)";
const GRAD_SOFT = "linear-gradient(90deg,#aeb4dd,#c2c7e6)";
const GRAD_WARN = "linear-gradient(90deg,#cda04a,#dab873)";
const GRAD_BAD = "linear-gradient(90deg,#d3705f,#df8a79)";

const TONE = {
  ok: { color: C.ok, bg: "#e7f5ef", solid: "#3aa97c" },
  good: { color: C.ok, bg: "#e7f5ef", solid: "#3aa97c" },
  green: { color: C.ok, bg: "#e7f5ef", solid: "#3aa97c" },
  info: { color: C.primary, bg: "#ecedfb", solid: "#5566e6" },
  blue: { color: C.primary, bg: "#ecedfb", solid: "#5566e6" },
  primary: { color: C.primary, bg: "#ecedfb", solid: "#5566e6" },
  violet: { color: "#7b54ec", bg: "#efeafe", solid: "#7b54ec" },
  neutral: { color: C.ink2, bg: "#eef0f5", solid: "#9aa0ad" },
  warn: { color: C.warn, bg: "#fbf1da", solid: "#d39a2a" },
  warning: { color: C.warn, bg: "#fbf1da", solid: "#d39a2a" },
  amber: { color: C.warn, bg: "#fbf1da", solid: "#d39a2a" },
  danger: { color: C.danger, bg: C.dangerBg, solid: "#ef5b46" },
  bad: { color: C.danger, bg: C.dangerBg, solid: "#ef5b46" },
  red: { color: C.danger, bg: C.dangerBg, solid: "#ef5b46" },
};
const tone = (t) => TONE[t] || TONE.neutral;
const solid = (t) => tone(t).solid;

const ROUTE_LABELS = { project: "项目", projects: "项目", streamers: "主播", tasks: "任务", reports: "报数", settle: "结算", audit: "审计", notifications: "通知" };
const routeLabel = (r) => ROUTE_LABELS[r] || "查看";

const num = (n) => (Number(n) || 0).toLocaleString("zh-CN");
const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("zh-CN")}`;
};
const moneyK = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? `¥${(v / 1000).toFixed(1)}K` : `¥${v.toLocaleString("zh-CN")}`;
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

function scheduleSeries(tasks) {
  const byHour = Array(24).fill(0);
  let any = false;
  (tasks || []).forEach((t) => {
    const h = Number(t?.startHour);
    if (Number.isFinite(h)) { byHour[Math.max(0, Math.min(23, Math.round(h)))] += 1; any = true; }
  });
  if (!any) return null;
  const out = [];
  let acc = 0;
  for (let h = 6; h <= 23; h += 1) { acc += byHour[h]; out.push(acc); }
  return out.length >= 2 ? out : null;
}

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
  return [
    G("项目待办", [I("进行中", cnt(projects, (p) => pStatus(p, "active")), "primary", "projects"), I("招募中", cnt(projects, (p) => pStatus(p, "recruiting")), "neutral", "projects")]),
    G("复盘待办", [I("低毛利", cnt(projects, (p) => margin(p) >= 0 && margin(p) < 20), "warn", "projects"), I("负毛利", cnt(projects, (p) => margin(p) < 0), "bad", "projects")]),
    G("结算待办", [I("待生成", bs("draft"), "neutral", "settle"), I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle")]),
    G("审计待办", [I("高风险", cnt(projects, (p) => p.risk === "high"), "bad", "audit"), I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle")]),
  ];
}

function funnelRate(funnel) {
  const st = funnel?.stages;
  if (!st?.length) return null;
  const first = Number(st[0]?.value) || 0;
  const last = Number(st[st.length - 1]?.value) || 0;
  if (first <= 0) return null;
  return Math.round((last / first) * 100);
}

// ——— 真实数据走势线 ———
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
  const id = `sk-${color.replace(/[^a-z0-9]/gi, "")}-${series.length}-${Math.round(series[0])}`;
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

// ——— 区块外壳 + 标题（精确样式） ———
function Sec({ span = 2, children }) {
  return (
    <section style={{ gridColumn: `span ${span}`, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 20px" }}>
      {children}
    </section>
  );
}
function SecHead({ title, hint, right, mb = 16 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: mb }}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.ink }}>{title}</h3>
      {hint ? <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginLeft: right ? 0 : "auto" }}>{hint}</span> : null}
      {right ? <span style={{ marginLeft: "auto", ...right.style }}>{right.text}</span> : null}
    </div>
  );
}

// ——— 待办分组条 ———
const TODO_BAD = (t) => t === "bad" || t === "danger" || t === "red";
function TodoStrip({ groups, go }) {
  if (!groups?.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 8px", display: "flex", alignItems: "stretch", boxShadow: "0 1px 2px rgba(20,24,40,.04)" }}>
      {groups.map((g, gi) => (
        <div key={g.title} style={{ flex: 1, minWidth: 0, padding: "0 16px", borderRight: gi === groups.length - 1 ? "none" : `1px solid ${C.divider}`, display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink3 }}>{g.title}</div>
          <div style={{ display: "flex", gap: 18 }}>
            {g.items.map((it) => (
              <button key={it.label} type="button" onClick={() => it.target?.route && go?.(it.target.route, it.target.id)} style={{ border: 0, background: "transparent", padding: 0, cursor: it.target ? "pointer" : "default", textAlign: "left" }}>
                <div style={{ fontSize: 23, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: TODO_BAD(it.tone) ? "#d3705f" : "#2b2f3a" }}>{it.value}</div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 6 }}>{it.label}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ——— 经营数据卡 ———
function BizDataCard({ metrics, updatedAt, liveLabel }) {
  if (!metrics?.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 22px", boxShadow: "0 1px 2px rgba(20,24,40,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.ink }}>经营数据</h3>
        <span style={{ fontSize: 11, color: C.faint, fontWeight: 700, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px" }}>自定义数据</span>
        {updatedAt ? <span style={{ fontSize: 11.5, color: C.faint, fontWeight: 600 }}>更新时间 {updatedAt}</span> : null}
        {liveLabel ? (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: C.danger }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.danger, animation: "livepulse 1.6s ease-in-out infinite" }} />
            {liveLabel}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {metrics.map((m, i) => {
          const f = fmtKpi(m.value, m.unit);
          return (
            <div key={m.key} style={{ flex: 1, minWidth: 0, padding: "0 16px", borderRight: i === metrics.length - 1 ? "none" : `1px solid ${C.divider}` }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 9 }}>
                <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.4px", fontVariantNumeric: "tabular-nums", color: tone(m.tone).color }}>{f.value}</span>
                {f.unit ? <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{f.unit}</span> : null}
              </div>
              {m.hint ? <div style={{ fontSize: 11.5, fontWeight: 700, color: tone(m.tone).color, marginTop: 8 }}>{m.hint}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ——— Hero + 趋势卡 ———
function HeroRow({ hero, sparkCards }) {
  if (!hero) return null;
  const f = fmtKpi(hero.value, hero.unit);
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ flex: 1.5, minWidth: 0, background: C.heroGrad, borderRadius: 16, padding: "20px 22px", color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 6px 18px rgba(70,70,130,.16)" }}>
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
        <div key={c.label} style={{ flex: 1, minWidth: 0, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 18px 0", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 700 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 9 }}>
            <span style={{ fontSize: 25, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{c.value}</span>
            {c.delta ? <span style={{ fontSize: 11.5, fontWeight: 800, color: tone(c.tone).color }}>{c.delta}</span> : null}
          </div>
          <div style={{ marginTop: "auto" }}>
            {c.series ? <Spark series={c.series} color="#8088d6" w={240} h={56} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ——— 漏斗（值显示在条内，右侧转化率） ———
function FunnelPanel({ funnel, go, onPick, labelW = 118, fillMin = 42, rightW = 62, rightKey = "rate", warn }) {
  if (!funnel?.stages?.length) return null;
  // 用各阶段最大值作分母，避免首段为 0 时后段撑爆（如 已审核进池 0 / 已生成批次 240）。
  const base = Math.max(...funnel.stages.map((s) => Math.abs(Number(s.value) || 0)), 1);
  const n = funnel.stages.length;
  return (
    <Sec span={2}>
      <SecHead title={funnel.title} hint={funnel.subtitle} right={warn} />
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {funnel.stages.map((s, i) => {
          const pct = Math.min(Math.max(Math.round((Math.abs(Number(s.value) || 0) / base) * 100), 6), 100);
          const grad = i >= n - 2 ? GRAD_PRIMARY : GRAD_SOFT;
          const rightVal = rightKey === "count" ? s.count : s.rate != null ? `${s.rate}%` : "";
          const inner = rightKey === "count" ? moneyK(s.value) : num(s.value);
          return (
            <button key={s.key} type="button" onClick={() => (funnel.target?.route ? go?.(funnel.target.route, funnel.target.id) : onPick?.({ kind: "funnel", title: s.label, item: s, tag: funnel.title }))} style={{ display: "flex", alignItems: "center", gap: 14, border: 0, background: "transparent", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: labelW, flex: "none", fontSize: 12.5, fontWeight: 700, color: C.ink2 }}>{s.label}</div>
              <div style={{ flex: 1, height: 30, background: C.track, borderRadius: 9, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(20,30,70,.06)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: grad, borderRadius: 9, display: "flex", alignItems: "center", paddingLeft: 11, color: "#fff", fontSize: 12.5, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: fillMin }}>{inner}</div>
              </div>
              <div style={{ width: rightW, flex: "none", textAlign: "right", fontSize: 12, fontWeight: 700, color: C.muted }}>{rightVal}</div>
            </button>
          );
        })}
      </div>
    </Sec>
  );
}

// ——— 今日直播时间轴 ———
function TimelinePanel({ tasks, nowClock, onPick }) {
  const rows = (tasks || []).filter((t) => Number.isFinite(t?.startHour)).slice().sort((a, b) => (a.startHour || 0) - (b.startHour || 0)).slice(0, 8);
  if (!rows.length) return null;
  return (
    <Sec span={1}>
      <SecHead title="今日直播时间轴" hint={`${rows.length} 场 · 现在 ${nowClock}`} mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => {
          const tn = isAnomaly(t) ? "danger" : isLive(t) ? "ok" : isNotStarted(t) ? "neutral" : "warn";
          return (
            <div key={t.id} onClick={() => onPick?.({ kind: "task", title: `${t.streamer || "任务"} · ${t.startHour}:00`, item: t, tag: "直播任务", target: { route: "tasks", id: t.id } })} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
              <div style={{ width: 44, flex: "none", fontSize: 12.5, fontWeight: 800, color: C.ink2, fontVariantNumeric: "tabular-nums", paddingTop: 1 }}>{t.startHour}:00</div>
              <div style={{ width: 2, flex: "none", background: solid(tn), borderRadius: 2 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.streamer || t.anchor || "未指派主播"}</div>
                <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.project || t.projectName || t.title || "—"}</div>
              </div>
              <span style={{ flex: "none", alignSelf: "center", fontSize: 11, fontWeight: 700, color: tone(tn).color, background: tone(tn).bg, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{isAnomaly(t) ? "异常" : t.statusLabel || t.status || "待开播"}</span>
            </div>
          );
        })}
      </div>
    </Sec>
  );
}

// ——— 项目卡点队列 ———
function QueuePanel({ items, go }) {
  if (!items?.length) return null;
  return (
    <Sec span={1}>
      <SecHead title="项目卡点队列" hint="按卡住时长" mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((q) => (
          <button key={q.key} type="button" onClick={() => go?.(q.target?.route || "warroom", q.target?.id)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "11px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone(q.tone).solid }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.title}</span>
              <span style={{ marginLeft: "auto", flex: "none", fontSize: 11, fontWeight: 700, color: tone(q.tone).color, background: tone(q.tone).bg, padding: "2px 8px", borderRadius: 20 }}>{routeLabel(q.target?.route)}</span>
            </div>
            {q.subtitle ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingLeft: 14 }}>
                <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{q.subtitle}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: C.primary }}>查看 →</span>
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </Sec>
  );
}

// ——— 我的今日任务流 ———
function TaskStreamPanel({ tasks, onPick }) {
  const rows = (tasks || []).slice(0, 8);
  if (!rows.length) return null;
  return (
    <Sec span={2}>
      <SecHead title="我的今日任务流" hint={`按时间排序 · ${rows.length} 项待处理`} mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((t) => (
          <div key={`ts-${t.id}`} onClick={() => onPick?.({ kind: "task", title: t.title || t.streamer, item: t, tag: "任务", target: { route: "tasks", id: t.id } })} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
            <div style={{ width: 46, flex: "none", fontSize: 12.5, fontWeight: 800, color: C.ink2, fontVariantNumeric: "tabular-nums" }}>{Number.isFinite(t.startHour) ? `${t.startHour}:00` : "全天"}</div>
            <span style={{ flex: "none", fontSize: 10.5, fontWeight: 800, color: C.primary, background: "#ecedfb", padding: "3px 9px", borderRadius: 6, width: 64, textAlign: "center" }}>{t.kind || t.type || "排班"}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title || t.streamer || "任务"}</div>
              <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{t.project || t.projectName || ""}</div>
            </div>
            <span style={{ flex: "none", fontSize: 11.5, fontWeight: 700, color: C.primary }}>处理 →</span>
          </div>
        ))}
      </div>
    </Sec>
  );
}

// ——— 待审核报数 ———
function ReviewQueuePanel({ reports, onPick }) {
  const rows = (reports || []).filter((r) => r?.status === "pending_review").slice(0, 8);
  if (!rows.length) return null;
  const cols = "1.4fr .9fr .9fr .9fr 1fr";
  return (
    <Sec span={2}>
      <SecHead title="待审核报数 · 证据核验" hint="系统时长 vs 截图时长 · 阈值 10% / 15min" mb={12} />
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontSize: 11, fontWeight: 700, color: C.faint, padding: "0 4px 8px", borderBottom: `1px solid ${C.divider}` }}>
        <div>主播 / 项目</div><div>系统时长</div><div>截图时长</div><div>偏差</div><div style={{ textAlign: "right" }}>证据 / 动作</div>
      </div>
      {rows.map((r) => {
        const sys = Number(r.systemDurationHours ?? r.duration ?? 0);
        const shot = Number(r.screenDurationHours ?? r.duration ?? 0);
        const dev = sys > 0 ? Math.round(((shot - sys) / sys) * 100) : 0;
        const bad = Math.abs(dev) >= 10;
        const dn = bad ? "bad" : "ok";
        return (
          <div key={`rv-${r.id}`} onClick={() => onPick?.({ kind: "report", title: r.streamer, item: r, tag: "待审报数", target: { route: "reports", id: r.id } })} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "11px 4px", borderBottom: `1px solid #f4f5f8`, cursor: "pointer", fontSize: 12.5 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.streamer || "—"}</div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.project || ""}</div>
            </div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.ink }}>{sys ? `${sys} 小时` : "—"}</div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: shot ? C.ink : C.danger }}>{shot ? `${shot} 小时` : "—"}</div>
            <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: tone(dn).color }}>{dev > 0 ? "+" : ""}{dev}%</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: tone(dn).color, background: tone(dn).bg, padding: "2px 8px", borderRadius: 6 }}>{bad ? "弱证据" : "可信"}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.primary }}>审</span>
            </div>
          </div>
        );
      })}
    </Sec>
  );
}

// ——— 结算批次泳道 ———
function LanesPanel({ data, onPick }) {
  if (!data?.lanes?.length) return null;
  return (
    <Sec span={2}>
      <SecHead title={data.title || "结算批次泳道"} hint="草稿 → 已生成 → 待确认 → 已锁定 → 已导出" mb={14} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {data.lanes.map((L) => (
          <div key={L.key} style={{ flex: 1, minWidth: 0, background: C.soft, border: `1px solid ${C.divider}`, borderRadius: 12, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9, padding: "0 2px" }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: tone(L.tone || "info").solid }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>{L.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: C.muted }}>{L.count}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div onClick={() => onPick?.({ kind: "lane", title: L.label, item: L, tag: data.title })} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 10px", cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{money(L.amount)}</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2 }}>{L.count} 个批次</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Sec>
  );
}

// ——— 金额风险榜 ———
function AmountRiskPanel({ data, go, onPick }) {
  if (!data?.rows?.length) return null;
  return (
    <Sec span={2}>
      <SecHead title={data.title || "金额风险榜"} hint={data.subtitle || "弱证据 / 人工承载 / 重开批次"} mb={12} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {data.rows.map((r) => {
          const tn = r.tone || "danger";
          return (
            <div key={r.key} onClick={() => (r.target?.route ? go?.(r.target.route, r.target.id) : onPick?.({ kind: "amountRisk", title: r.label, item: r, tag: data.title }))} style={{ position: "relative", overflow: "hidden", border: `1px solid ${C.border}`, background: "#fff", borderRadius: 12, padding: "15px 16px 15px 19px", cursor: "pointer", boxShadow: "0 1px 2px rgba(20,30,70,.04)" }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: tone(tn).solid }} />
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: tone(tn).solid }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: C.ink3 }}>{r.label}</span>
              </div>
              <div style={{ fontSize: 23, fontWeight: 800, marginTop: 9, fontVariantNumeric: "tabular-nums", color: tone(tn).color }}>{money(r.amount)}</div>
              {r.hint ? <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 6 }}>{r.hint}</div> : null}
            </div>
          );
        })}
      </div>
    </Sec>
  );
}

// ——— 项目经营排行 ———
function RankingPanel({ data, go, onPick }) {
  if (!data?.rows?.length) return null;
  const max = Math.max(...data.rows.map((r) => Math.abs(Number(r.value) || 0)), 1);
  return (
    <Sec span={1}>
      <SecHead title={data.title || "项目经营排行"} hint={data.subtitle || "按毛利贡献"} mb={14} />
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {data.rows.map((r) => {
          const pct = Math.max(Math.round((Math.abs(Number(r.value)) / max) * 100), 4);
          const neg = Number(r.value) < 0;
          const tn = neg ? "bad" : r.tone === "amber" ? "warn" : "ok";
          return (
            <div key={r.key} onClick={() => (r.target?.route ? go?.(r.target.route, r.target.id) : onPick?.({ kind: "rank", title: r.title, item: r, tag: data.title }))} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
                <span style={{ marginLeft: "auto", flex: "none", fontSize: 12.5, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: C.ink }}>{money(r.value)}</span>
                {r.hint ? <span style={{ flex: "none", fontSize: 11, fontWeight: 800, color: tone(tn).color, background: tone(tn).bg, padding: "1px 7px", borderRadius: 20 }}>{r.hint.replace("毛利率 ", "")}</span> : null}
              </div>
              <div style={{ height: 8, background: C.track, borderRadius: 6, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(20,30,70,.06)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: neg ? GRAD_BAD : r.tone === "amber" ? GRAD_WARN : GRAD_PRIMARY, borderRadius: 6, boxShadow: "0 1px 2px rgba(70,60,140,.22)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </Sec>
  );
}

// ——— 低 / 负毛利项目 ———
function LowMarginPanel({ projects, go }) {
  const rows = (projects || []).map((p) => ({ p, rate: margin(p) })).filter((x) => Number.isFinite(x.rate) && x.rate < 20).sort((a, b) => a.rate - b.rate).slice(0, 6);
  if (!rows.length) return null;
  return (
    <Sec span={1}>
      <SecHead title="低 / 负毛利项目" hint="复盘重点" mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(({ p, rate }) => (
          <div key={`lm-${p.id}`} onClick={() => go?.("project", p.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{p.product || p.vendor || "—"}</div>
            </div>
            <span style={{ flex: "none", fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: rate < 0 ? C.danger : C.warn }}>{rate.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </Sec>
  );
}

// ——— 风险告警流 ———
function RiskFeedPanel({ items, riskCount, go }) {
  if (!items?.length) return null;
  return (
    <Sec span={1}>
      <SecHead title="风险告警流" right={{ text: `${riskCount} 未处理`, style: { fontSize: 11, fontWeight: 700, color: C.danger, background: C.dangerBg, padding: "1px 8px", borderRadius: 20 } }} mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((r) => (
          <button key={r.key} type="button" onClick={() => go?.(r.target?.route || "warroom", r.target?.id)} style={{ display: "flex", width: "100%", textAlign: "left", border: 0, background: "transparent", gap: 11, padding: "11px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
            <span style={{ width: 8, height: 8, flex: "none", marginTop: 5, borderRadius: "50%", background: tone(r.tone).solid }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, lineHeight: 1.4 }}>{r.title}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: tone(r.tone).color, background: tone(r.tone).bg, padding: "1px 7px", borderRadius: 5 }}>{routeLabel(r.target?.route)}</span>
                {r.subtitle ? <span style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>{r.subtitle}</span> : null}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Sec>
  );
}

// ——— 常用入口（drilldowns，按钮+路由徽标） ———
function DrilldownPanel({ items, go }) {
  if (!items?.length) return null;
  return (
    <Sec span={2}>
      <SecHead title="常用入口" hint="一键进入对应闭环阶段" mb={6} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((it) => (
          <button key={it.key} type="button" onClick={() => go?.(it.target?.route || "warroom", it.target?.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "11px 0", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
            {it.subtitle ? <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{it.subtitle}</span> : null}
            <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: tone(it.tone).color, background: tone(it.tone).bg, padding: "2px 8px", borderRadius: 20 }}>{routeLabel(it.target?.route)}</span>
          </button>
        ))}
      </div>
    </Sec>
  );
}

// ——— 详情抽屉 ———
function fieldsFor(pick) {
  const it = pick?.item || {};
  if (pick.kind === "task") return [{ k: "状态", v: it.statusLabel || it.status || pick.tag }, { k: "项目", v: it.project || it.projectName || "—" }, { k: "主播", v: it.streamer || it.anchor || "—" }, { k: "时间", v: Number.isFinite(it.startHour) ? `${it.startHour}:00` : "—" }];
  if (pick.kind === "report") return [{ k: "主播", v: it.streamer || "—" }, { k: "项目", v: it.project || "—" }, { k: "系统时长", v: `${it.systemDurationHours ?? it.duration ?? 0} 小时` }, { k: "日期", v: it.date || "—" }];
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
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,40,.28)", zIndex: 40 }} />
      <div role="dialog" aria-label={data.title} style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 420, maxWidth: "92vw", background: "#fff", zIndex: 41, boxShadow: "-12px 0 40px rgba(20,30,70,.16)", display: "flex", flexDirection: "column", animation: "drawerin .22s cubic-bezier(.2,.7,.3,1)" }}>
        <div style={{ padding: "20px 22px", borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.primary, background: "#ecedfb", padding: "3px 9px", borderRadius: 6 }}>{data.tag || "明细"}</span>
            <span onClick={onClose} style={{ marginLeft: "auto", cursor: "pointer", color: C.muted, fontSize: 20, lineHeight: 1, fontWeight: 600 }}>×</span>
          </div>
          <h2 style={{ margin: "12px 0 4px", fontSize: 19, fontWeight: 800, letterSpacing: "-.2px", color: C.ink }}>{data.title}</h2>
          <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{data.sub || ""}</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            {fields.map((f, i) => (
              <div key={i} style={{ background: C.soft, border: `1px solid ${C.divider}`, borderRadius: 10, padding: "11px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{f.k}</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums", color: C.ink }}>{f.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.faint, letterSpacing: ".5px", marginBottom: 10 }}>操作 / 审计轨迹</div>
          <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>进入对应闭环页面可查看完整操作与审计记录。</div>
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.divider}`, display: "flex", gap: 10 }}>
          <div onClick={onClose} style={{ flex: 1, textAlign: "center", padding: 11, border: "1px solid #e3e6ee", borderRadius: 10, fontSize: 13, fontWeight: 700, color: C.ink2, cursor: "pointer" }}>关闭</div>
          {data.target?.route ? (
            <div onClick={() => { go?.(data.target.route, data.target.id); onClose(); }} style={{ flex: 1, textAlign: "center", padding: 11, background: C.primaryGrad, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>去处理</div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function useClock() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 5000);
    return () => clearInterval(id);
  }, []);
}
function nowClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function updatedLabelFrom(generatedAt) {
  if (!generatedAt) return "";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
  return diff < 60 ? `${diff} 秒前更新` : `${Math.floor(diff / 60)} 分钟前更新`;
}

// ——— 个人信息面板（右侧栏，参考钉钉/飞书首页个人卡） ———
const ROLE_LABELS = { owner: "负责人", ops_manager: "运营负责人", operator_business: "次级运营", finance: "财务", streamer: "主播" };
function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "凌晨好" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

function PanelCard({ title, extra, children, pad = true }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 1px 2px rgba(20,24,40,.04)", overflow: "hidden" }}>
      {title ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: `1px solid ${C.divider}` }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.ink }}>{title}</h3>
          {extra ? <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted, fontWeight: 600 }}>{extra}</span> : null}
        </div>
      ) : null}
      <div style={{ padding: pad ? 16 : 0 }}>{children}</div>
    </div>
  );
}

function PersonalPanel({ user, scopeLabel, summary, recos, todos, go }) {
  const name = (user?.name && user.name !== "未登录用户" ? user.name : null) || "经营舱用户";
  const roleLabel = ROLE_LABELS[user?.role] || "成员";
  const org = user?.org || user?.dept || scopeLabel || "";
  const [done, setDone] = React.useState({});
  return (
    <>
      {/* 1. 问候 + 身份 */}
      <div style={{ background: C.heroGrad, borderRadius: 16, padding: 18, color: "#fff", boxShadow: "0 6px 18px rgba(70,70,130,.16)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.92 }}>{greeting()}，{name} 👋</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <span style={{ width: 46, height: 46, flex: "none", borderRadius: "50%", background: "rgba(255,255,255,.22)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 800 }}>{name[0] || "U"}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{name}</div>
            <div style={{ fontSize: 11.5, opacity: 0.82, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{roleLabel}{org ? ` · ${org}` : ""}</div>
          </div>
        </div>
      </div>

      {/* 2. 大盘总览 · 要点汇总 */}
      <PanelCard title="大盘总览" extra="要点汇总">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {summary.map((s) => (
            <div key={s.label} style={{ background: C.soft, border: `1px solid ${C.divider}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{s.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: s.color || C.ink, fontVariantNumeric: "tabular-nums" }}>{s.value}</span>
                {s.unit ? <span style={{ fontSize: 11, color: C.muted }}>{s.unit}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </PanelCard>

      {/* 3. 今日推荐 */}
      {recos.length ? (
        <PanelCard title="今日推荐" pad={false}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {recos.map((r) => (
              <button key={r.text} type="button" onClick={() => r.route && go?.(r.route)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "11px 16px", borderBottom: `1px solid ${C.divider2}`, cursor: "pointer" }}>
                <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: tone(r.tone).bg, color: tone(r.tone).color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12.5 }}>{r.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.ink }}>{r.text}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{r.sub}</span>
                </span>
                <span style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>→</span>
              </button>
            ))}
          </div>
        </PanelCard>
      ) : null}

      {/* 4. 待办事项 */}
      {todos.length ? (
        <PanelCard title="待办事项" extra={`${todos.length} 项`} pad={false}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {todos.map((t) => {
              const checked = !!done[t.key];
              return (
                <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${C.divider2}` }}>
                  <button type="button" aria-label="标记完成" onClick={() => setDone((dd) => ({ ...dd, [t.key]: !dd[t.key] }))} style={{ width: 18, height: 18, flex: "none", borderRadius: 6, border: `1.5px solid ${checked ? C.primary : "#cfd4e0"}`, background: checked ? C.primary : "#fff", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, padding: 0 }}>{checked ? "✓" : ""}</button>
                  <button type="button" onClick={() => t.route && go?.(t.route)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: checked ? C.muted : C.ink, textDecoration: checked ? "line-through" : "none" }}>{t.text}</span>
                  </button>
                  {t.count != null ? <span style={{ flex: "none", fontSize: 11, fontWeight: 800, color: tone(t.tone).color, background: tone(t.tone).bg, padding: "1px 8px", borderRadius: 20 }}>{t.count}</span> : null}
                </div>
              );
            })}
          </div>
        </PanelCard>
      ) : null}
    </>
  );
}

export function OverviewBoard({ dashboard, go, projects, tasks, reports, batches, currentUser }) {
  const [pick, setPick] = React.useState(null);
  useClock();
  const d = dashboard || {};
  const profile = d.profile || {};
  const role = String(profile.role || "owner");
  const panels = d.panels || {};
  const kpis = d.kpis || [];
  const heroKpi = kpis[0] || null;
  const riskCount = (d.risks || []).length;
  const updatedLabel = updatedLabelFrom(d.generatedAt);
  const updatedAt = d.generatedAt ? new Date(d.generatedAt).toLocaleString("zh-CN") : "";
  const isOperator = role.includes("operator");
  const isOps = role.includes("ops");

  const todoGroups = React.useMemo(() => computeTodoGroups(role, { projects, tasks, reports, batches }), [role, projects, tasks, reports, batches]);

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
      highRiskItems: bs("reopened") ? `重开 ${bs("reopened")}` : "",
      streamerGapProjects: gap ? `${gap} 项告急` : "",
      recordingsPending: recPending ? `录屏待审 ${recPending}` : "",
      pendingReports: pendReports ? `待审 ${pendReports}` : "",
      anomalyTasks: notStarted ? `未开播 ${notStarted}` : "",
      myTodayTasks: `进行中 ${live}`,
      notStartedTasks: anomalies ? `异常 ${anomalies}` : "",
      draftBatches: bs("pending_confirm") ? `待确认 ${bs("pending_confirm")}` : "",
    };
    return kpis.slice(1).map((k) => ({ ...k, hint: k.hint || HINT[k.key] || "" }));
  }, [kpis, projects, tasks, reports, batches]);

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
      stats: taskish ? [{ k: "进行中", v: String(live) }, { k: "待报数", v: String(pendingReports) }, { k: "异常", v: String(anomalies) }] : null,
      series: isOperator || isOps ? series : null,
    };
  }, [heroKpi, tasks, reports, isOperator, isOps]);

  const sparkCards = React.useMemo(() => {
    const cards = [];
    const af = panels.admissionFunnel;
    const ar = funnelRate(af);
    if (ar != null) cards.push({ label: "准入通过率", value: `${ar}%`, tone: ar >= 70 ? "ok" : "warn", series: (af.stages || []).map((s) => Number(s.value) || 0) });
    const sf = panels.settlementFunnel;
    const sr = funnelRate(sf);
    if (sr != null) cards.push({ label: "结算池转化率", value: `${sr}%`, tone: sr >= 70 ? "ok" : "warn", series: (sf.stages || []).map((s) => Number(s.value) || 0) });
    return cards;
  }, [panels.admissionFunnel, panels.settlementFunnel]);

  // 个人面板：大盘要点 / 今日推荐 / 待办，均由真实数据派生（标签与看板区块不重复）。
  const personal = React.useMemo(() => {
    const active = cnt(projects, (p) => ["active", "recruiting", "settling"].includes(p?.status));
    const pendingReports = cnt(reports, (r) => r?.status === "pending_review");
    const anomalies = cnt(tasks, isAnomaly);
    const recordingPending = (projects || []).reduce((s, p) => s + (p?.streamers?.pendingReview ?? 0), 0);
    const lowMargin = cnt(projects, (p) => Number.isFinite(margin(p)) && margin(p) < 20);
    const bs = (s) => cnt(batches, (b) => b.status === s);
    const todoTotal = todoGroups.reduce((s, g) => s + g.items.reduce((a, i) => a + (Number(i.value) || 0), 0), 0);
    const summary = [
      { label: "在营项目", value: String(active), color: C.primary },
      { label: "待办合计", value: String(todoTotal) },
      { label: "风险数", value: String(riskCount), color: riskCount ? C.danger : C.ink },
      { label: "今日场次", value: String((tasks || []).length) },
    ];
    const recos = [];
    if (recordingPending > 0) recos.push({ icon: "录", text: "优先处理录屏审核", sub: `${recordingPending} 条待审`, tone: "warn", route: "projects" });
    if (anomalies > 0) recos.push({ icon: "异", text: "跟进异常直播任务", sub: `${anomalies} 个异常`, tone: "danger", route: "tasks" });
    if (lowMargin > 0) recos.push({ icon: "复", text: "复盘低毛利项目", sub: `${lowMargin} 个`, tone: "warn", route: "warroom" });
    if (pendingReports > 0) recos.push({ icon: "审", text: "清理待审报数", sub: `${pendingReports} 条`, tone: "info", route: "reports" });
    if (!recos.length) recos.push({ icon: "看", text: "查看项目经营排行", sub: "按毛利贡献", tone: "info", route: "warroom" });
    const todos = [];
    if (pendingReports > 0) todos.push({ key: "rev", text: "审核待审报数", count: pendingReports, tone: "warn", route: "reports" });
    if (anomalies > 0) todos.push({ key: "ano", text: "处理异常直播任务", count: anomalies, tone: "danger", route: "tasks" });
    if (bs("draft") > 0) todos.push({ key: "bat", text: "生成结算批次", count: bs("draft"), tone: "neutral", route: "settle" });
    if (bs("pending_confirm") > 0) todos.push({ key: "cfm", text: "确认待确认批次", count: bs("pending_confirm"), tone: "warn", route: "settle" });
    if (!todos.length) todos.push({ key: "none", text: "暂无紧急待办，保持关注经营总览", count: null, route: "warroom" });
    return { summary, recos: recos.slice(0, 3), todos };
  }, [projects, tasks, reports, batches, todoGroups, riskCount]);

  const liveLabel = isOperator ? "任务实时刷新" : role.includes("finance") ? "结算池实时变动" : "直播执行实时盘";
  const onPick = React.useCallback((p) => setPick({ ...p, sub: p.tag, fields: fieldsFor(p) }), []);

  return (
    <div style={{ background: C.page, minHeight: "100%" }}>
      <div style={{ display: "flex", gap: 16, padding: 20, alignItems: "flex-start", boxSizing: "border-box" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
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
            {profile.scopeLabel ? <span style={{ fontSize: 11.5, fontWeight: 600, color: C.primary, background: "#ecedfb", padding: "3px 9px", borderRadius: 9 }}>{profile.scopeLabel}</span> : null}
            {updatedLabel ? <span style={{ fontSize: 11.5, color: C.muted }}>{updatedLabel}</span> : null}
          </div>
        </div>

        {/* 风险提醒条 */}
        {riskCount > 0 ? (
          <button type="button" onClick={() => go?.("warroom")} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #f4e7c8", background: "#faf3e1", borderRadius: 14, padding: "13px 18px", cursor: "pointer", textAlign: "left" }}>
            <span style={{ width: 26, height: 26, borderRadius: 999, background: "#f6e8c2", color: C.warn, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>!</span>
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.warn }}>风险提醒</span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#363b47", marginTop: 2 }}>{riskCount} 条命中风险规则的事项待人工核验处理</span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.warn }}>去处理 →</span>
          </button>
        ) : null}

        {d.emptyState ? (
          <Sec span={2}>
            <SecHead title={d.emptyState.title} mb={8} />
            <div style={{ fontSize: 13, color: C.muted }}>{d.emptyState.hint}</div>
          </Sec>
        ) : null}

        {/* 待办条 */}
        <TodoStrip groups={todoGroups} go={go} />

        {/* 经营数据卡 */}
        <BizDataCard metrics={bizMetrics} updatedAt={updatedAt} liveLabel={liveLabel} />

        {/* Hero + 趋势卡 */}
        <HeroRow hero={hero} sparkCards={sparkCards} />

        {/* 区块网格（2 列） */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16, alignItems: "start" }}>
          <FunnelPanel funnel={panels.admissionFunnel} go={go} onPick={onPick} />
          <TimelinePanel tasks={tasks} nowClock={nowClock()} onPick={onPick} />
          <QueuePanel items={d.queue} go={go} />
          {isOperator ? <TaskStreamPanel tasks={tasks} onPick={onPick} /> : null}
          <ReviewQueuePanel reports={reports} onPick={onPick} />
          <FunnelPanel funnel={panels.settlementFunnel} go={go} onPick={onPick} labelW={104} fillMin={74} rightW={54} rightKey="count" warn={{ text: "⚠ 结算池金额流转", style: { fontSize: 11.5, fontWeight: 700, color: C.warn } }} />
          <LanesPanel data={panels.batchLanes} onPick={onPick} />
          <AmountRiskPanel data={panels.amountRisks} go={go} onPick={onPick} />
          <RankingPanel data={panels.projectRanking} go={go} onPick={onPick} />
          <LowMarginPanel projects={projects} go={go} />
          <RiskFeedPanel items={d.risks} riskCount={riskCount} go={go} />
          <DrilldownPanel items={d.drilldowns} go={go} />
        </div>

        {updatedAt ? <div style={{ fontSize: 12, color: C.muted }}>数据更新时间：{updatedAt}</div> : null}
        </div>
        <aside style={{ width: 340, flex: "none", position: "sticky", top: 20, alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: 16 }}>
          <PersonalPanel user={currentUser} scopeLabel={profile.scopeLabel} summary={personal.summary} recos={personal.recos} todos={personal.todos} go={go} />
        </aside>
      </div>

      <DetailDrawer open={!!pick} data={pick} onClose={() => setPick(null)} go={go} />
    </div>
  );
}

export default OverviewBoard;
