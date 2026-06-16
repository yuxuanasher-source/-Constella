# Game Live Complex Cost Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP for game-live complex cost rules: project-level entitlement, rule templates, cost preview, import/manual cost items, settlement-batch attachment, role-safe exports, and ops UI entry points.

**Architecture:** Reuse the existing domain-service + Supabase-repository + route-handler pattern. Keep current settlement behavior intact: CPT/base salary remain the only automatic money calculations from live reports; CPA/CPS/gift/traffic/supplier costs enter through confirmed import or manual cost items. Commercial access is enforced by billing entitlements plus project-level complex-cost rule records.

**Tech Stack:** Next.js App Router route handlers, Supabase/Postgres migrations and RLS, TypeScript service/repository layers, Vitest, existing billing guards, existing export definitions, existing reference UI.

---

## Scope

This plan implements the MVP described in `docs/reports/2026-06-16-game-live-complex-cost-rules-delivery-design.md` and reflected in `docs/product-function-document.md`.

Included:

- Project-level complex cost rule entitlement and quota source.
- Rules for CPT, base salary + CPT, CPA, CPS, gift share, supplier fee, traffic spend, platform fee, sample/CDK/account cost, bonus, penalty, and replay cost.
- Cost preview calculator for expected revenue, streamer payable, supplier cost, traffic/platform cost, manual adjustment, gross margin, and risk notes.
- Cost import batches for CPA/CPS/gift/traffic/supplier bills.
- Confirmed `project_cost_items` attached to projects and optionally settlement batches.
- New settlement-batch cost-item route.
- Export definitions for project cost details and supplier reconciliation.
- Ops UI wiring inside existing project/settings, settlement center, war room, and export center surfaces.

Not included:

- Direct GMV API integration with every livestream platform.
- Automatic penalty deduction.
- Natural-language contract parsing.
- Autonomous settlement approval.

---

## File Structure

- Create: `supabase/migrations/20260616190000_game_live_complex_cost_rules.sql`
  - Adds complex-cost entitlement, template, rule version, cost item, and import batch tables with org/project indexes.
- Create: `lib/db/game-live-complex-cost-schema-contract.test.ts`
  - Pins table names, status values, money columns, and RLS policy anchors.
- Modify: `features/billing/billing-gates.ts`
  - Adds `complex_cost_rules` entitlement.
- Modify: `features/billing/usage-metering.ts`
  - Adds `complex_cost_project` usage metric.
- Modify: `features/billing/billing-gates.test.ts`
  - Covers plan/add-on entitlement behavior.
- Modify: `features/billing/usage-metering.test.ts`
  - Covers complex cost project usage status and event recording.
- Create: `features/complex-cost/complex-cost-types.ts`
  - Defines rule, cost item, import batch, preview, and entitlement types.
- Create: `features/complex-cost/complex-cost-calculator.ts`
  - Pure calculator for preview and imported item amount calculation.
- Create: `features/complex-cost/complex-cost-calculator.test.ts`
  - Covers CPT/base salary, CPS, CPA, gift, traffic, supplier, gross margin, and risk notes.
- Create: `features/complex-cost/complex-cost-service.ts`
  - Owns entitlement checks, rule draft/approval, manual cost item creation, import confirmation, and settlement attachment.
- Create: `features/complex-cost/complex-cost-service.test.ts`
  - Covers permissions, billing gate, quota source, rule versioning, imports, audit, and locked-batch boundaries.
- Create: `features/complex-cost/complex-cost-repository.ts`
  - Supabase persistence for all complex-cost tables.
- Create: `features/complex-cost/complex-cost-queries.ts`
  - Read DTOs for project settings, dashboard, and batch details.
- Create: `features/complex-cost/complex-cost-ui-dto.ts`
  - Maps service records into reference UI-safe DTOs.
- Create: `features/complex-cost/complex-cost-ui-dto.test.ts`
  - Covers role-safe cost visibility and labels.
- Modify: `features/exports/export-definitions.ts`
  - Adds `project_costs` and `supplier_reconcile` export kinds.
- Modify: `features/exports/export-definitions.test.ts`
  - Covers role-safe field filtering.
- Create: `app/api/projects/[projectId]/complex-cost-rule/route.ts`
  - GET current rule/entitlement and POST draft/open state.
- Create: `app/api/projects/[projectId]/complex-cost-rule/approve/route.ts`
  - Approves a rule version.
- Create: `app/api/projects/[projectId]/complex-cost-rule/preview/route.ts`
  - Runs cost preview.
- Create: `app/api/projects/[projectId]/cost-items/route.ts`
  - Lists and creates project cost items.
- Create: `app/api/projects/[projectId]/cost-imports/route.ts`
  - Creates parsed import batches.
- Create: `app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.ts`
  - Confirms import rows into cost items.
- Create: `app/api/projects/[projectId]/cost-dashboard/route.ts`
  - Reads project cost and margin dashboard.
- Create: `app/api/projects/[projectId]/cost-export/route.ts`
  - Creates cost-related export requests.
- Create: `app/api/settlement-batches/[batchId]/cost-items/route.ts`
  - Attaches confirmed project cost items to settlement batches.
