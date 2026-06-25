# AI3 Auto Review Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure read-only metrics snapshot layer that converts historical shadow and audit outcomes into `AutoReviewRolloutGateInput`.

**Architecture:** Add one focused module under `features/auto-review` that owns rollout metric math and returns both gate input and a transparent summary. The existing rollout gate remains the only component that decides `allowed` or `effectiveMode`.

**Tech Stack:** TypeScript, Vitest, existing `features/auto-review` modules.

---

### Task 1: Metrics Snapshot Builder

**Files:**

- Create: `features/auto-review/auto-review-rollout-metrics.test.ts`
- Create: `features/auto-review/auto-review-rollout-metrics.ts`

- [ ] **Step 1: Write the failing metrics tests**

Add tests that describe the desired API:

```ts
import { describe, expect, it } from "vitest";

import { buildAutoReviewRolloutMetrics } from "./auto-review-rollout-metrics";

describe("buildAutoReviewRolloutMetrics", () => {
  it("builds gate input from shadow false accepts and audit errors", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: passingConfig(),
      shadowOutcomes: [
        {
          reportId: "report-1",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "approve",
        },
        {
          reportId: "report-2",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "reject",
        },
        {
          reportId: "report-3",
          shadowDecision: "manual_review",
          finalHumanDecision: "needs_changes",
        },
      ],
      auditSamples: [
        {
          sampleId: "audit-1",
          expectedDecision: "approve",
          actualDecision: "approve",
        },
        {
          sampleId: "audit-2",
          expectedDecision: "approve",
          actualDecision: "reject",
        },
      ],
    });

    expect(snapshot.gateInput).toMatchObject({
      shadowSampleCount: 3,
      shadowFalseAcceptRateBps: 5000,
      auditSampleCount: 2,
      auditErrorRateBps: 5000,
    });
    expect(snapshot.summary).toMatchObject({
      shadowAutoPassCount: 2,
      shadowFalseAcceptCount: 1,
      auditComparedCount: 2,
      auditErrorCount: 1,
    });
  });

  it("ignores unknown human outcomes in the false accept denominator", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: passingConfig(),
      shadowOutcomes: [
        {
          reportId: "report-1",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "unknown",
        },
        {
          reportId: "report-2",
          shadowDecision: "auto_pass_candidate",
          finalHumanDecision: "approve",
        },
      ],
      auditSamples: [],
    });

    expect(snapshot.gateInput.shadowFalseAcceptRateBps).toBe(0);
    expect(snapshot.summary.shadowAutoPassReviewedCount).toBe(1);
  });

  it("preserves insufficient sample counts for the rollout gate", () => {
    const snapshot = buildAutoReviewRolloutMetrics({
      config: {
        ...passingConfig(),
        minimumShadowSampleCount: 10,
        minimumAuditSampleCount: 10,
      },
      shadowOutcomes: [],
      auditSamples: [],
    });

    expect(snapshot.gateInput.shadowSampleCount).toBe(0);
    expect(snapshot.gateInput.auditSampleCount).toBe(0);
  });
});

function passingConfig() {
  return {
    targetMode: "active" as const,
    killSwitchEnabled: false,
    minimumShadowSampleCount: 1,
    maximumFalseAcceptRateBps: 100,
    minimumAuditSampleCount: 1,
    maximumAuditErrorRateBps: 100,
    explicitActiveRequest: true,
  };
}
```

- [ ] **Step 2: Run the metrics tests to verify RED**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics.test.ts`

Expected: FAIL because `./auto-review-rollout-metrics` does not exist.

- [ ] **Step 3: Implement the minimal metrics builder**

Create:

```ts
import type {
  AutoReviewRolloutGateInput,
  AutoReviewRolloutMode,
} from "./auto-review-rollout-gates";

export type AutoReviewRolloutMetricsConfig = Omit<
  AutoReviewRolloutGateInput,
  | "shadowSampleCount"
  | "shadowFalseAcceptRateBps"
  | "auditSampleCount"
  | "auditErrorRateBps"
>;

export type ShadowHumanDecision =
  | "approve"
  | "reject"
  | "needs_changes"
  | "unknown";

export type ShadowReviewOutcome = {
  reportId: string;
  shadowDecision: "auto_pass_candidate" | "manual_review" | "disabled";
  finalHumanDecision: ShadowHumanDecision;
};

export type AuditReviewSample = {
  sampleId: string;
  expectedDecision: ShadowHumanDecision;
  actualDecision: ShadowHumanDecision;
};

export type AutoReviewRolloutMetricsSummary = {
  targetMode: AutoReviewRolloutMode;
  shadowSampleCount: number;
  shadowAutoPassCount: number;
  shadowAutoPassReviewedCount: number;
  shadowFalseAcceptCount: number;
  auditSampleCount: number;
  auditComparedCount: number;
  auditErrorCount: number;
};

