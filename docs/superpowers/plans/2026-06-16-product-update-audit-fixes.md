# Product Update Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three audit findings from the local product update: OCR confirmation bypass, collaboration application DB integrity/RLS gaps, and recording ownership leakage after collaboration attribution.

**Architecture:** Keep the existing owner-project collaboration model. Fix OCR by making the streamer flow two-phase: upload and queue OCR first, then confirm the same report after an OCR result or explicit fallback. Fix collaboration and recording security at both service and database boundaries, without broad refactors.

**Tech Stack:** Next.js App Router, React reference UI, Supabase/Postgres RLS migrations, Vitest, PowerShell, pnpm.

---

## Scope And File Map

- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
  - Stop immediately confirming `/api/live-reports/{reportId}/ocr` after queueing OCR.
  - Store pending OCR report/job state and confirm only after result or fallback confirmation.
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
  - Replace current one-click OCR submission expectation with queue -> result/fallback -> confirm expectations.
- Modify: `features/ai/ocr-jobs.ts` only if job status/result DTO needs a safer helper for UI polling.
- Modify: `app/api/ocr/jobs/[jobId]/route.ts` only if it does not already expose safe job result fields needed by the streamer flow.
- Create: `supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql`
  - Add share/application consistency constraints.
  - Tighten collaboration application insert RLS.
  - Add duplicate-open-application guard.
- Modify: `features/collaborations/project-collaboration-service.ts`
  - Stop exposing `share.id` in public share DTO.
  - Re-check share/project consistency when reviewing applications if needed for defense in depth.
- Modify: `features/collaborations/project-collaboration-service.test.ts`
  - Assert public share DTO hides `id`.
  - Assert owner review rejects an application whose share/project/owner are inconsistent if service-level guard is added.
- Modify: `app/api/public/project-collaboration/[token]/route.test.ts`
  - Assert public route response does not expose share id.
- Modify: `features/applications/application-service.ts`
  - Add current-streamer ownership check before recording insertion.
- Modify: `features/applications/application-route-utils.ts`
  - Allow `actorFromContext` to carry `streamerId`, or add a small helper for streamer actors.
- Modify: `app/api/applications/[applicationId]/videos/route.ts`
  - Resolve current streamer id and pass it into `submitRecording`.
- Modify: `app/api/streamer/recordings/route.ts`
  - Pass the already-resolved streamer id into `submitProjectRecording` / `submitRecording`.
- Modify: `features/recordings/project-recording-delivery.ts`
  - Preserve current-streamer id when delegating to `submitRecording`.
- Modify tests:
  - `features/applications/application-service.test.ts`
  - `app/api/applications/[applicationId]/videos/route.test.ts`
  - `app/api/streamer/recordings/route.test.ts`
  - `features/recordings/project-recording-delivery.test.ts`
- Modify: `docs/superpowers/specs/2026-06-10-project-mcn-collaboration-design.md`
  - Remove trailing whitespace that currently fails `git diff --check`.
- Decide: `docs/database-product-link-structure.md`
  - Leave untracked unless this audit-fix batch explicitly includes docs.

---

### Task 1: Fix Streamer OCR So It Does Not Confirm Before OCR Runs

**Files:**

- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Optional Modify: `app/api/ocr/jobs/[jobId]/route.ts`
- Add: `supabase/migrations/20260616110000_streamer_ocr_job_read.sql`

- [x] **Step 1: Write the failing UI test for queue-only behavior**

In `components/reference-ui/streamer-mobile-reference.test.jsx`, change the current smoke test that expects call 8 to `/api/live-reports/report-ui-smoke-streamer/ocr`. The first click should queue OCR and refresh tasks, but must not confirm the report before an OCR result is available.

```jsx
expect(fetchMock).toHaveBeenNthCalledWith(
  7,
  "/api/live-tasks/live-task-ui-smoke-1/ocr",
  expect.objectContaining({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screenshotStoragePath:
        "org-1/report-screenshots/live-task-ui-smoke-1/manual-submit.png",
      screenshotFileHash:
        "manual-live-task-ui-smoke-1-1780000000000-end.png-21",
      imageBucket: "evidence-private",
    }),
  }),
);

expect(
  fetchMock.mock.calls.some(
    ([url]) => String(url) === "/api/live-reports/report-ui-smoke-streamer/ocr",
  ),
).toBe(false);

expect(await screen.findByText(/OCR 识别中/)).toBeInTheDocument();
```

