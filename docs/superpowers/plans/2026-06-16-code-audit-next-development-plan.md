# Code Audit Next Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-risk audit findings from the 2026-06-16 project review: OAuth login correctness, explicit settlement tenant scoping, dependency security, CI audit coverage, and mobile auth routing.

**Architecture:** Keep the fixes narrow and defensive. Route third-party auth through a callback that exchanges the Supabase PKCE code before resolving the real user role. Carry `organizationId` explicitly through settlement batch queries instead of depending on RLS alone.

**Tech Stack:** Next.js App Router, TypeScript, Supabase SSR/Auth, Vitest, pnpm, GitHub Actions.

---

## Audit Baseline

- Branch: `codex/full-project-ui`, ahead of `origin/codex/full-project-ui` by 25 commits.
- Dirty files at audit time: `app/(auth)/login/actions.ts`, `app/(auth)/login/actions.test.ts`, `app/(auth)/login/page.tsx`, `app/(auth)/login/page.test.tsx`, `docs/database-product-link-structure.md`.
- Green checks: `git diff --check`, `pnpm format:check`, `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Failing security check: `pnpm audit --audit-level moderate` reports `postcss <8.5.10` through `next -> postcss@8.4.31`.

---

## Current Audit Acceptance Update

- Timestamp: 2026-06-16 11:34 CST.
- Accepted completed feature slice: `b6a68cfe fix: harden collaboration OCR and recording flows`.
- Acceptance checks run now:
  - `git diff --check` passed.
  - `pnpm exec vitest run "components/reference-ui/streamer-mobile-reference.test.jsx" "app/api/ocr/jobs/[jobId]/route.test.ts" "features/collaborations/project-collaboration-service.test.ts" "app/api/public/project-collaboration/[token]/route.test.ts" "features/applications/application-service.test.ts" "app/api/applications/[applicationId]/videos/route.test.ts" "app/api/streamer/recordings/route.test.ts" "features/recordings/project-recording-delivery.test.ts"` passed: 8 test files, 76 tests.
- Security checks rerun now:
  - `pnpm audit --audit-level moderate` passed.
  - `pnpm audit:security` passed.
- Next-slice focused checks run now:
  - `pnpm exec vitest run "app/(auth)/login/actions.test.ts" "app/(auth)/login/page.test.tsx" "app/(streamer-app)/m/login/page.test.tsx" "features/settlements/settlement-queries.test.ts" "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/stubs/[module]/page.test.tsx" "app/api/settlement-batches/route.test.ts" proxy.test.ts "app/auth/callback/route.test.ts"` passed: 9 test files, 43 tests.
- Full repo checks run now:
  - `pnpm format:check`, `pnpm type-check`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm audit:security` passed.
  - Full test result: 168 passed and 1 skipped test file; 804 passed and 3 skipped tests.
  - `pnpm lint` exits 0; the only lint output is the known Babel deopt note for `components/reference-ui/ops-reference.jsx`.
- Release verdict: the committed collaboration/OCR/recording hardening slice is accepted by focused regression. The current uncommitted auth/proxy/settlement/security/CI slice now passes focused and full verification. Remaining work is packaging only: decide whether to include `docs/database-product-link-structure.md`, then stage and commit the scoped slice.

---

## File Structure

- Modify `app/(auth)/login/actions.ts`: send OAuth providers to a real callback URL and preserve `entryPoint`, `roleIntent`, and safe `next`.
- Create `app/auth/callback/route.ts`: exchange OAuth code for a Supabase session, read auth context, and redirect by real role.
- Create `app/auth/callback/route.test.ts`: cover success, bad `next`, missing code, and exchange failure.
- Modify `app/(auth)/login/actions.test.ts`: assert configured OAuth uses `/auth/callback`.
- Modify `app/(streamer-app)/m/login/page.test.tsx`: assert mobile provider forms carry `entryPoint=mobile`.
- Modify `proxy.ts` and `proxy.test.ts`: send unauthenticated `/m/*` requests to `/m/login`, not desktop `/login`.
- Modify `features/settlements/settlement-queries.ts`: add explicit `organizationId` filters to settlement batch list/detail queries.
- Modify settlement callers: `app/(ops)/console/projects/page.tsx`, `app/(ops)/console/stubs/[module]/page.tsx`, `app/api/settlement-batches/route.ts`, `app/api/settlement-batches/[batchId]/route.ts`.
- Modify settlement tests: `app/(ops)/console/projects/page.test.tsx`, `app/(ops)/console/stubs/[module]/page.test.tsx`, and route/query tests for `settlement-batches`.
- Modify `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`: add PostCSS override and audit gate.

