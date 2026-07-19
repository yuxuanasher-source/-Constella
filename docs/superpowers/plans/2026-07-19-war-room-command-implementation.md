# War Room Command Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Constella-style "今日指挥台" action queue to the existing `OverviewBoard` war-room entry without changing backend contracts or migrating routes.

**Architecture:** Keep the current `OverviewBoard` entry point and derive a command queue ViewModel from `dashboard.queue`, `dashboard.risks`, `reports`, `tasks`, `batches`, `projects`, and pending AI draft todos. Render a compact table-like command panel before the older KPI/overview blocks, with evidence, owner, impact, and next action for each row. Keep AI as the side panel and do not let it execute sensitive actions directly.

**Tech Stack:** React 19, existing Vitest + Testing Library tests, existing `components/dashboard/overview-board.jsx` component, no new dependencies.

---

## File Structure

- Modify: `components/dashboard/overview-board.test.jsx`
  - Add behavior tests for the new command queue.
  - Verify each row exposes priority, impact, evidence source, owner, and a routeable next action.
- Modify: `components/dashboard/overview-board.jsx`
  - Add `buildCommandQueueItems(...)` ViewModel helper.
  - Add `CommandQueuePanel` render helper.
  - Place the panel after the period/scope toolbar and before risk/KPI cards.
  - Add minimal CSS classes inside the existing component-local style tag.
- Verify: focused Vitest for `components/dashboard/overview-board.test.jsx`.

## Task 1: Command Queue Failing Test

**Files:**
- Modify: `components/dashboard/overview-board.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test near the other `OverviewBoard` layout tests:

```jsx
it("renders a daily command queue with impact evidence owner and next action", () => {
  const go = vi.fn();

  render(
    <OverviewBoard
      dashboard={{
        ...dashboard,
        queue: [
          {
            key: "queue-weak-evidence",
            title: "3 条弱证据即将超时",
            subtitle: "报数审核 · OCR 置信度低",
            tone: "red",
            target: { route: "reports", id: "report-risk" },
            sourceRef: "live_reports:weak-evidence",
            ownerLabel: "审核运营",
            impactLabel: "阻塞结算锁定",
          },
        ],
        risks: [
          {
            key: "risk-batch",
            title: "结算批次金额差异",
            subtitle: "批次 SET-0719-02",
            tone: "amber",
            target: { route: "settle", id: "batch-risk" },
            sourceRef: "settlement_batches:batch-risk",
          },
        ],
      }}
      projects={[]}
      tasks={[]}
      reports={[]}
      batches={[]}
      currentUser={{ name: "123", role: "owner" }}
      go={go}
    />,
  );

  const panel = screen.getByRole("region", { name: "今日指挥行动队列" });
  expect(within(panel).getByText("今日指挥台")).toBeInTheDocument();
  expect(within(panel).getByText("3 条弱证据即将超时")).toBeInTheDocument();
  expect(within(panel).getByText("阻塞结算锁定")).toBeInTheDocument();
  expect(within(panel).getByText("live_reports:weak-evidence")).toBeInTheDocument();
  expect(within(panel).getByText("审核运营")).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: /进入复核队列/ })).toBeInTheDocument();
  expect(within(panel).getByText("settlement_batches:batch-risk")).toBeInTheDocument();

  fireEvent.click(within(panel).getByRole("button", { name: /进入复核队列/ }));
  expect(go).toHaveBeenCalledWith("reports", "report-risk");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx -t "daily command queue"