- [x] **Step 2: Run the failing focused test**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/streamer-mobile-reference.test.jsx" -t "streams a real screenshot through the OCR report flow"
```

Expected: FAIL because the current UI immediately calls `/api/live-reports/{reportId}/ocr`.

- [x] **Step 3: Change the UI action to queue OCR and store pending confirmation state**

In `components/reference-ui/streamer-mobile-reference.jsx`, replace the immediate confirm block after `const queued = await fetchJson(...)` with state that preserves the same report identity.

```jsx
const queuedReportId = queued.report?.id;
const queuedJobId = queued.job?.id;
if (!queuedReportId) {
  throw new Error("OCR report response missing report id");
}

setPendingOcrReport({
  taskId: id,
  reportId: queuedReportId,
  jobId: queuedJobId ?? null,
  confirmedDuration,
  confirmedViewers: audience,
  note: input.note || "",
  status: queued.job?.status || "queued",
  result: null,
});

setTaskMessage("OCR 识别中，请等待识别结果后确认报数。");
await refreshTasks();
return queued;
```

Add component state near the other task/report state:

```jsx
const [pendingOcrReport, setPendingOcrReport] = React.useState(null);
```

- [x] **Step 4: Add a safe OCR job polling helper**

In the same component, add a helper that reads safe job status from the existing OCR job endpoint.

```jsx
const refreshPendingOcrResult = React.useCallback(async () => {
  if (!pendingOcrReport?.jobId) return null;
  const body = await fetchJson(
    `/api/ocr/jobs/${pendingOcrReport.jobId}`,
    "load OCR result failed",
  );
  const job = body.job || body;
  setPendingOcrReport((current) =>
    current?.jobId === pendingOcrReport.jobId
      ? {
          ...current,
          status: job.status,
          result: job.result || null,
        }
      : current,
  );
  return job;
}, [pendingOcrReport]);
```

If `app/api/ocr/jobs/[jobId]/route.ts` does not return `result.extractedDuration` and `result.extractedViewers`, add those fields only when the job is accessible to the current user and the result is safe to expose.

- [x] **Step 5: Add explicit confirm action after OCR result or fallback**

Add a button in the pending task/report panel that calls the confirm endpoint only after the user sees the OCR result or decides to use manual values.

```jsx
const confirmPendingOcrReport = React.useCallback(async () => {
  if (!pendingOcrReport?.reportId) return;
  const result = pendingOcrReport.result || {};
  await fetchJson(
    `/api/live-reports/${pendingOcrReport.reportId}/ocr`,
    "confirm OCR report failed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ocrDuration: result.extractedDuration,
        ocrViewers: result.extractedViewers,
        confirmedDuration: pendingOcrReport.confirmedDuration,
        confirmedViewers: pendingOcrReport.confirmedViewers,
        note: pendingOcrReport.note,
      }),
    },
  );
  setPendingOcrReport(null);
  setTaskMessage("报数已提交审核");
  await refreshTasks();
}, [pendingOcrReport, refreshTasks]);
```

The UI text can be short:

```jsx
{
  pendingOcrReport ? (
    <div role="status">
      OCR 识别中
      <button type="button" onClick={refreshPendingOcrResult}>
        刷新识别结果
      </button>
      <button type="button" onClick={confirmPendingOcrReport}>
        确认 OCR 结果，提交审核
      </button>
    </div>
  ) : null;
}
```

- [x] **Step 6: Add passing tests for OCR result confirmation and fallback**

Add one test where `/api/ocr/jobs/ocr-job-ui-smoke-streamer` returns:

```js
{
  job: {
    id: "ocr-job-ui-smoke-streamer",
    status: "succeeded",
    result: { extractedDuration: 238, extractedViewers: 11240 },
  },
}
```

Expected confirm body:

```js
{
  ocrDuration: 238,
  ocrViewers: 11240,
  confirmedDuration: 240,
  confirmedViewers: 11240,
  note: "",
}
```

Add one fallback test where OCR job status is `failed`; the UI still uses the same `queuedReportId` and lets the streamer confirm manual values.

- [x] **Step 7: Run OCR-focused tests**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/streamer-mobile-reference.test.jsx" "app/api/live-tasks/[taskId]/ocr/route.test.ts" "app/api/live-reports/[reportId]/ocr/route.test.ts" "features/live-operations/live-operations-service.test.ts" "features/ai/ocr-jobs.test.ts"
```

Expected: PASS.

---

### Task 2: Harden Collaboration Application DB Integrity And Public DTOs

**Files:**