---

### Task 1: Fix Supabase OAuth Callback And Role Routing

**Files:**

- Modify: `app/(auth)/login/actions.ts`
- Create: `app/auth/callback/route.ts`
- Test: `app/auth/callback/route.test.ts`
- Test: `app/(auth)/login/actions.test.ts`
- Test: `app/(streamer-app)/m/login/page.test.tsx`

- [x] **Step 1: Write failing OAuth callback route tests**

Create `app/auth/callback/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";

import { GET } from "./route";

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

function request(path: string) {
  return new NextRequest(new URL(path, "https://preview.example.cn"));
}

describe("OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges the OAuth code and sends mobile streamers to mobile tasks", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "streamer@example.cn",
      name: "Streamer",
      role: "streamer",
      organizationId: "org-1",
      organizationName: "Org",
      requiresOnboarding: false,
    } as never);

    const response = await GET(
      request(
        "/auth/callback?code=oauth-code&entryPoint=mobile&roleIntent=streamer",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/tasks",
    );
  });

  it("rejects unsafe next URLs and falls back by real role", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    } as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-1",
      email: "owner@example.cn",
      name: "Owner",
      role: "owner",
      organizationId: "org-1",
      organizationName: "Org",
      requiresOnboarding: false,
    } as never);

    const response = await GET(
      request("/auth/callback?code=oauth-code&next=https://evil.test/console"),
    );

    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/console/projects",
    );
  });

  it("returns to the matching login page when the code is missing", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { exchangeCodeForSession: vi.fn() },
    } as never);

    const response = await GET(request("/auth/callback?entryPoint=mobile"));

    expect(response.headers.get("location")).toBe(
      "https://preview.example.cn/m/login?error=auth",
    );
  });
});
```

- [x] **Step 2: Run the callback test and verify it fails**

Run:

```powershell
pnpm exec vitest run "app/auth/callback/route.test.ts"
```

Expected: fails because `app/auth/callback/route.ts` does not exist.

- [x] **Step 3: Add the OAuth callback route**

Create `app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  normalizeLoginEntryPoint,
  normalizeRoleIntent,
  resolvePostLoginPath,
} from "@/app/(auth)/login/login-workflows";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const entryPoint = normalizeLoginEntryPoint(
    url.searchParams.get("entryPoint"),
  );
  const roleIntent = normalizeRoleIntent(url.searchParams.get("roleIntent"));
  const next = normalizeRelativeNext(url.searchParams.get("next"));
  const loginPath = entryPoint === "mobile" ? "/m/login" : "/login";

  const supabase = await createSupabaseServerClient();
  if (!supabase || !code) {
    return NextResponse.redirect(
      new URL(`${loginPath}?error=auth`, request.url),
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`${loginPath}?error=auth`, request.url),
    );
  }

  const auth = await getAuthContext(supabase);
  const target = resolvePostLoginPath({
    role: auth?.role,
    roleIntent: auth?.role === "streamer" ? "streamer" : roleIntent,
    entryPoint,
    next,
  });

  return NextResponse.redirect(new URL(target, request.url));
}

function normalizeRelativeNext(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "";
  }
  return next;
}
```

- [x] **Step 4: Update provider action redirect target**

In `app/(auth)/login/actions.ts`, change `signInWithProviderAction` to read `roleIntent` and `next`, and set OAuth redirect to the callback:

```ts
export async function signInWithProviderAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const roleIntent = normalizeRoleIntent(formData.get("roleIntent"));
  const entryPoint = normalizeLoginEntryPoint(formData.get("entryPoint"));
  const next = String(formData.get("next") ?? "");
  const loginBasePath = getLoginBasePath(entryPoint);

  if (provider === "wechat") {
    const supabase = await createSupabaseServerClient();
    if (!supabase || process.env.NEXT_PUBLIC_AUTH_WECHAT_ENABLED !== "true") {
      redirect(`${loginBasePath}?provider=unconfigured`);
    }

    const callback = new URL("/auth/callback", getAppUrl());
    callback.searchParams.set("entryPoint", entryPoint);
    callback.searchParams.set("roleIntent", roleIntent);
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      callback.searchParams.set("next", next);
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "wechat" as Provider,
      options: { redirectTo: callback.toString() },
    });

    if (error || !data.url) {
      redirect(`${loginBasePath}?provider=unconfigured`);
    }

    redirect(data.url);
  }

  if (provider === "feishu" && process.env.AUTH_FEISHU_LOGIN_URL) {
    redirect(process.env.AUTH_FEISHU_LOGIN_URL);
  }

  redirect(`${loginBasePath}?provider=unconfigured`);
}
```

