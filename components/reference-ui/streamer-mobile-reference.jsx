"use client";
/* eslint-disable */
import React from "react";

import { toStreamerReferenceTask } from "@/features/live-operations/live-ui-adapters";

const UUID_LIKE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayRecordId(value, fallback = "内部记录") {
  const text = String(value || "").trim();
  if (!text || UUID_LIKE_ID.test(text)) return fallback;
  return text;
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

// ===== src-streamer\ui.jsx =====
// Mobile UI atoms for streamer side ———————————————————————

function MBadge({ tone = "neutral", children, dot = false, style }) {
  const tones = {
    neutral: ["#EEF2F7", "#475569", "#94A3B8"],
    blue: ["#EEF3FF", "#1842A6", "#3B6BE6"],
    green: ["#E6F6EE", "#0E8A4D", "#22B86C"],
    amber: ["#FFF3DC", "#A86A00", "#E5A33A"],
    red: ["#FDECEC", "#C0303A", "#E66670"],
    violet: ["#EFEBFF", "#5B4BD1", "#8C7DEB"],
    teal: ["#DEF3F0", "#0E7C77", "#3CB1AB"],
  };
  const [bg, fg, dc] = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11.5,
        lineHeight: "18px",
        fontWeight: 500,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{ width: 6, height: 6, borderRadius: 999, background: dc }}
        />
      )}
      {children}
    </span>
  );
}

// Card — rounded, white, soft shadow
function MCard({ children, style, onClick, padded = true }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "var(--shadow-card)",
        padding: padded ? 16 : 0,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Button — full-width by default, big touch target
function MButton({
  kind = "primary",
  size = "md",
  children,
  icon,
  onClick,
  disabled,
  style,
  full = false,
}) {
  const sizes = {
    sm: { h: 32, px: 14, fs: 13 },
    md: { h: 44, px: 18, fs: 14 },
    lg: { h: 52, px: 20, fs: 15 },
    xl: { h: 60, px: 24, fs: 17 },
  };
  const s = sizes[size];
  const kinds = {
    primary: {
      bg: "var(--blue-600)",
      color: "#fff",
      border: "none",
      hover: "var(--blue-700)",
    },
    success: {
      bg: "var(--ok-600)",
      color: "#fff",
      border: "none",
      hover: "#0A6E3D",
    },
    danger: {
      bg: "#fff",
      color: "var(--danger-600)",
      border: "1px solid #F3C4C9",
      hover: "#FDECEC",
    },
    default: {
      bg: "#fff",
      color: "var(--ink-700)",
      border: "1px solid var(--line-strong)",
      hover: "var(--bg)",
    },
    ghost: {
      bg: "transparent",
      color: "var(--blue-600)",
      border: "none",
      hover: "var(--blue-50)",
    },
  };
  const k = kinds[kind];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: s.h,
        padding: `0 ${s.px}px`,
        fontSize: s.fs,
        background: k.bg,
        color: k.color,
        border: k.border,
        borderRadius: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        width: full ? "100%" : "auto",
        transition: "transform 80ms ease, background 100ms ease",
        ...style,
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.97)";
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {icon}
      {children}
    </button>
  );
}

// Top app bar — gradient blue header with optional back button
function MAppBar({
  title,
  subtitle,
  onBack,
  right,
  dark = true,
  transparent = false,
}) {
  const fg = dark && !transparent ? "#fff" : "var(--ink-900)";
  const subFg =
    dark && !transparent ? "rgba(255,255,255,0.7)" : "var(--ink-400)";
  return (
    <div
      style={{
        height: 52,
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: transparent ? "transparent" : dark ? "transparent" : "#fff",
        borderBottom: transparent || dark ? "none" : "1px solid var(--line)",
        position: "relative",
        zIndex: 2,
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "none",
            background: dark ? "rgba(255,255,255,0.12)" : "var(--ink-50)",
            color: fg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon.ChevLeft size={18} stroke={fg} sw={2} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: fg,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: subFg, marginTop: 1 }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

// Section header inside scroll area
function MSection({ title, action, children, style }) {
  return (
    <div style={{ padding: "0 16px", marginTop: 18, ...style }}>
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
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
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Avatar
function MAvatar({ name, size = 32, src }) {
  const palette = [
    "#1E50C8",
    "#5B4BD1",
    "#0E7C77",
    "#A86A00",
    "#C0303A",
    "#0E8A4D",
  ];
  const code = (name || "?").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = palette[code % palette.length];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: `${bg}26`,
        color: bg,
        fontSize: size * 0.42,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {(name || "?").slice(0, 1)}
    </span>
  );
}

// Stat block (used in 我的)
function MStat({ label, value, unit, color = "var(--ink-900)" }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 4,
          marginTop: 4,
        }}
      >
        <span
          className="num"
          style={{
            fontSize: 20,
            fontWeight: 700,
            color,
            letterSpacing: "-0.01em",
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, color: "var(--ink-400)" }}>{unit}</span>
        )}
      </div>
    </div>
  );
}

// Bottom tab bar
function MTabBar({ value, onChange }) {
  const tabs = [
    { key: "home", label: "任务", icon: "Tasks" },
    { key: "videos", label: "录屏", icon: "Reports" },
    { key: "ai", label: "诊断", icon: "Sparkles", accent: true },
    { key: "me", label: "我的", icon: "Streamer" },
  ];
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.92)",
          borderTop: "1px solid var(--line)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          padding: "6px 8px calc(8px + env(safe-area-inset-bottom, 0px))",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 4,
        }}
      >
        {tabs.map((t) => {
          const active = t.key === value;
          const IconComp = Icon[t.icon];
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              style={{
                padding: "8px 0 6px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                color: active ? "var(--blue-700)" : "var(--ink-400)",
                fontSize: 10.5,
                fontWeight: active ? 600 : 500,
                position: "relative",
              }}
            >
              {t.accent && !active && (
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    right: "50%",
                    marginRight: -16,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: "var(--violet-600)",
                  }}
                />
              )}
              <IconComp
                size={22}
                stroke={active ? "var(--blue-700)" : "var(--ink-400)"}
                sw={active ? 1.8 : 1.6}
              />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Big gradient hero card (used on home + ai)
function MHero({ children, style }) {
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, var(--blue-700) 0%, var(--blue-500) 100%)",
        padding: "20px 20px 28px",
        color: "#fff",
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {/* Decorative blob */}
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 180,
          height: 180,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -60,
          width: 220,
          height: 220,
          background:
            "radial-gradient(circle, rgba(124,90,255,0.25) 0%, transparent 70%)",
        }}
      />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

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

// Streamer's tasks — for today + upcoming + recent
const MY_TASKS = [];

const STATUS_MAP = {
  pending_live: { tone: "neutral", label: "待开播" },
  missed_live: { tone: "red", label: "已延期未直播" },
  live: { tone: "blue", label: "直播中" },
  pending_report: { tone: "amber", label: "待上传截图" },
  pending_review: { tone: "violet", label: "审核中" },
  approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
  trial: { tone: "teal", label: "试播任务" },
  completed: { tone: "green", label: "已完成" },
};

const StreamerLiveDataContext = React.createContext({
  profile: null,
  tasks: null,
  earnings: null,
  applications: null,
  projectAnnouncements: [],
  actions: {},
});

function useStreamerTasks() {
  const { tasks } = React.useContext(StreamerLiveDataContext);
  return Array.isArray(tasks) ? tasks : MY_TASKS;
}

function useStreamerEarnings() {
  const { earnings } = React.useContext(StreamerLiveDataContext);
  return earnings && typeof earnings === "object" ? earnings : MY_EARNINGS;
}

function useStreamerProfile() {
  const { profile } = React.useContext(StreamerLiveDataContext);
  return normalizeStreamerProfile(profile);
}

function useStreamerLiveActions() {
  const { actions } = React.useContext(StreamerLiveDataContext);
  return actions || {};
}

function useStreamerRecordings() {
  const { recordings } = React.useContext(StreamerLiveDataContext);
  return Array.isArray(recordings) ? recordings : [];
}

function useStreamerRecordingAssets() {
  const { recordingAssets } = React.useContext(StreamerLiveDataContext);
  return Array.isArray(recordingAssets) ? recordingAssets : [];
}

function useStreamerApplications() {
  const { applications } = React.useContext(StreamerLiveDataContext);
  return Array.isArray(applications) ? applications : [];
}

function normalizeStreamerProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return ME;
  }

  return {
    ...ME,
    ...profile,
    alias: profile.alias || ME.alias,
    level: profile.level || ME.level,
    org: profile.org || ME.org,
    platforms: Array.isArray(profile.platforms) ? profile.platforms : [],
  };
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

// AI diagnosis conversation history
const AI_THREAD = [];

// ===== src-streamer\screen-home.jsx =====
// ——— Streamer Home (我的任务) ——————————————————————

function StreamerHome({ go }) {
  const profile = useStreamerProfile();
  const tasks = useStreamerTasks();
  const earnings = useStreamerEarnings();
  const today = tasks.filter((t) => t.date === "今天");
  const pendingReport = tasks.filter((t) => t.status === "pending_report");
  const upcoming = tasks.filter((t) => ["明天", "本周六"].includes(t.date));
  const reviewing = tasks.filter((t) => t.status === "pending_review");

  const unreadCount = MY_NOTIFICATIONS.filter((n) => n.unread).length;

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Hero */}
      <MHero style={{ paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
              border: "1.5px solid rgba(255,255,255,0.35)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            {profile.alias.slice(0, 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: "-0.005em",
              }}
            >
              {profile.alias}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.72)" }}>
              {profile.level} · {profile.org}
            </div>
          </div>
          <button
            style={{
              position: "relative",
              width: 38,
              height: 38,
              borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              border: "none",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon.Bell size={18} stroke="#fff" sw={1.8} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  minWidth: 16,
                  height: 16,
                  background: "#FF4757",
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  fontWeight: 700,
                  border: "2px solid var(--blue-600)",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
            本周累计
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginTop: 4,
            }}
          >
            <span
              className="num"
              style={{
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.02em",
              }}
            >
              {earnings.currentMonth.hours.toFixed(1)}
            </span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              h · 已结算 ¥{earnings.currentMonth.earned.toLocaleString()}
            </span>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          <HeroMini label="今天" value={today.length} />
          <HeroMini
            label="待上传"
            value={pendingReport.length}
            highlight={pendingReport.length > 0}
          />
          <HeroMini label="审核中" value={reviewing.length} />
        </div>
      </MHero>

      {/* Today */}
      {today.length > 0 && (
        <MSection title="今天 · 即将直播" style={{ marginTop: 16 }}>
          {today.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onClick={() => go("task", t.id)}
              primary
            />
          ))}
        </MSection>
      )}

      {/* Action needed */}
      {pendingReport.length > 0 && (
        <MSection
          title="待上传截图"
          action={
            <span
              style={{
                fontSize: 12,
                color: "var(--warn-600)",
                fontWeight: 600,
              }}
            >
              请尽快
            </span>
          }
        >
          {pendingReport.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onClick={() => go("task", t.id)}
              urgent
            />
          ))}
        </MSection>
      )}

      {/* Reviewing */}
      {reviewing.length > 0 && (
        <MSection title="审核中">
          {reviewing.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onClick={() => go("task", t.id)}
              compact
            />
          ))}
        </MSection>
      )}

      {/* Upcoming */}
      <MSection
        title="即将开始"
        action={
          <MButton kind="ghost" size="sm" onClick={() => go("tasks")}>
            查看全部 →
          </MButton>
        }
      >
        {upcoming.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onClick={() => go("task", t.id)}
            compact
          />
        ))}
      </MSection>

      {/* AI promo card */}
      <MSection>
        <div
          onClick={() => go("ai")}
          style={{
            background: "linear-gradient(135deg, #F8F6FF 0%, #EEF3FF 100%)",
            border: "1px solid #D8D0FA",
            borderRadius: 14,
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 14,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg, #5B4BD1, #1E50C8)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Sparkles size={20} stroke="#fff" sw={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                }}
              >
                开播前来个卡点诊断
              </span>
              <MBadge tone="violet">AI</MBadge>
            </div>
            <div
              style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}
            >
              结合你近 14 天数据，10 秒判断流量卡点
            </div>
          </div>
          <Icon.ChevRight size={16} stroke="var(--ink-300)" />
        </div>
      </MSection>
    </div>
  );
}