- Create: `supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql`
- Modify: `features/collaborations/project-collaboration-service.ts`
- Modify: `features/collaborations/project-collaboration-service.test.ts`
- Modify: `app/api/public/project-collaboration/[token]/route.test.ts`
- Modify: `app/api/public/project-collaboration/[token]/route.ts`
- Modify: `app/share/project-collaboration/[token]/project-collaboration-page-client.tsx`
- Modify: `app/share/project-collaboration/[token]/project-collaboration-page-client.test.tsx`
- Modify: `lib/db/project-collaboration-schema-contract.test.ts`

- [x] **Step 1: Add migration-level share/application consistency**

Create `supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql`:

```sql
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_collaboration_shares_id_project_owner_unique'
  ) then
    alter table public.project_collaboration_shares
      add constraint project_collaboration_shares_id_project_owner_unique
      unique (id, project_id, owner_organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_collaboration_applications_share_project_owner_fk'
  ) then
    alter table public.project_collaboration_applications
      add constraint project_collaboration_applications_share_project_owner_fk
      foreign key (share_id, project_id, owner_organization_id)
      references public.project_collaboration_shares (id, project_id, owner_organization_id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists project_collaboration_applications_one_open_per_partner
on public.project_collaboration_applications (project_id, applicant_organization_id)
where status in ('submitted', 'owner_countered');
```

- [x] **Step 2: Replace broad insert RLS with service-equivalent checks**

In the same migration:

```sql
drop policy if exists project_collaboration_applications_partner_insert
on public.project_collaboration_applications;

create policy project_collaboration_applications_partner_insert
on public.project_collaboration_applications
for insert
to authenticated
with check (
  public.is_org_member(applicant_organization_id)
  and applicant_organization_id <> owner_organization_id
  and exists (
    select 1
    from public.project_collaboration_shares share
    join public.projects project
      on project.id = share.project_id
    where share.id = share_id
      and share.project_id = project_id
      and share.owner_organization_id = owner_organization_id
      and share.status = 'active'
      and share.expires_at > now()
      and share.allow_applications
      and project.is_open_to_mcn_collaboration
      and project.organization_id = owner_organization_id
  )
);
```

- [x] **Step 3: Hide public share id**

In `features/collaborations/project-collaboration-service.ts`, change `toPublicShare`:

```ts
function toPublicShare(share: CollaborationShareRecord) {
  return {
    status: share.status,
    expiresAt: share.expiresAt,
    allowApplications: share.allowApplications,
  };
}
```

- [x] **Step 4: Add service tests for hidden share id**

In `features/collaborations/project-collaboration-service.test.ts`, extend the public share test:

```ts
expect(JSON.stringify(result)).not.toContain("tokenHash");
expect(JSON.stringify(result)).not.toContain("privateMargin");
expect(JSON.stringify(result)).not.toContain('"share":{"id"');
if (result.available) {
  expect(result.share).not.toHaveProperty("id");
}
```

- [x] **Step 5: Add route test for hidden share id**

In `app/api/public/project-collaboration/[token]/route.test.ts`, assert:

```ts
const body = await response.json();
expect(body.collaboration.share).not.toHaveProperty("id");
```

- [x] **Step 6: Add optional service defense on owner review**

If the repository can cheaply load a share by application share id, add a guard before activation:

```ts
if (
  application.shareId !== share.id ||
  application.projectId !== share.projectId ||
  application.ownerOrganizationId !== share.ownerOrganizationId ||
  share.status !== "active"
) {
  throw new Error("Collaboration application is inconsistent with its share");
}
```

Keep this as defense in depth; the migration is the primary fix.

- [x] **Step 7: Run collaboration-focused tests**

Run:

```powershell
pnpm exec vitest run "features/collaborations/project-collaboration-service.test.ts" "app/api/public/project-collaboration/[token]/route.test.ts" "app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.test.ts" "app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts"
```

Expected: PASS.

---

### Task 3: Enforce Current-Streamer Ownership Before Recording Insert

**Files:**

- Modify: `features/applications/application-service.ts`
- Modify: `features/applications/application-service.test.ts`
- Modify: `app/api/applications/[applicationId]/videos/route.ts`
- Modify: `app/api/applications/[applicationId]/videos/route.test.ts`
- Modify: `app/api/streamer/recordings/route.ts`
- Modify: `app/api/streamer/recordings/route.test.ts`
- Modify: `features/recordings/project-recording-delivery.test.ts`

- [x] **Step 1: Write failing service test for mismatched streamer**

In `features/applications/application-service.test.ts`, add:

```ts
it("rejects streamer recording submissions for another streamer's application", async () => {
  const repo = makeRepo({
    getApplicationById: vi.fn().mockResolvedValue({
      ...baseApplication,
      streamerId: "streamer-2",
      status: "recording_required",
    }),
  });

  await expect(
    submitRecording({
      repo,
      audit: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      actor: { ...streamerActor, streamerId: "streamer-1" },
      input: {
        applicationId: "app-1",
        externalUrl: "https://videos.example.com/other-streamer",
      },
    }),
  ).rejects.toThrow("Application is not available for the current streamer");

  expect(repo.createRecordingSubmission).not.toHaveBeenCalled();
  expect(repo.markApplicationRecordingReviewing).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the failing service test**

Run:

```powershell
pnpm exec vitest run "features/applications/application-service.test.ts" -t "rejects streamer recording submissions for another streamer's application"
```

Expected: FAIL because `submitRecording` currently does not compare actor streamer id with `application.streamerId`.

- [x] **Step 3: Add `streamerId` to admission actors**

In `features/applications/application-service.ts`, extend the actor type:

```ts
export type AdmissionActor = {
  userId: string;
  name?: string;
  role: AppRole;
  organizationId: string;
  streamerId?: string | null;
};
```

- [x] **Step 4: Check ownership before creating a recording**

In `submitRecording`, immediately after `const application = await requireApplication(...)`:

```ts
if (actor.role === "streamer") {
  if (!actor.streamerId || application.streamerId !== actor.streamerId) {
    throw new Error("Application is not available for the current streamer");
  }
}
```

This must run before `repo.getLatestRecordingSubmission` and before `repo.createRecordingSubmission`.

- [x] **Step 5: Pass current streamer id from the generic videos route**

In `app/api/applications/[applicationId]/videos/route.ts`, resolve the current streamer id before calling `submitRecording`:

```ts
import { getStreamerIdForUser } from "@/features/applications/application-repository";

const currentStreamerId =
  context.auth.role === "streamer"
    ? await getStreamerIdForUser(
        context.supabase,
        context.auth.userId,
        context.auth.organizationId,
      )
    : null;

const recording = await submitRecording({
  repo: context.repo,
  audit: (input) => context.audit(context.supabase, input),
  notify: (input) => context.notify(context.supabase, input),
  actor: {
    ...actorFromContext(context),
    streamerId: currentStreamerId,
  },
  input: {
    applicationId,
    storagePath: body.storagePath,
    externalUrl: body.externalUrl,
    durationSeconds: body.durationSeconds,
  },
});
```

- [x] **Step 6: Preserve current streamer id through streamer recording route**

In `app/api/streamer/recordings/route.ts`, pass `streamerId` into the actor:

```ts
actor: {
  userId: context.auth.userId,
  name: context.auth.name,
  role: context.auth.role,
  organizationId: context.auth.organizationId,
  streamerId,
},
```

In `features/recordings/project-recording-delivery.ts`, keep the actor unchanged when delegating to `submitRecording`; the `streamerId` should already be present.

- [x] **Step 7: Update route tests**

In `app/api/applications/[applicationId]/videos/route.test.ts`, mock `getStreamerIdForUser` and assert actor includes `streamerId: "streamer-1"`.

```ts
expect(submitRecording).toHaveBeenCalledWith(
  expect.objectContaining({
    actor: expect.objectContaining({
      role: "streamer",
      streamerId: "streamer-1",
    }),
  }),
);
```

In `app/api/streamer/recordings/route.test.ts`, assert `submitProjectRecording` receives an actor with `streamerId`.

- [x] **Step 8: Run application-focused tests**

Run:

```powershell
pnpm exec vitest run "features/applications/application-service.test.ts" "app/api/applications/[applicationId]/videos/route.test.ts" "app/api/streamer/recordings/route.test.ts" "features/recordings/project-recording-delivery.test.ts"
```

Expected: PASS.

---

### Task 4: Clean Known Diff Check Failure And Keep Docs Scope Explicit

**Files:**

- Check: `git diff --check`
- Decide: `docs/database-product-link-structure.md`

- [x] **Step 1: Confirm no trailing whitespace remains**

`git diff --check` produced no output, so no whitespace-only fix was needed.

- [x] **Step 2: Re-run diff check**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [x] **Step 3: Decide untracked docs scope**

Run:

```powershell
git status --short --branch
git ls-files --others --exclude-standard
```

Expected: `docs/database-product-link-structure.md` remains untracked unless this batch intentionally includes it.

Actual: `docs/database-product-link-structure.md` remains outside this batch; include only this plan document and the two new security migrations from untracked files.

---

### Task 5: Full Verification And Publish Readiness

**Files:**

- No new code files unless tests reveal fixes.

- [x] **Step 1: Re-check remote/local state**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/codex/full-project-ui
gh api repos/yuxuanasher-source/-Constella/branches/codex/full-project-ui --jq .commit.sha
gh api repos/yuxuanasher-source/-Constella/branches/codex/ai-runtime-foundation --jq .commit.sha
```