- Create route tests beside each route.
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
  - Hydrates complex-cost settings and dashboard data for existing ops reference UI.
- Modify: `components/reference-ui/ops-reference.jsx`
  - Adds complex-cost settings, preview, settlement cost items, and export entry points in existing screens.
- Modify: `components/reference-ui/ops-reference.test.jsx`
  - Covers user-visible flows.
- Modify: `docs/product-function-document.md`
  - Keep product docs aligned after implementation details settle.

---

### Task 1: Schema and Contract

**Files:**

- Create: `supabase/migrations/20260616190000_game_live_complex_cost_rules.sql`
- Create: `lib/db/game-live-complex-cost-schema-contract.test.ts`

- [x] **Step 1: Write the failing schema contract test**

Create `lib/db/game-live-complex-cost-schema-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260616190000_game_live_complex_cost_rules.sql",
  ),
  "utf8",
);

describe("game live complex cost rules schema", () => {
  it("declares project entitlement, rule, cost item, and import tables", () => {
    expect(migration).toContain(
      "create table if not exists public.project_complex_cost_rule_entitlements",
    );
    expect(migration).toContain(
      "create table if not exists public.cost_rule_templates",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_rule_versions",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_items",
    );
    expect(migration).toContain(
      "create table if not exists public.project_cost_import_batches",
    );
  });

  it("pins money, status, and source constraints", () => {
    expect(migration).toContain("amount_cents bigint not null");
    expect(migration).toContain("status text not null");
    expect(migration).toContain("source text not null");
    expect(migration).toContain("check (amount_cents >= 0)");
    expect(migration).toContain(
      "check (source in ('system', 'import', 'manual'))",
    );
  });

  it("enables RLS on all new tables", () => {
    expect(migration).toContain(
      "alter table public.project_complex_cost_rule_entitlements enable row level security",
    );
    expect(migration).toContain(
      "alter table public.cost_rule_templates enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_rule_versions enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_items enable row level security",
    );
    expect(migration).toContain(
      "alter table public.project_cost_import_batches enable row level security",
    );
  });
});
```

Run: `pnpm vitest run lib/db/game-live-complex-cost-schema-contract.test.ts`

Expected: FAIL because the migration does not exist.

- [x] **Step 2: Create the migration**

Create `supabase/migrations/20260616190000_game_live_complex_cost_rules.sql`:

```sql
create table if not exists public.project_complex_cost_rule_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  enabled_source text not null check (enabled_source in ('plan', 'addon', 'override')),
  billing_mode text not null check (billing_mode in ('included', 'per_project_monthly', 'enterprise')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  created_by uuid references auth.users(id),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.cost_rule_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  scenario text not null check (scenario in ('cpt', 'base_salary_cpt', 'cpa', 'cps', 'gift', 'supplier', 'traffic', 'replay_penalty')),
  rule_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.project_cost_rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('draft', 'active', 'archived')),
  rule_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  effective_from timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version_no)
);

create table if not exists public.project_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  streamer_id uuid references public.streamers(id) on delete set null,
  supplier_organization_id uuid references public.organizations(id) on delete set null,
  live_report_id uuid references public.live_reports(id) on delete set null,
  settlement_batch_id uuid references public.settlement_batches(id) on delete set null,
  item_type text not null check (item_type in ('cpa', 'cps', 'gift', 'bonus', 'penalty', 'supplier_fee', 'traffic', 'platform_fee', 'sample', 'replay', 'tax', 'manual')),
  amount_cents bigint not null check (amount_cents >= 0),
  direction text not null check (direction in ('cost', 'revenue_offset', 'adjustment')),
  evidence_level text not null check (evidence_level in ('green', 'yellow', 'red')),
  source text not null check (source in ('system', 'import', 'manual')),
  source_payload jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null check (status in ('draft', 'pending_review', 'confirmed', 'voided')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.project_cost_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  import_type text not null check (import_type in ('cpa', 'cps', 'gift', 'traffic', 'supplier_bill')),
  file_url text,
  row_count integer not null default 0 check (row_count >= 0),
  parsed_payload jsonb not null default '[]'::jsonb,
  status text not null check (status in ('uploaded', 'parsed', 'confirmed', 'failed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists project_complex_cost_entitlements_org_project_idx
  on public.project_complex_cost_rule_entitlements (organization_id, project_id);
create index if not exists project_cost_rule_versions_project_status_idx
  on public.project_cost_rule_versions (project_id, status);
create index if not exists project_cost_items_project_status_idx
  on public.project_cost_items (project_id, status);
create index if not exists project_cost_items_batch_idx
  on public.project_cost_items (settlement_batch_id);
create index if not exists project_cost_import_batches_project_status_idx
  on public.project_cost_import_batches (project_id, status);

alter table public.project_complex_cost_rule_entitlements enable row level security;
alter table public.cost_rule_templates enable row level security;
alter table public.project_cost_rule_versions enable row level security;
alter table public.project_cost_items enable row level security;
alter table public.project_cost_import_batches enable row level security;

create policy project_complex_cost_entitlements_org_read
  on public.project_complex_cost_rule_entitlements for select
  using (public.is_org_member(organization_id));
create policy cost_rule_templates_org_read
  on public.cost_rule_templates for select
  using (organization_id is null or public.is_org_member(organization_id));
create policy project_cost_rule_versions_org_read
  on public.project_cost_rule_versions for select
  using (public.is_org_member(organization_id));
create policy project_cost_items_org_read
  on public.project_cost_items for select
  using (public.is_org_member(organization_id));
create policy project_cost_import_batches_org_read
  on public.project_cost_import_batches for select
  using (public.is_org_member(organization_id));
```

