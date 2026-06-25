# Miracle Legend Test Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build local-only commands that load, verify, and clear Miracle-like and Legend-like project, streamer, and instrumentation data.

**Architecture:** Keep the data model and safety logic in a pure fixture module, keep Supabase side effects in one CLI script, and add a narrow service-role-only cleanup RPC for append-only audit logs. The loader clears the marked dataset before inserting, the verifier counts required records, and the clearer removes only records owned by the dataset marker or script email suffix.

**Tech Stack:** Node ESM scripts, Vitest, Supabase JS service-role client, Supabase SQL migrations, package scripts.

---

## File Structure

- Create `scripts/local-testdata-fixture.mjs`: dataset constants, local safety guard, fixture row builders, verification requirements, clear-order metadata, and pure assertion helpers.
- Create `scripts/local-testdata.mjs`: CLI entry point for `load`, `verify`, and `clear`; environment loading; Supabase admin client; database adapter calls.
- Create `scripts/local-testdata-fixture.test.mjs`: unit tests for the pure fixture module.
- Create `scripts/local-testdata-runner.test.mjs`: unit tests for the side-effect runner using an in-memory fake adapter.
- Create `supabase/migrations/20260604230000_local_testdata_audit_cleanup.sql`: service-role-only RPC that deletes dataset audit rows despite the append-only trigger.
- Modify `lib/db/schema-contract.test.ts`: assert the cleanup RPC is restricted to service role and exact dataset code.
- Modify `package.json`: add `testdata:load`, `testdata:verify`, and `testdata:clear`.

---

### Task 1: Fixture Constants And Local Safety Guard

**Files:**

- Create: `scripts/local-testdata-fixture.mjs`
- Create: `scripts/local-testdata-fixture.test.mjs`

- [ ] **Step 1: Write the failing safety guard tests**

Add this test file:

```javascript
import { describe, expect, it } from "vitest";

import {
  DATASET,
  assertLocalTestdataAllowed,
  isDatasetEmail,
} from "./local-testdata-fixture.mjs";

describe("local testdata safety guard", () => {
  it("allows localhost Supabase URLs", () => {
    expect(() =>
      assertLocalTestdataAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();

    expect(() =>
      assertLocalTestdataAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      }),
    ).not.toThrow();
  });

  it("allows non-local URLs only with explicit opt-in", () => {
    expect(() =>
      assertLocalTestdataAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        ALLOW_LOCAL_TESTDATA: "1",
      }),
    ).not.toThrow();
  });

  it("rejects non-local URLs without explicit opt-in", () => {
    expect(() =>
      assertLocalTestdataAllowed({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(/Refusing to run local testdata command/);
  });

  it("uses a dedicated dataset marker and email suffix", () => {
    expect(DATASET.organizationCode).toBe("local_miracle_legend_v1");
    expect(DATASET.emailSuffix).toBe("@ml-test.invalid");
    expect(isDatasetEmail("owner@ml-test.invalid")).toBe(true);
    expect(isDatasetEmail("owner@example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs
```

Expected: fail because `scripts/local-testdata-fixture.mjs` does not exist.

- [ ] **Step 3: Implement the fixture constants and guard**

Create `scripts/local-testdata-fixture.mjs` with:

```javascript
export const DATASET = Object.freeze({
  organizationCode: "local_miracle_legend_v1",
  organizationName: "Local Miracle Legend Workspace",
  emailSuffix: "@ml-test.invalid",
  password: "LocalTestdata123!",
  periodMonth: "2026-06-01",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  now: "2026-06-04T12:00:00.000Z",
});

export const STAFF_USERS = Object.freeze([
  {
    key: "owner",
    role: "owner",
    email: `owner${DATASET.emailSuffix}`,
    fullName: "Local Fixture Owner",
  },
  {
    key: "ops",
    role: "ops_manager",
    email: `ops${DATASET.emailSuffix}`,
    fullName: "Local Fixture Ops",
  },
  {
    key: "business",
    role: "operator_business",
    email: `business${DATASET.emailSuffix}`,
    fullName: "Local Fixture Business",
  },
  {
    key: "finance",
    role: "finance",
    email: `finance${DATASET.emailSuffix}`,
    fullName: "Local Fixture Finance",
  },
]);

export const STREAMER_USERS = Object.freeze([
  {
    key: "streamerA",
    email: `streamer-a${DATASET.emailSuffix}`,
    fullName: "Local Fixture Streamer A",
  },
  {
    key: "streamerB",
    email: `streamer-b${DATASET.emailSuffix}`,
    fullName: "Local Fixture Streamer B",
  },
]);

export function isDatasetEmail(email) {
  return typeof email === "string" && email.endsWith(DATASET.emailSuffix);
}

export function assertLocalTestdataAllowed(env) {
  if (env.ALLOW_LOCAL_TESTDATA === "1") {
    return;
  }

  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is required for local testdata commands",
    );
  }

  const hostname = new URL(rawUrl).hostname;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(hostname)) {
    throw new Error(
      `Refusing to run local testdata command against ${hostname}. Set ALLOW_LOCAL_TESTDATA=1 to override.`,
    );
  }
}
```

