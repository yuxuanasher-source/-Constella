# Streamer Project Review API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real read-only API entrypoint that loads a streamer-project profile from existing schedule, report, application, and recording data, then runs the audited Xingyao review AI tool.

**Architecture:** Keep data loading separate from the route. The loader converts authorized Supabase rows into the pure `StreamerProjectReviewInput` shape, and the route handles auth/RBAC/body validation before invoking the existing `streamer_project_review` AI tool.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Supabase query patterns, existing auth context and AI tool layer.

---

## File Structure

Create:

- `features/streamers/streamer-project-review-loader.ts`
- `features/streamers/streamer-project-review-loader.test.ts`
- `app/api/ai/streamer-project-review/route.ts`
- `app/api/ai/streamer-project-review/route.test.ts`

Modify:

- No existing production files except imports if required by type-check.

## Task 1: Loader

**Files:**

- Create: `features/streamers/streamer-project-review-loader.ts`
- Test: `features/streamers/streamer-project-review-loader.test.ts`

- [ ] Write a failing test that passes fake Supabase rows for one streamer, one project, tasks, reports, applications, and recordings, then asserts `loadStreamerProjectReviewInput` returns the `StreamerProjectReviewInput` shape.
- [ ] Run `corepack pnpm test features/streamers/streamer-project-review-loader.test.ts` and confirm it fails because the module does not exist.
- [ ] Implement `loadStreamerProjectReviewInput({ supabase, organizationId, streamerId, projectId })`.
- [ ] Run the loader test and confirm it passes.

## Task 2: API Route

**Files:**

- Create: `app/api/ai/streamer-project-review/route.ts`
- Test: `app/api/ai/streamer-project-review/route.test.ts`

- [ ] Write failing tests for MCN staff success, streamer forbidden, and missing IDs returning 400.
- [ ] Run `corepack pnpm test app/api/ai/streamer-project-review/route.test.ts` and confirm it fails because the route does not exist.
- [ ] Implement the route with `createSupabaseServerClient`, `getAuthContext`, `isMcnStaff`, `loadStreamerProjectReviewInput`, and `runAiToolQuery`.
- [ ] Run the route test and confirm it passes.

## Task 3: Verification

- [ ] Run `corepack pnpm test features/streamers/streamer-project-review.test.ts features/streamers/streamer-project-review-loader.test.ts features/ai/ai-tool-layer.test.ts app/api/ai/streamer-project-review/route.test.ts`.
- [ ] Run `git diff --check`.
- [ ] Run `corepack pnpm type-check`.
