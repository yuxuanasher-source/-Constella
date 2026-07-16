# Unified Finance Settlement Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified finance batch center where finance creates typed batches first, with streamer payable as the first cross-project end-to-end flow.

**Architecture:** Add a new finance-batch domain beside the existing settlement domain instead of rewriting legacy `settlement_batches` in place. The first shippable path creates `streamer_payable` finance batches from approved, unsettled live reports across projects, stores project attribution per item, supports finance-owned adjustments, and exposes read APIs for the ops UI.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres migrations, Vitest, existing `components/reference-ui/ops-reference.jsx` reference UI, existing RBAC/audit/notification patterns.

---

## Scope And Sequencing

This spec is intentionally broad. Implement it in phases so each phase ships working software:

1. Finance batch schema and contracts.
2. Domain types, totals, status guards, and adjustment math.
3. Repository and service for `streamer_payable` cross-project batches.
4. API routes for list, detail, create, adjustments, and status transitions.
5. Ops UI finance center using the new APIs.
6. Project-detail read-only attribution.
7. Compatibility checks so old project settlement still works.

Do not implement real payment, real collection, real invoicing, or external accounting integrations in this plan.

## File Structure

Create:

- `supabase/migrations/20260716160000_unified_finance_batches.sql`  
  Defines finance batch tables, constraints, RLS policies, duplicate-source indexes, and immutable-lock triggers.
- `lib/db/unified-finance-batches-schema-contract.test.ts`  
  Contract test for migration content.
- `features/finance-batches/finance-batch-types.ts`  
  Shared finance batch enums, DTOs, and input types.
- `features/finance-batches/finance-batch-money.ts`  
  Money helpers and totals calculation.
- `features/finance-batches/finance-batch-status.ts`  
  Status transition and lock guards.
- `features/finance-batches/finance-batch-repository.ts`  
  Supabase repository for finance batch reads/writes.
- `features/finance-batches/finance-batch-service.ts`  
  Business service for preview, create, adjust, lock, reopen, void.
- `features/finance-batches/finance-batch-ui-adapters.ts`  
  Converts repository rows into reference UI DTOs.
- `features/finance-batches/finance-batch-money.test.ts`
- `features/finance-batches/finance-batch-status.test.ts`
- `features/finance-batches/finance-batch-service.test.ts`
- `features/finance-batches/finance-batch-repository.test.ts`
- `app/api/finance/batches/route.ts`
- `app/api/finance/batches/route.test.ts`
- `app/api/finance/batches/[batchId]/route.ts`
- `app/api/finance/batches/[batchId]/adjustments/route.ts`
- `app/api/finance/batches/[batchId]/lock/route.ts`
- `app/api/finance/batches/[batchId]/reopen/route.ts`
- `app/api/finance/batches/[batchId]/void/route.ts`
- `app/api/finance/batch-source-preview/route.ts`
- `app/api/finance/batch-source-preview/route.test.ts`

Modify:

- `components/reference-ui/ops-reference.jsx`  
  Add finance center UI state, actions, new finance center screen, and project-detail finance attribution block.
- `components/reference-ui/ops-reference.test.jsx`  
  Add focused UI tests for finance batch list, create preview, and project attribution.
- `app/(ops)/console/projects/page.tsx`  
  Hydrate finance batch summary data for project pages when needed.
- `app/(ops)/console/stubs/[module]/page.tsx`  
  Hydrate finance batch list for the settlement/finance module.
- `README.md` or `docs/product-function-document.md` only if implementation changes user-visible product behavior materially.

Leave untouched unless a later task explicitly needs it:

- Existing `features/settlements/custom-rule-*` files.
- Existing legacy settlement API routes under `app/api/settlement-batches`.
- Existing war-room files currently dirty in the worktree.

---

### Task 1: Add Finance Batch Schema And Contract Tests

**Files:**

- Create: `supabase/migrations/20260716160000_unified_finance_batches.sql`
- Create: `lib/db/unified-finance-batches-schema-contract.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Create `lib/db/unified-finance-batches-schema-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260716160000_unified_finance_batches.sql",
  ),
  "utf8",
).toLowerCase();

