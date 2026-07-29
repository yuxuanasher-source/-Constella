import type {
  OpsLiveReportQueueItem,
  OpsLiveTaskQueueItem,
  StreamerTaskCard,
} from "./live-operations-queries";

type StreamerReferenceTaskStatus =
  | "pending_live"
  | "missed_live"
  | "live"
  | "pending_report"
  | "pending_review"
  | "approved"
  | "rejected"
  | "trial"
  | "completed";

export type StreamerReferenceTask = {
  id: string;
  date: string;
  dateStr: string;
  project: string;
  projectName: string;
  vendor: string;
  start: string;
  end: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  durationPlan: number;
  status: StreamerReferenceTaskStatus;
  needStartStop: boolean;
  needScreening: boolean;
  note: string;
  settleHint: string;
  reportedDuration?: number;
  reportedAudience?: number;
  systemDuration?: number;
};

export type OpsReferenceTask = {
  id: string;
  streamerId: string;
  streamerName: string;
  dayIdx: number;
  startHour: number;
  endHour: number;
  project: string;
  projectName: string;
  name: string;
  type: OpsLiveTaskQueueItem["taskType"];
  status: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  plannedDuration?: number | null;
  systemDuration?: number;
  anomaly?: string;
};

export type OpsReferenceReport = {
  id: string;
  date: string;
  streamer: string;
  streamerId: string;
  project: string;
  taskId: string;
  duration: number;
  systemDurationHours: number;
  ocrDurationHours: number | null;
  divergencePct: number | null;
  audience: number;
  status: string;
  screens: number;
  source: "OCR" | "manual";
  riskFlags: string[];
  screenshotUploadedAt: string | null;
  screenshotFileHash: string | null;
  note: string;
};

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function toStreamerReferenceTask(
  task: StreamerTaskCard,
  options: { now?: string } = {},
): StreamerReferenceTask {
  const start = parseDate(task.plannedStartAt);
  const end = parseDate(task.plannedEndAt);
  const now = options.now ? new Date(options.now) : new Date();
  const baseStatus = toReferenceTaskStatus(task.status);
  const status =
    baseStatus === "pending_live" && hasPlannedWindowEnded(end, now)
      ? "missed_live"
      : baseStatus;

  return {
    id: task.id,
    date: relativeDateLabel(start, now),
    dateStr: formatDateLabel(start),
    project: task.projectName,
    projectName: task.projectName,
    vendor: "经营舱",
    start: formatClock(start),
    end: formatClock(end),
    plannedStartAt: task.plannedStartAt,
    plannedEndAt: task.plannedEndAt,
    durationPlan: minutesToHours(
      task.plannedDuration ?? differenceMinutes(start, end),
    ),
    status,
    needStartStop: true,
    needScreening: true,
    note: streamerReferenceTaskNote(status),
    settleHint: "CPT · 审核后入池",
    reportedDuration:
      status === "pending_review" || status === "approved"
        ? minutesToHours(task.systemDuration)
        : undefined,
    systemDuration: task.systemDuration,
  };
}

export function toOpsReferenceTask(
  task: OpsLiveTaskQueueItem,
): OpsReferenceTask {
  const start = parseDate(task.plannedStartAt);
  const end = parseDate(task.plannedEndAt);

  return {
    id: task.id,
    streamerId: task.streamerId,
    streamerName: task.streamerName,
    dayIdx: dayIndex(start),
    startHour: decimalHour(start),
    endHour: decimalHour(end),
    project: task.projectId ?? task.projectName,
    projectName: task.projectName,
    name: task.title,
    type: task.taskType ?? "project",
    status: toOpsReferenceTaskStatus(task.status),
    plannedStartAt: task.plannedStartAt,
    plannedEndAt: task.plannedEndAt,
    plannedDuration: task.plannedDuration,
    systemDuration: task.systemDuration,
    anomaly: toReferenceAnomalyType(task.anomalyFlags, task.status),
  };
}

const ANOMALY_FLAG_MAP: Record<string, string> = {
  no_stop_48h: "unstopped",
  no_stop: "unstopped",
  unstopped: "unstopped",
  report_overdue: "late_report",
  late_report: "late_report",
  no_start: "unstart",
  unstart: "unstart",
  short_duration: "short",
  short: "short",
  schedule_conflict: "conflict",
  conflict: "conflict",
};

