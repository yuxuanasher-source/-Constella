# Tencent Background Workers Phase 2 Workload Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run OCR, recording AI, large-sample settlement simulation, and scheduled maintenance through durable Tencent-hosted Worker processes with cross-organization atomic claims, leases, heartbeats, bounded concurrency, and graceful shutdown.

**Architecture:** Add service-role PostgreSQL claim RPCs that fairly select one candidate per organization before filling a batch. Keep Worker entrypoints thin; reusable execution, retry, lease, stage, and notification behavior lives in feature modules and is shared with the existing internal routes during migration.

**Tech Stack:** PostgreSQL `FOR UPDATE SKIP LOCKED`, TypeScript, `tsx`, Supabase JS, Node 20 process signals, Vitest, existing Tencent OCR/ASR/LLM providers.

---

## Dependency And Scope

Requires Phase 1 complete and green. Read:

- `docs/superpowers/specs/2026-07-14-tencent-postgres-background-workers-design.md`
- `docs/superpowers/plans/2026-07-14-tencent-background-workers-phase-1-runtime-foundation.md`

This phase starts Worker processes in development/test only. It must not install production systemd units, disable GitHub schedules, or remove the current internal runner routes and inline kicks.

## File Map

- Create: `supabase/migrations/20260714110000_async_task_worker_claims.sql` — fair cross-org claims, lease renewal, cancel request, and grants.
- Create: `lib/db/async-task-worker-claims-contract.test.ts` — SQL locking/fairness/privilege contract.
- Create: `features/async-tasks/worker-loop.ts` and `.test.ts` — bounded polling, heartbeat, drain, and backoff.
- Create: `features/async-tasks/resource-guard.ts` and `.test.ts` — CPU, memory, and temporary-disk claim protection.
- Create: `features/async-tasks/runtime-config.ts` and `.test.ts` — fail-closed global/per-workload enable and numeric configuration.
- Create: `features/async-tasks/provider-circuit-breaker.ts` and `.test.ts` — persisted provider outage protection.
- Create: `features/async-tasks/system-actor.ts` and `.test.ts` — non-impersonating system execution actor.
- Modify: `features/ai/contracts.ts`, `features/ai/invocation-ledger.ts`, `features/billing/usage-metering.ts` — permit a nullable human actor for system execution while preserving organization and role.
- Create: `features/ai/ocr-worker.ts` and `.test.ts` — OCR batch execution and stages.
- Modify: `features/ai/ocr-jobs.ts`, `features/ai/ocr-jobs.test.ts` — platform claim and renewable lease.
- Create: `features/recordings/recording-ai-worker.ts` and `.test.ts` — recording batch execution and stages.
- Modify: `features/recordings/recording-ai-analysis.ts`, `.test.ts`, `recording-ai-pipeline.ts` — platform claim, stage, cancellation, and lease.
- Create: `features/settlements/custom-rule-simulation-jobs.ts` and `.test.ts` — frozen simulation queue payloads and claims.
- Create: `features/settlements/custom-rule-simulation-worker.ts` and `.test.ts` — deterministic large-sample execution.
- Modify: `features/settlements/custom-rule-route-context.ts`, `.test.ts` — split simulation preparation from frozen execution.
- Modify: `app/api/projects/[projectId]/settlement-rules/simulate/route.ts`, `.test.ts` — 10-second-budget sync/async decision.
- Create: `features/background-jobs/maintenance-runner.ts` and `.test.ts` — domain-service dispatch for four scheduled jobs.
- Create: `scripts/workers/ocr-worker.ts`, `recording-ai-worker.ts`, `settlement-simulation-worker.ts`, `maintenance-job.ts`, `watchdog.ts` — thin process entrypoints.
- Modify: `app/api/internal/ocr/run/route.ts`, `app/api/internal/recording-ai/run/route.ts`, and route tests — call the same Worker services.
- Modify: `package.json`, `pnpm-lock.yaml` — add `tsx` and Worker scripts.

### Task 1: Build The Generic Worker Loop

**Files:**
- Create: `features/async-tasks/worker-loop.ts`
- Create: `features/async-tasks/worker-loop.test.ts`
- Create: `features/async-tasks/resource-guard.ts`
- Create: `features/async-tasks/resource-guard.test.ts`
- Create: `features/async-tasks/runtime-config.ts`
- Create: `features/async-tasks/runtime-config.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing loop tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { runWorkerLoop } from "./worker-loop";

describe("runWorkerLoop", () => {
  it("polls immediately, then waits after an empty batch", async () => {
    const runOnce = vi.fn().mockResolvedValueOnce(0).mockImplementation(() => {
      controller.abort();
      return Promise.resolve(0);
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();
    await runWorkerLoop({ runOnce, heartbeat: vi.fn().mockResolvedValue("running"), isEnabled: () => true, getCurrentJobs: () => 0, readProtectionState: vi.fn().mockResolvedValue("normal"), sleep, idleMs: 1_000, signal: controller.signal });
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000, controller.signal);
  });

  it("stops claiming when drain is requested", async () => {
    const controller = new AbortController();
    controller.abort();
    const runOnce = vi.fn();
    await runWorkerLoop({ runOnce, heartbeat: vi.fn().mockResolvedValue("draining"), isEnabled: () => true, getCurrentJobs: () => 0, readProtectionState: vi.fn().mockResolvedValue("normal"), sleep: vi.fn(), idleMs: 1_000, signal: controller.signal });
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("backs off after a failed claim without terminating the process", async () => {
    const controller = new AbortController();
    const runOnce = vi.fn()
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockImplementation(() => { controller.abort(); return Promise.resolve(0); });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await runWorkerLoop({ runOnce, heartbeat: vi.fn().mockResolvedValue("running"), isEnabled: () => true, getCurrentJobs: () => 0, readProtectionState: vi.fn().mockResolvedValue("normal"), sleep, idleMs: 1_000, errorBackoffMs: 5_000, signal: controller.signal });
    expect(sleep).toHaveBeenCalledWith(5_000, controller.signal);
  });
});

it("does not claim while resource protection is active", async () => {
  const controller = new AbortController();
  const runOnce = vi.fn();
  const heartbeat = vi.fn().mockImplementation(async () => {
    controller.abort();
    return "running" as const;
  });
  await runWorkerLoop({
    runOnce,
    heartbeat,
    isEnabled: () => true,
    getCurrentJobs: () => 0,
    readProtectionState: vi.fn().mockResolvedValue("disk_high"),
    sleep: vi.fn(),
    idleMs: 1_000,
    signal: controller.signal,
  });
  expect(runOnce).not.toHaveBeenCalled();
});
```

