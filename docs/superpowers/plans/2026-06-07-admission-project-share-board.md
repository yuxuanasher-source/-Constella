# Admission Project Share Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the project-first admission board, project recording export, and vendor share-board feedback loop described in `docs/superpowers/specs/2026-06-07-admission-project-share-board-design.md`.

**Architecture:** Keep `project_applications` and `recording_submissions` as the source of truth for admission state. Add a narrow admission-board query layer for project aggregation, a governed `admission_recordings` export kind, and project-scoped share/review tables plus service functions that sync vendor decisions back into existing recording/application status. Wire the existing reference UI to the new DTOs and actions without introducing a parallel review workflow.

**Tech Stack:** Next.js App Router route handlers, TypeScript service modules, Supabase SQL migrations/RLS, Vitest, React reference UI.

---

## File Structure

- Create `features/applications/admission-board.ts`: project aggregation, recording detail DTOs, export row mapping, and vendor decision summary helpers.
- Create `features/applications/admission-board.test.ts`: unit tests for project grouping, latest recording selection, export rows, and no sensitive fields.
- Create `features/applications/admission-share-board.ts`: token hashing, share-board creation DTOs, public share DTOs, vendor review sync rules.
- Create `features/applications/admission-share-board.test.ts`: unit tests for token hashing, share item locking, expiration checks, sync rules, and joined-state skip behavior.
- Create `supabase/migrations/20260607160000_admission_project_share_boards.sql`: share board, share items, vendor reviews, indexes, constraints, RLS.
- Modify `features/applications/application-queries.ts`: include recording URLs and vendor review fields in ops queue DTOs when available.
- Modify `features/applications/application-repository.ts`: support vendor sync update helpers only if needed by the share service.
- Modify `features/exports/export-definitions.ts`: add `admission_recordings` whitelist.
- Modify `features/exports/export-definitions.test.ts` and `features/exports/export-service.test.ts`: cover whitelist and CSV behavior.
- Create `app/api/applications/admission-board/route.ts`: returns project-first admission board for MCN staff.
- Create `app/api/exports/admission-recordings/route.ts`: server-side project recording export.
- Create `app/api/exports/admission-recordings/route.test.ts`: route authorization and project-scoped row generation tests.
- Create `app/api/projects/[projectId]/admission-share-boards/route.ts`: list/create share boards.
- Create `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.ts`: revoke active share board.
- Create `app/api/public/admission-share/[token]/route.ts`: public read-only share DTO.
- Create `app/api/public/admission-share/[token]/reviews/route.ts`: vendor review submission.
- Create route tests for share-board create/read/review APIs under the same folders.
- Modify `components/reference-ui/ops-reference.jsx`: render project-first admission board, export button, share creation button, vendor decision display.
- Modify `components/reference-ui/ops-reference.test.jsx`: UI smoke for project grouping, export call, share creation, and vendor result rendering.
- Optionally create `app/(public)/share/admission/[token]/page.tsx` after APIs are green if a routed page is needed for manual QA.

---

### Task 1: Schema And Export Whitelist

**Files:**

- Create: `supabase/migrations/20260607160000_admission_project_share_boards.sql`
- Modify: `features/exports/export-definitions.ts`
- Modify: `features/exports/export-definitions.test.ts`
- Modify: `features/exports/export-service.test.ts`

- [ ] **Step 1: Write failing export whitelist tests**

Add tests that call `getAllowedExportFields("admission_recordings", "operator_business")` and assert the field keys are exactly:

```ts
[
  "projectCode",
  "projectName",
  "vendorProduct",
  "streamerName",
  "streamerAccount",
  "recordingUrl",
  "recordingVersion",
  "recordingSubmittedAt",
  "mcnReviewStatus",
  "vendorDecision",
  "vendorRemark",
];
```