describe("unified finance batch schema", () => {
  it("creates finance batch tables", () => {
    expect(migration).toContain("create table if not exists public.finance_batches");
    expect(migration).toContain("create table if not exists public.finance_batch_items");
    expect(migration).toContain("create table if not exists public.finance_batch_adjustments");
  });

  it("defines typed batches and status checks", () => {
    expect(migration).toContain("finance_batches_batch_type_check");
    expect(migration).toContain("streamer_payable");
    expect(migration).toContain("collaboration_share");
    expect(migration).toContain("finance_batches_status_check");
    expect(migration).toContain("draft");
    expect(migration).toContain("locked");
    expect(migration).toContain("voided");
  });

  it("prevents duplicate active source consumption", () => {
    expect(migration).toContain("finance_batch_items_active_source_uidx");
    expect(migration).toMatch(
      /unique index[\s\S]*finance_batch_items[\s\S]*organization_id[\s\S]*batch_type[\s\S]*source_type[\s\S]*source_id/,
    );
  });

  it("keeps project attribution on every item", () => {
    expect(migration).toMatch(/project_id uuid not null references public\.projects\(id\)/);
    expect(migration).toContain("finance_batch_project_summary");
  });

  it("adds staff-scoped rls policies", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("finance_batches_staff_read");
    expect(migration).toContain("public.is_mcn_staff(organization_id)");
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```powershell
pnpm vitest run lib/db/unified-finance-batches-schema-contract.test.ts
```

Expected: FAIL because `20260716160000_unified_finance_batches.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260716160000_unified_finance_batches.sql`:

```sql
create table if not exists public.finance_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_type text not null,
  title text,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  has_exceptions boolean not null default false,
  system_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  final_amount numeric(14, 2) not null default 0,
  item_count integer not null default 0 check (item_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  created_by uuid references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  locked_by uuid references public.profiles(id),
  exported_by uuid references public.profiles(id),
  completed_by uuid references public.profiles(id),
  reopened_by uuid references public.profiles(id),
  voided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  locked_at timestamptz,
  exported_at timestamptz,
  completed_at timestamptz,
  reopened_at timestamptz,
  voided_at timestamptz,
  status_reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint finance_batches_period_check check (period_end >= period_start),
  constraint finance_batches_batch_type_check check (
    batch_type in ('receivable', 'streamer_payable', 'project_cost', 'collaboration_share')
  ),
  constraint finance_batches_status_check check (
    status in ('draft', 'pending_review', 'confirmed', 'locked', 'exported', 'completed', 'rejected', 'reopened', 'voided')
  ),
  constraint finance_batches_amount_check check (
    final_amount = system_amount + adjustment_amount
  )
);

create table if not exists public.finance_batch_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null references public.finance_batches(id) on delete cascade,
  batch_type text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  counterparty_type text not null,
  counterparty_id uuid,
  counterparty_name_snapshot text,
  source_type text not null,
  source_id uuid not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  system_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  final_amount numeric(14, 2) not null default 0,
  evidence_level text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  exception_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_batch_items_batch_type_check check (
    batch_type in ('receivable', 'streamer_payable', 'project_cost', 'collaboration_share')
  ),
  constraint finance_batch_items_counterparty_type_check check (
    counterparty_type in ('customer', 'streamer', 'project', 'collaboration_partner')
  ),
  constraint finance_batch_items_status_check check (
    status in ('active', 'voided')
  ),
  constraint finance_batch_items_amount_check check (
    final_amount = system_amount + adjustment_amount
  )
);

create table if not exists public.finance_batch_adjustments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finance_batch_id uuid not null references public.finance_batches(id) on delete cascade,
  finance_batch_item_id uuid references public.finance_batch_items(id) on delete cascade,
  direction text not null,
  amount numeric(14, 2) not null,
  reason text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  constraint finance_batch_adjustments_direction_check check (
    direction in ('increase', 'decrease')
  ),
  constraint finance_batch_adjustments_amount_check check (amount > 0),
  constraint finance_batch_adjustments_reason_check check (nullif(trim(reason), '') is not null),
  constraint finance_batch_adjustments_void_reason_check check (
    voided_at is null or nullif(trim(coalesce(void_reason, '')), '') is not null
  )
);

create index if not exists finance_batches_org_status_idx
  on public.finance_batches (organization_id, status, updated_at desc);

create index if not exists finance_batches_org_type_period_idx
  on public.finance_batches (organization_id, batch_type, period_start, period_end);

create index if not exists finance_batch_items_batch_idx
  on public.finance_batch_items (organization_id, finance_batch_id, created_at);

create index if not exists finance_batch_items_project_idx
  on public.finance_batch_items (organization_id, project_id, batch_type);

create unique index if not exists finance_batch_items_active_source_uidx
  on public.finance_batch_items (organization_id, batch_type, source_type, source_id)
  where status = 'active';

create index if not exists finance_batch_adjustments_batch_idx
  on public.finance_batch_adjustments (organization_id, finance_batch_id, created_at)
  where voided_at is null;

create or replace view public.finance_batch_project_summary as
select
  i.organization_id,
  i.finance_batch_id,
  i.project_id,
  sum(case when i.batch_type = 'receivable' then i.final_amount else 0 end) as receivable_amount,
  sum(case when i.batch_type = 'streamer_payable' then i.final_amount else 0 end) as streamer_payable_amount,
  sum(case when i.batch_type = 'project_cost' then i.final_amount else 0 end) as project_cost_amount,
  sum(case when i.batch_type = 'collaboration_share' then i.final_amount else 0 end) as collaboration_share_amount,
  sum(case when i.batch_type = 'receivable' then i.final_amount else 0 end)
    - sum(case when i.batch_type = 'streamer_payable' then i.final_amount else 0 end)
    - sum(case when i.batch_type = 'project_cost' then i.final_amount else 0 end)
    - sum(case when i.batch_type = 'collaboration_share' then i.final_amount else 0 end) as gross_margin_impact,
  count(*)::integer as item_count,
  count(*) filter (where jsonb_array_length(i.exception_flags) > 0)::integer as exception_count
from public.finance_batch_items i
join public.finance_batches b on b.id = i.finance_batch_id
where i.status = 'active' and b.status <> 'voided'
group by i.organization_id, i.finance_batch_id, i.project_id;

alter table public.finance_batches enable row level security;
alter table public.finance_batch_items enable row level security;
alter table public.finance_batch_adjustments enable row level security;

create policy finance_batches_staff_read
on public.finance_batches for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy finance_batch_items_staff_read
on public.finance_batch_items for select
to authenticated
using (public.is_mcn_staff(organization_id));

create policy finance_batch_adjustments_staff_read
on public.finance_batch_adjustments for select
to authenticated
using (public.is_mcn_staff(organization_id));

revoke all on table public.finance_batches from public, anon, authenticated, service_role;
revoke all on table public.finance_batch_items from public, anon, authenticated, service_role;
revoke all on table public.finance_batch_adjustments from public, anon, authenticated, service_role;
grant select on table public.finance_batches to authenticated;
grant select on table public.finance_batch_items to authenticated;
grant select on table public.finance_batch_adjustments to authenticated;
grant select on table public.finance_batch_project_summary to authenticated;
```

- [ ] **Step 4: Run schema contract test**

Run:

```powershell
pnpm vitest run lib/db/unified-finance-batches-schema-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add supabase/migrations/20260716160000_unified_finance_batches.sql lib/db/unified-finance-batches-schema-contract.test.ts
git commit -m "feat: add unified finance batch schema"
```

---

### Task 2: Add Domain Types, Money Helpers, And Status Guards

**Files:**

- Create: `features/finance-batches/finance-batch-types.ts`
- Create: `features/finance-batches/finance-batch-money.ts`
- Create: `features/finance-batches/finance-batch-status.ts`
- Create: `features/finance-batches/finance-batch-money.test.ts`
- Create: `features/finance-batches/finance-batch-status.test.ts`

- [ ] **Step 1: Write money helper tests**

Create `features/finance-batches/finance-batch-money.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  financeAmount,
  signedAdjustmentAmount,
  summarizeFinanceItems,
} from "./finance-batch-money";

describe("finance batch money helpers", () => {
  it("normalizes amounts to two decimals", () => {
    expect(financeAmount(12.345)).toBe(12.35);
    expect(financeAmount("8.1")).toBe(8.1);
  });

  it("rejects unsafe amounts", () => {
    expect(() => financeAmount(Number.NaN)).toThrow("Invalid finance amount");
    expect(() => financeAmount("abc")).toThrow("Invalid finance amount");
  });

  it("computes signed adjustments", () => {
    expect(signedAdjustmentAmount({ direction: "increase", amount: 25 })).toBe(25);
    expect(signedAdjustmentAmount({ direction: "decrease", amount: 25 })).toBe(-25);
  });

  it("summarizes system, adjustment, and final amounts", () => {
    expect(
      summarizeFinanceItems([
        { systemAmount: 100, adjustmentAmount: 10 },
        { systemAmount: 60, adjustmentAmount: -5 },
      ]),
    ).toEqual({
      systemAmount: 160,
      adjustmentAmount: 5,
      finalAmount: 165,
      itemCount: 2,
    });
  });
});
```

- [ ] **Step 2: Write status guard tests**

Create `features/finance-batches/finance-batch-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertFinanceBatchAdjustable,
  assertFinanceBatchTransition,
  nextFinanceBatchStatus,
} from "./finance-batch-status";

describe("finance batch status guards", () => {
  it("allows the normal lock path", () => {
    expect(nextFinanceBatchStatus("draft", "submit")).toBe("pending_review");
    expect(nextFinanceBatchStatus("pending_review", "confirm")).toBe("confirmed");
    expect(nextFinanceBatchStatus("confirmed", "lock")).toBe("locked");
    expect(nextFinanceBatchStatus("locked", "export")).toBe("exported");
    expect(nextFinanceBatchStatus("exported", "complete")).toBe("completed");
  });

  it("blocks invalid transitions", () => {
    expect(() => assertFinanceBatchTransition("draft", "lock")).toThrow(
      "Cannot lock finance batch from draft",
    );
  });

  it("requires reopen before locked batch adjustment", () => {
    expect(() => assertFinanceBatchAdjustable("locked")).toThrow(
      "Locked finance batches cannot be adjusted",
    );
    expect(() => assertFinanceBatchAdjustable("draft")).not.toThrow();
    expect(() => assertFinanceBatchAdjustable("reopened")).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```powershell
pnpm vitest run features/finance-batches/finance-batch-money.test.ts features/finance-batches/finance-batch-status.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 4: Add shared types**

Create `features/finance-batches/finance-batch-types.ts`:

```ts
import type { UserRole } from "@/lib/rbac/roles";

export type FinanceBatchType =
  | "receivable"
  | "streamer_payable"
  | "project_cost"
  | "collaboration_share";

export type FinanceBatchStatus =
  | "draft"
  | "pending_review"
  | "confirmed"
  | "locked"
  | "exported"
  | "completed"
  | "rejected"
  | "reopened"
  | "voided";

export type FinanceBatchAction =
  | "submit"
  | "confirm"
  | "lock"
  | "export"
  | "complete"
  | "reject"
  | "reopen"
  | "void";

export type FinanceAdjustmentDirection = "increase" | "decrease";

export type FinanceCounterpartyType =
  | "customer"
  | "streamer"
  | "project"
  | "collaboration_partner";

export type FinanceSourceType =
  | "live_report"
  | "settlement_rule_result"
  | "receivable_rule_result"
  | "project_cost_item"
  | "cost_import_item"
  | "collaboration_settlement_item"
  | "project_collaboration_share";

export type FinanceActor = {
  userId: string;
  name?: string | null;
  role: UserRole;
  organizationId: string;
};

export type FinanceBatchRecord = {
  id: string;
  organizationId: string;
  batchType: FinanceBatchType;
  title: string | null;
  periodStart: string;
  periodEnd: string;
  status: FinanceBatchStatus;
  hasExceptions: boolean;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  itemCount: number;
  exceptionCount: number;
  createdBy: string | null;
  statusReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FinanceBatchItemRecord = {
  id: string;
  organizationId: string;
  financeBatchId: string;
  batchType: FinanceBatchType;
  projectId: string;
  counterpartyType: FinanceCounterpartyType;
  counterpartyId: string | null;
  counterpartyNameSnapshot: string | null;
  sourceType: FinanceSourceType;
  sourceId: string;
  sourceSnapshot: Record<string, unknown>;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  evidenceLevel: string | null;
  evidenceSnapshot: Record<string, unknown>;
  status: "active" | "voided";
  exceptionFlags: string[];
  createdAt: string;
  updatedAt: string;
};

export type FinanceBatchAdjustmentRecord = {
  id: string;
  organizationId: string;
  financeBatchId: string;
  financeBatchItemId: string | null;
  direction: FinanceAdjustmentDirection;
  amount: number;
  reason: string;
  evidenceSnapshot: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  voidedAt: string | null;
};

export type CreateFinanceBatchInput = {
  batchType: FinanceBatchType;
  title?: string;
  periodStart: string;
  periodEnd: string;
  selection: {
    projectIds?: string[];
    streamerIds?: string[];
    sourceIds?: string[];
  };
};
```

- [ ] **Step 5: Add money helpers**

Create `features/finance-batches/finance-batch-money.ts`:

```ts
import type { FinanceAdjustmentDirection } from "./finance-batch-types";

export function financeAmount(value: number | string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    throw new Error("Invalid finance amount");
  }
  return Math.round(numeric * 100) / 100;
}

export function signedAdjustmentAmount(input: {
  direction: FinanceAdjustmentDirection;
  amount: number;
}): number {
  const amount = financeAmount(input.amount);
  return input.direction === "decrease" ? -amount : amount;
}

export function summarizeFinanceItems(
  items: Array<{ systemAmount: number; adjustmentAmount: number }>,
): {
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  itemCount: number;
} {
  const systemAmount = financeAmount(
    items.reduce((sum, item) => sum + item.systemAmount, 0),
  );
  const adjustmentAmount = financeAmount(
    items.reduce((sum, item) => sum + item.adjustmentAmount, 0),
  );
  return {
    systemAmount,
    adjustmentAmount,
    finalAmount: financeAmount(systemAmount + adjustmentAmount),
    itemCount: items.length,
  };
}
```

- [ ] **Step 6: Add status guards**

Create `features/finance-batches/finance-batch-status.ts`:

```ts
import type {
  FinanceBatchAction,
  FinanceBatchStatus,
} from "./finance-batch-types";

const transitions: Record<
  FinanceBatchAction,
  Partial<Record<FinanceBatchStatus, FinanceBatchStatus>>
> = {
  submit: { draft: "pending_review", reopened: "pending_review" },
  confirm: { pending_review: "confirmed" },
  lock: { confirmed: "locked" },
  export: { locked: "exported" },
  complete: { exported: "completed" },
  reject: { pending_review: "rejected" },
  reopen: { locked: "reopened", exported: "reopened", completed: "reopened" },
  void: {
    draft: "voided",
    pending_review: "voided",
    rejected: "voided",
    reopened: "voided",
  },
};

export function nextFinanceBatchStatus(
  status: FinanceBatchStatus,
  action: FinanceBatchAction,
): FinanceBatchStatus {
  const next = transitions[action][status];
  if (!next) {
    throw new Error(`Cannot ${action} finance batch from ${status}`);
  }
  return next;
}

export function assertFinanceBatchTransition(
  status: FinanceBatchStatus,
  action: FinanceBatchAction,
): void {
  nextFinanceBatchStatus(status, action);
}

export function assertFinanceBatchAdjustable(
  status: FinanceBatchStatus,
): void {
  if (["locked", "exported", "completed", "voided"].includes(status)) {
    throw new Error("Locked finance batches cannot be adjusted");
  }
}
```

- [ ] **Step 7: Run tests**

Run:

```powershell
pnpm vitest run features/finance-batches/finance-batch-money.test.ts features/finance-batches/finance-batch-status.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add features/finance-batches/finance-batch-types.ts features/finance-batches/finance-batch-money.ts features/finance-batches/finance-batch-status.ts features/finance-batches/finance-batch-money.test.ts features/finance-batches/finance-batch-status.test.ts
git commit -m "feat: add finance batch domain helpers"
```

---

### Task 3: Add Repository And Streamer Payable Service

**Files:**

- Create: `features/finance-batches/finance-batch-repository.ts`
- Create: `features/finance-batches/finance-batch-service.ts`
- Create: `features/finance-batches/finance-batch-service.test.ts`
- Create: `features/finance-batches/finance-batch-repository.test.ts`

- [ ] **Step 1: Write service tests for cross-project streamer payable**

Create `features/finance-batches/finance-batch-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  addFinanceBatchAdjustment,
  createFinanceBatch,
  transitionFinanceBatch,
  type FinanceBatchRepository,
} from "./finance-batch-service";

const actor = {
  userId: "user-finance",
  role: "finance" as const,
  organizationId: "org-1",
  name: "Finance",
};

const reports = [
  {
    id: "report-1",
    organizationId: "org-1",
    projectId: "project-a",
    projectName: "Project A",
    streamerId: "streamer-1",
    streamerName: "Alice",
    settlementDuration: 120,
    evidenceLevel: "green",
    createdAt: "2026-07-02T10:00:00.000Z",
    hourlyRate: 80,
  },
  {
    id: "report-2",
    organizationId: "org-1",
    projectId: "project-b",
    projectName: "Project B",
    streamerId: "streamer-1",
    streamerName: "Alice",
    settlementDuration: 60,
    evidenceLevel: "green",
    createdAt: "2026-07-03T10:00:00.000Z",
    hourlyRate: 100,
  },
];

function createRepo(): FinanceBatchRepository {
  return {
    listStreamerPayableSources: vi.fn(async () => reports),
    createFinanceBatchAtomic: vi.fn(async (input) => ({
      batch: {
        id: "finance-batch-1",
        organizationId: input.organizationId,
        batchType: input.batchType,
        title: input.title ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: "draft",
        hasExceptions: false,
        systemAmount: input.systemAmount,
        adjustmentAmount: input.adjustmentAmount,
        finalAmount: input.finalAmount,
        itemCount: input.items.length,
        exceptionCount: 0,
        createdBy: input.createdBy,
        statusReason: null,
        metadata: {},
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
      items: input.items.map((item, index) => ({
        id: `item-${index + 1}`,
        organizationId: input.organizationId,
        financeBatchId: "finance-batch-1",
        batchType: input.batchType,
        projectId: item.projectId,
        counterpartyType: item.counterpartyType,
        counterpartyId: item.counterpartyId,
        counterpartyNameSnapshot: item.counterpartyNameSnapshot,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceSnapshot: item.sourceSnapshot,
        systemAmount: item.systemAmount,
        adjustmentAmount: 0,
        finalAmount: item.systemAmount,
        evidenceLevel: item.evidenceLevel,
        evidenceSnapshot: item.evidenceSnapshot,
        status: "active",
        exceptionFlags: [],
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      })),
    })),
    getFinanceBatch: vi.fn(async () => ({
      id: "finance-batch-1",
      organizationId: "org-1",
      batchType: "streamer_payable",
      title: null,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      status: "draft",
      hasExceptions: false,
      systemAmount: 260,
      adjustmentAmount: 0,
      finalAmount: 260,
      itemCount: 2,
      exceptionCount: 0,
      createdBy: "user-finance",
      statusReason: null,
      metadata: {},
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    })),
    addAdjustment: vi.fn(async () => ({
      id: "adjustment-1",
      organizationId: "org-1",
      financeBatchId: "finance-batch-1",
      financeBatchItemId: null,
      direction: "increase",
      amount: 20,
      reason: "补贴",
      evidenceSnapshot: {},
      createdBy: "user-finance",
      createdAt: "2026-07-16T00:01:00.000Z",
      voidedAt: null,
    })),
    transitionBatch: vi.fn(async (_input) => ({
      id: "finance-batch-1",
      organizationId: "org-1",
      batchType: "streamer_payable",
      title: null,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      status: "pending_review",
      hasExceptions: false,
      systemAmount: 260,
      adjustmentAmount: 0,
      finalAmount: 260,
      itemCount: 2,
      exceptionCount: 0,
      createdBy: "user-finance",
      statusReason: null,
      metadata: {},
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:02:00.000Z",
    })),
  };
}

describe("finance batch service", () => {
  it("creates a cross-project streamer payable batch", async () => {
    const repo = createRepo();
    const result = await createFinanceBatch({
      repo,
      actor,
      input: {
        batchType: "streamer_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        title: "7月主播付款",
        selection: { streamerIds: ["streamer-1"] },
      },
    });

    expect(repo.listStreamerPayableSources).toHaveBeenCalledWith({
      organizationId: "org-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      projectIds: undefined,
      streamerIds: ["streamer-1"],
      sourceIds: undefined,
    });
    expect(result.batch.systemAmount).toBe(260);
    expect(result.items.map((item) => item.projectId)).toEqual([
      "project-a",
      "project-b",
    ]);
  });

  it("blocks unsupported batch types until their source adapters are added", async () => {
    await expect(
      createFinanceBatch({
        repo: createRepo(),
        actor,
        input: {
          batchType: "receivable",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          selection: {},
        },
      }),
    ).rejects.toThrow("receivable finance batches are not enabled yet");
  });

  it("adds finance-owned adjustments without changing system amount", async () => {
    const repo = createRepo();
    const adjustment = await addFinanceBatchAdjustment({
      repo,
      actor,
      batchId: "finance-batch-1",
      input: { direction: "increase", amount: 20, reason: "补贴" },
    });

    expect(adjustment.amount).toBe(20);
    expect(repo.addAdjustment).toHaveBeenCalledWith({
      organizationId: "org-1",
      batchId: "finance-batch-1",
      itemId: undefined,
      direction: "increase",
      amount: 20,
      reason: "补贴",
      evidenceSnapshot: {},
      createdBy: "user-finance",
    });
  });

  it("transitions batches through status guards", async () => {
    const repo = createRepo();
    const batch = await transitionFinanceBatch({
      repo,
      actor,
      batchId: "finance-batch-1",
      action: "submit",
    });

    expect(batch.status).toBe("pending_review");
    expect(repo.transitionBatch).toHaveBeenCalledWith({
      organizationId: "org-1",
      batchId: "finance-batch-1",
      action: "submit",
      nextStatus: "pending_review",
      actorUserId: "user-finance",
      reason: undefined,
    });
  });
});
```

- [ ] **Step 2: Run service test and verify it fails**

Run:

```powershell
pnpm vitest run features/finance-batches/finance-batch-service.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement service interface and logic**

Create `features/finance-batches/finance-batch-service.ts`:

```ts
import { isMcnStaff } from "@/lib/rbac/roles";

import { financeAmount, signedAdjustmentAmount, summarizeFinanceItems } from "./finance-batch-money";
import {
  assertFinanceBatchAdjustable,
  nextFinanceBatchStatus,
} from "./finance-batch-status";
import type {
  CreateFinanceBatchInput,
  FinanceActor,
  FinanceBatchAction,
  FinanceBatchAdjustmentRecord,
  FinanceBatchItemRecord,
  FinanceBatchRecord,
  FinanceBatchType,
  FinanceCounterpartyType,
  FinanceSourceType,
} from "./finance-batch-types";

export type StreamerPayableSource = {
  id: string;
  organizationId: string;
  projectId: string;
  projectName: string | null;
  streamerId: string;
  streamerName: string | null;
  settlementDuration: number | null;
  evidenceLevel: string | null;
  createdAt: string;
  hourlyRate: number;
};

type AtomicFinanceItemInput = {
  projectId: string;
  counterpartyType: FinanceCounterpartyType;
  counterpartyId: string | null;
  counterpartyNameSnapshot: string | null;
  sourceType: FinanceSourceType;
  sourceId: string;
  sourceSnapshot: Record<string, unknown>;
  systemAmount: number;
  evidenceLevel: string | null;
  evidenceSnapshot: Record<string, unknown>;
};

export type FinanceBatchRepository = {
  listStreamerPayableSources(input: {
    organizationId: string;
    periodStart: string;
    periodEnd: string;
    projectIds?: string[];
    streamerIds?: string[];
    sourceIds?: string[];
  }): Promise<StreamerPayableSource[]>;
  createFinanceBatchAtomic(input: {
    organizationId: string;
    batchType: FinanceBatchType;
    title?: string | null;
    periodStart: string;
    periodEnd: string;
    systemAmount: number;
    adjustmentAmount: number;
    finalAmount: number;
    createdBy: string;
    items: AtomicFinanceItemInput[];
  }): Promise<{ batch: FinanceBatchRecord; items: FinanceBatchItemRecord[] }>;
  getFinanceBatch(input: {
    organizationId: string;
    batchId: string;
  }): Promise<FinanceBatchRecord | null>;
  addAdjustment(input: {
    organizationId: string;
    batchId: string;
    itemId?: string;
    direction: "increase" | "decrease";
    amount: number;
    reason: string;
    evidenceSnapshot: Record<string, unknown>;
    createdBy: string;
  }): Promise<FinanceBatchAdjustmentRecord>;
  transitionBatch(input: {
    organizationId: string;
    batchId: string;
    action: FinanceBatchAction;
    nextStatus: FinanceBatchRecord["status"];
    actorUserId: string;
    reason?: string;
  }): Promise<FinanceBatchRecord>;
};

export async function createFinanceBatch({
  repo,
  actor,
  input,
}: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  input: CreateFinanceBatchInput;
}): Promise<{ batch: FinanceBatchRecord; items: FinanceBatchItemRecord[] }> {
  assertFinanceStaff(actor);
  assertPeriod(input.periodStart, input.periodEnd);

  if (input.batchType !== "streamer_payable") {
    throw new Error(`${input.batchType} finance batches are not enabled yet`);
  }

  const sources = await repo.listStreamerPayableSources({
    organizationId: actor.organizationId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    projectIds: normalizeOptionalIds(input.selection.projectIds),
    streamerIds: normalizeOptionalIds(input.selection.streamerIds),
    sourceIds: normalizeOptionalIds(input.selection.sourceIds),
  });

  if (sources.length === 0) {
    throw new Error("No eligible streamer payable sources found");
  }

  const items = sources.map(sourceToStreamerPayableItem);
  const totals = summarizeFinanceItems(
    items.map((item) => ({ systemAmount: item.systemAmount, adjustmentAmount: 0 })),
  );

  return repo.createFinanceBatchAtomic({
    organizationId: actor.organizationId,
    batchType: input.batchType,
    title: input.title?.trim() || null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    systemAmount: totals.systemAmount,
    adjustmentAmount: totals.adjustmentAmount,
    finalAmount: totals.finalAmount,
    createdBy: actor.userId,
    items,
  });
}

export async function addFinanceBatchAdjustment({
  repo,
  actor,
  batchId,
  input,
}: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  batchId: string;
  input: {
    itemId?: string;
    direction: "increase" | "decrease";
    amount: number;
    reason: string;
    evidenceSnapshot?: Record<string, unknown>;
  };
}): Promise<FinanceBatchAdjustmentRecord> {
  assertFinanceStaff(actor);
  const batch = await requireBatch(repo, actor.organizationId, batchId);
  assertFinanceBatchAdjustable(batch.status);

  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Adjustment reason is required");
  }

  return repo.addAdjustment({
    organizationId: actor.organizationId,
    batchId,
    itemId: input.itemId,
    direction: input.direction,
    amount: Math.abs(signedAdjustmentAmount(input)),
    reason,
    evidenceSnapshot: input.evidenceSnapshot ?? {},
    createdBy: actor.userId,
  });
}

