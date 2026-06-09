"use client";
/* eslint-disable */
import React from "react";

import { getAllowedProjectStatusTransitions } from "@/features/projects/project-state";
import { toOpsReferenceTask } from "@/features/live-operations/live-ui-adapters";
import {
  toPricingResultDto,
  toProjectReviewDto,
  toStreamerMatchDtos,
  toSupplierQualityDtos,
} from "@/features/war-room/war-room-ui-dto";

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
// ——— empty production defaults ——————————————————————————————————————————————

const ORG = { id: "", name: "未配置组织" };

const ORGANIZATION_FEATURE_OPTIONS = [
  {
    key: "aiWarRoom",
    label: "AI 智能作战台",
    hint: "经营看板、复盘摘要、风险提醒与项目推荐能力。",
  },
  {
    key: "dataExport",
    label: "数据导出",
    hint: "导出项目、主播、报数、结算与审计明细。",
  },
  {
    key: "streamerDesktop",
    label: "主播工作台",
    hint: "主播任务、录屏、报数与结算确认入口。",
  },
  {
    key: "vendorPortal",
    label: "厂家门户",
    hint: "向厂家开放候选主播、执行进度与交付包。",
  },
  {
    key: "autoReview",
    label: "自动审核正式模式",
    hint: "OCR 与规则命中后自动推进报数审核流转。",
  },
];

const DEFAULT_ORGANIZATION_SETTINGS = {
  id: ORG.id,
  name: ORG.name || "未配置组织",
  logoText: "JY",
  memberLimit: null,
  plan: "",
  verified: false,
  features: {
    aiWarRoom: true,
    dataExport: true,
    streamerDesktop: true,
    vendorPortal: false,
    autoReview: false,
  },
};

function normalizeOrganizationSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawLimit = Number(source.memberLimit ?? source.memberCount);
  const memberLimit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : null;
  const features =
    source.features && typeof source.features === "object"
      ? source.features
      : source.enabledFeatures && typeof source.enabledFeatures === "object"
        ? source.enabledFeatures
        : {};

  return {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...source,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : DEFAULT_ORGANIZATION_SETTINGS.name,
    logoText:
      typeof source.logoText === "string" && source.logoText.trim()
        ? source.logoText.trim().slice(0, 4)
        : DEFAULT_ORGANIZATION_SETTINGS.logoText,
    memberLimit,
    plan:
      typeof source.plan === "string" && source.plan.trim()
        ? source.plan.trim()
        : DEFAULT_ORGANIZATION_SETTINGS.plan,
    verified:
      typeof source.verified === "boolean"
        ? source.verified
        : DEFAULT_ORGANIZATION_SETTINGS.verified,
    features: {
      ...DEFAULT_ORGANIZATION_SETTINGS.features,
      ...features,
    },
  };
}

function countEnabledOrganizationFeatures(settings) {
  const normalized = normalizeOrganizationSettings(settings);
  return ORGANIZATION_FEATURE_OPTIONS.filter(
    (feature) => normalized.features[feature.key],
  ).length;
}

const ROLES = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};

const DEFAULT_CURRENT_USER = {
  id: "",
  name: "未登录用户",
  role: "owner",
  org: "",
  dept: "",
};

function normalizeCurrentUser(input) {
  const source = input && typeof input === "object" ? input : {};
  const role = ROLES[source.role] ? source.role : DEFAULT_CURRENT_USER.role;
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : DEFAULT_CURRENT_USER.name;
  const dept = typeof source.dept === "string" ? source.dept.trim() : "";
  const org = typeof source.org === "string" ? source.org.trim() : "";

  return {
    ...DEFAULT_CURRENT_USER,
    ...source,
    name,
    role,
    org,
    dept,
  };
}

function formatCurrentUserMeta(user) {
  const roleLabel = ROLES[user.role] ?? ROLES[DEFAULT_CURRENT_USER.role];
  const scope = user.dept || user.org;
  return scope ? `${roleLabel} · ${scope}` : roleLabel;
}

const UUID_LIKE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLikeId(value) {
  return UUID_LIKE_ID.test(String(value || "").trim());
}

function displayRecordId(value, fallback = "内部记录") {
  const text = String(value || "").trim();
  if (!text || isUuidLikeId(text)) return fallback;
  return text;
}

function displayTaskStreamerName(task, fallback = "未配置主播") {
  const readableName = displayRecordId(task?.streamerName, "");
  if (readableName) return readableName;
  return displayRecordId(task?.streamerId, fallback);
}

function displayProjectCode(project) {
  const code = String(project?.code || "").trim();
  return code || "未设置编号";
}

// Projects ———————————————————————————————————
const PROJECTS = [];

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

const PROJECT_STATUS_OPTIONS = Object.entries(PROJECT_STATUS).map(
  ([value, meta]) => ({ value, label: meta.label }),
);

// Streamers ———————————————————————————————————
const STREAMERS = [];

// Reports ———————————————————————————————————
const REPORTS = [];

const REPORT_STATUS = {
  pending_streamer: { tone: "neutral", label: "待主播确认" },
  pending_review: { tone: "blue", label: "待审核" },
  need_supply: { tone: "amber", label: "需补充" },
  approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
};

const OpsLiveDataContext = React.createContext({
  projects: null,
  streamers: null,
  applications: null,
  tasks: null,
  reports: null,
  batches: null,
  batchDetails: null,
  settlementPool: null,
  settlementScope: null,
  auditEntries: null,
  ocrJobs: null,
  notificationItems: null,
  organizationMembers: null,
  organizationMemberPermissions: null,
  organizationSettings: DEFAULT_ORGANIZATION_SETTINGS,
  billingStatus: null,
  currentUser: DEFAULT_CURRENT_USER,
  actions: {},
});

function useOpsProjects() {
  const { projects } = React.useContext(OpsLiveDataContext);
  return Array.isArray(projects) ? projects : PROJECTS;
}

function useOpsStreamers() {
  const { streamers } = React.useContext(OpsLiveDataContext);
  return Array.isArray(streamers) ? streamers : STREAMERS;
}

function useOpsApplications() {
  const { applications } = React.useContext(OpsLiveDataContext);
  return Array.isArray(applications) ? applications : [];
}

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
  return Array.isArray(batches) ? batches : BATCHES;
}

function useOpsSettlementBatchDetails() {
  const { batchDetails } = React.useContext(OpsLiveDataContext);
  return batchDetails && typeof batchDetails === "object" ? batchDetails : {};
}

function useOpsSettlementPool() {
  const { settlementPool } = React.useContext(OpsLiveDataContext);
  return Array.isArray(settlementPool) ? settlementPool : [];
}

function useOpsSettlementScope() {
  const { settlementScope } = React.useContext(OpsLiveDataContext);
  return settlementScope || null;
}

function useOpsAuditEntries() {
  const { auditEntries } = React.useContext(OpsLiveDataContext);
  return Array.isArray(auditEntries) ? auditEntries : [];
}

function useOpsOcrJobs() {
  const { ocrJobs } = React.useContext(OpsLiveDataContext);
  return Array.isArray(ocrJobs) ? ocrJobs : [];
}

function useOpsNotifications() {
  const { notificationItems } = React.useContext(OpsLiveDataContext);
  return Array.isArray(notificationItems) ? notificationItems : [];
}

function useOpsOrganizationMembers() {
  const { organizationMembers } = React.useContext(OpsLiveDataContext);
  return Array.isArray(organizationMembers) ? organizationMembers : MEMBERS;
}

function useOpsOrganizationMemberPermissions() {
  const { organizationMemberPermissions } =
    React.useContext(OpsLiveDataContext);
  return organizationMemberPermissions &&
    typeof organizationMemberPermissions === "object"
    ? organizationMemberPermissions
    : null;
}

function useOpsOrganizationSettings() {
  const { organizationSettings } = React.useContext(OpsLiveDataContext);
  return normalizeOrganizationSettings(organizationSettings);
}

function useOpsCurrentUser() {
  const { currentUser } = React.useContext(OpsLiveDataContext);
  return normalizeCurrentUser(currentUser);
}

function useOpsBillingStatus() {
  const { billingStatus } = React.useContext(OpsLiveDataContext);
  return billingStatus && typeof billingStatus === "object"
    ? billingStatus
    : null;
}

function useOpsLiveActions() {
  const { actions } = React.useContext(OpsLiveDataContext);
  return actions || {};
}

// Settlement batches ———————————————————————————————————
const BATCHES = [];

const BATCH_STATUS = {
  draft: { tone: "neutral", label: "草稿" },
  generated: { tone: "blue", label: "已生成" },
  pending_confirm: { tone: "amber", label: "待确认" },
  confirmed: { tone: "green", label: "已确认" },
  locked: { tone: "teal", label: "已锁定" },
  reopened: { tone: "violet", label: "已重开" },
};

const BATCH_DETAIL_ITEMS = [];

const JOINED_STREAMER_REQUIRED_MESSAGE =
  "该项目暂无已加入主播，请先在主播资源池邀请并确认加入后再排班。";

// Recommended streamers (war room)
const DEFAULT_MATCHING_ROWS = [];

// Supplier scores (war room)
const SUPPLIER_SCORES = [];

const WAR_ROOM_FALLBACK_PROJECT = {
  id: "project-war-room-fallback",
  name: "项目待配置",
  start: "",
  end: "",
  metrics: {
    receivable: 0,
    payable: 0,
  },
};

const WAR_ROOM_FALLBACK_STREAMERS = [
  {
    id: "streamer-war-room-fallback",
    alias: "主播待配置",
    games: [],
    platforms: [],
    style: "待配置",
    risk: "low",
    metrics: {
      projectFinish: 0,
      screenPass: 0,
      roi: 0,
      grossContrib: 0,
    },
    completedProjects: 0,
  },
];

const WAR_ROOM_FALLBACK_SUPPLIERS = [
  {
    id: "supplier-war-room-fallback",
    name: "供应商待配置",
    score: 0,
    finishRate: 0,
    anomalyRate: 0,
    grossContrib: 0,
  },
];

const ANOMALIES = [];

const AUDIT_LOG_RECENT = [];

// ——— Tasks / Schedule —————————————————————————————

const SCHEDULE_WEEK = createScheduleWeek();

function createScheduleWeek(today = new Date()) {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const day = today.getUTCDay();
  const todayIdx = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - todayIdx);
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const days = labels.map((label, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    return {
      label,
      date: formatScheduleDate(current),
      today: index === todayIdx,
    };
  });
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end),
    todayIdx,
    days,
  };
}

function formatDateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatScheduleDate(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

// Tasks: each row = one streamer, with tasks placed by day.
// startHour / endHour are 0-24. status: 'completed' | 'live' | 'pending_report' | 'pending_review' | 'pending_live' | 'abnormal' | 'cancelled'
// project: project id
// type: 'project' | 'trial' | 'training' | 'temporary'
const TASKS = [];

const TASK_STATUS = {
  pending_live: { tone: "neutral", label: "待开播" },
  missed_live: { tone: "red", label: "已延期未直播" },
  live: { tone: "blue", label: "直播中", pulse: true },
  pending_report: { tone: "violet", label: "待报数" },
  pending_review: { tone: "amber", label: "报数待审" },
  approved: { tone: "green", label: "审核通过" },
  rejected: { tone: "red", label: "审核驳回" },
  completed: { tone: "green", label: "已完成" },
  cancelled: { tone: "neutral", label: "已取消" },
  abnormal: { tone: "red", label: "异常" },
};

const TASK_TYPE_OPTIONS = [
  { value: "project", label: "项目任务" },
  { value: "trial", label: "试播任务" },
  { value: "training", label: "训练任务" },
  { value: "temporary", label: "临时任务" },
];

const ANOMALY_TYPES = {
  not_started: { tone: "red", label: "已延期未直播" },
  not_reported: { tone: "amber", label: "未报数" },
  report_overdue: { tone: "amber", label: "报数逾期" },
  missing_checkout_screenshot: { tone: "amber", label: "缺少下播截图" },
  live_over_48h: { tone: "red", label: "直播超过 48 小时" },
  unstopped: { tone: "red", label: "未停止 / 未报数" },
  late_report: { tone: "amber", label: "报数逾期" },
  unstart: { tone: "amber", label: "未开播" },
  short: { tone: "amber", label: "时长不足" },
  rejected: { tone: "red", label: "审核驳回未重提" },
  conflict: { tone: "red", label: "时间冲突" },
  abnormal: { tone: "red", label: "异常" },
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
  Logout: (p) =>
    ic(
      p,
      <>
        <path d="M10 6H6.5A1.5 1.5 0 0 0 5 7.5v9A1.5 1.5 0 0 0 6.5 18H10" />
        <path d="M14 8l4 4-4 4" />
        <path d="M18 12H9" />
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
  { key: "admission", label: "选播准入", icon: "Eye" },
  { key: "tasks", label: "排班与任务", icon: "Tasks" },
  { key: "reports", label: "报数审核", icon: "Reports" },
  { key: "settle", label: "结算中心", icon: "Money" },
  { key: "billing", label: "商业化与套餐", icon: "Money" },
  { divider: true },
  { key: "export", label: "数据导出", icon: "Export" },
  { key: "audit", label: "操作日志", icon: "Audit" },
  { key: "org", label: "组织与权限", icon: "Settings" },
];

function Sidebar({
  route,
  onNav,
  navCounts = {},
  currentUser,
  organizationSettings,
  organizationMembers,
  onOpenOrganizationSettings,
}) {
  const displayUser = normalizeCurrentUser(currentUser);
  const orgSettings = normalizeOrganizationSettings(organizationSettings);
  const enabledFeatureCount = countEnabledOrganizationFeatures(orgSettings);
  const memberCount = Array.isArray(organizationMembers)
    ? organizationMembers.length
    : null;
  const [accountPanel, setAccountPanel] = React.useState(null);
  const switcherMemberText =
    memberCount != null
      ? `当前组织 · ${memberCount} 名成员`
      : orgSettings.memberLimit != null
        ? `当前组织 · 配额 ${orgSettings.memberLimit}`
        : "当前组织 · 设置与权限";

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
          aria-label="组织 LOGO"
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
          {orgSettings.logoText}
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
        type="button"
        onClick={onOpenOrganizationSettings}
        style={{
          margin: "12px 12px 8px",
          padding: "10px 12px",
          minWidth: 0,
          background: "var(--bg-soft)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <span
          data-org-switcher-mark="true"
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 7,
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          星
        </span>
        <div
          data-org-switcher-content="true"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            rowGap: 2,
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-900)",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {orgSettings.name}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--ink-400)",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {switcherMemberText}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--blue-600)",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            已启用 {enabledFeatureCount} 项功能
          </div>
        </div>
        <span
          data-org-switcher-chevron="true"
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon.ChevDown size={14} stroke="var(--ink-400)" />
        </span>
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
          const count = navCounts[it.key] ?? 0;
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
              {count > 0 && (
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
                  {formatBadgeCount(count)}
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
          position: "relative",
          padding: "10px 12px",
          borderTop: "1px solid var(--line)",
        }}
      >
        <details
          style={{ position: "relative" }}
          onClick={(event) => {
            if (event.target?.closest?.("[data-account-menu-close]")) {
              event.currentTarget.removeAttribute("open");
            }
          }}
        >
          <summary
            role="button"
            aria-haspopup="menu"
            aria-label={`${displayUser.name} ${formatCurrentUserMeta(displayUser)} 账号菜单`}
            style={{
              listStyle: "none",
              width: "100%",
              border: "1px solid transparent",
              background: "transparent",
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 6px",
              textAlign: "left",
            }}
          >
            <Avatar name={displayUser.name} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-900)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayUser.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatCurrentUserMeta(displayUser)}
              </div>
            </div>
            <Icon.ChevDown
              size={14}
              stroke="var(--ink-400)"
              style={{
                transition: "transform 120ms ease",
              }}
            />
          </summary>

          <div
            role="menu"
            aria-label="账号菜单"
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 66,
              zIndex: 30,
              padding: 6,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "#fff",
              boxShadow: "0 16px 40px rgba(15,23,42,0.14)",
            }}
          >
            <AccountMenuItem
              icon={<Icon.Streamer size={14} />}
              label="个人资料"
              closeMenu
              onClick={() => {
                setAccountPanel("profile");
              }}
            />
            <AccountMenuItem
              icon={<Icon.Lock size={14} />}
              label="账号安全"
              closeMenu
              onClick={() => {
                setAccountPanel("security");
              }}
            />
            <AccountMenuItem
              icon={<Icon.Settings size={14} />}
              label="组织设置"
              closeMenu
              onClick={() => {
                onOpenOrganizationSettings?.();
              }}
            />
            <div
              style={{
                height: 1,
                background: "var(--line)",
                margin: "6px 4px",
              }}
            />
            <form action="/api/auth/signout" method="post">
              <AccountMenuItem
                icon={<Icon.Logout size={14} stroke="var(--danger-600)" />}
                label="退出登录"
                danger
                submit
              />
            </form>
          </div>
        </details>
      </div>

      {accountPanel ? (
        <AccountPanelDialog
          mode={accountPanel}
          currentUser={displayUser}
          onClose={() => setAccountPanel(null)}
        />
      ) : null}
    </aside>
  );
}

function AccountMenuItem({
  icon,
  label,
  onClick,
  danger = false,
  submit = false,
  closeMenu = false,
}) {
  return (
    <button
      type={submit ? "submit" : "button"}
      role="menuitem"
      data-account-menu-close={closeMenu ? "true" : undefined}
      onClick={onClick}
      style={{
        width: "100%",
        minHeight: 34,
        border: "none",
        borderRadius: 6,
        background: "transparent",
        color: danger ? "var(--danger-600)" : "var(--ink-700)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 9px",
        fontSize: 13,
        fontWeight: 500,
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#FDECEC" : "var(--ink-50)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: danger ? "var(--danger-600)" : "var(--ink-400)",
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function AccountPanelDialog({ mode, currentUser, onClose }) {
  const title = mode === "security" ? "账号安全" : "个人资料";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(15,23,42,0.24)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          borderRadius: 8,
          background: "#fff",
          boxShadow: "0 24px 60px rgba(15,23,42,0.22)",
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={currentUser.name} size={34} />
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                }}
              >
                {title}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
                {currentUser.name}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "#fff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon.X size={14} />
          </button>
        </div>
        <div style={{ padding: 18, display: "grid", gap: 12 }}>
          {mode === "security" ? (
            <>
              <KV label="登录密码">已启用</KV>
              <KV label="双因素认证">待接入账号系统</KV>
              <KV label="登录设备">当前浏览器会话</KV>
            </>
          ) : (
            <>
              <KV label="姓名">{currentUser.name}</KV>
              <KV label="角色">
                {ROLES[currentUser.role] ?? ROLES[DEFAULT_CURRENT_USER.role]}
              </KV>
              <KV label="组织">{currentUser.dept || "未配置组织"}</KV>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TopBar({ breadcrumbs = [], notificationCount = 0, extra }) {
  const hasUnreadNotifications = notificationCount > 0;
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
        aria-label={
          hasUnreadNotifications ? `通知，${notificationCount} 条未读` : "通知"
        }
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
        {hasUnreadNotifications && (
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
            {formatBadgeCount(notificationCount)}
          </span>
        )}
      </button>

      {extra}
    </div>
  );
}

function formatBadgeCount(count) {
  return count > 99 ? "99+" : count;
}

function countActionableTasks(tasks) {
  return tasks.filter((task) => {
    if (task?.anomaly) return true;
    return ["live", "pending_report", "pending_review"].includes(task?.status);
  }).length;
}

function countActionableReports(reports) {
  return reports.filter((report) =>
    ["pending_review", "need_supply"].includes(report?.status),
  ).length;
}

function countUnreadNotifications(notificationItems) {
  return notificationItems.filter((item) => item?.status === "unread").length;
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
  const actions = useOpsLiveActions();
  const [tab, setTab] = React.useState("overview");
  const [ocrOpen, setOcrOpen] = React.useState(false);
  const [warRoomMessage, setWarRoomMessage] = React.useState("");
  const [warRoomExporting, setWarRoomExporting] = React.useState(false);
  const projects = useOpsProjects();
  const tasks = useOpsTasks();
  const reports = useOpsReports();
  const ocrJobs = useOpsOcrJobs();
  const activeProjects = projects.filter((project) =>
    ["active", "recruiting", "settling"].includes(project.status),
  );
  const highRiskProjects = projects.filter(
    (project) => project.risk === "high",
  );
  const totalDoneHours = projects.reduce(
    (sum, project) => sum + (project.metrics?.doneHours ?? 0),
    0,
  );
  const totalReceivable = projects.reduce(
    (sum, project) => sum + (project.metrics?.receivable ?? 0),
    0,
  );
  const totalGross = projects.reduce(
    (sum, project) => sum + (project.metrics?.gross ?? 0),
    0,
  );
  const grossMargin =
    totalReceivable > 0 ? (totalGross / totalReceivable) * 100 : 0;
  const pendingReportCount = countActionableReports(reports);
  const anomalyCount =
    tasks.filter((task) => task?.anomaly).length +
    projects.reduce(
      (sum, project) => sum + (project.metrics?.anomalies ?? 0),
      0,
    );
  const pendingActionCount = pendingReportCount + anomalyCount;
  const exportDailyBrief = async () => {
    if (warRoomExporting) return;
    setWarRoomMessage("");
    setWarRoomExporting(true);
    try {
      const result = await actions.createGovernedExport?.({
        kind: "project_execution",
        rows: activeProjects.map((project) => ({
          projectName: project.name,
          status: project.status,
          operatorName: project.leadOps || project.ownerName || "未分配",
        })),
      });
      setWarRoomMessage(
        result?.filename
          ? `当日简报导出已生成：${result.filename}`
          : "当日简报导出已生成",
      );
    } catch (error) {
      setWarRoomMessage(
        error instanceof Error ? error.message : "当日简报导出失败",
      );
    } finally {
      setWarRoomExporting(false);
    }
  };
  const openOcrPanel = async () => {
    setWarRoomMessage("");
    setOcrOpen(true);
    try {
      await actions.refreshOcrJobs?.();
    } catch (error) {
      setWarRoomMessage(
        error instanceof Error ? error.message : "OCR 作业刷新失败",
      );
    }
  };

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
            <Button kind="default" onClick={openOcrPanel}>
              OCR 作业
            </Button>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportDailyBrief}
              disabled={warRoomExporting}
            >
              {warRoomExporting ? "导出中…" : "导出当日简报"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => setTab("pricing")}
            >
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
              value={String(activeProjects.length)}
              unit="个"
              hint={
                highRiskProjects.length > 0
                  ? `${highRiskProjects.length} 个高风险`
                  : "暂无高风险项目"
              }
            />
          </Card>
          <Card>
            <Metric
              label="本周直播时长"
              value={totalDoneHours.toFixed(1)}
              unit="h"
              hint="按当前项目数据汇总"
            />
          </Card>
          <Card>
            <Metric
              label="本周厂家应收"
              value={`¥${totalReceivable.toLocaleString("zh-CN")}`}
              hint="按当前项目数据汇总"
            />
          </Card>
          <Card>
            <Metric
              label="预估毛利率"
              value={grossMargin.toFixed(1)}
              unit="%"
              hint={totalReceivable > 0 ? "毛利率" : "暂无应收数据"}
            />
          </Card>
          <Card>
            <Metric
              label="待处理事项"
              value={String(pendingActionCount)}
              unit="项"
              hint={
                pendingActionCount > 0
                  ? `审核 ${pendingReportCount} · 异常 ${anomalyCount}`
                  : "暂无待处理事项"
              }
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
        {warRoomMessage ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--ink-500)" }}
          >
            {warRoomMessage}
          </div>
        ) : null}

        {ocrOpen ? (
          <OcrOperationsPanel
            jobs={ocrJobs}
            onRefresh={actions.refreshOcrJobs}
            onRunNext={actions.runNextOcrJob}
            onRetry={actions.retryOcrJob}
            onMarkNeedsReview={actions.markOcrJobNeedsReview}
            onConfirm={actions.confirmOcrJob}
          />
        ) : null}

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
                { key: "matching", label: "主播匹配引擎" },
                { key: "supplier", label: "供应商质量" },
                { key: "pricing", label: "报价 & 测算" },
                { key: "ai", label: "AI Copilot" },
              ]}
            />
          </div>

          <div style={{ padding: 20 }}>
            {tab === "overview" && <Overview go={go} />}
            {tab === "matching" && <Matching go={go} />}
            {tab === "supplier" && <Supplier />}
            {tab === "pricing" && <Pricing />}
            {tab === "ai" && <AICopilot />}
          </div>
        </Card>
      </div>
    </>
  );
}

