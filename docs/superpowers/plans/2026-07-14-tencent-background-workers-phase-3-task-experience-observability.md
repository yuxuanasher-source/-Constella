# Tencent Background Workers Phase 3 Task Experience And Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users durable task status, SSE updates with polling fallback, self-service retry/cancel/manual paths, completion notifications, and give operators a unified task runtime center.

**Architecture:** Project OCR, recording AI, and settlement simulation rows through one access-controlled API while preserving their domain tables. Stream only already-persisted task events, use notifications as an idempotent leased outbox consumer, and keep the reusable UI in focused components embedded into existing reference applications.

**Tech Stack:** Next.js App Router, React 19, SSE `ReadableStream`, Supabase JS, existing notifications, Lucide React, Vitest and Testing Library.

---

## Dependency And Scope

Requires Phases 1 and 2 complete. This phase does not install systemd units or disable any scheduler. It may add UI routes and APIs, but production Worker concurrency remains controlled by existing migration flags until Phase 4.

## File Map

- Create: `supabase/migrations/20260714120000_async_task_notification_outbox.sql` — unique notification source and dispatch marker.
- Create: `lib/db/async-task-notification-contract.test.ts` — outbox idempotency contract.
- Create: `supabase/migrations/20260714120100_async_task_queue_estimates.sql` — caller-scoped position and de-identified capacity/duration aggregates.
- Create: `lib/db/async-task-queue-estimates-contract.test.ts` — SQL security and bounded-query contract.
- Create: `supabase/migrations/20260714120050_async_task_visible_reads.sql` and `lib/db/async-task-visible-reads-contract.test.ts` — unified caller-filtered list/detail RPCs.
- Create: `supabase/migrations/20260714120200_async_task_user_actions.sql` — caller-checked atomic retry/cancel plus events.
- Create: `lib/db/async-task-user-actions-contract.test.ts` — action authorization and transaction contract.
- Modify: `features/async-tasks/repository.ts`, `.test.ts` — visible task queries, detail, actions, and operator metrics.
- Create: `features/async-tasks/service.ts`, `.test.ts` — authorization, retry/cancel, queue estimates, and outbox dispatch.
- Create: `features/async-tasks/stream-adapter.ts`, `.test.ts` — persisted-event SSE with heartbeat and disconnect cleanup.
- Create: `app/api/async-tasks/route.ts`, `.test.ts` — visible task list.
- Create: `app/api/async-tasks/[taskType]/[taskId]/route.ts`, `.test.ts` — task detail.
- Create: `app/api/async-tasks/[taskType]/[taskId]/retry/route.ts`, `.test.ts` — explicit retry.
- Create: `app/api/async-tasks/[taskType]/[taskId]/cancel/route.ts`, `.test.ts` — explicit cancel.
- Create: `app/api/async-tasks/stream/route.ts`, `.test.ts` — authenticated SSE.
- Create: `supabase/migrations/20260714120300_async_task_visible_events.sql` and `lib/db/async-task-visible-events-contract.test.ts` — caller-filtered event cursor RPC.
- Create: `app/api/async-tasks/operations/route.ts`, `.test.ts` — staff-only runtime health.
- Create: `supabase/migrations/20260714120400_async_task_operations_summary.sql` and `lib/db/async-task-operations-summary-contract.test.ts` — safe staff aggregate RPC.
- Create: `app/api/async-tasks/operations/queues/[taskType]/route.ts`, `.test.ts` — audited organization queue pause/resume.
- Create: `components/async-tasks/async-task-center.tsx`, `.test.tsx` — responsive task list and actions.
- Create: `components/async-tasks/async-task-status.tsx`, `.test.tsx` — stable state/stage presentation.
- Create: `features/async-tasks/use-async-task-feed.ts`, `.test.tsx` — SSE with polling fallback.
- Modify: `components/reference-ui/custom-settlement-rule-api.js`, `.test.js` — accept synchronous `201` or queued `202` simulation responses.
- Modify: `components/reference-ui/custom-settlement-rule-workspace.jsx`, `.test.jsx` — durable simulation status and result refresh.
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`, `.test.jsx` — mobile processing strip and task center.
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`, `.test.jsx` — desktop processing route and notifications.
- Modify: `components/reference-ui/ops-reference.jsx`, `.test.jsx` — operations runtime center route.
- Modify: `app/(streamer-app)/m/(protected)/tasks/page.tsx` — initial visible tasks.
- Modify: `app/(streamer-desktop)/desktop/page.tsx`, `.test.tsx` — initial visible tasks.
- Modify: `app/(ops)/console/page.tsx`, `.test.tsx` — initial operations summary.

