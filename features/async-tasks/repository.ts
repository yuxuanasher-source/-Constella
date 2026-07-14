import type {
  AsyncTaskEventDto,
  AsyncTaskStatus,
  AsyncTaskType,
  WorkerDesiredState,
} from "./contracts";

type DbError = { message?: string } | null;
type DbResult<T> = { data: T; error: DbError };

type QueryResult = PromiseLike<DbResult<unknown>> & {
  select(columns?: string): QueryResult;
  single(): QueryResult;
  maybeSingle(): QueryResult;
  eq(column: string, value: unknown): QueryResult;
  gt(column: string, value: unknown): QueryResult;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): QueryResult;
  limit(value: number): QueryResult;
};

type TableQuery = {
  insert(payload: unknown): QueryResult;
  select(columns?: string): QueryResult;
  upsert(
    payload: unknown,
    options?: { onConflict?: string },
  ): QueryResult;
  update(payload: unknown): QueryResult;
};

export type AsyncTaskRuntimeClient = {
  from(table: string): TableQuery;
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<DbResult<unknown>>;
};

export type AppendTaskEventInput = {
  organizationId: string;
  taskType: AsyncTaskType;
  taskId: string;
  status: AsyncTaskStatus;
  stage: string;
  attempt: number;
  workerId?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
};

export type WorkerHeartbeatInput = {
  workerId: string;
  workerType:
    | "ocr"
    | "recording_ai"
    | "settlement_simulation"
    | "maintenance"
    | "watchdog";
  hostName: string;
  appVersion?: string | null;
  status: "starting" | "running" | "paused" | "draining" | "stopped";
  currentJobs: number;
  concurrencyLimit: number;
  protectionState: "normal" | "cpu_high" | "memory_high" | "disk_high";
  lastHeartbeatAt?: string;
  metadata?: Record<string, unknown>;
};

export type ScheduledJobKey = string;
type ScheduledRunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
type ScheduledTerminalStatus = "succeeded" | "failed" | "skipped";

export type EnsureScheduledRunInput = {
  jobKey: ScheduledJobKey;
  scheduledFor: string;
};

export type ClaimScheduledRunInput = {
  runId: string;
  workerId: string;
  leaseSeconds: number;
  now: string;
};

export type ClaimScheduledRunItemsInput = {
  runId: string;
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now: string;
};

export type ScheduledRunItem = {
  runId: string;
  organizationId: string;
  status: ScheduledRunStatus;
  claimedBy: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  result: Record<string, unknown>;
};

export type RenewScheduledRunLeaseInput = {
  runId: string;
  workerId: string;
  leaseSeconds: number;
  now: string;
};

export type RenewScheduledRunItemLeaseInput = RenewScheduledRunLeaseInput & {
  organizationId: string;
};

export type CompleteScheduledRunItemInput = {
  runId: string;
  organizationId: string;
  workerId: string;
  status: ScheduledTerminalStatus;
  errorCode: string | null;
  result: Record<string, unknown>;
  now: string;
};

export type MaintenanceLeaseInput = {
  workerId: string;
  leaseSeconds: number;
  now: string;
};

type Row = Record<string, unknown>;

const SCHEDULED_STATUSES = new Set<ScheduledRunStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

const SCHEDULED_TERMINAL_STATUSES = new Set<ScheduledRunStatus>([
  "succeeded",
  "failed",
  "skipped",
]);

export async function appendTaskEvent(
  client: AsyncTaskRuntimeClient,
  event: AppendTaskEventInput,
): Promise<void> {
  await requireNoDataError(
    client.from("async_task_events").insert({
      organization_id: event.organizationId,
      task_type: event.taskType,
      task_id: event.taskId,
      status: event.status,
      stage: event.stage,
      attempt: event.attempt,
      worker_id: event.workerId ?? null,
      error_code: event.errorCode ?? null,
      metadata: event.metadata ?? {},
    }),
    "event write failed",
  );
}