function HeroMini({ label, value, highlight }) {
  return (
    <div
      style={{
        background: highlight
          ? "rgba(255,180,90,0.18)"
          : "rgba(255,255,255,0.12)",
        backdropFilter: "blur(6px)",
        border: `1px solid ${highlight ? "rgba(255,180,90,0.45)" : "rgba(255,255,255,0.2)"}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.78)" }}>
        {label}
      </div>
      <div
        className="num"
        style={{ fontSize: 22, fontWeight: 700, marginTop: 2, color: "#fff" }}
      >
        {value}
      </div>
    </div>
  );
}

// Task card — used on home & elsewhere
function TaskCard({
  task,
  onClick,
  primary = false,
  urgent = false,
  compact = false,
}) {
  const st = STATUS_MAP[task.status] || STATUS_MAP.pending_live;
  const shouldShowNote =
    task.note && (!compact || task.status === "missed_live");
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: `1px solid ${urgent ? "#F3C4C9" : primary ? "var(--blue-200)" : "var(--line)"}`,
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
        boxShadow: "var(--shadow-card)",
        cursor: "pointer",
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
            background: "var(--blue-600)",
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
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
                display: "inline-block",
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
          </div>
        </div>
        <MBadge tone={st.tone} dot style={{ flexShrink: 0 }}>
          {st.label}
        </MBadge>
      </div>

      <div
        style={{
          fontSize: 15,
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
          flexWrap: "wrap",
        }}
      >
        <Icon.Game size={13} stroke="var(--ink-400)" />
        <span style={{ whiteSpace: "nowrap" }}>{task.vendor}</span>
        <span style={{ whiteSpace: "nowrap" }}>
          · <span className="num">{displayRecordId(task.id, "任务")}</span>
        </span>
      </div>

      {shouldShowNote && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-500)",
            marginTop: 10,
            padding: "8px 10px",
            background: "var(--bg-soft)",
            borderRadius: 8,
            border: "1px solid var(--line)",
          }}
        >
          {task.note}
        </div>
      )}

      {!compact && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px dashed var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <MBadge tone="blue">{task.settleHint}</MBadge>
          {task.needScreening && <MBadge tone="amber">需录屏</MBadge>}
          <span style={{ flex: 1 }} />
          {task.status === "pending_live" && (
            <MButton size="sm" kind="primary">
              查看
            </MButton>
          )}
          {task.status === "pending_report" && (
            <MButton
              size="sm"
              kind="primary"
              icon={<Icon.Upload size={13} stroke="#fff" />}
            >
              上传截图
            </MButton>
          )}
          {task.status === "pending_review" && (
            <MButton size="sm" kind="default">
              查看进度
            </MButton>
          )}
          {task.status === "trial" && (
            <MButton size="sm" kind="default" icon={<Icon.Upload size={13} />}>
              上传录屏
            </MButton>
          )}
        </div>
      )}
    </div>
  );
}

function StreamerTaskList({ go }) {
  const tasks = useStreamerTasks();
  const today = tasks.filter((t) => t.date === "今天");
  const pendingReport = tasks.filter((t) => t.status === "pending_report");
  const reviewing = tasks.filter((t) => t.status === "pending_review");

  return (
    <div style={{ paddingBottom: 96, background: "var(--bg)" }}>
      <MAppBar
        title="全部任务"
        subtitle={`${tasks.length} 个任务 · ${pendingReport.length} 个待上传 · ${reviewing.length} 个审核中`}
        onBack={() => go("home")}
        dark={false}
      />

      <MSection title="任务概览" style={{ marginTop: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          <MCard style={{ padding: 12 }}>
            <MStat label="全部" value={tasks.length} />
          </MCard>
          <MCard style={{ padding: 12 }}>
            <MStat label="今天" value={today.length} color="var(--blue-600)" />
          </MCard>
          <MCard style={{ padding: 12 }}>
            <MStat
              label="待上传"
              value={pendingReport.length}
              color="var(--warn-600)"
            />
          </MCard>
        </div>
      </MSection>

      <MSection title="任务列表">
        {tasks.length === 0 ? (
          <MCard>
            <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>
              暂无任务数据
            </div>
            <div
              style={{ marginTop: 6, fontSize: 12, color: "var(--ink-400)" }}
            >
              后端返回直播任务后会显示在这里。
            </div>
          </MCard>
        ) : (
          tasks.map((t, index) => (
            <TaskCard
              key={`${t.id || "task"}-${index}`}
              task={t}
              onClick={() => go("task", t.id)}
              compact
            />
          ))
        )}
      </MSection>
    </div>
  );
}

// ===== src-streamer\screen-task.jsx =====
// ——— Streamer: Task Detail ——————————————————————

function StreamerTask({ taskId, go }) {
  const tasks = useStreamerTasks();
  const actions = useStreamerLiveActions();
  const t = tasks.find((x) => x.id === taskId) || tasks[0] || MY_TASKS[0];
  if (!t) {
    return (
      <div style={{ paddingBottom: 100, background: "var(--bg)" }}>
        <MAppBar onBack={() => go("home")} title="任务详情" dark={false} />
        <div style={{ padding: 20 }}>
          <MCard>
            <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>
              暂无任务数据
            </div>
            <div
              style={{ marginTop: 6, fontSize: 12, color: "var(--ink-400)" }}
            >
              后端返回直播任务后会显示在这里。
            </div>
          </MCard>
        </div>
      </div>
    );
  }

  const st = STATUS_MAP[t.status];
  const isLive = t.status === "live";
  const isPendingLive = t.status === "pending_live";
  const isMissedLive = t.status === "missed_live";
  const isPendingReport = t.status === "pending_report";

  return (
    <div style={{ paddingBottom: 100, background: "var(--bg)" }}>
      {/* Header with gradient — keeps consistent feel */}
      <div
        style={{
          background:
            "linear-gradient(135deg, var(--blue-700) 0%, var(--blue-500) 100%)",
          paddingBottom: 16,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <MAppBar
          onBack={() => go("home")}
          title="任务详情"
          dark
          transparent={false}
          right={
            <button
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                border: "none",
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon.More size={18} stroke="#fff" sw={1.8} />
            </button>
          }
        />

        <div style={{ padding: "0 20px 4px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              className="num"
              style={{ fontSize: 11, color: "rgba(255,255,255,0.72)" }}
            >
              {displayRecordId(t.id, "任务")}
            </span>
            <MBadge tone={st.tone} dot>
              {st.label}
            </MBadge>
          </div>
          <div
            style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {t.projectName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Game size={13} stroke="rgba(255,255,255,0.7)" />
            {t.vendor} · 计划 {t.start}–{t.end} · {t.durationPlan}h
          </div>
        </div>
      </div>

      {/* CTA area */}
      <div style={{ padding: "16px 16px 0" }}>
        {isPendingLive && (
          <PendingLiveCTA task={t} go={go} onStart={actions.startTask} />
        )}
        {isMissedLive && <MissedLiveCTA task={t} />}
        {isLive && <LiveCTA task={t} go={go} onStop={actions.stopTask} />}
        {isPendingReport && <PendingReportCTA task={t} go={go} />}
        {t.status === "pending_review" && <ReviewingCTA task={t} go={go} />}
        {t.status === "trial" && <TrialCTA task={t} go={go} />}
      </div>

      <MSection title="项目要求">
        <MCard>
          <Field label="项目">
            <div>
              <div style={{ fontWeight: 600 }}>{t.projectName}</div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}
              >
                {t.project}
              </div>
            </div>
          </Field>
          <Divider />
          <Field label="结算规则">
            <MBadge tone="blue">{t.settleHint}</MBadge>
          </Field>
          <Divider />
          <Field label="是否点击开播 / 停止">
            {t.needStartStop ? (
              <span style={{ color: "var(--ok-600)", fontWeight: 600 }}>
                需要 · 必须在 App 内开始与结束
              </span>
            ) : (
              <span style={{ color: "var(--ink-500)" }}>无需</span>
            )}
          </Field>
          <Divider />
          <Field label="录屏要求">
            {t.needScreening ? (
              <span style={{ color: "var(--ok-600)", fontWeight: 600 }}>
                本项目强制录屏
              </span>
            ) : (
              <span style={{ color: "var(--ink-500)" }}>不强制</span>
            )}
          </Field>
          {t.note && (
            <>
              <Divider />
              <div style={{ padding: "10px 0" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-400)",
                    marginBottom: 6,
                  }}
                >
                  项目运营备注
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-700)",
                    padding: "10px 12px",
                    background: "var(--bg-soft)",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                  }}
                >
                  {t.note}
                </div>
              </div>
            </>
          )}
        </MCard>
      </MSection>

      <MSection title="任务状态">
        <MCard padded={false}>
          <div style={{ padding: 16 }}>
            <Timeline
              events={[
                { title: "排班创建", time: "系统生成", done: true },
                {
                  title: "点击开始直播",
                  time: isMissedLive
                    ? "未开始 · 待补充原因"
                    : t.status === "pending_live"
                      ? "待你操作"
                      : "5/27 19:58",
                  done: !isPendingLive && !isMissedLive,
                  current: isPendingLive || isMissedLive,
                },
                {
                  title: "点击停止 + 上传下播截图",
                  time: isPendingReport
                    ? "待你操作"
                    : t.status === "pending_review"
                      ? "5/26 22:48"
                      : "—",
                  done: ["pending_review", "approved", "completed"].includes(
                    t.status,
                  ),
                  current: isPendingReport,
                },
                {
                  title: "确认 OCR 结果",
                  time:
                    t.status === "pending_review" ? "5/26 22:50 · 已确认" : "—",
                  done: ["pending_review", "approved"].includes(t.status),
                },
                {
                  title: "运营审核",
                  time:
                    t.status === "pending_review"
                      ? "审核中（预计 24h）"
                      : t.status === "approved"
                        ? "已通过"
                        : "—",
                  done: t.status === "approved",
                  current: t.status === "pending_review",
                },
              ]}
            />
          </div>
        </MCard>
      </MSection>
    </div>
  );
}

// CTA: 待开播
function PendingLiveCTA({ task, go, onStart }) {
  const [busy, setBusy] = React.useState(false);
  const timing = getPendingLiveTiming(task);
  const handleStart = async () => {
    if (!onStart) return;
    setBusy(true);
    try {
      await onStart(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard
      style={{
        padding: 20,
        background: "linear-gradient(135deg, #FFFFFF 0%, #F5F8FF 100%)",
        border: "1px solid var(--blue-200)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--ink-500)", marginBottom: 4 }}>
        {timing.heading}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          className="num"
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: "var(--blue-700)",
            letterSpacing: "-0.02em",
          }}
        >
          {timing.durationText}
        </span>
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <MButton
          size="lg"
          kind="primary"
          full
          icon={<Icon.Play size={16} stroke="#fff" />}
          disabled={busy}
          onClick={handleStart}
        >
          {busy ? "正在开始…" : timing.buttonLabel}
        </MButton>
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: "var(--ink-400)",
          textAlign: "center",
        }}
      >
        {timing.helperText}
      </div>
    </MCard>
  );
}

function MissedLiveCTA({ task }) {
  return (
    <MCard
      style={{
        padding: 20,
        background: "linear-gradient(135deg, #FFF8F8 0%, #FFFDF9 100%)",
        border: "1px solid #F3C4C9",
      }}
    >
      <div
        style={{ fontSize: 13, color: "var(--danger-600)", fontWeight: 700 }}
      >
        已延期未直播
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 13,
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
          borderRadius: 10,
          background: "#fff",
          border: "1px dashed #F3C4C9",
          color: "var(--danger-600)",
          fontSize: 12,
          lineHeight: 1.6,
          fontWeight: 700,
        }}
      >
        未直播原因待补充：{task.note || "请联系运营填写延期或未开播原因。"}
      </div>
    </MCard>
  );
}

function getPendingLiveTiming(task) {
  const plannedStart = parseTaskTimestamp(task.plannedStartAt);
  if (!plannedStart) {
    return {
      heading: "等待开播",
      durationText: "计划时间待确认",
      buttonLabel: "点击「开始直播」",
      helperText: "系统会自动记录开播时间 · 时长以审核报数为准",
    };
  }

  const remainingMinutes = Math.round(
    (plannedStart.getTime() - Date.now()) / 60_000,
  );
  if (remainingMinutes > 0) {
    return {
      heading: "距开播还有",
      durationText: formatLiveTimingDuration(remainingMinutes),
      buttonLabel: "准时点击「开始直播」",
      helperText: "系统会自动记录开播时间 · 时长以审核报数为准",
    };
  }

  return {
    heading: "计划已开始",
    durationText: `已过开播时间 ${formatLiveTimingDuration(Math.abs(remainingMinutes))}`,
    buttonLabel: "立即点击「开始直播」",
    helperText: "如未能按时开播，请尽快联系运营补充原因",
  };
}

function parseTaskTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLiveTimingDuration(totalMinutes) {
  const minutes = Math.max(0, totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours <= 0) {
    return `${remainder} 分钟`;
  }

  if (remainder === 0) {
    return `${hours} 小时`;
  }

  return `${hours} 小时 ${remainder} 分钟`;
}

function LiveCTA({ task, onStop }) {
  const [busy, setBusy] = React.useState(false);
  const handleStop = async () => {
    if (!onStop) return;
    setBusy(true);
    try {
      await onStop(task.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard
      style={{
        padding: 20,
        background: "linear-gradient(135deg, #0E2150 0%, #1842A6 100%)",
        border: "none",
        color: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#FF4757",
            boxShadow: "0 0 0 4px rgba(255,71,87,0.3)",
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600 }}>直播中</span>
        <span style={{ flex: 1 }} />
        <span
          className="num"
          style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}
        >
          已开播 02:48:13
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <MButton size="lg" kind="default" style={{ flex: 1 }}>
          暂停
        </MButton>
        <MButton
          size="lg"
          kind="danger"
          style={{ flex: 2 }}
          icon={<Icon.Pause size={16} stroke="var(--danger-600)" />}
          disabled={busy}
          onClick={handleStop}
        >
          {busy ? "正在结束…" : "结束直播 + 上传截图"}
        </MButton>
      </div>
    </MCard>
  );
}

function PendingReportCTA({ task, go }) {
  const fileInputRef = React.useRef(null);
  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    go("report", task.id, { screenshotFile: file });
  };

  return (
    <MCard
      style={{
        padding: 20,
        background: "#FFF6E6",
        border: "1px solid #F5DDA8",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--warn-600)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Upload size={18} stroke="#fff" sw={1.8} />
        </span>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            请上传下播截图
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
            截图需包含「时长 / 场观」两个字段，系统会自动识别
          </div>
        </div>
      </div>
      <MButton
        size="lg"
        kind="primary"
        full
        icon={<Icon.Upload size={16} stroke="#fff" />}
        onClick={() => fileInputRef.current?.click?.()}
      >
        从相册选择截图
      </MButton>
      <input
        ref={fileInputRef}
        aria-label="上传下播截图"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: "var(--warn-600)",
          textAlign: "center",
          fontWeight: 500,
        }}
      >
        ⓘ 报数仅延迟 1 天，建议下播 24h 内上传，超时会进入异常列表
      </div>
    </MCard>
  );
}

function ReviewingCTA({ task }) {
  return (
    <MCard style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: "var(--violet-50)",
            color: "var(--violet-600)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.Eye size={18} stroke="var(--violet-600)" />
        </span>
        <div style={{ flex: 1 }}>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            报数已提交，正在审核
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
            预计 24 小时内出结果，通过后会自动计入本周结算
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          padding: 12,
          background: "var(--bg-soft)",
          borderRadius: 10,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        <MStat
          label="直播时长"
          value={task.reportedDuration?.toFixed(1) || "—"}
          unit="h"
        />
        <MStat
          label="场观"
          value={task.reportedAudience?.toLocaleString() || "—"}
          unit=""
        />
        <MStat
          label="预计收入"
          value={`¥${Math.round((task.reportedDuration || 0) * 80).toLocaleString()}`}
          color="var(--blue-700)"
        />
      </div>
    </MCard>
  );
}

function TrialCTA({ task, go }) {
  return (
    <MCard
      style={{
        padding: 20,
        background: "linear-gradient(135deg, #FFFFFF 0%, #E6F9F4 100%)",
        border: "1px solid #B0E8DC",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <MBadge tone="teal" dot>
          试播任务
        </MBadge>
        <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
          · 不计入正式结算
        </span>
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-700)", lineHeight: 1.55 }}>
        厂家邀你试播该项目。试播完成后上传 60 分钟以上录屏，由运营 +
        厂家二审确认是否正式加入。
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <MButton
          size="lg"
          kind="default"
          style={{ flex: 1 }}
          onClick={() => go("videos")}
        >
          查看项目要求
        </MButton>
        <MButton
          size="lg"
          kind="primary"
          style={{ flex: 1 }}
          icon={<Icon.Upload size={15} stroke="#fff" />}
          onClick={() => go("videos")}
        >
          上传录屏
        </MButton>
      </div>
    </MCard>
  );
}

// Helpers
function Field({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 0",
        gap: 16,
        minHeight: 36,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink-400)", flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "var(--ink-900)",
          textAlign: "right",
          minWidth: 0,
        }}
      >
        {children}
      </span>
    </div>
  );
}
function Divider() {
  return <div style={{ height: 1, background: "var(--line)" }} />;
}

function Timeline({ events }) {
  return (
    <div>
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
                display: "flex",
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
                  width: 2,
                  background: e.done ? "var(--ok-600)" : "var(--ink-100)",
                  marginTop: 2,
                }}
              />
            )}
          </div>
          <div style={{ flex: 1, paddingTop: 1 }}>
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

// ===== src-streamer\screen-report.jsx =====
// ——— Streamer: Report Confirm (OCR) ——————————————————

function StreamerReport({ taskId, go, screenshotFile }) {
  const tasks = useStreamerTasks();
  const actions = useStreamerLiveActions();
  const t = tasks.find((x) => x.id === taskId) || tasks[0] || MY_TASKS[0];
  const fileInputRef = React.useRef(null);
  const [duration, setDuration] = React.useState("4.0");
  const [audience, setAudience] = React.useState("11240");
  const [note, setNote] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState("");
  const [pendingOcrReport, setPendingOcrReport] = React.useState(null);
  const [selectedScreenshotFile, setSelectedScreenshotFile] =
    React.useState(screenshotFile);

  React.useEffect(() => {
    setSelectedScreenshotFile(screenshotFile);
  }, [screenshotFile]);

  // OCR-recognized values (slightly off, to show diff highlight)
  const ocrDuration = "4.3";
  const ocrAudience = "11480";

  const durChanged = duration !== ocrDuration;
  const audChanged = audience !== ocrAudience;

  if (!t) {
    return (
      <div style={{ paddingBottom: 100 }}>
        <MAppBar onBack={() => go("home")} title="确认报数" dark={false} />
        <div style={{ padding: 20 }}>
          <MCard>
            <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>
              暂无可报数任务
            </div>
            <div
              style={{ marginTop: 6, fontSize: 12, color: "var(--ink-400)" }}
            >
              待上传报数的任务会在后端返回后显示。
            </div>
          </MCard>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <ReportSubmitted
        task={t}
        duration={duration}
        audience={audience}
        go={go}
      />
    );
  }

  if (pendingOcrReport) {
    return (
      <ReportOcrPending
        task={t}
        pending={pendingOcrReport}
        setPending={setPendingOcrReport}
        onConfirmed={() => setSubmitted(true)}
        duration={duration}
        audience={audience}
        go={go}
      />
    );
  }

  return (
    <div style={{ paddingBottom: 100 }}>
      <MAppBar
        onBack={() => go("task", t.id)}
        title="确认报数"
        subtitle={t.projectName}
        dark={false}
      />

      {/* Step indicator */}
      <div style={{ padding: "8px 16px 16px" }}>
        <Stepper steps={["上传截图", "确认数据", "提交审核"]} current={1} />
      </div>

      {/* Screenshot preview */}
      <MSection
        title="下播截图"
        action={
          <MButton
            size="sm"
            kind="ghost"
            icon={<Icon.Upload size={13} />}
            onClick={() => fileInputRef.current?.click?.()}
          >
            重传
          </MButton>
        }
      >
        <ScreenshotPreview />
        <input
          ref={fileInputRef}
          aria-label="重新上传下播截图"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setSelectedScreenshotFile(file);
              setSubmitError("");
            }
          }}
          style={{ display: "none" }}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-400)" }}>
          {selectedScreenshotFile?.name || "尚未选择截图"}
        </div>
      </MSection>

      {/* OCR result */}
      <MSection
        title="系统识别结果"
        action={
          <MBadge tone="violet" dot>
            OCR · 置信度 92%
          </MBadge>
        }
      >
        <MCard padded={false}>
          <div style={{ padding: 16 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-400)",
                marginBottom: 10,
              }}
            >
              请核对下方字段。如有差异请直接修改，系统会同时保留 OCR 原值。
            </div>

            <DataField label="直播日期" value={t.dateStr || t.date} static />
            <DataField
              label="直播时长"
              value={duration}
              ocrValue={ocrDuration}
              onChange={setDuration}
              unit="h"
              changed={durChanged}
            />
            <DataField
              label="累计场观"
              value={audience}
              ocrValue={ocrAudience}
              onChange={setAudience}
              unit="人次"
              changed={audChanged}
              last
            />
          </div>

          {(durChanged || audChanged) && (
            <div
              style={{
                padding: "10px 16px",
                background: "var(--warn-50)",
                borderTop: "1px solid #F5DDA8",
                fontSize: 12,
                color: "var(--warn-600)",
                display: "flex",
                gap: 8,
              }}
            >
              <Icon.Warn size={14} stroke="var(--warn-600)" />
              <span>
                你修改了{" "}
                {[durChanged && "时长", audChanged && "场观"]
                  .filter(Boolean)
                  .join(" / ")}
                ，提交后系统会保留 OCR 原值供运营复核。
              </span>
            </div>
          )}
        </MCard>
      </MSection>

      {/* Note */}
      <MSection title="备注（可选）">
        <MCard>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：开播前 30 分钟设备掉线 5 分钟…"
            style={{
              width: "100%",
              minHeight: 72,
              padding: 0,
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              fontSize: 13,
              color: "var(--ink-700)",
              background: "transparent",
            }}
          />
        </MCard>
      </MSection>

      {/* Predicted earnings */}
      <MSection title="预计本场收入">
        <MCard
          style={{
            background: "linear-gradient(135deg, #F5F8FF 0%, #FFFFFF 100%)",
            borderColor: "var(--blue-200)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              className="num"
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--blue-700)",
                letterSpacing: "-0.02em",
              }}
            >
              ¥{Math.round(parseFloat(duration || 0) * 80).toLocaleString()}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-400)",
                paddingBottom: 6,
              }}
            >
              按 CPT 80 / h
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
            实际金额以运营审核后的有效时长为准 · 礼物提成单独结算
          </div>
        </MCard>
      </MSection>

      {/* Submit bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: 420,
          margin: "0 auto",
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
          background: "rgba(255,255,255,0.96)",
          borderTop: "1px solid var(--line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          display: "grid",
          gap: 8,
          zIndex: 20,
        }}
      >
        {submitError ? (
          <div
            role="alert"
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--danger-600)",
            }}
          >
            {submitError}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 10 }}>
          <MButton
            kind="default"
            size="lg"
            style={{ flex: 1 }}
            onClick={() => go("task", t.id)}
          >
            取消
          </MButton>
          <MButton
            kind="primary"
            size="lg"
            style={{ flex: 2 }}
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              setSubmitError("");
              try {
                if (!selectedScreenshotFile) {
                  throw new Error("请先上传下播截图");
                }
                const queued = await actions.submitReport?.(t.id, {
                  durationHours: duration,
                  audience,
                  note,
                  screenshotFile: selectedScreenshotFile,
                });
                const reportId = queued?.report?.id;
                if (!reportId) {
                  throw new Error("OCR report response missing report id");
                }
                setPendingOcrReport({
                  reportId,
                  jobId: queued?.job?.id ?? null,
                  status: queued?.job?.status || "queued",
                  result: queued?.job?.result ?? null,
                  confirmedDuration: Math.round(Number(duration || 0) * 60),
                  confirmedViewers: Number(audience || 0),
                  note,
                });
              } catch (error) {
                setSubmitError(error?.message || "提交失败，请稍后重试");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "正在提交…" : "确认无误，提交审核"}
          </MButton>
        </div>
      </div>
    </div>
  );
}

function DataField({
  label,
  value,
  ocrValue,
  onChange,
  unit,
  changed,
  static: isStatic,
  last,
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 0",
        borderBottom: last ? "none" : "1px solid var(--line)",
      }}
    >
      <div
        style={{
          width: 70,
          fontSize: 12,
          color: "var(--ink-400)",
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}
      >
        {isStatic ? (
          <span
            className="num"
            style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {value}
          </span>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              border: `1.5px solid ${changed ? "var(--warn-600)" : "var(--line-strong)"}`,
              background: changed ? "var(--warn-50)" : "#fff",
              borderRadius: 8,
            }}
          >
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="num"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--ink-900)",
              }}
            />
            {unit && (
              <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                {unit}
              </span>
            )}
          </div>
        )}
        {ocrValue && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-400)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>OCR 原始：</span>
            <span
              className="num"
              style={{
                textDecoration: changed ? "line-through" : "none",
                color: changed ? "var(--warn-600)" : "var(--ink-500)",
              }}
            >
              {ocrValue}
              {unit && ` ${unit}`}
            </span>
            {changed && <MBadge tone="amber">已修改</MBadge>}
          </div>
        )}
      </div>
    </div>
  );
}

// Stylized live console screenshot
function ScreenshotPreview() {
  return (
    <MCard padded={false} style={{ overflow: "hidden", padding: 0 }}>
      <div
        style={{
          aspectRatio: "16 / 9",
          background: "#0E1530",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 14,
            left: 14,
            right: 14,
            bottom: 14,
            background:
              "linear-gradient(180deg, rgba(20,25,55,0.85), rgba(8,12,30,0.9))",
            border: "1px solid #233063",
            borderRadius: 10,
            padding: 14,
            color: "#E5EAF6",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
              color: "#B8C2DB",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#3B6BE6",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              抖
            </span>
            <span>抖音 · 直播后台 · 数据概览</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: "#7C8AB0" }}>直播日期</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>本场直播已结束</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            <ShotStat label="直播时长" value="4.3 h" />
            <ShotStat label="累计场观" value="11,480" />
            <ShotStat label="平均同时" value="356" />
          </div>
          <div style={{ marginTop: "auto", fontSize: 10, color: "#7C8AB0" }}>
            主播端截图 · SHA-256
          </div>
        </div>
      </div>
    </MCard>
  );
}

function sanitizeReportScreenshotFileName(name) {
  const safeName = String(name || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safeName || "report-screenshot.png";
}

function sanitizeRecordingFileName(name) {
  const safeName = String(name || "")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safeName || "recording.mp4";
}

// 与服务端 RECORDING_MAX_FILE_BYTES / jy-private 桶限一致（300MB）：
// 选中即拦截超大录屏文件，省一次注定被 400 拒绝的上传。
const RECORDING_MAX_UPLOAD_BYTES = 314572800;
const RECORDING_UPLOAD_TOO_LARGE_MESSAGE = "文件超过 300MB 上限";

function ShotStat({ label, value }) {
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
        style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

function Stepper({ steps, current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: done
                    ? "var(--ok-600)"
                    : active
                      ? "var(--blue-600)"
                      : "var(--ink-50)",
                  color: done || active ? "#fff" : "var(--ink-400)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {done ? <Icon.Check size={12} stroke="#fff" /> : i + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: done || active ? "var(--ink-900)" : "var(--ink-400)",
                }}
              >
                {s}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  background: done ? "var(--ok-600)" : "var(--ink-100)",
                  borderRadius: 999,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ReportOcrPending({
  task,
  pending,
  setPending,
  onConfirmed,
  duration,
  audience,
  go,
}) {
  const actions = useStreamerLiveActions();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const ocrDuration = pending.result?.extractedDuration;
  const ocrViewers = pending.result?.extractedViewers;
  const hasResult = ocrDuration !== undefined || ocrViewers !== undefined;
  const statusLabel =
    pending.status === "succeeded"
      ? "识别完成"
      : pending.status === "failed"
        ? "识别失败，可按手填值提交"
        : "OCR 识别中";

  const refreshResult = async () => {
    if (!pending.jobId || !actions.refreshOcrJob) return;
    setBusy(true);
    setError("");
    try {
      const job = await actions.refreshOcrJob(pending.jobId);
      setPending((current) =>
        current?.jobId === pending.jobId
          ? {
              ...current,
              status: job.status || current.status,
              result: job.result || current.result,
            }
          : current,
      );
    } catch (refreshError) {
      setError(refreshError?.message || "刷新 OCR 结果失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const confirmReport = async () => {
    if (!actions.confirmOcrReport) return;
    setBusy(true);
    setError("");
    try {
      await actions.confirmOcrReport(pending.reportId, {
        ocrDuration,
        ocrViewers,
        confirmedDuration: pending.confirmedDuration,
        confirmedViewers: pending.confirmedViewers,
        note: pending.note,
      });
      onConfirmed?.();
    } catch (confirmError) {
      setError(confirmError?.message || "确认 OCR 报数失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 100 }}>
      <MAppBar
        onBack={() => go("task", task.id)}
        title="OCR 识别中"
        dark={false}
      />
      <div style={{ padding: "32px 20px 20px", textAlign: "center" }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 999,
            margin: "0 auto",
            background: "linear-gradient(135deg, #DDEBFF 0%, #79A8FF 100%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 28px rgba(24,66,166,0.28)",
          }}
        >
          <Icon.Reports size={36} stroke="#fff" sw={2.2} />
        </div>
        <div
          role="status"
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--ink-900)",
            marginTop: 16,
          }}
        >
          {statusLabel}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>
          识别结果返回后再确认提交，报数会继续使用同一张截图和同一个报数单。
        </div>
      </div>

      <MSection>
        <MCard>
          <Field label="项目">{task.projectName}</Field>
          <Divider />
          <Field label="报数单">
            {displayRecordId(pending.reportId, "报数")}
          </Field>
          <Divider />
          <Field label="OCR 状态">
            <MBadge tone={pending.status === "failed" ? "red" : "blue"} dot>
              {pending.status}
            </MBadge>
          </Field>
          <Divider />
          <Field label="OCR 时长">
            {ocrDuration === undefined ? "待识别" : `${ocrDuration} 分钟`}
          </Field>
          <Divider />
          <Field label="OCR 场观">
            {ocrViewers === undefined ? "待识别" : `${ocrViewers} 人`}
          </Field>
          <Divider />
          <Field label="手填时长">{duration} h</Field>
          <Divider />
          <Field label="手填场观">{audience}</Field>
        </MCard>
      </MSection>

      {error ? (
        <div
          role="alert"
          style={{
            margin: "0 16px 12px",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--danger-600)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ padding: "0 16px 24px", display: "grid", gap: 10 }}>
        {pending.jobId ? (
          <MButton
            kind="default"
            size="lg"
            disabled={busy}
            onClick={refreshResult}
          >
            刷新识别结果
          </MButton>
        ) : null}
        <MButton
          kind="primary"
          size="lg"
          disabled={busy || (!hasResult && pending.status !== "failed")}
          onClick={confirmReport}
        >
          {hasResult ? "确认 OCR 结果，提交审核" : "按手填值提交审核"}
        </MButton>
      </div>
    </div>
  );
}

// Submitted confirmation state
function ReportSubmitted({ task, duration, audience, go }) {
  return (
    <div style={{ paddingBottom: 100 }}>
      <MAppBar onBack={() => go("home")} title="报数已提交" dark={false} />
      <div style={{ padding: "32px 20px 20px", textAlign: "center" }}>
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 999,
            margin: "0 auto",
            background: "linear-gradient(135deg, #C5F3D3 0%, #6BCF8C 100%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 28px rgba(14,138,77,0.32)",
          }}
        >
          <Icon.Check size={36} stroke="#fff" sw={2.4} />
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--ink-900)",
            marginTop: 16,
            letterSpacing: "-0.01em",
          }}
        >
          报数已提交审核
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6 }}>
          运营预计 24 小时内完成审核 · 通过后会进入本周结算池
        </div>
      </div>

      <MSection>
        <MCard>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span
              style={{ fontSize: 11, color: "var(--ink-400)" }}
              className="num"
            >
              待生成审核单号
            </span>
            <MBadge tone="violet" dot>
              待审核
            </MBadge>
          </div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            {task.projectName}
          </div>
          <div
            style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}
            className="num"
          >
            {task.dateStr} · {task.start}–{task.end}
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: "var(--bg-soft)",
              borderRadius: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <MStat label="时长" value={duration} unit="h" />
            <MStat
              label="场观"
              value={Number(audience).toLocaleString()}
              unit="人"
            />
            <MStat
              label="预计收入"
              value={`¥${Math.round(parseFloat(duration || 0) * 80).toLocaleString()}`}
              color="var(--blue-700)"
            />
          </div>
        </MCard>
      </MSection>

      <div style={{ padding: "24px 16px", display: "flex", gap: 10 }}>
        <MButton
          kind="default"
          size="lg"
          full
          style={{ flex: 1 }}
          onClick={() => go("home")}
        >
          返回首页
        </MButton>
        <MButton
          kind="primary"
          size="lg"
          full
          style={{ flex: 1 }}
          onClick={() => go("me")}
        >
          查看结算
        </MButton>
      </div>
    </div>
  );
}

// ===== src-streamer\screen-ai.jsx =====
// ——— Streamer: AI 卡点诊断 ——————————————————————

function StreamerAI({ go }) {
  const actions = useStreamerLiveActions();
  const [thread, setThread] = React.useState(AI_THREAD);
  const [input, setInput] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, typing]);

  const send = async (text) => {
    const question = String(text || "").trim();
    if (!question) return;
    setThread((prev) => [
      ...prev,
      { role: "me", text: question, time: nowHM() },
    ]);
    setInput("");
    setTyping(true);
    try {
      const answer = await actions.askDiagnosis?.(question);
      setThread((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            answer ||
            "诊断已完成，但本次没有返回可展示建议。请补充直播时间、产品和卡点现象后再试。",
          time: nowHM(),
        },
      ]);
    } catch (error) {
      setThread((prev) => [
        ...prev,
        {
          role: "ai",
          text:
            error instanceof Error
              ? error.message
              : "诊断服务暂时不可用，请稍后重试。",
          time: nowHM(),
        },
      ]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <div
      style={{
        paddingBottom: 96,
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >
      <MHero
        style={{
          paddingTop: 16,
          paddingBottom: 22,
          borderBottomLeftRadius: 20,
          borderBottomRightRadius: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "linear-gradient(135deg, #8C7DEB, #1E50C8)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon.Sparkles size={20} stroke="#fff" sw={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: "-0.005em",
              }}
            >
              卡点诊断助手
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "rgba(255,255,255,0.7)",
                marginTop: 1,
              }}
            >
              基于你近 14 天数据 · 不会暴露给运营或其他主播
            </div>
          </div>
          <button style={iconBtnGlass}>
            <Icon.History size={16} stroke="#fff" sw={1.8} />
          </button>
        </div>

        <div
          style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
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
                height: 28,
                fontSize: 12,
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.22)",
                color: "#fff",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </MHero>

      {/* Thread */}
      <div
        style={{
          flex: 1,
          padding: "16px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {thread.map((m, i) => (
          <Message key={i} msg={m} />
        ))}
        {typing && <TypingBubble />}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: 420,
          margin: "0 auto",
          zIndex: 20,
          padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))",
          background: "rgba(255,255,255,0.96)",
          borderTop: "1px solid var(--line)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: "6px 6px 6px 14px",
            background: "var(--bg)",
            borderRadius: 24,
            border: "1px solid var(--line)",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="把你的疑问告诉我，比如「为什么昨晚进房少」"
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
              minHeight: 24,
              maxHeight: 96,
              fontFamily: "inherit",
              fontSize: 14,
              color: "var(--ink-900)",
              padding: "8px 0",
            }}
            rows={1}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "none",
              background: input.trim() ? "var(--blue-600)" : "var(--ink-100)",
              color: "#fff",
              cursor: input.trim() ? "pointer" : "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 120ms",
            }}
          >
            <Icon.Sparkles size={16} stroke="#fff" sw={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtnGlass = {
  width: 36,
  height: 36,
  borderRadius: 999,
  background: "rgba(255,255,255,0.12)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function Message({ msg }) {
  const isMe = msg.role === "me";
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexDirection: isMe ? "row-reverse" : "row",
        alignItems: "flex-start",
      }}
    >
      {!isMe && (
        <div
          style={{
            width: 30,
            height: 30,
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
      )}
      <div
        style={{
          maxWidth: "82%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: isMe ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            background: isMe ? "var(--blue-600)" : "#fff",
            color: isMe ? "#fff" : "var(--ink-900)",
            border: isMe ? "none" : "1px solid var(--line)",
            borderRadius: 16,
            borderBottomRightRadius: isMe ? 4 : 16,
            borderBottomLeftRadius: isMe ? 16 : 4,
            fontSize: 14,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            boxShadow: isMe ? "none" : "var(--shadow-card)",
          }}
        >
          {msg.text}
          {msg.bullets && (
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: 0,
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
        width: "100%",
        padding: 14,
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
          marginBottom: 10,
        }}
      >
        <Icon.Warn size={14} stroke="var(--violet-600)" />
        <span
          style={{ fontSize: 12, fontWeight: 700, color: "var(--violet-600)" }}
        >
          卡点判断 · {insight.type}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {insight.evidence.map(([k, v, u], i) => (
          <div
            key={i}
            style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}
          >
            <div style={{ fontSize: 10.5, color: "var(--ink-400)" }}>{k}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span
                className="num"
                style={{
                  fontSize: 17,
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
        width: "100%",
        padding: 14,
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
          marginBottom: 10,
        }}
      >
        <Icon.Check size={14} stroke="var(--ok-600)" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ok-600)" }}>
          开播实验建议
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                fontSize: 13,
                color: "var(--ink-700)",
                lineHeight: 1.55,
              }}
            >
              {t}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
        <MButton size="sm" kind="default" full>
          保存为脚本
        </MButton>
        <MButton size="sm" kind="primary" full>
          发我话术稿
        </MButton>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div
        style={{
          width: 30,
          height: 30,
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
          borderRadius: 16,
          borderBottomLeftRadius: 4,
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
              animation: `aiblink 1.2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
        <style>{`@keyframes aiblink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }`}</style>
      </div>
    </div>
  );
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ===== src-streamer\screen-me.jsx =====
// ——— Streamer: 我的（个人页 / 结算 / 录屏库）—————————

function StreamerMe({ go }) {
  const [tab, setTab] = React.useState("overview");
  const [settingsPanel, setSettingsPanel] = React.useState(null);
  const earnings = useStreamerEarnings();
  const profile = useStreamerProfile();
  return (
    <div style={{ paddingBottom: 96 }}>
      <MHero
        style={{
          paddingTop: 14,
          paddingBottom: 24,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 999,
              background: "rgba(255,255,255,0.18)",
              border: "1.5px solid rgba(255,255,255,0.4)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            {profile.alias.slice(0, 1)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                {profile.alias}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                {profile.real}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.78)",
                marginTop: 3,
              }}
            >
              {profile.level} · {profile.org}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              {profile.platforms.map((p) => (
                <span
                  key={p.id}
                  style={{
                    padding: "2px 8px",
                    background: "rgba(255,255,255,0.12)",
                    borderRadius: 999,
                    fontSize: 11,
                    color: "#fff",
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {p.primary && (
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 999,
                        background: "#FFD166",
                      }}
                    />
                  )}
                  {p.platform} · {(p.followers / 1000).toFixed(1)}k
                </span>
              ))}
            </div>
          </div>
          <button
            aria-label="打开设置"
            onClick={() => {
              setTab("overview");
              setSettingsPanel("settings");
            }}
            style={iconBtnGlassMe}
          >
            <Icon.Settings size={16} stroke="#fff" sw={1.8} />
          </button>
        </div>

        {/* Earnings card */}
        <div
          style={{
            marginTop: 18,
            padding: 16,
            background: "rgba(255,255,255,0.14)",
            borderRadius: 16,
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                本月已结算
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                  ¥
                </span>
                <span
                  className="num"
                  style={{
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {earnings.currentMonth.earned.toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                + 待审核{" "}
                <span
                  className="num"
                  style={{ color: "#FFD166", fontWeight: 600 }}
                >
                  ¥{earnings.currentMonth.pending.toLocaleString()}
                </span>
              </div>
            </div>
            <button
              onClick={() => setTab("earnings")}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 999,
                border: "none",
                background: "#fff",
                color: "var(--blue-700)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              结算明细{" "}
              <Icon.ChevRight size={12} stroke="var(--blue-700)" sw={2} />
            </button>
          </div>
          <div
            style={{
              marginTop: 12,
              height: 6,
              background: "rgba(255,255,255,0.18)",
              borderRadius: 999,
            }}
          >
            <div
              style={{
                width: `${Math.min(
                  (earnings.currentMonth.hours / 60) * 100,
                  100,
                )}%`,
                height: "100%",
                background: "#FFD166",
                borderRadius: 999,
              }}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.72)",
              marginTop: 6,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              已直播{" "}
              <span className="num">
                {earnings.currentMonth.hours.toFixed(1)}
              </span>{" "}
              h
            </span>
            <span>本月目标 60 h</span>
          </div>
        </div>
      </MHero>

      {/* Tabs */}
      <div
        style={{
          padding: "8px 16px 0",
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--line)",
        }}
      >
        {[
          { k: "overview", l: "概览" },
          { k: "applications", l: "报名" },
          { k: "earnings", l: "结算" },
          { k: "videos", l: "录屏" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: "12px 14px",
              fontSize: 13,
              background: "transparent",
              border: "none",
              borderBottom:
                tab === t.k
                  ? "2px solid var(--blue-600)"
                  : "2px solid transparent",
              color: tab === t.k ? "var(--blue-700)" : "var(--ink-500)",
              fontWeight: tab === t.k ? 600 : 500,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          go={go}
          profile={profile}
          earnings={earnings}
          setTab={setTab}
          settingsPanel={settingsPanel}
          setSettingsPanel={setSettingsPanel}
        />
      )}
      {tab === "applications" && <ApplicationsTab />}
      {tab === "earnings" && <EarningsTab earnings={earnings} />}
      {tab === "videos" && <VideosTab />}
    </div>
  );
}

const iconBtnGlassMe = {
  width: 36,
  height: 36,
  borderRadius: 999,
  background: "rgba(255,255,255,0.14)",
  border: "none",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function OverviewTab({
  go,
  profile,
  earnings,
  setTab,
  settingsPanel,
  setSettingsPanel,
}) {
  const recordings = useStreamerRecordings();
  const approvedRecordingCount = recordings.filter(
    (recording) => recording.status === "approved",
  ).length;

  return (
    <>
      <MSection title="本月业绩">
        <MCard>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
            }}
          >
            <MStat
              label="已直播"
              value={earnings.currentMonth.hours.toFixed(1)}
              unit="h"
            />
            <MStat label="录屏通过" value="95" unit="%" color="var(--ok-600)" />
            <MStat label="本周参与" value="3" unit="项目" />
          </div>
          <div
            style={{ height: 1, background: "var(--line)", margin: "14px 0" }}
          />
          <div
            style={{ fontSize: 11, color: "var(--ink-400)", marginBottom: 8 }}
          >
            近 6 个月收入趋势
          </div>
          <Sparkbars data={earnings.history} />
        </MCard>
      </MSection>

      <MSection
        title="近期任务"
        action={
          <MButton size="sm" kind="ghost" onClick={() => go("tasks")}>
            查看全部 →
          </MButton>
        }
      >
        {MY_TASKS.slice(0, 3).map((t) => (
          <div
            key={t.id}
            onClick={() => go("task", t.id)}
            style={{
              background: "#fff",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--blue-50)",
                color: "var(--blue-700)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon.Game size={18} stroke="var(--blue-700)" />
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
                {t.projectName}
              </div>
              <div
                style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}
                className="num"
              >
                {t.dateStr} · {t.start}–{t.end}
              </div>
            </div>
            <MBadge tone={STATUS_MAP[t.status].tone} dot>
              {STATUS_MAP[t.status].label}
            </MBadge>
          </div>
        ))}
      </MSection>

      <MSection title="工具">
        <MCard padded={false}>
          <ToolRow
            icon="Sparkles"
            tone="violet"
            title="AI 卡点诊断"
            detail="基于你近 14 天的任务和报数"
            onClick={() => go("ai")}
          />
          <ToolRow
            icon="Reports"
            tone="blue"
            title="我的录屏库"
            detail={`${recordings.length} 条 · ${approvedRecordingCount} 条已通过`}
            onClick={() => go("videos")}
          />
          <ToolRow
            icon="Check"
            tone="green"
            title="我的报名"
            detail="查看申请状态与录屏审核进度"
            onClick={() => setTab("applications")}
          />
          <ToolRow
            icon="Money"
            tone="teal"
            title="结算账单"
            detail={`本月预估 ¥${(
              earnings.currentMonth.earned + earnings.currentMonth.pending
            ).toLocaleString()}`}
            onClick={() => setTab("earnings")}
            last
          />
        </MCard>
      </MSection>

      <MSection title="设置">
        <MCard padded={false}>
          <ToolRow
            icon="Settings"
            tone="neutral"
            title="账号与平台绑定"
            detail={`已绑定 ${profile.platforms.length} 个平台`}
            onClick={() => setSettingsPanel("platforms")}
          />
          <ToolRow
            icon="Lock"
            tone="neutral"
            title="隐私与权限"
            detail="我能看到的字段范围"
            onClick={() => setSettingsPanel("privacy")}
          />
          <ToolRow
            icon="History"
            tone="neutral"
            title="操作记录"
            detail="我对自己资料的修改日志"
            onClick={() => setSettingsPanel("history")}
            last
          />
        </MCard>
      </MSection>

      {settingsPanel && (
        <ProfileSettingsPanel kind={settingsPanel} profile={profile} />
      )}
    </>
  );
}

function ToolRow({ icon, tone, title, detail, onClick, last }) {
  const IconComp = Icon[icon];
  const toneMap = {
    blue: ["var(--blue-50)", "var(--blue-700)"],
    violet: ["var(--violet-50)", "var(--violet-600)"],
    teal: ["var(--teal-50)", "var(--teal-600)"],
    green: ["var(--ok-50)", "var(--ok-600)"],
    amber: ["var(--warn-50)", "var(--warn-600)"],
    neutral: ["var(--ink-50)", "var(--ink-500)"],
  };
  const [bg, fg] = toneMap[tone] || toneMap.neutral;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderBottom: last ? "none" : "1px solid var(--line)",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        background: "#fff",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: bg,
          color: fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <IconComp size={17} stroke={fg} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-900)" }}>
          {title}
        </div>
        {detail && (
          <div
            style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}
          >
            {detail}
          </div>
        )}
      </div>
      <Icon.ChevRight size={16} stroke="var(--ink-300)" />
    </button>
  );
}

function ApplicationsTab() {
  const { applications, projectAnnouncements, actions } = React.useContext(
    StreamerLiveDataContext,
  );
  const rows = useStreamerApplications();
  const signupProjects = Array.isArray(projectAnnouncements)
    ? projectAnnouncements
    : [];
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [applyingProjectId, setApplyingProjectId] = React.useState(null);
  const [signupMessage, setSignupMessage] = React.useState("");
  const [signupError, setSignupError] = React.useState("");

  const refresh = React.useCallback(async () => {
    if (!actions.refreshApplications || loading) return;
    setLoading(true);
    setMessage("");
    try {
      await Promise.all([
        actions.refreshApplications(),
        actions.refreshProjectAnnouncements?.(),
      ]);
    } catch (error) {
      setMessage(error?.message || "报名状态刷新失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, [actions, loading]);

  React.useEffect(() => {
    if (!Array.isArray(applications)) {
      refresh();
    }
  }, [applications, refresh]);

  const apply = React.useCallback(
    async (project) => {
      if (!actions.applyToProject || applyingProjectId) return;
      setApplyingProjectId(project.id);
      setSignupMessage("");
      setSignupError("");
      try {
        await actions.applyToProject(project.id);
        setSignupMessage(`报名成功：已提交「${project.name}」，等待运营审核。`);
      } catch (error) {
        setSignupError(applicationSignupErrorMessage(error));
      } finally {
        setApplyingProjectId(null);
      }
    },
    [actions, applyingProjectId],
  );

  return (
    <div>
      <MSection
        title="我的报名"
        action={
          <MButton size="sm" kind="ghost" onClick={refresh} disabled={loading}>
            {loading ? "刷新中" : "刷新"}
          </MButton>
        }
      >
        {message ? (
          <div
            aria-live="polite"
            style={{
              marginBottom: 10,
              fontSize: 12,
              color: "var(--danger-600)",
            }}
          >
            {message}
          </div>
        ) : null}
        {rows.length ? (
          rows.map((application) => (
            <ApplicationStatusCard
              key={application.id || application.projectId}
              application={application}
            />
          ))
        ) : (
          <MCard>
            <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
              {loading ? "正在读取报名状态…" : "暂无报名记录"}
            </div>
          </MCard>
        )}
      </MSection>

      <MSection
        title="可报名项目"
        action={<MBadge tone="blue">{signupProjects.length} 个</MBadge>}
      >
        {signupMessage ? (
          <div
            aria-live="polite"
            style={{
              marginBottom: 10,
              fontSize: 12,
              color: "var(--ok-600)",
            }}
          >
            {signupMessage}
          </div>
        ) : null}
        {signupError ? (
          <div
            aria-live="polite"
            style={{
              marginBottom: 10,
              fontSize: 12,
              color: "var(--danger-600)",
            }}
          >
            {signupError}
          </div>
        ) : null}
        {signupProjects.length ? (
          signupProjects.map((project) => (
            <ProjectSignupCard
              key={project.id}
              project={project}
              applying={applyingProjectId === project.id}
              onApply={() => apply(project)}
            />
          ))
        ) : (
          <MCard
            style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}
          >
            <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
              {loading
                ? "正在读取可报名项目…"
                : "暂无可报名项目，运营发布公开项目后会显示在这里。"}
            </div>
          </MCard>
        )}
      </MSection>
    </div>
  );
}

function ProjectSignupCard({ project, applying, onApply }) {
  const applied = Boolean(project.applicationId || project.applicationStatus);
  const joined = project.applicationStatus === "joined";
  const disabled = applied || applying;
  const buttonLabel = applied
    ? joined
      ? "已加入项目"
      : "已报名"
    : applying
      ? "报名中…"
      : "立即报名";

  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--ink-900)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.name}
          </div>
          {applied ? (
            <MBadge tone={applicationStatusTone(project.applicationStatus)} dot>
              {applicationStatusLabel(project.applicationStatus)}
            </MBadge>
          ) : (
            <MBadge tone="blue">可报名</MBadge>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            fontSize: 11,
            color: "var(--ink-400)",
          }}
        >
          {project.code ? <span className="mono">{project.code}</span> : null}
          {project.product ? <span>{project.product}</span> : null}
        </div>
        {project.publicSummary ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-600)",
              lineHeight: 1.55,
            }}
          >
            {project.publicSummary}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onApply}
          disabled={disabled}
          style={{
            height: 34,
            borderRadius: 8,
            border: "none",
            padding: "0 14px",
            justifySelf: "start",
            background: disabled ? "var(--bg-soft)" : "var(--blue-600)",
            color: disabled ? "var(--ink-400)" : "#fff",
            fontSize: 12,
            fontWeight: 800,
            cursor: disabled ? "default" : "pointer",
            opacity: applying ? 0.7 : 1,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </MCard>
  );
}

function ApplicationStatusCard({ application }) {
  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--ok-50)",
            color: "var(--ok-600)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Check size={18} stroke="var(--ok-600)" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--ink-900)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {application.projectName}
            </div>
            <MBadge tone={applicationStatusTone(application.status)} dot>
              {application.statusLabel}
            </MBadge>
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            {application.projectCode ? (
              <span className="mono">{application.projectCode}</span>
            ) : null}
            <span>{application.source === "invite" ? "邀约" : "自主报名"}</span>
            {application.submittedAt ? (
              <span className="mono">
                {application.submittedAt.slice(0, 10)}
              </span>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--bg-soft)",
              border: "1px solid var(--line)",
              fontSize: 12,
              color: "var(--ink-600)",
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span>录屏审核</span>
            <span style={{ fontWeight: 700 }}>
              {application.reviewStatusLabel}
            </span>
          </div>
          {application.decisionReason ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--danger-600)",
                lineHeight: 1.5,
              }}
            >
              {application.decisionReason}
            </div>
          ) : null}
        </div>
      </div>
    </MCard>
  );
}

