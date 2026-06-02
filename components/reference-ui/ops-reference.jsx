"use client";
/* eslint-disable */
import React from "react";

// ===== src\ui.jsx =====
// ——— Reusable UI atoms ——————————————————————————————————————

// Status badge — color via tone prop
function Badge({
  tone = "neutral",
  children,
  dot = false,
  soft = true,
  style,
}) {
  const tones = {
    neutral: ["#EEF2F7", "#475569", "#94A3B8"],
    blue: ["#EEF3FF", "#1842A6", "#3B6BE6"],
    green: ["#E6F6EE", "#0E8A4D", "#22B86C"],
    amber: ["#FFF3DC", "#A86A00", "#E5A33A"],
    red: ["#FDECEC", "#C0303A", "#E66670"],
    violet: ["#EFEBFF", "#5B4BD1", "#8C7DEB"],
    teal: ["#DEF3F0", "#0E7C77", "#3CB1AB"],
    ink: ["#E2E8F0", "#1E2A47", "#475569"],
  };
  const [bg, fg, dotC] = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        background: soft ? bg : "transparent",
        color: fg,
        fontSize: 12,
        lineHeight: "18px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        border: soft ? "none" : `1px solid ${dotC}`,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{ width: 6, height: 6, borderRadius: 999, background: dotC }}
        />
      )}
      {children}
    </span>
  );
}

// Solid Status pill with vertical line accent — for table status columns
function StatusPill({ tone = "neutral", children }) {
  const tones = {
    neutral: ["#64748B"],
    blue: ["#1E50C8"],
    green: ["#0E8A4D"],
    amber: ["#C58A1A"],
    red: ["#C0303A"],
    violet: ["#5B4BD1"],
    teal: ["#0E7C77"],
  };
  const [c] = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-700)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: c,
          boxShadow: `0 0 0 3px ${c}22`,
        }}
      />
      {children}
    </span>
  );
}

function Button({
  kind = "default",
  size = "md",
  children,
  icon,
  onClick,
  disabled,
  style,
  type = "button",
}) {
  const sizes = {
    sm: { h: 26, px: 10, fs: 12, gap: 4 },
    md: { h: 32, px: 12, fs: 13, gap: 6 },
    lg: { h: 38, px: 16, fs: 14, gap: 8 },
  };
  const s = sizes[size];
  const kinds = {
    primary: {
      bg: "var(--blue-600)",
      color: "#fff",
      border: "1px solid var(--blue-600)",
      hover: "var(--blue-700)",
    },
    default: {
      bg: "#fff",
      color: "var(--ink-700)",
      border: "1px solid var(--line-strong)",
      hover: "#F4F6FB",
    },
    ghost: {
      bg: "transparent",
      color: "var(--ink-500)",
      border: "1px solid transparent",
      hover: "#EEF2F7",
    },
    danger: {
      bg: "#fff",
      color: "var(--danger-600)",
      border: "1px solid #F3C4C9",
      hover: "#FDECEC",
    },
    link: {
      bg: "transparent",
      color: "var(--blue-600)",
      border: "none",
      hover: "transparent",
    },
  };
  const k = kinds[kind];
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: s.h,
        padding: `0 ${s.px}px`,
        fontSize: s.fs,
        background: hover && !disabled ? k.hover : k.bg,
        color: k.color,
        border: k.border,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        fontWeight: 500,
        opacity: disabled ? 0.55 : 1,
        transition: "background 100ms ease",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// Card — base container
function Card({ children, title, extra, padded = true, style, bodyStyle }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {(title || extra) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink-900)",
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </div>
          {extra}
        </div>
      )}
      <div style={{ padding: padded ? 16 : 0, flex: 1, ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

// Sectional header inside a page (between cards)
function SectionTitle({ children, hint, extra }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        margin: "4px 0 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-900)" }}>
          {children}
        </div>
        {hint && (
          <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{hint}</div>
        )}
      </div>
      {extra}
    </div>
  );
}

// Key-value row used in detail panes
function KV({ label, children, w = 96 }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "6px 0",
        fontSize: 13,
      }}
    >
      <div style={{ width: w, color: "var(--ink-400)", flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ color: "var(--ink-700)", flex: 1 }}>{children}</div>
    </div>
  );
}

// Avatar — initials disc
function Avatar({ name, size = 28, tone }) {
  const palette = [
    "#1E50C8",
    "#5B4BD1",
    "#0E7C77",
    "#A86A00",
    "#C0303A",
    "#0E8A4D",
  ];
  const code = (name || "?").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = tone || palette[code % palette.length];
  const initials = (name || "?").slice(0, 1);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: `${bg}18`,
        color: bg,
        fontSize: size * 0.42,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

// Tabular: header + body. Pass columns + rows as React-friendly arrays.
function DataTable({
  columns,
  rows,
  dense = false,
  onRowClick,
  activeRowId,
  emptyText = "暂无数据",
}) {
  return (
    <div style={{ width: "100%", overflow: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
          fontSize: 13,
          color: "var(--ink-700)",
        }}
      >
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: "var(--bg-soft)",
                  textAlign: c.align || "left",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "var(--ink-400)",
                  padding: dense ? "8px 12px" : "10px 14px",
                  borderBottom: "1px solid var(--line)",
                  width: c.width,
                  whiteSpace: "nowrap",
                }}
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: 48,
                  textAlign: "center",
                  color: "var(--ink-400)",
                }}
              >
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr
              key={r.id ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{
                background:
                  activeRowId === r.id ? "var(--blue-50)" : "transparent",
                cursor: onRowClick ? "pointer" : "default",
              }}
              onMouseEnter={(e) => {
                if (onRowClick && activeRowId !== r.id)
                  e.currentTarget.style.background = "#F7F9FD";
              }}
              onMouseLeave={(e) => {
                if (onRowClick && activeRowId !== r.id)
                  e.currentTarget.style.background = "transparent";
              }}
            >
              {columns.map((c, j) => (
                <td
                  key={j}
                  style={{
                    padding: dense ? "8px 12px" : "12px 14px",
                    textAlign: c.align || "left",
                    borderBottom: "1px solid var(--line)",
                    verticalAlign: c.valign || "middle",
                    whiteSpace: c.wrap ? "normal" : "nowrap",
                    color: c.muted ? "var(--ink-400)" : "var(--ink-700)",
                  }}
                >
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Metric block — large number with label + delta
function Metric({
  label,
  value,
  unit,
  delta,
  deltaTone = "green",
  hint,
  accent,
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-400)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {accent}
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          className="num"
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "var(--ink-900)",
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: 12,
              color: "var(--ink-400)",
              whiteSpace: "nowrap",
            }}
          >
            {unit}
          </span>
        )}
      </div>
      {(delta || hint) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            rowGap: 2,
          }}
        >
          {delta && (
            <span
              className="num"
              style={{
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: "nowrap",
                color:
                  deltaTone === "green"
                    ? "var(--ok-600)"
                    : deltaTone === "red"
                      ? "var(--danger-600)"
                      : "var(--ink-400)",
              }}
            >
              {delta}
            </span>
          )}
          {hint && (
            <span
              style={{
                fontSize: 12,
                color: "var(--ink-400)",
                whiteSpace: "nowrap",
              }}
            >
              {hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Search input
function SearchInput({ placeholder = "搜索…", value, onChange, width = 280 }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 10px",
        width,
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        background: "#fff",
      }}
    >
      <Icon.Search size={14} stroke="var(--ink-400)" />
      <input
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 13,
          color: "var(--ink-700)",
        }}
      />
    </div>
  );
}

// Tab control — pill underline style
function Tabs({ items, value, onChange, size = "md" }) {
  const fs = size === "lg" ? 14 : 13;
  return (
    <div
      style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)" }}
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            onClick={() => onChange?.(it.key)}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "none",
              borderBottom: active
                ? "2px solid var(--blue-600)"
                : "2px solid transparent",
              marginBottom: -1,
              cursor: "pointer",
              color: active ? "var(--blue-700)" : "var(--ink-500)",
              fontWeight: active ? 600 : 500,
              fontSize: fs,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {it.label}
            {it.count != null && (
              <span
                style={{
                  background: active ? "var(--blue-50)" : "var(--ink-50)",
                  color: active ? "var(--blue-700)" : "var(--ink-400)",
                  borderRadius: 999,
                  padding: "0 6px",
                  fontSize: 11,
                  fontWeight: 500,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Mini bar — used inline (e.g. scoring or distribution)
function MiniBar({ value, max = 100, tone = "blue", width = 80 }) {
  const tones = {
    blue: "var(--blue-600)",
    green: "var(--ok-600)",
    amber: "#C58A1A",
    red: "var(--danger-600)",
  };
  return (
    <div
      style={{
        width,
        height: 6,
        background: "var(--ink-50)",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          height: "100%",
          background: tones[tone] || tones.blue,
        }}
      />
    </div>
  );
}

// Risk dot — single colored circle
function RiskDot({ level }) {
  const map = {
    low: ["var(--ok-600)", "低"],
    medium: ["#C58A1A", "中"],
    high: ["var(--danger-600)", "高"],
    none: ["var(--ink-200)", "无"],
  };
  const [c, t] = map[level] || map.none;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: c }} />
      {t}
    </span>
  );
}
// ===== src\data.jsx =====
// ——— Mock data ——————————————————————————————————————————————

const ORG = { id: "org_01", name: "星河直播" };

const ROLES = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};

const CURRENT_USER = {
  id: "u_01",
  name: "陈一鸣",
  role: "owner",
  org: ORG.id,
  dept: "总经办",
};

// Projects ———————————————————————————————————
const PROJECTS = [
  {
    id: "P-2406",
    name: "原神 · 4.7 版本品宣专项",
    code: "GS-0407",
    vendor: "米哈游",
    product: "原神 4.7",
    agent: "智星互动",
    supplier: "云途直播 / 自有",
    status: "active",
    leadOps: "李珩",
    bizOwner: "周筱筱",
    start: "2026-04-22",
    end: "2026-06-30",
    pricing: "CPT + CPS",
    needScreening: true,
    needStartStop: true,
    streamers: { active: 14, candidate: 6, pendingReview: 4 },
    metrics: {
      plannedHours: 720,
      doneHours: 412.5,
      audience: 1284600,
      reportedPending: 7,
      anomalies: 2,
      receivable: 286400,
      payable: 196800,
      gross: 89600,
      margin: 31.3,
    },
    risk: "medium",
  },
  {
    id: "P-2412",
    name: "元梦之星 · 6 月赛事直播",
    code: "YM-0612",
    vendor: "腾讯游戏",
    product: "元梦之星",
    agent: "—",
    supplier: "飞鸟传媒",
    status: "recruiting",
    leadOps: "李珩",
    bizOwner: "吴桐",
    start: "2026-06-08",
    end: "2026-07-10",
    pricing: "CPT + 礼物提成",
    needScreening: true,
    needStartStop: false,
    streamers: { active: 0, candidate: 12, pendingReview: 9 },
    metrics: {
      plannedHours: 480,
      doneHours: 0,
      audience: 0,
      reportedPending: 0,
      anomalies: 0,
      receivable: 0,
      payable: 0,
      gross: 0,
      margin: 0,
    },
    risk: "low",
  },
  {
    id: "P-2405",
    name: "王者荣耀 · KPL 春赛二级解说",
    code: "WZ-S26",
    vendor: "腾讯游戏",
    product: "王者荣耀",
    agent: "智星互动",
    supplier: "自有",
    status: "settling",
    leadOps: "苏婉",
    bizOwner: "何琳",
    start: "2026-03-01",
    end: "2026-05-15",
    pricing: "CPT 底薪",
    needScreening: false,
    needStartStop: true,
    streamers: { active: 8, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 1240,
      doneHours: 1276,
      audience: 3120400,
      reportedPending: 0,
      anomalies: 0,
      receivable: 480000,
      payable: 312600,
      gross: 167400,
      margin: 34.9,
    },
    risk: "low",
  },
  {
    id: "P-2403",
    name: "崩坏：星穹铁道 · 角色定向种草",
    code: "HSR-0226",
    vendor: "米哈游",
    product: "崩坏：星穹铁道",
    agent: "智星互动",
    supplier: "云途直播",
    status: "paused",
    leadOps: "苏婉",
    bizOwner: "周筱筱",
    start: "2026-02-26",
    end: "2026-05-30",
    pricing: "CPA",
    needScreening: true,
    needStartStop: true,
    streamers: { active: 6, candidate: 2, pendingReview: 1 },
    metrics: {
      plannedHours: 360,
      doneHours: 198,
      audience: 562000,
      reportedPending: 3,
      anomalies: 4,
      receivable: 84000,
      payable: 67200,
      gross: 16800,
      margin: 20.0,
    },
    risk: "high",
  },
  {
    id: "P-2398",
    name: "永劫无间 · 5 周年限时",
    code: "NRK-05Y",
    vendor: "网易雷火",
    product: "永劫无间",
    agent: "—",
    supplier: "自有 / 飞鸟传媒",
    status: "ended",
    leadOps: "李珩",
    bizOwner: "何琳",
    start: "2026-01-15",
    end: "2026-02-28",
    pricing: "CPS",
    needScreening: true,
    needStartStop: true,
    streamers: { active: 10, candidate: 0, pendingReview: 0 },
    metrics: {
      plannedHours: 540,
      doneHours: 528,
      audience: 1820000,
      reportedPending: 0,
      anomalies: 0,
      receivable: 264000,
      payable: 168000,
      gross: 96000,
      margin: 36.4,
    },
    risk: "low",
  },
];

const PROJECT_STATUS = {
  draft: { tone: "neutral", label: "草稿" },
  recruiting: { tone: "blue", label: "招募中" },
  pending_start: { tone: "violet", label: "待开始" },
  active: { tone: "green", label: "进行中" },
  paused: { tone: "amber", label: "已暂停" },
  ended: { tone: "ink", label: "已结束" },
  settling: { tone: "teal", label: "结算中" },
  archived: { tone: "neutral", label: "已归档" },
};

// Streamers ———————————————————————————————————
const STREAMERS = [
  {
    id: "S-001",
    alias: "冷江",
    real: "江泽宇",
    gender: "男",
    source: "自孵化",
    supplier: "自有",
    games: ["原神", "崩坏：星穹铁道"],
    platforms: ["B站", "抖音"],
    style: "剧情解说",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 92,
      projectFinish: 95,
      roi: 1.42,
      grossContrib: 28400,
    },
    matchScore: 92,
    defaultRule: "CPT 60/h",
    completedProjects: 11,
  },
  {
    id: "S-002",
    alias: "小Mei",
    real: "梅子涵",
    gender: "女",
    source: "签约",
    supplier: "自有",
    games: ["王者荣耀", "元梦之星"],
    platforms: ["抖音"],
    style: "高能竞技",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 88,
      projectFinish: 92,
      roi: 1.36,
      grossContrib: 31200,
    },
    matchScore: 89,
    defaultRule: "CPT 75/h + 礼物 30%",
    completedProjects: 8,
  },
  {
    id: "S-003",
    alias: "阿七",
    real: "齐景明",
    gender: "男",
    source: "供应商推荐",
    supplier: "云途直播",
    games: ["原神", "永劫无间", "王者荣耀"],
    platforms: ["抖音", "快手"],
    style: "陪玩 / 情感",
    cooperation: "active",
    risk: "medium",
    metrics: {
      screenPass: 78,
      projectFinish: 80,
      roi: 1.18,
      grossContrib: 18600,
    },
    matchScore: 76,
    defaultRule: "CPT 50/h",
    completedProjects: 6,
  },
  {
    id: "S-004",
    alias: "NIKO",
    real: "倪可",
    gender: "女",
    source: "签约",
    supplier: "自有",
    games: ["元梦之星", "永劫无间"],
    platforms: ["B站", "虎牙"],
    style: "欢快互动",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 95,
      projectFinish: 98,
      roi: 1.55,
      grossContrib: 42100,
    },
    matchScore: 96,
    defaultRule: "底薪 6000 + CPT",
    completedProjects: 14,
  },
  {
    id: "S-005",
    alias: "咕咕",
    real: "顾远",
    gender: "男",
    source: "外部合作",
    supplier: "飞鸟传媒",
    games: ["崩坏：星穹铁道"],
    platforms: ["B站"],
    style: "攻略向",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 84,
      projectFinish: 88,
      roi: 1.24,
      grossContrib: 21000,
    },
    matchScore: 81,
    defaultRule: "CPA 12/单",
    completedProjects: 5,
  },
  {
    id: "S-006",
    alias: "青羽",
    real: "林青羽",
    gender: "女",
    source: "签约",
    supplier: "自有",
    games: ["原神", "元梦之星", "王者荣耀"],
    platforms: ["抖音", "B站"],
    style: "声控 / 美图",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 90,
      projectFinish: 93,
      roi: 1.48,
      grossContrib: 36500,
    },
    matchScore: 93,
    defaultRule: "CPT 80/h + 礼物 35%",
    completedProjects: 10,
  },
  {
    id: "S-007",
    alias: "雷酱",
    real: "雷夕",
    gender: "女",
    source: "供应商推荐",
    supplier: "云途直播",
    games: ["王者荣耀"],
    platforms: ["抖音"],
    style: "高能竞技",
    cooperation: "paused",
    risk: "medium",
    metrics: {
      screenPass: 70,
      projectFinish: 72,
      roi: 0.96,
      grossContrib: 5200,
    },
    matchScore: 64,
    defaultRule: "CPT 45/h",
    completedProjects: 3,
  },
  {
    id: "S-008",
    alias: "糖豆",
    real: "陶蓁",
    gender: "女",
    source: "外部合作",
    supplier: "飞鸟传媒",
    games: ["崩坏：星穹铁道", "原神"],
    platforms: ["B站"],
    style: "剧情解说",
    cooperation: "active",
    risk: "low",
    metrics: {
      screenPass: 86,
      projectFinish: 90,
      roi: 1.28,
      grossContrib: 24300,
    },
    matchScore: 84,
    defaultRule: "CPS 22%",
    completedProjects: 7,
  },
];

// Reports ———————————————————————————————————
const REPORTS = [
  {
    id: "R-08831",
    date: "2026-05-26",
    streamer: "NIKO",
    streamerId: "S-004",
    project: "P-2406",
    taskId: "T-1024",
    duration: 4.2,
    audience: 11200,
    status: "pending_review",
    screens: 1,
    source: "OCR",
    note: "凌晨开播，互动峰值在前一小时",
  },
  {
    id: "R-08830",
    date: "2026-05-26",
    streamer: "冷江",
    streamerId: "S-001",
    project: "P-2406",
    taskId: "T-1023",
    duration: 3.5,
    audience: 9420,
    status: "pending_review",
    screens: 1,
    source: "OCR",
    note: "",
  },
  {
    id: "R-08829",
    date: "2026-05-26",
    streamer: "青羽",
    streamerId: "S-006",
    project: "P-2406",
    taskId: "T-1022",
    duration: 4.0,
    audience: 8600,
    status: "need_supply",
    screens: 1,
    source: "manual",
    note: "截图缺时长字段，已退回主播",
  },
  {
    id: "R-08828",
    date: "2026-05-26",
    streamer: "阿七",
    streamerId: "S-003",
    project: "P-2403",
    taskId: "T-1018",
    duration: 2.1,
    audience: 4200,
    status: "pending_review",
    screens: 2,
    source: "OCR",
    note: "同一任务多条截图，需要选择计入项",
  },
  {
    id: "R-08827",
    date: "2026-05-25",
    streamer: "小Mei",
    streamerId: "S-002",
    project: "P-2406",
    taskId: "T-1019",
    duration: 4.5,
    audience: 13800,
    status: "approved",
    screens: 1,
    source: "OCR",
    note: "已通过",
  },
  {
    id: "R-08826",
    date: "2026-05-25",
    streamer: "糖豆",
    streamerId: "S-008",
    project: "P-2403",
    taskId: "T-1015",
    duration: 3.0,
    audience: 5600,
    status: "rejected",
    screens: 1,
    source: "OCR",
    note: "截图疑似重复，已驳回",
  },
  {
    id: "R-08825",
    date: "2026-05-25",
    streamer: "咕咕",
    streamerId: "S-005",
    project: "P-2403",
    taskId: "T-1014",
    duration: 3.8,
    audience: 6800,
    status: "pending_review",
    screens: 1,
    source: "OCR",
    note: "",
  },
];

const REPORT_STATUS = {
  pending_streamer: { tone: "neutral", label: "待主播确认" },
  pending_review: { tone: "blue", label: "待审核" },
  need_supply: { tone: "amber", label: "需补充" },
  approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
};

const OpsLiveDataContext = React.createContext({
  tasks: null,
  reports: null,
  batches: null,
  batchDetails: null,
  settlementScope: null,
  actions: {},
});

function useOpsTasks() {
  const { tasks } = React.useContext(OpsLiveDataContext);
  return Array.isArray(tasks) ? tasks : TASKS;
}

function useOpsReports() {
  const { reports } = React.useContext(OpsLiveDataContext);
  return Array.isArray(reports) ? reports : REPORTS;
}

function useOpsSettlementBatches() {
  const { batches } = React.useContext(OpsLiveDataContext);
  return Array.isArray(batches) && batches.length > 0 ? batches : BATCHES;
}

function useOpsSettlementBatchDetails() {
  const { batchDetails } = React.useContext(OpsLiveDataContext);
  return batchDetails && typeof batchDetails === "object" ? batchDetails : {};
}

function useOpsSettlementScope() {
  const { settlementScope } = React.useContext(OpsLiveDataContext);
  return settlementScope || null;
}

function useOpsLiveActions() {
  const { actions } = React.useContext(OpsLiveDataContext);
  return actions || {};
}