export async function transitionFinanceBatch({
  repo,
  actor,
  batchId,
  action,
  reason,
}: {
  repo: FinanceBatchRepository;
  actor: FinanceActor;
  batchId: string;
  action: FinanceBatchAction;
  reason?: string;
}): Promise<FinanceBatchRecord> {
  assertFinanceStaff(actor);
  const batch = await requireBatch(repo, actor.organizationId, batchId);
  const nextStatus = nextFinanceBatchStatus(batch.status, action);
  return repo.transitionBatch({
    organizationId: actor.organizationId,
    batchId,
    action,
    nextStatus,
    actorUserId: actor.userId,
    reason: reason?.trim() || undefined,
  });
}

function sourceToStreamerPayableItem(source: StreamerPayableSource): AtomicFinanceItemInput {
  const hours = (source.settlementDuration ?? 0) / 60;
  const systemAmount = financeAmount(hours * source.hourlyRate);
  return {
    projectId: source.projectId,
    counterpartyType: "streamer",
    counterpartyId: source.streamerId,
    counterpartyNameSnapshot: source.streamerName,
    sourceType: "live_report",
    sourceId: source.id,
    sourceSnapshot: {
      projectId: source.projectId,
      projectName: source.projectName,
      streamerId: source.streamerId,
      streamerName: source.streamerName,
      settlementDuration: source.settlementDuration,
      hourlyRate: source.hourlyRate,
      createdAt: source.createdAt,
    },
    systemAmount,
    evidenceLevel: source.evidenceLevel,
    evidenceSnapshot: {
      evidenceLevel: source.evidenceLevel,
      settlementDuration: source.settlementDuration,
    },
  };
}