function ProfileSettingsPanel({ kind, profile }) {
  const panel = profileSettingsPanel(kind, profile);

  return (
    <MSection title={panel.title}>
      <MCard>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {panel.rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                paddingBottom: 10,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
                {row.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ink-700)",
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </MCard>
    </MSection>
  );
}

function profileSettingsPanel(kind, profile = ME) {
  if (kind === "platforms") {
    return {
      title: "平台绑定明细",
      rows: profile.platforms.length
        ? profile.platforms.map((platform) => ({
            label: platform.platform,
            value: platform.primary
              ? "主账号"
              : `${(platform.followers / 1000).toFixed(1)}k 粉丝`,
          }))
        : [{ label: "平台账号", value: "暂无已绑定平台" }],
    };
  }

  if (kind === "privacy") {
    return {
      title: "隐私字段范围",
      rows: [
        { label: "可见收益", value: "仅本人结算账单" },
        { label: "不可见字段", value: "厂家价格、MCN 毛利、其他主播结算" },
        { label: "AI 诊断", value: "继承主播本人权限" },
      ],
    };
  }

  if (kind === "history") {
    return {
      title: "近期操作记录",
      rows: [
        { label: "资料修改", value: "暂无记录" },
        { label: "录屏上传", value: "由报名录屏链路记录" },
        { label: "任务报数", value: "由任务履约链路记录" },
      ],
    };
  }

  return {
    title: "设置项",
    rows: [
      { label: "通知提醒", value: "跟随任务和审核状态" },
      { label: "账号绑定", value: `${profile.platforms.length} 个平台` },
      { label: "隐私权限", value: "按主播角色自动限制字段" },
    ],
  };
}

function Sparkbars({ data }) {
  const rows = data.length ? data : [{ month: "暂无", earned: 0 }];
  const max = Math.max(1, ...rows.map((d) => d.earned));
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 60 }}
    >
      {rows.map((d, i) => {
        const h = (d.earned / max) * 100;
        const isLast = i === rows.length - 1;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <div
              style={{
                width: "100%",
                height: `${h}%`,
                minHeight: 6,
                background: isLast ? "var(--blue-600)" : "var(--blue-200)",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: isLast ? "var(--blue-700)" : "var(--ink-400)",
                fontWeight: isLast ? 600 : 400,
              }}
              className="num"
            >
              {d.month.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ——— Earnings tab ———
function EarningsTab({ earnings }) {
  const [expandedExplanationId, setExpandedExplanationId] =
    React.useState(null);
  const currentItems = (earnings.items || []).filter(
    (item) => item.month === earnings.currentMonth.month,
  );
  const systemAmount = currentItems.reduce(
    (total, item) => total + (item.computedAmount || 0),
    0,
  );
  const manualAmount = currentItems.reduce(
    (total, item) => total + (item.manualAmount || 0),
    0,
  );
  const adjustmentAmount = currentItems.reduce(
    (total, item) => total + (item.adjustmentAmount || 0),
    0,
  );

  return (
    <>
      <MSection title="本月预估">
        <MCard>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--ink-400)" }}>¥</span>
            <span
              className="num"
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: "var(--ink-900)",
                letterSpacing: "-0.02em",
              }}
            >
              {(
                earnings.currentMonth.earned + earnings.currentMonth.pending
              ).toLocaleString()}
            </span>
            <MBadge tone="amber">未锁定</MBadge>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            <RangeRow
              label="已审核计入"
              value={`¥${earnings.currentMonth.earned.toLocaleString()}`}
              tone="green"
            />
            <RangeRow
              label="审核中"
              value={`¥${earnings.currentMonth.pending.toLocaleString()}`}
              tone="amber"
            />
          </div>
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: "1px dashed var(--line)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "var(--ink-500)",
                padding: "4px 0",
              }}
            >
              <span>系统计算</span>
              <span
                className="num"
                style={{ fontWeight: 600, color: "var(--ink-900)" }}
              >
                ¥{systemAmount.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "var(--ink-500)",
                padding: "4px 0",
              }}
            >
              <span>
                有效时长 · {earnings.currentMonth.hours.toFixed(1)}h · 安全视图
              </span>
              <span
                className="num"
                style={{ fontWeight: 600, color: "var(--ink-900)" }}
              >
                ¥{systemAmount.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "var(--ink-500)",
                padding: "4px 0",
              }}
            >
              <span>CPA / CPS / 礼物 · 人工承载</span>
              <span
                className="num"
                style={{ fontWeight: 600, color: "var(--ink-900)" }}
              >
                ¥{manualAmount.toLocaleString()}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "var(--ink-500)",
                padding: "4px 0",
              }}
            >
              <span>人工调整</span>
              <span
                className="num"
                style={{
                  color:
                    adjustmentAmount < 0
                      ? "var(--danger-600)"
                      : "var(--ink-900)",
                  fontWeight: 600,
                }}
              >
                {adjustmentAmount >= 0 ? "+¥" : "-¥"}
                {Math.abs(adjustmentAmount).toLocaleString()}
              </span>
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "var(--bg-soft)",
              borderRadius: 8,
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            说明：以上为按目前已审核报数估算。实际金额以运营在月底锁定批次后为准。
          </div>
        </MCard>
      </MSection>

      {currentItems.length > 0 ? (
        <MSection title="结算明细">
          <MCard padded={false}>
            {currentItems.map((item, index) => {
              const explanationId = `settlement-explanation-${item.id}`;
              const expanded = expandedExplanationId === item.id;
              return (
                <div
                  key={item.id}
                  style={{
                    padding: "14px 16px",
                    borderBottom:
                      index < currentItems.length - 1
                        ? "1px solid var(--line)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                        }}
                      >
                        {item.projectName}
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 11,
                          color: "var(--ink-400)",
                        }}
                      >
                        {item.evidence} · {item.hours.toFixed(1)}h
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div
                        className="num"
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--ink-900)",
                        }}
                      >
                        ¥{item.amount.toLocaleString()}
                      </div>
                      {item.explanation ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={explanationId}
                          aria-label={`查看 ${item.projectName} 结算说明`}
                          onClick={() =>
                            setExpandedExplanationId(expanded ? null : item.id)
                          }
                          style={{
                            marginTop: 6,
                            padding: 0,
                            border: "none",
                            background: "transparent",
                            color: "var(--blue-700)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {expanded ? "收起说明" : "查看说明"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {item.explanation && expanded ? (
                    <div
                      id={explanationId}
                      role="region"
                      aria-label={`${item.projectName} 结算说明`}
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px dashed var(--line)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: "var(--ink-800)",
                        }}
                      >
                        个人结算说明
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(96px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {item.explanation.components.map((component) => (
                          <div
                            key={component.key}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 8,
                              background: "var(--bg-soft)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--ink-400)",
                              }}
                            >
                              {component.label}
                            </div>
                            <div
                              className="num"
                              style={{
                                marginTop: 2,
                                fontSize: 13,
                                fontWeight: 700,
                                color: "var(--ink-900)",
                              }}
                            >
                              {formatMobileYuanFromCents(
                                component.amountCents,
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: "var(--ink-500)",
                          lineHeight: 1.55,
                        }}
                      >
                        来源报数{" "}
                        {item.explanation.evidenceFacts.sourceReportCount} 条
                        · 时间来源 {item.explanation.evidenceFacts.timeSource}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: "var(--ink-700)",
                          lineHeight: 1.55,
                        }}
                      >
                        {item.explanation.explanationZh}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </MCard>
        </MSection>
      ) : null}

      <MSection title="历史月度">
        <MCard padded={false}>
          {earnings.history.slice(0, 5).map((m, i, arr) => (
            <div
              key={m.month}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderBottom:
                  i < arr.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--bg-soft)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 11,
                  color: "var(--ink-500)",
                }}
                className="num"
              >
                {m.month.slice(5)}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink-900)",
                  }}
                  className="num"
                >
                  {m.month}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-400)",
                    marginTop: 2,
                  }}
                >
                  批次已锁定 · 已结算
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
                  ¥{m.earned.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--blue-700)",
                    fontWeight: 600,
                    marginTop: 1,
                  }}
                >
                  查看明细
                </div>
              </div>
            </div>
          ))}
        </MCard>
      </MSection>
    </>
  );
}

