# 经营舱自动化开发计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把产品设计文档与开发计划转成可被编码 Agent 连续执行的自动化开发计划，从当前 P0 骨架开始，按 P1-P5 分期推进，每期有明确输入、任务、验证、提交和停顿确认点。

**Architecture:** 当前仓库已完成 P0 骨架：Next.js App Router、Supabase migration、RLS helper、审计/通知底座、三端外壳、项目草稿发布纵切片。后续自动化开发以“阶段门禁 + 纵切片优先 + 每期黄金路径回归”为主线，每个业务动作必须经过 DB RLS、服务端 RBAC、审计、通知和字段脱敏边界。

**Tech Stack:** Next.js App Router, React, TypeScript strict, Tailwind CSS, shadcn-style components, Supabase Postgres with RLS, Supabase Auth, Supabase Storage, Vitest, ESLint, Prettier.

---

## Automation Operating Rules

- [ ] **Step 1: Start every phase from source documents**

  Read `C:/Users/admin/Desktop/经营舱-产品设计文档.md` and `C:/Users/admin/Desktop/经营舱-开发计划.md`. Extract only the phase being implemented plus upstream dependencies. Do not implement later-phase business logic early.

- [ ] **Step 2: Create a phase checklist before code**

  For each phase, create `docs/checklists/PX-<phase-name>.md` with:

  ```markdown
  # PX Checklist

  ## Scope In

  - [ ] Requirement copied from source document

  ## Scope Out

  - [ ] Later phase item intentionally deferred

  ## Security Boundaries

  - [ ] RLS policy exists for each new table
  - [ ] Service action checks role
  - [ ] Sensitive fields are returned through view or DTO
  - [ ] Write operation calls audit service

  ## Verification

  - [ ] pnpm lint
  - [ ] pnpm type-check
  - [ ] pnpm test
  - [ ] pnpm build
  - [ ] pnpm supabase db reset
  - [ ] Golden path smoke test
  ```

- [ ] **Step 3: Use migration-first development for data changes**

  Add or alter database schema only in `supabase/migrations/*.sql`. Add matching seed records in `supabase/seed.sql` only when the UI or golden path needs non-empty demo data.

- [ ] **Step 4: Use TDD for domain and service behavior**

  For every state machine, permission rule, calculation, parser, or service action, add a failing `*.test.ts` first, run it, implement the smallest code, then run it green.

- [ ] **Step 5: Commit per logical slice**

  Each commit must represent one deployable slice:

  ```bash
  pnpm lint
  pnpm type-check
  pnpm test
  pnpm build
  git add .
  git commit -m "<type>: <slice summary>"
  ```

- [ ] **Step 6: Stop at phase gates**

  After P1, P2, P3, P4, and P5, stop and ask the product owner to confirm before continuing. Do not silently proceed into the next phase.

---

## Task 0: P0 Stabilization Gate

**Files:**

- Verify: `supabase/migrations/20260601161000_initial_foundation.sql`
- Verify: `supabase/seed.sql`
- Verify: `README.md`
- Modify only if verification exposes a concrete issue.

- [ ] **Step 1: Start Docker Desktop and apply the database**

  Run:

  ```bash
  pnpm supabase db reset
  ```

  Expected: migrations apply, seed loads five demo users, no SQL errors.

- [ ] **Step 2: Login smoke test five roles**

  Use:

  ```text
  owner@jy-demo.local / Password123!
  ops@jy-demo.local / Password123!
  operator@jy-demo.local / Password123!
  finance@jy-demo.local / Password123!
  streamer@jy-demo.local / Password123!
  ```

  Expected:
  - owner and ops_manager can publish draft projects.
  - operator_business can create drafts but cannot publish.
  - finance sees read-oriented shell.
  - streamer is directed to streamer-facing shell.

- [ ] **Step 3: Verify P0 commands**

  Run:

  ```bash
  pnpm lint
  pnpm type-check
  pnpm test
  pnpm build
  ```

  Expected: all pass.

