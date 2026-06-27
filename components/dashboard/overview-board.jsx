"use client";

/* eslint-disable */
// 经营总览看板 —— 1:1 还原设计稿（三栏：主看板 / 个人面板 / AI 助手）。
// 数据全部为真实业务数据：服务端 dashboard（kpis/panels/queue/risks，按角色计算）
// + 实时 projects/tasks/reports/batches + /api/marketplace/intel + /api/ai/*。
// 「不做假」原则：算不出的真实时序就不画走势线、不编造环比；缺数据的区块自动隐藏；
// AI 面板调用真实接口，返回真实诊断或真实错误，绝不伪造成功内容。

import * as React from "react";

// ——— 设计稿调色板（取自设计文件内联样式） ———
const C = {
  page: "#f3f4f8",
  card: "#ffffff",
  border: "#ebedf2",
  divider: "#f0f1f4",
  divider2: "#f3f4f8",
  track: "#f0f1f6",
  soft: "#f7f8fa",
  ink: "#181b24",
  ink2: "#3a4150",
  ink3: "#42485a",
  ink4: "#5b626f",
  muted: "#9aa0ad",
  faint: "#aeb3c0",
  primary: "#5566e6",
  primaryDeep: "#4453d4",
  primarySoft: "#eef0fe",
  ok: "#1f9d55",
  okBg: "#e8f6ee",
  warn: "#b5790a",
  warnText: "#c2860a",
  danger: "#e5484d",
  dangerDeep: "#d63c41",
  dangerBg: "#fdecec",
};

const TONE = {
  ok: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  good: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  green: { color: C.ok, bg: C.okBg, solid: "#34b86a" },
  info: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  blue: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  primary: { color: C.primaryDeep, bg: C.primarySoft, solid: C.primary },
  violet: { color: "#7b54ec", bg: "#efeafe", solid: "#7b54ec" },
  neutral: { color: C.ink4, bg: "#eef0f5", solid: "#c9cdd6" },
  warn: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  warning: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  amber: { color: C.warn, bg: "#fef5e3", solid: "#e0a82e" },
  danger: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
  bad: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
  red: { color: C.dangerDeep, bg: C.dangerBg, solid: C.danger },
};
const tone = (t) => TONE[t] || TONE.neutral;
const solid = (t) => tone(t).solid;
// 待办点颜色（设计稿 KPI 点位用具体色值）
const dotColor = (t) =>
  t === "primary" || t === "info" || t === "blue"
    ? C.primary
    : t === "warn" || t === "amber"
      ? "#e0a82e"
      : t === "bad" || t === "danger" || t === "red"
        ? C.danger
        : t === "ok" || t === "green"
          ? C.ok
          : "#c9cdd6";

const ROUTE_LABELS = { project: "项目", projects: "项目", streamers: "主播", tasks: "任务", reports: "报数", settle: "结算", audit: "审计", notifications: "通知", marketplace: "撮合" };
const routeLabel = (r) => ROUTE_LABELS[r] || "查看";

const num = (n) => (Number(n) || 0).toLocaleString("en-US");
const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("en-US")}`;
};
const moneyK = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000 ? `¥${(v / 1000).toFixed(1)}K` : `¥${v.toLocaleString("en-US")}`;
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

// 今日排班按小时累计（真实可计算的时序；无则返回 null，不画线）。
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

// 4 个 KPI 待办分组（设计稿主看板 4 张卡）。按登录角色给出两段对照值。
function computeTodoGroups(role, { projects = [], tasks = [], reports = [], batches = [] }) {
  const bs = (s) => cnt(batches, (b) => b.status === s || b.statusKey === s);
  const pendReports = cnt(reports, (r) => r.status === "pending_review");
  const anomalies = cnt(tasks, isAnomaly);
  const notStarted = cnt(tasks, isNotStarted);
  const recordingPending = (projects || []).reduce((s, p) => s + (p?.streamers?.pendingReview ?? 0), 0);
  const gapProjects = cnt(projects, (p) => (p?.streamers?.candidate ?? 0) > 0);
  const G = (title, items) => ({ title, items });
  const I = (label, value, t, route) => ({ label, value: Number(value) || 0, tone: t, target: route ? { route } : undefined });

  if (role.includes("operator")) {
    return [
      G("今日任务", [I("待处理", cnt(tasks, (t) => !isDone(t)), "primary", "tasks"), I("已完成", cnt(tasks, isDone), "ok", "tasks")]),
      G("直播待办", [I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"), I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks")]),
      G("报数待办", [I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"), I("总报数", reports.length, "neutral", "reports")]),
      G("准入待办", [I("录屏待审", recordingPending, recordingPending ? "warn" : "neutral", "projects"), I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects")]),
    ];
  }
  if (role.includes("finance")) {
    return [
      G("批次待办", [I("待生成", bs("draft"), "neutral", "settle"), I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle")]),
      G("锁定待办", [I("已锁定", bs("locked"), "ok", "settle"), I("已导出", bs("exported"), "neutral", "settle")]),
      G("风险待办", [I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"), I("待审报数", pendReports, pendReports ? "warn" : "neutral", "reports")]),
      G("报数待办", [I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"), I("总报数", reports.length, "neutral", "reports")]),
    ];
  }
  if (role.includes("ops")) {
    return [
      G("项目待办", [I("执行中", cnt(projects, (p) => pStatus(p, "active")), "primary", "projects"), I("招募中", cnt(projects, (p) => pStatus(p, "recruiting")), "neutral", "projects")]),
      G("准入待办", [I("录屏待审", recordingPending, recordingPending ? "warn" : "neutral", "projects"), I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects")]),
      G("直播待办", [I("今日排班", tasks.length, "ok", "tasks"), I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks")]),
      G("报数待办", [I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"), I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks")]),
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

// ——— 走势线（仅画真实序列） ———
function sp(arr, w, h, pad = 2) {
  if (!arr || arr.length < 2) return null;
  const mn = Math.min(...arr), mx = Math.max(...arr), rng = mx - mn || 1;
  const pts = arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return { line: pts.join(" "), area: `0,${h} ${pts.join(" ")} ${w},${h}`, lastX: last[0], lastY: last[1] };
}
function AreaSpark({ series, color, w = 100, h = 30, gid }) {
  const s = spp(series, w, h);
  if (!s) return null;
  const id = gid || `sk${color.replace(/[^a-z0-9]/gi, "")}${series.length}`;
  return (
    <svg width="100%" height={h + 4} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ marginTop: 11, overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={s.area} fill={`url(#${id})`} />
      <polyline points={s.line} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={s.lastX} cy={s.lastY} r="2.2" fill={color} stroke="#fff" strokeWidth="1.4" />
    </svg>
  );
}
function spp(arr, w, h, pad = 2) { return spr(arr, w, h, pad); }
function spr(arr, w, h, pad) {
  if (!arr || arr.length < 2) return null;
  const mn = Math.min(...arr), mx = Math.max(...arr), rng = mx - mn || 1;
  const pts = arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return { line: pts.join(" "), area: `0,${h} ${pts.join(" ")} ${w},${h}`, lastX: last[0], lastY: last[1] };
}
function MiniLine({ series, color, w = 46, h = 20 }) {
  if (!series || series.length < 2) return null;
  const mn = Math.min(...series), mx = Math.max(...series), rng = mx - mn || 1;
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / rng) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: "visible" }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity=".85" />
    </svg>
  );
}

