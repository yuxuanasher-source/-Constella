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
  PROJECTS,
  PROJECT_STATUS,
  useOpsApplications,
  useOpsLiveActions,
  useOpsProjects,
  useOpsStreamers,
  useOpsTasks,
} from "./data";
import { Icon } from "./icons";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  KV,
  Metric,
  MiniBar,
  RiskDot,
  SearchInput,
  Tabs,
} from "./ui";

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

// ——— Project detail ———————————————————————

function ProjectDetail({ id, go }) {
  const projects = useOpsProjects();
  const actions = useOpsLiveActions();
  const p = projects.find((x) => x.id === id) || projects[0] || PROJECTS[0];
  const [tab, setTab] = React.useState("overview");
  const [detailMessage, setDetailMessage] = React.useState("");
  const [detailSubmitting, setDetailSubmitting] = React.useState("");
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
  const donePct =
    Math.round((p.metrics.doneHours / p.metrics.plannedHours) * 100) || 0;
  const exportVendorDelivery = async () => {
    setDetailSubmitting("delivery");
    setDetailMessage("");
    try {
      await actions.createGovernedExport?.({
        kind: "vendor_delivery",
        rows: [
          {
            projectName: p.name,
            streamerName: `${p.streamers.active} 位已入选主播`,
            settlementDuration: p.metrics.doneHours,
            evidenceLevel: `待审录屏 ${p.streamers.pendingReview} 条`,
          },
        ],
      });
      setDetailMessage("厂家交付包已生成");
    } catch (error) {
      setDetailMessage(error?.message || "厂家交付包导出失败，请稍后重试");
    } finally {
      setDetailSubmitting("");
    }
  };

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
              onClick={() => setDetailMessage("项目设置后台暂未接入")}
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
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedStreamerId, setSelectedStreamerId] = React.useState("");
  const [inviteSubmitting, setInviteSubmitting] = React.useState(false);
  const [inviteError, setInviteError] = React.useState("");
  const [inviteMessage, setInviteMessage] = React.useState("");
  const [localInvites, setLocalInvites] = React.useState([]);
  const applicationRoster = applications
    .filter((application) => applicationBelongsToProject(application, p))
    .map((application) =>
      applicationToRosterRow(application, streamers, "application"),
    )
    .filter(Boolean);
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
      name: task.streamerName || task.streamerId || "未配置主播",
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

export { EmptyHint, ScreenProjects, splitDraftList };