### Task 1: Build Access-Controlled Task Queries

**Files:**
- Modify: `features/async-tasks/repository.ts`
- Modify: `features/async-tasks/repository.test.ts`
- Create: `features/async-tasks/service.ts`
- Create: `features/async-tasks/service.test.ts`
- Create: `supabase/migrations/20260714120100_async_task_queue_estimates.sql`
- Create: `lib/db/async-task-queue-estimates-contract.test.ts`
- Create: `supabase/migrations/20260714120050_async_task_visible_reads.sql`
- Create: `lib/db/async-task-visible-reads-contract.test.ts`

- [ ] **Step 1: Write failing visibility tests**

Required cases:

```ts
it("lists every organization task for MCN staff", async () => {
  const tasks = await listVisibleAsyncTasks(deps, staffActor, { limit: 20 });
  expect(tasks.items.map((task) => task.id)).toEqual(["new-ocr", "old-recording"]);
});

it("limits a streamer to requested or owned source tasks", async () => {
  const tasks = await listVisibleAsyncTasks(deps, streamerActor, { limit: 20 });
  expect(tasks.items.map((task) => task.id)).toEqual(["own-ocr", "own-recording"]);
  expect(tasks.items).not.toContainEqual(expect.objectContaining({ id: "other-ocr" }));
});

it("returns not found instead of leaking an unauthorized task", async () => {
  await expect(getVisibleAsyncTask(deps, streamerActor, "ocr", "other-ocr"))
    .rejects.toThrow("Async task not found");
});

it("shows settlement simulations only to authorized MCN project staff", async () => {
  const staffTasks = await listVisibleAsyncTasks(deps, staffActor, { type: "settlement_simulation", limit: 20 });
  expect(staffTasks.items.map((task) => task.id)).toEqual(["own-project-simulation"]);
  await expect(listVisibleAsyncTasks(deps, streamerActor, { type: "settlement_simulation", limit: 20 }))
    .resolves.toEqual({ items: [], nextCursor: null });
});

it("returns a capacity-aware queue range instead of an exact countdown", async () => {
  const detail = await getVisibleAsyncTask(deps, staffActor, "recording_ai", "queued-recording");
  expect(detail.task.queue).toEqual({
    ahead: 3,
    expectedSecondsRange: [120, 360],
  });
});
```

The streamer query resolves owned `live_reports` and `recording_assets` first, then filters task sources. Settlement simulation jobs are visible only to MCN staff who retain access to the referenced project and draft. Staff queries remain organization-scoped. Never use an admin client in user routes.

Add SQL contract cases proving the queue-estimate function fixes `search_path`, verifies the authenticated caller belongs to the requested organization, returns no task IDs or cross-organization counts, limits duration history to 100 rows per task type, and is executable only by `authenticated` and `service_role`.

The visible-read SQL contract requires unified `list_visible_async_tasks` and `get_visible_async_task` functions to derive identity from `auth.uid()`, enforce MCN project access or streamer source ownership inside SQL, fix `search_path`, cap list size, and return only whitelisted columns/source IDs. Revoke from `public` and `anon`; grant to `authenticated` and `service_role`. This is necessary because the domain queue tables remain service-role/staff protected and user routes must not create an admin client.

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run lib/db/async-task-visible-reads-contract.test.ts lib/db/async-task-queue-estimates-contract.test.ts features/async-tasks/repository.test.ts features/async-tasks/service.test.ts`

Expected: FAIL because visible task methods and the queue-estimate migration do not exist.

- [ ] **Step 3: Implement list and detail services**

Export:

```ts
export type AsyncTaskListInput = {
  status?: AsyncTaskStatus;
  type?: AsyncTaskType;
  limit?: number;
  cursor?: string;
};