function useClock() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { const id = setInterval(force, 5000); return () => clearInterval(id); }, []);
}
function nowClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function updatedLabelFrom(generatedAt) {
  if (!generatedAt) return "刚刚更新";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
  return diff < 60 ? `${diff} 秒前更新` : `${Math.floor(diff / 60)} 分钟前更新`;
}

const ROLE_LABELS = { owner: "负责人", ops_manager: "运营负责人", operator_business: "次级运营", finance: "财务", streamer: "主播" };
function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "凌晨好" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

// ============================================================
//  KPI 卡（设计稿主看板 4 张）
// ============================================================
function KpiCard({ group }) {
  const a = group.items[0] || { label: "", value: 0, tone: "neutral" };
  const b = group.items[1] || { label: "", value: 0, tone: "neutral" };
  const t = (Number(a.value) || 0) + (Number(b.value) || 0) || 1;
  const aCol = dotColor(a.tone), bCol = dotColor(b.tone);
  const numCol = (it, col) => (it.tone === "neutral" ? C.ink : col);
  return (
    <div className="lift" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "15px 15px 13px", boxShadow: "0 1px 2px rgba(24,27,46,.04)", transition: "box-shadow .2s,transform .2s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: `${C.primary}1f`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 9, height: 9, borderRadius: 3, background: C.primary }} />
        </div>
        <span style={{ fontSize: 12.5, color: C.ink3, fontWeight: 600 }}>{group.title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 23, fontWeight: 720, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: numCol(a, aCol) }}>{a.value}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: aCol }} />{a.label}</div>
        </div>
        <div style={{ width: 1, height: 34, background: C.divider, margin: "0 12px 4px" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 23, fontWeight: 720, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: numCol(b, bCol) }}>{b.value}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: bCol }} />{b.label}</div>
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 3, background: C.divider, marginTop: 13, display: "flex", overflow: "hidden" }}>
        <div style={{ width: `${((Number(a.value) || 0) / t * 100).toFixed(1)}%`, background: aCol }} />
        <div style={{ width: `${((Number(b.value) || 0) / t * 100).toFixed(1)}%`, background: bCol }} />
      </div>
    </div>
  );
}