async function requireBatch(
  repo: FinanceBatchRepository,
  organizationId: string,
  batchId: string,
): Promise<FinanceBatchRecord> {
  const batch = await repo.getFinanceBatch({ organizationId, batchId });
  if (!batch) {
    throw new Error("Finance batch not found");
  }
  return batch;
}

function assertFinanceStaff(actor: FinanceActor): void {
  if (!isMcnStaff(actor.role)) {
    throw new Error("Only MCN staff can manage finance batches");
  }
}

function assertPeriod(periodStart: string, periodEnd: string): void {
  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    throw new Error("Invalid finance batch period");
  }
}

function normalizeOptionalIds(ids?: string[]): string[] | undefined {
  if (!ids?.length) {
    return undefined;
  }
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).sort();
}
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
pnpm vitest run features/finance-batches/finance-batch-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add repository implementation and contract smoke test**

Create `features/finance-batches/finance-batch-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toFinanceBatchRecord, toFinanceBatchItemRecord } from "./finance-batch-repository";

describe("finance batch repository mappers", () => {
  it("maps finance batch rows", () => {
    expect(
      toFinanceBatchRecord({
        id: "batch-1",
        organization_id: "org-1",
        batch_type: "streamer_payable",
        title: "7月主播付款",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        status: "draft",
        has_exceptions: false,
        system_amount: 260,
        adjustment_amount: 20,
        final_amount: 280,
        item_count: 2,
        exception_count: 0,
        created_by: "user-1",
        status_reason: null,
        metadata: {},
        created_at: "2026-07-16T00:00:00.000Z",
        updated_at: "2026-07-16T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "batch-1",
      organizationId: "org-1",
      batchType: "streamer_payable",
      systemAmount: 260,
      finalAmount: 280,
    });
  });

  it("maps finance batch item rows", () => {
    expect(
      toFinanceBatchItemRecord({
        id: "item-1",
        organization_id: "org-1",
        finance_batch_id: "batch-1",
        batch_type: "streamer_payable",
        project_id: "project-1",
        counterparty_type: "streamer",
        counterparty_id: "streamer-1",
        counterparty_name_snapshot: "Alice",
        source_type: "live_report",
        source_id: "report-1",
        source_snapshot: {},
        system_amount: 100,
        adjustment_amount: 0,
        final_amount: 100,
        evidence_level: "green",
        evidence_snapshot: {},
        status: "active",
        exception_flags: [],
        created_at: "2026-07-16T00:00:00.000Z",
        updated_at: "2026-07-16T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "item-1",
      projectId: "project-1",
      counterpartyType: "streamer",
      finalAmount: 100,
    });
  });
});
```