- [ ] **Step 4: Run the guard tests and verify they pass**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/local-testdata-fixture.mjs scripts/local-testdata-fixture.test.mjs
git commit -m "test: add local testdata safety guard"
```

---

### Task 2: Audit Log Cleanup RPC

**Files:**

- Create: `supabase/migrations/20260604230000_local_testdata_audit_cleanup.sql`
- Modify: `lib/db/schema-contract.test.ts`

- [ ] **Step 1: Write the failing schema contract test**

Add this test case to `lib/db/schema-contract.test.ts`:

```typescript
it("restricts local testdata audit cleanup to service-role execution and the dataset code", () => {
  expect(allMigrations).toContain(
    "function public.clear_local_testdata_audit_logs(dataset_code text)",
  );
  expect(allMigrations).toContain("dataset_code <> 'local_miracle_legend_v1'");
  expect(allMigrations).toContain("disable trigger audit_logs_append_only");
  expect(allMigrations).toContain("enable trigger audit_logs_append_only");
  expect(allMigrations).toContain(
    "revoke all on function public.clear_local_testdata_audit_logs(text) from public",
  );
  expect(allMigrations).toContain(
    "grant execute on function public.clear_local_testdata_audit_logs(text) to service_role",
  );
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm vitest run lib/db/schema-contract.test.ts
```

Expected: fail because the migration does not exist.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/20260604230000_local_testdata_audit_cleanup.sql`:

```sql
create or replace function public.clear_local_testdata_audit_logs(dataset_code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid;
  deleted_count integer := 0;
begin
  if dataset_code <> 'local_miracle_legend_v1' then
    raise exception 'Unsupported local testdata dataset code: %', dataset_code;
  end if;

  select id
    into target_organization_id
  from public.organizations
  where code = dataset_code;

  if target_organization_id is null then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('local_miracle_legend_audit_cleanup'));

  alter table public.audit_logs disable trigger audit_logs_append_only;

  delete from public.audit_logs
  where organization_id = target_organization_id;

  get diagnostics deleted_count = row_count;

  alter table public.audit_logs enable trigger audit_logs_append_only;

  return deleted_count;
exception
  when others then
    alter table public.audit_logs enable trigger audit_logs_append_only;
    raise;
end;
$$;

revoke all on function public.clear_local_testdata_audit_logs(text) from public;
revoke all on function public.clear_local_testdata_audit_logs(text) from anon;
revoke all on function public.clear_local_testdata_audit_logs(text) from authenticated;
grant execute on function public.clear_local_testdata_audit_logs(text) to service_role;
```

- [ ] **Step 4: Run the schema test and verify it passes**

Run:

```bash
pnpm vitest run lib/db/schema-contract.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/db/schema-contract.test.ts supabase/migrations/20260604230000_local_testdata_audit_cleanup.sql
git commit -m "feat: add local testdata audit cleanup rpc"
```

---

### Task 3: Fixture Row Builder And Verification Rules

**Files:**

- Modify: `scripts/local-testdata-fixture.mjs`
- Modify: `scripts/local-testdata-fixture.test.mjs`

- [ ] **Step 1: Write the failing fixture shape tests**

Append these tests to `scripts/local-testdata-fixture.test.mjs`:

```javascript
import {
  REQUIRED_AUDIT_GROUPS,
  REQUIRED_USAGE_METRICS,
  buildFixtureRows,
  assertLoadedSummary,
  assertEmptySummary,
} from "./local-testdata-fixture.mjs";

describe("local testdata fixture rows", () => {
  it("builds Miracle-like and Legend-like project rows", () => {
    const rows = buildFixtureRows({
      usersByKey: {
        owner: "11111111-1111-4111-8111-111111111101",
        ops: "11111111-1111-4111-8111-111111111102",
        business: "11111111-1111-4111-8111-111111111103",
        finance: "11111111-1111-4111-8111-111111111104",
        streamerA: "11111111-1111-4111-8111-111111111105",
        streamerB: "11111111-1111-4111-8111-111111111106",
      },
    });

    expect(rows.projects.map((project) => project.product_name)).toEqual([
      "Miracle Echo",
      "Legend Expedition",
    ]);
    expect(rows.streamers).toHaveLength(3);
    expect(rows.liveTasks.length).toBeGreaterThanOrEqual(4);
    expect(rows.liveReports.length).toBeGreaterThanOrEqual(2);
    expect(rows.usageEvents.map((event) => event.metric).sort()).toEqual(
      [...REQUIRED_USAGE_METRICS].sort(),
    );
    expect(rows.auditLogs.map((entry) => entry.module)).toEqual(
      expect.arrayContaining(REQUIRED_AUDIT_GROUPS),
    );
  });

  it("asserts loaded and empty verification summaries", () => {
    expect(() =>
      assertLoadedSummary({
        organizations: 1,
        projects: 2,
        streamers: 3,
        liveTasks: 4,
        liveReports: 2,
        usageMetrics: ["active_streamer", "ai", "storage_mb", "export"],
        auditModules: [
          "project",
          "streamer",
          "live_operation",
          "settlement",
          "instrumentation",
        ],
      }),
    ).not.toThrow();

    expect(() =>
      assertEmptySummary({
        organizations: 0,
        projects: 0,
        streamers: 0,
        authUsers: 0,
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the fixture test and verify it fails**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs
```

Expected: fail because the row builder and verification helpers do not exist.

- [ ] **Step 3: Add row builder constants and verification helpers**

Append this implementation to `scripts/local-testdata-fixture.mjs`:

```javascript
export const REQUIRED_USAGE_METRICS = Object.freeze([
  "active_streamer",
  "ai",
  "storage_mb",
  "export",
]);

export const REQUIRED_AUDIT_GROUPS = Object.freeze([
  "project",
  "streamer",
  "live_operation",
  "settlement",
  "instrumentation",
]);

const IDS = Object.freeze({
  supplier: "11111111-1111-4111-8111-111111111201",
  miracleProject: "11111111-1111-4111-8111-111111111301",
  legendProject: "11111111-1111-4111-8111-111111111302",
  streamerA: "11111111-1111-4111-8111-111111111401",
  streamerB: "11111111-1111-4111-8111-111111111402",
  streamerUnbound: "11111111-1111-4111-8111-111111111403",
  taskMiraclePending: "11111111-1111-4111-8111-111111111501",
  taskMiracleApproved: "11111111-1111-4111-8111-111111111502",
  taskLegendLive: "11111111-1111-4111-8111-111111111503",
  taskLegendCompleted: "11111111-1111-4111-8111-111111111504",
  reportMiracle: "11111111-1111-4111-8111-111111111601",
  reportLegend: "11111111-1111-4111-8111-111111111602",
  payableBatch: "11111111-1111-4111-8111-111111111701",
  receivableBatch: "11111111-1111-4111-8111-111111111702",
  payableItem: "11111111-1111-4111-8111-111111111801",
  receivableItem: "11111111-1111-4111-8111-111111111802",
});

export function buildFixtureRows({ usersByKey, organizationId = null }) {
  const orgId = organizationId ?? "11111111-1111-4111-8111-111111111001";
  const actorId = usersByKey.ops;
  const ownerId = usersByKey.owner;

  const projects = [
    {
      id: IDS.miracleProject,
      organization_id: orgId,
      code: "ML-MIRACLE-001",
      name: "Miracle Echo Local Acceptance",
      product_name: "Miracle Echo",
      vendor_name: "Local Game Vendor",
      agent_name: "Local Ops Agent",
      supplier_name: "Local Supplier",
      description: "Local-only Miracle-like product acceptance project",
      status: "recruiting",
      sensitivity: "normal",
      supplier_id: IDS.supplier,
      created_by: ownerId,
      owner_id: ownerId,
      ops_manager_id: actorId,
      starts_at: "2026-06-10T12:00:00.000Z",
      ends_at: "2026-06-30T12:00:00.000Z",
      recruiting_deadline: "2026-06-09",
      default_settlement_method: "cpt",
      default_hourly_rate: 80,
      default_base_salary: 0,
      default_settlement_rule: {
        dataset: DATASET.organizationCode,
        category: "miracle",
      },
      published_at: DATASET.now,
    },
    {
      id: IDS.legendProject,
      organization_id: orgId,
      code: "ML-LEGEND-001",
      name: "Legend Expedition Local Acceptance",
      product_name: "Legend Expedition",
      vendor_name: "Local Game Vendor",
      agent_name: "Local Ops Agent",
      supplier_name: "Local Supplier",
      description: "Local-only Legend-like product acceptance project",
      status: "active",
      sensitivity: "high",
      supplier_id: IDS.supplier,
      created_by: ownerId,
      owner_id: ownerId,
      ops_manager_id: actorId,
      starts_at: "2026-06-04T12:00:00.000Z",
      ends_at: "2026-06-25T12:00:00.000Z",
      recruiting_deadline: "2026-06-03",
      default_settlement_method: "base_salary_cpt",
      default_hourly_rate: 95,
      default_base_salary: 1200,
      default_settlement_rule: {
        dataset: DATASET.organizationCode,
        category: "legend",
      },
      published_at: "2026-06-03T12:00:00.000Z",
    },
  ];

  const streamers = [
    {
      id: IDS.streamerA,
      organization_id: orgId,
      user_id: usersByKey.streamerA,
      display_name: "Local Streamer Nova",
      real_name: "Nova Local",
      source_type: "signed",
      primary_supplier_id: IDS.supplier,
      cooperation_status: "active",
      categories: ["miracle", "legend"],
      platforms: ["douyin", "kuaishou"],
      styles: ["guide", "pvp"],
      skills: ["new-server-rush", "boss-fight"],
      default_settlement_method: "cpt",
      default_price: 80,
      default_base_salary: 0,
      risk_level: "low",
      auto_trust: "trusted",
      clean_report_count: 8,
      duration_baseline: 120,
      created_by: actorId,
    },
    {
      id: IDS.streamerB,
      organization_id: orgId,
      user_id: usersByKey.streamerB,
      display_name: "Local Streamer Rune",
      real_name: "Rune Local",
      source_type: "external",
      primary_supplier_id: IDS.supplier,
      cooperation_status: "key_development",
      categories: ["legend"],
      platforms: ["douyin"],
      styles: ["story", "guild"],
      skills: ["retention", "conversion"],
      default_settlement_method: "base_salary_cpt",
      default_price: 95,
      default_base_salary: 1200,
      risk_level: "medium",
      auto_trust: "probation",
      clean_report_count: 2,
      duration_baseline: 150,
      created_by: actorId,
    },
    {
      id: IDS.streamerUnbound,
      organization_id: orgId,
      user_id: null,
      display_name: "Local Streamer Unbound",
      real_name: "Unbound Local",
      source_type: "supplier_recommended",
      primary_supplier_id: IDS.supplier,
      cooperation_status: "not_started",
      categories: ["miracle"],
      platforms: ["bilibili"],
      styles: ["trial"],
      skills: ["first-look"],
      default_settlement_method: "cpt",
      default_price: 70,
      default_base_salary: 0,
      risk_level: "low",
      auto_trust: "probation",
      clean_report_count: 0,
      duration_baseline: 90,
      created_by: actorId,
    },
  ];

  const liveTasks = [
    {
      id: IDS.taskMiraclePending,
      organization_id: orgId,
      project_id: IDS.miracleProject,
      streamer_id: IDS.streamerA,
      title: "Miracle Echo prerelease warmup",
      status: "pending_live",
      planned_start_at: "2026-06-12T12:00:00.000Z",
      planned_end_at: "2026-06-12T14:00:00.000Z",
      planned_duration: 120,
      created_by: actorId,
      note: DATASET.organizationCode,
    },
    {
      id: IDS.taskMiracleApproved,
      organization_id: orgId,
      project_id: IDS.miracleProject,
      streamer_id: IDS.streamerA,
      title: "Miracle Echo approved report sample",
      status: "report_approved",
      planned_start_at: "2026-06-13T12:00:00.000Z",
      planned_end_at: "2026-06-13T14:00:00.000Z",
      planned_duration: 120,
      system_started_at: "2026-06-13T12:00:00.000Z",
      system_stopped_at: "2026-06-13T14:00:00.000Z",
      system_duration: 120,
      created_by: actorId,
      note: DATASET.organizationCode,
    },
    {
      id: IDS.taskLegendLive,
      organization_id: orgId,
      project_id: IDS.legendProject,
      streamer_id: IDS.streamerB,
      title: "Legend Expedition live sample",
      status: "live",
      planned_start_at: "2026-06-14T12:00:00.000Z",
      planned_end_at: "2026-06-14T14:30:00.000Z",
      planned_duration: 150,
      system_started_at: "2026-06-14T12:00:00.000Z",
      system_duration: 30,
      created_by: actorId,
      note: DATASET.organizationCode,
    },
    {
      id: IDS.taskLegendCompleted,
      organization_id: orgId,
      project_id: IDS.legendProject,
      streamer_id: IDS.streamerB,
      title: "Legend Expedition completed sample",
      status: "completed",
      planned_start_at: "2026-06-15T12:00:00.000Z",
      planned_end_at: "2026-06-15T14:30:00.000Z",
      planned_duration: 150,
      system_started_at: "2026-06-15T12:00:00.000Z",
      system_stopped_at: "2026-06-15T14:28:00.000Z",
      system_duration: 148,
      created_by: actorId,
      note: DATASET.organizationCode,
    },
  ];

  const liveReports = [
    {
      id: IDS.reportMiracle,
      organization_id: orgId,
      live_task_id: IDS.taskMiracleApproved,
      project_id: IDS.miracleProject,
      streamer_id: IDS.streamerA,
      status: "approved",
      system_duration: 120,
      screenshot_duration: 119,
      claimed_duration: 119,
      settlement_duration: 120,
      time_source: "system",
      evidence_level: "green",
      divergence_pct: 0.0083,
      viewers: 1800,
      review_mode: "manual",
      reviewed_by: actorId,
      reviewed_at: DATASET.now,
      review_notes: DATASET.organizationCode,
      enter_settlement_pool: true,
      created_by: usersByKey.streamerA,
    },
    {
      id: IDS.reportLegend,
      organization_id: orgId,
      live_task_id: IDS.taskLegendCompleted,
      project_id: IDS.legendProject,
      streamer_id: IDS.streamerB,
      status: "approved",
      system_duration: 148,
      screenshot_duration: 143,
      claimed_duration: 145,
      settlement_duration: 143,
      time_source: "screenshot",
      evidence_level: "yellow",
      divergence_pct: 0.0338,
      viewers: 2400,
      review_mode: "manual",
      reviewed_by: actorId,
      reviewed_at: DATASET.now,
      review_notes: DATASET.organizationCode,
      enter_settlement_pool: true,
      risk_flags: ["duration_divergence"],
      created_by: usersByKey.streamerB,
    },
  ];

  const usageEvents = REQUIRED_USAGE_METRICS.map((metric, index) => ({
    organization_id: orgId,
    metric,
    quantity: index === 2 ? 256 : index + 1,
    period_month: DATASET.periodMonth,
    source: "local_testdata",
    object_type: "dataset",
    object_id: DATASET.organizationCode,
    metadata: { dataset: DATASET.organizationCode, metric },
  }));

  const auditLogs = REQUIRED_AUDIT_GROUPS.map((module, index) => ({
    organization_id: orgId,
    actor_user_id: actorId,
    actor_name: "Local Fixture Ops",
    actor_role: "ops_manager",
    action: index === 3 ? "lock" : "create",
    module,
    object_type: "local_testdata",
    object_name: DATASET.organizationCode,
    project_id: index < 2 ? IDS.miracleProject : IDS.legendProject,
    streamer_id: index === 1 ? IDS.streamerA : null,
    before_json: {},
    after_json: { dataset: DATASET.organizationCode },
    changed_fields: ["dataset"],
    reason: index === 3 ? "Local fixture high-risk settlement sample" : null,
    is_high_risk: index === 3,
    result: "success",
  }));

  return {
    organization: {
      id: orgId,
      name: DATASET.organizationName,
      code: DATASET.organizationCode,
    },
    billingPlan: {
      code: "local_miracle_legend_plan_v1",
      tier: "pro",
      name: "Local Miracle Legend Plan",
      monthly_price_cents: 0,
      annual_price_cents: 0,
      included_active_streamers: 10,
      included_seats: 10,
      included_ocr: 100,
      included_ai: 100,
      included_storage_mb: 1024,
      included_exports: 20,
      features: { dataset: DATASET.organizationCode },
    },
    supplier: {
      id: IDS.supplier,
      organization_id: orgId,
      name: "Local Fixture Supplier",
      contact_name: "Local Contact",
      note: DATASET.organizationCode,
    },
    projects,
    streamers,
    liveTasks,
    liveReports,
    usageEvents,
    auditLogs,
  };
}

export function assertLoadedSummary(summary) {
  assertMinimum(summary.organizations, 1, "dataset organization");
  assertMinimum(summary.projects, 2, "dataset projects");
  assertMinimum(summary.streamers, 3, "dataset streamers");
  assertMinimum(summary.liveTasks, 4, "dataset live tasks");
  assertMinimum(summary.liveReports, 2, "dataset live reports");

  for (const metric of REQUIRED_USAGE_METRICS) {
    if (!summary.usageMetrics.includes(metric)) {
      throw new Error(`Missing usage metric ${metric}`);
    }
  }

  for (const module of REQUIRED_AUDIT_GROUPS) {
    if (!summary.auditModules.includes(module)) {
      throw new Error(`Missing audit module ${module}`);
    }
  }
}

export function assertEmptySummary(summary) {
  const checked = ["organizations", "projects", "streamers", "authUsers"];
  for (const key of checked) {
    if (summary[key] !== 0) {
      throw new Error(`Expected ${key} to be empty, received ${summary[key]}`);
    }
  }
}

function assertMinimum(value, minimum, label) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`Expected at least ${minimum} ${label}, received ${value}`);
  }
}
```

- [ ] **Step 4: Run the fixture tests and verify they pass**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/local-testdata-fixture.mjs scripts/local-testdata-fixture.test.mjs
git commit -m "test: define local miracle legend fixture"
```

---

### Task 4: Runner Contract With Fake Adapter

**Files:**

- Modify: `scripts/local-testdata-fixture.mjs`
- Create: `scripts/local-testdata-runner.test.mjs`

- [ ] **Step 1: Write failing runner tests**

Create `scripts/local-testdata-runner.test.mjs`:

```javascript
import { describe, expect, it } from "vitest";

import { DATASET, createTestdataRunner } from "./local-testdata-fixture.mjs";

function createFakeAdapter() {
  const calls = [];
  return {
    calls,
    async findDatasetOrganization() {
      calls.push(["findDatasetOrganization"]);
      return { id: "org-local" };
    },
    async clearAuditLogs() {
      calls.push(["clearAuditLogs"]);
    },
    async clearRelationalRows() {
      calls.push(["clearRelationalRows"]);
    },
    async deleteDatasetOrganization() {
      calls.push(["deleteDatasetOrganization"]);
    },
    async deleteDatasetAuthUsers() {
      calls.push(["deleteDatasetAuthUsers"]);
    },
    async ensureAuthUsers() {
      calls.push(["ensureAuthUsers"]);
      return {
        owner: "user-owner",
        ops: "user-ops",
        business: "user-business",
        finance: "user-finance",
        streamerA: "user-streamer-a",
        streamerB: "user-streamer-b",
      };
    },
    async insertFixtureRows(rows) {
      calls.push(["insertFixtureRows", rows.organization.code]);
    },
    async summarizeLoadedDataset() {
      calls.push(["summarizeLoadedDataset"]);
      return {
        organizations: 1,
        projects: 2,
        streamers: 3,
        liveTasks: 4,
        liveReports: 2,
        usageMetrics: ["active_streamer", "ai", "storage_mb", "export"],
        auditModules: [
          "project",
          "streamer",
          "live_operation",
          "settlement",
          "instrumentation",
        ],
      };
    },
    async summarizeEmptyDataset() {
      calls.push(["summarizeEmptyDataset"]);
      return {
        organizations: 0,
        projects: 0,
        streamers: 0,
        authUsers: 0,
      };
    },
  };
}

describe("local testdata runner", () => {
  it("clears before loading and verifies the loaded dataset", async () => {
    const adapter = createFakeAdapter();
    const runner = createTestdataRunner(adapter);

    await runner.load();

    expect(adapter.calls.map((call) => call[0])).toEqual([
      "findDatasetOrganization",
      "clearAuditLogs",
      "clearRelationalRows",
      "deleteDatasetOrganization",
      "deleteDatasetAuthUsers",
      "ensureAuthUsers",
      "insertFixtureRows",
      "summarizeLoadedDataset",
    ]);
    expect(adapter.calls[6]).toEqual([
      "insertFixtureRows",
      DATASET.organizationCode,
    ]);
  });

  it("verifies loaded and empty states explicitly", async () => {
    const adapter = createFakeAdapter();
    const runner = createTestdataRunner(adapter);

    await expect(runner.verify()).resolves.toMatchObject({ organizations: 1 });
    await expect(runner.verify({ expectEmpty: true })).resolves.toMatchObject({
      organizations: 0,
    });
  });

  it("clears audit logs before relational rows", async () => {
    const adapter = createFakeAdapter();
    const runner = createTestdataRunner(adapter);

    await runner.clear();

    expect(adapter.calls.map((call) => call[0])).toEqual([
      "findDatasetOrganization",
      "clearAuditLogs",
      "clearRelationalRows",
      "deleteDatasetOrganization",
      "deleteDatasetAuthUsers",
      "summarizeEmptyDataset",
    ]);
  });
});
```

- [ ] **Step 2: Run the runner test and verify it fails**

Run:

```bash
pnpm vitest run scripts/local-testdata-runner.test.mjs
```

Expected: fail because `createTestdataRunner` does not exist.

- [ ] **Step 3: Implement the pure runner**

Append this to `scripts/local-testdata-fixture.mjs`:

```javascript
export function createTestdataRunner(adapter) {
  async function clearWithoutVerify() {
    const organization = await adapter.findDatasetOrganization();
    if (organization) {
      await adapter.clearAuditLogs(organization.id);
      await adapter.clearRelationalRows(organization.id);
      await adapter.deleteDatasetOrganization(organization.id);
    }
    await adapter.deleteDatasetAuthUsers(DATASET.emailSuffix);
  }

  return {
    async load() {
      await clearWithoutVerify();
      const usersByKey = await adapter.ensureAuthUsers({
        staffUsers: STAFF_USERS,
        streamerUsers: STREAMER_USERS,
        password: DATASET.password,
      });
      const rows = buildFixtureRows({ usersByKey });
      await adapter.insertFixtureRows(rows);
      const summary = await adapter.summarizeLoadedDataset();
      assertLoadedSummary(summary);
      return summary;
    },

    async verify(options = {}) {
      if (options.expectEmpty) {
        const summary = await adapter.summarizeEmptyDataset();
        assertEmptySummary(summary);
        return summary;
      }

      const summary = await adapter.summarizeLoadedDataset();
      assertLoadedSummary(summary);
      return summary;
    },

    async clear() {
      await clearWithoutVerify();
      const summary = await adapter.summarizeEmptyDataset();
      assertEmptySummary(summary);
      return summary;
    },
  };
}
```

- [ ] **Step 4: Run fixture and runner tests**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/local-testdata-fixture.mjs scripts/local-testdata-runner.test.mjs
git commit -m "test: define local testdata runner contract"
```

---

### Task 5: CLI Shell And Package Scripts

**Files:**

- Create: `scripts/local-testdata.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add command entries to `package.json`**

Modify the `scripts` object to include:

```json
{
  "testdata:load": "node scripts/local-testdata.mjs load",
  "testdata:verify": "node scripts/local-testdata.mjs verify",
  "testdata:clear": "node scripts/local-testdata.mjs clear"
}
```

Keep all existing scripts.

- [ ] **Step 2: Create the CLI shell**

Create `scripts/local-testdata.mjs`:

```javascript
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  assertLocalTestdataAllowed,
  createTestdataRunner,
} from "./local-testdata-fixture.mjs";

const env = loadEnv();
assertLocalTestdataAllowed(env);

const command = process.argv[2] ?? "verify";
const adapter = createSupabaseAdapter(env);
const runner = createTestdataRunner(adapter);

if (command === "load") {
  const summary = await runner.load();
  printSummary("Loaded local Miracle/Legend testdata", summary);
} else if (command === "verify") {
  const summary = await runner.verify({
    expectEmpty: process.argv.includes("--expect-empty"),
  });
  printSummary("Verified local Miracle/Legend testdata", summary);
} else if (command === "clear") {
  const summary = await runner.clear();
  printSummary("Cleared local Miracle/Legend testdata", summary);
} else {
  throw new Error(`Unknown local testdata command: ${command}`);
}

function createSupabaseAdapter(currentEnv) {
  const supabaseUrl = requireEnv(currentEnv, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv(currentEnv, "SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    client,
    async findDatasetOrganization() {
      return findDatasetOrganization(client);
    },
    async clearAuditLogs() {
      return clearAuditLogs(client);
    },
    async clearRelationalRows(organizationId) {
      return clearRelationalRows(client, organizationId);
    },
    async deleteDatasetOrganization(organizationId) {
      return deleteDatasetOrganization(client, organizationId);
    },
    async deleteDatasetAuthUsers(emailSuffix) {
      return deleteDatasetAuthUsers(client, emailSuffix);
    },
    async ensureAuthUsers(input) {
      return ensureAuthUsers(client, input);
    },
    async insertFixtureRows(input) {
      return insertFixtureRows(client, input);
    },
    async summarizeLoadedDataset() {
      return summarizeLoadedDataset(client);
    },
    async summarizeEmptyDataset() {
      return summarizeEmptyDataset(client);
    },
  };
}

function loadEnv() {
  const loaded = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...valueParts] = trimmed.split("=");
      if (loaded[key] === undefined) {
        loaded[key] = valueParts.join("=");
      }
    }
  }
  return loaded;
}