function OcrOperationsPanel({
  jobs = [],
  onRefresh,
  onRunNext,
  onRetry,
  onMarkNeedsReview,
  onConfirm,
}) {
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [manualResults, setManualResults] = React.useState({});
  const runAction = async (key, action) => {
    if (busy) return;
    setBusy(key);
    setMessage("");
    try {
      await action?.();
      setMessage("OCR 作业已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OCR 作业操作失败");
    } finally {
      setBusy("");
    }
  };
  const updateManualResult = (jobId, field, value) => {
    setManualResults((current) => ({
      ...current,
      [jobId]: {
        ...(current[jobId] ?? {}),
        [field]: value,
      },
    }));
  };
  const manualResultFor = (jobId) => {
    const value = manualResults[jobId] ?? {};
    return {
      duration: Number(value.duration || 0),
      viewers: Number(value.viewers || 0),
    };
  };
  const safeJobs = jobs.map(toSafeOcrJobView);

  return (
    <Card
      title="OCR 作业"
      extra={
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="default"
            onClick={() => runAction("refresh", onRefresh)}
            disabled={Boolean(busy)}
          >
            刷新 OCR 作业
          </Button>
          <Button
            kind="primary"
            onClick={() => runAction("run", () => onRunNext?.())}
            disabled={Boolean(busy)}
          >
            运行下一条 OCR
          </Button>
        </div>
      }
    >
      {message ? (
        <div
          style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 10 }}
        >
          {message}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {OCR_STATUS_FILTERS.map((item) => (
          <Button
            key={item.value}
            kind={statusFilter === item.value ? "primary" : "default"}
            size="sm"
            onClick={() => {
              setStatusFilter(item.value);
              runAction(`filter-${item.value}`, () => onRefresh?.(item.value));
            }}
            disabled={Boolean(busy)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          color: "var(--ink-700)",
        }}
      >
        <thead>
          <tr>
            {[
              "Job",
              "Status",
              "Attempts",
              "Error",
              "Report",
              "Screenshot",
              "OCR Result",
              "Actions",
            ].map((heading) => (
              <th
                key={heading}
                style={{
                  textAlign: "left",
                  padding: "8px 6px",
                  borderBottom: "1px solid var(--line)",
                  color: "var(--ink-400)",
                  fontWeight: 500,
                }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {safeJobs.length ? (
            safeJobs.map((job) => (
              <tr key={job.id}>
                <td style={ocrCellStyle}>
                  {displayRecordId(job.id, "OCR 任务")}
                </td>
                <td style={ocrCellStyle}>
                  <Badge tone={ocrStatusTone(job.status)}>{job.status}</Badge>
                </td>
                <td style={ocrCellStyle}>
                  {job.attempt ?? 0}/{job.maxAttempts ?? 3}
                </td>
                <td style={ocrCellStyle}>
                  <div>{job.errorCode || "无"}</div>
                  {job.errorMessage ? (
                    <div style={{ color: "var(--ink-400)", marginTop: 2 }}>
                      {job.errorMessage}
                    </div>
                  ) : null}
                </td>
                <td style={ocrCellStyle}>
                  {displayRecordId(job.liveReportId, "报数记录")}
                </td>
                <td style={ocrCellStyle}>
                  {displayRecordId(job.screenshotId, "未记录")}
                </td>
                <td style={ocrCellStyle}>
                  <div>
                    时长 {formatOcrResultNumber(job.result.extractedDuration)}
                  </div>
                  <div style={{ color: "var(--ink-400)", marginTop: 2 }}>
                    场观 {formatOcrResultNumber(job.result.extractedViewers)}
                  </div>
                </td>
                <td style={ocrCellStyle}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--ink-400)",
                      }}
                    >
                      时长
                      <input
                        aria-label={`修正时长 ${displayRecordId(job.id, "OCR 任务")}`}
                        type="number"
                        min="0"
                        value={manualResults[job.id]?.duration ?? ""}
                        onChange={(event) =>
                          updateManualResult(
                            job.id,
                            "duration",
                            event.target.value,
                          )
                        }
                        style={ocrNumberInputStyle}
                      />
                    </label>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--ink-400)",
                      }}
                    >
                      人数
                      <input
                        aria-label={`修正观看人数 ${displayRecordId(job.id, "OCR 任务")}`}
                        type="number"
                        min="0"
                        value={manualResults[job.id]?.viewers ?? ""}
                        onChange={(event) =>
                          updateManualResult(
                            job.id,
                            "viewers",
                            event.target.value,
                          )
                        }
                        style={ocrNumberInputStyle}
                      />
                    </label>
                    <Button
                      kind="default"
                      onClick={() =>
                        runAction(`retry-${job.id}`, () => onRetry?.(job.id))
                      }
                      disabled={Boolean(busy)}
                    >
                      手动重试
                    </Button>
                    <Button
                      kind="default"
                      onClick={() =>
                        runAction(`review-${job.id}`, () =>
                          onMarkNeedsReview?.(job.id),
                        )
                      }
                      disabled={Boolean(busy)}
                    >
                      标记需复核
                    </Button>
                    <Button
                      kind="default"
                      onClick={() =>
                        runAction(`confirm-${job.id}`, () =>
                          onConfirm?.(job.id, manualResultFor(job.id)),
                        )
                      }
                      disabled={Boolean(busy)}
                    >
                      人工确认
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={8}
                style={{ ...ocrCellStyle, color: "var(--ink-400)" }}
              >
                暂无 OCR 作业
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function toSafeOcrJobView(job) {
  const result =
    job?.result && typeof job.result === "object" ? job.result : {};
  return {
    id: job?.id,
    status: job?.status,
    attempt: job?.attempt,
    maxAttempts: job?.maxAttempts,
    liveReportId: job?.liveReportId,
    screenshotId: job?.screenshotId,
    errorCode: job?.errorCode,
    errorMessage: job?.errorMessage,
    result: {
      extractedDuration: result.extractedDuration,
      extractedViewers: result.extractedViewers,
    },
  };
}

function formatOcrResultNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "未识别";
}

const ocrCellStyle = {
  padding: "9px 6px",
  borderBottom: "1px solid var(--line)",
  verticalAlign: "top",
};

const ocrNumberInputStyle = {
  width: 64,
  height: 26,
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
  padding: "0 6px",
  fontSize: 12,
  color: "var(--ink-700)",
};

const OCR_STATUS_FILTERS = [
  { value: "all", label: "全部" },
  { value: "failed", label: "失败" },
  { value: "needs_review", label: "需复核" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "处理中" },
  { value: "succeeded", label: "成功" },
];

function ocrStatusTone(status) {
  return (
    {
      queued: "blue",
      pending: "blue",
      running: "violet",
      processing: "violet",
      succeeded: "green",
      failed: "red",
      needs_confirmation: "amber",
      needs_review: "amber",
      cancelled: "neutral",
    }[status] ?? "neutral"
  );
}

// ——— Overview tab ————————————————————————
function Overview({ go }) {
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const [reviewResult, setReviewResult] = React.useState(null);
  const [reviewBusy, setReviewBusy] = React.useState(false);
  const [reviewError, setReviewError] = React.useState("");

  const runProjectReview = async () => {
    if (reviewBusy) return;

    setReviewBusy(true);
    setReviewError("");
    try {
      const reviewInput = buildWarRoomReviewInput(projects, streamers);
      if (!reviewInput) {
        setReviewError("暂无可评估的项目数据。");
        return;
      }
      const body = await postWarRoomJson(
        "/api/war-room/project-review",
        reviewInput,
        "project review failed",
      );
      setReviewResult(toProjectReviewDto(body.report));
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "project review failed",
      );
    } finally {
      setReviewBusy(false);
    }
  };

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
                          {displayRecordId(r.id, "项目")} · {r.vendor}
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
              rows={projects.filter((p) =>
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
              <EmptyHint
                title="暂无经营简报"
                hint="接入真实项目复盘结果后会展示可执行建议。"
              />
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  kind="default"
                  onClick={runProjectReview}
                  disabled={reviewBusy}
                >
                  {reviewBusy ? "生成中…" : "查看完整复盘"}
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  icon={<Icon.History size={13} />}
                >
                  历史简报
                </Button>
              </div>
              {reviewError ? (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: "var(--danger-600)",
                  }}
                >
                  {reviewError}
                </div>
              ) : null}
              {reviewResult ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    background: "#fff",
                    border: "1px solid #D8D0FA",
                    fontSize: 12.5,
                    color: "var(--ink-700)",
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "var(--violet-600)" }}>
                    复盘结论：{reviewResult.conclusionLabel}
                  </div>
                  <div>
                    下轮建议报价{" "}
                    <span className="num">
                      {reviewResult.nextSuggestedQuoteLabel}
                    </span>
                    ，毛利率{" "}
                    <span className="num">{reviewResult.marginRateLabel}</span>
                  </div>
                  <div>
                    最佳主播 {reviewResult.bestStreamerLabel} · 待替换{" "}
                    {reviewResult.worstStreamerLabel}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      {/* Right: anomalies + audit feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <SectionTitle
            extra={
              <Button size="sm" kind="link" onClick={() => go("tasks")}>
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
                  <Button size="sm" kind="default" onClick={() => go("tasks")}>
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
function Matching({ go }) {
  const streamers = useOpsStreamers();
  const projects = useOpsProjects();
  const actions = useOpsLiveActions();
  const [matchRows, setMatchRows] = React.useState(null);
  const [supplierRows, setSupplierRows] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [inviteBusyId, setInviteBusyId] = React.useState("");
  const [error, setError] = React.useState("");
  const [actionMessage, setActionMessage] = React.useState("");
  const rows = matchRows ?? DEFAULT_MATCHING_ROWS;

  const runMatching = async () => {
    if (busy) return;

    setBusy(true);
    setError("");
    setActionMessage("");
    try {
      const body = await postWarRoomJson(
        "/api/war-room/matching",
        buildWarRoomMatchingInput(streamers),
        "matching failed",
      );
      setMatchRows(toStreamerMatchDtos(body.matches ?? []));
      setSupplierRows(toSupplierQualityDtos(body.suppliers ?? []));
    } catch (error) {
      setError(error instanceof Error ? error.message : "matching failed");
    } finally {
      setBusy(false);
    }
  };
  const inviteMatch = async (row) => {
    const projectId = projects[0]?.id;
    if (!projectId) {
      setActionMessage("请先创建或选择项目后再发起邀约。");
      return;
    }

    setInviteBusyId(row.id);
    setError("");
    setActionMessage("");
    try {
      await actions.inviteStreamerToProject?.(projectId, row.id);
      setActionMessage("已发起邀约");
    } catch (error) {
      setActionMessage(error?.message || "邀约失败，请稍后重试。");
    } finally {
      setInviteBusyId("");
    }
  };

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
            为当前项目推荐主播
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
            基于品类匹配、历史完成率、录屏通过率、ROI、风险扣分综合评分
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="default"
            icon={<Icon.Filter size={14} />}
            onClick={() => setActionMessage("匹配筛选后台暂未接入。")}
          >
            筛选
          </Button>
          <Button
            kind="primary"
            icon={<Icon.Export size={14} stroke="#fff" />}
            onClick={runMatching}
            disabled={busy}
          >
            {busy ? "匹配中…" : "导出厂家候选包"}
          </Button>
        </div>
      </div>
      {error ? (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "var(--danger-600)",
          }}
        >
          {error}
        </div>
      ) : null}
      {actionMessage ? (
        <div
          aria-live="polite"
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "var(--ink-500)",
          }}
        >
          {actionMessage}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        {rows.map((r) => {
          const s = STREAMERS.find((s) => s.id === r.id);
          const source = s?.source ?? "API 推荐";
          const games = s?.games ?? ["接口结果"];
          const platforms = s?.platforms ?? ["API"];
          const style = s?.style ?? "综合评分";
          const defaultRule =
            r.suggestedSettlementMethodLabel ?? s?.defaultRule ?? "CPT";
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
                      {displayRecordId(s?.id ?? r.id, "主播档案")}
                    </span>
                    <span style={{ flex: 1 }} />
                    <Badge
                      tone={
                        source === "签约"
                          ? "blue"
                          : source === "自孵化"
                            ? "teal"
                            : "neutral"
                      }
                    >
                      {source}
                    </Badge>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-400)",
                      marginTop: 2,
                    }}
                  >
                    {games.join(" / ")} · {platforms.join(" ")} · {style}
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
                <Badge tone="blue">{defaultRule}</Badge>
                <span style={{ flex: 1 }} />
                <Button
                  size="sm"
                  kind="ghost"
                  onClick={() => go("streamers", r.id)}
                >
                  查看画像
                </Button>
                <Button
                  size="sm"
                  kind="primary"
                  onClick={() => inviteMatch(r)}
                  disabled={inviteBusyId === r.id}
                >
                  {inviteBusyId === r.id ? "邀约中" : "发起邀约"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {supplierRows?.length ? (
        <div style={{ marginTop: 16 }}>
          <SectionTitle hint="来自本次匹配 API">供应商同步评分</SectionTitle>
          <Card padded={false}>
            <DataTable
              columns={[
                {
                  title: "供应商",
                  render: (r) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <Avatar name={r.name} size={30} />
                      <div>
                        <div
                          style={{ fontWeight: 600, color: "var(--ink-900)" }}
                        >
                          {r.name}
                        </div>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                        >
                          {displayRecordId(r.id, "供应商")}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "评分",
                  render: (r) => (
                    <span className="num" style={{ fontWeight: 700 }}>
                      {r.score}
                    </span>
                  ),
                },
                {
                  title: "等级",
                  render: (r) => <Badge tone="green">{r.grade}</Badge>,
                },
                {
                  title: "原因",
                  wrap: true,
                  render: (r) => r.reasons.join(" / ") || "—",
                },
              ]}
              rows={supplierRows}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function AICopilot() {
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const [busyKey, setBusyKey] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [results, setResults] = React.useState({});

  const runAiAction = async (key, url, payload, formatter, fallbackMessage) => {
    if (busyKey) return;
    setBusyKey(key);
    setMessage("");
    try {
      const body = await postWarRoomJson(url, payload, fallbackMessage);
      setResults((current) => ({ ...current, [key]: formatter(body) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setBusyKey("");
    }
  };

  const matchingInput = React.useMemo(
    () => buildWarRoomMatchingInput(streamers),
    [streamers],
  );
  const reviewInput = React.useMemo(
    () => buildWarRoomReviewInput(projects, streamers),
    [projects, streamers],
  );
  const scriptInput = React.useMemo(
    () => buildAiScriptOptimizationInput(projects, streamers),
    [projects, streamers],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <AiActionPanel
          title="候选简报"
          hint="基于匹配快照生成可邀约候选解释"
          buttonLabel={busyKey === "brief" ? "生成中" : "生成 AI Brief"}
          disabled={Boolean(busyKey)}
          onClick={() =>
            runAiAction(
              "brief",
              "/api/ai/briefs",
              {
                kind: "casting",
                project: matchingInput.project,
                candidates: matchingInput.candidates,
                maxRecommendations: 3,
              },
              formatAiBriefResult,
              "AI brief failed",
            )
          }
        />
        <AiActionPanel
          title="项目复盘"
          hint="读取经营复盘代理输出"
          buttonLabel={busyKey === "review" ? "复盘中" : "AI 项目复盘"}
          disabled={Boolean(busyKey)}
          onClick={() =>
            runAiAction(
              "review",
              "/api/ai/project-reviews",
              reviewInput,
              formatAiProjectReviewResult,
              "AI project review failed",
            )
          }
        />
        <AiActionPanel
          title="Copilot 路由"
          hint="通过 M10 Copilot 统一调度脚本优化"
          buttonLabel={busyKey === "copilot" ? "运行中" : "运行 Copilot"}
          disabled={Boolean(busyKey)}
          onClick={() =>
            runAiAction(
              "copilot",
              "/api/ai/copilot",
              {
                intent: "script_optimization",
                payload: scriptInput,
              },
              formatAiCopilotResult,
              "AI copilot failed",
            )
          }
        />
        <AiActionPanel
          title="脚本草稿"
          hint="生成待人工复核的话术版本"
          buttonLabel={busyKey === "script" ? "生成中" : "生成脚本草稿"}
          disabled={Boolean(busyKey)}
          onClick={() =>
            runAiAction(
              "script",
              "/api/ai/scripts",
              scriptInput,
              formatAiScriptResult,
              "AI script draft failed",
            )
          }
        />
      </div>

      {message ? (
        <div
          aria-live="polite"
          style={{ fontSize: 12, color: "var(--danger-600)" }}
        >
          {message}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {[
          ["brief", "AI Brief"],
          ["review", "AI 项目复盘"],
          ["copilot", "Copilot 摘要"],
          ["script", "脚本草稿"],
        ].map(([key, title]) => (
          <div
            key={key}
            style={{
              minHeight: 86,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink-900)",
              }}
            >
              <Icon.Sparkles size={14} stroke="var(--violet-600)" />
              {title}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12.5,
                color: results[key] ? "var(--ink-700)" : "var(--ink-400)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {results[key] || "等待生成"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiActionPanel({ title, hint, buttonLabel, disabled, onClick }) {
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-900)" }}>
          {title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--ink-500)",
            lineHeight: 1.5,
          }}
        >
          {hint}
        </div>
      </div>
      <Button kind="primary" onClick={onClick} disabled={disabled}>
        {buttonLabel}
      </Button>
    </div>
  );
}

function buildAiScriptOptimizationInput(
  projects = PROJECTS,
  streamers = STREAMERS,
) {
  const project = projects[0] ?? WAR_ROOM_FALLBACK_PROJECT;
  const streamer = streamers[0] ?? WAR_ROOM_FALLBACK_STREAMERS[0];

  return {
    scriptKey: "opening-hook",
    version: 1,
    currentScript: `${project.name} 开场钩子：先说明福利，再引导观众提问。`,
    diagnosisType: "content_rhythm",
    feedback: ["强化前三十秒的互动提问。"],
    replayNotes: ["复盘最近一场直播，保留高转化话术。"],
    streamerId: streamer?.id,
    projectId: project?.id,
  };
}

function formatAiBriefResult(body) {
  const advice = body.candidateAdvice?.[0];
  if (advice) {
    return `${advice.streamerName} · ${advice.recommendation}`;
  }
  const tradeoff = body.tradeoffAdvice;
  if (tradeoff) {
    return `${tradeoff.decision || "pricing"} · ${tradeoff.summary || ""}`;
  }
  return "AI Brief 已生成";
}

function formatAiProjectReviewResult(body) {
  const report = body.report ?? {};
  const quote = report.nextSuggestedQuoteCents
    ? ` · 下轮报价 ${(report.nextSuggestedQuoteCents / 100).toLocaleString("zh-CN")} 元`
    : "";
  return `${report.projectName || report.projectId || "项目复盘"} · ${
    report.shouldContinue ? "建议继续" : "需要复核"
  }${quote}`;
}

function formatAiCopilotResult(body) {
  const summary = body.copilotSummary ?? {};
  return [summary.title, summary.status, summary.nextStep]
    .filter(Boolean)
    .join(" · ");
}

function formatAiScriptResult(body) {
  const draft = body.scriptVersionDraft ?? {};
  return draft.content || `${draft.scriptKey || "脚本"} v${draft.version || 1}`;
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
                      {displayRecordId(r.id, "供应商")} · 推荐主播 {r.streamers}
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
  const [pricingResult, setPricingResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [draftMessage, setDraftMessage] = React.useState("");

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

  const runPricing = async () => {
    if (busy) return;

    setBusy(true);
    setError("");
    setDraftMessage("");
    try {
      const body = await postWarRoomJson(
        "/api/war-room/pricing",
        buildWarRoomPricingInput({
          model,
          streamers,
          hours,
          hourly,
          conversion,
          cpsRate,
          vendorRevenue,
          supplierCost,
        }),
        "pricing failed",
      );
      setPricingResult(toPricingResultDto(body.pricing));
    } catch (error) {
      setError(error instanceof Error ? error.message : "pricing failed");
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = () => {
    setError("");
    setDraftMessage("报价草稿后台暂未接入，当前测算参数已保留在本页。");
  };

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
            value={pricingResult?.expectedReceivableLabel ?? fmt(vendorRevenue)}
            tone="blue"
            emphasize
          />
          <ResultCell
            label="预计毛利"
            value={pricingResult?.grossMarginLabel ?? fmt(gross)}
            tone={gross > 0 ? "green" : "red"}
            emphasize
          />
          <ResultCell
            label="主播应付"
            value={pricingResult?.streamerPayableLabel ?? fmt(streamerCost)}
          />
          <ResultCell
            label="供应商成本"
            value={pricingResult?.supplierCostLabel ?? fmt(supplierCost)}
          />
          <ResultCell
            label="平台扣点"
            value={pricingResult?.platformFeeLabel ?? fmt(platform)}
          />
          <ResultCell
            label="毛利率"
            value={pricingResult?.marginRateLabel ?? `${marginPct}%`}
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
            {pricingResult ? (
              <>
                API 测算完成，<b>建议最低报价</b>{" "}
                <span className="num">
                  {pricingResult.suggestedMinimumQuoteLabel}
                </span>
                ，盈亏平衡报价{" "}
                <span className="num">{pricingResult.breakEvenQuoteLabel}</span>
                ，建议结算方式 {pricingResult.recommendedSettlementMethodLabel}
                。
                {pricingResult.riskNotes.length ? (
                  <div style={{ marginTop: 6 }}>
                    {pricingResult.riskNotes.map((note) => (
                      <Badge key={note} tone="amber" style={{ marginRight: 6 }}>
                        {note}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                按当前输入，<b>盈亏平衡点</b>约为单主播{" "}
                <span className="num">
                  {Math.ceil(streamerCost / streamers / hourly)}
                </span>{" "}
                h / 月。 如希望毛利率 ≥ 30%，建议将 CPT 单价降至{" "}
                <span className="num">¥{Math.round(hourly * 0.93)}</span>， 或将
                CPS 分成提高至{" "}
                <span className="num">{Math.min(30, cpsRate + 2)}%</span>。
                历史同类项目平均毛利率 <b className="num">31.6%</b>。
              </>
            )}
          </div>
        </div>
        {error ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--danger-600)",
            }}
          >
            {error}
          </div>
        ) : null}
        {draftMessage ? (
          <div
            aria-live="polite"
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            {draftMessage}
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Button kind="default" onClick={saveDraft}>
            保存为草稿
          </Button>
          <Button kind="primary" onClick={runPricing} disabled={busy}>
            {busy ? "测算中…" : "生成立项申请"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

async function postWarRoomJson(url, body, fallbackMessage) {
  const response = await globalThis.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

async function getOpsJson(url, fallbackMessage) {
  const response = await globalThis.fetch(url, { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }
  return payload;
}

function buildWarRoomPricingInput({
  model,
  streamers,
  hours,
  hourly,
  conversion,
  cpsRate,
  vendorRevenue,
  supplierCost,
}) {
  const fixedBudgetModels = new Set(["cpt-cps", "cpa", "gift"]);
  return {
    vendorSettlementMethod: fixedBudgetModels.has(model)
      ? "fixed_budget"
      : "cpt",
    streamerCount: streamers,
    estimatedMinutesPerStreamer: hours * 60,
    vendorBudgetCents: vendorRevenue * 100,
    vendorHourlyRateCents: Math.round(hourly * 130),
    streamerHourlyCostCents: hourly * 100,
    supplierCostCents: supplierCost * 100,
    expectedManualRevenueCents: conversion * cpsRate,
    platformFeeBps: 500,
    manualAdjustmentCents: 0,
    targetMarginBps: 3000,
  };
}

function buildWarRoomMatchingInput(streamers = STREAMERS) {
  const streamerRows = streamers.length
    ? streamers
    : WAR_ROOM_FALLBACK_STREAMERS;
  const supplierRows = SUPPLIER_SCORES.length
    ? SUPPLIER_SCORES
    : WAR_ROOM_FALLBACK_SUPPLIERS;

  return {
    project: {
      category: "moba",
      platform: "douyin",
      preferredStyles: ["高互动", "欢快互动", "高能竞技"],
      requiredMinutes: 900,
    },
    candidates: streamerRows.map((streamer) => ({
      id: streamer.id ?? "streamer-war-room-fallback",
      name: streamer.alias ?? streamer.name ?? "主播待配置",
      categories: (streamer.games ?? ["moba"]).map(toWarRoomCategory),
      platforms: (streamer.platforms ?? ["抖音"]).map(toWarRoomPlatform),
      styles: [streamer.style ?? "高互动"],
      completionRateBps: (streamer.metrics?.projectFinish ?? 80) * 100,
      screeningPassRateBps: (streamer.metrics?.screenPass ?? 80) * 100,
      roiBps: Math.round((streamer.metrics?.roi ?? 1) * 10000),
      grossMarginContributionCents: (streamer.metrics?.grossContrib ?? 0) * 100,
      riskTags:
        streamer.risk === "low"
          ? []
          : streamer.risk === "medium"
            ? ["recent_anomaly"]
            : ["dispute"],
      availableMinutes: Math.max(300, (streamer.completedProjects ?? 1) * 120),
      referenceProjects: [
        {
          id: `${streamer.id}-ref`,
          name: `${streamer.alias ?? streamer.name ?? "主播待配置"} 历史项目`,
          result: `完成率 ${streamer.metrics?.projectFinish ?? 80}%`,
        },
      ],
    })),
    suppliers: supplierRows.map((supplier) => ({
      id: supplier.id ?? "supplier-war-room-fallback",
      name: supplier.name ?? "未命名供应商",
      screeningPassRateBps: Math.min(10000, (supplier.finishRate ?? 80) * 100),
      completionRateBps: Math.min(10000, (supplier.finishRate ?? 80) * 100),
      marginContributionCents: (supplier.grossContrib ?? 0) * 100,
      anomalyRateBps: (supplier.anomalyRate ?? 0) * 100,
      blacklistRateBps: 0,
      isBlacklisted: supplier.score < 60,
    })),
  };
}

function buildWarRoomReviewInput(projects = PROJECTS, streamers = STREAMERS) {
  const project = projects[0] ?? WAR_ROOM_FALLBACK_PROJECT;
  const streamerRows = streamers.length
    ? streamers
    : WAR_ROOM_FALLBACK_STREAMERS;

  return {
    project: {
      id: project.id,
      name: project.name,
      category: "moba",
      platform: "douyin",
      periodStart: project.start,
      periodEnd: project.end,
    },
    finance: {
      receivableCents: (project.metrics?.receivable ?? 12000) * 100,
      payableCents: (project.metrics?.payable ?? 6000) * 100,
      supplierCostCents: 100000,
      adjustmentCents: 0,
      manualRevenueCents: 0,
    },
    streamers: streamerRows.slice(0, 4).map((streamer, index) => ({
      id: streamer.id ?? `streamer-war-room-${index}`,
      name: streamer.alias ?? streamer.name ?? "主播待配置",
      durationMinutes: 600 + index * 120,
      totalViews: 40000 + index * 12000,
      completionRateBps: (streamer.metrics?.projectFinish ?? 80) * 100,
      roiBps: Math.round((streamer.metrics?.roi ?? 1) * 10000),
      grossMarginContributionCents: (streamer.metrics?.grossContrib ?? 0) * 100,
      anomalyCount: streamer.risk === "low" ? 0 : 1,
      disputeCount: streamer.risk === "high" ? 1 : 0,
    })),
    suppliers: buildWarRoomMatchingInput(streamers).suppliers,
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}

function buildAutoReviewReportSnapshot(report) {
  const settlementDuration =
    report.systemDuration ??
    report.plannedDuration ??
    report.settlementDuration ??
    Math.round((report.duration ?? 0) * 60);

  return {
    id: report.id,
    taskId: report.taskId,
    status: report.status,
    evidenceLevel: report.evidenceLevel || evidenceLevelFromReport(report),
    timeSource: report.timeSource || "manual",
    settlementDuration,
    screenshotCount: report.screens ?? report.screenshotCount ?? 0,
    viewers: report.audience ?? report.viewers ?? 0,
  };
}

function evidenceLevelFromReport(report) {
  const text = `${report.note ?? ""} ${report.source ?? ""}`.toLowerCase();
  if (text.includes("green")) return "green";
  if (text.includes("yellow")) return "yellow";
  if (text.includes("red")) return "red";
  return "unknown";
}

function buildAutoReviewRuleSnapshot() {
  return {
    mode: "shadow",
    requireSystemTiming: true,
    minimumEvidenceLevel: "green",
    maximumDurationDeltaRateBps: 1000,
  };
}

function toWarRoomCategory(game) {
  if (game.includes("moba") || game.includes("party")) return "moba";
  if (game.includes("rpg") || game.includes("story")) return "rpg";
  if (game.includes("action")) return "action";
  return "other";
}

function toWarRoomPlatform(platform) {
  if (platform.includes("抖音")) return "douyin";
  if (platform.includes("快手")) return "kuaishou";
  if (platform.includes("B站")) return "bilibili";
  return platform.toLowerCase();
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
  const projects = useOpsProjects();
  const actions = useOpsLiveActions();
  const [status, setStatus] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [vendorFilter, setVendorFilter] = React.useState("all");
  const [ownerFilter, setOwnerFilter] = React.useState("all");
  const [scheduleFilter, setScheduleFilter] = React.useState("all");
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [draftCode, setDraftCode] = React.useState("");
  const [draftError, setDraftError] = React.useState("");
  const [draftSubmitting, setDraftSubmitting] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState("");
  const [exportSubmitting, setExportSubmitting] = React.useState(false);
  const draftInputStyle = {
    width: "100%",
    height: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink-700)",
    fontSize: 13,
    outline: "none",
    padding: "0 10px",
  };
  const openDraftForm = () => {
    setDraftOpen(true);
    setDraftError("");
    setDraftName((value) => value || "新项目草稿");
    setDraftCode((value) => value || `P-${Date.now()}`);
  };
  const closeDraftForm = () => {
    setDraftOpen(false);
    setDraftError("");
  };
  const submitProjectDraft = async (event) => {
    event.preventDefault();
    const name = draftName.trim();
    const code = draftCode.trim();
    if (!name || !code) {
      setDraftError("请填写项目名称和项目编号");
      return;
    }
    setDraftSubmitting(true);
    setDraftError("");
    try {
      await actions.createProjectDraft?.({ name, code });
      setDraftOpen(false);
      setDraftName("");
      setDraftCode("");
    } catch (error) {
      setDraftError(error?.message || "创建项目失败，请稍后重试");
    } finally {
      setDraftSubmitting(false);
    }
  };
  const exportProjectList = async () => {
    setExportSubmitting(true);
    setExportMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "project_execution",
        rows: filtered.map((project) => ({
          projectName: project.name,
          status: project.status,
          operatorName: project.leadOps,
        })),
      });
      setExportMessage("项目表导出已生成");
    } catch (error) {
      setExportMessage(error?.message || "项目表导出失败，请稍后重试");
    } finally {
      setExportSubmitting(false);
    }
  };
  const counts = {
    all: projects.length,
    active: projects.filter((p) => p.status === "active").length,
    recruiting: projects.filter((p) => p.status === "recruiting").length,
    settling: projects.filter((p) => p.status === "settling").length,
    paused: projects.filter((p) => p.status === "paused").length,
    ended: projects.filter((p) => p.status === "ended").length,
  };
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = projects.filter((p) => {
    const matchesStatus = status === "all" || p.status === status;
    const matchesSearch =
      !normalizedQuery ||
      [p.name, p.code, p.id, p.vendor, p.product, p.leadOps, p.bizOwner]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    const matchesVendor = vendorFilter === "all" || p.vendor === vendorFilter;
    const matchesOwner = ownerFilter === "all" || p.leadOps === ownerFilter;
    const matchesSchedule =
      scheduleFilter === "all" ||
      (scheduleFilter === "scheduled" && hasProjectSchedule(p)) ||
      (scheduleFilter === "unscheduled" && !hasProjectSchedule(p));
    return (
      matchesStatus &&
      matchesSearch &&
      matchesVendor &&
      matchesOwner &&
      matchesSchedule
    );
  });

  return (
    <>
      <PageHeader
        title="项目管理"
        subtitle="厂商 → 产品 → 项目；同时管理报名、录屏、排班、报数与结算"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportProjectList}
              disabled={exportSubmitting}
            >
              {exportSubmitting ? "导出中" : "导出项目表"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={openDraftForm}
            >
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
            <SearchInput
              placeholder="项目名 / 编号 / 厂商"
              value={query}
              onChange={setQuery}
              width={260}
            />
            <ProjectInlineFilter
              label="厂商筛选"
              value={vendorFilter}
              onChange={setVendorFilter}
              options={uniqueProjectOptions(projects, "vendor")}
            />
            <ProjectInlineFilter
              label="负责人筛选"
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={uniqueProjectOptions(projects, "leadOps")}
            />
            <ProjectInlineFilter
              label="时间范围筛选"
              value={scheduleFilter}
              onChange={setScheduleFilter}
              options={[
                { value: "scheduled", label: "已配置周期" },
                { value: "unscheduled", label: "未配置周期" },
              ]}
            />
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink-400)" }}>
              共{" "}
              <b className="num" style={{ color: "var(--ink-700)" }}>
                {filtered.length}
              </b>{" "}
              个项目
            </span>
          </div>
          {exportMessage ? (
            <div
              aria-live="polite"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                color: exportMessage.includes("失败")
                  ? "var(--danger-600)"
                  : "var(--green-700)",
                fontSize: 12,
              }}
            >
              {exportMessage}
            </div>
          ) : null}

          {draftOpen ? (
            <form
              onSubmit={submitProjectDraft}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(180px, 1.2fr) minmax(160px, 0.8fr) auto",
                alignItems: "end",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--bg-soft)",
              }}
            >
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--ink-500)",
                  fontWeight: 600,
                }}
              >
                项目名称
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="例如：品牌直播专项"
                  style={draftInputStyle}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--ink-500)",
                  fontWeight: 600,
                }}
              >
                项目编号
                <input
                  value={draftCode}
                  onChange={(event) => setDraftCode(event.target.value)}
                  placeholder="例如：项目编号"
                  style={draftInputStyle}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <Button
                  kind="default"
                  type="button"
                  onClick={closeDraftForm}
                  disabled={draftSubmitting}
                >
                  取消
                </Button>
                <Button
                  kind="primary"
                  type="submit"
                  disabled={draftSubmitting}
                  icon={<Icon.Plus size={14} stroke="#fff" />}
                >
                  {draftSubmitting ? "创建中" : "创建草稿"}
                </Button>
              </div>
              {draftError ? (
                <div
                  aria-live="polite"
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--danger-600)",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {draftError}
                </div>
              ) : null}
            </form>
          ) : null}

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
                        {r.code || "未设置编号"}
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

function uniqueProjectOptions(projects, key) {
  return Array.from(
    new Set(projects.map((project) => project[key]).filter(Boolean)),
  ).map((value) => ({ value, label: value }));
}

function hasProjectSchedule(project) {
  return Boolean(project?.start && project?.end);
}

function ProjectInlineFilter({ label, value, onChange, options }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      style={{
        height: 32,
        minWidth: 116,
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        background: "#fff",
        color: "var(--ink-700)",
        fontSize: 13,
        outline: "none",
        padding: "0 28px 0 10px",
      }}
    >
      <option value="all">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function warnBackgroundRefreshFailure(scope, error) {
  globalThis.console?.warn?.(`${scope} background refresh failed`, error);
}

// ——— Project detail ———————————————————————

function ProjectDetail({ id, go }) {
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const applications = useOpsApplications();
  const tasks = useOpsTasks();
  const actions = useOpsLiveActions();
  const members = useOpsOrganizationMembers();
  const currentUser = useOpsCurrentUser();
  const {
    organizationMembers,
    streamers: streamerData,
    applications: applicationData,
  } = React.useContext(OpsLiveDataContext);
  const p = projects.find((x) => x.id === id) || projects[0] || PROJECTS[0];
  const [tab, setTab] = React.useState("overview");
  const [detailMessage, setDetailMessage] = React.useState("");
  const [detailSubmitting, setDetailSubmitting] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsDraft, setSettingsDraft] = React.useState(() =>
    projectSettingsInitialDraft(p),
  );
  const [settingsError, setSettingsError] = React.useState("");
  const [settingsSubmitting, setSettingsSubmitting] = React.useState(false);

  React.useEffect(() => {
    setSettingsDraft(projectSettingsInitialDraft(p));
    setSettingsOpen(false);
    setSettingsError("");
  }, [p]);

  React.useEffect(() => {
    if (
      settingsOpen &&
      !Array.isArray(organizationMembers) &&
      actions.refreshOrganizationMembers
    ) {
      actions
        .refreshOrganizationMembers()
        .catch((error) =>
          warnBackgroundRefreshFailure("project detail", error),
        );
    }
  }, [actions, organizationMembers, settingsOpen]);

  React.useEffect(() => {
    if (streamerData == null && actions.refreshStreamers) {
      actions
        .refreshStreamers()
        .catch((error) =>
          warnBackgroundRefreshFailure("project detail", error),
        );
    }
  }, [actions, streamerData]);

  React.useEffect(() => {
    if (applicationData == null && actions.refreshApplications) {
      actions
        .refreshApplications()
        .catch((error) =>
          warnBackgroundRefreshFailure("project detail", error),
        );
    }
  }, [actions, applicationData]);

  if (!p) {
    return (
      <>
        <PageHeader
          title="项目详情"
          subtitle="暂无可展示的项目数据"
          actions={
            <Button
              kind="ghost"
              icon={<Icon.ChevLeft size={14} />}
              onClick={() => go("projects")}
            >
              返回列表
            </Button>
          }
        />
        <div style={{ padding: 20 }}>
          <EmptyHint
            title="暂无项目数据"
            hint="请先创建项目或接入后端项目数据。"
            actionLabel="返回项目列表"
            onAction={() => go("projects")}
          />
        </div>
      </>
    );
  }

  const status = PROJECT_STATUS[p.status] || PROJECT_STATUS.draft;
  const canAssignOwner = canAssignProjectOwnerInUi(currentUser.role);
  const ownerOptions = projectOwnerOptions(members, p, currentUser);
  const donePct =
    Math.round((p.metrics.doneHours / p.metrics.plannedHours) * 100) || 0;
  const projectApplicationRoster = mergeRosterRows(
    projectApplicationRosterRows(p, applications, streamers),
  );
  const projectRosterCount = Math.max(
    (p.streamers?.active ?? 0) + (p.streamers?.candidate ?? 0),
    projectApplicationRoster.length,
  );
  const projectTasks = tasks.filter((task) => taskBelongsToProject(task, p));
  const exportVendorDelivery = async () => {
    setDetailSubmitting("delivery");
    setDetailMessage("");
    try {
      const packageRows = await actions.readVendorDeliveryPackage?.(p.id);
      const result = await actions.createGovernedExport?.({
        kind: "vendor_delivery",
        rows: Array.isArray(packageRows) ? packageRows : [],
      });
      setDetailMessage(
        result?.filename
          ? `厂家交付包已生成：${result.filename}`
          : "厂家交付包已生成",
      );
    } catch (error) {
      setDetailMessage(error?.message || "厂家交付包导出失败，请稍后重试");
    } finally {
      setDetailSubmitting("");
    }
  };
  const openProjectSettings = () => {
    setSettingsDraft(projectSettingsInitialDraft(p));
    setSettingsError("");
    setDetailMessage("");
    setSettingsOpen(true);
  };
  const handleSettingsChange = (field, value) => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };
  const handleProjectSettingsSubmit = async (event) => {
    event.preventDefault();
    const name = settingsDraft.name.trim();
    if (!name) {
      setSettingsError("项目名称不能为空");
      return;
    }
    if (
      settingsDraft.startsAt &&
      settingsDraft.endsAt &&
      settingsDraft.endsAt < settingsDraft.startsAt
    ) {
      setSettingsError("结束日期不能早于开始日期");
      return;
    }
    setSettingsSubmitting(true);
    setSettingsError("");
    setDetailMessage("");
    try {
      if (!actions.updateProjectBasics) {
        throw new Error("项目设置接口不可用");
      }
      const shouldPublishFromSettings = isProjectPublishFromSettings(
        p.status,
        settingsDraft.status,
      );
      await actions.updateProjectBasics(p.id, {
        name,
        vendorName: settingsDraft.vendorName.trim(),
        productName: settingsDraft.productName.trim(),
        agentName: settingsDraft.agentName.trim(),
        supplierName: settingsDraft.supplierName.trim(),
        description: settingsDraft.description.trim(),
        ...(canAssignOwner ? { ownerId: settingsDraft.ownerId || null } : {}),
        status: shouldPublishFromSettings ? undefined : settingsDraft.status,
        startsAt: settingsDraft.startsAt || null,
        endsAt: settingsDraft.endsAt || null,
        openSignup: settingsDraft.openSignup,
        allowDirectInvite: settingsDraft.allowDirectInvite,
        forceRecording: settingsDraft.forceRecording,
        forceSystemTiming: settingsDraft.forceSystemTiming,
        isPublicToStreamers: settingsDraft.isPublicToStreamers,
        publicSummary: settingsDraft.publicSummary.trim(),
        gameDownloadUrl: settingsDraft.gameDownloadUrl.trim(),
      });
      if (shouldPublishFromSettings) {
        if (!actions.publishProject) {
          throw new Error("项目发布接口不可用");
        }
        await actions.publishProject(p.id);
      }
      setDetailMessage(
        shouldPublishFromSettings
          ? "项目设置已更新，已发布招募"
          : "项目设置已更新",
      );
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(error?.message || "项目设置更新失败，请稍后重试");
    } finally {
      setSettingsSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span>
            <span className="mono">{displayProjectCode(p)}</span> · {p.vendor} ·{" "}
            {p.product} · 由 {p.leadOps}（运营负责人）/ {p.bizOwner}
            （商务）共同负责
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
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportVendorDelivery}
              disabled={detailSubmitting === "delivery"}
            >
              {detailSubmitting === "delivery" ? "生成中" : "厂家交付包"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Settings size={14} />}
              onClick={openProjectSettings}
            >
              项目设置
            </Button>
            {p.status === "draft" && (
              <Button
                kind="default"
                icon={<Icon.Play size={14} />}
                onClick={async () => {
                  await actions.publishProject?.(p.id);
                  go("projects");
                }}
              >
                发布招募
              </Button>
            )}
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => go("tasks")}
            >
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
        {detailMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: detailMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {detailMessage}
          </div>
        ) : null}
        {settingsOpen ? (
          <ProjectSettingsPanel
            draft={settingsDraft}
            baseStatus={p.status}
            ownerOptions={ownerOptions}
            canAssignOwner={canAssignOwner}
            error={settingsError}
            submitting={settingsSubmitting}
            onChange={handleSettingsChange}
            onSubmit={handleProjectSettingsSubmit}
            onCancel={() => {
              setSettingsOpen(false);
              setSettingsError("");
              setSettingsDraft(projectSettingsInitialDraft(p));
            }}
          />
        ) : null}
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
              hint="按当前项目数据汇总"
            />
          </Card>
          <Card>
            <Metric
              label="主播应付"
              value={`¥${(p.metrics.payable / 10000).toFixed(1)}万`}
              hint="按当前项目数据汇总"
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
                  count: projectRosterCount,
                },
                {
                  key: "screening",
                  label: "录屏审核",
                  count: p.streamers.pendingReview,
                },
                {
                  key: "schedule",
                  label: "排班 & 任务",
                  count: projectTasks.length,
                },
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
            {tab === "schedule" && (
              <ProjectScheduleTasks
                p={p}
                tasks={projectTasks}
                streamers={streamers}
                go={go}
              />
            )}
            {tab !== "overview" && tab !== "roster" && tab !== "schedule" && (
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

function normalizeProjectSettingDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function projectSettingsInitialDraft(project) {
  return {
    name: project?.name || "",
    vendorName: normalizeProjectTextDraft(project?.vendor, ["未填写"]),
    productName: normalizeProjectTextDraft(project?.product, ["未填写"]),
    agentName: normalizeProjectTextDraft(project?.agent, ["—", "未填写"]),
    supplierName: normalizeProjectTextDraft(project?.supplier, [
      "未填写",
      "未绑定",
    ]),
    description: normalizeProjectTextDraft(
      project?.description || project?.note || project?.brief,
      ["暂无项目说明"],
    ),
    status: project?.status || "draft",
    ownerId: project?.ownerId || "",
    startsAt: normalizeProjectSettingDate(project?.start || project?.startsAt),
    endsAt: normalizeProjectSettingDate(project?.end || project?.endsAt),
    openSignup: project?.openSignup ?? true,
    allowDirectInvite: project?.allowDirectInvite ?? true,
    forceRecording: project?.forceRecording ?? project?.needScreening ?? true,
    forceSystemTiming:
      project?.forceSystemTiming ?? project?.needStartStop ?? true,
    isPublicToStreamers: project?.isPublicToStreamers ?? false,
    publicSummary: normalizeProjectTextDraft(project?.publicSummary),
    gameDownloadUrl: normalizeProjectTextDraft(project?.gameDownloadUrl),
  };
}

function normalizeProjectTextDraft(value, placeholders = []) {
  if (!value || placeholders.includes(value)) return "";
  return String(value);
}

const PROJECT_OWNER_ASSIGNABLE_ROLES = new Set([
  "owner",
  "ops_manager",
  "operator_business",
]);

function canAssignProjectOwnerInUi(role) {
  return role === "owner" || role === "ops_manager";
}

function projectOwnerOptions(members = [], project, currentUser) {
  const options = [];
  const seen = new Set();
  const pushOption = (value, label, role) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    const roleLabel = role && ROLES[role] ? ` · ${ROLES[role]}` : "";
    options.push({ value, label: `${label || value}${roleLabel}` });
  };

  if (currentUser?.id && PROJECT_OWNER_ASSIGNABLE_ROLES.has(currentUser.role)) {
    pushOption(currentUser.id, currentUser.name, currentUser.role);
  }

  members
    .filter((member) => member?.status !== "suspended")
    .filter((member) => PROJECT_OWNER_ASSIGNABLE_ROLES.has(member?.role))
    .forEach((member) => {
      pushOption(
        member.userId || member.user_id || member.id,
        member.name,
        member.role,
      );
    });

  if (project?.ownerId) {
    pushOption(project.ownerId, project.leadOps || project.ownerName, null);
  }

  return [{ value: "", label: "未分配" }, ...options];
}

const projectSettingsInputStyle = {
  height: 34,
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
  padding: "0 10px",
  fontSize: 13,
  color: "var(--ink-900)",
  background: "#fff",
  outline: "none",
};

const projectStatusPickerTones = {
  neutral: ["#EEF2F7", "#475569", "#94A3B8"],
  blue: ["#EEF3FF", "#1842A6", "#3B6BE6"],
  green: ["#E6F6EE", "#0E8A4D", "#22B86C"],
  amber: ["#FFF3DC", "#A86A00", "#E5A33A"],
  red: ["#FDECEC", "#C0303A", "#E66670"],
  violet: ["#EFEBFF", "#5B4BD1", "#8C7DEB"],
  teal: ["#DEF3F0", "#0E7C77", "#3CB1AB"],
  ink: ["#E2E8F0", "#1E2A47", "#475569"],
};

function projectStatusPickerColors(statusValue) {
  const tone = PROJECT_STATUS[statusValue]?.tone || "neutral";
  const [bg, fg, dot] =
    projectStatusPickerTones[tone] || projectStatusPickerTones.neutral;
  return { bg, fg, dot };
}

function ProjectSettingsField({ label, children }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: "var(--ink-500)",
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function projectStatusOptionsForTransition(fromStatus, currentValue) {
  const baseStatus = PROJECT_STATUS[fromStatus] ? fromStatus : currentValue;
  const nextStatuses = PROJECT_STATUS[baseStatus]
    ? getAllowedProjectStatusTransitions(baseStatus)
    : [];
  const visibleValues = new Set([baseStatus, currentValue, ...nextStatuses]);
  return PROJECT_STATUS_OPTIONS.filter((option) =>
    visibleValues.has(option.value),
  );
}

function projectStatusNextLabels(fromStatus) {
  if (!PROJECT_STATUS[fromStatus]) return "暂无可流转状态";
  const nextOptions = getAllowedProjectStatusTransitions(fromStatus)
    .map((status) => PROJECT_STATUS[status]?.label)
    .filter(Boolean);
  return nextOptions.length > 0 ? nextOptions.join("、") : "暂无可流转状态";
}

function isProjectPublishFromSettings(fromStatus, nextStatus) {
  return fromStatus === "draft" && nextStatus === "recruiting";
}

function ProjectSettingsStatusPicker({ value, fromStatus, onChange }) {
  const [open, setOpen] = React.useState(false);
  const statusOptions = projectStatusOptionsForTransition(fromStatus, value);
  const current =
    statusOptions.find((option) => option.value === value) ||
    PROJECT_STATUS_OPTIONS.find((option) => option.value === value) ||
    statusOptions[0] ||
    PROJECT_STATUS_OPTIONS[0];
  const currentColors = projectStatusPickerColors(current.value);
  const listboxId = "project-settings-status-options";

  const selectOption = (option) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      style={{ position: "relative" }}
    >
      <button
        type="button"
        role="combobox"
        aria-label="项目状态"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          ...projectSettingsInputStyle,
          width: "100%",
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderColor: open ? "var(--blue-300)" : "var(--line-strong)",
          background: "linear-gradient(180deg, #fff 0%, #F8FAFF 100%)",
          boxShadow: open
            ? "0 0 0 3px rgba(37, 99, 235, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)"
            : "inset 0 1px 0 rgba(255,255,255,0.8)",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span
          style={{
            minWidth: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "var(--ink-900)",
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: currentColors.dot,
              boxShadow: `0 0 0 4px ${currentColors.bg}`,
              flex: "0 0 auto",
            }}
          />
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {current.label}
          </span>
        </span>
        <Icon.ChevDown
          aria-hidden="true"
          size={14}
          stroke={open ? "var(--blue-700)" : "var(--ink-400)"}
        />
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="项目状态选项"
          style={{
            position: "absolute",
            zIndex: 40,
            top: 40,
            left: 0,
            right: 0,
            padding: 6,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "#fff",
            boxShadow:
              "0 16px 32px rgba(15, 23, 42, 0.14), 0 4px 10px rgba(15, 23, 42, 0.08)",
          }}
        >
          {statusOptions.map((option) => {
            const colors = projectStatusPickerColors(option.value);
            const selected = option.value === current.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                style={{
                  width: "100%",
                  height: 32,
                  border: "none",
                  borderRadius: 6,
                  padding: "0 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  background: selected ? "var(--blue-50)" : "transparent",
                  color: selected ? "var(--blue-700)" : "var(--ink-700)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: selected ? 700 : 600,
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: colors.dot,
                      boxShadow: `0 0 0 4px ${colors.bg}`,
                      flex: "0 0 auto",
                    }}
                  />
                  <span>{option.label}</span>
                </span>
                {selected && (
                  <span
                    aria-hidden="true"
                    style={{
                      color: "var(--blue-700)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    已选
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectSettingsDateField({ label, value, onChange }) {
  const inputRef = React.useRef(null);
  const [focused, setFocused] = React.useState(false);
  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
  };

  return (
    <ProjectSettingsField label={label}>
      <div
        onClick={openPicker}
        style={{
          ...projectSettingsInputStyle,
          borderColor: focused ? "var(--blue-300)" : "var(--line-strong)",
          padding: 0,
          display: "flex",
          alignItems: "center",
          position: "relative",
          cursor: "pointer",
          background: "linear-gradient(180deg, #fff 0%, #F8FAFF 100%)",
          boxShadow: focused
            ? "0 0 0 3px rgba(37, 99, 235, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)"
            : "inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        <input
          className="project-settings-date-input"
          ref={inputRef}
          type="date"
          value={value}
          onClick={(event) => {
            event.stopPropagation();
            openPicker();
          }}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            background: "transparent",
            outline: "none",
            color: "var(--ink-900)",
            fontSize: 13,
            padding: "0 34px 0 10px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            width: 18,
            height: 18,
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--blue-50)",
            color: "var(--blue-700)",
            pointerEvents: "none",
          }}
        >
          <Icon.Calendar size={13} stroke="var(--blue-700)" />
        </span>
      </div>
    </ProjectSettingsField>
  );
}

function ProjectSettingsPanel({
  draft,
  baseStatus,
  ownerOptions = [],
  canAssignOwner = false,
  error,
  submitting,
  onChange,
  onSubmit,
  onCancel,
}) {
  return (
    <Card
      title="项目设置"
      extra={
        <Badge tone="blue" dot>
          后端实时保存
        </Badge>
      }
      padded={true}
    >
      <form
        onSubmit={onSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <style>
          {`
            .project-settings-date-input::-webkit-calendar-picker-indicator {
              opacity: 0;
              cursor: pointer;
            }
          `}
        </style>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(120px, 0.5fr) minmax(180px, 1fr)",
            gap: 12,
            alignItems: "center",
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--blue-50)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink-900)",
              }}
            >
              状态设置
            </div>
            <div
              style={{ marginTop: 2, fontSize: 12, color: "var(--ink-500)" }}
            >
              状态保存后同步刷新项目列表与详情
            </div>
          </div>
          <ProjectSettingsField label="项目状态">
            <ProjectSettingsStatusPicker
              value={draft.status}
              fromStatus={baseStatus}
              onChange={(value) => onChange("status", value)}
            />
            <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
              当前可流转：{projectStatusNextLabels(baseStatus)}
            </span>
          </ProjectSettingsField>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <ProjectSettingsField label="项目名称">
            <input
              value={draft.name}
              onChange={(event) => onChange("name", event.target.value)}
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label="负责人">
            <select
              value={draft.ownerId || ""}
              onChange={(event) => onChange("ownerId", event.target.value)}
              disabled={!canAssignOwner}
              style={{
                ...projectSettingsInputStyle,
                cursor: canAssignOwner ? "pointer" : "not-allowed",
                color: canAssignOwner ? "var(--ink-900)" : "var(--ink-400)",
                background: canAssignOwner ? "#fff" : "var(--bg-soft)",
              }}
            >
              {ownerOptions.map((option) => (
                <option key={option.value || "unassigned"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ProjectSettingsField>
          <ProjectSettingsField label="厂商">
            <input
              value={draft.vendorName}
              onChange={(event) => onChange("vendorName", event.target.value)}
              placeholder="未填写"
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label="产品">
            <input
              value={draft.productName}
              onChange={(event) => onChange("productName", event.target.value)}
              placeholder="默认使用项目名称"
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label="代理商">
            <input
              value={draft.agentName}
              onChange={(event) => onChange("agentName", event.target.value)}
              placeholder="未填写"
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label="供应商">
            <input
              value={draft.supplierName}
              onChange={(event) => onChange("supplierName", event.target.value)}
              placeholder="未填写"
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
          <ProjectSettingsDateField
            label="开始日期"
            value={draft.startsAt}
            onChange={(value) => onChange("startsAt", value)}
          />
          <ProjectSettingsDateField
            label="结束日期"
            value={draft.endsAt}
            onChange={(value) => onChange("endsAt", value)}
          />
          <div style={{ gridColumn: "1 / -1" }}>
            <ProjectSettingsField label="项目说明">
              <textarea
                value={draft.description}
                onChange={(event) =>
                  onChange("description", event.target.value)
                }
                placeholder="补充厂家关注角色、素材要求、转化口径等项目说明"
                style={{
                  ...projectSettingsInputStyle,
                  width: "100%",
                  minHeight: 68,
                  padding: "8px 10px",
                  resize: "vertical",
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                }}
              />
            </ProjectSettingsField>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
          }}
        >
          <ProjectSettingsCheck
            label="开放报名"
            checked={draft.openSignup}
            onChange={(checked) => onChange("openSignup", checked)}
          />
          <ProjectSettingsCheck
            label="允许定向邀约"
            checked={draft.allowDirectInvite}
            onChange={(checked) => onChange("allowDirectInvite", checked)}
          />
          <ProjectSettingsCheck
            label="强制录屏"
            checked={draft.forceRecording}
            onChange={(checked) => onChange("forceRecording", checked)}
          />
          <ProjectSettingsCheck
            label="主播需点击开播/停止"
            checked={draft.forceSystemTiming}
            onChange={(checked) => onChange("forceSystemTiming", checked)}
          />
          <ProjectSettingsCheck
            label="公开给组织内主播"
            checked={draft.isPublicToStreamers}
            onChange={(checked) => onChange("isPublicToStreamers", checked)}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <ProjectSettingsField label="主播公告概括">
            <textarea
              value={draft.publicSummary}
              onChange={(event) =>
                onChange("publicSummary", event.target.value)
              }
              placeholder="给组织内主播看的项目概括、录播要求和注意事项"
              rows={3}
              style={{
                ...projectSettingsInputStyle,
                minHeight: 76,
                paddingTop: 8,
                resize: "vertical",
                lineHeight: 1.45,
                fontFamily: "inherit",
              }}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label="游戏下载链接">
            <input
              value={draft.gameDownloadUrl}
              onChange={(event) =>
                onChange("gameDownloadUrl", event.target.value)
              }
              placeholder="https://..."
              style={projectSettingsInputStyle}
            />
          </ProjectSettingsField>
        </div>

        {error ? (
          <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="ghost" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button kind="primary" type="submit" disabled={submitting}>
            {submitting ? "保存中" : "保存设置"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProjectSettingsCheck({ label, checked, onChange }) {
  return (
    <label
      style={{
        height: 34,
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "0 10px",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ink-700)",
        background: checked ? "var(--blue-50)" : "#fff",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
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

function ProjectScheduleTasks({ p, tasks = [], streamers = [], go }) {
  const liveCount = tasks.filter((task) => task.status === "live").length;
  const waitingCount = tasks.filter((task) =>
    ["pending_live", "pending_report", "pending_review"].includes(task.status),
  ).length;
  const anomalyCount = tasks.filter(isTaskOperationalAnomaly).length;
  const plannedHours = tasks.reduce((total, task) => {
    const plannedMinutes = Number(task.plannedDuration);
    if (Number.isFinite(plannedMinutes) && plannedMinutes > 0) {
      return total + plannedMinutes / 60;
    }
    const startHour = Number(task.startHour);
    const endHour = Number(task.endHour);
    if (Number.isFinite(startHour) && Number.isFinite(endHour)) {
      return total + Math.max(0, endHour - startHour);
    }
    return total;
  }, 0);
  const openTasks = () => go("tasks");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <Card padded={true}>
          <Metric label="项目任务" value={tasks.length} unit="项" />
        </Card>
        <Card padded={true}>
          <Metric label="待执行 / 待处理" value={waitingCount} unit="项" />
        </Card>
        <Card padded={true}>
          <Metric label="正在直播" value={liveCount} unit="项" />
        </Card>
        <Card padded={true}>
          <Metric
            label="计划时长"
            value={plannedHours.toFixed(1)}
            unit="h"
            delta={anomalyCount ? `${anomalyCount} 个异常` : "无异常"}
            deltaTone={anomalyCount ? "red" : "green"}
          />
        </Card>
      </div>

      <Card
        title="项目排班任务明细"
        extra={
          <Button size="sm" kind="default" onClick={openTasks}>
            前往排班与任务
          </Button>
        }
        padded={false}
      >
        {tasks.length ? (
          <TaskList
            tasks={tasks}
            projects={[p]}
            streamers={streamers}
            onSelectTask={openTasks}
          />
        ) : (
          <div style={{ padding: 20 }}>
            <EmptyHint
              title="暂无项目排班任务"
              hint="从排班与任务创建或批量排班后，会同步展示在这里。"
              actionLabel="前往排班与任务"
              onAction={openTasks}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

// Project overview content
function ProjectOverview({ p }) {
  const tasks = useOpsTasks();
  const projectTasks = tasks.filter((task) => taskBelongsToProject(task, p));
  const reminders = projectReminders(p, projectTasks);
  const insights = projectReviewInsights(p, projectTasks);
  const projectDescription =
    p.description || p.note || p.brief || "暂无项目说明";

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
                <span className="mono">{p.code || "未设置编号"}</span>
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
              <KV label="主播可见性">
                {p.isPublicToStreamers ? (
                  <Badge tone="green" dot>
                    组织内公开
                  </Badge>
                ) : (
                  <Badge tone="neutral">未公开</Badge>
                )}
              </KV>
              <KV label="主播公告概括" w={120}>
                <span style={{ color: "var(--ink-500)" }}>
                  {p.publicSummary || "暂无主播公告"}
                </span>
              </KV>
              <KV label="游戏下载链接" w={120}>
                {p.gameDownloadUrl ? (
                  <a
                    href={p.gameDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "var(--blue-700)",
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    游戏下载已配置
                  </a>
                ) : (
                  <span style={{ color: "var(--ink-500)" }}>未配置</span>
                )}
              </KV>
              <KV label="项目说明" w={120}>
                <span style={{ color: "var(--ink-500)" }}>
                  {projectDescription}
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
          <GanttPreview tasks={projectTasks} />
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card title="项目提醒" padded={true}>
          {reminders.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {reminders.map((reminder) => (
                <ReminderItem key={reminder.title} {...reminder} />
              ))}
            </div>
          ) : (
            <EmptyHint
              title="暂无项目提醒"
              hint="真实异常、待审核报数或候选录屏会在这里汇总。"
            />
          )}
        </Card>

        <Card
          title="项目复盘要点"
          extra={
            <Badge tone="violet" dot>
              按真实数据生成
            </Badge>
          }
          padded={true}
        >
          {insights.length ? (
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
              {insights.map(([title, detail]) => (
                <li
                  key={title}
                  style={{ fontSize: 12.5, color: "var(--ink-700)" }}
                >
                  <b style={{ color: "var(--violet-600)" }}>· {title}：</b>
                  {detail}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint
              title="暂无复盘要点"
              hint="需要真实任务、报数或结算数据后才会生成项目复盘。"
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function taskBelongsToProject(task, project) {
  const taskKeys = [task.project, task.projectId, task.projectName].filter(
    Boolean,
  );
  const projectKeys = [project.id, project.code, project.name].filter(Boolean);
  return taskKeys.some((key) => projectKeys.includes(key));
}

function projectReminders(project, tasks) {
  const pendingReportCount = tasks.filter(
    (task) => task.status === "pending_report",
  ).length;

  return [
    project.metrics.anomalies > 0 && {
      tone: "red",
      title: "异常待处理",
      content: `${project.metrics.anomalies} 条异常需要复核。`,
    },
    project.streamers.pendingReview > 0 && {
      tone: "amber",
      title: "录屏待审",
      content: `${project.streamers.pendingReview} 条候选录屏等待审核。`,
    },
    project.metrics.reportedPending > 0 && {
      tone: "blue",
      title: "报数待审",
      content: `${project.metrics.reportedPending} 条报数等待审核。`,
    },
    pendingReportCount > 0 && {
      tone: "amber",
      title: "待上传报数",
      content: `${pendingReportCount} 个任务等待主播提交报数。`,
    },
  ].filter(Boolean);
}

function projectReviewInsights(project, tasks) {
  const completedTasks = tasks.filter((task) =>
    ["completed", "approved"].includes(task.status),
  ).length;
  if (
    !completedTasks &&
    !project.metrics.doneHours &&
    !project.metrics.audience
  ) {
    return [];
  }

  return [
    project.metrics.doneHours > 0 && [
      "履约进度",
      `累计直播 ${project.metrics.doneHours.toFixed(1)} 小时。`,
    ],
    project.metrics.audience > 0 && [
      "场观表现",
      `累计场观 ${project.metrics.audience.toLocaleString("zh-CN")}。`,
    ],
    completedTasks > 0 && ["任务完成", `${completedTasks} 个任务已完成。`],
  ].filter(Boolean);
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
  const streamers = useOpsStreamers();
  const applications = useOpsApplications();
  const actions = useOpsLiveActions();
  const { streamers: streamerData, applications: applicationData } =
    React.useContext(OpsLiveDataContext);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedStreamerId, setSelectedStreamerId] = React.useState("");
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false);
  const [inviteError, setInviteError] = React.useState("");
  const [inviteMessage, setInviteMessage] = React.useState("");
  const [rosterActionError, setRosterActionError] = React.useState("");
  const [joiningApplicationId, setJoiningApplicationId] = React.useState("");
  const [localInvites, setLocalInvites] = React.useState([]);
  const applicationRoster = projectApplicationRosterRows(
    p,
    applications,
    streamers,
  );
  const roster = mergeRosterRows(applicationRoster, localInvites);
  const availableStreamers = streamers.filter(
    (streamer) => !roster.some((row) => row.id === streamer.id),
  );

  React.useEffect(() => {
    if (!selectedStreamerId && availableStreamers[0]?.id) {
      setSelectedStreamerId(availableStreamers[0].id);
    }
    if (
      selectedStreamerId &&
      !availableStreamers.some((streamer) => streamer.id === selectedStreamerId)
    ) {
      setSelectedStreamerId(availableStreamers[0]?.id ?? "");
    }
  }, [availableStreamers, selectedStreamerId]);

  const selectedStreamer = availableStreamers.find(
    (streamer) => streamer.id === selectedStreamerId,
  );

  React.useEffect(() => {
    if (streamerData == null && actions.refreshStreamers) {
      actions
        .refreshStreamers()
        .catch((error) =>
          warnBackgroundRefreshFailure("project roster", error),
        );
    }
  }, [actions, streamerData]);

  React.useEffect(() => {
    if (applicationData == null && actions.refreshApplications) {
      actions
        .refreshApplications()
        .catch((error) =>
          warnBackgroundRefreshFailure("project roster", error),
        );
    }
  }, [actions, applicationData]);

  const submitInvitation = async (event) => {
    event.preventDefault();
    if (!selectedStreamer) {
      setInviteError("暂无可邀请主播");
      return;
    }

    setInviteSubmitting(true);
    setInviteError("");
    try {
      await actions.inviteStreamerToProject?.(p.id, selectedStreamer.id);
      const row = {
        ...selectedStreamer,
        projectStatus: "邀约中",
        rosterSource: "local",
      };
      setLocalInvites((rows) => mergeRosterRows(rows, [row]));
      setInviteMessage(`已邀请 ${selectedStreamer.alias}`);
      setInviteOpen(false);
    } catch (error) {
      setInviteError(error?.message || "邀请主播失败，请稍后重试");
    } finally {
      setInviteSubmitting(false);
    }
  };
  const confirmRosterJoin = async (row) => {
    if (!row.applicationId || !actions.confirmApplicationJoin) return;

    setJoiningApplicationId(row.applicationId);
    setRosterActionError("");
    setInviteMessage("");
    try {
      await actions.confirmApplicationJoin(row.applicationId);
      setInviteMessage(`已确认 ${row.alias} 加入项目`);
    } catch (error) {
      setRosterActionError(error?.message || "确认加入失败，请稍后重试");
    } finally {
      setJoiningApplicationId("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}
          >
            项目主播阵容
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 3 }}>
            已加入与已邀约主播统一在这里管理。
          </div>
        </div>
        <Button
          kind="primary"
          icon={<Icon.Plus size={14} stroke="#fff" />}
          onClick={() => {
            setInviteOpen(true);
            setInviteError("");
            setInviteMessage("");
          }}
        >
          邀请主播
        </Button>
      </div>

      {inviteOpen ? (
        <form
          onSubmit={submitInvitation}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) auto",
            alignItems: "end",
            gap: 12,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-soft)",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-500)",
              fontWeight: 600,
            }}
          >
            选择主播
            <select
              value={selectedStreamerId}
              onChange={(event) => setSelectedStreamerId(event.target.value)}
              style={{
                height: 32,
                border: "1px solid var(--line-strong)",
                borderRadius: 6,
                background: "#fff",
                color: "var(--ink-700)",
                fontSize: 13,
                outline: "none",
                padding: "0 10px",
              }}
            >
              {availableStreamers.length ? (
                availableStreamers.map((streamer) => (
                  <option key={streamer.id} value={streamer.id}>
                    {streamer.alias} · {streamer.defaultRule}
                  </option>
                ))
              ) : (
                <option value="">暂无可邀请主播</option>
              )}
            </select>
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              kind="default"
              type="button"
              disabled={inviteSubmitting}
              onClick={() => setInviteOpen(false)}
            >
              取消
            </Button>
            <Button kind="primary" type="submit" disabled={inviteSubmitting}>
              {inviteSubmitting ? "邀请中" : "确认邀请"}
            </Button>
          </div>
          {inviteError ? (
            <div
              aria-live="polite"
              style={{
                gridColumn: "1 / -1",
                color: "var(--danger-600)",
                fontSize: 12,
              }}
            >
              {inviteError}
            </div>
          ) : null}
        </form>
      ) : null}

      {inviteMessage ? (
        <div
          aria-live="polite"
          style={{
            padding: "8px 12px",
            border: "1px solid #B7E6CE",
            borderRadius: 8,
            background: "#ECFDF3",
            color: "var(--ok-600)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {inviteMessage}
        </div>
      ) : null}

      {rosterActionError ? (
        <div
          aria-live="polite"
          style={{
            padding: "8px 12px",
            border: "1px solid #FAD1D1",
            borderRadius: 8,
            background: "#FEF2F2",
            color: "var(--danger-600)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {rosterActionError}
        </div>
      ) : null}

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
                    {displayRecordId(r.id, "主播")} · {r.real}
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
            title: "本项目状态",
            render: (r) => (
              <Badge tone={r.projectStatusTone}>{r.projectStatus}</Badge>
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
              <span className="num">
                {r.projectStatus === "已加入"
                  ? `${r.weeklyHours ?? 0} h`
                  : "待排班"}
              </span>
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
                {isConfirmableRosterApplication(r.applicationStatus) &&
                r.applicationId ? (
                  <Button
                    size="sm"
                    kind="primary"
                    disabled={joiningApplicationId === r.applicationId}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmRosterJoin(r);
                    }}
                  >
                    {joiningApplicationId === r.applicationId
                      ? "确认中"
                      : "确认加入"}
                  </Button>
                ) : null}
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
        emptyText="暂无项目主播"
      />
    </div>
  );
}

function projectApplicationRosterRows(project, applications, streamers) {
  if (!project) return [];
  return applications
    .filter((application) => applicationBelongsToProject(application, project))
    .map((application) =>
      applicationToRosterRow(application, streamers, "application"),
    )
    .filter(Boolean);
}

function applicationBelongsToProject(application, project) {
  const applicationProject = application.project || {};
  const applicationKeys = [
    application.projectId,
    application.project_id,
    applicationProject.id,
    applicationProject.code,
    applicationProject.name,
  ].filter(Boolean);
  const projectKeys = [project.id, project.code, project.name].filter(Boolean);
  return applicationKeys.some((key) => projectKeys.includes(key));
}

function applicationToRosterRow(application, streamers, rosterSource) {
  const streamer = application.streamer || {};
  const streamerId =
    application.streamerId || application.streamer_id || streamer.id;
  if (!streamerId) return null;
  const card = streamers.find((item) => item.id === streamerId);
  const projectStatus = applicationRosterStatus(application.status);
  return {
    id: streamerId,
    applicationId: application.id,
    applicationStatus: application.status,
    alias: card?.alias || streamer.displayName || streamer.name || streamerId,
    real: card?.real || streamer.realName || streamer.displayName || "未填写",
    source: card?.source || "项目邀约",
    supplier: card?.supplier || "未绑定",
    defaultRule: card?.defaultRule || "CPT",
    matchScore: card?.matchScore ?? 65,
    risk: card?.risk || streamer.riskLevel || "low",
    projectStatus: projectStatus.label,
    projectStatusTone: projectStatus.tone,
    weeklyHours: 0,
    rosterSource,
  };
}

function mergeRosterRows(...groups) {
  const rows = [];
  groups.flat().forEach((row) => {
    if (row && !rows.some((item) => item.id === row.id)) {
      rows.push(row);
    }
  });
  return rows;
}

function applicationRosterStatus(status) {
  const map = {
    invited: { label: "邀约中", tone: "blue" },
    recording_submitted: { label: "录屏待审", tone: "amber" },
    pending_recording_review: { label: "录屏待审", tone: "amber" },
    recording_approved: { label: "待确认加入", tone: "violet" },
    joined: { label: "已加入", tone: "green" },
    rejected: { label: "已拒绝", tone: "red" },
    rejected_join: { label: "已拒绝", tone: "red" },
  };
  return map[status] || { label: "邀约中", tone: "blue" };
}

function isConfirmableRosterApplication(status) {
  return status === "invited" || status === "recording_approved";
}

function GanttPreview({ tasks = [] }) {
  const rows = taskGanttRows(tasks);
  const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayColor = (k) =>
    k === "live"
      ? "var(--blue-600)"
      : k === "late"
        ? "var(--danger-600)"
        : "var(--blue-200)";

  if (!rows.length) {
    return (
      <EmptyHint
        title="暂无执行节奏"
        hint="创建排班或任务后会展示未来 7 天安排。"
      />
    );
  }

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

function taskGanttRows(tasks) {
  const grouped = new Map();
  tasks.forEach((task) => {
    const key = task.streamerId || task.streamerName || "unassigned";
    const current = grouped.get(key) || {
      name: displayTaskStreamerName(task),
      bars: [],
    };
    current.bars.push([
      Math.max(1, Math.min(7, (task.dayIdx ?? 0) + 1)),
      Math.max(1, Math.min(7, Math.ceil((task.endHour - task.startHour) / 4))),
      task.status === "live"
        ? "live"
        : task.status === "abnormal"
          ? "late"
          : "plan",
    ]);
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).slice(0, 5);
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

function splitDraftList(value) {
  return value
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftNumber(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Number(trimmed) : 0;
}

function draftPercentToBps(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? Math.round(Number(trimmed) * 100) : 0;
}

function buildStreamerSubaccountCandidates(members) {
  if (!Array.isArray(members)) return [];

  return members
    .filter(
      (member) =>
        member?.role === "streamer" &&
        member?.status !== "suspended" &&
        typeof member?.userId === "string" &&
        member.userId.trim(),
    )
    .map((member) => {
      const email = typeof member.email === "string" ? member.email.trim() : "";
      const name =
        typeof member.name === "string" && member.name.trim()
          ? member.name.trim()
          : email || member.userId;
      const account = accountFromLocalSubaccountEmail(email);
      const searchText = [name, email, account, member.userId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        userId: member.userId.trim(),
        name,
        email,
        account,
        status: member.status,
        searchText,
      };
    });
}

function streamerSubaccountLabel(candidate) {
  if (!candidate) return "";

  const account = candidate.account
    ? `默认账号 ${candidate.account}`
    : candidate.email || candidate.userId;

  return `${candidate.name} · ${account}`;
}

// ===== src\screen-streamers.jsx =====
// ——— Screen: 主播资源池 ————————————————————————————

function ScreenStreamers({ go, initialActiveId }) {
  const streamers = useOpsStreamers();
  const actions = useOpsLiveActions();
  const { organizationMembers, streamers: streamerData } =
    React.useContext(OpsLiveDataContext);
  const emptyDraft = {
    displayName: "",
    realName: "",
    gender: "",
    sourceType: "external",
    categories: "",
    platforms: "",
    styles: "",
    defaultSettlementMethod: "cpt",
    defaultHourlyRate: "",
    defaultBaseSalary: "",
    defaultCpsRatePercent: "",
    userId: "",
  };
  const [active, setActive] = React.useState(
    initialActiveId || streamers[3]?.id || streamers[0]?.id,
  );
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(emptyDraft);
  const [draftError, setDraftError] = React.useState("");
  const [draftSubmitting, setDraftSubmitting] = React.useState(false);
  const [memberLoading, setMemberLoading] = React.useState(false);
  const [memberLoadError, setMemberLoadError] = React.useState("");
  const [userSearch, setUserSearch] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [cooperationFilter, setCooperationFilter] = React.useState("all");
  const [riskFilter, setRiskFilter] = React.useState("all");
  const [importMessage, setImportMessage] = React.useState("");
  const [exportMessage, setExportMessage] = React.useState("");
  const [exportSubmitting, setExportSubmitting] = React.useState(false);
  const draftFieldStyle = {
    width: "100%",
    height: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink-700)",
    fontSize: 13,
    outline: "none",
    padding: "0 10px",
  };
  const draftLabelStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: "var(--ink-500)",
    fontWeight: 600,
    minWidth: 0,
  };
  const updateDraft = (field) => (event) => {
    setDraft((value) => ({ ...value, [field]: event.target.value }));
  };
  const streamerSubaccountCandidates = React.useMemo(
    () => buildStreamerSubaccountCandidates(organizationMembers),
    [organizationMembers],
  );
  const selectedSubaccount = streamerSubaccountCandidates.find(
    (candidate) => candidate.userId === draft.userId.trim(),
  );
  const userQuery = userSearch.trim().toLowerCase();
  const filteredSubaccountCandidates = userQuery
    ? streamerSubaccountCandidates
        .filter((candidate) => candidate.searchText.includes(userQuery))
        .slice(0, 6)
    : streamerSubaccountCandidates.slice(0, 6);
  const refreshStreamerSubaccounts = () => {
    if (organizationMembers != null || !actions.refreshOrganizationMembers) {
      return;
    }

    setMemberLoading(true);
    setMemberLoadError("");
    actions
      .refreshOrganizationMembers()
      .catch((error) =>
        setMemberLoadError(formatOrganizationMemberError(error)),
      )
      .finally(() => setMemberLoading(false));
  };
  const updateUserSearch = (event) => {
    const nextValue = event.target.value;
    setUserSearch(nextValue);
    setDraft((value) => (value.userId ? { ...value, userId: "" } : value));
  };
  const selectStreamerSubaccount = (candidate) => {
    setDraft((value) => ({ ...value, userId: candidate.userId }));
    setUserSearch(streamerSubaccountLabel(candidate));
  };
  React.useEffect(() => {
    if (streamerData == null && actions.refreshStreamers) {
      actions
        .refreshStreamers()
        .catch((error) =>
          warnBackgroundRefreshFailure("organization members", error),
        );
    }
  }, [actions, streamerData]);
  const openDraftForm = () => {
    setDraftOpen(true);
    setDraftError("");
    setMemberLoadError("");
    setUserSearch(streamerSubaccountLabel(selectedSubaccount));
    refreshStreamerSubaccounts();
  };
  const closeDraftForm = () => {
    setDraftOpen(false);
    setDraftError("");
    setMemberLoadError("");
    setUserSearch("");
  };
  const submitStreamerDraft = async (event) => {
    event.preventDefault();
    const displayName = draft.displayName.trim();
    if (!displayName) {
      setDraftError("请填写主播昵称");
      return;
    }
    if (userSearch.trim() && !selectedSubaccount) {
      setDraftError("请从候选列表选择主播子账号，或清空后不绑定");
      return;
    }

    setDraftSubmitting(true);
    setDraftError("");
    try {
      const body = await actions.createStreamerProfile?.({
        displayName,
        realName: draft.realName.trim(),
        gender: draft.gender,
        sourceType: draft.sourceType,
        categories: splitDraftList(draft.categories),
        platforms: splitDraftList(draft.platforms),
        styles: splitDraftList(draft.styles),
        defaultSettlementMethod: draft.defaultSettlementMethod,
        defaultHourlyRate: draftNumber(draft.defaultHourlyRate),
        defaultBaseSalary: draftNumber(draft.defaultBaseSalary),
        defaultCpsRateBps: draftPercentToBps(draft.defaultCpsRatePercent),
        userId: draft.userId.trim(),
      });
      setDraftOpen(false);
      setDraft(emptyDraft);
      setUserSearch("");
      if (body?.streamer?.id) {
        setActive(body.streamer.id);
      }
    } catch (error) {
      setDraftError(error?.message || "创建主播档案失败，请稍后重试");
    } finally {
      setDraftSubmitting(false);
    }
  };
  const query = search.trim().toLowerCase();
  const visibleStreamers = streamers.filter((streamer) => {
    const matchesSearch =
      !query ||
      [
        streamer.alias,
        streamer.real,
        streamer.id,
        streamer.source,
        streamer.supplier,
        streamer.style,
        ...streamer.games,
        ...streamer.platforms,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesCategory =
      categoryFilter === "all" || streamer.games.includes(categoryFilter);
    const matchesSource =
      sourceFilter === "all" || streamer.source === sourceFilter;
    const matchesCooperation =
      cooperationFilter === "all" || streamer.cooperation === cooperationFilter;
    const matchesRisk = riskFilter === "all" || streamer.risk === riskFilter;
    return (
      matchesSearch &&
      matchesCategory &&
      matchesSource &&
      matchesCooperation &&
      matchesRisk
    );
  });
  React.useEffect(() => {
    if (!visibleStreamers.some((item) => item.id === active)) {
      const nextActive = visibleStreamers[0]?.id ?? null;
      if (nextActive !== active) {
        setActive(nextActive);
      }
    }
  }, [active, visibleStreamers]);
  const exportStreamerPool = async () => {
    setExportSubmitting(true);
    setExportMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "project_execution",
        rows: visibleStreamers.map((streamer) => ({
          projectName: "主播资源池",
          status: streamer.cooperation === "paused" ? "paused" : "active",
          operatorName: streamer.alias,
        })),
      });
      setExportMessage("导出已生成");
    } catch (error) {
      setExportMessage(error?.message || "导出失败，请稍后重试");
    } finally {
      setExportSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="主播资源池"
        subtitle="不是通讯录 · 用于回答：能不能接？适合接什么？历史表现如何？值不值得继续合作？"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportStreamerPool}
              disabled={exportSubmitting}
            >
              导出主播表
            </Button>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={() => setImportMessage("批量导入后端尚未接入")}
            >
              批量导入
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={openDraftForm}
            >
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
            <SearchInput
              placeholder="主播名 / 真名 / 平台账号"
              value={search}
              onChange={setSearch}
              width={240}
            />
            <StreamerInlineFilter
              label="品类筛选"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={uniqueStreamerListOptions(streamers, "games")}
            />
            <StreamerInlineFilter
              label="来源筛选"
              value={sourceFilter}
              onChange={setSourceFilter}
              options={uniqueStreamerValueOptions(streamers, "source")}
            />
            <StreamerInlineFilter
              label="合作状态筛选"
              value={cooperationFilter}
              onChange={setCooperationFilter}
              options={uniqueStreamerValueOptions(streamers, "cooperation")}
            />
            <select
              aria-label="风险筛选"
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
              style={{
                height: 32,
                border: "1px solid var(--line-strong)",
                borderRadius: 6,
                background: "#fff",
                color: "var(--ink-700)",
                fontSize: 13,
                padding: "0 10px",
                outline: "none",
              }}
            >
              <option value="all">全部风险</option>
              <option value="low">低风险</option>
              <option value="medium">中风险</option>
              <option value="high">高风险</option>
              <option value="blacklisted">黑名单</option>
            </select>
            <div style={{ flex: 1 }} />
            <Badge tone="blue">{visibleStreamers.length} 位主播</Badge>
          </div>
          {exportMessage ? (
            <div
              aria-live="polite"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--blue-50)",
                color: "var(--blue-700)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {exportMessage}
            </div>
          ) : null}
          {importMessage ? (
            <div
              aria-live="polite"
              style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--warn-50)",
                color: "var(--warn-600)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {importMessage}
            </div>
          ) : null}

          {draftOpen ? (
            <form
              onSubmit={submitStreamerDraft}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                alignItems: "end",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line)",
                background: "var(--bg-soft)",
              }}
            >
              <label style={draftLabelStyle}>
                主播昵称
                <input
                  value={draft.displayName}
                  onChange={updateDraft("displayName")}
                  placeholder="例如：小鹿"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                真实姓名
                <input
                  value={draft.realName}
                  onChange={updateDraft("realName")}
                  placeholder="可选"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                性别
                <select
                  value={draft.gender}
                  onChange={updateDraft("gender")}
                  style={draftFieldStyle}
                >
                  <option value="">未填写</option>
                  <option value="女">女</option>
                  <option value="男">男</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              <label style={draftLabelStyle}>
                来源
                <select
                  value={draft.sourceType}
                  onChange={updateDraft("sourceType")}
                  style={draftFieldStyle}
                >
                  <option value="external">外部</option>
                  <option value="signed">签约</option>
                  <option value="self_incubated">自孵化</option>
                  <option value="supplier_recommended">供应商</option>
                  <option value="account_managed">代运营</option>
                </select>
              </label>
              <label style={draftLabelStyle}>
                擅长品类
                <input
                  value={draft.categories}
                  onChange={updateDraft("categories")}
                  placeholder="二游, 卡牌"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                平台
                <input
                  value={draft.platforms}
                  onChange={updateDraft("platforms")}
                  placeholder="抖音, 快手"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                直播风格
                <input
                  value={draft.styles}
                  onChange={updateDraft("styles")}
                  placeholder="高能整活, 陪伴"
                  style={draftFieldStyle}
                />
              </label>
              <label style={draftLabelStyle}>
                默认结算
                <select
                  value={draft.defaultSettlementMethod}
                  onChange={updateDraft("defaultSettlementMethod")}
                  style={draftFieldStyle}
                >
                  <option value="cpt">CPT</option>
                  <option value="cpa">CPA</option>
                  <option value="cps">CPS</option>
                  <option value="gift">礼物流水</option>
                  <option value="base_salary">保底</option>
                  <option value="base_salary_cpt">保底 + CPT</option>
                  <option value="manual">手动结算</option>
                </select>
              </label>
              {["cpt", "base_salary_cpt"].includes(
                draft.defaultSettlementMethod,
              ) ? (
                <label style={draftLabelStyle}>
                  CPT 小时单价
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.defaultHourlyRate}
                    onChange={updateDraft("defaultHourlyRate")}
                    placeholder="80"
                    style={draftFieldStyle}
                  />
                </label>
              ) : null}
              {draft.defaultSettlementMethod === "cps" ? (
                <label style={draftLabelStyle}>
                  CPS 分成比例
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={draft.defaultCpsRatePercent}
                    onChange={updateDraft("defaultCpsRatePercent")}
                    placeholder="15"
                    style={draftFieldStyle}
                  />
                </label>
              ) : null}
              {["base_salary", "base_salary_cpt"].includes(
                draft.defaultSettlementMethod,
              ) ? (
                <label style={draftLabelStyle}>
                  底薪
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.defaultBaseSalary}
                    onChange={updateDraft("defaultBaseSalary")}
                    placeholder="6000"
                    style={draftFieldStyle}
                  />
                </label>
              ) : null}
              <div style={{ position: "relative", minWidth: 0 }}>
                <label style={draftLabelStyle}>
                  绑定主播子账号
                  <input
                    value={userSearch}
                    onChange={updateUserSearch}
                    onFocus={refreshStreamerSubaccounts}
                    placeholder={
                      memberLoading
                        ? "正在加载主播子账号"
                        : "搜索姓名 / 邮箱 / 默认账号"
                    }
                    aria-autocomplete="list"
                    aria-expanded={
                      Boolean(userSearch.trim()) && !selectedSubaccount
                    }
                    style={draftFieldStyle}
                  />
                </label>
                {userSearch.trim() && !selectedSubaccount ? (
                  <div
                    role="listbox"
                    aria-label="主播子账号候选"
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      top: 56,
                      left: 0,
                      right: 0,
                      overflow: "hidden",
                      border: "1px solid var(--line-strong)",
                      borderRadius: 8,
                      background: "#fff",
                      boxShadow: "var(--shadow-pop)",
                    }}
                  >
                    {filteredSubaccountCandidates.length > 0 ? (
                      filteredSubaccountCandidates.map((candidate) => (
                        <button
                          key={candidate.userId}
                          type="button"
                          role="option"
                          onClick={() => selectStreamerSubaccount(candidate)}
                          style={{
                            width: "100%",
                            border: 0,
                            borderBottom: "1px solid var(--line)",
                            background: "#fff",
                            padding: "8px 10px",
                            textAlign: "left",
                            cursor: "pointer",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              color: "var(--ink-900)",
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            {candidate.name}
                          </span>
                          <span
                            style={{
                              display: "block",
                              marginTop: 2,
                              color: "var(--ink-400)",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {candidate.account
                              ? `默认账号 ${candidate.account}`
                              : candidate.email || candidate.userId}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div
                        style={{
                          padding: "9px 10px",
                          color: "var(--ink-400)",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        暂无匹配主播子账号
                      </div>
                    )}
                  </div>
                ) : null}
                {memberLoadError || selectedSubaccount ? (
                  <div
                    aria-live="polite"
                    style={{
                      marginTop: 4,
                      color: memberLoadError
                        ? "var(--danger-600)"
                        : "var(--ink-300)",
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {memberLoadError ||
                      `已绑定 ${streamerSubaccountLabel(selectedSubaccount)}`}
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  minWidth: 160,
                }}
              >
                <Button
                  kind="default"
                  type="button"
                  onClick={closeDraftForm}
                  disabled={draftSubmitting}
                >
                  取消
                </Button>
                <Button
                  kind="primary"
                  type="submit"
                  disabled={draftSubmitting}
                  icon={<Icon.Plus size={14} stroke="#fff" />}
                >
                  {draftSubmitting ? "创建中" : "创建档案"}
                </Button>
              </div>
              {draftError ? (
                <div
                  aria-live="polite"
                  style={{
                    gridColumn: "1 / -1",
                    color: "var(--danger-600)",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {draftError}
                </div>
              ) : null}
            </form>
          ) : null}

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
                        {displayRecordId(r.id, "主播")} · {r.real}
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
                render: (r) => {
                  if (!hasStreamerPerformanceData(r)) {
                    return (
                      <span style={{ color: "var(--ink-300)" }}>暂无</span>
                    );
                  }
                  return (
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
                  );
                },
              },
              {
                title: "ROI",
                align: "right",
                render: (r) =>
                  hasStreamerPerformanceData(r) ? (
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
                  ) : (
                    <span style={{ color: "var(--ink-300)" }}>暂无</span>
                  ),
              },
              {
                title: "默认结算",
                render: (r) => <Badge tone="ink">{r.defaultRule}</Badge>,
              },
              { title: "风险", render: (r) => <RiskDot level={r.risk} /> },
            ]}
            rows={visibleStreamers}
            emptyText="暂无匹配主播"
          />
        </Card>

        {/* Detail panel */}
        <StreamerPanel id={active} streamers={visibleStreamers} go={go} />
      </div>
    </>
  );
}

function uniqueStreamerListOptions(streamers, key) {
  return Array.from(
    new Set(
      streamers.flatMap((streamer) => streamer[key] || []).filter(Boolean),
    ),
  );
}

function uniqueStreamerValueOptions(streamers, key) {
  return Array.from(
    new Set(streamers.map((streamer) => streamer[key]).filter(Boolean)),
  );
}

function StreamerInlineFilter({ label, value, onChange, options }) {
  return (
    <div
      style={{
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 9px",
        border: "1px solid var(--line-strong)",
        borderRadius: 6,
        background: "#fff",
        color: "var(--ink-500)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      <Icon.Filter size={13} />
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--ink-700)",
          fontSize: 12,
          maxWidth: 96,
        }}
      >
        <option value="all">全部</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function StreamerPanel({ id, streamers = STREAMERS, go }) {
  const actions = useOpsLiveActions();
  const projects = useOpsProjects();
  const s = streamers.find((x) => x.id === id);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [profileDraft, setProfileDraft] = React.useState(null);
  const [profileError, setProfileError] = React.useState("");
  const [profileSubmitting, setProfileSubmitting] = React.useState(false);
  const [riskOpen, setRiskOpen] = React.useState(false);
  const [riskLevel, setRiskLevel] = React.useState("low");
  const [riskReason, setRiskReason] = React.useState("");
  const [riskError, setRiskError] = React.useState("");
  const [riskSubmitting, setRiskSubmitting] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteProjectId, setInviteProjectId] = React.useState("");
  const [inviteMessage, setInviteMessage] = React.useState("");
  const [inviteError, setInviteError] = React.useState("");
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false);
  React.useEffect(() => {
    if (!s) return;
    setRiskLevel(s.risk || "low");
    setRiskReason("");
    setRiskError("");
    setProfileOpen(false);
    setProfileError("");
    setProfileDraft(streamerProfileDraftFromCard(s));
    setRiskOpen(false);
    setInviteOpen(false);
    setInviteError("");
    setInviteMessage("");
  }, [s?.id, s?.risk]);
  React.useEffect(() => {
    if (!inviteProjectId && projects[0]?.id) {
      setInviteProjectId(projects[0].id);
    }
  }, [inviteProjectId, projects]);
  if (!s) {
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
        <Card>
          <EmptyHint
            title="未选中主播"
            hint="调整搜索或筛选条件后再查看主播档案。"
          />
        </Card>
      </div>
    );
  }
  const panelFieldStyle = {
    width: "100%",
    minHeight: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--ink-700)",
    fontSize: 13,
    outline: "none",
    padding: "0 10px",
  };
  const panelLabelStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: "var(--ink-500)",
    fontWeight: 600,
  };
  const streamerProjects = Array.isArray(s.projects) ? s.projects : [];
  const hasPerformanceData = hasStreamerPerformanceData(s);
  const updateProfileDraft = (field) => (event) => {
    setProfileDraft((value) => ({
      ...(value || streamerProfileDraftFromCard(s)),
      [field]: event.target.value,
    }));
  };
  const openProfileForm = () => {
    setProfileDraft(streamerProfileDraftFromCard(s));
    setProfileError("");
    setProfileOpen(true);
  };
  const closeProfileForm = () => {
    setProfileOpen(false);
    setProfileError("");
    setProfileDraft(streamerProfileDraftFromCard(s));
  };
  const submitProfileUpdate = async (event) => {
    event.preventDefault();
    const draft = profileDraft || streamerProfileDraftFromCard(s);
    const displayName = draft.displayName.trim();
    const reason = draft.reason.trim();
    if (!displayName) {
      setProfileError("请填写主播昵称");
      return;
    }
    if (!reason) {
      setProfileError("请填写变更原因");
      return;
    }

    setProfileSubmitting(true);
    setProfileError("");
    try {
      const settlementMethod = draft.defaultSettlementMethod;
      await actions.updateStreamerProfile?.(s.id, {
        displayName,
        realName: draft.realName.trim(),
        gender: draft.gender.trim(),
        sourceType: draft.sourceType,
        cooperationStatus: draft.cooperationStatus,
        categories: splitDraftList(draft.categories),
        platforms: splitDraftList(draft.platforms),
        styles: splitDraftList(draft.styles),
        defaultSettlementMethod: settlementMethod,
        defaultHourlyRate: ["cpt", "base_salary_cpt"].includes(settlementMethod)
          ? draftNumber(draft.defaultHourlyRate)
          : 0,
        defaultBaseSalary: ["base_salary", "base_salary_cpt"].includes(
          settlementMethod,
        )
          ? draftNumber(draft.defaultBaseSalary)
          : 0,
        defaultCpsRateBps:
          settlementMethod === "cps"
            ? draftPercentToBps(draft.defaultCpsRatePercent)
            : 0,
        reason,
      });
      setProfileOpen(false);
    } catch (error) {
      setProfileError(error?.message || "档案更新失败，请稍后重试");
    } finally {
      setProfileSubmitting(false);
    }
  };
  const openRiskForm = () => {
    setRiskOpen(true);
    setRiskError("");
  };
  const submitRiskUpdate = async (event) => {
    event.preventDefault();
    const reason = riskReason.trim();
    if (!reason) {
      setRiskError("请填写风险原因");
      return;
    }

    setRiskSubmitting(true);
    setRiskError("");
    try {
      await actions.updateStreamerRisk?.(s.id, {
        riskLevel,
        riskReason: reason,
        reason,
      });
      setRiskOpen(false);
      setRiskReason("");
    } catch (error) {
      setRiskError(error?.message || "风险更新失败，请稍后重试");
    } finally {
      setRiskSubmitting(false);
    }
  };
  const openInviteForm = () => {
    setInviteOpen(true);
    setInviteError("");
    setInviteMessage("");
    setInviteProjectId((value) => value || projects[0]?.id || "");
  };
  const submitInvitation = async (event) => {
    event.preventDefault();
    const projectId = inviteProjectId || projects[0]?.id;
    if (!projectId) {
      setInviteError("请先选择项目");
      return;
    }

    setInviteSubmitting(true);
    setInviteError("");
    try {
      await actions.inviteStreamerToProject?.(projectId, s.id);
      setInviteOpen(false);
      setInviteMessage("已发起邀约");
    } catch (error) {
      setInviteError(error?.message || "邀约失败，请稍后重试");
    } finally {
      setInviteSubmitting(false);
    }
  };

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
                  {s.real} · {s.gender} ·{" "}
                  <span className="mono">{displayRecordId(s.id, "主播")}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  title="编辑档案"
                  onClick={openProfileForm}
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
          {s.settlement ? (
            <>
              <KV label="CPT 单价">
                {s.settlement.cptHourlyRate > 0
                  ? `¥${s.settlement.cptHourlyRate}/h`
                  : "未配置"}
              </KV>
              <KV label="CPS 分成">
                {s.settlement.cpsRateBps > 0
                  ? `${s.settlement.cpsRateBps / 100}%`
                  : "未配置"}
              </KV>
              <KV label="底薪">
                {s.settlement.baseSalary > 0
                  ? `¥${s.settlement.baseSalary}`
                  : "未配置"}
              </KV>
            </>
          ) : null}
        </div>
      </Card>

      {profileOpen ? (
        <Card title="编辑主播档案" padded={true}>
          <form
            onSubmit={submitProfileUpdate}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={panelLabelStyle}>
              主播昵称
              <input
                value={profileDraft?.displayName ?? ""}
                onChange={updateProfileDraft("displayName")}
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              真实姓名
              <input
                value={profileDraft?.realName ?? ""}
                onChange={updateProfileDraft("realName")}
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              性别
              <input
                value={profileDraft?.gender ?? ""}
                onChange={updateProfileDraft("gender")}
                placeholder="女 / 男 / 其他"
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              来源
              <select
                value={profileDraft?.sourceType ?? "external"}
                onChange={updateProfileDraft("sourceType")}
                style={panelFieldStyle}
              >
                <option value="external">外部</option>
                <option value="signed">签约</option>
                <option value="self_incubated">自孵化</option>
                <option value="supplier_recommended">供应商</option>
                <option value="account_managed">代运营</option>
              </select>
            </label>
            <label style={panelLabelStyle}>
              合作状态
              <select
                value={profileDraft?.cooperationStatus ?? "not_started"}
                onChange={updateProfileDraft("cooperationStatus")}
                style={panelFieldStyle}
              >
                <option value="not_started">未填写</option>
                <option value="active">合作中</option>
                <option value="paused">暂停</option>
                <option value="ended">已结束</option>
              </select>
            </label>
            <label style={panelLabelStyle}>
              擅长品类
              <input
                value={profileDraft?.categories ?? ""}
                onChange={updateProfileDraft("categories")}
                placeholder="RPG, SLG"
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              平台
              <input
                value={profileDraft?.platforms ?? ""}
                onChange={updateProfileDraft("platforms")}
                placeholder="抖音, 快手"
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              直播风格
              <input
                value={profileDraft?.styles ?? ""}
                onChange={updateProfileDraft("styles")}
                placeholder="高能整活"
                style={panelFieldStyle}
              />
            </label>
            <label style={panelLabelStyle}>
              默认结算
              <select
                value={profileDraft?.defaultSettlementMethod ?? "cpt"}
                onChange={updateProfileDraft("defaultSettlementMethod")}
                style={panelFieldStyle}
              >
                <option value="cpt">CPT</option>
                <option value="cpa">CPA</option>
                <option value="cps">CPS</option>
                <option value="gift">礼物流水</option>
                <option value="base_salary">保底</option>
                <option value="base_salary_cpt">保底 + CPT</option>
                <option value="manual">手动结算</option>
              </select>
            </label>
            {["cpt", "base_salary_cpt"].includes(
              profileDraft?.defaultSettlementMethod,
            ) ? (
              <label style={panelLabelStyle}>
                CPT 小时单价
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={profileDraft?.defaultHourlyRate ?? ""}
                  onChange={updateProfileDraft("defaultHourlyRate")}
                  style={panelFieldStyle}
                />
              </label>
            ) : null}
            {profileDraft?.defaultSettlementMethod === "cps" ? (
              <label style={panelLabelStyle}>
                CPS 分成比例
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={profileDraft?.defaultCpsRatePercent ?? ""}
                  onChange={updateProfileDraft("defaultCpsRatePercent")}
                  style={panelFieldStyle}
                />
              </label>
            ) : null}
            {["base_salary", "base_salary_cpt"].includes(
              profileDraft?.defaultSettlementMethod,
            ) ? (
              <label style={panelLabelStyle}>
                底薪
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={profileDraft?.defaultBaseSalary ?? ""}
                  onChange={updateProfileDraft("defaultBaseSalary")}
                  style={panelFieldStyle}
                />
              </label>
            ) : null}
            <label style={panelLabelStyle}>
              变更原因
              <textarea
                value={profileDraft?.reason ?? ""}
                onChange={updateProfileDraft("reason")}
                rows={3}
                placeholder="例如：同步主播资源池主档案"
                style={{ ...panelFieldStyle, padding: 10, lineHeight: 1.5 }}
              />
            </label>
            {profileError ? (
              <div
                aria-live="polite"
                style={{
                  color: "var(--danger-600)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {profileError}
              </div>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button
                kind="default"
                type="button"
                disabled={profileSubmitting}
                onClick={closeProfileForm}
              >
                取消
              </Button>
              <Button kind="primary" type="submit" disabled={profileSubmitting}>
                {profileSubmitting ? "保存中" : "保存档案"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="经营画像 · 近 90 天" padded={true}>
        {hasPerformanceData ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
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
                value={formatStreamerMoneyK(s.metrics.grossContrib)}
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
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  marginBottom: 6,
                }}
              >
                近 6 周匹配分趋势
              </div>
              <Sparkline
                data={
                  Array.isArray(s.matchTrend) && s.matchTrend.length > 1
                    ? s.matchTrend
                    : Array(6).fill(s.matchScore)
                }
              />
            </div>
          </>
        ) : (
          <EmptyHint
            title="暂无经营画像数据"
            hint="完成录屏、排班任务或报数审核后，这里会展示近 90 天真实表现。"
          />
        )}
      </Card>

      <Card
        title="参与项目"
        extra={
          <Button size="sm" kind="link" onClick={() => go?.("projects")}>
            查看全部
          </Button>
        }
        padded={false}
      >
        {streamerProjects.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {streamerProjects.slice(0, 5).map((project, index) => (
              <div
                key={project.id || project.name}
                style={{
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderBottom:
                    index < Math.min(streamerProjects.length, 5) - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    background: "var(--blue-50)",
                    color: "var(--blue-700)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon.Project size={15} stroke="var(--blue-700)" />
                </span>
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
                    {project.name}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "var(--ink-400)" }}
                  >
                    {formatStreamerHours(project.settlementHours)} ·{" "}
                    {formatStreamerMoney(project.grossContrib)}
                  </div>
                </div>
                <Badge tone={project.status === "joined" ? "green" : "blue"}>
                  {project.status === "joined" ? "已加入" : project.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyHint
            title="暂无参与项目"
            hint="后端返回项目履约记录后会展示项目贡献。"
          />
        )}
      </Card>

      {riskOpen ? (
        <Card title="设置风险" padded={true}>
          <form
            onSubmit={submitRiskUpdate}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={panelLabelStyle}>
              风险等级
              <select
                value={riskLevel}
                onChange={(event) => setRiskLevel(event.target.value)}
                style={panelFieldStyle}
              >
                <option value="low">低风险</option>
                <option value="medium">中风险</option>
                <option value="high">高风险</option>
                <option value="blacklisted">黑名单</option>
              </select>
            </label>
            <label style={panelLabelStyle}>
              风险原因
              <textarea
                value={riskReason}
                onChange={(event) => setRiskReason(event.target.value)}
                rows={3}
                placeholder="例如：连续两次异常报数"
                style={{ ...panelFieldStyle, padding: 10, lineHeight: 1.5 }}
              />
            </label>
            {riskError ? (
              <div
                aria-live="polite"
                style={{
                  color: "var(--danger-600)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {riskError}
              </div>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button
                kind="default"
                type="button"
                disabled={riskSubmitting}
                onClick={() => setRiskOpen(false)}
              >
                取消
              </Button>
              <Button kind="primary" type="submit" disabled={riskSubmitting}>
                {riskSubmitting ? "更新中" : "更新风险"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {inviteOpen ? (
        <Card title="邀请加入项目" padded={true}>
          <form
            onSubmit={submitInvitation}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label style={panelLabelStyle}>
              邀约项目
              <select
                value={inviteProjectId}
                onChange={(event) => setInviteProjectId(event.target.value)}
                style={panelFieldStyle}
              >
                {projects.length === 0 ? (
                  <option value="">暂无可邀约项目</option>
                ) : (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            {inviteError ? (
              <div
                aria-live="polite"
                style={{
                  color: "var(--danger-600)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {inviteError}
              </div>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Button
                kind="default"
                type="button"
                disabled={inviteSubmitting}
                onClick={() => setInviteOpen(false)}
              >
                取消
              </Button>
              <Button kind="primary" type="submit" disabled={inviteSubmitting}>
                {inviteSubmitting ? "邀约中" : "确认邀约"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {inviteMessage ? (
        <div
          aria-live="polite"
          style={{
            padding: "10px 12px",
            border: "1px solid #B7E6CE",
            borderRadius: 8,
            background: "#ECFDF3",
            color: "var(--ok-600)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {inviteMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="default" style={{ flex: 1 }} onClick={openRiskForm}>
          设置风险
        </Button>
        <Button kind="primary" style={{ flex: 1 }} onClick={openInviteForm}>
          邀请加入项目
        </Button>
      </div>
    </div>
  );
}

function streamerProfileDraftFromCard(streamer) {
  const settlement = streamer?.settlement || {};
  return {
    displayName: streamer?.alias || "",
    realName: streamer?.real || "",
    gender: streamer?.gender || "",
    sourceType: streamerSourceValue(streamer?.source),
    cooperationStatus: streamer?.cooperation || "not_started",
    categories: editableListText(streamer?.games),
    platforms: editableListText(streamer?.platforms),
    styles: editableListText([streamer?.style]),
    defaultSettlementMethod: settlement.method || "cpt",
    defaultHourlyRate:
      settlement.cptHourlyRate > 0 ? String(settlement.cptHourlyRate) : "",
    defaultBaseSalary:
      settlement.baseSalary > 0 ? String(settlement.baseSalary) : "",
    defaultCpsRatePercent:
      settlement.cpsRateBps > 0 ? String(settlement.cpsRateBps / 100) : "",
    reason: "",
  };
}

function streamerSourceValue(source) {
  const values = {
    外部: "external",
    签约: "signed",
    自孵化: "self_incubated",
    供应商: "supplier_recommended",
    代运营: "account_managed",
    external: "external",
    signed: "signed",
    self_incubated: "self_incubated",
    supplier_recommended: "supplier_recommended",
    account_managed: "account_managed",
  };
  return values[source] || "external";
}

function editableListText(values) {
  return (values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "未填写")
    .join(", ");
}

function formatStreamerMoneyK(value) {
  return `¥${(Math.round((Number(value) || 0) / 100) / 10).toFixed(1)}k`;
}

function hasStreamerPerformanceData(streamer) {
  return streamer?.hasPerformanceData !== false;
}

function formatStreamerMoney(value) {
  return `¥${(Number(value) || 0).toFixed(1)}`;
}

function formatStreamerHours(value) {
  return `${(Number(value) || 0).toFixed(1)} h`;
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
  const actions = useOpsLiveActions();
  const [filter, setFilter] = React.useState("pending_review");
  const [activeId, setActiveId] = React.useState(reports[0]?.id ?? null);
  const [exportMessage, setExportMessage] = React.useState("");
  const [exportSubmitting, setExportSubmitting] = React.useState(false);
  const [batchSubmitting, setBatchSubmitting] = React.useState(false);
  const [autoReviewSubmitting, setAutoReviewSubmitting] = React.useState("");

  const counts = {
    all: reports.length,
    pending_review: reports.filter((r) => r.status === "pending_review").length,
    need_supply: reports.filter((r) => r.status === "need_supply").length,
    approved: reports.filter((r) => r.status === "approved").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
  };
  const filtered = React.useMemo(
    () =>
      filter === "all" ? reports : reports.filter((r) => r.status === filter),
    [filter, reports],
  );

  React.useEffect(() => {
    if (filtered.length === 0) {
      if (activeId !== null) {
        setActiveId(null);
      }
      return;
    }

    if (!filtered.some((report) => report.id === activeId)) {
      setActiveId(filtered[0].id);
    }
  }, [activeId, filtered]);

  const activeReport =
    filtered.find((report) => report.id === activeId) || filtered[0] || null;
  const exportReportDetails = async () => {
    setExportSubmitting(true);
    setExportMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "report_details",
        rows: filtered.map((report) => ({
          streamerName: report.streamer,
          settlementDuration: report.duration,
          evidenceLevel: `${report.source} · ${report.status}`,
        })),
      });
      setExportMessage("报数明细导出已生成");
    } catch (error) {
      setExportMessage(error?.message || "报数明细导出失败，请稍后重试");
    } finally {
      setExportSubmitting(false);
    }
  };
  const batchApproveReports = async () => {
    if (batchSubmitting) return;
    const targetReports = filtered.filter(
      (report) => report.status === "pending_review",
    );
    if (targetReports.length === 0) {
      setExportMessage("当前筛选下没有可批量通过的待审核报数。");
      return;
    }

    setBatchSubmitting(true);
    setExportMessage("");
    try {
      for (const report of targetReports) {
        await actions.reviewReport?.(report.id, "approve");
      }
      setExportMessage(`批量审核已通过 ${targetReports.length} 条`);
    } catch (error) {
      setExportMessage(error?.message || "批量审核失败，请稍后重试");
    } finally {
      setBatchSubmitting(false);
    }
  };
  const evaluateAutoReview = async () => {
    if (!activeReport || autoReviewSubmitting) return;
    setAutoReviewSubmitting("evaluate");
    setExportMessage("");
    try {
      const body = await postWarRoomJson(
        "/api/auto-review/evaluate",
        {
          report: buildAutoReviewReportSnapshot(activeReport),
          rule: buildAutoReviewRuleSnapshot(),
        },
        "auto review evaluation failed",
      );
      const result = body.result ?? {};
      setExportMessage(
        `自动审核评估完成：${result.decision || "已返回结果"} · ${result.mode || "shadow"}`,
      );
    } catch (error) {
      setExportMessage(error?.message || "自动审核评估失败，请稍后重试");
    } finally {
      setAutoReviewSubmitting("");
    }
  };
  const readAutoReviewGate = async () => {
    if (autoReviewSubmitting) return;
    setAutoReviewSubmitting("gate");
    setExportMessage("");
    try {
      const body = await getOpsJson(
        "/api/auto-review/rollout-metrics?targetMode=active&explicitActiveRequest=false",
        "auto review rollout metrics failed",
      );
      const gate = body.result?.gate ?? {};
      const summary = body.result?.metrics?.summary ?? {};
      setExportMessage(
        `审核门槛：${gate.effectiveMode || gate.targetMode || "shadow"} · shadow ${summary.shadowSampleCount ?? 0} · audit ${summary.auditSampleCount ?? 0}`,
      );
    } catch (error) {
      setExportMessage(error?.message || "审核门槛读取失败，请稍后重试");
    } finally {
      setAutoReviewSubmitting("");
    }
  };

  return (
    <>
      <PageHeader
        title="下播截图报数 · 审核"
        subtitle="一条任务可能对应多条报数。审核通过的报数将进入可结算池，但不自动生成结算。"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportReportDetails}
              disabled={exportSubmitting}
            >
              {exportSubmitting ? "导出中" : "导出报数明细"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Sparkles size={14} />}
              onClick={evaluateAutoReview}
              disabled={!activeReport || Boolean(autoReviewSubmitting)}
            >
              {autoReviewSubmitting === "evaluate" ? "评估中" : "自动审核评估"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Audit size={14} />}
              onClick={readAutoReviewGate}
              disabled={Boolean(autoReviewSubmitting)}
            >
              {autoReviewSubmitting === "gate" ? "读取中" : "审核门槛"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Check size={14} stroke="#fff" />}
              onClick={batchApproveReports}
              disabled={batchSubmitting}
            >
              {batchSubmitting ? "批量审核中" : "批量审核通过"}
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
        {exportMessage ? (
          <div
            aria-live="polite"
            style={{
              gridColumn: "1 / -1",
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: exportMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {exportMessage}
          </div>
        ) : null}
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
                      {displayRecordId(r.id, "报数记录")}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {displayRecordId(r.taskId, "任务")}
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
        <ReportDetail id={activeId} reports={filtered} />
      </div>
    </>
  );
}

function ReportDetail({ id, reports }) {
  const actions = useOpsLiveActions();
  const [busyDecision, setBusyDecision] = React.useState(null);
  const r = reports.find((x) => x.id === id) || reports[0] || null;
  if (!r) {
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
        <Card>
          <EmptyHint
            title="暂无报数数据"
            hint="报数审核记录会在后端返回后展示。"
          />
        </Card>
      </div>
    );
  }

  const s = STREAMERS.find((s) => s.alias === r.streamer);
  const p = PROJECTS.find((p) => p.id === r.project);
  const projectName = p?.name || r.project;
  const isReviewable = r.status === "pending_review";

  const review = async (decision) => {
    if (!actions.reviewReport || !isReviewable) return;
    setBusyDecision(decision);
    try {
      await actions.reviewReport(r.id, decision);
    } finally {
      setBusyDecision(null);
    }
  };

  // OCR-vs-manual side-by-side
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
      ocr: "live_account",
      manual: "live_account",
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
              {displayRecordId(r.id, "报数记录")} · 任务{" "}
              {displayRecordId(r.taskId, "任务")}
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

        {isReviewable ? (
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
        ) : (
          <div
            style={{
              padding: 12,
              borderTop: "1px solid var(--line)",
              background: "var(--bg-soft)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--ink-500)",
              fontSize: 12,
            }}
          >
            <Badge tone={REPORT_STATUS[r.status].tone}>
              {REPORT_STATUS[r.status].label}
            </Badge>
            该报数已完成当前审核流转。
          </div>
        )}
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

function ScreenAdmission() {
  const applications = useOpsApplications();
  const actions = useOpsLiveActions();
  const [projectBoards, setProjectBoards] = React.useState(null);
  const [selectedProjectId, setSelectedProjectId] = React.useState("");
  const [admissionMessage, setAdmissionMessage] = React.useState("");
  const [busyAction, setBusyAction] = React.useState("");

  const syncAdmissionProjectBoards = async () => {
    if (!actions.refreshAdmissionProjectBoards) {
      return;
    }
    const projects = await actions.refreshAdmissionProjectBoards();
    if (!Array.isArray(projects)) {
      return;
    }
    setProjectBoards(projects);
    setSelectedProjectId(
      (current) => current || projects[0]?.project?.id || "",
    );
  };

  const review = async (applicationId, decision) => {
    if (!actions.reviewApplicationRecording) {
      setAdmissionMessage("录屏审核后台暂未接入。");
      return;
    }
    setBusyAction(`review:${applicationId}:${decision}`);
    setAdmissionMessage("");
    try {
      await actions.reviewApplicationRecording(applicationId, {
        decision,
        note: "经营端选播准入审核",
      });
      await syncAdmissionProjectBoards();
      setAdmissionMessage(recordingDecisionSuccessMessage(decision));
    } catch (error) {
      setAdmissionMessage(error?.message || "录屏审核失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const confirmJoin = async (applicationId) => {
    if (!actions.confirmApplicationJoin) {
      setAdmissionMessage("二次确认后台暂未接入。");
      return;
    }
    setBusyAction(`confirm:${applicationId}`);
    setAdmissionMessage("");
    try {
      await actions.confirmApplicationJoin(applicationId);
      await syncAdmissionProjectBoards();
      setAdmissionMessage("二次确认已完成");
    } catch (error) {
      setAdmissionMessage(error?.message || "二次确认失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };
  const boards = projectBoards ?? buildAdmissionProjectBoards(applications);
  const selectedBoard =
    boards.find((board) => board.project.id === selectedProjectId) ??
    boards[0] ??
    null;
  const selectedApplications = selectedBoard
    ? applications.filter(
        (application) =>
          admissionProjectId(application) === selectedBoard.project.id,
      )
    : [];

  React.useEffect(() => {
    let active = true;
    if (!actions.refreshAdmissionProjectBoards) {
      return () => {
        active = false;
      };
    }
    actions
      .refreshAdmissionProjectBoards()
      .then((projects) => {
        if (!active || !Array.isArray(projects)) return;
        setProjectBoards(projects);
        setSelectedProjectId(
          (current) => current || projects[0]?.project?.id || "",
        );
      })
      .catch((error) =>
        warnBackgroundRefreshFailure("admission project board", error),
      );
    return () => {
      active = false;
    };
  }, [actions]);

  const viewProject = (board) => {
    setSelectedProjectId(board.project.id);
    setAdmissionMessage("");
  };

  const exportAdmissionRecordings = async (board) => {
    if (!actions.exportAdmissionRecordings) {
      setAdmissionMessage("录屏表导出后台暂未接入。");
      return;
    }
    setBusyAction(`export:${board.project.id}`);
    setAdmissionMessage("");
    try {
      const result = await actions.exportAdmissionRecordings(board.project.id);
      downloadAdmissionExport(result);
      setAdmissionMessage(
        result?.filename
          ? `录屏表导出已生成：${result.filename}`
          : "录屏表导出已生成",
      );
    } catch (error) {
      setAdmissionMessage(error?.message || "录屏表导出失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  const createShareBoard = async (board) => {
    if (!actions.createAdmissionShareBoard) {
      setAdmissionMessage("分享链接后台暂未接入。");
      return;
    }
    const projectApplications = applications.filter(
      (application) => admissionProjectId(application) === board.project.id,
    );
    const shareableApplications = projectApplications.filter((application) =>
      isMcnApprovedAdmissionRecording(application),
    );
    const applicationIds = shareableApplications
      .map((application) => application.id)
      .filter(Boolean);
    if (applicationIds.length === 0 && board.counts.mcnApproved === 0) {
      setAdmissionMessage("当前项目暂无 MCN 已通过的可分享录屏");
      return;
    }
    const skippedNotApproved = applicationIds.length
      ? projectApplications.length - shareableApplications.length
      : 0;
    const skippedMessage =
      skippedNotApproved > 0
        ? `（已跳过 ${skippedNotApproved} 条未通过 MCN 初审或暂无录屏）`
        : "";
    setBusyAction(`share:${board.project.id}`);
    setAdmissionMessage("");
    try {
      const result = await actions.createAdmissionShareBoard(board.project.id, {
        title: `${board.project.name || board.project.code || "项目"} 录屏复核`,
        ...(applicationIds.length ? { applicationIds } : {}),
        allowVendorSubmit: true,
      });
      setAdmissionMessage(
        result?.shareUrl
          ? `分享链接已生成：${result.shareUrl}${skippedMessage}`
          : `分享链接已生成${skippedMessage}`,
      );
    } catch (error) {
      setAdmissionMessage(error?.message || "分享链接创建失败，请稍后重试");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <>
      <PageHeader
        title="选播准入"
        subtitle="主播报名 → 试播录屏 → 运营审核 → 二次确认加入项目"
      />
      <div style={{ padding: 20 }}>
        <Card title="项目准入板" padded={false}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <SearchInput placeholder="项目 / 主播 / 报名编号" width={260} />
            <Badge tone="blue">{boards.length} 个项目</Badge>
            <Badge tone="violet">{applications.length} 条准入记录</Badge>
          </div>
          <DataTable
            rows={boards}
            columns={[
              {
                title: "项目",
                render: (board) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{board.project.name}</div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {board.project.code || displayRecordId(board.project.id)}
                    </div>
                  </div>
                ),
              },
              {
                title: "MCN 进度",
                render: (board) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone="blue">
                      录屏 {board.counts.recordingCount}/
                      {board.counts.totalApplications}
                    </Badge>
                    <Badge tone="amber">
                      待审 {board.counts.mcnPendingReview}
                    </Badge>
                    <Badge tone="teal">
                      待确认 {board.counts.pendingFinalConfirm}
                    </Badge>
                  </div>
                ),
              },
              {
                title: "厂家反馈",
                render: (board) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone="teal">
                      厂家已选 {board.counts.vendorSelected}
                    </Badge>
                    <Badge tone="amber">备选 {board.counts.vendorBackup}</Badge>
                    <Badge tone="red">拒绝 {board.counts.vendorRejected}</Badge>
                  </div>
                ),
              },
              {
                title: "分享状态",
                render: (board) => (
                  <Badge
                    tone={board.share.status === "active" ? "green" : "neutral"}
                  >
                    {admissionShareStatusLabel(board.share.status)}
                  </Badge>
                ),
              },
              {
                title: "操作",
                render: (board) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() => viewProject(board)}
                    >
                      查看录屏
                    </Button>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() => exportAdmissionRecordings(board)}
                      disabled={busyAction === `export:${board.project.id}`}
                    >
                      导出录屏表
                    </Button>
                    <Button
                      size="sm"
                      kind="primary"
                      onClick={() => createShareBoard(board)}
                      disabled={
                        busyAction === `share:${board.project.id}` ||
                        board.counts.recordingCount === 0
                      }
                    >
                      创建分享链接
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>
        {admissionMessage ? (
          <div
            aria-live="polite"
            style={{
              marginTop: 12,
              fontSize: 12,
              color: admissionMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-600)",
            }}
          >
            {admissionMessage}
          </div>
        ) : null}
        {selectedBoard ? (
          <Card
            title={`${selectedBoard.project.name || "项目"} · 录屏明细`}
            padded={false}
            style={{ marginTop: 16 }}
          >
            <DataTable
              rows={selectedApplications}
              columns={[
                {
                  title: "报名编号",
                  render: (r) => (
                    <span className="mono" style={{ fontSize: 12 }}>
                      {displayRecordId(r.id, "报名记录")}
                    </span>
                  ),
                },
                {
                  title: "主播",
                  render: (r) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Avatar name={r.streamer?.displayName} size={24} />
                      <div>
                        <div>{r.streamer?.displayName}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                          {admissionAccountLabel(r)}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "录屏",
                  render: (r) => (
                    <div>
                      <Badge tone={r.latestRecording ? "violet" : "amber"}>
                        {r.latestRecording
                          ? r.latestRecording.status
                          : "待上传"}
                      </Badge>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 4,
                        }}
                      >
                        {displayRecordId(r.latestRecording?.id, "暂无录屏")}
                        {r.latestRecording?.version
                          ? ` · v${r.latestRecording.version}`
                          : ""}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "厂家决策",
                  render: (r) => (
                    <div>
                      <Badge
                        tone={vendorDecisionTone(r.vendorReview?.decision)}
                      >
                        {vendorDecisionLabel(r.vendorReview?.decision)}
                      </Badge>
                      {r.vendorReview?.remark ? (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            color: "var(--ink-500)",
                          }}
                        >
                          {r.vendorReview.remark}
                        </div>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: "状态",
                  render: (r) => <Badge tone="neutral">{r.status}</Badge>,
                },
                {
                  title: "操作",
                  render: (r) => {
                    const reviewable = isAdmissionRecordingReviewable(r);
                    const confirmable =
                      r.status === "recording_approved" &&
                      r.vendorReview?.decision === "selected";
                    if (!reviewable && !confirmable) {
                      return (
                        <span style={{ color: "var(--ink-400)" }}>
                          {admissionNextActionLabel(r)}
                        </span>
                      );
                    }
                    return (
                      <div style={{ display: "flex", gap: 6 }}>
                        {reviewable ? (
                          <>
                            <Button
                              size="sm"
                              kind="default"
                              onClick={() => review(r.id, "needs_changes")}
                              disabled={
                                busyAction === `review:${r.id}:needs_changes`
                              }
                            >
                              需补充
                            </Button>
                            <Button
                              size="sm"
                              kind="default"
                              onClick={() => review(r.id, "rejected")}
                              disabled={
                                busyAction === `review:${r.id}:rejected`
                              }
                            >
                              驳回
                            </Button>
                            <Button
                              size="sm"
                              kind="primary"
                              onClick={() => review(r.id, "approved")}
                              disabled={
                                busyAction === `review:${r.id}:approved`
                              }
                            >
                              通过
                            </Button>
                          </>
                        ) : null}
                        {confirmable ? (
                          <Button
                            size="sm"
                            kind="default"
                            onClick={() => confirmJoin(r.id)}
                            disabled={busyAction === `confirm:${r.id}`}
                          >
                            二次确认
                          </Button>
                        ) : null}
                      </div>
                    );
                  },
                },
              ]}
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}

function downloadAdmissionExport(result) {
  if (
    !result?.content ||
    !result?.filename ||
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const blob = new Blob(["\uFEFF", result.content], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = result.filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL?.(href);
}

function buildAdmissionProjectBoards(applications = []) {
  const boards = new Map();
  for (const application of applications) {
    const project = admissionProject(application);
    const current = boards.get(project.id) ?? {
      project,
      counts: {
        totalApplications: 0,
        recordingCount: 0,
        mcnPendingReview: 0,
        mcnApproved: 0,
        mcnRejected: 0,
        needsChanges: 0,
        vendorPending: 0,
        vendorSelected: 0,
        vendorBackup: 0,
        vendorRejected: 0,
        vendorNeedsChanges: 0,
        pendingFinalConfirm: 0,
      },
      share: {
        id: null,
        status: "unshared",
        expiresAt: null,
        lastSubmittedAt: null,
      },
      lastActivityAt: application.submittedAt ?? null,
    };
    incrementAdmissionCounts(current, application);
    boards.set(project.id, current);
  }
  return [...boards.values()];
}

function incrementAdmissionCounts(board, application) {
  const status = application.status;
  const recordingStatus = application.latestRecording?.status;
  const decision = application.vendorReview?.decision || "pending";
  board.counts.totalApplications += 1;
  if (application.latestRecording) board.counts.recordingCount += 1;
  if (
    [
      "recording_reviewing",
      "pending_recording_review",
      "pending_review",
    ].includes(status) ||
    ["submitted", "reviewing", "pending_review"].includes(recordingStatus)
  ) {
    board.counts.mcnPendingReview += 1;
  }
  if (status === "recording_approved" || status === "joined") {
    board.counts.mcnApproved += 1;
  }
  if (status === "recording_rejected" || recordingStatus === "rejected") {
    board.counts.mcnRejected += 1;
  }
  if (status === "recording_required" || recordingStatus === "needs_changes") {
    board.counts.needsChanges += 1;
  }
  if (status === "recording_approved") {
    board.counts.pendingFinalConfirm += 1;
  }
  if (decision === "pending") board.counts.vendorPending += 1;
  if (decision === "selected") board.counts.vendorSelected += 1;
  if (decision === "backup") board.counts.vendorBackup += 1;
  if (decision === "rejected") board.counts.vendorRejected += 1;
  if (decision === "needs_changes") board.counts.vendorNeedsChanges += 1;
}

function isAdmissionRecordingReviewable(application) {
  const status = application.status;
  const recordingStatus = application.latestRecording?.status;
  return (
    Boolean(application.latestRecording) &&
    ([
      "recording_reviewing",
      "pending_recording_review",
      "pending_review",
    ].includes(status) ||
      ["submitted", "reviewing", "pending_review"].includes(recordingStatus))
  );
}

function isMcnApprovedAdmissionRecording(application) {
  return (
    application.status === "recording_approved" &&
    application.latestRecording?.status === "approved"
  );
}

function admissionNextActionLabel(application) {
  const decision = application.vendorReview?.decision;
  if (decision === "selected" && application.status === "recording_approved") {
    return "邀请进入项目";
  }
  if (decision === "backup") return "厂家备选，等待最终名额";
  if (decision === "rejected") return "等待主播重新上传";
  if (decision === "needs_changes") return "等待主播补充录屏";
  if (isAdmissionRecordingReviewable(application)) return "MCN 初审";
  if (!application.latestRecording) return "等待录屏";
  return "无需操作";
}

function recordingDecisionSuccessMessage(decision) {
  if (decision === "approved") return "录屏已通过";
  if (decision === "rejected") return "录屏已驳回";
  return "已要求补充录屏";
}

function admissionProject(application) {
  const project = application.project ?? {};
  return {
    id: admissionProjectId(application),
    code: project.code || application.projectCode || "",
    name:
      project.name ||
      application.projectName ||
      displayRecordId(admissionProjectId(application), "项目记录"),
    status: project.status || application.projectStatus || "",
    vendor: project.vendor || application.vendor || "",
    product: project.product || application.product || "",
  };
}

function admissionProjectId(application) {
  return application.project?.id || application.projectId || "unknown-project";
}

function admissionAccountLabel(application) {
  return (
    application.streamer?.accountLabel ||
    application.streamer?.account ||
    application.streamer?.platformAccount ||
    "未配置账号"
  );
}

function admissionShareStatusLabel(status) {
  const labels = {
    unshared: "未分享",
    active: "已分享",
    expired: "已过期",
    revoked: "已撤销",
  };
  return labels[status] || status;
}

function vendorDecisionLabel(decision) {
  const labels = {
    pending: "待厂家反馈",
    selected: "厂家已选",
    backup: "厂家备选",
    rejected: "厂家拒绝",
    needs_changes: "需修改",
  };
  return labels[decision || "pending"] || decision;
}

function vendorDecisionTone(decision) {
  const tones = {
    selected: "teal",
    backup: "amber",
    rejected: "red",
    needs_changes: "violet",
  };
  return tones[decision] || "neutral";
}

function askText(label, defaultValue = "") {
  const value = globalThis.prompt?.(label, defaultValue);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatOpsMinute(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "刚刚";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`;
}

function numberFromSnapshot(snapshot, key) {
  const value = snapshot && typeof snapshot === "object" ? snapshot[key] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textFromSnapshot(snapshot, key, fallback = "unknown") {
  const value = snapshot && typeof snapshot === "object" ? snapshot[key] : null;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toReferenceReportFromApi(report) {
  return {
    id: report.id,
    date: String(report.submittedAt || "").slice(0, 10),
    streamer: report.streamerName || "Unknown streamer",
    streamerId: report.streamerId || report.streamerName || "Unknown streamer",
    project: report.projectName || "Unknown project",
    taskId: report.taskId || report.taskTitle || "Unknown task",
    duration: Math.round(((report.settlementDuration ?? 0) / 60) * 10) / 10,
    audience: report.viewers ?? 0,
    status:
      report.status === "pending_adjudication"
        ? "pending_review"
        : report.status === "need_more"
          ? "need_supply"
          : report.status || "pending_review",
    screens: 1,
    source: report.timeSource === "claimed" ? "manual" : "OCR",
    note: `${report.timeSource ?? "unknown"} · ${report.evidenceLevel ?? "unknown"}`,
  };
}

function toReferenceBatchFromApi(batch, items, context = {}) {
  const isPayable = batch.batchType === "payable";
  const projectName =
    batch.projectName ||
    context.pool?.find((row) => row.project)?.project ||
    context.activeBatch?.project ||
    displayRecordId(batch.projectId, "项目");
  const amount =
    Number(batch.totalAmount ?? 0) ||
    Number(batch.computedAmount ?? 0) +
      Number(batch.manualAmount ?? 0) +
      Number(batch.adjustmentAmount ?? 0);

  return {
    id: batch.id,
    projectId: batch.projectId,
    type: isPayable ? "streamer_payable" : "vendor_receivable",
    name: `${projectName} · ${isPayable ? "主播应付" : "厂家应收"}`,
    project: projectName,
    vendor: isPayable ? "—" : projectName,
    period: `${batch.periodStart} → ${batch.periodEnd}`,
    items:
      typeof batch.itemCount === "number"
        ? batch.itemCount
        : Array.isArray(items)
          ? items.length
          : 0,
    amount,
    status:
      batch.status === "pending"
        ? "pending_confirm"
        : batch.status || "generated",
    updated: formatOpsMinute(batch.updatedAt || batch.createdAt),
    creator: batch.createdBy || "system",
  };
}

function toReferenceBatchDetailFromApi(item, pool = [], index = 0) {
  const snapshot = item.evidenceSnapshot || {};
  const settlementDuration =
    typeof item.settlementDuration === "number"
      ? item.settlementDuration
      : numberFromSnapshot(snapshot, "settlementDuration");
  const settlementMethod = textFromSnapshot(
    snapshot,
    "settlementMethod",
    item.itemType,
  );
  const timeSource =
    item.timeSource || textFromSnapshot(snapshot, "timeSource");
  const sourceReport = pool.find((row) => row.id === item.liveReportId);
  const computedAmount = Number(item.systemAmount ?? item.computedAmount ?? 0);
  const manualAmount = Number(item.manualAmount ?? 0);
  const adjustmentAmount = Number(item.adjustmentAmount ?? 0);
  const total =
    Number(item.totalAmount ?? 0) ||
    computedAmount + manualAmount + adjustmentAmount;

  return {
    streamer:
      item.streamerName ||
      sourceReport?.streamer ||
      displayRecordId(item.streamerId, `主播 ${index + 1}`),
    id: item.id,
    rule:
      item.itemType === "live_report"
        ? `${settlementMethod} · 系统结算`
        : `${String(item.itemType).toUpperCase()} · 人工承载`,
    hours: Math.round((settlementDuration / 60) * 10) / 10,
    qty: `${item.evidenceLevel ?? "unknown"} · ${timeSource}`,
    base: 0,
    variable: computedAmount + manualAmount,
    adjust: adjustmentAmount,
    total,
  };
}

function toReferenceSettlementPoolFromApi(item) {
  return {
    id: item.id,
    streamer: item.streamerName || "Unknown streamer",
    project: item.projectName || "Unknown project",
    hours: Math.round(((item.settlementDuration ?? 0) / 60) * 10) / 10,
    evidence: `${item.evidenceLevel ?? "unknown"} · ${item.timeSource ?? "unknown"}`,
    rule: item.settlementMethod || "manual",
    expected: Number(item.expectedAmount ?? 0),
    approvedAt: formatOpsMinute(item.approvedAt),
  };
}

function toSettlementPoolFromReviewedReport(report, sourceReport) {
  const settlementDuration = Number(
    report.settlementDuration ?? (sourceReport?.duration ?? 0) * 60,
  );
  const evidenceLevel = report.evidenceLevel ?? "unknown";
  const timeSource = report.timeSource ?? "unknown";

  return {
    id: report.id || sourceReport?.id,
    streamer:
      sourceReport?.streamer || displayRecordId(report.streamerId, "主播"),
    project: sourceReport?.project || displayRecordId(report.projectId, "项目"),
    hours: Math.round((settlementDuration / 60) * 10) / 10,
    evidence: `${evidenceLevel} · ${timeSource}`,
    rule: "cpt",
    expected: Math.round((settlementDuration / 60) * 80),
    approvedAt: formatOpsMinute(
      report.reviewedAt || report.updatedAt || new Date().toISOString(),
    ),
  };
}

// ===== src\screen-settlement.jsx =====
// ——— Screen: 结算中心 ————————————————————————————

function ScreenSettlement({ go }) {
  const batches = useOpsSettlementBatches();
  const batchDetails = useOpsSettlementBatchDetails();
  const settlementPool = useOpsSettlementPool();
  const settlementScope = useOpsSettlementScope();
  const actions = useOpsLiveActions();
  const [type, setType] = React.useState("all");
  const [busyAction, setBusyAction] = React.useState(null);
  const [activeId, setActiveId] = React.useState(batches[0]?.id ?? null);
  const [batchFormOpen, setBatchFormOpen] = React.useState(false);
  const [manualFormOpen, setManualFormOpen] = React.useState(false);
  const [settlementMessage, setSettlementMessage] = React.useState("");
  const [batchDraft, setBatchDraft] = React.useState({
    projectId: settlementScope?.projectId || "",
    periodStart: settlementScope?.periodStart || "",
    periodEnd: settlementScope?.periodEnd || "",
    batchType: "payable",
  });
  const [manualDraft, setManualDraft] = React.useState({
    itemType: "cpa",
    manualAmount: "300",
    evidenceLevel: "red",
    reason: "人工录入 CPA/CPS/礼物金额",
  });

  React.useEffect(() => {
    if (!batches.some((b) => b.id === activeId)) {
      setActiveId(batches[0]?.id ?? null);
    }
  }, [activeId, batches]);

  const filtered =
    type === "all" ? batches : batches.filter((b) => b.type === type);
  const activeBatch =
    batches.find((batch) => batch.id === activeId) || batches[0] || null;
  const poolCount =
    settlementPool.length > 0
      ? settlementPool.length
      : (settlementScope?.poolCount ?? 0);
  const settlementSummary = React.useMemo(() => {
    const vendorBatches = batches.filter((batch) => {
      return batch.type === "vendor_receivable";
    });
    const lockedPayableBatches = batches.filter((batch) => {
      return batch.type === "streamer_payable" && batch.status === "locked";
    });
    const vendorReceivable = sumSettlementBatchAmounts(vendorBatches);
    const lockedPayable = sumSettlementBatchAmounts(lockedPayableBatches);
    const gross = vendorReceivable - lockedPayable;
    const marginRate =
      vendorReceivable > 0 ? (gross / vendorReceivable) * 100 : 0;

    return {
      vendorReceivable,
      vendorBatchCount: vendorBatches.length,
      lockedPayable,
      lockedPayableBatchCount: lockedPayableBatches.length,
      gross,
      marginRate,
    };
  }, [batches]);

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

  React.useEffect(() => {
    setBatchDraft((draft) => ({
      ...draft,
      projectId:
        draft.projectId ||
        settlementScope?.projectId ||
        activeBatch?.projectId ||
        "",
      periodStart: draft.periodStart || settlementScope?.periodStart || "",
      periodEnd: draft.periodEnd || settlementScope?.periodEnd || "",
    }));
  }, [activeBatch, settlementScope]);

  const updateBatchDraft = (field) => (event) => {
    setBatchDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };
  const updateManualDraft = (field) => (event) => {
    setManualDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };

  const createBatch = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("create", async () => {
      const { projectId, periodStart, periodEnd, batchType } = batchDraft;
      if (!projectId || !periodStart || !periodEnd || !batchType) {
        setSettlementMessage("请填写完整结算批次信息");
        return false;
      }

      await actions.createSettlementBatch?.({
        projectId,
        periodStart,
        periodEnd,
        batchType,
      });
      setBatchFormOpen(false);
      setSettlementMessage("");
      return false;
    });
  };

  const addManualItem = (event) => {
    event?.preventDefault?.();
    return runSettlementAction("manual", async () => {
      if (!activeBatch) return false;
      const manualAmount = Number(manualDraft.manualAmount);
      if (!manualDraft.itemType || !manualAmount || !manualDraft.reason) {
        setSettlementMessage("请填写完整人工调整信息");
        return false;
      }

      await actions.addManualSettlementItem?.(activeBatch.id, {
        itemType: manualDraft.itemType,
        manualAmount,
        evidenceLevel:
          manualDraft.evidenceLevel === "yellow" ? "yellow" : "red",
        reason: manualDraft.reason,
        projectId: activeBatch.projectId,
      });
      setManualFormOpen(false);
      setSettlementMessage("");
      return false;
    });
  };

  const lockBatch = () =>
    runSettlementAction("lock", async () => {
      if (!activeBatch) return false;
      await actions.lockSettlementBatch?.(activeBatch.id, {
        reason: "财务核对无误",
      });
      return false;
    });

  const reopenBatch = () =>
    runSettlementAction("reopen", async () => {
      if (!activeBatch) return false;
      await actions.reopenSettlementBatch?.(activeBatch.id, {
        reason: "需要修正结算金额",
      });
      return false;
    });
  const exportBatches = () =>
    runSettlementAction("export", async () => {
      await actions.createGovernedExport?.({
        kind: "settlement_batch",
        rows: filtered.map((batch) => ({
          batchName: batch.name,
          payableAmountCents:
            batch.type === "streamer_payable" ? batch.amount * 100 : 0,
          vendorReceivableCents:
            batch.type === "vendor_receivable" ? batch.amount * 100 : 0,
        })),
      });
      setSettlementMessage("结算批次导出已生成");
      return false;
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
              onClick={() => {
                setManualFormOpen((value) => !value);
                setSettlementMessage("");
              }}
              disabled={!!busyAction}
            >
              {busyAction === "manual" ? "处理中…" : "导入 CPA / CPS 数据"}
            </Button>
            <Button
              kind="default"
              icon={<Icon.Export size={14} />}
              onClick={exportBatches}
              disabled={!!busyAction}
            >
              {busyAction === "export" ? "导出中…" : "批次导出"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => {
                setBatchFormOpen((value) => !value);
                setSettlementMessage("");
              }}
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
              value={String(poolCount)}
              unit="条"
              hint="审核通过 · 待入批次"
            />
          </Card>
          <Card>
            <Metric
              label="本月厂家应收 (草稿)"
              value={formatSettlementCurrency(
                settlementSummary.vendorReceivable,
              )}
              hint={settlementBatchHint(
                settlementSummary.vendorBatchCount,
                "应收",
              )}
            />
          </Card>
          <Card>
            <Metric
              label="本月主播应付 (锁定)"
              value={formatSettlementCurrency(settlementSummary.lockedPayable)}
              hint={settlementBatchHint(
                settlementSummary.lockedPayableBatchCount,
                "锁定",
              )}
            />
          </Card>
          <Card style={{ borderColor: "var(--blue-200)" }}>
            <Metric
              label="本月预估毛利"
              value={formatSettlementCurrency(settlementSummary.gross)}
              delta={`${settlementSummary.marginRate.toFixed(1)}% 毛利率`}
              deltaTone={settlementSummary.gross >= 0 ? "green" : "red"}
            />
          </Card>
        </div>

        {settlementMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: settlementMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {settlementMessage}
          </div>
        ) : null}

        {batchFormOpen ? (
          <form
            onSubmit={createBatch}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1fr) 150px 150px 160px auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="结算项目 ID">
              <input
                value={batchDraft.projectId}
                onChange={updateBatchDraft("projectId")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="周期开始">
              <input
                type="date"
                value={batchDraft.periodStart}
                onChange={updateBatchDraft("periodStart")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="周期结束">
              <input
                type="date"
                value={batchDraft.periodEnd}
                onChange={updateBatchDraft("periodEnd")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="批次类型">
              <select
                value={batchDraft.batchType}
                onChange={updateBatchDraft("batchType")}
                style={taskInputStyle}
              >
                <option value="payable">主播应付</option>
                <option value="receivable">厂家应收</option>
              </select>
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认新建批次
            </Button>
          </form>
        ) : null}

        {manualFormOpen ? (
          <form
            onSubmit={addManualItem}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 140px 140px minmax(220px, 1fr) auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="人工项目类型">
              <select
                value={manualDraft.itemType}
                onChange={updateManualDraft("itemType")}
                style={taskInputStyle}
              >
                <option value="cpa">CPA</option>
                <option value="cps">CPS</option>
                <option value="gift">礼物</option>
                <option value="manual">手工</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工金额">
              <input
                value={manualDraft.manualAmount}
                onChange={updateManualDraft("manualAmount")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="证据等级">
              <select
                value={manualDraft.evidenceLevel}
                onChange={updateManualDraft("evidenceLevel")}
                style={taskInputStyle}
              >
                <option value="red">red</option>
                <option value="yellow">yellow</option>
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="人工原因">
              <input
                value={manualDraft.reason}
                onChange={updateManualDraft("reason")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认导入人工金额
            </Button>
          </form>
        ) : null}

        <SettlementPoolPreview
          rows={settlementPool}
          settlementScope={settlementScope}
        />

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
                        {displayRecordId(r.id, "结算批次")}
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
            onAddManualItem={() => {
              setManualFormOpen(true);
              setSettlementMessage("");
            }}
            onLockBatch={lockBatch}
            onReopenBatch={reopenBatch}
            busyAction={busyAction}
          />
        </div>
      </div>
    </>
  );
}

function sumSettlementBatchAmounts(batches) {
  return batches.reduce((sum, batch) => sum + Number(batch.amount ?? 0), 0);
}

function formatSettlementCurrency(value) {
  const amount = Math.round(Number(value) || 0);
  const prefix = amount < 0 ? "-¥" : "¥";
  return `${prefix}${Math.abs(amount).toLocaleString()}`;
}

function settlementBatchHint(count, label) {
  return count > 0 ? `${count} 个${label}批次` : `暂无${label}批次`;
}

function SettlementPoolPreview({ rows, settlementScope }) {
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}
          >
            可结算池预览
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 3 }}
          >
            {settlementScope
              ? `${settlementScope.periodStart} → ${settlementScope.periodEnd}`
              : "等待审核通过报数进入池子"}
          </div>
        </div>
        <Badge tone={rows.length > 0 ? "green" : "neutral"} dot>
          {rows.length > 0 ? `${rows.length} 条待入批次` : "暂无待入批次"}
        </Badge>
      </div>
      <DataTable
        dense
        emptyText="暂无审核通过且未入批次的报数"
        columns={[
          {
            title: "报数",
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
                    {displayRecordId(r.id, "结算项")}
                  </div>
                </div>
              </div>
            ),
          },
          {
            title: "项目",
            render: (r) => <span style={{ fontSize: 12 }}>{r.project}</span>,
          },
          {
            title: "有效时长",
            align: "right",
            render: (r) => <span className="num">{r.hours.toFixed(1)} h</span>,
          },
          {
            title: "证据",
            render: (r) => (
              <Badge tone={settlementEvidenceTone(r.evidence)}>
                {r.evidence}
              </Badge>
            ),
          },
          {
            title: "规则",
            render: (r) => <Badge tone="blue">{r.rule}</Badge>,
          },
          {
            title: "预计金额",
            align: "right",
            render: (r) => (
              <span
                className="num"
                style={{ fontWeight: 700, color: "var(--ink-900)" }}
              >
                ¥{r.expected.toLocaleString()}
              </span>
            ),
          },
          {
            title: "审核时间",
            align: "right",
            render: (r) => (
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-400)" }}
              >
                {r.approvedAt}
              </span>
            ),
          },
        ]}
        rows={rows}
      />
    </Card>
  );
}

function settlementEvidenceTone(value) {
  if (String(value).startsWith("green")) return "green";
  if (String(value).startsWith("yellow")) return "amber";
  if (String(value).startsWith("red")) return "red";
  return "neutral";
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
  const [detailMessage, setDetailMessage] = React.useState("");
  const b = batches.find((x) => x.id === id) || batches[0] || BATCHES[1];
  if (!b) {
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
        <Card>
          <EmptyHint title="暂无结算批次" hint="结算批次会在后端返回后展示。" />
        </Card>
      </div>
    );
  }

  const isPayable = b.type === "streamer_payable";
  const isLocked = b.status === "locked";
  const batchStatus = BATCH_STATUS[b.status] || BATCH_STATUS.pending_confirm;
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
  const showPendingDetail = (message) => {
    setDetailMessage(message);
  };

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
                {displayRecordId(b.id, "结算批次")}
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
                <Badge tone={batchStatus.tone} dot>
                  {batchStatus.label}
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
                      {displayRecordId(r.id, "结算项")}
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
        {detailMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px 0",
              fontSize: 12,
              color: "var(--ink-500)",
            }}
          >
            {detailMessage}
          </div>
        ) : null}

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
              <Button
                kind="ghost"
                icon={<Icon.History size={14} />}
                onClick={() =>
                  showPendingDetail(
                    "批次审计明细后台暂未接入，请查看下方审计轨迹。",
                  )
                }
              >
                查看审计
              </Button>
              <Button
                kind="default"
                icon={<Icon.Export size={14} />}
                onClick={() => showPendingDetail("批次 PDF 导出后台暂未接入。")}
              >
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
              <Button
                kind="ghost"
                onClick={() =>
                  showPendingDetail("批次编辑已取消，未提交后台变更。")
                }
              >
                取消
              </Button>
              <Button
                kind="default"
                icon={<Icon.Plus size={14} />}
                onClick={onAddManualItem}
                disabled={!!busyAction}
              >
                {busyAction === "manual" ? "处理中…" : "添加人工调整"}
              </Button>
              <Button
                kind="default"
                onClick={() => showPendingDetail("批次草稿保存后台暂未接入。")}
              >
                保存为草稿
              </Button>
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
        <EmptyHint
          title="暂无审计轨迹"
          hint="批次操作日志会在后端返回后展示。"
        />
      </Card>
    </div>
  );
}

// ===== src\screen-tasks.jsx =====
// ——— Screen: 排班与任务 ————————————————————————

function ScreenTasks({ go }) {
  const tasks = useOpsTasks();
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const applications = useOpsApplications();
  const actions = useOpsLiveActions();
  const {
    projects: projectData,
    streamers: streamerData,
    applications: applicationData,
  } = React.useContext(OpsLiveDataContext);
  const [view, setView] = React.useState("board");
  const [project, setProject] = React.useState("all");
  const [streamerFilter, setStreamerFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [selectedTask, setSelectedTask] = React.useState(null);
  const [busyAction, setBusyAction] = React.useState(null);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchDraft, setBatchDraft] = React.useState({
    projectId: "",
    streamerIds: "",
    dateKey: formatDateKey(new Date()),
    startTime: "20:00",
    endTime: "23:30",
  });
  const [taskMessage, setTaskMessage] = React.useState("");

  const liveCount = tasks.filter((t) => t.status === "live").length;
  const pendingReportCount = tasks.filter(
    (t) => t.status === "pending_report",
  ).length;
  const pendingReviewCount = tasks.filter(
    (t) => t.status === "pending_review",
  ).length;
  const anomalyCount = tasks.filter(isTaskOperationalAnomaly).length;
  const todayCount = tasks.filter(
    (t) => t.dayIdx === SCHEDULE_WEEK.todayIdx,
  ).length;
  const taskFilters = {
    project,
    streamer: streamerFilter,
    status: statusFilter,
  };
  const filteredTasks = tasks.filter((task) =>
    taskMatchesTaskFilters(task, taskFilters, projects),
  );
  const selectedProject =
    project === "all" ? null : projects.find((item) => item.id === project);

  React.useEffect(() => {
    if (projectData == null && actions.refreshProjects) {
      actions
        .refreshProjects()
        .catch((error) => warnBackgroundRefreshFailure("tasks", error));
    }
  }, [actions, projectData]);

  React.useEffect(() => {
    if (streamerData == null && actions.refreshStreamers) {
      actions
        .refreshStreamers()
        .catch((error) => warnBackgroundRefreshFailure("tasks", error));
    }
  }, [actions, streamerData]);

  React.useEffect(() => {
    setBatchDraft((draft) => {
      const nextProjectId = draft.projectId || projects[0]?.id || "";
      const nextStreamerIds =
        draft.streamerIds ||
        joinedStreamersForProject(nextProjectId, streamers, applications)
          .map((streamer) => streamer.id)
          .join(",");
      if (
        draft.projectId === nextProjectId &&
        draft.streamerIds === nextStreamerIds
      ) {
        return draft;
      }
      return {
        ...draft,
        projectId: nextProjectId,
        streamerIds: nextStreamerIds,
      };
    });
  }, [applications, projects, streamers]);

  React.useEffect(() => {
    if (applicationData == null && actions.refreshApplications) {
      actions
        .refreshApplications()
        .catch((error) => warnBackgroundRefreshFailure("tasks", error));
    }
  }, [actions, applicationData]);

  React.useEffect(() => {
    if (project === "all") return;
    setBatchDraft((draft) =>
      draft.projectId === project ? draft : { ...draft, projectId: project },
    );
  }, [project]);

  const runTaskAction = async (actionName, fn) => {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      await fn();
    } catch (error) {
      setTaskMessage(formatTaskActionError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const openNewTask = () => {
    const defaultProject =
      project === "all"
        ? projects[0]
        : projects.find((item) => item.id === project);
    if (!defaultProject) {
      globalThis.alert?.("请先创建项目和主播档案。");
      return;
    }
    const eligibleStreamers = joinedStreamersForProject(
      defaultProject.id,
      streamers,
      applications,
    );
    const defaultStreamer =
      streamerFilter === "all"
        ? eligibleStreamers[0]
        : eligibleStreamers.find((item) => item.id === streamerFilter);

    setSelectedTask({
      _new: true,
      dayIdx: SCHEDULE_WEEK.todayIdx,
      projectId: defaultProject.id,
      streamerId: defaultStreamer?.id || "",
    });
  };

  const createTask = async (input) => {
    await runTaskAction("create", async () => {
      await actions.createLiveTask?.(input);
      const taskProject = projects.find((item) => item.id === input.projectId);
      setTaskMessage(
        `已创建任务并绑定项目：${
          taskProject?.name || displayRecordId(input.projectId, "项目")
        }`,
      );
      setSelectedTask(null);
    });
  };

  const cancelTask = async (task) => {
    await runTaskAction("cancel", async () => {
      await actions.cancelLiveTask?.(task.id, {
        reason: "经营端页面取消任务",
      });
      setSelectedTask(null);
    });
  };

  const updateBatchDraft = (field) => (event) => {
    setBatchDraft((draft) => ({ ...draft, [field]: event.target.value }));
  };

  const submitBatchTasks = (event) => {
    event.preventDefault();
    return runTaskAction("batch", async () => {
      const project = projectById(batchDraft.projectId, projects);
      if (!project) {
        setTaskMessage("请先选择项目");
        return;
      }

      const plannedStartAt = scheduleTimeToIso(
        batchDraft.dateKey,
        batchDraft.startTime,
      );
      const plannedEndAt = scheduleTimeToIso(
        batchDraft.dateKey,
        batchDraft.endTime,
      );
      const plannedDuration = scheduleMinutes(plannedStartAt, plannedEndAt);
      const eligibleStreamers = joinedStreamersForProject(
        project.id,
        streamers,
        applications,
      );
      const batchTasks = batchDraft.streamerIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((streamerId) => {
          const streamer = eligibleStreamers.find(
            (item) => item.id === streamerId,
          );
          if (!streamer) {
            return null;
          }
          return {
            projectId: project.id,
            streamerId: streamer.id,
            title: `${project.name} · ${streamer.alias}`,
            plannedStartAt,
            plannedEndAt,
            plannedDuration,
            note: "经营端批量排班创建",
          };
        })
        .filter(Boolean);

      if (batchTasks.length === 0) {
        setTaskMessage(JOINED_STREAMER_REQUIRED_MESSAGE);
        return;
      }

      setTaskMessage("");
      await actions.createLiveTasks?.({ tasks: batchTasks });
      setTaskMessage(
        `已为 ${project.name} 创建 ${batchTasks.length} 个排班任务`,
      );
      setBatchOpen(false);
    });
  };

  return (
    <>
      <PageHeader
        title="排班与任务"
        subtitle="项目维度排班看板 + 任务表格 · 任务完成依据为报数审核通过"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Upload size={14} />}
              onClick={() => setTaskMessage("Excel 导入后台暂未接入")}
            >
              从 Excel 导入
            </Button>
            <Button
              kind="default"
              icon={<Icon.Calendar size={14} />}
              onClick={() => {
                setBatchOpen((value) => !value);
                setTaskMessage("");
              }}
              disabled={!!busyAction}
            >
              {busyAction === "batch" ? "排班中…" : "批量排班"}
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={openNewTask}
              disabled={!!busyAction}
            >
              {busyAction === "create" ? "创建中…" : "新建任务"}
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
              hint={SCHEDULE_WEEK.days[SCHEDULE_WEEK.todayIdx]?.date ?? "本周"}
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
              hint={`共 ${streamers.length} 位主播`}
            />
          </Card>
        </div>

        <TaskProjectMappingStrip
          project={selectedProject}
          projects={projects}
          tasks={filteredTasks}
          totalTasks={tasks.length}
          onOpenProject={
            selectedProject ? () => go("project", selectedProject.id) : null
          }
        />

        {taskMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: taskMessage.includes("失败")
                ? "var(--danger-600)"
                : "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {taskMessage}
          </div>
        ) : null}

        {batchOpen ? (
          <form
            onSubmit={submitBatchTasks}
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(160px, 0.9fr) minmax(220px, 1.2fr) 150px 120px 120px auto",
              alignItems: "end",
              gap: 10,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
            }}
          >
            <TaskFormLabel label="批量排班项目">
              <select
                value={batchDraft.projectId}
                onChange={updateBatchDraft("projectId")}
                style={taskInputStyle}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </TaskFormLabel>
            <TaskFormLabel label="批量排班主播">
              <input
                value={batchDraft.streamerIds}
                onChange={updateBatchDraft("streamerIds")}
                placeholder="streamer-one,streamer-two"
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="排班日期">
              <input
                type="date"
                value={batchDraft.dateKey}
                onChange={updateBatchDraft("dateKey")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="开始时间">
              <input
                type="time"
                value={batchDraft.startTime}
                onChange={updateBatchDraft("startTime")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <TaskFormLabel label="结束时间">
              <input
                type="time"
                value={batchDraft.endTime}
                onChange={updateBatchDraft("endTime")}
                style={taskInputStyle}
              />
            </TaskFormLabel>
            <Button kind="primary" type="submit" disabled={!!busyAction}>
              确认批量排班
            </Button>
          </form>
        ) : null}

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
              <ProjectFilter
                value={project}
                onChange={setProject}
                projects={projects}
              />
              <TaskInlineFilter
                label="主播筛选"
                value={streamerFilter}
                onChange={setStreamerFilter}
                options={streamers.map((streamer) => ({
                  value: streamer.id,
                  label: streamer.alias,
                }))}
              />
              <TaskInlineFilter
                label="状态筛选"
                value={statusFilter}
                onChange={setStatusFilter}
                options={Object.entries(TASK_STATUS).map(([value, item]) => ({
                  value,
                  label: item.label,
                }))}
              />
            </div>
          </div>

          <div>
            {view === "board" && (
              <ScheduleBoard
                filters={taskFilters}
                onSelectTask={setSelectedTask}
              />
            )}
            {view === "list" && (
              <TaskList
                tasks={filteredTasks}
                projects={projects}
                streamers={streamers}
                onSelectTask={setSelectedTask}
              />
            )}
            {view === "anomaly" && (
              <AnomalyList
                tasks={filteredTasks}
                projects={projects}
                streamers={streamers}
              />
            )}
            {view === "mine" && <MyTasksView />}
          </div>
        </Card>
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          projects={projects}
          streamers={streamers}
          applications={applications}
          onClose={() => setSelectedTask(null)}
          onCreateTask={createTask}
          onCancelTask={cancelTask}
          busyAction={busyAction}
          go={go}
        />
      )}
    </>
  );
}

const taskInputStyle = {
  width: "100%",
  height: 32,
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
  background: "#fff",
  color: "var(--ink-700)",
  fontSize: 13,
  outline: "none",
  padding: "0 10px",
};

function TaskFormLabel({ label, children }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: "var(--ink-500)",
        fontWeight: 600,
        minWidth: 0,
      }}
    >
      {label}
      {children}
    </label>
  );
}

function ProjectFilter({ value, onChange, projects = [] }) {
  return (
    <select
      aria-label="项目筛选"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      style={{ ...taskInputStyle, width: 150, height: 28, fontSize: 12 }}
    >
      <option value="all">全部项目</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}

function TaskInlineFilter({ label, value, onChange, options }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      style={{ ...taskInputStyle, width: 122, height: 28, fontSize: 12 }}
    >
      <option value="all">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TaskProjectMappingStrip({
  project,
  projects = [],
  tasks = [],
  totalTasks = 0,
  onOpenProject,
}) {
  const anomalyCount = tasks.filter(isTaskOperationalAnomaly).length;
  const pendingCount = tasks.filter((task) =>
    ["pending_live", "live", "pending_report", "pending_review"].includes(
      task.status,
    ),
  ).length;

  if (!project) {
    return (
      <div
        style={{
          padding: "10px 12px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--bg-soft)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          color: "var(--ink-600)",
        }}
      >
        <Icon.Project size={15} stroke="var(--blue-600)" />
        <span>
          全部项目映射 · {projects.length} 个项目 · {totalTasks} 个任务
        </span>
        <span style={{ color: "var(--ink-400)" }}>
          选择项目后，新建任务和批量排班会自动绑定该项目。
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-soft)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12,
        color: "var(--ink-600)",
      }}
    >
      <Icon.Project size={15} stroke="var(--blue-600)" />
      <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
        {project.name}
      </span>
      <span className="mono" style={{ color: "var(--ink-400)" }}>
        {project.code || "未设置编号"}
      </span>
      <span>负责人：{project.leadOps || "未分配"}</span>
      <span>
        周期：{project.start || "未配置"} → {project.end || "未配置"}
      </span>
      <span>
        当前筛选 {tasks.length} 个任务 · {pendingCount} 个待执行 ·{" "}
        {anomalyCount} 个异常
      </span>
      <div style={{ flex: 1 }} />
      {onOpenProject ? (
        <Button size="sm" kind="default" onClick={onOpenProject}>
          查看当前项目
        </Button>
      ) : null}
    </div>
  );
}

function taskMatchesTaskFilters(task, filters, projects = []) {
  const project = projects.find((item) => item.id === filters.project);
  const projectKeys = [
    filters.project,
    project?.id,
    project?.code,
    project?.name,
  ].filter(Boolean);
  const taskProjectKeys = [
    task.project,
    task.projectId,
    task.projectName,
  ].filter(Boolean);
  const matchesProject =
    filters.project === "all" ||
    taskProjectKeys.some((key) => projectKeys.includes(key));
  const matchesStreamer =
    filters.streamer === "all" ||
    [task.streamerId, task.streamerName]
      .filter(Boolean)
      .includes(filters.streamer);
  const statusKey = getTaskDisplayStatusKey(task);
  const matchesStatus =
    filters.status === "all" || statusKey === filters.status;
  return matchesProject && matchesStreamer && matchesStatus;
}

function getTaskDisplayStatusKey(task) {
  const baseStatus = task?.anomaly
    ? "abnormal"
    : task?.status || "pending_live";
  if (
    baseStatus === "pending_live" &&
    hasTaskPlannedWindowEnded(task?.plannedEndAt)
  ) {
    return "missed_live";
  }
  return baseStatus;
}

function hasTaskPlannedWindowEnded(plannedEndAt) {
  if (!plannedEndAt) return false;
  const plannedEnd = new Date(plannedEndAt);
  return (
    !Number.isNaN(plannedEnd.getTime()) && Date.now() > plannedEnd.getTime()
  );
}

function getTaskOperationalAnomalyKey(task) {
  if (task?.anomaly) return task.anomaly;
  if (task?.status === "abnormal") return "abnormal";
  if (getTaskDisplayStatusKey(task) === "missed_live") return "not_started";
  return "";
}

function isTaskOperationalAnomaly(task) {
  return Boolean(getTaskOperationalAnomalyKey(task));
}

function taskOperationalAnomalyDescription(anomalyKey) {
  const descriptions = {
    not_started:
      "计划窗口已结束但系统未记录开播，建议联系主播补充未直播原因或重新排班。",
    unstart:
      "计划窗口已结束但系统未记录开播，建议联系主播补充未直播原因或重新排班。",
    not_reported: "直播任务已结束但尚未提交报数，建议提醒主播尽快补报。",
    report_overdue: "已超过项目上传期限，建议运营提示主播尽快补传截图。",
    late_report: "已超过项目上传期限，建议运营提示主播尽快补传截图。",
    missing_checkout_screenshot: "任务缺少下播截图，建议提醒主播补充履约证据。",
    live_over_48h:
      "直播持续超过 48 小时未上传下播截图，建议主动联系主播并提示截图上传。",
    unstopped:
      "直播持续超过 48 小时未上传下播截图，建议主动联系主播并提示截图上传。",
    short: "实际直播时长低于计划时长 75%，触发时长不足异常。",
    rejected: "报数审核被驳回后尚未重新提交，建议跟进主播补充材料。",
    conflict: "该任务与同主播其他排班存在时间冲突，请调整排班窗口。",
    abnormal: "任务已进入异常状态，请运营跟进处理并记录原因。",
  };
  return descriptions[anomalyKey] || descriptions.abnormal;
}

function resolveTaskProject(task, projects = []) {
  const taskProjectKeys = [
    task?.projectId,
    task?.project,
    task?.projectName,
  ].filter(Boolean);
  return (
    projects.find((project) =>
      [project.id, project.code, project.name].some((key) =>
        taskProjectKeys.includes(key),
      ),
    ) || null
  );
}

function resolveTaskStreamer(task, streamers = []) {
  const taskStreamerKeys = [task?.streamerId, task?.streamerName].filter(
    Boolean,
  );
  return (
    streamers.find((streamer) =>
      [streamer.id, streamer.alias, streamer.real].some((key) =>
        taskStreamerKeys.includes(key),
      ),
    ) || null
  );
}

// ——— Schedule Board (week / streamer grid) ————————

function ScheduleBoard({ filters, onSelectTask }) {
  const tasks = useOpsTasks();
  const projects = useOpsProjects();
  const knownStreamers = useOpsStreamers();
  const [unit, setUnit] = React.useState("day"); // 'day' | 'hour'
  const [toolbarMessage, setToolbarMessage] = React.useState("");

  // Filter tasks
  const visibleTasks = tasks.filter((task) =>
    taskMatchesTaskFilters(task, filters, projects),
  );
  const streamerIds = Array.from(
    new Set(
      visibleTasks
        .map((task) => task.streamerId || task.streamerName)
        .filter(Boolean),
    ),
  );
  const streamers = streamerIds.map((id) => {
    const fromKnown = knownStreamers.find((streamer) => streamer.id === id);
    if (fromKnown) return fromKnown;
    const task = visibleTasks.find(
      (item) => item.streamerId === id || item.streamerName === id,
    );
    return { id, alias: displayTaskStreamerName(task) };
  });
  const dayWidth = "minmax(140px, 1fr)";
  const HOUR_START = 12; // visible window: 12:00 - 24:00 (used in hour view)
  const HOUR_END = 24;

  if (!visibleTasks.length) {
    return (
      <div style={{ padding: 16 }}>
        <EmptyHint title="暂无排班数据" hint="创建排班或任务后会展示周视图。" />
      </div>
    );
  }

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
        <button
          type="button"
          style={iconBtn}
          onClick={() => setToolbarMessage("上一周排班后台暂未接入。")}
        >
          <Icon.ChevLeft size={14} />
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
          本周排班
        </div>
        <button
          type="button"
          style={iconBtn}
          onClick={() => setToolbarMessage("下一周排班后台暂未接入。")}
        >
          <Icon.ChevRight size={14} />
        </button>
        <Button
          size="sm"
          kind="default"
          onClick={() => setToolbarMessage("已定位到本周排班。")}
        >
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
      {toolbarMessage ? (
        <div
          aria-live="polite"
          style={{
            padding: "8px 16px 0",
            fontSize: 12,
            color: "var(--ink-500)",
          }}
        >
          {toolbarMessage}
        </div>
      ) : null}

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
            taskMatchesTaskFilters(t, filters, projects),
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
                          projects={projects}
                          onClick={() => onSelectTask(t)}
                        />
                      ) : (
                        <HourTaskBar
                          key={t.id}
                          task={t}
                          projects={projects}
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
                            projectId:
                              filters.project === "all"
                                ? projects[0]?.id
                                : filters.project,
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
function DayTaskBlock({ task, projects = [], onClick }) {
  const statusKey = getTaskDisplayStatusKey(task);
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
    resolveTaskProject(task, projects)?.product ||
    task.projectName ||
    task.project;
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
        <span style={{ flex: 1, minWidth: 4 }} />
        <span
          style={{
            fontSize: 10,
            color: c.text,
            opacity: 0.9,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 82,
          }}
        >
          {st.label}
        </span>
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
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-400)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.25,
        }}
      >
        {projectShort}
      </div>
    </button>
  );
}

// Hour-unit bar — positioned within the 12-24h window
function HourTaskBar({ task, projects = [], hourStart, hourEnd, onClick }) {
  const span = hourEnd - hourStart;
  const leftPct = Math.max(0, ((task.startHour - hourStart) / span) * 100);
  const widthPct = Math.min(
    100 - leftPct,
    ((task.endHour - task.startHour) / span) * 100,
  );
  const statusKey = getTaskDisplayStatusKey(task);
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
    resolveTaskProject(task, projects)?.name?.split("·")[0]?.trim() ||
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
      aria-label={`${task.name} · ${st.label} · ${formatHour(task.startHour)} - ${formatHour(task.endHour)}`}
      title={`${task.name} · ${st.label} · ${formatHour(task.startHour)} - ${formatHour(task.endHour)}`}
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
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          {projectName} · {task.name.replace(/^.+·\s*/, "")}
        </span>
        <span
          style={{
            marginLeft: 6,
            maxWidth: 72,
            fontSize: 9.5,
            color: c.text,
            opacity: 0.8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
          }}
        >
          {st.label}
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

function decimalHourToTime(value) {
  return formatHour(value);
}

function timeValueToDecimalHour(value, fallback) {
  const [hour, minute] = String(value)
    .split(":")
    .map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback;
  }
  return hour + minute / 60;
}

function scheduleTimeToIso(dateKey, timeValue) {
  const [hour = 0, minute = 0] = String(timeValue)
    .split(":")
    .map((part) => Number(part));
  const timestamp =
    Date.parse(`${dateKey}T00:00:00.000+08:00`) + (hour * 60 + minute) * 60_000;
  return new Date(timestamp).toISOString();
}

function dayScheduleTimeToIso(dayIdx, hourValue) {
  const timestamp =
    Date.parse(`${SCHEDULE_WEEK.start}T00:00:00.000+08:00`) +
    dayIdx * 24 * 60 * 60_000 +
    Math.round(hourValue * 60) * 60_000;
  return new Date(timestamp).toISOString();
}

function scheduleMinutes(startIso, endIso) {
  return Math.max(
    0,
    Math.round(
      (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
    ),
  );
}

function projectById(projectId, projects = PROJECTS) {
  return projects.find((item) => item.id === projectId) || projects[0] || null;
}

function joinedStreamersForProject(
  projectId,
  streamers = STREAMERS,
  applications = [],
) {
  if (!projectId) return [];
  const project = { id: projectId };
  const joinedFromStreamers = streamers.filter((streamer) =>
    isStreamerJoinedProject(streamer, projectId),
  );
  const joinedFromApplications = applications
    .filter(
      (application) =>
        application.status === "joined" &&
        applicationBelongsToProject(application, project),
    )
    .map((application) =>
      applicationToScheduledStreamer(application, streamers, projectId),
    )
    .filter(Boolean);

  return mergeRosterRows(joinedFromStreamers, joinedFromApplications);
}

function applicationToScheduledStreamer(application, streamers, projectId) {
  const streamer = application.streamer || {};
  const streamerId =
    application.streamerId || application.streamer_id || streamer.id;
  if (!streamerId) return null;
  const card = streamers.find((item) => item.id === streamerId);
  const joinedProject = applicationJoinedProjectRecord(application, projectId);
  const base = card || {
    id: streamerId,
    alias: streamer.displayName || streamer.name || streamerId,
    real: streamer.realName || streamer.displayName || "未填写",
    gender: "",
    source: "项目邀约",
    supplier: "未绑定",
    games: [],
    platforms: [],
    style: "",
    cooperation: streamer.cooperationStatus || "active",
    risk: streamer.riskLevel || "low",
    metrics: {},
    matchScore: 65,
    defaultRule: "CPT",
    completedProjects: 0,
    projects: [],
  };

  return {
    ...base,
    projects: ensureJoinedProject(base.projects, joinedProject),
  };
}

function applicationJoinedProjectRecord(application, fallbackProjectId) {
  const project = application.project || {};
  return {
    id:
      application.projectId ||
      application.project_id ||
      project.id ||
      fallbackProjectId,
    code: project.code,
    name: project.name,
    status: "joined",
    settlementHours: 0,
    grossContrib: 0,
  };
}

function ensureJoinedProject(projects = [], joinedProject) {
  const existingProjects = Array.isArray(projects) ? projects : [];
  if (!joinedProject.id) return existingProjects;
  const hasProject = existingProjects.some(
    (project) =>
      project.id === joinedProject.id ||
      (joinedProject.code && project.code === joinedProject.code) ||
      (joinedProject.name && project.name === joinedProject.name),
  );
  if (hasProject) {
    return existingProjects.map((project) =>
      project.id === joinedProject.id ||
      (joinedProject.code && project.code === joinedProject.code) ||
      (joinedProject.name && project.name === joinedProject.name)
        ? { ...project, status: "joined" }
        : project,
    );
  }
  return [...existingProjects, joinedProject];
}

function isStreamerJoinedProject(streamer, projectId) {
  if (!streamer || !projectId || !Array.isArray(streamer.projects)) {
    return false;
  }
  return streamer.projects.some(
    (project) => project.id === projectId && project.status === "joined",
  );
}

function streamerById(streamerId, streamers = STREAMERS) {
  return (
    streamers.find((item) => item.id === streamerId) || streamers[0] || null
  );
}

function formatTaskActionError(error) {
  const message = error instanceof Error ? error.message : "任务操作失败";
  if (message.includes("Only joined project streamers can be scheduled")) {
    return JOINED_STREAMER_REQUIRED_MESSAGE;
  }
  return message;
}

function normalizeTaskType(type) {
  return TASK_TYPE_OPTIONS.some((option) => option.value === type)
    ? type
    : "project";
}

function taskTypeLabel(type) {
  const normalizedType = normalizeTaskType(type);
  return (
    TASK_TYPE_OPTIONS.find((option) => option.value === normalizedType)
      ?.label || "项目任务"
  );
}

function opsLiveTaskInput({
  projectId = "",
  streamerId = "",
  dayIdx = SCHEDULE_WEEK.todayIdx,
  startHour = 20,
  endHour = 23.5,
  type = "project",
  note = "经营端页面创建任务",
  projects = PROJECTS,
  streamers = STREAMERS,
}) {
  const project = projectById(projectId, projects);
  const streamer = streamerById(streamerId, streamers);
  if (!project || !streamer) {
    throw new Error("请先创建项目和主播档案。");
  }
  const plannedStartAt = dayScheduleTimeToIso(dayIdx, startHour);
  const plannedEndAt = dayScheduleTimeToIso(dayIdx, endHour);

  return {
    projectId: project.id,
    streamerId: streamer.id,
    title: `${project.name} · ${streamer.alias}`,
    type: normalizeTaskType(type),
    plannedStartAt,
    plannedEndAt,
    plannedDuration: scheduleMinutes(plannedStartAt, plannedEndAt),
    note,
  };
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

function TaskList({ tasks, projects = [], streamers = [], onSelectTask }) {
  const rows = tasks;
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
              {displayRecordId(r.id, "任务")}
            </span>
          ),
        },
        {
          title: "任务名 / 项目",
          render: (r) => {
            const project = resolveTaskProject(r, projects);
            const projectName = project?.name || r.projectName || r.project;
            const projectCode = project?.code || r.project || "未设置编号";
            return (
              <div>
                <div style={{ fontWeight: 500, color: "var(--ink-900)" }}>
                  {r.name}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-400)" }}
                >
                  {projectName} · {projectCode} · {taskTypeLabel(r.type)}
                </div>
              </div>
            );
          },
        },
        {
          title: "主播",
          render: (r) => {
            const s = resolveTaskStreamer(r, streamers);
            const streamerLabel = s?.alias || displayTaskStreamerName(r);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={streamerLabel} size={24} />
                <span>{streamerLabel}</span>
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
            const k = getTaskDisplayStatusKey(r);
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
          render: (r) => {
            const anomalyKey = getTaskOperationalAnomalyKey(r);
            const anomalyMeta =
              ANOMALY_TYPES[anomalyKey] || ANOMALY_TYPES.abnormal;
            return anomalyKey ? (
              <Badge tone={anomalyMeta.tone}>{anomalyMeta.label}</Badge>
            ) : (
              <span style={{ color: "var(--ink-300)" }}>—</span>
            );
          },
        },
        {
          title: "",
          render: (r) => (
            <button
              type="button"
              onClick={() => onSelectTask(r)}
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

function AnomalyList({ tasks, projects = [], streamers = [] }) {
  const actions = useOpsLiveActions();
  const [actionMessage, setActionMessage] = React.useState("");
  const [scanBusy, setScanBusy] = React.useState("");
  const anomalies = tasks.filter(isTaskOperationalAnomaly).map((t) => {
    const anomalyKey = getTaskOperationalAnomalyKey(t);
    const project = resolveTaskProject(t, projects);
    const streamer = resolveTaskStreamer(t, streamers);
    return {
      ...t,
      projectDisplay: project?.name || t.projectName || t.project,
      streamer: streamer?.alias || t.streamerName,
      typeKey: anomalyKey,
    };
  });

  // Group by type
  const groups = {};
  anomalies.forEach((a) => {
    (groups[a.typeKey] = groups[a.typeKey] || []).push(a);
  });

  const runAnomalyScan = async (mode) => {
    if (scanBusy) return;
    setScanBusy(mode);
    setActionMessage("");
    try {
      const result = await actions.scanAnomalies?.();
      const detectedCount = result?.detectedCount ?? 0;
      const sentCount = result?.sentCount ?? 0;
      setActionMessage(
        mode === "dispatch"
          ? `异常批量分派完成：发现 ${detectedCount} 项，已分派 ${sentCount} 条通知。`
          : `异常扫描完成：发现 ${detectedCount} 项，已分派 ${sentCount} 条通知。`,
      );
    } catch (error) {
      setActionMessage(error?.message || "异常扫描失败，请稍后重试。");
    } finally {
      setScanBusy("");
    }
  };

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
        <Button
          size="sm"
          kind="default"
          onClick={() => runAnomalyScan("history")}
          disabled={Boolean(scanBusy)}
        >
          {scanBusy === "history" ? "扫描中" : "扫描历史"}
        </Button>
        <Button
          size="sm"
          kind="primary"
          onClick={() => runAnomalyScan("dispatch")}
          disabled={Boolean(scanBusy)}
        >
          {scanBusy === "dispatch" ? "分派中" : "批量分派处理"}
        </Button>
      </div>
      {actionMessage ? (
        <div
          aria-live="polite"
          style={{ fontSize: 12, color: "var(--ink-500)" }}
        >
          {actionMessage}
        </div>
      ) : null}

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
            <Badge
              tone={(ANOMALY_TYPES[type] || ANOMALY_TYPES.abnormal).tone}
              dot
            >
              {(ANOMALY_TYPES[type] || ANOMALY_TYPES.abnormal).label}
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
                      {displayRecordId(a.id, "异常任务")} · {a.projectDisplay}
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
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={() =>
                        setActionMessage(
                          `${a.streamer} 的联系通道后台暂未接入。`,
                        )
                      }
                    >
                      联系主播
                    </Button>
                    <Button
                      size="sm"
                      kind="default"
                      onClick={() =>
                        setActionMessage(
                          `已定位异常任务：${displayRecordId(a.id, "任务")}`,
                        )
                      }
                    >
                      查看任务
                    </Button>
                    <Button
                      size="sm"
                      kind="primary"
                      onClick={() =>
                        setActionMessage("异常处理状态后台暂未接入。")
                      }
                    >
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
  const [previewMessage, setPreviewMessage] = React.useState("");
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
        <Button
          kind="default"
          style={{ marginTop: 16 }}
          onClick={() => setPreviewMessage("主播端账号切换预览后台暂未接入。")}
        >
          预览主播端 →
        </Button>
        {previewMessage ? (
          <div
            aria-live="polite"
            style={{ marginTop: 10, fontSize: 12, color: "var(--ink-500)" }}
          >
            {previewMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ——— Task Drawer (right panel) ——————————

function TaskDrawer({
  task,
  projects,
  streamers,
  applications,
  onClose,
  onCreateTask,
  onCancelTask,
  busyAction,
  go,
}) {
  const [drawerMessage, setDrawerMessage] = React.useState("");
  if (task._new) {
    return (
      <NewTaskDrawer
        task={task}
        projects={projects}
        streamers={streamers}
        applications={applications}
        onClose={onClose}
        onCreateTask={onCreateTask}
      />
    );
  }

  const s = resolveTaskStreamer(task, streamers);
  const p = resolveTaskProject(task, projects);
  const streamerName = s?.alias || displayTaskStreamerName(task);
  const projectName = p?.name || task.projectName || task.project;
  const statusKey = getTaskDisplayStatusKey(task);
  const flowStatusKey = task.status || "pending_live";
  const taskAnomalyKey = getTaskOperationalAnomalyKey(task);
  const taskAnomalyMeta =
    ANOMALY_TYPES[taskAnomalyKey] || ANOMALY_TYPES.abnormal;
  const st = TASK_STATUS[statusKey] || TASK_STATUS.pending_live;
  const showHeaderAnomalyBadge =
    taskAnomalyKey && taskAnomalyMeta.label !== st.label;

  return (
    <Drawer
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className="mono"
            style={{ fontSize: 13, color: "var(--ink-400)" }}
          >
            {displayRecordId(task.id, "任务")}
          </span>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
          {showHeaderAnomalyBadge && (
            <Badge tone={taskAnomalyMeta.tone}>{taskAnomalyMeta.label}</Badge>
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
          <DrawerStat label="任务类型" value={taskTypeLabel(task.type)} />
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
                {displayRecordId(s?.id || task.streamerId, "主播")} ·{" "}
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
          <KV label="项目编号">
            <span className="mono">{p?.code || "未设置编号"}</span>
          </KV>
          <KV label="项目负责人">{p?.leadOps || "未分配"}</KV>
          <KV label="项目周期">
            {p?.start || "未配置"} → {p?.end || "未配置"}
          </KV>
        </div>

        {/* Status timeline */}
        <div>
          <SectionTitle hint="任务流转">状态轨迹</SectionTitle>
          <Timeline
            events={[
              {
                time: "已创建",
                who: "系统",
                action: "排班创建",
                done: true,
              },
              {
                time: flowStatusKey === "pending_live" ? "待开播" : "已开播",
                who: streamerName,
                action: "点击开始直播",
                done: flowStatusKey !== "pending_live",
              },
              {
                time: flowStatusKey === "live" ? "进行中…" : "已结束",
                who: streamerName,
                action: "点击停止 + 上传下播截图",
                done: [
                  "pending_report",
                  "pending_review",
                  "completed",
                  "approved",
                ].includes(flowStatusKey),
                current: flowStatusKey === "live",
              },
              {
                time: "—",
                who: streamerName,
                action: "主播确认 OCR 结果",
                done: ["pending_review", "completed", "approved"].includes(
                  flowStatusKey,
                ),
              },
              {
                time: "—",
                who: "运营审核",
                action: "报数审核",
                done: ["completed", "approved"].includes(flowStatusKey),
              },
            ]}
          />
        </div>

        {taskAnomalyKey && (
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
                {taskAnomalyMeta.label}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-700)", marginTop: 4 }}
              >
                {taskOperationalAnomalyDescription(taskAnomalyKey)}
              </div>
            </div>
          </div>
        )}
        {drawerMessage ? (
          <div
            aria-live="polite"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              color: "var(--ink-700)",
              fontSize: 12,
            }}
          >
            {drawerMessage}
          </div>
        ) : null}
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
        <Button
          kind="danger"
          icon={<Icon.X size={14} />}
          onClick={() => onCancelTask?.(task)}
          disabled={busyAction === "cancel"}
        >
          {busyAction === "cancel" ? "取消中…" : "取消任务"}
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          kind="default"
          onClick={() => setDrawerMessage("编辑排班后台暂未接入")}
        >
          编辑排班
        </Button>
        <Button
          kind="default"
          onClick={() => p?.id && go?.("project", p.id)}
          disabled={!p?.id}
        >
          查看项目
        </Button>
        <Button kind="primary" onClick={() => go?.("reports")}>
          查看报数
        </Button>
      </div>
    </Drawer>
  );
}

function NewTaskDrawer({
  task,
  projects = [],
  streamers = [],
  applications = [],
  onClose,
  onCreateTask,
}) {
  const [selectedProjectId, setSelectedProjectId] = React.useState(
    task.projectId || projects[0]?.id || "",
  );
  const [selectedStreamerId, setSelectedStreamerId] = React.useState(
    task.streamerId || streamers[0]?.id || "",
  );
  const [startTime, setStartTime] = React.useState(
    decimalHourToTime(task.startHour ?? 20),
  );
  const [endTime, setEndTime] = React.useState(
    decimalHourToTime(task.endHour ?? 23.5),
  );
  const [taskType, setTaskType] = React.useState(
    normalizeTaskType(task.type || "project"),
  );
  const [note, setNote] = React.useState("");
  const p = projects.find((x) => x.id === selectedProjectId) || projects[0];
  const eligibleStreamers = p
    ? joinedStreamersForProject(p.id, streamers, applications)
    : [];
  const pendingConfirmApplications = p
    ? applications.filter(
        (application) =>
          isConfirmableRosterApplication(application.status) &&
          applicationBelongsToProject(application, p),
      )
    : [];
  const joinedRequirementMessage =
    pendingConfirmApplications.length > 0
      ? `该项目有 ${pendingConfirmApplications.length} 位待确认主播，请先到项目详情的主播阵容点击确认加入后再排班。`
      : JOINED_STREAMER_REQUIRED_MESSAGE;
  const s = eligibleStreamers.find((x) => x.id === selectedStreamerId) || null;
  const projectName = p?.name || task.projectName || task.project || "";
  const [busy, setBusy] = React.useState(false);
  const [draftMessage, setDraftMessage] = React.useState("");
  React.useEffect(() => {
    const project =
      projects.find((x) => x.id === selectedProjectId) || projects[0];
    const nextEligibleStreamers = project
      ? joinedStreamersForProject(project.id, streamers, applications)
      : [];
    if (
      !nextEligibleStreamers.some(
        (streamer) => streamer.id === selectedStreamerId,
      )
    ) {
      setSelectedStreamerId(nextEligibleStreamers[0]?.id || "");
    }
  }, [
    applications,
    projects,
    selectedProjectId,
    selectedStreamerId,
    streamers,
  ]);
  const handleCreate = async () => {
    if (!onCreateTask || !p) {
      setDraftMessage("请先选择项目。");
      return;
    }
    if (!s) {
      setDraftMessage("");
      return;
    }
    const startHour = timeValueToDecimalHour(startTime, 20);
    const endHour = timeValueToDecimalHour(endTime, 23.5);
    if (endHour <= startHour) {
      setDraftMessage("计划结束时间必须晚于开播时间。");
      return;
    }
    setBusy(true);
    setDraftMessage("");
    try {
      await onCreateTask(
        opsLiveTaskInput({
          projectId: p.id,
          streamerId: s.id,
          dayIdx: task.dayIdx,
          startHour,
          endHour,
          type: taskType,
          note: note.trim() || "经营端页面创建任务",
          projects,
          streamers: eligibleStreamers,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

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
        <TaskFormLabel label="所属项目">
          <select
            value={p?.id || ""}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            style={taskInputStyle}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </TaskFormLabel>
        <TaskFormLabel label="主播">
          <select
            value={s?.id || ""}
            onChange={(event) => setSelectedStreamerId(event.target.value)}
            style={taskInputStyle}
            disabled={eligibleStreamers.length === 0}
          >
            {eligibleStreamers.length > 0 ? (
              eligibleStreamers.map((streamer) => (
                <option key={streamer.id} value={streamer.id}>
                  {streamer.alias}
                </option>
              ))
            ) : (
              <option value="">暂无已加入主播</option>
            )}
          </select>
        </TaskFormLabel>
        {eligibleStreamers.length === 0 ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--danger-600)" }}
          >
            {joinedRequirementMessage}
          </div>
        ) : null}
        <FormField label="任务类型">
          <SegmentedControl
            options={TASK_TYPE_OPTIONS}
            value={taskType}
            onChange={setTaskType}
          />
        </FormField>
        <div
          style={{
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--bg-soft)",
            fontSize: 12,
            color: "var(--ink-600)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span>
            项目映射：{projectName || "未选择项目"} · {p?.code || "未设置编号"}
          </span>
          <span>
            负责人：{p?.leadOps || "未分配"} · 周期：{p?.start || "未配置"} →{" "}
            {p?.end || "未配置"}
          </span>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          <TaskFormLabel label="计划开播">
            <input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              style={taskInputStyle}
            />
          </TaskFormLabel>
          <TaskFormLabel label="计划结束">
            <input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              style={taskInputStyle}
            />
          </TaskFormLabel>
        </div>
        <TaskFormLabel label="任务说明（可选）">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
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
        </TaskFormLabel>
        {draftMessage ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--ink-500)" }}
          >
            {draftMessage}
          </div>
        ) : null}
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
        <Button
          kind="default"
          onClick={() => setDraftMessage("任务草稿保存后台暂未接入。")}
        >
          保存草稿
        </Button>
        <Button kind="primary" onClick={handleCreate} disabled={busy}>
          {busy ? "创建中…" : "创建任务"}
        </Button>
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

function SegmentedControl({ options, value, onChange }) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {normalizedOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange?.(option.value)}
          style={{
            flex: 1,
            height: 30,
            fontSize: 12,
            background: option.value === value ? "var(--blue-50)" : "#fff",
            border: `1px solid ${
              option.value === value ? "var(--blue-500)" : "var(--line-strong)"
            }`,
            color:
              option.value === value ? "var(--blue-700)" : "var(--ink-500)",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: option.value === value ? 600 : 500,
          }}
        >
          {option.label}
        </button>
      ))}
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
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
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

const MEMBERS = [];

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

function ScreenOrg({ go, onOpenOrganizationSettings }) {
  const [tab, setTab] = React.useState("overview");
  const [orgMessage, setOrgMessage] = React.useState("");
  const [memberDrawerOpen, setMemberDrawerOpen] = React.useState(false);
  const [editingMember, setEditingMember] = React.useState(null);
  const [statusMember, setStatusMember] = React.useState(null);
  const members = useOpsOrganizationMembers();
  const memberPermissions = useOpsOrganizationMemberPermissions();
  const orgSettings = useOpsOrganizationSettings();
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const billingStatus = useOpsBillingStatus();
  const actions = useOpsLiveActions();
  const {
    organizationMembers,
    projects: projectData,
    streamers: streamerData,
    billingStatus: billingStatusData,
  } = React.useContext(OpsLiveDataContext);
  const showOrgPending = (message) => {
    setOrgMessage(message);
  };
  const canViewMembers = memberPermissions?.canViewMembers !== false;
  const creatableRoles = Array.isArray(memberPermissions?.creatableRoles)
    ? memberPermissions.creatableRoles
    : null;
  const canCreateMembers =
    memberPermissions?.canCreateMembers === false
      ? false
      : creatableRoles == null
        ? true
        : creatableRoles.length > 0;
  const openMemberDrawer = () => {
    if (!canCreateMembers) {
      setOrgMessage("当前角色无权创建组织成员。");
      return;
    }
    setMemberDrawerOpen(true);
  };

  React.useEffect(() => {
    if (organizationMembers == null && actions.refreshOrganizationMembers) {
      actions
        .refreshOrganizationMembers()
        .catch((error) => setOrgMessage(formatOrganizationMemberError(error)));
    }
  }, [actions, organizationMembers]);

  React.useEffect(() => {
    if (projectData == null && actions.refreshProjects) {
      actions
        .refreshProjects()
        .catch((error) =>
          warnBackgroundRefreshFailure("organization overview", error),
        );
    }
    if (streamerData == null && actions.refreshStreamers) {
      actions
        .refreshStreamers()
        .catch((error) =>
          warnBackgroundRefreshFailure("organization overview", error),
        );
    }
    if (billingStatusData == null && actions.refreshBillingStatus) {
      actions
        .refreshBillingStatus()
        .catch((error) =>
          warnBackgroundRefreshFailure("organization overview", error),
        );
    }
  }, [actions, billingStatusData, projectData, streamerData]);

  const organizationStats = buildOrganizationOverviewStats({
    members,
    canViewMembers,
    memberLimit: orgSettings.memberLimit,
    projects,
    projectsLoaded: Array.isArray(projectData),
    streamers,
    streamersLoaded: Array.isArray(streamerData),
    billingStatus,
  });
  const orgPlanName = billingStatus
    ? billingPlanName(billingStatus.plan)
    : orgSettings.plan;

  const handleCreateMember = async (input) => {
    if (!actions.createOrganizationMember) {
      setOrgMessage("成员管理接口暂未配置。");
      return;
    }
    const result = await actions.createOrganizationMember(input);
    setOrgMessage(
      input.mode === "subaccount"
        ? "子账号已创建并加入当前组织。"
        : "成员邀请已发送，并已写入当前组织成员列表。",
    );
    if (input.mode !== "subaccount") {
      setMemberDrawerOpen(false);
    }
    return result;
  };

  const handleUpdateRole = async (memberId, input) => {
    if (!actions.updateOrganizationMemberRole) {
      setOrgMessage("角色设置接口暂未配置。");
      return;
    }
    const result = await actions.updateOrganizationMemberRole(memberId, input);
    setOrgMessage("成员角色已更新，权限变更已进入审计日志。");
    setEditingMember(null);
    return result;
  };

  const handleUpdateStatus = async (memberId, input) => {
    if (!actions.updateOrganizationMemberStatus) {
      setOrgMessage("成员状态接口暂未配置。");
      return;
    }
    const result = await actions.updateOrganizationMemberStatus(
      memberId,
      input,
    );
    setOrgMessage(
      input.status === "suspended"
        ? "成员已停用，权限变更已进入审计日志。"
        : "成员已恢复，权限变更已进入审计日志。",
    );
    setStatusMember(null);
    return result;
  };

  return (
    <>
      <PageHeader
        title="组织与权限"
        subtitle="多组织数据隔离 · 字段级脱敏 · AI 查询继承用户权限"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.History size={14} />}
              onClick={() => go("audit")}
            >
              权限变更日志
            </Button>
            {canCreateMembers ? (
              <Button
                kind="primary"
                icon={<Icon.Plus size={14} stroke="#fff" />}
                onClick={openMemberDrawer}
              >
                邀请成员
              </Button>
            ) : null}
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
        {orgMessage ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--ink-500)" }}
          >
            {orgMessage}
          </div>
        ) : null}
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
                  {orgSettings.name}
                </h2>
                {orgPlanName ? (
                  <Badge tone="blue" dot>
                    {orgPlanName}
                  </Badge>
                ) : null}
                {orgSettings.verified ? (
                  <Badge tone="green" dot>
                    已认证
                  </Badge>
                ) : null}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 4 }}
              >
                <span className="mono">
                  {displayRecordId(orgSettings.id, "组织编号待配置")}
                </span>{" "}
                · {orgSettings.name} · MCN 经营舱
              </div>
            </div>
            <Button
              kind="default"
              icon={<Icon.Settings size={14} />}
              onClick={onOpenOrganizationSettings}
            >
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
            <StatCell
              label="活跃成员"
              value={organizationStats.members.value}
              detail={organizationStats.members.detail}
            />
            <StatCell
              label="主播档案"
              value={organizationStats.streamers.value}
              detail={organizationStats.streamers.detail}
            />
            <StatCell
              label="进行中项目"
              value={organizationStats.projects.value}
              detail={organizationStats.projects.detail}
            />
            <StatCell
              label="存储用量"
              value={organizationStats.storage.value}
              detail={organizationStats.storage.detail}
            />
            <StatCell
              label="API 调用 (本月)"
              value={organizationStats.api.value}
              detail={organizationStats.api.detail}
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
                { key: "members", label: "成员管理", count: members.length },
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
            {tab === "overview" && <RoleOverview members={members} />}
            {tab === "members" && (
              <MemberList
                members={members}
                creatableRoles={creatableRoles}
                onPendingAction={showOrgPending}
                onInvite={openMemberDrawer}
                onEditRole={(member) => setEditingMember(member)}
                onChangeStatus={(member) => setStatusMember(member)}
              />
            )}
            {tab === "matrix" && <PermMatrix />}
            {tab === "sensitive" && <SensitiveFields />}
            {tab === "security" && <SecurityPolicy />}
          </div>
        </Card>
      </div>
      {memberDrawerOpen ? (
        <OrganizationMemberDrawer
          creatableRoles={creatableRoles}
          onClose={() => setMemberDrawerOpen(false)}
          onSubmit={handleCreateMember}
        />
      ) : null}
      {editingMember ? (
        <RoleEditDrawer
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSubmit={handleUpdateRole}
        />
      ) : null}
      {statusMember ? (
        <StatusEditDrawer
          member={statusMember}
          onClose={() => setStatusMember(null)}
          onSubmit={handleUpdateStatus}
        />
      ) : null}
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

function buildOrganizationOverviewStats({
  members,
  canViewMembers,
  memberLimit,
  projects,
  projectsLoaded,
  streamers,
  streamersLoaded,
  billingStatus,
}) {
  const activeMembers = members.filter((member) => member.status === "active");
  const invitedMembers = members.filter(
    (member) => member.status === "invited",
  );
  const activeProjects = projects.filter((project) =>
    ["active", "recruiting", "pending_start", "settling"].includes(
      project.status,
    ),
  );
  const cooperatingStreamers = streamers.filter((streamer) =>
    ["active", "signed", "cooperating"].includes(streamer.cooperation),
  );
  const storageUsage = usageByMetric(billingStatus, "storage_mb");
  const apiUsage = ["ocr", "ai", "export"].reduce(
    (sum, metric) =>
      sum + (usageByMetric(billingStatus, metric)?.usedQuantity ?? 0),
    0,
  );

  return {
    members: canViewMembers
      ? {
          value: String(activeMembers.length),
          detail: [
            memberLimit != null ? `配额 ${memberLimit}` : null,
            `邀请中 ${invitedMembers.length}`,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          value: "暂无权限",
          detail: "当前角色不可查看成员明细",
        },
    streamers: streamersLoaded
      ? {
          value: String(streamers.length),
          detail: `${cooperatingStreamers.length} 位合作中`,
        }
      : {
          value: "暂无数据",
          detail: "等待主播资源池同步",
        },
    projects: projectsLoaded
      ? {
          value: String(activeProjects.length),
          detail: `共 ${projects.length} 个项目`,
        }
      : {
          value: "暂无数据",
          detail: "等待项目列表同步",
        },
    storage: billingStatus
      ? {
          value: formatStorageUsage(storageUsage?.usedQuantity ?? 0),
          detail:
            storageUsage?.allowanceQuantity > 0
              ? `配额 ${formatStorageUsage(storageUsage.allowanceQuantity)}`
              : "按本月用量表汇总",
        }
      : {
          value: "暂无数据",
          detail: "等待账务用量同步",
        },
    api: billingStatus
      ? {
          value: apiUsage.toLocaleString("zh-CN"),
          detail: "OCR · AI · 导出",
        }
      : {
          value: "暂无数据",
          detail: "等待账务用量同步",
        },
  };
}

function usageByMetric(billingStatus, metric) {
  return billingStatus?.usage?.find((item) => item.metric === metric) ?? null;
}

function formatStorageUsage(value) {
  const mb = Math.max(0, Number(value) || 0);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  return `${Math.trunc(mb)} MB`;
}

// ——— Role Overview ————————————————————————

function RoleOverview({ members = MEMBERS }) {
  const counts = {};
  members.forEach((m) => {
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
      {roleCards.map(({ key, ...role }) => (
        <RoleCard key={key} {...role} count={counts[role.code] || 0} />
      ))}
    </div>
  );
}

function RoleCard({ title, code, tone, desc, perms, count }) {
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

function MemberList({
  members = MEMBERS,
  creatableRoles,
  onPendingAction,
  onInvite,
  onEditRole,
  onChangeStatus,
}) {
  const [filter, setFilter] = React.useState("all");
  const rows =
    filter === "all" ? members : members.filter((m) => m.role === filter);
  const notify = (message) => onPendingAction?.(message);
  const canCreateMembers =
    !Array.isArray(creatableRoles) || creatableRoles.length > 0;

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
        <Button
          kind="default"
          icon={<Icon.Filter size={13} />}
          onClick={() => notify("部门筛选后台暂未接入。")}
        >
          部门
        </Button>
        <Button
          kind="default"
          icon={<Icon.Filter size={13} />}
          onClick={() => notify("成员状态筛选后台暂未接入。")}
        >
          状态
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          kind="default"
          icon={<Icon.Export size={13} />}
          onClick={() => notify("成员表导出后台暂未接入。")}
        >
          导出成员表
        </Button>
        {canCreateMembers ? (
          <Button
            kind="primary"
            icon={<Icon.Plus size={13} stroke="#fff" />}
            onClick={onInvite}
          >
            邀请成员
          </Button>
        ) : (
          <Badge tone="neutral">当前角色无创建权限</Badge>
        )}
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
                      {m.status === "suspended" && (
                        <Badge tone="neutral">已停用</Badge>
                      )}
                      {m.status === "invited" && (
                        <Badge tone="amber">邀请中</Badge>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-400)" }}
                    >
                      {memberIdentityText(m)}
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
                  {m.dept || "未分组"}
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
                  {m.phone || "—"}
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
                  {m.lastSeen || "—"}
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
                  {m.joined || formatMemberDate(m.createdAt)}
                </span>
              ),
            },
            {
              title: "操作",
              align: "right",
              render: (m) => (
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <Button
                    size="sm"
                    kind="default"
                    onClick={() => onEditRole?.(m)}
                  >
                    编辑角色
                  </Button>
                  <Button
                    size="sm"
                    kind={m.status === "suspended" ? "default" : "danger"}
                    onClick={() => onChangeStatus?.(m)}
                  >
                    {m.status === "suspended" ? "恢复成员" : "停用成员"}
                  </Button>
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

function memberIdentityText(member) {
  const email = typeof member?.email === "string" ? member.email.trim() : "";
  const phone = typeof member?.phone === "string" ? member.phone.trim() : "";
  const loginAccount =
    typeof member?.loginAccount === "string" ? member.loginAccount.trim() : "";
  const localAccount = accountFromLocalSubaccountEmail(email);
  const account = loginAccount || localAccount;

  if (account && (localAccount || member?.requiresOnboarding)) {
    return `默认账号 ${account} · 首次登录待激活`;
  }

  const contacts = [];
  if (email) contacts.push(`邮箱 ${email}`);
  if (phone) contacts.push(`手机 ${phone}`);

  return contacts.length ? contacts.join(" · ") : "暂无联系方式";
}

function accountFromLocalSubaccountEmail(email) {
  const normalized = email.trim().toLowerCase();
  const suffix = "@subaccount.local";
  if (!normalized.endsWith(suffix)) {
    return "";
  }

  return email.slice(0, email.length - suffix.length);
}

const ORG_MEMBER_ROLE_OPTIONS = [
  { key: "ops_manager", label: "运营负责人" },
  { key: "operator_business", label: "次级运营 / 商务" },
  { key: "finance", label: "财务" },
  { key: "streamer", label: "主播" },
  { key: "owner", label: "负责人" },
];

function organizationMemberRoleOptionsFor(creatableRoles) {
  if (!Array.isArray(creatableRoles)) {
    return ORG_MEMBER_ROLE_OPTIONS;
  }

  const allowed = new Set(creatableRoles);
  return ORG_MEMBER_ROLE_OPTIONS.filter((option) => allowed.has(option.key));
}

function formatOrganizationMemberError(error) {
  const message = error?.message || "成员操作失败。";
  if (/Current role cannot create (.+) accounts/i.test(message)) {
    return "当前角色无权创建该类型账号，请切换负责人或运营账号后重试。";
  }

  return message;
}

function OrganizationSettingsDrawer({ settings, onClose, onSubmit }) {
  const normalized = normalizeOrganizationSettings(settings);
  const [name, setName] = React.useState(normalized.name);
  const [logoText, setLogoText] = React.useState(normalized.logoText);
  const [memberLimit, setMemberLimit] = React.useState(
    normalized.memberLimit == null ? "" : String(normalized.memberLimit),
  );
  const [features, setFeatures] = React.useState(normalized.features);
  const [message, setMessage] = React.useState("");
  const enabledCount = countEnabledOrganizationFeatures({ features });

  const toggleFeature = (key) => {
    setFeatures((current) => ({ ...current, [key]: !current[key] }));
  };

  const submit = () => {
    const nextName = name.trim();
    const nextMemberLimit = memberLimit.trim() ? Number(memberLimit) : null;
    if (!nextName) {
      setMessage("组织名称不能为空。");
      return;
    }
    if (
      nextMemberLimit != null &&
      (!Number.isFinite(nextMemberLimit) || nextMemberLimit <= 0)
    ) {
      setMessage("成员规模需要大于 0。");
      return;
    }
    setMessage("");
    onSubmit?.({
      name: nextName,
      logoText: logoText.trim().slice(0, 4) || normalized.logoText,
      memberLimit: nextMemberLimit,
      features,
    });
  };

  return (
    <Drawer title="组织功能设置" onClose={onClose}>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--blue-50)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--blue-600)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            星
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-900)",
              }}
            >
              {normalized.plan || "套餐以账务后台为准"}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}
            >
              {enabledCount} / {ORGANIZATION_FEATURE_OPTIONS.length}{" "}
              项功能已启用
            </div>
          </div>
          {normalized.verified ? (
            <Badge tone="green" dot>
              已认证
            </Badge>
          ) : null}
        </div>

        <OrgMemberField label="组织名称">
          <input
            aria-label="组织名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="请输入组织名称"
            style={orgMemberInputStyle}
          />
        </OrgMemberField>

        <OrgMemberField label="LOGO 字标">
          <input
            aria-label="LOGO 字标"
            value={logoText}
            maxLength={4}
            onChange={(event) => setLogoText(event.target.value)}
            placeholder="JY"
            style={orgMemberInputStyle}
          />
        </OrgMemberField>

        <OrgMemberField label="成员规模">
          <input
            aria-label="成员规模"
            type="number"
            min="1"
            value={memberLimit}
            onChange={(event) => setMemberLimit(event.target.value)}
            placeholder="按组织合同配置"
            style={orgMemberInputStyle}
          />
        </OrgMemberField>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 500 }}
          >
            功能开关
          </div>
          {ORGANIZATION_FEATURE_OPTIONS.map((feature) => {
            const checked = Boolean(features[feature.key]);
            return (
              <label
                key={feature.key}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  background: checked ? "var(--blue-50)" : "#fff",
                  cursor: "pointer",
                }}
              >
                <input
                  aria-label={feature.label}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFeature(feature.key)}
                  style={{ marginTop: 2, accentColor: "var(--blue-600)" }}
                />
                <span
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-900)",
                    }}
                  >
                    {feature.label}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    {feature.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {message ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--danger-600)" }}
          >
            {message}
          </div>
        ) : null}
      </div>
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button kind="default" onClick={onClose}>
          取消
        </Button>
        <Button kind="primary" onClick={submit}>
          保存功能设置
        </Button>
      </div>
    </Drawer>
  );
}

function OrganizationMemberDrawer({ creatableRoles, onClose, onSubmit }) {
  const [mode, setMode] = React.useState("invite");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const roleOptions = organizationMemberRoleOptionsFor(creatableRoles);
  const [role, setRole] = React.useState(
    roleOptions[0]?.key || "operator_business",
  );
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [generatedCredentials, setGeneratedCredentials] = React.useState(null);

  React.useEffect(() => {
    if (!roleOptions.some((option) => option.key === role)) {
      setRole(roleOptions[0]?.key || "streamer");
    }
  }, [role, roleOptions]);

  React.useEffect(() => {
    setMessage("");
    setGeneratedCredentials(null);
  }, [mode]);

  const submit = async () => {
    setBusy(true);
    setMessage("");
    if (roleOptions.length === 0) {
      setMessage("当前角色无权创建组织成员。");
      setBusy(false);
      return;
    }

    try {
      const result = await onSubmit?.({
        mode,
        ...(mode === "invite" ? { email } : {}),
        name,
        role,
      });
      if (result?.credentials) {
        setGeneratedCredentials(result.credentials);
      }
    } catch (error) {
      setMessage(formatOrganizationMemberError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={mode === "subaccount" ? "创建子账号" : "邀请成员"}
      onClose={onClose}
    >
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <Button
            kind={mode === "invite" ? "primary" : "default"}
            onClick={() => setMode("invite")}
          >
            邀请成员
          </Button>
          <Button
            kind={mode === "subaccount" ? "primary" : "default"}
            onClick={() => setMode("subaccount")}
          >
            创建子账号
          </Button>
        </div>

        {mode === "invite" ? (
          <OrgMemberField label="成员邮箱">
            <input
              aria-label="成员邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              style={orgMemberInputStyle}
            />
          </OrgMemberField>
        ) : (
          <div
            style={{
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--blue-50)",
              fontSize: 12,
              color: "var(--ink-500)",
              lineHeight: 1.6,
            }}
          >
            系统将生成默认账号和 8
            位默认密码。首次登录需补充邮箱、电话并设置新密码。
          </div>
        )}
        <OrgMemberField label="成员姓名">
          <input
            aria-label="成员姓名"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="成员真实姓名"
            style={orgMemberInputStyle}
          />
        </OrgMemberField>
        <OrgMemberField label="成员角色">
          <select
            aria-label="成员角色"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            style={orgMemberInputStyle}
          >
            {roleOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </OrgMemberField>
        {generatedCredentials ? (
          <div
            style={{
              padding: 12,
              border: "1px solid var(--line-strong)",
              borderRadius: 8,
              background: "#fff",
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
              首次登录凭据，仅展示本次创建结果
            </div>
            <div
              className="mono"
              style={{ fontSize: 13, color: "var(--ink-900)" }}
            >
              默认账号：{generatedCredentials.account}
            </div>
            <div
              className="mono"
              style={{ fontSize: 13, color: "var(--ink-900)" }}
            >
              默认密码：{generatedCredentials.password}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
              用户首次登录后必须填写邮箱、电话和新密码，后续可用邮箱或电话 +
              密码登录。
            </div>
          </div>
        ) : null}
        {message ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--danger-600)" }}
          >
            {message}
          </div>
        ) : null}
      </div>
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button kind="default" onClick={onClose}>
          {generatedCredentials ? "关闭" : "取消"}
        </Button>
        <Button
          kind="primary"
          onClick={submit}
          disabled={busy || generatedCredentials || roleOptions.length === 0}
        >
          {busy ? "提交中…" : mode === "subaccount" ? "确认创建" : "发送邀请"}
        </Button>
      </div>
    </Drawer>
  );
}

function RoleEditDrawer({ member, onClose, onSubmit }) {
  const [role, setRole] = React.useState(member.role);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      await onSubmit?.(member.id, { role, reason });
    } catch (error) {
      setMessage(error?.message || "角色保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={`编辑角色 · ${member.name}`} onClose={onClose}>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {memberIdentityText(member)}
        </div>
        <OrgMemberField label="新角色">
          <select
            aria-label="新角色"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            style={orgMemberInputStyle}
          >
            {ORG_MEMBER_ROLE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </OrgMemberField>
        <OrgMemberField label="变更原因">
          <textarea
            aria-label="变更原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="记录角色变更原因，写入权限审计日志"
            style={{
              ...orgMemberInputStyle,
              minHeight: 84,
              resize: "vertical",
            }}
          />
        </OrgMemberField>
        {message ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--danger-600)" }}
          >
            {message}
          </div>
        ) : null}
      </div>
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button kind="default" onClick={onClose}>
          取消
        </Button>
        <Button kind="primary" onClick={submit} disabled={busy}>
          {busy ? "保存中…" : "保存角色"}
        </Button>
      </div>
    </Drawer>
  );
}

function StatusEditDrawer({ member, onClose, onSubmit }) {
  const nextStatus = member.status === "suspended" ? "active" : "suspended";
  const isSuspending = nextStatus === "suspended";
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      await onSubmit?.(member.id, { status: nextStatus, reason });
    } catch (error) {
      setMessage(error?.message || "成员状态保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={`${isSuspending ? "停用成员" : "恢复成员"} · ${member.name}`}
      onClose={onClose}
    >
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {memberIdentityText(member)}
        </div>
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: isSuspending ? "#FDECEC" : "var(--ok-50)",
            color: isSuspending ? "var(--danger-600)" : "var(--ok-600)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {isSuspending
            ? "停用后该成员无法继续访问当前组织数据。"
            : "恢复后该成员将按当前角色重新获得组织访问权限。"}
        </div>
        <OrgMemberField label="状态变更原因">
          <textarea
            aria-label="状态变更原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="记录停用或恢复原因，写入权限审计日志"
            style={{
              ...orgMemberInputStyle,
              minHeight: 84,
              resize: "vertical",
            }}
          />
        </OrgMemberField>
        {message ? (
          <div
            aria-live="polite"
            style={{ fontSize: 12, color: "var(--danger-600)" }}
          >
            {message}
          </div>
        ) : null}
      </div>
      <div
        style={{
          padding: 12,
          borderTop: "1px solid var(--line)",
          background: "var(--bg-soft)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button kind="default" onClick={onClose}>
          取消
        </Button>
        <Button
          kind={isSuspending ? "danger" : "primary"}
          onClick={submit}
          disabled={busy}
        >
          {busy ? "保存中…" : isSuspending ? "确认停用" : "确认恢复"}
        </Button>
      </div>
    </Drawer>
  );
}

function OrgMemberField({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--ink-500)", fontWeight: 500 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const orgMemberInputStyle = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  border: "1px solid var(--line-strong)",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--ink-700)",
  background: "#fff",
  fontFamily: "inherit",
};

function formatMemberDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDateKey(date);
}

function RoleFilter({ value, onChange }) {
  const opts = [
    { key: "all", label: "全部角色" },
    { key: "owner", label: "负责人" },
    { key: "ops_manager", label: "运营负责人" },
    { key: "operator_business", label: "次级运营" },
    { key: "finance", label: "财务" },
  ];
  return (
    <label
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
      }}
    >
      <Icon.Streamer size={13} stroke="var(--ink-500)" />
      <span style={{ color: "var(--ink-400)" }}>角色：</span>
      <select
        value={value}
        aria-label="角色筛选"
        onChange={(event) => onChange(event.target.value)}
        style={{
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-700)",
        }}
      >
        {opts.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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

function ScreenAudit() {
  const entries = useOpsAuditEntries();
  const actions = useOpsLiveActions();
  const [filter, setFilter] = React.useState("all");
  const [busy, setBusy] = React.useState(false);
  const [activeId, setActiveId] = React.useState(entries[0]?.id || null);

  React.useEffect(() => {
    if (!entries.some((entry) => entry.id === activeId)) {
      setActiveId(entries[0]?.id || null);
    }
  }, [activeId, entries]);

  const filtered = React.useMemo(() => {
    if (filter === "highRisk") {
      return entries.filter((entry) => entry.isHighRisk);
    }
    if (filter === "settlement") {
      return entries.filter((entry) => entry.module === "settlement");
    }
    if (filter === "failure") {
      return entries.filter((entry) => entry.result === "failure");
    }
    return entries;
  }, [entries, filter]);

  const activeEntry =
    entries.find((entry) => entry.id === activeId) || filtered[0] || null;
  const highRiskCount = entries.filter((entry) => entry.isHighRisk).length;
  const failureCount = entries.filter(
    (entry) => entry.result === "failure",
  ).length;
  const moduleCount = new Set(entries.map((entry) => entry.module)).size;

  const refresh = async () => {
    if (!actions.refreshAuditEntries || busy) return;
    setBusy(true);
    try {
      await actions.refreshAuditEntries();
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "刷新审计日志失败",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="操作日志 & 审计"
        subtitle="差异日志、角色可见范围、高风险原因与导出留痕统一进入审计中心"
        actions={
          <>
            <Button
              kind="default"
              icon={<Icon.Filter size={14} />}
              onClick={() => setFilter("highRisk")}
            >
              高风险
            </Button>
            <Button
              kind="primary"
              icon={<Icon.Audit size={14} stroke="#fff" />}
              onClick={refresh}
              disabled={busy || !actions.refreshAuditEntries}
            >
              {busy ? "刷新中…" : "刷新日志"}
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Card>
            <Metric
              label="审计日志"
              value={String(entries.length)}
              unit="条"
              hint="仅展示当前角色可见范围"
            />
          </Card>
          <Card>
            <Metric
              label="高风险操作"
              value={String(highRiskCount)}
              unit="条"
              delta={highRiskCount > 0 ? "需复核原因" : "无待复核"}
              deltaTone={highRiskCount > 0 ? "amber" : "green"}
            />
          </Card>
          <Card>
            <Metric
              label="失败操作"
              value={String(failureCount)}
              unit="条"
              hint="失败原因只显示错误摘要"
            />
          </Card>
          <Card style={{ borderColor: "var(--blue-200)" }}>
            <Metric
              label="覆盖模块"
              value={String(moduleCount)}
              unit="个"
              hint="权限过滤在服务端完成"
            />
          </Card>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.55fr 0.8fr",
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
                value={filter}
                onChange={setFilter}
                items={[
                  { key: "all", label: "全部", count: entries.length },
                  {
                    key: "highRisk",
                    label: "高风险",
                    count: highRiskCount,
                  },
                  {
                    key: "settlement",
                    label: "结算",
                    count: entries.filter(
                      (entry) => entry.module === "settlement",
                    ).length,
                  },
                  { key: "failure", label: "失败", count: failureCount },
                ]}
              />
            </div>
            <DataTable
              activeRowId={activeEntry?.id}
              onRowClick={(entry) => setActiveId(entry.id)}
              emptyText="暂无可见审计日志"
              columns={[
                {
                  title: "日志",
                  width: 170,
                  render: (entry) => (
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 11, color: "var(--ink-400)" }}
                      >
                        {displayRecordId(entry.id, "审计日志")}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "var(--ink-400)",
                          marginTop: 3,
                        }}
                      >
                        {formatOpsMinute(entry.createdAt)}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "操作人",
                  render: (entry) => (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 9 }}
                    >
                      <Avatar
                        name={entry.actorName || entry.actorRole || "系统"}
                      />
                      <div>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "var(--ink-900)",
                          }}
                        >
                          {entry.actorName || "系统"}
                        </div>
                        <div
                          className="mono"
                          style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                        >
                          {auditRoleLabel(entry.actorRole)}
                        </div>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "模块 / 动作",
                  render: (entry) => (
                    <div>
                      <div
                        className="mono"
                        style={{ fontSize: 12, color: "var(--ink-900)" }}
                      >
                        {entry.module} / {entry.action}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Badge tone={auditModuleTone(entry.module)}>
                          {auditModuleLabel(entry.module)}
                        </Badge>
                        <Badge
                          tone={entry.result === "failure" ? "red" : "green"}
                          dot
                        >
                          {entry.result === "failure" ? "失败" : "成功"}
                        </Badge>
                      </div>
                    </div>
                  ),
                },
                {
                  title: "对象",
                  render: (entry) => (
                    <div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-700)" }}>
                        {entry.objectName || entry.objectType}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: "var(--ink-400)",
                          marginTop: 3,
                        }}
                      >
                        {displayRecordId(entry.objectId, "业务对象")}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "变更字段",
                  width: 150,
                  render: (entry) => (
                    <span
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--ink-500)" }}
                    >
                      {auditChangedFields(entry)}
                    </span>
                  ),
                },
                {
                  title: "风险",
                  render: (entry) =>
                    entry.isHighRisk ? (
                      <Badge tone="red" dot>
                        高风险
                      </Badge>
                    ) : (
                      <Badge tone="neutral">普通</Badge>
                    ),
                },
                {
                  title: "原因",
                  wrap: true,
                  render: (entry) => (
                    <span
                      style={{
                        display: "inline-block",
                        maxWidth: 220,
                        color: entry.reason
                          ? "var(--ink-700)"
                          : "var(--ink-400)",
                        fontSize: 12,
                        whiteSpace: "normal",
                      }}
                    >
                      {entry.reason || entry.errorMessage || "—"}
                    </span>
                  ),
                },
              ]}
              rows={filtered}
            />
          </Card>

          <AuditEntryDetail entry={activeEntry} />
        </div>
      </div>
    </>
  );
}

function AuditEntryDetail({ entry }) {
  if (!entry) {
    return (
      <Card title="日志详情">
        <div
          style={{ padding: 32, textAlign: "center", color: "var(--ink-400)" }}
        >
          暂无日志详情
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="日志详情"
      extra={
        entry.isHighRisk ? (
          <Badge tone="red" dot>
            高风险
          </Badge>
        ) : (
          <Badge tone="green" dot>
            已记录
          </Badge>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <KV label="日志 ID">
          <span className="mono">{displayRecordId(entry.id, "审计日志")}</span>
        </KV>
        <KV label="发生时间">
          <span className="mono">{formatOpsMinute(entry.createdAt)}</span>
        </KV>
        <KV label="操作人">
          {entry.actorName || "系统"} · {auditRoleLabel(entry.actorRole)}
        </KV>
        <KV label="模块动作">
          <span className="mono">
            {entry.module} / {entry.action}
          </span>
        </KV>
        <KV label="对象">
          {entry.objectType} ·{" "}
          <span className="mono">
            {displayRecordId(entry.objectId, "业务对象")}
          </span>
        </KV>
        <KV label="项目">
          <span className="mono">
            {displayRecordId(entry.projectId, "项目")}
          </span>
        </KV>
        <KV label="变更字段">
          <span className="mono">{auditChangedFields(entry)}</span>
        </KV>
        <KV label="结果">
          <Badge tone={entry.result === "failure" ? "red" : "green"} dot>
            {entry.result === "failure" ? "失败" : "成功"}
          </Badge>
        </KV>
        <KV label="原因">
          <span
            style={{
              color: entry.reason ? "var(--ink-700)" : "var(--ink-400)",
            }}
          >
            {entry.reason || "—"}
          </span>
        </KV>
        {entry.errorMessage && (
          <KV label="错误摘要">
            <span style={{ color: "var(--danger-600)" }}>
              {entry.errorMessage}
            </span>
          </KV>
        )}
      </div>
    </Card>
  );
}

function ScreenNotifications() {
  const notifications = useOpsNotifications();
  const actions = useOpsLiveActions();
  const [filter, setFilter] = React.useState("all");
  const [busyId, setBusyId] = React.useState(null);

  const filtered = React.useMemo(() => {
    if (filter === "open") {
      return notifications.filter(
        (item) => item.status === "unread" || item.status === "read",
      );
    }
    if (filter === "highRisk") {
      return notifications.filter((item) => item.isHighRisk);
    }
    if (filter === "handled") {
      return notifications.filter((item) => item.status === "handled");
    }
    return notifications;
  }, [filter, notifications]);

  const unreadCount = notifications.filter(
    (item) => item.status === "unread",
  ).length;
  const openCount = notifications.filter(
    (item) => item.status === "unread" || item.status === "read",
  ).length;
  const highRiskCount = notifications.filter((item) => item.isHighRisk).length;

  const updateStatus = async (item, action) => {
    if (!actions.updateNotificationStatus || busyId) return;
    setBusyId(item.id);
    try {
      await actions.updateNotificationStatus(item.id, action);
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "更新通知状态失败",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="通知待办"
        subtitle="站内提醒、待办状态与高风险动作通知统一在这里处理"
        actions={
          <Button
            kind="primary"
            icon={<Icon.Bell size={14} stroke="#fff" />}
            onClick={actions.refreshNotifications}
            disabled={!actions.refreshNotifications}
          >
            刷新通知
          </Button>
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <Card>
            <Metric
              label="通知总数"
              value={String(notifications.length)}
              unit="条"
              hint="仅展示当前用户或角色可见范围"
            />
          </Card>
          <Card>
            <Metric
              label="未读"
              value={String(unreadCount)}
              unit="条"
              delta={unreadCount > 0 ? "需要查看" : "已清空"}
              deltaTone={unreadCount > 0 ? "amber" : "green"}
            />
          </Card>
          <Card>
            <Metric
              label="待处理"
              value={String(openCount)}
              unit="条"
              hint="未读与已读未处理"
            />
          </Card>
          <Card>
            <Metric
              label="高风险"
              value={String(highRiskCount)}
              unit="条"
              delta={highRiskCount > 0 ? "需复核" : "无风险提醒"}
              deltaTone={highRiskCount > 0 ? "red" : "green"}
            />
          </Card>
        </div>

        <Card padded={false}>
          <div
            style={{
              padding: "0 12px",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { key: "all", label: "全部", count: notifications.length },
                { key: "open", label: "待办", count: openCount },
                { key: "highRisk", label: "高风险", count: highRiskCount },
                {
                  key: "handled",
                  label: "已处理",
                  count: notifications.filter(
                    (item) => item.status === "handled",
                  ).length,
                },
              ]}
            />
          </div>
          <DataTable
            emptyText="暂无可见通知"
            columns={[
              {
                title: "通知",
                render: (item) => (
                  <div>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "var(--ink-900)",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11.5,
                        color: "var(--ink-500)",
                        maxWidth: 320,
                        whiteSpace: "normal",
                      }}
                    >
                      {item.content}
                    </div>
                    <div
                      className="mono"
                      style={{
                        marginTop: 5,
                        fontSize: 10.5,
                        color: "var(--ink-400)",
                      }}
                    >
                      {displayRecordId(item.id, "通知")} ·{" "}
                      {formatOpsMinute(item.createdAt)}
                    </div>
                  </div>
                ),
              },
              {
                title: "类型",
                render: (item) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone={notificationTypeTone(item.type)}>
                      {notificationTypeLabel(item.type)}
                    </Badge>
                    {item.isHighRisk && (
                      <Badge tone="red" dot>
                        高风险
                      </Badge>
                    )}
                  </div>
                ),
              },
              {
                title: "对象",
                render: (item) => (
                  <div>
                    <div
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--ink-700)" }}
                    >
                      {item.objectType || "system"}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--ink-400)" }}
                    >
                      {displayRecordId(item.objectId, "业务对象")}
                    </div>
                  </div>
                ),
              },
              {
                title: "状态",
                render: (item) => (
                  <Badge tone={notificationStatusTone(item.status)} dot>
                    {notificationStatusLabel(item.status)}
                  </Badge>
                ),
              },
              {
                title: "操作",
                width: 210,
                render: (item) => (
                  <div style={{ display: "flex", gap: 8 }}>
                    {item.status === "unread" && (
                      <Button
                        size="sm"
                        kind="default"
                        onClick={() => updateStatus(item, "read")}
                        disabled={busyId === item.id}
                      >
                        标记已读
                      </Button>
                    )}
                    {item.status !== "handled" && (
                      <Button
                        size="sm"
                        kind="primary"
                        onClick={() => updateStatus(item, "handled")}
                        disabled={busyId === item.id}
                      >
                        标记已处理
                      </Button>
                    )}
                    {item.status !== "ignored" && (
                      <Button
                        size="sm"
                        kind="ghost"
                        onClick={() => updateStatus(item, "ignored")}
                        disabled={busyId === item.id}
                      >
                        忽略
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={filtered}
          />
        </Card>
      </div>
    </>
  );
}

function ScreenExport() {
  const actions = useOpsLiveActions();
  const projects = useOpsProjects();
  const [kind, setKind] = React.useState("audit_logs");
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    if (!projectId && projects[0]?.id) {
      setProjectId(projects[0].id);
      return;
    }
    if (projectId && !projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0]?.id ?? "");
    }
  }, [projectId, projects]);

  const exportKinds = [
    { key: "audit_logs", label: "审计日志" },
    { key: "vendor_delivery", label: "厂家交付包" },
    { key: "settlement_batch", label: "结算批次" },
    { key: "report_details", label: "报数明细" },
  ];

  const submit = async () => {
    if (!actions.createGovernedExport || busy) return;
    setBusy(true);
    try {
      const rows =
        kind === "vendor_delivery"
          ? await actions.readVendorDeliveryPackage?.(projectId)
          : [];
      const exportResult = await actions.createGovernedExport({
        kind,
        rows: Array.isArray(rows) ? rows : [],
      });
      setResult(exportResult);
    } catch (error) {
      globalThis.alert?.(
        error instanceof Error ? error.message : "生成导出失败",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="数据导出中心"
        subtitle="按角色字段白名单生成导出预览，导出动作统一写入审计日志"
        actions={
          <Button
            kind="primary"
            icon={<Icon.Export size={14} stroke="#fff" />}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "生成中…" : "生成导出"}
          </Button>
        }
      />
      <div
        style={{
          padding: 20,
          display: "grid",
          gridTemplateColumns: "0.9fr 1.2fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        <Card title="导出类型" padded={false}>
          <div style={{ padding: 12 }}>
            <Tabs
              value={kind}
              onChange={setKind}
              items={exportKinds.map((item) => ({
                key: item.key,
                label: item.label,
              }))}
            />
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {kind === "vendor_delivery" ? (
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--ink-500)",
                    fontWeight: 600,
                  }}
                >
                  交付包项目
                  <select
                    aria-label="交付包项目"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    style={{
                      height: 34,
                      border: "1px solid var(--line-strong)",
                      borderRadius: 6,
                      background: "#fff",
                      color: "var(--ink-700)",
                      fontSize: 13,
                      outline: "none",
                      padding: "0 10px",
                    }}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <SectionTitle>治理规则</SectionTitle>
              {[
                { label: "字段控制", val: "服务端白名单", tone: "blue" },
                { label: "敏感字段", val: "角色过滤", tone: "green" },
                { label: "导出审计", val: "自动留痕", tone: "amber" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--bg-soft)",
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    {item.label}
                  </span>
                  <Badge tone={item.tone}>{item.val}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="导出预览" padded={true}>
          {result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--ink-900)",
                }}
              >
                {result.filename}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Badge tone="blue">{result.kind}</Badge>
                <Badge tone="green">{result.rowCount} 行</Badge>
                <Badge tone="violet">{result.fieldCount} 字段</Badge>
              </div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg-soft)",
                  border: "1px solid var(--line)",
                  fontSize: 11.5,
                  color: "var(--ink-700)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {result.content}
              </pre>
            </div>
          ) : (
            <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
              选择导出类型后点击生成导出，系统会按角色字段白名单返回预览。
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function auditChangedFields(entry) {
  return Array.isArray(entry.changedFields) && entry.changedFields.length > 0
    ? entry.changedFields.join(", ")
    : "—";
}

function auditModuleLabel(module) {
  const labels = {
    auth: "鉴权",
    project: "项目",
    application: "选播",
    live: "履约",
    settlement: "结算",
    finance: "财务",
    audit: "审计",
    export: "导出",
  };
  return labels[module] || module || "未知";
}

function auditModuleTone(module) {
  if (module === "settlement" || module === "finance") return "violet";
  if (module === "auth" || module === "audit") return "ink";
  if (module === "live") return "teal";
  if (module === "project" || module === "application") return "blue";
  if (module === "export") return "amber";
  return "neutral";
}

function auditRoleLabel(role) {
  const labels = {
    owner: "负责人",
    ops_manager: "运营负责人",
    operator_business: "次级运营",
    finance: "财务",
    streamer: "主播",
  };
  return labels[role] || role || "系统";
}

function notificationTypeLabel(type) {
  const labels = {
    task: "任务",
    review: "审核",
    anomaly: "异常",
    settlement: "结算",
    system: "系统",
    high_risk: "高风险",
  };
  return labels[type] || type || "通知";
}

function notificationTypeTone(type) {
  if (type === "high_risk") return "red";
  if (type === "settlement") return "violet";
  if (type === "anomaly") return "amber";
  if (type === "review") return "blue";
  if (type === "task") return "green";
  return "neutral";
}

function notificationStatusLabel(status) {
  const labels = {
    unread: "未读",
    read: "已读",
    handled: "已处理",
    ignored: "已忽略",
  };
  return labels[status] || status || "未知";
}

function notificationStatusTone(status) {
  if (status === "unread") return "blue";
  if (status === "handled") return "green";
  if (status === "ignored") return "neutral";
  return "amber";
}

function ScreenBilling({ billingStatus, onRefresh }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const usageRows = billingStatus?.usage ?? [];
  const entitlementRows = Object.entries(billingStatus?.entitlements ?? {}).map(
    ([key, enabled]) => ({
      key,
      label: BILLING_FEATURE_LABELS[key] ?? key,
      enabled,
    }),
  );

  const refresh = async () => {
    if (!onRefresh || busy) return;
    setBusy(true);
    setError("");
    try {
      await onRefresh();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "刷新账务状态失败",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="商业化与套餐"
        subtitle="组织套餐、功能权益与用量状态统一由账务服务返回"
        actions={
          <Button kind="primary" onClick={refresh} disabled={busy}>
            {busy ? "刷新中…" : "刷新账务状态"}
          </Button>
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
        {!billingStatus ? (
          <Card>
            <EmptyHint
              title="暂无账务状态"
              hint="点击刷新后从账务服务读取当前组织的套餐、权益和用量。"
              actionLabel="刷新账务状态"
              onAction={refresh}
            />
          </Card>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              <Card>
                <Metric
                  label="当前套餐"
                  value={billingPlanName(billingStatus.plan)}
                  hint={billingStatus.plan.code}
                />
              </Card>
              <Card>
                <Metric
                  label="订阅状态"
                  value={billingStatusLabel(billingStatus.subscriptionStatus)}
                  hint={billingStatus.subscriptionStatus}
                />
              </Card>
              <Card>
                <Metric
                  label="账务模式"
                  value={billingModeLabel(billingStatus.mode)}
                  hint={
                    billingStatus.mode === "read_only"
                      ? "写入动作会被套餐闸口拦截"
                      : "写入动作按权益放行"
                  }
                />
              </Card>
              <Card>
                <Metric
                  label="已开权益"
                  value={String(
                    entitlementRows.filter((row) => row.enabled).length,
                  )}
                  unit="项"
                  hint={`${entitlementRows.length} 项可配置能力`}
                />
              </Card>
            </div>

            {billingStatus.mode === "read_only" && (
              <Card>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "var(--danger-700)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <Icon.Warn size={16} stroke="var(--danger-600)" />
                  只读模式：逾期、只读或取消状态下，写入型经营动作会由账务闸口拦截。
                </div>
              </Card>
            )}

            <Card title="功能权益" padded={false}>
              <DataTable
                columns={[
                  {
                    title: "能力",
                    render: (row) => (
                      <div>
                        <div
                          style={{ fontWeight: 600, color: "var(--ink-900)" }}
                        >
                          {row.label}
                        </div>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                        >
                          {row.key}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "状态",
                    render: (row) => (
                      <Badge tone={row.enabled ? "green" : "neutral"} dot>
                        {row.enabled ? "已开通" : "未开通"}
                      </Badge>
                    ),
                  },
                ]}
                rows={entitlementRows}
              />
            </Card>

            <Card title="本月用量" padded={false}>
              <DataTable
                columns={[
                  {
                    title: "指标",
                    render: (row) => (
                      <div>
                        <div
                          style={{ fontWeight: 600, color: "var(--ink-900)" }}
                        >
                          {BILLING_METRIC_LABELS[row.metric] ?? row.metric}
                        </div>
                        <div
                          className="mono"
                          style={{ fontSize: 11, color: "var(--ink-400)" }}
                        >
                          {row.metric}
                        </div>
                      </div>
                    ),
                  },
                  { title: "已用", render: (row) => row.usedQuantity },
                  { title: "套餐内", render: (row) => row.includedQuantity },
                  { title: "加购", render: (row) => row.addonQuantity },
                  { title: "剩余", render: (row) => row.remainingQuantity },
                  {
                    title: "超额",
                    render: (row) => (
                      <Badge tone={row.overageQuantity > 0 ? "amber" : "green"}>
                        {row.overageQuantity}
                      </Badge>
                    ),
                  },
                ]}
                rows={usageRows}
              />
            </Card>
          </>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "var(--danger-600)" }}>
            {error}
          </div>
        )}
      </div>
    </>
  );
}

const BILLING_FEATURE_LABELS = {
  project_management: "项目管理",
  settlement: "结算中心",
  export_center: "导出中心",
  war_room: "智能作战台",
  auto_review_shadow: "自动审核影子模式",
  auto_review_active: "自动审核正式模式",
  ai_diagnosis: "AI 诊断",
  vendor_portal: "厂家门户",
  private_deployment: "私有化部署",
};

const BILLING_METRIC_LABELS = {
  active_streamer: "活跃主播",
  seat: "席位",
  ocr: "OCR 识别",
  ai: "AI 调用",
  storage_mb: "存储 MB",
  export: "导出中心",
};

function billingPlanName(plan) {
  const labels = {
    free: "免费版",
    pro: "专业版",
    enterprise: "企业版",
  };
  return labels[plan?.code] ?? plan?.name ?? "未配置套餐";
}

function billingStatusLabel(status) {
  const labels = {
    trialing: "试用中",
    active: "活跃",
    past_due: "逾期",
    readonly: "只读",
    cancelled: "已取消",
  };
  return labels[status] ?? status ?? "未知";
}

function billingModeLabel(mode) {
  return mode === "read_only" ? "只读模式" : "活跃";
}

function upsertReferenceTasks(currentTasks, nextTasks) {
  const base = Array.isArray(currentTasks) ? currentTasks : [];
  const normalizedNext = nextTasks.filter(Boolean);
  const nextIds = new Set(normalizedNext.map((task) => task.id));
  return [...base.filter((task) => !nextIds.has(task.id)), ...normalizedNext];
}

function toOpsReferenceTaskFromMutation(task, fallback = {}) {
  if (!task?.id) return null;
  return toOpsReferenceTask({
    id: task.id,
    title: task.title || fallback.title || "排班任务",
    status: task.status || "pending_live",
    taskType:
      task.taskType ||
      task.type ||
      fallback.taskType ||
      fallback.type ||
      "project",
    projectId: task.projectId || fallback.projectId || null,
    projectName:
      task.projectName ||
      fallback.projectName ||
      fallback.projectId ||
      "Unknown project",
    streamerId: task.streamerId || fallback.streamerId || "",
    streamerName: task.streamerName || fallback.streamerName || "",
    plannedStartAt: task.plannedStartAt ?? fallback.plannedStartAt ?? null,
    plannedEndAt: task.plannedEndAt ?? fallback.plannedEndAt ?? null,
    plannedDuration: task.plannedDuration ?? fallback.plannedDuration ?? null,
    systemDuration: task.systemDuration ?? 0,
  });
}

// ===== src\app.jsx =====
// ——— App entry ————————————————————————————————

function OpsReferenceInner({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  liveSettlementPool,
  settlementScope,
  auditEntries,
  notificationItems,
  ocrJobs,
  organizationMembers,
  organizationMemberPermissions,
  organizationSettings,
  billingStatus,
  projectCards,
  streamerCards,
  applicationQueue,
  currentUser,
}) {
  // route can be: 'warroom' | 'projects' | 'project' | 'streamers' | 'tasks' | 'reports' | 'settle' | 'billing' | 'export' | 'audit' | 'org'
  const [route, setRoute] = React.useState(initialRoute);
  const [projectId, setProjectId] = React.useState(null);
  const [streamerId, setStreamerId] = React.useState(null);
  const [tasksState, setTasksState] = React.useState(liveTasks ?? null);
  const [reportsState, setReportsState] = React.useState(liveReports ?? null);
  const [batchesState, setBatchesState] = React.useState(liveBatches ?? null);
  const [batchDetailsState, setBatchDetailsState] = React.useState(
    liveBatchDetails ?? null,
  );
  const [settlementPoolState, setSettlementPoolState] = React.useState(
    liveSettlementPool ?? null,
  );
  const [auditEntriesState, setAuditEntriesState] = React.useState(
    auditEntries ?? null,
  );
  const [ocrJobsState, setOcrJobsState] = React.useState(ocrJobs ?? null);
  const [notificationItemsState, setNotificationItemsState] = React.useState(
    notificationItems ?? null,
  );
  const [organizationMembersState, setOrganizationMembersState] =
    React.useState(organizationMembers ?? null);
  const [
    organizationMemberPermissionsState,
    setOrganizationMemberPermissionsState,
  ] = React.useState(organizationMemberPermissions ?? null);
  const [organizationSettingsState, setOrganizationSettingsState] =
    React.useState(() => normalizeOrganizationSettings(organizationSettings));
  const [organizationSettingsOpen, setOrganizationSettingsOpen] =
    React.useState(false);
  const [billingStatusState, setBillingStatusState] = React.useState(
    billingStatus ?? null,
  );
  const [projectsState, setProjectsState] = React.useState(
    projectCards ?? null,
  );
  const [streamersState, setStreamersState] = React.useState(
    streamerCards ?? null,
  );
  const [applicationsState, setApplicationsState] = React.useState(
    applicationQueue ?? null,
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

  React.useEffect(() => {
    setSettlementPoolState(liveSettlementPool ?? null);
  }, [liveSettlementPool]);

  React.useEffect(() => {
    setAuditEntriesState(auditEntries ?? null);
  }, [auditEntries]);

  React.useEffect(() => {
    setOcrJobsState(ocrJobs ?? null);
  }, [ocrJobs]);

  React.useEffect(() => {
    setNotificationItemsState(notificationItems ?? null);
  }, [notificationItems]);

  React.useEffect(() => {
    setOrganizationMembersState(organizationMembers ?? null);
  }, [organizationMembers]);

  React.useEffect(() => {
    setOrganizationMemberPermissionsState(
      organizationMemberPermissions ?? null,
    );
  }, [organizationMemberPermissions]);

  React.useEffect(() => {
    setOrganizationSettingsState(
      normalizeOrganizationSettings(organizationSettings),
    );
  }, [organizationSettings]);

  React.useEffect(() => {
    setBillingStatusState(billingStatus ?? null);
  }, [billingStatus]);

  React.useEffect(() => {
    setProjectsState(projectCards ?? null);
  }, [projectCards]);

  React.useEffect(() => {
    setStreamersState(streamerCards ?? null);
  }, [streamerCards]);

  React.useEffect(() => {
    setApplicationsState(applicationQueue ?? null);
  }, [applicationQueue]);

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

    const refreshOpsTasks = async () => {
      const body = await fetchJson(
        "/api/live-tasks",
        "refresh live tasks failed",
      );
      if (Array.isArray(body.tasks)) {
        setTasksState(body.tasks.map((task) => toOpsReferenceTask(task)));
      }
    };

    const settlementPoolUrl = (scope) => {
      if (!scope?.periodStart || !scope?.periodEnd) {
        return null;
      }
      const params = new URLSearchParams({
        periodStart: scope.periodStart,
        periodEnd: scope.periodEnd,
      });
      if (scope.batchType && scope.batchType !== "payable") {
        params.set("batchType", scope.batchType);
      }
      return `/api/settlement-pool?${params.toString()}`;
    };

    const refreshReports = async () => {
      const body = await fetchJson(
        "/api/live-reports",
        "refresh reports failed",
      );
      if (Array.isArray(body.reports)) {
        setReportsState(body.reports.map(toReferenceReportFromApi));
      }
    };

    const refreshSettlementPool = async (scope = settlementScope) => {
      const url = settlementPoolUrl(scope);
      if (!url) return;
      const body = await fetchJson(url, "refresh settlement pool failed");
      if (Array.isArray(body.reports)) {
        setSettlementPoolState(
          body.reports.map(toReferenceSettlementPoolFromApi),
        );
      }
    };

    const refreshSettlementBatches = async () => {
      const body = await fetchJson(
        "/api/settlement-batches",
        "refresh settlement batches failed",
      );
      if (Array.isArray(body.batches)) {
        setBatchesState(
          body.batches.map((batch) => toReferenceBatchFromApi(batch, [])),
        );
      }
    };

    const refreshSettlementBatchDetail = async (batchId) => {
      const body = await fetchJson(
        `/api/settlement-batches/${batchId}`,
        "refresh settlement batch failed",
      );
      const items = Array.isArray(body.items) ? body.items : [];
      if (body.batch) {
        const batch = toReferenceBatchFromApi(body.batch, items);
        setBatchesState((current) => {
          const base = Array.isArray(current) ? current : [];
          return [batch, ...base.filter((item) => item.id !== batch.id)];
        });
      }
      setBatchDetailsState((current) => ({
        ...(current && typeof current === "object" ? current : {}),
        [batchId]: items.map((item, index) =>
          toReferenceBatchDetailFromApi(item, [], index),
        ),
      }));
    };

    const refreshAuditEntries = async () => {
      const body = await fetchJson(
        "/api/audit-logs?limit=50",
        "refresh audit logs failed",
      );
      if (Array.isArray(body.entries)) {
        setAuditEntriesState(body.entries);
      }
    };

    const upsertOcrJob = (job) => {
      if (!job) return;
      setOcrJobsState((current) => [
        job,
        ...(Array.isArray(current)
          ? current.filter((item) => item.id !== job.id)
          : []),
      ]);
    };

    const refreshOcrJobs = async (status) => {
      const query =
        status && status !== "all"
          ? `?status=${encodeURIComponent(status)}`
          : "";
      const body = await fetchJson(
        `/api/ocr/jobs${query}`,
        "refresh OCR jobs failed",
      );
      if (Array.isArray(body.jobs)) {
        setOcrJobsState(body.jobs);
      }
      return body.jobs;
    };

    const runNextOcrJob = async () => {
      const body = await fetchJson("/api/ocr/jobs/run", "run OCR job failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      });
      if (Array.isArray(body.jobs)) {
        body.jobs.forEach(upsertOcrJob);
      }
      return body.jobs;
    };

    const retryOcrJob = async (id) => {
      const body = await fetchJson(
        `/api/ocr/jobs/${id}`,
        "retry OCR job failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        },
      );
      upsertOcrJob(body.job);
      return body.job;
    };

    const markOcrJobNeedsReview = async (id) => {
      const body = await fetchJson(
        `/api/ocr/jobs/${id}`,
        "mark OCR job failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "needs_review" }),
        },
      );
      upsertOcrJob(body.job);
      return body.job;
    };

    const confirmOcrJob = async (id, manualResult) => {
      const body = await fetchJson(
        `/api/ocr/jobs/${id}`,
        "confirm OCR job failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "confirm", manualResult }),
        },
      );
      upsertOcrJob(body.job);
      return body.job;
    };

    const refreshNotifications = async () => {
      const body = await fetchJson(
        "/api/notifications",
        "refresh notifications failed",
      );
      if (Array.isArray(body.items)) {
        setNotificationItemsState(body.items);
      }
    };

    const refreshOrganizationMembers = async () => {
      const body = await fetchJson(
        "/api/organization/members",
        "refresh organization members failed",
      );
      if (Array.isArray(body.members)) {
        setOrganizationMembersState(body.members);
      }
      if (body.permissions && typeof body.permissions === "object") {
        setOrganizationMemberPermissionsState(body.permissions);
      }
      if (body.organization && typeof body.organization === "object") {
        setOrganizationSettingsState((current) =>
          normalizeOrganizationSettings({
            ...normalizeOrganizationSettings(current),
            id: body.organization.id,
            name: body.organization.name,
          }),
        );
      }
      return body.members;
    };

    const refreshBillingStatus = async () => {
      const body = await fetchJson(
        "/api/billing/status",
        "refresh billing failed",
        {
          method: "GET",
        },
      );
      if (body.billing) {
        setBillingStatusState(body.billing);
      }
      return body.billing;
    };

    const refreshProjects = async () => {
      const body = await fetchJson("/api/projects", "refresh projects failed");
      if (Array.isArray(body.projects)) {
        setProjectsState(body.projects);
      }
    };

    const refreshStreamers = async () => {
      const body = await fetchJson(
        "/api/streamers",
        "refresh streamers failed",
      );
      if (Array.isArray(body.streamers)) {
        setStreamersState(body.streamers);
      }
    };

    const refreshApplications = async () => {
      const body = await fetchJson(
        "/api/applications",
        "refresh applications failed",
      );
      if (Array.isArray(body.applications)) {
        setApplicationsState(body.applications);
      }
    };

    const refreshAdmissionProjectBoards = async () => {
      const body = await fetchJson(
        "/api/applications/admission-board",
        "refresh admission project board failed",
        { method: "GET" },
      );
      return Array.isArray(body.projects) ? body.projects : [];
    };

    const exportAdmissionRecordings = async (projectId) => {
      const body = await fetchJson(
        "/api/exports/admission-recordings",
        "export admission recordings failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        },
      );
      return body.export;
    };

    const createAdmissionShareBoard = async (projectId, input) => {
      return fetchJson(
        `/api/projects/${projectId}/admission-share-boards`,
        "create admission share board failed",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
    };

    const readVendorDeliveryPackage = async (projectId) => {
      const trimmedProjectId = String(projectId || "").trim();
      if (!trimmedProjectId) {
        return [];
      }
      const params = new URLSearchParams({ projectId: trimmedProjectId });
      const body = await fetchJson(
        `/api/delivery-packages?${params.toString()}`,
        "read delivery package failed",
        { method: "GET" },
      );
      return Array.isArray(body.items) ? body.items : [];
    };

    const scanAnomalies = async () => {
      const body = await fetchJson(
        "/api/anomalies/scan",
        "scan anomalies failed",
        { method: "POST" },
      );
      return body.result ?? {};
    };

    return {
      refreshProjects,
      refreshStreamers,
      refreshApplications,
      refreshAdmissionProjectBoards,
      refreshOpsTasks,
      refreshReports,
      readVendorDeliveryPackage,
      exportAdmissionRecordings,
      createAdmissionShareBoard,
      scanAnomalies,
      createProjectDraft: async (input) => {
        const body = await fetchJson("/api/projects", "create project failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        await refreshProjects();
        return body;
      },
      publishProject: async (id) => {
        const body = await fetchJson(
          `/api/projects/${id}/publish`,
          "publish project failed",
          { method: "POST" },
        );
        await refreshProjects();
        return body;
      },
      updateProjectBasics: async (id, input) => {
        const body = await fetchJson(
          `/api/projects/${id}`,
          "update project failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshProjects();
        return body;
      },
      createStreamerProfile: async (input) => {
        const body = await fetchJson(
          "/api/streamers",
          "create streamer failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshStreamers();
        return body;
      },
      updateStreamerProfile: async (id, input) => {
        const body = await fetchJson(
          `/api/streamers/${id}`,
          "update streamer profile failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await Promise.all([
          refreshStreamers(),
          refreshProjects(),
          refreshApplications(),
          refreshOpsTasks(),
          refreshReports(),
          refreshSettlementPool(),
        ]);
        return body;
      },
      updateStreamerRisk: async (id, input) => {
        const body = await fetchJson(
          `/api/streamers/${id}/risk`,
          "update streamer risk failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshStreamers();
        return body;
      },
      inviteStreamerToProject: async (projectId, streamerId) => {
        const body = await fetchJson(
          `/api/projects/${projectId}/invitations`,
          "invite streamer failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streamerId }),
          },
        );
        await refreshApplications();
        return body;
      },
      reviewApplicationRecording: async (id, input) => {
        const body = await fetchJson(
          `/api/applications/${id}/review`,
          "review application recording failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshApplications();
        return body;
      },
      confirmApplicationJoin: async (id) => {
        const body = await fetchJson(
          `/api/applications/${id}/confirm-join`,
          "confirm application join failed",
          { method: "POST" },
        );
        await refreshApplications();
        await Promise.all([
          refreshStreamers().catch((error) =>
            warnBackgroundRefreshFailure("confirm application join", error),
          ),
          refreshProjects().catch((error) =>
            warnBackgroundRefreshFailure("confirm application join", error),
          ),
        ]);
        return body;
      },
      createLiveTask: async (input) => {
        const body = await fetchJson(
          "/api/live-tasks",
          "create live task failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        const createdTask = toOpsReferenceTaskFromMutation(body.task, input);
        if (createdTask) {
          setTasksState((current) =>
            upsertReferenceTasks(current, [createdTask]),
          );
        }
        return body;
      },
      createLiveTasks: async (input) => {
        const body = await fetchJson(
          "/api/live-tasks/batch",
          "create live tasks failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        const createdTasks = Array.isArray(body.tasks)
          ? body.tasks.map((task, index) =>
              toOpsReferenceTaskFromMutation(task, input?.tasks?.[index] ?? {}),
            )
          : [];
        if (createdTasks.length > 0) {
          setTasksState((current) =>
            upsertReferenceTasks(current, createdTasks),
          );
        }
        return body;
      },
      cancelLiveTask: async (id, input) => {
        const body = await fetchJson(
          `/api/live-tasks/${id}/cancel`,
          "cancel live task failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input ?? {}),
          },
        );
        await refreshOpsTasks();
        return body;
      },
      reviewReport: async (id, decision) => {
        const approved = decision === "approve";
        const body = await fetchJson(
          `/api/live-reports/${id}/review`,
          "review report failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              decision,
              includeInTaskResult: approved,
              enterSettlementPool: approved,
              reviewNotes: "经营端页面审核",
            }),
          },
        );
        const nextStatus = approved
          ? "approved"
          : decision === "need_more"
            ? "need_supply"
            : "rejected";
        const applyReviewedStatus = () => {
          setReportsState((current) =>
            Array.isArray(current)
              ? current.map((report) =>
                  report.id === id
                    ? {
                        ...report,
                        status:
                          body.report?.status === "need_more"
                            ? "need_supply"
                            : body.report?.status || nextStatus,
                      }
                    : report,
                )
              : current,
          );
        };
        applyReviewedStatus();
        await Promise.all([
          refreshProjects(),
          refreshReports(),
          refreshOpsTasks(),
          refreshSettlementPool(),
        ]);
        applyReviewedStatus();
      },
      createSettlementBatch: async (input) => {
        const body = await fetchJson(
          "/api/settlement-batches",
          "create settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatches();
        if (body.batch?.id) {
          await refreshSettlementBatchDetail(body.batch.id);
        }
        await refreshSettlementPool({
          projectId: input.projectId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          batchType: input.batchType,
        });
        await refreshProjects();
        return body;
      },
      addManualSettlementItem: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/manual-items`,
          "add manual settlement item failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      lockSettlementBatch: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/lock`,
          "lock settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      reopenSettlementBatch: async (batchId, input) => {
        await fetchJson(
          `/api/settlement-batches/${batchId}/reopen`,
          "reopen settlement batch failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshSettlementBatchDetail(batchId);
        await refreshSettlementBatches();
      },
      refreshAuditEntries,
      refreshOcrJobs,
      runNextOcrJob,
      retryOcrJob,
      markOcrJobNeedsReview,
      confirmOcrJob,
      refreshNotifications,
      refreshOrganizationMembers,
      createOrganizationMember: async (input) => {
        const body = await fetchJson(
          "/api/organization/members",
          "create organization member failed",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (body.member && input.mode !== "subaccount") {
          setOrganizationMembersState((current) => [
            body.member,
            ...(Array.isArray(current)
              ? current.filter((item) => item.id !== body.member.id)
              : []),
          ]);
        }
        if (body.permissions && typeof body.permissions === "object") {
          setOrganizationMemberPermissionsState(body.permissions);
        }
        if (body.organization && typeof body.organization === "object") {
          setOrganizationSettingsState((current) =>
            normalizeOrganizationSettings({
              ...normalizeOrganizationSettings(current),
              id: body.organization.id,
              name: body.organization.name,
            }),
          );
        }
        return body;
      },
      updateOrganizationMemberRole: async (memberId, input) => {
        const body = await fetchJson(
          `/api/organization/members/${memberId}`,
          "update organization member role failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshOrganizationMembers();
        return body.member;
      },
      updateOrganizationMemberStatus: async (memberId, input) => {
        const body = await fetchJson(
          `/api/organization/members/${memberId}`,
          "update organization member status failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        await refreshOrganizationMembers();
        return body.member;
      },
      refreshBillingStatus,
      updateNotificationStatus: async (id, action) => {
        await fetchJson(
          `/api/notifications/${id}`,
          "update notification failed",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        await refreshNotifications();
      },
      createGovernedExport: async (input) => {
        const body = await fetchJson("/api/exports", "create export failed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        return body.export;
      },
    };
  }, [settlementScope]);

  React.useEffect(() => {
    if (!["project", "tasks", "reports"].includes(route)) {
      return undefined;
    }

    const refreshLiveQueue = () => {
      const request =
        route === "reports"
          ? actions.refreshReports()
          : actions.refreshOpsTasks();
      request?.catch?.((error) =>
        warnBackgroundRefreshFailure(`${route} live queue`, error),
      );
    };

    const shouldRefreshImmediately =
      (route === "tasks" && tasksState == null) ||
      (route === "reports" && reportsState == null);
    if (shouldRefreshImmediately) {
      refreshLiveQueue();
    }
    const intervalId = globalThis.setInterval?.(refreshLiveQueue, 15000);
    const refreshWhenVisible = () => {
      if (globalThis.document?.visibilityState !== "hidden") {
        refreshLiveQueue();
      }
    };

    globalThis.addEventListener?.("focus", refreshLiveQueue);
    globalThis.document?.addEventListener?.(
      "visibilitychange",
      refreshWhenVisible,
    );

    return () => {
      if (intervalId) {
        globalThis.clearInterval?.(intervalId);
      }
      globalThis.removeEventListener?.("focus", refreshLiveQueue);
      globalThis.document?.removeEventListener?.(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, [actions, reportsState, route, tasksState]);

  const go = (r, arg) => {
    if (r === "project") {
      setRoute("project");
      setProjectId(arg || null);
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
      case "admission":
        return ["项目", "选播准入"];
      case "tasks":
        return ["执行", "排班与任务"];
      case "reports":
        return ["执行", "报数审核"];
      case "settle":
        return ["财务", "结算中心"];
      case "billing":
        return ["财务", "商业化与套餐"];
      case "export":
        return ["运营", "数据导出"];
      case "audit":
        return ["治理", "操作日志"];
      case "notifications":
        return ["治理", "通知待办"];
      case "org":
        return ["设置", "组织与权限"];
      default:
        return ["工作台"];
    }
  })();

  const navKey = route === "project" ? "projects" : route;
  const navCounts = {
    tasks: countActionableTasks(Array.isArray(tasksState) ? tasksState : TASKS),
    reports: countActionableReports(
      Array.isArray(reportsState) ? reportsState : REPORTS,
    ),
  };
  const unreadNotificationCount = countUnreadNotifications(
    Array.isArray(notificationItemsState) ? notificationItemsState : [],
  );

  const saveOrganizationSettings = (input) => {
    setOrganizationSettingsState((current) =>
      normalizeOrganizationSettings({
        ...normalizeOrganizationSettings(current),
        ...input,
        features: {
          ...normalizeOrganizationSettings(current).features,
          ...(input?.features ?? {}),
        },
      }),
    );
    setOrganizationSettingsOpen(false);
  };

  return (
    <OpsLiveDataContext.Provider
      value={{
        projects: projectsState,
        streamers: streamersState,
        applications: applicationsState,
        tasks: tasksState,
        reports: reportsState,
        batches: batchesState,
        batchDetails: batchDetailsState,
        settlementPool: settlementPoolState,
        settlementScope,
        auditEntries: auditEntriesState,
        ocrJobs: ocrJobsState,
        notificationItems: notificationItemsState,
        organizationMembers: organizationMembersState,
        organizationMemberPermissions: organizationMemberPermissionsState,
        organizationSettings: organizationSettingsState,
        billingStatus: billingStatusState,
        currentUser: normalizeCurrentUser(currentUser),
        actions,
      }}
    >
      <div
        style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}
      >
        <Sidebar
          route={navKey}
          onNav={go}
          navCounts={navCounts}
          currentUser={currentUser}
          organizationSettings={organizationSettingsState}
          organizationMembers={organizationMembersState}
          onOpenOrganizationSettings={() => setOrganizationSettingsOpen(true)}
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
            breadcrumbs={crumbs}
            notificationCount={unreadNotificationCount}
          />
          <div id="content-scroll" style={{ flex: 1, overflowY: "auto" }}>
            {route === "warroom" && <ScreenWarRoom go={go} />}
            {(route === "projects" || route === "project") && (
              <ScreenProjects go={go} projectId={projectId} />
            )}
            {route === "streamers" && (
              <ScreenStreamers go={go} initialActiveId={streamerId} />
            )}
            {route === "admission" && <ScreenAdmission go={go} />}
            {route === "tasks" && <ScreenTasks go={go} />}
            {route === "reports" && <ScreenReports go={go} />}
            {route === "settle" && <ScreenSettlement go={go} />}
            {route === "billing" && (
              <ScreenBilling
                billingStatus={billingStatusState}
                onRefresh={actions.refreshBillingStatus}
              />
            )}
            {route === "audit" && <ScreenAudit go={go} />}
            {route === "notifications" && <ScreenNotifications go={go} />}
            {route === "org" && (
              <ScreenOrg
                go={go}
                onOpenOrganizationSettings={() =>
                  setOrganizationSettingsOpen(true)
                }
              />
            )}
            {route === "export" && <ScreenExport go={go} />}
          </div>
        </main>
        {organizationSettingsOpen ? (
          <OrganizationSettingsDrawer
            settings={organizationSettingsState}
            onClose={() => setOrganizationSettingsOpen(false)}
            onSubmit={saveOrganizationSettings}
          />
        ) : null}
      </div>
    </OpsLiveDataContext.Provider>
  );
}

function PlaceholderScreen({ route, go }) {
  const [placeholderMessage, setPlaceholderMessage] = React.useState("");
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
              <Button
                kind="primary"
                onClick={() =>
                  setPlaceholderMessage("产品设计详情页暂未接入。")
                }
              >
                查看产品设计 →
              </Button>
            </div>
            {placeholderMessage ? (
              <div
                aria-live="polite"
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: "var(--ink-500)",
                }}
              >
                {placeholderMessage}
              </div>
            ) : null}
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
 * @param {{ initialRoute?: string; projectCards?: any[]; streamerCards?: any[]; applicationQueue?: any[]; liveTasks?: any[]; liveReports?: any[]; liveBatches?: any[]; liveBatchDetails?: Record<string, any[]>; liveSettlementPool?: any[]; settlementScope?: any; auditEntries?: any[]; notificationItems?: any[]; organizationMembers?: any[]; organizationMemberPermissions?: any; organizationSettings?: any; billingStatus?: any; currentUser?: any }} props
 */
export default function OpsReferenceApp({
  initialRoute = "warroom",
  liveTasks,
  liveReports,
  liveBatches,
  liveBatchDetails,
  liveSettlementPool,
  settlementScope,
  auditEntries,
  notificationItems,
  organizationMembers,
  organizationMemberPermissions,
  organizationSettings,
  billingStatus,
  projectCards,
  streamerCards,
  applicationQueue,
  currentUser,
}) {
  return (
    <OpsReferenceInner
      initialRoute={initialRoute}
      liveTasks={liveTasks}
      liveReports={liveReports}
      liveBatches={liveBatches}
      liveBatchDetails={liveBatchDetails}
      liveSettlementPool={liveSettlementPool}
      settlementScope={settlementScope}
      auditEntries={auditEntries}
      notificationItems={notificationItems}
      organizationMembers={organizationMembers}
      organizationMemberPermissions={organizationMemberPermissions}
      organizationSettings={organizationSettings}
      billingStatus={billingStatus}
      projectCards={projectCards}
      streamerCards={streamerCards}
      applicationQueue={applicationQueue}
      currentUser={currentUser}
    />
  );
}
