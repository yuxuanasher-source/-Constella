import { describe, expect, it } from "vitest";

import {
  acquireMaintenanceExecutionLease,
  appendTaskEvent,
  claimScheduledRun,
  claimScheduledRunItems,
  completeScheduledRunItem,
  ensureScheduledRun,
  finalizeScheduledRun,
  findOldestIncompleteScheduledRun,
  heartbeatWorker,
  listTaskEventsAfter,
  markWorkerStopped,
  reconcileExpiredScheduledJobWork,
  releaseMaintenanceExecutionLease,
  renewMaintenanceExecutionLease,
  renewScheduledRunItemLease,
  renewScheduledRunLease,
  type AsyncTaskRuntimeClient,
} from "./repository";

type DbResponse = { data: unknown; error: null | { message?: string } };

class FakeQuery {
  readonly filters: Array<[string, string, unknown]> = [];
  readonly orders: Array<[string, Record<string, unknown> | undefined]> = [];
  readonly limits: number[] = [];
  selectColumns: string | undefined;
  payload: unknown;
  conflict: Record<string, unknown> | undefined;

  constructor(
    readonly table: string,
    readonly operation: string,
    private readonly response: DbResponse,
  ) {}

  select(columns = "*") {
    this.selectColumns = columns;
    return this;
  }

  single() {
    return this;
  }

