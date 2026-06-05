# AI3 Auto Review Metrics Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only repository adapter that converts existing audit log rows into AI-3 rollout metrics snapshots.

**Architecture:** Add one repository module beside the rollout metrics builder. The module has a pure row mapper for deterministic tests and a small Supabase-style query adapter that reads `audit_logs`, applies safe filters, and feeds `buildAutoReviewRolloutMetrics`.

**Tech Stack:** TypeScript, Vitest, existing Supabase query-builder style, existing `features/auto-review` metrics and gate modules.

---

### Task 1: Pure Audit Row Mapper

**Files:**

- Create: `features/auto-review/auto-review-rollout-metrics-repository.test.ts`
- Create: `features/auto-review/auto-review-rollout-metrics-repository.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `features/auto-review/auto-review-rollout-metrics-repository.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import {
  buildAutoReviewRolloutMetricsFromAuditRows,
  type AutoReviewRolloutMetricAuditRow,
} from "./auto-review-rollout-metrics-repository";

describe("buildAutoReviewRolloutMetricsFromAuditRows", () => {
  it("correlates shadow decisions with final human live-report reviews", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        humanReviewRow({
          id: "human-2",
          objectId: "report-2",
          action: "reject",
          status: "rejected",
          createdAt: "2026-06-04T10:04:00.000Z",
        }),
        humanReviewRow({
          id: "human-1",
          objectId: "report-1",
          action: "approve",
          status: "approved",
          createdAt: "2026-06-04T10:03:00.000Z",
        }),
        shadowRow({
          id: "shadow-2",
          objectId: "report-2",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:02:00.000Z",
        }),
        shadowRow({
          id: "shadow-1",
          objectId: "report-1",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:01:00.000Z",
        }),
      ],
    });

    expect(snapshot.gateInput).toMatchObject({
      shadowSampleCount: 2,
      shadowFalseAcceptRateBps: 5000,
    });
    expect(snapshot.summary).toMatchObject({
      shadowAutoPassReviewedCount: 2,
      shadowFalseAcceptCount: 1,
    });
  });

  it("uses the most recent human review row for the same report", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        humanReviewRow({
          id: "human-latest",
          objectId: "report-1",
          action: "approve",
          status: "approved",
          createdAt: "2026-06-04T10:05:00.000Z",
        }),
        humanReviewRow({
          id: "human-old",
          objectId: "report-1",
          action: "reject",
          status: "rejected",
          createdAt: "2026-06-04T10:01:00.000Z",
        }),
        shadowRow({
          id: "shadow-1",
          objectId: "report-1",
          decision: "auto_pass_candidate",
          createdAt: "2026-06-04T10:00:00.000Z",
        }),
      ],
    });

    expect(snapshot.gateInput.shadowFalseAcceptRateBps).toBe(0);
    expect(snapshot.summary.shadowFalseAcceptCount).toBe(0);
  });

  it("maps active audit outcome metadata into audit error rate", () => {
    const snapshot = buildAutoReviewRolloutMetricsFromAuditRows({
      config: passingConfig(),
      rows: [
        activeAuditSampleRow({
          id: "sample-1",
          expectedDecision: "approve",
          actualDecision: "reject",
        }),
        activeAuditSampleRow({
          id: "sample-2",
          expectedDecision: "approve",
          actualDecision: "approve",
        }),
      ],
    });

    expect(snapshot.gateInput.auditSampleCount).toBe(2);
    expect(snapshot.gateInput.auditErrorRateBps).toBe(5000);
    expect(snapshot.summary.auditErrorCount).toBe(1);
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

function shadowRow(input: {
  id: string;
  objectId: string;
  decision: "auto_pass_candidate" | "manual_review" | "disabled";
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "auto_review",
    action: "approve",
    objectId: input.objectId,
    after: {
      mode: "shadow",
      decision: input.decision,
    },
    createdAt: input.createdAt,
  });
}

function humanReviewRow(input: {
  id: string;
  objectId: string;
  action: "approve" | "reject";
  status: "approved" | "rejected" | "need_more";
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "live_report",
    action: input.action,
    objectId: input.objectId,
    after: {
      status: input.status,
    },
    createdAt: input.createdAt,
  });
}

function activeAuditSampleRow(input: {
  id: string;
  expectedDecision: "approve" | "reject" | "needs_changes";
  actualDecision: "approve" | "reject" | "needs_changes";
}): AutoReviewRolloutMetricAuditRow {
  return auditRow({
    id: input.id,
    module: "auto_review",
    action: "approve",
    objectId: "report-sample",
    after: {
      mode: "active",
      auditOutcome: {
        expectedDecision: input.expectedDecision,
        actualDecision: input.actualDecision,
      },
    },
    createdAt: "2026-06-04T10:00:00.000Z",
  });
}

function auditRow(input: {
  id: string;
  module: "auto_review" | "live_report";
  action: "approve" | "reject";
  objectId: string;
  after: Record<string, unknown>;
  createdAt: string;
}): AutoReviewRolloutMetricAuditRow {
  return {
    id: input.id,
    organization_id: "org-1",
    action: input.action,
    module: input.module,
    object_type: "live_report",
    object_id: input.objectId,
    after_json: input.after,
    result: "success",
    created_at: input.createdAt,
  };
}
```

- [ ] **Step 2: Run the mapper tests to verify RED**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics-repository.test.ts`

Expected: FAIL because `./auto-review-rollout-metrics-repository` does not exist.

- [ ] **Step 3: Implement the pure mapper**

Create `features/auto-review/auto-review-rollout-metrics-repository.ts` with:

```ts
import {
  buildAutoReviewRolloutMetrics,
  type AuditReviewSample,
  type AutoReviewRolloutMetricsConfig,
  type AutoReviewRolloutMetricsSnapshot,
  type ShadowHumanDecision,
  type ShadowReviewOutcome,
} from "./auto-review-rollout-metrics";

export type AutoReviewRolloutMetricAuditRow = {
  id: string;
  organization_id: string;
  action: string;
  module: string;
  object_type: string;
  object_id: string | null;
  after_json: Record<string, unknown>;
  result: "success" | "failure";
  created_at: string;
};

export function buildAutoReviewRolloutMetricsFromAuditRows(input: {
  config: AutoReviewRolloutMetricsConfig;
  rows: AutoReviewRolloutMetricAuditRow[];
}): AutoReviewRolloutMetricsSnapshot {
  const rows = [...input.rows].sort(compareRowsNewestFirst);
  const humanDecisionsByReportId = new Map<string, ShadowHumanDecision>();

  for (const row of rows) {
    if (row.module !== "live_report" || row.object_type !== "live_report") {
      continue;
    }
    if (!row.object_id || humanDecisionsByReportId.has(row.object_id)) {
      continue;
    }
    humanDecisionsByReportId.set(row.object_id, mapHumanDecision(row));
  }

  const shadowOutcomes: ShadowReviewOutcome[] = [];
  const auditSamples: AuditReviewSample[] = [];

  for (const row of rows) {
    if (row.module !== "auto_review" || row.object_type !== "live_report") {
      continue;
    }
    const mode = stringValue(row.after_json.mode);

    if (mode === "shadow") {
      const decision = mapShadowDecision(row.after_json.decision);
      if (!row.object_id || !decision) {
        continue;
      }
      shadowOutcomes.push({
        reportId: row.object_id,
        shadowDecision: decision,
        finalHumanDecision:
          humanDecisionsByReportId.get(row.object_id) ?? "unknown",
      });
    }

    if (mode === "active") {
      const sample = mapAuditSample(row);
      if (sample) {
        auditSamples.push(sample);
      }
    }
  }

  return buildAutoReviewRolloutMetrics({
    config: input.config,
    shadowOutcomes,
    auditSamples,
  });
}
```

Then add helper functions for sorting and mapping decisions.

- [ ] **Step 4: Run mapper tests to verify GREEN**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics-repository.test.ts`

Expected: PASS.

### Task 2: Read-Only Repository Query

**Files:**

- Modify: `features/auto-review/auto-review-rollout-metrics-repository.test.ts`
- Modify: `features/auto-review/auto-review-rollout-metrics-repository.ts`

- [ ] **Step 1: Add failing query adapter test**

Add a test for the read-only query:

```ts
import { listAutoReviewRolloutMetricRows } from "./auto-review-rollout-metrics-repository";

it("queries scoped successful live-report audit rows with a safe limit", async () => {
  const { client, calls } = createClient([]);

  await listAutoReviewRolloutMetricRows(client, {
    organizationId: "org-1",
    config: passingConfig(),
    limit: 999,
  });

  expect(calls).toContainEqual(["eq", ["organization_id", "org-1"]]);
  expect(calls).toContainEqual([
    "in",
    ["module", ["auto_review", "live_report"]],
  ]);
  expect(calls).toContainEqual(["eq", ["object_type", "live_report"]]);
  expect(calls).toContainEqual(["eq", ["result", "success"]]);
  expect(calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
  expect(calls).toContainEqual(["limit", [500]]);
});
```

- [ ] **Step 2: Run repository tests to verify RED**

Run: `pnpm vitest run features/auto-review/auto-review-rollout-metrics-repository.test.ts`

Expected: FAIL until `listAutoReviewRolloutMetricRows` and the mock client are wired.

- [ ] **Step 3: Implement query adapter and test client**

Add a Supabase-style client type and `listAutoReviewRolloutMetricRows` that calls:

```ts
client
  .from("audit_logs")
  .select(autoReviewRolloutMetricAuditSelect)
  .eq("organization_id", input.organizationId)
  .in("module", ["auto_review", "live_report"])
  .eq("object_type", "live_report")
  .eq("result", "success")
  .order("created_at", { ascending: false })
  .limit(safeLimit(input.limit));
```

The function throws `error` when present and maps `data ?? []` through `buildAutoReviewRolloutMetricsFromAuditRows`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run features/auto-review/auto-review-rollout-metrics-repository.test.ts
pnpm vitest run features/auto-review/auto-review-rollout-metrics.test.ts
```

Expected: PASS.

### Task 3: Regression And Push

**Files:**

- Create: `features/auto-review/auto-review-rollout-metrics-repository.ts`
- Create: `features/auto-review/auto-review-rollout-metrics-repository.test.ts`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
pnpm test:p4-flywheel
pnpm test:ai-system
```

Expected: PASS.

- [ ] **Step 2: Run repository gates**

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
git add features/auto-review/auto-review-rollout-metrics-repository.ts features/auto-review/auto-review-rollout-metrics-repository.test.ts
git commit -m "feat: add AI3 auto review metrics repository"
```

Expected: implementation commit created.

- [ ] **Step 4: Push**

Run:

```bash
git push -u origin codex/ai3-auto-review-metrics-repository
```

Expected: branch pushed and GitHub prints a PR URL.

## Self-Review

- Spec coverage: audit row mapping, most recent human review, active audit sample metadata, query filters, safe limit, and no DB/API/UI writes are covered.
- Placeholder scan: no deferred implementation markers are required.
- Type consistency: repository output feeds `buildAutoReviewRolloutMetrics`, preserving the existing gate contract.
