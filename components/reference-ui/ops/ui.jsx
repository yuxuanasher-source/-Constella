"use client";
/* eslint-disable */
import React from "react";
import {
  Avatar as HeroAvatar,
  Button as HeroButton,
  Card as HeroCard,
  Chip as HeroChip,
  InputGroup as HeroInputGroup,
  TabList as HeroTabList,
  Tabs as HeroTabs,
} from "@heroui/react";

import { Icon } from "./icons";

// ——— Reusable UI atoms ——————————————————————————————————————

// Status badge — color via tone prop
// Maps the legacy `tone` palette onto HeroUI Chip colors.
const CHIP_COLOR_BY_TONE = {
  neutral: "default",
  ink: "default",
  blue: "accent",
  violet: "accent",
  teal: "accent",
  green: "success",
  amber: "warning",
  red: "danger",
};

function Badge({
  tone = "neutral",
  children,
  dot = false,
  soft = true,
  style,
}) {
  return (
    <HeroChip
      color={CHIP_COLOR_BY_TONE[tone] || "default"}
      variant={soft ? "soft" : "tertiary"}
      size="sm"
      style={style}
    >
      {children}
    </HeroChip>
  );
}

// Status pill for table status columns — HeroUI soft chip.
function StatusPill({ tone = "neutral", children }) {
  return (
    <HeroChip
      color={CHIP_COLOR_BY_TONE[tone] || "default"}
      variant="soft"
      size="sm"
    >
      {children}
    </HeroChip>
  );
}

// HeroUI-backed button. Keeps the original `kind` API by mapping it onto
// HeroUI `variant`s. `onClick` is passed through (react-aria Button forwards
// the native click, so existing `e.stopPropagation()` handlers keep working).
const BUTTON_VARIANT_BY_KIND = {
  primary: "primary",
  default: "outline",
  ghost: "ghost",
  danger: "danger-soft",
  link: "tertiary",
};

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
  return (
    <HeroButton
      type={type}
      variant={BUTTON_VARIANT_BY_KIND[kind] || "outline"}
      size={size}
      isDisabled={disabled}
      onClick={onClick}
      style={style}
    >
      {icon}
      {children}
    </HeroButton>
  );
}

// Card — HeroUI surface container (keeps the title/extra/padded API).
function Card({ children, title, extra, padded = true, style, bodyStyle }) {
  return (
    <HeroCard
      style={{
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
    </HeroCard>
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

// Avatar — HeroUI avatar with initials fallback. Exact pixel sizing is kept
// via inline style so dense table/detail layouts stay aligned.
function Avatar({ name, size = 28, tone }) {
  const initials = (name || "?").slice(0, 1);
  return (
    <HeroAvatar
      size="sm"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      <HeroAvatar.Fallback>{initials}</HeroAvatar.Fallback>
    </HeroAvatar>
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

// Search input — HeroUI input group with a leading search icon.
function SearchInput({ placeholder = "搜索…", value, onChange, width = 280 }) {
  return (
    <HeroInputGroup style={{ width }}>
      <HeroInputGroup.Prefix>
        <Icon.Search size={14} stroke="var(--ink-400)" />
      </HeroInputGroup.Prefix>
      <HeroInputGroup.Input
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
      />
    </HeroInputGroup>
  );
}

// Tab control — HeroUI tabs (tab bar only; screens render their own panels).
function Tabs({ items, value, onChange, size = "md" }) {
  return (
    <HeroTabs selectedKey={value} onSelectionChange={(key) => onChange?.(key)}>
      <HeroTabList>
        {items.map((it) => (
          <HeroTabs.Tab key={it.key} id={it.key}>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {it.label}
              {it.count != null && (
                <span
                  style={{
                    background: "var(--ink-50)",
                    color: "var(--ink-400)",
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
            </span>
          </HeroTabs.Tab>
        ))}
      </HeroTabList>
    </HeroTabs>
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

// Risk indicator — HeroUI soft chip colored by level.
function RiskDot({ level }) {
  const map = {
    low: ["success", "低"],
    medium: ["warning", "中"],
    high: ["danger", "高"],
    none: ["default", "无"],
  };
  const [color, label] = map[level] || map.none;
  return (
    <HeroChip color={color} variant="soft" size="sm">
      {label}
    </HeroChip>
  );
}

export {
  Badge,
  StatusPill,
  Button,
  Card,
  SectionTitle,
  KV,
  Avatar,
  DataTable,
  Metric,
  SearchInput,
  Tabs,
  MiniBar,
  RiskDot,
};
