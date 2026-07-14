# Admission Share Review Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public admission recording share page as a compact two-column review workbench with one in-page player and per-recording draft persistence.

**Architecture:** Keep the existing public share DTO and review API unchanged. Add local selected-recording state to the client, render items as a compact selectable queue, and bind the existing draft map plus source-aware player to the selected item only.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library.

---

### Task 1: Lock the workbench behavior with tests

**Files:**

- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

- [ ] **Step 1: Write the failing layout test**

Add assertions for the `待审录屏明细` and `录屏播放器` regions, three selectable recording rows, and exactly one initial video element for the first recording.

- [ ] **Step 2: Write the failing player-switch test**

Click the Bilibili row and assert that the single right-side player becomes an iframe whose source contains `player.bilibili.com/player.html`; then click the private upload row and assert that it becomes a video using the protected playback URL.

- [ ] **Step 3: Write the failing draft-persistence test**

Edit the first recording decision and remark, switch to a second recording and back, and assert that the first recording draft remains intact.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `pnpm vitest run "app/share/admission/[token]/admission-share-page-client.test.tsx"`

Expected: FAIL because the current page renders one large card and one player per recording and has no selectable workbench queue.

### Task 2: Implement the compact two-column workbench

**Files:**

- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`

- [ ] **Step 1: Add selected-recording state**

Track the selected recording submission ID, initialize it from the first returned item, and preserve it on refresh when the item still exists.

- [ ] **Step 2: Replace the hero and repeated cards**

Render a compact project information bar followed by a responsive two-column section. The left panel contains one row button per recording; the right panel renders only the selected item.

- [ ] **Step 3: Move review controls into the selected detail panel**

Bind decision, reason codes, and remark controls to the selected item's existing draft entry. Keep the full-board submit payload and version-lock validation unchanged.

- [ ] **Step 4: Keep source-aware playback in page**

Reuse the current URL detection: protected private uploads and direct media URLs use `video`; Bilibili and YouTube URLs use `iframe`; unsupported page URLs show an explicit fallback with the original link.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm vitest run "app/share/admission/[token]/admission-share-page-client.test.tsx"`

Expected: PASS with one player at a time and persisted per-recording drafts.

### Task 3: Verify the finished interface

**Files:**

- Verify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Verify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

- [ ] **Step 1: Run focused regression tests**

Run: `pnpm vitest run "app/share/admission/[token]/admission-share-page-client.test.tsx" "features/applications/admission-share-board.test.ts" "app/api/public/admission-share/[token]/recordings/[recordingSubmissionId]/route.test.ts"`

Expected: all focused admission-share tests pass.

- [ ] **Step 2: Run static verification**

Run: `pnpm type-check`

Run: `pnpm eslint "app/share/admission/[token]/admission-share-page-client.tsx" "app/share/admission/[token]/admission-share-page-client.test.tsx"`

Expected: both commands exit successfully.

- [ ] **Step 3: Run browser QA**

Open the public admission share route with fixture-compatible data, inspect desktop and mobile viewports, and confirm the queue, player, form, sticky behavior, focus states, and text wrapping are stable.

- [ ] **Step 4: Review the scoped diff**

Run: `git diff --check -- docs/superpowers/specs/2026-07-13-admission-share-review-workbench-design.zh-CN.md docs/superpowers/plans/2026-07-13-admission-share-review-workbench.md "app/share/admission/[token]/admission-share-page-client.tsx" "app/share/admission/[token]/admission-share-page-client.test.tsx"`

Expected: no whitespace errors and no unrelated files in the scoped diff.
