# Upgrade Hardening Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the current upgrade diff by closing tenant-scoping and streamer-profile update gaps, then restore the repository quality gate to green.

**Architecture:** Keep the existing Next.js route/service/query layering. Add explicit `organizationId` scoping to settlement read queries instead of relying only on RLS, and preserve "field omitted" versus "field intentionally cleared" semantics in streamer profile updates. Avoid broad reference-UI restructuring in this plan; split that into a separate refactor after the hardening work is green.

**Tech Stack:** Next.js App Router, TypeScript, Supabase JS, Vitest, React reference UI, Prettier, ESLint.

---

## File Structure

- Modify `features/settlements/settlement-queries.ts`
  - Add explicit `organizationId` inputs to ops settlement pool and default-scope queries.
  - Apply `.eq("organization_id", organizationId)` to `live_reports`, `settlement_batches`, `project_streamers`, and `settlement_batch_items` lookups used by these flows.
- Modify `app/api/settlement-pool/route.ts`
  - Pass `context.auth.organizationId` into `listOpsSettlementPool`.
  - Keep optional `projectId`, but scope all results to the authenticated organization.
- Modify `app/(ops)/console/projects/page.tsx`
  - Pass `auth.organizationId` into settlement reference-data loading.
- Modify `app/(ops)/console/stubs/[module]/page.tsx`
  - Pass the authenticated organization ID into the same settlement reference-data loading path.
- Modify `app/(ops)/console/projects/page.test.tsx`
  - Assert `organizationId` is passed when hydrating settlement data.
- Create `app/api/settlement-pool/route.test.ts`
  - Assert the route passes `organizationId` to the query even when `projectId` is absent.
- Modify `features/streamers/streamer-service.ts`
  - Preserve clearable fields as `null` or `[]` when explicitly provided.
  - Keep `displayName` non-empty when provided.
- Modify `features/streamers/streamer-repository.ts`
  - Allow nullable patch values for nullable DB columns.
- Modify `app/api/streamers/[streamerId]/route.ts`
  - Parse update bodies with field-presence awareness.
- Modify `features/streamers/streamer-service.test.ts`
  - Cover explicit clearing of nullable/list fields.
- Modify `app/api/streamers/streamers-route.test.ts`
  - Cover route-level normalization for clear requests and non-settlement updates.
- Format only changed files with Prettier.

---

### Task 1: Add Explicit Organization Scoping To Settlement Pool Reads

**Files:**

- Modify: `features/settlements/settlement-queries.ts`
- Modify: `app/api/settlement-pool/route.ts`
- Modify: `app/(ops)/console/projects/page.tsx`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `app/(ops)/console/projects/page.test.tsx`
- Create: `app/api/settlement-pool/route.test.ts`

- [ ] **Step 1: Write the failing projects-page hydration assertion**

In `app/(ops)/console/projects/page.test.tsx`, update the existing "hydrates settlement center data" test expectation from:

```ts
expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
});
```

to:

```ts
expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
  organizationId: "org-1",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
});
```

- [ ] **Step 2: Run the focused page test and verify it fails**

Run:

```powershell
pnpm exec vitest run "app/(ops)/console/projects/page.test.tsx"
```

Expected: FAIL because `listOpsSettlementPool` is still called without `organizationId`.

- [ ] **Step 3: Add a route test for organization scoping without projectId**

Create `app/api/settlement-pool/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listOpsSettlementPool } from "@/features/settlements/settlement-queries";
import { listSettlementPool } from "@/features/settlements/settlement-service";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-service", () => ({
  listSettlementPool: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");
  return {
    ...actual,
    getSettlementRouteContext: vi.fn(),
  };
});

describe("settlement pool route", () => {
  const supabase = {};
  const repo = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase: supabase as never,
      repo: repo as never,
      audit: vi.fn() as never,
      notify: vi.fn() as never,
      auth: {
        userId: "user-owner",
        email: "owner@example.test",
        name: "Owner",
        organizationId: "org-1",
        organizationName: "Org One",
        role: "owner",
      },
    });
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
  });

  it("scopes organization-wide pool reads to the authenticated organization", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/settlement-pool?periodStart=2026-06-01&periodEnd=2026-06-30",
      ),
    );

    expect(response.status).toBe(200);
    expect(listSettlementPool).not.toHaveBeenCalled();
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: null,
      batchType: "payable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
  });
});
```

- [ ] **Step 4: Run the new route test and verify it fails**

Run:

```powershell
pnpm exec vitest run "app/api/settlement-pool/route.test.ts"
```

