"use client";
/* eslint-disable */
import React from "react";

const UUID_LIKE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayRecordId(value, fallback = "内部记录") {
  const text = String(value || "").trim();
  if (!text || UUID_LIKE_ID.test(text)) return fallback;
  return text;
}

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

// ===== src-streamer\data.jsx =====
// Streamer-side empty production defaults ———————————————————————————————

// Logged-in streamer profile fallback.
const ME = {
  id: "",
  alias: "未登录",
  real: "",
  gender: "",
  level: "未配置档案",
  signedAt: "",
  org: "未配置组织",
  platforms: [],
};

const EMPTY_PROFILE = {
  ...ME,
  stats: {
    projectCount: 0,
    recordingCount: 0,
    totalLiveHours: 0,
  },
  tags: {
    categories: ["未配置品类"],
    styles: ["未配置风格"],
    skills: ["未配置技能"],
    availability: ["未配置时间"],
    equipment: ["未配置设备"],
  },
  settlement: {
    rule: "未配置",
    cycle: "按项目规则",
    baseSalary: "未配置",
    cpt: "未配置",
    giftShare: "按项目规则配置",
    bank: "未向前端暴露",
  },
  security: {
    password: "由账号系统管理",
    mfa: "按账号设置",
    notifications: "任务 / 审核 / AI",
    devices: "当前会话",
  },
};

// Streamer's tasks — for today + upcoming + recent
const MY_TASKS = [];

const STATUS_MAP = {
  pending_live: { tone: "neutral", label: "待开播" },
  missed_live: { tone: "red", label: "直播已延期" },
  live: { tone: "blue", label: "直播中" },
  pending_report: { tone: "amber", label: "待上传截图" },
  pending_review: { tone: "violet", label: "审核中" },
  report_pending_review: { tone: "violet", label: "审核中" },
  approved: { tone: "green", label: "审核通过" },
  report_approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
  report_rejected: { tone: "red", label: "审核驳回" },
  trial: { tone: "teal", label: "试播任务" },
  completed: { tone: "green", label: "已完成" },
  cancelled: { tone: "neutral", label: "已取消" },
  abnormal: { tone: "red", label: "异常" },
};

function getTaskStatusMeta(status) {
  return (
    STATUS_MAP[status] || {
      tone: "neutral",
      label: status || STATUS_MAP.pending_live.label,
    }
  );
}

const MY_NOTIFICATIONS = [];

// Earnings — only my own
const MY_EARNINGS = {
  currentMonth: {
    month: "",
    earned: 0,
    pending: 0,
    finalized: false,
    hours: 0,
  },
  lastMonth: {
    month: "",
    earned: 0,
    hours: 0,
    base: 0,
    variable: 0,
  },
  history: [],
};

// Screening videos
const MY_VIDEOS = [];
const MY_RECORDINGS = [];

const VIDEO_STATUS = {
  pending_review: { tone: "violet", label: "审核中" },
  approved: { tone: "green", label: "通过" },
  rejected: { tone: "red", label: "驳回" },
  need_supply: { tone: "amber", label: "需补充" },
  expired: { tone: "neutral", label: "已失效" },
};

// AI diagnosis conversation history
const AI_THREAD = [];

// ===== src-streamer-pc\chrome.jsx =====
// ——— Streamer Desktop · Chrome (sidebar + topbar) ———

const NAV = [
  { key: "dashboard", label: "工作台", icon: "Dashboard" },
  { key: "tasks", label: "我的任务", icon: "Tasks", count: 2 },
  { key: "videos", label: "录屏库", icon: "Reports" },
  { divider: true },
  { key: "ai", label: "AI 卡点诊断", icon: "Sparkles", accent: true },
  { divider: true },
  { key: "earnings", label: "结算账单", icon: "Money" },
  { key: "profile", label: "个人资料 & 平台", icon: "Streamer" },
];

