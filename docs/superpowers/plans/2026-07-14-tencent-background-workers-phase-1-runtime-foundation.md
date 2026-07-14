# Tencent Background Workers Phase 1 Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable PostgreSQL task metadata, event ledger, worker heartbeat registry, scheduled-run idempotency, and shared TypeScript contracts required by Tencent-hosted workers.

**Architecture:** Keep `background_jobs` and `recording_ai_analyses` as their domain sources of truth, with large settlement simulations represented as a new `background_jobs` type whose append-only result remains in `settlement_formula_simulations`. Add equivalent runtime columns, append-only task events, worker instance heartbeats, and resumable scheduled-run identities; expose them through a focused `features/async-tasks` module without changing execution yet.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript, Supabase JS, Vitest, Zod-style explicit parsing without a new runtime dependency.

---

## Dependency And Scope

Read first: `docs/superpowers/specs/2026-07-14-tencent-postgres-background-workers-design.md`.

This phase is additive. It must not start Worker daemons, disable inline kicks, alter GitHub schedules, or change user-visible pages. Existing OCR and recording routes must continue to pass unchanged.

## File Map

- Create: `supabase/migrations/20260714100000_async_task_runtime_foundation.sql` — additive runtime columns, task events, Worker instances, and scheduled-run records.
- Create: `lib/db/async-task-schema-contract.test.ts` — static migration and privilege contract.
- Create: `features/async-tasks/contracts.ts` — shared task, event, Worker, and scheduled-run DTOs.
- Create: `features/async-tasks/contracts.test.ts` — normalization and state-machine contracts.
- Create: `features/async-tasks/repository.ts` — append/read events, write heartbeats, and separately ensure/claim scheduled runs.
- Create: `features/async-tasks/repository.test.ts` — repository query and fail-closed tests.
- Create: `features/async-tasks/task-projection.ts` — normalize OCR, recording, and settlement simulation rows into `AsyncTaskDto`.
- Create: `features/async-tasks/task-projection.test.ts` — status/stage/error projection tests.
- Modify: `package.json` — add a focused `test:async-tasks` command.

### Task 1: Lock The Database Contract