Also assert these keys are absent: `vendorReceivableCents`, `grossMarginCents`, `supplierCostCents`, `internalRiskNote`, `settlementPrice`.

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
pnpm test features/exports/export-definitions.test.ts features/exports/export-service.test.ts
```

Expected: fail because `admission_recordings` is not an `ExportKind`.

- [ ] **Step 3: Add the export kind and schema migration**

Add `admission_recordings` to `ExportKind`, `exportDefinitions`, and `isExportKind`. Create the migration with:

- `project_recording_share_boards`
- `project_recording_share_items`
- `project_recording_vendor_reviews`
- check constraints for statuses and decisions
- indexes on organization/project/status, token hash, expiration, and share item lookup
- RLS policies for MCN org members via `public.is_org_member(organization_id)` and `public.can_access_project(project_id)`
- no public direct RLS policy for token access

- [ ] **Step 4: Re-run export tests**

Run:

```bash
pnpm test features/exports/export-definitions.test.ts features/exports/export-service.test.ts
```

Expected: pass.

---

### Task 2: Admission Project Board DTO

**Files:**

- Create: `features/applications/admission-board.ts`
- Create: `features/applications/admission-board.test.ts`
- Modify: `features/applications/application-queries.ts`
- Modify: `app/api/applications/route.ts`
- Create: `app/api/applications/admission-board/route.ts`

- [ ] **Step 1: Write failing DTO tests**

Tests must cover:

- grouping three application rows into two project boards
- taking the highest `recording.version` per application
- counting pending MCN review, approved, rejected, needs changes, vendor selected, vendor backup, vendor rejected, vendor needs changes
- returning detail rows with project, streamer, latestRecording, vendorReview
- not serializing `grossMargin`, `cost`, `payable`, `receivable`, `internalRisk`

- [ ] **Step 2: Run failing DTO tests**

Run:

```bash
pnpm test features/applications/admission-board.test.ts
```

Expected: fail because `admission-board.ts` does not exist.

- [ ] **Step 3: Implement admission-board helpers**

Implement:

- `toAdmissionProjectBoards(rows, latestRecordings, vendorReviews, shareBoards)`
- `toAdmissionRecordingDetails(rows, latestRecordings, vendorReviews)`
- `toAdmissionRecordingExportRows(details)`
- `listAdmissionProjectBoards(client)`
- `listAdmissionProjectRecordings(client, projectId)`

The service should query `project_applications` with project and streamer relations, query latest recordings separately, and query vendor reviews separately.

- [ ] **Step 4: Add route handler**

`GET /api/applications/admission-board` should:

- use `getAdmissionRouteContext`
- block non-MCN staff with 403
- return `{ projects }`

- [ ] **Step 5: Re-run focused tests**

Run:

```bash
pnpm test features/applications/admission-board.test.ts features/applications/application-queries.test.ts
```

Expected: pass.

---

### Task 3: Project Recording Export API

**Files:**

- Create: `app/api/exports/admission-recordings/route.ts`
- Create: `app/api/exports/admission-recordings/route.test.ts`
- Modify: `features/applications/admission-board.ts`

- [ ] **Step 1: Write failing route tests**

Tests must verify:

- MCN staff can export a project
- streamer receives 403
- missing `projectId` receives 400
- export calls `createGovernedExport` with `kind: "admission_recordings"`
- exported rows are generated server-side from `listAdmissionProjectRecordings`, not accepted from arbitrary request rows

- [ ] **Step 2: Run failing route tests**

Run:

```bash
pnpm test app/api/exports/admission-recordings/route.test.ts
```

Expected: fail because route does not exist.

- [ ] **Step 3: Implement route**

Implement `POST /api/exports/admission-recordings` using:

- `createSupabaseServerClient`
- `getAuthContext`
- `isMcnStaff`
- `listAdmissionProjectRecordings`
- `toAdmissionRecordingExportRows`
- `createGovernedExport`

- [ ] **Step 4: Re-run focused route/export tests**

Run:

```bash
pnpm test app/api/exports/admission-recordings/route.test.ts features/exports/export-definitions.test.ts features/exports/export-service.test.ts
```

Expected: pass.

---

### Task 4: Share Board Service And APIs

**Files:**

- Create: `features/applications/admission-share-board.ts`
- Create: `features/applications/admission-share-board.test.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/route.ts`
- Create: `app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.ts`
- Create: tests beside the routes

- [ ] **Step 1: Write failing service tests**

Tests must verify:

- token hashes are deterministic and no plain token is stored in insert payloads
- active share creation locks current recording ids and versions
- creation rejects empty recording/application lists
- creation rejects applications outside the target project
- active share default expires in 7 days
- access code hashes are stored only when provided

- [ ] **Step 2: Run failing service tests**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 3: Implement share-board service**

Implement:

- `createShareToken()`
- `hashShareSecret(value)`
- `createAdmissionShareBoard({ client, actor, projectId, input, now })`
- `listAdmissionShareBoards({ client, actor, projectId })`
- `revokeAdmissionShareBoard({ client, actor, projectId, shareBoardId })`

- [ ] **Step 4: Write and implement route tests**

Routes must:

- block streamers and unauthenticated callers
- return the one-time plain share URL only on create
- never return token hash
- revoke active share boards

- [ ] **Step 5: Re-run focused share-board tests**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts app/api/projects/[projectId]/admission-share-boards
```

