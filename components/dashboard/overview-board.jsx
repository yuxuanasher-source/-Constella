"use client";

/* eslint-disable */
// 经营总览看板 —— 主看板优先的三栏工作台（主看板 / 个人面板 / AI 助手）。
// 数据全部为真实业务数据：服务端 dashboard（kpis/panels/queue/risks，按角色计算）
// + 实时 projects/tasks/reports/batches + /api/marketplace/intel + /api/ai/*。
// 「不做假」原则：算不出的真实时序就不画走势线、不编造环比；缺数据的区块自动隐藏；
// AI 面板调用真实接口，返回真实诊断或真实错误，绝不伪造成功内容。

import * as React from "react";

// ——— 设计稿调色板（取自设计文件内联样式） ———
const C = {
  page: "#f4f6fb",
  card: "#ffffff",
  border: "#dfe6f2",
  divider: "#e7edf6",
  divider2: "#edf2f8",
  track: "#e8eef7",
  soft: "#f7f9fd",
  ink: "#0b1733",
  ink2: "#1b2744",
  ink3: "#2d3a58",
  ink4: "#5e6a82",
  muted: "#7b879c",
  faint: "#a8b1c2",
  primary: "#3b6be6",
  primaryDeep: "#1e50c8",
  primarySoft: "#eef3ff",
  ok: "#0e8a4d",
  okBg: "#e6f6ee",
  warn: "#a86a00",
  warnText: "#a86a00",
  danger: "#d43d45",
  dangerDeep: "#b9323b",
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
        ? "#d7a02a"
        : t === "ok" || t === "green"
          ? C.ok
          : "#c9cdd6";

const ROUTE_LABELS = {
  project: "项目",
  projects: "项目",
  streamers: "主播",
  tasks: "任务",
  reports: "报数",
  settle: "结算",
  audit: "审计",
  notifications: "通知",
  marketplace: "撮合",
};
const routeLabel = (r) => ROUTE_LABELS[r] || "查看";

const DASHBOARD_TIME_ZONE = "Asia/Shanghai";
const PERIOD_TABS = ["实时", "今日", "本周", "本月"];

const num = (n) => (Number(n) || 0).toLocaleString("en-US");
const money = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
  return `¥${v.toLocaleString("en-US")}`;
};
const moneyK = (n) => {
  const v = Number(n) || 0;
  return Math.abs(v) >= 1000
    ? `¥${(v / 1000).toFixed(1)}K`
    : `¥${v.toLocaleString("en-US")}`;
};

function normalizeVisualSeries(value) {
  if (!Array.isArray(value)) return null;
  const series = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return series.length >= 2 ? series : null;
}

const AI_PANEL_STORAGE_PREFIX = "jingying-cabin.dashboard.ai.messages.v1";

function aiPanelStorageKey(user) {
  const identity = user?.id || user?.name || user?.role || "anonymous";
  return `${AI_PANEL_STORAGE_PREFIX}.${identity}`;
}

function normalizeAiMessageMeta(value) {
  const projectHealth = normalizeProjectHealth(
    value?.projectHealth || value?.grounding?.projectHealth,
  );
  const suggestedActions = normalizeSuggestedActions(
    value?.suggestedActions || value?.grounding?.suggestedActions,
  );
  const meta = {
    ...(projectHealth ? { projectHealth } : {}),
    ...(suggestedActions ? { suggestedActions } : {}),
  };
  return Object.keys(meta).length ? meta : undefined;
}

function normalizeProjectHealth(value) {
  const rows = Array.isArray(value?.topProjects) ? value.topProjects : [];
  const topProjects = rows
    .map((item) => {
      const projectName =
        typeof item?.projectName === "string" ? item.projectName.trim() : "";
      if (!projectName) return null;
      const priority =
        item?.priority === "high" ||
        item?.priority === "medium" ||
        item?.priority === "low"
          ? item.priority
          : "medium";
      const reasons = Array.isArray(item?.reasons)
        ? item.reasons
            .map((reason) =>
              typeof reason === "string" ? reason.trim().slice(0, 180) : "",
            )
            .filter(Boolean)
            .slice(0, 3)
        : [];
      const evidence = Array.isArray(item?.evidence)
        ? item.evidence
            .map((entry) => ({
              sourceTool:
                typeof entry?.sourceTool === "string"
                  ? entry.sourceTool.slice(0, 80)
                  : "role_home_dashboard",
              sourceId:
                typeof entry?.sourceId === "string"
                  ? entry.sourceId.slice(0, 180)
                  : "",
            }))
            .filter((entry) => entry.sourceId)
            .slice(0, 3)
        : [];
      const score = Number(item?.score);
      return {
        projectId:
          typeof item?.projectId === "string"
            ? item.projectId.slice(0, 120)
            : undefined,
        projectName: projectName.slice(0, 120),
        priority,
        score: Number.isFinite(score) ? score : undefined,
        reasons,
        evidence,
        target: normalizeAiTarget(item?.target),
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return topProjects.length ? { topProjects } : null;
}

function normalizeSuggestedActions(value) {
  if (!Array.isArray(value)) return null;
  const actions = value
    .map((item) => {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      if (!title) return null;
      const priority =
        item?.priority === "high" ||
        item?.priority === "medium" ||
        item?.priority === "low"
          ? item.priority
          : "medium";
      const evidence = Array.isArray(item?.evidence)
        ? item.evidence
            .map((entry) => ({
              sourceTool:
                typeof entry?.sourceTool === "string"
                  ? entry.sourceTool.slice(0, 80)
                  : "role_home_dashboard",
              sourceId:
                typeof entry?.sourceId === "string"
                  ? entry.sourceId.slice(0, 180)
                  : "",
            }))
            .filter((entry) => entry.sourceId)
            .slice(0, 3)
        : [];
      return {
        actionId:
          typeof item?.actionId === "string"
            ? item.actionId.slice(0, 160)
            : title,
        projectId:
          typeof item?.projectId === "string"
            ? item.projectId.slice(0, 120)
            : undefined,
        projectName:
          typeof item?.projectName === "string"
            ? item.projectName.slice(0, 120)
            : "",
        priority,
        title: title.slice(0, 160),
        rationale:
          typeof item?.rationale === "string"
            ? item.rationale.slice(0, 240)
            : "",
        evidence,
        target: normalizeAiTarget(item?.target),
        requiresHumanApproval: item?.requiresHumanApproval !== false,
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return actions.length ? actions : null;
}

function normalizeAiTarget(value) {
  if (!value || typeof value !== "object") return undefined;
  const route = typeof value.route === "string" ? value.route : "";
  if (!route) return undefined;
  return {
    route,
    ...(typeof value.id === "string" ? { id: value.id.slice(0, 120) } : {}),
  };
}

function normalizeStoredAiMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const meta = normalizeAiMessageMeta(item?.meta);
      return {
        role: item?.role === "user" ? "user" : "ai",
        text: typeof item?.text === "string" ? item.text.slice(0, 8000) : "",
        ...(meta ? { meta } : {}),
      };
    })
    .filter((item) => item.text.trim())
    .slice(-20);
}

function loadStoredAiMessages(storageKey) {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    return normalizeStoredAiMessages(
      JSON.parse(window.localStorage.getItem(storageKey) || "[]"),
    );
  } catch {
    return [];
  }
}

function saveStoredAiMessages(storageKey, messages) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const normalized = normalizeStoredAiMessages(messages);
    if (normalized.length) {
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage quota or privacy-mode failures; chat still works in memory.
  }
}

function fmtKpi(value, unit) {
  if (unit === "元") {
    const v = Number(value) || 0;
    return {
      value: Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) : String(v),
      unit: Math.abs(v) >= 10000 ? "万" : "元",
    };
  }
  return { value: String(value), unit: unit || "" };
}

function normalizeDashboardActionGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group, groupIndex) => ({
      title: group?.title || `待办组 ${groupIndex + 1}`,
      items: (Array.isArray(group?.items) ? group.items : [])
        .map((item, itemIndex) => ({
          label: item?.label || `事项 ${itemIndex + 1}`,
          value: Number(item?.value) || 0,
          tone: item?.tone || "neutral",
          target: item?.target,
        }))
        .slice(0, 2),
    }))
    .filter((group) => group.items.length > 0)
    .slice(0, 4);
}

function normalizeDashboardPersonalPanel(panel) {
  if (!panel || typeof panel !== "object") return null;
  const summary = Array.isArray(panel.summary)
    ? panel.summary.slice(0, 4).map((item) => ({
        label: item?.label || "",
        value: String(Number(item?.value) || 0),
        color: tone(item?.tone).color,
        attention: !!item?.attention,
        series: normalizeVisualSeries(item?.series),
      }))
    : [];
  const recos = Array.isArray(panel.recommendations)
    ? panel.recommendations.slice(0, 3).map((item) => ({
        icon: item?.icon || "看",
        text: item?.text || "",
        sub: item?.sub || "",
        tone: item?.tone || "neutral",
        cta: item?.cta || "查看",
        route: item?.target?.route || item?.route,
      }))
    : [];
  const todos = Array.isArray(panel.todos)
    ? panel.todos.slice(0, 5).map((item, index) => ({
        key: item?.key || `todo-${index}`,
        text: item?.text || "",
        count:
          item?.count === null || item?.count === undefined
            ? null
            : Number(item.count) || 0,
        tone: item?.tone || "neutral",
        route: item?.target?.route || item?.route,
      }))
    : [];

  if (!summary.length && !recos.length && !todos.length) return null;
  return { summary, recos, todos };
}

const cnt = (arr, fn) => (arr || []).filter(fn).length;
const pStatus = (p, s) => p?.status === s;
const OPERATING_PROJECT_STATUSES = new Set([
  "recruiting",
  "pending_start",
  "active",
  "paused",
  "settling",
]);
const PENDING_REPORT_STATUSES = new Set([
  "pending_review",
  "pending_adjudication",
]);
const margin = (p) => Number(p?.metrics?.margin);
const isLive = (t) => t?.status === "live" || t?.statusLabel === "直播中";
const isNotStarted = (t) =>
  ["pending_live", "not_started", "scheduled"].includes(t?.status);
const isDone = (t) =>
  t?.status === "completed" || t?.status === "done" || t?.status === "已完成";
const isAnomaly = (t) => t?.anomaly || t?.status === "abnormal";
const isOperatingProject = (project) =>
  OPERATING_PROJECT_STATUSES.has(project?.status);
const isPendingReport = (report) => PENDING_REPORT_STATUSES.has(report?.status);

function projectMetricTotal(projects, key) {
  return (projects || []).reduce(
    (total, project) => total + (Number(project?.metrics?.[key]) || 0),
    0,
  );
}

function scopedPendingReportCount(projects, reports) {
  return Math.max(
    projectMetricTotal(projects, "reportedPending"),
    cnt(reports, isPendingReport),
  );
}