function Sidebar({
  route,
  onNav,
  taskBadgeCount = 0,
  profile = EMPTY_PROFILE,
}) {
  return (
    <aside
      style={{
        width: 224,
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
      {/* Brand */}
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
            主播工作台
          </span>
          <span
            style={{
              fontSize: 10.5,
              color: "var(--ink-400)",
              letterSpacing: "0.04em",
            }}
          >
            STREAMER · v1.0
          </span>
        </div>
      </div>

      {/* Quick "me" tile */}
      <div style={{ padding: "12px 12px 8px" }}>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background:
              "linear-gradient(135deg, var(--blue-700), var(--blue-500))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 4px 14px rgba(30,80,200,0.28)",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: "rgba(255,255,255,0.2)",
              border: "1.5px solid rgba(255,255,255,0.35)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {profile.alias.slice(0, 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.005em",
              }}
            >
              {profile.alias}
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: "rgba(255,255,255,0.78)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {profile.level}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "4px 8px", flex: 1, overflowY: "auto" }}>
        {NAV.map((it, i) => {
          if (it.divider)
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
          const active = it.key === route;
          const IconComp = Icon[it.icon];
          const count = it.key === "tasks" ? taskBadgeCount : it.count;
          return (
            <button
              key={it.key}
              onClick={() => onNav(it.key)}
              style={{
                width: "100%",
                padding: "0 10px",
                height: 36,
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
              {count != null && count > 0 && (
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
                  {count}
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

      {/* Bottom: status pill */}
      <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--bg-soft)",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: isProfileActive(profile)
                ? "var(--ok-600)"
                : "var(--ink-300)",
              boxShadow: isProfileActive(profile)
                ? "0 0 0 3px rgba(14,138,77,0.22)"
                : "none",
            }}
          />
          <div style={{ flex: 1, fontSize: 11.5, color: "var(--ink-500)" }}>
            {formatProfileContractSummary(profile)}
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  title,
  subtitle,
  actions,
  unreadNotificationCount = 0,
  notifications = MY_NOTIFICATIONS,
  profile = EMPTY_PROFILE,
}) {
  const [notificationOpen, setNotificationOpen] = React.useState(false);
  const notificationLabel = `通知 ${unreadNotificationCount} 条未读`;
  const topbarNotifications = Array.isArray(notifications)
    ? notifications.slice(0, 5)
    : [];

  return (
    <div
      style={{
        height: 56,
        flexShrink: 0,
        background: "#fff",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        position: "sticky",
        top: 0,
        zIndex: 10,
        gap: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink-900)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
            {subtitle}
          </div>
        )}
      </div>

      <div>
        <SearchInput placeholder="搜索任务 / 录屏 / 项目…" width={280} />
      </div>

      {actions}

      <div
        style={{
          position: "relative",
        }}
      >
        {/* Notification */}
        <button
          aria-label={notificationLabel}
          title={notificationLabel}
          onClick={() => setNotificationOpen((open) => !open)}
          style={{
            position: "relative",
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "#fff",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-500)",
          }}
        >
          <Icon.Bell size={16} />
          {unreadNotificationCount > 0 && (
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
              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
            </span>
          )}
        </button>
        {notificationOpen && (
          <Card
            padded={false}
            style={{
              position: "absolute",
              right: 0,
              top: 42,
              width: 340,
              zIndex: 20,
              boxShadow: "0 14px 36px rgba(15, 23, 42, 0.16)",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                }}
              >
                通知
              </span>
              <Badge tone={unreadNotificationCount > 0 ? "red" : "neutral"}>
                {unreadNotificationCount} 条未读
              </Badge>
            </div>
            {topbarNotifications.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  color: "var(--ink-400)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                暂无通知
              </div>
            ) : (
              topbarNotifications.map((item, index) => (
                <div
                  key={item.id ?? index}
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    gap: 10,
                    borderBottom:
                      index < topbarNotifications.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    background: item.unread ? "rgba(238,243,255,0.65)" : "#fff",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      marginTop: 6,
                      flexShrink: 0,
                      background: item.unread
                        ? "var(--blue-600)"
                        : "transparent",
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: item.unread ? 700 : 600,
                        color: "var(--ink-900)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-500)",
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {item.detail}
                    </div>
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--ink-400)",
                        marginTop: 3,
                      }}
                    >
                      {item.time}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        )}
      </div>

      {/* Avatar dropdown */}
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 34,
          padding: "0 12px 0 4px",
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        <Avatar name={profile.alias} size={26} />
        <span
          style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
        >
          {profile.alias}
        </span>
        <Icon.ChevDown size={12} stroke="var(--ink-400)" />
      </button>
    </div>
  );
}

// Page header used inside content area
function PageHero({ title, subtitle, status, actions, dense = false }) {
  return (
    <div
      style={{
        padding: dense ? "16px 24px 12px" : "20px 24px 16px",
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

// ===== src-streamer-pc\screen-dashboard.jsx =====
// ——— Screen: 工作台 ——————————————————————

function normalizeStreamerNotifications(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.map((item) => ({
    id: item.id ?? item.title,
    title: item.title || "通知",
    detail: item.detail || item.content || "",
    time: item.time || formatNotificationTime(item.createdAt),
    unread: item.unread ?? item.status === "unread",
    status: item.status || (item.unread ? "unread" : "read"),
    isHighRisk: item.isHighRisk ?? false,
  }));
}

function normalizeStreamerProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  return {
    ...EMPTY_PROFILE,
    ...profile,
    stats: {
      ...EMPTY_PROFILE.stats,
      ...(profile.stats || {}),
    },
    platforms: Array.isArray(profile.platforms) ? profile.platforms : [],
    tags: {
      ...EMPTY_PROFILE.tags,
      ...(profile.tags || {}),
    },
    settlement: {
      ...EMPTY_PROFILE.settlement,
      ...(profile.settlement || {}),
    },
    security: {
      ...EMPTY_PROFILE.security,
      ...(profile.security || {}),
    },
  };
}

function normalizeStreamerRecordings(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.map((item) => ({
    id: item.id ?? item.link,
    product: item.product || "未配置产品",
    category: item.category || "未配置品类",
    link: item.link || item.recordingUrl || "",
    month: item.month || item.recordingMonth || currentMonthLabel(),
    status: item.status || "submitted",
    statusLabel: item.statusLabel || item.status || "待审核",
    submittedAt: item.submittedAt || item.submitted_at || "",
  }));
}

function normalizeProjectAnnouncements(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items;
}

function isProfileActive(profile = EMPTY_PROFILE) {
  return Boolean(profile.id) && ["合作中", "已签约"].includes(profile.level);
}

function formatProfileContractSummary(profile = EMPTY_PROFILE) {
  if (!profile.id) {
    return "未绑定主播档案";
  }

  const level = profile.level || "未配置档案";
  const signedAt = parseProfileDate(profile.signedAt);
  if (!signedAt) {
    return `${level} · 签约时间未配置`;
  }

  return `${level} · ${formatTenure(signedAt, new Date())}`;
}

function parseProfileDate(value) {
  if (!value || value === "未配置") {
    return null;
  }

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTenure(start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / dayMs),
  );
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    end.getMonth() -
    start.getMonth();
  if (end.getDate() < start.getDate()) {
    months -= 1;
  }
  months = Math.max(0, months);

  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return rest > 0 ? `签约 ${years} 年 ${rest} 个月` : `签约 ${years} 年`;
  }
  if (months > 0) {
    return `签约 ${months} 个月`;
  }
  if (days > 0) {
    return `签约 ${days} 天`;
  }
  return "今日签约";
}

function countUnreadNotifications(notifications = MY_NOTIFICATIONS) {
  return notifications.filter((item) => item.unread || item.status === "unread")
    .length;
}

function normalizeNotificationUnreadCount(value, notifications) {
  const count = Number(value);
  if (Number.isFinite(count) && count >= 0) {
    return Math.trunc(count);
  }

  return countUnreadNotifications(
    normalizeStreamerNotifications(notifications) || [],
  );
}

function formatNotificationTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function ScreenDashboard({
  go,
  tasks = MY_TASKS,
  earnings = MY_EARNINGS,
  notifications = MY_NOTIFICATIONS,
  profile = EMPTY_PROFILE,
}) {
  const dashboardTaskStatuses = [
    "pending_live",
    "missed_live",
    "live",
    "pending_report",
  ];
  const today = tasks.filter((t) => dashboardTaskStatuses.includes(t.status));
  const pendingReport = tasks.filter((t) => t.status === "pending_report");
  const upcoming = tasks
    .filter((t) => !dashboardTaskStatuses.includes(t.status))
    .slice(0, 4);
  const reviewing = tasks.filter((t) => t.status === "pending_review");
  const visibleNotifications = notifications.slice(0, 4);

  const dayLabel = "周三 · 5 月 27 日";

  return (
    <>
      <PageHero
        title={<>你好，{profile.alias}</>}
        subtitle={
          <>
            {dayLabel} · 今天还有{" "}
            <b className="num" style={{ color: "var(--ink-900)" }}>
              {today.length}
            </b>{" "}
            场直播 · 本周已完成{" "}
            <b className="num" style={{ color: "var(--ink-900)" }}>
              {earnings.currentMonth.hours.toFixed(1)}
            </b>
            h
          </>
        }
        actions={
          <>
            <Button kind="default" icon={<Icon.History size={14} />}>
              历史复盘
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Sparkles size={14} stroke="#fff" />}
              onClick={() => go("ai")}
            >
              开播前诊断
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top metric strip — 4 columns */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            gap: 16,
          }}
        >
          <EarningsCard go={go} earnings={earnings} />
          <Card>
            <Metric
              label="本月已直播"
              value={earnings.currentMonth.hours.toFixed(1)}
              unit="h"
              hint="等待真实任务数据"
            />
          </Card>
          <Card>
            <Metric label="录屏通过率" value="0" unit="%" hint="暂无审核记录" />
          </Card>
          <Card>
            <Metric
              label="本周参与项目"
              value={tasks.length}
              unit="个"
              hint="按真实任务统计"
            />
          </Card>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20 }}
        >
          {/* Left: today + actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Action: pending report */}
            {pendingReport.length > 0 && (
              <Card
                style={{
                  borderColor: "#F5DDA8",
                  background:
                    "linear-gradient(135deg, #FFFBF0 0%, #FFFFFF 50%)",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 14 }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: "var(--warn-600)",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon.Upload size={18} stroke="#fff" sw={1.8} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                        }}
                      >
                        {pendingReport.length} 个任务待上传下播截图
                      </span>
                      <Badge tone="amber" dot>
                        请尽快
                      </Badge>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-500)",
                        marginTop: 4,
                      }}
                    >
                      建议下播 24h 内完成上传 · 超时会进入异常列表并影响本周结算
                    </div>
                  </div>
                  <Button
                    kind="primary"
                    onClick={() => go("tasks", pendingReport[0].id)}
                  >
                    立即上传 →
                  </Button>
                </div>
              </Card>
            )}

            {/* Today */}
            <div>
              <SectionTitle
                hint={today.length > 0 ? `${today.length} 场直播` : "没有安排"}
              >
                今天 · 即将直播
              </SectionTitle>
              {today.length === 0 ? (
                <EmptyCard
                  title="今天没有排班"
                  hint="可以利用空闲时间上传历史录屏，扩展你的可接项目品类。"
                />
              ) : (
                today.map((t) => (
                  <DesktopTaskCard
                    key={t.id}
                    task={t}
                    onClick={() => go("tasks", t.id)}
                    primary
                  />
                ))
              )}
            </div>

            {/* Upcoming */}
            <div>
              <SectionTitle
                extra={
                  <Button size="sm" kind="link" onClick={() => go("tasks")}>
                    查看全部 →
                  </Button>
                }
              >
                即将开始
              </SectionTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                {upcoming.map((t) => (
                  <CompactTaskCard
                    key={t.id}
                    task={t}
                    onClick={() => go("tasks", t.id)}
                  />
                ))}
              </div>
            </div>

            {/* Recent submission */}
            <div>
              <SectionTitle>最近提交</SectionTitle>
              <Card padded={false}>
                {reviewing.length === 0 ? (
                  <div
                    style={{
                      padding: 24,
                      color: "var(--ink-400)",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  >
                    近期无审核中报数
                  </div>
                ) : (
                  reviewing.map((t, i, arr) => (
                    <div
                      key={t.id}
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        borderBottom:
                          i < arr.length - 1 ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 7,
                          background: "var(--violet-50)",
                          color: "var(--violet-600)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon.Eye size={14} stroke="var(--violet-600)" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: "var(--ink-900)",
                          }}
                        >
                          {t.projectName}
                        </div>
                        <div
                          className="num"
                          style={{
                            fontSize: 11,
                            color: "var(--ink-400)",
                            marginTop: 2,
                          }}
                        >
                          {t.dateStr} · {t.start}–{t.end} · 已提交 17 分钟前
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          className="num"
                          style={{
                            fontSize: 13,
                            color: "var(--ink-900)",
                            fontWeight: 600,
                          }}
                        >
                          {t.reportedDuration?.toFixed(1)} h ·{" "}
                          {t.reportedAudience?.toLocaleString()} 人
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--blue-700)",
                            fontWeight: 600,
                          }}
                        >
                          预计 ¥
                          {Math.round(
                            (t.reportedDuration || 0) * 80,
                          ).toLocaleString()}
                        </div>
                      </div>
                      <Badge tone="violet" dot>
                        审核中
                      </Badge>
                    </div>
                  ))
                )}
              </Card>
            </div>
          </div>

          {/* Right: trend + AI + notifications */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Earnings trend */}
            <Card title="近 6 个月收入趋势" padded={true}>
              <Sparkbars data={earnings.history} />
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px dashed var(--line)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                    近 6 月均值
                  </div>
                  <div
                    className="num"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    ¥11,890
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                    本月预估
                  </div>
                  <div
                    className="num"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--blue-700)",
                    }}
                  >
                    ¥
                    {(
                      MY_EARNINGS.currentMonth.earned +
                      MY_EARNINGS.currentMonth.pending
                    ).toLocaleString()}
                  </div>
                </div>
              </div>
            </Card>

            {/* AI advisor teaser */}
            <Card
              style={{
                background: "linear-gradient(135deg, #F8F6FF 0%, #EEF3FF 100%)",
                borderColor: "#D8D0FA",
              }}
            >
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
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
                  <Icon.Sparkles size={16} stroke="#fff" sw={1.8} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    开播前建议
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--violet-600)",
                      marginTop: 2,
                      fontWeight: 500,
                    }}
                  >
                    基于近 14 天数据 · 19:08 生成
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-700)",
                  lineHeight: 1.65,
                }}
              >
                上一档「进房少 + 留不住」复合卡点。建议：
              </div>
              <ul
                style={{
                  margin: "8px 0 0",
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {[
                  "开场先明确本场主题和互动目标",
                  "5 分钟内安排一个低门槛互动钩子",
                  "直播间标题和封面同步本场重点",
                ].map((t, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12,
                      color: "var(--ink-700)",
                      display: "flex",
                      gap: 8,
                    }}
                  >
                    <Icon.Check size={11} stroke="var(--violet-600)" sw={2.2} />
                    {t}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button size="sm" kind="default" onClick={() => go("ai")}>
                  继续追问
                </Button>
                <Button size="sm" kind="ghost">
                  保存为脚本
                </Button>
              </div>
            </Card>

            {/* Notifications */}
            <Card
              title="通知"
              extra={
                <Button size="sm" kind="link">
                  全部
                </Button>
              }
              padded={false}
            >
              {visibleNotifications.length === 0 ? (
                <div style={{ padding: "18px 16px" }}>
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--ink-400)",
                      fontSize: 12,
                      lineHeight: 1.8,
                    }}
                  >
                    <div
                      style={{
                        color: "var(--ink-700)",
                        fontWeight: 600,
                        marginBottom: 2,
                      }}
                    >
                      暂无通知
                    </div>
                    <div>任务、报数和结算状态有变化时会在这里提醒。</div>
                  </div>
                </div>
              ) : (
                visibleNotifications.map((n, i) => (
                  <div
                    key={n.id ?? i}
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      gap: 10,
                      borderBottom:
                        i < visibleNotifications.length - 1
                          ? "1px solid var(--line)"
                          : "none",
                      background: n.unread
                        ? "rgba(238,243,255,0.5)"
                        : "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: n.unread
                          ? "var(--blue-600)"
                          : "transparent",
                        marginTop: 6,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: n.unread ? 600 : 500,
                          color: "var(--ink-900)",
                        }}
                      >
                        {n.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink-500)",
                          marginTop: 2,
                        }}
                      >
                        {n.detail}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "var(--ink-400)",
                          marginTop: 2,
                        }}
                      >
                        {n.time}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

// Big earnings card on dashboard
function EarningsCard({ go, earnings = MY_EARNINGS }) {
  const e = earnings.currentMonth;
  const pct = Math.min(100, (e.hours / 60) * 100);
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, var(--blue-700) 0%, var(--blue-500) 100%)",
        borderRadius: 10,
        padding: 16,
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(30,80,200,0.16)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 160,
          height: 160,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 70%)",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.78)" }}>
            本月已结算
          </span>
          <button
            onClick={() => go("earnings")}
            style={{
              height: 24,
              padding: "0 10px",
              borderRadius: 999,
              border: "none",
              background: "rgba(255,255,255,0.18)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            明细 <Icon.ChevRight size={11} stroke="#fff" sw={2} />
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 4,
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
            ¥
          </span>
          <span
            className="num"
            style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {e.earned.toLocaleString()}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.75)",
              marginLeft: 8,
            }}
          >
            + 待审{" "}
            <span className="num" style={{ color: "#FFD166", fontWeight: 600 }}>
              ¥{e.pending.toLocaleString()}
            </span>
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            height: 5,
            background: "rgba(255,255,255,0.2)",
            borderRadius: 999,
          }}
        >
          <div
            style={{
              width: pct + "%",
              height: "100%",
              background: "#FFD166",
              borderRadius: 999,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 10.5,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <span>
            已直播 <span className="num">{e.hours.toFixed(1)}</span> h
          </span>
          <span>本月目标 60 h</span>
        </div>
      </div>
    </div>
  );
}

