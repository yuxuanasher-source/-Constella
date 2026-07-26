# Platform Organization, User, and Subscription Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separately authorized `/platform-admin` console that lets a platform super administrator analyze and manage every organization, its primary and child accounts, subscriptions, orders, standard costs, expiry risk, and audited high-risk operations.

**Architecture:** Add service-role-only platform administration tables and RPCs without weakening tenant RLS. A server-only platform-admin auth guard fronts focused read and mutation services under `features/platform-admin`; Next.js route handlers expose stable DTOs, and an independent App Router shell renders the approved organization-list-plus-fixed-detail workspace and supporting pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres RLS and RPCs, Zod, Tailwind CSS, lucide-react, Vitest, React Testing Library.

---

## Scope and delivery slices

The approved specification spans one tightly coupled platform-admin product surface. It will be delivered in four vertical slices that remain usable and testable after each slice:

1. platform identity, schema, and read-only organization console;
2. metrics, secondary directories, and cost coverage;
3. governed organization, account, subscription, price, cost, and payment mutations;
4. visual hardening, accessibility, regression verification, and branch packaging.

The implementation must not add platform administrators to `lib/rbac/roles.ts`, weaken existing tenant RLS, or route platform-to-streamer payments through subscription billing.

### Task 1: Add the platform-admin database foundation

**Files:**

- Create: `supabase/migrations/20260725120000_platform_admin_console.sql`
- Create: `lib/db/platform-admin-schema-contract.test.ts`
- Modify: `supabase/migrations/20260620110000_funnel_onboarding.sql` only if the new migration cannot safely replace the RPC; prefer replacing it in the new migration.

- [ ] **Step 1: Write the failing schema contract test**

Create a test that reads the new migration and requires the four new tables, organization lifecycle column, indexes, RLS enablement, self-serve primary-account insert, and atomic platform organization RPC:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260725120000_platform_admin_console.sql",
  ),
  "utf8",
);