export async function listTaskEventsAfter(
  client: AsyncTaskRuntimeClient,
  input: { organizationId: string; afterId: number; limit: number },
): Promise<AsyncTaskEventDto[]> {
  const rows = await requireData(
    client
      .from("async_task_events")
      .select(
        "id, task_type, task_id, status, stage, attempt, error_code, created_at",
      )
      .eq("organization_id", input.organizationId)
      .gt("id", input.afterId)
      .order("id", { ascending: true })
      .limit(input.limit),
    "list task events failed",
  );

  if (!Array.isArray(rows)) {
    throw new Error("Invalid task event rows");
  }

  return rows.map(mapTaskEventRow);
}

export async function heartbeatWorker(
  client: AsyncTaskRuntimeClient,
  input: WorkerHeartbeatInput,
): Promise<WorkerDesiredState> {
  const row = await requireData(
    client
      .from("worker_instances")
      .upsert(
        {
          worker_id: input.workerId,
          worker_type: input.workerType,
          host_name: input.hostName,
          app_version: input.appVersion ?? null,
          status: input.status,
          current_jobs: input.currentJobs,
          concurrency_limit: input.concurrencyLimit,
          protection_state: input.protectionState,
          last_heartbeat_at: input.lastHeartbeatAt ?? new Date().toISOString(),
          metadata: input.metadata ?? {},
        },
        { onConflict: "worker_id" },
      )
      .select("desired_state")
      .single(),
    "worker heartbeat failed",
  );

  return parseWorkerDesiredState(asRow(row, "worker heartbeat"));
}

export async function markWorkerStopped(
  client: AsyncTaskRuntimeClient,
  workerId: string,
  stoppedAt: string,
): Promise<void> {
  await requireNoDataError(
    client
      .from("worker_instances")
      .update({ status: "stopped", stopped_at: stoppedAt })
      .eq("worker_id", workerId),
    "mark worker stopped failed",
  );
}

export async function ensureScheduledRun(
  client: AsyncTaskRuntimeClient,
  input: EnsureScheduledRunInput,
): Promise<{ runId: string; status: ScheduledRunStatus }> {
  const data = await requireData(
    client.rpc("ensure_scheduled_job_run", {
      p_job_key: input.jobKey,
      p_scheduled_for: input.scheduledFor,
    }),
    "ensure scheduled run failed",
  );

  if (typeof data === "string") {
    const row = await requireData(
      client
        .from("scheduled_job_runs")
        .select("id, status")
        .eq("id", data)
        .single(),
      "load ensured scheduled run failed",
    );
    return {
      runId: requiredString(asRow(row, "scheduled run").id, "id"),
      status: parseScheduledRunStatus(asRow(row, "scheduled run").status),
    };
  }

  const row = asRow(data, "scheduled run");
  return {
    runId: requiredString(row.id ?? row.run_id, "id"),
    status: parseScheduledRunStatus(row.status),
  };
}