Expected: FAIL because `listOpsSettlementPool` is still called without `organizationId`.

- [ ] **Step 5: Update settlement query signatures and filters**

In `features/settlements/settlement-queries.ts`, update the public query inputs:

```ts
export async function listOpsSettlementPool(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string | null;
    batchType?: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  },
): Promise<OpsSettlementPoolItem[]> {
  let query = client
    .from("live_reports")
    .select(
      "id, project_id, streamer_id, created_at, settlement_duration, time_source, evidence_level, projects(name), streamers(display_name)",
    )
    .eq("organization_id", input.organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .gte("created_at", `${input.periodStart}T00:00:00.000Z`)
    .lte("created_at", `${input.periodEnd}T23:59:59.999Z`)
    .order("created_at", { ascending: true });
```

Update the rule lookup call:

```ts
      ? await listProjectStreamerRules(
          client,
          input.organizationId,
          projectIds,
          streamerIds,
        )
      : [];
```

Update `getOpsSettlementDefaultScope`:

```ts
export async function getOpsSettlementDefaultScope(
  client: SupabaseClient,
  organizationId: string,
): Promise<OpsSettlementDefaultScope | null> {
  const { data: poolRows, error } = await client
    .from("live_reports")
    .select("project_id, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .eq("enter_settlement_pool", true)
    .is("settled_batch_item_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<SettlementScopeSeedRow[]>();
```

Update the fallback `settlement_batches` query:

```ts
      .from("settlement_batches")
      .select("project_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
```

Update the pool count call:

```ts
const poolCount = await countSettlementPoolReports(client, {
  organizationId,
  periodStart,
  periodEnd,
});
```

Update private helpers:

```ts
async function listProjectStreamerRules(
  client: SupabaseClient,
  organizationId: string,
  projectIds: string[],
  streamerIds: string[],
): Promise<ProjectStreamerRuleRow[]> {
  const { data, error } = await client
    .from("project_streamers")
    .select(
      "project_id, streamer_id, settlement_method, hourly_rate, base_salary, cps_rate_bps",
    )
    .eq("organization_id", organizationId)
    .in("project_id", projectIds)
    .in("streamer_id", streamerIds)
    .returns<ProjectStreamerRuleRow[]>();
```

```ts
async function countSettlementPoolReports(
  client: SupabaseClient,
  input: {
    organizationId: string;
    projectId?: string | null;
    batchType?: SettlementBatchType;
    periodStart: string;
    periodEnd: string;
  },
): Promise<number> {
  return (await listOpsSettlementPool(client, input)).length;
}
```

```ts
async function listSettledReportIdsForBatchType(
  client: SupabaseClient,
  organizationId: string,
  reportIds: string[],
  batchType: SettlementBatchType,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("settlement_batch_items")
    .select("live_report_id, settlement_batches!inner(batch_type)")
    .eq("organization_id", organizationId)
    .in("live_report_id", reportIds)
    .eq("settlement_batches.batch_type", batchType)
```

Call `listSettledReportIdsForBatchType(client, input.organizationId, reportIds, batchType)`.

- [ ] **Step 6: Pass organizationId from routes and pages**

In `app/api/settlement-pool/route.ts`, change:

```ts
const reports = await listOpsSettlementPool(context.supabase, {
  projectId,
  batchType: batchType as "receivable" | "payable",
  periodStart,
  periodEnd,
});
```

to:

```ts
const reports = await listOpsSettlementPool(context.supabase, {
  organizationId: context.auth.organizationId,
  projectId,
  batchType: batchType as "receivable" | "payable",
  periodStart,
  periodEnd,
});
```

In `app/(ops)/console/projects/page.tsx`, change:

```ts
loadSettlementReferenceData(supabase);
```

to:

```ts
loadSettlementReferenceData(supabase, auth.organizationId);
```

and change the helper signature and calls:

```ts
async function loadSettlementReferenceData(
  supabase: SupabaseClient,
  organizationId: string,
) {
  const [batches, details, settlementScope] = await Promise.all([
    listOpsSettlementBatches(supabase),
    listOpsSettlementBatchDetails(supabase),
    getOpsSettlementDefaultScope(supabase, organizationId),
  ]);
  const settlementPool = settlementScope
    ? await listOpsSettlementPool(supabase, {
        organizationId,
        periodStart: settlementScope.periodStart,
        periodEnd: settlementScope.periodEnd,
      })
    : [];
```

Apply the same `getOpsSettlementDefaultScope(supabase, auth.organizationId)` and `listOpsSettlementPool(... organizationId: auth.organizationId ...)` shape in `app/(ops)/console/stubs/[module]/page.tsx`.