export type AutoReviewRolloutMetricsSnapshot = {
  gateInput: AutoReviewRolloutGateInput;
  summary: AutoReviewRolloutMetricsSummary;
};

export function buildAutoReviewRolloutMetrics(input: {
  config: AutoReviewRolloutMetricsConfig;
  shadowOutcomes: ShadowReviewOutcome[];
  auditSamples: AuditReviewSample[];
}): AutoReviewRolloutMetricsSnapshot {
  const shadowSampleCount = input.shadowOutcomes.length;
  const shadowAutoPassReviewed = input.shadowOutcomes.filter(
    (outcome) =>
      outcome.shadowDecision === "auto_pass_candidate" &&
      outcome.finalHumanDecision !== "unknown",
  );
  const shadowAutoPassCount = input.shadowOutcomes.filter(
    (outcome) => outcome.shadowDecision === "auto_pass_candidate",
  ).length;
  const shadowFalseAcceptCount = shadowAutoPassReviewed.filter(
    (outcome) => outcome.finalHumanDecision !== "approve",
  ).length;

  const comparedAuditSamples = input.auditSamples.filter(
    (sample) =>
      sample.expectedDecision !== "unknown" &&
      sample.actualDecision !== "unknown",
  );
  const auditErrorCount = comparedAuditSamples.filter(
    (sample) => sample.expectedDecision !== sample.actualDecision,
  ).length;

  return {
    gateInput: {
      ...input.config,
      shadowSampleCount,
      shadowFalseAcceptRateBps: rateBps(
        shadowFalseAcceptCount,
        shadowAutoPassReviewed.length,
      ),
      auditSampleCount: comparedAuditSamples.length,
      auditErrorRateBps: rateBps(auditErrorCount, comparedAuditSamples.length),
    },
    summary: {
      targetMode: input.config.targetMode,
      shadowSampleCount,
      shadowAutoPassCount,
      shadowAutoPassReviewedCount: shadowAutoPassReviewed.length,
      shadowFalseAcceptCount,
      auditSampleCount: input.auditSamples.length,
      auditComparedCount: comparedAuditSamples.length,
      auditErrorCount,
    },
  };
}

function rateBps(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 10000);
}
```

- [ ] **Step 4: Run the metrics tests to verify GREEN**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics.test.ts`

Expected: PASS.

### Task 2: Gate Integration Proof

**Files:**

- Modify: `features/auto-review/auto-review-rollout-metrics.test.ts`

- [ ] **Step 1: Write the failing integration proof**

Add a test that passes the metrics output into the existing gate:

```ts
import { evaluateAutoReviewRolloutGate } from "./auto-review-rollout-gates";

it("feeds the rollout gate with measured metrics", () => {
  const snapshot = buildAutoReviewRolloutMetrics({
    config: passingConfig(),
    shadowOutcomes: [
      {
        reportId: "report-1",
        shadowDecision: "auto_pass_candidate",
        finalHumanDecision: "approve",
      },
    ],
    auditSamples: [
      {
        sampleId: "audit-1",
        expectedDecision: "approve",
        actualDecision: "approve",
      },
    ],
  });

  expect(evaluateAutoReviewRolloutGate(snapshot.gateInput)).toMatchObject({
    allowed: true,
    effectiveMode: "active",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails before import wiring**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics.test.ts`

Expected: FAIL until `evaluateAutoReviewRolloutGate` is imported.

- [ ] **Step 3: Add the import and keep production code unchanged**

Add:

```ts
import { evaluateAutoReviewRolloutGate } from "./auto-review-rollout-gates";
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run features/auto-review/auto-review-rollout-metrics.test.ts
pnpm vitest run features/auto-review/auto-review-rollout-gates.test.ts
```

Expected: PASS.

### Task 3: Regression And Commit

**Files:**

- Create: `features/auto-review/auto-review-rollout-metrics.ts`
- Create: `features/auto-review/auto-review-rollout-metrics.test.ts`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
pnpm test:ai-system
pnpm test:p4-flywheel
```

Expected: PASS.

- [ ] **Step 2: Run repo gates**

Run:

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add features/auto-review/auto-review-rollout-metrics.ts features/auto-review/auto-review-rollout-metrics.test.ts
git commit -m "feat: add AI3 auto review rollout metrics"
```

Expected: commit created on `codex/ai3-auto-review-metrics`.

- [ ] **Step 4: Push**

Run:

```bash
git push -u origin codex/ai3-auto-review-metrics
```

Expected: branch pushed and PR URL printed by GitHub.

## Self-Review

- Spec coverage: pure metrics builder, deterministic output, summary, ignored unknown outcomes, no DB/API/UI writes, and gate integration proof are covered.
- Placeholder scan: no deferred implementation markers are required for this plan.
- Type consistency: `AutoReviewRolloutMetricsConfig` derives from `AutoReviewRolloutGateInput`, so future gate changes surface through TypeScript.