Create `features/finance-batches/finance-batch-repository.ts` with exported mappers first, then add Supabase methods. Use the existing `SupabaseSettlementRepository` style for `from(...).select(...).returns<...>()`.

Minimum exported mapper signatures:

```ts
export function toFinanceBatchRecord(row: FinanceBatchRow): FinanceBatchRecord;
export function toFinanceBatchItemRecord(row: FinanceBatchItemRow): FinanceBatchItemRecord;
```

Minimum repository methods:

```ts
export class SupabaseFinanceBatchRepository implements FinanceBatchRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listStreamerPayableSources(input: {
    organizationId: string;
    periodStart: string;
    periodEnd: string;
    projectIds?: string[];
    streamerIds?: string[];
    sourceIds?: string[];
  }): Promise<StreamerPayableSource[]> {
    let query = this.client
      .from("live_reports")
      .select(
        "id, organization_id, project_id, streamer_id, settlement_duration, evidence_level, created_at, projects(name), streamers(display_name), project_streamers(hourly_rate)",
      )
      .eq("organization_id", input.organizationId)
      .eq("status", "approved")
      .eq("enter_settlement_pool", true)
      .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
      .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
      .order("created_at", { ascending: true });

    if (input.projectIds?.length) query = query.in("project_id", input.projectIds);
    if (input.streamerIds?.length) query = query.in("streamer_id", input.streamerIds);
    if (input.sourceIds?.length) query = query.in("id", input.sourceIds);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      projectName: first(row.projects)?.name ?? null,
      streamerId: row.streamer_id,
      streamerName: first(row.streamers)?.display_name ?? null,
      settlementDuration: row.settlement_duration,
      evidenceLevel: row.evidence_level,
      createdAt: row.created_at,
      hourlyRate: Number(first(row.project_streamers)?.hourly_rate ?? 0),
    }));
  }
}
```