// Settlement batches ———————————————————————————————————
const BATCHES = [
  {
    id: "B-2026-05-V-001",
    type: "vendor_receivable",
    name: "米哈游 · 5月 应收 (原神 4.7)",
    project: "P-2406",
    vendor: "米哈游",
    period: "2026-05-01 → 2026-05-31",
    items: 14,
    amount: 286400,
    status: "pending_confirm",
    updated: "2026-05-26 14:02",
    creator: "李珩",
  },
  {
    id: "B-2026-05-S-001",
    type: "streamer_payable",
    name: "原神 4.7 · 主播应付 (5月上)",
    project: "P-2406",
    vendor: "—",
    period: "2026-05-01 → 2026-05-15",
    items: 12,
    amount: 92400,
    status: "locked",
    updated: "2026-05-20 17:14",
    creator: "李珩",
  },
  {
    id: "B-2026-04-S-002",
    type: "streamer_payable",
    name: "王者荣耀 KPL · 主播应付 (4月)",
    project: "P-2405",
    vendor: "—",
    period: "2026-04-01 → 2026-04-30",
    items: 8,
    amount: 156400,
    status: "locked",
    updated: "2026-05-08 10:30",
    creator: "苏婉",
  },
  {
    id: "B-2026-04-V-003",
    type: "vendor_receivable",
    name: "腾讯游戏 · 4月应收 (KPL)",
    project: "P-2405",
    vendor: "腾讯游戏",
    period: "2026-04-01 → 2026-04-30",
    items: 8,
    amount: 240000,
    status: "confirmed",
    updated: "2026-05-06 16:48",
    creator: "苏婉",
  },
  {
    id: "B-2026-04-S-001",
    type: "streamer_payable",
    name: "崩铁种草 · 主播应付 (4月)",
    project: "P-2403",
    vendor: "—",
    period: "2026-04-01 → 2026-04-30",
    items: 6,
    amount: 38600,
    status: "draft",
    updated: "2026-05-04 19:22",
    creator: "李珩",
  },
];

const BATCH_STATUS = {
  draft: { tone: "neutral", label: "草稿" },
  generated: { tone: "blue", label: "已生成" },
  pending_confirm: { tone: "amber", label: "待确认" },
  confirmed: { tone: "green", label: "已确认" },
  locked: { tone: "teal", label: "已锁定" },
  reopened: { tone: "violet", label: "已重开" },
};

const BATCH_DETAIL_ITEMS = [
  // 主播应付 - B-2026-05-S-001
  {
    streamer: "NIKO",
    id: "S-004",
    rule: "底薪 6000 + CPT 80/h",
    hours: 38.5,
    qty: "—",
    base: 6000,
    variable: 3080,
    adjust: 0,
    total: 9080,
  },
  {
    streamer: "青羽",
    id: "S-006",
    rule: "CPT 80/h + 礼物 35%",
    hours: 34.0,
    qty: "礼物 3.2k",
    base: 0,
    variable: 3840,
    adjust: 200,
    total: 4040,
  },
  {
    streamer: "冷江",
    id: "S-001",
    rule: "CPT 60/h",
    hours: 32.5,
    qty: "—",
    base: 0,
    variable: 1950,
    adjust: 0,
    total: 1950,
  },
  {
    streamer: "小Mei",
    id: "S-002",
    rule: "CPT 75/h + 礼物 30%",
    hours: 30.0,
    qty: "礼物 4.1k",
    base: 0,
    variable: 3480,
    adjust: 0,
    total: 3480,
  },
  {
    streamer: "阿七",
    id: "S-003",
    rule: "CPT 50/h",
    hours: 24.5,
    qty: "—",
    base: 0,
    variable: 1225,
    adjust: -100,
    total: 1125,
  },
  {
    streamer: "糖豆",
    id: "S-008",
    rule: "CPS 22%",
    hours: 22.0,
    qty: "CPS 28.4k",
    base: 0,
    variable: 6248,
    adjust: 0,
    total: 6248,
  },
];

// Recommended streamers (war room)
const RECOS_FOR_P2412 = [
  {
    id: "S-004",
    alias: "NIKO",
    score: 96,
    reasons: ["同品类完成率 98%", "近期 ROI 1.55"],
    risks: [],
  },
  {
    id: "S-002",
    alias: "小Mei",
    score: 91,
    reasons: ["竞技品类多项达标", "礼物提成转化好"],
    risks: [],
  },
  {
    id: "S-006",
    alias: "青羽",
    score: 88,
    reasons: ["元梦之星历史 ROI 1.42"],
    risks: ["档期已部分占用"],
  },
  {
    id: "S-007",
    alias: "雷酱",
    score: 62,
    reasons: ["品类匹配"],
    risks: ["上周报数 2 次逾期", "审核驳回率 14%"],
  },
];

// Supplier scores (war room)
const SUPPLIER_SCORES = [
  {
    id: "V-1",
    name: "云途直播",
    score: 84,
    streamers: 18,
    finishRate: 92,
    anomalyRate: 6,
    grossContrib: 184000,
    trend: "+4",
  },
  {
    id: "V-2",
    name: "飞鸟传媒",
    score: 79,
    streamers: 12,
    finishRate: 88,
    anomalyRate: 9,
    grossContrib: 124200,
    trend: "+1",
  },
  {
    id: "V-3",
    name: "自有",
    score: 91,
    streamers: 22,
    finishRate: 96,
    anomalyRate: 3,
    grossContrib: 296000,
    trend: "+2",
  },
  {
    id: "V-4",
    name: "智星互动",
    score: 67,
    streamers: 9,
    finishRate: 80,
    anomalyRate: 14,
    grossContrib: 42600,
    trend: "-3",
  },
];

const ANOMALIES = [
  {
    id: "A1",
    type: "未停止 / 未报数",
    streamer: "阿七",
    project: "P-2403",
    detail: "直播中已超 51h 未上传截图",
    level: "high",
    time: "2 小时前",
  },
  {
    id: "A2",
    type: "报数逾期",
    streamer: "咕咕",
    project: "P-2403",
    detail: "5/24 任务超过上传期限 12h",
    level: "medium",
    time: "今晨 03:12",
  },
  {
    id: "A3",
    type: "审核驳回",
    streamer: "糖豆",
    project: "P-2403",
    detail: "截图疑似重复，已退回",
    level: "medium",
    time: "昨日 22:40",
  },
  {
    id: "A4",
    type: "时长不足",
    streamer: "青羽",
    project: "P-2406",
    detail: "5/25 计划 4h 实际 3.1h",
    level: "low",
    time: "昨日 19:08",
  },
];

const AUDIT_LOG_RECENT = [
  {
    who: "李珩 · 运营负责人",
    action: "锁定结算批次",
    target: "B-2026-05-S-001",
    risk: true,
    time: "2 分钟前",
  },
  {
    who: "苏婉 · 次级运营",
    action: "审核通过报数",
    target: "R-08827",
    risk: false,
    time: "17 分钟前",
  },
  {
    who: "陈一鸣 · 负责人",
    action: "修改结算规则",
    target: "S-006 · P-2406",
    risk: true,
    time: "1 小时前",
  },
];

// ——— Tasks / Schedule —————————————————————————————

// Week range: 2026-05-25 (Mon) ~ 2026-05-31 (Sun). "today" = 2026-05-27 Wed.
const SCHEDULE_WEEK = {
  start: "2026-05-25",
  end: "2026-05-31",
  todayIdx: 2, // Wed
  days: [
    { label: "周一", date: "05-25" },
    { label: "周二", date: "05-26" },
    { label: "周三", date: "05-27", today: true },
    { label: "周四", date: "05-28" },
    { label: "周五", date: "05-29" },
    { label: "周六", date: "05-30" },
    { label: "周日", date: "05-31" },
  ],
};

// Tasks: each row = one streamer, with tasks placed by day.
// startHour / endHour are 0-24. status: 'completed' | 'live' | 'pending_report' | 'pending_review' | 'pending_live' | 'abnormal' | 'cancelled'
// project: project id
// type: 'project' | 'trial' | 'training' | 'temp'
const TASKS = [
  // 冷江 S-001
  {
    id: "T-1019",
    streamerId: "S-001",
    dayIdx: 0,
    startHour: 20,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 新角色专场",
    type: "project",
    status: "completed",
  },
  {
    id: "T-1023",
    streamerId: "S-001",
    dayIdx: 1,
    startHour: 20,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 剧情向解说",
    type: "project",
    status: "pending_review",
  },
  {
    id: "T-1031",
    streamerId: "S-001",
    dayIdx: 2,
    startHour: 20,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 周中场",
    type: "project",
    status: "live",
  },
  {
    id: "T-1043",
    streamerId: "S-001",
    dayIdx: 4,
    startHour: 19,
    endHour: 23,
    project: "P-2406",
    name: "原神 4.7 · 周五黄金档",
    type: "project",
    status: "pending_live",
  },
  {
    id: "T-1051",
    streamerId: "S-001",
    dayIdx: 5,
    startHour: 14,
    endHour: 18,
    project: "P-2406",
    name: "原神 4.7 · 周末特别场",
    type: "project",
    status: "pending_live",
  },

  // 小Mei S-002
  {
    id: "T-1020",
    streamerId: "S-002",
    dayIdx: 0,
    startHour: 19,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · KOL 联动",
    type: "project",
    status: "completed",
  },
  {
    id: "T-1024",
    streamerId: "S-002",
    dayIdx: 1,
    startHour: 19,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 高能 PVP",
    type: "project",
    status: "pending_review",
  },
  {
    id: "T-1032",
    streamerId: "S-002",
    dayIdx: 3,
    startHour: 20,
    endHour: 23,
    project: "P-2406",
    name: "元梦试播 · 试播",
    type: "trial",
  },
  {
    id: "T-1044",
    streamerId: "S-002",
    dayIdx: 5,
    startHour: 20,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 周末场",
    type: "project",
    status: "pending_live",
  },

  // 阿七 S-003
  {
    id: "T-1018",
    streamerId: "S-003",
    dayIdx: 0,
    startHour: 21,
    endHour: 23.5,
    project: "P-2403",
    name: "崩铁种草 · 角色解说",
    type: "project",
    status: "pending_review",
  },
  {
    id: "T-1029",
    streamerId: "S-003",
    dayIdx: 1,
    startHour: 20,
    endHour: 22.5,
    project: "P-2403",
    name: "崩铁种草 · 速通向",
    type: "project",
    status: "abnormal",
  },
  {
    id: "T-1037",
    streamerId: "S-003",
    dayIdx: 2,
    startHour: 20,
    endHour: 23,
    project: "P-2403",
    name: "崩铁种草 · 中段拉新",
    type: "project",
    status: "live",
    anomaly: "unstopped",
  },

  // NIKO S-004
  {
    id: "T-1022",
    streamerId: "S-004",
    dayIdx: 0,
    startHour: 19.5,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 沉浸玩法",
    type: "project",
    status: "completed",
  },
  {
    id: "T-1028",
    streamerId: "S-004",
    dayIdx: 1,
    startHour: 19.5,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 周二常规",
    type: "project",
    status: "pending_report",
  },
  {
    id: "T-1034",
    streamerId: "S-004",
    dayIdx: 2,
    startHour: 19,
    endHour: 23.5,
    project: "P-2406",
    name: "原神 4.7 · 周三常规",
    type: "project",
    status: "pending_live",
  },
  {
    id: "T-1041",
    streamerId: "S-004",
    dayIdx: 3,
    startHour: 19,
    endHour: 23,
    project: "P-2412",
    name: "元梦之星 · 候选试播",
    type: "trial",
  },
  {
    id: "T-1048",
    streamerId: "S-004",
    dayIdx: 5,
    startHour: 19,
    endHour: 24,
    project: "P-2406",
    name: "原神 4.7 · 黄金档",
    type: "project",
    status: "pending_live",
  },

  // 咕咕 S-005
  {
    id: "T-1014",
    streamerId: "S-005",
    dayIdx: 0,
    startHour: 21,
    endHour: 24,
    project: "P-2403",
    name: "崩铁种草 · 攻略向",
    type: "project",
    status: "pending_review",
  },
  {
    id: "T-1030",
    streamerId: "S-005",
    dayIdx: 1,
    startHour: 14,
    endHour: 17,
    project: "P-2403",
    name: "崩铁种草 · 日间场",
    type: "project",
    status: "abnormal",
    anomaly: "late_report",
  },
  {
    id: "T-1038",
    streamerId: "S-005",
    dayIdx: 2,
    startHour: 20,
    endHour: 23,
    project: "P-2403",
    name: "崩铁种草 · 周中",
    type: "project",
    status: "pending_live",
  },

  // 青羽 S-006
  {
    id: "T-1021",
    streamerId: "S-006",
    dayIdx: 0,
    startHour: 20,
    endHour: 24,
    project: "P-2406",
    name: "原神 4.7 · 声控向",
    type: "project",
    status: "completed",
  },
  {
    id: "T-1027",
    streamerId: "S-006",
    dayIdx: 1,
    startHour: 19,
    endHour: 22,
    project: "P-2406",
    name: "原神 4.7 · 短场",
    type: "project",
    status: "abnormal",
    anomaly: "short",
  },
  {
    id: "T-1033",
    streamerId: "S-006",
    dayIdx: 2,
    startHour: 20,
    endHour: 23,
    project: "P-2406",
    name: "原神 4.7 · 周中场",
    type: "project",
    status: "pending_live",
  },
  {
    id: "T-1045",
    streamerId: "S-006",
    dayIdx: 4,
    startHour: 20,
    endHour: 24,
    project: "P-2406",
    name: "原神 4.7 · 周五黄金",
    type: "project",
    status: "pending_live",
  },

  // 糖豆 S-008
  {
    id: "T-1015",
    streamerId: "S-008",
    dayIdx: 0,
    startHour: 19,
    endHour: 22,
    project: "P-2403",
    name: "崩铁种草 · 剧情解读",
    type: "project",
    status: "pending_review",
  },
  {
    id: "T-1036",
    streamerId: "S-008",
    dayIdx: 2,
    startHour: 19,
    endHour: 22,
    project: "P-2403",
    name: "崩铁种草 · 周中",
    type: "project",
    status: "pending_live",
  },
  {
    id: "T-1049",
    streamerId: "S-008",
    dayIdx: 5,
    startHour: 14,
    endHour: 17,
    project: "P-2403",
    name: "崩铁种草 · 日间",
    type: "project",
    status: "pending_live",
  },
];

const TASK_STATUS = {
  pending_live: { tone: "neutral", label: "待开播" },
  live: { tone: "blue", label: "直播中", pulse: true },
  pending_report: { tone: "violet", label: "待报数" },
  pending_review: { tone: "amber", label: "报数待审" },
  approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
  completed: { tone: "green", label: "已完成" },
  cancelled: { tone: "neutral", label: "已取消" },
  abnormal: { tone: "red", label: "异常" },
};

const ANOMALY_TYPES = {
  unstopped: { tone: "red", label: "未停止 / 未报数" },
  late_report: { tone: "amber", label: "报数逾期" },
  unstart: { tone: "amber", label: "未开播" },
  short: { tone: "amber", label: "时长不足" },
  rejected: { tone: "red", label: "审核驳回未重提" },
  conflict: { tone: "red", label: "时间冲突" },
};
// ===== src\icons.jsx =====
// Inline stroke-icons — 16/18/20 sizing. All paths from scratch (simple geometry).
const ic = (props, paths) => {
  const {
    size = 16,
    stroke = "currentColor",
    sw = 1.6,
    fill = "none",
    ...rest
  } = props || {};
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );
};

const Icon = {
  Dashboard: (p) =>
    ic(
      p,
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>,
    ),
  Project: (p) =>
    ic(
      p,
      <>
        <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </>,
    ),
  Streamer: (p) =>
    ic(
      p,
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c1.2-3.5 4.2-5.5 7.5-5.5s6.3 2 7.5 5.5" />
      </>,
    ),
  Audit: (p) =>
    ic(
      p,
      <>
        <path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11.5A1.5 1.5 0 0 1 4.5 20V5a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M14.5 3.5v4.5H19" />
        <path d="M8 12.5h8M8 16h6" />
      </>,
    ),
  Tasks: (p) =>
    ic(
      p,
      <>
        <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
        <path d="M3.5 9h17" />
        <path d="M8 4.5v3M16 4.5v3" />
        <path d="M7.5 13.5l2 2 4-4" />
      </>,
    ),
  Reports: (p) =>
    ic(
      p,
      <>
        <path d="M4 19V5a1.5 1.5 0 0 1 1.5-1.5H15l5 5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" />
        <path d="M14.5 3.5v5H20" />
        <path d="M8 12h6M8 16h8" />
      </>,
    ),
  Money: (p) =>
    ic(
      p,
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <circle cx="12" cy="12.5" r="2.5" />
        <path d="M6 9.5V9M18 16v.5" />
      </>,
    ),
  Export: (p) =>
    ic(
      p,
      <>
        <path d="M12 4v11" />
        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
        <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
      </>,
    ),
  Bell: (p) =>
    ic(
      p,
      <>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>,
    ),
  Search: (p) =>
    ic(
      p,
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-3.5-3.5" />
      </>,
    ),
  ChevDown: (p) => ic(p, <path d="m6 9 6 6 6-6" />),
  ChevRight: (p) => ic(p, <path d="m9 6 6 6-6 6" />),
  ChevLeft: (p) => ic(p, <path d="m15 6-6 6 6 6" />),
  Plus: (p) =>
    ic(
      p,
      <>
        <path d="M12 5v14M5 12h14" />
      </>,
    ),
  More: (p) =>
    ic(
      p,
      <>
        <circle cx="6" cy="12" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="18" cy="12" r="1.2" />
      </>,
    ),
  Filter: (p) => ic(p, <path d="M4 5h16l-6 8v6l-4-2v-4z" />),
  Settings: (p) =>
    ic(
      p,
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 14.5 21 15.2l-1 2-1.7-.4a7.5 7.5 0 0 1-1.5.9l-.3 1.8h-2.4l-.3-1.8a7.5 7.5 0 0 1-1.5-.9l-1.7.4-1-2 1.6-.7a7.5 7.5 0 0 1 0-1.8L4.6 12 5.6 10l1.7.4a7.5 7.5 0 0 1 1.5-.9l.3-1.8h2.4l.3 1.8a7.5 7.5 0 0 1 1.5.9l1.7-.4 1 2-1.6.7a7.5 7.5 0 0 1 0 1.8z" />
      </>,
    ),
  Sparkles: (p) =>
    ic(
      p,
      <>
        <path d="m12 4 1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
        <path d="m19 16 .8 1.7L21.5 18l-1.7.3L19 20l-.3-1.7L17 18l1.7-.3z" />
      </>,
    ),
  Calendar: (p) =>
    ic(
      p,
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" />
      </>,
    ),
  Check: (p) => ic(p, <path d="m5 12 4.5 4.5L19 7" />),
  X: (p) => ic(p, <path d="m6 6 12 12M18 6 6 18" />),
  Eye: (p) =>
    ic(
      p,
      <>
        <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>,
    ),
  Play: (p) => ic(p, <path d="M7 5.5v13l11-6.5z" />),
  Pause: (p) =>
    ic(
      p,
      <>
        <rect x="7" y="5" width="3.5" height="14" rx="1" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
      </>,
    ),
  Upload: (p) =>
    ic(
      p,
      <>
        <path d="M12 16V5" />
        <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
        <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
      </>,
    ),
  Warn: (p) =>
    ic(
      p,
      <>
        <path d="M12 3.5 21 19H3z" />
        <path d="M12 10v4M12 17v.01" />
      </>,
    ),
  Lock: (p) =>
    ic(
      p,
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>,
    ),
  Unlock: (p) =>
    ic(
      p,
      <>
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path d="M8 11V8a4 4 0 0 1 7.7-1.4" />
      </>,
    ),
  Trend: (p) =>
    ic(
      p,
      <>
        <path d="M4 16.5 9 11l3.5 3.5L20 6.5" />
        <path d="M15 6.5h5v5" />
      </>,
    ),
  Game: (p) =>
    ic(
      p,
      <>
        <rect x="2.5" y="7" width="19" height="10" rx="4" />
        <path d="M7 11v2M5.5 12h3M14 12h.01M16.5 13.5h.01M16.5 10.5h.01M18 12h.01" />
      </>,
    ),
  Logo: (p) =>
    ic(
      { ...p, sw: 0, fill: "currentColor" },
      <>
        <path
          d="M4 6.5c0-1.2.9-2 2-2h8c4.5 0 7.5 3 7.5 7.5S18.5 19.5 14 19.5H6c-1.2 0-2-.8-2-2z"
          opacity=".18"
        />
        <path d="M8 9.5h4a3 3 0 1 1 0 6H8z" />
      </>,
    ),
  History: (p) =>
    ic(
      p,
      <>
        <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
        <path d="M3.5 4v4h4" />
        <path d="M12 8v4l3 2" />
      </>,
    ),
  Pencil: (p) =>
    ic(
      p,
      <>
        <path d="m4 20 1-4L16 5l3 3L8 19z" />
        <path d="m13 8 3 3" />
      </>,
    ),
};

// ===== src\chrome.jsx =====
// ——— App chrome: sidebar + topbar + page header ———

const NAV = [
  { key: "warroom", label: "智能作战台", icon: "Sparkles", accent: true },
  { divider: true },
  { key: "projects", label: "项目管理", icon: "Project" },
  { key: "streamers", label: "主播资源池", icon: "Streamer" },
  { key: "tasks", label: "排班与任务", icon: "Tasks", count: 3 },
  { key: "reports", label: "报数审核", icon: "Reports", count: 7 },
  { key: "settle", label: "结算中心", icon: "Money" },
  { divider: true },
  { key: "export", label: "数据导出", icon: "Export" },
  { key: "audit", label: "操作日志", icon: "Audit" },
  { key: "org", label: "组织与权限", icon: "Settings" },
];