- [ ] **Step 7: Run focused settlement tests**

Run:

```powershell
pnpm exec vitest run "app/(ops)/console/projects/page.test.tsx" "app/api/settlement-pool/route.test.ts" "features/settlements/settlement-queries.test.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit the tenant-scope hardening**

Run:

```powershell
git add "features/settlements/settlement-queries.ts" "app/api/settlement-pool/route.ts" "app/(ops)/console/projects/page.tsx" "app/(ops)/console/stubs/[module]/page.tsx" "app/(ops)/console/projects/page.test.tsx" "app/api/settlement-pool/route.test.ts"
git commit -m "fix: scope settlement pool reads to organization"
```

---

### Task 2: Preserve Explicit Clear Semantics For Streamer Profile Updates

**Files:**

- Modify: `features/streamers/streamer-service.ts`
- Modify: `features/streamers/streamer-repository.ts`
- Modify: `app/api/streamers/[streamerId]/route.ts`
- Modify: `features/streamers/streamer-service.test.ts`
- Modify: `app/api/streamers/streamers-route.test.ts`

- [ ] **Step 1: Add a failing service test for clearable fields**

In `features/streamers/streamer-service.test.ts`, add this test after the existing profile update test:

```ts
it("clears nullable and list profile fields when they are explicitly provided empty", async () => {
  const before = {
    id: "S-clear",
    displayName: "Clearable Streamer",
    userId: "user-streamer",
    realName: "Old Real",
    gender: "female",
    categories: ["RPG"],
    platforms: ["Douyin"],
    styles: ["Story"],
    riskLevel: "low" as const,
    cooperationStatus: "active" as const,
  };
  const after = {
    ...before,
    userId: null,
    realName: null,
    gender: null,
    categories: [],
    platforms: [],
    styles: [],
  };
  const repo = {
    createProfile: vi.fn(),
    getById: vi.fn().mockResolvedValue(before),
    updateRisk: vi.fn(),
    updateSettlementRule: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue(after),
  };
  const audit = vi.fn().mockResolvedValue(undefined);

  await updateStreamerProfile({
    repo,
    audit,
    actor: { ...actor, role: "ops_manager" },
    streamerId: before.id,
    input: {
      userId: null,
      realName: "",
      gender: null,
      categories: [],
      platforms: [" "],
      styles: [],
    },
    reason: "clear stale profile fields",
  });

  expect(repo.updateProfile).toHaveBeenCalledWith(before.id, {
    user_id: null,
    real_name: null,
    gender: null,
    categories: [],
    platforms: [],
    styles: [],
  });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      changedFields: [
        "user_id",
        "real_name",
        "gender",
        "categories",
        "platforms",
        "styles",
      ],
      reason: "clear stale profile fields",
    }),
  );
});
```

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```powershell
pnpm exec vitest run "features/streamers/streamer-service.test.ts"
```

Expected: FAIL because empty text/list values are currently normalized to `undefined`.

- [ ] **Step 3: Add a failing route test for clear requests**

In `app/api/streamers/streamers-route.test.ts`, add this test inside `describe("streamer api routes", ...)`:

```ts
it("PATCH /api/streamers/[streamerId] preserves explicit profile clear requests", async () => {
  vi.mocked(updateStreamerProfile).mockResolvedValue({
    id: "s-clear",
    displayName: "Clearable Streamer",
    riskLevel: "low",
    cooperationStatus: "active",
  } as never);

  const { PATCH } = await import("./[streamerId]/route");
  const response = await PATCH(
    jsonRequest(
      {
        realName: "",
        gender: "",
        categories: "",
        platforms: [],
        styles: "   ",
        reason: "clear stale profile fields",
      },
      "PATCH",
    ),
    { params: Promise.resolve({ streamerId: "s-clear" }) },
  );

  expect(response.status).toBe(200);
  expect(updateStreamerProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      streamerId: "s-clear",
      reason: "clear stale profile fields",
      input: expect.objectContaining({
        realName: null,
        gender: null,
        categories: [],
        platforms: [],
        styles: [],
      }),
    }),
  );
  expect(assertBillingWriteAllowed).toHaveBeenCalledTimes(1);
  expect(assertBillingWriteAllowed).toHaveBeenCalledWith(
    expect.objectContaining({ featureKey: "project_management" }),
  );
});
```

- [ ] **Step 4: Run the route test and verify it fails**

Run:

```powershell
pnpm exec vitest run "app/api/streamers/streamers-route.test.ts"
```

Expected: FAIL because the route currently drops empty profile fields.

- [ ] **Step 5: Update service patch types and normalization**

In `features/streamers/streamer-service.ts`, change clearable input handling by adding these helpers:

```ts
function normalizePatchDisplayName(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error("displayName cannot be empty");
  }
  return normalized;
}