- [x] **Step 3: Verify the contract passes**

Run: `pnpm vitest run lib/db/game-live-complex-cost-schema-contract.test.ts`

Expected: PASS.

- [x] **Step 4: Commit** (skipped per user instruction: do not commit or push)

```bash
git add supabase/migrations/20260616190000_game_live_complex_cost_rules.sql lib/db/game-live-complex-cost-schema-contract.test.ts
git commit -m "feat: add complex cost rule schema"
```

---

### Task 2: Billing Entitlement and Usage Metric

**Files:**

- Modify: `features/billing/billing-gates.ts`
- Modify: `features/billing/billing-gates.test.ts`
- Modify: `features/billing/usage-metering.ts`
- Modify: `features/billing/usage-metering.test.ts`

- [x] **Step 1: Add failing entitlement tests**

Add to `features/billing/billing-gates.test.ts`:

```ts
it("opens complex cost rules for pro and enterprise, while addons can open lower tiers", () => {
  expect(
    resolvePlanEntitlements({ planTier: "free", featureAddons: [] })
      .complex_cost_rules,
  ).toBe(false);
  expect(
    resolvePlanEntitlements({ planTier: "basic", featureAddons: [] })
      .complex_cost_rules,
  ).toBe(false);
  expect(
    resolvePlanEntitlements({ planTier: "pro", featureAddons: [] })
      .complex_cost_rules,
  ).toBe(true);
  expect(
    resolvePlanEntitlements({ planTier: "enterprise", featureAddons: [] })
      .complex_cost_rules,
  ).toBe(true);
  expect(
    resolvePlanEntitlements({
      planTier: "basic",
      featureAddons: [{ featureKey: "complex_cost_rules", enabled: true }],
    }).complex_cost_rules,
  ).toBe(true);
});
```

Run: `pnpm vitest run features/billing/billing-gates.test.ts`

Expected: FAIL because `complex_cost_rules` is not a feature key.

- [x] **Step 2: Implement entitlement**

Update `BillingFeatureKey` and each `baseEntitlements` record in `features/billing/billing-gates.ts`:

```ts
export type BillingFeatureKey =
  | "project_management"
  | "settlement"
  | "complex_cost_rules"
  | "export_center"
  | "war_room"
  | "auto_review_shadow"
  | "auto_review_active"
  | "ai_diagnosis"
  | "vendor_portal"
  | "private_deployment";
```

Set `complex_cost_rules: false` for `free` and `basic`, `true` for `pro` and `enterprise`.

- [x] **Step 3: Add failing usage metric test**

Add to `features/billing/usage-metering.test.ts`:

```ts
it("calculates complex cost project usage as a soft overage metric", () => {
  expect(
    calculateUsageStatus({
      metric: "complex_cost_project",
      usedQuantity: 6,
      includedQuantity: 5,
      addonQuantity: 0,
    }),
  ).toMatchObject({
    metric: "complex_cost_project",
    remainingQuantity: 0,
    overageQuantity: 1,
    billableOverageQuantity: 1,
    softOverage: true,
    shouldHardBlock: false,
  });
});
```

Run: `pnpm vitest run features/billing/usage-metering.test.ts`

Expected: FAIL because the metric is not defined.

- [x] **Step 4: Implement metric**

Update `UsageMetric` in `features/billing/usage-metering.ts`:

```ts
export type UsageMetric =
  | "active_streamer"
  | "seat"
  | "ocr"
  | "ai"
  | "storage_mb"
  | "export"
  | "complex_cost_project";
```

- [x] **Step 5: Verify billing tests**

Run:

```bash
pnpm vitest run features/billing/billing-gates.test.ts features/billing/usage-metering.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit** (skipped per user instruction: do not commit or push)

```bash
git add features/billing/billing-gates.ts features/billing/billing-gates.test.ts features/billing/usage-metering.ts features/billing/usage-metering.test.ts
git commit -m "feat: gate complex cost rules by plan"
```

---

### Task 3: Complex Cost Calculator

**Files:**

- Create: `features/complex-cost/complex-cost-types.ts`
- Create: `features/complex-cost/complex-cost-calculator.ts`
- Create: `features/complex-cost/complex-cost-calculator.test.ts`

- [x] **Step 1: Write failing calculator tests**

Create `features/complex-cost/complex-cost-calculator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  calculateComplexCostPreview,
  calculateImportedCostAmountCents,
} from "./complex-cost-calculator";