  maybeSingle() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(["eq", column, value]);
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push(["gt", column, value]);
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.orders.push([column, options]);
    return this;
  }

  limit(value: number) {
    this.limits.push(value);
    return this;
  }

  then<TResult1 = DbResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: DbResponse) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ) {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

class FakeTable {
  constructor(
    private readonly client: FakeClient,
    private readonly table: string,
  ) {}

  insert(payload: unknown) {
    return this.client.queueQuery(this.table, "insert", payload);
  }

  select(columns = "*") {
    const query = this.client.queueQuery(this.table, "select", undefined);
    query.select(columns);
    return query;
  }

  upsert(payload: unknown, conflict?: Record<string, unknown>) {
    const query = this.client.queueQuery(this.table, "upsert", payload);
    query.conflict = conflict;
    return query;
  }

  update(payload: unknown) {
    return this.client.queueQuery(this.table, "update", payload);
  }
}

class FakeClient implements AsyncTaskRuntimeClient {
  readonly queries: FakeQuery[] = [];
  readonly rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  private responses: DbResponse[];

  constructor(responses: DbResponse[]) {
    this.responses = [...responses];
  }

  from(table: string) {
    return new FakeTable(this, table);
  }

  rpc(name: string, params: Record<string, unknown>) {
    this.rpcs.push({ name, params });
    return Promise.resolve(this.nextResponse());
  }

  queueQuery(table: string, operation: string, payload: unknown) {
    const query = new FakeQuery(table, operation, this.nextResponse());
    query.payload = payload;
    this.queries.push(query);
    return query;
  }

  private nextResponse() {
    const response = this.responses.shift();
    if (!response) {
      throw new Error("No fake response queued");
    }
    return response;
  }
}

const ok = (data: unknown): DbResponse => ({ data, error: null });
const fail = (message: string): DbResponse => ({ data: null, error: { message } });

describe("async task runtime repository", () => {
  it("appends organization-scoped task events and fails closed on insert errors", async () => {
    const client = new FakeClient([ok(null), fail("event write failed")]);

    await appendTaskEvent(client, {
      organizationId: "org-1",
      taskType: "ocr",
      taskId: "task-1",
      status: "running",
      stage: "ocr.processing",
      attempt: 2,
      workerId: "worker-1",
      errorCode: null,
      metadata: { page: 1 },
    });

    expect(client.queries[0]).toMatchObject({
      table: "async_task_events",
      operation: "insert",
      payload: {
        organization_id: "org-1",
        task_type: "ocr",
        task_id: "task-1",
        status: "running",
        stage: "ocr.processing",
        attempt: 2,
        worker_id: "worker-1",
        error_code: null,
        metadata: { page: 1 },
      },
    });

    await expect(
      appendTaskEvent(client, {
        organizationId: "org-1",
        taskType: "ocr",
        taskId: "task-1",
        status: "failed",
        stage: "ocr.failed",
        attempt: 2,
        errorCode: "boom",
      }),
    ).rejects.toThrow("event write failed");
  });

  it("lists organization-scoped events after a cursor and maps DTO fields", async () => {
    const client = new FakeClient([
      ok([
        {
          id: 42,
          task_type: "ocr",
          task_id: "task-1",
          status: "succeeded",
          stage: "done",
          attempt: 1,
          error_code: null,
          created_at: "2026-07-14T01:00:00.000Z",
        },
      ]),
    ]);

    await expect(
      listTaskEventsAfter(client, {
        organizationId: "org-1",
        afterId: 41,
        limit: 10,
      }),
    ).resolves.toEqual([
      {
        id: 42,
        taskType: "ocr",
        taskId: "task-1",
        status: "succeeded",
        stage: "done",
        attempt: 1,
        errorCode: null,
        createdAt: "2026-07-14T01:00:00.000Z",
      },
    ]);

    expect(client.queries[0].filters).toEqual([
      ["eq", "organization_id", "org-1"],
      ["gt", "id", 41],
    ]);
    expect(client.queries[0].orders).toEqual([["id", { ascending: true }]]);
    expect(client.queries[0].limits).toEqual([10]);
  });

  it("heartbeats workers without writing desired_state and returns persisted desired_state", async () => {
    const client = new FakeClient([ok({ desired_state: "paused" })]);

    await expect(
      heartbeatWorker(client, {
        workerId: "worker-1",
        workerType: "maintenance",
        hostName: "host-a",
        appVersion: "sha-1",
        status: "running",
        currentJobs: 2,
        concurrencyLimit: 4,
        protectionState: "normal",
        lastHeartbeatAt: "2026-07-14T01:00:00.000Z",
        metadata: { pid: 123 },
      }),
    ).resolves.toBe("paused");

    expect(client.queries[0]).toMatchObject({
      table: "worker_instances",
      operation: "upsert",
      conflict: { onConflict: "worker_id" },
    });
    expect(client.queries[0].payload).toEqual({
      worker_id: "worker-1",
      worker_type: "maintenance",
      host_name: "host-a",
      app_version: "sha-1",
      status: "running",
      current_jobs: 2,
      concurrency_limit: 4,
      protection_state: "normal",
      last_heartbeat_at: "2026-07-14T01:00:00.000Z",
      metadata: { pid: 123 },
    });
    expect(JSON.stringify(client.queries[0].payload)).not.toContain(
      "desired_state",
    );
  });

  it("marks workers stopped and rethrows database errors", async () => {
    const client = new FakeClient([fail("stop failed")]);

    await expect(
      markWorkerStopped(client, "worker-1", "2026-07-14T01:00:00.000Z"),
    ).rejects.toThrow("stop failed");

    expect(client.queries[0]).toMatchObject({
      table: "worker_instances",
      operation: "update",
      payload: {
        status: "stopped",
        stopped_at: "2026-07-14T01:00:00.000Z",
      },
    });
    expect(client.queries[0].filters).toEqual([["eq", "worker_id", "worker-1"]]);
  });

  it("ensures scheduled runs through RPC and returns run status without claiming ownership", async () => {
    const client = new FakeClient([
      ok({
        id: "run-1",
        status: "queued",
      }),
    ]);

    await expect(
      ensureScheduledRun(client, {
        jobKey: "settlement.simulate_large_sample",
        scheduledFor: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toEqual({ runId: "run-1", status: "queued" });

    expect(client.rpcs).toEqual([
      {
        name: "ensure_scheduled_job_run",
        params: {
          p_job_key: "settlement.simulate_large_sample",
          p_scheduled_for: "2026-07-14T01:00:00.000Z",
        },
      },
    ]);
  });

  it("acquires the global maintenance lease and returns false on no match", async () => {
    const client = new FakeClient([ok(false)]);

    await expect(
      acquireMaintenanceExecutionLease(client, {
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toBe(false);

    expect(client.rpcs[0]).toEqual({
      name: "acquire_maintenance_execution_lease",
      params: {
        p_worker_id: "worker-1",
        p_lease_seconds: 120,
        p_now: "2026-07-14T01:00:00.000Z",
      },
    });
  });

  it("claims scheduled runs only through RPC and reports terminal/no-lease/stale-resume states", async () => {
    const client = new FakeClient([
      ok(null),
      ok({ id: "run-1", status: "failed", claimed_by: "worker-1" }),
      ok({
        id: "run-1",
        status: "running",
        claimed_by: "worker-1",
        attempt: 2,
      }),
    ]);

    await expect(
      claimScheduledRun(client, {
        runId: "run-1",
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toEqual({
      claimed: false,
      runId: "run-1",
      resumed: false,
      status: "queued",
    });

    await expect(
      claimScheduledRun(client, {
        runId: "run-1",
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toEqual({
      claimed: false,
      runId: "run-1",
      resumed: false,
      status: "failed",
    });

    await expect(
      claimScheduledRun(client, {
        runId: "run-1",
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toEqual({
      claimed: true,
      runId: "run-1",
      resumed: true,
      status: "running",
    });

    expect(client.rpcs.map((rpc) => rpc.name)).toEqual([
      "claim_scheduled_job_run",
      "claim_scheduled_job_run",
      "claim_scheduled_job_run",
    ]);
    expect(client.queries).toHaveLength(0);
  });

  it("finds oldest incomplete scheduled run and maps snake_case fields", async () => {
    const client = new FakeClient([
      ok({
        id: "run-1",
        scheduled_for: "2026-07-14T01:00:00.000Z",
      }),
    ]);

    await expect(
      findOldestIncompleteScheduledRun(
        client,
        "settlement.simulate_large_sample",
      ),
    ).resolves.toEqual({
      runId: "run-1",
      scheduledFor: "2026-07-14T01:00:00.000Z",
    });
  });

  it("claims scheduled run items and preserves succeeded items from fake RPC responses unchanged", async () => {
    const succeededItem = {
      run_id: "run-1",
      organization_id: "org-done",
      status: "succeeded",
      claimed_by: "worker-old",
      lease_expires_at: null,
      attempt: 1,
      max_attempts: 3,
      started_at: "2026-07-14T00:00:00.000Z",
      completed_at: "2026-07-14T00:01:00.000Z",
      error_code: null,
      result: { preserved: true },
    };
    const client = new FakeClient([
      ok([
        succeededItem,
        {
          run_id: "run-1",
          organization_id: "org-2",
          status: "running",
          claimed_by: "worker-1",
          lease_expires_at: "2026-07-14T01:02:00.000Z",
          attempt: 2,
          max_attempts: 3,
          started_at: "2026-07-14T01:00:00.000Z",
          completed_at: null,
          error_code: null,
          result: {},
        },
      ]),
    ]);

    await expect(
      claimScheduledRunItems(client, {
        runId: "run-1",
        workerId: "worker-1",
        limit: 20,
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toEqual([
      {
        runId: "run-1",
        organizationId: "org-done",
        status: "succeeded",
        claimedBy: "worker-old",
        leaseExpiresAt: null,
        attempt: 1,
        maxAttempts: 3,
        startedAt: "2026-07-14T00:00:00.000Z",
        completedAt: "2026-07-14T00:01:00.000Z",
        errorCode: null,
        result: { preserved: true },
      },
      {
        runId: "run-1",
        organizationId: "org-2",
        status: "running",
        claimedBy: "worker-1",
        leaseExpiresAt: "2026-07-14T01:02:00.000Z",
        attempt: 2,
        maxAttempts: 3,
        startedAt: "2026-07-14T01:00:00.000Z",
        completedAt: null,
        errorCode: null,
        result: {},
      },
    ]);

    expect(client.rpcs).toHaveLength(1);
    expect(client.queries).toHaveLength(0);
  });

  it("renews leases, completes items, finalizes runs, reconciles work, and handles maintenance lease lifecycle with RPCs", async () => {
    const client = new FakeClient([
      ok(true),
      ok(false),
      ok(true),
      ok({ status: "succeeded", result: { total: 1 } }),
      ok({
        failed_item_ids: ["item-1"],
        finalized_run_ids: ["run-1"],
      }),
      ok(true),
      ok(true),
    ]);

    await expect(
      renewScheduledRunLease(client, {
        runId: "run-1",
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      renewScheduledRunItemLease(client, {
        runId: "run-1",
        organizationId: "org-1",
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      completeScheduledRunItem(client, {
        runId: "run-1",
        organizationId: "org-1",
        workerId: "worker-1",
        status: "succeeded",
        errorCode: null,
        result: { ok: true },
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      finalizeScheduledRun(client, {
        runId: "run-1",
        workerId: "worker-1",
      }),
    ).resolves.toEqual({ status: "succeeded", result: { total: 1 } });
    await expect(
      reconcileExpiredScheduledJobWork(client, {
        now: "2026-07-14T01:00:00.000Z",
        limit: 50,
      }),
    ).resolves.toEqual({
      failedItemIds: ["item-1"],
      finalizedRunIds: ["run-1"],
    });
    await expect(
      renewMaintenanceExecutionLease(client, {
        workerId: "worker-1",
        leaseSeconds: 120,
        now: "2026-07-14T01:00:00.000Z",
      }),
    ).resolves.toBe(true);
    await expect(
      releaseMaintenanceExecutionLease(client, {
        workerId: "worker-1",
      }),
    ).resolves.toBeUndefined();

    expect(client.rpcs.map((rpc) => rpc.name)).toEqual([
      "renew_scheduled_job_run_lease",
      "renew_scheduled_job_run_item_lease",
      "complete_scheduled_job_run_item",
      "finalize_scheduled_job_run",
      "reconcile_expired_scheduled_job_work",
      "renew_maintenance_execution_lease",
      "release_maintenance_execution_lease",
    ]);
  });

  it("rethrows every database error instead of converting unknown errors into duplicate or skip states", async () => {
    const functions = [
      () =>
        listTaskEventsAfter(new FakeClient([fail("list failed")]), {
          organizationId: "org-1",
          afterId: 1,
          limit: 10,
        }),
      () =>
        heartbeatWorker(new FakeClient([fail("heartbeat failed")]), {
          workerId: "worker-1",
          workerType: "maintenance",
          hostName: "host-a",
          status: "running",
          currentJobs: 0,
          concurrencyLimit: 1,
          protectionState: "normal",
          lastHeartbeatAt: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        ensureScheduledRun(new FakeClient([fail("ensure failed")]), {
          jobKey: "settlement.simulate_large_sample",
          scheduledFor: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        claimScheduledRun(new FakeClient([fail("claim failed")]), {
          runId: "run-1",
          workerId: "worker-1",
          leaseSeconds: 120,
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        findOldestIncompleteScheduledRun(
          new FakeClient([fail("find failed")]),
          "settlement.simulate_large_sample",
        ),
      () =>
        claimScheduledRunItems(new FakeClient([fail("item claim failed")]), {
          runId: "run-1",
          workerId: "worker-1",
          limit: 20,
          leaseSeconds: 120,
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        renewScheduledRunLease(new FakeClient([fail("renew run failed")]), {
          runId: "run-1",
          workerId: "worker-1",
          leaseSeconds: 120,
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        renewScheduledRunItemLease(new FakeClient([fail("renew item failed")]), {
          runId: "run-1",
          organizationId: "org-1",
          workerId: "worker-1",
          leaseSeconds: 120,
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        completeScheduledRunItem(new FakeClient([fail("complete failed")]), {
          runId: "run-1",
          organizationId: "org-1",
          workerId: "worker-1",
          status: "failed",
          errorCode: "boom",
          result: {},
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        finalizeScheduledRun(new FakeClient([fail("finalize failed")]), {
          runId: "run-1",
          workerId: "worker-1",
        }),
      () =>
        reconcileExpiredScheduledJobWork(
          new FakeClient([fail("reconcile failed")]),
          {
            now: "2026-07-14T01:00:00.000Z",
            limit: 50,
          },
        ),
      () =>
        acquireMaintenanceExecutionLease(
          new FakeClient([fail("acquire failed")]),
          {
            workerId: "worker-1",
            leaseSeconds: 120,
            now: "2026-07-14T01:00:00.000Z",
          },
        ),
      () =>
        renewMaintenanceExecutionLease(new FakeClient([fail("renew failed")]), {
          workerId: "worker-1",
          leaseSeconds: 120,
          now: "2026-07-14T01:00:00.000Z",
        }),
      () =>
        releaseMaintenanceExecutionLease(new FakeClient([fail("release failed")]), {
          workerId: "worker-1",
        }),
    ];

    for (const run of functions) {
      await expect(run()).rejects.toThrow("failed");
    }
  });
});