function requireEnv(currentEnv, key) {
  const value = currentEnv[key];
  if (!value) {
    throw new Error(`${key} is required for local testdata commands`);
  }
  return value;
}

function printSummary(label, summary) {
  console.log(label);
  console.log(JSON.stringify(summary, null, 2));
}
```

- [ ] **Step 3: Run the pure tests and package script command**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs
```

Expected: tests pass. The package commands are exercised after the adapter methods are filled in by Tasks 6 through 8.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json scripts/local-testdata.mjs
git commit -m "chore: add local testdata cli commands"
```

---

### Task 6: Clear Adapter

**Files:**

- Modify: `scripts/local-testdata.mjs`
- Modify: `scripts/local-testdata-runner.test.mjs`

- [ ] **Step 1: Add a fake-adapter assertion for organization-not-found clear**

Append this test to `scripts/local-testdata-runner.test.mjs`:

```javascript
it("clear still deletes script-owned auth users when the organization is absent", async () => {
  const adapter = createFakeAdapter();
  adapter.findDatasetOrganization = async () => {
    adapter.calls.push(["findDatasetOrganization"]);
    return null;
  };
  const runner = createTestdataRunner(adapter);

  await runner.clear();

  expect(adapter.calls.map((call) => call[0])).toEqual([
    "findDatasetOrganization",
    "deleteDatasetAuthUsers",
    "summarizeEmptyDataset",
  ]);
});
```

- [ ] **Step 2: Run the runner test and verify it passes**

Run:

```bash
pnpm vitest run scripts/local-testdata-runner.test.mjs
```

Expected: pass because the pure runner already supports this behavior.

- [ ] **Step 3: Add the clear adapter helper functions**

In `scripts/local-testdata.mjs`, import `DATASET` and `isDatasetEmail`:

```javascript
import {
  DATASET,
  assertLocalTestdataAllowed,
  createTestdataRunner,
  isDatasetEmail,
} from "./local-testdata-fixture.mjs";
```

Add these helper functions inside `createSupabaseAdapter` before the return object, so `clearTable` and `listAllAuthUsers` share the local `client`:

```javascript
async function findDatasetOrganization(client) {
  const { data, error } = await client
    .from("organizations")
    .select("id, code")
    .eq("code", DATASET.organizationCode)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data;
}