describe("complex cost calculator", () => {
  it("previews game live project costs and gross margin", () => {
    expect(
      calculateComplexCostPreview({
        expectedReceivableCents: 1_000_000,
        streamerCount: 5,
        estimatedMinutesPerStreamer: 120,
        streamerHourlyCostCents: 8_000,
        streamerBaseCostCents: 20_000,
        supplierCostCents: 100_000,
        trafficCostCents: 80_000,
        platformFeeBps: 500,
        manualAdjustmentCents: -10_000,
      }),
    ).toMatchObject({
      estimatedDurationMinutes: 600,
      streamerPayableCents: 180_000,
      supplierCostCents: 100_000,
      trafficCostCents: 80_000,
      platformFeeCents: 50_000,
      grossMarginCents: 580_000,
      marginRateBps: 5800,
      riskNotes: [],
    });
  });

  it("calculates imported CPA, CPS, gift, and direct costs", () => {
    expect(
      calculateImportedCostAmountCents({
        itemType: "cpa",
        unitCount: 20,
        unitPriceCents: 3000,
      }),
    ).toBe(60_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "cps",
        salesAmountCents: 200_000,
        rateBps: 1500,
      }),
    ).toBe(30_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "gift",
        salesAmountCents: 100_000,
        rateBps: 5000,
      }),
    ).toBe(50_000);
    expect(
      calculateImportedCostAmountCents({
        itemType: "traffic",
        directAmountCents: 88_000,
      }),
    ).toBe(88_000);
  });
});
```

Run: `pnpm vitest run features/complex-cost/complex-cost-calculator.test.ts`

Expected: FAIL because files do not exist.

- [x] **Step 2: Create types**

Create `features/complex-cost/complex-cost-types.ts`:

```ts
export type ComplexCostItemType =
  | "cpa"
  | "cps"
  | "gift"
  | "bonus"
  | "penalty"
  | "supplier_fee"
  | "traffic"
  | "platform_fee"
  | "sample"
  | "replay"
  | "tax"
  | "manual";

export type ComplexCostSource = "system" | "import" | "manual";
export type ComplexCostStatus =
  | "draft"
  | "pending_review"
  | "confirmed"
  | "voided";
export type ComplexCostEvidenceLevel = "green" | "yellow" | "red";

export type ComplexCostPreviewInput = {
  expectedReceivableCents: number;
  streamerCount: number;
  estimatedMinutesPerStreamer: number;
  streamerHourlyCostCents?: number | null;
  streamerBaseCostCents?: number | null;
  supplierCostCents?: number | null;
  trafficCostCents?: number | null;
  platformFeeBps?: number | null;
  manualAdjustmentCents?: number | null;
  targetMarginBps?: number | null;
};

export type ComplexCostPreviewResult = {
  estimatedDurationMinutes: number;
  expectedReceivableCents: number;
  streamerPayableCents: number;
  supplierCostCents: number;
  trafficCostCents: number;
  platformFeeCents: number;
  manualAdjustmentCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  riskNotes: string[];
};

export type ImportedCostAmountInput = {
  itemType:
    | "cpa"
    | "cps"
    | "gift"
    | "traffic"
    | "supplier_fee"
    | "platform_fee"
    | "sample"
    | "tax"
    | "manual";
  unitCount?: number | null;
  unitPriceCents?: number | null;
  salesAmountCents?: number | null;
  rateBps?: number | null;
  directAmountCents?: number | null;
};
```

- [x] **Step 3: Implement calculator**

Create `features/complex-cost/complex-cost-calculator.ts`:

```ts
import type {
  ComplexCostPreviewInput,
  ComplexCostPreviewResult,
  ImportedCostAmountInput,
} from "./complex-cost-types";

export function calculateComplexCostPreview(
  input: ComplexCostPreviewInput,
): ComplexCostPreviewResult {
  const streamerCount = safeInt(input.streamerCount);
  const minutesPerStreamer = safeInt(input.estimatedMinutesPerStreamer);
  const estimatedDurationMinutes = streamerCount * minutesPerStreamer;
  const expectedReceivableCents = safeCents(input.expectedReceivableCents);
  const streamerPayableCents =
    amountForMinutes(
      estimatedDurationMinutes,
      safeCents(input.streamerHourlyCostCents),
    ) +
    streamerCount * safeCents(input.streamerBaseCostCents);
  const supplierCostCents = safeCents(input.supplierCostCents);
  const trafficCostCents = safeCents(input.trafficCostCents);
  const platformFeeCents = divideRound(
    expectedReceivableCents * safeBps(input.platformFeeBps),
    10000,
  );
  const manualAdjustmentCents = safeSignedCents(input.manualAdjustmentCents);
  const grossMarginCents =
    expectedReceivableCents -
    streamerPayableCents -
    supplierCostCents -
    trafficCostCents -
    platformFeeCents +
    manualAdjustmentCents;
  const marginRateBps =
    expectedReceivableCents > 0
      ? divideRound(grossMarginCents * 10000, expectedReceivableCents)
      : 0;
  const targetMarginBps = safeBps(input.targetMarginBps ?? 2000);

  return {
    estimatedDurationMinutes,
    expectedReceivableCents,
    streamerPayableCents,
    supplierCostCents,
    trafficCostCents,
    platformFeeCents,
    manualAdjustmentCents,
    grossMarginCents,
    marginRateBps,
    riskNotes: buildRiskNotes({
      expectedReceivableCents,
      grossMarginCents,
      marginRateBps,
      targetMarginBps,
    }),
  };
}