// Task card (full)
function DesktopTaskCard({ task, onClick, primary, compact }) {
  const st = getTaskStatusMeta(task.status);
  const isMissedLive = task.status === "missed_live";
  const tones = {
    blue: "var(--blue-600)",
    violet: "var(--violet-600)",
    amber: "var(--warn-600)",
    green: "var(--ok-600)",
    red: "var(--danger-600)",
    teal: "var(--teal-600)",
    neutral: "var(--ink-300)",
  };
  return (
    <Card
      style={{
        borderColor: primary
          ? isMissedLive
            ? "#F3C4C9"
            : "var(--blue-200)"
          : isMissedLive
            ? "#F3C4C9"
            : "var(--line)",
        background: isMissedLive
          ? "linear-gradient(135deg, #FFF8F8 0%, #FFFFFF 55%)"
          : "#fff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {primary && (
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: tones[st.tone],
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            flexShrink: 0,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Game size={24} stroke="var(--blue-700)" />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            <span
              className="num"
              style={{
                fontSize: 12,
                color: "var(--ink-400)",
                whiteSpace: "nowrap",
              }}
            >
              {task.dateStr}
            </span>
            <span
              style={{
                width: 2,
                height: 2,
                borderRadius: 999,
                background: "var(--ink-200)",
              }}
            />
            <span
              className="num"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-900)",
                whiteSpace: "nowrap",
              }}
            >
              {task.start}–{task.end}
            </span>
            <span
              className="num"
              style={{
                fontSize: 11,
                color: "var(--ink-400)",
                whiteSpace: "nowrap",
              }}
            >
              · {task.durationPlan}h
            </span>
            <span style={{ flex: 1 }} />
            <Badge tone={st.tone} dot>
              {st.label}
            </Badge>
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink-900)",
              letterSpacing: "-0.005em",
            }}
          >
            {task.projectName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-400)",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Game size={12} stroke="var(--ink-400)" />
            {task.vendor} ·{" "}
            <span className="mono">{displayRecordId(task.id, "任务")}</span>
          </div>

          {!compact && task.note && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-500)",
                marginTop: 12,
                padding: "10px 12px",
                background: "var(--bg-soft)",
                borderRadius: 8,
                borderLeft: "3px solid var(--blue-300)",
              }}
            >
              {task.note}
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Badge tone="blue">{task.settleHint}</Badge>
            {task.needScreening && <Badge tone="amber">需录屏</Badge>}
            {isMissedLive ? (
              <Badge tone="red">不可直播</Badge>
            ) : (
              task.needStartStop && <Badge tone="neutral">需点击开播</Badge>
            )}
            <span style={{ flex: 1 }} />
            {task.status === "pending_live" && (
              <Button
                kind="primary"
                icon={<Icon.Play size={13} stroke="#fff" />}
                onClick={onClick}
              >
                查看任务
              </Button>
            )}
            {task.status === "pending_report" && (
              <Button
                kind="primary"
                icon={<Icon.Upload size={13} stroke="#fff" />}
                onClick={onClick}
              >
                上传截图
              </Button>
            )}
            {task.status === "pending_review" && (
              <Button kind="default" onClick={onClick}>
                查看进度
              </Button>
            )}
            {task.status === "trial" && (
              <Button
                kind="default"
                icon={<Icon.Upload size={13} />}
                onClick={onClick}
              >
                上传录屏
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CompactTaskCard({ task, onClick }) {
  const st = getTaskStatusMeta(task.status);
  return (
    <Card onClick={onClick} style={{ cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Game size={16} stroke="var(--blue-700)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-900)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {task.projectName}
          </div>
          <div
            className="num"
            style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}
          >
            {task.dateStr} · {task.start}–{task.end}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
        <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
          {task.durationPlan}h · {task.vendor}
        </span>
      </div>
    </Card>
  );
}

function EmptyCard({ title, hint }) {
  return (
    <Card>
      <div style={{ padding: "14px 4px", textAlign: "center" }}>
        <div
          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-700)" }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 4 }}>
          {hint}
        </div>
      </div>
    </Card>
  );
}

// Bar chart for earnings history
function Sparkbars({ data }) {
  if (!data.length) {
    return (
      <div style={{ height: 100, display: "grid", placeItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
          暂无收入数据
        </span>
      </div>
    );
  }

  const max = Math.max(1, ...data.map((d) => d.earned));
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 100 }}
    >
      {data.map((d, i) => {
        const h = (d.earned / max) * 100;
        const isLast = i === data.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              className="num"
              style={{
                fontSize: 10,
                color: "var(--ink-400)",
                fontWeight: isLast ? 600 : 400,
              }}
            >
              ¥{(d.earned / 1000).toFixed(1)}k
            </div>
            <div
              style={{
                width: "100%",
                height: `${h}%`,
                minHeight: 8,
                background: isLast
                  ? "linear-gradient(180deg, var(--blue-600), var(--blue-500))"
                  : "var(--blue-200)",
                borderRadius: "4px 4px 0 0",
              }}
            />
            <div
              className="num"
              style={{
                fontSize: 10.5,
                color: isLast ? "var(--blue-700)" : "var(--ink-400)",
                fontWeight: isLast ? 600 : 400,
              }}
            >
              {d.month.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== src-streamer-pc\screen-tasks.jsx =====
// ——— Screen: 我的任务 ——————————————————————

function summarizeStreamerTasks(tasks = MY_TASKS) {
  const taskCount = tasks.length;
  const pendingReportCount = tasks.filter(
    (task) => task.status === "pending_report",
  ).length;
  const plannedHours =
    Math.round(
      tasks.reduce((sum, task) => sum + getTaskDurationHours(task), 0) * 10,
    ) / 10;

  return {
    taskCount,
    pendingReportCount,
    hoursLabel: formatSummaryHours(plannedHours),
  };
}

function getTaskDurationHours(task) {
  const directHours = Number(task.durationPlan);
  if (Number.isFinite(directHours) && directHours > 0) {
    return directHours;
  }

  const plannedMinutes = Number(task.plannedDuration);
  if (Number.isFinite(plannedMinutes) && plannedMinutes > 0) {
    return plannedMinutes / 60;
  }

  const start = task.plannedStartAt ? new Date(task.plannedStartAt) : null;
  const end = task.plannedEndAt ? new Date(task.plannedEndAt) : null;
  if (
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime())
  ) {
    return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
  }

  return 0;
}

function formatSummaryHours(hours) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

function ScreenTasks({ go, openTaskId, tasks = MY_TASKS, actions = {} }) {
  const [filter, setFilter] = React.useState("all");
  const [activeId, setActiveId] = React.useState(
    openTaskId || tasks[0]?.id || null,
  );

  React.useEffect(() => {
    if (!tasks.some((task) => task.id === activeId)) {
      setActiveId(openTaskId || tasks[0]?.id || null);
    }
  }, [activeId, openTaskId, tasks]);

  const counts = {
    all: tasks.length,
    pending_live: tasks.filter((t) => t.status === "pending_live").length,
    missed_live: tasks.filter((t) => t.status === "missed_live").length,
    pending_report: tasks.filter((t) => t.status === "pending_report").length,
    pending_review: tasks.filter((t) => t.status === "pending_review").length,
    trial: tasks.filter((t) => t.status === "trial").length,
  };
  const filtered =
    filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const summary = summarizeStreamerTasks(tasks);

  return (
    <>
      <PageHero
        title="我的任务"
        subtitle={`本周累计 ${summary.taskCount} 个任务 · ${summary.hoursLabel} h · ${summary.pendingReportCount} 个待上传截图`}
        actions={
          <>
            <Button kind="default" icon={<Icon.Calendar size={14} />}>
              查看日历
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Upload size={14} stroke="#fff" />}
            >
              批量上传截图
            </Button>
          </>
        }
      />

      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
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
                { key: "all", label: "全部", count: counts.all },
                {
                  key: "pending_live",
                  label: "待开播",
                  count: counts.pending_live,
                },
                {
                  key: "missed_live",
                  label: "已延期",
                  count: counts.missed_live,
                },
                {
                  key: "pending_report",
                  label: "待上传",
                  count: counts.pending_report,
                },
                {
                  key: "pending_review",
                  label: "审核中",
                  count: counts.pending_review,
                },
                { key: "trial", label: "试播", count: counts.trial },
              ]}
            />
          </div>

          <DataTable
            activeRowId={activeId}
            onRowClick={(r) => setActiveId(r.id)}
            columns={[
              {
                title: "任务 / 项目",
                render: (r) => (
                  <div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {displayRecordId(r.id, "任务")}
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        marginTop: 2,
                      }}
                    >
                      {r.projectName}
                    </div>
                  </div>
                ),
              },
              {
                title: "日期",
                render: (r) => (
                  <span className="num" style={{ fontSize: 12 }}>
                    {r.dateStr}
                  </span>
                ),
              },
              {
                title: "时间",
                render: (r) => (
                  <span
                    className="num"
                    style={{ fontSize: 12, color: "var(--ink-500)" }}
                  >
                    {r.start}–{r.end}
                  </span>
                ),
              },
              {
                title: "时长",
                align: "right",
                render: (r) => (
                  <span className="num" style={{ fontWeight: 600 }}>
                    {r.durationPlan}h
                  </span>
                ),
              },
              {
                title: "状态",
                render: (r) => {
                  const status = getTaskStatusMeta(r.status);
                  return (
                    <Badge tone={status.tone} dot>
                      {status.label}
                    </Badge>
                  );
                },
              },
            ]}
            rows={filtered}
          />
        </Card>

        {/* Detail */}
        <TaskDetail id={activeId} go={go} tasks={tasks} actions={actions} />
      </div>
    </>
  );
}

function TaskDetail({ id, go, tasks = MY_TASKS, actions = {} }) {
  const t = tasks.find((x) => x.id === id) || tasks[0];
  if (!t) {
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
        <EmptyCard
          title="暂无任务数据"
          hint="后端返回直播任务后会显示任务详情。"
        />
      </div>
    );
  }

  const st = getTaskStatusMeta(t.status);

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
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-400)" }}
            >
              {displayRecordId(t.id, "任务")}
            </span>
            <Badge tone={st.tone} dot>
              {st.label}
            </Badge>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--ink-900)",
              letterSpacing: "-0.01em",
            }}
          >
            {t.projectName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-400)",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Game size={13} stroke="var(--ink-400)" /> {t.vendor} · 计划{" "}
            {t.dateStr} {t.start}–{t.end} · {t.durationPlan}h
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: 20 }}>
          {t.status === "pending_live" && (
            <PendingLiveCTA task={t} onStart={actions.startTask} />
          )}
          {t.status === "missed_live" && <MissedLiveCTA task={t} />}
          {t.status === "live" && (
            <LiveCTA task={t} onStop={actions.stopTask} />
          )}
          {t.status === "pending_report" && (
            <PendingReportCTA task={t} go={go} actions={actions} />
          )}
          {t.status === "pending_review" && <ReviewingCTA task={t} />}
          {t.status === "trial" && <TrialCTA task={t} />}
        </div>

        {/* Required */}
        <div style={{ padding: "0 20px 20px" }}>
          <KV label="结算规则">
            <Badge tone="blue">{t.settleHint}</Badge>
          </KV>
          <KV label="开播 / 停止">
            {t.status === "missed_live" ? (
              <span style={{ color: "var(--danger-600)", fontWeight: 700 }}>
                已延期，不可开播
              </span>
            ) : t.needStartStop ? (
              <span style={{ color: "var(--ok-600)", fontWeight: 600 }}>
                需要在 App 内点击
              </span>
            ) : (
              <span style={{ color: "var(--ink-500)" }}>无需</span>
            )}
          </KV>
          <KV label="录屏要求">
            {t.needScreening ? (
              <span style={{ color: "var(--ok-600)", fontWeight: 600 }}>
                本项目强制录屏
              </span>
            ) : (
              <span style={{ color: "var(--ink-500)" }}>不强制</span>
            )}
          </KV>
          {t.note && (
            <KV label="项目备注">
              <span style={{ color: "var(--ink-500)" }}>{t.note}</span>
            </KV>
          )}
        </div>
      </Card>

      {/* Timeline */}
      <Card title="任务流转">
        <Timeline
          events={[
            { title: "排班创建", time: "系统生成", done: true },
            {
              title: "点击开始直播",
              time:
                t.status === "missed_live"
                  ? "计划窗口已结束"
                  : t.status === "pending_live"
                    ? "待你操作"
                    : "5/27 19:58",
              done: !["pending_live", "missed_live"].includes(t.status),
              current: ["pending_live", "missed_live"].includes(t.status),
            },
            {
              title: "点击停止 + 上传下播截图",
              time:
                t.status === "live"
                  ? "待你操作"
                  : t.status === "pending_report"
                    ? "待你操作"
                    : t.status === "pending_review"
                      ? "5/26 22:48"
                      : "—",
              done: ["pending_review", "approved", "completed"].includes(
                t.status,
              ),
              current: ["live", "pending_report"].includes(t.status),
            },
            {
              title: "确认 OCR 结果",
              time: t.status === "pending_review" ? "5/26 22:50" : "—",
              done: ["pending_review", "approved"].includes(t.status),
            },
            {
              title: "运营审核",
              time:
                t.status === "pending_review"
                  ? "审核中（24h 内）"
                  : t.status === "approved"
                    ? "已通过"
                    : "—",
              done: t.status === "approved",
              current: t.status === "pending_review",
            },
          ]}
        />
      </Card>
    </div>
  );
}