export async function listVisibleAsyncTasks(
  dependencies: AsyncTaskServiceDependencies,
  actor: AsyncTaskActor,
  input: AsyncTaskListInput,
): Promise<{ items: AsyncTaskDto[]; nextCursor: string | null }>;

export async function getVisibleAsyncTask(
  dependencies: AsyncTaskServiceDependencies,
  actor: AsyncTaskActor,
  type: AsyncTaskType,
  taskId: string,
): Promise<{ task: AsyncTaskDto; events: AsyncTaskEventDto[] }>;
```

The cursor is base64url JSON containing `{ createdAt, type, id }`. Reject malformed cursors with `Invalid async task cursor`. Call the unified visible-read RPC through the route's normal authenticated Supabase client; the function unions OCR, recording, and `settlement.simulate_large_sample` only after applying caller visibility and uses keyset pagination with `limit + 1`. Validate every returned row through the shared projection schema and fail closed on malformed data.

For queued tasks, calculate `queue.ahead` from claim ordering within the same task type and organization; the UI labels it as the caller organization's position, not a global rank. Estimate `expectedSecondsRange` from the de-identified rolling median duration of at most the last 100 successful platform tasks of that type, divided by currently healthy Worker capacity. Use a deliberately broad range around the estimate and never expose an exact completion timestamp. When there are fewer than five successful samples, no healthy capacity heartbeat, or the organization queue is paused, return `queue: null`. Keep the aggregation bounded and cover sparse-history, paused-queue, and stale-heartbeat cases in the service tests.

Implement `get_async_task_queue_estimate(task_type, task_id, organization_id)` as a `security definer` function with a fixed `search_path`. It validates the caller's organization membership, verifies the requested task is visible inside that organization, and returns only `{ ahead, expected_min_seconds, expected_max_seconds }`, with nullable range fields when evidence is insufficient. Sample counts, global Worker capacity, other organization volume, task IDs, exact global queue depth, and provider payloads remain internal to the function and are never returned. Revoke execution from `public` and `anon`; grant it to `authenticated` and `service_role`. The user route calls this narrow RPC through its normal authenticated Supabase client, never an admin client.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run lib/db/async-task-visible-reads-contract.test.ts lib/db/async-task-queue-estimates-contract.test.ts features/async-tasks/repository.test.ts features/async-tasks/service.test.ts`

Expected: PASS.

```bash
git add supabase/migrations/20260714120050_async_task_visible_reads.sql lib/db/async-task-visible-reads-contract.test.ts supabase/migrations/20260714120100_async_task_queue_estimates.sql lib/db/async-task-queue-estimates-contract.test.ts features/async-tasks/repository.ts features/async-tasks/repository.test.ts features/async-tasks/service.ts features/async-tasks/service.test.ts
git commit -m "feat: add visible async task service"
```

### Task 2: Add List, Detail, Retry, And Cancel APIs

**Files:**
- Create: `app/api/async-tasks/route.ts`
- Create: `app/api/async-tasks/route.test.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/route.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/route.test.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/retry/route.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/retry/route.test.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/cancel/route.ts`
- Create: `app/api/async-tasks/[taskType]/[taskId]/cancel/route.test.ts`
- Create: `supabase/migrations/20260714120200_async_task_user_actions.sql`
- Create: `lib/db/async-task-user-actions-contract.test.ts`
- Modify: `features/async-tasks/service.ts`
- Modify: `features/async-tasks/service.test.ts`

- [ ] **Step 1: Write failing route contracts**

Test 401 without auth, 404 for cross-organization or non-owned tasks, bounded list filters, and action permissions.

The SQL contract requires fixed `search_path`, `auth.uid()` caller checks, organization/project or streamer ownership checks, one transaction that changes task state and inserts its event, idempotent repeated actions, and no execution grant to `anon` or `public`.