Add a fake-timer test where `runOnce` remains pending for 75 seconds. Heartbeats must still occur at 0, 30, and 60 seconds, and must report the injected current-job count instead of zero. Add resource-guard tests for CPU, memory, and temporary-disk thresholds, including the exact 80% disk boundary and a fail-closed `disk_high` result when the recording temporary directory cannot be inspected.

Add runtime-config tests proving only the exact string `true` enables `ASYNC_WORKERS_ENABLED`, missing/false/malformed values disable claims, per-workload OCR/recording/settlement/maintenance flags can further disable their own claims, numeric limits reject nonpositive or unbounded values, and the watchdog may remain active while workload claims are globally disabled.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm vitest run features/async-tasks/worker-loop.test.ts features/async-tasks/resource-guard.test.ts features/async-tasks/runtime-config.test.ts`

Expected: FAIL because `worker-loop.ts` does not exist.

- [ ] **Step 3: Implement the loop**

```ts
export type WorkerLoopOptions = {
  runOnce: () => Promise<number>;
  isEnabled: () => boolean;
  heartbeat: (status: "running" | "draining", currentJobs: number, protectionState: ResourceProtectionState) => Promise<"running" | "paused" | "draining">;
  getCurrentJobs: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  idleMs: number;
  heartbeatIntervalMs?: number;
  errorBackoffMs?: number;
  signal: AbortSignal;
  readProtectionState: () => Promise<ResourceProtectionState>;
};
```

Run heartbeat pumping independently from the claim/execution loop: send immediately and then every 30 seconds even while `runOnce` is pending. Prevent overlapping heartbeat calls, retain the last desired/protection state, and let `draining` stop only new claims while the current task reaches a safe checkpoint. A failed heartbeat is logged and retried on the next interval; it must not abort or duplicate the in-flight task. The production `sleep` and heartbeat pump both clear timers when the abort signal fires. Add a test that `paused` skips `runOnce` and continues heartbeats, while `draining` exits before a new claim.

Before every claim, require `isEnabled()` from the strict runtime config. Disabled Workers continue a `paused` heartbeat and sleep but never call a claim RPC. Entry points load configuration once and exit nonzero on invalid numeric settings; an absent or false enable flag is a valid disabled state, not an implicit enable.

`resource-guard.ts` reads normalized load, process/system memory, and `statfs` for the recording temporary directory; it returns `disk_high` at 80% usage and uses configurable CPU/memory thresholds. Every Worker exposes an in-process current-job counter updated immediately after claim and in `finally` after release; the independent pump writes that count and the latest protection state to the heartbeat.

- [ ] **Step 4: Add the production TypeScript runner dependency**

Run: `pnpm add tsx`

Expected: `tsx` appears under `dependencies`, not `devDependencies`, and `pnpm-lock.yaml` changes.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run features/async-tasks/worker-loop.test.ts features/async-tasks/resource-guard.test.ts features/async-tasks/runtime-config.test.ts`

Expected: PASS.

```bash
git add package.json pnpm-lock.yaml features/async-tasks/worker-loop.ts features/async-tasks/worker-loop.test.ts features/async-tasks/resource-guard.ts features/async-tasks/resource-guard.test.ts features/async-tasks/runtime-config.ts features/async-tasks/runtime-config.test.ts
git commit -m "feat: add durable worker polling loop"
```

### Task 2: Add Fair Cross-Organization Claim RPCs

**Files:**
- Create: `supabase/migrations/20260714110000_async_task_worker_claims.sql`
- Create: `lib/db/async-task-worker-claims-contract.test.ts`

- [ ] **Step 1: Write the failing SQL contract**

The test must require all three claim functions to contain `row_number() over (partition by organization_id`, `for update skip locked`, a lease expiration update, service-role-only execution grants, and no `p_organization_id` parameter.

```ts
expect(sql).toMatch(/create or replace function public\.claim_async_ocr_jobs\(/);
expect(sql).toMatch(/create or replace function public\.claim_async_recording_ai\(/);
expect(sql).toMatch(/create or replace function public\.claim_async_settlement_simulations\(/);
expect(sql).toMatch(/create or replace function public\.finalize_async_task\(/);
expect(sql).toMatch(/create or replace function public\.reconcile_expired_async_tasks\(/);
expect(sql).toContain("row_number() over (partition by");
expect(sql).toContain("for update skip locked");
expect(sql).toContain("pg_try_advisory_xact_lock");
expect(sql).toContain("lease_expires_at > p_now");
expect(sql).toContain("lease_expires_at = p_now + make_interval");
expect(sql).not.toContain("p_organization_id");
expect(sql).toContain("grant execute on function public.claim_async_ocr_jobs");
expect(sql).toContain("to service_role");
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `pnpm vitest run lib/db/async-task-worker-claims-contract.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement all three claim functions**

Each RPC accepts `p_worker_id text`, `p_limit integer`, `p_lease_seconds integer`, `p_per_org_limit integer`, and `p_now timestamptz default now()`. Validate positive bounded limits. Worker defaults are OCR 3, recording AI 1, and settlement simulation 1.