function RangeRow({ label, value, tone }) {
  const c = tone === "green" ? "var(--ok-600)" : "var(--warn-600)";
  const bg = tone === "green" ? "var(--ok-50)" : "var(--warn-50)";
  return (
    <div style={{ background: bg, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 11, color: c, fontWeight: 600 }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--ink-900)",
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatMobileYuanFromCents(value) {
  const amount = Number(value) / 100;
  if (!Number.isFinite(amount)) return "¥0";
  const prefix = amount < 0 ? "-¥" : "¥";
  return `${prefix}${Math.abs(amount).toLocaleString("zh-CN", {
    minimumFractionDigits: Math.abs(amount % 1) > 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// ——— Videos tab ———
function VideosTab({
  recordings,
  recordingAssets,
  projectAnnouncements,
  onRefreshAssets,
}) {
  const contextRecordings = useStreamerRecordings();
  const contextRecordingAssets = useStreamerRecordingAssets();
  const recordingRows = Array.isArray(recordings)
    ? recordings
    : contextRecordings.length
      ? contextRecordings
      : MY_VIDEOS;
  const recordingAssetRows = Array.isArray(recordingAssets)
    ? recordingAssets
    : contextRecordingAssets;
  const announcementRows = Array.isArray(projectAnnouncements)
    ? projectAnnouncements
    : [];
  const actions = useStreamerLiveActions();
  const [form, setForm] = React.useState(() => ({
    product: "",
    category: "",
    link: "",
    month: currentMonthLabel(),
  }));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [selectedProject, setSelectedProject] = React.useState(null);
  const [projectForm, setProjectForm] = React.useState({
    link: "",
    file: null,
  });
  const [projectSubmitting, setProjectSubmitting] = React.useState(false);
  const [projectError, setProjectError] = React.useState("");
  const [detailLoading, setDetailLoading] = React.useState(false);

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
    setProjectForm({ link: "", file: null });
    setProjectError("");
  };

  const submitRecordingLink = async (event) => {
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

  const updateProjectForm = (key, value) => {
    setProjectError("");
    // 超过 300MB 的录屏在选中时就地报错，不带入表单、不发起上传。
    if (key === "file" && value && value.size > RECORDING_MAX_UPLOAD_BYTES) {
      setProjectForm((current) => ({ ...current, file: null }));
      setProjectError(RECORDING_UPLOAD_TOO_LARGE_MESSAGE);
      return;
    }
    setProjectForm((current) => ({ ...current, [key]: value }));
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
        storagePath: projectForm.file
          ? await uploadProjectRecordingFile(
              selectedProject.id,
              projectForm.file,
            )
          : undefined,
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
      setProjectForm({ link: "", file: null });
    } catch (submitError) {
      setProjectError(recordingLinkErrorMessage(submitError));
    } finally {
      setProjectSubmitting(false);
    }
  };

  const uploadProjectRecordingFile = async (projectId, file) => {
    const fileName = sanitizeRecordingFileName(file.name || "recording.mp4");
    const signedResponse = await fetch("/api/uploads/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "recordings",
        ownerId: projectId,
        fileName,
        fileSizeBytes: file.size,
      }),
    });
    const signed = await signedResponse.json().catch(() => ({}));
    if (!signedResponse.ok) {
      throw new Error(signed.error || "创建录屏上传地址失败");
    }
    const uploadResponse = await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error("上传原始录屏失败");
    }
    return signed.path;
  };

  return (
    <>
      <MSection
        title="项目公告"
        action={<MBadge tone="blue">{announcementRows.length} 个</MBadge>}
      >
        {announcementRows.length === 0 ? (
          <MCard
            style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}
          >
            <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
              暂无公开项目公告。
            </div>
          </MCard>
        ) : (
          announcementRows.map((project) => (
            <ProjectAnnouncementCard
              key={project.id}
              project={project}
              onOpen={openProjectDetail}
            />
          ))
        )}
      </MSection>

      {selectedProject ? (
        <ProjectAnnouncementDetail
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

      <MSection title="个人录屏链接">
        <MCard>
          <form
            onSubmit={submitRecordingLink}
            style={{ display: "grid", gap: 10 }}
          >
            <MobileRecordingField
              label="产品"
              value={form.product}
              placeholder="例如：Game Alpha"
              onChange={(value) => updateForm("product", value)}
            />
            <MobileRecordingField
              label="品类"
              value={form.category}
              placeholder="ARPG / SLG / 赛事"
              onChange={(value) => updateForm("category", value)}
            />
            <MobileRecordingField
              label="链接"
              value={form.link}
              placeholder="https://..."
              onChange={(value) => updateForm("link", value)}
            />
            <MobileRecordingField
              label="月份"
              value={form.month}
              placeholder="2026-06"
              onChange={(value) => updateForm("month", value)}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 44,
                borderRadius: 10,
                border: "none",
                background: "var(--blue-600)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                opacity: submitting ? 0.58 : 1,
              }}
            >
              {submitting ? "提交中" : "提交录屏链接"}
            </button>
            {error ? (
              <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
                {error}
              </div>
            ) : null}
          </form>
        </MCard>
      </MSection>

      <MSection
        title="录屏资产"
        action={<MBadge tone="violet">{recordingAssetRows.length} 条</MBadge>}
      >
        {recordingAssetRows.length === 0 ? (
          <MCard
            style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}
          >
            <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
              暂无统一录屏资产，提交项目录屏或历史 URL 后会自动归档。
            </div>
          </MCard>
        ) : (
          recordingAssetRows.map((asset) => (
            <RecordingAssetCard
              key={asset.id}
              asset={asset}
              onRefreshAssets={onRefreshAssets}
            />
          ))
        )}
      </MSection>

      <MSection
        title="我的录屏"
        action={<MBadge tone="blue">{recordingRows.length} 条</MBadge>}
      >
        {recordingRows.length === 0 ? (
          <MCard
            style={{ background: "var(--bg-soft)", borderStyle: "dashed" }}
          >
            <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
              暂无录屏链接，提交 URL 后会进入审核列表。
            </div>
          </MCard>
        ) : (
          recordingRows.map((recording) => (
            <RecordingLinkCard key={recording.id} recording={recording} />
          ))
        )}
      </MSection>
    </>
  );
}

function ProjectAnnouncementCard({ project, onOpen }) {
  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "var(--ink-900)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.name}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}
            >
              {project.product || project.code}
            </div>
          </div>
          <MBadge tone={recordingStatusTone(project.latestRecordingStatus)} dot>
            {project.reviewStatusLabel}
          </MBadge>
        </div>
        {project.publicSummary ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-600)",
              lineHeight: 1.55,
            }}
          >
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
                height: 32,
                borderRadius: 8,
                padding: "0 10px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--bg-soft)",
                color: "var(--blue-700)",
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              打开游戏下载
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => onOpen(project)}
            style={{
              height: 32,
              borderRadius: 8,
              border: "none",
              padding: "0 10px",
              background: "var(--blue-600)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            查看详情
          </button>
        </div>
      </div>
    </MCard>
  );
}

function ProjectAnnouncementDetail({
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
    <MSection
      title="项目详情"
      action={
        <MBadge tone={recordingStatusTone(project.latestRecordingStatus)} dot>
          {project.reviewStatusLabel}
        </MBadge>
      }
    >
      <MCard>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "var(--ink-900)",
                }}
              >
                {project.name}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}
              >
                {project.product || project.code}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: "1px solid var(--line-strong)",
                borderRadius: 8,
                background: "#fff",
                color: "var(--ink-500)",
                height: 30,
                padding: "0 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              返回
            </button>
          </div>
          {loading ? (
            <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
              正在加载项目详情...
            </div>
          ) : null}
          {project.publicSummary ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-700)",
                lineHeight: 1.65,
              }}
            >
              {project.publicSummary}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
              录屏要求：
              {project.forceRecording
                ? "需提交项目试播录屏"
                : "可提交项目试播录屏"}
            </div>
            {project.recordingFeedback ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--warn-600)",
                  lineHeight: 1.55,
                }}
              >
                {project.recordingFeedback}
              </div>
            ) : null}
            {project.gameDownloadUrl ? (
              <a
                href={project.gameDownloadUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--blue-700)",
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                  wordBreak: "break-all",
                }}
              >
                打开游戏下载
              </a>
            ) : null}
          </div>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
            <MobileRecordingField
              label="录屏链接"
              value={form.link}
              placeholder="https://..."
              onChange={(value) => onChange("link", value)}
            />
            <label style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ink-500)",
                  fontWeight: 600,
                }}
              >
                上传原始录屏
              </span>
              <input
                aria-label="上传原始录屏"
                type="file"
                accept="video/*"
                onChange={(event) =>
                  onChange("file", event.target.files?.[0] ?? null)
                }
                style={{
                  width: "100%",
                  fontSize: 12,
                  color: "var(--ink-600)",
                }}
              />
              {form.file ? (
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  已选择：{form.file.name}
                </span>
              ) : null}
            </label>
            <button
              type="submit"
              disabled={submitting || !project.canSubmitRecording}
              style={{
                height: 44,
                borderRadius: 10,
                border: "none",
                background: project.canSubmitRecording
                  ? "var(--blue-600)"
                  : "var(--line-strong)",
                color: project.canSubmitRecording ? "#fff" : "var(--ink-400)",
                fontSize: 14,
                fontWeight: 800,
                opacity: submitting ? 0.58 : 1,
              }}
            >
              {submitting ? "提交中" : "提交项目录屏"}
            </button>
            {error ? (
              <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
                {error}
              </div>
            ) : null}
          </form>
        </div>
      </MCard>
    </MSection>
  );
}

function RecordingAssetCard({ asset, onRefreshAssets }) {
  const source = asset.primarySource || {};
  // 签名 URL 1 小时过期：播放失败时提示并触发上层重签（GET /api/streamer/recordings）。
  const [playbackExpired, setPlaybackExpired] = React.useState(false);
  React.useEffect(() => {
    setPlaybackExpired(false);
  }, [source.downloadUrl]);
  const label =
    source.previewMode === "private_file"
      ? "原始文件"
      : source.previewMode === "embed"
        ? "B站预览"
        : source.previewMode === "external"
          ? "外部链接"
          : "待处理";
  const href =
    source.previewMode === "private_file"
      ? source.downloadUrl
      : source.openUrl || source.embedUrl;

  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--violet-50)",
              color: "var(--violet-600)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Play size={18} stroke="var(--violet-600)" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "var(--ink-900)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {asset.title}
              </div>
              <MBadge tone={recordingStatusTone(asset.reviewStatus)} dot>
                {asset.reviewStatusLabel || asset.reviewStatus}
              </MBadge>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 11,
                color: "var(--ink-400)",
              }}
            >
              <span>{label}</span>
              {source.provider ? <span>{source.provider}</span> : null}
            </div>
          </div>
        </div>
        {source.previewMode === "embed" && source.embedUrl ? (
          <iframe
            title={`${asset.title} 预览`}
            src={source.embedUrl}
            loading="lazy"
            allowFullScreen
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--ink-50)",
            }}
          />
        ) : null}
        {source.previewMode === "private_file" && source.downloadUrl ? (
          <video
            controls
            preload="none"
            src={source.downloadUrl}
            onError={() => {
              setPlaybackExpired(true);
              if (onRefreshAssets) onRefreshAssets();
            }}
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 10,
              background: "#000",
            }}
          />
        ) : null}
        {playbackExpired ? (
          <div style={{ fontSize: 11, color: "var(--danger-600)" }}>
            播放地址已过期，已自动刷新，请重试
          </div>
        ) : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
              height: 34,
              borderRadius: 9,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 12px",
              background: "var(--bg-soft)",
              color: "var(--blue-700)",
              fontSize: 12,
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            {source.previewMode === "private_file"
              ? "下载原始文件"
              : "打开录屏"}
          </a>
        ) : null}
        <RecordingAssetAiAnalysis analysis={asset.aiAnalysis} />
      </div>
    </MCard>
  );
}

function RecordingAssetAiAnalysis({ analysis }) {
  if (!analysis) {
    return (
      <div
        style={{
          borderTop: "1px solid var(--line)",
          paddingTop: 10,
          fontSize: 12,
          color: "var(--ink-400)",
          lineHeight: 1.5,
        }}
      >
        AI 分析待排队，审核后会沉淀节奏、互动、音画和风险片段。
      </div>
    );
  }

  const dimensions = Array.isArray(analysis.dimensions)
    ? analysis.dimensions
    : [];
  const segments = Array.isArray(analysis.segments) ? analysis.segments : [];

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        paddingTop: 10,
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-900)" }}>
          AI 分析报告
        </div>
        <MBadge tone={analysis.status === "succeeded" ? "green" : "violet"}>
          {analysis.statusLabel || analysis.status}
        </MBadge>
      </div>
      {analysis.summary ? (
        <div style={{ fontSize: 12, color: "var(--ink-600)", lineHeight: 1.6 }}>
          {analysis.summary}
        </div>
      ) : null}
      {dimensions.length > 0 ? (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          {dimensions.slice(0, 4).map((dimension) => (
            <div
              key={dimension.key}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: "8px 9px",
                background: "var(--bg-soft)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  marginBottom: 4,
                }}
              >
                {dimension.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "var(--blue-600)",
                  lineHeight: 1,
                }}
              >
                {dimension.score}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {segments.length > 0 ? (
        <div style={{ display: "grid", gap: 7 }}>
          {segments.slice(0, 3).map((segment) => (
            <div
              key={segment.id || `${segment.segmentKind}-${segment.sortOrder}`}
              style={{
                display: "grid",
                gap: 2,
                fontSize: 12,
                color: "var(--ink-600)",
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: "var(--ink-400)", fontWeight: 700 }}>
                {segment.timeRangeLabel}
              </span>
              <span>
                <strong style={{ color: "var(--ink-800)" }}>
                  {segment.title}
                </strong>
                {segment.summary ? ` · ${segment.summary}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MobileRecordingField({ label, value, placeholder, onChange }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 600 }}>
        {label}
      </span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: 40,
          border: "1px solid var(--line-strong)",
          borderRadius: 10,
          padding: "0 12px",
          fontSize: 13,
          outline: "none",
          color: "var(--ink-900)",
          background: "#fff",
        }}
      />
    </label>
  );
}