async function clearAuditLogs(client) {
  const { error } = await client.rpc("clear_local_testdata_audit_logs", {
    dataset_code: DATASET.organizationCode,
  });
  if (error) {
    throw error;
  }
}

async function clearRelationalRows(client, organizationId) {
  await clearTable("settlement_batch_items", "organization_id", organizationId);
  await clearTable("settlement_batches", "organization_id", organizationId);
  await clearTable("review_samples", "organization_id", organizationId);
  await clearTable("ocr_results", "organization_id", organizationId);
  await clearTable("report_screenshots", "organization_id", organizationId);
  await clearTable("report_change_logs", "organization_id", organizationId);
  await clearTable("live_reports", "organization_id", organizationId);
  await clearTable("live_tasks", "organization_id", organizationId);
  await clearTable("recording_submissions", "organization_id", organizationId);
  await clearTable("project_applications", "organization_id", organizationId);
  await clearTable("project_streamers", "organization_id", organizationId);
  await clearTable(
    "streamer_recording_links",
    "organization_id",
    organizationId,
  );
  await clearTable("streamer_accounts", "organization_id", organizationId);
  await clearTable("streamer_suppliers", "organization_id", organizationId);
  await clearTable("usage_events", "organization_id", organizationId);
  await clearTable("usage_monthly_counters", "organization_id", organizationId);
  await clearTable("usage_addons", "organization_id", organizationId);
  await clearTable("feature_addons", "organization_id", organizationId);
  await clearTable(
    "organization_subscriptions",
    "organization_id",
    organizationId,
  );
  await clearTable("notifications", "organization_id", organizationId);
  await clearTable("project_assignments", "organization_id", organizationId);
  await clearTable("projects", "organization_id", organizationId);
  await clearTable("streamers", "organization_id", organizationId);
  await clearTable("suppliers", "organization_id", organizationId);
  await clearTable("organization_members", "organization_id", organizationId);
}

