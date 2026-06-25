# AI3 Auto Review Shadow Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic rollout gates that keep auto-review active mode blocked until shadow, audit, and kill-switch safety checks pass.

**Architecture:** A new pure evaluator in `features/auto-review/auto-review-rollout-gates.ts` returns allowed/effective mode and failed gate reasons. `evaluateAutoReviewActive` accepts an optional rollout gate result and refuses active approval when that gate is blocked, preserving existing callers when no gate is supplied.

**Tech Stack:** TypeScript, Vitest, existing auto-review engine/service.

---

### Task 1: Rollout Gate RED Test

**Files:**

- Create: `features/auto-review/auto-review-rollout-gates.test.ts`

- [ ] **Step 1: Write failing gate tests**

Add tests for:

- Shadow target is allowed by default.
- Kill switch blocks active.
- Missing explicit active request blocks active.
- Low shadow sample count blocks gray and active.
- High shadow false accept rate blocks active.
- High audit error rate blocks active.
- Active is allowed when all gates pass.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-gates.test.ts`

Expected: FAIL because `./auto-review-rollout-gates` does not exist.

### Task 2: Rollout Gate GREEN

**Files:**

- Create: `features/auto-review/auto-review-rollout-gates.ts`

- [ ] **Step 1: Implement exported types and evaluator**

Implement:

```ts
export type AutoReviewRolloutMode = "shadow" | "gray" | "active";

export type AutoReviewRolloutGateInput = {
  targetMode: AutoReviewRolloutMode;
  killSwitchEnabled: boolean;
  shadowSampleCount: number;
  minimumShadowSampleCount: number;
  shadowFalseAcceptRateBps: number;
  maximumFalseAcceptRateBps: number;
  auditSampleCount: number;
  minimumAuditSampleCount: number;
  auditErrorRateBps: number;
  maximumAuditErrorRateBps: number;
  explicitActiveRequest: boolean;
};
```

- [ ] **Step 2: Run GREEN**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-gates.test.ts`

Expected: PASS.

### Task 3: Active Service Gate RED Test

**Files:**

- Modify: `features/auto-review/auto-review-service.test.ts`

- [ ] **Step 1: Add service tests**

Add tests that assert:

- Active evaluation throws when `rolloutGate.allowed` is false.
- Blocked rollout gate does not call `approveReport`.
- Allowed active rollout gate preserves existing active approval behavior.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/auto-review/auto-review-service.test.ts`

Expected: FAIL because `evaluateAutoReviewActive` does not accept or enforce `rolloutGate`.

### Task 4: Active Service Gate GREEN

**Files:**

- Modify: `features/auto-review/auto-review-service.ts`

- [ ] **Step 1: Add optional `rolloutGate` parameter**

Import `AutoReviewRolloutGateResult`. If provided and not allowed for active, throw `Active auto review blocked by rollout gate` before auditing or approving.

- [ ] **Step 2: Run service test**

Run: `pnpm vitest run features/auto-review/auto-review-service.test.ts`

Expected: PASS.

### Task 5: Regression Verification

**Files:**

- No edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run features/auto-review/auto-review-rollout-gates.test.ts
pnpm vitest run features/auto-review/auto-review-service.test.ts
```

- [ ] **Step 2: Run staged suites**

Run:

```bash
pnpm test:p4-flywheel
pnpm test:ai-system
pnpm test:golden
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Expected: all pass. Build may show the existing Next worktree root warning.

### Task 6: Commit And Push

**Files:**

- All AI-3 auto-review gate files.

- [ ] **Step 1: Commit implementation**

Commit plan and implementation separately when possible.

- [ ] **Step 2: Push**

Run:

```bash
git push -u origin codex/ai3-auto-review-shadow-gates
```

Expected: branch pushed.

## Self Review

- Spec coverage: rollout gate, active service opt-in enforcement, kill switch, sample thresholds, FAR thresholds, audit thresholds, and regression gates are covered.
- Marker scan: no open markers remain.
- Type consistency: exported names match test and service usage.
