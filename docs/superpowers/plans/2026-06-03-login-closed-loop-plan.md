# Login Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a screenshot-aligned login page whose visible actions are connected to real authentication or onboarding workflows.

**Architecture:** Pure workflow helpers define routing, modes, notices, provider status, and form validation. Server actions perform Supabase side effects. The page renders mode-specific forms against those actions.

**Tech Stack:** Next.js App Router, React Server Components, Server Actions, Supabase Auth, Supabase SQL migrations, Vitest.

---

### Task 1: Login Workflow Helpers

**Files:**

- Create: `app/(auth)/login/login-workflows.ts`
- Test: `app/(auth)/login/login-workflows.test.ts`

- [x] **Step 1: Write failing tests**

Cover MCN and streamer destinations, safe `next`, query mode parsing, notice state, provider configuration, and MCN application validation.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run 'app/(auth)/login/login-workflows.test.ts'`
Expected: failures from missing or stubbed workflow behavior.

- [x] **Step 3: Implement workflow helpers**

Implement `resolvePostLoginPath`, `normalizeLoginMode`, `normalizeRoleIntent`, `buildLoginViewState`, `getAuthProviderState`, and `validateMcnApplicationInput`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run 'app/(auth)/login/login-workflows.test.ts'`
Expected: all workflow tests pass.

### Task 2: Server Actions

**Files:**

- Modify: `app/(auth)/login/actions.ts`

- [x] **Step 1: Extend email/password login**

Read `roleIntent`, `next`, and `remember`; persist remembered login preference for seven days; redirect through `resolvePostLoginPath`.

- [x] **Step 2: Add reset, OTP, provider, and onboarding actions**

Add `requestPasswordResetAction`, `requestPhoneOtpAction`, `verifyPhoneOtpAction`, `signInWithProviderAction`, and `submitMcnApplicationAction`.

### Task 3: Visual Login Page

**Files:**

- Replace: `app/(auth)/login/page.tsx`

- [x] **Step 1: Render split-screen layout**

Build the left blue business panel and right auth workspace using existing tokens and lucide icons.

- [x] **Step 2: Render real mode-specific forms**

Render password login, reset, phone OTP, MCN application, and help modes from query state.

### Task 4: Onboarding Database

**Files:**

- Create: `supabase/migrations/20260603152500_mcn_onboarding_requests.sql`

- [x] **Step 1: Add onboarding request table**

Create insert-only public onboarding request storage with status, review fields, timestamps, validation checks, and RLS.

### Task 5: Verification

**Files:**

- Check: login workflow tests, type checker, no-demo-data regression, browser screenshot.

- [ ] **Step 1: Run focused workflow tests**

Run: `pnpm vitest run 'app/(auth)/login/login-workflows.test.ts'`

- [ ] **Step 2: Run type check**

Run: `pnpm type-check`

- [ ] **Step 3: Run demo-data guard**

Run: `pnpm vitest run features/regression/no-demo-data.test.ts`

- [ ] **Step 4: Open `/login` and verify in browser**

Reload `http://localhost:3000/login` and inspect that the page renders without console errors.