async function deleteDatasetOrganization(client, organizationId) {
  const { error } = await client
    .from("organizations")
    .delete()
    .eq("id", organizationId)
    .eq("code", DATASET.organizationCode);
  if (error) {
    throw error;
  }

  await clearTable("billing_plans", "code", "local_miracle_legend_plan_v1");
}

async function deleteDatasetAuthUsers(client, emailSuffix) {
  const users = await listAllAuthUsers();
  const datasetUsers = users.filter((user) => isDatasetEmail(user.email));
  for (const user of datasetUsers) {
    if (!user.email.endsWith(emailSuffix)) {
      throw new Error(`Refusing to delete non-dataset user ${user.email}`);
    }
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) {
      throw error;
    }
  }
}
```

Add these helper functions inside `createSupabaseAdapter` after the returned object or hoist them before the return:

```javascript
async function clearTable(table, column, value) {
  const { error } = await client.from(table).delete().eq(column, value);
  if (error) {
    throw error;
  }
}

async function listAllAuthUsers() {
  const collected = [];
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) {
      throw error;
    }
    collected.push(...data.users);
    if (data.users.length < 100) {
      return collected;
    }
    page += 1;
  }
}
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm vitest run scripts/local-testdata-runner.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/local-testdata.mjs scripts/local-testdata-runner.test.mjs
git commit -m "feat: implement local testdata cleanup"
```

---

### Task 7: Load Adapter

**Files:**

- Modify: `scripts/local-testdata.mjs`

- [ ] **Step 1: Implement auth user creation**

Add `ensureAuthUsers` inside `createSupabaseAdapter`:

```javascript
async function ensureAuthUsers(
  client,
  { staffUsers, streamerUsers, password },
) {
  const usersByKey = {};
  for (const user of [...staffUsers, ...streamerUsers]) {
    const existing = await findAuthUserByEmail(user.email);
    if (existing) {
      usersByKey[user.key] = existing.id;
      continue;
    }

    const { data, error } = await client.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: user.fullName,
        dataset: DATASET.organizationCode,
      },
    });
    if (error) {
      throw error;
    }
    usersByKey[user.key] = data.user.id;
  }
  return usersByKey;
}
```

Add helper:

```javascript
async function findAuthUserByEmail(email) {
  const users = await listAllAuthUsers();
  return users.find((user) => user.email === email) ?? null;
}
```

- [ ] **Step 2: Implement fixture insertion with the final runner signature**

In `scripts/local-testdata-fixture.mjs`, change the runner call from:

```javascript
await adapter.insertFixtureRows(rows);
```

to:

```javascript
await adapter.insertFixtureRows({
  rows,
  usersByKey,
  staffUsers: STAFF_USERS,
  streamerUsers: STREAMER_USERS,
});
```

Update the fake test expectation in `scripts/local-testdata-runner.test.mjs` so the fake adapter receives an object:

```javascript
async insertFixtureRows({ rows }) {
  calls.push(["insertFixtureRows", rows.organization.code]);
},
```

Add `insertFixtureRows` inside `createSupabaseAdapter`:

```javascript
async function insertFixtureRows(
  client,
  { rows, usersByKey, staffUsers, streamerUsers },
) {
  await upsertRows("billing_plans", [rows.billingPlan], "code");
  const { data: plan, error: planError } = await client
    .from("billing_plans")
    .select("id")
    .eq("code", rows.billingPlan.code)
    .single();
  if (planError) {
    throw planError;
  }

  await upsertRows("organizations", [rows.organization], "code");

  const profiles = [...staffUsers, ...streamerUsers].map((user) => ({
    id: usersByKey[user.key],
    email: user.email,
    full_name: user.fullName,
    login_account: user.email,
    requires_onboarding: false,
  }));
  await upsertRows("profiles", profiles, "id");

  const members = staffUsers.map((user) => ({
    organization_id: rows.organization.id,
    user_id: usersByKey[user.key],
    role: user.role,
    status: "active",
  }));
  const streamerMembers = streamerUsers.map((user) => ({
    organization_id: rows.organization.id,
    user_id: usersByKey[user.key],
    role: "streamer",
    status: "active",
  }));
  await upsertRows(
    "organization_members",
    [...members, ...streamerMembers],
    "organization_id,user_id",
  );

  await upsertRows(
    "organization_subscriptions",
    [
      {
        organization_id: rows.organization.id,
        plan_id: plan.id,
        status: "active",
        billing_cycle: "monthly",
        current_period_start: DATASET.periodStart,
        current_period_end: DATASET.periodEnd,
      },
    ],
    "organization_id",
  );

  await upsertRows("suppliers", [rows.supplier], "organization_id,name");
  await upsertRows("projects", rows.projects, "organization_id,code");
  await upsertRows("streamers", rows.streamers, "id");
  await upsertRows("live_tasks", rows.liveTasks, "id");
  await upsertRows("live_reports", rows.liveReports, "id");
  await upsertRows(
    "usage_events",
    rows.usageEvents,
    "organization_id,metric,period_month,source",
  );
  await insertRows("audit_logs", rows.auditLogs);
}
```

Add these helper functions inside `createSupabaseAdapter`:

```javascript
async function upsertRows(table, rows, onConflict) {
  if (!rows.length) {
    return;
  }
  const { error } = await client.from(table).upsert(rows, { onConflict });
  if (error) {
    throw error;
  }
}