function PendingLiveCTA({ task, onStart }) {
  const [busy, setBusy] = React.useState(false);
  const start = async () => {
    if (!onStart || busy) return;
    setBusy(true);
    try {
      await onStart(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #F5F8FF 0%, #EEF3FF 100%)",
        borderRadius: 10,
        border: "1px solid var(--blue-200)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>距开播还有</div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 6,
        }}
      >
        <span
          className="num"
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--blue-700)",
            letterSpacing: "-0.02em",
          }}
        >
          2
        </span>
        <span style={{ fontSize: 13, color: "var(--ink-500)" }}>小时</span>
        <span
          className="num"
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--blue-700)",
            letterSpacing: "-0.02em",
            marginLeft: 6,
          }}
        >
          14
        </span>
        <span style={{ fontSize: 13, color: "var(--ink-500)" }}>分钟</span>
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <Button
          kind="primary"
          icon={<Icon.Play size={14} stroke="#fff" />}
          onClick={start}
          disabled={busy}
          style={{ flex: 1 }}
        >
          {busy ? "启动中…" : "开始直播"}
        </Button>
        <Button kind="default" style={{ flex: 1 }}>
          修改排班
        </Button>
      </div>
    </div>
  );
}

function MissedLiveCTA({ task }) {
  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #FFF8F8 0%, #FFFDF9 100%)",
        borderRadius: 10,
        border: "1px solid #F3C4C9",
      }}
    >
      <div
        style={{ fontSize: 13.5, color: "var(--danger-600)", fontWeight: 700 }}
      >
        直播已延期
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12.5,
          color: "var(--ink-600)",
          lineHeight: 1.65,
        }}
      >
        计划 {task.dateStr} {task.start}–{task.end} 已结束，系统未记录开播。
      </div>
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 8,
          background: "#fff",
          border: "1px dashed #F3C4C9",
          color: "var(--danger-600)",
          fontSize: 12,
          lineHeight: 1.6,
          fontWeight: 700,
        }}
      >
        当前不可直播，请联系运营确认延期或未开播原因。
      </div>
    </div>
  );
}

function LiveCTA({ task, onStop }) {
  const [busy, setBusy] = React.useState(false);
  const stop = async () => {
    if (!onStop || busy) return;
    setBusy(true);
    try {
      await onStop(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #F4FBF7 0%, #EEF9F2 100%)",
        borderRadius: 10,
        border: "1px solid #BDEBD2",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>当前状态</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
          color: "var(--ok-600)",
          fontWeight: 700,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "var(--ok-600)",
            boxShadow: "0 0 0 4px rgba(22,163,74,0.14)",
          }}
        />
        直播中
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <Button kind="default" style={{ flex: 1 }}>
          暂停
        </Button>
        <Button
          kind="primary"
          icon={<Icon.Upload size={14} stroke="#fff" />}
          onClick={stop}
          disabled={busy}
          style={{ flex: 2 }}
        >
          {busy ? "结束中…" : "结束直播 + 上传截图"}
        </Button>
      </div>
    </div>
  );
}

function sanitizeReportScreenshotFileName(name) {
  const safeName = String(name || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^\w.\-()一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safeName || "report-screenshot.png";
}

function PendingReportCTA({ task, go, actions = {} }) {
  const fileInputRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!actions.submitReport) {
      setError("上传功能暂不可用，请刷新页面后重试");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await actions.submitReport(task.id, { screenshotFile: file });
      go?.("tasks", task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 16,
        background: "#FFF6E6",
        borderRadius: 10,
        border: "1px solid #F5DDA8",
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
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "var(--warn-600)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Upload size={14} stroke="#fff" sw={1.8} />
        </span>
        <div>
          <div
            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-900)" }}
          >
            请上传下播截图
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-500)" }}>
            截图需包含「时长 / 场观」，上传后系统会自动识别
          </div>
        </div>
      </div>
      <Button
        kind="primary"
        icon={<Icon.Upload size={13} stroke="#fff" />}
        style={{ width: "100%" }}
        disabled={busy}
        onClick={() => fileInputRef.current?.click?.()}
      >
        {busy ? "上传中…" : "从本地选择截图"}
      </Button>
      <input
        ref={fileInputRef}
        aria-label="上传下播截图"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger-600)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function ReviewingCTA({ task }) {
  return (
    <div
      style={{ padding: 16, background: "var(--bg-soft)", borderRadius: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--violet-50)",
            color: "var(--violet-600)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Eye size={16} stroke="var(--violet-600)" />
        </span>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-900)" }}
          >
            报数已提交，审核中
          </div>
          <div
            style={{ fontSize: 11.5, color: "var(--ink-500)", marginTop: 2 }}
          >
            预计 24 小时内出结果
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        <Metric
          label="时长"
          value={task.reportedDuration?.toFixed(1) || "—"}
          unit="h"
        />
        <Metric
          label="场观"
          value={task.reportedAudience?.toLocaleString() || "—"}
        />
        <Metric
          label="预计收入"
          value={`¥${Math.round((task.reportedDuration || 0) * 80).toLocaleString()}`}
        />
      </div>
    </div>
  );
}