function RecordingLinkCard({ recording }) {
  return (
    <MCard style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon.Reports size={18} stroke="var(--blue-700)" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--ink-900)",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {recording.product}
            </div>
            <MBadge tone={recordingStatusTone(recording.status)} dot>
              {recording.statusLabel}
            </MBadge>
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontSize: 11,
              color: "var(--ink-400)",
            }}
          >
            <span>{recording.category}</span>
            <span className="mono">{recording.month}</span>
          </div>
          <a
            href={recording.link}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              marginTop: 8,
              color: "var(--blue-700)",
              fontSize: 12,
              textDecoration: "none",
              wordBreak: "break-all",
              lineHeight: 1.45,
            }}
          >
            {recording.link}
          </a>
        </div>
      </div>
    </MCard>
  );
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

function normalizeStreamerApplications(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.map((item) => {
    const project = item.project ?? {};
    const latestRecording = item.latestRecording ?? {};
    const latestRecordingStatus =
      item.latestRecordingStatus || latestRecording.status || "";

    return {
      id: item.id,
      projectId: item.projectId || project.id,
      projectName: item.projectName || project.name || "项目记录",
      projectCode: item.projectCode || project.code || "",
      status: item.status || "submitted",
      statusLabel:
        item.statusLabel || applicationStatusLabel(item.status || "submitted"),
      source: item.source || "signup",
      submittedAt: item.submittedAt || item.submitted_at || "",
      decisionReason: item.decisionReason || item.decision_reason || "",
      recordingFeedback:
        item.recordingFeedback ||
        item.recording_feedback ||
        item.decisionReason ||
        item.decision_reason ||
        "",
      forceRecording:
        item.forceRecording ??
        project.forceRecording ??
        project.force_recording,
      latestRecordingStatus,
      reviewStatusLabel:
        item.reviewStatusLabel ||
        (latestRecordingStatus
          ? recordingStatusLabel(latestRecordingStatus)
          : "暂无录屏"),
    };
  });
}

