export type AsyncTaskType =
  | "ocr"
  | "recording_ai"
  | "settlement_simulation";

export type AsyncTaskStatus =
  | "queued"
  | "running"
  | "needs_confirmation"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AsyncTaskDto = {
  id: string;
  type: AsyncTaskType;
  status: AsyncTaskStatus;
  stage: string;
  priority: 0 | 1 | 2 | 3;
  attempt: number;
  maxAttempts: number;
  requestedBy: string | null;
  source: {
    type: "live_report" | "recording_asset" | "settlement_rule";
    id: string;
  };
  nextRunAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: { code: string; message: string } | null;
  queue: { ahead: number; expectedSecondsRange: [number, number] } | null;
  createdAt: string;
  updatedAt: string;
};

export type AsyncTaskEventDto = {
  id: number;
  taskType: AsyncTaskType;
  taskId: string;
  status: AsyncTaskStatus;
  stage: string;
  attempt: number;
  errorCode: string | null;
  createdAt: string;
};

export type WorkerDesiredState = "running" | "paused" | "draining";

export const TERMINAL_TASK_STATUSES = new Set<AsyncTaskStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

export function isTerminalTaskStatus(status: AsyncTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function normalizeTaskPriority(priority: unknown): 0 | 1 | 2 | 3 {
  if (
    typeof priority !== "number" ||
    !Number.isFinite(priority) ||
    !Number.isInteger(priority)
  ) {
    throw new Error("Invalid task priority");
  }

  if (priority <= 0) {
    return 0;
  }

  if (priority >= 3) {
    return 3;
  }

  return priority as 1 | 2;
}