function Sidebar({ route, onNav }) {
  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "linear-gradient(135deg, #1E50C8 0%, #3B6BE6 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "-0.04em",
            boxShadow: "0 2px 6px rgba(30,80,200,0.35)",
          }}
        >
          JY
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "var(--ink-900)",
              letterSpacing: "-0.005em",
            }}
          >
            经营舱
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--ink-400)",
              letterSpacing: "0.04em",
            }}
          >
            MCN OPERATIONS · v1.2
          </span>
        </div>
      </div>

      {/* Org switcher */}
      <button
        style={{
          margin: "12px 12px 8px",
          padding: "8px 10px",
          background: "var(--bg-soft)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 11,
          }}
        >
          星
        </span>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-900)",
              lineHeight: 1.1,
            }}
          >
            星河直播
          </div>
          <div
            style={{ fontSize: 10.5, color: "var(--ink-400)", lineHeight: 1.2 }}
          >
            当前组织 · 32 名成员
          </div>
        </div>
        <Icon.ChevDown size={14} stroke="var(--ink-400)" />
      </button>

      {/* Nav */}
      <nav style={{ padding: "4px 8px", flex: 1, overflowY: "auto" }}>
        {NAV.map((it, i) => {
          if (it.divider) {
            return (
              <div
                key={"d" + i}
                style={{
                  height: 1,
                  margin: "10px 12px",
                  background: "var(--line)",
                }}
              />
            );
          }
          const active = it.key === route;
          const IconComp = Icon[it.icon];
          return (
            <button
              key={it.key}
              onClick={() => onNav(it.key)}
              style={{
                width: "100%",
                padding: "0 10px",
                height: 34,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: active ? "var(--blue-50)" : "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                color: active ? "var(--blue-700)" : "var(--ink-500)",
                fontWeight: active ? 600 : 500,
                fontSize: 13,
                position: "relative",
                marginBottom: 2,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "var(--ink-50)";
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent";
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: -8,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: 999,
                    background: "var(--blue-600)",
                  }}
                />
              )}
              <IconComp
                size={16}
                stroke={active ? "var(--blue-700)" : "var(--ink-400)"}
              />
              <span style={{ flex: 1, textAlign: "left" }}>{it.label}</span>
              {it.count != null && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "0 6px",
                    height: 16,
                    background: active ? "var(--blue-600)" : "#E1E7F0",
                    color: active ? "#fff" : "var(--ink-500)",
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    minWidth: 16,
                  }}
                >
                  {it.count}
                </span>
              )}
              {it.accent && !active && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "0 5px",
                    height: 16,
                    lineHeight: "16px",
                    background: "linear-gradient(135deg, #EFEBFF, #DCE6FF)",
                    color: "var(--violet-600)",
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  AI
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Avatar name={CURRENT_USER.name} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {CURRENT_USER.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
            {ROLES[CURRENT_USER.role]} · {CURRENT_USER.dept}
          </div>
        </div>
        <button
          style={{
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            borderRadius: 6,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-400)",
          }}
        >
          <Icon.Settings size={16} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ breadcrumbs = [], extra }) {
  return (
    <div
      style={{
        height: 56,
        flexShrink: 0,
        background: "#fff",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Breadcrumbs */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
      >
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Icon.ChevRight size={12} stroke="var(--ink-300)" />}
            <span
              style={{
                color:
                  i === breadcrumbs.length - 1
                    ? "var(--ink-900)"
                    : "var(--ink-400)",
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 500,
              }}
            >
              {b}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Global search */}
      <div style={{ marginRight: 12 }}>
        <SearchInput placeholder="搜索项目 / 主播 / 任务编号…" width={280} />
      </div>

      {/* Notification bell */}
      <button
        style={{
          position: "relative",
          width: 34,
          height: 34,
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          marginRight: 8,
          color: "var(--ink-500)",
        }}
      >
        <Icon.Bell size={16} />
        <span
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            minWidth: 14,
            height: 14,
            borderRadius: 999,
            background: "var(--danger-600)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
            border: "1.5px solid #fff",
          }}
        >
          5
        </span>
      </button>

      {extra}
    </div>
  );
}

// Generic page header (under top bar) — title + subtitle + actions
function PageHeader({ title, subtitle, status, actions }) {
  return (
    <div
      style={{
        padding: "20px 24px 16px",
        background: "#fff",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
                color: "var(--ink-900)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h1>
            {status}
          </div>
          {subtitle && (
            <div
              style={{ marginTop: 4, fontSize: 13, color: "var(--ink-400)" }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
      </div>
    </div>
  );
}

// ===== src\screen-warroom.jsx =====
// ——— Screen: 智能项目作战台 ————————————————————————————

function ScreenWarRoom({ go }) {
  const [tab, setTab] = React.useState("overview");

  return (
    <>
      <PageHeader
        title="智能项目作战台"
        subtitle="覆盖立项前 → 招募中 → 执行中 → 结算中 → 结项复盘的项目经营决策面板"
        status={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "linear-gradient(135deg, #EFEBFF, #DCE6FF)",
              color: "var(--violet-600)",
            }}
          >
            <Icon.Sparkles size={12} stroke="var(--violet-600)" /> AI 增强 ·
            基础版
          </span>
        }
        actions={
          <>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              导出当日简报
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              立项 / 报价测算
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top metrics strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 16,
          }}
        >
          <Card style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: "var(--blue-600)",
              }}
            />
            <Metric
              label="进行中项目"
              value="4"
              unit="个"
              delta="本周 +1"
              hint="3 个达标、1 个高风险"
            />
          </Card>
          <Card>
            <Metric
              label="本周直播时长"
              value="386.5"
              unit="h"
              delta="+18.4%"
              hint="较上周"
            />
          </Card>
          <Card>
            <Metric
              label="本周厂家应收"
              value="¥126,400"
              delta="+¥21,200"
              hint="较上周"
            />
          </Card>
          <Card>
            <Metric
              label="预估毛利率"
              value="32.6"
              unit="%"
              delta="-1.4 pt"
              deltaTone="red"
              hint="较上月"
            />
          </Card>
          <Card>
            <Metric
              label="待处理事项"
              value="11"
              unit="项"
              delta=""
              hint="审核 7 · 异常 4"
              accent={
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--danger-600)",
                  }}
                />
              }
            />
          </Card>
        </div>

        {/* Tabs */}
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "执行总览" },
                { key: "matching", label: "主播匹配引擎", count: 4 },
                { key: "supplier", label: "供应商质量" },
                { key: "pricing", label: "报价 & 测算" },
              ]}
            />
          </div>

          <div style={{ padding: 20 }}>
            {tab === "overview" && <Overview go={go} />}
            {tab === "matching" && <Matching />}
            {tab === "supplier" && <Supplier />}
            {tab === "pricing" && <Pricing />}
          </div>
        </Card>
      </div>
    </>
  );
}

