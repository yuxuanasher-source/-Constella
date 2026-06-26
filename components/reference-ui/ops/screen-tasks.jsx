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
  ANOMALY_TYPES,
  PROJECTS,
  SCHEDULE_WEEK,
  STREAMERS,
  TASK_STATUS,
  formatDateKey,
  useOpsLiveActions,
  useOpsProjects,
  useOpsStreamers,
  useOpsTasks,
} from "./data";
import { Icon } from "./icons";
import { EmptyHint } from "./screen-project";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  KV,
  Metric,
  SectionTitle,
  Tabs,
} from "./ui";

// ——— Screen: 排班与任务 ————————————————————————

function ScreenTasks({ go }) {
  const tasks = useOpsTasks();
  const projects = useOpsProjects();
  const streamers = useOpsStreamers();
  const actions = useOpsLiveActions();
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
  const anomalyCount = tasks.filter(
    (t) => t.status === "abnormal" || t.anomaly,
  ).length;
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
    setBatchDraft((draft) => ({
      ...draft,
      projectId: draft.projectId || projects[0]?.id || "",
      streamerIds:
        draft.streamerIds || streamers.map((streamer) => streamer.id).join(","),
    }));
  }, [projects, streamers]);

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
      globalThis.alert?.(
        error instanceof Error ? error.message : "任务操作失败",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const openNewTask = () => {
    const defaultProject =
      project === "all"
        ? projects[0]
        : projects.find((item) => item.id === project);
    const defaultStreamer =
      streamerFilter === "all"
        ? streamers[0]
        : streamers.find((item) => item.id === streamerFilter);
    if (!defaultProject || !defaultStreamer) {
      globalThis.alert?.("请先创建项目和主播档案。");
      return;
    }

    setSelectedTask({
      _new: true,
      dayIdx: SCHEDULE_WEEK.todayIdx,
      projectId: defaultProject.id,
      streamerId: defaultStreamer.id,
    });
  };

  const createTask = async (input) => {
    await runTaskAction("create", async () => {
      await actions.createLiveTask?.(input);
      const taskProject = projects.find((item) => item.id === input.projectId);
      setTaskMessage(
        `已创建任务并绑定项目：${taskProject?.name || input.projectId}`,
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
      const batchTasks = batchDraft.streamerIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((streamerId) => {
          const streamer = streamerById(streamerId, streamers);
          if (!streamer) return null;
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
        setTaskMessage("请至少选择一个有效主播");
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
  const anomalyCount = tasks.filter(
    (task) => task.anomaly || task.status === "abnormal",
  ).length;
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
        {project.code || project.id}
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
  const statusKey = task.anomaly ? "abnormal" : task.status;
  const matchesStatus =
    filters.status === "all" || statusKey === filters.status;
  return matchesProject && matchesStreamer && matchesStatus;
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
    return { id, alias: task?.streamerName || id };
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
          {projectName} · {task.name.replace(/^.+·\s*/, "")}
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

function streamerById(streamerId, streamers = STREAMERS) {
  return (
    streamers.find((item) => item.id === streamerId) || streamers[0] || null
  );
}

function opsLiveTaskInput({
  projectId = "",
  streamerId = "",
  dayIdx = SCHEDULE_WEEK.todayIdx,
  startHour = 20,
  endHour = 23.5,
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
              {r.id}
            </span>
          ),
        },
        {
          title: "任务名 / 项目",
          render: (r) => {
            const project = resolveTaskProject(r, projects);
            const projectName = project?.name || r.projectName || r.project;
            const projectCode = project?.code || r.projectId || r.project;
            return (
              <div>
                <div style={{ fontWeight: 500, color: "var(--ink-900)" }}>
                  {r.name}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-400)" }}
                >
                  {projectName} · {projectCode} ·{" "}
                  {r.type === "project"
                    ? "项目任务"
                    : r.type === "trial"
                      ? "试播任务"
                      : r.type === "training"
                        ? "训练任务"
                        : "临时任务"}
                </div>
              </div>
            );
          },
        },
        {
          title: "主播",
          render: (r) => {
            const s = resolveTaskStreamer(r, streamers);
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
  const [actionMessage, setActionMessage] = React.useState("");
  const anomalies = tasks
    .filter((t) => t.anomaly)
    .map((t) => {
      const project = resolveTaskProject(t, projects);
      const streamer = resolveTaskStreamer(t, streamers);
      return {
        ...t,
        projectDisplay: project?.name || t.projectName || t.project,
        streamer: streamer?.alias || t.streamerName,
        typeKey: t.anomaly,
      };
    });

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
        <Button
          size="sm"
          kind="default"
          onClick={() => setActionMessage("异常扫描历史后台暂未接入。")}
        >
          扫描历史
        </Button>
        <Button
          size="sm"
          kind="primary"
          onClick={() => setActionMessage("异常批量分派后台暂未接入。")}
        >
          批量分派处理
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
                      {a.id} · {a.projectDisplay}
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
                        setActionMessage(`已定位异常任务：${a.id}`)
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
        onClose={onClose}
        onCreateTask={onCreateTask}
      />
    );
  }

  const s = resolveTaskStreamer(task, streamers);
  const p = resolveTaskProject(task, projects);
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
          <KV label="项目编号">
            <span className="mono">{p?.code || task.projectId || "—"}</span>
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
                time: statusKey === "pending_live" ? "待开播" : "已开播",
                who: streamerName,
                action: "点击开始直播",
                done: statusKey !== "pending_live",
              },
              {
                time: statusKey === "live" ? "进行中…" : "已结束",
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
                who: "运营审核",
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
  const [note, setNote] = React.useState("");
  const s = streamers.find((x) => x.id === selectedStreamerId);
  const p = projects.find((x) => x.id === selectedProjectId) || projects[0];
  const projectName = p?.name || task.projectName || task.project || "";
  const [busy, setBusy] = React.useState(false);
  const [draftMessage, setDraftMessage] = React.useState("");
  const handleCreate = async () => {
    if (!onCreateTask || !p || !s) {
      setDraftMessage("请先选择项目和主播。");
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
          note: note.trim() || "经营端页面创建任务",
          projects,
          streamers,
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
          >
            {streamers.map((streamer) => (
              <option key={streamer.id} value={streamer.id}>
                {streamer.alias}
              </option>
            ))}
          </select>
        </TaskFormLabel>
        <FormField label="任务类型">
          <SegmentedControl
            options={["项目任务", "试播任务", "训练任务", "临时任务"]}
            value="项目任务"
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
            项目映射：{projectName || "未选择项目"} · {p?.code || p?.id || "—"}
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

export { ScreenTasks, TaskFormLabel, taskInputStyle };