- [ ] **Step 4: Commit only fixes**

  If P0 stabilization required changes:

  ```bash
  git add .
  git commit -m "fix: stabilize P0 local database workflow"
  ```

---

## Task 1: P1-1 Project Management Completion

**Files:**

- Modify: `features/projects/*`
- Modify: `app/(ops)/console/projects/page.tsx`
- Modify: `supabase/migrations/*.sql`
- Test: `features/projects/*.test.ts`
- Create: `docs/checklists/P1-project-management.md`

- [ ] **Step 1: Extend project schema from M1 fields**

  Add migration fields for vendor/product/agent references if needed by the selected M1 UI, plus owners, dates, admission rules, and default settlement rule fields already present in P0.

- [ ] **Step 2: Add project status tests**

  Extend `features/projects/project-state.test.ts` to cover:

  ```typescript
  expect(() => assertProjectTransition("recruiting", "active")).not.toThrow();
  expect(() => assertProjectTransition("active", "settling")).toThrow();
  expect(() => assertProjectTransition("ended", "settling")).not.toThrow();
  ```

- [ ] **Step 3: Implement project edit service**

  Add service functions for updating non-financial fields and settlement fields. Settlement field edits must call `writeAuditLog` with `isHighRisk: true` and a non-empty reason.

- [ ] **Step 4: Build project detail UI**

  Add `/console/projects/[id]` with tabs:
  - 基础信息
  - 准入规则
  - 默认结算规则
  - 审计摘要