describe("platform admin schema", () => {
  it.each([
    "platform_admins",
    "organization_primary_accounts",
    "billing_plan_cost_versions",
    "platform_admin_operation_logs",
  ])("creates %s", (table) => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}`, "i"));
    expect(sql).toMatch(
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
  });

  it("adds lifecycle state and primary-account provisioning", () => {
    expect(sql).toMatch(
      /add column lifecycle_status text not null default 'active'/i,
    );
    expect(sql).toMatch(/insert into public\.organization_primary_accounts/i);
    expect(sql).toMatch(
      /create or replace function public\.provision_self_serve_org/i,
    );
  });

  it("adds an atomic service-role organization creation function", () => {
    expect(sql).toMatch(
      /create or replace function public\.platform_create_organization/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.platform_create_organization/i,
    );
  });
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```powershell
pnpm vitest run lib/db/platform-admin-schema-contract.test.ts
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Write the migration**

The migration must:

```sql
alter table public.organizations
  add column lifecycle_status text not null default 'active'
  check (lifecycle_status in ('active', 'frozen', 'archived'));

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'super_admin' check (role = 'super_admin'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_primary_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  assignment_source text not null
    check (assignment_source in ('signup', 'backfill', 'manual_confirmation')),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.billing_plan_cost_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  effective_from timestamptz not null,
  effective_to timestamptz,
  fixed_cost_cents integer not null default 0 check (fixed_cost_cents >= 0),
  per_seat_cost_cents integer not null default 0 check (per_seat_cost_cents >= 0),
  per_active_streamer_cost_cents integer not null default 0
    check (per_active_streamer_cost_cents >= 0),
  metric_unit_costs jsonb not null default '{}'::jsonb,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create table public.platform_admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id text,
  target_organization_id uuid references public.organizations(id),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  reason text,
  is_high_risk boolean not null default false,
  result text not null default 'success' check (result in ('success', 'failure')),
  error_message text,
  trace_id text not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);
```

Also add:

- `create extension if not exists btree_gist with schema extensions` plus an exclusion constraint on `plan_id` and `tstzrange(effective_from, coalesce(effective_to, 'infinity'), '[)')` so cost ranges cannot overlap;
- indexes on organization lifecycle, subscription expiry, paid order time, cost-version effective range, and operation-log organization/time;
- `touch_updated_at` trigger for `platform_admins`;
- RLS enabled on all four tables with no authenticated policies;
- a backfill that inserts a confirmed primary account only for organizations with exactly one owner candidate, leaving ambiguous organizations unassigned;
- a replacement `provision_self_serve_org` that inserts the signup user into `organization_primary_accounts`;
- a service-role-only security-definer RPC with this stable boundary:

```sql
public.platform_create_organization(
  p_actor_user_id uuid,
  p_name text,
  p_code text,
  p_primary_user_id uuid,
  p_primary_email text,
  p_primary_name text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_period_start date,
  p_period_end date,
  p_offline_payment jsonb,
  p_reason text,
  p_trace_id text,
  p_idempotency_key text
) returns jsonb
```

The RPC inserts the organization, profile, owner membership, primary account, subscription, optional offline paid order and succeeded transaction, and platform operation log in one database transaction. It first returns the existing logged result when the actor and idempotency key already match the same request, and raises an idempotency conflict for a different request.

- [ ] **Step 4: Run the schema test and repository database contracts**

Run:

```powershell
pnpm vitest run lib/db/platform-admin-schema-contract.test.ts lib/db/default-billing-subscription-contract.test.ts lib/db/billing-plan-prices-fix-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the database foundation**

```powershell
git add -- supabase/migrations/20260725120000_platform_admin_console.sql lib/db/platform-admin-schema-contract.test.ts
git commit -m "feat(platform-admin): add administration schema"
```

### Task 2: Implement platform-admin identity and page guards

**Files:**

- Create: `features/platform-admin/platform-admin-auth.ts`
- Create: `features/platform-admin/platform-admin-auth.test.ts`
- Create: `app/(platform-admin)/platform-admin/platform-admin-auth.ts`
- Create: `app/(platform-admin)/platform-admin/layout.tsx`
- Create: `app/(platform-admin)/platform-admin/layout.test.tsx`
- Modify: `middleware.ts`
- Modify: `middleware.test.ts`

- [ ] **Step 1: Write failing auth-context tests**

Test the wished-for API:

```ts
const context = await resolvePlatformAdminContext({
  sessionClient,
  adminClient,
  now: new Date("2026-07-25T08:00:00.000Z"),
});

expect(context).toEqual({
  userId: "admin-user",
  email: "admin@example.com",
  name: "平台管理员",
  role: "super_admin",
});
expect(adminClient.from).toHaveBeenCalledWith("platform_admins");
```

Add cases for unauthenticated user, missing admin row, and `suspended` status. The session client must only establish the real user; the service-role client performs the platform-admin and profile lookup.

- [ ] **Step 2: Run the auth test and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-auth.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the server-only auth contract**

Export:

```ts
export type PlatformAdminContext = {
  userId: string;
  email: string;
  name: string;
  role: "super_admin";
};

export async function resolvePlatformAdminContext(input: {
  sessionClient: SupabaseClient | null;
  adminClient: SupabaseClient | null;
  now?: Date;
}): Promise<PlatformAdminContext | null>;

export async function getPlatformAdminContext(): Promise<PlatformAdminContext | null>;
```

`getPlatformAdminContext` creates the request session client and admin client, calls the resolver, and updates `last_access_at` after successful authorization. Do not import `AppRole`.

- [ ] **Step 4: Write and run failing layout and middleware tests**

The layout test must prove:

- unauthenticated users redirect to `/platform-admin/login`;
- authenticated non-admin users redirect to `/`;
- active super admin renders children.

The middleware test must prove `/platform-admin/login` is public while `/platform-admin`, `/platform-admin/organizations`, and platform-admin APIs require an authenticated Supabase session.

Run:

```powershell
pnpm vitest run 'app/(platform-admin)/platform-admin/layout.test.tsx' middleware.test.ts
```

Expected: FAIL before the layout and middleware prefix are implemented.

- [ ] **Step 5: Implement the page guard and middleware protection**

`requirePlatformAdminPage` must:

```ts
export async function requirePlatformAdminPage() {
  const sessionClient = await createSupabaseServerClient();
  if (!sessionClient) redirect("/platform-admin/login?error=config");

  const user = await getAuthenticatedUser(sessionClient);
  if (!user) redirect("/platform-admin/login");

  const context = await getPlatformAdminContext();
  if (!context) redirect("/");

  return context;
}
```

The layout sets `dynamic = "force-dynamic"` and calls the guard before rendering children.

- [ ] **Step 6: Run auth, layout, and middleware tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-auth.test.ts 'app/(platform-admin)/platform-admin/layout.test.tsx' middleware.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit platform identity**

```powershell
git add -- features/platform-admin/platform-admin-auth.ts features/platform-admin/platform-admin-auth.test.ts 'app/(platform-admin)/platform-admin/platform-admin-auth.ts' 'app/(platform-admin)/platform-admin/layout.tsx' 'app/(platform-admin)/platform-admin/layout.test.tsx' middleware.ts middleware.test.ts
git commit -m "feat(platform-admin): guard the administration surface"
```

### Task 3: Add the dedicated platform-admin login and grant command

**Files:**

- Create: `app/(platform-admin-auth)/platform-admin/login/actions.ts`
- Create: `app/(platform-admin-auth)/platform-admin/login/actions.test.ts`
- Create: `app/(platform-admin-auth)/platform-admin/login/page.tsx`
- Create: `app/(platform-admin-auth)/platform-admin/login/page.test.tsx`
- Create: `features/platform-admin/grant-platform-admin.ts`
- Create: `features/platform-admin/grant-platform-admin.test.ts`
- Create: `scripts/grant-platform-admin.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing login-action tests**

Test password sign-in followed by platform-admin authorization:

```ts
await expect(
  platformAdminSignInAction(
    formData({ email: "admin@example.com", password: "secret123" }),
  ),
).rejects.toThrow("NEXT_REDIRECT:/platform-admin/organizations");
```

Also verify bad credentials redirect to `/platform-admin/login?error=auth` and authenticated non-admin users are signed out before redirecting to `?error=forbidden`.

- [ ] **Step 2: Run the login test and verify RED**

```powershell
pnpm vitest run 'app/(platform-admin-auth)/platform-admin/login/actions.test.ts'
```

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Implement login and its restrained standalone page**

The action uses `createSupabaseServerClient().auth.signInWithPassword`, then `getPlatformAdminContext`, and redirects only to `/platform-admin/organizations`.

The page contains:

- “平台管理后台” heading;
- email and password fields;
- an explicit statement that institution accounts cannot enter;
- errors for `config`, `auth`, and `forbidden`;
- no MCN signup, social login, or role chooser.

- [ ] **Step 4: Write failing grant-service tests**

Test:

```ts
await grantPlatformAdmin({
  client,
  email: "admin@example.com",
});

expect(client.from).toHaveBeenCalledWith("platform_admins");
expect(upsert).toHaveBeenCalledWith({
  user_id: "profile-1",
  role: "super_admin",
  status: "active",
});
```

Reject missing profiles and ambiguous email matches.

- [ ] **Step 5: Implement grant service and CLI wrapper**

Add:

```json
"platform-admin:grant": "node scripts/grant-platform-admin.mjs"
```

The CLI accepts exactly one email argument, loads the same Supabase environment variables as the app, calls the tested grant service, and prints only the granted email and profile ID. It must never print service-role credentials.

- [ ] **Step 6: Run login and grant tests**

```powershell
pnpm vitest run 'app/(platform-admin-auth)/platform-admin/login/actions.test.ts' 'app/(platform-admin-auth)/platform-admin/login/page.test.tsx' features/platform-admin/grant-platform-admin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit login and grant tooling**

```powershell
git add -- 'app/(platform-admin-auth)/platform-admin/login' features/platform-admin/grant-platform-admin.ts features/platform-admin/grant-platform-admin.test.ts scripts/grant-platform-admin.mjs package.json
git commit -m "feat(platform-admin): add login and bootstrap grant"
```

### Task 4: Define DTOs and deterministic metric calculations

**Files:**

- Create: `features/platform-admin/platform-admin-contracts.ts`
- Create: `features/platform-admin/platform-admin-metrics.ts`
- Create: `features/platform-admin/platform-admin-metrics.test.ts`

- [ ] **Step 1: Write failing metric tests**

Cover:

```ts
expect(
  calculatePlatformMetrics({
    organizations: [
      { id: "a", lifecycleStatus: "active" },
      { id: "b", lifecycleStatus: "frozen" },
      { id: "c", lifecycleStatus: "archived" },
    ],
    transactions: [
      {
        organizationId: "a",
        type: "payment",
        status: "succeeded",
        amountCents: 12000,
      },
      {
        organizationId: "a",
        type: "refund",
        status: "succeeded",
        amountCents: 2000,
      },
    ],
    organizationCosts: [
      { organizationId: "a", costCents: 4000, complete: true },
    ],
  }),
).toMatchObject({
  organizationCount: 2,
  payingOrganizationCount: 1,
  netRevenueCents: 10000,
  arpCents: 5000,
  computableContributionMarginCents: 6000,
  costCoverage: { covered: 1, total: 2 },
});
```

Add cases for zero denominator, incomplete cost models, failed/pending transactions, multiple orders from one organization, and expiry buckets at `-1`, `0`, `7`, `8`, and `30` days.

- [ ] **Step 2: Run the metric test and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-metrics.test.ts
```

Expected: FAIL because the metric module does not exist.

- [ ] **Step 3: Implement contracts and pure calculations**

Contracts include:

```ts
export type PlatformOverviewDto = {
  period: { start: string; end: string };
  organizationCount: number;
  payingOrganizationCount: number;
  successfulOrderCount: number;
  netRevenueCents: number;
  forecastRevenueCents: number;
  arpCents: number | null;
  computableContributionMarginCents: number;
  costCoverage: { covered: number; total: number };
  expiry: { expired: number; within7Days: number; within30Days: number };
};
```

Use integer cents and UTC date keys. Do not coerce missing costs to zero.

- [ ] **Step 4: Run metric tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-metrics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit metric contracts**

```powershell
git add -- features/platform-admin/platform-admin-contracts.ts features/platform-admin/platform-admin-metrics.ts features/platform-admin/platform-admin-metrics.test.ts
git commit -m "feat(platform-admin): define administration metrics"
```

### Task 5: Build the cross-organization repository and read service

**Files:**

- Create: `features/platform-admin/platform-admin-repository.ts`
- Create: `features/platform-admin/platform-admin-repository-supabase.ts`
- Create: `features/platform-admin/platform-admin-read-service.ts`
- Create: `features/platform-admin/platform-admin-read-service.test.ts`

- [ ] **Step 1: Write failing read-service tests**

Use a fake repository implementing:

```ts
export type PlatformAdminRepository = {
  listOrganizations(
    query: OrganizationListQuery,
  ): Promise<OrganizationPageSource>;
  getOrganizationDetail(
    id: string,
    period: ReportingPeriod,
  ): Promise<OrganizationDetailSource | null>;
  listUsers(query: UserListQuery): Promise<UserPageSource>;
  listPlans(period: ReportingPeriod): Promise<PlanPerformanceSource[]>;
  listOrders(query: OrderListQuery): Promise<OrderPageSource>;
  listAudit(query: AuditListQuery): Promise<AuditPageSource>;
  loadOverviewSource(period: ReportingPeriod): Promise<PlatformOverviewSource>;
};
```

Test search normalization, server page-size cap of 100, cost coverage, primary-account pending status, organization detail 404, and stable sorting by expiry date then organization name.

- [ ] **Step 2: Run the service test and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-read-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement read service**

Export:

```ts
export async function loadPlatformOverview(input: {
  repo: PlatformAdminRepository;
  period: ReportingPeriod;
}): Promise<PlatformOverviewDto>;

export async function listPlatformOrganizations(input: {
  repo: PlatformAdminRepository;
  query: OrganizationListQuery;
}): Promise<OrganizationPageDto>;

export async function getPlatformOrganizationDetail(input: {
  repo: PlatformAdminRepository;
  organizationId: string;
  period: ReportingPeriod;
}): Promise<OrganizationDetailDto>;
```

Throw `PlatformAdminNotFoundError` for missing organizations and preserve explicit `null` for unavailable metrics.

- [ ] **Step 4: Implement Supabase repository**

The repository accepts only an admin client and explicitly selects safe columns from:

- organizations and primary accounts;
- profiles and organization members;
- subscriptions, plans, active plan prices, addons, orders, transactions;
- monthly usage counters and cost versions;
- platform operation logs.

Queries must page on the server, filter by explicit organization IDs, and avoid returning provider payloads or auth metadata.

- [ ] **Step 5: Run read-service and focused billing tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-read-service.test.ts features/billing/billing-status.test.ts features/billing/pricing.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the read layer**

```powershell
git add -- features/platform-admin/platform-admin-repository.ts features/platform-admin/platform-admin-repository-supabase.ts features/platform-admin/platform-admin-read-service.ts features/platform-admin/platform-admin-read-service.test.ts
git commit -m "feat(platform-admin): add cross-organization read models"
```

### Task 6: Expose guarded read APIs

**Files:**

- Create: `app/api/platform-admin/route-context.ts`
- Create: `app/api/platform-admin/overview/route.ts`
- Create: `app/api/platform-admin/overview/route.test.ts`
- Create: `app/api/platform-admin/organizations/route.ts`
- Create: `app/api/platform-admin/organizations/route.test.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/route.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/route.test.ts`
- Create: `app/api/platform-admin/users/route.ts`
- Create: `app/api/platform-admin/plans/route.ts`
- Create: `app/api/platform-admin/orders/route.ts`
- Create: `app/api/platform-admin/audit/route.ts`
- Create: `app/api/platform-admin/read-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Each route test proves:

- 401 without a session;
- 403 for an authenticated non-admin;
- 503 without the admin client;
- 400 for invalid page, period, or filter;
- 200 with the exact DTO from the read service;
- organization detail returns 404 for `PlatformAdminNotFoundError`.

- [ ] **Step 2: Run route tests and verify RED**

```powershell
pnpm vitest run app/api/platform-admin
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement a shared route context**

```ts
export async function getPlatformAdminRouteContext() {
  const sessionClient = await createSupabaseServerClient();
  if (!sessionClient) return { ok: false as const, status: 401 };

  const user = await getAuthenticatedUser(sessionClient);
  if (!user) return { ok: false as const, status: 401 };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, status: 503 };

  const actor = await resolvePlatformAdminContext({
    sessionClient,
    adminClient: admin,
  });
  if (!actor) return { ok: false as const, status: 403 };

  return {
    ok: true as const,
    actor,
    admin,
    repo: new SupabasePlatformAdminRepository(admin),
  };
}
```

- [ ] **Step 4: Implement read routes with Zod query parsing**

Use maximum page size 100 and default current natural month. Return `{ data, meta }` for paged collections and `{ data }` for single resources.

- [ ] **Step 5: Run platform-admin route tests**

```powershell
pnpm vitest run app/api/platform-admin
```

Expected: PASS.

- [ ] **Step 6: Commit read APIs**

```powershell
git add -- app/api/platform-admin
git commit -m "feat(platform-admin): expose guarded read APIs"
```

### Task 7: Build the independent shell and organization workspace

**Files:**

- Create: `components/platform-admin/platform-admin-shell.tsx`
- Create: `components/platform-admin/platform-admin-shell.test.tsx`
- Create: `components/platform-admin/organization-workspace.tsx`
- Create: `components/platform-admin/organization-workspace.test.tsx`
- Create: `components/platform-admin/platform-admin-format.ts`
- Create: `app/(platform-admin)/platform-admin/page.tsx`
- Create: `app/(platform-admin)/platform-admin/organizations/page.tsx`
- Create: `app/(platform-admin)/platform-admin/organizations/page.test.tsx`

- [ ] **Step 1: Run impeccable setup before frontend edits**

From the isolated worktree:

```powershell
node .agents/skills/impeccable/scripts/context.mjs --target 'app/(platform-admin)/platform-admin'
```

Read `PRODUCT.md`, one existing UI component, and `.agents/skills/impeccable/reference/product.md`. Preserve committed tokens in `app/globals.css`; do not generate a new palette.

- [ ] **Step 2: Write failing shell and workspace tests**

The shell test expects nav labels:

```ts
for (const label of [
  "经营总览",
  "组织",
  "全部用户",
  "套餐",
  "订单与付款",
  "成本模型",
  "操作审计",
]) {
  expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
}
```

The workspace test proves:

- organizations render in the left list;
- selecting a row updates the fixed detail pane;
- the primary account is distinguished from child accounts;
- “实收”“预测”“标准估算” labels remain visible;
- missing cost displays “成本未配置” instead of `¥0`;
- narrow layout exposes an organization selector.

- [ ] **Step 3: Run UI tests and verify RED**

```powershell
pnpm vitest run components/platform-admin/platform-admin-shell.test.tsx components/platform-admin/organization-workspace.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement shell and approved B layout**

`PlatformAdminShell` uses existing `Button`, `Badge`, CSS variables, and lucide icons. It must visually identify itself as “平台管理后台” and must not reuse the tenant organization switcher.

`OrganizationWorkspace` is a client component with:

- debounced server search;
- lifecycle, plan, subscription, and expiry filters;
- paged left list;
- fixed detail tabs: 概览、用户、套餐、订单、操作记录;
- compact top metric band;
- action menu slots added in later tasks.

Use flat panels with borders or compact shadows, maximum 14px panel radius, visible focus, and `aria-live` for refresh errors.

- [ ] **Step 5: Implement server page loading**

`/platform-admin` redirects to `/platform-admin/organizations`. The organizations page requires platform auth, creates an admin repository, loads overview + first organization page + first detail in parallel, and renders the shell and workspace.

- [ ] **Step 6: Run UI and page tests**

```powershell
pnpm vitest run components/platform-admin/platform-admin-shell.test.tsx components/platform-admin/organization-workspace.test.tsx 'app/(platform-admin)/platform-admin/organizations/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 7: Commit the organization console**

```powershell
git add -- components/platform-admin 'app/(platform-admin)/platform-admin'
git commit -m "feat(platform-admin): add organization control workspace"
```

### Task 8: Add overview, user, plan, order, cost, and audit pages

**Files:**

- Create: `components/platform-admin/overview-dashboard.tsx`
- Create: `components/platform-admin/user-directory.tsx`
- Create: `components/platform-admin/plan-directory.tsx`
- Create: `components/platform-admin/order-directory.tsx`
- Create: `components/platform-admin/cost-model-directory.tsx`
- Create: `components/platform-admin/audit-directory.tsx`
- Create: `components/platform-admin/platform-admin-directories.test.tsx`
- Create: `app/(platform-admin)/platform-admin/overview/page.tsx`
- Create: `app/(platform-admin)/platform-admin/users/page.tsx`
- Create: `app/(platform-admin)/platform-admin/plans/page.tsx`
- Create: `app/(platform-admin)/platform-admin/orders/page.tsx`
- Create: `app/(platform-admin)/platform-admin/cost-models/page.tsx`
- Create: `app/(platform-admin)/platform-admin/audit/page.tsx`

- [ ] **Step 1: Write failing directory tests**

Test real user-visible behavior:

- overview shows net revenue, forecast revenue, ARP, expiry queue, and cost coverage;
- user directory searches across organization, primary-account status, role, and account status;
- plan directory distinguishes price from standard cost;
- orders distinguish paid, refunding, and refunded transactions;
- audit shows reason, actor, target, before/after summary, trace ID, and result.

- [ ] **Step 2: Run directory tests and verify RED**

```powershell
pnpm vitest run components/platform-admin/platform-admin-directories.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement directories and server pages**

Each directory uses the shared shell, server pagination, semantic tables, empty states, and explicit status text. Charts may use CSS/SVG only for trends already backed by real period data; do not fabricate sparklines.

- [ ] **Step 4: Run directory tests**

```powershell
pnpm vitest run components/platform-admin/platform-admin-directories.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit secondary administration pages**

```powershell
git add -- components/platform-admin 'app/(platform-admin)/platform-admin'
git commit -m "feat(platform-admin): add administration directories"
```

### Task 9: Add mutation audit, validation, concurrency, and idempotency core

**Files:**

- Create: `features/platform-admin/platform-admin-errors.ts`
- Create: `features/platform-admin/platform-admin-operation-log.ts`
- Create: `features/platform-admin/platform-admin-operation-log.test.ts`
- Create: `features/platform-admin/platform-admin-mutations.ts`
- Create: `features/platform-admin/platform-admin-mutations.test.ts`

- [ ] **Step 1: Write failing operation-core tests**

Cover:

- high-risk operations reject blank reasons;
- repeated actor + idempotency key returns the prior success result;
- the same key with a different request hash throws `PlatformAdminConflictError`;
- stale `updatedAt` throws conflict before writing;
- failures write a failure operation log with trace ID but no secret payloads.

- [ ] **Step 2: Run mutation-core tests and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-operation-log.test.ts features/platform-admin/platform-admin-mutations.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the mutation envelope**

```ts
export async function executePlatformAdminOperation<T>(input: {
  actor: PlatformAdminContext;
  action: string;
  target: { type: string; id?: string; organizationId?: string };
  reason: string;
  highRisk: boolean;
  idempotencyKey?: string;
  request: Record<string, unknown>;
  loadBefore?: () => Promise<Record<string, unknown>>;
  execute: () => Promise<T>;
  summarizeAfter: (result: T) => Record<string, unknown>;
  log: PlatformAdminOperationLog;
}): Promise<T>;
```

Hash a canonical JSON request with SHA-256. Redact passwords, provider payloads, service keys, and raw tokens before logging.

- [ ] **Step 4: Run operation-core tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-operation-log.test.ts features/platform-admin/platform-admin-mutations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit mutation governance**

```powershell
git add -- features/platform-admin/platform-admin-errors.ts features/platform-admin/platform-admin-operation-log.ts features/platform-admin/platform-admin-operation-log.test.ts features/platform-admin/platform-admin-mutations.ts features/platform-admin/platform-admin-mutations.test.ts
git commit -m "feat(platform-admin): govern administration mutations"
```

### Task 10: Implement organization and account mutations

**Files:**

- Create: `features/platform-admin/platform-admin-organization-service.ts`
- Create: `features/platform-admin/platform-admin-organization-service.test.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/members/route.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/members/route.test.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/members/[memberId]/route.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/members/[memberId]/route.test.ts`
- Modify: `app/api/platform-admin/organizations/route.ts`
- Modify: `app/api/platform-admin/organizations/route.test.ts`
- Modify: `app/api/platform-admin/organizations/[organizationId]/route.ts`
- Modify: `app/api/platform-admin/organizations/[organizationId]/route.test.ts`
- Modify: `app/(auth)/login/actions.ts`
- Create: `app/(auth)/login/registration-primary-account.test.ts`

- [ ] **Step 1: Write failing organization-service tests**

Test:

- create organization creates auth user then calls the atomic RPC;
- RPC failure deletes the newly created auth user;
- the creator is the only primary account even when another owner is added;
- freeze and restore require reason and optimistic `updatedAt`;
- creating invited and generated subaccounts applies the same email, password, profile, role, and membership rules as institution member creation without inventing an institution actor role;
- changing a child account role, suspending/restoring it, and sending a password-reset link are audited platform operations;
- primary-account role and status changes are rejected when they would leave the organization without an active owner;
- the self-registration path writes `organization_primary_accounts` before it reports success;
- archived organizations reject new accounts.

- [ ] **Step 2: Run service tests and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-organization-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement organization and account services**

Define:

```ts
export async function createPlatformOrganization(input: {
  repo: PlatformAdminMutationRepository;
  authAdmin: OrganizationAuthAdmin;
  actor: PlatformAdminContext;
  command: CreatePlatformOrganizationCommand;
}): Promise<CreatePlatformOrganizationResult>;

export async function setPlatformOrganizationLifecycle(input: {
  repo: PlatformAdminMutationRepository;
  actor: PlatformAdminContext;
  organizationId: string;
  status: "active" | "frozen";
  expectedUpdatedAt: string;
  reason: string;
  idempotencyKey: string;
}): Promise<OrganizationDetailDto>;
```

Extract organization-member input normalization and auth-user provisioning into a role-agnostic helper used by both the existing institution service and the platform service. Authorization remains in the respective wrappers: institution callers use existing `getCreatableOrganizationMemberRoles`; platform callers require `PlatformAdminContext`. Do not pass `role: "owner"` as a fake platform actor.

Do not offer primary-account transfer or hard delete. General organization edits are limited to name and code, require optimistic `updatedAt`, and keep historical references intact.

- [ ] **Step 4: Add guarded POST/PATCH/member routes**

Validate bodies with Zod, require `reason`, `idempotencyKey`, and `expectedUpdatedAt` where applicable, then delegate to the service. The member item route accepts exactly one of `role`, `status`, or `sendPasswordReset`. Return 409 for conflict and 422 for business-rule failures.

- [ ] **Step 5: Run organization service and route tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-organization-service.test.ts app/api/platform-admin/organizations 'app/(auth)/login/registration-primary-account.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit organization operations**

```powershell
git add -- features/platform-admin/platform-admin-organization-service.ts features/platform-admin/platform-admin-organization-service.test.ts app/api/platform-admin/organizations 'app/(auth)/login/actions.ts' 'app/(auth)/login/registration-primary-account.test.ts'
git commit -m "feat(platform-admin): manage organizations and accounts"
```

### Task 11: Implement subscription, price, and cost-version mutations

**Files:**

- Create: `features/platform-admin/platform-admin-billing-service.ts`
- Create: `features/platform-admin/platform-admin-billing-service.test.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/subscription/route.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/subscription/route.test.ts`
- Create: `app/api/platform-admin/plans/[planId]/prices/route.ts`
- Create: `app/api/platform-admin/plans/[planId]/prices/route.test.ts`
- Create: `app/api/platform-admin/plans/[planId]/cost-versions/route.ts`
- Create: `app/api/platform-admin/plans/[planId]/cost-versions/route.test.ts`
- Create: `app/api/platform-admin/plans/[planId]/route.ts`
- Create: `app/api/platform-admin/plans/[planId]/route.test.ts`

- [ ] **Step 1: Write failing billing-service tests**

Cover:

- immediate and next-cycle plan changes;
- renewal and extension from the later of today or current period end;
- cancellation and restoration;
- expiry shortening rejected by the extension command;
- package name, feature map, and included quota edits validate non-negative quantities and preserve the stable plan code;
- new price version closes the previous active version without rewriting old orders;
- cost version overlap rejected;
- missing reason, stale version, and duplicate idempotency key rejected.

- [ ] **Step 2: Run billing-service tests and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-billing-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement billing administration services**

Use existing period helpers and billing plan prices. Keep direct subscription administration separate from payment recognition. Every result includes a preview DTO:

```ts
export type SubscriptionChangePreview = {
  currentPlan: string;
  targetPlan: string;
  effectiveAt: string;
  currentPeriodEnd: string;
  nextPeriodEnd: string;
  currentPriceCents: number;
  targetPriceCents: number;
  includedQuantityChanges: Record<string, { from: number; to: number }>;
};
```

- [ ] **Step 4: Add guarded routes and route tests**

Use `POST` for new price and cost versions, `PATCH` for package metadata and subscription lifecycle. Return the preview before confirmation when `mode: "preview"` and execute only when `mode: "apply"`.

- [ ] **Step 5: Run billing-service and route tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-billing-service.test.ts 'app/api/platform-admin/organizations/[organizationId]/subscription/route.test.ts' 'app/api/platform-admin/plans/[planId]/route.test.ts' 'app/api/platform-admin/plans/[planId]/prices/route.test.ts' 'app/api/platform-admin/plans/[planId]/cost-versions/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit subscription and economics operations**

```powershell
git add -- features/platform-admin/platform-admin-billing-service.ts features/platform-admin/platform-admin-billing-service.test.ts 'app/api/platform-admin/organizations/[organizationId]/subscription' 'app/api/platform-admin/plans/[planId]'
git commit -m "feat(platform-admin): manage plans and cost versions"
```

### Task 12: Implement offline payment and refund operations

**Files:**

- Create: `features/platform-admin/platform-admin-payment-service.ts`
- Create: `features/platform-admin/platform-admin-payment-service.test.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/payments/route.ts`
- Create: `app/api/platform-admin/organizations/[organizationId]/payments/route.test.ts`
- Create: `app/api/platform-admin/orders/[orderId]/refund/route.ts`
- Create: `app/api/platform-admin/orders/[orderId]/refund/route.test.ts`
- Create: `app/api/platform-admin/orders/[orderId]/route.ts`
- Create: `app/api/platform-admin/orders/[orderId]/route.test.ts`
- Modify: `features/billing/refunds.ts`
- Modify: `features/billing/refunds.test.ts`

- [ ] **Step 1: Write failing payment-service tests**

Cover:

- offline payment requires organization, purpose, amount, received date, external reference, channel, reason, and idempotency key;
- duplicate idempotency key returns the original order;
- payment creates a paid order and succeeded transaction, then applies subscription effects once;
- refund requires a paid order, settled payment transaction, refundable amount, and reason;
- successful refund deducts net revenue and settles the existing business rollback once;
- pending orders can be cancelled, while paid orders require refund rather than cancellation;
- refund never touches streamer settlement tables.

- [ ] **Step 2: Run payment tests and verify RED**

```powershell
pnpm vitest run features/platform-admin/platform-admin-payment-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement platform payment services**

Refactor `features/billing/refunds.ts` into:

```ts
export async function requestRefundCore(input: {
  repo: BillingRepo;
  provider: PaymentProvider;
  organizationId: string;
  orderId: string;
  reason: string;
  now?: Date;
}): Promise<RefundResultSummary>;
```

The existing institution `requestRefund` keeps owner authorization and institution audit, then delegates to the core. The platform payment service calls the core only after platform authorization and writes platform audit through `executePlatformAdminOperation`. Reuse `BillingRepo`, `applyPaidOrder`, provider registry, and `settleRefund`; never pass a fake institution role.

- [ ] **Step 4: Add guarded payment/refund routes**

Return:

```ts
{ data: { orderId, transactionId, status, appliedSubscriptionStatus }, traceId }
```

Map conflicts to 409, invalid refundable or cancellation state to 422, and missing provider configuration to 503.

- [ ] **Step 5: Run payment, existing billing, and route tests**

```powershell
pnpm vitest run features/platform-admin/platform-admin-payment-service.test.ts features/billing/apply-paid-order.test.ts features/billing/refunds.test.ts 'app/api/platform-admin/organizations/[organizationId]/payments/route.test.ts' 'app/api/platform-admin/orders/[orderId]/route.test.ts' 'app/api/platform-admin/orders/[orderId]/refund/route.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit payment operations**

```powershell
git add -- features/platform-admin/platform-admin-payment-service.ts features/platform-admin/platform-admin-payment-service.test.ts features/billing/refunds.ts features/billing/refunds.test.ts 'app/api/platform-admin/organizations/[organizationId]/payments' 'app/api/platform-admin/orders/[orderId]'
git commit -m "feat(platform-admin): manage offline payments and refunds"
```

### Task 13: Wire governed actions into the interface

**Files:**

- Create: `components/platform-admin/platform-admin-action-dialog.tsx`
- Create: `components/platform-admin/platform-admin-action-dialog.test.tsx`
- Create: `components/platform-admin/organization-actions.tsx`
- Create: `components/platform-admin/organization-actions.test.tsx`
- Create: `components/platform-admin/plan-actions.tsx`
- Create: `components/platform-admin/payment-actions.tsx`
- Modify: `components/platform-admin/organization-workspace.tsx`
- Modify: `components/platform-admin/plan-directory.tsx`
- Modify: `components/platform-admin/order-directory.tsx`
- Modify: `components/platform-admin/cost-model-directory.tsx`

- [ ] **Step 1: Write failing action-flow tests**

Cover:

- create organization collects organization, primary account, plan, cycle, expiry, and optional first payment;
- create subaccount distinguishes invite and generated-account mode;
- freeze, refund, plan change, expiry change, price change, and cost change require reason;
- preview shows old/new values and impact before apply;
- generated credentials display once and are not written to audit text;
- 409 conflict preserves form values and offers refresh;
- successful action refreshes list, detail, metrics, and audit tabs.

- [ ] **Step 2: Run action UI tests and verify RED**

```powershell
pnpm vitest run components/platform-admin/platform-admin-action-dialog.test.tsx components/platform-admin/organization-actions.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement accessible dialogs and action forms**

Use native `<dialog>` or a portal outside scroll containers. Each dialog:

- traps focus while open;
- closes on Escape unless submitting;
- labels every field;
- displays an `aria-live` result;
- generates one idempotency key per form attempt and reuses it on retry;
- separates preview and apply requests.

- [ ] **Step 4: Wire action refresh behavior**

After success, re-fetch the affected organization detail and overview. Do not perform optimistic money updates before the server confirms the operation.

- [ ] **Step 5: Run platform UI tests**

```powershell
pnpm vitest run components/platform-admin
```

Expected: PASS.

- [ ] **Step 6: Commit governed action UI**

```powershell
git add -- components/platform-admin
git commit -m "feat(platform-admin): wire governed administration actions"
```

### Task 14: Harden the surface and complete verification

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `app/api/api-route-contracts.test.ts`
- Create: `features/regression/platform-admin-golden-path.test.ts`
- Create: `app/api/platform-admin/platform-admin-route-contracts.test.ts`

- [ ] **Step 1: Write failing golden-path and route-contract tests**

The golden path must prove:

1. an active platform admin loads organization metrics;
2. organization creation establishes exactly one primary account;
3. a child owner remains a child account;
4. a cost version enables contribution-margin coverage;
5. offline payment changes net revenue and ARP;
6. refund reverses net revenue once;
7. freeze changes lifecycle without deleting data;
8. every high-risk action has one platform operation log.

The route contract enumerates every `/api/platform-admin` handler and expected verbs.

- [ ] **Step 2: Run golden path and verify RED**

```powershell
pnpm vitest run features/regression/platform-admin-golden-path.test.ts app/api/platform-admin/platform-admin-route-contracts.test.ts
```

Expected: FAIL until all route registrations and regression fixtures are connected.

- [ ] **Step 3: Complete docs and configuration**

Document:

```powershell
pnpm platform-admin:grant -- admin@example.com
```

Explain that the user must already exist in `profiles`, service-role credentials remain server-only, and database migration deployment is required before granting access.

Add no public platform-admin feature flag. Authorization is entirely server-side.

- [ ] **Step 4: Run focused platform verification**

```powershell
pnpm vitest run features/platform-admin app/api/platform-admin components/platform-admin features/regression/platform-admin-golden-path.test.ts lib/db/platform-admin-schema-contract.test.ts middleware.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 5: Run repository verification**

```powershell
git diff --check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit 0. If an unrelated environment-gated test fails, record the exact command, failure, and why it is unrelated; do not hide or relabel it as passing.

- [ ] **Step 6: Perform visual and accessibility verification**

Start the app, then verify at desktop and narrow widths:

- `/platform-admin/login`;
- `/platform-admin/organizations`;
- organization with active paid plan;
- trial expiring in 7 days;
- frozen organization;
- missing primary account;
- missing cost model;
- refund conflict.

Check keyboard navigation, focus visibility, dialog focus return, status text without color dependence, and reduced-motion behavior. Save screenshots under `.qa-screenshots/platform-admin/` without committing them.

- [ ] **Step 7: Run impeccable audit and fix deterministic findings**

```powershell
node .agents/skills/impeccable/scripts/detect.mjs --json components/platform-admin 'app/(platform-admin)'
```

Re-run component tests after every fix.

- [ ] **Step 8: Commit hardening**

```powershell
git add -- .env.example README.md app/api/api-route-contracts.test.ts app/api/platform-admin/platform-admin-route-contracts.test.ts features/regression/platform-admin-golden-path.test.ts
git commit -m "test(platform-admin): harden administration workflows"
```

## Plan self-review checklist

- [x] Every approved specification section maps to at least one task.
- [x] Platform identity never enters institution `AppRole`.
- [x] Tenant RLS remains unchanged; service role stays server-only.
- [x] Primary account remains unique and non-transferable in the first version.
- [x] Revenue and forecast metrics remain separate.
- [x] Missing costs never become zero costs.
- [x] Platform subscription billing never touches streamer settlement.
- [x] Every production behavior starts with a failing test.
- [x] Every task has a focused verification command and commit boundary.