async function insertRows(table, rows) {
  if (!rows.length) {
    return;
  }
  const { error } = await client.from(table).insert(rows);
  if (error) {
    throw error;
  }
}
```

- [ ] **Step 3: Run unit tests**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs
```

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/local-testdata-fixture.mjs scripts/local-testdata-runner.test.mjs scripts/local-testdata.mjs
git commit -m "feat: load local miracle legend testdata"
```

---

### Task 8: Verification Adapter

**Files:**

- Modify: `scripts/local-testdata.mjs`

- [ ] **Step 1: Implement loaded and empty summaries**

Add `summarizeLoadedDataset` and `summarizeEmptyDataset` inside `createSupabaseAdapter`:

```javascript
async function summarizeLoadedDataset(client) {
  const organization = await findDatasetOrganization(client);
  if (!organization) {
    return {
      organizations: 0,
      projects: 0,
      streamers: 0,
      liveTasks: 0,
      liveReports: 0,
      usageMetrics: [],
      auditModules: [],
    };
  }

  const [projects, streamers, liveTasks, liveReports, usageEvents, auditLogs] =
    await Promise.all([
      countRows("projects", "organization_id", organization.id),
      countRows("streamers", "organization_id", organization.id),
      countRows("live_tasks", "organization_id", organization.id),
      countRows("live_reports", "organization_id", organization.id),
      selectRows("usage_events", "metric", "organization_id", organization.id),
      selectRows("audit_logs", "module", "organization_id", organization.id),
    ]);

  return {
    organizations: 1,
    projects,
    streamers,
    liveTasks,
    liveReports,
    usageMetrics: uniqueValues(usageEvents, "metric"),
    auditModules: uniqueValues(auditLogs, "module"),
  };
}