function toReferenceAnomalyType(
  flags: string[] | undefined,
  status: string,
): string | undefined {
  for (const flag of flags ?? []) {
    const mapped = ANOMALY_FLAG_MAP[flag];
    if (mapped) {
      return mapped;
    }
  }
  if ((flags ?? []).length > 0 || status === "abnormal") {
    return "unstopped";
  }
  return undefined;
}

export function toOpsReferenceReport(
  report: OpsLiveReportQueueItem,
): OpsReferenceReport {
  return {
    id: report.id,
    date: report.submittedAt.slice(0, 10),
    streamer: report.streamerName,
    streamerId: report.streamerId || report.streamerName,
    project: report.projectName,
    taskId: report.taskId || report.taskTitle,
    duration: minutesToHours(report.settlementDuration ?? 0),
    systemDurationHours: minutesToHours(report.systemDuration ?? 0),
    ocrDurationHours:
      report.screenshotDuration != null
        ? minutesToHours(report.screenshotDuration)
        : null,
    divergencePct: report.divergencePct ?? null,
    audience: report.viewers ?? 0,
    status: reportStatusToReference(report.status),
    screens: 1,
    source: report.timeSource === "claimed" ? "manual" : "OCR",
    riskFlags: report.riskFlags ?? [],
    screenshotUploadedAt: report.screenshotUploadedAt ?? null,
    screenshotFileHash: report.screenshotFileHash ?? null,
    note: `${report.timeSource ?? "unknown"} · ${report.evidenceLevel ?? "unknown"}`,
  };
}

function streamerReferenceTaskNote(
  status: StreamerReferenceTaskStatus,
): string {
  if (status === "pending_review") {
    return "运营审核中，预计 24 小时内出结果";
  }

  if (status === "missed_live") {
    return "计划窗口已结束，系统未记录开播，请联系运营补充未直播原因。";
  }

  return "";
}

function toReferenceTaskStatus(status: string): StreamerReferenceTaskStatus {
  const map: Record<string, StreamerReferenceTaskStatus> = {
    pending_live: "pending_live",
    live: "live",
    pending_report: "pending_report",
    report_pending_review: "pending_review",
    report_approved: "approved",
    completed: "completed",
    report_rejected: "rejected",
    cancelled: "rejected",
    abnormal: "rejected",
  };

  return map[status] ?? "pending_live";
}

function hasPlannedWindowEnded(end: Date | null, now: Date): boolean {
  return (
    !!end &&
    !Number.isNaN(end.getTime()) &&
    !Number.isNaN(now.getTime()) &&
    now.getTime() > end.getTime()
  );
}

function toOpsReferenceTaskStatus(status: string): string {
  const map: Record<string, string> = {
    pending_live: "pending_live",
    live: "live",
    pending_report: "pending_report",
    report_pending_review: "pending_review",
    report_approved: "approved",
    completed: "completed",
    report_rejected: "rejected",
    cancelled: "cancelled",
    abnormal: "abnormal",
  };

  return map[status] ?? "pending_live";
}

function reportStatusToReference(status: string): string {
  if (status === "pending_adjudication") {
    return "pending_review";
  }

  if (status === "need_more") {
    return "need_supply";
  }

  return status;
}

function parseDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function formatClock(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatDateLabel(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) {
    return "未排期";
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";

  return `${month}-${day} ${weekday}`;
}

function relativeDateLabel(date: Date | null, now: Date): string {
  if (!date || Number.isNaN(date.getTime())) {
    return "未排期";
  }

  const dateKey = localDateKey(date);
  const nowKey = localDateKey(now);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  if (dateKey === nowKey) {
    return "今天";
  }

  if (dateKey === localDateKey(tomorrow)) {
    return "明天";
  }

  return formatDateLabel(date);
}

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function differenceMinutes(start: Date | null, end: Date | null): number {
  if (
    !start ||
    !end ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return 0;
  }

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function dayIndex(date: Date | null): number {
  if (!date || Number.isNaN(date.getTime())) {
    return 0;
  }

  const localWeekday = weekdayLabels.indexOf(
    new Intl.DateTimeFormat("zh-CN", {
      weekday: "short",
      timeZone: "Asia/Shanghai",
    }).format(date),
  );

  return localWeekday <= 0 ? 6 : localWeekday - 1;
}

function decimalHour(date: Date | null): number {
  if (!date || Number.isNaN(date.getTime())) {
    return 0;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );

  return hour + minute / 60;
}