export async function claimScheduledRun(
  client: AsyncTaskRuntimeClient,
  input: ClaimScheduledRunInput,
): Promise<{
  claimed: boolean;
  runId: string;
  resumed: boolean;
  status: ScheduledRunStatus;
}> {
  const data = await requireData(
    client.rpc("claim_scheduled_job_run", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "claim scheduled run failed",
  );

  if (data === null) {
    return {
      claimed: false,
      runId: input.runId,
      resumed: false,
      status: "queued",
    };
  }

  const row = asRow(data, "claimed scheduled run");
  const status = parseScheduledRunStatus(row.status);
  const claimedBy = stringValue(row.claimed_by);
  const claimed =
    status === "running" &&
    claimedBy === input.workerId &&
    !SCHEDULED_TERMINAL_STATUSES.has(status);

  return {
    claimed,
    runId: requiredString(row.id ?? row.run_id, "id"),
    resumed: claimed && numberValue(row.attempt) > 1,
    status,
  };
}

export async function findOldestIncompleteScheduledRun(
  client: AsyncTaskRuntimeClient,
  jobKey: ScheduledJobKey,
): Promise<{ runId: string; scheduledFor: string } | null> {
  const data = await requireData(
    client.rpc("find_oldest_incomplete_scheduled_job_run", {
      p_job_key: jobKey,
    }),
    "find oldest incomplete scheduled run failed",
  );

  if (data === null) {
    return null;
  }

  if (typeof data === "string") {
    const row = await requireData(
      client
        .from("scheduled_job_runs")
        .select("id, scheduled_for")
        .eq("id", data)
        .single(),
      "load oldest incomplete scheduled run failed",
    );
    return mapOldestRunRow(asRow(row, "oldest scheduled run"));
  }

  return mapOldestRunRow(asRow(data, "oldest scheduled run"));
}

export async function claimScheduledRunItems(
  client: AsyncTaskRuntimeClient,
  input: ClaimScheduledRunItemsInput,
): Promise<ScheduledRunItem[]> {
  const rows = await requireData(
    client.rpc("claim_scheduled_job_run_items", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "claim scheduled run items failed",
  );

  if (!Array.isArray(rows)) {
    throw new Error("Invalid scheduled run item rows");
  }

  return rows.map((row) => mapScheduledRunItem(asRow(row, "scheduled item")));
}

export async function renewScheduledRunLease(
  client: AsyncTaskRuntimeClient,
  input: RenewScheduledRunLeaseInput,
): Promise<boolean> {
  return requireBooleanRpc(
    client.rpc("renew_scheduled_job_run_lease", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "renew scheduled run lease failed",
  );
}

export async function renewScheduledRunItemLease(
  client: AsyncTaskRuntimeClient,
  input: RenewScheduledRunItemLeaseInput,
): Promise<boolean> {
  return requireBooleanRpc(
    client.rpc("renew_scheduled_job_run_item_lease", {
      p_run_id: input.runId,
      p_organization_id: input.organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "renew scheduled run item lease failed",
  );
}

export async function completeScheduledRunItem(
  client: AsyncTaskRuntimeClient,
  input: CompleteScheduledRunItemInput,
): Promise<void> {
  const completed = await requireBooleanRpc(
    client.rpc("complete_scheduled_job_run_item", {
      p_run_id: input.runId,
      p_organization_id: input.organizationId,
      p_worker_id: input.workerId,
      p_status: input.status,
      p_error_code: input.errorCode,
      p_result: input.result,
      p_now: input.now,
    }),
    "complete scheduled run item failed",
  );

  if (!completed) {
    throw new Error("complete scheduled run item failed");
  }
}

export async function finalizeScheduledRun(
  client: AsyncTaskRuntimeClient,
  input: { runId: string; workerId: string },
): Promise<{ status: ScheduledTerminalStatus; result: Record<string, unknown> }> {
  const row = await requireData(
    client.rpc("finalize_scheduled_job_run", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
    }),
    "finalize scheduled run failed",
  );

  const parsed = asRow(row, "finalized scheduled run");
  const status = parseScheduledRunStatus(parsed.status);
  if (!SCHEDULED_TERMINAL_STATUSES.has(status)) {
    throw new Error("Scheduled run is not finalized");
  }

  return {
    status: status as ScheduledTerminalStatus,
    result: objectRecord(parsed.result),
  };
}

export async function reconcileExpiredScheduledJobWork(
  client: AsyncTaskRuntimeClient,
  input: { now: string; limit: number },
): Promise<{ failedItemIds: string[]; finalizedRunIds: string[] }> {
  const data = await requireData(
    client.rpc("reconcile_expired_scheduled_job_work", {
      p_now: input.now,
      p_limit: input.limit,
    }),
    "reconcile expired scheduled job work failed",
  );

  const row = asSingleRpcRow(data, "reconciled scheduled work");
  return {
    failedItemIds: requiredStringArray(row.failed_item_ids, "failed_item_ids"),
    finalizedRunIds: requiredStringArray(row.finalized_run_ids, "finalized_run_ids"),
  };
}

export async function acquireMaintenanceExecutionLease(
  client: AsyncTaskRuntimeClient,
  input: MaintenanceLeaseInput,
): Promise<boolean> {
  return requireBooleanRpc(
    client.rpc("acquire_maintenance_execution_lease", {
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "acquire maintenance execution lease failed",
  );
}

export async function renewMaintenanceExecutionLease(
  client: AsyncTaskRuntimeClient,
  input: MaintenanceLeaseInput,
): Promise<boolean> {
  return requireBooleanRpc(
    client.rpc("renew_maintenance_execution_lease", {
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_now: input.now,
    }),
    "renew maintenance execution lease failed",
  );
}

export async function releaseMaintenanceExecutionLease(
  client: AsyncTaskRuntimeClient,
  input: { workerId: string },
): Promise<void> {
  await requireNoDataError(
    client.rpc("release_maintenance_execution_lease", {
      p_worker_id: input.workerId,
    }),
    "release maintenance execution lease failed",
  );
}

async function requireBooleanRpc(
  promise: PromiseLike<DbResult<unknown>>,
  fallbackMessage: string,
): Promise<boolean> {
  const data = await requireData(promise, fallbackMessage);
  if (typeof data !== "boolean") {
    throw new Error(fallbackMessage);
  }
  return data;
}

async function requireNoDataError(
  promise: PromiseLike<DbResult<unknown>>,
  fallbackMessage: string,
): Promise<void> {
  const { error } = await promise;
  if (error) {
    throw new Error(error.message ?? fallbackMessage);
  }
}

async function requireData<T>(
  promise: PromiseLike<DbResult<T>>,
  fallbackMessage: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(error.message ?? fallbackMessage);
  }
  return data;
}

function mapTaskEventRow(row: unknown): AsyncTaskEventDto {
  const parsed = asRow(row, "task event");
  return {
    id: requiredNumber(parsed.id, "id"),
    taskType: requiredString(parsed.task_type, "task_type") as AsyncTaskType,
    taskId: requiredString(parsed.task_id, "task_id"),
    status: requiredString(parsed.status, "status") as AsyncTaskStatus,
    stage: requiredString(parsed.stage, "stage"),
    attempt: requiredNumber(parsed.attempt, "attempt"),
    errorCode: nullableString(parsed.error_code, "error_code"),
    createdAt: requiredString(parsed.created_at, "created_at"),
  };
}

function mapOldestRunRow(row: Row): { runId: string; scheduledFor: string } {
  return {
    runId: requiredString(row.id ?? row.run_id, "id"),
    scheduledFor: requiredString(row.scheduled_for, "scheduled_for"),
  };
}

function mapScheduledRunItem(row: Row): ScheduledRunItem {
  return {
    runId: requiredString(row.run_id, "run_id"),
    organizationId: requiredString(row.organization_id, "organization_id"),
    status: parseScheduledRunStatus(row.status),
    claimedBy: nullableString(row.claimed_by, "claimed_by"),
    leaseExpiresAt: nullableString(row.lease_expires_at, "lease_expires_at"),
    attempt: requiredNumber(row.attempt, "attempt"),
    maxAttempts: requiredNumber(row.max_attempts, "max_attempts"),
    startedAt: nullableString(row.started_at, "started_at"),
    completedAt: nullableString(row.completed_at, "completed_at"),
    errorCode: nullableString(row.error_code, "error_code"),
    result: objectRecord(row.result),
  };
}

function parseWorkerDesiredState(row: Row): WorkerDesiredState {
  if (
    row.desired_state === "running" ||
    row.desired_state === "paused" ||
    row.desired_state === "draining"
  ) {
    return row.desired_state;
  }

  throw new Error("Invalid worker desired state");
}

function parseScheduledRunStatus(value: unknown): ScheduledRunStatus {
  if (typeof value === "string" && SCHEDULED_STATUSES.has(value as ScheduledRunStatus)) {
    return value as ScheduledRunStatus;
  }

  throw new Error("Invalid scheduled run status");
}

function asRow(value: unknown, label: string): Row {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Row;
  }

  throw new Error(`Invalid ${label} row`);
}

function asSingleRpcRow(value: unknown, label: string): Row {
  if (Array.isArray(value)) {
    if (value.length === 1) {
      return asRow(value[0], label);
    }
    throw new Error(`Invalid ${label} row`);
  }

  return asRow(value, label);
}

function requiredString(value: unknown, field: string): string {
  const parsed = stringValue(value);
  if (parsed === null) {
    throw new Error(`Missing required field: ${field}`);
  }
  return parsed;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requiredString(value, field);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return value;
  }

  throw new Error(`Missing required field: ${field}`);
}