function scopedAnomalyCount(projects, tasks) {
  return Math.max(
    projectMetricTotal(projects, "anomalies"),
    cnt(tasks, isAnomaly),
  );
}

// 今日排班按小时累计（真实可计算的时序；无则返回 null，不画线）。
function scheduleSeries(tasks) {
  const byHour = Array(24).fill(0);
  let any = false;
  (tasks || []).forEach((t) => {
    const h = Number(t?.startHour);
    if (Number.isFinite(h)) {
      byHour[Math.max(0, Math.min(23, Math.round(h)))] += 1;
      any = true;
    }
  });
  if (!any) return null;
  const out = [];
  let acc = 0;
  for (let h = 6; h <= 23; h += 1) {
    acc += byHour[h];
    out.push(acc);
  }
  return out.length >= 2 ? out : null;
}

// 4 个 KPI 待办分组（设计稿主看板 4 张卡）。按登录角色给出两段对照值。
function computeTodoGroups(
  role,
  { projects = [], tasks = [], reports = [], batches = [] },
) {
  const bs = (s) => cnt(batches, (b) => b.status === s || b.statusKey === s);
  const pendReports = cnt(reports, (r) => r.status === "pending_review");
  const anomalies = cnt(tasks, isAnomaly);
  const notStarted = cnt(tasks, isNotStarted);
  const recordingPending = (projects || []).reduce(
    (s, p) => s + (p?.streamers?.pendingReview ?? 0),
    0,
  );
  const gapProjects = cnt(projects, (p) => (p?.streamers?.candidate ?? 0) > 0);
  const G = (title, items) => ({ title, items });
  const I = (label, value, t, route) => ({
    label,
    value: Number(value) || 0,
    tone: t,
    target: route ? { route } : undefined,
  });

  if (role.includes("operator")) {
    return [
      G("今日任务", [
        I(
          "待处理",
          cnt(tasks, (t) => !isDone(t)),
          "primary",
          "tasks",
        ),
        I("已完成", cnt(tasks, isDone), "ok", "tasks"),
      ]),
      G("直播待办", [
        I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"),
        I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("总报数", reports.length, "neutral", "reports"),
      ]),
      G("准入待办", [
        I(
          "录屏待审",
          recordingPending,
          recordingPending ? "warn" : "neutral",
          "projects",
        ),
        I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects"),
      ]),
    ];
  }
  if (role.includes("finance")) {
    return [
      G("批次待办", [
        I("待生成", bs("draft"), "neutral", "settle"),
        I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle"),
      ]),
      G("锁定待办", [
        I("已锁定", bs("locked"), "ok", "settle"),
        I("已导出", bs("exported"), "neutral", "settle"),
      ]),
      G("风险待办", [
        I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"),
        I("待审报数", pendReports, pendReports ? "warn" : "neutral", "reports"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("总报数", reports.length, "neutral", "reports"),
      ]),
    ];
  }
  if (role.includes("ops")) {
    return [
      G("项目待办", [
        I(
          "执行中",
          cnt(projects, (p) => pStatus(p, "active")),
          "primary",
          "projects",
        ),
        I(
          "招募中",
          cnt(projects, (p) => pStatus(p, "recruiting")),
          "neutral",
          "projects",
        ),
      ]),
      G("准入待办", [
        I(
          "录屏待审",
          recordingPending,
          recordingPending ? "warn" : "neutral",
          "projects",
        ),
        I("主播缺口", gapProjects, gapProjects ? "bad" : "neutral", "projects"),
      ]),
      G("直播待办", [
        I("今日排班", tasks.length, "ok", "tasks"),
        I("异常", anomalies, anomalies ? "bad" : "neutral", "tasks"),
      ]),
      G("报数待办", [
        I("待审核", pendReports, pendReports ? "warn" : "neutral", "reports"),
        I("未开播", notStarted, notStarted ? "bad" : "neutral", "tasks"),
      ]),
    ];
  }
  return [
    G("项目待办", [
      I(
        "进行中",
        cnt(projects, (p) => pStatus(p, "active")),
        "primary",
        "projects",
      ),
      I(
        "招募中",
        cnt(projects, (p) => pStatus(p, "recruiting")),
        "neutral",
        "projects",
      ),
    ]),
    G("复盘待办", [
      I(
        "低毛利",
        cnt(projects, (p) => margin(p) >= 0 && margin(p) < 20),
        "warn",
        "projects",
      ),
      I(
        "负毛利",
        cnt(projects, (p) => margin(p) < 0),
        "bad",
        "projects",
      ),
    ]),
    G("结算待办", [
      I("待生成", bs("draft"), "neutral", "settle"),
      I("待确认", bs("pending_confirm") + bs("generated"), "warn", "settle"),
    ]),
    G("审计待办", [
      I(
        "高风险",
        cnt(projects, (p) => p.risk === "high"),
        "bad",
        "audit",
      ),
      I("重开", bs("reopened"), bs("reopened") ? "bad" : "neutral", "settle"),
    ]),
  ];
}

function localDateParts(value) {
  const text = String(value || "");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    const [year = "0", month = "0", day = "0"] = text.slice(0, 10).split("-");
    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromParts(parts) {
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localDateKey(value) {
  if (!value) return null;
  return dateKeyFromParts(localDateParts(value));
}

function dateKeyToUtcDate(dateKey) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToDateKey(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  if (!date) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

function dashboardPeriodRange(period, generatedAt) {
  if (period === "实时") return null;

  const baseKey = localDateKey(generatedAt || new Date().toISOString());
  if (!baseKey) return null;

  if (period === "今日") {
    return { start: baseKey, end: baseKey };
  }

  const baseDate = dateKeyToUtcDate(baseKey);
  if (!baseDate) return { start: baseKey, end: baseKey };

  if (period === "本周") {
    const day = baseDate.getUTCDay() || 7;
    const start = addDaysToDateKey(baseKey, 1 - day);
    return { start, end: addDaysToDateKey(start, 6) };
  }

  const parts = localDateParts(baseKey);
  const start = `${parts.year}-${pad2(parts.month)}-01`;
  const end = `${parts.year}-${pad2(parts.month)}-${pad2(
    new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate(),
  )}`;
  return { start, end };
}

function dateInRange(value, range) {
  if (!range) return true;
  const key = localDateKey(value);
  return !!key && key >= range.start && key <= range.end;
}

function dateSpanOverlapsRange(startValue, endValue, range) {
  if (!range) return true;
  const start = localDateKey(startValue);
  const end = localDateKey(endValue) || start;
  if (!start && !end) return false;
  const from = start || end;
  const to = end || start;
  return from <= range.end && to >= range.start;
}

function projectInPeriod(project, range) {
  if (!range) return true;
  return dateSpanOverlapsRange(
    project?.start ||
      project?.startDate ||
      project?.startsAt ||
      project?.createdAt ||
      project?.updatedAt,
    project?.end ||
      project?.endDate ||
      project?.endsAt ||
      project?.updatedAt ||
      project?.start,
    range,
  );
}

function taskInPeriod(task, range) {
  if (!range) return true;
  return dateSpanOverlapsRange(
    task?.plannedStartAt || task?.startAt || task?.createdAt || task?.updatedAt,
    task?.plannedEndAt || task?.endAt || task?.updatedAt,
    range,
  );
}

function reportInPeriod(report, range) {
  if (!range) return true;
  return dateInRange(
    report?.submittedAt || report?.createdAt || report?.updatedAt,
    range,
  );
}

function batchInPeriod(batch, range) {
  if (!range) return true;
  return (
    dateSpanOverlapsRange(batch?.periodStart, batch?.periodEnd, range) ||
    dateInRange(batch?.updatedAt || batch?.createdAt, range)
  );
}

function scopeDashboardDataByPeriod(
  period,
  generatedAt,
  { projects = [], tasks = [], reports = [], batches = [] },
) {
  const range = dashboardPeriodRange(period, generatedAt);
  if (!range) return { projects, tasks, reports, batches };

  return {
    projects: projects.filter((project) => projectInPeriod(project, range)),
    tasks: tasks.filter((task) => taskInPeriod(task, range)),
    reports: reports.filter((report) => reportInPeriod(report, range)),
    batches: batches.filter((batch) => batchInPeriod(batch, range)),
  };
}

function sumMetric(projects, key) {
  return projectMetricTotal(projects, key);
}

function scopedRiskCount({ projects = [], tasks = [], batches = [] }) {
  return (
    cnt(projects, (project) => project?.risk === "high") +
    cnt(tasks, isAnomaly) +
    cnt(batches, (batch) => batch?.status === "reopened")
  );
}

function scopedKpiValue(key, data) {
  const projects = data.projects || [];
  const tasks = data.tasks || [];
  const reports = data.reports || [];
  const batches = data.batches || [];
  const receivable = sumMetric(projects, "receivable");
  const gross = sumMetric(projects, "gross");
  const plannedHours = sumMetric(projects, "plannedHours");
  const doneHours = sumMetric(projects, "doneHours");
  const recordingPending = projects.reduce(
    (total, project) => total + (project?.streamers?.pendingReview ?? 0),
    0,
  );
  const streamerGapProjects = cnt(
    projects,
    (project) => (project?.streamers?.candidate ?? 0) > 0,
  );
  const pendingReports = scopedPendingReportCount(projects, reports);

  switch (key) {
    case "vendorReceivable":
      return receivable;
    case "estimatedGross":
      return gross;
    case "grossMarginRate":
      return receivable > 0 ? Math.round((gross / receivable) * 1000) / 10 : 0;
    case "highRiskItems":
      return scopedRiskCount(data);
    case "activeProjects":
      return cnt(projects, isOperatingProject);
    case "deliveryProgress":
      return plannedHours > 0
        ? Math.round((doneHours / plannedHours) * 1000) / 10
        : 0;
    case "streamerGapProjects":
      return streamerGapProjects;
    case "recordingsPending":
      return recordingPending;
    case "pendingReports":
      return pendingReports;
    case "anomalyTasks":
    case "streamerReminders":
      return scopedAnomalyCount(projects, tasks);
    case "myTodayTasks":
      return tasks.length;
    case "notStartedTasks":
      return cnt(tasks, isNotStarted);
    case "draftBatches":
      return cnt(batches, (batch) => batch?.status === "draft");
    case "reopenedBatches":
      return cnt(batches, (batch) => batch?.status === "reopened");
    default:
      return undefined;
  }
}

function buildScopedLiveKpis(baseKpis, role, data) {
  const defaults = role.includes("finance")
    ? [
        { key: "draftBatches", label: "待生成批次", unit: "个" },
        { key: "pendingReports", label: "待审核报数", unit: "条" },
        { key: "reopenedBatches", label: "重开批次", unit: "个", tone: "red" },
        { key: "highRiskItems", label: "高风险事项", unit: "项", tone: "red" },
      ]
    : role.includes("operator")
      ? [
          { key: "myTodayTasks", label: "我的任务", unit: "项" },
          {
            key: "notStartedTasks",
            label: "未开播",
            unit: "项",
            tone: "amber",
          },
          { key: "pendingReports", label: "待审核报数", unit: "条" },
          {
            key: "streamerReminders",
            label: "需联系主播",
            unit: "人",
            tone: "red",
          },
        ]
      : role.includes("ops")
        ? [
            { key: "activeProjects", label: "招募/执行项目", unit: "个" },
            { key: "deliveryProgress", label: "履约进度", unit: "%" },
            {
              key: "streamerGapProjects",
              label: "主播缺口项目",
              unit: "个",
              tone: "amber",
            },
            {
              key: "recordingsPending",
              label: "录屏待审",
              unit: "条",
              tone: "amber",
            },
          ]
        : [
            { key: "vendorReceivable", label: "本月厂家应收", unit: "元" },
            { key: "estimatedGross", label: "预计毛利", unit: "元" },
            { key: "grossMarginRate", label: "预计毛利率", unit: "%" },
            {
              key: "highRiskItems",
              label: "高风险事项",
              unit: "项",
              tone: "red",
            },
          ];

  const source = (baseKpis?.length ? baseKpis : defaults).slice(0, 4);
  return source.map((item, index) => {
    const fallback = defaults[index] || item;
    const key = item.key || fallback.key;
    const scopedValue = scopedKpiValue(key, data);
    return {
      ...fallback,
      ...item,
      key,
      label: item.label || fallback.label,
      unit: item.unit || fallback.unit,
      value: scopedValue === undefined ? item.value : scopedValue,
    };
  });
}

function admissionDecision(stage, index, total) {
  if (index === 0) {
    return {
      title: "报名入口",
      detail: "候选量是否充足，来源质量是否稳定？",
    };
  }
  if (index === total - 1) {
    return {
      title: "入项确认",
      detail: "可排班人选是否稳定，是否满足项目节奏？",
    };
  }
  if (String(stage?.key || "").includes("review")) {
    return {
      title: "录屏审核",
      detail: "录屏证据是否达标，卡点集中在哪？",
    };
  }
  return {
    title: "筛选推进",
    detail: "这一层的流失是否异常，是否需要运营介入？",
  };
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
  const mn = Math.min(...arr),
    mx = Math.max(...arr),
    rng = mx - mn || 1;
  const xPad = Math.max(3, pad * 2);
  const drawableW = Math.max(1, w - xPad * 2);
  const pts = arr.map((v, i) => {
    const x = xPad + (i / (arr.length - 1)) * drawableW;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const first = pts[0].split(",");
  return {
    line: pts.join(" "),
    area: `${first[0]},${h} ${pts.join(" ")} ${last[0]},${h}`,
    lastX: last[0],
    lastY: last[1],
  };
}
function AreaSpark({ series, color, w = 320, h = 54, gid, testId }) {
  const s = spp(series, w, h);
  if (!s) return null;
  const id = gid || `sk${color.replace(/[^a-z0-9]/gi, "")}${series.length}`;
  return (
    <svg
      data-testid={testId}
      width="100%"
      height={h + 2}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "block",
        marginTop: 10,
        overflow: "visible",
        width: "100%",
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={s.area} fill={`url(#${id})`} />
      <polyline
        points={s.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={s.lastX}
        cy={s.lastY}
        r="2.6"
        fill={color}
        stroke="#fff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function spp(arr, w, h, pad = 6) {
  return spr(arr, w, h, pad, Math.max(10, pad * 2));
}
function spr(arr, w, h, pad, xPad = pad) {
  if (!arr || arr.length < 2) return null;
  const mn = Math.min(...arr),
    mx = Math.max(...arr),
    rng = mx - mn || 1;
  const drawableW = Math.max(1, w - xPad * 2);
  const pts = arr.map((v, i) => {
    const x = xPad + (i / (arr.length - 1)) * drawableW;
    const y = h - pad - ((v - mn) / rng) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  const first = pts[0].split(",");
  return {
    line: pts.join(" "),
    area: `${first[0]},${h} ${pts.join(" ")} ${last[0]},${h}`,
    lastX: last[0],
    lastY: last[1],
  };
}
function MiniLine({ series, color, w = 46, h = 20, testId }) {
  const spark = spr(series, w, h, 2, 3);
  if (!spark) return null;
  return (
    <svg
      data-testid={testId}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      <polyline
        points={spark.line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity=".85"
      />
    </svg>
  );
}

function AdmissionFunnelModel({ admission }) {
  const stages = admission?.stages || [];
  const base = Math.max(
    ...stages.map((stage) => Math.abs(Number(stage.value) || 0)),
    1,
  );
  const first = Number(stages[0]?.value) || 0;
  const shrinkStep = stages.length > 1 ? 42 / (stages.length - 1) : 0;

  return (
    <div
      data-testid="admission-funnel-model"
      style={{
        padding: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "190px minmax(260px,.86fr) minmax(260px,1fr)",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            padding: "0 8px 2px",
          }}
        >
          转化指标
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            textAlign: "center",
            paddingBottom: 2,
          }}
        >
          阶段
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 680,
            color: C.ink4,
            padding: "0 8px 2px",
          }}
        >
          业务决策
        </div>

        {stages.map((stage, index) => {
          const value = Math.abs(Number(stage.value) || 0);
          const pct = Math.min(Math.max(Math.round((value / base) * 100), 6), 100);
          const ofFirst =
            first > 0 ? `${Math.round((value / first) * 100)}%` : "—";
          const next = stages[index + 1];
          const conversion =
            next && value > 0
              ? `${Math.round(((Number(next.value) || 0) / value) * 100)}%`
              : null;
          const decision = admissionDecision(stage, index, stages.length);
          const width = Math.max(44, 88 - index * shrinkStep);
          const tone =
            index === stages.length - 1
              ? {
                  fill:
                    "linear-gradient(180deg,var(--violet-600) 0%,var(--blue-800) 100%)",
                  metric: "var(--blue-50)",
                  accent: "var(--violet-600)",
                }
              : {
                  fill:
                    "linear-gradient(180deg,var(--blue-500) 0%,var(--violet-600) 100%)",
                  metric: "var(--violet-50)",
                  accent: "var(--blue-600)",
                };

          return (
            <React.Fragment key={stage.key || index}>
              <div
                data-testid="admission-funnel-metric"
                style={{
                  minHeight: 58,
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 64px",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 11px 9px 14px",
                  background: tone.metric,
                  border: `1px solid ${C.divider}`,
                  clipPath:
                    "polygon(0 0,calc(100% - 18px) 0,100% 50%,calc(100% - 18px) 100%,0 100%)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 680,
                      color: C.ink2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stage.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 11.5,
                      color: C.ink4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    占报名 {ofFirst}
                  </div>
                </div>
                <div
                  style={{
                    minHeight: 38,
                    border: `1px dashed ${C.ink3}`,
                    borderRadius: 6,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tone.accent,
                    background: "rgba(255,255,255,.62)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <strong style={{ fontSize: 18, lineHeight: 1 }}>
                    {num(stage.value)}
                  </strong>
                  <span style={{ fontSize: 10.5, color: C.ink4 }}>人</span>
                </div>
              </div>

              <div
                style={{
                  minHeight: 58,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                <div
                  data-testid="admission-funnel-segment"
                  style={{
                    width: `${width}%`,
                    height: 58,
                    clipPath: "polygon(5% 0,95% 0,84% 100%,16% 100%)",
                    background: tone.fill,
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,.26),0 8px 18px -14px rgba(91,75,209,.45)",
                    color: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 720 }}>
                    {stage.label}
                  </span>
                  <span
                    style={{
                      marginTop: 3,
                      fontSize: 11,
                      opacity: 0.86,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {pct}% 阶段占比
                  </span>
                </div>
              </div>

              <div
                data-testid="admission-funnel-decision"
                style={{
                  minHeight: 58,
                  display: "grid",
                  gridTemplateColumns: "38px minmax(0,1fr)",
                  gap: 10,
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "linear-gradient(180deg,#f7f9fd 0%,#ffffff 100%)",
                  border: `1px solid ${C.divider2}`,
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: tone.accent,
                    background: tone.metric,
                    fontSize: 15,
                    fontWeight: 780,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 3,
                    }}
                  >
                    <strong
                      style={{
                        fontSize: 12.5,
                        color: C.ink2,
                        fontWeight: 720,
                      }}
                    >
                      {decision.title}
                    </strong>
                    {conversion ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: C.warn,
                          background: "var(--warn-50)",
                          borderRadius: 999,
                          padding: "2px 7px",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        下一层 {conversion}
                      </span>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      color: C.ink4,
                    }}
                  >
                    {decision.detail}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function useClock() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 5000);
    return () => clearInterval(id);
  }, []);
}
function nowClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function updatedLabelFrom(generatedAt) {
  if (!generatedAt) return "刚刚更新";
  const diff = Math.max(
    0,
    Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000),
  );
  return diff < 60 ? `${diff} 秒前更新` : `${Math.floor(diff / 60)} 分钟前更新`;
}

const ROLE_LABELS = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};
function greeting() {
  const h = new Date().getHours();
  return h < 6
    ? "凌晨好"
    : h < 11
      ? "早上好"
      : h < 13
        ? "中午好"
        : h < 18
          ? "下午好"
          : "晚上好";
}

// ============================================================
//  KPI 卡（设计稿主看板 4 张）
// ============================================================
function KpiCard({ group }) {
  const a = group.items[0] || { label: "", value: 0, tone: "neutral" };
  const b = group.items[1] || { label: "", value: 0, tone: "neutral" };
  const t = (Number(a.value) || 0) + (Number(b.value) || 0) || 1;
  const aCol = dotColor(a.tone),
    bCol = dotColor(b.tone);
  const numCol = (it, col) => (it.tone === "neutral" ? C.ink : col);
  return (
    <div
      className="ob-kpi-card lift"
      style={{
        borderRadius: 14,
        padding: "16px 16px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "linear-gradient(180deg,#eef3ff,#e4ebff)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.72),0 0 0 1px rgba(59,107,230,.08)",
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: C.primary,
            }}
          />
        </div>
        <span style={{ fontSize: 12.5, color: C.ink3, fontWeight: 600 }}>
          {group.title}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 23,
              fontWeight: 720,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: numCol(a, aCol),
            }}
          >
            {a.value}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: C.muted,
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: aCol,
              }}
            />
            {a.label}
          </div>
        </div>
        <div
          style={{
            width: 1,
            height: 34,
            background: "linear-gradient(180deg,transparent,#dfe6f2,transparent)",
            margin: "0 12px 4px",
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 23,
              fontWeight: 720,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              color: numCol(b, bCol),
            }}
          >
            {b.value}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: C.muted,
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: bCol,
              }}
            />
            {b.label}
          </div>
        </div>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: C.track,
          marginTop: 13,
          display: "flex",
          overflow: "hidden",
          boxShadow: "inset 0 0 0 1px rgba(15,23,42,.03)",
        }}
      >
        <div
          style={{
            width: `${(((Number(a.value) || 0) / t) * 100).toFixed(1)}%`,
            background: aCol,
          }}
        />
        <div
          style={{
            width: `${(((Number(b.value) || 0) / t) * 100).toFixed(1)}%`,
            background: bCol,
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
//  AI 助手面板（右栏）—— 调用真实 /api/ai/* 与 /api/marketplace/intel
// ============================================================
function buildReviewInput(projects) {
  const project = (projects || [])[0] || {
    id: "project-warroom",
    name: "经营项目",
    start: "",
    end: "",
    metrics: {},
  };
  const rows = (projects || []).slice(0, 4);
  const streamers = (rows.length ? rows : [project]).map((p, i) => ({
    id: `${project.id}-s${i}`,
    name: p.name || `主播${i + 1}`,
    durationMinutes: 600,
    totalViews: 40000,
    completionRateBps: Math.round(
      (Number(p?.metrics?.doneHours) || 0) > 0 ? 8000 : 7000,
    ),
    roiBps: Math.round((Number(p?.metrics?.margin) || 0) * 100 + 10000),
    grossMarginContributionCents: Math.round(
      (Number(p?.metrics?.gross) || 0) * 100,
    ),
    anomalyCount: p?.risk === "high" ? 1 : 0,
    disputeCount: p?.risk === "high" ? 1 : 0,
  }));
  return {
    project: {
      id: project.id,
      name: project.name,
      category: "moba",
      platform: "douyin",
      periodStart: project.start || "2026-01-01",
      periodEnd: project.end || "2026-12-31",
    },
    finance: {
      receivableCents: Math.round(
        (Number(project?.metrics?.receivable) || 12000) * 100,
      ),
      payableCents: Math.round(
        (Number(project?.metrics?.payable) || 6000) * 100,
      ),
      supplierCostCents: 100000,
      adjustmentCents: 0,
      manualRevenueCents: 0,
    },
    streamers,
    suppliers: [
      {
        id: "sup-1",
        name: "默认供应商",
        streamerCount: streamers.length,
        settlementCents: 100000,
      },
    ],
    evidenceSummary: { green: 8, yellow: 1, red: 0, unknown: 0 },
    targetMarginBps: 3000,
  };
}
function extractAiText(body) {
  const o = body?.agentOutput || body?.output || body || {};
  if (typeof o.summary === "string" && o.summary.trim()) {
    const recs = Array.isArray(o.recommendations) ? o.recommendations : [];
    const tail = recs
      .slice(0, 3)
      .map((r) => `· ${typeof r === "string" ? r : r.text || r.title || ""}`)
      .filter(Boolean)
      .join("\n");
    return tail ? `${o.summary}\n\n建议：\n${tail}` : o.summary;
  }
  if (typeof o.narrative === "string" && o.narrative.trim()) return o.narrative;
  if (Array.isArray(o.findings) && o.findings.length)
    return o.findings.map((f) => `· ${f.title || f.text || ""}`).join("\n");
  return "已生成分析（需人工确认后采用）。";
}

function cleanMarkdownText(value) {
  return String(value || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

function markdownCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cleanMarkdownText);
}

function isMarkdownTableRow(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function isMarkdownTableSeparator(line) {
  if (!isMarkdownTableRow(line)) return false;
  const cells = markdownCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableStart(lines, index) {
  return (
    isMarkdownTableRow(lines[index]) &&
    isMarkdownTableSeparator(lines[index + 1])
  );
}

function parseMarkdownTable(lines) {
  const headers = markdownCells(lines[0]);
  const rows = lines
    .slice(2)
    .map(markdownCells)
    .filter((row) => row.some(Boolean));
  return { headers, rows };
}

function parseMarkdownHeading(line) {
  const match = /^(#{1,4})\s+(.+)$/.exec(String(line || "").trim());
  if (!match) return null;
  return {
    level: Math.min(match[1].length, 4),
    text: cleanMarkdownText(match[2]),
  };
}

function parseMarkdownListItem(line) {
  const unordered = /^\s*[-*+]\s+(.+)$/.exec(String(line || ""));
  if (unordered) {
    return { ordered: false, text: unordered[1] };
  }
  const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(String(line || ""));
  if (ordered) {
    return { ordered: true, text: ordered[1] };
  }
  return null;
}

function parseAiMarkdown(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let pendingText = [];

  const flushText = () => {
    const value = pendingText.join("\n").trim();
    if (value) blocks.push({ type: "paragraph", value });
    pendingText = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) {
      flushText();
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushText();
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", value: parseMarkdownTable(tableLines) });
      continue;
    }

    const heading = parseMarkdownHeading(lines[index]);
    if (heading) {
      flushText();
      blocks.push({ type: "heading", value: heading });
      continue;
    }

    const listItem = parseMarkdownListItem(lines[index]);
    if (listItem) {
      flushText();
      const items = [listItem.text];
      const ordered = listItem.ordered;
      index += 1;
      while (index < lines.length) {
        const nextItem = parseMarkdownListItem(lines[index]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        items.push(nextItem.text);
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", value: { ordered, items } });
      continue;
    }

    pendingText.push(lines[index]);
  }

  flushText();
  return blocks;
}

function renderInlineMarkdown(text, keyPrefix = "inline") {
  const source = String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g;
  const nodes = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > lastIndex) {
      nodes.push(source.slice(lastIndex, match.index));
    }

    if (match[2] || match[3]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {match[2] || match[3]}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          style={{
            fontSize: "0.95em",
            color: C.primaryDeep,
            background: C.primarySoft,
            borderRadius: 4,
            padding: "0 4px",
          }}
        >
          {match[4]}
        </code>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes.length ? nodes : [source];
}

function AiMessageContent({ text }) {
  const blocks = parseAiMarkdown(text);
  if (!blocks.length) return null;

  return (
    <div style={{ display: "grid", gap: 9, whiteSpace: "normal" }}>
      {blocks.map((block, index) =>
        block.type === "table" ? (
          <AiMarkdownTable key={index} table={block.value} />
        ) : block.type === "heading" ? (
          <AiHeadingBlock key={index} heading={block.value} />
        ) : block.type === "list" ? (
          <AiListBlock key={index} list={block.value} />
        ) : (
          <AiTextBlock key={index} text={block.value} />
        ),
      )}
    </div>
  );
}

function priorityTone(priority) {
  if (priority === "high") return tone("danger");
  if (priority === "medium") return tone("warn");
  return tone("ok");
}

function AiProjectHealthCard({ projectHealth }) {
  const project = projectHealth?.topProjects?.[0];
  if (!project) return null;

  const t = priorityTone(project.priority);
  const reasons = Array.isArray(project.reasons) ? project.reasons.slice(0, 3) : [];
  const evidence = Array.isArray(project.evidence)
    ? project.evidence.slice(0, 2)
    : [];

  return (
    <div
      data-testid="ai-project-health-card"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.soft,
        padding: "10px 11px",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: t.solid,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 12.5,
            fontWeight: 730,
            color: C.ink,
            overflowWrap: "anywhere",
          }}
        >
          {project.projectName}
        </span>
        <span
          style={{
            flexShrink: 0,
            color: t.color,
            background: t.bg,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 10.5,
            fontWeight: 720,
            lineHeight: 1.4,
          }}
        >
          {project.priority}
        </span>
      </div>
      {reasons.length ? (
        <div style={{ display: "grid", gap: 5 }}>
          {reasons.map((reason, index) => (
            <div
              key={`${reason}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "10px minmax(0, 1fr)",
                gap: 6,
                alignItems: "start",
                fontSize: 11.5,
                color: C.ink3,
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: t.color, fontWeight: 740 }}>-</span>
              <span style={{ overflowWrap: "anywhere" }}>{reason}</span>
            </div>
          ))}
        </div>
      ) : null}
      {evidence.length ? (
        <div
          style={{
            display: "grid",
            gap: 3,
            paddingTop: 2,
            borderTop: `1px solid ${C.divider}`,
          }}
        >
          {evidence.map((entry, index) => (
            <span
              key={`${entry.sourceId}-${index}`}
              style={{
                fontSize: 10.5,
                lineHeight: 1.45,
                color: C.muted,
                overflowWrap: "anywhere",
              }}
            >
              {entry.sourceId}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiSuggestedActionCard({ actions }) {
  const action = actions?.[0];
  if (!action) return null;

  const t = priorityTone(action.priority);
  const evidence = Array.isArray(action.evidence)
    ? action.evidence.slice(0, 2)
    : [];

  return (
    <div
      data-testid="ai-suggested-action-card"
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        background: C.card,
        padding: "10px 11px",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 8,
            background: t.bg,
            color: t.color,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 760,
          }}
        >
          !
        </span>
        <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 3 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 730,
              color: C.ink,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {action.title}
          </div>
          {action.projectName ? (
            <div
              style={{
                fontSize: 11,
                color: C.muted,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {action.projectName}
            </div>
          ) : null}
        </div>
      </div>
      {action.rationale ? (
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.5,
            color: C.ink3,
            overflowWrap: "anywhere",
          }}
        >
          {action.rationale}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            color: t.color,
            background: t.bg,
            borderRadius: 999,
            padding: "2px 7px",
            fontSize: 10.5,
            fontWeight: 720,
            lineHeight: 1.4,
          }}
        >
          {action.priority}
        </span>
        {action.requiresHumanApproval ? (
          <span
            style={{
              color: C.muted,
              background: C.soft,
              borderRadius: 999,
              padding: "2px 7px",
              fontSize: 10.5,
              fontWeight: 650,
              lineHeight: 1.4,
            }}
          >
            Human approval required
          </span>
        ) : null}
      </div>
      {evidence.length ? (
        <div
          style={{
            display: "grid",
            gap: 3,
            paddingTop: 2,
            borderTop: `1px solid ${C.divider}`,
          }}
        >
          {evidence.map((entry, index) => (
            <span
              key={`${entry.sourceId}-${index}`}
              style={{
                fontSize: 10.5,
                lineHeight: 1.45,
                color: C.muted,
                overflowWrap: "anywhere",
              }}
            >
              {entry.sourceId}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiHeadingBlock({ heading }) {
  const Tag = heading.level <= 2 ? "h3" : "h4";
  return (
    <Tag
      style={{
        margin: 0,
        paddingTop: 2,
        fontSize: heading.level <= 2 ? 14 : 13,
        lineHeight: 1.45,
        fontWeight: 760,
        color: C.ink,
      }}
    >
      {heading.text}
    </Tag>
  );
}

function AiTextBlock({ text }) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {lines.map((line, index) => (
        <p
          key={`${line}-${index}`}
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.7,
            color: "#2a2f3a",
            overflowWrap: "anywhere",
          }}
        >
          {renderInlineMarkdown(line, `p-${index}`)}
        </p>
      ))}
    </div>
  );
}

function AiListBlock({ list }) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag
      style={{
        margin: 0,
        paddingLeft: list.ordered ? 20 : 18,
        display: "grid",
        gap: 5,
        color: "#2a2f3a",
      }}
    >
      {list.items.map((item, index) => (
        <li
          key={`${item}-${index}`}
          style={{
            fontSize: 12.5,
            lineHeight: 1.6,
            paddingLeft: 2,
            overflowWrap: "anywhere",
          }}
        >
          {renderInlineMarkdown(item, `li-${index}`)}
        </li>
      ))}
    </Tag>
  );
}

function AiMarkdownTable({ table }) {
  const headers = table.headers || [];
  const rows = table.rows || [];
  if (!headers.length || !rows.length) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row, rowIndex) => {
        const title = row[0] || `#${rowIndex + 1}`;
        const details = headers
          .map((header, index) => ({
            header: header || `字段 ${index + 1}`,
            value: row[index] || "-",
          }))
          .filter((item, index) => index > 0 && item.value !== "-");

        return (
          <div
            key={`${title}-${rowIndex}`}
            data-testid="ai-markdown-table-row"
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 11,
              background: "#fafbff",
              padding: "9px 10px",
              display: "grid",
              gap: 7,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.72)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: C.primary,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 720,
                  color: C.ink,
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {title}
              </span>
            </div>
            <div style={{ display: "grid", gap: 5 }}>
              {details.map((item) => (
                <div
                  key={`${item.header}-${item.value}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "82px minmax(0, 1fr)",
                    gap: 8,
                    alignItems: "start",
                  }}
                >
                  <span
                    style={{
                      color: C.muted,
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    {item.header}
                  </span>
                  <span
                    style={{
                      color: C.ink3,
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiPanel({ user, projects, go }) {
  const storageKey = aiPanelStorageKey(user);
  const [msgs, setMsgs] = React.useState(() =>
    loadStoredAiMessages(storageKey),
  );
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const name =
    (user?.name && user.name !== "未登录用户" ? user.name : null) ||
    "经营舱用户";
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy]);
  React.useEffect(() => {
    saveStoredAiMessages(storageKey, msgs);
  }, [storageKey, msgs]);

  const push = (role, text, meta) =>
    setMsgs((m) => m.concat([{ role, text, ...(meta ? { meta } : {}) }]));
  const chatHistory = (userText) =>
    (msgs || [])
      .slice(-8)
      .map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text,
      }))
      .concat([{ role: "user", content: userText }]);

  async function run(kind, userText) {
    if (busy) return;
    push("user", userText);
    setBusy(true);
    try {
      let text = "";
      let meta;
      if (kind === "match") {
        const res = await fetch("/api/marketplace/intel", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "撮合情报获取失败");
        const recos = (json?.matches?.recommendations || []).slice(0, 3);
        text = recos.length
          ? "为当前供需匹配出以下高契合机会：\n" +
            recos
              .map((r) => `· ${r.title}（${(r.reasons || []).join("、")}）`)
              .join("\n")
          : "当前暂无可撮合的高契合机会，待有新发单/接单意向后会自动出现。";
      } else if (kind === "ask") {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: chatHistory(userText) }),
        });
        const json = await res.json();
        meta = normalizeAiMessageMeta(json);
        if (!res.ok) throw new Error(json?.error || "AI 调用失败");
        text =
          json?.message?.content || json?.text || "已生成回复（需人工确认）。";
      } else {
        // review / risk → 真实经营诊断代理
        const res = await fetch("/api/ai/project-reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildReviewInput(projects)),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "AI 诊断调用失败");
        text = extractAiText(json);
      }
      push("ai", text, meta);
    } catch (e) {
      push(
        "ai",
        `⚠ ${e instanceof Error ? e.message : "调用失败，请稍后重试"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    run("ask", t);
  };
  const quick = (icon, bg, stroke, title, sub, onClick) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "11px 12px",
        cursor: busy ? "default" : "pointer",
        boxShadow: "0 1px 2px rgba(24,27,46,.03)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 650,
            color: C.ink,
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            color: C.muted,
            marginTop: 1,
          }}
        >
          {sub}
        </span>
      </span>
    </button>
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "linear-gradient(180deg,#fcfcfe,#f3f4f9)",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow:
          "0 1px 2px rgba(24,27,46,.04),0 12px 32px -20px rgba(24,27,46,.2)",
      }}
    >
      {/* 顶栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 15px",
          borderBottom: `1px solid ${C.divider}`,
          background: "rgba(255,255,255,.55)",
        }}
      >
        <span
          style={{
            display: "flex",
            width: 22,
            height: 22,
            borderRadius: 7,
            background: "linear-gradient(140deg,#5566e6,#8a72ee)",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(85,102,230,.4)",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 100 100" fill="#fff">
            <path d="M50 6C54 30 70 46 94 50 70 54 54 70 50 94 46 70 30 54 6 50 30 46 46 30 50 6Z" />
          </svg>
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>
          星耀 AI 助手
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: C.primaryDeep,
            background: C.primarySoft,
            borderRadius: 6,
            padding: "2px 6px",
          }}
        >
          Beta
        </span>
      </div>
      {/* 对话区 */}
      <div
        ref={bodyRef}
        className="scl"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 15px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minHeight: 0,
        }}
      >
        {msgs.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "18px 4px 4px",
            }}
          >
            <div
              style={{
                position: "relative",
                width: 74,
                height: 74,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle,rgba(138,114,238,.28),transparent 68%)",
                }}
              />
              <svg
                width="54"
                height="54"
                viewBox="0 0 100 100"
                style={{ position: "relative" }}
              >
                <defs>
                  <linearGradient id="aiStar" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#8b9cf0" />
                    <stop offset=".52" stopColor="#a98ad8" />
                    <stop offset="1" stopColor="#e7b491" />
                  </linearGradient>
                </defs>
                <path
                  d="M50 3C55 31 69 45 97 50 69 55 55 69 50 97 45 69 31 55 3 50 31 45 45 31 50 3Z"
                  fill="url(#aiStar)"
                />
              </svg>
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 730,
                marginTop: 16,
                letterSpacing: "-.2px",
                color: C.ink,
              }}
            >
              你好，{name} 👋
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: C.muted,
                marginTop: 7,
                lineHeight: 1.5,
              }}
            >
              需要我帮你分析经营数据
              <br />
              或处理待办事项吗？
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                width: "100%",
                marginTop: 22,
              }}
            >
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4453d4"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3v18h18" />
                  <path d="m7 14 4-4 3 3 5-6" />
                </svg>,
                "linear-gradient(145deg,#e7e9fc,#dadef9)",
                "#4453d4",
                "生成复盘报告",
                "汇总本月经营与低毛利项目",
                () =>
                  run(
                    "ask",
                    "帮我生成本月经营复盘报告，并结合知识库沉淀可复用经验",
                  ),
              )}
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1f9d55"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="3.4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.5a4 4 0 0 1 0 7" />
                </svg>,
                "linear-gradient(145deg,#e2f3e9,#d3eedd)",
                "#1f9d55",
                "智能撮合推荐",
                "为招募项目匹配主播",
                () => run("match", "为当前招募中的项目推荐匹配主播"),
              )}
              {quick(
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#b5790a"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
                </svg>,
                "linear-gradient(145deg,#fbeccb,#f7e1ac)",
                "#b5790a",
                "解读风险事项",
                "分析风险并给出处理优先级",
                () => run("risk", "解读当前风险事项并按优先级给出处理建议"),
              )}
            </div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={
                m.role === "user"
                  ? {
                      maxWidth: "84%",
                      background: "linear-gradient(135deg,#5566e6,#7160e6)",
                      color: "#fff",
                      borderRadius: "14px 14px 4px 14px",
                      padding: "9px 12px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      boxShadow: "0 2px 7px rgba(85,102,230,.26)",
                    }
                  : {
                      maxWidth: "94%",
                      background: "#fff",
                      color: "#2a2f3a",
                      border: `1px solid ${C.border}`,
                      borderRadius: "14px 14px 14px 4px",
                      padding: "9px 12px",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      whiteSpace: "normal",
                      boxShadow: "0 1px 2px rgba(24,27,46,.05)",
                    }
              }
            >
              {m.role === "ai" ? (
                <div style={{ display: "grid", gap: 9 }}>
                  <AiMessageContent text={m.text} />
                  <AiProjectHealthCard projectHealth={m.meta?.projectHealth} />
                  <AiSuggestedActionCard actions={m.meta?.suggestedActions} />
                </div>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
        {busy ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: "14px 14px 14px 4px",
                padding: "9px 12px",
                fontSize: 12.5,
                color: C.muted,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  border: "2.2px solid #d8dbe6",
                  borderTopColor: C.primary,
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "obspin .7s linear infinite",
                }}
              />
              正在分析真实数据…
            </div>
          </div>
        ) : null}
      </div>
      {/* 输入坞 */}
      <div
        style={{
          borderTop: `1px solid ${C.divider}`,
          padding: 12,
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#f5f6f9",
            border: "1px solid #e8eaf0",
            borderRadius: 13,
            padding: "7px 7px 7px 13px",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#aeb3bf"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="向 AI 助手提问或下达指令…"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13,
              color: C.ink,
              fontFamily: "inherit",
              minWidth: 0,
            }}
          />
          <button
            type="button"
            onClick={send}
            disabled={busy}
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: "none",
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 9,
          }}
        >
          <span style={{ fontSize: 11, color: "#b4b9c4" }}>
            AI 产出为草稿，需人工确认
          </span>
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
        const res = await fetch("/api/marketplace/intel", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled)
          setRecos(
            res.ok ? (json?.matches?.recommendations || []).slice(0, 3) : [],
          );
      } catch {
        if (!cancelled) setRecos([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!recos || recos.length === 0) return null;
  return (
    <div
      className="card ob-side-card"
      style={{
        borderRadius: 16,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 680,
          marginBottom: 11,
          color: C.ink,
        }}
      >
        撮合推荐
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
          · 供需广场
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {recos.map((r) => (
          <button
            key={r.kind + r.refId}
            type="button"
            onClick={() => go?.("marketplace")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 8px",
              borderRadius: 11,
              cursor: "pointer",
              border: 0,
              background: "transparent",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                flexShrink: 0,
                borderRadius: 9,
                background: tone(r.kind === "posting" ? "blue" : "violet").bg,
                color: tone(r.kind === "posting" ? "blue" : "violet").color,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {r.kind === "posting" ? "需" : "接"}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: C.ink,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: C.muted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {(r.reasons || []).join(" · ")}
              </span>
            </span>
            <span style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonalPanel({
  user,
  scopeLabel,
  periodLabel = "实时",
  summary,
  recos,
  todos,
  go,
}) {
  const name =
    (user?.name && user.name !== "未登录用户" ? user.name : null) ||
    "经营舱用户";
  const roleLabel = ROLE_LABELS[user?.role] || "成员";
  const org = user?.org || user?.dept || scopeLabel || "";
  const [done, setDone] = React.useState({});
  const todoTotal = todos.length || 1;
  const todoDone = todos.filter((t) => done[t.key]).length;
  return (
    <>
      {/* 问候卡 */}
      <div
        className="ob-greeting-card"
        style={{
          background:
            "linear-gradient(135deg,#17233f 0%,#24294d 58%,#30345f 100%)",
          border: "1px solid rgba(255,255,255,.1)",
          borderRadius: 16,
          padding: 18,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          boxShadow:
            "0 1px 2px rgba(15,23,42,.18),0 18px 34px -24px rgba(15,23,42,.52),inset 0 1px 0 rgba(255,255,255,.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            position: "relative",
          }}
        >
          <span
            style={{
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: 14,
              background:
                "linear-gradient(145deg,rgba(255,255,255,.3),rgba(255,255,255,.14))",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              fontWeight: 800,
              boxShadow: "0 4px 12px rgba(85,102,230,.4)",
            }}
          >
            {name[0] || "U"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 650 }}>
              {greeting()}，{name} 👋
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "#aab0c0",
                marginTop: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {roleLabel}
              {org ? ` · ${org}` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* 大盘总览 2x2 */}
      <div
        className="card ob-side-card"
        style={{
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>
            大盘总览
          </div>
          <span style={{ fontSize: 11, color: C.muted }}>{periodLabel}</span>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {summary.map((s) => (
            <div
              key={s.label}
              style={{
                background: s.attention
                  ? "linear-gradient(150deg,#fff8ea,#fffaf2)"
                  : C.soft,
                border: `1px solid ${s.attention ? "#f1e4c4" : C.divider}`,
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 730,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    color: s.color || C.ink,
                  }}
                >
                  {s.value}
                </div>
                {s.series ? (
                  <MiniLine
                    series={s.series}
                    color={s.color || C.primary}
                    testId="personal-summary-sparkline"
                  />
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 今日推荐 */}
      {recos.length ? (
        <div
          className="card ob-side-card"
          style={{
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 680,
              marginBottom: 11,
              color: C.ink,
            }}
          >
            今日推荐
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {recos.map((r) => (
              <button
                key={r.text}
                type="button"
                onClick={() => r.route && go?.(r.route)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 8px",
                  borderRadius: 11,
                  cursor: "pointer",
                  border: 0,
                  background: "transparent",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `linear-gradient(145deg,${tone(r.tone).bg},${tone(r.tone).bg})`,
                    color: tone(r.tone).color,
                    fontWeight: 800,
                    fontSize: 12.5,
                    boxShadow: `inset 0 0 0 1px ${tone(r.tone).solid}28`,
                  }}
                >
                  {r.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color: C.ink,
                    }}
                  >
                    {r.text}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: C.muted,
                      marginTop: 2,
                    }}
                  >
                    {r.sub}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: tone(r.tone).color,
                    background: tone(r.tone).bg,
                    borderRadius: 7,
                    padding: "3px 8px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.cta || "前往"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <MarketplaceRecos go={go} />

      {/* 待办事项 */}
      {todos.length ? (
        <div
          className="card ob-side-card"
          style={{
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", marginBottom: 12 }}
          >
            <div style={{ fontSize: 13, fontWeight: 680, color: C.ink }}>
              待办事项
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                fontSize: 11.5,
                color: C.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {todoDone} / {todos.length} 已完成
            </div>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 3,
              background: C.divider,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                height: "100%",
                background: "linear-gradient(90deg,#1e50c8,#3b6be6)",
                borderRadius: 3,
                width: "100%",
                transform: `scaleX(${todoDone / todoTotal})`,
                transformOrigin: "left center",
                transition: "transform .3s",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {todos.map((t) => {
              const checked = !!done[t.key];
              return (
                <div
                  key={t.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 6px",
                    borderRadius: 9,
                    cursor: "pointer",
                  }}
                >
                  <button
                    type="button"
                    aria-label="标记完成"
                    onClick={() =>
                      setDone((dd) => ({ ...dd, [t.key]: !dd[t.key] }))
                    }
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: 6,
                      border: checked
                        ? `1px solid ${C.primary}`
                        : "1.5px solid #d3d7e0",
                      background: checked ? C.primary : "#fff",
                      color: "#fff",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      padding: 0,
                      boxShadow: checked
                        ? "0 1px 3px rgba(85,102,230,.35)"
                        : "none",
                    }}
                  >
                    {checked ? "✓" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => t.route && go?.(t.route)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      color: checked ? "#b4b9c4" : C.ink2,
                      textDecoration: checked ? "line-through" : "none",
                    }}
                  >
                    {t.text}
                  </button>
                  {t.count != null ? (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        fontWeight: 600,
                        borderRadius: 6,
                        padding: "2px 6px",
                        color: tone(t.tone).color,
                        background: tone(t.tone).bg,
                      }}
                    >
                      {t.count}
                    </span>
                  ) : null}
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
const RISK_LEVEL = {
  high: { text: "高风险", chip: { background: "#fdecec", color: "#d63c41" } },
  mid: { text: "中风险", chip: { background: "#fef5e3", color: "#b5790a" } },
  low: { text: "低风险", chip: { background: "#eef0fe", color: "#4453d4" } },
};
function toneToLevel(t) {
  return t === "bad" || t === "danger" || t === "red"
    ? "high"
    : t === "warn" || t === "amber"
      ? "mid"
      : "low";
}
function RiskDrawer({ open, risks, onClose, go }) {
  const [tab, setTab] = React.useState("all");
  if (!open) return null;
  const enriched = (risks || []).map((r, i) => ({
    ...r,
    key: r.key || `risk-${i}`,
    level: r.level || toneToLevel(r.tone),
  }));
  const counts = {
    all: enriched.length,
    high: enriched.filter((r) => r.level === "high").length,
    mid: enriched.filter((r) => r.level === "mid").length,
    low: enriched.filter((r) => r.level === "low").length,
  };
  const visible =
    tab === "all" ? enriched : enriched.filter((r) => r.level === tab);
  const tabBtn = (key, label) => {
    const active = tab === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setTab(key)}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          height: 30,
          border: "none",
          borderRadius: 8,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          background: active ? "#fff" : "transparent",
          color: active ? C.ink : "#7a818f",
          boxShadow: active ? "0 1px 3px rgba(24,27,46,.1)" : "none",
        }}
      >
        {label}{" "}
        <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>
          {counts[key]}
        </span>
      </button>
    );
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        animation: "obfade .18s",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(20,24,40,.34)",
        }}
      />
      <div
        role="dialog"
        aria-label="风险事项核验"
        className="scl"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 560,
          maxWidth: "94vw",
          background: "#fff",
          boxShadow: "-12px 0 44px rgba(20,24,40,.2)",
          display: "flex",
          flexDirection: "column",
          animation: "obslide .28s cubic-bezier(.2,.85,.25,1)",
        }}
      >
        <div
          style={{
            padding: "20px 22px 16px",
            borderBottom: `1px solid ${C.divider}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(145deg,#fde0e0,#fbd2d2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#d63c41"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
                <path d="M12 8v4" />
                <path d="M12 15h.01" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 680, color: C.ink }}>
                风险事项核验
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                共{" "}
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {enriched.length}
                </span>{" "}
                条命中规则，需人工确认处理
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#5b626f"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            style={{
              display: "flex",
              gap: 4,
              marginTop: 16,
              background: "#f4f5f8",
              borderRadius: 10,
              padding: 3,
            }}
          >
            {tabBtn("all", "全部")}
            {tabBtn("high", "高风险")}
            {tabBtn("mid", "中风险")}
            {tabBtn("low", "低风险")}
          </div>
        </div>
        <div
          className="scl"
          style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}
        >
          {visible.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {visible.map((r) => {
                const lv = RISK_LEVEL[r.level] || RISK_LEVEL.low;
                return (
                  <div
                    key={r.key}
                    className="card"
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: 14,
                      boxShadow: "0 1px 2px rgba(24,27,46,.03)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          fontSize: 11,
                          fontWeight: 650,
                          borderRadius: 7,
                          padding: "3px 8px",
                          flexShrink: 0,
                          ...lv.chip,
                        }}
                      >
                        {lv.text}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 620,
                            lineHeight: 1.4,
                            color: C.ink,
                          }}
                        >
                          {r.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "#7a818f",
                              background: "#f4f5f8",
                              borderRadius: 6,
                              padding: "2px 7px",
                            }}
                          >
                            {routeLabel(r.target?.route)}
                          </span>
                          {r.subtitle ? (
                            <span style={{ fontSize: 11.5, color: C.muted }}>
                              {r.subtitle}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: `1px solid ${C.divider2}`,
                      }}
                    >
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={onClose}
                        style={{
                          fontSize: 12,
                          color: "#5b626f",
                          background: "#fff",
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: "5px 11px",
                          cursor: "pointer",
                        }}
                      >
                        稍后
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          go?.(r.target?.route || "warroom", r.target?.id);
                          onClose();
                        }}
                        style={{
                          fontSize: 12,
                          color: "#fff",
                          background: C.primary,
                          border: "none",
                          borderRadius: 8,
                          padding: "5px 13px",
                          cursor: "pointer",
                          fontWeight: 600,
                          boxShadow: "0 2px 5px rgba(85,102,230,.3)",
                        }}
                      >
                        去处理
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 16,
                  background: "linear-gradient(145deg,#e8f6ee,#daf0e3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <svg
                  width="27"
                  height="27"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1f9d55"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 620, color: C.ink }}>
                该等级暂无待核验事项
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.muted,
                  marginTop: 5,
                  maxWidth: 240,
                }}
              >
                所有命中此风险等级的事项均已处理完成
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  主组件
// ============================================================
export function OverviewBoard({
  dashboard,
  go,
  projects,
  tasks,
  reports,
  batches,
  currentUser,
}) {
  const [drawer, setDrawer] = React.useState(false);
  const [period, setPeriod] = React.useState("实时");
  useClock();
  const d = dashboard || {};
  const profile = d.profile || {};
  const role = String(profile.role || "owner");
  const panels = d.panels || {};
  const kpis = d.kpis || [];
  const risks = d.risks || [];
  const updatedLabel = updatedLabelFrom(d.generatedAt);
  const periodScopedData = React.useMemo(
    () =>
      scopeDashboardDataByPeriod(period, d.generatedAt, {
        projects: projects || [],
        tasks: tasks || [],
        reports: reports || [],
        batches: batches || [],
      }),
    [period, d.generatedAt, projects, tasks, reports, batches],
  );
  const scopedProjects = periodScopedData.projects;
  const scopedTasks = periodScopedData.tasks;
  const scopedReports = periodScopedData.reports;
  const scopedBatches = periodScopedData.batches;
  const isRealtimePeriod = period === "实时";
  const riskCount = isRealtimePeriod
    ? risks.length
    : scopedRiskCount(periodScopedData);
  const dashboardActionGroups = React.useMemo(
    () => normalizeDashboardActionGroups(d.actionGroups),
    [d.actionGroups],
  );
  const dashboardPersonal = React.useMemo(
    () => normalizeDashboardPersonalPanel(d.personal),
    [d.personal],
  );

  const todoGroups = React.useMemo(
    () =>
      isRealtimePeriod && dashboardActionGroups.length
        ? dashboardActionGroups
        : computeTodoGroups(role, {
            projects: scopedProjects,
            tasks: scopedTasks,
            reports: scopedReports,
            batches: scopedBatches,
          }),
    [
      isRealtimePeriod,
      dashboardActionGroups,
      role,
      scopedProjects,
      scopedTasks,
      scopedReports,
      scopedBatches,
    ],
  );

  // 直播执行实时盘：真实 KPI（厂家应收 / 毛利 / 毛利率 / 风险等，按角色由服务端算）。
  // 走势线仅在能算出真实序列（今日排班累计）时绘制，否则不画、不编造环比。
  const bizCols = React.useMemo(() => {
    const liveKpis =
      isRealtimePeriod && kpis.length
        ? kpis.slice(0, 4)
        : buildScopedLiveKpis(kpis, role, periodScopedData);
    const series = scheduleSeries(scopedTasks);
    return liveKpis.map((k, i) => {
      const f = fmtKpi(k.value, k.unit);
      const fallbackColor =
        i === 0 ? C.primary : i === 1 ? C.ok : i === 2 ? "#e0a82e" : C.danger;
      return {
        key: k.key || `kpi-${i}`,
        label: k.label,
        value: f.value,
        unit: f.unit,
        hint: k.hint || "",
        series: normalizeVisualSeries(k.series) || (i === 0 ? series : null),
        color:
          k.tone && k.tone !== "neutral" ? tone(k.tone).solid : fallbackColor,
      };
    });
  }, [isRealtimePeriod, kpis, role, periodScopedData, scopedTasks]);

  const proj = React.useMemo(
    () => ({
      total: scopedProjects.length,
      running: cnt(scopedProjects, isOperatingProject),
      pending: scopedPendingReportCount(scopedProjects, scopedReports),
      abnormal: scopedAnomalyCount(scopedProjects, scopedTasks),
    }),
    [scopedProjects, scopedReports, scopedTasks],
  );

  const admission = panels.admissionFunnel;
  const passRate = funnelRate(admission);
  const passSeries = admission?.stages?.length
    ? admission.stages.map((s) => Number(s.value) || 0)
    : null;

  // 个人面板真实派生
  const personal = React.useMemo(() => {
    if (isRealtimePeriod && dashboardPersonal) return dashboardPersonal;

    const active = cnt(scopedProjects, isOperatingProject);
    const pendingReports = scopedPendingReportCount(
      scopedProjects,
      scopedReports,
    );
    const anomalies = scopedAnomalyCount(scopedProjects, scopedTasks);
    const recordingPending = (scopedProjects || []).reduce(
      (s, p) => s + (p?.streamers?.pendingReview ?? 0),
      0,
    );
    const lowMargin = cnt(
      scopedProjects,
      (p) => Number.isFinite(margin(p)) && margin(p) < 20,
    );
    const bs = (s) => cnt(scopedBatches, (b) => b.status === s);
    const sched = scheduleSeries(scopedTasks);
    const summary = [
      {
        label: "在营项目",
        value: String(active),
        color: C.primary,
        series: null,
      },
      {
        label: "待办合计",
        value: String(
          todoGroups.reduce(
            (s, g) =>
              s + g.items.reduce((a, i) => a + (Number(i.value) || 0), 0),
            0,
          ),
        ),
        color: "#7b6ef0",
        series: null,
      },
      {
        label: "风险数",
        value: String(riskCount),
        color: riskCount > 0 ? C.warn : C.ink,
        attention: riskCount > 0,
        series: null,
      },
      {
        label: "今日场次",
        value: String((tasks || []).length),
        color: C.ok,
        series: sched,
      },
    ];
    const recos = [];
    if (recordingPending > 0)
      recos.push({
        icon: "录",
        text: "优先处理录屏审核",
        sub: `${recordingPending} 条待审`,
        tone: "warn",
        cta: "去审核",
        route: "projects",
      });
    if (anomalies > 0)
      recos.push({
        icon: "异",
        text: "跟进异常直播任务",
        sub: `${anomalies} 个异常`,
        tone: "warn",
        cta: "去处理",
        route: "tasks",
      });
    if (lowMargin > 0)
      recos.push({
        icon: "复",
        text: "复盘低毛利项目",
        sub: `${lowMargin} 个低于阈值`,
        tone: "warn",
        cta: "去复盘",
        route: "warroom",
      });
    if (pendingReports > 0)
      recos.push({
        icon: "审",
        text: "清理待审报数",
        sub: `${pendingReports} 条`,
        tone: "info",
        cta: "去审核",
        route: "reports",
      });
    if (!recos.length)
      recos.push({
        icon: "看",
        text: "查看项目经营排行",
        sub: "按毛利贡献",
        tone: "info",
        cta: "查看",
        route: "warroom",
      });
    const todos = [];
    if (pendingReports > 0)
      todos.push({
        key: "rev",
        text: "审核待审报数",
        count: pendingReports,
        tone: "warn",
        route: "reports",
      });
    if (anomalies > 0)
      todos.push({
        key: "ano",
        text: "处理异常直播任务",
        count: anomalies,
        tone: "warn",
        route: "tasks",
      });
    if (recordingPending > 0)
      todos.push({
        key: "rec",
        text: "核验录屏待审",
        count: recordingPending,
        tone: "warn",
        route: "projects",
      });
    if (bs("draft") > 0)
      todos.push({
        key: "bat",
        text: "生成结算批次",
        count: bs("draft"),
        tone: "neutral",
        route: "settle",
      });
    if (bs("pending_confirm") > 0)
      todos.push({
        key: "cfm",
        text: "确认待确认批次",
        count: bs("pending_confirm"),
        tone: "warn",
        route: "settle",
      });
    if (!todos.length)
      todos.push({
        key: "none",
        text: "暂无紧急待办，保持关注经营总览",
        count: null,
        route: "warroom",
      });
    return { summary, recos: recos.slice(0, 3), todos: todos.slice(0, 5) };
  }, [
    isRealtimePeriod,
    dashboardPersonal,
    scopedProjects,
    scopedTasks,
    scopedReports,
    scopedBatches,
    todoGroups,
    riskCount,
  ]);

  return (
    <div className="ob-shell ob-command-surface" style={{ minHeight: "100%" }}>
      <style>{`
        @keyframes obpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
        @keyframes obspin{to{transform:rotate(360deg)}}
        @keyframes obfade{from{opacity:0}to{opacity:1}}
        @keyframes obslide{from{transform:translateX(44px);opacity:0}to{transform:translateX(0);opacity:1}}
        .ob-command-surface{--ob-command-bg:linear-gradient(180deg,#eef3fb 0%,#f4f6fb 260px,#f4f6fb 100%);--ob-panel-border:#dfe6f2;--ob-panel-shadow:0 1px 2px rgba(15,23,42,.05),0 12px 30px -22px rgba(15,23,42,.34);--ob-panel-highlight:inset 0 1px 0 rgba(255,255,255,.86);background:var(--ob-command-bg);color:#0b1733}
        .ob-shell *{box-sizing:border-box}
        .ob-card .lift,.lift{transition:box-shadow .2s ease,transform .2s ease,border-color .2s ease}
        .lift:hover{box-shadow:0 1px 2px rgba(15,23,42,.06),0 18px 34px -24px rgba(15,23,42,.42);transform:translateY(-1px)}
        .ob-panel-card,.ob-side-card,.ob-live-card,.ob-kpi-card{background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%);border:1px solid var(--ob-panel-border);box-shadow:var(--ob-panel-shadow),var(--ob-panel-highlight)}
        .ob-kpi-card{position:relative;overflow:hidden}
        .ob-kpi-card::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,rgba(59,107,230,.28),rgba(14,138,77,.16),rgba(168,106,0,.18))}
        .ob-live-card{box-shadow:0 1px 2px rgba(15,23,42,.05),0 18px 42px -30px rgba(15,23,42,.42),var(--ob-panel-highlight)}
        .ob-critical-banner{background:linear-gradient(180deg,#fff8e7 0%,#fff3d6 100%);border:1px solid #efd89f;box-shadow:0 1px 2px rgba(121,80,0,.05),inset 0 1px 0 rgba(255,255,255,.74)}
        .ob-segmented{display:flex;gap:2px;background:#e9eef7;border:1px solid #dce4f0;border-radius:11px;padding:3px;box-shadow:inset 0 1px 2px rgba(15,23,42,.04)}
        .ob-segmented-button{min-width:54px;height:28px;padding:0 14px;border:none;border-radius:8px;font-size:12.5px;font-weight:650;cursor:pointer;transition:background-color .16s ease,color .16s ease,box-shadow .16s ease;line-height:28px}
        .ob-segmented-button.is-active{background:#ffffff;color:#1e50c8;box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 1px rgba(255,255,255,.8)}
        .ob-segmented-button:not(.is-active){background:transparent;color:#66748a}
        .ob-toolbar-pill{background:rgba(255,255,255,.76);border:1px solid var(--ob-panel-border);box-shadow:0 1px 2px rgba(15,23,42,.03),inset 0 1px 0 rgba(255,255,255,.82)}
        .scl::-webkit-scrollbar{width:8px;height:8px}
        .scl::-webkit-scrollbar-thumb{background:#cfd7e6;border-radius:4px}
        .scl::-webkit-scrollbar-track{background:transparent}
        .ob-shell{--ob-ai-width:440px;--ob-gap:16px;--ob-pad-r:20px;--ob-ai-top:76px;--ob-ai-bottom:20px}
        .ob-layout{display:grid;grid-template-columns:minmax(760px,1fr) 300px;gap:var(--ob-gap);align-items:start;padding:20px calc(var(--ob-ai-width) + var(--ob-gap) + var(--ob-pad-r)) 40px 24px;box-sizing:border-box}
        .ob-main{min-width:0;display:flex;flex-direction:column;gap:16px}
        .ob-personal{min-width:0;display:flex;flex-direction:column;gap:16px}
        .ob-ai{min-width:0;position:fixed;right:var(--ob-pad-r);top:var(--ob-ai-top);bottom:var(--ob-ai-bottom);width:var(--ob-ai-width);z-index:20;display:flex;flex-direction:column}
        @media(max-width:1560px){.ob-shell{--ob-ai-width:400px;--ob-gap:14px;--ob-pad-r:18px}.ob-layout{grid-template-columns:minmax(720px,1fr) 280px;gap:var(--ob-gap);padding:18px calc(var(--ob-ai-width) + var(--ob-gap) + var(--ob-pad-r)) 36px 20px}}
        @media(max-width:1360px){.ob-layout{grid-template-columns:minmax(0,1fr);padding:18px calc(var(--ob-ai-width) + var(--ob-gap) + var(--ob-pad-r)) 36px 20px}}
        @media(max-width:1080px){.ob-layout{grid-template-columns:1fr;padding:18px 18px 36px 20px}.ob-ai{position:relative;right:auto;top:auto;bottom:auto;width:auto;height:540px;z-index:auto}}
      `}</style>

      <div className="ob-layout">
        {/* ===== 左：主看板 ===== */}
        <section className="ob-main">
          {/* 标题 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 0,
                display: "flex",
                alignItems: "center",
                gap: 9,
                color: C.ink,
              }}
            >
              {profile.title || "经营总览看板"}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: C.primaryDeep,
                  background: C.primarySoft,
                  borderRadius: 20,
                  padding: "3px 9px",
                  boxShadow: "inset 0 0 0 1px rgba(85,102,230,.14)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: C.primary,
                    animation: "obpulse 1.6s infinite",
                  }}
                />
                实时
              </span>
            </h1>
          </div>

          {/* tabs + meta */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="ob-segmented">
              {PERIOD_TABS.map((p) => {
                const active = period === p;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`ob-segmented-button${active ? " is-active" : ""}`}
                    onClick={() => setPeriod(p)}
                    style={{
                      fontFamily: "inherit",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1 }} />
            {profile.scopeLabel ? (
              <div
                className="ob-toolbar-pill"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 32,
                  borderRadius: 9,
                  padding: "0 11px",
                  fontSize: 12.5,
                  color: C.ink4,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#9aa0ad"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 7h18M3 12h18M3 17h18" />
                </svg>
                {profile.scopeLabel}
              </div>
            ) : null}
            <div
              className="ob-toolbar-pill"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                borderRadius: 9,
                padding: "0 11px",
                fontSize: 12.5,
                color: C.ink4,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9aa0ad"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
              {updatedLabel}
            </div>
          </div>

          {/* 风险横幅 */}
          {riskCount > 0 ? (
            <div
              className="ob-critical-banner"
              style={{
                position: "relative",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                gap: 14,
                borderRadius: 14,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "linear-gradient(150deg,#fcedc4,#f7da93)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.65),0 0 0 4px rgba(247,218,147,.22)",
                }}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#c2860a"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
              </div>
              <div style={{ position: "relative", flex: 1, lineHeight: 1.4 }}>
                <div
                  style={{ fontSize: 13.5, fontWeight: 650, color: "#6b5326" }}
                >
                  命中风险规则的事项待人工核验处理
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 20,
                      height: 20,
                      padding: "0 6px",
                      marginLeft: 8,
                      background: "rgba(181,121,10,.12)",
                      color: C.warn,
                      border: "1px solid rgba(181,121,10,.22)",
                      borderRadius: 7,
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      verticalAlign: "middle",
                    }}
                  >
                    {riskCount}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#9c8755", marginTop: 2 }}>
                  含{" "}
                  {risks.filter((r) => toneToLevel(r.tone) === "high").length}{" "}
                  条高风险事项，建议优先处理
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(true)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 34,
                  border: "none",
                  borderRadius: 9,
                  padding: "0 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background:
                    "linear-gradient(135deg,#edb52b 0%,#e2a314 52%,#d4940b 100%)",
                  cursor: "pointer",
                  flexShrink: 0,
                  boxShadow:
                    "0 3px 9px rgba(206,150,16,.3),inset 0 1px 0 rgba(255,255,255,.32)",
                }}
              >
                去处理
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          ) : null}

          {/* 4 KPI */}
          {todoGroups.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,1fr)",
                gap: 14,
              }}
            >
              {todoGroups.slice(0, 4).map((g) => (
                <KpiCard key={g.title} group={g} />
              ))}
            </div>
          ) : null}

          {/* 经营数据卡（直播执行实时盘） */}
          {bizCols.length ? (
            <div
              className="card ob-live-card"
              style={{
                position: "relative",
                borderRadius: 16,
                padding: "18px 20px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 18,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: C.primary,
                    boxShadow: "0 0 0 3px rgba(85,102,230,.14)",
                    animation: "obpulse 1.6s infinite",
                  }}
                />
                <span style={{ fontSize: 14.5, fontWeight: 680, color: C.ink }}>
                  直播执行实时盘
                </span>
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  · 经营汇总
                </span>
                {cnt(scopedTasks, isLive) > 0 ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.ok,
                      background: C.okBg,
                      borderRadius: 6,
                      padding: "2px 7px",
                      marginLeft: 2,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: C.ok,
                      }}
                    />
                    {cnt(scopedTasks, isLive)} 场直播中
                  </span>
                ) : null}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.muted }}>
                  {updatedLabel}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${bizCols.length},1fr)`,
                }}
              >
                {bizCols.map((c, i) => (
                  <div
                    key={c.key}
                    style={{
                      padding: "0 18px",
                      paddingLeft: i === 0 ? 0 : 18,
                      borderLeft: i === 0 ? "none" : `1px solid ${C.divider}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        color: C.muted,
                        marginBottom: 9,
                      }}
                    >
                      {c.label}
                    </div>
                    <div
                      style={{
                        fontSize: 27,
                        fontWeight: 720,
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: 0,
                        lineHeight: 1,
                        display: "flex",
                        alignItems: "baseline",
                        gap: 1,
                        color: C.ink,
                      }}
                    >
                      {c.value}
                      {c.unit ? (
                        <span
                          style={{
                            fontSize: 15,
                            color: "#a3a8b4",
                            fontWeight: 600,
                            marginLeft: 2,
                          }}
                        >
                          {c.unit}
                        </span>
                      ) : null}
                    </div>
                    {c.hint ? (
                      <div
                        style={{ fontSize: 11.5, marginTop: 8, color: C.muted }}
                      >
                        {c.hint}
                      </div>
                    ) : (
                      <div style={{ height: 8 }} />
                    )}
                    {c.series ? (
                      <AreaSpark
                        series={c.series}
                        color={c.color}
                        gid={`biz-${c.key}`}
                        testId="live-kpi-sparkline"
                      />
                    ) : (
                      <div style={{ height: 45 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 进行中项目 + 准入通过率 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: passRate != null ? "1.4fr 1fr" : "1fr",
              gap: 16,
            }}
          >
            <div
              className="ob-project-card"
              style={{
                background:
                  "linear-gradient(135deg,#374475 0%,#4a4e82 52%,#665b83 100%)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 16,
                padding: "19px 20px",
                color: "#fff",
                position: "relative",
                overflow: "hidden",
                boxShadow:
                  "0 1px 2px rgba(15,23,42,.12),0 22px 42px -30px rgba(58,54,104,.68),inset 0 1px 0 rgba(255,255,255,.13)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: 0.94,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3 3 8l9 5 9-5-9-5Z" />
                    <path d="m3 16 9 5 9-5" />
                  </svg>
                  进行中项目
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 16,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    fontSize: 44,
                    fontWeight: 760,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    letterSpacing: 0,
                    textShadow: "0 2px 10px rgba(30,26,70,.3)",
                  }}
                >
                  {proj.total}
                </span>
                <span style={{ fontSize: 14, opacity: 0.82 }}>个</span>
              </div>
              <div style={{ display: "flex", gap: 8, position: "relative" }}>
                <div
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,.12)",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {proj.running}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    进行中
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,.12)",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {proj.pending}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                    待报数
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    background:
                      "linear-gradient(135deg,rgba(224,168,46,.22),rgba(181,121,10,.12))",
                    borderRadius: 11,
                    padding: "10px 12px",
                    boxShadow: "inset 0 0 0 1px rgba(224,168,46,.2)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {proj.abnormal}
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#e0a82e",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.9, marginTop: 4 }}>
                    异常
                  </div>
                </div>
              </div>
            </div>
            {passRate != null ? (
              <div
                className="card ob-panel-card lift"
                style={{
                  borderRadius: 16,
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 2,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.ink3 }}>
                    准入通过率
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.muted,
                      background: "#f4f5f8",
                      borderRadius: 6,
                      padding: "2px 7px",
                    }}
                  >
                    录屏→入项
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 7,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 31,
                      fontWeight: 730,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: 0,
                      color: C.ink,
                    }}
                  >
                    {passRate}
                    <span
                      style={{ fontSize: 17, color: C.muted, fontWeight: 600 }}
                    >
                      %
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "flex-end",
                    marginTop: 6,
                    minHeight: 78,
                  }}
                >
                  {passSeries && passSeries.length >= 2 ? (
                    <AreaSpark
                      series={passSeries}
                      color={C.primary}
                      w={420}
                      h={64}
                      gid="passrate"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* 准入漏斗 */}
          {admission?.stages?.length ? (
            <div
              className="card ob-panel-card lift"
              style={{
                borderRadius: 16,
                padding: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "18px 20px 14px",
                  borderBottom: `1px solid ${C.divider2}`,
                  background:
                    "linear-gradient(180deg,rgba(247,249,253,.92) 0%,rgba(255,255,255,.72) 100%)",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 680, color: C.ink }}>
                  {admission.title || "准入漏斗 · 录屏到入项"}
                </div>
                <div style={{ flex: 1 }} />
                {passRate != null ? (
                  <div style={{ fontSize: 12, color: C.muted }}>
                    整体转化{" "}
                    <span
                      style={{
                        color: C.ok,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 13.5,
                        background: C.okBg,
                        border: "1px solid rgba(14,138,77,.16)",
                        borderRadius: 999,
                        padding: "3px 8px",
                      }}
                    >
                      {passRate}%
                    </span>
                  </div>
                ) : null}
              </div>
              <AdmissionFunnelModel admission={admission} />

            </div>
          ) : null}

          {d.emptyState ? (
            <div
              style={{
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 800,
                  color: C.ink,
                  marginBottom: 8,
                }}
              >
                {d.emptyState.title}
              </div>
              <div style={{ fontSize: 13, color: C.muted }}>
                {d.emptyState.hint}
              </div>
            </div>
          ) : null}
        </section>

        {/* ===== 中：个人面板 ===== */}
        <aside className="ob-personal">
          <PersonalPanel
            user={currentUser}
            scopeLabel={profile.scopeLabel}
            periodLabel={period}
            summary={personal.summary}
            recos={personal.recos}
            todos={personal.todos}
            go={go}
          />
        </aside>

        {/* ===== 右：AI 助手 ===== */}
        <aside className="ob-ai">
          <AiPanel user={currentUser} projects={scopedProjects} go={go} />
        </aside>
      </div>

      <RiskDrawer
        open={drawer}
        risks={risks}
        onClose={() => setDrawer(false)}
        go={go}
      />
    </div>
  );
}

export default OverviewBoard;