// ——— Overview tab ————————————————————————
function Overview({ go }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
      {/* Left: active projects + AI insights */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <SectionTitle hint="按风险与履约进度排序">活跃项目</SectionTitle>
          <Card padded={false}>
            <DataTable
              columns={[
                {
                  title: "项目",
                  width: 240,
                  render: (r) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 6,
                          background: "var(--blue-50)",
                          color: "var(--blue-700)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon.Game size={16} stroke="var(--blue-700)" />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "var(--ink-900)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 200,
                          }}
                        >
                          {r.name}
                        </div>
                        <div
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                          className="mono"
                        >
                          {r.id} · {r.vendor}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => (
                    <Badge tone={PROJECT_STATUS[r.status].tone} dot>
                      {PROJECT_STATUS[r.status].label}
                    </Badge>
                  ),
                },
                {
                  title: "履约进度",
                  render: (r) => {
                    const pct = r.metrics.plannedHours
                      ? Math.round(
                          (r.metrics.doneHours / r.metrics.plannedHours) * 100,
                        )
                      : 0;
                    return (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MiniBar
                          value={pct}
                          tone={
                            pct >= 90 ? "green" : pct >= 50 ? "blue" : "amber"
                          }
                          width={64}
                        />
                        <span
                          className="num"
                          style={{
                            fontSize: 12,
                            color: "var(--ink-500)",
                            minWidth: 30,
                          }}
                        >
                          {pct}%
                        </span>
                      </div>
                    );
                  },
                },
                {
                  title: "主播",
                  align: "right",
                  render: (r) => (
                    <span className="num">{r.streamers.active}</span>
                  ),
                },
                {
                  title: "应收 / 应付",
                  align: "right",
                  render: (r) => (
                    <div>
                      <div
                        className="num"
                        style={{ fontSize: 13, color: "var(--ink-900)" }}
                      >
                        ¥{(r.metrics.receivable / 1000).toFixed(1)}k
                      </div>
                      <div
                        className="num"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        -¥{(r.metrics.payable / 1000).toFixed(1)}k
                      </div>
                    </div>
                  ),
                },
                { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
              ]}
              rows={PROJECTS.filter((p) =>
                ["active", "settling", "paused", "recruiting"].includes(
                  p.status,
                ),
              )}
              onRowClick={() => go("project")}
            />
          </Card>
        </div>

        {/* AI advisor card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #F8F6FF 0%, #EEF3FF 100%)",
            borderColor: "#D8D0FA",
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #5B4BD1, #1E50C8)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Sparkles size={18} stroke="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-900)",
                  }}
                >
                  AI 经营简报
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  基于近 14 天数据
                </span>
              </div>
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {[
                  [
                    "原神 4.7 项目",
                    "本周转化下滑 8.2%。建议把高 CPS 转化的 NIKO、青羽 排进周末黄金档。",
                  ],
                  [
                    "崩铁种草",
                    "近 4 个任务出现「报数逾期 / 截图重复」异常，建议复核「阿七」、「糖豆」资格。",
                  ],
                  [
                    "元梦之星 6 月赛事",
                    "候选主播匹配度均值 84，已超过启动阈值；建议本周内完成厂家二审。",
                  ],
                ].map(([k, v], i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 13,
                      color: "var(--ink-700)",
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 999,
                        background: "var(--violet-600)",
                        marginTop: 8,
                        flexShrink: 0,
                      }}
                    />
                    <span>
                      <b style={{ color: "var(--violet-600)" }}>{k}：</b>
                      {v}
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button size="sm" kind="default">
                  查看完整复盘
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  icon={<Icon.History size={13} />}
                >
                  历史简报
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Right: anomalies + audit feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <SectionTitle
            extra={
              <Button size="sm" kind="link">
                查看全部 →
              </Button>
            }
          >
            异常任务 · 实时
          </SectionTitle>
          <Card padded={false}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {ANOMALIES.map((a, i) => (
                <div
                  key={a.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom:
                      i < ANOMALIES.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      flexShrink: 0,
                      background:
                        a.level === "high"
                          ? "var(--danger-50)"
                          : a.level === "medium"
                            ? "var(--warn-50)"
                            : "var(--ink-50)",
                      color:
                        a.level === "high"
                          ? "var(--danger-600)"
                          : a.level === "medium"
                            ? "var(--warn-600)"
                            : "var(--ink-500)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon.Warn size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                        }}
                      >
                        {a.type}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                        {a.streamer} · {a.project}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-500)",
                        marginTop: 2,
                      }}
                    >
                      {a.detail}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {a.time}
                    </div>
                  </div>
                  <Button size="sm" kind="default">
                    处理
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>最近高风险操作</SectionTitle>
          <Card padded={false}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {AUDIT_LOG_RECENT.map((l, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 16px",
                    borderBottom:
                      i < AUDIT_LOG_RECENT.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Avatar name={l.who.split(" ")[0]} size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                      <b style={{ color: "var(--ink-900)" }}>{l.who}</b>
                      <span style={{ color: "var(--ink-400)" }}> · </span>
                      <span>{l.action}</span>
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {l.target} · {l.time}
                    </div>
                  </div>
                  {l.risk && (
                    <Badge tone="red" dot>
                      高风险
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ——— Matching tab ————————————————————————
function Matching() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            为 P-2412 · 元梦之星 6 月赛事 推荐主播
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            基于品类匹配、历史完成率、录屏通过率、ROI、风险扣分综合评分
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button kind="default" icon={<Icon.Filter size={14} />}>
            筛选
          </Button>
          <Button kind="primary" icon={<Icon.Export size={14} stroke="#fff" />}>
            导出厂家候选包
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        {RECOS_FOR_P2412.map((r) => {
          const s = STREAMERS.find((s) => s.id === r.id);
          const tone =
            r.score >= 85 ? "green" : r.score >= 70 ? "blue" : "amber";
          return (
            <Card key={r.id}>
              <div style={{ display: "flex", gap: 14 }}>
                <Avatar name={r.alias} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {r.alias}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {s.id}
                    </span>
                    <span style={{ flex: 1 }} />
                    <Badge
                      tone={
                        s.source === "签约"
                          ? "blue"
                          : s.source === "自孵化"
                            ? "teal"
                            : "neutral"
                      }
                    >
                      {s.source}
                    </Badge>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-400)",
                      marginTop: 2,
                    }}
                  >
                    {s.games.join(" / ")} · {s.platforms.join(" ")} · {s.style}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 28,
                          fontWeight: 700,
                          color:
                            tone === "green"
                              ? "var(--ok-600)"
                              : tone === "blue"
                                ? "var(--blue-600)"
                                : "var(--warn-600)",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        {r.score}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                        匹配分
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <MiniBar value={r.score} tone={tone} width="100%" />
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {r.reasons.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--ink-700)",
                        }}
                      >
                        <Icon.Check size={14} stroke="var(--ok-600)" />
                        <span>{t}</span>
                      </div>
                    ))}
                    {r.risks.map((t, i) => (
                      <div
                        key={"r" + i}
                        style={{
                          display: "flex",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--danger-600)",
                        }}
                      >
                        <Icon.Warn size={14} stroke="var(--danger-600)" />
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px dashed var(--line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  建议结算 ：
                </div>
                <Badge tone="blue">{s.defaultRule}</Badge>
                <span style={{ flex: 1 }} />
                <Button size="sm" kind="ghost">
                  查看画像
                </Button>
                <Button size="sm" kind="primary">
                  发起邀约
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ——— Supplier tab ————————————————————————
function Supplier() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            供应商质量评分
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            评分 = 录屏通过 + 项目完成 + 毛利贡献 − 异常率 − 黑名单率
          </div>
        </div>
        <SearchInput placeholder="搜索供应商…" width={220} />
      </div>

      <Card padded={false}>
        <DataTable
          columns={[
            {
              title: "供应商",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={r.name} size={30} />
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                      {r.name}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.id} · 推荐主播 {r.streamers}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: "综合评分",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    className="num"
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color:
                        r.score >= 85
                          ? "var(--ok-600)"
                          : r.score >= 75
                            ? "var(--blue-600)"
                            : "var(--warn-600)",
                    }}
                  >
                    {r.score}
                  </span>
                  <MiniBar
                    value={r.score}
                    tone={
                      r.score >= 85 ? "green" : r.score >= 75 ? "blue" : "amber"
                    }
                    width={100}
                  />
                </div>
              ),
            },
            {
              title: "项目完成率",
              align: "right",
              render: (r) => <span className="num">{r.finishRate}%</span>,
            },
            {
              title: "异常率",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color:
                      r.anomalyRate >= 10
                        ? "var(--danger-600)"
                        : "var(--ink-700)",
                  }}
                >
                  {r.anomalyRate}%
                </span>
              ),
            },
            {
              title: "累计毛利贡献",
              align: "right",
              render: (r) => (
                <span className="num">
                  ¥{(r.grossContrib / 1000).toFixed(1)}k
                </span>
              ),
            },
            {
              title: "趋势",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color: r.trend.startsWith("+")
                      ? "var(--ok-600)"
                      : "var(--danger-600)",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {r.trend}
                </span>
              ),
            },
            {
              title: "建议",
              render: (r) =>
                r.score >= 85 ? (
                  <Badge tone="green">优先续合</Badge>
                ) : r.score >= 75 ? (
                  <Badge tone="blue">维持合作</Badge>
                ) : (
                  <Badge tone="amber">谨慎使用</Badge>
                ),
            },
          ]}
          rows={SUPPLIER_SCORES}
        />
      </Card>
    </div>
  );
}

// ——— Pricing tab ————————————————————————
function Pricing() {
  const [model, setModel] = React.useState("cpt-cps");
  const [streamers, setStreamers] = React.useState(8);
  const [hours, setHours] = React.useState(60);
  const [hourly, setHourly] = React.useState(75);
  const [conversion, setConversion] = React.useState(12000);
  const [cpsRate, setCpsRate] = React.useState(8);

  const vendorRevenue = Math.round(
    streamers * hours * hourly * 1.3 + ((conversion * cpsRate) / 100) * 1.6,
  );
  const streamerCost = Math.round(streamers * hours * hourly);
  const supplierCost = Math.round(streamerCost * 0.18);
  const platform = Math.round(vendorRevenue * 0.05);
  const gross = vendorRevenue - streamerCost - supplierCost - platform;
  const marginPct =
    vendorRevenue > 0 ? ((gross / vendorRevenue) * 100).toFixed(1) : "0.0";

  const fmt = (n) => `¥${n.toLocaleString()}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Inputs */}
      <Card title="输入项" padded={true}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="结算方式">
            <div style={{ display: "flex", gap: 6 }}>
              {[
                ["cpt", "CPT"],
                ["cpt-cps", "CPT + CPS"],
                ["cpa", "CPA"],
                ["gift", "礼物提成"],
              ].map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setModel(k)}
                  style={{
                    height: 28,
                    padding: "0 10px",
                    fontSize: 12,
                    background: model === k ? "var(--blue-50)" : "#fff",
                    border: `1px solid ${model === k ? "var(--blue-500)" : "var(--line-strong)"}`,
                    color: model === k ? "var(--blue-700)" : "var(--ink-500)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: model === k ? 600 : 500,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <Field label="预计主播数">
            <RangeInput
              value={streamers}
              setValue={setStreamers}
              min={1}
              max={30}
              suffix="人"
            />
          </Field>
          <Field label="人均直播时长">
            <RangeInput
              value={hours}
              setValue={setHours}
              min={10}
              max={200}
              suffix="h / 月"
            />
          </Field>
          <Field label="时薪 / CPT 单价">
            <RangeInput
              value={hourly}
              setValue={setHourly}
              min={30}
              max={200}
              prefix="¥"
            />
          </Field>
          <Field label="预计 CPS 转化销售额">
            <RangeInput
              value={conversion}
              setValue={setConversion}
              min={0}
              max={80000}
              step={1000}
              prefix="¥"
            />
          </Field>
          <Field label="CPS 分成 (%)">
            <RangeInput
              value={cpsRate}
              setValue={setCpsRate}
              min={0}
              max={30}
              suffix="%"
            />
          </Field>
        </div>
      </Card>

      {/* Outputs */}
      <Card
        title="预估结果"
        extra={
          <Badge tone="violet" dot>
            AI 建议
          </Badge>
        }
        padded={true}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <ResultCell
            label="厂家应收"
            value={fmt(vendorRevenue)}
            tone="blue"
            emphasize
          />
          <ResultCell
            label="预计毛利"
            value={fmt(gross)}
            tone={gross > 0 ? "green" : "red"}
            emphasize
          />
          <ResultCell label="主播应付" value={fmt(streamerCost)} />
          <ResultCell label="供应商成本" value={fmt(supplierCost)} />
          <ResultCell label="平台扣点" value={fmt(platform)} />
          <ResultCell
            label="毛利率"
            value={`${marginPct}%`}
            tone={parseFloat(marginPct) > 25 ? "green" : "amber"}
          />
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 8,
            background: "linear-gradient(135deg, #F8F6FF, #EEF3FF)",
            border: "1px solid #D8D0FA",
            display: "flex",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--violet-600)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Sparkles size={14} stroke="#fff" />
          </div>
          <div
            style={{
              flex: 1,
              fontSize: 12.5,
              color: "var(--ink-700)",
              lineHeight: 1.6,
            }}
          >
            按当前输入，<b>盈亏平衡点</b>约为单主播{" "}
            <span className="num">
              {Math.ceil(streamerCost / streamers / hourly)}
            </span>{" "}
            h / 月。 如希望毛利率 ≥ 30%，建议将 CPT 单价降至{" "}
            <span className="num">¥{Math.round(hourly * 0.93)}</span>， 或将 CPS
            分成提高至 <span className="num">{Math.min(30, cpsRate + 2)}%</span>
            。 历史同类项目平均毛利率 <b className="num">31.6%</b>。
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button kind="default">保存为草稿</Button>
          <Button kind="primary">生成立项申请</Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function RangeInput({ value, setValue, min, max, step = 1, prefix, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--blue-600)" }}
      />
      <div
        style={{
          minWidth: 96,
          height: 30,
          padding: "0 10px",
          border: "1px solid var(--line-strong)",
          borderRadius: 6,
          background: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-900)",
        }}
        className="num"
      >
        {prefix}
        {value.toLocaleString()}
        {suffix && (
          <span
            style={{ color: "var(--ink-400)", fontWeight: 400, marginLeft: 2 }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function ResultCell({ label, value, tone, emphasize }) {
  const tones = {
    blue: "var(--blue-700)",
    green: "var(--ok-600)",
    amber: "var(--warn-600)",
    red: "var(--danger-600)",
  };
  return (
    <div
      style={{
        padding: 14,
        background: emphasize ? "var(--bg-soft)" : "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: emphasize ? 22 : 18,
          fontWeight: 600,
          color: tones[tone] || "var(--ink-900)",
          marginTop: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ===== src\screen-project.jsx =====
// ——— Screen: 项目管理 ————————————————————————————

function ScreenProjects({ go, projectId }) {
  if (projectId) return <ProjectDetail id={projectId} go={go} />;
  return <ProjectList go={go} />;
}

function ProjectList({ go }) {
  const [status, setStatus] = React.useState("all");
  const counts = {
    all: PROJECTS.length,
    active: PROJECTS.filter((p) => p.status === "active").length,
    recruiting: PROJECTS.filter((p) => p.status === "recruiting").length,
    settling: PROJECTS.filter((p) => p.status === "settling").length,
    paused: PROJECTS.filter((p) => p.status === "paused").length,
    ended: PROJECTS.filter((p) => p.status === "ended").length,
  };
  const filtered =
    status === "all" ? PROJECTS : PROJECTS.filter((p) => p.status === status);

  return (
    <>
      <PageHeader
        title="项目管理"
        subtitle="厂商 → 产品 → 项目；同时管理报名、录屏、排班、报数与结算"
        actions={
          <>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              导出项目表
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              新建项目
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={status}
              onChange={setStatus}
              items={[
                { key: "all", label: "全部", count: counts.all },
                { key: "active", label: "进行中", count: counts.active },
                {
                  key: "recruiting",
                  label: "招募中",
                  count: counts.recruiting,
                },
                { key: "settling", label: "结算中", count: counts.settling },
                { key: "paused", label: "已暂停", count: counts.paused },
                { key: "ended", label: "已结束", count: counts.ended },
              ]}
            />
          </div>

          {/* Toolbar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="项目名 / 编号 / 厂商" width={260} />
            <Button kind="default" size="md" icon={<Icon.Filter size={14} />}>
              厂商
            </Button>
            <Button kind="default" size="md" icon={<Icon.Filter size={14} />}>
              负责人
            </Button>
            <Button kind="default" size="md" icon={<Icon.Calendar size={14} />}>
              时间范围
            </Button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              共{" "}
              <b className="num" style={{ color: "var(--ink-700)" }}>
                {filtered.length}
              </b>{" "}
              个项目
            </span>
          </div>

          <DataTable
            columns={[
              {
                title: "项目",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 7,
                        background: "var(--blue-50)",
                        color: "var(--blue-700)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon.Game size={18} stroke="var(--blue-700)" />
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                        {r.name}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {r.id} · {r.code}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "厂商 / 产品",
                render: (r) => (
                  <div>
                    <div>{r.vendor}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                      {r.product}
                    </div>
                  </div>
                ),
              },
              {
                title: "状态",
                render: (r) => (
                  <Badge tone={PROJECT_STATUS[r.status].tone} dot>
                    {PROJECT_STATUS[r.status].label}
                  </Badge>
                ),
              },
              {
                title: "结算方式",
                render: (r) => <Badge tone="neutral">{r.pricing}</Badge>,
              },
              {
                title: "负责人",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Avatar name={r.leadOps} size={22} />
                    <span style={{ fontSize: 12, color: "var(--ink-700)" }}>
                      {r.leadOps}
                    </span>
                  </div>
                ),
              },
              {
                title: "主播",
                align: "right",
                render: (r) => (
                  <span className="num">
                    <b style={{ color: "var(--ink-900)" }}>
                      {r.streamers.active}
                    </b>
                    <span style={{ color: "var(--ink-400)" }}>
                      {" "}
                      / {r.streamers.active + r.streamers.candidate}
                    </span>
                  </span>
                ),
              },
              {
                title: "直播时长",
                align: "right",
                render: (r) => (
                  <div
                    className="num"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <span style={{ color: "var(--ink-900)" }}>
                      {r.metrics.doneHours.toLocaleString()} h
                    </span>
                    <span style={{ color: "var(--ink-400)", fontSize: 11 }}>
                      / 计划 {r.metrics.plannedHours.toLocaleString()}
                    </span>
                  </div>
                ),
              },
              {
                title: "预估毛利",
                align: "right",
                render: (r) => (
                  <div
                    className="num"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <span style={{ color: "var(--ink-900)" }}>
                      ¥{r.metrics.gross.toLocaleString()}
                    </span>
                    <span style={{ color: "var(--ink-400)", fontSize: 11 }}>
                      {r.metrics.margin.toFixed(1)}%
                    </span>
                  </div>
                ),
              },
              { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
              {
                title: "",
                render: () => (
                  <button
                    style={{
                      width: 24,
                      height: 24,
                      border: "none",
                      background: "transparent",
                      borderRadius: 4,
                      cursor: "pointer",
                      color: "var(--ink-400)",
                    }}
                  >
                    <Icon.More size={16} />
                  </button>
                ),
              },
            ]}
            rows={filtered}
            onRowClick={(r) => go("project", r.id)}
          />
        </Card>
      </div>
    </>
  );
}

// ——— Project detail ———————————————————————

function ProjectDetail({ id, go }) {
  const p = PROJECTS.find((x) => x.id === id) || PROJECTS[0];
  const [tab, setTab] = React.useState("overview");
  const status = PROJECT_STATUS[p.status];
  const donePct =
    Math.round((p.metrics.doneHours / p.metrics.plannedHours) * 100) || 0;

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span>
            <span className="mono">{p.id}</span> · {p.vendor} · {p.product} · 由{" "}
            {p.leadOps}（运营负责人）/ {p.bizOwner}（商务）共同负责
          </span>
        }
        status={
          <>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {p.risk !== "low" && (
              <Badge tone={p.risk === "high" ? "red" : "amber"} dot>
                {p.risk === "high" ? "高风险" : "中风险"}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              kind="ghost"
              icon={<Icon.ChevLeft size={14} />}
              onClick={() => go("projects")}
            >
              返回列表
            </Button>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              厂家交付包
            </Button>
            <Button kind="default" icon={<Icon.Settings size={14} />}>
              项目设置
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              新建排班
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top metric strip (owner view) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}
        >
          <Card>
            <Metric
              label="项目周期"
              value={`${p.start.slice(5)} → ${p.end.slice(5)}`}
              hint={`共 ${diffDays(p.start, p.end)} 天`}
            />
          </Card>
          <Card>
            <Metric
              label="累计直播时长"
              value={p.metrics.doneHours.toFixed(1)}
              unit="h"
              delta={`${donePct}% 达成`}
              deltaTone={
                donePct >= 90 ? "green" : donePct >= 50 ? "neutral" : "red"
              }
            />
          </Card>
          <Card>
            <Metric
              label="累计场观"
              value={(p.metrics.audience / 10000).toFixed(1)}
              unit="万人次"
            />
          </Card>
          <Card>
            <Metric
              label="预计厂家应收"
              value={`¥${(p.metrics.receivable / 10000).toFixed(1)}万`}
              hint="本批次未确认"
            />
          </Card>
          <Card>
            <Metric
              label="主播应付"
              value={`¥${(p.metrics.payable / 10000).toFixed(1)}万`}
              hint="已锁定 B-001"
            />
          </Card>
          <Card style={{ borderColor: "var(--blue-200)" }}>
            <Metric
              label="预估毛利"
              value={`¥${(p.metrics.gross / 10000).toFixed(1)}万`}
              delta={`${p.metrics.margin}%`}
              hint="毛利率"
            />
          </Card>
        </div>

        <Card padded={false}>
          <div
            style={{ padding: "0 16px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "项目总览" },
                {
                  key: "roster",
                  label: "主播阵容",
                  count: p.streamers.active + p.streamers.candidate,
                },
                {
                  key: "screening",
                  label: "录屏审核",
                  count: p.streamers.pendingReview,
                },
                { key: "schedule", label: "排班 & 任务" },
                {
                  key: "reports",
                  label: "报数",
                  count: p.metrics.reportedPending,
                },
                { key: "rules", label: "结算规则" },
                { key: "audit", label: "操作日志" },
              ]}
            />
          </div>

          <div style={{ padding: 20 }}>
            {tab === "overview" && <ProjectOverview p={p} />}
            {tab === "roster" && <ProjectRoster p={p} go={go} />}
            {tab !== "overview" && tab !== "roster" && (
              <EmptyHint
                title={tabLabel(tab) + " · 数据视图"}
                hint="此标签页与对应一级模块共享数据，仅做过滤展示。点击下方按钮跳转至完整模块。"
                actionLabel={"前往" + tabLabel(tab)}
                onAction={() => go(tabRoute(tab))}
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function tabLabel(k) {
  return (
    {
      screening: "录屏审核",
      schedule: "排班 & 任务",
      reports: "报数审核",
      rules: "结算规则",
      audit: "操作日志",
    }[k] || k
  );
}
function tabRoute(k) {
  return (
    {
      screening: "streamers",
      schedule: "tasks",
      reports: "reports",
      rules: "settle",
      audit: "audit",
    }[k] || "projects"
  );
}

// Project overview content
function ProjectOverview({ p }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="项目基础信息" padded={true}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              columnGap: 24,
            }}
          >
            <div>
              <KV label="项目编号">
                <span className="mono">
                  {p.id} · {p.code}
                </span>
              </KV>
              <KV label="厂商">{p.vendor}</KV>
              <KV label="产品">{p.product}</KV>
              <KV label="代理商">{p.agent}</KV>
              <KV label="供应商">{p.supplier}</KV>
            </div>
            <div>
              <KV label="开始 / 结束">
                {p.start} → {p.end}
              </KV>
              <KV label="结算方式">
                <Badge tone="blue">{p.pricing}</Badge>
              </KV>
              <KV label="强制录屏">{p.needScreening ? "是" : "否"}</KV>
              <KV label="主播需点击开播 / 停止">
                {p.needStartStop ? "是" : "否"}
              </KV>
              <KV label="项目说明" w={120}>
                <span style={{ color: "var(--ink-500)" }}>
                  厂家关注角色相关内容的高质感呈现；不接受重复梗图与画质过低截图，CPS
                  转化按米哈游官方对账数据为准。
                </span>
              </KV>
            </div>
          </div>
        </Card>

        <Card
          title="执行节奏"
          extra={<Badge tone="neutral">未来 7 天</Badge>}
          padded={true}
        >
          <GanttPreview />
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="本周提醒" padded={true}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <ReminderItem
              tone="red"
              title="高风险操作"
              content="李珩 5 分钟前锁定主播应付批次 B-2026-05-S-001，请在 24h 内确认无误。"
            />
            <ReminderItem
              tone="amber"
              title="录屏待审"
              content="4 位候选主播的项目报名录屏已超过 18h 未审核。"
            />
            <ReminderItem
              tone="blue"
              title="报数待审"
              content="7 条本周报数处于待审核，其中 2 条 OCR 与手动值偏差较大。"
            />
          </div>
        </Card>

        <Card
          title="近期 AI 复盘要点"
          extra={
            <Badge tone="violet" dot>
              每周一更新
            </Badge>
          }
          padded={true}
        >
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {[
              [
                "品类匹配偏差",
                "原神剧情向流量近 2 周下滑 11%，建议下一档期增配「攻略 / 速通」主播。",
              ],
              [
                "礼物提成转化",
                "NIKO 与青羽两人贡献 64% 礼物流水，但占总主播 14%，建议优先排班加码。",
              ],
              [
                "CPS 数据缺口",
                "近 7 天仍有 2 个任务缺少 CPS 数据导入，可能影响下批次结算金额。",
              ],
            ].map(([t, d], i) => (
              <li key={i} style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                <b style={{ color: "var(--violet-600)" }}>· {t}：</b>
                {d}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ReminderItem({ tone, title, content }) {
  const toneMap = {
    red: ["var(--danger-50)", "var(--danger-600)"],
    amber: ["var(--warn-50)", "var(--warn-600)"],
    blue: ["var(--blue-50)", "var(--blue-700)"],
  };
  const [bg, fg] = toneMap[tone];
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          background: bg,
          color: fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon.Warn size={14} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
          {content}
        </div>
      </div>
    </div>
  );
}

function ProjectRoster({ p, go }) {
  const roster = STREAMERS.slice(0, p.streamers.active);
  return (
    <DataTable
      columns={[
        {
          title: "主播",
          render: (r) => (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={r.alias} />
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                  {r.alias}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-400)" }}
                >
                  {r.id} · {r.real}
                </div>
              </div>
            </div>
          ),
        },
        {
          title: "来源 / 供应商",
          render: (r) => (
            <div>
              <div>{r.source}</div>
              <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                {r.supplier}
              </div>
            </div>
          ),
        },
        {
          title: "本项目结算规则",
          render: (r) => <Badge tone="blue">{r.defaultRule}</Badge>,
        },
        {
          title: "本周时长",
          align: "right",
          render: (r) => (
            <span className="num">{(8 + Math.random() * 16).toFixed(1)} h</span>
          ),
        },
        {
          title: "匹配分",
          render: (r) => (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="num" style={{ fontWeight: 600 }}>
                {r.matchScore}
              </span>
              <MiniBar
                value={r.matchScore}
                tone={r.matchScore >= 85 ? "green" : "blue"}
                width={60}
              />
            </div>
          ),
        },
        { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
        {
          title: "操作",
          align: "right",
          render: (r) => (
            <div
              style={{
                display: "inline-flex",
                gap: 6,
                justifyContent: "flex-end",
              }}
            >
              <Button
                size="sm"
                kind="default"
                icon={<Icon.Streamer size={12} />}
                onClick={(e) => {
                  e.stopPropagation();
                  go && go("streamers", r.id);
                }}
              >
                查看主页
              </Button>
              <button
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 26,
                  height: 26,
                  border: "1px solid var(--line-strong)",
                  background: "#fff",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--ink-400)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon.More size={14} />
              </button>
            </div>
          ),
        },
      ]}
      rows={roster}
    />
  );
}

function GanttPreview() {
  const rows = [
    {
      name: "NIKO",
      bars: [
        [1, 3, "live"],
        [4, 4, "plan"],
        [5, 2, "plan"],
      ],
    },
    {
      name: "冷江",
      bars: [
        [1, 2, "live"],
        [3, 3, "plan"],
        [6, 2, "plan"],
      ],
    },
    {
      name: "青羽",
      bars: [
        [2, 2, "live"],
        [4, 3, "plan"],
      ],
    },
    {
      name: "小Mei",
      bars: [
        [1, 1, "late"],
        [3, 4, "plan"],
        [6, 2, "plan"],
      ],
    },
    { name: "阿七", bars: [[2, 5, "plan"]] },
  ];
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayColor = (k) =>
    k === "live"
      ? "var(--blue-600)"
      : k === "late"
        ? "var(--danger-600)"
        : "var(--blue-200)";

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px repeat(7, 1fr)",
          columnGap: 4,
          fontSize: 11,
          color: "var(--ink-400)",
          marginBottom: 8,
        }}
      >
        <span></span>
        {days.map((d) => (
          <div key={d} style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div
            key={r.name}
            style={{
              display: "grid",
              gridTemplateColumns: "60px repeat(7, 1fr)",
              alignItems: "center",
              columnGap: 4,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--ink-700)" }}>
              {r.name}
            </div>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const bar = r.bars.find((b) => b[0] - 1 === i);
              return (
                <div key={i} style={{ height: 22, position: "relative" }}>
                  {bar && (
                    <div
                      style={{
                        position: "absolute",
                        left: 2,
                        right: -2 - (bar[1] - 1) * -100 + "%",
                        width: `calc(${bar[1]} * 100% + ${(bar[1] - 1) * 4}px - 4px)`,
                        height: 18,
                        top: 2,
                        background: dayColor(bar[2]),
                        borderRadius: 4,
                        opacity: bar[2] === "plan" ? 0.55 : 1,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 14,
          fontSize: 11,
          color: "var(--ink-400)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: "var(--blue-600)",
            }}
          />
          已直播
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: "var(--blue-200)",
            }}
          />
          计划
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: "var(--danger-600)",
            }}
          />
          异常
        </span>
      </div>
    </div>
  );
}

function EmptyHint({ title, hint, actionLabel, onAction }) {
  return (
    <div style={{ padding: "40px 16px", textAlign: "center" }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: "var(--ink-50)",
          color: "var(--ink-400)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Icon.Eye size={20} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-700)" }}>
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-400)",
          marginTop: 6,
          maxWidth: 420,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {hint}
      </div>
      {actionLabel && (
        <div style={{ marginTop: 14 }}>
          <Button kind="primary" onClick={onAction}>
            {actionLabel} →
          </Button>
        </div>
      )}
    </div>
  );
}

function diffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// ===== src\screen-streamers.jsx =====
// ——— Screen: 主播资源池 ————————————————————————————

function ScreenStreamers({ go, initialActiveId }) {
  const [active, setActive] = React.useState(
    initialActiveId || STREAMERS[3].id,
  ); // NIKO

  return (
    <>
      <PageHeader
        title="主播资源池"
        subtitle="不是通讯录 · 用于回答：能不能接？适合接什么？历史表现如何？值不值得继续合作？"
        actions={
          <>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              导出主播表
            </Button>
            <Button kind="default" icon={<Icon.Upload size={14} />}>
              批量导入
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              新增主播档案
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {/* List */}
        <Card padded={false}>
          {/* Filter strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="主播名 / 真名 / 平台账号" width={240} />
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              游戏品类
            </Button>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              来源
            </Button>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              合作状态
            </Button>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              风险
            </Button>
            <div style={{ flex: 1 }} />
            <Badge tone="blue">{STREAMERS.length} 位主播</Badge>
          </div>

          <DataTable
            activeRowId={active}
            onRowClick={(r) => setActive(r.id)}
            columns={[
              {
                title: "主播",
                render: (r) => (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <Avatar name={r.alias} size={32} />
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {r.alias}
                        {r.cooperation === "paused" && (
                          <Badge tone="amber">暂停</Badge>
                        )}
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {r.id} · {r.real}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: "来源 / 供应商",
                render: (r) => (
                  <div>
                    <Badge
                      tone={
                        r.source === "签约"
                          ? "blue"
                          : r.source === "自孵化"
                            ? "teal"
                            : "neutral"
                      }
                    >
                      {r.source}
                    </Badge>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {r.supplier}
                    </div>
                  </div>
                ),
              },
              {
                title: "擅长品类",
                wrap: true,
                render: (r) => (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.games.map((g) => (
                      <Badge key={g} tone="neutral">
                        {g}
                      </Badge>
                    ))}
                  </div>
                ),
              },
              {
                title: "完成率",
                align: "right",
                render: (r) => (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    <MiniBar
                      value={r.metrics.projectFinish}
                      tone={r.metrics.projectFinish >= 90 ? "green" : "blue"}
                      width={56}
                    />
                    <span className="num" style={{ minWidth: 32 }}>
                      {r.metrics.projectFinish}%
                    </span>
                  </div>
                ),
              },
              {
                title: "ROI",
                align: "right",
                render: (r) => (
                  <span
                    className="num"
                    style={{
                      color:
                        r.metrics.roi >= 1.3
                          ? "var(--ok-600)"
                          : r.metrics.roi >= 1
                            ? "var(--ink-900)"
                            : "var(--danger-600)",
                      fontWeight: 600,
                    }}
                  >
                    {r.metrics.roi.toFixed(2)}
                  </span>
                ),
              },
              {
                title: "默认结算",
                render: (r) => <Badge tone="ink">{r.defaultRule}</Badge>,
              },
              { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
            ]}
            rows={STREAMERS}
          />
        </Card>

        {/* Detail panel */}
        <StreamerPanel id={active} />
      </div>
    </>
  );
}

function StreamerPanel({ id }) {
  const s = STREAMERS.find((x) => x.id === id);
  if (!s) return null;

  return (
    <div
      style={{
        position: "sticky",
        top: 76,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Card padded={true}>
        <div style={{ display: "flex", gap: 14 }}>
          <Avatar name={s.alias} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--ink-900)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {s.alias}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                  {s.real} · {s.gender} · <span className="mono">{s.id}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  title="编辑档案"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "var(--ink-500)",
                    transition: "all 100ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--blue-50)";
                    e.currentTarget.style.borderColor = "var(--blue-500)";
                    e.currentTarget.style.color = "var(--blue-700)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.borderColor = "var(--line-strong)";
                    e.currentTarget.style.color = "var(--ink-500)";
                  }}
                >
                  <Icon.Pencil size={14} />
                </button>
                <button
                  title="更多操作"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: "1px solid var(--line-strong)",
                    background: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "var(--ink-500)",
                  }}
                >
                  <Icon.More size={14} />
                </button>
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <Badge tone="blue">{s.source}</Badge>
              <Badge tone="green" dot>
                合作中
              </Badge>
              <Badge
                tone={
                  s.risk === "low"
                    ? "neutral"
                    : s.risk === "medium"
                      ? "amber"
                      : "red"
                }
                dot
              >
                风险 {s.risk}
              </Badge>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--line)",
          }}
        >
          <KV label="供应商来源">{s.supplier}</KV>
          <KV label="擅长品类">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.games.map((g) => (
                <Badge key={g} tone="neutral">
                  {g}
                </Badge>
              ))}
            </div>
          </KV>
          <KV label="平台账号">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.platforms.map((p) => (
                <Badge key={p} tone="violet">
                  {p}
                </Badge>
              ))}
            </div>
          </KV>
          <KV label="风格">{s.style}</KV>
          <KV label="默认结算">
            <Badge tone="blue">{s.defaultRule}</Badge>
          </KV>
        </div>
      </Card>

      <Card title="经营画像 · 近 90 天" padded={true}>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <RingMetric
            label="录屏通过率"
            value={s.metrics.screenPass}
            max={100}
            suffix="%"
          />
          <RingMetric
            label="项目完成率"
            value={s.metrics.projectFinish}
            max={100}
            suffix="%"
          />
          <RingMetric
            label="ROI"
            value={s.metrics.roi}
            max={2}
            dp={2}
            highlight
          />
          <RingMetric
            label="毛利贡献"
            value={`¥${(s.metrics.grossContrib / 1000).toFixed(1)}k`}
            raw
          />
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px dashed var(--line)",
          }}
        >
          <div
            style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 6 }}
          >
            近 6 周匹配分趋势
          </div>
          <Sparkline data={[78, 81, 83, 86, 90, s.matchScore]} />
        </div>
      </Card>

      <Card
        title="参与项目"
        extra={
          <Button size="sm" kind="link">
            查看全部
          </Button>
        }
        padded={false}
      >
        <div>
          {[
            {
              id: "P-2406",
              name: "原神 4.7 品宣",
              status: "active",
              hours: 32.5,
              contrib: 8400,
            },
            {
              id: "P-2405",
              name: "KPL 春赛二级解说",
              status: "settling",
              hours: 102,
              contrib: 18600,
            },
            {
              id: "P-2398",
              name: "永劫无间 5 周年",
              status: "ended",
              hours: 54,
              contrib: 9200,
            },
          ].map((pr, i) => (
            <div
              key={pr.id}
              style={{
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderBottom: i < 2 ? "1px solid var(--line)" : "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ink-900)",
                  }}
                >
                  {pr.name}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-400)" }}
                >
                  {pr.id}
                </div>
              </div>
              <Badge tone={PROJECT_STATUS[pr.status].tone}>
                {PROJECT_STATUS[pr.status].label}
              </Badge>
              <div style={{ textAlign: "right" }}>
                <div
                  className="num"
                  style={{ fontSize: 12, color: "var(--ink-900)" }}
                >
                  ¥{pr.contrib.toLocaleString()}
                </div>
                <div
                  className="num"
                  style={{ fontSize: 11, color: "var(--ink-400)" }}
                >
                  {pr.hours} h
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="default" style={{ flex: 1 }}>
          设置风险
        </Button>
        <Button kind="primary" style={{ flex: 1 }}>
          邀请加入项目
        </Button>
      </div>
    </div>
  );
}