Expected: pass.

---

### Task 5: Public Share Read And Vendor Review Sync

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Create: `app/api/public/admission-share/[token]/route.ts`
- Create: `app/api/public/admission-share/[token]/reviews/route.ts`
- Create: route tests beside the public routes

- [x] **Step 1: Write failing sync tests**

Tests must verify:

- expired or revoked share boards reject public read and submit
- public DTO includes only project, streamer display/account, recording URL/version/status, existing vendor decision
- `selected` syncs latest recording to `approved` and application to `recording_approved`
- `rejected` syncs to `rejected` and `recording_rejected`
- `needs_changes` syncs to `needs_changes` and `recording_required`
- `backup` writes vendor review but does not change application/recording state
- `joined` applications skip status sync and keep vendor review as note-only
- stale recording version rejects submit

- [x] **Step 2: Run failing sync tests**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: fail on missing public read/review functions.

- [x] **Step 3: Implement public read and submit service functions**

Implement:

- `getPublicAdmissionShareBoard({ client, token, accessCode, now })`
- `submitVendorAdmissionReviews({ client, token, input, now })`
- `mapVendorDecisionToSyncPatch(decision, applicationStatus)`

- [x] **Step 4: Implement public routes**

Routes must use server-side token lookup and must not require MCN auth.

- [x] **Step 5: Re-run public share tests**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts app/api/public/admission-share
```

Expected: pass.

---

### Task 6: Reference UI Wiring

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing UI tests**

Tests must verify:

- admission route renders project rows first
- project row shows recording counts and vendor decision counts
- expanding a project shows streamer recording details
- export button posts to `/api/exports/admission-recordings`
- share button posts to `/api/projects/:projectId/admission-share-boards`
- vendor decision and remark are visible in detail rows

- [x] **Step 2: Run failing UI test**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: fail because `ScreenAdmission` is still a flat application table.

- [x] **Step 3: Implement UI changes**

Modify `ScreenAdmission` and live actions:

- derive project boards from `applications` if the new API has not loaded
- fetch `/api/applications/admission-board` where available
- render project-first board
- keep existing review/confirm buttons in detail rows
- add export and share actions
- show copied/generated share link message

- [x] **Step 4: Re-run UI smoke**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: pass.

---

### Task 7: Final Verification

**Files:**

- All touched files

- [x] **Step 1: Run focused test chain**

Run:

```bash
pnpm test features/applications/admission-board.test.ts features/applications/admission-share-board.test.ts features/exports/export-definitions.test.ts features/exports/export-service.test.ts app/api/exports/admission-recordings/route.test.ts components/reference-ui/ops-reference.test.jsx
```

- [x] **Step 2: Run broader checks**

Run:

```bash
pnpm type-check
pnpm lint
pnpm test:ui-smoke
```

- [x] **Step 3: Review diff**

Run:

```bash
git diff --check
git diff --stat
```

- [ ] **Step 4: Commit only this feature's files**

Do not stage unrelated dirty files. Stage only files touched by this plan and commit:

```bash
git add docs/superpowers/plans/2026-06-07-admission-project-share-board.md \
  supabase/migrations/20260607160000_admission_project_share_boards.sql \
  features/applications/admission-board.ts \
  features/applications/admission-board.test.ts \
  features/applications/admission-share-board.ts \
  features/applications/admission-share-board.test.ts \
  features/applications/application-queries.ts \
  features/applications/application-repository.ts \
  features/exports/export-definitions.ts \
  features/exports/export-definitions.test.ts \
  features/exports/export-service.test.ts \
  app/api/applications/admission-board/route.ts \
  app/api/exports/admission-recordings/route.ts \
  app/api/exports/admission-recordings/route.test.ts \
  app/api/projects/[projectId]/admission-share-boards/route.ts \
  app/api/projects/[projectId]/admission-share-boards/[shareBoardId]/revoke/route.ts \
  app/api/public/admission-share/[token]/route.ts \
  app/api/public/admission-share/[token]/reviews/route.ts \
  components/reference-ui/ops-reference.jsx \
  components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add admission project share board"
```
