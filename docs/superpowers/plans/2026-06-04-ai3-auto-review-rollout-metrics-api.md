# AI3 Auto Review Rollout Metrics API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only route that exposes measured auto-review rollout metrics and gate readiness to operations staff.

**Architecture:** Add `app/api/auto-review/rollout-metrics/route.ts` and a route contract test. The route authenticates with the existing Supabase server client, calls the read-only metrics repository, evaluates the rollout gate, and returns only the metrics snapshot plus gate result.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, existing auth context, existing auto-review metrics repository and rollout gate modules.

---

### Task 1: Route Contract

**Files:**

- Create: `app/api/auto-review/rollout-metrics/route.test.ts`
- Create: `app/api/auto-review/rollout-metrics/route.ts`

- [ ] **Step 1: Write failing route tests**

Create `app/api/auto-review/rollout-metrics/route.test.ts` with tests for success, forbidden role, and invalid target mode:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

import { listAutoReviewRolloutMetricRows } from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

vi.mock(
  "@/features/auto-review/auto-review-rollout-metrics-repository",
  () => ({
    listAutoReviewRolloutMetricRows: vi.fn(),
  }),
);

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const auth = {
  userId: "user-ops",
  email: "ops@jy-demo.local",
  name: "Ops Manager",
  organizationId: "org-1",
  organizationName: "Demo Org",
  role: "ops_manager" as const,
};

describe("auto review rollout metrics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      client: "supabase",
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue(auth);
    vi.mocked(listAutoReviewRolloutMetricRows).mockResolvedValue({
      gateInput: {
        targetMode: "active",
        killSwitchEnabled: false,
        shadowSampleCount: 100,
        minimumShadowSampleCount: 50,
        shadowFalseAcceptRateBps: 50,
        maximumFalseAcceptRateBps: 100,
        auditSampleCount: 30,
        minimumAuditSampleCount: 20,
        auditErrorRateBps: 100,
        maximumAuditErrorRateBps: 250,
        explicitActiveRequest: true,
      },
      summary: {
        targetMode: "active",
        shadowSampleCount: 100,
        shadowAutoPassCount: 80,
        shadowAutoPassReviewedCount: 80,
        shadowFalseAcceptCount: 1,
        auditSampleCount: 30,
        auditComparedCount: 30,
        auditErrorCount: 1,
      },
    });
  });

  it("returns measured rollout metrics and gate result for operations staff", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/auto-review/rollout-metrics?targetMode=active&explicitActiveRequest=true&limit=200",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        gate: {
          allowed: true,
          targetMode: "active",
          effectiveMode: "active",
        },
        metrics: {
          summary: {
            shadowSampleCount: 100,
            auditComparedCount: 30,
          },
        },
      },
    });
    expect(listAutoReviewRolloutMetricRows).toHaveBeenCalledWith(
      { client: "supabase" },
      {
        organizationId: "org-1",
        limit: 200,
        config: expect.objectContaining({
          targetMode: "active",
          explicitActiveRequest: true,
          killSwitchEnabled: false,
          minimumShadowSampleCount: 50,
          maximumFalseAcceptRateBps: 100,
          minimumAuditSampleCount: 20,
          maximumAuditErrorRateBps: 250,
        }),
      },
    );
  });

  it("blocks streamers from reading organization rollout metrics", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({
      ...auth,
      role: "streamer",
    });

    const response = await GET(
      new Request("http://localhost/api/auto-review/rollout-metrics"),
    );

    expect(response.status).toBe(403);
    expect(listAutoReviewRolloutMetricRows).not.toHaveBeenCalled();
  });

  it("rejects invalid target mode", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/auto-review/rollout-metrics?targetMode=pilot",
      ),
    );

    expect(response.status).toBe(400);
    expect(listAutoReviewRolloutMetricRows).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run route tests to verify RED**

Run: `pnpm vitest run app/api/auto-review/rollout-metrics/route.test.ts`

Expected: FAIL because `./route` does not exist.

- [ ] **Step 3: Implement the minimal route**

Create `app/api/auto-review/rollout-metrics/route.ts`:

```ts
import { NextResponse } from "next/server";

import { evaluateAutoReviewRolloutGate } from "@/features/auto-review/auto-review-rollout-gates";
import { listAutoReviewRolloutMetricRows } from "@/features/auto-review/auto-review-rollout-metrics-repository";
import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import { statusForServiceError } from "@/lib/http/route-error-status";

const allowedRoles = new Set(["owner", "ops_manager", "operator_business"]);

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await getAuthContext(supabase);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!allowedRoles.has(auth.role)) {
      return NextResponse.json(
        { error: "Only operations roles can read auto review rollout metrics" },
        { status: 403 },
      );
    }

    const parsed = parseRolloutMetricsQuery(new URL(request.url).searchParams);
    const metrics = await listAutoReviewRolloutMetricRows(supabase, {
      organizationId: auth.organizationId,
      config: parsed.config,
      limit: parsed.limit,
    });
    const gate = evaluateAutoReviewRolloutGate(metrics.gateInput);

    return NextResponse.json({
      result: {
        gate,
        metrics,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: statusForServiceError(error) },
      );
    }

    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
```

Add local parse helpers for enum, boolean, integer, and defaults.

- [ ] **Step 4: Run route tests to verify GREEN**

Run: `pnpm vitest run app/api/auto-review/rollout-metrics/route.test.ts`

Expected: PASS.

### Task 2: Regression And Push

**Files:**

- Create: `app/api/auto-review/rollout-metrics/route.ts`
- Create: `app/api/auto-review/rollout-metrics/route.test.ts`

- [ ] **Step 1: Run targeted regression tests**

Run:

```bash
pnpm vitest run app/api/auto-review/rollout-metrics/route.test.ts features/auto-review/auto-review-rollout-metrics-repository.test.ts
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
git add app/api/auto-review/rollout-metrics
git commit -m "feat: add AI3 auto review rollout metrics API"
```

Expected: implementation commit created.

- [ ] **Step 4: Push**

Run:

```bash
git push -u origin codex/ai3-auto-review-rollout-metrics-api
```

Expected: branch pushed and GitHub prints a PR URL.

## Self-Review

- Spec coverage: endpoint, auth, role filtering, query parsing, repository call, gate result, no raw audit rows, and no writes are covered.
- Placeholder scan: no deferred implementation markers are required.
- Type consistency: route config fields match `AutoReviewRolloutMetricsConfig` and feed the existing repository adapter.
