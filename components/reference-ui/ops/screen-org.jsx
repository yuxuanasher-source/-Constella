"use client";
/* eslint-disable */
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PageHeader } from "./chrome";
import {
  ORG,
  useOpsAuditEntries,
  useOpsLiveActions,
  useOpsNotifications,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint } from "./screen-project";
import { formatOpsMinute } from "./screen-reports";
import { Overview } from "./screen-warroom";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  KV,
  Metric,
  SearchInput,
  SectionTitle,
  Tabs,
} from "./ui";

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

function ScreenOrg({ go }) {
  const [tab, setTab] = React.useState("overview");
  const [orgMessage, setOrgMessage] = React.useState("");
  const showOrgPending = (message) => {
    setOrgMessage(message);
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
            <Button
              kind="primary"
              icon={<Icon.Plus size={14} stroke="#fff" />}
              onClick={() => showOrgPending("邀请成员后台暂未接入。")}
            >
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
                  未配置组织
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
                <span className="mono">{ORG.id || "组织编号待配置"}</span> ·{" "}
                {ORG.name || "组织名称待配置"} · MCN 经营舱
              </div>
            </div>
            <Button
              kind="default"
              icon={<Icon.Settings size={14} />}
              onClick={() => showOrgPending("组织设置后台暂未接入。")}
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
            {tab === "members" && (
              <MemberList onPendingAction={showOrgPending} />
            )}
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

function MemberList({ onPendingAction }) {
  const [filter, setFilter] = React.useState("all");
  const rows =
    filter === "all" ? MEMBERS : MEMBERS.filter((m) => m.role === filter);
  const notify = (message) => onPendingAction?.(message);

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
        <Button
          kind="primary"
          icon={<Icon.Plus size={13} stroke="#fff" />}
          onClick={() => notify("邀请成员后台暂未接入。")}
        >
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
                  <Button
                    size="sm"
                    kind="default"
                    onClick={() => notify(`${m.name} 的角色编辑后台暂未接入。`)}
                  >
                    编辑角色
                  </Button>
                  <button
                    type="button"
                    onClick={() =>
                      notify(`${m.name} 的更多成员操作后台暂未接入。`)
                    }
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
                        {entry.id}
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
                        {entry.objectId || "—"}
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
          <span className="mono">{entry.id}</span>
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
          <span className="mono">{entry.objectId || "—"}</span>
        </KV>
        <KV label="项目">
          <span className="mono">{entry.projectId || "—"}</span>
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
                      {item.id} · {formatOpsMinute(item.createdAt)}
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
                      {item.objectId || "—"}
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
  const [kind, setKind] = React.useState("audit_logs");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

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
      const exportResult = await actions.createGovernedExport({
        kind,
        rows: sampleExportRows(kind),
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

function sampleExportRows(kind) {
  if (kind === "audit_logs") {
    return [{ module: "settlement", action: "lock" }];
  }
  if (kind === "vendor_delivery") {
    return [
      {
        projectName: "项目名称",
        streamerName: "主播名称",
        settlementDuration: 0,
        evidenceLevel: "system",
        grossMarginCents: 0,
      },
    ];
  }
  if (kind === "settlement_batch") {
    return [{ batchName: "6月应付批次", payableAmountCents: 120000 }];
  }
  return [
    {
      streamerName: "阿洛",
      settlementDuration: 120,
      evidenceLevel: "system",
    },
  ];
}

export {
  ScreenAudit,
  ScreenBilling,
  ScreenExport,
  ScreenNotifications,
  ScreenOrg,
};