export function calculateImportedCostAmountCents(
  input: ImportedCostAmountInput,
): number {
  if (input.itemType === "cpa") {
    return safeInt(input.unitCount) * safeCents(input.unitPriceCents);
  }
  if (input.itemType === "cps" || input.itemType === "gift") {
    return divideRound(
      safeCents(input.salesAmountCents) * safeBps(input.rateBps),
      10000,
    );
  }
  return safeCents(input.directAmountCents);
}

function buildRiskNotes({
  expectedReceivableCents,
  grossMarginCents,
  marginRateBps,
  targetMarginBps,
}: {
  expectedReceivableCents: number;
  grossMarginCents: number;
  marginRateBps: number;
  targetMarginBps: number;
}) {
  const notes: string[] = [];
  if (expectedReceivableCents <= 0) notes.push("zero_receivable");
  if (grossMarginCents < 0) notes.push("negative_margin");
  else if (marginRateBps < targetMarginBps) notes.push("low_margin");
  return notes;
}

function amountForMinutes(minutes: number, hourlyRateCents: number) {
  return divideRound(minutes * hourlyRateCents, 60);
}

function safeInt(value: number | null | undefined) {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.trunc(value as number)
    : 0;
}

function safeCents(value: number | null | undefined) {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.trunc(value as number)
    : 0;
}

function safeSignedCents(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

function safeBps(value: number | null | undefined) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(10000, Math.trunc(value as number)))
    : 0;
}

function divideRound(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round(numerator / denominator) : 0;
}
```

- [x] **Step 4: Verify calculator**

Run: `pnpm vitest run features/complex-cost/complex-cost-calculator.test.ts`

Expected: PASS.

- [x] **Step 5: Commit** (skipped per user instruction: do not commit or push)

```bash
git add features/complex-cost/complex-cost-types.ts features/complex-cost/complex-cost-calculator.ts features/complex-cost/complex-cost-calculator.test.ts
git commit -m "feat: add complex cost calculator"
```

---

### Task 4: Domain Service and Repository

**Files:**

- Create: `features/complex-cost/complex-cost-service.ts`
- Create: `features/complex-cost/complex-cost-service.test.ts`
- Create: `features/complex-cost/complex-cost-repository.ts`
- Create: `features/complex-cost/complex-cost-queries.ts`
- Create: `features/complex-cost/complex-cost-ui-dto.ts`
- Create: `features/complex-cost/complex-cost-ui-dto.test.ts`

- [x] **Step 1: Write failing service tests**

Create `features/complex-cost/complex-cost-service.test.ts` with these cases:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  approveComplexCostRuleVersion,
  createManualProjectCostItem,
  saveComplexCostRuleDraft,
} from "./complex-cost-service";

const actor = {
  userId: "user-1",
  name: "Owner",
  role: "owner" as const,
  organizationId: "org-1",
};

describe("complex cost service", () => {
  it("requires complex cost entitlement before saving a project rule draft", async () => {
    const repo = {
      getProjectEntitlement: vi.fn(async () => null),
      createRuleVersion: vi.fn(),
      getNextRuleVersionNo: vi.fn(async () => 1),
    };

    await expect(
      saveComplexCostRuleDraft({
        repo,
        audit: vi.fn(),
        actor,
        input: { projectId: "project-1", rulePayload: { scenario: "cps" } },
      }),
    ).rejects.toThrow("Complex cost rules are not enabled for this project");
  });

  it("approves a draft rule version and writes high-risk audit", async () => {
    const repo = {
      getRuleVersionById: vi.fn(async () => ({
        id: "version-1",
        organizationId: "org-1",
        projectId: "project-1",
        status: "draft",
      })),
      updateRuleVersion: vi.fn(async () => ({
        id: "version-1",
        status: "active",
      })),
      archiveActiveRuleVersions: vi.fn(async () => undefined),
    };
    const audit = vi.fn();

    await approveComplexCostRuleVersion({
      repo,
      audit,
      actor,
      versionId: "version-1",
      reason: "Enable CPS and supplier cost template.",
    });

    expect(repo.archiveActiveRuleVersions).toHaveBeenCalledWith({
      projectId: "project-1",
      exceptVersionId: "version-1",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true }),
    );
  });

  it("creates a manual project cost item with reason and yellow evidence", async () => {
    const repo = {
      getProjectEntitlement: vi.fn(async () => ({ projectId: "project-1" })),
      createProjectCostItem: vi.fn(async () => ({
        id: "cost-1",
        amountCents: 12000,
      })),
    };

    await expect(
      createManualProjectCostItem({
        repo,
        audit: vi.fn(),
        actor,
        input: {
          projectId: "project-1",
          itemType: "supplier_fee",
          amountCents: 12000,
          direction: "cost",
          evidenceLevel: "yellow",
          reason: "Supplier bill confirmed by finance.",
        },
      }),
    ).resolves.toMatchObject({ id: "cost-1" });
  });
});
```

