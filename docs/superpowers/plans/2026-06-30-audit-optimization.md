# Code Audit Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two audit findings from 2026-06-30: keep local agent/editor artifacts out of the repo, and make war-room report action counts route to the same normalized report queue that the review screen uses.

**Architecture:** Treat local agent/plugin folders as workstation state, not product source. Treat report actionability as a shared status-normalization concern inside `components/reference-ui/ops-reference.jsx`, so the war-room count, nav badge, and report review screen all agree on `pending_review` and `need_supply`.

**Tech Stack:** Next.js 16 App Router, React 19, Vitest, Testing Library, ESLint, TypeScript, PowerShell on Windows.

---

## File Structure

- Modify: `.gitignore`
  - Responsibility: exclude local agent/editor bundles and generated tool state from normal Git status.
- Modify: `components/reference-ui/ops-reference.jsx`
  - Responsibility: normalize report statuses before storing prop-backed report state and before counting actionable reports.
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - Responsibility: prove legacy/raw report props are normalized into the same queue the report review screen displays.
- Verify only: `app/dev/ops-console-preview/page.tsx`
  - Responsibility: keep production behavior returning `notFound()`; no code change needed unless verification regresses.

---

## Task 1: Repository Hygiene Guard

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Confirm current untracked local-tool noise**

Run:

```powershell
git status --short
git ls-files --others --exclude-standard | ForEach-Object { ($_ -split '/|\\')[0] } | Group-Object | Sort-Object Count -Descending | Select-Object Count,Name
```

Expected: `.agents`, `.claude`, `.github`, `.obsidian`, `.codex`, `.claudian`, and `.impeccable` dominate the untracked list.

- [ ] **Step 2: Add local tool ignores**

Append this block to `.gitignore` after the existing debug/local sections:

```gitignore
# local agent/editor workspaces
/.agents/
/.claude/
/.codex/
/.claudian/
/.impeccable/
/.obsidian/
/.github/hooks/
/.github/skills/
```

Do not ignore `.github/` as a whole, because real workflows and issue templates may belong in source control.

- [ ] **Step 3: Verify the noise is gone**

Run:

```powershell
git status --short
git ls-files --others --exclude-standard | Measure-Object
```

Expected: local agent/editor directories no longer appear. Intended product docs such as `DESIGN.md`, `PRODUCT.md`, `_latest-docs/`, `docs/...`, and `app/dev/...` may still appear until the owner decides whether to keep them.

---

## Task 2: Report Status Normalization

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Test: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write the failing regression test**

Add this test inside `describe("OpsReferenceApp war room smoke", () => { ... })` in `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("normalizes submitted pending report props before opening the report review queue", () => {
  render(
    <OpsReferenceApp
      initialRoute="warroom"
      projectCards={taskProjectCards}
      streamerCards={taskStreamerCards}
      liveReports={[
        {
          id: "report-review",
          taskId: "task-risk",
          projectId: "project-live",
          projectName: "Fixture Project",
          streamerId: "streamer-one",
          streamerName: "Streamer One",
          reviewStatus: "pending",
          status: "submitted",
          evidenceLevel: "yellow",
          settlementDuration: 90,
          viewers: 1200,
          timeSource: "claimed",
          submittedAt: "2026-06-28T12:05:00.000Z",
        },
      ]}
    />,
  );

  expect(screen.getByText("先处理待审核报数")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "去报数审核" }));

  expect(screen.getByText("报数审核")).toBeInTheDocument();
  expect(screen.getByText("Streamer One")).toBeInTheDocument();
  expect(screen.getByText("Fixture Project")).toBeInTheDocument();
  expect(screen.getByText("待审核")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run components/reference-ui/ops-reference.test.jsx -t "normalizes submitted pending report props"
```

Expected before implementation: FAIL because the war-room count treats the report as actionable, but the report review screen filters it out when `status` remains `submitted`.

- [ ] **Step 3: Add shared report status helpers**

In `components/reference-ui/ops-reference.jsx`, replace the current `countActionableReports` helper with this normalized version:

```jsx
function normalizeReferenceReportStatus(report) {
  const status = report?.status;
  const reviewStatus = report?.reviewStatus || report?.review_status;

  if (status === "pending_adjudication") return "pending_review";
  if (status === "need_more") return "need_supply";

  if (
    status === "submitted" &&
    ["pending", "pending_review", "submitted"].includes(reviewStatus)
  ) {
    return "pending_review";
  }

  return status || "pending_review";
}

function normalizeReferenceReports(reports) {
  if (!Array.isArray(reports)) return reports ?? null;

  return reports.map((report) => ({
    ...report,
    status: normalizeReferenceReportStatus(report),
  }));
}

function countActionableReports(reports) {
  return reports.filter((report) =>
    ["pending_review", "need_supply"].includes(
      normalizeReferenceReportStatus(report),
    ),
  ).length;
}
```

- [ ] **Step 4: Normalize prop-backed report state**

In `OpsReferenceInner`, change the `reportsState` initialization and prop-sync effect from direct assignment to the helper:

```jsx
const [reportsState, setReportsState] = React.useState(() =>
  normalizeReferenceReports(liveReports),
);
```

```jsx
React.useEffect(() => {
  setReportsState(normalizeReferenceReports(liveReports));
}, [liveReports]);
```

This makes externally provided `liveReports` follow the same queue semantics as reports fetched through the API adapter.

- [ ] **Step 5: Run the regression test and existing war-room smoke tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run components/reference-ui/ops-reference.test.jsx -t "war room smoke"
```

Expected: PASS. The new test proves the action queue and report review screen agree.

---

## Task 3: Dev Preview Route Safety Check

**Files:**

- Verify only: `app/dev/ops-console-preview/page.tsx`
- Test: `app/dev/ops-console-preview/page.test.tsx`

- [ ] **Step 1: Keep the current production guard**

Do not change this guard unless production verification fails:

```tsx
if (process.env.NODE_ENV === "production") {
  notFound();
}
```

- [ ] **Step 2: Run the route unit test**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run app/dev/ops-console-preview/page.test.tsx
```

Expected: PASS, including the production `notFound()` branch.

- [ ] **Step 3: Verify production server behavior after build**

Run:

```powershell
.\node_modules\.bin\next.cmd build
```

Then start the production server on an unused local port and request the route:

```powershell
$port = 3219
$proc = Start-Process -FilePath "node" -ArgumentList @("node_modules/next/dist/bin/next", "start", "-p", "$port") -WorkingDirectory $PWD -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/dev/ops-console-preview" -UseBasicParsing
  "Unexpected status: $($response.StatusCode)"
} catch {
  "Expected production status: $([int]$_.Exception.Response.StatusCode)"
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
```

Expected: `Expected production status: 404`.

---

## Task 4: Final Verification And Scoped Staging

**Files:**

- Verify: all touched files

- [ ] **Step 1: Run cheap diff safety**

Run:

```powershell
git diff --check
```

Expected: no output and exit code `0`.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run components/reference-ui/ops-reference.test.jsx app/dev/ops-console-preview/page.test.tsx
```

Expected: all tests pass. The prior audit baseline was 92 passing tests across these two files.

- [ ] **Step 3: Run static verification using local project binaries**

Run:

```powershell
.\node_modules\.bin\eslint.cmd components/reference-ui/ops-reference.jsx app/dev/ops-console-preview/page.tsx app/dev/ops-console-preview/page.test.tsx
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: both commands pass. Use local `.bin` commands because this checkout's `node_modules` was created with `pnpm@10.12.1`, while the current global Codex PATH may pick `pnpm@11.7.0` and try to purge `node_modules`.

- [ ] **Step 4: Run production build**

Run:

```powershell
.\node_modules\.bin\next.cmd build
```

Expected: build completes successfully and `/dev/ops-console-preview` remains unavailable in production.

- [ ] **Step 5: Stage only intended files**

Run:

```powershell
git status --short
git add .gitignore components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx app/dev/ops-console-preview/page.tsx app/dev/ops-console-preview/page.test.tsx docs/superpowers/plans/2026-06-30-audit-optimization.md
git status --short
```

Expected: no `.agents/`, `.claude/`, `.codex/`, `.claudian/`, `.impeccable/`, `.obsidian/`, `.github/hooks/`, or `.github/skills/` files are staged.

---

## Self-Review

- Spec coverage: Task 1 covers the repository hygiene finding. Task 2 covers the war-room/report queue status mismatch. Task 3 preserves the verified dev-route safety. Task 4 covers the exact verification chain for this checkout.
- Placeholder scan: no `TBD`, `TODO`, or undefined implementation steps remain.
- Type consistency: helpers use the existing plain JS style in `ops-reference.jsx`; tests use the existing React Testing Library/Vitest imports already present in `ops-reference.test.jsx`.