```ts
const retry = await POST(
  new Request("http://localhost/api/async-tasks/ocr/job-1/retry", {
    method: "POST",
  }),
  { params: Promise.resolve({ taskType: "ocr", taskId: "job-1" }) },
);
expect(retry.status).toBe(200);
expect(retryAsyncTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: "job-1" }));
```

- [ ] **Step 2: Run and verify missing-route failures**

Run:

```bash
pnpm vitest run app/api/async-tasks/route.test.ts \
  "app/api/async-tasks/[taskType]/[taskId]/route.test.ts" \
  "app/api/async-tasks/[taskType]/[taskId]/retry/route.test.ts" \
  "app/api/async-tasks/[taskType]/[taskId]/cancel/route.test.ts"
```

Expected: FAIL.

- [ ] **Step 3: Implement action semantics**

`retryAsyncTask` may retry only `failed` tasks or retryable queued tasks whose `run_after` is in the future. It calls the authenticated `retry_visible_async_task` RPC, which increments `max_attempts` only for an explicit final-failure retry, clears lease ownership, sets `run_after=now`, and appends the event atomically. The application writes the audit after success.

`cancelAsyncTask` behavior:

- queued: call `cancel_visible_async_task` to change to `cancelled` and persist the terminal event atomically;
- running: set `cancel_requested_at`, return status `running` with `cancelRequested=true`;
- terminal: return the current task unchanged (idempotent);
- streamer: may act only on own tasks;
- staff: may act on organization tasks if existing role permissions allow task management.

Each action route response is `{ task }`. Unsupported task types or malformed payloads return 400; unauthorized ownership returns 404. The functions are `security definer` only to span domain tables and event insertion; they fix `search_path`, derive identity from `auth.uid()`, return no cross-organization information, and are called through the route's normal authenticated client.

- [ ] **Step 4: Run routes, service, and existing OCR action tests**

Run:

```bash
pnpm vitest run lib/db/async-task-user-actions-contract.test.ts app/api/async-tasks features/async-tasks/service.test.ts "app/api/ocr/jobs/[jobId]/route.test.ts" "app/api/recording-assets/[assetId]/ai-analysis/route.test.ts"
pnpm type-check
```

Expected: PASS.

- [ ] **Step 5: Commit APIs**

```bash
git add supabase/migrations/20260714120200_async_task_user_actions.sql lib/db/async-task-user-actions-contract.test.ts app/api/async-tasks features/async-tasks/service.ts features/async-tasks/service.test.ts
git commit -m "feat: add async task self-service APIs"
```

### Task 3: Add Reliable Completion Notifications

**Files:**
- Create: `supabase/migrations/20260714120000_async_task_notification_outbox.sql`
- Create: `lib/db/async-task-notification-contract.test.ts`
- Create: `features/async-tasks/task-notifications.ts`
- Create: `features/async-tasks/task-notifications.test.ts`
- Modify: `scripts/workers/watchdog.ts`

- [ ] **Step 1: Write failing outbox and service tests**

The SQL contract requires:

```sql
create table public.async_task_notification_dispatches (
  event_id bigint primary key references public.async_task_events(id) on delete cascade,
  status text not null check (status in ('processing', 'succeeded')),
  claimed_by text not null,
  lease_expires_at timestamptz not null,
  attempt integer not null default 1 check (attempt > 0),
  notification_id uuid references public.notifications(id),
  dispatched_at timestamptz,
  error_code text,
  updated_at timestamptz not null default now()
);

create unique index notifications_async_task_source_uidx
  on public.notifications (organization_id, source)
  where source like 'async-task:%';
```

The service test must prove a repeated terminal event produces one notification and marks its separate dispatch row succeeded only after `sendNotification` succeeds. It also proves an expired processing lease is reclaimable and an unexpired lease is not stolen.

```ts
expect(sendNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  source: "async-task:ocr:job-1:succeeded",
  objectType: "async_task",
  objectId: "job-1",
}));
```

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run lib/db/async-task-notification-contract.test.ts features/async-tasks/task-notifications.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the outbox consumer**