Expected: local branch still ahead of `origin/codex/full-project-ui`; GitHub remote SHA matches local `origin` ref, unless `git fetch` succeeds and shows new remote work.

Actual: `git fetch origin` failed twice with `schannel: failed to receive handshake, SSL/TLS connection failed`. Based on the existing local remote-tracking ref, `codex/full-project-ui` is ahead of `origin/codex/full-project-ui` by 24 commits and behind by 0.

- [x] **Step 2: Run focused regression suites**

Run:

```powershell
pnpm exec vitest run "components/reference-ui/streamer-mobile-reference.test.jsx" "features/collaborations/project-collaboration-service.test.ts" "app/api/public/project-collaboration/[token]/route.test.ts" "features/applications/application-service.test.ts" "app/api/applications/[applicationId]/videos/route.test.ts" "app/api/streamer/recordings/route.test.ts"
```

Expected: PASS.

Actual: PASS, 16 test files and 146 tests.

- [x] **Step 3: Run trusted repo gates**

Run:

```powershell
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

Expected: PASS. If `lint` prints only the known Babel deopt warning for large reference UI files and exits 0, treat it as pass.

Actual: PASS for `pnpm format:check`, `pnpm type-check`, `pnpm lint`, `pnpm test`, and `pnpm build`. Full test result was 166 passed and 1 skipped test file, 792 passed and 3 skipped tests.

- [x] **Step 4: Review final diff before staging**

Run:

```powershell
git diff --stat
git diff --check
git status --short
```

Expected:

- `git diff --check` passes.
- Only intended OCR/collaboration/application/security plan files are modified.
- `docs/database-product-link-structure.md` is either intentionally included or intentionally left untracked.

Actual: `git diff --check` passes. The working tree also contains unrelated login changes in `app/(auth)/login/*`, which remain outside this batch. `docs/database-product-link-structure.md` remains intentionally untracked and outside this batch.

- [ ] **Step 5: Commit only after verification and explicit approval**

Use narrow staging. Example:

```powershell
git add -- `
  "components/reference-ui/streamer-mobile-reference.jsx" `
  "components/reference-ui/streamer-mobile-reference.test.jsx" `
  "supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql" `
  "features/collaborations/project-collaboration-service.ts" `
  "features/collaborations/project-collaboration-service.test.ts" `
  "app/api/public/project-collaboration/[token]/route.ts" `
  "app/api/public/project-collaboration/[token]/route.test.ts" `
  "app/share/project-collaboration/[token]/project-collaboration-page-client.tsx" `
  "app/share/project-collaboration/[token]/project-collaboration-page-client.test.tsx" `
  "lib/db/project-collaboration-schema-contract.test.ts" `
  "features/applications/application-service.ts" `
  "app/api/applications/[applicationId]/videos/route.ts" `
  "app/api/streamer/recordings/route.ts" `
  "features/applications/application-service.test.ts" `
  "app/api/applications/[applicationId]/videos/route.test.ts" `
  "app/api/streamer/recordings/route.test.ts" `
  "features/recordings/project-recording-delivery.test.ts" `
  "supabase/migrations/20260616110000_streamer_ocr_job_read.sql" `
  "supabase/migrations/20260616120000_harden_project_collaboration_application_integrity.sql" `
  "docs/superpowers/plans/2026-06-16-product-update-audit-fixes.md"

git commit -m "fix: harden collaboration OCR and recording flows"
```

Expected: one scoped commit containing only the audit-fix batch.

---

## Self-Review Checklist

- [x] OCR flow preserves one report identity from screenshot upload through OCR result and confirmation.
- [x] Streamer cannot confirm a report with nonexistent OCR values unless using explicit fallback on the same report.
- [x] Public collaboration response does not expose share id or token hash.
- [x] DB rejects collaboration applications whose share/project/owner do not match.
- [x] DB rejects direct inserts through expired/revoked/non-application shares.
- [x] DB rejects duplicate open collaboration applications for the same project and applicant organization.
- [x] Streamer recording insertion checks current streamer ownership before any recording row is created.
- [x] `git diff --check` passes.
- [x] Untracked docs are handled intentionally, not accidentally staged.