- [x] **Step 5: Add action and mobile-provider regression tests**

Extend `app/(auth)/login/actions.test.ts` with a configured WeChat case that asserts `signInWithOAuth` receives `redirectTo` containing `/auth/callback?entryPoint=mobile&roleIntent=streamer`.

Extend `app/(streamer-app)/m/login/page.test.tsx` to assert every provider form includes `input[name="entryPoint"][value="mobile"]` and `input[name="roleIntent"][value="streamer"]`.

- [x] **Step 6: Verify focused auth tests**

Run:

```powershell
pnpm exec vitest run "app/(auth)/login/actions.test.ts" "app/(auth)/login/page.test.tsx" "app/(streamer-app)/m/login/page.test.tsx" "app/auth/callback/route.test.ts"
```

Expected: all focused auth tests pass.

---

### Task 2: Add Explicit Organization Scoping To Settlement Batch Reads

**Files:**

- Modify: `features/settlements/settlement-queries.ts`
- Modify: `app/(ops)/console/projects/page.tsx`
- Modify: `app/(ops)/console/stubs/[module]/page.tsx`
- Modify: `app/api/settlement-batches/route.ts`
- Modify: `app/api/settlement-batches/[batchId]/route.ts`
- Test: `app/(ops)/console/projects/page.test.tsx`
- Test: `app/(ops)/console/stubs/[module]/page.test.tsx`
- Test: settlement route/query tests that cover these calls

- [x] **Step 1: Write failing query expectations**

Add tests that expect:

```ts
expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
expect(listOpsSettlementBatchDetails).toHaveBeenCalledWith(supabase, {
  organizationId: "org-1",
});
```

For route-level tests, assert the Supabase query chain receives:

```ts
expect(eqMock).toHaveBeenCalledWith("organization_id", "org-1");
```

- [x] **Step 2: Run focused settlement tests and verify failure**

Run:

```powershell
pnpm exec vitest run "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/stubs/[module]/page.test.tsx" "app/api/settlement-batches"
```

Expected: fails because current calls omit `organizationId`.

- [x] **Step 3: Update settlement query signatures**

In `features/settlements/settlement-queries.ts`, change the functions to:

```ts
export async function listOpsSettlementBatches(
  client: SupabaseClient,
  organizationId: string,
): Promise<OpsSettlementBatchListItem[]> {
  const { data, error } = await client
    .from("settlement_batches")
    .select(
      "id, project_id, batch_type, status, period_start, period_end, computed_amount, manual_amount, adjustment_amount, evidence_summary, updated_at, created_by, projects(name), settlement_batch_items(id)",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .returns<SettlementBatchRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(toOpsSettlementBatchListItem);
}

export async function listOpsSettlementBatchDetails(
  client: SupabaseClient,
  input: { organizationId: string; batchId?: string },
): Promise<Record<string, OpsSettlementBatchDetailItem[]>> {
  let query = client
    .from("settlement_batch_items")
    .select(
      "id, settlement_batch_id, item_type, computed_amount, manual_amount, adjustment_amount, evidence_level, evidence_snapshot, streamers(display_name)",
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: true });

  if (input.batchId) {
    query = query.eq("settlement_batch_id", input.batchId);
  }

  const { data, error } = await query.returns<SettlementBatchDetailRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).reduce<Record<string, OpsSettlementBatchDetailItem[]>>(
    (grouped, row) => {
      const item = toOpsSettlementBatchDetailItem(row);
      grouped[item.batchId] = [...(grouped[item.batchId] ?? []), item];
      return grouped;
    },
    {},
  );
}
```

- [x] **Step 4: Update all callers**

Change page and API calls to pass `auth.organizationId`:

```ts
listOpsSettlementBatches(supabase, auth.organizationId);
listOpsSettlementBatchDetails(supabase, {
  organizationId: auth.organizationId,
});
listOpsSettlementBatchDetails(supabase, {
  organizationId: context.auth.organizationId,
  batchId,
});
```