async function summarizeEmptyDataset(client) {
  const organization = await findDatasetOrganization(client);
  const users = await listAllAuthUsers();
  return {
    organizations: organization ? 1 : 0,
    projects: organization
      ? await countRows("projects", "organization_id", organization.id)
      : 0,
    streamers: organization
      ? await countRows("streamers", "organization_id", organization.id)
      : 0,
    authUsers: users.filter((user) => isDatasetEmail(user.email)).length,
  };
}
```

Add these helper functions inside `createSupabaseAdapter`:

```javascript
async function countRows(table, column, value) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

async function selectRows(table, columns, column, value) {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq(column, value);
  if (error) {
    throw error;
  }
  return data ?? [];
}

function uniqueValues(rows, key) {
  return Array.from(
    new Set(rows.map((row) => row[key]).filter(Boolean)),
  ).sort();
}
```

- [ ] **Step 2: Run unit tests**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs
```

Expected: pass.

- [ ] **Step 3: Run local integration when Supabase is available**

Run:

```bash
pnpm supabase:migrate
pnpm testdata:load
pnpm testdata:verify
pnpm testdata:clear
pnpm testdata:verify -- --expect-empty
```

Expected:

- `testdata:load` prints counts with 2 projects, 3 streamers, 4 live tasks, and 2 live reports.
- `testdata:verify` succeeds after load.
- `testdata:clear` succeeds.
- `testdata:verify -- --expect-empty` succeeds after clear.