function normalizeProjectAnnouncements(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items;
}

function formatDiagnosisAnswer(body) {
  const directAnswer = body?.result?.answer || body?.result?.output?.answer;
  if (typeof directAnswer === "string" && directAnswer.trim()) {
    return directAnswer;
  }

  const summary = body?.agentOutput?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary;
  }

  const firstRecommendation = body?.agentOutput?.recommendations?.[0];
  if (firstRecommendation?.title && firstRecommendation?.rationale) {
    return `${firstRecommendation.title}：${firstRecommendation.rationale}`;
  }

  return "";
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

function recordingStatusLabel(status) {
  return (
    {
      submitted: "已提交",
      reviewing: "审核中",
      approved: "已通过",
      rejected: "未通过",
      needs_changes: "需修改",
    }[status] ??
    status ??
    "暂无录屏"
  );
}

function applicationStatusLabel(status) {
  return (
    {
      submitted: "待审核",
      invited: "已受邀",
      recording_required: "待提交录屏",
      recording_reviewing: "录屏审核中",
      recording_approved: "录屏已通过",
      recording_rejected: "录屏未通过",
      approved: "已通过",
      rejected: "已拒绝",
      joined: "已加入项目",
      cancelled: "已取消",
    }[status] ??
    status ??
    "待审核"
  );
}

