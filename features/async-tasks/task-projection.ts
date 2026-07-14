import type {
  AsyncTaskDto,
  AsyncTaskStatus,
  AsyncTaskType,
} from "./contracts";
import { normalizeTaskPriority } from "./contracts";

type SourceType = AsyncTaskDto["source"]["type"];

type TaskRow = {
  [key: string]: unknown;
};

const NORMALIZED_STATUSES = new Set<AsyncTaskStatus>([
  "queued",
  "running",
  "needs_confirmation",
  "succeeded",
  "failed",
  "cancelled",
]);

export function projectOcrTask(row: TaskRow): AsyncTaskDto {
  const payload = objectValue(row.payload);
  const liveReportId = stringValue(payload.liveReportId);

  if (liveReportId === null) {
    throw new Error("Invalid OCR task source: missing liveReportId");
  }

  return projectTask(row, {
    type: "ocr",
    status: normalizeOcrStatus(row.status),
    sourceType: "live_report",
    sourceId: liveReportId,
  });
}

export function projectRecordingTask(row: TaskRow): AsyncTaskDto {
  const assetId = stringValue(row.asset_id);

  if (assetId === null) {
    throw new Error("Invalid recording task source: missing asset_id");
  }

  return projectTask(row, {
    type: "recording_ai",
    status: normalizeRecordingStatus(row.status),
    sourceType: "recording_asset",
    sourceId: assetId,
  });
}

export function projectSettlementSimulationTask(row: TaskRow): AsyncTaskDto {
  const payload = objectValue(row.payload);
  const draftId = stringValue(payload.draftId) ?? stringValue(payload.draft_id);

  if (draftId === null) {
    throw new Error("Invalid settlement simulation task source: missing draftId");
  }

  return projectTask(row, {
    type: "settlement_simulation",
    status: normalizeTaskStatus(row.status),
    sourceType: "settlement_rule",
    sourceId: draftId,
  });
}

function projectTask(
  row: TaskRow,
  options: {
    type: AsyncTaskType;
    status: AsyncTaskStatus;
    sourceType: SourceType;
    sourceId: string;
  },
): AsyncTaskDto {
  return {
    id: requiredString(row.id, "id"),
    type: options.type,
    status: options.status,
    stage: requiredString(row.stage, "stage"),
    priority: normalizeTaskPriority(row.priority),
    attempt: requiredNumber(row.attempt, "attempt"),
    maxAttempts: requiredNumber(row.max_attempts, "max_attempts"),
    requestedBy: stringValue(row.requested_by),
    source: { type: options.sourceType, id: options.sourceId },
    nextRunAt: nullableString(row.run_after, "run_after"),
    startedAt: nullableString(row.started_at, "started_at"),
    completedAt: nullableString(row.completed_at, "completed_at"),
    error: projectError(row),
    queue: null,
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

function normalizeOcrStatus(status: unknown): AsyncTaskStatus {
  if (status === "pending") {
    return "queued";
  }
  if (status === "processing") {
    return "running";
  }
  if (status === "needs_review") {
    return "needs_confirmation";
  }

  return normalizeTaskStatus(status);
}

function normalizeRecordingStatus(status: unknown): AsyncTaskStatus {
  if (status === "completed") {
    return "succeeded";
  }

  return normalizeTaskStatus(status);
}

function normalizeTaskStatus(status: unknown): AsyncTaskStatus {
  if (
    typeof status === "string" &&
    NORMALIZED_STATUSES.has(status as AsyncTaskStatus)
  ) {
    return status as AsyncTaskStatus;
  }

  throw new Error(`Invalid async task status: ${String(status)}`);
}

function projectError(
  row: TaskRow,
): { code: string; message: string } | null {
  const code = stringValue(row.error_code);

  if (code === null) {
    return null;
  }

  return {
    code,
    message:
      stringValue(row.error_summary) ??
      stringValue(row.error_message) ??
      "Task failed. See internal logs for details.",
  };
}

function objectValue(value: unknown): TaskRow {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as TaskRow;
  }

  return {};
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = stringValue(value);

  if (parsed === null) {
    throw new Error(`Invalid async task row: missing ${fieldName}`);
  }

  return parsed;
}

function nullableString(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requiredString(value, fieldName);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function requiredNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid async task row: missing ${fieldName}`);
  }

  return value;
}