When implementing `createFinanceBatchAtomic`, prefer a Postgres RPC if duplicate-source insertion and totals must be atomic. For the first pass, a single service-role route context can insert batch and items sequentially only if tests cover duplicate-source failures and clean error handling; otherwise add an RPC in the migration follow-up.

- [ ] **Step 6: Run repository and service tests**

Run:

```powershell
pnpm vitest run features/finance-batches/finance-batch-repository.test.ts features/finance-batches/finance-batch-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add features/finance-batches
git commit -m "feat: create finance batch service"
```

---

### Task 4: Add Finance Batch API Routes

**Files:**

- Create: `app/api/finance/batches/route.ts`
- Create: `app/api/finance/batches/route.test.ts`
- Create: `app/api/finance/batches/[batchId]/route.ts`
- Create: `app/api/finance/batches/[batchId]/adjustments/route.ts`
- Create: `app/api/finance/batches/[batchId]/lock/route.ts`
- Create: `app/api/finance/batches/[batchId]/reopen/route.ts`
- Create: `app/api/finance/batches/[batchId]/void/route.ts`
- Create: `app/api/finance/batch-source-preview/route.ts`
- Create: `app/api/finance/batch-source-preview/route.test.ts`

- [ ] **Step 1: Write route tests**

Create `app/api/finance/batches/route.test.ts` with mocks matching existing route tests:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/features/settlements/settlement-route-utils", () => ({
  getSettlementRouteContext: vi.fn(async () => ({
    supabase: {},
    auth: {
      userId: "user-finance",
      role: "finance",
      organizationId: "org-1",
      name: "Finance",
    },
  })),
  jsonError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    ),
  readJsonBody: async (request: Request) => request.json(),
  settlementActorFromContext: () => ({
    userId: "user-finance",
    role: "finance",
    organizationId: "org-1",
    name: "Finance",
  }),
}));

vi.mock("@/features/finance-batches/finance-batch-repository", () => ({
  SupabaseFinanceBatchRepository: vi.fn(() => ({})),
}));

vi.mock("@/features/finance-batches/finance-batch-service", () => ({
  createFinanceBatch: vi.fn(async () => ({
    batch: { id: "finance-batch-1", batchType: "streamer_payable" },
    items: [{ id: "item-1" }],
  })),
}));

describe("POST /api/finance/batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a streamer payable finance batch", async () => {
    const request = new NextRequest("http://localhost/api/finance/batches", {
      method: "POST",
      body: JSON.stringify({
        batchType: "streamer_payable",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        title: "7月主播付款",
        selection: { streamerIds: ["streamer-1"] },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "finance-batch-1", batchType: "streamer_payable" },
      items: [{ id: "item-1" }],
    });
  });
});
```

- [ ] **Step 2: Run route test and verify it fails**

Run:

```powershell
pnpm vitest run app/api/finance/batches/route.test.ts
```

Expected: FAIL because route files do not exist.

- [ ] **Step 3: Implement `POST /api/finance/batches`**

Create `app/api/finance/batches/route.ts`:

```ts
import { NextResponse } from "next/server";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { createFinanceBatch } from "@/features/finance-batches/finance-batch-service";
import type { FinanceBatchType } from "@/features/finance-batches/finance-batch-types";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";