**Files:**
- Create: `lib/db/async-task-schema-contract.test.ts`
- Test: `lib/db/async-task-schema-contract.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260714100000_async_task_runtime_foundation.sql",
  ),
  "utf8",
).toLowerCase();

describe("async task runtime schema", () => {
  it("adds equivalent runtime metadata to OCR and recording tasks", () => {
    for (const column of [
      "stage",
      "priority",
      "run_after",
      "lease_expires_at",
      "started_at",
      "idempotency_key",
      "error_code",
      "cancel_requested_at",
      "desired_state",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("alter table public.background_jobs");
    expect(sql).toContain("alter table public.recording_ai_analyses");
    expect(sql).toContain("settlement.simulate_large_sample");
    expect(sql).toContain("'settlement_simulation'");
  });

  it("creates append-only events, worker heartbeats, and scheduled run keys", () => {
    expect(sql).toContain("create table public.async_task_events");
    expect(sql).toContain("create table public.worker_instances");
    expect(sql).toContain("create table public.scheduled_job_runs");
    expect(sql).toContain("create table public.scheduled_job_run_items");
    expect(sql).toContain("create table public.maintenance_execution_leases");
    expect(sql).toContain("create table public.async_task_queue_controls");
    expect(sql).toContain("create table public.provider_circuit_breakers");
    expect(sql).toContain("unique (job_key, scheduled_for)");
    expect(sql).toContain("create or replace function public.ensure_scheduled_job_run");
    expect(sql).toContain("create or replace function public.claim_scheduled_job_run");
    expect(sql).toContain("create or replace function public.claim_scheduled_job_run_items");
    expect(sql).toContain("create or replace function public.reconcile_expired_scheduled_job_work");
  });

  it("keeps runtime tables service-role write only", () => {
    expect(sql).toContain(
      "grant select, insert on table public.async_task_events to service_role",
    );
    expect(sql).not.toContain(
      "grant select, insert, update on table public.async_task_events",
    );
    for (const table of [
      "worker_instances",
      "scheduled_job_runs",
      "scheduled_job_run_items",
    ]) {
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated`,
      );
      expect(sql).toContain(
        `grant select, insert, update on table public.${table} to service_role`,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `pnpm vitest run lib/db/async-task-schema-contract.test.ts`

Expected: FAIL because `20260714100000_async_task_runtime_foundation.sql` does not exist.

- [ ] **Step 3: Commit only after Task 2 has supplied the migration**

Do not commit a permanently red test. Continue directly to Task 2.

### Task 2: Add The Additive Runtime Migration

**Files:**
- Create: `supabase/migrations/20260714100000_async_task_runtime_foundation.sql`
- Test: `lib/db/async-task-schema-contract.test.ts`

- [ ] **Step 1: Create the runtime migration**

Use additive columns so existing rows and routes remain valid. The migration must include this shape:

```sql
alter type public.recording_ai_analysis_status
  add value if not exists 'needs_confirmation';
alter type public.recording_ai_analysis_status
  add value if not exists 'cancelled';

alter table public.background_jobs
  add column if not exists requested_by uuid references public.profiles(id),
  add column if not exists stage text not null default 'queued',
  add column if not exists priority smallint not null default 1,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists cancel_requested_at timestamptz;

alter table public.background_jobs
  drop constraint if exists background_jobs_known_type;
alter table public.background_jobs
  add constraint background_jobs_known_type check (
    job_type in (
      'ocr.extract_live_report',
      'ai.replay',
      'insight.scan',
      'settlement.simulate_large_sample'
    )
  );

alter table public.recording_ai_analyses
  add column if not exists stage text not null default 'queued',
  add column if not exists priority smallint not null default 1,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists cancel_requested_at timestamptz;

alter table public.background_jobs
  add constraint background_jobs_priority_range
  check (priority between 0 and 3) not valid;
alter table public.background_jobs
  validate constraint background_jobs_priority_range;

alter table public.recording_ai_analyses
  add constraint recording_ai_priority_range
  check (priority between 0 and 3) not valid;
alter table public.recording_ai_analyses
  validate constraint recording_ai_priority_range;

create unique index if not exists background_jobs_idempotency_uidx
  on public.background_jobs (organization_id, job_type, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists recording_ai_idempotency_uidx
  on public.recording_ai_analyses (organization_id, asset_id, idempotency_key)
  where idempotency_key is not null;

create table public.async_task_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_type text not null,
  task_id uuid not null,
  status text not null,
  stage text not null,
  attempt integer not null default 0 check (attempt >= 0),
  worker_id text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index async_task_events_task_idx
  on public.async_task_events (organization_id, task_type, task_id, id);
create index async_task_events_cursor_idx
  on public.async_task_events (organization_id, id);
create unique index async_task_events_terminal_attempt_uidx
  on public.async_task_events (task_type, task_id, attempt, status)
  where status in ('needs_confirmation', 'succeeded', 'failed', 'cancelled');

create table public.worker_instances (
  worker_id text primary key,
  worker_type text not null check (worker_type in ('ocr', 'recording_ai', 'settlement_simulation', 'maintenance', 'watchdog')),
  host_name text not null,
  app_version text not null,
  status text not null default 'starting' check (status in ('starting', 'running', 'paused', 'draining', 'stopped')),
  desired_state text not null default 'running' check (desired_state in ('running', 'paused', 'draining')),
  current_jobs integer not null default 0 check (current_jobs >= 0),
  concurrency_limit integer not null check (concurrency_limit > 0),
  protection_state text not null default 'normal' check (protection_state in ('normal', 'cpu_high', 'memory_high', 'disk_high')),
  last_heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.scheduled_job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  claimed_by text,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  result jsonb not null default '{}'::jsonb,
  unique (job_key, scheduled_for)
);

create table public.scheduled_job_run_items (
  run_id uuid not null references public.scheduled_job_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  claimed_by text,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  result jsonb not null default '{}'::jsonb,
  primary key (run_id, organization_id)
);

create index scheduled_job_runs_incomplete_idx
  on public.scheduled_job_runs (job_key, scheduled_for)
  where status in ('queued', 'running');

create table public.maintenance_execution_leases (
  lease_key text primary key check (lease_key = 'global'),
  claimed_by text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.async_task_queue_controls (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_type text not null check (task_type in ('ocr', 'recording_ai', 'settlement_simulation')),
  desired_state text not null default 'running' check (desired_state in ('running', 'paused')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, task_type)
);

create table public.provider_circuit_breakers (
  provider_key text primary key,
  state text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_until timestamptz,
  probe_worker_id text,
  probe_lease_expires_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);

alter table public.async_task_events enable row level security;
alter table public.worker_instances enable row level security;
alter table public.scheduled_job_runs enable row level security;
alter table public.scheduled_job_run_items enable row level security;
alter table public.maintenance_execution_leases enable row level security;
alter table public.async_task_queue_controls enable row level security;
alter table public.provider_circuit_breakers enable row level security;

create policy async_task_queue_controls_staff_read
on public.async_task_queue_controls for select
using (public.is_org_member(organization_id) and public.is_mcn_staff(organization_id));

create policy async_task_queue_controls_manager_write
on public.async_task_queue_controls for all
using (
  public.is_org_member(organization_id)
  and public.current_user_role(organization_id) in ('owner', 'ops_manager')
)
with check (
  public.is_org_member(organization_id)
  and public.current_user_role(organization_id) in ('owner', 'ops_manager')
);

revoke all on table public.async_task_events from public, anon, authenticated;
revoke all on table public.worker_instances from public, anon, authenticated;
revoke all on table public.scheduled_job_runs from public, anon, authenticated;
revoke all on table public.scheduled_job_run_items from public, anon, authenticated;
revoke all on table public.maintenance_execution_leases from public, anon, authenticated;
grant select, insert on table public.async_task_events to service_role;
grant select, insert, update on table public.worker_instances to service_role;
grant select, insert, update on table public.scheduled_job_runs to service_role;
grant select, insert, update on table public.scheduled_job_run_items to service_role;
grant select, insert, update, delete on table public.maintenance_execution_leases to service_role;
grant select, insert, update on table public.async_task_queue_controls to authenticated, service_role;
revoke all on table public.provider_circuit_breakers from public, anon, authenticated;
grant select, insert, update on table public.provider_circuit_breakers to service_role;
grant usage, select on sequence public.async_task_events_id_seq to service_role;
```

In the same migration, add service-role-only transactional functions:

- `ensure_scheduled_job_run(job_key, scheduled_for)` inserts a missing deterministic slot in `queued`, returns an existing slot unchanged, and snapshots currently active organizations into `scheduled_job_run_items` with `on conflict do nothing`. It never writes a parent lease.
- `claim_scheduled_job_run(run_id, worker_id, lease_seconds, now)` verifies inside SQL that the same Worker owns an unexpired global maintenance lease. It then locks the parent slot, claims `queued` or stale `running` by incrementing attempt and replacing the lease, and leaves terminal, unexpired foreign-owned, or no-global-lease slots unchanged. The SQL contract includes this ownership predicate so call ordering cannot be bypassed accidentally.
- `find_oldest_incomplete_scheduled_job_run(job_key)` returns only the oldest queued/running slot identity for that key so an `auto` restart resumes persisted work before deriving a new calendar slot.
- `claim_scheduled_job_run_items(run_id, worker_id, limit, lease_seconds, now)` claims queued or stale items with `FOR UPDATE SKIP LOCKED`.
- `renew_scheduled_job_run_lease(run_id, worker_id, lease_seconds, now)` and the item equivalent renew only matching owners.
- `complete_scheduled_job_run_item(...)` records one organization's terminal result idempotently.
- `finalize_scheduled_job_run(run_id, worker_id, now)` succeeds only when every item is terminal and derives the aggregate status/result from item rows.
- `reconcile_expired_scheduled_job_work(now, limit)` atomically marks stale items whose `attempt >= max_attempts` failed with `worker_lease_exhausted`, leaves retryable stale items claimable, and finalizes any now-complete parent run. The parent run attempt is telemetry and does not cap crash recovery; organization item attempts are the bounded business execution attempts.
- `acquire_maintenance_execution_lease(worker_id, lease_seconds, now)`, renew, and release functions serialize all maintenance job keys through one renewable global slot. Acquisition can replace only an expired lease; release requires the same owner.

Revoke all function execution from `public`, `anon`, and `authenticated`; grant only to `service_role`. Contract tests must require stale-lease predicates, row locking, attempt bounds, and item snapshot idempotency.

Before adding named constraints, guard duplicate names with a `do $$ begin ... exception when duplicate_object then null; end $$;` block so reset and deployed migration paths are both deterministic.

- [ ] **Step 2: Run the focused schema contract**

Run: `pnpm vitest run lib/db/async-task-schema-contract.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 3: Run existing AI and global schema contracts**

Run: `pnpm vitest run lib/db/ai-schema-contract.test.ts lib/db/schema-contract.test.ts`

Expected: PASS with no changed expectations in existing migrations.

- [ ] **Step 4: Commit the schema foundation**

```bash
git add lib/db/async-task-schema-contract.test.ts supabase/migrations/20260714100000_async_task_runtime_foundation.sql
git commit -m "feat: add async task runtime schema"
```

### Task 3: Define Task Contracts And Projection

**Files:**
- Create: `features/async-tasks/contracts.ts`
- Create: `features/async-tasks/contracts.test.ts`
- Create: `features/async-tasks/task-projection.ts`
- Create: `features/async-tasks/task-projection.test.ts`

- [ ] **Step 1: Write failing contract and projection tests**

Test exact normalization, terminal-state rules, and error redaction:

```ts
import { describe, expect, it } from "vitest";
import { isTerminalTaskStatus } from "./contracts";
import { projectOcrTask, projectRecordingTask } from "./task-projection";

describe("async task projection", () => {
  it("projects OCR retries without exposing payload storage paths", () => {
    expect(projectOcrTask({
      id: "00000000-0000-4000-8000-000000000001",
      organization_id: "org-1",
      requested_by: "user-1",
      status: "queued",
      stage: "recognizing",
      attempt: 1,
      max_attempts: 3,
      run_after: "2026-07-14T10:00:00.000Z",
      payload: { liveReportId: "report-1", imagePath: "private/a.png" },
      created_at: "2026-07-14T09:59:00.000Z",
      updated_at: "2026-07-14T09:59:30.000Z",
    })).toMatchObject({
      type: "ocr",
      status: "queued",
      stage: "recognizing",
      source: { type: "live_report", id: "report-1" },
    });
  });

  it("maps recording success to a terminal task", () => {
    const task = projectRecordingTask({
      id: "00000000-0000-4000-8000-000000000002",
      organization_id: "org-1",
      requested_by: "user-1",
      asset_id: "asset-1",
      status: "succeeded",
      stage: "persisting",
      attempt: 1,
      max_attempts: 3,
      run_after: "2026-07-14T10:00:00.000Z",
      created_at: "2026-07-14T09:59:00.000Z",
      updated_at: "2026-07-14T10:01:00.000Z",
      completed_at: "2026-07-14T10:01:00.000Z",
    });
    expect(isTerminalTaskStatus(task.status)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `pnpm vitest run features/async-tasks/contracts.test.ts features/async-tasks/task-projection.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the shared contracts**

`contracts.ts` must export these stable names:

```ts
export type AsyncTaskType = "ocr" | "recording_ai" | "settlement_simulation";
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
  source: { type: "live_report" | "recording_asset" | "settlement_rule"; id: string };
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
```

`task-projection.ts` must normalize legacy OCR aliases (`pending`, `processing`, `needs_review`) and map only known source references: OCR `liveReportId`, recording `asset_id`, and settlement simulation `draftId`. Never copy arbitrary payload keys, frozen simulation evidence, or provider data into the DTO.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm vitest run features/async-tasks/contracts.test.ts features/async-tasks/task-projection.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit contracts and projection**

```bash
git add features/async-tasks/contracts.ts features/async-tasks/contracts.test.ts features/async-tasks/task-projection.ts features/async-tasks/task-projection.test.ts
git commit -m "feat: add async task projection contracts"
```

### Task 4: Add Event, Heartbeat, And Scheduled-Run Repositories

**Files:**
- Create: `features/async-tasks/repository.ts`
- Create: `features/async-tasks/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Cover four behaviors with an injected Supabase-shaped client:

```ts
it("appends a task event with organization scope", async () => {
  await appendTaskEvent(client, {
    organizationId: "org-1",
    taskType: "ocr",
    taskId: "00000000-0000-4000-8000-000000000001",
    status: "running",
    stage: "recognizing",
    attempt: 1,
    workerId: "ocr:host-a:1",
  });
  expect(inserts.async_task_events[0]).toMatchObject({
    organization_id: "org-1",
    task_type: "ocr",
    stage: "recognizing",
  });
});

it("upserts worker heartbeat without overwriting operator desired state", async () => {
  const state = await heartbeatWorker(client, {
    workerId: "ocr:host-a:1",
    workerType: "ocr",
    hostName: "host-a",
    appVersion: "abc123",
    status: "running",
    currentJobs: 1,
    concurrencyLimit: 3,
    protectionState: "normal",
  });
  expect(upserts.worker_instances[0]).toMatchObject({ worker_id: "ocr:host-a:1" });
  expect(upserts.worker_instances[0]).not.toHaveProperty("desired_state");
  expect(state).toBe("paused");
});

it("ensures queued, acquires the global lease, then claims the scheduled run", async () => {
  const slot = await ensureScheduledRun(client, {
    jobKey: "anomaly-scan",
    scheduledFor: "2026-07-14T10:00:00.000Z",
  });
  expect(slot.status).toBe("queued");
  await expect(acquireMaintenanceExecutionLease(client, {
    workerId: "maintenance:host-a:1",
    leaseSeconds: 120,
  })).resolves.toBe(true);
  const result = await claimScheduledRun(client, {
    runId: slot.runId,
    workerId: "maintenance:host-a:1",
    leaseSeconds: 120,
  });
  expect(result).toEqual({ claimed: true, runId: "run-1", resumed: false, status: "running" });
});

it("fails closed when event persistence fails", async () => {
  await expect(appendTaskEvent(failingClient, event)).rejects.toThrow("event write failed");
});

it("atomically fails an expired final-attempt schedule item", async () => {
  const result = await reconcileExpiredScheduledJobWork(client, { now, limit: 20 });
  expect(result.failedItemIds).toEqual(["item-at-max-attempts"]);
  expect(result.finalizedRunIds).toEqual(["run-now-complete"]);
});
```

Also test that `claimScheduledRun` returns `claimed: false` without a matching global lease, and that reclaiming a stale parent after lease acquisition keeps already succeeded organization items untouched.

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `pnpm vitest run features/async-tasks/repository.test.ts`

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement the repository API**

Export exactly:

```ts
export async function appendTaskEvent(client: AsyncTaskRuntimeClient, event: AppendTaskEventInput): Promise<void>;
export async function listTaskEventsAfter(client: AsyncTaskRuntimeClient, input: { organizationId: string; afterId: number; limit: number }): Promise<AsyncTaskEventDto[]>;
export async function heartbeatWorker(client: AsyncTaskRuntimeClient, input: WorkerHeartbeatInput): Promise<WorkerDesiredState>;
export async function markWorkerStopped(client: AsyncTaskRuntimeClient, workerId: string, stoppedAt: string): Promise<void>;
export async function ensureScheduledRun(client: AsyncTaskRuntimeClient, input: EnsureScheduledRunInput): Promise<{ runId: string; status: "queued" | "running" | "succeeded" | "failed" | "skipped" }>;
export async function claimScheduledRun(client: AsyncTaskRuntimeClient, input: ClaimScheduledRunInput): Promise<{ claimed: boolean; runId: string; resumed: boolean; status: "queued" | "running" | "succeeded" | "failed" | "skipped" }>;
export async function findOldestIncompleteScheduledRun(client: AsyncTaskRuntimeClient, jobKey: ScheduledJobKey): Promise<{ runId: string; scheduledFor: string } | null>;
export async function claimScheduledRunItems(client: AsyncTaskRuntimeClient, input: ClaimScheduledRunItemsInput): Promise<ScheduledRunItem[]>;
export async function renewScheduledRunLease(client: AsyncTaskRuntimeClient, input: RenewScheduledRunLeaseInput): Promise<boolean>;
export async function renewScheduledRunItemLease(client: AsyncTaskRuntimeClient, input: RenewScheduledRunItemLeaseInput): Promise<boolean>;
export async function completeScheduledRunItem(client: AsyncTaskRuntimeClient, input: CompleteScheduledRunItemInput): Promise<void>;
export async function finalizeScheduledRun(client: AsyncTaskRuntimeClient, input: { runId: string; workerId: string }): Promise<{ status: "succeeded" | "failed" | "skipped"; result: Record<string, unknown> }>;
export async function reconcileExpiredScheduledJobWork(client: AsyncTaskRuntimeClient, input: { now: string; limit: number }): Promise<{ failedItemIds: string[]; finalizedRunIds: string[] }>;
export async function acquireMaintenanceExecutionLease(client: AsyncTaskRuntimeClient, input: MaintenanceLeaseInput): Promise<boolean>;
export async function renewMaintenanceExecutionLease(client: AsyncTaskRuntimeClient, input: MaintenanceLeaseInput): Promise<boolean>;
export async function releaseMaintenanceExecutionLease(client: AsyncTaskRuntimeClient, input: { workerId: string }): Promise<void>;
```

Use `.upsert(..., { onConflict: "worker_id" })` for heartbeat, but never include `desired_state` in the heartbeat payload; select and return its persisted value after upsert. Scheduled-run methods call the transactional migration RPCs rather than reproducing claim logic in TypeScript. `ensureScheduledRun` never changes ownership; only `claimScheduledRun` can return `claimed: true`. A terminal duplicate returns `claimed: false`; a stale active slot returns `claimed: true, resumed: true`. Rethrow every database error and never convert an unknown failure into a duplicate/skip result.

- [ ] **Step 4: Run the repository and projection suite**

Run: `pnpm vitest run features/async-tasks`

Expected: PASS.

- [ ] **Step 5: Commit runtime repositories**

```bash
git add features/async-tasks/repository.ts features/async-tasks/repository.test.ts
git commit -m "feat: add async task runtime repositories"
```

### Task 5: Add The Focused Verification Command

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

```json
"test:async-tasks": "vitest run lib/db/async-task-schema-contract.test.ts features/async-tasks"
```

- [ ] **Step 2: Run Phase 1 verification**

Run:

```bash
pnpm test:async-tasks
pnpm vitest run lib/db/ai-schema-contract.test.ts lib/db/schema-contract.test.ts features/ai/ocr-jobs.test.ts features/recordings/recording-ai-analysis.test.ts
pnpm type-check
pnpm eslint features/async-tasks lib/db/async-task-schema-contract.test.ts
git diff --check
```

Expected: every command exits 0. Existing OCR and recording tests prove the additive foundation did not alter execution.

- [ ] **Step 3: Commit the verification script**

```bash
git add package.json
git commit -m "test: add async task verification command"
```

## Phase 1 Exit Gate

- The migration is additive and schema contracts pass.
- Existing OCR and recording execution tests remain green.
- Task projection never exposes raw payload storage fields.
- Event writes fail closed; heartbeat and scheduled-run reservations are idempotent.
- Scheduled slots and organization items have renewable leases, stale recovery, and exhausted-attempt reconciliation contracts.
- Operator pause/drain intent survives Worker heartbeats through `desired_state`.
- No Worker process, UI route, systemd unit, or GitHub workflow changed in this phase.