function RingMetric({
  label,
  value,
  max = 100,
  suffix = "",
  dp = 0,
  raw = false,
  highlight = false,
}) {
  let pct = 0;
  let display = value;
  if (!raw && typeof value === "number") {
    pct = Math.min(100, (value / max) * 100);
    display = dp ? value.toFixed(dp) : value;
  } else {
    pct = 75; // visual default
  }
  const size = 64,
    stroke = 6,
    r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = highlight ? "var(--violet-600)" : "var(--blue-600)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--ink-50)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div>
        <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{label}</div>
        <div
          className="num"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--ink-900)",
            letterSpacing: "-0.01em",
          }}
        >
          {display}
          {suffix}
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, w = 280, h = 40 }) {
  const min = Math.min(...data),
    max = Math.max(...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / (max - min || 1)) * (h - 8) - 4;
    return [x, y];
  });
  const path = pts
    .map((p, i) => (i === 0 ? "M" : "L") + p[0] + " " + p[1])
    .join(" ");
  const area = path + ` L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E50C8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1E50C8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sg)" />
      <path
        d={path}
        fill="none"
        stroke="#1E50C8"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === pts.length - 1 ? 3 : 2}
          fill={i === pts.length - 1 ? "#1E50C8" : "#fff"}
          stroke="#1E50C8"
          strokeWidth="1.4"
        />
      ))}
    </svg>
  );
}

// ===== src\screen-reports.jsx =====
// ——— Screen: 报数审核 ————————————————————————————

function ScreenReports({ go }) {
  const reports = useOpsReports();
  const [filter, setFilter] = React.useState("pending_review");
  const [activeId, setActiveId] = React.useState("R-08831");

  React.useEffect(() => {
    if (
      reports.length > 0 &&
      !reports.some((report) => report.id === activeId)
    ) {
      setActiveId(reports[0].id);
    }
  }, [activeId, reports]);

  const counts = {
    all: reports.length,
    pending_review: reports.filter((r) => r.status === "pending_review").length,
    need_supply: reports.filter((r) => r.status === "need_supply").length,
    approved: reports.filter((r) => r.status === "approved").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
  };
  const filtered =
    filter === "all" ? reports : reports.filter((r) => r.status === filter);

  return (
    <>
      <PageHeader
        title="下播截图报数 · 审核"
        subtitle="一条任务可能对应多条报数。审核通过的报数将进入可结算池，但不自动生成结算。"
        actions={
          <>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              导出报数明细
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Check size={14} stroke="#fff" />}
            >
              批量审核通过
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "1.35fr 1fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                {
                  key: "pending_review",
                  label: "待审核",
                  count: counts.pending_review,
                },
                {
                  key: "need_supply",
                  label: "需补充",
                  count: counts.need_supply,
                },
                { key: "approved", label: "已通过", count: counts.approved },
                { key: "rejected", label: "已驳回", count: counts.rejected },
                { key: "all", label: "全部", count: counts.all },
              ]}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="任务号 / 主播 / 项目" width={220} />
            <Button kind="default" icon={<Icon.Calendar size={14} />}>
              日期：近 7 天
            </Button>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              项目
            </Button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              OCR 与手动偏差自动标红
            </span>
          </div>

          <DataTable
            activeRowId={activeId}
            onRowClick={(r) => setActiveId(r.id)}
            columns={[
              {
                title: "报数 / 任务",
                render: (r) => (
                  <div>
                    <div
                      className="mono"
                      style={{
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        fontSize: 12.5,
                      }}
                    >
                      {r.id}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.taskId}
                    </div>
                  </div>
                ),
              },
              {
                title: "主播 · 项目",
                render: (r) => (
                  <div>
                    <div style={{ color: "var(--ink-900)", fontWeight: 500 }}>
                      {r.streamer}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {r.project}
                    </div>
                  </div>
                ),
              },
              {
                title: "日期",
                render: (r) => (
                  <span className="num" style={{ fontSize: 12 }}>
                    {r.date}
                  </span>
                ),
              },
              {
                title: "时长",
                align: "right",
                render: (r) => (
                  <span className="num" style={{ fontWeight: 600 }}>
                    {r.duration.toFixed(1)} h
                  </span>
                ),
              },
              {
                title: "场观",
                align: "right",
                render: (r) => (
                  <span className="num">{r.audience.toLocaleString()}</span>
                ),
              },
              {
                title: "截图",
                align: "center",
                render: (r) => (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--ink-500)",
                    }}
                  >
                    <Icon.Reports size={12} stroke="var(--ink-400)" />
                    {r.screens}
                  </span>
                ),
              },
              {
                title: "来源",
                render: (r) => (
                  <Badge tone={r.source === "OCR" ? "violet" : "neutral"}>
                    {r.source === "OCR" ? "OCR 识别" : "手动"}
                  </Badge>
                ),
              },
              {
                title: "状态",
                render: (r) => (
                  <Badge tone={REPORT_STATUS[r.status].tone} dot>
                    {REPORT_STATUS[r.status].label}
                  </Badge>
                ),
              },
            ]}
            rows={filtered}
          />
        </Card>

        {/* Detail */}
        <ReportDetail id={activeId} reports={reports} />
      </div>
    </>
  );
}

function ReportDetail({ id, reports }) {
  const actions = useOpsLiveActions();
  const [busyDecision, setBusyDecision] = React.useState(null);
  const r = reports.find((x) => x.id === id) || reports[0] || REPORTS[0];
  const s = STREAMERS.find((s) => s.alias === r.streamer);
  const p = PROJECTS.find((p) => p.id === r.project);
  const projectName = p?.name || r.project;

  const review = async (decision) => {
    if (!actions.reviewReport) return;
    setBusyDecision(decision);
    try {
      await actions.reviewReport(r.id, decision);
    } finally {
      setBusyDecision(null);
    }
  };

  // Mock OCR-vs-manual side-by-side
  const ocrFields = [
    { label: "直播日期", ocr: r.date, manual: r.date, diff: false },
    {
      label: "直播时长",
      ocr: (r.duration + 0.3).toFixed(1) + " h",
      manual: r.duration.toFixed(1) + " h",
      diff: true,
    },
    {
      label: "场观",
      ocr: (r.audience + 240).toLocaleString(),
      manual: r.audience.toLocaleString(),
      diff: true,
    },
    {
      label: "直播账号",
      ocr: "douyin_niko_live",
      manual: "douyin_niko_live",
      diff: false,
    },
  ];

  return (
    <div
      style={{
        position: "sticky",
        top: 76,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Card padded={false}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-400)" }}
            >
              {r.id} · 任务 {r.taskId}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink-900)",
                marginTop: 2,
              }}
            >
              {r.streamer} · {projectName}
            </div>
          </div>
          <Badge tone={REPORT_STATUS[r.status].tone} dot>
            {REPORT_STATUS[r.status].label}
          </Badge>
        </div>

        {/* Screenshot preview */}
        <div style={{ padding: 16 }}>
          <ScreenshotPreview
            platform={s?.platforms?.[0] || "抖音"}
            streamer={r.streamer}
            date={r.date}
            duration={r.duration}
            audience={r.audience}
          />
        </div>

        {/* OCR vs Manual */}
        <div style={{ padding: "0 16px 16px" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-700)",
              margin: "0 0 8px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            OCR 识别 vs 主播确认
            <Badge tone="violet" dot>
              差异 2 项
            </Badge>
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              border: "1px solid var(--line)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr style={{ background: "var(--bg-soft)" }}>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  字段
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  OCR 原始
                </th>
                <th
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink-400)",
                  }}
                >
                  主播确认
                </th>
              </tr>
            </thead>
            <tbody>
              {ocrFields.map((f, i) => (
                <tr
                  key={f.label}
                  style={{ background: f.diff ? "#FEF7E6" : "#fff" }}
                >
                  <td
                    style={{
                      padding: "9px 12px",
                      fontSize: 12,
                      color: "var(--ink-500)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {f.label}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: "9px 12px",
                      fontSize: 12.5,
                      color: f.diff ? "var(--warn-600)" : "var(--ink-700)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                      textDecoration: f.diff ? "line-through" : "none",
                    }}
                  >
                    {f.ocr}
                  </td>
                  <td
                    className="num"
                    style={{
                      padding: "9px 12px",
                      fontSize: 12.5,
                      fontWeight: f.diff ? 600 : 500,
                      color: "var(--ink-900)",
                      borderTop: i ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {f.manual}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: "0 16px 16px" }}>
          <KV label="主播备注">
            {r.note || <span style={{ color: "var(--ink-300)" }}>—</span>}
          </KV>
          <KV label="风控提示">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ok-600)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Check size={12} stroke="var(--ok-600)" />
                图片哈希无重复
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--warn-600)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.Warn size={12} stroke="var(--warn-600)" />
                时长字段偏差 8.6%，已标记复核
              </span>
            </div>
          </KV>
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "var(--bg-soft)",
            display: "flex",
            gap: 8,
          }}
        >
          <Button
            kind="danger"
            icon={<Icon.X size={14} />}
            disabled={Boolean(busyDecision)}
            onClick={() => review("reject")}
          >
            {busyDecision === "reject" ? "处理中…" : "驳回"}
          </Button>
          <Button
            kind="default"
            disabled={Boolean(busyDecision)}
            onClick={() => review("need_more")}
          >
            {busyDecision === "need_more" ? "处理中…" : "需补充截图"}
          </Button>
          <div style={{ flex: 1 }} />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            <input
              type="checkbox"
              defaultChecked
              style={{ accentColor: "var(--blue-600)" }}
            />{" "}
            计入任务结果
          </label>
          <Button
            kind="primary"
            icon={<Icon.Check size={14} stroke="#fff" />}
            disabled={Boolean(busyDecision)}
            onClick={() => review("approve")}
          >
            {busyDecision === "approve" ? "处理中…" : "审核通过"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Faux screenshot — stylized 抖音/B 站 后台截图样式 (subtle, not real branding)
function ScreenshotPreview({ platform, streamer, date, duration, audience }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
        background: "#0E1530",
        position: "relative",
        aspectRatio: "16 / 9",
      }}
    >
      {/* Phone-like overlay panel */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          bottom: 12,
          background:
            "linear-gradient(180deg, rgba(20,25,55,0.85), rgba(8,12,30,0.9))",
          border: "1px solid #233063",
          borderRadius: 8,
          padding: 14,
          color: "#E5EAF6",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontFamily: '"IBM Plex Sans", "PingFang SC", sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "#3B6BE6",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 11,
              color: "#fff",
            }}
          >
            L
          </span>
          <span style={{ fontSize: 11.5, color: "#B8C2DB" }}>
            {platform} · 直播后台 · 数据概览
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#7C8AB0" }}>{date}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>本场直播已结束</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          <ShotMetric label="直播时长" value={`${duration.toFixed(1)} h`} />
          <ShotMetric label="累计场观" value={audience.toLocaleString()} />
          <ShotMetric
            label="平均同时"
            value={((audience / (duration * 60)) * 8).toFixed(0)}
          />
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10.5,
            color: "#7C8AB0",
          }}
        >
          <Icon.History size={11} stroke="#7C8AB0" />
          {streamer} · 截图时间 {date} 22:48:21
        </div>
      </div>

      {/* watermark */}
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 18,
          fontSize: 10,
          color: "rgba(255,255,255,0.16)",
          fontFamily: "IBM Plex Mono, monospace",
          letterSpacing: "0.1em",
        }}
      >
        SHA · 8A2E…F19C
      </div>
    </div>
  );
}

function ShotMetric({ label, value }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: 10, color: "#7C8AB0" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "#fff",
          marginTop: 2,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function askText(label, defaultValue = "") {
  const value = globalThis.prompt?.(label, defaultValue);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ===== src\screen-settlement.jsx =====
// ——— Screen: 结算中心 ————————————————————————————

function ScreenSettlement({ go }) {
  const batches = useOpsSettlementBatches();
  const batchDetails = useOpsSettlementBatchDetails();
  const settlementScope = useOpsSettlementScope();
  const actions = useOpsLiveActions();
  const [type, setType] = React.useState("all");
  const [busyAction, setBusyAction] = React.useState(null);
  const [activeId, setActiveId] = React.useState(
    batches[0]?.id || "B-2026-05-S-001",
  );

  React.useEffect(() => {
    if (!batches.some((b) => b.id === activeId)) {
      setActiveId(batches[0]?.id || "B-2026-05-S-001");
    }
  }, [activeId, batches]);

  const filtered =
    type === "all" ? batches : batches.filter((b) => b.type === type);
  const activeBatch =
    batches.find((batch) => batch.id === activeId) || batches[0] || null;

  const runSettlementAction = async (actionName, fn) => {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      const shouldReload = await fn();
      if (shouldReload !== false) {
        globalThis.location?.reload();
      }
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "结算操作失败",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const createBatch = () =>
    runSettlementAction("create", async () => {
      const projectId = askText(
        "项目 ID",
        settlementScope?.projectId || activeBatch?.projectId || "",
      );
      const periodStart = askText(
        "周期开始 YYYY-MM-DD",
        settlementScope?.periodStart || "",
      );
      const periodEnd = askText(
        "周期结束 YYYY-MM-DD",
        settlementScope?.periodEnd || "",
      );
      const batchTypeInput = askText(
        "批次类型：payable 主播应付 / receivable 厂家应收",
        "payable",
      );
      if (!projectId || !periodStart || !periodEnd || !batchTypeInput)
        return false;

      const batchType =
        batchTypeInput.includes("receivable") || batchTypeInput.includes("应收")
          ? "receivable"
          : "payable";
      await actions.createSettlementBatch?.({
        projectId,
        periodStart,
        periodEnd,
        batchType,
      });
      return true;
    });

  const addManualItem = () =>
    runSettlementAction("manual", async () => {
      if (!activeBatch) return false;
      const itemType = askText("承载类型：cpa / cps / gift / manual", "cpa");
      const amount = askText("人工金额", "300");
      const evidenceLevel = askText("证据等级：yellow / red", "red");
      const reason = askText("原因", "人工录入 CPA/CPS/礼物金额");
      if (!itemType || !amount || !evidenceLevel || !reason) return false;
      await actions.addManualSettlementItem?.(activeBatch.id, {
        itemType,
        manualAmount: Number(amount),
        evidenceLevel: evidenceLevel === "yellow" ? "yellow" : "red",
        reason,
        projectId: activeBatch.projectId,
      });
      return true;
    });

  const lockBatch = () =>
    runSettlementAction("lock", async () => {
      if (!activeBatch) return false;
      const reason = askText("锁定原因", "财务核对无误");
      if (!reason) return false;
      await actions.lockSettlementBatch?.(activeBatch.id, { reason });
      return true;
    });

  const reopenBatch = () =>
    runSettlementAction("reopen", async () => {
      if (!activeBatch) return false;
      const reason = askText("重开原因", "需要修正结算金额");
      if (!reason) return false;
      await actions.reopenSettlementBatch?.(activeBatch.id, { reason });
      return true;
    });

  return (
    <>
      <PageHeader
        title="结算中心"
        subtitle="厂家应收与主播应付分别开批次 · 锁定批次只允许负责人重新打开 · 全程审计"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={addManualItem}
              disabled={!!busyAction}
            >
              {busyAction === "manual" ? "处理中…" : "导入 CPA / CPS 数据"}
            </Button>
            <Button kind="default" icon={<Icon.Export size={14} />}>
              批次导出
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={createBatch}
              disabled={!!busyAction}
            >
              新建结算批次
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Card>
            <Metric
              label="可结算池 · 报数条数"
              value={String(settlementScope?.poolCount ?? 42)}
              unit="条"
              hint="审核通过 · 待入批次"
            />
          </Card>
          <Card>
            <Metric
              label="本月厂家应收 (草稿)"
              value="¥286,400"
              delta="+¥120k"
              hint="2 个待确认批次"
            />
          </Card>
          <Card>
            <Metric
              label="本月主播应付 (锁定)"
              value="¥92,400"
              hint="已发送至财务"
            />
          </Card>
          <Card style={{ borderColor: "var(--blue-200)" }}>
            <Metric label="本月预估毛利" value="¥73,200" delta="34.2% 毛利率" />
          </Card>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          <Card padded={false}>
            <div
              style={{
                padding: "0 12px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <Tabs
                value={type}
                onChange={setType}
                items={[
                  { key: "all", label: "全部", count: batches.length },
                  {
                    key: "vendor_receivable",
                    label: "厂家应收",
                    count: batches.filter((b) => b.type === "vendor_receivable")
                      .length,
                  },
                  {
                    key: "streamer_payable",
                    label: "主播应付",
                    count: batches.filter((b) => b.type === "streamer_payable")
                      .length,
                  },
                ]}
              />
            </div>

            <DataTable
              activeRowId={activeId}
              onRowClick={(r) => setActiveId(r.id)}
              columns={[
                {
                  title: "批次",
                  render: (r) => (
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {r.id}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          marginTop: 2,
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 2,
                        }}
                      >
                        {r.period}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "类型",
                  render: (r) => (
                    <Badge
                      tone={r.type === "vendor_receivable" ? "blue" : "teal"}
                    >
                      {r.type === "vendor_receivable" ? "应收" : "应付"}
                    </Badge>
                  ),
                },
                {
                  title: "金额",
                  align: "right",
                  render: (r) => (
                    <span
                      className="num"
                      style={{
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        fontSize: 14,
                      }}
                    >
                      ¥{r.amount.toLocaleString()}
                    </span>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => (
                    <Badge tone={BATCH_STATUS[r.status].tone} dot>
                      {BATCH_STATUS[r.status].label}
                    </Badge>
                  ),
                },
              ]}
              rows={filtered}
            />
          </Card>

          {/* Batch detail */}
          <BatchDetail
            id={activeId}
            batches={batches}
            batchDetails={batchDetails}
            onAddManualItem={addManualItem}
            onLockBatch={lockBatch}
            onReopenBatch={reopenBatch}
            busyAction={busyAction}
          />
        </div>
      </div>
    </>
  );
}

function BatchDetail({
  id,
  batches = BATCHES,
  batchDetails = {},
  onAddManualItem,
  onLockBatch,
  onReopenBatch,
  busyAction,
}) {
  const b = batches.find((x) => x.id === id) || batches[0] || BATCHES[1];
  const isPayable = b.type === "streamer_payable";
  const isLocked = b.status === "locked";
  const isReferenceBatch = BATCHES.some((x) => x.id === b.id);
  const apiDetailRows = Array.isArray(batchDetails[b.id])
    ? batchDetails[b.id]
    : null;
  const detailRows = apiDetailRows?.length
    ? apiDetailRows
    : isReferenceBatch
      ? BATCH_DETAIL_ITEMS
      : [
          {
            streamer: "批次汇总",
            id: String(b.id).slice(0, 8),
            rule: isPayable ? "主播应付汇总" : "厂家应收汇总",
            hours: 0,
            qty: "API 批次",
            base: 0,
            variable: b.amount,
            adjust: 0,
            total: b.amount,
          },
        ];

  const total = detailRows.reduce((s, x) => s + x.total, 0);
  const baseSum = detailRows.reduce((s, x) => s + x.base, 0);
  const varSum = detailRows.reduce((s, x) => s + x.variable, 0);
  const adjSum = detailRows.reduce((s, x) => s + x.adjust, 0);

  return (
    <div
      style={{
        position: "sticky",
        top: 76,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Card padded={false}>
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {b.id}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                  marginTop: 2,
                }}
              >
                {b.name}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <Badge tone={isPayable ? "teal" : "blue"}>
                  {isPayable ? "主播应付" : "厂家应收"}
                </Badge>
                <Badge tone={BATCH_STATUS[b.status].tone} dot>
                  {BATCH_STATUS[b.status].label}
                </Badge>
                {isLocked && (
                  <Badge tone="ink" soft={true}>
                    <Icon.Lock size={11} /> 已锁定
                  </Badge>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                合计金额
              </div>
              <div
                className="num"
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                  letterSpacing: "-0.02em",
                }}
              >
                ¥{total.toLocaleString()}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              paddingTop: 12,
              borderTop: "1px dashed var(--line)",
            }}
          >
            <KV label="结算周期" w={60}>
              <span className="num">{b.period}</span>
            </KV>
            <KV label="项目" w={36}>
              <span className="mono">{b.project}</span>
            </KV>
            <KV label="创建人" w={50}>
              {b.creator}
            </KV>
            <KV label="更新" w={36}>
              <span className="num" style={{ fontSize: 11.5 }}>
                {b.updated}
              </span>
            </KV>
          </div>
        </div>

        {/* Items */}
        <div
          style={{
            padding: "12px 16px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            结算明细
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            <span>
              底薪{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{baseSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              变动{" "}
              <span
                className="num"
                style={{ color: "var(--ink-700)", fontWeight: 600 }}
              >
                ¥{varSum.toLocaleString()}
              </span>
            </span>
            <span>·</span>
            <span>
              调整{" "}
              <span
                className="num"
                style={{
                  color: adjSum >= 0 ? "var(--ink-700)" : "var(--danger-600)",
                  fontWeight: 600,
                }}
              >
                {adjSum >= 0 ? "+" : ""}
                {adjSum}
              </span>
            </span>
          </div>
        </div>

        <DataTable
          dense
          columns={[
            {
              title: "主播",
              render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={r.streamer} size={26} />
                  <div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {r.streamer}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                    >
                      {r.id}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: "结算规则",
              render: (r) => <Badge tone="blue">{r.rule}</Badge>,
            },
            {
              title: "有效时长",
              align: "right",
              render: (r) => (
                <span className="num">{r.hours.toFixed(1)} h</span>
              ),
            },
            {
              title: "其他口径",
              align: "right",
              render: (r) => (
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  {r.qty}
                </span>
              ),
            },
            {
              title: "底薪",
              align: "right",
              render: (r) => (
                <span className="num">
                  {r.base ? "¥" + r.base.toLocaleString() : "—"}
                </span>
              ),
            },
            {
              title: "变动",
              align: "right",
              render: (r) => (
                <span className="num">¥{r.variable.toLocaleString()}</span>
              ),
            },
            {
              title: "调整",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{
                    color:
                      r.adjust === 0
                        ? "var(--ink-400)"
                        : r.adjust > 0
                          ? "var(--ok-600)"
                          : "var(--danger-600)",
                  }}
                >
                  {r.adjust === 0 ? "—" : (r.adjust > 0 ? "+" : "") + r.adjust}
                </span>
              ),
            },
            {
              title: "小计",
              align: "right",
              render: (r) => (
                <span
                  className="num"
                  style={{ fontWeight: 700, color: "var(--ink-900)" }}
                >
                  ¥{r.total.toLocaleString()}
                </span>
              ),
            },
          ]}
          rows={detailRows}
        />

        {/* Footer: actions */}
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            background: "var(--bg-soft)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {isLocked && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-500)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.Lock size={12} stroke="var(--ink-500)" />
              本批次已锁定 · 由 {b.creator} 于 {b.updated}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {isLocked ? (
            <>
              <Button kind="ghost" icon={<Icon.History size={14} />}>
                查看审计
              </Button>
              <Button kind="default" icon={<Icon.Export size={14} />}>
                导出 PDF
              </Button>
              <Button
                kind="danger"
                icon={<Icon.Unlock size={14} />}
                onClick={onReopenBatch}
                disabled={!!busyAction}
              >
                {busyAction === "reopen" ? "处理中…" : "重新打开"}
              </Button>
            </>
          ) : (
            <>
              <Button kind="ghost">取消</Button>
              <Button
                kind="default"
                icon={<Icon.Plus size={14} />}
                onClick={onAddManualItem}
                disabled={!!busyAction}
              >
                {busyAction === "manual" ? "处理中…" : "添加人工调整"}
              </Button>
              <Button kind="default">保存为草稿</Button>
              <Button
                kind="primary"
                icon={<Icon.Lock size={14} stroke="#fff" />}
                onClick={onLockBatch}
                disabled={!!busyAction}
              >
                {busyAction === "lock" ? "处理中…" : "确认并锁定"}
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Audit timeline */}
      <Card title="批次审计轨迹" padded={true}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            {
              time: "05-26 14:02",
              who: "李珩",
              text: "生成批次明细，应用主播默认结算规则",
              risk: false,
            },
            {
              time: "05-26 14:08",
              who: "陈一鸣",
              text: "修改青羽调整项 +200（原因：礼物校对差额）",
              risk: true,
            },
            {
              time: "05-26 14:11",
              who: "李珩",
              text: "确认批次并锁定",
              risk: true,
            },
          ].map((it, i, arr) => (
            <div key={i} style={{ display: "flex", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: it.risk
                      ? "var(--danger-600)"
                      : "var(--blue-600)",
                    marginTop: 4,
                  }}
                />
                {i < arr.length - 1 && (
                  <span
                    style={{
                      flex: 1,
                      width: 1,
                      background: "var(--line)",
                      marginTop: 4,
                    }}
                  />
                )}
              </div>
              <div
                style={{ flex: 1, paddingBottom: i < arr.length - 1 ? 6 : 0 }}
              >
                <div
                  style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--ink-400)" }}
                  >
                    {it.time}
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {it.who}
                  </span>
                  {it.risk && <Badge tone="red">高风险</Badge>}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-500)",
                    marginTop: 2,
                  }}
                >
                  {it.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===== src\screen-tasks.jsx =====
// ——— Screen: 排班与任务 ————————————————————————

function ScreenTasks({ go }) {
  const tasks = useOpsTasks();
  const [view, setView] = React.useState("board");
  const [project, setProject] = React.useState("all");
  const [selectedTask, setSelectedTask] = React.useState(null);

  const liveCount = tasks.filter((t) => t.status === "live").length;
  const pendingReportCount = tasks.filter(
    (t) => t.status === "pending_report",
  ).length;
  const pendingReviewCount = tasks.filter(
    (t) => t.status === "pending_review",
  ).length;
  const anomalyCount = tasks.filter(
    (t) => t.status === "abnormal" || t.anomaly,
  ).length;
  const todayCount = tasks.filter(
    (t) => t.dayIdx === SCHEDULE_WEEK.todayIdx,
  ).length;

  return (
    <>
      <PageHeader
        title="排班与任务"
        subtitle="项目维度排班看板 + 任务表格 · 任务完成依据为报数审核通过"
        actions={
          <>
            <Button kind="default" icon={<Icon.Upload size={14} />}>
              从 Excel 导入
            </Button>
            <Button kind="default" icon={<Icon.Calendar size={14} />}>
              批量排班
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              新建任务
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Top metrics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 14,
          }}
        >
          <Card>
            <Metric
              label="今日任务"
              value={todayCount}
              unit="个"
              hint="周三 05-27"
            />
          </Card>
          <Card>
            <Metric
              label="正在直播"
              value={liveCount}
              unit="个"
              accent={
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--blue-600)",
                    boxShadow: "0 0 0 3px rgba(30,80,200,0.25)",
                  }}
                />
              }
            />
          </Card>
          <Card>
            <Metric
              label="待报数 / 待审核"
              value={`${pendingReportCount} / ${pendingReviewCount}`}
            />
          </Card>
          <Card
            style={{ borderColor: anomalyCount > 0 ? "#F3C4C9" : undefined }}
          >
            <Metric
              label="异常任务"
              value={anomalyCount}
              unit="项"
              deltaTone="red"
              accent={
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--danger-600)",
                  }}
                />
              }
            />
          </Card>
          <Card>
            <Metric
              label="本周已排"
              value={tasks.length}
              unit="个"
              hint="共 8 位主播"
            />
          </Card>
        </div>

        <Card padded={false}>
          {/* View toggle + filters */}
          <div
            style={{
              padding: "0 14px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { key: "board", label: "项目排班看板" },
                { key: "list", label: "任务列表", count: tasks.length },
                { key: "anomaly", label: "异常任务", count: anomalyCount },
                { key: "mine", label: "我的任务" },
              ]}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ProjectFilter value={project} onChange={setProject} />
              <Button size="sm" kind="default" icon={<Icon.Filter size={13} />}>
                主播
              </Button>
              <Button size="sm" kind="default" icon={<Icon.Filter size={13} />}>
                状态
              </Button>
            </div>
          </div>

          <div>
            {view === "board" && (
              <ScheduleBoard project={project} onSelectTask={setSelectedTask} />
            )}
            {view === "list" && (
              <TaskList
                project={project}
                tasks={tasks}
                onSelectTask={setSelectedTask}
              />
            )}
            {view === "anomaly" && <AnomalyList tasks={tasks} />}
            {view === "mine" && <MyTasksView />}
          </div>
        </Card>
      </div>

      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </>
  );
}

function ProjectFilter({ value, onChange }) {
  return (
    <div
      style={{
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px 0 6px",
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        background: "#fff",
        fontSize: 12,
        color: "var(--ink-700)",
        cursor: "pointer",
      }}
    >
      <Icon.Project size={13} stroke="var(--ink-500)" />
      <span style={{ color: "var(--ink-400)" }}>项目：</span>
      <span style={{ fontWeight: 600 }}>
        {value === "all"
          ? "全部项目"
          : PROJECTS.find((p) => p.id === value)?.name || value}
      </span>
      <Icon.ChevDown size={12} stroke="var(--ink-400)" />
    </div>
  );
}

// ——— Schedule Board (week / streamer grid) ————————

function ScheduleBoard({ project, onSelectTask }) {
  const tasks = useOpsTasks();
  const [unit, setUnit] = React.useState("day"); // 'day' | 'hour'

  // Filter tasks
  const allowedProject = project === "all" ? null : project;
  const visibleStreamers = [
    "S-001",
    "S-002",
    "S-003",
    "S-004",
    "S-005",
    "S-006",
    "S-008",
  ];
  const liveStreamerIds = tasks
    .map((task) => task.streamerId)
    .filter((id) => !visibleStreamers.includes(id));
  const streamers = [...visibleStreamers, ...liveStreamerIds].map((id) => {
    const fromMock = STREAMERS.find((s) => s.id === id);
    if (fromMock) return fromMock;
    const task = tasks.find((item) => item.streamerId === id);
    return { id, alias: task?.streamerName || id };
  });

  const dayWidth = "minmax(140px, 1fr)";
  const HOUR_START = 12; // visible window: 12:00 - 24:00 (used in hour view)
  const HOUR_END = 24;

  return (
    <div>
      {/* Week toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-soft)",
        }}
      >
        <button style={iconBtn}>
          <Icon.ChevLeft size={14} />
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
          2026 · 5 月 · 第 22 周
        </div>
        <button style={iconBtn}>
          <Icon.ChevRight size={14} />
        </button>
        <Button size="sm" kind="default">
          今天
        </Button>

        {/* Unit toggle */}
        <div
          style={{
            display: "inline-flex",
            height: 28,
            padding: 2,
            background: "var(--ink-50)",
            borderRadius: 6,
            marginLeft: 4,
          }}
        >
          {[
            ["day", "1 天"],
            ["hour", "按小时"],
          ].map(([k, v]) => (
            <button
              key={k}
              onClick={() => setUnit(k)}
              style={{
                padding: "0 12px",
                height: 24,
                fontSize: 12,
                background: unit === k ? "#fff" : "transparent",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                color: unit === k ? "var(--blue-700)" : "var(--ink-500)",
                fontWeight: unit === k ? 600 : 500,
                boxShadow:
                  unit === k ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            gap: 12,
            fontSize: 11,
            color: "var(--ink-400)",
          }}
        >
          <Legend dot="var(--blue-600)" label="直播中" />
          <Legend dot="var(--violet-600)" label="待报数" />
          <Legend dot="var(--warn-600)" label="报数待审" />
          <Legend dot="var(--ok-600)" label="已完成" />
          <Legend dot="var(--danger-600)" label="异常" />
          <Legend dot="var(--ink-200)" label="待开播" />
        </div>
      </div>

      {/* Day header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `180px repeat(7, ${dayWidth})`,
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-soft)",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            fontSize: 11,
            color: "var(--ink-400)",
            fontWeight: 500,
            borderRight: "1px solid var(--line)",
          }}
        >
          主播 / 日期
        </div>
        {SCHEDULE_WEEK.days.map((d, i) => (
          <div
            key={i}
            style={{
              padding: "8px 12px",
              background: d.today ? "var(--blue-50)" : "transparent",
              borderRight: i < 6 ? "1px solid var(--line)" : "none",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: d.today ? "var(--blue-700)" : "var(--ink-900)",
                }}
              >
                {d.label}
              </span>
              <span
                className="num"
                style={{
                  fontSize: 11,
                  color: d.today ? "var(--blue-700)" : "var(--ink-400)",
                }}
              >
                {d.date}
              </span>
              {d.today && <Badge tone="blue">今天</Badge>}
            </div>
            {unit === "hour" && (
              <div style={{ fontSize: 10.5, color: "var(--ink-300)" }}>
                {HOUR_START}:00 - {HOUR_END}:00
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rows */}
      {streamers.map((s, ri) => {
        const sTasks = tasks.filter(
          (t) =>
            t.streamerId === s.id &&
            (!allowedProject || t.project === allowedProject),
        );
        return (
          <div
            key={s.id}
            style={{
              display: "grid",
              gridTemplateColumns: `180px repeat(7, ${dayWidth})`,
              borderBottom:
                ri < streamers.length - 1 ? "1px solid var(--line)" : "none",
              minHeight: unit === "day" ? 88 : 78,
            }}
          >
            {/* Streamer cell */}
            <div
              style={{
                padding: "10px 12px",
                borderRight: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "#fff",
              }}
            >
              <Avatar name={s.alias} size={30} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-900)",
                  }}
                >
                  {s.alias}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                >
                  {sTasks.length} 个任务 ·{" "}
                  {sTasks
                    .reduce((sum, t) => sum + (t.endHour - t.startHour), 0)
                    .toFixed(1)}
                  h
                </div>
              </div>
            </div>

            {/* Day cells */}
            {SCHEDULE_WEEK.days.map((d, di) => {
              const dayTasks = sTasks.filter((t) => t.dayIdx === di);
              return (
                <div
                  key={di}
                  style={{
                    position: "relative",
                    borderRight: di < 6 ? "1px solid var(--line)" : "none",
                    background: d.today
                      ? "rgba(238, 243, 255, 0.4)"
                      : "transparent",
                    padding: "8px 8px",
                  }}
                >
                  {/* Subtle hour mid-line only in hour mode */}
                  {unit === "hour" && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundImage:
                          "linear-gradient(to right, transparent calc(50% - 0.5px), rgba(15,23,42,0.04) calc(50% - 0.5px), rgba(15,23,42,0.04) calc(50% + 0.5px), transparent calc(50% + 0.5px))",
                        pointerEvents: "none",
                      }}
                    />
                  )}

                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {dayTasks.map((t) =>
                      unit === "day" ? (
                        <DayTaskBlock
                          key={t.id}
                          task={t}
                          onClick={() => onSelectTask(t)}
                        />
                      ) : (
                        <HourTaskBar
                          key={t.id}
                          task={t}
                          hourStart={HOUR_START}
                          hourEnd={HOUR_END}
                          onClick={() => onSelectTask(t)}
                        />
                      ),
                    )}
                    {dayTasks.length === 0 && (
                      <button
                        onClick={() =>
                          onSelectTask({
                            _new: true,
                            dayIdx: di,
                            streamerId: s.id,
                          })
                        }
                        style={{
                          background: "transparent",
                          border: "1px dashed var(--line-strong)",
                          borderRadius: 4,
                          height: unit === "day" ? 60 : 32,
                          color: "var(--ink-300)",
                          fontSize: 11,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          opacity: 0,
                          transition: "opacity 120ms",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.opacity = 0.8)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.opacity = 0)
                        }
                      >
                        <Icon.Plus size={11} stroke="var(--ink-400)" /> 排班
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Day-unit block — full width within its day cell
function DayTaskBlock({ task, onClick }) {
  const statusKey = task.anomaly ? "abnormal" : task.status;
  const st = TASK_STATUS[statusKey] || TASK_STATUS.pending_live;
  const tones = {
    blue: {
      bg: "var(--blue-50)",
      bar: "var(--blue-600)",
      text: "var(--blue-800)",
    },
    violet: {
      bg: "var(--violet-50)",
      bar: "var(--violet-600)",
      text: "var(--violet-600)",
    },
    amber: {
      bg: "var(--warn-50)",
      bar: "var(--warn-600)",
      text: "var(--warn-600)",
    },
    green: { bg: "var(--ok-50)", bar: "var(--ok-600)", text: "var(--ok-600)" },
    red: {
      bg: "var(--danger-50)",
      bar: "var(--danger-600)",
      text: "var(--danger-600)",
    },
    neutral: { bg: "#F1F4FA", bar: "var(--ink-300)", text: "var(--ink-500)" },
  };
  const c = tones[st.tone] || tones.neutral;
  const projectShort =
    PROJECTS.find((p) => p.id === task.project)?.product || task.project;
  const niceName = task.name.replace(/^.+·\s*/, "");

  return (
    <button
      onClick={onClick}
      title={task.name}
      style={{
        width: "100%",
        textAlign: "left",
        background: c.bg,
        border: "none",
        borderLeft: `3px solid ${c.bar}`,
        borderRadius: 4,
        padding: "6px 8px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 30,
      }}
    >
      {/* Top line: time + duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {statusKey === "live" && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: c.bar,
              boxShadow: `0 0 0 3px ${c.bar}33`,
              flexShrink: 0,
            }}
          />
        )}
        <span
          className="num"
          style={{ fontSize: 11, fontWeight: 600, color: c.text }}
        >
          {formatHour(task.startHour)} – {formatHour(task.endHour)}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="num"
          style={{ fontSize: 10, color: c.text, opacity: 0.75 }}
        >
          {(task.endHour - task.startHour).toFixed(1)}h
        </span>
      </div>
      {/* Second line: task name */}
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--ink-900)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.3,
        }}
      >
        {niceName}
      </div>
    </button>
  );
}

// Hour-unit bar — positioned within the 12-24h window
function HourTaskBar({ task, hourStart, hourEnd, onClick }) {
  const span = hourEnd - hourStart;
  const leftPct = Math.max(0, ((task.startHour - hourStart) / span) * 100);
  const widthPct = Math.min(
    100 - leftPct,
    ((task.endHour - task.startHour) / span) * 100,
  );
  const statusKey = task.anomaly ? "abnormal" : task.status;
  const st = TASK_STATUS[statusKey] || TASK_STATUS.pending_live;

  const tones = {
    blue: {
      bg: "var(--blue-50)",
      bar: "var(--blue-600)",
      text: "var(--blue-800)",
    },
    violet: {
      bg: "var(--violet-50)",
      bar: "var(--violet-600)",
      text: "var(--violet-600)",
    },
    amber: {
      bg: "var(--warn-50)",
      bar: "var(--warn-600)",
      text: "var(--warn-600)",
    },
    green: { bg: "var(--ok-50)", bar: "var(--ok-600)", text: "var(--ok-600)" },
    red: {
      bg: "var(--danger-50)",
      bar: "var(--danger-600)",
      text: "var(--danger-600)",
    },
    neutral: { bg: "#F1F4FA", bar: "var(--ink-300)", text: "var(--ink-500)" },
  };
  const c = tones[st.tone] || tones.neutral;
  const projectName =
    PROJECTS.find((p) => p.id === task.project)
      ?.name?.split("·")[0]
      ?.trim() ||
    task.projectName ||
    task.project;

  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        height: 30,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
      }}
      title={`${task.name} · ${formatHour(task.startHour)} - ${formatHour(task.endHour)}`}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          height: 30,
          left: leftPct + "%",
          width: widthPct + "%",
          background: c.bg,
          borderLeft: `2px solid ${c.bar}`,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          overflow: "hidden",
          minWidth: 14,
        }}
      >
        {statusKey === "live" && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: c.bar,
              marginRight: 4,
              flexShrink: 0,
              boxShadow: `0 0 0 3px ${c.bar}33`,
            }}
          />
        )}
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: c.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {task.name.replace(/^.+·\s*/, "")}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9.5,
            color: c.text,
            opacity: 0.7,
            flexShrink: 0,
          }}
          className="num"
        >
          {(task.endHour - task.startHour).toFixed(1)}h
        </span>
      </div>
    </button>
  );
}

function formatHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function Legend({ dot, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: dot }} />
      {label}
    </span>
  );
}

const iconBtn = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: "1px solid var(--line-strong)",
  background: "#fff",
  cursor: "pointer",
  color: "var(--ink-500)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

// ——— Task List ——————————————————————

function TaskList({ project, tasks, onSelectTask }) {
  const rows = tasks.filter((t) => project === "all" || t.project === project);
  return (
    <DataTable
      onRowClick={onSelectTask}
      columns={[
        {
          title: "任务 ID",
          render: (r) => (
            <span
              className="mono"
              style={{ fontWeight: 600, color: "var(--ink-900)" }}
            >
              {r.id}
            </span>
          ),
        },
        {
          title: "任务名 / 项目",
          render: (r) => (
            <div>
              <div style={{ fontWeight: 500, color: "var(--ink-900)" }}>
                {r.name}
              </div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {r.project} ·{" "}
                {r.type === "project"
                  ? "项目任务"
                  : r.type === "trial"
                    ? "试播任务"
                    : r.type === "training"
                      ? "训练任务"
                      : "临时任务"}
              </div>
            </div>
          ),
        },
        {
          title: "主播",
          render: (r) => {
            const s = STREAMERS.find((x) => x.id === r.streamerId);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={s?.alias || r.streamerName} size={24} />
                <span>{s?.alias || r.streamerName || r.streamerId}</span>
              </div>
            );
          },
        },
        {
          title: "计划时间",
          render: (r) => (
            <div className="num" style={{ fontSize: 12 }}>
              <div>{SCHEDULE_WEEK.days[r.dayIdx].date}</div>
              <div style={{ color: "var(--ink-400)", fontSize: 11 }}>
                {formatHour(r.startHour)} - {formatHour(r.endHour)}
              </div>
            </div>
          ),
        },
        {
          title: "时长",
          align: "right",
          render: (r) => (
            <span className="num" style={{ fontWeight: 600 }}>
              {(r.endHour - r.startHour).toFixed(1)} h
            </span>
          ),
        },
        {
          title: "状态",
          render: (r) => {
            const k = r.anomaly ? "abnormal" : r.status;
            const st = TASK_STATUS[k] || TASK_STATUS.pending_live;
            return (
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
            );
          },
        },
        {
          title: "异常",
          render: (r) =>
            r.anomaly ? (
              <Badge tone={ANOMALY_TYPES[r.anomaly].tone}>
                {ANOMALY_TYPES[r.anomaly].label}
              </Badge>
            ) : (
              <span style={{ color: "var(--ink-300)" }}>—</span>
            ),
        },
        {
          title: "",
          render: () => (
            <button
              style={{
                width: 24,
                height: 24,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-400)",
              }}
            >
              <Icon.More size={14} />
            </button>
          ),
        },
      ]}
      rows={rows}
    />
  );
}

// ——— Anomaly List ———————————————————

function AnomalyList({ tasks }) {
  const anomalies = tasks
    .filter((t) => t.anomaly)
    .map((t) => ({
      ...t,
      streamer:
        STREAMERS.find((s) => s.id === t.streamerId)?.alias || t.streamerName,
      typeKey: t.anomaly,
    }));

  // Group by type
  const groups = {};
  anomalies.forEach((a) => {
    (groups[a.typeKey] = groups[a.typeKey] || []).push(a);
  });

  return (
    <div
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
    >
      {/* Bulk action strip */}
      <div
        style={{
          padding: "10px 14px",
          background: "var(--bg-soft)",
          borderRadius: 8,
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Icon.Warn size={16} stroke="var(--danger-600)" />
        <div style={{ flex: 1, fontSize: 12.5, color: "var(--ink-700)" }}>
          检测到{" "}
          <b className="num" style={{ color: "var(--danger-600)" }}>
            {anomalies.length}
          </b>{" "}
          项异常 · 系统每小时自动扫描，扫描结果同步推送项目运营。
        </div>
        <Button size="sm" kind="default">
          扫描历史
        </Button>
        <Button size="sm" kind="primary">
          批量分派处理
        </Button>
      </div>

      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Badge tone={ANOMALY_TYPES[type].tone} dot>
              {ANOMALY_TYPES[type].label}
            </Badge>
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              {items.length} 项
            </span>
          </div>
          <Card padded={false}>
            {items.map((a, i) => (
              <div
                key={a.id}
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderBottom:
                    i < items.length - 1 ? "1px solid var(--line)" : "none",
                }}
              >
                <Avatar name={a.streamer} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "baseline", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {a.streamer}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {a.id} · {a.project}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-500)",
                      marginTop: 2,
                    }}
                  >
                    {a.name} · {SCHEDULE_WEEK.days[a.dayIdx].date}{" "}
                    {formatHour(a.startHour)} - {formatHour(a.endHour)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                    检测于 {((Math.random() * 8) | 0) + 1}h 前
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" kind="ghost">
                      联系主播
                    </Button>
                    <Button size="sm" kind="default">
                      查看任务
                    </Button>
                    <Button size="sm" kind="primary">
                      标记处理
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

// ——— My Tasks (streamer view) —————————————

function MyTasksView() {
  return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: 480,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <Icon.Streamer size={24} stroke="var(--blue-700)" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-900)" }}>
          主播端「我的任务」视图
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-400)", marginTop: 6 }}>
          切换到主播账号后可看到任务卡片列表（含开始 /
          停止按钮、上传截图入口、报数审核结果）。当前是负责人视角。
        </div>
        <Button kind="default" style={{ marginTop: 16 }}>
          预览主播端 →
        </Button>
      </div>
    </div>
  );
}

// ——— Task Drawer (right panel) ——————————

function TaskDrawer({ task, onClose }) {
  if (task._new) return <NewTaskDrawer task={task} onClose={onClose} />;

  const s = STREAMERS.find((x) => x.id === task.streamerId);
  const p = PROJECTS.find((x) => x.id === task.project);
  const streamerName = s?.alias || task.streamerName || task.streamerId;
  const projectName = p?.name || task.projectName || task.project;
  const statusKey = task.anomaly ? "abnormal" : task.status;
  const st = TASK_STATUS[statusKey];

  return (
    <Drawer
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className="mono"
            style={{ fontSize: 13, color: "var(--ink-400)" }}
          >
            {task.id}
          </span>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
          {task.anomaly && (
            <Badge tone={ANOMALY_TYPES[task.anomaly].tone}>
              {ANOMALY_TYPES[task.anomaly].label}
            </Badge>
          )}
        </div>
      }
    >
      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {task.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 4 }}>
            {projectName} · {p?.vendor || "经营舱"}
          </div>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <DrawerStat
            label="计划开播"
            value={`${SCHEDULE_WEEK.days[task.dayIdx].date} ${formatHour(task.startHour)}`}
          />
          <DrawerStat
            label="计划结束"
            value={`${SCHEDULE_WEEK.days[task.dayIdx].date} ${formatHour(task.endHour)}`}
          />
          <DrawerStat
            label="计划时长"
            value={`${(task.endHour - task.startHour).toFixed(1)} h`}
          />
          <DrawerStat
            label="任务类型"
            value={
              task.type === "project"
                ? "项目任务"
                : task.type === "trial"
                  ? "试播任务"
                  : task.type === "training"
                    ? "训练任务"
                    : "临时任务"
            }
          />
        </div>

        <div
          style={{
            padding: 14,
            background: "var(--bg-soft)",
            borderRadius: 8,
            border: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <Avatar name={streamerName} size={36} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                {streamerName}
              </div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {s?.id || task.streamerId} ·{" "}
                {s?.platforms?.join(" / ") || "直播账号"}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <Badge tone="blue">{s?.defaultRule || "CPT · 审核后入池"}</Badge>
          </div>
          <KV label="是否需要点击开播 / 停止">
            {(p?.needStartStop ?? true) ? "是 · 主播需在 App 内操作" : "否"}
          </KV>
          <KV label="录屏要求">
            {(p?.needScreening ?? true) ? "本项目强制录屏" : "不强制"}
          </KV>
        </div>

        {/* Status timeline */}
        <div>
          <SectionTitle hint="任务流转">状态轨迹</SectionTitle>
          <Timeline
            events={[
              {
                time: "05-25 11:02",
                who: "李珩",
                action: "排班创建",
                done: true,
              },
              {
                time: "05-27 19:58",
                who: streamerName,
                action: "点击开始直播",
                done: statusKey !== "pending_live",
              },
              {
                time: statusKey === "live" ? "进行中…" : "05-27 22:48",
                who: streamerName,
                action: "点击停止 + 上传下播截图",
                done: [
                  "pending_report",
                  "pending_review",
                  "completed",
                  "approved",
                ].includes(statusKey),
                current: statusKey === "live",
              },
              {
                time: "—",
                who: streamerName,
                action: "主播确认 OCR 结果",
                done: ["pending_review", "completed", "approved"].includes(
                  statusKey,
                ),
              },
              {
                time: "—",
                who: "苏婉 · 次级运营",
                action: "报数审核",
                done: ["completed", "approved"].includes(statusKey),
              },
            ]}
          />
        </div>

        {task.anomaly && (
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: "var(--danger-50)",
              border: "1px solid #F3C4C9",
              display: "flex",
              gap: 12,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--danger-600)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Warn size={14} stroke="#fff" />
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--danger-600)",
                }}
              >
                {ANOMALY_TYPES[task.anomaly].label}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-700)", marginTop: 4 }}
              >
                {task.anomaly === "unstopped" &&
                  "直播持续超过 48 小时未上传下播截图，建议主动联系主播并提示截图上传。"}
                {task.anomaly === "late_report" &&
                  "已超过项目上传期限，建议运营提示主播尽快补传截图。"}
                {task.anomaly === "short" &&
                  "实际直播时长低于计划时长 75%，触发时长不足异常。"}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          gap: 8,
        }}
      >
        <Button kind="danger" icon={<Icon.X size={14} />}>
          取消任务
        </Button>
        <div style={{ flex: 1 }} />
        <Button kind="default">编辑排班</Button>
        <Button kind="primary">查看报数</Button>
      </div>
    </Drawer>
  );
}

function NewTaskDrawer({ task, onClose }) {
  const s = STREAMERS.find((x) => x.id === task.streamerId);
  return (
    <Drawer onClose={onClose} title="新建任务">
      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <FormField label="主播">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "1px solid var(--line-strong)",
              borderRadius: 6,
            }}
          >
            <Avatar name={s?.alias} size={24} />
            <span style={{ fontWeight: 600 }}>{s?.alias}</span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-400)" }}
            >
              {s?.id}
            </span>
          </div>
        </FormField>
        <FormField label="任务类型">
          <SegmentedControl
            options={["项目任务", "试播任务", "训练任务", "临时任务"]}
            value="项目任务"
          />
        </FormField>
        <FormField label="所属项目">
          <FauxSelect value="P-2406 · 原神 4.7 版本品宣专项" />
        </FormField>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <FormField label="计划开播">
            <FauxSelect
              value={`${SCHEDULE_WEEK.days[task.dayIdx].date} 20:00`}
            />
          </FormField>
          <FormField label="计划结束">
            <FauxSelect
              value={`${SCHEDULE_WEEK.days[task.dayIdx].date} 23:30`}
            />
          </FormField>
        </div>
        <FormField label="任务说明（可选）">
          <textarea
            placeholder="特殊要求、口径备注等"
            style={{
              width: "100%",
              minHeight: 72,
              padding: "8px 10px",
              border: "1px solid var(--line-strong)",
              borderRadius: 6,
              fontSize: 13,
              color: "var(--ink-700)",
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
        </FormField>
      </div>
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <Button kind="default" onClick={onClose}>
          取消
        </Button>
        <Button kind="default">保存草稿</Button>
        <Button kind="primary">创建任务</Button>
      </div>
    </Drawer>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-500)",
          marginBottom: 6,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl({ options, value }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((o) => (
        <button
          key={o}
          style={{
            flex: 1,
            height: 30,
            fontSize: 12,
            background: o === value ? "var(--blue-50)" : "#fff",
            border: `1px solid ${o === value ? "var(--blue-500)" : "var(--line-strong)"}`,
            color: o === value ? "var(--blue-700)" : "var(--ink-500)",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: o === value ? 600 : 500,
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function FauxSelect({ value }) {
  return (
    <div
      style={{
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 13,
        color: "var(--ink-900)",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      <span>{value}</span>
      <Icon.ChevDown size={14} stroke="var(--ink-400)" />
    </div>
  );
}

function DrawerStat({ label, value }) {
  return (
    <div
      style={{
        padding: 12,
        background: "var(--bg-soft)",
        border: "1px solid var(--line)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink-900)",
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Timeline({ events }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            paddingBottom: i < events.length - 1 ? 14 : 0,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: e.current
                  ? "var(--blue-600)"
                  : e.done
                    ? "var(--ok-600)"
                    : "var(--ink-100)",
                border: `2px solid ${e.current ? "var(--blue-600)" : e.done ? "var(--ok-600)" : "#fff"}`,
                boxShadow: e.current
                  ? "0 0 0 3px rgba(30,80,200,0.18)"
                  : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {e.done && !e.current && <Icon.Check size={9} stroke="#fff" />}
            </span>
            {i < events.length - 1 && (
              <span
                style={{
                  flex: 1,
                  width: 1.5,
                  background: e.done ? "var(--ok-600)" : "var(--ink-100)",
                  marginTop: 2,
                }}
              />
            )}
          </div>
          <div style={{ flex: 1, paddingTop: 1 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color:
                  e.done || e.current ? "var(--ink-900)" : "var(--ink-400)",
              }}
            >
              {e.action}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}
            >
              {e.who}{" "}
              <span style={{ marginLeft: 6 }} className="num">
                {e.time}
              </span>
              {e.current && (
                <Badge tone="blue" style={{ marginLeft: 6 }}>
                  当前
                </Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Drawer({ children, onClose, title }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 460,
        background: "#fff",
        borderLeft: "1px solid var(--line)",
        boxShadow: "-8px 0 24px rgba(15,23,42,0.08)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
      }}
    >
      <div
        style={{
          height: 56,
          padding: "0 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
        <button
          onClick={onClose}
          style={{
            width: 30,
            height: 30,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--ink-400)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.X size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
    </div>
  );
}

// ===== src\screen-org.jsx =====
// ——— Screen: 组织与权限 ————————————————————————

const MEMBERS = [
  {
    id: "u_01",
    name: "陈一鸣",
    role: "owner",
    dept: "总经办",
    email: "chen@galaxy-mcn.com",
    phone: "138****2901",
    mfa: true,
    status: "active",
    lastSeen: "刚刚",
    joined: "2025-08-12",
  },
  {
    id: "u_02",
    name: "李珩",
    role: "ops_manager",
    dept: "直播运营组",
    email: "li.heng@galaxy-mcn.com",
    phone: "139****1108",
    mfa: true,
    status: "active",
    lastSeen: "2 分钟前",
    joined: "2025-09-04",
  },
  {
    id: "u_03",
    name: "苏婉",
    role: "ops_manager",
    dept: "直播运营组",
    email: "su.wan@galaxy-mcn.com",
    phone: "136****8842",
    mfa: true,
    status: "active",
    lastSeen: "14 分钟前",
    joined: "2025-09-20",
  },
  {
    id: "u_04",
    name: "周筱筱",
    role: "operator_business",
    dept: "商务组",
    email: "zhou.xx@galaxy-mcn.com",
    phone: "155****3320",
    mfa: false,
    status: "active",
    lastSeen: "1 小时前",
    joined: "2025-11-02",
    projects: 4,
  },
  {
    id: "u_05",
    name: "吴桐",
    role: "operator_business",
    dept: "商务组",
    email: "wu.tong@galaxy-mcn.com",
    phone: "177****9012",
    mfa: true,
    status: "active",
    lastSeen: "3 小时前",
    joined: "2025-12-15",
    projects: 2,
  },
  {
    id: "u_06",
    name: "何琳",
    role: "operator_business",
    dept: "商务组",
    email: "he.lin@galaxy-mcn.com",
    phone: "186****4521",
    mfa: false,
    status: "active",
    lastSeen: "昨日",
    joined: "2026-01-08",
    projects: 3,
  },
  {
    id: "u_07",
    name: "范泽",
    role: "finance",
    dept: "财务",
    email: "fan.ze@galaxy-mcn.com",
    phone: "189****7733",
    mfa: true,
    status: "active",
    lastSeen: "5 小时前",
    joined: "2025-09-30",
  },
  {
    id: "u_08",
    name: "韩冬",
    role: "finance",
    dept: "财务",
    email: "han.dong@galaxy-mcn.com",
    phone: "180****0099",
    mfa: true,
    status: "inactive",
    lastSeen: "6 天前",
    joined: "2025-10-15",
  },
];

const PERM_MATRIX = [
  {
    group: "组织与成员",
    rows: [
      {
        feat: "组织设置",
        o: "full",
        m: "read",
        b: "none",
        f: "none",
        s: "none",
      },
      {
        feat: "成员与角色管理",
        o: "full",
        m: "partial",
        b: "none",
        f: "none",
        s: "none",
      },
    ],
  },
  {
    group: "项目",
    rows: [
      {
        feat: "项目管理 / 发布",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "scoped",
      },
      {
        feat: "项目分配",
        o: "full",
        m: "full",
        b: "scoped",
        f: "none",
        s: "none",
      },
      {
        feat: "结算规则配置",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "none",
      },
    ],
  },
  {
    group: "主播 & 招募",
    rows: [
      {
        feat: "主播档案 / 风险",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "self",
      },
      {
        feat: "录屏审核",
        o: "full",
        m: "full",
        b: "scoped",
        f: "none",
        s: "self",
      },
      {
        feat: "加入项目二次确认",
        o: "full",
        m: "full",
        b: "none",
        f: "none",
        s: "none",
      },
    ],
  },
  {
    group: "执行",
    rows: [
      {
        feat: "排班 / 任务",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "self",
      },
      {
        feat: "报数上传 / 代传",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "self",
      },
      {
        feat: "报数审核",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "none",
      },
    ],
  },
  {
    group: "财务 & 结算",
    rows: [
      {
        feat: "结算明细查看",
        o: "full",
        m: "masked",
        b: "none",
        f: "full",
        s: "self",
      },
      {
        feat: "结算批次创建",
        o: "full",
        m: "full",
        b: "scoped",
        f: "read",
        s: "none",
      },
      {
        feat: "锁定 / 重新打开",
        o: "full",
        m: "partial",
        b: "none",
        f: "none",
        s: "none",
      },
      {
        feat: "财务表格导出",
        o: "full",
        m: "none",
        b: "none",
        f: "full",
        s: "none",
      },
    ],
  },
  {
    group: "治理",
    rows: [
      {
        feat: "审计日志",
        o: "full",
        m: "partial",
        b: "scoped",
        f: "partial",
        s: "none",
      },
      {
        feat: "数据导出中心",
        o: "full",
        m: "partial",
        b: "scoped",
        f: "partial",
        s: "none",
      },
    ],
  },
];

const PERM_LEVELS = {
  full: {
    label: "全部",
    tone: "green",
    icon: "Check",
    shortColor: "#0E8A4D",
    cell: "var(--ok-50)",
    fg: "var(--ok-600)",
  },
  partial: {
    label: "部分",
    tone: "blue",
    icon: "Check",
    shortColor: "#1E50C8",
    cell: "var(--blue-50)",
    fg: "var(--blue-700)",
  },
  read: {
    label: "只读",
    tone: "violet",
    icon: "Eye",
    shortColor: "#5B4BD1",
    cell: "var(--violet-50)",
    fg: "var(--violet-600)",
  },
  scoped: {
    label: "指定项目",
    tone: "teal",
    icon: "Eye",
    shortColor: "#0E7C77",
    cell: "var(--teal-50)",
    fg: "var(--teal-600)",
  },
  masked: {
    label: "脱敏",
    tone: "amber",
    icon: "Eye",
    shortColor: "#A86A00",
    cell: "var(--warn-50)",
    fg: "var(--warn-600)",
  },
  self: {
    label: "仅本人",
    tone: "neutral",
    icon: "Eye",
    shortColor: "#64748B",
    cell: "var(--ink-50)",
    fg: "var(--ink-500)",
  },
  none: {
    label: "无",
    tone: "neutral",
    icon: "X",
    shortColor: "#CBD5E1",
    cell: "transparent",
    fg: "var(--ink-300)",
  },
};

const SENSITIVE_FIELDS = [
  {
    field: "厂家单价 / 厂家应付",
    roles: ["owner", "finance"],
    note: "主播端 / 商务端不可见",
  },
  {
    field: "主播成本明细",
    roles: ["owner", "finance", "ops_manager"],
    note: "运营负责人可见，商务可配置开关",
  },
  {
    field: "MCN 毛利 / 利润率",
    roles: ["owner", "finance"],
    note: "导出时自动脱敏",
  },
  {
    field: "回款 / 付款状态",
    roles: ["owner", "finance"],
    note: "第一版暂不开放修改",
  },
  {
    field: "合同金额 / 发票信息",
    roles: ["owner", "finance"],
    note: "附件存储于私有 bucket",
  },
  {
    field: "供应商内部成本",
    roles: ["owner", "finance"],
    note: "厂家交付包中自动剔除",
  },
  {
    field: "其他主播结算金额",
    roles: ["owner", "finance", "ops_manager"],
    note: "主播仅能查看自己金额",
  },
];

function ScreenOrg({ go }) {
  const [tab, setTab] = React.useState("overview");

  return (
    <>
      <PageHeader
        title="组织与权限"
        subtitle="多组织数据隔离 · 字段级脱敏 · AI 查询继承用户权限"
        actions={
          <>
            <Button kind="default" icon={<Icon.History size={14} />}>
              权限变更日志
            </Button>
            <Button kind="primary" icon={<Icon.Plus size={14} stroke="#fff" />}>
              邀请成员
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Org info card */}
        <Card padded={true}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                background:
                  "linear-gradient(135deg, var(--blue-600), var(--blue-800))",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                boxShadow: "0 4px 14px rgba(30,80,200,0.28)",
              }}
            >
              星
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--ink-900)",
                  }}
                >
                  星河直播
                </h2>
                <Badge tone="blue" dot>
                  专业版
                </Badge>
                <Badge tone="green" dot>
                  已认证
                </Badge>
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 4 }}
              >
                <span className="mono">org_galaxy_001</span> · 杭州市余杭区 ·
                MCN 经营舱 v1.2 · 创建于 2025-08-12
              </div>
            </div>
            <Button kind="default" icon={<Icon.Settings size={14} />}>
              组织设置
            </Button>
          </div>

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 24,
            }}
          >
            <StatCell label="活跃成员" value="32" detail="本月 +3" />
            <StatCell label="主播档案" value="187" detail="48 位签约" />
            <StatCell label="进行中项目" value="4" detail="2 个高优先级" />
            <StatCell label="存储用量" value="84.2 GB" detail="配额 500 GB" />
            <StatCell
              label="API 调用 (本月)"
              value="14.6k"
              detail="OCR · AI · 导出"
            />
          </div>
        </Card>

        <Card padded={false}>
          <div
            style={{ padding: "0 14px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "角色总览" },
                { key: "members", label: "成员管理", count: MEMBERS.length },
                { key: "matrix", label: "权限矩阵" },
                {
                  key: "sensitive",
                  label: "敏感字段脱敏",
                  count: SENSITIVE_FIELDS.length,
                },
                { key: "security", label: "安全策略" },
              ]}
            />
          </div>
          <div style={{ padding: 20 }}>
            {tab === "overview" && <RoleOverview />}
            {tab === "members" && <MemberList />}
            {tab === "matrix" && <PermMatrix />}
            {tab === "sensitive" && <SensitiveFields />}
            {tab === "security" && <SecurityPolicy />}
          </div>
        </Card>
      </div>
    </>
  );
}

function StatCell({ label, value, detail }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "var(--ink-900)",
          marginTop: 4,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      {detail && (
        <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}>
          {detail}
        </div>
      )}
    </div>
  );
}

// ——— Role Overview ————————————————————————

function RoleOverview() {
  const counts = {};
  MEMBERS.forEach((m) => {
    counts[m.role] = (counts[m.role] || 0) + 1;
  });

  const roleCards = [
    {
      key: "owner",
      title: "负责人",
      code: "owner",
      tone: "red",
      desc: "组织最高权限，掌握全部数据、财务结果与权限变更决策。",
      perms: [
        "组织 / 成员 / 角色管理",
        "所有项目、主播、结算",
        "可重新打开锁定批次",
        "审计日志全量查看",
      ],
    },
    {
      key: "ops_manager",
      title: "运营负责人",
      code: "ops_manager",
      tone: "blue",
      desc: "负责项目执行、主播管理、排班审核与运营数据决策。",
      perms: [
        "所有项目执行权限",
        "录屏 / 报数 / 排班全审核",
        "可发布项目",
        "可锁定结算批次",
      ],
    },
    {
      key: "operator_business",
      title: "次级运营 / 商务",
      code: "operator_business",
      tone: "teal",
      desc: "只看被分配的项目，执行具体运营或维护主播与厂商沟通。",
      perms: [
        "指定项目可见",
        "可创建项目草稿",
        "录屏 / 报数审核",
        "导出候选 / 执行类表格",
      ],
    },
    {
      key: "finance",
      title: "财务",
      code: "finance",
      tone: "violet",
      desc: "负责结算核对、财务导出、凭证管理和财务审计。",
      perms: [
        "结算明细全字段可见",
        "可导出财务表格",
        "审计 / 结算日志只读",
        "第一版不直接改金额",
      ],
    },
    {
      key: "streamer",
      title: "主播",
      code: "streamer",
      tone: "neutral",
      desc: "只处理自己的项目、任务、录屏、报数和个人结算。",
      perms: [
        "自己的任务 / 报数 / 录屏",
        "自己金额可见",
        "AI 卡点诊断",
        "财务字段全量隐藏",
      ],
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 14,
      }}
    >
      {roleCards.map((r) => (
        <RoleCard key={r.key} {...r} count={counts[r.code] || 0} />
      ))}
    </div>
  );
}

function RoleCard({ key, title, code, tone, desc, perms, count }) {
  const toneMap = {
    red: { bar: "var(--danger-600)", fg: "var(--danger-600)" },
    blue: { bar: "var(--blue-600)", fg: "var(--blue-700)" },
    teal: { bar: "var(--teal-600)", fg: "var(--teal-600)" },
    violet: { bar: "var(--violet-600)", fg: "var(--violet-600)" },
    neutral: { bar: "var(--ink-300)", fg: "var(--ink-500)" },
  };
  const c = toneMap[tone];

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: 16,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: c.bar,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {title}
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-400)", marginTop: 2 }}
          >
            {code}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            className="num"
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: c.fg,
              letterSpacing: "-0.01em",
            }}
          >
            {count > 0 ? count : "—"}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>
            {count > 0 ? "位成员" : "主播端"}
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 12,
          color: "var(--ink-500)",
          minHeight: 36,
          marginBottom: 12,
        }}
      >
        {desc}
      </div>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          marginTop: "auto",
        }}
      >
        {perms.map((p, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 6,
              fontSize: 11.5,
              color: "var(--ink-700)",
            }}
          >
            <Icon.Check size={11} stroke={c.bar} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ——— Members table ———————————————————————

function MemberList() {
  const [filter, setFilter] = React.useState("all");
  const rows =
    filter === "all" ? MEMBERS : MEMBERS.filter((m) => m.role === filter);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <SearchInput placeholder="姓名 / 邮箱 / 手机" width={240} />
        <RoleFilter value={filter} onChange={setFilter} />
        <Button kind="default" icon={<Icon.Filter size={13} />}>
          部门
        </Button>
        <Button kind="default" icon={<Icon.Filter size={13} />}>
          状态
        </Button>
        <div style={{ flex: 1 }} />
        <Button kind="default" icon={<Icon.Export size={13} />}>
          导出成员表
        </Button>
        <Button kind="primary" icon={<Icon.Plus size={13} stroke="#fff" />}>
          邀请成员
        </Button>
      </div>

      <Card padded={false}>
        <DataTable
          columns={[
            {
              title: "成员",
              render: (m) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={m.name} size={32} />
                  <div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{ fontWeight: 600, color: "var(--ink-900)" }}
                      >
                        {m.name}
                      </span>
                      {m.status === "inactive" && (
                        <Badge tone="neutral">已停用</Badge>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {m.id} · {m.email}
                    </div>
                  </div>
                </div>
              ),
            },
            { title: "角色", render: (m) => <RoleBadge role={m.role} /> },
            {
              title: "部门",
              render: (m) => (
                <span style={{ fontSize: 12, color: "var(--ink-700)" }}>
                  {m.dept}
                </span>
              ),
            },
            {
              title: "负责项目",
              align: "right",
              render: (m) =>
                m.projects != null ? (
                  <span className="num">{m.projects} 个</span>
                ) : (
                  <span style={{ color: "var(--ink-300)" }}>—</span>
                ),
            },
            {
              title: "手机",
              render: (m) => (
                <span className="mono" style={{ fontSize: 12 }}>
                  {m.phone}
                </span>
              ),
            },
            {
              title: "双因素",
              render: (m) =>
                m.mfa ? (
                  <Badge tone="green" dot>
                    已启用
                  </Badge>
                ) : (
                  <Badge tone="amber" dot>
                    未启用
                  </Badge>
                ),
            },
            {
              title: "最近活跃",
              render: (m) => (
                <span
                  className="num"
                  style={{ fontSize: 12, color: "var(--ink-500)" }}
                >
                  {m.lastSeen}
                </span>
              ),
            },
            {
              title: "加入",
              render: (m) => (
                <span
                  className="num"
                  style={{ fontSize: 12, color: "var(--ink-400)" }}
                >
                  {m.joined}
                </span>
              ),
            },
            {
              title: "操作",
              align: "right",
              render: (m) => (
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <Button size="sm" kind="default">
                    编辑角色
                  </Button>
                  <button
                    style={{
                      width: 26,
                      height: 26,
                      border: "1px solid var(--line-strong)",
                      background: "#fff",
                      borderRadius: 6,
                      cursor: "pointer",
                      color: "var(--ink-400)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon.More size={14} />
                  </button>
                </div>
              ),
            },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

function RoleFilter({ value, onChange }) {
  const opts = [
    { key: "all", label: "全部角色" },
    { key: "owner", label: "负责人" },
    { key: "ops_manager", label: "运营负责人" },
    { key: "operator_business", label: "次级运营" },
    { key: "finance", label: "财务" },
  ];
  const cur = opts.find((o) => o.key === value);
  return (
    <div
      style={{
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#fff",
        fontSize: 12,
        color: "var(--ink-700)",
        cursor: "pointer",
      }}
    >
      <Icon.Streamer size={13} stroke="var(--ink-500)" />
      <span style={{ color: "var(--ink-400)" }}>角色：</span>
      <span style={{ fontWeight: 600 }}>{cur?.label}</span>
      <Icon.ChevDown size={12} stroke="var(--ink-400)" />
    </div>
  );
}

function RoleBadge({ role }) {
  const map = {
    owner: { tone: "red", label: "负责人" },
    ops_manager: { tone: "blue", label: "运营负责人" },
    operator_business: { tone: "teal", label: "次级运营" },
    finance: { tone: "violet", label: "财务" },
    streamer: { tone: "neutral", label: "主播" },
  };
  const m = map[role] || map.streamer;
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

// ——— Permission Matrix ——————————————————————

function PermMatrix() {
  const roleCols = [
    { key: "o", label: "负责人", sub: "owner", tone: "red" },
    { key: "m", label: "运营负责人", sub: "ops_manager", tone: "blue" },
    { key: "b", label: "次级运营", sub: "operator_business", tone: "teal" },
    { key: "f", label: "财务", sub: "finance", tone: "violet" },
    { key: "s", label: "主播", sub: "streamer", tone: "neutral" },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            跨模块 × 角色权限矩阵
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 4 }}>
            该矩阵作为数据库 RLS、服务端字段过滤、前端按钮控制的唯一来源
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {Object.entries(PERM_LEVELS)
            .filter(([k]) => k !== "none")
            .map(([k, v]) => (
              <span
                key={k}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  background: v.cell,
                  color: v.fg,
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: v.shortColor,
                  }}
                />
                {v.label}
              </span>
            ))}
        </div>
      </div>

      <Card padded={false}>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    ...mthStyle,
                    width: 200,
                    textAlign: "left",
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--bg-soft)",
                  }}
                >
                  能力 / 角色
                </th>
                {roleCols.map((c) => (
                  <th key={c.key} style={{ ...mthStyle, textAlign: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <RoleBadge role={c.sub} />
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--ink-400)" }}
                      >
                        {c.sub}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_MATRIX.map((g, gi) => (
                <React.Fragment key={g.group}>
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: "10px 14px",
                        background: "var(--bg-soft)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--ink-400)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        borderTop: gi > 0 ? "1px solid var(--line)" : "none",
                        borderBottom: "1px solid var(--line)",
                        position: "sticky",
                        left: 0,
                      }}
                    >
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r, ri) => (
                    <tr key={r.feat}>
                      <td
                        style={{
                          ...mtdStyle,
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          fontWeight: 500,
                          color: "var(--ink-900)",
                        }}
                      >
                        {r.feat}
                      </td>
                      {roleCols.map((c) => (
                        <PermCell key={c.key} level={r[c.key]} />
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const mthStyle = {
  padding: "12px 14px",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--ink-400)",
  background: "var(--bg-soft)",
  borderBottom: "1px solid var(--line)",
  position: "sticky",
  top: 0,
};
const mtdStyle = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--line)",
};

function PermCell({ level }) {
  const l = PERM_LEVELS[level] || PERM_LEVELS.none;
  return (
    <td
      style={{
        ...mtdStyle,
        textAlign: "center",
      }}
    >
      {level === "none" ? (
        <Icon.X size={14} stroke="var(--ink-200)" />
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 4,
            background: l.cell,
            color: l.fg,
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          {l.label}
        </span>
      )}
    </td>
  );
}

// ——— Sensitive Fields ——————————————————————

function SensitiveFields() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: 14,
          background: "var(--blue-50)",
          border: "1px solid var(--blue-200)",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "var(--blue-600)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Lock size={14} stroke="#fff" />
        </span>
        <div
          style={{
            flex: 1,
            fontSize: 12.5,
            color: "var(--ink-700)",
            lineHeight: 1.7,
          }}
        >
          以下字段被识别为「敏感字段」，由 <b>服务端 DTO + 安全视图</b>{" "}
          双重过滤，与前端隐藏无关。 主播端
          AI、导出模板字段白名单与厂家交付包均会自动剔除未授权字段。
        </div>
      </div>

      <Card padded={false}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th style={mthStyle}>敏感字段</th>
              <th style={{ ...mthStyle, textAlign: "center" }}>负责人</th>
              <th style={{ ...mthStyle, textAlign: "center" }}>运营负责人</th>
              <th style={{ ...mthStyle, textAlign: "center" }}>次级运营</th>
              <th style={{ ...mthStyle, textAlign: "center" }}>财务</th>
              <th style={{ ...mthStyle, textAlign: "center" }}>主播</th>
              <th style={{ ...mthStyle, textAlign: "left" }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {SENSITIVE_FIELDS.map((s) => (
              <tr key={s.field}>
                <td
                  style={{
                    ...mtdStyle,
                    fontWeight: 500,
                    color: "var(--ink-900)",
                  }}
                >
                  {s.field}
                </td>
                {[
                  "owner",
                  "ops_manager",
                  "operator_business",
                  "finance",
                  "streamer",
                ].map((r) => (
                  <td key={r} style={{ ...mtdStyle, textAlign: "center" }}>
                    {s.roles.includes(r) ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: "var(--ok-50)",
                          color: "var(--ok-600)",
                        }}
                      >
                        <Icon.Check size={12} />
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: "var(--ink-50)",
                          color: "var(--ink-300)",
                        }}
                      >
                        <Icon.X size={11} />
                      </span>
                    )}
                  </td>
                ))}
                <td
                  style={{ ...mtdStyle, fontSize: 12, color: "var(--ink-500)" }}
                >
                  {s.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ——— Security Policy ——————————————————————

function SecurityPolicy() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <PolicyCard
        title="访问与会话"
        icon="Lock"
        items={[
          {
            label: "强制双因素 (MFA)",
            val: "负责人 / 财务必启用",
            tone: "green",
          },
          { label: "空闲超时", val: "30 分钟", tone: "neutral" },
          { label: "密码策略", val: "12 位 / 90 天", tone: "neutral" },
          { label: "IP 白名单", val: "未启用", tone: "amber" },
          { label: "异地登录提醒", val: "已启用", tone: "green" },
        ]}
      />
      <PolicyCard
        title="文件与存储"
        icon="Export"
        items={[
          { label: "存储桶", val: "私有 · 短期签名 URL", tone: "green" },
          { label: "截图哈希去重", val: "已启用", tone: "green" },
          { label: "录屏上传方式", val: "外链 + 本地双轨", tone: "neutral" },
          { label: "导出文件过期", val: "24 小时", tone: "neutral" },
          { label: "财务文件加水印", val: "已启用 · 含操作人", tone: "green" },
        ]}
      />
      <PolicyCard
        title="AI 安全 (重要)"
        icon="Sparkles"
        accent="violet"
        items={[
          { label: "SQL 直查", val: "禁止", tone: "red" },
          { label: "工具层权限继承", val: "已启用", tone: "green" },
          { label: "AI 查询日志保留", val: "永久", tone: "green" },
          { label: "主播端 AI 数据范围", val: "仅自己", tone: "blue" },
          { label: "财务字段 AI 可见", val: "运营负责人及以上", tone: "blue" },
        ]}
      />
      <PolicyCard
        title="审计与高风险提醒"
        icon="Audit"
        items={[
          { label: "差异日志", val: "before / after / 字段", tone: "green" },
          { label: "高风险操作必填原因", val: "已启用", tone: "green" },
          { label: "日志可删除", val: "不允许", tone: "green" },
          { label: "负责人站内提醒", val: "高风险即时推送", tone: "green" },
          { label: "审计导出", val: "负责人 / 财务", tone: "neutral" },
        ]}
      />
    </div>
  );
}

function PolicyCard({ title, icon, items, accent }) {
  const IconComp = Icon[icon];
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background:
              accent === "violet" ? "var(--violet-50)" : "var(--blue-50)",
            color:
              accent === "violet" ? "var(--violet-600)" : "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconComp size={15} />
        </span>
        <div
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--ink-900)",
          }}
        >
          {title}
        </div>
        <Button size="sm" kind="ghost" icon={<Icon.Settings size={12} />}>
          配置
        </Button>
      </div>
      <div>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--line)" : "none",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--ink-500)", flex: 1 }}>
              {it.label}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color:
                  it.tone === "green"
                    ? "var(--ok-600)"
                    : it.tone === "amber"
                      ? "var(--warn-600)"
                      : it.tone === "red"
                        ? "var(--danger-600)"
                        : it.tone === "blue"
                          ? "var(--blue-700)"
                          : "var(--ink-700)",
              }}
            >
              {it.val}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ===== src\app.jsx =====
// ——— App entry ————————————————————————————————

function OpsReferenceInner({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  settlementScope,
}) {
  // route can be: 'warroom' | 'projects' | 'project' | 'streamers' | 'tasks' | 'reports' | 'settle' | 'export' | 'audit' | 'org'
  const [route, setRoute] = React.useState(initialRoute);
  const [projectId, setProjectId] = React.useState(null);
  const [streamerId, setStreamerId] = React.useState(null);
  const [tasksState, setTasksState] = React.useState(liveTasks ?? null);
  const [reportsState, setReportsState] = React.useState(liveReports ?? null);
  const [batchesState, setBatchesState] = React.useState(liveBatches ?? null);
  const [batchDetailsState, setBatchDetailsState] = React.useState(
    liveBatchDetails ?? null,
  );

  React.useEffect(() => {
    setTasksState(liveTasks ?? null);
  }, [liveTasks]);

  React.useEffect(() => {
    setReportsState(liveReports ?? null);
  }, [liveReports]);

  React.useEffect(() => {
    setBatchesState(liveBatches ?? null);
  }, [liveBatches]);

  React.useEffect(() => {
    setBatchDetailsState(liveBatchDetails ?? null);
  }, [liveBatchDetails]);

  const actions = React.useMemo(
    () => ({
      reviewReport: async (id, decision) => {
        const response = await fetch(`/api/live-reports/${id}/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            includeInTaskResult: true,
            enterSettlementPool: true,
            reviewNotes: "经营端页面审核",
          }),
        });
        if (!response.ok) throw new Error("review report failed");
        const status =
          decision === "approve"
            ? "approved"
            : decision === "need_more"
              ? "need_supply"
              : "rejected";
        setReportsState((current) => {
          const base = Array.isArray(current) ? current : REPORTS;
          return base.map((report) =>
            report.id === id ? { ...report, status } : report,
          );
        });
      },
      createSettlementBatch: async (input) => {
        const response = await fetch("/api/settlement-batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "create settlement batch failed");
        }
      },
      addManualSettlementItem: async (batchId, input) => {
        const response = await fetch(
          `/api/settlement-batches/${batchId}/manual-items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "add manual settlement item failed");
        }
      },
      lockSettlementBatch: async (batchId, input) => {
        const response = await fetch(
          `/api/settlement-batches/${batchId}/lock`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "lock settlement batch failed");
        }
      },
      reopenSettlementBatch: async (batchId, input) => {
        const response = await fetch(
          `/api/settlement-batches/${batchId}/reopen`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "reopen settlement batch failed");
        }
      },
    }),
    [],
  );

  const go = (r, arg) => {
    if (r === "project") {
      setRoute("project");
      setProjectId(arg || "P-2406");
    } else if (r === "streamers") {
      setRoute("streamers");
      if (arg) setStreamerId(arg);
    } else {
      setRoute(r);
      if (r === "projects") setProjectId(null);
    }
    // Scroll content to top
    const content = globalThis.document?.getElementById("content-scroll");
    if (content) content.scrollTop = 0;
  };

  // Breadcrumbs per route
  const crumbs = (() => {
    switch (route) {
      case "warroom":
        return ["工作台", "智能作战台"];
      case "projects":
        return ["项目管理", "全部项目"];
      case "project":
        return [
          "项目管理",
          PROJECTS.find((p) => p.id === projectId)?.name || "项目详情",
        ];
      case "streamers":
        return ["资源", "主播资源池"];
      case "tasks":
        return ["执行", "排班与任务"];
      case "reports":
        return ["执行", "报数审核"];
      case "settle":
        return ["财务", "结算中心"];
      case "export":
        return ["运营", "数据导出"];
      case "audit":
        return ["治理", "操作日志"];
      case "org":
        return ["设置", "组织与权限"];
      default:
        return ["工作台"];
    }
  })();

  const navKey = route === "project" ? "projects" : route;

  return (
    <OpsLiveDataContext.Provider
      value={{
        tasks: tasksState,
        reports: reportsState,
        batches: batchesState,
        batchDetails: batchDetailsState,
        settlementScope,
        actions,
      }}
    >
      <div
        style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}
      >
        <Sidebar route={navKey} onNav={go} />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            maxHeight: "100vh",
          }}
        >
          <TopBar breadcrumbs={crumbs} />
          <div id="content-scroll" style={{ flex: 1, overflowY: "auto" }}>
            {route === "warroom" && <ScreenWarRoom go={go} />}
            {(route === "projects" || route === "project") && (
              <ScreenProjects go={go} projectId={projectId} />
            )}
            {route === "streamers" && (
              <ScreenStreamers go={go} initialActiveId={streamerId} />
            )}
            {route === "tasks" && <ScreenTasks go={go} />}
            {route === "reports" && <ScreenReports go={go} />}
            {route === "settle" && <ScreenSettlement go={go} />}
            {route === "org" && <ScreenOrg go={go} />}
            {(route === "export" || route === "audit") && (
              <PlaceholderScreen route={route} go={go} />
            )}
          </div>
        </main>
      </div>
    </OpsLiveDataContext.Provider>
  );
}

function PlaceholderScreen({ route, go }) {
  const map = {
    tasks: {
      title: "排班与任务",
      desc: "项目维度排班看板 + 任务表格 · 第一版支持单日与多日重复批量排班 · 主播端有「我的任务」",
      icon: "Tasks",
    },
    export: {
      title: "数据导出中心",
      desc: "厂家候选主播表 / 项目执行表 / 报数明细 / 结算批次 / 审计日志，统一权限、字段、脱敏与日志",
      icon: "Export",
    },
    audit: {
      title: "操作日志 & 审计",
      desc: "差异日志 + 高风险原因 + 轻量审计中心 + 高风险站内提醒",
      icon: "Audit",
    },
    org: {
      title: "组织与权限",
      desc: "角色与字段级权限 · 主播敏感字段隔离 · AI 查询继承权限",
      icon: "Settings",
    },
  };
  const m = map[route] || map.tasks;
  const IconComp = Icon[m.icon];

  return (
    <>
      <PageHeader title={m.title} subtitle={m.desc} />
      <div style={{ padding: 32 }}>
        <Card padded={true}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "32px 16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 14,
                background: "var(--blue-50)",
                color: "var(--blue-700)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <IconComp size={28} stroke="var(--blue-700)" />
            </div>
            <div
              style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-900)" }}
            >
              {m.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-400)",
                marginTop: 6,
                maxWidth: 520,
              }}
            >
              {m.desc}
            </div>

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
                maxWidth: 720,
                width: "100%",
              }}
            >
              {modulePreview(route).map((b, i) => (
                <div
                  key={i}
                  style={{
                    padding: 14,
                    background: "var(--bg-soft)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {b.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-400)",
                      marginTop: 4,
                    }}
                  >
                    {b.desc}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
              <Button kind="default" onClick={() => go("warroom")}>
                返回作战台
              </Button>
              <Button kind="primary">查看产品设计 →</Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function modulePreview(route) {
  return (
    {
      tasks: [
        {
          title: "项目排班看板",
          desc: "横向时间轴 / 纵向主播 · 拖拽创建与冲突检测",
        },
        {
          title: "批量排班",
          desc: "单日批量 + 多日重复 · 后续支持 Excel 导入",
        },
        {
          title: "异常任务列表",
          desc: "未开播 / 未报数 / 超 48h 未停止 / 报数逾期等",
        },
      ],
      export: [
        {
          title: "厂家候选主播表",
          desc: "录屏审核后导出给厂家，自动脱敏价格与毛利",
        },
        { title: "项目执行表", desc: "任务、报数、审核进度的统一对账" },
        { title: "导出日志 & 高风险提醒", desc: "财务表格导出触发负责人提醒" },
      ],
      audit: [
        { title: "差异日志", desc: "记录 before / after 与变更字段" },
        { title: "高风险原因", desc: "修改金额、解锁批次、拉黑主播必须填原因" },
        { title: "审计中心", desc: "按角色 / 模块 / 项目过滤，可签名导出" },
      ],
      org: [
        {
          title: "角色权限矩阵",
          desc: "负责人 / 运营负责人 / 次级运营 / 财务 / 主播",
        },
        { title: "字段级脱敏", desc: "主播端不返回毛利、价格、其他主播结算" },
        {
          title: "AI 工具权限继承",
          desc: "AI 查询走安全工具层，与用户身份绑定",
        },
      ],
    }[route] || []
  );
}

// Mount

/**
 * @param {{ initialRoute?: string; liveTasks?: any[]; liveReports?: any[]; liveBatches?: any[]; liveBatchDetails?: Record<string, any[]>; settlementScope?: any }} props
 */
export default function OpsReferenceApp({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  settlementScope,
}) {
  return (
    <OpsReferenceInner
      initialRoute={initialRoute}
      liveTasks={liveTasks}
      liveReports={liveReports}
      liveBatches={liveBatches}
      liveBatchDetails={liveBatchDetails}
      settlementScope={settlementScope}
    />
  );
}