function normalizeNullableTextPatch(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

function normalizePatchTextList(value: string[] | undefined) {
  if (value === undefined) return undefined;
  return value.map((item) => item.trim()).filter(Boolean);
}
```

Update `normalizeUpdateStreamerProfileInput`:

```ts
function normalizeUpdateStreamerProfileInput(
  input: UpdateStreamerProfileInput,
) {
  return {
    displayName: normalizePatchDisplayName(input.displayName),
    userId: normalizeNullableTextPatch(input.userId),
    realName: normalizeNullableTextPatch(input.realName),
    gender: normalizeNullableTextPatch(input.gender),
    sourceType: input.sourceType,
    cooperationStatus: input.cooperationStatus,
    categories: normalizePatchTextList(input.categories),
    platforms: normalizePatchTextList(input.platforms),
    styles: normalizePatchTextList(input.styles),
    defaultSettlementMethod: input.defaultSettlementMethod,
    defaultHourlyRate: normalizeNonNegativeNumber(
      input.defaultHourlyRate,
      "defaultHourlyRate",
    ),
    defaultBaseSalary: normalizeNonNegativeNumber(
      input.defaultBaseSalary,
      "defaultBaseSalary",
    ),
    defaultCpsRateBps: normalizeCpsRateBps(input.defaultCpsRateBps),
  };
}
```

Update repository patch types in `StreamerRepository.updateProfile`:

```ts
user_id?: string | null;
real_name?: string | null;
gender?: string | null;
categories?: string[];
platforms?: string[];
styles?: string[];
```

- [ ] **Step 6: Update route field-presence parsing**

In `app/api/streamers/[streamerId]/route.ts`, add these helpers:

```ts
function hasOwn(body: StreamerPatchBody, key: keyof StreamerPatchBody) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function normalizeNullableTextField(
  body: StreamerPatchBody,
  key: keyof StreamerPatchBody,
) {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
}

function normalizeTextListField(
  body: StreamerPatchBody,
  key: keyof StreamerPatchBody,
) {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n，]/)
      : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
```

Change the `input` passed to `updateStreamerProfile`:

```ts
input: {
  displayName: normalizeOptionalText(body.displayName),
  realName: normalizeNullableTextField(body, "realName"),
  gender: normalizeNullableTextField(body, "gender"),
  sourceType: sourceType as StreamerSourceType | undefined,
  cooperationStatus: cooperationStatus as
    | StreamerCooperationStatus
    | undefined,
  categories: normalizeTextListField(body, "categories"),
  platforms: normalizeTextListField(body, "platforms"),
  styles: normalizeTextListField(body, "styles"),
  defaultSettlementMethod: defaultSettlementMethod as
    | StreamerSettlementMethod
    | undefined,
  defaultHourlyRate: optionalNumber(
    body.defaultHourlyRate,
    "defaultHourlyRate",
  ),
  defaultBaseSalary: optionalNumber(
    body.defaultBaseSalary,
    "defaultBaseSalary",
  ),
  defaultCpsRateBps: optionalInteger(
    body.defaultCpsRateBps,
    "defaultCpsRateBps",
  ),
},
```

Do not use `normalizeNullableTextField` for `displayName`; a blank display name must not clear `streamers.display_name`.

- [ ] **Step 7: Run focused streamer tests**

Run:

```powershell
pnpm exec vitest run "features/streamers/streamer-service.test.ts" "app/api/streamers/streamers-route.test.ts" "components/reference-ui/ops-reference.test.jsx"
```

Expected: PASS.

- [ ] **Step 8: Commit the streamer profile hardening**

Run:

```powershell
git add "features/streamers/streamer-service.ts" "features/streamers/streamer-repository.ts" "app/api/streamers/[streamerId]/route.ts" "features/streamers/streamer-service.test.ts" "app/api/streamers/streamers-route.test.ts"
git commit -m "fix: preserve streamer profile clear updates"
```

---

### Task 3: Restore Formatting And Run The Quality Gate

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `features/streamers/streamer-service.ts`
- Modify: any files touched by Tasks 1 and 2 that Prettier changes.

- [ ] **Step 1: Format only changed files**

Run:

```powershell
pnpm exec prettier --write "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/projects/page.tsx" "app/(ops)/console/stubs/[module]/page.tsx" "app/api/settlement-pool/route.ts" "app/api/settlement-pool/route.test.ts" "app/api/streamers/streamers-route.test.ts" "app/api/streamers/[streamerId]/route.ts" "components/reference-ui/ops-reference.jsx" "components/reference-ui/ops-reference.test.jsx" "features/projects/project-ui-dto.test.ts" "features/projects/project-ui-dto.ts" "features/settlements/settlement-queries.ts" "features/streamers/streamer-repository.ts" "features/streamers/streamer-service.test.ts" "features/streamers/streamer-service.ts"
```

Expected: Prettier rewrites changed files and exits 0.

- [ ] **Step 2: Run the focused verification suite**

Run:

```powershell
pnpm exec vitest run "app/(ops)/console/projects/page.test.tsx" "app/api/settlement-pool/route.test.ts" "app/api/streamers/streamers-route.test.ts" "components/reference-ui/ops-reference.test.jsx" "features/projects/project-ui-dto.test.ts" "features/settlements/settlement-queries.test.ts" "features/streamers/streamer-service.test.ts"
```

Expected: PASS.

- [ ] **Step 3: Run repository quality checks**

Run these commands in order:

```powershell
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected:

