"use client";
import React from "react";

import { Icon } from "./icons";
import { Avatar, SearchInput } from "./ui";
import { CURRENT_USER, ROLES } from "./data";

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

function Sidebar({ route, onNav, navCounts = {} }) {
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
            未配置组织
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

export {
  Sidebar,
  TopBar,
  PageHeader,
  countActionableTasks,
  countActionableReports,
  countUnreadNotifications,
};