function TrialCTA({ task }) {
  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #F2FBF8 0%, #FFFFFF 100%)",
        borderRadius: 10,
        border: "1px solid #B0E8DC",
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
        <Badge tone="teal" dot>
          试播任务
        </Badge>
        <span style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
          · 不计入正式结算
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.55 }}>
        厂家邀请你试播。完成后请上传 60
        分钟以上录屏，运营与厂家二审后将决定是否正式加入项目。
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <Button kind="default" style={{ flex: 1 }}>
          查看项目要求
        </Button>
        <Button
          kind="primary"
          icon={<Icon.Upload size={13} stroke="#fff" />}
          style={{ flex: 1 }}
        >
          上传录屏
        </Button>
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
              flexShrink: 0,
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
                border: "2px solid #fff",
                boxShadow: e.current
                  ? "0 0 0 3px rgba(30,80,200,0.22)"
                  : "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 2,
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
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: e.done || e.current ? 600 : 500,
                color:
                  e.done || e.current ? "var(--ink-900)" : "var(--ink-400)",
              }}
            >
              {e.title}
            </div>
            <div
              style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}
            >
              {e.time}
              {e.current && (
                <span
                  style={{
                    marginLeft: 6,
                    color: "var(--blue-700)",
                    fontWeight: 600,
                  }}
                >
                  · 当前
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== src-streamer-pc\screen-videos.jsx =====
// ——— Screen: 录屏库 ——————————————————————

function ScreenVideos({
  recordings = MY_RECORDINGS,
  projectAnnouncements = [],
  actions = {},
}) {
  const [tab, setTab] = React.useState("all");
  const [form, setForm] = React.useState(() => ({
    product: "",
    category: "",
    link: "",
    month: currentMonthLabel(),
  }));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [selectedProject, setSelectedProject] = React.useState(null);
  const [projectForm, setProjectForm] = React.useState({ link: "" });
  const [projectSubmitting, setProjectSubmitting] = React.useState(false);
  const [projectError, setProjectError] = React.useState("");
  const [detailLoading, setDetailLoading] = React.useState(false);
  const announcementRows = Array.isArray(projectAnnouncements)
    ? projectAnnouncements
    : [];
  const counts = {
    all: recordings.length,
    submitted: recordings.filter((item) => item.status === "submitted").length,
    reviewing: recordings.filter((item) => item.status === "reviewing").length,
    approved: recordings.filter((item) => item.status === "approved").length,
  };
  const filtered =
    tab === "all"
      ? recordings
      : recordings.filter((item) => item.status === tab);

  const updateForm = (key, value) => {
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openProjectDetail = async (project) => {
    setProjectError("");
    setDetailLoading(true);
    setSelectedProject(project);
    try {
      const detail = await actions.getProjectAnnouncement?.(project.id);
      if (detail) {
        setSelectedProject(detail);
      }
    } catch (detailError) {
      setProjectError(recordingLinkErrorMessage(detailError));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeProjectDetail = () => {
    setSelectedProject(null);
    setProjectForm({ link: "" });
    setProjectError("");
  };

  const updateProjectForm = (key, value) => {
    setProjectError("");
    setProjectForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await actions.submitRecordingLink?.(form);
      setForm({
        product: "",
        category: "",
        link: "",
        month: currentMonthLabel(),
      });
    } catch (submitError) {
      setError(recordingLinkErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const submitProjectRecording = async (event) => {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    setProjectSubmitting(true);
    setProjectError("");
    try {
      const result = await actions.submitRecordingLink?.({
        projectId: selectedProject.id,
        link: projectForm.link,
      });
      const reviewStatusLabel = result?.reviewStatusLabel || "审核中";
      setSelectedProject((current) =>
        current && current.id === selectedProject.id
          ? {
              ...current,
              applicationId: result?.applicationId ?? current.applicationId,
              applicationStatus: "recording_reviewing",
              latestRecordingStatus: "submitted",
              latestRecordingVersion:
                result?.recording?.version ?? current.latestRecordingVersion,
              reviewStatusLabel,
              canSubmitRecording: false,
            }
          : current,
      );
      setProjectForm({ link: "" });
    } catch (submitError) {
      setProjectError(recordingLinkErrorMessage(submitError));
    } finally {
      setProjectSubmitting(false);
    }
  };

  return (
    <>
      <PageHero
        title="录屏库"
        subtitle="提交录屏链接 URL · 按产品、品类、月份与审核状态留档"
        actions={
          <>
            <Button kind="default" icon={<Icon.Filter size={14} />}>
              按品类筛选
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Export size={14} stroke="#fff" />}
            >
              提交链接
            </Button>
          </>
        }
      />

      <div style={{ padding: "24px 24px 0", display: "grid", gap: 16 }}>
        <Card
          title="项目公告"
          extra={<Badge tone="blue">{announcementRows.length} 个</Badge>}
        >
          {announcementRows.length === 0 ? (
            <EmptyCard
              title="暂无公开项目公告"
              hint="当前组织暂未发布公开招募项目。"
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {announcementRows.map((project) => (
                <DesktopProjectAnnouncementCard
                  key={project.id}
                  project={project}
                  onOpen={openProjectDetail}
                />
              ))}
            </div>
          )}
        </Card>

        {selectedProject ? (
          <DesktopProjectAnnouncementDetail
            project={selectedProject}
            form={projectForm}
            error={projectError}
            loading={detailLoading}
            submitting={projectSubmitting}
            onChange={updateProjectForm}
            onSubmit={submitProjectRecording}
            onClose={closeProjectDetail}
          />
        ) : null}
      </div>

      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: "1.45fr 0.95fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <Card padded={false}>
          <div
            style={{ padding: "0 12px", borderBottom: "1px solid var(--line)" }}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: "all", label: "全部", count: counts.all },
                {
                  key: "submitted",
                  label: "待审核",
                  count: counts.submitted,
                },
                {
                  key: "reviewing",
                  label: "审核中",
                  count: counts.reviewing,
                },
                { key: "approved", label: "已通过", count: counts.approved },
              ]}
            />
          </div>

          <div style={{ padding: 16 }}>
            <RecordingLinkForm
              form={form}
              error={error}
              submitting={submitting}
              onChange={updateForm}
              onSubmit={submit}
            />
            <div style={{ marginTop: 16 }}>
              <DataTable
                columns={[
                  { title: "产品", key: "product", width: "20%" },
                  {
                    title: "品类",
                    key: "category",
                    width: "14%",
                    render: (row) => <Badge tone="blue">{row.category}</Badge>,
                  },
                  {
                    title: "链接",
                    key: "link",
                    wrap: true,
                    render: (row) => (
                      <a
                        href={row.link}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "var(--blue-700)",
                          textDecoration: "none",
                          wordBreak: "break-all",
                        }}
                      >
                        {row.link}
                      </a>
                    ),
                  },
                  {
                    title: "月份",
                    key: "month",
                    width: 96,
                    render: (row) => <span className="mono">{row.month}</span>,
                  },
                  {
                    title: "审核状态",
                    key: "statusLabel",
                    width: 112,
                    render: (row) => (
                      <Badge tone={recordingStatusTone(row.status)} dot>
                        {row.statusLabel}
                      </Badge>
                    ),
                  },
                ]}
                rows={filtered}
                emptyText="暂无录屏链接，提交 URL 后会进入审核表格。"
              />
            </div>
          </div>
        </Card>

        {/* Right panel: guidance + recent project requirements */}
        <div
          style={{
            position: "sticky",
            top: 76,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <Card
            title="录屏链接审核口径"
            extra={
              <Badge tone="violet" dot>
                AI 总结
              </Badge>
            }
          >
            <div
              style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.7 }}
            >
              审核只读取你提交的 URL 与表格字段。常见驳回原因：
            </div>
            <ul
              style={{
                margin: "10px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {[
                ["链接不可访问", "请确认 URL 可打开且无需私有登录"],
                ["产品不清晰", "产品名需与项目或游戏名称一致"],
                ["品类不匹配", "请按实际录屏内容填写品类"],
                ["月份错误", "按录屏归档月份填写 YYYY-MM"],
              ].map(([t, d], i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 12,
                    color: "var(--ink-700)",
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: "var(--violet-50)",
                      color: "var(--violet-600)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 10,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>
                    <b style={{ color: "var(--violet-600)" }}>{t}：</b>
                    {d}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="表格字段">
            <KV label="产品">录屏对应产品或游戏</KV>
            <KV label="品类">录屏内容所属品类</KV>
            <KV label="链接">http(s) 录屏 URL</KV>
            <KV label="月份">YYYY-MM 归档月份</KV>
            <KV label="审核状态">待审核 / 审核中 / 已通过 / 已驳回</KV>
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                background: "var(--blue-50)",
                color: "var(--ink-700)",
                fontSize: 12,
                lineHeight: 1.65,
              }}
            >
              这里只保存 URL 与审核元数据，不再上传 MP4/MOV 文件到前端 bucket。
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function DesktopProjectAnnouncementCard({ project, onOpen }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 14,
        background: "var(--bg-soft)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--ink-900)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 3 }}>
            {project.product || project.code}
          </div>
        </div>
        <Badge tone={recordingStatusTone(project.latestRecordingStatus)} dot>
          {project.reviewStatusLabel}
        </Badge>
      </div>
      {project.publicSummary ? (
        <div style={{ fontSize: 12, color: "var(--ink-600)", lineHeight: 1.6 }}>
          {project.publicSummary}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {project.gameDownloadUrl ? (
          <a
            href={project.gameDownloadUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              height: 30,
              padding: "0 10px",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              background: "#fff",
              color: "var(--blue-700)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            打开游戏下载
          </a>
        ) : null}
        <Button size="sm" kind="primary" onClick={() => onOpen(project)}>
          查看详情
        </Button>
      </div>
    </div>
  );
}

function DesktopProjectAnnouncementDetail({
  project,
  form,
  error,
  loading,
  submitting,
  onChange,
  onSubmit,
  onClose,
}) {
  return (
    <Card
      title="项目详情"
      extra={
        <Badge tone={recordingStatusTone(project.latestRecordingStatus)} dot>
          {project.reviewStatusLabel}
        </Badge>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ fontSize: 18, fontWeight: 700, color: "var(--ink-900)" }}
            >
              {project.name}
            </div>
            <div
              style={{ marginTop: 4, fontSize: 13, color: "var(--ink-500)" }}
            >
              {project.product || project.code}
            </div>
          </div>
          <Button kind="default" size="sm" onClick={onClose}>
            返回列表
          </Button>
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
            正在加载项目详情...
          </div>
        ) : null}
        {project.publicSummary ? (
          <div
            style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.7 }}
          >
            {project.publicSummary}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <KV label="录屏要求">
            {project.forceRecording
              ? "需提交项目试播录屏"
              : "可提交项目试播录屏"}
          </KV>
          {project.gameDownloadUrl ? (
            <KV label="游戏下载">
              <a
                href={project.gameDownloadUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--blue-700)",
                  textDecoration: "none",
                  wordBreak: "break-all",
                }}
              >
                {project.gameDownloadUrl}
              </a>
            </KV>
          ) : null}
        </div>
        {project.recordingFeedback ? (
          <div
            style={{
              color: "var(--warn-600)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {project.recordingFeedback}
          </div>
        ) : null}
        <form
          onSubmit={onSubmit}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1fr) auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <FieldInput
            label="录屏链接"
            value={form.link}
            placeholder="https://..."
            onChange={(value) => onChange("link", value)}
          />
          <Button
            kind="primary"
            type="submit"
            disabled={submitting || !project.canSubmitRecording}
          >
            {submitting ? "提交中" : "提交项目录屏"}
          </Button>
          {error ? (
            <div
              style={{
                gridColumn: "1 / -1",
                color: "var(--danger-600)",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </form>
      </div>
    </Card>
  );
}

function RecordingLinkForm({ form, error, submitting, onChange, onSubmit }) {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 120px 1.5fr 120px auto",
        gap: 10,
        alignItems: "end",
      }}
    >
      <FieldInput
        label="产品"
        value={form.product}
        placeholder="例如：Game Alpha"
        onChange={(value) => onChange("product", value)}
      />
      <FieldInput
        label="品类"
        value={form.category}
        placeholder="ARPG"
        onChange={(value) => onChange("category", value)}
      />
      <FieldInput
        label="链接"
        value={form.link}
        placeholder="https://..."
        onChange={(value) => onChange("link", value)}
      />
      <FieldInput
        label="月份"
        value={form.month}
        placeholder="2026-06"
        onChange={(value) => onChange("month", value)}
      />
      <Button kind="primary" type="submit" disabled={submitting}>
        {submitting ? "提交中" : "提交录屏链接"}
      </Button>
      {error && (
        <div
          style={{
            gridColumn: "1 / -1",
            color: "var(--danger-600)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}

function FieldInput({ label, value, placeholder, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--ink-400)" }}>{label}</span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 32,
          border: "1px solid var(--line-strong)",
          borderRadius: 8,
          padding: "0 10px",
          fontSize: 13,
          outline: "none",
          color: "var(--ink-900)",
          background: "#fff",
        }}
      />
    </label>
  );
}

function recordingStatusTone(status) {
  return (
    {
      submitted: "amber",
      reviewing: "violet",
      approved: "green",
      rejected: "red",
      needs_changes: "amber",
    }[status] ?? "neutral"
  );
}

function recordingLinkErrorMessage(error) {
  const message = error?.message || "";
  if (message.includes("Only streamers")) {
    return "请先登录主播账号后再提交录屏链接。";
  }
  if (message.includes("not bound to a streamer")) {
    return "当前账号还未绑定主播档案，请先完成主播档案配置。";
  }
  if (message.includes("Product is required")) {
    return "请填写产品。";
  }
  if (message.includes("Category is required")) {
    return "请填写品类。";
  }
  if (message.includes("Recording link is required")) {
    return "请填写录屏链接。";
  }
  if (message.includes("valid http")) {
    return "录屏链接必须是可访问的 http(s) URL。";
  }
  if (message.includes("Month is required")) {
    return "请填写月份。";
  }
  if (message.includes("YYYY-MM")) {
    return "月份格式需为 YYYY-MM。";
  }
  return message || "录屏链接提交失败，请稍后重试。";
}

function currentMonthLabel() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function VideoCard({ v }) {
  const st = VIDEO_STATUS[v.status];
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "var(--shadow-card)",
        cursor: "pointer",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          aspectRatio: "16 / 9",
          position: "relative",
          background: "linear-gradient(135deg, #0E1530 0%, #1842A6 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <Icon.Play size={18} stroke="#fff" sw={2} />
        </div>
        <span
          className="num"
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            fontSize: 10.5,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {v.duration}
        </span>
        <span style={{ position: "absolute", top: 8, left: 8 }}>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: 12 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--ink-900)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {v.title}
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4 }}
        >
          {displayRecordId(v.id, "录屏")} · {v.uploaded}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Badge tone={v.forProject === "历史录屏" ? "neutral" : "blue"}>
            {v.forProject}
          </Badge>
        </div>
      </div>
    </div>
  );
}

// ===== src-streamer-pc\screen-ai.jsx =====
// ——— Screen: AI 卡点诊断 (Desktop) ———————————————————

function ScreenAI({ go, profile = EMPTY_PROFILE }) {
  const [thread, setThread] = React.useState(AI_THREAD);
  const [input, setInput] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, typing]);

  const send = (text) => {
    if (!text) return;
    setThread((prev) => [...prev, { role: "me", text, time: nowHM() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setThread((prev) => [
        ...prev,
        {
          role: "ai",
          text: "收到。基于你的描述，建议先观察开播后 30 分钟：进房峰值、停留曲线和互动密度。如果任一指标明显低于近期均值，就切换备用话术。我会在直播后做对照复盘。",
          time: nowHM(),
        },
      ]);
    }, 1000);
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)" }}>
      {/* History sidebar */}
      <aside
        style={{
          width: 256,
          background: "#fff",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
          <Button
            kind="primary"
            icon={<Icon.Plus size={14} stroke="#fff" />}
            style={{ width: "100%" }}
          >
            新会话
          </Button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
          <div
            style={{
              padding: "8px 10px",
              fontSize: 11,
              color: "var(--ink-400)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            今天
          </div>
          <HistoryItem
            title="开播表现复盘"
            snippet="进房少 + 留不住复合卡点…"
            time="19:08"
            active
          />
          <HistoryItem
            title="脚本：开场互动话术"
            snippet="开场 3 分钟速通版本…"
            time="14:22"
          />

          <div
            style={{
              padding: "12px 10px 8px",
              fontSize: 11,
              color: "var(--ink-400)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            近 7 天
          </div>
          <HistoryItem
            title="5/25 互动转化偏低复盘"
            snippet="弹幕活跃度低于均值 36%…"
            time="昨日"
          />
          <HistoryItem
            title="试播话术建议"
            snippet="高能 PVP 风格匹配度 89%…"
            time="昨日"
          />
          <HistoryItem
            title="周末时段选取建议"
            snippet="周六 19-23 时段建议优先…"
            time="3 天前"
          />

          <div
            style={{
              padding: "12px 10px 8px",
              fontSize: 11,
              color: "var(--ink-400)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            更早
          </div>
          <HistoryItem
            title="4 月项目复盘"
            snippet="历史项目收益总结…"
            time="上月"
          />
        </div>
        <div
          style={{
            padding: 12,
            borderTop: "1px solid var(--line)",
            fontSize: 11,
            color: "var(--ink-400)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <Icon.Lock size={11} stroke="var(--ok-600)" />
            <span style={{ color: "var(--ok-600)", fontWeight: 600 }}>
              仅你可见
            </span>
          </div>
          AI 仅可访问你自己的任务 / 报数 / 录屏数据，不会泄露给运营或其他主播。
        </div>
      </aside>

      {/* Main chat */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
        }}
      >
        {/* Conversation header */}
        <div
          style={{
            padding: "14px 24px",
            background: "#fff",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #8C7DEB, #1E50C8)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon.Sparkles size={16} stroke="#fff" sw={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
            >
              开播表现复盘
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-400)" }}>
              基于你近 14 天任务、报数、录屏 · 默认模型：haiku-4-5
            </div>
          </div>
          <Button kind="ghost" size="sm" icon={<Icon.Export size={13} />}>
            导出会话
          </Button>
          <Button kind="default" size="sm">
            复盘整理为脚本
          </Button>
        </div>

        {/* Scrolling thread */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <div
            style={{
              maxWidth: 760,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {/* Suggested question chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                "昨天的进房为什么下滑",
                "今晚怎么开播",
                "帮我写开场话术",
                "上周礼物提成怎样了",
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  style={{
                    padding: "6px 12px",
                    height: 30,
                    fontSize: 12,
                    background: "#fff",
                    border: "1px solid var(--line-strong)",
                    color: "var(--ink-700)",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--blue-500)";
                    e.currentTarget.style.color = "var(--blue-700)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--line-strong)";
                    e.currentTarget.style.color = "var(--ink-700)";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>

            {thread.map((m, i) => (
              <Message key={i} msg={m} profile={profile} />
            ))}
            {typing && <TypingBubble />}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: "12px 24px 20px", background: "var(--bg)" }}>
          <div
            style={{
              maxWidth: 760,
              margin: "0 auto",
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              padding: "8px 8px 8px 16px",
              background: "#fff",
              borderRadius: 16,
              border: "1px solid var(--line)",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="把你的疑问告诉我，比如「为什么昨晚进房少」…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                resize: "none",
                background: "transparent",
                minHeight: 26,
                maxHeight: 120,
                fontFamily: "inherit",
                fontSize: 14,
                color: "var(--ink-900)",
                padding: "6px 0",
                lineHeight: 1.5,
              }}
              rows={1}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--ink-400)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="附加任务上下文"
              >
                <Icon.Tasks size={15} />
              </button>
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "none",
                  background: input.trim()
                    ? "var(--blue-600)"
                    : "var(--ink-100)",
                  color: "#fff",
                  cursor: input.trim() ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon.Sparkles size={15} stroke="#fff" sw={2} />
              </button>
            </div>
          </div>
          <div
            style={{
              maxWidth: 760,
              margin: "6px auto 0",
              fontSize: 11,
              color: "var(--ink-400)",
              textAlign: "center",
            }}
          >
            ⌘ + ↵ 发送 · 此会话只读取你的数据
          </div>
        </div>
      </main>
    </div>
  );
}

function HistoryItem({ title, snippet, time, active }) {
  return (
    <button
      style={{
        width: "100%",
        padding: "10px 12px",
        textAlign: "left",
        background: active ? "var(--blue-50)" : "transparent",
        border: "none",
        borderRadius: 8,
        cursor: "pointer",
        marginBottom: 2,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--ink-50)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: active ? "var(--blue-700)" : "var(--ink-900)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: active ? "var(--blue-700)" : "var(--ink-400)",
            flexShrink: 0,
          }}
        >
          {time}
        </span>
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-400)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {snippet}
      </div>
    </button>
  );
}

function Message({ msg, profile = EMPTY_PROFILE }) {
  const isMe = msg.role === "me";
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexDirection: isMe ? "row-reverse" : "row",
        alignItems: "flex-start",
      }}
    >
      {!isMe ? (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            flexShrink: 0,
            background: "linear-gradient(135deg, #8C7DEB, #1E50C8)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Sparkles size={14} stroke="#fff" sw={1.8} />
        </div>
      ) : (
        <Avatar name={profile.alias} size={32} />
      )}
      <div
        style={{
          maxWidth: "76%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: isMe ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            background: isMe ? "var(--blue-600)" : "#fff",
            color: isMe ? "#fff" : "var(--ink-900)",
            border: isMe ? "none" : "1px solid var(--line)",
            borderRadius: 14,
            borderTopRightRadius: isMe ? 4 : 14,
            borderTopLeftRadius: isMe ? 14 : 4,
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            boxShadow: isMe ? "none" : "var(--shadow-card)",
          }}
        >
          {msg.text}
          {msg.bullets && (
            <ul
              style={{
                margin: "10px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {msg.bullets.map((b, i) => (
                <li key={i} style={{ display: "flex", gap: 8, fontSize: 13.5 }}>
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
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {msg.insight && <InsightCard insight={msg.insight} />}
        {msg.suggestions && <SuggestionsCard items={msg.suggestions} />}

        <div style={{ fontSize: 10.5, color: "var(--ink-300)" }}>
          {msg.time}
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight }) {
  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #F8F6FF 0%, #EEF3FF 100%)",
        border: "1px solid #D8D0FA",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 12,
        }}
      >
        <Icon.Warn size={14} stroke="var(--violet-600)" />
        <span
          style={{ fontSize: 12, fontWeight: 700, color: "var(--violet-600)" }}
        >
          卡点判断 · {insight.type}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        {insight.evidence.map(([k, v, u], i) => (
          <div
            key={i}
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                color: "var(--ink-400)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {k}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 3,
                marginTop: 4,
              }}
            >
              <span
                className="num"
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                  letterSpacing: "-0.01em",
                }}
              >
                {v}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--ink-400)" }}>
                {u}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionsCard({ items }) {
  return (
    <div
      style={{
        padding: 16,
        background: "linear-gradient(135deg, #E6F6EE 0%, #F7FFF9 100%)",
        border: "1px solid #B8E6CC",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 12,
        }}
      >
        <Icon.Check size={14} stroke="var(--ok-600)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ok-600)" }}>
          开播实验建议
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {items.map((t, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              background: "#fff",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "var(--ok-50)",
                color: "var(--ok-600)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                fontSize: 12.5,
                color: "var(--ink-700)",
                lineHeight: 1.55,
              }}
            >
              {t}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <Button size="sm" kind="default">
          保存为脚本
        </Button>
        <Button size="sm" kind="primary">
          发我话术稿
        </Button>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: "linear-gradient(135deg, #8C7DEB, #1E50C8)",
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon.Sparkles size={14} stroke="#fff" sw={1.8} />
      </div>
      <div
        style={{
          padding: "14px 16px",
          background: "#fff",
          border: "1px solid var(--line)",
          borderRadius: 14,
          borderTopLeftRadius: 4,
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--ink-300)",
              animation: `aiblink2 1.2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
        <style>{`@keyframes aiblink2 { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }`}</style>
      </div>
    </div>
  );
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ===== src-streamer-pc\screen-earnings.jsx =====
// ——— Screen: 结算账单 ——————————————————————

const SETTLEMENT_HISTORY = [];

const BATCH_DETAIL_TASKS = [];

function ScreenEarnings({ go }) {
  const [activeBatch, setActiveBatch] = React.useState(
    SETTLEMENT_HISTORY[0]?.batch ?? null,
  );
  const cur =
    SETTLEMENT_HISTORY.find((b) => b.batch === activeBatch) ||
    SETTLEMENT_HISTORY[0] ||
    null;
  const ytd = SETTLEMENT_HISTORY.reduce((s, b) => s + b.amount, 0);

  if (!cur) {
    return (
      <>
        <PageHero
          title="结算账单"
          subtitle="实际金额以运营在月底锁定批次后为准 · 数据仅展示你自己"
          actions={
            <Button kind="default" icon={<Icon.Export size={14} />}>
              导出 PDF 账单
            </Button>
          }
        />
        <div style={{ padding: 24 }}>
          <EmptyCard
            title="暂无结算批次"
            hint="运营锁定应付批次后，你可以在这里查看金额、明细和复核入口。"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero
        title="结算账单"
        subtitle="实际金额以运营在月底锁定批次后为准 · 数据仅展示你自己"
        actions={
          <Button kind="default" icon={<Icon.Export size={14} />}>
            导出 PDF 账单
          </Button>
        }
      />

      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Top stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Card
            style={{
              background:
                "linear-gradient(135deg, var(--blue-700), var(--blue-500))",
              borderColor: "var(--blue-500)",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.78)" }}>
              本月预估
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 4,
                marginTop: 6,
              }}
            >
              <span style={{ fontSize: 12 }}>¥</span>
              <span
                className="num"
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                }}
              >
                {(
                  MY_EARNINGS.currentMonth.earned +
                  MY_EARNINGS.currentMonth.pending
                ).toLocaleString()}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.78)",
                marginTop: 6,
              }}
            >
              已结算 ¥{MY_EARNINGS.currentMonth.earned.toLocaleString()} · 待审
              ¥{MY_EARNINGS.currentMonth.pending.toLocaleString()}
            </div>
          </Card>
          <Card>
            <Metric
              label="2026 年累计"
              value={`¥${ytd.toLocaleString()}`}
              hint={`${SETTLEMENT_HISTORY.length} 个批次`}
            />
          </Card>
          <Card>
            <Metric
              label="近 6 月均值"
              value="¥11,890"
              delta="+8.4%"
              hint="较去年"
            />
          </Card>
          <Card>
            <Metric
              label="本月录屏通过率"
              value="95"
              unit="%"
              hint="近 30 天"
            />
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
          {/* Batch list */}
          <Card
            title="结算批次"
            extra={<Badge tone="neutral">最近 5 期</Badge>}
            padded={false}
          >
            {SETTLEMENT_HISTORY.map((b, i) => {
              const active = b.batch === activeBatch;
              return (
                <div
                  key={b.batch}
                  onClick={() => setActiveBatch(b.batch)}
                  style={{
                    padding: "14px 16px",
                    cursor: "pointer",
                    borderBottom:
                      i < SETTLEMENT_HISTORY.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                    background: active ? "var(--blue-50)" : "transparent",
                    borderLeft: active
                      ? "3px solid var(--blue-600)"
                      : "3px solid transparent",
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
                      {b.batch}
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        marginTop: 2,
                      }}
                    >
                      {b.project}
                    </div>
                    <div
                      className="num"
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {b.period}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      className="num"
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "var(--ink-900)",
                      }}
                    >
                      ¥{b.amount.toLocaleString()}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {b.status === "locked" && (
                        <Badge tone="teal" dot>
                          已锁定
                        </Badge>
                      )}
                      {b.status === "settled" && (
                        <Badge tone="green" dot>
                          已结算
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* Batch detail */}
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
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {cur.batch}
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                        marginTop: 4,
                      }}
                    >
                      {cur.project} · 主播应付明细
                    </div>
                    <div
                      className="num"
                      style={{
                        fontSize: 12,
                        color: "var(--ink-400)",
                        marginTop: 4,
                      }}
                    >
                      {cur.period} · 锁定于 {cur.date}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                      合计应付给你
                    </div>
                    <div
                      className="num"
                      style={{
                        fontSize: 26,
                        fontWeight: 700,
                        color: "var(--ink-900)",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      ¥{cur.amount.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    background: "var(--bg-soft)",
                    borderRadius: 8,
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 12,
                  }}
                >
                  <Metric
                    label="底薪"
                    value={`¥${cur.breakdown.base.toLocaleString()}`}
                  />
                  <Metric
                    label="有效时长"
                    value={cur.breakdown.hours.toFixed(1)}
                    unit="h"
                  />
                  <Metric
                    label="变动 (CPT)"
                    value={`¥${cur.breakdown.variable.toLocaleString()}`}
                  />
                  <Metric
                    label="调整"
                    value={
                      cur.breakdown.adj === 0
                        ? "—"
                        : cur.breakdown.adj > 0
                          ? `+¥${cur.breakdown.adj}`
                          : `¥${cur.breakdown.adj}`
                    }
                  />
                </div>
              </div>

              {/* Task-level breakdown */}
              <div
                style={{
                  padding: "12px 20px 4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-700)",
                  }}
                >
                  任务明细
                </div>
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  共 {BATCH_DETAIL_TASKS.length} 个任务
                </span>
              </div>

              <DataTable
                dense
                columns={[
                  {
                    title: "日期",
                    render: (r) => <span className="num">{r.date}</span>,
                  },
                  {
                    title: "任务",
                    render: (r) => (
                      <div>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                        >
                          {displayRecordId(r.id, "结算项")}
                        </div>
                        <div
                          style={{ fontWeight: 500, color: "var(--ink-900)" }}
                        >
                          {r.name}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "有效时长",
                    align: "right",
                    render: (r) => (
                      <span className="num" style={{ fontWeight: 600 }}>
                        {r.hours.toFixed(1)} h
                      </span>
                    ),
                  },
                  {
                    title: "本场 CPT",
                    align: "right",
                    render: (r) => (
                      <span className="num">
                        ¥{r.variable.toLocaleString()}
                      </span>
                    ),
                  },
                ]}
                rows={BATCH_DETAIL_TASKS}
              />

              <div
                style={{
                  padding: 12,
                  borderTop: "1px solid var(--line)",
                  background: "var(--bg-soft)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-400)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Icon.Lock size={12} stroke="var(--ink-400)" />
                  本批次已锁定 · 由运营负责人确认
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" kind="default">
                    下载 PDF
                  </Button>
                  <Button size="sm" kind="default">
                    申请复核
                  </Button>
                </div>
              </div>
            </Card>

            {/* Help card */}
            <Card
              style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}
            >
              <div style={{ display: "flex", gap: 12 }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "var(--blue-50)",
                    color: "var(--blue-700)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon.Eye size={15} stroke="var(--blue-700)" />
                </span>
                <div
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    color: "var(--ink-700)",
                    lineHeight: 1.7,
                  }}
                >
                  <b style={{ color: "var(--ink-900)" }}>我看到的金额对吗？</b>
                  <br />
                  这里显示的是 MCN 应付给你的金额，按{" "}
                  <b>主播项目规则 → 主播默认规则 → 项目默认规则</b> 顺序应用。
                  你无法看到厂家应收、毛利等敏感字段（已脱敏）。对金额有异议可点「申请复核」。
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

// ===== src-streamer-pc\screen-profile.jsx =====
// ——— Screen: 个人资料 & 平台 ——————————————————————

function ScreenProfile({ go, profile = EMPTY_PROFILE }) {
  const profilePlatforms = Array.isArray(profile.platforms)
    ? profile.platforms
    : [];

  return (
    <>
      <PageHero
        title="个人资料 & 平台"
        subtitle="档案信息、平台账号绑定、隐私与权限"
        actions={<Button kind="primary">联系运营更新</Button>}
      />

      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Profile header */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 999,
                  background:
                    "linear-gradient(135deg, var(--blue-600), var(--blue-800))",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  boxShadow: "0 4px 12px rgba(30,80,200,0.28)",
                }}
              >
                {profile.alias.slice(0, 1)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: "var(--ink-900)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {profile.alias}
                  </span>
                  <Badge tone="blue" dot>
                    {profile.level}
                  </Badge>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-400)",
                    marginTop: 4,
                  }}
                >
                  {profile.real} · {profile.gender} ·{" "}
                  <span className="mono">{profile.id || "未绑定"}</span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-400)",
                    marginTop: 2,
                  }}
                >
                  所属：{profile.org} · 签约于 {profile.signedAt}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid var(--line)",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              <Metric
                label="参与项目"
                value={profile.stats.projectCount}
                unit="个"
              />
              <Metric
                label="录屏"
                value={profile.stats.recordingCount}
                unit="条"
              />
              <Metric
                label="累计直播"
                value={profile.stats.totalLiveHours}
                unit="h"
              />
            </div>
          </Card>

          {/* Platform bindings */}
          <Card
            title="已绑定平台"
            extra={
              <Button size="sm" kind="default" icon={<Icon.Plus size={12} />}>
                联系运营新增
              </Button>
            }
            padded={false}
          >
            {profilePlatforms.length === 0 && (
              <div
                style={{
                  padding: "20px 16px",
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "var(--ink-400)",
                }}
              >
                暂无已绑定平台。平台账号由运营审核后绑定。
              </div>
            )}
            {profilePlatforms.map((p, i) => (
              <div
                key={p.id}
                style={{
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  borderBottom:
                    i < profilePlatforms.length - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background:
                      p.platform === "抖音"
                        ? "#000"
                        : "linear-gradient(135deg, #FB7299, #00A1D6)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {p.platform.slice(0, 1)}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--ink-900)",
                      }}
                    >
                      {p.platform}
                    </span>
                    {p.primary && <Badge tone="amber">主账号</Badge>}
                    <Badge tone={p.verified ? "green" : "neutral"} dot>
                      {p.verified ? "已认证" : "待认证"}
                    </Badge>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-400)",
                      marginTop: 4,
                    }}
                  >
                    {p.account}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-500)",
                      marginTop: 4,
                    }}
                  >
                    粉丝{" "}
                    <span className="num" style={{ fontWeight: 600 }}>
                      {p.followers.toLocaleString()}
                    </span>
                    {" · "} 同步状态：来自平台账号表
                  </div>
                </div>
                <Button size="sm" kind="default">
                  查看
                </Button>
              </div>
            ))}
          </Card>

          {/* Tags */}
          <Card
            title="能力标签"
            extra={
              <Button size="sm" kind="link">
                运营配置
              </Button>
            }
          >
            <TagGroup
              label="擅长游戏品类"
              tags={profile.tags.categories}
              tone="blue"
            />
            <TagGroup
              label="直播风格"
              tags={profile.tags.styles}
              tone="violet"
            />
            <TagGroup
              label="技能标签"
              tags={profile.tags.skills}
              tone="amber"
            />
            <TagGroup
              label="可播时间"
              tags={profile.tags.availability}
              tone="teal"
            />
            <TagGroup
              label="设备"
              tags={profile.tags.equipment}
              tone="neutral"
            />
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Default settlement */}
          <Card
            title="默认结算规则"
            extra={<Badge tone="neutral">由运营配置</Badge>}
          >
            <KV label="规则">
              <Badge tone="blue">{profile.settlement.rule}</Badge>
            </KV>
            <KV label="底薪周期">{profile.settlement.cycle}</KV>
            <KV label="底薪">{profile.settlement.baseSalary}</KV>
            <KV label="时薪 (CPT)">{profile.settlement.cpt}</KV>
            <KV label="礼物提成">{profile.settlement.giftShare}</KV>
            <KV label="结算银行卡">{profile.settlement.bank}</KV>
            <div
              style={{
                marginTop: 10,
                padding: 10,
                background: "var(--bg-soft)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--ink-500)",
                lineHeight: 1.65,
              }}
            >
              单个项目可被覆盖：主播项目规则 → 主播默认规则 →
              项目默认规则。如需调整，请联系运营负责人。
            </div>
          </Card>

          {/* Privacy */}
          <Card title="我能看到 / 我看不到">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PermRow can label="自己的任务、报数、录屏" />
              <PermRow can label="自己的结算明细金额" />
              <PermRow can label="AI 卡点诊断（仅你自己数据）" />
              <div
                style={{
                  height: 1,
                  background: "var(--line)",
                  margin: "4px 0",
                }}
              />
              <PermRow label="厂家单价 / 厂家应付" reason="敏感财务字段" />
              <PermRow label="MCN 毛利 / 利润率" reason="组织级数据" />
              <PermRow label="供应商内部成本" reason="组织级数据" />
              <PermRow label="其他主播的结算金额" reason="字段级隔离" />
              <PermRow label="审计日志" reason="管理员可见" />
            </div>
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "var(--blue-50)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--ink-700)",
                display: "flex",
                gap: 10,
              }}
            >
              <Icon.Lock size={14} stroke="var(--blue-700)" />
              <span>
                <b style={{ color: "var(--blue-700)" }}>字段级脱敏</b>
                由服务端强制执行，前端隐藏与你无关——即便有
                bug，你也访问不到隐藏字段。
              </span>
            </div>
          </Card>

          {/* Security */}
          <Card title="账号与安全" padded={false}>
            <SecRow
              icon="Lock"
              label="登录密码"
              value={profile.security.password}
              action="账号系统"
            />
            <SecRow
              icon="Settings"
              label="双因素认证"
              value={profile.security.mfa}
              action="账号系统"
            />
            <SecRow
              icon="Bell"
              label="通知偏好"
              value={profile.security.notifications}
              action="设置"
            />
            <SecRow
              icon="History"
              label="登录设备"
              value={profile.security.devices}
              action="查看"
              last
            />
          </Card>

          {/* Sign-out */}
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="default" style={{ flex: 1 }}>
              退出当前组织
            </Button>
            <Button kind="danger" style={{ flex: 1 }}>
              退出登录
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function TagGroup({ label, tags, tone }) {
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tags.map((t) => (
          <Badge key={t} tone={tone}>
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PermRow({ can, label, reason }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          background: can ? "var(--ok-50)" : "var(--ink-50)",
          color: can ? "var(--ok-600)" : "var(--ink-300)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {can ? (
          <Icon.Check size={11} sw={2.4} />
        ) : (
          <Icon.X size={10} sw={2.2} />
        )}
      </span>
      <span
        style={{ flex: 1, color: can ? "var(--ink-900)" : "var(--ink-500)" }}
      >
        {label}
      </span>
      {reason && (
        <span style={{ fontSize: 11, color: "var(--ink-400)" }}>{reason}</span>
      )}
    </div>
  );
}

function SecRow({ icon, label, value, action, last }) {
  const IconComp = Icon[icon];
  return (
    <div
      style={{
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: last ? "none" : "1px solid var(--line)",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--ink-50)",
          color: "var(--ink-500)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconComp size={15} />
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink-900)" }}
        >
          {label}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>
          {value}
        </div>
      </div>
      <Button size="sm" kind="default">
        {action}
      </Button>
    </div>
  );
}

function normalizeDesktopReferenceTasks(tasks) {
  if (!Array.isArray(tasks)) {
    return null;
  }

  return tasks.map((task) => normalizeDesktopReferenceTask(task));
}

function normalizeDesktopReferenceTask(task) {
  if ("plannedStartAt" in task || "plannedDuration" in task) {
    return toDesktopReferenceTask(task);
  }

  return {
    ...task,
    durationPlan: getTaskDurationHours(task),
    status: task.status || "pending_live",
  };
}

function toDesktopReferenceTask(task) {
  const plannedStart = task.plannedStartAt
    ? new Date(task.plannedStartAt)
    : null;
  const plannedEnd = task.plannedEndAt ? new Date(task.plannedEndAt) : null;
  const plannedMinutes =
    Number(task.plannedDuration) ||
    (plannedStart && plannedEnd
      ? Math.max(0, (plannedEnd.getTime() - plannedStart.getTime()) / 60000)
      : 0);
  const status = getDesktopReferenceTaskStatus(task.status, plannedEnd);

  return {
    id: task.id,
    projectName: task.projectName || task.title || "未命名任务",
    vendor: task.vendor || "项目方",
    dateStr: plannedStart ? formatDesktopDate(plannedStart) : "待排期",
    start: plannedStart ? formatDesktopTime(plannedStart) : "--:--",
    end: plannedEnd ? formatDesktopTime(plannedEnd) : "--:--",
    durationPlan: plannedMinutes ? plannedMinutes / 60 : 0,
    status,
    needStartStop: task.needStartStop ?? true,
    needScreening: task.needScreening ?? true,
    settleHint: task.settleHint || "按项目规则",
    note: task.note || "",
    reportedDuration: task.settlementDuration
      ? task.settlementDuration / 60
      : undefined,
    reportedAudience: task.viewers,
  };
}

function getDesktopReferenceTaskStatus(status, plannedEnd) {
  const baseStatus = status || "pending_live";
  if (
    baseStatus === "pending_live" &&
    plannedEnd &&
    !Number.isNaN(plannedEnd.getTime()) &&
    Date.now() > plannedEnd.getTime()
  ) {
    return "missed_live";
  }

  return baseStatus;
}

function formatDesktopDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDesktopTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

// ===== src-streamer-pc\app.jsx =====
// ——— App entry ————————————————————————

function StreamerDesktopReferenceInner({
  initialRoute = "dashboard",
  liveTasks,
  notificationItems,
  notificationUnreadCount,
  profile,
  recordings,
  projectAnnouncements = [],
}) {
  const [route, setRoute] = React.useState(initialRoute);
  const [taskId, setTaskId] = React.useState(null);
  const [tasks, setTasks] = React.useState(() =>
    normalizeDesktopReferenceTasks(liveTasks),
  );
  const [notifications, setNotifications] = React.useState(() =>
    normalizeStreamerNotifications(notificationItems),
  );
  const [notificationUnreadCountState, setNotificationUnreadCountState] =
    React.useState(() =>
      normalizeNotificationUnreadCount(
        notificationUnreadCount,
        notificationItems,
      ),
    );
  const [profileState, setProfileState] = React.useState(() =>
    normalizeStreamerProfile(profile),
  );
  const [recordingRows, setRecordingRows] = React.useState(() =>
    normalizeStreamerRecordings(recordings),
  );
  const [announcementRows, setAnnouncementRows] = React.useState(() =>
    normalizeProjectAnnouncements(projectAnnouncements),
  );

  React.useEffect(() => {
    setTasks(normalizeDesktopReferenceTasks(liveTasks));
  }, [liveTasks]);

  React.useEffect(() => {
    setNotifications(normalizeStreamerNotifications(notificationItems));
  }, [notificationItems]);

  React.useEffect(() => {
    setNotificationUnreadCountState(
      normalizeNotificationUnreadCount(
        notificationUnreadCount,
        notificationItems,
      ),
    );
  }, [notificationUnreadCount, notificationItems]);

  React.useEffect(() => {
    setProfileState(normalizeStreamerProfile(profile));
  }, [profile]);

  React.useEffect(() => {
    setRecordingRows(normalizeStreamerRecordings(recordings));
  }, [recordings]);

  React.useEffect(() => {
    setAnnouncementRows(normalizeProjectAnnouncements(projectAnnouncements));
  }, [projectAnnouncements]);

  const visibleTasks = Array.isArray(tasks) ? tasks : MY_TASKS;
  const visibleNotifications = Array.isArray(notifications)
    ? notifications
    : MY_NOTIFICATIONS;
  const visibleProfile = profileState || EMPTY_PROFILE;
  const visibleRecordings = Array.isArray(recordingRows)
    ? recordingRows
    : MY_RECORDINGS;
  const visibleAnnouncements = Array.isArray(announcementRows)
    ? announcementRows
    : [];
  const actions = React.useMemo(() => {
    const readJson = async (response, fallbackMessage) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || fallbackMessage);
      }
      return body;
    };

    const fetchJson = async (url, fallbackMessage, init) => {
      const response = await fetch(url, init);
      return readJson(response, fallbackMessage);
    };

    const refreshTasks = async () => {
      const body = await fetchJson(
        "/api/streamer/live-tasks",
        "refresh streamer tasks failed",
      );
      if (Array.isArray(body.tasks)) {
        setTasks(normalizeDesktopReferenceTasks(body.tasks));
      }
    };

    const refreshNotifications = async () => {
      const body = await fetchJson(
        "/api/notifications",
        "refresh notifications failed",
      );
      if (Array.isArray(body.items)) {
        setNotifications(normalizeStreamerNotifications(body.items));
      }
      setNotificationUnreadCountState(
        normalizeNotificationUnreadCount(body.unreadCount, body.items),
      );
    };

    const refreshProfile = async () => {
      const body = await fetchJson(
        "/api/streamer/profile",
        "refresh streamer profile failed",
      );
      if (body.profile) {
        setProfileState(normalizeStreamerProfile(body.profile));
      }
    };

    const refreshRecordings = async () => {
      const body = await fetchJson(
        "/api/streamer/recordings",
        "refresh streamer recordings failed",
      );
      if (Array.isArray(body.recordings)) {
        setRecordingRows(normalizeStreamerRecordings(body.recordings));
      }
    };

    const refreshProjectAnnouncements = async () => {
      const body = await fetchJson(
        "/api/streamer/project-announcements",
        "refresh project announcements failed",
      );
      if (Array.isArray(body.announcements)) {
        setAnnouncementRows(normalizeProjectAnnouncements(body.announcements));
      }
    };

    const getProjectAnnouncement = async (projectId) => {
      const body = await fetchJson(
        `/api/streamer/project-announcements/${projectId}`,
        "load project announcement failed",
      );
      return body.project
        ? normalizeProjectAnnouncements([body.project])[0]
        : null;
    };

    return {
      refreshTasks,
      refreshNotifications,
      refreshProfile,
      refreshRecordings,
      refreshProjectAnnouncements,
      getProjectAnnouncement,
      submitRecordingLink: async (form) => {
        const body = await fetchJson(
          "/api/streamer/recordings",
          "submit recording link failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          },
        );
        if (body.projectRecording) {
          await refreshProjectAnnouncements();
          return body.projectRecording;
        }
        if (body.recording) {
          setRecordingRows((current) => [
            normalizeStreamerRecordings([body.recording])[0],
            ...(Array.isArray(current) ? current : []),
          ]);
        }
        return body.recording;
      },
      startTask: async (id) => {
        await fetchJson(`/api/live-tasks/${id}/start`, "start task failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        await refreshTasks();
      },
      stopTask: async (id) => {
        await fetchJson(`/api/live-tasks/${id}/stop`, "stop task failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        await refreshTasks();
      },
      submitReport: async (id, input) => {
        const screenshotFile = input?.screenshotFile;
        if (!screenshotFile) {
          throw new Error("请先选择下播截图");
        }
        const fileName = sanitizeReportScreenshotFileName(
          screenshotFile.name || "report-screenshot.png",
        );
        const signed = await fetchJson(
          "/api/uploads/signed",
          "create report screenshot upload failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: "report-screenshots",
              ownerId: id,
              fileName,
            }),
          },
        );
        const screenshotFileHash = `manual-${id}-${Date.now()}-${fileName}-${screenshotFile.size ?? 0}`;
        const uploadResponse = await fetch(signed.signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": screenshotFile.type || "application/octet-stream",
          },
          body: screenshotFile,
        });
        if (!uploadResponse.ok) {
          throw new Error("upload report screenshot failed");
        }
        const queued = await fetchJson(
          `/api/live-tasks/${id}/ocr`,
          "create OCR report failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              screenshotStoragePath: signed.path,
              screenshotFileHash,
              imageBucket: signed.bucket,
            }),
          },
        );
        const queuedReportId = queued.report?.id;
        if (!queuedReportId) {
          throw new Error("OCR report response missing report id");
        }
        await refreshTasks();
        return queued;
      },
    };
  }, []);

  React.useEffect(() => {
    if (!Array.isArray(liveTasks)) {
      return undefined;
    }

    actions.refreshTasks?.().catch((error) => {
      console.warn("refresh streamer tasks failed", error);
    });
    const timer = window.setInterval(() => {
      actions.refreshTasks?.().catch((error) => {
        console.warn("refresh streamer tasks failed", error);
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [actions, liveTasks]);

  React.useEffect(() => {
    if (!Array.isArray(notificationItems)) {
      return undefined;
    }

    actions.refreshNotifications?.().catch((error) => {
      console.warn("refresh notifications failed", error);
    });
    const timer = window.setInterval(() => {
      actions.refreshNotifications?.().catch((error) => {
        console.warn("refresh notifications failed", error);
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [actions, notificationItems]);

  React.useEffect(() => {
    if (!profile) {
      return undefined;
    }

    actions.refreshProfile?.().catch((error) => {
      console.warn("refresh streamer profile failed", error);
    });
    const timer = window.setInterval(() => {
      actions.refreshProfile?.().catch((error) => {
        console.warn("refresh streamer profile failed", error);
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [actions, profile]);

  React.useEffect(() => {
    if (!Array.isArray(recordings)) {
      return undefined;
    }

    actions.refreshRecordings?.().catch((error) => {
      console.warn("refresh streamer recordings failed", error);
    });
    const timer = window.setInterval(() => {
      actions.refreshRecordings?.().catch((error) => {
        console.warn("refresh streamer recordings failed", error);
      });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [actions, recordings]);

  const go = (r, arg) => {
    if (r === "tasks" && arg) setTaskId(arg);
    setRoute(r);
    const content = globalThis.document?.getElementById("content-scroll");
    if (content) content.scrollTop = 0;
  };

  const titles = {
    dashboard: { t: "工作台", s: "今天 · 本周累计 · 待办与 AI 建议" },
    tasks: { t: "我的任务", s: "直播任务与报数审核状态" },
    videos: { t: "录屏库", s: "项目报名录屏 + 历史录屏" },
    ai: { t: "AI 卡点诊断", s: "基于你近 14 天数据 · 仅你可见" },
    earnings: { t: "结算账单", s: "主播应付明细" },
    profile: { t: "个人资料 & 平台", s: "档案 · 平台 · 隐私" },
  };
  const meta = titles[route] || titles.dashboard;

  return (
    <div
      style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}
    >
      <Sidebar
        route={route}
        onNav={go}
        profile={visibleProfile}
        taskBadgeCount={
          visibleTasks.filter((task) => task.status === "pending_report").length
        }
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          maxHeight: "100vh",
        }}
      >
        <TopBar
          title={meta.t}
          subtitle={meta.s}
          unreadNotificationCount={notificationUnreadCountState}
          notifications={visibleNotifications}
          profile={visibleProfile}
        />
        <div id="content-scroll" style={{ flex: 1, overflowY: "auto" }}>
          {route === "dashboard" && (
            <ScreenDashboard
              go={go}
              tasks={visibleTasks}
              notifications={visibleNotifications}
              profile={visibleProfile}
            />
          )}
          {route === "tasks" && (
            <ScreenTasks
              go={go}
              openTaskId={taskId}
              tasks={visibleTasks}
              actions={actions}
            />
          )}
          {route === "videos" && (
            <ScreenVideos
              recordings={visibleRecordings}
              projectAnnouncements={visibleAnnouncements}
              actions={actions}
            />
          )}
          {route === "ai" && <ScreenAI go={go} profile={visibleProfile} />}
          {route === "earnings" && <ScreenEarnings go={go} />}
          {route === "profile" && (
            <ScreenProfile go={go} profile={visibleProfile} />
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * @param {{ initialRoute?: string; liveTasks?: any[] | null; notificationItems?: any[] | null; notificationUnreadCount?: number | null; profile?: any; recordings?: any[] | null; projectAnnouncements?: any[] | null }} props
 */
export default function StreamerDesktopReferenceApp({
  initialRoute = "dashboard",
  liveTasks,
  notificationItems,
  notificationUnreadCount,
  profile,
  recordings,
  projectAnnouncements = [],
}) {
  return (
    <StreamerDesktopReferenceInner
      initialRoute={initialRoute}
      liveTasks={liveTasks}
      notificationItems={notificationItems}
      notificationUnreadCount={notificationUnreadCount}
      profile={profile}
      recordings={recordings}
      projectAnnouncements={projectAnnouncements}
    />
  );
}