Add service-role-only `claim_async_task_notification_dispatches` and `complete_async_task_notification_dispatch` functions with fixed search paths, `FOR UPDATE SKIP LOCKED`, renewable leases, and bounded batches. The claim function selects terminal or `needs_confirmation` events that have no succeeded dispatch row, creates/reclaims a dispatch lease, and never updates the append-only event itself.

Export `dispatchPendingTaskNotifications(client, { limit, now, workerId })`. It claims dispatch rows, resolves `requested_by`, sends type `task`, and marks the dispatch succeeded only after delivery. Treat PostgreSQL `23505` from the notification source index as already delivered, resolve the existing notification ID, then complete the dispatch. A crash between notification insertion and dispatch completion therefore retries safely without creating a duplicate.

The watchdog calls this consumer every minute after stale Worker checks. Do not send notifications for ordinary stage changes or automatic retry transitions.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run lib/db/async-task-notification-contract.test.ts features/async-tasks/task-notifications.test.ts features/notifications`

Expected: PASS.

```bash
git add supabase/migrations/20260714120000_async_task_notification_outbox.sql lib/db/async-task-notification-contract.test.ts features/async-tasks/task-notifications.ts features/async-tasks/task-notifications.test.ts scripts/workers/watchdog.ts
git commit -m "feat: deliver async task notifications reliably"
```

### Task 4: Stream Persisted Task Events

**Files:**
- Create: `features/async-tasks/stream-adapter.ts`
- Create: `features/async-tasks/stream-adapter.test.ts`
- Create: `app/api/async-tasks/stream/route.ts`
- Create: `app/api/async-tasks/stream/route.test.ts`
- Create: `supabase/migrations/20260714120300_async_task_visible_events.sql`
- Create: `lib/db/async-task-visible-events-contract.test.ts`

- [ ] **Step 1: Write failing SSE tests**

Required cases:

- 401 without a valid session;
- sends only events visible to the actor;
- honors `Last-Event-ID`;
- emits heartbeat every 15 seconds;
- clears intervals when the request signal aborts;
- query failure errors the stream without emitting a fake terminal task event.
- returns retryable `503` with `Retry-After` when the per-process SSE connection cap or database health guard is reached, and releases the connection slot on every close path.

The SQL contract requires `list_visible_async_task_events_after` to fix `search_path`, derive the caller from `auth.uid()`, enforce the same staff/project/streamer ownership rules as task detail, cap batches at 500, and grant execution only to `authenticated` and `service_role`. It must not expose event rows for a merely shared organization when the streamer does not own the source task.

```ts
expect(body).toContain("event: task.updated");
expect(body).toContain('"taskId":"job-1"');
expect(body).not.toContain("other-org-job");
expect(response.headers.get("x-accel-buffering")).toBe("no");
```

- [ ] **Step 2: Run and verify missing adapter failures**

Run: `pnpm vitest run lib/db/async-task-visible-events-contract.test.ts features/async-tasks/stream-adapter.test.ts app/api/async-tasks/stream/route.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the stream adapter**

Follow `features/ai/conversation-stream-adapter.ts` headers and cleanup style. Export:

```ts
export function createAsyncTaskEventStream(input: {
  actor: AsyncTaskActor;
  request: Request;
  listVisibleEventsAfter: (cursor: number) => Promise<AsyncTaskEventDto[]>;
  pollMs?: number;
  heartbeatMs?: number;
}): Response;
```

Poll persisted events through `list_visible_async_task_events_after` on the route's normal authenticated client in batches every 2 seconds, send `id: <event.id>`, `event: task.updated`, and JSON data. Heartbeats are comments (`: heartbeat`) so they do not advance the task event cursor. Never stream an event before it exists in `async_task_events`. Enforce `ASYNC_TASK_SSE_MAX_CONNECTIONS` with a small per-process semaphore and a cheap injected database-health guard; reject before allocating poll timers when protection is active. The client treats this `503` exactly like a stream error and immediately uses polling.

- [ ] **Step 4: Run and commit SSE**

Run: `pnpm vitest run lib/db/async-task-visible-events-contract.test.ts features/async-tasks/stream-adapter.test.ts app/api/async-tasks/stream/route.test.ts`