function applicationStatusTone(status) {
  return (
    {
      submitted: "amber",
      invited: "blue",
      recording_required: "blue",
      recording_reviewing: "violet",
      recording_approved: "green",
      recording_rejected: "red",
      approved: "green",
      joined: "green",
      rejected: "red",
      cancelled: "neutral",
    }[status] ?? "neutral"
  );
}

function applicationSignupErrorMessage(error) {
  const message = error?.message || "";
  if (message.includes("Only streamers")) {
    return "请先登录主播账号后再报名。";
  }
  if (message.includes("not bound to a streamer")) {
    return "当前账号还未绑定主播档案，请先完成主播档案配置。";
  }
  if (message.includes("not open for signup")) {
    return "该项目暂未开放报名。";
  }
  if (message.includes("Project not found")) {
    return "项目不存在或暂不可报名。";
  }
  if (message.includes("Blacklisted")) {
    return "当前账号暂时无法报名，请联系运营确认。";
  }
  return message || "报名失败，请稍后重试。";
}

function recordingLinkErrorMessage(error) {
  const message = error?.message || "";
  if (message.includes("Only streamers")) {
    return "请先登录主播账号后再提交录屏链接。";
  }
  if (message.includes("not bound to a streamer")) {
    return "当前账号还未绑定主播档案，请先完成主播档案配置。";
  }
  if (message.includes("product is required")) {
    return "请填写产品。";
  }
  if (message.includes("category is required")) {
    return "请填写品类。";
  }
  if (message.includes("link is required")) {
    return "请填写录屏链接。";
  }
  if (message.includes("http(s) URL")) {
    return "录屏链接必须是可访问的 http(s) URL。";
  }
  if (message.includes("month is required")) {
    return "请填写月份。";
  }
  if (message.includes("YYYY-MM")) {
    return "月份格式需为 YYYY-MM。";
  }
  return message || "录屏链接提交失败，请稍后重试。";
}