Use this candidate pattern for each table:

```sql
with ranked as materialized (
  select candidate.id,
         candidate.organization_id,
         row_number() over (
           partition by candidate.organization_id
           order by greatest(
             0,
             candidate.priority - floor(extract(epoch from (p_now - candidate.created_at)) / 1800)::integer
           ) asc,
           candidate.run_after asc,
           candidate.created_at asc
         ) as org_rank
  from public.background_jobs candidate
  where candidate.job_type = 'ocr.extract_live_report'
    and candidate.attempt < candidate.max_attempts
    and candidate.cancel_requested_at is null
    and candidate.run_after <= p_now
    and not exists (
      select 1
      from public.async_task_queue_controls control
      where control.organization_id = candidate.organization_id
        and control.task_type = 'ocr'
        and control.desired_state = 'paused'
    )
    and (
      candidate.status = 'queued'
      or (candidate.status = 'running' and candidate.lease_expires_at <= p_now)
    )
), selected as materialized (
  select job.id
  from ranked
  join public.background_jobs job on job.id = ranked.id
  order by ranked.org_rank asc,
           greatest(0, job.priority - floor(extract(epoch from (p_now - job.created_at)) / 1800)::integer) asc,
           job.run_after asc,
           job.created_at asc
  limit greatest(1, least(p_limit, 10))
  for update of job skip locked
)
update public.background_jobs job
set status = 'running',
    stage = 'resolving_image',
    attempt = job.attempt + 1,
    locked_at = p_now,
    locked_by = p_worker_id,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
    started_at = coalesce(job.started_at, p_now),
    updated_at = p_now
from selected
where job.id = selected.id
returning job.*;
```

Before selecting a candidate for an organization, acquire a transaction-scoped advisory lock derived from `(task_type, organization_id)`. Under that lock, count rows for the same organization and type whose status is running and whose lease remains valid. Only ranks up to `p_per_org_limit - active_count` may be selected. This serialization is required so concurrent Worker hosts cannot each observe a free slot and exceed the organization cap. The SQL contract must assert the advisory lock and active-lease predicates; Phase 4 adds a concurrent canary that proves OCR never exceeds 3 and recording/simulation never exceed 1 for one organization.

The recording function uses `recording_ai_analyses`, `claimed_at`, `claimed_by`, stage `extracting_audio`, and the equivalent `recording_ai` queue-control exclusion. The settlement function uses `background_jobs` filtered to `settlement.simulate_large_sample`, stage `validating_snapshot`, and the `settlement_simulation` queue control. Add a generic `renew_async_task_lease(p_task_type text, p_task_id uuid, p_worker_id text, p_lease_seconds integer, p_now timestamptz default now()) returns boolean` that renews only a matching running task owned by that Worker.

Add `finalize_async_task(...)` as the only new-runtime path that writes `succeeded`, `failed`, `cancelled`, or `needs_confirmation`. In one PostgreSQL function transaction it verifies the current lease owner (or an explicit authenticated cancellation policy), updates the correct domain row, clears the lease, sets completion/error fields, and inserts the matching `async_task_events` row. If event insertion fails, the domain status update must roll back. Repeated calls with the same terminal state are idempotent and return the existing event; conflicting terminal transitions fail closed. Revoke execution from `public` and `anon`; Workers use the service-role grant, while Phase 3 user actions call a separate caller-checked wrapper.

Add `reconcile_expired_async_tasks(p_now, p_limit)` for the crash-attempt boundary. In one transaction it locks expired `running` OCR, recording, and settlement rows whose `attempt >= max_attempts`, changes them to `failed` with `error_code='worker_lease_exhausted'`, and inserts one terminal event per row. Rows with attempts remaining stay eligible for normal stale-lease claim. Call reconciliation before each claim batch and from the watchdog so a task that crashes on its last attempt cannot remain `running` forever. Contract and Worker tests cover a task claimed at `attempt = max_attempts`, process loss, lease expiry, exactly one failed event, and idempotent repeated reconciliation.

Revoke claim and lease execution from `public, anon, authenticated`; grant only to `service_role`. Grant the service role access to the terminal finalizer and cover its update-plus-event ordering in the SQL contract.

- [ ] **Step 4: Run schema contracts**

Run: `pnpm vitest run lib/db/async-task-worker-claims-contract.test.ts lib/db/async-task-schema-contract.test.ts lib/db/ai-schema-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit claim RPCs**

```bash
git add supabase/migrations/20260714110000_async_task_worker_claims.sql lib/db/async-task-worker-claims-contract.test.ts
git commit -m "feat: add fair async task claims"
```

### Task 3: Add Non-Impersonating System Execution Actors

**Files:**
- Create: `features/async-tasks/system-actor.ts`
- Create: `features/async-tasks/system-actor.test.ts`
- Modify: `features/ai/contracts.ts`
- Modify: `features/ai/invocation-ledger.ts`
- Modify: `features/ai/invocation-ledger.test.ts`
- Modify: `features/billing/usage-metering.ts`
- Modify: `features/billing/usage-metering.test.ts`

- [ ] **Step 1: Write failing actor tests**

```ts
it("creates an organization-scoped system actor without a human user id", () => {
  expect(createWorkerActor({ organizationId: "org-1", workerId: "ocr:host-a:1" })).toEqual({
    actorKind: "system",
    organizationId: "org-1",
    userId: undefined,
    name: "Background Worker",
    role: "ops_manager",
    workerId: "ocr:host-a:1",
  });
});