Expected: PASS.

```bash
git add supabase/migrations/20260714120300_async_task_visible_events.sql lib/db/async-task-visible-events-contract.test.ts features/async-tasks/stream-adapter.ts features/async-tasks/stream-adapter.test.ts app/api/async-tasks/stream
git commit -m "feat: stream persisted async task events"
```

### Task 5: Build The Shared Task Center

**Files:**
- Create: `components/async-tasks/async-task-status.tsx`
- Create: `components/async-tasks/async-task-status.test.tsx`
- Create: `components/async-tasks/async-task-center.tsx`
- Create: `components/async-tasks/async-task-center.test.tsx`
- Create: `features/async-tasks/use-async-task-feed.ts`
- Create: `features/async-tasks/use-async-task-feed.test.tsx`

- [ ] **Step 1: Write failing UI and feed tests**

Test stable Chinese labels, no indefinite generic spinner, action availability, reconnect, and polling fallback.

```tsx
render(<AsyncTaskStatus task={recordingTask({ status: "running", stage: "transcribing" })} />);
expect(screen.getByText("语音转写中")).toBeInTheDocument();
expect(screen.queryByText("处理中...")).not.toBeInTheDocument();

render(<AsyncTaskCenter tasks={[failedOcr]} onRetry={retry} onCancel={cancel} />);
await user.click(screen.getByRole("button", { name: "重新识别" }));
expect(retry).toHaveBeenCalledWith("ocr", failedOcr.id);
```

The feed test mocks a failed `EventSource` connection and expects `/api/async-tasks` polling at 2 seconds, then 15 seconds while `document.hidden` is true.

- [ ] **Step 2: Run and verify missing-component failures**

Run: `pnpm vitest run components/async-tasks features/async-tasks/use-async-task-feed.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement status and stage presentation**

Use Lucide icons: `Clock3` queued, `LoaderCircle` running, `CircleCheck` succeeded, `TriangleAlert` failed, `CircleHelp` needs confirmation, `Ban` cancelled, `RotateCcw` retry, and `X` cancel. Icon-only controls require `aria-label` and `title`.

Cards use at most 8px radius, stable min-height, no nested cards, and text wraps at narrow mobile widths. Show approximate queue information only when the API provides it; do not fabricate an ETA.

- [ ] **Step 4: Implement SSE with polling fallback**

`useAsyncTaskFeed` accepts initial tasks and exposes `{ tasks, connection, refresh, retry, cancel }`. Use native `EventSource` for GET SSE. On stream error, close it and poll. After a successful refresh, retry SSE with capped exponential reconnect (`2s, 5s, 15s, 30s`). Server results always replace local optimistic state.

- [ ] **Step 5: Run accessibility-focused tests and commit**

Run:

```bash
pnpm vitest run components/async-tasks features/async-tasks/use-async-task-feed.test.tsx
pnpm eslint components/async-tasks features/async-tasks/use-async-task-feed.ts
```

Expected: PASS.

```bash
git add components/async-tasks features/async-tasks/use-async-task-feed.ts features/async-tasks/use-async-task-feed.test.tsx
git commit -m "feat: add resilient async task center"
```

### Task 6: Integrate Durable Simulation Into The Settlement Rule Workspace

**Files:**
- Modify: `components/reference-ui/custom-settlement-rule-api.js`
- Modify: `components/reference-ui/custom-settlement-rule-api.test.js`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.test.jsx`

- [ ] **Step 1: Write failing queued-simulation journey tests**

Cover both response modes. A `201` simulation continues the current flow unchanged. A `202 { task }` response shows `结算试算已排队`, the current stage, approximate organization queue range when available, and a clear statement that the user may leave the page. Refreshing or reopening the workspace must recover the server task instead of losing progress.