const financeBatchTypes = new Set([
  "receivable",
  "streamer_payable",
  "project_cost",
  "collaboration_share",
]);

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const batchType = requiredString(body, "batchType");
    if (!financeBatchTypes.has(batchType)) {
      throw new Error("batchType must be a valid finance batch type");
    }

    const context = await getSettlementRouteContext();
    await assertBillingWriteAllowed({
      client: context.supabase,
      organizationId: context.auth.organizationId,
      featureKey: "settlement",
    });

    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const result = await createFinanceBatch({
      repo,
      actor: settlementActorFromContext(context),
      input: {
        batchType: batchType as FinanceBatchType,
        periodStart: requiredString(body, "periodStart"),
        periodEnd: requiredString(body, "periodEnd"),
        title: typeof body.title === "string" ? body.title : undefined,
        selection:
          body.selection && typeof body.selection === "object"
            ? (body.selection as { projectIds?: string[]; streamerIds?: string[]; sourceIds?: string[] })
            : {},
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
```

Also add `GET` in the same file after repository list methods exist:

```ts
export async function GET() {
  try {
    const context = await getSettlementRouteContext();
    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const batches = await repo.listFinanceBatches({
      organizationId: context.auth.organizationId,
    });
    return NextResponse.json({ batches });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 4: Implement status/action routes**

For each action route, use the same pattern:

```ts
import { NextResponse } from "next/server";

import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { transitionFinanceBatch } from "@/features/finance-batches/finance-batch-service";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getSettlementRouteContext();
    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const batch = await transitionFinanceBatch({
      repo,
      actor: settlementActorFromContext(context),
      batchId,
      action: "lock",
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return NextResponse.json({ batch });
  } catch (error) {
    return jsonError(error);
  }
}
```

Use action values:

- `lock/route.ts`: `"lock"`
- `reopen/route.ts`: `"reopen"`
- `void/route.ts`: `"void"`

- [ ] **Step 5: Implement adjustments route**

Create `app/api/finance/batches/[batchId]/adjustments/route.ts`:

```ts
import { NextResponse } from "next/server";

import { SupabaseFinanceBatchRepository } from "@/features/finance-batches/finance-batch-repository";
import { addFinanceBatchAdjustment } from "@/features/finance-batches/finance-batch-service";
import {
  getSettlementRouteContext,
  jsonError,
  readJsonBody,
  requiredString,
  settlementActorFromContext,
} from "@/features/settlements/settlement-route-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = await readJsonBody(request);
    const context = await getSettlementRouteContext();
    const repo = new SupabaseFinanceBatchRepository(context.supabase);
    const adjustment = await addFinanceBatchAdjustment({
      repo,
      actor: settlementActorFromContext(context),
      batchId,
      input: {
        itemId: typeof body.itemId === "string" ? body.itemId : undefined,
        direction: requiredString(body, "direction") as "increase" | "decrease",
        amount: Number(body.amount),
        reason: requiredString(body, "reason"),
        evidenceSnapshot:
          body.evidenceSnapshot && typeof body.evidenceSnapshot === "object"
            ? (body.evidenceSnapshot as Record<string, unknown>)
            : {},
      },
    });
    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
```

- [ ] **Step 6: Run API tests**

Run:

```powershell
pnpm vitest run app/api/finance/batches/route.test.ts app/api/finance/batch-source-preview/route.test.ts
```

Expected: PASS after the preview route test and implementation are added.

- [ ] **Step 7: Commit**

Run:

```powershell
git add app/api/finance features/finance-batches
git commit -m "feat: add finance batch api routes"
```

---

### Task 5: Add Finance Center UI And Actions

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Create or modify as needed: `features/finance-batches/finance-batch-ui-adapters.ts`

- [ ] **Step 1: Write UI tests**

Add focused tests to `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("shows unified finance batches in the settlement center", async () => {
  render(
    <OpsReference
      initialModule="settle"
      liveFinanceBatches={[
        {
          id: "finance-batch-1",
          title: "7月主播付款",
          batchType: "streamer_payable",
          status: "draft",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          finalAmount: 260,
          itemCount: 2,
        },
      ]}
    />,
  );

  expect(await screen.findByText("7月主播付款")).toBeInTheDocument();
  expect(screen.getByText("主播应付")).toBeInTheDocument();
});
```

If `OpsReference` test helpers do not accept `initialModule` or `liveFinanceBatches`, extend the existing test fixture rather than replacing unrelated setup.

- [ ] **Step 2: Run UI test and verify it fails**

Run:

```powershell
pnpm vitest run components/reference-ui/ops-reference.test.jsx --testNamePattern "unified finance"
```

Expected: FAIL because finance batch props and UI are not wired.

- [ ] **Step 3: Add UI adapter DTOs**

Create `features/finance-batches/finance-batch-ui-adapters.ts`:

```ts
import type { FinanceBatchRecord } from "./finance-batch-types";

export type OpsReferenceFinanceBatch = {
  id: string;
  title: string;
  batchType: string;
  batchTypeLabel: string;
  status: string;
  statusLabel: string;
  periodStart: string;
  periodEnd: string;
  systemAmount: number;
  adjustmentAmount: number;
  finalAmount: number;
  itemCount: number;
  exceptionCount: number;
};

const batchTypeLabels: Record<string, string> = {
  receivable: "客户应收",
  streamer_payable: "主播应付",
  project_cost: "项目成本",
  collaboration_share: "协作分账",
};

const statusLabels: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审核",
  confirmed: "已确认",
  locked: "已锁定",
  exported: "已导出",
  completed: "已完成",
  rejected: "已驳回",
  reopened: "已重开",
  voided: "已作废",
};

export function toOpsReferenceFinanceBatch(
  batch: FinanceBatchRecord,
): OpsReferenceFinanceBatch {
  return {
    id: batch.id,
    title: batch.title || batchTypeLabels[batch.batchType] || "财务批次",
    batchType: batch.batchType,
    batchTypeLabel: batchTypeLabels[batch.batchType] || batch.batchType,
    status: batch.status,
    statusLabel: statusLabels[batch.status] || batch.status,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    systemAmount: batch.systemAmount,
    adjustmentAmount: batch.adjustmentAmount,
    finalAmount: batch.finalAmount,
    itemCount: batch.itemCount,
    exceptionCount: batch.exceptionCount,
  };
}
```

- [ ] **Step 4: Wire live data context**

In `components/reference-ui/ops-reference.jsx`, add `financeBatches` to the existing live data context default:

```jsx
const OpsLiveDataContext = React.createContext({
  // existing fields
  financeBatches: null,
});

function useOpsFinanceBatches() {
  const { financeBatches } = React.useContext(OpsLiveDataContext);
  return Array.isArray(financeBatches) ? financeBatches : [];
}
```

Add actions near existing settlement actions:

```jsx
createFinanceBatch: async (input) => {
  const response = await fetch("/api/finance/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow(response);
},
addFinanceBatchAdjustment: async (batchId, input) => {
  const response = await fetch(`/api/finance/batches/${batchId}/adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow(response);
},
lockFinanceBatch: async (batchId, input = {}) => {
  const response = await fetch(`/api/finance/batches/${batchId}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJsonOrThrow(response);
},
```

- [ ] **Step 5: Add finance center panel inside `ScreenSettlement`**

Keep the existing settlement center intact. Add a top-level tab or segmented mode named `finance` before legacy project batch content.

Minimum UI content:

```jsx
function FinanceBatchList({ batches, onCreate }) {
  return (
    <section className="ops-settlement-content">
      <div className="ops-settlement-batch-header">
        <div>
          <h2>财务结算中心</h2>
          <p>按批次处理客户应收、主播应付、项目成本和协作分账。</p>
        </div>
        <button type="button" onClick={onCreate}>
          新建批次
        </button>
      </div>
      <DataTable
        rows={batches}
        columns={[
          { key: "title", label: "批次" },
          { key: "batchTypeLabel", label: "类型" },
          { key: "statusLabel", label: "状态" },
          { key: "finalAmount", label: "最终金额" },
          { key: "itemCount", label: "明细" },
        ]}
      />
    </section>
  );
}
```

Use existing table/list components in the file if names differ. Do not introduce a new UI library.

- [ ] **Step 6: Run UI tests**

Run:

```powershell
pnpm vitest run components/reference-ui/ops-reference.test.jsx --testNamePattern "unified finance"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx features/finance-batches/finance-batch-ui-adapters.ts
git commit -m "feat: add unified finance center ui"
```

---

### Task 6: Hydrate Finance Batches In Ops Routes

**Files:**

- Modify: `app/(ops)/console/projects/page.tsx`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `features/finance-batches/finance-batch-repository.ts`
- Modify: `features/finance-batches/finance-batch-ui-adapters.ts`

- [ ] **Step 1: Add route hydration tests**

Extend existing tests for `app/(ops)/console/stubs/[module]/page.test.tsx` or create a focused test if current mocks are large:

```ts
expect(listOpsFinanceBatches).toHaveBeenCalledWith(supabase, {
  organizationId: "org-1",
});
```

The assertion belongs in the settlement module hydration test, next to existing `listOpsSettlementBatches` assertions.

- [ ] **Step 2: Add query helper**

In `features/finance-batches/finance-batch-repository.ts`, export:

```ts
export async function listOpsFinanceBatches(
  client: SupabaseClient,
  input: { organizationId: string; projectId?: string },
): Promise<OpsReferenceFinanceBatch[]> {
  let query = client
    .from("finance_batches")
    .select(
      "id, organization_id, batch_type, title, period_start, period_end, status, has_exceptions, system_amount, adjustment_amount, final_amount, item_count, exception_count, created_by, status_reason, metadata, created_at, updated_at",
    )
    .eq("organization_id", input.organizationId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (input.projectId) {
    query = query.in(
      "id",
      client
        .from("finance_batch_items")
        .select("finance_batch_id")
        .eq("organization_id", input.organizationId)
        .eq("project_id", input.projectId),
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => toOpsReferenceFinanceBatch(toFinanceBatchRecord(row)));
}
```

If Supabase does not accept the nested query shape above, split it into two queries: first item batch ids by project, then `.in("id", batchIds)`.

- [ ] **Step 3: Wire server page props**

In `app/(ops)/console/stubs/[module]/page.tsx`, load finance batches in the same place as settlement batches:

```ts
const financeBatches = await listOpsFinanceBatches(supabase, {
  organizationId: auth.organizationId,
});
```

Pass into `OpsReference`:

```tsx
<OpsReference
  liveFinanceBatches={financeBatches}
  // existing props
/>
```

In `app/(ops)/console/projects/page.tsx`, load project-scoped finance batches for project detail hydration only when the route already resolves project data.

- [ ] **Step 4: Run route tests**

Run:

```powershell
pnpm vitest run app/(ops)/console/stubs/[module]/page.test.tsx
```

In PowerShell, escape or quote the path:

```powershell
pnpm vitest run "app/(ops)/console/stubs/[module]/page.test.tsx"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add "app/(ops)/console/stubs/[module]/page.tsx" "app/(ops)/console/stubs/[module]/page.test.tsx" "app/(ops)/console/projects/page.tsx" features/finance-batches
git commit -m "feat: hydrate finance batches in ops console"
```

---

### Task 7: Add Project Attribution Read View

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `features/finance-batches/finance-batch-repository.ts`

- [ ] **Step 1: Write project attribution UI test**

Add to `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("shows finance batch attribution on project detail", async () => {
  render(
    <OpsReference
      initialModule="projects"
      initialProjectId="project-a"
      liveFinanceBatches={[
        {
          id: "finance-batch-1",
          title: "7月主播付款",
          batchType: "streamer_payable",
          batchTypeLabel: "主播应付",
          status: "locked",
          statusLabel: "已锁定",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          finalAmount: 160,
          itemCount: 1,
          projectId: "project-a",
        },
      ]}
    />,
  );

  expect(await screen.findByText("财务批次归因")).toBeInTheDocument();
  expect(screen.getByText("7月主播付款")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
pnpm vitest run components/reference-ui/ops-reference.test.jsx --testNamePattern "finance batch attribution"
```

Expected: FAIL because project detail attribution block does not exist.

- [ ] **Step 3: Add project attribution block**

In `ProjectDetail`, derive project finance batches:

```jsx
const financeBatches = useOpsFinanceBatches();
const projectFinanceBatches = financeBatches.filter(
  (batch) => batch.projectId === p.id || batch.projectIds?.includes?.(p.id),
);
```

Render inside the existing settlement tab:

```jsx
<DetailCard title="财务批次归因">
  {projectFinanceBatches.length ? (
    <DataTable
      rows={projectFinanceBatches}
      columns={[
        { key: "title", label: "批次" },
        { key: "batchTypeLabel", label: "类型" },
        { key: "statusLabel", label: "状态" },
        { key: "finalAmount", label: "项目归因金额" },
      ]}
    />
  ) : (
    <EmptyState
      title="暂无财务批次"
      hint="该项目尚未被新的财务批次引用。"
    />
  )}
</DetailCard>
```

Use existing `DetailCard`, `DataTable`, and `EmptyState` names if present; otherwise use the local equivalents already used in the project detail settlement tab.

- [ ] **Step 4: Run UI test**

Run:

```powershell
pnpm vitest run components/reference-ui/ops-reference.test.jsx --testNamePattern "finance batch attribution"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx features/finance-batches/finance-batch-repository.ts
git commit -m "feat: show finance batch project attribution"
```

---

### Task 8: Regression And Documentation Pass

**Files:**

- Modify: `docs/product-function-document.md` if user-visible docs need refresh.
- Modify: `README.md` only if the public workflow section mentions old project-first settlement as the only model.

- [ ] **Step 1: Run focused finance tests**

Run:

```powershell
pnpm vitest run lib/db/unified-finance-batches-schema-contract.test.ts features/finance-batches app/api/finance
```

Expected: PASS.

- [ ] **Step 2: Run settlement regression tests**

Run:

```powershell
pnpm test:custom-settlement
```

Expected: PASS. If failures are unrelated to finance batch changes, capture the failing test names and confirm the finance-related test slice still passes before proceeding.

- [ ] **Step 3: Run UI smoke tests**

Run:

```powershell
pnpm test:ui-smoke
```

Expected: PASS.

- [ ] **Step 4: Run type check and lint**

Run:

```powershell
pnpm type-check
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Update docs only if product wording is stale**

If `docs/product-function-document.md` still says settlement is project-first only, update the finance section with this wording:

```md
财务结算中心以财务批次为第一对象，批次按客户应收、主播应付、项目成本、协作分账分类型管理。项目不再限制批次范围，而是在每条明细和项目归因汇总中保留，用于收入、支出、成本、分账和毛利追溯。
```

- [ ] **Step 6: Final diff review**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected:

- No whitespace errors.
- Only finance batch, API, UI, schema, and docs files changed by this work.
- Existing unrelated dirty war-room files remain unstaged unless the user explicitly asks to package them.

- [ ] **Step 7: Commit verification/docs changes**

Run:

```powershell
git add docs/product-function-document.md README.md
git commit -m "docs: describe unified finance settlement center"
```

Only run this commit if docs changed. If no docs changed, skip the commit and record that docs were already accurate.

---

## Self-Review

Spec coverage:

- Unified finance center: covered by Tasks 4, 5, and 6.
- Typed batches: covered by Tasks 1 and 2.
- Cross-project streamer payable first path: covered by Tasks 3 and 4.
- System amount plus finance adjustment: covered by Tasks 2 and 3.
- Unified status flow: covered by Tasks 1, 2, and 4.
- Project attribution: covered by Tasks 1, 6, and 7.
- Compatibility with old settlement: covered by Tasks 3 and 8.
- Four future finance action types: schema supports all four; service intentionally enables only `streamer_payable` first and returns explicit errors for the other three until their source adapters are implemented.

Red-flag wording scan:

- The plan contains no unresolved red-flag tokens.
- Every task includes concrete files, commands, and expected outcomes.

Type consistency:

- `FinanceBatchType`, `FinanceBatchStatus`, `FinanceBatchRecord`, and `FinanceBatchRepository` are defined before later tasks consume them.
- API route examples call the same service functions defined in Task 3.
- UI adapter names match the hydration plan.
