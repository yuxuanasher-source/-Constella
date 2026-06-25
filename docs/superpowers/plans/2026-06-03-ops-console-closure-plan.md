# 经营舱功能闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining practical business gaps in the ops console, starting with existing API-backed flows and ending with a verified acceptance report.

**Architecture:** Keep the current `OpsReferenceApp` shell, but convert UI-only buttons into one of four outcomes: API action, local filter, cross-module navigation, or explicit read-only/out-of-scope state. Avoid broad component rewrites while the reference UI is still centralized in `components/reference-ui/ops-reference.jsx`.

**Tech Stack:** Next.js App Router, React, Supabase query/services, Vitest, Testing Library, existing `/api/*` route handlers.

---

## Stage 0: Plan And Design

**Files:**

- Create: `docs/superpowers/specs/2026-06-03-ops-console-closure-design.md`
- Create: `docs/superpowers/plans/2026-06-03-ops-console-closure-plan.md`

- [ ] **Step 1: Save the design and plan**

Write the design and this plan so each later stage can be executed without asking for scope confirmation.

- [ ] **Step 2: Verify docs are staged cleanly**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-03-ops-console-closure-design.md docs/superpowers/plans/2026-06-03-ops-console-closure-plan.md
git commit -m "docs: plan ops console closure"
```

## Stage 1: M2 Streamer Pool Core Closure

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Optionally modify: `features/ui-route-contracts/module-route-map.ts`

- [ ] **Step 1: Write failing UI tests**

Add tests that prove:

- streamer search/filter reduces the displayed table rows;
- “新增主播档案” posts to `/api/streamers` and refreshes `/api/streamers`;
- “设置风险” posts to `/api/streamers/:id/risk` and refreshes;
- “邀请加入项目” posts to `/api/projects/:projectId/invitations`;
- “导出主播表” posts to `/api/exports` with `kind: "project_execution"` or another allowed current export kind and a safe streamer-shaped payload.

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx -t "streamer"
```

Expected: fail because controls are not wired yet.

- [ ] **Step 2: Implement local filters and dialogs**

In `ScreenStreamers`, add state for search, category, source, cooperation, risk, create dialog, risk dialog, invite dialog, and export result. Use existing `Button`, `DataTable`, `FormField`, `Drawer`, `SearchInput`, and `Badge` patterns.

- [ ] **Step 3: Wire existing actions**

Use existing `actions.createStreamerProfile`, `actions.updateStreamerRisk`, and add `actions.inviteStreamerToProject(projectId, streamerId)` in `OpsReferenceInner`.

- [ ] **Step 4: Wire governed export**

Call `actions.createGovernedExport` from the streamer export button. If export definitions do not have a streamer-specific kind, use the existing closest safe kind and document the compromise in the stage report.

- [ ] **Step 5: Verify Stage 1**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx
pnpm test:ui-smoke
pnpm type-check
```

Expected: all pass.

- [ ] **Step 6: Commit Stage 1**

```bash
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx features/ui-route-contracts/module-route-map.ts
git commit -m "feat: close streamer pool ops actions"
```

## Stage 2: M1 Project Management Secondary Closure

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing tests**

Cover project search/vendor/owner/time filters, project export, vendor delivery export, and “新建排班” navigation to M4.

- [ ] **Step 2: Implement filters**

Use controlled state in `ProjectList`. Filter by search, vendor, owner, and date bucket.

- [ ] **Step 3: Implement exports and navigation**

Call `actions.createGovernedExport` for project and vendor delivery exports. Route “新建排班” to `go("tasks", { projectId })` or equivalent route state.

- [ ] **Step 4: Verify and commit**

Run focused tests, `pnpm test:ui-smoke`, `pnpm type-check`, then commit:

```bash
git commit -m "feat: close project management secondary actions"
```

## Stage 3: M4 Schedule And Task Secondary Closure

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing tests**

Cover project/streamer/status filters, scan anomalies call, task detail “查看报数” navigation, and streamer preview navigation.

- [ ] **Step 2: Implement filters and navigation**

Make controls affect `visibleTasks`; wire navigation buttons to M5 or streamer task route.

- [ ] **Step 3: Wire anomaly scan**

Add action calling `/api/anomalies/scan` and show result count/error.

- [ ] **Step 4: Verify and commit**

Run focused tests, `pnpm test:ui-smoke`, `pnpm type-check`, then commit:

```bash
git commit -m "feat: close schedule task secondary actions"
```

## Stage 4: M5/M6 Report And Settlement Enhancements

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing tests**

Cover report filters, bulk approve, export details, checkbox-driven review payload, settlement form submission, settlement export, and audit navigation.

- [ ] **Step 2: Implement report enhancements**

Add controlled filters, batch approve loop, governed export, and checkbox payload handling.

- [ ] **Step 3: Replace settlement prompts with drawers**

Create form drawers for batch creation and manual item creation using existing form patterns.

- [ ] **Step 4: Implement settlement exports/navigation**

Use `actions.createGovernedExport` for settlement export. Route “查看审计” to M7.

- [ ] **Step 5: Verify and commit**

Run focused tests, `pnpm test:ui-smoke`, `pnpm test:manual-acceptance-smoke`, `pnpm type-check`, then commit:

```bash
git commit -m "feat: close report and settlement operations"
```

## Stage 5: Shell, War Room, Billing, Org Route Status

**Files:**

- Modify: `components/layouts/ops-shell.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `features/ui-route-contracts/module-route-map.ts`
- Modify tests under `features/ui-route-contracts/`

- [ ] **Step 1: Write failing tests**

Cover top bell navigation, M10 secondary button behavior, M11 read-only boundaries, and route contract status changes.

- [ ] **Step 2: Wire shell notification navigation**

Make the top bell link to `/console/stubs/m9` while preserving unread badge.

- [ ] **Step 3: Clean M10/M11 remaining buttons**

Convert remaining M10 buttons to API calls, exports, or explicit disabled/read-only labels. Keep M11 payment/tier-change behind a hard-gate label.

- [ ] **Step 4: Update route statuses**

Move M2 from `stub` to `partial` or `live` after Stage 1. Keep M0 honest unless a real org backend slice is implemented.

- [ ] **Step 5: Final verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm test:ui-smoke
pnpm test:manual-acceptance-smoke
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: close ops shell and route status gaps"
```