Simulate an SSE failure and prove polling continues. Simulate terminal success and prove the workspace reloads the authoritative rule session/simulation before enabling impact review and user confirmation. Simulate terminal failure and prove retry plus the existing visual/manual rule editor remain available; AI/Worker failure cannot block core settlement authoring.

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.test.jsx`

Expected: FAIL because `202` is not represented in the workspace.

- [ ] **Step 3: Implement the durable handoff**

Return a discriminated `{ mode: "completed", ... } | { mode: "queued", task }` result from the API helper. Embed the shared task status/feed without nesting cards. Filter to the current settlement draft source. On success, refetch the existing session endpoint and use its persisted simulation; never construct a local success result from SSE metadata. Keep natural-language AI drafting and clarification on the existing Xingyao streaming conversation protocol. Only the deterministic large-sample calculation is backgrounded.

- [ ] **Step 4: Run and commit the settlement experience**

Run:

```bash
pnpm vitest run components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.test.jsx components/async-tasks features/async-tasks/use-async-task-feed.test.tsx
pnpm eslint components/reference-ui/custom-settlement-rule-api.js components/reference-ui/custom-settlement-rule-workspace.jsx
```

Expected: PASS.

```bash
git add components/reference-ui/custom-settlement-rule-api.js components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-workspace.test.jsx
git commit -m "feat: show durable settlement simulation progress"
```

### Task 7: Integrate Streamer Mobile And Desktop

**Files:**
- Modify: `app/(streamer-app)/m/(protected)/tasks/page.tsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `app/(streamer-desktop)/desktop/page.tsx`
- Modify: `app/(streamer-desktop)/desktop/page.test.tsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Write failing integration tests**

Mobile: an OCR task survives rerender, shows `截图识别中`, and opens the task center from the task card.

Desktop: add a `处理任务` view; a completed recording task opens its recording result, and a failed OCR task offers manual entry rather than blocking submission.

- [ ] **Step 2: Run and verify the UI is absent**

Run: `pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx "app/(streamer-desktop)/desktop/page.test.tsx"`

Expected: FAIL on missing task labels/routes.

- [ ] **Step 3: Load and pass initial task DTOs**

Server pages call `listVisibleAsyncTasks` with the authenticated actor and `limit: 20`. Pass `asyncTasks` to reference apps. Keep the existing live-task and notification loaders unchanged.

- [ ] **Step 4: Embed the shared center**

Mobile places a compact status row inside the affected live task and a full-screen unframed `处理任务` route. Desktop adds a sidebar/tab entry with icon and unread action count. Completion notifications continue opening existing notification surfaces.

OCR final failure must offer `手动填写` and route back to the existing report confirmation form. Recording results route to the existing recording asset detail.

- [ ] **Step 5: Run and commit streamer integration**

Run:

```bash
pnpm vitest run components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx "app/(streamer-desktop)/desktop/page.test.tsx"
pnpm test:ui-smoke
```

Expected: PASS.

```bash
git add "app/(streamer-app)/m/(protected)/tasks/page.tsx" components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx "app/(streamer-desktop)/desktop/page.tsx" "app/(streamer-desktop)/desktop/page.test.tsx" components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git commit -m "feat: surface background tasks to streamers"
```

### Task 8: Add The Operations Runtime Center

**Files:**
- Create: `app/api/async-tasks/operations/route.ts`
- Create: `app/api/async-tasks/operations/route.test.ts`
- Create: `app/api/async-tasks/operations/queues/[taskType]/route.ts`
- Create: `app/api/async-tasks/operations/queues/[taskType]/route.test.ts`
- Create: `features/async-tasks/operations.ts`
- Create: `features/async-tasks/operations.test.ts`
- Create: `supabase/migrations/20260714120400_async_task_operations_summary.sql`
- Create: `lib/db/async-task-operations-summary-contract.test.ts`
- Modify: `app/(ops)/console/page.tsx`
- Modify: `app/(ops)/console/page.test.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing operations tests**

Require staff-only access, fail-closed metrics, Worker offline derivation from database time, queue counts for all three task types, oldest wait, 24-hour success/failure, provider breaker state, scheduled-run recovery state, and protection state.

