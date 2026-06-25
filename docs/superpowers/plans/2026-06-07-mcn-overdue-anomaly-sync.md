# MCN Overdue Task Anomaly Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCN overdue pending-live tasks count and render consistently as operational anomalies.

**Architecture:** Keep the canonical task lifecycle status unchanged. Add a UI-level operational anomaly derivation for overdue pending-live tasks, then make metrics, anomaly filters, anomaly list, and drawer badges use that same derived anomaly key. Do not write back `abnormal` just because a task is overdue.

**Tech Stack:** Next.js App Router, React reference UI, Vitest, Testing Library, TypeScript DTO adapters.

---

## File Structure

- Modify `components/reference-ui/ops-reference.jsx`
  - Extend the existing task display derivation so overdue pending-live tasks expose an anomaly-like key.
  - Update anomaly metrics, anomaly tab filter, anomaly list, drawer anomaly badge, and helper copy.
- Modify `components/reference-ui/ops-reference.test.jsx`
  - Add regression tests proving overdue pending-live tasks appear in the anomaly count and anomaly list.
- Optional later hardening: `features/anomalies/anomaly-rules.ts`
  - Keep as source of backend scanner truth. No change is required for the UI consistency fix because it already defines `not_started`.

---

### Task 1: Define UI Anomaly Derivation

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Test: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write the failing test**

Add a test in `describe("OpsReferenceApp live task smoke", ...)`:

```jsx
it("counts overdue pending-live tasks as anomalies in the MCN task module", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-07T13:12:00.000Z"));

  try {
    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "task-overdue-anomaly",
            name: "Overdue Task",
            status: "pending_live",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-one",
            streamerName: "Streamer One",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            plannedStartAt: "2026-06-04T12:00:00.000Z",
            plannedEndAt: "2026-06-04T15:30:00.000Z",
            plannedDuration: 210,
            type: "project",
          },
        ]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    expect(screen.getByText("异常任务")).toHaveTextContent("1");
    expect(screen.getByText("异常任务").closest("button")).toHaveTextContent(
      "1",
    );
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "counts overdue pending-live"
```

Expected: FAIL because the anomaly count remains `0`.

- [ ] **Step 3: Implement the minimal helper**

In `components/reference-ui/ops-reference.jsx`, add:

```jsx
function getTaskOperationalAnomalyKey(task) {
  if (task?.anomaly) return task.anomaly;
  if (task?.status === "abnormal") return "abnormal";
  if (getTaskDisplayStatusKey(task) === "missed_live") return "not_started";
  return "";
}

function isTaskOperationalAnomaly(task) {
  return Boolean(getTaskOperationalAnomalyKey(task));
}
```

- [ ] **Step 4: Use the helper for counts and filtering**

Replace:

```jsx
const anomalyCount = tasks.filter(
  (t) => t.status === "abnormal" || t.anomaly,
).length;
```

with:

```jsx
const anomalyCount = tasks.filter(isTaskOperationalAnomaly).length;
```

For the anomaly tab, pass only anomaly tasks:

```jsx
<AnomalyList
  tasks={filteredTasks.filter(isTaskOperationalAnomaly)}
  projects={projects}
  streamers={streamers}
/>
```

- [ ] **Step 5: Run the test**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "counts overdue pending-live"
```

Expected: PASS.

---

### Task 2: Render Overdue Tasks in the Anomaly List

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Test: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write the failing test**

Extend the same test or add:

```jsx
it("shows overdue pending-live tasks in the anomaly task list", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-07T13:12:00.000Z"));

  try {
    render(
      <OpsReferenceApp
        initialRoute="tasks"
        liveTasks={[
          {
            id: "task-overdue-list",
            name: "Overdue List Task",
            status: "pending_live",
            project: "project-live",
            projectId: "project-live",
            projectName: "Fixture Project",
            streamerId: "streamer-one",
            streamerName: "Streamer One",
            dayIdx: 1,
            startHour: 20,
            endHour: 22,
            plannedStartAt: "2026-06-04T12:00:00.000Z",
            plannedEndAt: "2026-06-04T15:30:00.000Z",
            plannedDuration: 210,
            type: "project",
          },
        ]}
        projectCards={taskProjectCards}
        streamerCards={taskStreamerCards}
        applicationQueue={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /异常任务\s*1/ }));
    expect(screen.getByText("Overdue List Task")).toBeInTheDocument();
    expect(screen.getByText("已延期未直播")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "shows overdue pending-live"
```

Expected: FAIL because `AnomalyList` currently filters only `t.anomaly`.

- [ ] **Step 3: Update `AnomalyList`**

Change:

```jsx
const anomalies = tasks
  .filter((t) => t.anomaly)
  .map((t) => {
```

to:

```jsx
const anomalies = tasks
  .filter(isTaskOperationalAnomaly)
  .map((t) => {
    const anomalyKey = getTaskOperationalAnomalyKey(t);
```

Set:

```jsx
typeKey: anomalyKey,
```

- [ ] **Step 4: Add labels for the new UI anomaly key**

Extend `ANOMALY_TYPES`:

```jsx
not_started: { tone: "red", label: "已延期未直播" },
abnormal: { tone: "red", label: "异常" },
```

- [ ] **Step 5: Make anomaly explanation robust**

In the task drawer anomaly explanation, render text by `getTaskOperationalAnomalyKey(task)` instead of `task.anomaly`.

Use copy:

```jsx
taskAnomalyKey === "not_started" &&
  "计划窗口已结束但系统未记录开播，建议联系主播补充未直播原因或重新排班。";
```

- [ ] **Step 6: Run the test**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "shows overdue pending-live"
```

Expected: PASS.

---

### Task 3: Keep Status Filter Behavior Predictable

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Test: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Add status filter assertion**

In the overdue test, add:

```jsx
fireEvent.change(screen.getByLabelText("状态筛选"), {
  target: { value: "missed_live" },
});
expect(screen.getByText("Overdue List Task")).toBeInTheDocument();
```

- [ ] **Step 2: Run status filter regression**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "overdue"
```

Expected: PASS because `taskMatchesTaskFilters` already uses `getTaskDisplayStatusKey`.

---

### Task 4: Full Verification

**Files:**

- Verify only.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx features/live-operations/live-ui-adapters.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run static checks**

```bash
pnpm type-check
pnpm format:check
pnpm lint
```

Expected:

- `type-check`: exit 0
- `format:check`: exit 0
- `lint`: exit 0, allowing the known Babel deopt note for `components/reference-ui/ops-reference.jsx`

---

## Recommended Product Copy

- “已延期未直播” remains the user-facing status.
- “异常任务” should include “已延期未直播” because MCN operators need to handle it.
- Do not change the persisted task status to `abnormal` automatically; that would blur lifecycle state with operational risk state.

## Self-Review

- Spec coverage: covers anomaly count, anomaly list, drawer badge, status filter, and tests.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: uses existing task fields and existing display-status helper.