- [x] **Step 5: Verify settlement focused tests**

Run:

```powershell
pnpm exec vitest run "features/settlements" "app/api/settlement-batches" "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/stubs/[module]/page.test.tsx"
```

Expected: all settlement focused tests pass.

---

### Task 3: Patch The PostCSS Advisory Without Waiting On Next

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Add a dependency security test command**

In `package.json`, add:

```json
"audit:security": "pnpm audit --audit-level moderate"
```

- [x] **Step 2: Add pnpm override**

In `package.json`, add the top-level field:

```json
"pnpm": {
  "overrides": {
    "postcss": "8.5.15"
  }
}
```

- [x] **Step 3: Refresh the lockfile only**

Run:

```powershell
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` resolves `next -> postcss` to `8.5.15` or another `>=8.5.10` version.

- [x] **Step 4: Verify the advisory is gone**

Run:

```powershell
pnpm audit --audit-level moderate
pnpm type-check
pnpm test
pnpm build
```

Expected: audit exits 0 and the existing verification remains green.

---

### Task 4: Add Dependency Audit To CI

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

- [x] **Step 1: Add CI step after install**

In `.github/workflows/ci.yml`, insert:

```yaml
- name: Security audit
  run: pnpm audit:security
```

- [x] **Step 2: Verify workflow syntax by running local commands**

Run:

```powershell
pnpm audit:security
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: all pass locally before pushing.

---

### Task 5: Keep Mobile Protected Routes On Mobile Login

**Files:**

- Modify: `proxy.ts`
- Test: `proxy.test.ts`

- [x] **Step 1: Add failing proxy test**

In `proxy.test.ts`, add:

```ts
it("redirects unauthenticated mobile routes to the mobile login page", async () => {
  const response = await proxy(createRequest("/m/tasks"));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://preview.example.cn/m/login?next=%2Fm%2Ftasks&error=config",
  );
  expect(createServerClient).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Update proxy login target**

In `proxy.ts`, replace both hard-coded login pathname assignments with:

```ts
loginUrl.pathname = request.nextUrl.pathname.startsWith("/m")
  ? "/m/login"
  : "/login";
```

- [x] **Step 3: Verify proxy tests**

Run:

```powershell
pnpm exec vitest run proxy.test.ts
```

Expected: proxy tests pass and `/console/*` still redirects to `/login`.

---

### Task 6: Final Verification And Packaging

**Files:**

- Check: all files modified by Tasks 1-5

- [x] **Step 1: Run full verification**

Run:

```powershell
git diff --check
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm audit:security
```

Expected: all commands exit 0.

- [x] **Step 2: Inspect dirty worktree before staging**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only files from this plan plus the already-present user-approved login/doc files are included. Stage only the intended implementation files.

- [x] **Step 3: Commit as one hardening slice**

Run:

```powershell
git add package.json pnpm-lock.yaml .github/workflows/ci.yml proxy.ts proxy.test.ts "app/(auth)/login/actions.ts" "app/(auth)/login/actions.test.ts" "app/(streamer-app)/m/login/page.test.tsx" app/auth/callback/route.ts app/auth/callback/route.test.ts features/settlements/settlement-queries.ts features/settlements/settlement-queries.test.ts "app/(ops)/console/projects/page.tsx" "app/(ops)/console/projects/page.test.tsx" "app/(ops)/console/stubs/[module]/page.tsx" "app/(ops)/console/stubs/[module]/page.test.tsx" app/api/settlement-batches/route.ts app/api/settlement-batches/route.test.ts "app/api/settlement-batches/[batchId]/route.ts" docs/superpowers/plans/2026-06-16-code-audit-next-development-plan.md
git commit -m "fix: harden auth and settlement audit findings"
```

Expected: commit succeeds without staging unrelated generated files or environment files.

---

## Self-Review

- Spec coverage: Covers every high-priority audit finding from 2026-06-16: OAuth callback, mobile role routing, settlement organization scoping, dependency advisory, CI audit gate, and mobile proxy UX.
- Placeholder scan: No `TBD`, `TODO`, or generic "add validation" instructions remain.
- Type consistency: `entryPoint`, `roleIntent`, `organizationId`, and `batchId` names match the existing repo vocabulary.