```ts
expect(summary).toMatchObject({
  queues: {
    ocr: { queued: 4, running: 2, oldestQueuedSeconds: 61 },
    recordingAi: { queued: 1, running: 1, oldestQueuedSeconds: 120 },
    settlementSimulation: { queued: 2, running: 1, oldestQueuedSeconds: 45 },
  },
  workers: [expect.objectContaining({ workerId: "ocr:host-a:1", online: false })],
});
```

- [ ] **Step 2: Run and verify red state**

Run: `pnpm vitest run lib/db/async-task-operations-summary-contract.test.ts features/async-tasks/operations.test.ts app/api/async-tasks/operations/route.test.ts components/reference-ui/ops-reference.test.jsx`

Expected: FAIL.

- [ ] **Step 3: Implement health queries and route**

Create `get_async_task_operations_summary(organization_id)` as a fixed-search-path, `security definer` RPC that derives the caller from `auth.uid()`, requires MCN staff in that organization, returns bounded aggregates/read-only Worker and breaker health, and never returns task payloads or cross-organization counts. Revoke from `public`/`anon`, grant to `authenticated`/`service_role`, and cover these constraints in the SQL contract.

The route calls that RPC through its normal authenticated client and returns `{ summary }`. Database errors return 503 `Task runtime health is unavailable`; never return fake zeros. Keep the existing recording queue-health route for compatibility but implement it through the shared operations query.

Add `POST /api/async-tasks/operations/queues/[taskType]` with actions `pause` and `resume`. It upserts `async_task_queue_controls` only for the authenticated organization, requires `owner` or `ops_manager`, and writes an audit log. Worker rows are read-only in tenant UI; global Worker drain remains a Tencent server operation. Cross-organization queue controls are impossible through the route context and RLS.

- [ ] **Step 4: Add the `任务运行` screen**

Add route key `async-tasks` to existing navigation. The screen contains full-width queue metrics, a read-only Worker table, service protection banners, filters, and the shared task center. It must not nest cards; use table/bands for operational density. Controls include refresh, organization queue pause/resume, retry, cancel, and handoff-to-manual, all with permission checks and confirmation where destructive.

- [ ] **Step 5: Run and commit operations UI**

Run:

```bash
pnpm vitest run lib/db/async-task-operations-summary-contract.test.ts features/async-tasks/operations.test.ts app/api/async-tasks/operations/route.test.ts components/reference-ui/ops-reference.test.jsx "app/(ops)/console/page.test.tsx"
pnpm test:ui-smoke
pnpm type-check
```

Expected: PASS.

```bash
git add supabase/migrations/20260714120400_async_task_operations_summary.sql lib/db/async-task-operations-summary-contract.test.ts features/async-tasks/operations.ts features/async-tasks/operations.test.ts app/api/async-tasks/operations "app/(ops)/console/page.tsx" "app/(ops)/console/page.test.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add task runtime operations center"
```

### Task 9: Verify The Experience Phase

**Files:** no new files unless verification finds a scoped defect.

- [ ] **Step 1: Run the complete phase suite**

```bash
pnpm test:async-tasks
pnpm vitest run app/api/async-tasks components/async-tasks features/notifications components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx components/reference-ui/ops-reference.test.jsx
pnpm test:api-contracts
pnpm test:ui-smoke
pnpm type-check
pnpm eslint app/api/async-tasks components/async-tasks features/async-tasks
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Manually inspect desktop and mobile states**

Start the dev server and verify queued, running, needs-confirmation, failed, and succeeded examples at desktop and mobile widths. Confirm text does not overlap, buttons have stable dimensions, and SSE failure visibly falls back without losing task state.

- [ ] **Step 3: Commit only scoped fixes**

```bash
git commit -m "fix: close async task experience verification gaps"
```

## Phase 3 Exit Gate

- Users can leave and return without losing task state.
- SSE streams only persisted, authorized events and falls back to polling.
- Retry, cancel, manual OCR, and result navigation are explicit and audited.
- Queued settlement simulations return to the same rule workspace and never bypass impact review or user confirmation.
- Terminal/confirmation notifications are idempotent and recoverable.
- Operations health fails closed and exposes no business payload or secret.
- Existing notification, OCR, recording, settlement rule, streamer, and ops flows remain green.