function isStreamerAccountAccessError(error) {
  const message = error?.message || "";
  return (
    message.includes("Only streamers") ||
    message.includes("not bound to a streamer")
  );
}

function warnStreamerBackgroundRefreshFailure(scope, error) {
  globalThis.console?.warn?.(`${scope} background refresh failed`, error);
}

function currentMonthLabel() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ===== src-streamer\app.jsx =====
// ——— Streamer app entry ————————————————————————

function StreamerMobileReferenceInner({
  initialRoute = "home",
  profile,
  liveTasks,
  liveEarnings,
  recordings,
  recordingAssets,
  projectAnnouncements,
}) {
  // route: 'home' | 'tasks' | 'task' | 'report' | 'ai' | 'me' | 'videos'
  const [route, setRoute] = React.useState(initialRoute);
  const [taskId, setTaskId] = React.useState(null);
  const [reportScreenshotFile, setReportScreenshotFile] = React.useState(null);
  const [tasks, setTasks] = React.useState(liveTasks ?? null);
  const [earnings, setEarnings] = React.useState(liveEarnings ?? null);
  const [recordingRows, setRecordingRows] = React.useState(() =>
    normalizeStreamerRecordings(recordings),
  );
  const [recordingAssetRows, setRecordingAssetRows] = React.useState(() =>
    Array.isArray(recordingAssets) ? recordingAssets : null,
  );
  const [applicationRows, setApplicationRows] = React.useState(null);
  const [announcementRows, setAnnouncementRows] = React.useState(() =>
    projectAnnouncements === undefined
      ? null
      : normalizeProjectAnnouncements(projectAnnouncements),
  );

  React.useEffect(() => {
    setTasks(liveTasks ?? null);
  }, [liveTasks]);

  React.useEffect(() => {
    setEarnings(liveEarnings ?? null);
  }, [liveEarnings]);

  React.useEffect(() => {
    setRecordingRows(normalizeStreamerRecordings(recordings));
  }, [recordings]);

  React.useEffect(() => {
    setRecordingAssetRows(
      Array.isArray(recordingAssets) ? recordingAssets : null,
    );
  }, [recordingAssets]);

  React.useEffect(() => {
    setAnnouncementRows(
      projectAnnouncements === undefined
        ? null
        : normalizeProjectAnnouncements(projectAnnouncements),
    );
  }, [projectAnnouncements]);

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
        setTasks(body.tasks.map((task) => toStreamerReferenceTask(task)));
      }
    };

    const refreshRecordings = async () => {
      try {
        const body = await fetchJson(
          "/api/streamer/recordings",
          "refresh streamer recordings failed",
        );
        if (Array.isArray(body.recordings)) {
          setRecordingRows(normalizeStreamerRecordings(body.recordings));
        }
        if (Array.isArray(body.recordingAssets)) {
          setRecordingAssetRows(body.recordingAssets);
        }
      } catch (error) {
        if (isStreamerAccountAccessError(error)) {
          setRecordingRows([]);
          setRecordingAssetRows([]);
          return;
        }
        throw error;
      }
    };

    const refreshProjectAnnouncements = async () => {
      try {
        const body = await fetchJson(
          "/api/streamer/project-announcements",
          "refresh project announcements failed",
        );
        if (Array.isArray(body.announcements)) {
          setAnnouncementRows(
            normalizeProjectAnnouncements(body.announcements),
          );
        }
      } catch (error) {
        if (isStreamerAccountAccessError(error)) {
          setAnnouncementRows([]);
          return;
        }
        throw error;
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

    const refreshApplications = async () => {
      try {
        const body = await fetchJson(
          "/api/streamer/applications",
          "refresh streamer applications failed",
        );
        if (Array.isArray(body.applications)) {
          setApplicationRows(normalizeStreamerApplications(body.applications));
        }
      } catch (error) {
        if (isStreamerAccountAccessError(error)) {
          setApplicationRows([]);
          return;
        }
        throw error;
      }
    };

    return {
      askDiagnosis: async (question) => {
        const body = await fetchJson(
          "/api/ai/diagnosis",
          "AI diagnosis failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question,
              source: "streamer_mobile",
            }),
          },
        );

        return formatDiagnosisAnswer(body);
      },
      refreshRecordings,
      refreshProjectAnnouncements,
      getProjectAnnouncement,
      refreshApplications,
      applyToProject: async (projectId) => {
        if (!projectId) {
          throw new Error("projectId is required");
        }
        const body = await fetchJson(
          `/api/projects/${projectId}/applications`,
          "apply to project failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        await Promise.all([
          refreshApplications().catch((error) =>
            warnStreamerBackgroundRefreshFailure(
              "streamer applications",
              error,
            ),
          ),
          refreshProjectAnnouncements().catch((error) =>
            warnStreamerBackgroundRefreshFailure(
              "streamer project announcements",
              error,
            ),
          ),
        ]);
        return body.application;
      },
      submitRecordingLink: async (form) => {
        const payload = form.projectId
          ? form
          : {
              product: form.product,
              category: form.category,
              link: form.link,
              month: form.month,
            };
        const body = await fetchJson(
          "/api/streamer/recordings",
          "submit recording link failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (body.projectRecording) {
          // 提交项目录屏后同时刷新资产列表，新上传的原始视频立即可见/可播。
          await Promise.all([refreshProjectAnnouncements(), refreshRecordings()]);
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
      refreshOcrJob: async (jobId) => {
        if (!jobId) {
          throw new Error("OCR job id is required");
        }
        const body = await fetchJson(
          `/api/ocr/jobs/${jobId}`,
          "load OCR result failed",
        );
        return body.job || body;
      },
      confirmOcrReport: async (reportId, input) => {
        await fetchJson(
          `/api/live-reports/${reportId}/ocr`,
          "confirm OCR report failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshTasks();
      },
      submitReport: async (id, input) => {
        const durationHours = Number(input.durationHours || 0);
        const audience = Number(input.audience || 0);
        const confirmedDuration = Math.round(durationHours * 60);
        const screenshotFile = input.screenshotFile;
        if (!screenshotFile) {
          throw new Error("report screenshot file is required");
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
    // 进入「视频」页即重签一次：SSR 注入的签名 downloadUrl 1 小时过期，
    // 仅在 recordingRows===null 时拉取会让长驻页面永远拿不到新签名。
    if (route === "videos") {
      actions
        .refreshRecordings?.()
        .catch((error) =>
          warnStreamerBackgroundRefreshFailure("streamer recordings", error),
        );
    }
  }, [route, actions]);

  React.useEffect(() => {
    if (route === "videos" && announcementRows === null) {
      actions
        .refreshProjectAnnouncements?.()
        .catch((error) =>
          warnStreamerBackgroundRefreshFailure(
            "streamer project announcements",
            error,
          ),
        );
    }
  }, [route, announcementRows, actions]);

  const visibleTasks = Array.isArray(tasks) ? tasks : MY_TASKS;
  const visibleRecordings = Array.isArray(recordingRows) ? recordingRows : [];
  const visibleRecordingAssets = Array.isArray(recordingAssetRows)
    ? recordingAssetRows
    : [];
  const visibleAnnouncements = Array.isArray(announcementRows)
    ? announcementRows
    : [];

  const go = (r, arg, options = {}) => {
    if (r === "task") {
      setRoute("task");
      setTaskId(arg || visibleTasks[0]?.id || null);
      setReportScreenshotFile(null);
    } else if (r === "report") {
      setRoute("report");
      setTaskId(
        arg ||
          visibleTasks.find((t) => t.status === "pending_report")?.id ||
          null,
      );
      setReportScreenshotFile(options.screenshotFile ?? null);
    } else {
      setRoute(r);
      setReportScreenshotFile(null);
    }
    // Scroll to top on nav
    document
      .querySelector(".phone")
      ?.scrollTo?.({ top: 0, behavior: "instant" });
  };

  const navKey = ["home", "tasks"].includes(route)
    ? "home"
    : ["task", "report"].includes(route)
      ? "home"
      : route === "videos"
        ? "videos"
        : route;

  return (
    <StreamerLiveDataContext.Provider
      value={{
        tasks: visibleTasks,
        profile,
        earnings,
        applications: applicationRows,
        recordings: visibleRecordings,
        recordingAssets: visibleRecordingAssets,
        projectAnnouncements: visibleAnnouncements,
        actions,
      }}
    >
      <div className="phone">
        {route === "home" && <StreamerHome go={go} />}
        {route === "tasks" && <StreamerTaskList go={go} />}
        {route === "task" && <StreamerTask go={go} taskId={taskId} />}
        {route === "report" && (
          <StreamerReport
            go={go}
            taskId={taskId}
            screenshotFile={reportScreenshotFile}
          />
        )}
        {route === "ai" && <StreamerAI go={go} />}
        {route === "me" && <StreamerMe go={go} />}
        {route === "videos" && (
          <VideosOnlyPage
            go={go}
            recordings={visibleRecordings}
            recordingAssets={visibleRecordingAssets}
            projectAnnouncements={visibleAnnouncements}
            onRefreshAssets={() =>
              actions
                .refreshRecordings?.()
                .catch((error) =>
                  warnStreamerBackgroundRefreshFailure(
                    "streamer recordings",
                    error,
                  ),
                )
            }
          />
        )}

        {route !== "report" && (
          <MTabBar
            value={navKey}
            onChange={(k) => {
              if (k === "videos") {
                go("videos");
              } else {
                go(k);
              }
            }}
          />
        )}
      </div>
    </StreamerLiveDataContext.Provider>
  );
}

// Small placeholder for 录屏 tab when accessed independently
function VideosOnlyPage({
  recordings,
  recordingAssets,
  projectAnnouncements,
  onRefreshAssets,
}) {
  return (
    <div style={{ paddingBottom: 96 }}>
      <MAppBar
        title="我的录屏"
        subtitle="项目公告 / 录屏 URL / 审核状态"
        dark={false}
      />
      <VideosTab
        recordings={recordings}
        recordingAssets={recordingAssets}
        projectAnnouncements={projectAnnouncements}
        onRefreshAssets={onRefreshAssets}
      />
    </div>
  );
}

/**
 * @param {{ initialRoute?: string; profile?: any; liveTasks?: any[]; liveEarnings?: any; recordings?: any[]; recordingAssets?: any[]; projectAnnouncements?: any[] }} props
 */
export default function StreamerMobileReferenceApp({
  initialRoute = "home",
  profile,
  liveTasks,
  liveEarnings,
  recordings,
  recordingAssets,
  projectAnnouncements,
}) {
  return (
    <StreamerMobileReferenceInner
      initialRoute={initialRoute}
      profile={profile}
      liveTasks={liveTasks}
      liveEarnings={liveEarnings}
      recordings={recordings}
      recordingAssets={recordingAssets}
      projectAnnouncements={projectAnnouncements}
    />
  );
}