If Supabase or Docker is unavailable, record the exact command and failure message in the final implementation summary.

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/local-testdata.mjs
git commit -m "feat: verify local miracle legend testdata"
```

---

### Task 9: Final Regression Gates

**Files:**

- Modify only files changed by previous tasks if a gate exposes a defect.

- [ ] **Step 1: Run the focused automated tests**

Run:

```bash
pnpm vitest run scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs lib/db/schema-contract.test.ts features/regression/no-demo-data.test.ts
```

Expected: pass.

- [ ] **Step 2: Run broader project checks**

Run:

```bash
pnpm lint
pnpm type-check
pnpm test
```

Expected: pass.

- [ ] **Step 3: Run build if the prior gates pass**

Run:

```bash
pnpm build
```

Expected: pass.

- [ ] **Step 4: Commit any verification-only fixes**

If fixes were needed, run:

```bash
git add scripts/local-testdata-fixture.mjs scripts/local-testdata.mjs scripts/local-testdata-fixture.test.mjs scripts/local-testdata-runner.test.mjs lib/db/schema-contract.test.ts package.json supabase/migrations/20260604230000_local_testdata_audit_cleanup.sql
git commit -m "fix: stabilize local testdata gates"
```

If no fixes were needed, do not create an empty commit.

---

## Self Review

- Spec coverage: load, verify, clear, local safety, Miracle-like and Legend-like projects, streamer rows, instrumentation, cleanup scoping, and empty seed constraints are covered by Tasks 1 through 9.
- Append-only audit logs: Task 2 handles this with a service-role-only RPC before relational cleanup.
- Production seed guard: Task 9 explicitly runs `features/regression/no-demo-data.test.ts` and does not weaken the guard.
- Type consistency: runner methods are introduced in Task 4, implemented in Tasks 6 through 8, and called by the CLI shell from Task 5.
