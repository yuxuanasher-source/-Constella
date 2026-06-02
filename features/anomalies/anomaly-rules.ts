export type AnomalyType =
  | "not_started"
  | "not_reported"
  | "report_overdue"
  | "missing_checkout_screenshot"
  | "live_over_48h";

export type DetectedAnomaly = {
  type: AnomalyType;
  objectType: "live_task" | "live_report";
  objectId: string;
  severity: "warning" | "danger";
};

export type AnomalyTaskSnapshot = {
  id: string;
  status: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  system_started_at: string | null;
  system_stopped_at: string | null;
  has_report: boolean;
  has_checkout_screenshot: boolean;
};

const fortyEightHoursMs = 48 * 60 * 60 * 1000;
const reportGraceMs = 2 * 60 * 60 * 1000;

export function detectTaskAnomalies({
  now,
  task,
}: {
  now: string;
  task: AnomalyTaskSnapshot;
}): DetectedAnomaly[] {
  const nowMs = Date.parse(now);
  const anomalies: DetectedAnomaly[] = [];

  if (
    task.status === "pending_live" &&
    task.planned_start_at &&
    nowMs > Date.parse(task.planned_start_at) &&
    !task.system_started_at
  ) {
    anomalies.push({
      type: "not_started",
      objectType: "live_task",
      objectId: task.id,
      severity: "warning",
    });
  }

  if (
    isPostLiveStatus(task.status) &&
    task.planned_end_at &&
    nowMs > Date.parse(task.planned_end_at) &&
    !task.has_report
  ) {
    anomalies.push({
      type: "not_reported",
      objectType: "live_task",
      objectId: task.id,
      severity: "warning",
    });
  }

  if (
    task.status === "pending_report" &&
    task.planned_end_at &&
    nowMs - Date.parse(task.planned_end_at) > reportGraceMs &&
    !task.has_report
  ) {
    anomalies.push({
      type: "report_overdue",
      objectType: "live_task",
      objectId: task.id,
      severity: "warning",
    });
  }

  if (
    isPostLiveStatus(task.status) &&
    task.system_stopped_at &&
    !task.has_checkout_screenshot
  ) {
    anomalies.push({
      type: "missing_checkout_screenshot",
      objectType: "live_task",
      objectId: task.id,
      severity: "warning",
    });
  }

  if (
    task.status === "live" &&
    task.system_started_at &&
    nowMs - Date.parse(task.system_started_at) > fortyEightHoursMs
  ) {
    anomalies.push({
      type: "live_over_48h",
      objectType: "live_task",
      objectId: task.id,
      severity: "danger",
    });
  }

  return anomalies;
}

function isPostLiveStatus(status: string): boolean {
  return (
    status === "pending_report" ||
    status === "report_pending_review" ||
    status === "report_approved" ||
    status === "completed"
  );
}