```

Expected: FAIL because the region `今日指挥行动队列` does not exist yet.

## Task 2: Command Queue ViewModel and Panel

**Files:**
- Modify: `components/dashboard/overview-board.jsx`

- [ ] **Step 1: Implement minimal ViewModel helpers**

Add helpers before `OverviewBoard`:

```jsx
function buildCommandQueueItems({ dashboard, risks, reports, tasks, batches, projects, aiDraftTodos }) {
  const items = [];
  const add = (item) => {
    if (!item?.key || items.some((existing) => existing.key === item.key)) return;
    items.push(item);
  };

  for (const item of dashboard.queue || []) {
    add(normalizeCommandQueueItem(item, "queue"));
  }
  for (const item of risks || []) {
    add(normalizeCommandQueueItem(item, "risk"));
  }

  for (const report of reports || []) {
    if (!isPendingReport(report)) continue;
    add({
      key: `report:${report.id || report.taskId || report.projectId}`,
      priority: "高",
      tone: "red",
      title: "报数待复核",
      subtitle: report.projectName || report.streamerName || "待审报数",
      impact: "阻塞报数审核",
      evidence: report.id ? `live_reports:${report.id}` : "live_reports",
      owner: "审核运营",
      actionLabel: "进入复核队列",
      target: { route: "reports", id: report.id },
    });
  }

  for (const todo of aiDraftTodos || []) {
    add({
      key: todo.key,
      priority: "AI",
      tone: "violet",
      title: todo.text,
      subtitle: "AI 已生成草稿，待人工确认",
      impact: "待审阅产物",
      evidence: todo.draftId ? `ai_drafts:${todo.draftId}` : "ai_drafts",
      owner: "项目经理",
      actionLabel: "审阅草稿",
      target: { route: todo.route || "warroom", id: todo.targetId },
    });
  }

  return items.slice(0, 6);
}
```

- [ ] **Step 2: Render the command panel**

Add `CommandQueuePanel` before `OverviewBoard` and render it after the toolbar.

Expected properties per row:

- priority chip
- title and subtitle
- impact
- evidence
- owner
- action button calling `go(route, id)`

- [ ] **Step 3: Run test to verify it passes**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx -t "daily command queue"
```

Expected: PASS.

## Task 3: Visual Alignment and Existing Regression Tests

**Files:**
- Modify: `components/dashboard/overview-board.jsx`
- Test: `components/dashboard/overview-board.test.jsx`

- [ ] **Step 1: Add compact Constella-style CSS**

Add classes to the existing `<style>` block:

```css
.ob-command-queue-card{background:#fff;border:1px solid #e5e6eb;border-radius:6px;box-shadow:0 1px 2px rgba(29,33,41,.04)}
.ob-command-queue-table{display:grid;grid-template-columns:82px minmax(220px,1.3fr) minmax(120px,.8fr) minmax(170px,1fr) 96px 120px}
.ob-command-queue-row{display:contents}
.ob-command-queue-cell{min-width:0;padding:11px 12px;border-top:1px solid #e5e6eb;font-size:12px;color:#4e5969}
.ob-command-queue-head .ob-command-queue-cell{border-top:0;background:#fbfcfe;color:#86909c;font-weight:500}
```

- [ ] **Step 2: Run focused overview board tests**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx
```

Expected: PASS.

## Task 4: Final Verification and Commit

**Files:**
- Modify: `components/dashboard/overview-board.jsx`
- Modify: `components/dashboard/overview-board.test.jsx`
- Already added: `docs/superpowers/plans/2026-07-19-war-room-command-implementation.md`

- [ ] **Step 1: Run scoped checks**

Run:

```bash
git diff --check
pnpm vitest run components/dashboard/overview-board.test.jsx
pnpm type-check
```

Expected: all pass or only pre-existing unrelated failures explicitly documented.

- [ ] **Step 2: Commit scoped implementation**

Stage only:

```bash
git add docs/superpowers/plans/2026-07-19-war-room-command-implementation.md components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx
git commit -m "feat: add war room command queue"
```

## Self-Review

Spec coverage:

- First screen says what to do first: Task 2 command queue.
- Evidence source and owner visible: Task 1 test and Task 2 panel.
- AI remains explanatory/draft-only: Task 2 only reads AI drafts, action label is "审阅草稿".
- Constella visual rules: Task 3 compact white/gray table styling.
- No backend/API/RBAC/database changes: all tasks are UI/ViewModel only.

Placeholder scan: no TBD/TODO placeholders. Every test and command is explicit.

Type consistency: helpers use existing plain JS data conventions in `overview-board.jsx`; no new TypeScript types.