- [ ] **Step 5: Verification**

  Run:

  ```bash
  pnpm lint
  pnpm type-check
  pnpm test
  pnpm build
  pnpm supabase db reset
  ```

  Expected: project draft, edit, publish, and illegal transition tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add .
  git commit -m "feat: complete P1 project management"
  ```

---

## Task 2: P1-2 Streamer Resource Pool

**Files:**

- Create: `features/streamers/`
- Create: `app/(ops)/console/streamers/`
- Modify: `components/layouts/ops-shell.tsx`
- Modify: `supabase/migrations/*.sql`
- Test: `features/streamers/*.test.ts`
- Create: `docs/checklists/P1-streamer-pool.md`

- [ ] **Step 1: Add streamer domain tests**

  Cover:
  - blacklisted streamer cannot be invited.
  - streamer can exist without login `user_id`.
  - only owner/ops_manager can edit risk state.

- [ ] **Step 2: Add streamer list and detail services**

  Services must return DTOs. Do not return raw sensitive fields to streamer-facing routes.

- [ ] **Step 3: Build streamer pool UI**

  Add list filters for cooperation status, platform, category, supplier, risk level, and login binding.

- [ ] **Step 4: Add seed streamers for UI coverage**

  Ensure seed includes at least:
  - trusted active streamer
  - probation streamer
  - restricted or risk streamer

- [ ] **Step 5: Verification**

  Run:

  ```bash
  pnpm lint
  pnpm type-check
  pnpm test
  pnpm build
  pnpm supabase db reset
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add .
  git commit -m "feat: add streamer resource pool"
  ```

---

## Task 3: P1-3 Applications, Invitations, and Screening Review

**Files:**

- Create: `features/applications/`
- Create: `app/(ops)/console/applications/`
- Create: `app/(streamer-app)/m/applications/`
- Modify: `supabase/migrations/*.sql`
- Test: `features/applications/*.test.ts`
- Create: `docs/checklists/P1-applications-screening.md`

- [ ] **Step 1: Add tables**

  Add migration tables:
  - `project_applications`
  - `project_streamers`
  - `screening_videos`

  Include `organization_id`, RLS policies, status enums, file path fields, review fields, second confirmation fields, and settlement rule snapshot on `project_streamers`.

- [ ] **Step 2: Add state machine tests**

  Cover:
  - submitted recording -> pending_review -> approved -> pending_join_confirm -> joined.
  - approved does not equal joined.
  - rejected and need_more can be resubmitted.

- [ ] **Step 3: Implement review actions**

  Review actions must:
  - check role.
  - write audit.
  - send notification to next actor.
  - preserve all recording versions.

- [ ] **Step 4: Build UI**

经营 Web:

- application queue
- screening review
- pending join confirmation

主播 App:

- apply to project
- upload screening video placeholder
- view review status

- [ ] **Step 5: Verification**

  Run all standard checks plus a browser smoke test for application queue.

- [ ] **Step 6: Commit**

  ```bash
  git add .
  git commit -m "feat: add project applications and screening review"
  ```

---

## Task 4: P1-4 Scheduling and System Timing

**Files:**

- Create: `features/live-tasks/`
- Create: `app/(ops)/console/live-tasks/`
- Modify: `app/(streamer-app)/m/tasks/page.tsx`
- Modify: `supabase/migrations/*.sql`
- Test: `features/live-tasks/*.test.ts`
- Create: `docs/checklists/P1-live-tasks.md`

- [ ] **Step 1: Add live task state machine tests**

  Cover:
  - pending_live -> live -> pending_report.
  - report_approved -> completed.
  - overlapping project tasks for the same streamer are rejected.

- [ ] **Step 2: Implement start and stop services**

  Start and stop must:
  - verify streamer owns the task or staff can access project.
  - write system timestamps.
  - compute `system_duration`.
  - write audit.

- [ ] **Step 3: Build scheduling UI**

经营 Web:

- task table
- batch create form
- status filters

主播 App:

- task cards
- start button
- stop button

- [ ] **Step 4: Add anomaly foundation**

  Add `task_anomalies` table only if needed for P1 minimal anomaly markers. Full scanner remains P3.

- [ ] **Step 5: Verification**

  Run standard checks and confirm a task can be started/stopped in local UI.

- [ ] **Step 6: Commit**

  ```bash
  git add .
  git commit -m "feat: add live tasks and system timing"
  ```

---

## Task 5: P1-5 Live Reports, Evidence Model, and Review

**Files:**

- Create: `features/live-reports/`
- Create: `app/(ops)/console/live-reports/`
- Modify: `app/(streamer-app)/m/tasks/page.tsx`
- Modify: `supabase/migrations/*.sql`
- Test: `features/live-reports/*.test.ts`
- Create: `docs/checklists/P1-live-reports.md`

- [ ] **Step 1: Add evidence resolver tests**

  Cover:

  ```typescript
  expect(
    resolveEvidence({ forceSystemTiming: true, system: 120, screenshot: 118 }),
  ).toMatchObject({
    settlementDuration: 120,
    timeSource: "system",
    evidenceLevel: "green",
  });

  expect(
    resolveEvidence({ forceSystemTiming: true, screenshot: 118, claimed: 120 }),
  ).toMatchObject({
    settlementDuration: 118,
    timeSource: "screenshot",
    evidenceLevel: "yellow",
  });

  expect(resolveEvidence({ claimed: 120 })).toMatchObject({
    settlementDuration: 120,
    timeSource: "claimed",
    evidenceLevel: "red",
  });
  ```

- [ ] **Step 2: Implement report creation from task**

  Reports must only be created from a live task. Direct orphan reports are invalid.

- [ ] **Step 3: Implement screenshot and OCR placeholder**

  Store screenshot metadata in `report_screenshots`, compute file hash before insert when possible, and create pending `ocr_results`. Real OCR remains placeholder.

- [ ] **Step 4: Implement adjudication and review**

  Review actions must:
  - allow operator_business / ops_manager.
  - write `report_change_logs` when values change.
  - write high-risk audit when approved red evidence or changed submitted fields.
  - set `enter_settlement_pool` default true.

- [ ] **Step 5: Build UI**

经营 Web:

- pending review queue
- evidence badges green/yellow/red
- adjudication form

主播 App:

- upload screenshot placeholder
- confirm OCR/manual values
- see review result

- [ ] **Step 6: P1 Golden Path**

  Run:

  ```text
  create project -> publish -> streamer applies -> screening approved -> join confirmed
  -> create live task -> streamer start/stop -> create report -> approve -> report enters settlement pool
  ```

- [ ] **Step 7: Verification and Commit**

  ```bash
  pnpm lint
  pnpm type-check
  pnpm test
  pnpm build
  pnpm supabase db reset
  git add .
  git commit -m "feat: complete P1 evidence chain"
  ```

- [ ] **Step 8: Stop for P1 acceptance**

  Ask the product owner to confirm before starting P2.

---

## Task 6: P2 Financial Closure

**Files:**

- Create: `features/settlements/`
- Create: `app/(ops)/console/settlements/`
- Modify: `supabase/migrations/*.sql`
- Test: `features/settlements/*.test.ts`
- Create: `docs/checklists/P2-finance.md`

- [ ] **Step 1: Add settlement engine tests**

  Cover:
  - CPT = green `settlement_duration * hourly_rate`.
  - base salary computes only from rule snapshot.
  - CPA/CPS/gift rows are manual carry values and never marked computed.

- [ ] **Step 2: Implement settlement pool view**

  Use approved `live_reports` where `enter_settlement_pool = true` and `settled_batch_item_id is null`.

- [ ] **Step 3: Implement receivable and payable batches**

  Keep vendor receivable and streamer payable separate. Enforce project-period batch dimensions.

- [ ] **Step 4: Implement lock and reopen**

  Reopen requires:
  - role owner.
  - `reopen_reason`.
  - high-risk audit.
  - notification to owner and ops_manager.

- [ ] **Step 5: Implement streamer safe payable view consumption**

  主播端 reads only `streamer_payable_items_safe`.

- [ ] **Step 6: P2 Golden Path**

  Run P1 path, then:

  ```text
  settlement pool -> payable batch -> receivable batch -> compute CPT/base salary
  -> add manual CPA/gift row -> confirm -> lock -> attempt reopen with reason
  ```

- [ ] **Step 7: Commit and stop**

  ```bash
  git add .
  git commit -m "feat: close P2 financial loop"
  ```

  Stop for P2 acceptance.

---

## Task 7: P3 Governance and Operations Efficiency

**Files:**

- Create: `features/audit-center/`
- Create: `features/exports/`
- Create: `features/notification-center/`
- Create: `features/anomalies/`
- Create: `features/delivery-packages/`
- Modify: `app/(ops)/console/stubs/*`
- Test: `features/*/*.test.ts`
- Create: `docs/checklists/P3-governance.md`

- [ ] **Step 1: Build audit center**

  Add filterable audit list by role scope. Do not add update or delete paths for audit logs.

- [ ] **Step 2: Build export center**

  Add export job table if not already present, field whitelists, sensitivity flags, and async placeholder generation.

- [ ] **Step 3: Build notification center**

  Add unread/read/handled/ignored transitions and “my todos”.

- [ ] **Step 4: Build anomaly scanner placeholder**

  Add deterministic scanner service for:
  - not started
  - not reported
  - overdue report
  - missing screenshot
  - live over 48h

- [ ] **Step 5: Build delivery package generator**

  Generate recruitment, execution, and closing package data through DTOs that remove price, margin, cost, and internal risk notes.

- [ ] **Step 6: P3 Golden Path**

  Re-run P1 and P2 paths. Confirm every important action appears in audit center, notifications appear at the right role, and exports/delivery packages are脱敏.

- [ ] **Step 7: Commit and stop**

  ```bash
  git add .
  git commit -m "feat: add P3 governance workflows"
  ```

  Stop for P3 acceptance.

---

## Task 8: P4 Automation and Decision Intelligence

**Files:**

- Create: `features/auto-review/`
- Create: `features/war-room/`
- Create: `features/ai-tools/`
- Modify: `features/live-reports/`
- Modify: `supabase/migrations/*.sql`
- Test: `features/auto-review/*.test.ts`, `features/war-room/*.test.ts`, `features/ai-tools/*.test.ts`
- Create: `docs/checklists/P4-intelligence.md`

- [ ] **Step 1: Implement shadow-mode auto review**

  Auto review must first run in shadow mode: it records what it would do but does not approve.

- [ ] **Step 2: Add eight-gate tests**

  Cover all gates:
  - policy enabled
  - evidence green
  - no report risk flags
  - no task anomaly flags
  - time source system
  - streamer trusted
  - project not high sensitivity
  - guardrails pass

- [ ] **Step 3: Add sampling and brake logic**

  If sampled automatic approvals are overturned above threshold, increase sample rate and downgrade affected streamer trust.

- [ ] **Step 4: Build war room v1**

  Add rule-based:
  - streamer matching
  - supplier scoring
  - quote estimation
  - project review report

- [ ] **Step 5: Build AI safety tool layer**

  AI tools must:
  - never accept raw SQL.
  - check current role and organization.
  - use DTOs/views.
  - write audit for every AI query.

- [ ] **Step 6: P4 Golden Path**

  Run:

  ```text
  quote estimate -> streamer match -> green report shadow auto review
  -> evaluate shadow result -> project review -> score feeds next project
  ```

- [ ] **Step 7: Commit and stop**

  ```bash
  git add .
  git commit -m "feat: add P4 auto review and war room"
  ```

  Stop for P4 acceptance.

---

## Task 9: P5 SaaS Commercialization

**Files:**

- Create: `features/billing/`
- Create: `features/usage/`
- Create: `features/entitlements/`
- Modify: shared permission gates
- Modify: `supabase/migrations/*.sql`
- Test: `features/billing/*.test.ts`, `features/usage/*.test.ts`, `features/entitlements/*.test.ts`
- Create: `docs/checklists/P5-commercialization.md`

- [ ] **Step 1: Add usage metering**

  Track:
  - active streamers per month
  - seats
  - OCR usage
  - AI usage
  - storage
  - exports

- [ ] **Step 2: Add entitlement gates**

  Gates must be service-side first, UI-side second. Never rely on hidden UI for plan enforcement.

- [ ] **Step 3: Add subscription and add-on records**

  Keep payment integration behind an adapter. Do not hard-code provider secrets.

- [ ] **Step 4: Add delinquency read-only mode**

  Read-only mode must preserve access to settlement and audit records.

- [ ] **Step 5: P5 Golden Path**

  Run all previous golden paths under:
  - free/basic plan limits
  - professional plan with war room
  - delinquent read-only state

- [ ] **Step 6: Commit and stop**

  ```bash
  git add .
  git commit -m "feat: add P5 SaaS metering and entitlements"
  ```

  Stop for final acceptance.

---

## Continuous Verification Matrix

Run this matrix after every slice:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Run this matrix after every database slice:

```bash
pnpm supabase db reset
```

Run these route checks after every UI slice:

```text
/console/projects
/console/streamers
/console/live-tasks
/console/live-reports
/console/settlements
/m/tasks
/desktop
```

Run this security checklist after every phase:

```text
No business table without organization_id.
No business table without RLS enabled.
No sensitive field returned to streamer-facing routes except via safe view or DTO.
No write action without audit.
No high-risk action without reason.
No export without field whitelist.
No AI tool bypasses RBAC or directly executes SQL.
No P(n+1) feature shipped inside P(n) without explicit product approval.
```

## Current Known Blocker

`pnpm supabase db reset` requires Docker Desktop. On the current machine Docker Desktop is not starting, so database migrations are written and contract-tested but still need a live Supabase local reset once Docker is available.