it("records worker id in invocation metadata and leaves actor_user_id null", async () => {
  await recordAiInvocation({ client, actor: systemActor, input: { scene: "ocr", status: "queued" } });
  expect(inserts.ai_invocations[0]).toMatchObject({ actor_user_id: null });
  expect(inserts.ai_invocations[0].metadata).toMatchObject({ workerId: "ocr:host-a:1" });
});
```

- [ ] **Step 2: Run and verify the type/runtime failure**

Run: `pnpm vitest run features/async-tasks/system-actor.test.ts features/ai/invocation-ledger.test.ts features/billing/usage-metering.test.ts`

Expected: FAIL because system actors are unsupported.

- [ ] **Step 3: Implement the explicit actor union**

```ts
export type AiExecutionActor =
  | (AiActor & { actorKind?: "human"; workerId?: never })
  | {
      actorKind: "system";
      userId?: undefined;
      name: string;
      role: "ops_manager";
      organizationId: string;
      workerId: string;
    };
```

`recordAiInvocation` and `recordUsageEvent` accept `AiExecutionActor`; write `actor_user_id: actor.userId ?? null`. Merge `workerId` into metadata for system actors. `writeAuditLog` already accepts an optional actor user ID, so pass `undefined` and set `actorName` to `Background Worker`.

- [ ] **Step 4: Run the focused tests and type-check**

Run:

```bash
pnpm vitest run features/async-tasks/system-actor.test.ts features/ai/invocation-ledger.test.ts features/billing/usage-metering.test.ts
pnpm type-check
```

Expected: PASS.

- [ ] **Step 5: Commit the actor boundary**

```bash
git add features/async-tasks/system-actor.ts features/async-tasks/system-actor.test.ts features/ai/contracts.ts features/ai/invocation-ledger.ts features/ai/invocation-ledger.test.ts features/billing/usage-metering.ts features/billing/usage-metering.test.ts
git commit -m "feat: add system execution actor boundary"
```

### Task 4: Add Persistent Provider Circuit Breakers

**Files:**
- Create: `features/async-tasks/provider-circuit-breaker.ts`
- Create: `features/async-tasks/provider-circuit-breaker.test.ts`

- [ ] **Step 1: Write failing state-transition tests**

Cover these cases with a fake repository and clock:

- fewer than five retryable failures leave the provider closed;
- the fifth consecutive retryable failure opens the provider for two minutes;
- non-retryable input, authentication, and configuration failures do not advance the outage counter;
- exactly one Worker can atomically acquire the half-open probe after `opened_until`;
- a half-open probe lease expires after 30 seconds, allowing another Worker to recover when the probe process crashes;
- a successful probe closes the breaker and resets the failure count;
- a failed probe reopens the breaker without consuming a task attempt.

```ts
expect(await canCallProvider(deps, "tencent_ocr", "worker-a", now)).toEqual({
  allowed: false,
  retryAt: new Date("2026-07-14T10:02:00.000Z"),
  reason: "circuit_open",
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run: `pnpm vitest run features/async-tasks/provider-circuit-breaker.test.ts`

Expected: FAIL because the circuit-breaker module does not exist.

- [ ] **Step 3: Implement the persisted breaker service**

Export:

```ts
export async function canCallProvider(
  dependencies: ProviderCircuitBreakerDependencies,
  providerKey: ProviderKey,
  workerId: string,
  now?: Date,
): Promise<{ allowed: true; probe: boolean } | { allowed: false; retryAt: Date; reason: "circuit_open" }>;

export async function recordProviderFailure(
  dependencies: ProviderCircuitBreakerDependencies,
  input: { providerKey: ProviderKey; workerId: string; errorCode: string; retryable: boolean; now?: Date },
): Promise<void>;

export async function recordProviderSuccess(
  dependencies: ProviderCircuitBreakerDependencies,
  input: { providerKey: ProviderKey; workerId: string; now?: Date },
): Promise<void>;
```

Use conditional updates against `provider_circuit_breakers` for a 30-second half-open probe lease (`probe_worker_id`, `probe_lease_expires_at`) so concurrent hosts cannot both probe. An unexpired lease is exclusive; an expired lease is atomically reclaimable. Success closes and clears the probe lease; retryable failure reopens and clears it. The default threshold is five consecutive retryable failures and the default open duration is two minutes. Keep these values injectable in tests. Provider keys are `tencent_ocr`, `doubao_asr`, and the configured LLM provider key.

The Worker checks every required provider before claiming work. An open breaker returns an idle iteration with `claimed: 0`; it must not claim, increment attempts, or rewrite task state. Once a claim begins, every provider result records success or a classified failure.

- [ ] **Step 4: Run and commit the breaker boundary**

Run:

```bash
pnpm vitest run features/async-tasks/provider-circuit-breaker.test.ts
pnpm type-check
```

Expected: PASS.

```bash
git add features/async-tasks/provider-circuit-breaker.ts features/async-tasks/provider-circuit-breaker.test.ts
git commit -m "feat: add persistent provider circuit breakers"
```

### Task 5: Implement The OCR Worker

**Files:**
- Create: `features/ai/ocr-worker.ts`
- Create: `features/ai/ocr-worker.test.ts`
- Modify: `features/ai/ocr-jobs.ts`
- Modify: `features/ai/ocr-jobs.test.ts`
- Create: `scripts/workers/ocr-worker.ts`
- Modify: `app/api/internal/ocr/run/route.ts`
- Modify: `app/api/internal/ocr/run/route.test.ts`

- [ ] **Step 1: Write failing Worker tests**

Test that one iteration checks the global enable gate, `OCR_WORKER_ENABLED`, and the `tencent_ocr` breaker before claiming, claims a batch when all allow it, appends stages in order, renews the lease during provider work, continues after one job fails, classifies provider results for the breaker, finalizes through the atomic database RPC, and returns the number claimed. Separately test global=true/workload=false, global=false/workload=true, empty queue, and open breaker; each returns `claimed: 0` without calling the claim RPC. Finalizer failure never emits a separate terminal event.

```ts
expect(events.map((event) => event.stage)).toEqual([
  "resolving_image",
  "recognizing",
  "persisting",
]);
expect(renewLease).toHaveBeenCalledWith(expect.objectContaining({ taskType: "ocr" }));
expect(result).toEqual({ claimed: 2, succeeded: 1, failed: 1 });
```

- [ ] **Step 2: Run and verify the missing Worker failure**

Run: `pnpm vitest run features/ai/ocr-worker.test.ts`

Expected: FAIL because `ocr-worker.ts` does not exist.

- [ ] **Step 3: Implement one OCR iteration**

Export:

```ts
export async function runOcrWorkerIteration(input: {
  client: OcrWorkerClient;
  workerId: string;
  limit: number;
  leaseSeconds: number;
  now?: () => Date;
}): Promise<{ claimed: number; succeeded: number; failed: number }>;
```

Add `claimPlatformOcrJobs` to `ocr-jobs.ts`, calling `claim_async_ocr_jobs` without an organization ID. For each row, create a system actor from the row organization, append nonterminal stage events, execute existing image resolution/provider logic, and call `finalize_async_task` for every terminal transition. Use a 30-second renewal interval in a `try/finally`; clear it before releasing the job.

Split the execution body into `runClaimedOcrJob`, which accepts the row already returned by the platform claim RPC and never increments `attempt` or takes a second lock. Keep `runOcrJobOnce` as the manual compatibility wrapper that performs its existing local claim before calling `runClaimedOcrJob`. Add a regression test proving a platform claim at attempt 1 finishes at attempt 1, not attempt 2.

Do not call `retryOcrJob` for provider failures. Preserve existing backoff semantics and `run_after` persistence so the database remains authoritative. New OCR inserts write `requested_by`, `priority: 0`, and a stable idempotency key derived from the live report identity.

- [ ] **Step 4: Add the thin process entrypoint and route delegation**

`scripts/workers/ocr-worker.ts` must:

1. Create the admin client or exit nonzero.
2. Build `workerId` from `ocr:${hostname()}:${process.pid}`.
3. Register SIGTERM/SIGINT to abort the loop.
4. Call `runWorkerLoop` with 1-second idle polling.
5. Write heartbeats through Phase 1 repository functions.

Change `/api/internal/ocr/run` to call `runOcrWorkerIteration` once after token validation, preserving its existing response shape.

- [ ] **Step 5: Run and commit OCR Worker**

Run:

```bash
pnpm vitest run features/ai/ocr-worker.test.ts features/ai/ocr-jobs.test.ts app/api/internal/ocr/run/route.test.ts "app/api/live-tasks/[taskId]/ocr/route.test.ts"
pnpm type-check
```

Expected: PASS.

```bash
git add features/ai/ocr-worker.ts features/ai/ocr-worker.test.ts features/ai/ocr-jobs.ts features/ai/ocr-jobs.test.ts scripts/workers/ocr-worker.ts app/api/internal/ocr/run/route.ts app/api/internal/ocr/run/route.test.ts
git commit -m "feat: run OCR through durable worker service"
```

### Task 6: Implement The Recording AI Worker

**Files:**
- Create: `features/recordings/recording-ai-worker.ts`
- Create: `features/recordings/recording-ai-worker.test.ts`
- Modify: `features/recordings/recording-ai-analysis.ts`
- Modify: `features/recordings/recording-ai-analysis.test.ts`
- Modify: `features/recordings/recording-ai-pipeline.ts`
- Modify: `features/recordings/recording-audio-extraction.ts`
- Create: `scripts/workers/recording-ai-worker.ts`
- Modify: `app/api/internal/recording-ai/run/route.ts`
- Modify: `app/api/internal/recording-ai/run/route.test.ts`

- [ ] **Step 1: Write failing stage, lease, and cancellation tests**

Required cases:

- stages emit `extracting_audio`, `transcribing`, `analyzing`, `generating_report`, `persisting`;
- lease renews every 30 seconds while ASR/LLM is pending;
- `cancel_requested_at` before execution yields `cancelled` without provider calls;
- cancellation after extraction prevents ASR and cleans the temporary file;
- one failed analysis does not stop later claimed analyses.
- open `doubao_asr` or configured LLM breakers prevent claims without consuming attempts;
- provider successes and retryable failures update the matching persisted breaker.
- every terminal path calls `finalize_async_task`; a finalizer error cannot be followed by a standalone terminal event or notification.
- `ASYNC_WORKERS_ENABLED=false` prevents the recording claim RPC while heartbeats remain available.
- `ASYNC_WORKERS_ENABLED=true` with `RECORDING_AI_WORKER_ENABLED=false` also prevents the recording claim RPC.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm vitest run features/recordings/recording-ai-worker.test.ts`

Expected: FAIL because the Worker module does not exist.

- [ ] **Step 3: Implement one recording iteration**

Export:

```ts
export async function runRecordingAiWorkerIteration(input: {
  client: RecordingAiWorkerClient;
  workerId: string;
  limit: number;
  leaseSeconds: number;
  pipelineFactory?: typeof createRecordingAiAnalysisPipeline;
  now?: () => Date;
}): Promise<{ claimed: number; succeeded: number; failed: number; cancelled: number }>;
```

Add a platform claim path backed by `claim_async_recording_ai`. Update stages immediately before each expensive operation. Add an `onStage` callback and `AbortSignal` to the pipeline and audio extraction; cancellation is checked between safe stages, not by corrupting an in-flight provider request.

Split the current body into `executeClaimedRecordingAiAnalysis`, which receives an already claimed row and does not increment `attempt` again. Keep `runRecordingAiAnalysisOnce` as the explicit-analysis compatibility wrapper. Add a regression test proving one platform claim consumes exactly one attempt.

Always clean temporary files in `finally`. Use `finalize_async_task` so terminal status and terminal event commit atomically; notification dispatch only consumes the committed event.

- [ ] **Step 4: Add the process entrypoint and preserve route compatibility**

The entrypoint mirrors OCR but uses worker type `recording_ai`, idle polling 1 second, default limit 1, and the recording pipeline factory. Change the existing internal runner route to delegate to the same iteration service in batch mode; preserve explicit `analysisId` compatibility.

- [ ] **Step 5: Run and commit recording Worker**

Run:

```bash
pnpm vitest run features/recordings/recording-ai-worker.test.ts features/recordings/recording-ai-analysis.test.ts features/recordings/recording-audio-extraction.test.ts app/api/internal/recording-ai/run/route.test.ts "app/api/recording-assets/[assetId]/ai-analysis/route.test.ts"
pnpm type-check
```

Expected: PASS.

```bash
git add features/recordings/recording-ai-worker.ts features/recordings/recording-ai-worker.test.ts features/recordings/recording-ai-analysis.ts features/recordings/recording-ai-analysis.test.ts features/recordings/recording-ai-pipeline.ts features/recordings/recording-audio-extraction.ts scripts/workers/recording-ai-worker.ts app/api/internal/recording-ai/run/route.ts app/api/internal/recording-ai/run/route.test.ts
git commit -m "feat: run recording AI through durable worker service"
```

### Task 7: Queue Large Settlement Simulations Without Breaking The Live Conversation

**Files:**
- Create: `features/settlements/custom-rule-simulation-jobs.ts`
- Create: `features/settlements/custom-rule-simulation-jobs.test.ts`
- Create: `features/settlements/custom-rule-simulation-worker.ts`
- Create: `features/settlements/custom-rule-simulation-worker.test.ts`
- Modify: `features/settlements/custom-rule-route-context.ts`
- Modify: `features/settlements/custom-rule-route-context.test.ts`
- Modify: `app/api/projects/[projectId]/settlement-rules/simulate/route.ts`
- Modify: `app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts`
- Create: `scripts/workers/settlement-simulation-worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing budget, route, and frozen-context tests**

Required cases:

- a small prepared simulation stays synchronous and preserves the existing `201` response;
- work above the configured 10-second budget creates one `settlement.simulate_large_sample` job and returns `202 { task }`;
- while Web's `SETTLEMENT_SIMULATION_QUEUE_ENABLED` is false, the route preserves the existing synchronous behavior and creates no stranded job;
- while `ASYNC_WORKERS_ENABLED` is false, the settlement Worker does not call its claim RPC even if its per-workload flag is true;
- while the global flag is true and `SETTLEMENT_SIMULATION_WORKER_ENABLED=false`, the settlement Worker still does not call its claim RPC;
- the same organization, draft, revision, selection hash, and client request ID returns the same task;
- an async job stores a strict frozen execution envelope and never stores session cookies, provider credentials, arbitrary request headers, or conversation history;
- a technical retry executes the exact frozen envelope without reloading live evidence;
- tampered hashes, oversized payloads, stale draft identities, and unauthorized project scope fail closed;
- cancellation before execution produces `cancelled` without running the deterministic engine;
- simulation insertion is idempotent, and the task terminal status plus terminal event use the atomic finalizer.

Use an injectable work estimator. The default work unit is `recordCount * formulaNodeCount * scenarioCount`; queue above `SETTLEMENT_SIMULATION_SYNC_WORK_UNITS` with a conservative default of `50000`. Phase 4 calibrates that value so synchronous simulation P95 remains below 8 seconds, preserving a 2-second margin under the 10-second product boundary.

- [ ] **Step 2: Run and verify the missing queue/Worker failures**

Run:

```bash
pnpm vitest run features/settlements/custom-rule-simulation-jobs.test.ts features/settlements/custom-rule-simulation-worker.test.ts features/settlements/custom-rule-route-context.test.ts "app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts"
```

Expected: FAIL because the queue and Worker modules do not exist and the route is synchronous-only.

- [ ] **Step 3: Split preparation from deterministic execution**

Refactor `createCustomRuleExistingDraftSimulationService` into reusable preparation and execution steps while preserving the current public method:

```ts
prepareExistingDraftSimulation(scope): Promise<PreparedCustomRuleSimulation>;
executePreparedSimulation(prepared): Promise<CustomRuleSimulationExecutionResult>;
simulateExistingDraft(scope): Promise<CustomRuleSimulationExecutionResult>;
```

`PreparedCustomRuleSimulation` is a strict, versioned, inert-data envelope containing the original requester ID for attribution, organization/project/conversation/draft/revision identities, compiled formula and hashes, parameters, authorized evidence snapshot, selection hash, and idempotency key. Reuse the existing snapshot budget and cap serialized queue payloads at 2 MB. Compute and store an envelope SHA-256. Never include auth tokens or mutable context.

The queued execution verifies the envelope hash, identity tuple, formula/contract/parameter hashes, and evidence selection hash. It deliberately does not reject an authorized frozen snapshot merely because wall-clock time passed while queued or retrying, and it never re-grounds from current project evidence. `requestedBy` remains attribution only; Worker authorization uses the non-impersonating system actor.

- [ ] **Step 4: Add the sync/async route decision and durable enqueue**

After the existing session, project, billing, and selection authorization succeeds, prepare once. Execute synchronously below the work budget. Above the budget, enqueue only when Web's `SETTLEMENT_SIMULATION_QUEUE_ENABLED=true`; that Web flag defaults false until Phase 4 proves the Worker can claim. Otherwise preserve the existing synchronous path so deployment cannot strand a task before its Worker is active. The queue path inserts a priority-0 `background_jobs` row through `custom-rule-simulation-jobs.ts` with task type `settlement_simulation`, stage `queued`, the frozen envelope, and a stable idempotency key. Return `202 { task }`; do not keep the request open waiting for a Worker.

The async path must not apply, approve, or submit a rule. Completion only creates the simulation result for the same immutable draft so the live AI workspace can refresh it and continue to the existing user confirmation step.

- [ ] **Step 5: Implement the settlement simulation Worker**

Claim through `claim_async_settlement_simulations`. Emit `validating_snapshot`, `simulating`, and `persisting` stages. Renew the lease, check cancellation before deterministic execution, persist the append-only simulation idempotently, then call `finalize_async_task` so job success and its terminal event commit together. Classify deterministic input/integrity failures as non-retryable; database timeouts and transient infrastructure failures retain normal backoff.

The entrypoint uses worker type `settlement_simulation`, a 1-second idle poll, default concurrency 1, the shared resource guard, heartbeats, and graceful drain. Add:

```json
"worker:settlement-simulation": "tsx scripts/workers/settlement-simulation-worker.ts"
```

- [ ] **Step 6: Run and commit settlement simulation Worker**

Run:

```bash
pnpm vitest run features/settlements/custom-rule-simulation-jobs.test.ts features/settlements/custom-rule-simulation-worker.test.ts features/settlements/custom-rule-route-context.test.ts "app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts"
pnpm type-check
```

Expected: PASS.

```bash
git add features/settlements/custom-rule-simulation-jobs.ts features/settlements/custom-rule-simulation-jobs.test.ts features/settlements/custom-rule-simulation-worker.ts features/settlements/custom-rule-simulation-worker.test.ts features/settlements/custom-rule-route-context.ts features/settlements/custom-rule-route-context.test.ts "app/api/projects/[projectId]/settlement-rules/simulate/route.ts" "app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts" scripts/workers/settlement-simulation-worker.ts package.json
git commit -m "feat: queue large settlement simulations"
```

### Task 8: Extract Maintenance Jobs Into A Local CLI

**Files:**
- Create: `features/background-jobs/maintenance-runner.ts`
- Create: `features/background-jobs/maintenance-runner.test.ts`
- Create: `features/background-jobs/watchdog.ts`
- Create: `features/background-jobs/watchdog.test.ts`
- Create: `scripts/workers/maintenance-job.ts`
- Create: `scripts/workers/watchdog.ts`
- Modify: `app/api/internal/anomalies/run/route.ts`
- Modify: `app/api/internal/account-library/metrics-sync/run/route.ts`
- Modify: `app/api/internal/account-library/idle-scan/run/route.ts`
- Modify: `app/api/internal/recording-intelligence/learn/route.ts`
- Modify: the four matching route tests.
- Modify: `package.json`

- [ ] **Step 1: Write failing maintenance dispatch tests**

```ts
it.each([
  "anomaly-scan",
  "recording-intelligence-learn",
  "account-metrics-sync",
  "account-idle-scan",
] as const)("reserves and completes every organization item for %s", async (jobKey) => {
  const result = await runMaintenanceJob({ client, jobKey, scheduledFor, workerId, dependencies });
  expect(result.status).toBe("succeeded");
  expect(ensureScheduledRun).toHaveBeenCalledOnce();
  expect(claimScheduledRun).toHaveBeenCalledOnce();
  expect(finalizeScheduledRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ runId: expect.any(String) }));
});

it("reclaims stale work without rerunning completed organizations", async () => {
  claimScheduledRun.mockResolvedValue({ claimed: true, runId: "run-1", resumed: true, status: "running" });
  claimScheduledRunItems.mockResolvedValue([{ organizationId: "org-pending" }]);
  await runMaintenanceJob(input);
  expect(runOrganizationJob).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-pending" }));
  expect(runOrganizationJob).not.toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-complete" }));
});
```

Also cover: an unexpired active lease returns without stealing; a 75-second organization task renews both run and item leases; one organization failure does not skip later claimed items; transient item failure is reclaimable up to `max_attempts`; terminal duplicates preserve their original `succeeded` or `failed` result; the run cannot finalize while any item remains queued/running; and `--scheduled-for auto` derives the documented Asia/Shanghai calendar slot deterministically.

When `ASYNC_WORKERS_ENABLED=false`, maintenance exits with a structured disabled skip without reserving a new slot; the watchdog still runs so operators can observe the disabled state. Add a separate global=true / `MAINTENANCE_WORKER_ENABLED=false` test with the same no-reservation expectation.

Add a clock-boundary regression: an anomaly slot persisted at 10:00 crashes, systemd restarts at 10:31, and `auto` must resume the 10:00 run before creating or processing the 10:30 slot. The completed organization checkpoint from 10:00 is not rerun.

Add a 10:00 overlap regression: anomaly-scan and recording-intelligence services start concurrently, both persist their own schedule slots, but only one acquires the global maintenance execution lease and enters a domain service. The deferred slot remains queued, retries after lease release/expiry, and then completes. Renew the global lease during long organization work and release it in `finally`.

- [ ] **Step 2: Run and verify missing-module failure**

Run: `pnpm vitest run features/background-jobs/maintenance-runner.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement domain-service dispatch**

Export a discriminated job key union and dependency-injected dispatcher. Move route-only orchestration into this module; keep request parsing and bearer authentication in routes. Call `ensureScheduledRun` to persist the deterministic slot as queued without ownership, acquire the renewable global maintenance lease, and only then call `claimScheduledRun` plus `claimScheduledRunItems`. A busy global lease returns a retryable deferred result while the parent slot remains queued with no parent lease. Renew global/run/item leases every 30 seconds, release the global lease in `finally`, and finalize from item rows. Completed organization items are checkpoints and are never rerun after process restart. One organization failure is recorded on that item and does not skip later claimed items.

The CLI requires `--scheduled-for`, accepting either an explicit RFC3339 timestamp or `auto`. For `auto`, first call `findOldestIncompleteScheduledRun(jobKey)` and resume that persisted timestamp. Only when no incomplete slot remains may it derive the most recent Asia/Shanghai calendar slot. After completing an older recovered slot, it checks the current derived slot once so a boundary crossed during recovery is not silently missed. Bound each invocation to the recovered slot plus at most one current slot; later backlog remains durable for the next run. The mapping and cross-boundary behavior are unit tested and shared with systemd documentation. Accepted commands are:

```bash
pnpm worker:maintenance -- anomaly-scan --scheduled-for 2026-07-14T10:00:00+08:00
pnpm worker:maintenance -- recording-intelligence-learn --scheduled-for 2026-07-14T10:00:00+08:00
pnpm worker:maintenance -- account-metrics-sync --scheduled-for 2026-07-14T10:10:00+08:00
pnpm worker:maintenance -- account-idle-scan --scheduled-for 2026-07-14T10:20:00+08:00
pnpm worker:maintenance -- anomaly-scan --scheduled-for auto
```

Exit 0 only for persisted `succeeded`/`skipped` slots, exit 1 for reclaimable incomplete work so systemd retries, and exit 2 for terminal failure or invalid configuration. A duplicate terminal slot returns its persisted status; it is never flattened to a generic successful skip.

- [ ] **Step 4: Implement and test the watchdog health contract**

`features/background-jobs/watchdog.ts` queries bounded aggregate views/repositories and returns a structured health document. Tests cover:

- Worker heartbeat older than 60 seconds;
- OCR oldest wait over 1 minute, recording AI over 10 minutes, and settlement simulation over 2 minutes;
- final failure rate above 20% in a rolling 10-minute window, while small samples are marked insufficient rather than healthy;
- queue arrival rate exceeding completion rate for two consecutive windows;
- CPU, memory, or temporary-disk protection state;
- open/half-open provider breakers;
- failed timers, stale scheduled-run leases, and incomplete organization items;
- expired normal tasks and scheduled-run items at `max_attempts`, which are reconciled atomically to failed before health is reported;
- database/query failure returning `unknown` instead of fake healthy zeros.

`scripts/workers/watchdog.ts` prints one redacted JSON object for `--health-json` and otherwise emits structured alert log records suitable for Tencent Cloud log alarms. Exit 0 for healthy, 1 for confirmed unhealthy, and 2 for unknown/configuration failure. It never prints payloads, transcriptions, evidence snapshots, signed URLs, or environment values.

Before collecting health, the watchdog invokes bounded `reconcile_expired_async_tasks` and `reconcile_expired_scheduled_job_work`. Reconciliation failure makes health `unknown`; it is never swallowed into a healthy report.

Run: `pnpm vitest run features/background-jobs/watchdog.test.ts`

Expected: PASS.

- [ ] **Step 5: Add package scripts**

```json
"worker:ocr": "tsx scripts/workers/ocr-worker.ts",
"worker:recording-ai": "tsx scripts/workers/recording-ai-worker.ts",
"worker:settlement-simulation": "tsx scripts/workers/settlement-simulation-worker.ts",
"worker:maintenance": "tsx scripts/workers/maintenance-job.ts",
"worker:watchdog": "tsx scripts/workers/watchdog.ts"
```

- [ ] **Step 6: Run and commit maintenance workers**

Run:

```bash
pnpm vitest run features/background-jobs app/api/internal/anomalies/run/route.test.ts app/api/internal/account-library/metrics-sync/run/route.test.ts app/api/internal/account-library/idle-scan/run/route.test.ts app/api/internal/recording-intelligence/learn/route.test.ts
pnpm type-check
```

Expected: PASS.

```bash
git add features/background-jobs scripts/workers/maintenance-job.ts scripts/workers/watchdog.ts app/api/internal/anomalies/run app/api/internal/account-library/metrics-sync/run app/api/internal/account-library/idle-scan/run app/api/internal/recording-intelligence/learn package.json
git commit -m "feat: add local maintenance worker commands"
```

### Task 9: Verify The Workload Phase

**Files:** no new files unless a verification failure requires a scoped fix.

- [ ] **Step 1: Run all Worker and compatibility tests**

```bash
pnpm test:async-tasks
pnpm vitest run features/ai/ocr-worker.test.ts features/ai/ocr-jobs.test.ts features/recordings/recording-ai-worker.test.ts features/recordings/recording-ai-analysis.test.ts features/settlements/custom-rule-simulation-jobs.test.ts features/settlements/custom-rule-simulation-worker.test.ts features/background-jobs app/api/internal/ocr/run/route.test.ts app/api/internal/recording-ai/run/route.test.ts "app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts"
pnpm test:api-contracts
pnpm type-check
pnpm eslint features/async-tasks features/background-jobs features/ai/ocr-worker.ts features/recordings/recording-ai-worker.ts features/settlements/custom-rule-simulation-jobs.ts features/settlements/custom-rule-simulation-worker.ts scripts/workers
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Run a local one-iteration dry run with providers disabled**

Run the Worker modules through their injected tests, not against production data. Confirm an empty queue returns 0 and the process handles SIGTERM without an unhandled rejection.

- [ ] **Step 3: Commit only scoped fixes**

If verification required changes, stage only those files and commit:

```bash
git commit -m "fix: close background worker verification gaps"
```

## Phase 2 Exit Gate

- OCR, recording AI, and settlement simulation claims are cross-organization, atomic, fair, and service-role only.
- Worker execution uses system actors with no human impersonation.
- Lease renewal, cancellation checkpoints, retry persistence, and temp cleanup are tested.
- Expired final-attempt tasks and schedule items close atomically instead of remaining `running`.
- Global and per-workload flags fail closed before every claim while watchdog health remains available.
- Existing internal runner routes still work through shared services.
- Small settlement simulations remain synchronous; large simulations return a durable task and reuse one frozen authorized context across retries.
- Maintenance jobs run from a local CLI with database idempotency.
- Maintenance restart resumes persisted slots/items across calendar boundaries without rerunning completed organizations.
- Production schedules and inline kicks remain unchanged until Phase 4 cutover.