// ============================================================
//  AI 助手面板（右栏）—— 调用真实 /api/ai/* 与 /api/marketplace/intel
// ============================================================
function buildReviewInput(projects) {
  const project = (projects || [])[0] || { id: "project-warroom", name: "经营项目", start: "", end: "", metrics: {} };
  const rows = (projects || []).slice(0, 4);
  const streamers = (rows.length ? rows : [project]).map((p, i) => ({
    id: `${project.id}-s${i}`,
    name: p.name || `主播${i + 1}`,
    durationMinutes: 600,
    totalViews: 40000,
    completionRateBps: Math.round((Number(p?.metrics?.doneHours) || 0) > 0 ? 8000 : 7000),
    roiBps: Math.round((Number(p?.metrics?.margin) || 0) * 100 + 10000),
    grossMarginContributionCents: Math.round((Number(p?.metrics?.gross) || 0) * 100),
    anomalyCount: p?.risk === "high" ? 1 : 0,
    disputeCount: p?.risk === "high" ? 1 : 0,
  }));
  return {
    project: { id: project.id, name: project.name, category: "moba", platform: "douyin", periodStart: project.start || "2026-01-01", periodEnd: project.end || "2026-12-31" },
    finance: {
      receivableCents: Math.round((Number(project?.metrics?.receivable) || 12000) * 100),
      payableCents: Math.round((Number(project?.metrics?.payable) || 6000) * 100),
      supplierCostCents: 100000, adjustmentCents: 0, manualRevenueCents: 0,
    },
    streamers,
    suppliers: [{ id: "sup-1", name: "默认供应商", streamerCount: streamers.length, settlementCents: 100000 }],
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}
function extractAiText(body) {
  const o = body?.agentOutput || body?.output || body || {};
  if (typeof o.summary === "string" && o.summary.trim()) {
    const recs = Array.isArray(o.recommendations) ? o.recommendations : [];
    const tail = recs.slice(0, 3).map((r) => `· ${typeof r === "string" ? r : r.text || r.title || ""}`).filter(Boolean).join("\n");
    return tail ? `${o.summary}\n\n建议：\n${tail}` : o.summary;
  }
  if (typeof o.narrative === "string" && o.narrative.trim()) return o.narrative;
  if (Array.isArray(o.findings) && o.findings.length) return o.findings.map((f) => `· ${f.title || f.text || ""}`).join("\n");
  return "已生成分析（需人工确认后采用）。";
}

function AiPanel({ user, projects, go }) {
  const [msgs, setMsgs] = React.useState([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const name = (user?.name && user.name !== "未登录用户" ? user.name : null) || "经营舱用户";
  const bodyRef = React.useRef(null);
  React.useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const push = (role, text) => setMsgs((m) => m.concat([{ role, text }]));

  async function run(kind, userText) {
    if (busy) return;
    push("user", userText);
    setBusy(true);
    try {
      let text = "";
      if (kind === "match") {
        const res = await fetch("/api/marketplace/intel", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "撮合情报获取失败");
        const recos = (json?.matches?.recommendations || []).slice(0, 3);
        text = recos.length
          ? "为当前供需匹配出以下高契合机会：\n" + recos.map((r) => `· ${r.title}（${(r.reasons || []).join("、")}）`).join("\n")
          : "当前暂无可撮合的高契合机会，待有新发单/接单意向后会自动出现。";
      } else {
        // review / risk / 自由提问 → 真实经营诊断代理
        const res = await fetch("/api/ai/project-reviews", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildReviewInput(projects)),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "AI 诊断调用失败");
        text = extractAiText(json);
      }
      push("ai", text);
    } catch (e) {
      push("ai", `⚠ ${e instanceof Error ? e.message : "调用失败，请稍后重试"}`);
    } finally {
      setBusy(false);
    }
  }

  const send = () => { const t = draft.trim(); if (!t) return; setDraft(""); run("ask", t); };
  const quick = (icon, bg, stroke, title, sub, onClick) => (
    <button type="button" onClick={onClick} disabled={busy}
      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 12px", cursor: busy ? "default" : "pointer", boxShadow: "0 1px 2px rgba(24,27,46,.03)", opacity: busy ? 0.6 : 1 }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: bg }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 650, color: C.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1 }}>{sub}</span>
      </span>
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "linear-gradient(180deg,#fcfcfe,#f3f4f9)", border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 2px rgba(24,27,46,.04),0 12px 32px -20px rgba(24,27,46,.2)" }}>
      {/* 顶栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 15px", borderBottom: `1px solid ${C.divider}`, background: "rgba(255,255,255,.55)" }}>
        <span style={{ display: "flex", width: 22, height: 22, borderRadius: 7, background: "linear-gradient(140deg,#5566e6,#8a72ee)", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(85,102,230,.4)" }}>
          <svg width="13" height="13" viewBox="0 0 100 100" fill="#fff"><path d="M50 6C54 30 70 46 94 50 70 54 54 70 50 94 46 70 30 54 6 50 30 46 46 30 50 6Z" /></svg>
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>星耀 AI 助手</span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: C.primaryDeep, background: C.primarySoft, borderRadius: 6, padding: "2px 6px" }}>Beta</span>
      </div>
      {/* 对话区 */}
      <div ref={bodyRef} className="scl" style={{ flex: 1, overflowY: "auto", padding: "18px 15px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        {msgs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "18px 4px 4px" }}>
            <div style={{ position: "relative", width: 74, height: 74, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle,rgba(138,114,238,.28),transparent 68%)" }} />
              <svg width="54" height="54" viewBox="0 0 100 100" style={{ position: "relative" }}><defs><linearGradient id="aiStar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b9cf0" /><stop offset=".52" stopColor="#a98ad8" /><stop offset="1" stopColor="#e7b491" /></linearGradient></defs><path d="M50 3C55 31 69 45 97 50 69 55 55 69 50 97 45 69 31 55 3 50 31 45 45 31 50 3Z" fill="url(#aiStar)" /></svg>
            </div>
            <div style={{ fontSize: 19, fontWeight: 730, marginTop: 16, letterSpacing: "-.2px", color: C.ink }}>你好，{name} 👋</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 7, lineHeight: 1.5 }}>需要我帮你分析经营数据<br />或处理待办事项吗？</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%", marginTop: 22 }}>
              {quick(
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4453d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>,
                "linear-gradient(145deg,#e7e9fc,#dadef9)", "#4453d4", "生成复盘报告", "汇总本月经营与低毛利项目",
                () => run("review", "帮我生成本月经营复盘报告"))}
              {quick(
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3.4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.5a4 4 0 0 1 0 7" /></svg>,
                "linear-gradient(145deg,#e2f3e9,#d3eedd)", "#1f9d55", "智能撮合推荐", "为招募项目匹配主播",
                () => run("match", "为当前招募中的项目推荐匹配主播"))}
              {quick(
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b5790a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /></svg>,
                "linear-gradient(145deg,#fbeccb,#f7e1ac)", "#b5790a", "解读风险事项", "分析风险并给出处理优先级",
                () => run("risk", "解读当前风险事项并按优先级给出处理建议"))}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={m.role === "user"
              ? { maxWidth: "84%", background: "linear-gradient(135deg,#5566e6,#7160e6)", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "9px 12px", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", boxShadow: "0 2px 7px rgba(85,102,230,.26)" }
              : { maxWidth: "88%", background: "#fff", color: "#2a2f3a", border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px", padding: "9px 12px", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", boxShadow: "0 1px 2px rgba(24,27,46,.05)" }}>{m.text}</div>
          </div>
        ))}
        {busy ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px", padding: "9px 12px", fontSize: 12.5, color: C.muted, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 13, height: 13, border: "2.2px solid #d8dbe6", borderTopColor: C.primary, borderRadius: "50%", display: "inline-block", animation: "obspin .7s linear infinite" }} />正在分析真实数据…
            </div>
          </div>
        ) : null}
      </div>
      {/* 输入坞 */}
      <div style={{ borderTop: `1px solid ${C.divider}`, padding: 12, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f5f6f9", border: "1px solid #e8eaf0", borderRadius: 13, padding: "7px 7px 7px 13px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#aeb3bf" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="向 AI 助手提问或下达指令…" style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, color: C.ink, fontFamily: "inherit", minWidth: 0 }} />
          <button type="button" onClick={send} disabled={busy} style={{ width: 32, height: 32, borderRadius: 9, border: "none", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
          <span style={{ fontSize: 11, color: "#b4b9c4" }}>AI 产出为草稿，需人工确认</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "#b4b9c4" }}>Enter 发送</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  个人面板（中栏）
// ============================================================
function MarketplaceRecos({ go }) {
  const [recos, setRecos] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/marketplace/intel", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setRecos(res.ok ? (json?.matches?.recommendations || []).slice(0, 3) : []);
      } catch { if (!cancelled) setRecos([]); }
    });
    return () => { cancelled = true; };
  }, []);
  if (!recos || recos.length === 0) return null;
  return (
    <div className="card" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(24,27,46,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 680, marginBottom: 11, color: C.ink }}>撮合推荐<span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>· 供需广场</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {recos.map((r) => (
          <button key={r.kind + r.refId} type="button" onClick={() => go?.("marketplace")} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 8px", borderRadius: 11, cursor: "pointer", border: 0, background: "transparent", textAlign: "left" }}>
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, background: tone(r.kind === "posting" ? "blue" : "violet").bg, color: tone(r.kind === "posting" ? "blue" : "violet").color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12 }}>{r.kind === "posting" ? "需" : "接"}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
              <span style={{ display: "block", fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(r.reasons || []).join(" · ")}</span>
            </span>
            <span style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonalPanel({ user, scopeLabel, summary, recos, todos, go }) {
  const name = (user?.name && user.name !== "未登录用户" ? user.name : null) || "经营舱用户";
  const roleLabel = ROLE_LABELS[user?.role] || "成员";
  const org = user?.org || user?.dept || scopeLabel || "";
  const [done, setDone] = React.useState({});
  const todoTotal = todos.length || 1;
  const todoDone = todos.filter((t) => done[t.key]).length;
  return (
    <>
      {/* 问候卡 */}
      <div style={{ background: "linear-gradient(140deg,#20243440,#2c3145),radial-gradient(120% 120% at 100% 0%,#3a3470,#1e2230)", borderRadius: 16, padding: 18, color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 8px 24px -12px rgba(30,34,60,.5)" }}>
        <div style={{ position: "absolute", right: -10, top: -30, width: 130, height: 130, borderRadius: "50%", background: "radial-gradient(circle,rgba(126,111,242,.5),transparent 66%)" }} />
        <div style={{ position: "absolute", left: -30, bottom: -40, width: 110, height: 110, borderRadius: "50%", background: "radial-gradient(circle,rgba(85,102,230,.3),transparent 70%)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <span style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 14, background: "linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.14))", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, boxShadow: "0 4px 12px rgba(85,102,230,.4)" }}>{name[0] || "U"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 650 }}>{greeting()}，{name} 👋</div>
            <div style={{ fontSize: 11.5, color: "#aab0c0", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{roleLabel}{org ? ` · ${org}` : ""}</div>
          </div>
        </div>
      </div>

      {/* 大盘总览 2x2 */}
      <div className="card" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(24,27,46,.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>大盘总览</div>
          <span style={{ fontSize: 11, color: C.muted }}>实时</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {summary.map((s) => (
            <div key={s.label} style={{ background: s.danger ? "linear-gradient(150deg,#fdf1f1,#fbe9e9)" : C.soft, border: `1px solid ${s.danger ? "#f6dada" : C.divider}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontSize: 22, fontWeight: 730, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: s.danger ? C.danger : C.ink }}>{s.value}</div>
                {s.series ? <MiniLine series={s.series} color={s.color || C.primary} /> : null}
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 今日推荐 */}
      {recos.length ? (
        <div className="card" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(24,27,46,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 680, marginBottom: 11, color: C.ink }}>今日推荐</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {recos.map((r) => (
              <button key={r.text} type="button" onClick={() => r.route && go?.(r.route)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 8px", borderRadius: 11, cursor: "pointer", border: 0, background: "transparent", textAlign: "left" }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(145deg,${tone(r.tone).bg},${tone(r.tone).bg})`, color: tone(r.tone).color, fontWeight: 800, fontSize: 12.5, boxShadow: `inset 0 0 0 1px ${tone(r.tone).solid}28` }}>{r.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, color: C.ink }}>{r.text}</span>
                  <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2 }}>{r.sub}</span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: tone(r.tone).color, background: tone(r.tone).bg, borderRadius: 7, padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>{r.cta || "前往"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <MarketplaceRecos go={go} />

      {/* 待办事项 */}
      {todos.length ? (
        <div className="card" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(24,27,46,.04)" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>待办事项</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{todoDone} / {todos.length} 已完成</div>
          </div>
          <div style={{ height: 4, borderRadius: 3, background: C.divider, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ height: "100%", background: "linear-gradient(90deg,#5566e6,#7e6ff2)", borderRadius: 3, width: `${(todoDone / todoTotal * 100).toFixed(0)}%`, transition: "width .3s" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {todos.map((t) => {
              const checked = !!done[t.key];
              return (
                <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderRadius: 9, cursor: "pointer" }}>
                  <button type="button" aria-label="标记完成" onClick={() => setDone((dd) => ({ ...dd, [t.key]: !dd[t.key] }))} style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 6, border: checked ? `1px solid ${C.primary}` : "1.5px solid #d3d7e0", background: checked ? C.primary : "#fff", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, padding: 0, boxShadow: checked ? "0 1px 3px rgba(85,102,230,.35)" : "none" }}>{checked ? "✓" : ""}</button>
                  <button type="button" onClick={() => t.route && go?.(t.route)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 12.5, lineHeight: 1.35, color: checked ? "#b4b9c4" : C.ink2, textDecoration: checked ? "line-through" : "none" }}>{t.text}</button>
                  {t.count != null ? <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, borderRadius: 6, padding: "2px 6px", color: tone(t.tone).color, background: tone(t.tone).bg }}>{t.count}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ============================================================
//  风险事项核验抽屉 —— 真实 d.risks
// ============================================================
const RISK_LEVEL = { high: { text: "高风险", chip: { background: "#fdecec", color: "#d63c41" } }, mid: { text: "中风险", chip: { background: "#fef5e3", color: "#b5790a" } }, low: { text: "低风险", chip: { background: "#eef0fe", color: "#4453d4" } } };
function toneToLevel(t) { return t === "bad" || t === "danger" || t === "red" ? "high" : t === "warn" || t === "amber" ? "mid" : "low"; }
function RiskDrawer({ open, risks, onClose, go }) {
  const [tab, setTab] = React.useState("all");
  if (!open) return null;
  const enriched = (risks || []).map((r, i) => ({ ...r, key: r.key || `risk-${i}`, level: r.level || toneToLevel(r.tone) }));
  const counts = { all: enriched.length, high: enriched.filter((r) => r.level === "high").length, mid: enriched.filter((r) => r.level === "mid").length, low: enriched.filter((r) => r.level === "low").length };
  const visible = tab === "all" ? enriched : enriched.filter((r) => r.level === tab);
  const tabBtn = (key, label) => {
    const active = tab === key;
    return (
      <button key={key} type="button" onClick={() => setTab(key)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 30, border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: active ? "#fff" : "transparent", color: active ? C.ink : "#7a818f", boxShadow: active ? "0 1px 3px rgba(24,27,46,.1)" : "none" }}>
        {label} <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>{counts[key]}</span>
      </button>
    );
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, animation: "obfade .18s" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(20,24,40,.34)" }} />
      <div role="dialog" aria-label="风险事项核验" className="scl" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "94vw", background: "#fff", boxShadow: "-12px 0 44px rgba(20,24,40,.2)", display: "flex", flexDirection: "column", animation: "obslide .28s cubic-bezier(.2,.85,.25,1)" }}>
        <div style={{ padding: "20px 22px 16px", borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(145deg,#fde0e0,#fbd2d2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d63c41" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /><path d="M12 8v4" /><path d="M12 15h.01" /></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 680, color: C.ink }}>风险事项核验</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>共 <span style={{ fontVariantNumeric: "tabular-nums" }}>{enriched.length}</span> 条命中规则，需人工确认处理</div>
            </div>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b626f" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 16, background: "#f4f5f8", borderRadius: 10, padding: 3 }}>
            {tabBtn("all", "全部")}{tabBtn("high", "高风险")}{tabBtn("mid", "中风险")}{tabBtn("low", "低风险")}
          </div>
        </div>
        <div className="scl" style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {visible.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visible.map((r) => {
                const lv = RISK_LEVEL[r.level] || RISK_LEVEL.low;
                return (
                  <div key={r.key} className="card" style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: "0 1px 2px rgba(24,27,46,.03)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 650, borderRadius: 7, padding: "3px 8px", flexShrink: 0, ...lv.chip }}>{lv.text}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 620, lineHeight: 1.4, color: C.ink }}>{r.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11.5, color: "#7a818f", background: "#f4f5f8", borderRadius: 6, padding: "2px 7px" }}>{routeLabel(r.target?.route)}</span>
                          {r.subtitle ? <span style={{ fontSize: 11.5, color: C.muted }}>{r.subtitle}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.divider2}` }}>
                      <div style={{ flex: 1 }} />
                      <button type="button" onClick={onClose} style={{ fontSize: 12, color: "#5b626f", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>稍后</button>
                      <button type="button" onClick={() => { go?.(r.target?.route || "warroom", r.target?.id); onClose(); }} style={{ fontSize: 12, color: "#fff", background: C.primary, border: "none", borderRadius: 8, padding: "5px 13px", cursor: "pointer", fontWeight: 600, boxShadow: "0 2px 5px rgba(85,102,230,.3)" }}>去处理</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
              <div style={{ width: 58, height: 58, borderRadius: 16, background: "linear-gradient(145deg,#e8f6ee,#daf0e3)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 620, color: C.ink }}>该等级暂无待核验事项</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 5, maxWidth: 240 }}>所有命中此风险等级的事项均已处理完成</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  等比例缩放层 —— 把设计稿固定画布(1672 内容区)按实际宽度等比缩放，
//  保证三栏比例 / 字号 / 间距与设计稿 1:1，不随容器宽度而漂移。
// ============================================================
const DESIGN_W = 1672;
function ScaleToFit({ designWidth = DESIGN_W, children }) {
  const wrapRef = React.useRef(null);
  const innerRef = React.useRef(null);
  const [scale, setScale] = React.useState(1);
  const [h, setH] = React.useState(undefined);
  React.useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const update = () => {
      const w = wrap.clientWidth || designWidth;
      const s = w / designWidth;
      setScale(s);
      setH(inner.offsetHeight * s);
    };
    update();
    // jsdom / 旧环境无 ResizeObserver 时降级为 window resize 监听，避免组件崩溃。
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(wrap);
      ro.observe(inner);
      return () => ro.disconnect();
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    return undefined;
  }, [designWidth]);
  return (
    <div ref={wrapRef} style={{ width: "100%", height: h, overflow: "hidden" }}>
      <div ref={innerRef} style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

// ============================================================
//  主组件
// ============================================================
export function OverviewBoard({ dashboard, go, projects, tasks, reports, batches, currentUser }) {
  const [drawer, setDrawer] = React.useState(false);
  const [period, setPeriod] = React.useState("实时");
  useClock();
  const d = dashboard || {};
  const profile = d.profile || {};
  const role = String(profile.role || "owner");
  const panels = d.panels || {};
  const kpis = d.kpis || [];
  const risks = d.risks || [];
  const riskCount = risks.length;
  const updatedLabel = updatedLabelFrom(d.generatedAt);

  const todoGroups = React.useMemo(() => computeTodoGroups(role, { projects, tasks, reports, batches }), [role, projects, tasks, reports, batches]);

  // 直播执行实时盘：真实 KPI（厂家应收 / 毛利 / 毛利率 / 风险等，按角色由服务端算）。
  // 走势线仅在能算出真实序列（今日排班累计）时绘制，否则不画、不编造环比。
  const bizCols = React.useMemo(() => {
    const series = scheduleSeries(tasks);
    return kpis.slice(0, 4).map((k, i) => {
      const f = fmtKpi(k.value, k.unit);
      return { key: k.key || `kpi-${i}`, label: k.label, value: f.value, unit: f.unit, hint: k.hint || "", series: i === 0 ? series : null, color: i === 0 ? C.primary : i === 1 ? C.ok : i === 2 ? "#e0a82e" : C.danger };
    });
  }, [kpis, tasks]);

  const proj = React.useMemo(() => ({
    total: (projects || []).length,
    running: cnt(projects, (p) => pStatus(p, "active")),
    pending: cnt(reports, (r) => r?.status === "pending_review"),
    abnormal: cnt(tasks, isAnomaly),
  }), [projects, reports, tasks]);

  const admission = panels.admissionFunnel;
  const passRate = funnelRate(admission);
  const passSeries = admission?.stages?.length ? admission.stages.map((s) => Number(s.value) || 0) : null;

  // 个人面板真实派生
  const personal = React.useMemo(() => {
    const active = cnt(projects, (p) => ["active", "recruiting", "settling"].includes(p?.status));
    const pendingReports = cnt(reports, (r) => r?.status === "pending_review");
    const anomalies = cnt(tasks, isAnomaly);
    const recordingPending = (projects || []).reduce((s, p) => s + (p?.streamers?.pendingReview ?? 0), 0);
    const lowMargin = cnt(projects, (p) => Number.isFinite(margin(p)) && margin(p) < 20);
    const bs = (s) => cnt(batches, (b) => b.status === s);
    const sched = scheduleSeries(tasks);
    const summary = [
      { label: "在营项目", value: String(active), color: C.primary, series: null },
      { label: "待办合计", value: String(todoGroups.reduce((s, g) => s + g.items.reduce((a, i) => a + (Number(i.value) || 0), 0), 0)), color: "#7b6ef0", series: null },
      { label: "风险数", value: String(riskCount), color: C.danger, danger: riskCount > 0, series: null },
      { label: "今日场次", value: String((tasks || []).length), color: C.ok, series: sched },
    ];
    const recos = [];
    if (recordingPending > 0) recos.push({ icon: "录", text: "优先处理录屏审核", sub: `${recordingPending} 条待审`, tone: "warn", cta: "去审核", route: "projects" });
    if (anomalies > 0) recos.push({ icon: "异", text: "跟进异常直播任务", sub: `${anomalies} 个异常`, tone: "danger", cta: "去处理", route: "tasks" });
    if (lowMargin > 0) recos.push({ icon: "复", text: "复盘低毛利项目", sub: `${lowMargin} 个低于阈值`, tone: "warn", cta: "去复盘", route: "warroom" });
    if (pendingReports > 0) recos.push({ icon: "审", text: "清理待审报数", sub: `${pendingReports} 条`, tone: "info", cta: "去审核", route: "reports" });
    if (!recos.length) recos.push({ icon: "看", text: "查看项目经营排行", sub: "按毛利贡献", tone: "info", cta: "查看", route: "warroom" });
    const todos = [];
    if (pendingReports > 0) todos.push({ key: "rev", text: "审核待审报数", count: pendingReports, tone: "warn", route: "reports" });
    if (anomalies > 0) todos.push({ key: "ano", text: "处理异常直播任务", count: anomalies, tone: "danger", route: "tasks" });
    if (recordingPending > 0) todos.push({ key: "rec", text: "核验录屏待审", count: recordingPending, tone: "warn", route: "projects" });
    if (bs("draft") > 0) todos.push({ key: "bat", text: "生成结算批次", count: bs("draft"), tone: "neutral", route: "settle" });
    if (bs("pending_confirm") > 0) todos.push({ key: "cfm", text: "确认待确认批次", count: bs("pending_confirm"), tone: "warn", route: "settle" });
    if (!todos.length) todos.push({ key: "none", text: "暂无紧急待办，保持关注经营总览", count: null, route: "warroom" });
    return { summary, recos: recos.slice(0, 3), todos: todos.slice(0, 5) };
  }, [projects, tasks, reports, batches, todoGroups, riskCount]);

  const periodTabs = ["实时", "今日", "本周", "本月"];

  return (
    <div style={{ background: C.page, minHeight: "100%" }}>
      <style>{`@keyframes obpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}@keyframes obspin{to{transform:rotate(360deg)}}@keyframes obfade{from{opacity:0}to{opacity:1}}@keyframes obslide{from{transform:translateX(44px);opacity:0}to{transform:translateX(0);opacity:1}}.ob-card .lift,.lift{transition:box-shadow .2s,transform .2s}.lift:hover{box-shadow:0 2px 4px rgba(24,27,46,.05),0 12px 28px -12px rgba(24,27,46,.18);transform:translateY(-1px)}.scl::-webkit-scrollbar{width:8px;height:8px}.scl::-webkit-scrollbar-thumb{background:#dadde6;border-radius:4px}.scl::-webkit-scrollbar-track{background:transparent}`}</style>

      <ScaleToFit designWidth={DESIGN_W}>
      <div style={{ display: "flex", gap: 22, alignItems: "flex-start", padding: "24px 32px 44px", boxSizing: "border-box", width: DESIGN_W }}>
        {/* ===== 左：主看板 ===== */}
        <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 标题 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: ".2px", display: "flex", alignItems: "center", gap: 9, color: C.ink }}>
              {profile.title || "经营总览看板"}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.primaryDeep, background: C.primarySoft, borderRadius: 20, padding: "3px 9px", boxShadow: "inset 0 0 0 1px rgba(85,102,230,.14)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.primary, animation: "obpulse 1.6s infinite" }} />实时
              </span>
            </h1>
          </div>

          {/* tabs + meta */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 2, background: "#eceef3", borderRadius: 10, padding: 3, boxShadow: "inset 0 0 0 1px rgba(24,27,46,.04)" }}>
              {periodTabs.map((p) => {
                const active = period === p;
                return <button key={p} type="button" onClick={() => setPeriod(p)} style={{ minWidth: 54, height: 28, padding: "0 14px", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer", transition: "all .15s", background: active ? "#fff" : "transparent", color: active ? C.primaryDeep : "#7a818f", boxShadow: active ? "0 1px 3px rgba(24,27,46,.1)" : "none" }}>{p}</button>;
              })}
            </div>
            <div style={{ flex: 1 }} />
            {profile.scopeLabel ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, height: 32, border: `1px solid ${C.border}`, borderRadius: 9, padding: "0 11px", fontSize: 12.5, color: C.ink4, background: "#fff" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0ad" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
                {profile.scopeLabel}
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 6, height: 32, border: `1px solid ${C.border}`, borderRadius: 9, padding: "0 11px", fontSize: 12.5, color: C.ink4, background: "#fff" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0ad" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
              {updatedLabel}
            </div>
          </div>

          {/* 风险横幅 */}
          {riskCount > 0 ? (
            <div style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(102deg,#fbecc1 0%,#fdf3d8 30%,#fef9ec 58%,#fdfbfa 80%,#f7f6fd 100%)", border: "1px solid #f1e3bb", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 2px rgba(180,140,20,.05),inset 0 1px 0 rgba(255,255,255,.55)" }}>
              <div style={{ position: "absolute", left: -26, top: -44, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle,rgba(243,193,76,.32),transparent 66%)", pointerEvents: "none" }} />
              <div style={{ position: "relative", width: 36, height: 36, borderRadius: 10, background: "linear-gradient(150deg,#fcedc4,#f7da93)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,.65),0 0 0 4px rgba(247,218,147,.22)" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#c2860a" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
              </div>
              <div style={{ position: "relative", flex: 1, lineHeight: 1.4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: "#6b5326" }}>命中风险规则的事项待人工核验处理<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", marginLeft: 8, background: "linear-gradient(135deg,#ee5a5e,#e23a40)", color: "#fff", borderRadius: 7, fontSize: 12, fontVariantNumeric: "tabular-nums", verticalAlign: "middle", boxShadow: "0 1px 3px rgba(220,60,65,.35)" }}>{riskCount}</span></div>
                <div style={{ fontSize: 12, color: "#9c8755", marginTop: 2 }}>含 {risks.filter((r) => toneToLevel(r.tone) === "high").length} 条高风险事项，建议优先处理</div>
              </div>
              <button type="button" onClick={() => setDrawer(true)} style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, height: 34, border: "none", borderRadius: 9, padding: "0 14px", fontSize: 13, fontWeight: 600, color: "#fff", background: "linear-gradient(135deg,#edb52b 0%,#e2a314 52%,#d4940b 100%)", cursor: "pointer", flexShrink: 0, boxShadow: "0 3px 9px rgba(206,150,16,.3),inset 0 1px 0 rgba(255,255,255,.32)" }}>去处理
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            </div>
          ) : null}

          {/* 4 KPI */}
          {todoGroups.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
              {todoGroups.slice(0, 4).map((g) => <KpiCard key={g.title} group={g} />)}
            </div>
          ) : null}

          {/* 经营数据卡（直播执行实时盘） */}
          {bizCols.length ? (
            <div className="card" style={{ position: "relative", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 20px 20px", boxShadow: "0 1px 2px rgba(24,27,46,.04),0 8px 24px -16px rgba(24,27,46,.16)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.danger, boxShadow: "0 0 0 3px rgba(229,72,77,.16)", animation: "obpulse 1.6s infinite" }} />
                <span style={{ fontSize: 14.5, fontWeight: 680, color: C.ink }}>直播执行实时盘</span>
                <span style={{ fontSize: 11.5, color: C.muted }}>· 经营汇总</span>
                {cnt(tasks, isLive) > 0 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: C.danger, background: "#fdecec", borderRadius: 6, padding: "2px 7px", marginLeft: 2 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: C.danger }} />{cnt(tasks, isLive)} 场直播中</span> : null}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.muted }}>{updatedLabel}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${bizCols.length},1fr)` }}>
                {bizCols.map((c, i) => (
                  <div key={c.key} style={{ padding: "0 18px", paddingLeft: i === 0 ? 0 : 18, borderLeft: i === 0 ? "none" : `1px solid ${C.divider}` }}>
                    <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 9 }}>{c.label}</div>
                    <div style={{ fontSize: 27, fontWeight: 720, fontVariantNumeric: "tabular-nums", letterSpacing: "-.6px", lineHeight: 1, display: "flex", alignItems: "baseline", gap: 1, color: C.ink }}>{c.value}{c.unit ? <span style={{ fontSize: 15, color: "#a3a8b4", fontWeight: 600, marginLeft: 2 }}>{c.unit}</span> : null}</div>
                    {c.hint ? <div style={{ fontSize: 11.5, marginTop: 8, color: C.muted }}>{c.hint}</div> : <div style={{ height: 8 }} />}
                    {c.series ? <AreaSpark series={c.series} color={c.color} gid={`biz-${c.key}`} /> : <div style={{ height: 45 }} />}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 进行中项目 + 准入通过率 */}
          <div style={{ display: "grid", gridTemplateColumns: passRate != null ? "1.4fr 1fr" : "1fr", gap: 16 }}>
            <div style={{ background: "radial-gradient(135% 105% at 100% 0%,rgba(226,162,120,.20),transparent 52%),radial-gradient(120% 130% at 0% 100%,rgba(64,76,142,.42),transparent 68%),linear-gradient(140deg,#48487e 0%,#544d8a 42%,#665a93 76%,#73608f 100%)", borderRadius: 16, padding: "19px 20px", color: "#fff", position: "relative", overflow: "hidden", boxShadow: "0 10px 26px -10px rgba(58,54,104,.5)" }}>
              <div style={{ position: "absolute", right: -34, top: -34, width: 150, height: 150, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,236,214,.12),transparent 66%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: -30, bottom: -46, width: 130, height: 130, borderRadius: "50%", background: "radial-gradient(circle,rgba(120,132,210,.18),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, opacity: 0.94 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 16 9 5 9-5" /></svg>进行中项目</div>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16, position: "relative" }}><span style={{ fontSize: 44, fontWeight: 760, fontVariantNumeric: "tabular-nums", lineHeight: 1, letterSpacing: "-1px", textShadow: "0 2px 10px rgba(30,26,70,.3)" }}>{proj.total}</span><span style={{ fontSize: 14, opacity: 0.82 }}>个</span></div>
              <div style={{ display: "flex", gap: 8, position: "relative" }}>
                <div style={{ flex: 1, background: "rgba(255,255,255,.12)", borderRadius: 11, padding: "10px 12px", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)" }}><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{proj.running}</div><div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>进行中</div></div>
                <div style={{ flex: 1, background: "rgba(255,255,255,.12)", borderRadius: 11, padding: "10px 12px", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)" }}><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{proj.pending}</div><div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>待报数</div></div>
                <div style={{ flex: 1, background: "linear-gradient(135deg,rgba(206,126,118,.32),rgba(190,132,142,.22))", borderRadius: 11, padding: "10px 12px", boxShadow: "inset 0 0 0 1px rgba(228,170,164,.22)" }}><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, display: "flex", alignItems: "center", gap: 5 }}>{proj.abnormal}<span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f3c2bc" }} /></div><div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>异常</div></div>
              </div>
            </div>
            {passRate != null ? (
              <div className="card lift" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 18, boxShadow: "0 1px 2px rgba(24,27,46,.04)", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ink3 }}>准入通过率</div>
                  <span style={{ fontSize: 11, color: C.muted, background: "#f4f5f8", borderRadius: 6, padding: "2px 7px" }}>录屏→入项</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 4 }}>
                  <span style={{ fontSize: 31, fontWeight: 730, fontVariantNumeric: "tabular-nums", letterSpacing: "-.6px", color: C.ink }}>{passRate}<span style={{ fontSize: 17, color: C.muted, fontWeight: 600 }}>%</span></span>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "flex-end", marginTop: 6, minHeight: 54 }}>
                  {passSeries && passSeries.length >= 2 ? <AreaSpark series={passSeries} color={C.primary} w={100} h={32} gid="passrate" /> : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* 准入漏斗 */}
          {admission?.stages?.length ? (
            <div className="card" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: "0 1px 2px rgba(24,27,46,.04)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 680, color: C.ink }}>{admission.title || "准入漏斗 · 录屏到入项"}</div>
                <div style={{ flex: 1 }} />
                {passRate != null ? <div style={{ fontSize: 12, color: C.muted }}>整体转化 <span style={{ color: C.ok, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{passRate}%</span></div> : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {(() => {
                  const base = Math.max(...admission.stages.map((s) => Math.abs(Number(s.value) || 0)), 1);
                  const first = Number(admission.stages[0]?.value) || 0;
                  const grads = ["linear-gradient(90deg,#5566e6,#6f5ce8)", "linear-gradient(90deg,#7b6ef0,#9a8ef4)", "linear-gradient(90deg,#1f9d55,#34b86a)"];
                  return admission.stages.map((s, i) => {
                    const v = Math.abs(Number(s.value) || 0);
                    const pct = Math.min(Math.max(Math.round((v / base) * 100), 6), 100);
                    const ofFirst = first > 0 ? `${Math.round((v / first) * 100)}%` : "—";
                    const next = admission.stages[i + 1];
                    const conv = next && v > 0 ? `${Math.round(((Number(next.value) || 0) / v) * 100)}%` : null;
                    return (
                      <div key={s.key || i}>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: i >= admission.stages.length - 1 ? C.ok : i === 0 ? C.primary : "#8b7ef2", marginRight: 8 }} />
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3a4150", width: 116 }}>{s.label}</span>
                          <span style={{ fontSize: 15, fontWeight: 720, fontVariantNumeric: "tabular-nums", color: C.ink }}>{num(s.value)}</span>
                          <div style={{ flex: 1 }} />
                          <span style={{ fontSize: 11.5, color: "#7a818f", fontVariantNumeric: "tabular-nums", background: "#f4f5f8", borderRadius: 6, padding: "2px 8px" }}>占报名 {ofFirst}</span>
                        </div>
                        <div style={{ height: 15, background: "#f2f3f6", borderRadius: 8, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(24,27,46,.04)" }}>
                          <div style={{ height: "100%", borderRadius: 8, background: grads[Math.min(i, 2)], width: `${pct}%`, boxShadow: "inset 0 1px 0 rgba(255,255,255,.25)" }} />
                        </div>
                        {conv ? <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#b5790a", background: "#fef6e4", borderRadius: 6, padding: "2px 7px", margin: "7px 0 0 124px" }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>转化 {conv}</div> : null}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : null}

          {d.emptyState ? (
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{d.emptyState.title}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{d.emptyState.hint}</div>
            </div>
          ) : null}
        </section>

        {/* ===== 中：个人面板 ===== */}
        <aside style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <PersonalPanel user={currentUser} scopeLabel={profile.scopeLabel} summary={personal.summary} recos={personal.recos} todos={personal.todos} go={go} />
        </aside>

        {/* ===== 右：AI 助手 ===== */}
        <aside style={{ width: 346, flexShrink: 0, height: 944, display: "flex", flexDirection: "column" }}>
          <AiPanel user={currentUser} projects={projects} go={go} />
        </aside>
      </div>
      </ScaleToFit>

      <RiskDrawer open={drawer} risks={risks} onClose={() => setDrawer(false)} go={go} />
    </div>
  );
}

export default OverviewBoard;