- `pnpm format:check`: PASS.
- `pnpm type-check`: PASS.
- `pnpm lint`: PASS. The known Babel deopt note for `components/reference-ui/ops-reference.jsx` may still print, but exit code must be 0.
- `pnpm test`: PASS with all non-skipped tests passing.
- `pnpm build`: PASS.

- [ ] **Step 4: Commit formatting and any final verification-only fixes**

Run:

```powershell
git status --short
git add "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/projects/page.tsx" "app/(ops)/console/stubs/[module]/page.tsx" "app/api/settlement-pool/route.ts" "app/api/settlement-pool/route.test.ts" "app/api/streamers/streamers-route.test.ts" "app/api/streamers/[streamerId]/route.ts" "components/reference-ui/ops-reference.jsx" "components/reference-ui/ops-reference.test.jsx" "features/projects/project-ui-dto.test.ts" "features/projects/project-ui-dto.ts" "features/settlements/settlement-queries.ts" "features/streamers/streamer-repository.ts" "features/streamers/streamer-service.test.ts" "features/streamers/streamer-service.ts"
git commit -m "chore: format upgrade hardening changes"
```

---

### Task 4: Prepare A Separate Reference-UI Decomposition Plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-09-ops-reference-streamer-panel-decomposition.md`

- [ ] **Step 1: Record why the split is separate**

Create the follow-up plan file with this scope statement:

```md
# Ops Reference Streamer Panel Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `components/reference-ui/ops-reference.jsx` maintenance risk by extracting streamer profile editing code without changing runtime behavior.

**Architecture:** Extract pure draft helpers first, then extract the profile edit form behind prop-based dependencies. Keep the parent `StreamerPanel` responsible for data ownership and submission side effects.

**Tech Stack:** React, Vitest, Testing Library, existing reference UI components.
```

- [ ] **Step 2: Define the first extraction unit**

Add this file mapping to the follow-up plan:

```md
- Create `components/reference-ui/ops-streamer-profile-utils.js`
  - Owns `streamerProfileDraftFromCard`, `streamerSourceValue`, `editableListText`, `splitDraftList`, `draftNumber`, and `draftPercentToBps`.
- Modify `components/reference-ui/ops-reference.jsx`
  - Imports the helper functions from `ops-streamer-profile-utils.js`.
- Create `components/reference-ui/ops-streamer-profile-utils.test.js`
  - Covers source mapping, list parsing, money number parsing, and percent-to-bps conversion.
```

- [ ] **Step 3: Stop after saving the follow-up plan**

Do not implement the decomposition in the same change set as Tasks 1-3. The hardening changes are small and security-adjacent; the reference-UI split is a maintainability refactor that should be reviewed separately.

---

## Self-Review

**Spec coverage:** The plan covers the three concrete hardening areas found in the review: tenant-scoped settlement reads, explicit streamer-profile clear semantics, and failed formatting. It also records the `ops-reference.jsx` decomposition as a separate follow-up plan instead of mixing it into the same implementation.

**Placeholder scan:** The plan contains concrete files, concrete tests, concrete implementation snippets, and exact commands. There are no open-ended implementation steps.

**Type consistency:** `organizationId` is introduced as a required string in every settlement query path that reads organization-wide data. Streamer profile clear semantics use `null` for nullable scalar DB columns and `[]` for non-null text array DB columns.
