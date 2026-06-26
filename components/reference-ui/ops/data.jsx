"use client";
/* eslint-disable */
import React, { useContext } from "react";

// ——— empty production defaults ——————————————————————————————————————————————

const ORG = { id: "", name: "未配置组织" };

const ROLES = {
  owner: "负责人",
  ops_manager: "运营负责人",
  operator_business: "次级运营",
  finance: "财务",
  streamer: "主播",
};

const CURRENT_USER = {
  id: "",
  name: "未登录用户",
  role: "owner",
  org: "",
  dept: "",
};

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
  notificationItems: null,
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

function useOpsNotifications() {
  const { notificationItems } = React.useContext(OpsLiveDataContext);
  return Array.isArray(notificationItems) ? notificationItems : [];
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
  const start = new Date(today);
  const day = today.getDay();
  const todayIdx = day === 0 ? 6 : day - 1;
  start.setDate(today.getDate() - todayIdx);
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const days = labels.map((label, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return {
      label,
      date: formatScheduleDate(current),
      today: index === todayIdx,
    };
  });
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end),
    todayIdx,
    days,
  };
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatScheduleDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// Tasks: each row = one streamer, with tasks placed by day.
// startHour / endHour are 0-24. status: 'completed' | 'live' | 'pending_report' | 'pending_review' | 'pending_live' | 'abnormal' | 'cancelled'
// project: project id
// type: 'project' | 'trial' | 'training' | 'temp'
const TASKS = [];

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

export {
  ORG,
  ROLES,
  CURRENT_USER,
  PROJECTS,
  PROJECT_STATUS,
  STREAMERS,
  REPORTS,
  REPORT_STATUS,
  OpsLiveDataContext,
  useOpsProjects,
  useOpsStreamers,
  useOpsApplications,
  useOpsTasks,
  useOpsReports,
  useOpsSettlementBatches,
  useOpsSettlementBatchDetails,
  useOpsSettlementPool,
  useOpsSettlementScope,
  useOpsAuditEntries,
  useOpsNotifications,
  useOpsLiveActions,
  BATCHES,
  BATCH_STATUS,
  BATCH_DETAIL_ITEMS,
  DEFAULT_MATCHING_ROWS,
  SUPPLIER_SCORES,
  WAR_ROOM_FALLBACK_PROJECT,
  WAR_ROOM_FALLBACK_STREAMERS,
  WAR_ROOM_FALLBACK_SUPPLIERS,
  ANOMALIES,
  AUDIT_LOG_RECENT,
  SCHEDULE_WEEK,
  formatDateKey,
  TASKS,
  TASK_STATUS,
  ANOMALY_TYPES,
};
