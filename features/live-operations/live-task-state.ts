export type LiveTaskStatus =
  | "pending_live"
  | "live"
  | "pending_report"
  | "report_pending_review"
  | "report_approved"
  | "completed"
  | "report_rejected"
  | "cancelled"
  | "abnormal";

const allowedTransitions: Record<LiveTaskStatus, LiveTaskStatus[]> = {
  pending_live: ["live", "cancelled", "abnormal"],
  live: ["pending_report", "cancelled", "abnormal"],
  pending_report: ["report_pending_review", "cancelled", "abnormal"],
  report_pending_review: ["report_approved", "report_rejected", "abnormal"],
  report_approved: ["completed"],
  completed: [],
  report_rejected: ["pending_report", "report_pending_review", "cancelled"],
  cancelled: [],
  abnormal: ["pending_live", "live", "pending_report", "cancelled"],
};

export function assertLiveTaskTransition(
  from: LiveTaskStatus,
  to: LiveTaskStatus,
): void {
  if (from === to) {
    return;
  }

  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid live task status transition: ${from} -> ${to}`);
  }
}

export function deriveSystemDurationMinutes({
  startedAt,
  stoppedAt,
}: {
  startedAt: string;
  stoppedAt: string;
}): number {
  const started = new Date(startedAt).getTime();
  const stopped = new Date(stoppedAt).getTime();

  if (!Number.isFinite(started) || !Number.isFinite(stopped)) {
    throw new Error("Invalid live timing timestamp");
  }

  if (stopped < started) {
    throw new Error("Live stop time cannot be earlier than start time");
  }

  return Math.floor((stopped - started) / 60_000);
}