Run: `pnpm vitest run features/complex-cost/complex-cost-service.test.ts`

Expected: FAIL because the service does not exist.

- [x] **Step 2: Implement service contracts**

Create service functions with this public surface in `features/complex-cost/complex-cost-service.ts`:

```ts
export async function saveComplexCostRuleDraft(args: {
  repo: ComplexCostRepository;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: { projectId: string; rulePayload: Record<string, unknown> };
}): Promise<ComplexCostRuleVersionRecord>;

export async function approveComplexCostRuleVersion(args: {
  repo: ComplexCostRepository;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  versionId: string;
  reason: string;
}): Promise<ComplexCostRuleVersionRecord>;

export async function createManualProjectCostItem(args: {
  repo: ComplexCostRepository;
  audit: ComplexCostAuditWriter;
  actor: ComplexCostActor;
  input: CreateProjectCostItemInput;
}): Promise<ProjectCostItemRecord>;
```

The implementation must:

- Allow `owner` and `ops_manager` to configure rules.
- Allow `operator_business` to create cost items.
- Require a project entitlement before writing rule versions or cost items.
- Require a non-empty reason for approval and manual cost items.
- Write high-risk audit for approvals, penalties, and settlement-attached items.

- [x] **Step 3: Implement Supabase repository**

Create `features/complex-cost/complex-cost-repository.ts` with methods:

```ts
export class SupabaseComplexCostRepository implements ComplexCostRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProjectEntitlement(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ProjectComplexCostEntitlementRecord | null> {
    return mapEntitlementRow(
      await requireSingleOrNull(
        this.client
          .from("project_complex_cost_rule_entitlements")
          .select("*")
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .maybeSingle(),
      ),
    );
  }

  async getNextRuleVersionNo(projectId: string): Promise<number> {
    const rows = await requireRows(
      this.client
        .from("project_cost_rule_versions")
        .select("version_no")
        .eq("project_id", projectId)
        .order("version_no", { ascending: false })
        .limit(1),
    );
    return Number(rows[0]?.version_no ?? 0) + 1;
  }

  async createRuleVersion(
    input: CreateRuleVersionRepoInput,
  ): Promise<ProjectCostRuleVersionRecord> {
    return mapRuleVersionRow(
      await requireSingle(
        this.client
          .from("project_cost_rule_versions")
          .insert(input)
          .select("*")
          .single(),
      ),
    );
  }

  async createProjectCostItem(
    input: CreateProjectCostItemRepoInput,
  ): Promise<ProjectCostItemRecord> {
    return mapCostItemRow(
      await requireSingle(
        this.client
          .from("project_cost_items")
          .insert(input)
          .select("*")
          .single(),
      ),
    );
  }
}
```

Use the existing repository style from `features/settlements/settlement-repository.ts`: keep database rows snake_case and map to camelCase records at the boundary.

- [x] **Step 4: Add UI DTO tests and implementation**

Create `features/complex-cost/complex-cost-ui-dto.test.ts`:

```ts
it("hides gross margin and supplier cost from streamer-facing DTOs", () => {
  expect(
    toComplexCostDashboardDto(
      {
        expectedReceivableCents: 100000,
        supplierCostCents: 30000,
        grossMarginCents: 40000,
        items: [],
      },
      "streamer",
    ),
  ).toEqual({ items: [] });
});
```

Implement `toComplexCostDashboardDto` so staff roles can see internal cost fields, while streamer gets no internal financial fields.

- [x] **Step 5: Verify service and DTO tests**

Run:

```bash
pnpm vitest run features/complex-cost/complex-cost-service.test.ts features/complex-cost/complex-cost-ui-dto.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit** (skipped per user instruction: do not commit or push)

```bash
git add features/complex-cost
git commit -m "feat: add complex cost domain service"
```

---

### Task 5: API Routes

**Files:**

- Create route files under:
  - `app/api/projects/[projectId]/complex-cost-rule/route.ts`
  - `app/api/projects/[projectId]/complex-cost-rule/approve/route.ts`
  - `app/api/projects/[projectId]/complex-cost-rule/preview/route.ts`
  - `app/api/projects/[projectId]/cost-items/route.ts`
  - `app/api/projects/[projectId]/cost-imports/route.ts`
  - `app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.ts`
  - `app/api/projects/[projectId]/cost-dashboard/route.ts`
  - `app/api/projects/[projectId]/cost-export/route.ts`
  - `app/api/settlement-batches/[batchId]/cost-items/route.ts`
- Create matching `route.test.ts` files.

- [x] **Step 1: Write route contract tests**

For each write route, assert:

- Unauthenticated request returns 401.
- Role outside MCN staff returns 403.
- Missing entitlement returns 403 with `Complex cost rules are not enabled for this project`.
- Read-only billing status blocks writes.
- Valid input calls the service and returns JSON.

Example for preview route:

```ts
it("returns complex cost preview result", async () => {
  const request = new Request(
    "http://localhost/api/projects/project-1/complex-cost-rule/preview",
    {
      method: "POST",
      body: JSON.stringify({
        expectedReceivableCents: 100000,
        streamerCount: 2,
        estimatedMinutesPerStreamer: 60,
        streamerHourlyCostCents: 5000,
      }),
    },
  );

  const response = await POST(request, {
    params: Promise.resolve({ projectId: "project-1" }),
  });
  await expect(response.json()).resolves.toMatchObject({
    preview: expect.objectContaining({ expectedReceivableCents: 100000 }),
  });
});
```

Run: `pnpm vitest run app/api/projects/[projectId]/complex-cost-rule/preview/route.test.ts`

Expected: FAIL until route exists.

- [x] **Step 2: Implement route context helper**

Create a local helper in `features/complex-cost/complex-cost-route-utils.ts` that mirrors settlement route utilities:

```ts
export async function getComplexCostRouteContext() {
  const supabase = await createSupabaseServerClient();
  const auth = await getAuthContext(supabase);
  if (!auth.userId || !isMcnStaff(auth.role)) {
    throw new RouteError("Only MCN staff can manage complex cost rules", 403);
  }
  return {
    supabase,
    auth,
    repo: new SupabaseComplexCostRepository(supabase),
  };
}
```

- [x] **Step 3: Implement route files**

Each route should:

1. Parse JSON with strict required fields.
2. Load route context.
3. Call `assertBillingWriteAllowed` for write routes with `featureKey: "complex_cost_rules"`.
4. Call the relevant service function.
5. Return JSON with `{ rule }`, `{ preview }`, `{ item }`, `{ importBatch }`, or `{ dashboard }`.

- [x] **Step 4: Verify route tests**

Run:

```bash
pnpm vitest run app/api/projects/[projectId]/complex-cost-rule app/api/projects/[projectId]/cost-items app/api/settlement-batches/[batchId]/cost-items
```

Expected: PASS.

- [x] **Step 5: Commit** (skipped per user instruction: do not commit or push)

```bash
git add app/api/projects app/api/settlement-batches features/complex-cost/complex-cost-route-utils.ts
git commit -m "feat: add complex cost API routes"
```

---

### Task 6: Exports and Settlement Attachment

**Files:**

- Modify: `features/exports/export-definitions.ts`
- Modify: `features/exports/export-definitions.test.ts`
- Create: `features/complex-cost/complex-cost-export-dto.ts`
- Create: `features/complex-cost/complex-cost-export-dto.test.ts`
- Modify: `features/settlements/settlement-queries.ts`
- Modify: `features/settlements/settlement-queries.test.ts`

- [x] **Step 1: Write failing export definition tests**

Add to `features/exports/export-definitions.test.ts`:

```ts
it("supports project cost and supplier reconciliation exports", () => {
  expect(isExportKind("project_costs")).toBe(true);
  expect(isExportKind("supplier_reconcile")).toBe(true);
  expect(
    getAllowedExportFields("project_costs", "operator_business"),
  ).not.toContainEqual(
    expect.objectContaining({ sensitivity: "finance_sensitive" }),
  );
});
```

Run: `pnpm vitest run features/exports/export-definitions.test.ts`

Expected: FAIL because export kinds are missing.

- [x] **Step 2: Add export kinds**

Update `ExportKind` with:

```ts
  | "project_costs"
  | "supplier_reconcile";
```

Add fields:

```ts
project_costs: [
  { key: "projectName", label: "项目名称", sensitivity: "public" },
  { key: "itemType", label: "成本类型", sensitivity: "internal" },
  { key: "amountCents", label: "成本金额", sensitivity: "finance_sensitive" },
  { key: "source", label: "来源", sensitivity: "internal" },
  { key: "reason", label: "原因", sensitivity: "internal" },
],
supplier_reconcile: [
  { key: "projectName", label: "项目名称", sensitivity: "public" },
  { key: "supplierName", label: "供应商", sensitivity: "public" },
  { key: "itemType", label: "费用类型", sensitivity: "public" },
  { key: "amountCents", label: "对账金额", sensitivity: "finance_sensitive" },
  { key: "evidenceLevel", label: "证据等级", sensitivity: "internal" },
],
```

- [x] **Step 3: Add settlement query coverage**

Extend settlement batch detail DTO tests so batch cost items appear in staff views but never streamer-safe views.

- [x] **Step 4: Verify exports and settlement query tests**

Run:

```bash
pnpm vitest run features/exports/export-definitions.test.ts features/settlements/settlement-queries.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit** (skipped per user instruction: do not commit or push)

```bash
git add features/exports features/complex-cost/complex-cost-export-dto.ts features/complex-cost/complex-cost-export-dto.test.ts features/settlements/settlement-queries.ts features/settlements/settlement-queries.test.ts
git commit -m "feat: export complex cost data safely"
```

---

### Task 7: Ops UI Wiring

**Files:**

- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing UI tests**

Add tests to `components/reference-ui/ops-reference.test.jsx`:

```jsx
it("shows complex cost settings in settlement when entitlement is enabled", async () => {
  render(
    <OpsReferenceApp
      initialRoute="settle"
      complexCost={{ enabled: true, includedProjects: 5, usedProjects: 2 }}
    />,
  );
  expect(screen.getByText("复杂成本规则")).toBeInTheDocument();
  expect(screen.getByText("已用 2 / 5 个项目额度")).toBeInTheDocument();
});

it("submits a complex cost preview from war room", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      preview: { grossMarginCents: 580000, marginRateBps: 5800, riskNotes: [] },
    }),
  }));
  render(<OpsReferenceApp initialRoute="warroom" />);
  fireEvent.click(screen.getByText("复杂成本测算"));
  await screen.findByText("毛利率 58.0%");
});
```

Run: `pnpm vitest run components/reference-ui/ops-reference.test.jsx`

Expected: FAIL until UI is wired.

- [x] **Step 2: Hydrate data in stubs page**

In `app/(ops)/console/stubs/[module]/page.tsx`, load complex-cost data alongside existing settlement and billing data. Pass it to the reference UI through an existing `initialData` or context prop following the file's current pattern.

- [x] **Step 3: Add UI surfaces**

In `components/reference-ui/ops-reference.jsx`:

- Settlement screen: add a compact complex cost panel with entitlement status, quota usage, active rule version, and add cost item button.
- War room screen: add complex cost preview inputs and call `/api/projects/:projectId/complex-cost-rule/preview`.
- Export screen: add project cost and supplier reconciliation export kinds.
- Project settings area: show rule template selector and active rule status.

- [x] **Step 4: Verify UI tests**

Run: `pnpm vitest run components/reference-ui/ops-reference.test.jsx`

Expected: PASS.

- [x] **Step 5: Commit** (skipped per user instruction: do not commit or push)

```bash
git add "app/(ops)/console/stubs/[module]/page.tsx" components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: wire complex cost rules into ops UI"
```

---

### Task 8: Regression and Documentation Sync

**Files:**

- Create: `features/regression/complex-cost-golden-path.test.ts`
- Modify: `docs/product-function-document.md`
- Modify: `docs/reports/2026-06-16-game-live-complex-cost-rules-delivery-design.md`

- [x] **Step 1: Add golden-path regression**

Create `features/regression/complex-cost-golden-path.test.ts`:

```ts
it("covers enable rule -> preview -> import cps -> attach to settlement -> export-safe summary", async () => {
  const result = await runComplexCostGoldenPath({
    planTier: "pro",
    includedComplexProjects: 5,
    projectId: "project-1",
    salesAmountCents: 200000,
    cpsRateBps: 1500,
  });

  expect(result.entitlement).toMatchObject({ billingMode: "included" });
  expect(result.preview.grossMarginCents).toBeGreaterThan(0);
  expect(result.confirmedCostItem).toMatchObject({
    itemType: "cps",
    amountCents: 30000,
  });
  expect(result.settlementBatch.costItems).toHaveLength(1);
  expect(result.streamerSafeBill).not.toHaveProperty("grossMarginCents");
});
```

Implement the in-memory golden path using the service functions and calculator from previous tasks.

- [x] **Step 2: Sync product docs**

Update `docs/product-function-document.md` after implementation:

- Move X1 from "规划能力" to the correct shipped status if all MVP tasks are complete.
- Add implemented API routes to the API table.
- Add implemented database tables to the database overview.
- Add actual test command to the acceptance table.

- [x] **Step 3: Verify focused and broad checks**

Run:

```bash
pnpm vitest run features/complex-cost features/regression/complex-cost-golden-path.test.ts
pnpm vitest run features/billing features/exports features/settlements
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands pass. Known lint noise from `components/reference-ui/ops-reference.jsx` Babel deopt is acceptable if lint exits 0.

Verification note: focused complex-cost, billing/export/settlement, type-check, lint, full test, and build passed. Full `pnpm format:check` is blocked only by pre-existing unrelated untracked report docs; scoped Prettier check for this task's changed files passed.

- [x] **Step 4: Commit** (skipped per user instruction: do not commit or push)

```bash
git add features/regression/complex-cost-golden-path.test.ts docs/product-function-document.md docs/reports/2026-06-16-game-live-complex-cost-rules-delivery-design.md
git commit -m "docs: sync complex cost rule delivery status"
```

---

## Self-Review

Spec coverage:

- Project-level entitlement and 99 元/项目/月 commercial model: Task 1, Task 2, Task 4.
- Rule templates and rule versions: Task 1, Task 4.
- Cost preview and gross margin: Task 3, Task 5, Task 7.
- CPA/CPS/gift/traffic/supplier imports: Task 3, Task 4, Task 5.
- Settlement-batch attachment: Task 5, Task 6.
- Role-safe export: Task 6.
- Ops UI entry points: Task 7.
- Regression and documentation: Task 8.

Placeholder scan:

- No forbidden placeholder markers remain.
- Every task names exact files and verification commands.
- Code snippets define concrete public surfaces and expected behavior.

Type consistency:

- Entitlement key is `complex_cost_rules`.
- Usage metric is `complex_cost_project`.
- Core table names match the product design and schema contract.
- Cost item amount fields use integer cents.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-16-game-live-complex-cost-rules.md`. Two execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.
