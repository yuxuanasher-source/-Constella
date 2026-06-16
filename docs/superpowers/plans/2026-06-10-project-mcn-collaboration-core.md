# Project MCN Collaboration Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice for cross-MCN project collaboration: project collaboration settings, share-link creation/revocation, logged-in partner application, owner review/counter, and agreement activation.

**Architecture:** Reuse the repo's existing domain-service + Supabase-repository + route-handler pattern. Keep one owner `projects` row as the source of truth and introduce `project_collaboration_*` records as the authorization and audit anchors.

**Tech Stack:** Next.js route handlers, TypeScript, Supabase/Postgres migrations with RLS, Vitest, existing RBAC/audit helpers.

---

## Scope

This plan implements the core collaboration lifecycle from the approved design at `docs/superpowers/specs/2026-06-10-project-mcn-collaboration-design.md`. It deliberately leaves execution-chain attribution, MCN-to-MCN settlement, and full UI surfaces for the next slice after the agreement model is tested and stable.

## File Structure

- Modify: `features/projects/project-service.ts` to accept collaboration switch, summary, and terms fields.
- Modify: `features/projects/project-repository.ts` to select and persist collaboration fields.
- Modify: `app/api/projects/[projectId]/route.ts` to expose collaboration fields through existing PATCH.
- Modify: `features/projects/project-service.test.ts` to cover the project collaboration settings patch.
- Create: `features/collaborations/project-collaboration-service.ts` for token hashing, share creation/revocation, public snapshot, application submission, owner review, counter confirmation, and DTO mapping.
- Create: `features/collaborations/project-collaboration-service.test.ts` for red-green coverage of the lifecycle.
- Create: `app/api/projects/[projectId]/collaboration-shares/route.ts` for owner list/create share.
- Create: `app/api/projects/[projectId]/collaboration-shares/[shareId]/revoke/route.ts` for owner revoke.
- Create: `app/api/public/project-collaboration/[token]/route.ts` for public share snapshot and logged-in application submission.
- Create: `app/api/projects/[projectId]/collaboration-applications/route.ts` for owner application listing.
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.ts` for owner accept/reject/counter.
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.ts` for applicant counter confirmation.
- Create matching route tests under each new route folder.
- Create: `lib/db/project-collaboration-schema-contract.test.ts` for migration contract coverage.
- Create: `supabase/migrations/20260610120000_project_mcn_collaboration_core.sql` for core schema, indexes, RLS helpers, and policies.

## Task 1: Project Collaboration Settings

**Files:**

- Modify: `features/projects/project-service.ts`
- Modify: `features/projects/project-repository.ts`
- Modify: `app/api/projects/[projectId]/route.ts`
- Test: `features/projects/project-service.test.ts`

- [ ] **Step 1: Write the failing service test**

Add a test that calls `updateProjectBasics` as `ops_manager` with:

```ts
input: {
  isOpenToMcnCollaboration: true,
  mcnCollaborationSummary: "Partner MCNs can contribute verified streamers.",
  mcnCollaborationTerms: { revenueShareHint: "8-12%" },
}
```

Expected repository patch:

```ts
{
  is_open_to_mcn_collaboration: true,
  mcn_collaboration_summary: "Partner MCNs can contribute verified streamers.",
  mcn_collaboration_terms: { revenueShareHint: "8-12%" },
}
```

Run: `pnpm vitest run features/projects/project-service.test.ts`

Expected: FAIL because the new input fields are not mapped.

- [ ] **Step 2: Implement the minimal project patch**

Extend `ProjectRecord`, `UpdateProjectBasicsInput`, `mapBasicProjectPatch`, the Supabase select list, and the PATCH body mapping with the three collaboration fields.

- [ ] **Step 3: Verify the project service test passes**

Run: `pnpm vitest run features/projects/project-service.test.ts`

Expected: PASS.

## Task 2: Core Collaboration Domain Service

**Files:**

- Create: `features/collaborations/project-collaboration-service.ts`
- Test: `features/collaborations/project-collaboration-service.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover these behaviors in one focused test file:

```ts
it("creates an active share only for an open owner project and returns the raw token once", async () => {});
it("returns a public snapshot without token hashes or private project fields", async () => {});
it("rejects duplicate partner applications and owner self-applications", async () => {});
it("accepts an application and creates an active agreement idempotently", async () => {});
it("counters an application and requires applicant confirmation before agreement activation", async () => {});
it("rejects counter confirmation unless the application is owner_countered", async () => {});
```

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: FAIL because the service file does not exist.

- [ ] **Step 2: Implement service types and repository interface**

Define:

```ts
export type CollaborationShareStatus = "active" | "expired" | "revoked";
export type CollaborationApplicationStatus =
  | "submitted"
  | "approved"
  | "owner_countered"
  | "rejected"
  | "withdrawn"
  | "expired";
export type CollaborationAgreementStatus = "active" | "suspended" | "ended";
```

Expose functions:

```ts
createProjectCollaborationShare(...)
revokeProjectCollaborationShare(...)
getPublicProjectCollaboration(...)
submitProjectCollaborationApplication(...)
listProjectCollaborationApplications(...)
reviewProjectCollaborationApplication(...)
confirmProjectCollaborationCounter(...)
```

- [ ] **Step 3: Implement validation and state transitions**

Use basis points in `0..10000`, reject owner self-application, reject duplicate pending applications, reject duplicate active agreements, make accept idempotent through `getAgreementByApplicationId`, and require counter confirmation from the applicant organization.

- [ ] **Step 4: Verify service tests pass**

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: PASS.

## Task 3: Database Contract and Migration

**Files:**

- Create: `lib/db/project-collaboration-schema-contract.test.ts`
- Create: `supabase/migrations/20260610120000_project_mcn_collaboration_core.sql`

- [ ] **Step 1: Write the failing schema contract**

Assert the migration contains:

```text
alter table public.projects add column if not exists is_open_to_mcn_collaboration
create table if not exists public.project_collaboration_shares
create table if not exists public.project_collaboration_applications
create table if not exists public.project_collaboration_agreements
public.can_access_project_collaboration
public.can_manage_project_collaboration
public.can_contribute_to_project
```

Run: `pnpm vitest run lib/db/project-collaboration-schema-contract.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 2: Write the migration**

Add project columns, core tables, status checks, bps checks, uniqueness indexes, RLS helpers, owner/partner policies, and updated-at triggers. Use `security definer` helper functions that follow existing `public.is_org_member` and project-ownership patterns.

- [ ] **Step 3: Verify the schema contract passes**

Run: `pnpm vitest run lib/db/project-collaboration-schema-contract.test.ts`

Expected: PASS.

## Task 4: API Routes

**Files:**

- Create: `app/api/projects/[projectId]/collaboration-shares/route.ts`
- Create: `app/api/projects/[projectId]/collaboration-shares/route.test.ts`
- Create: `app/api/projects/[projectId]/collaboration-shares/[shareId]/revoke/route.ts`
- Create: `app/api/projects/[projectId]/collaboration-shares/[shareId]/revoke/route.test.ts`
- Create: `app/api/public/project-collaboration/[token]/route.ts`
- Create: `app/api/public/project-collaboration/[token]/route.test.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/route.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/route.test.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.test.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.ts`
- Create: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Mock the collaboration service and route context. Assert:

```ts
POST collaboration-shares returns shareUrl and no tokenHash.
POST public project-collaboration applications requires auth context and forwards applicant organization.
POST review accepts action "accept" | "reject" | "counter".
POST confirm activates a countered application for the applicant.
```

Run:

```bash
pnpm vitest run app/api/projects/[projectId]/collaboration-shares/route.test.ts app/api/public/project-collaboration/[token]/route.test.ts app/api/projects/[projectId]/collaboration-applications/route.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts
```

Expected: FAIL because the route files do not exist.

- [ ] **Step 2: Implement routes**

Use `getAdmissionRouteContext`, `actorFromContext`, `readJsonBody`, `jsonError`, and `RouteError` to stay consistent with admission routes. Guard owner actions with `owner` or `ops_manager`; allow public GET without auth; require auth for public POST application submission.

- [ ] **Step 3: Verify route tests pass**

Run the same route-test command.

Expected: PASS.

## Task 5: Focused Acceptance

**Files:**

- All files from Tasks 1-4

- [ ] **Step 1: Run focused core tests**

Run:

```bash
pnpm vitest run features/projects/project-service.test.ts features/collaborations/project-collaboration-service.test.ts lib/db/project-collaboration-schema-contract.test.ts app/api/projects/[projectId]/collaboration-shares/route.test.ts app/api/projects/[projectId]/collaboration-shares/[shareId]/revoke/route.test.ts app/api/public/project-collaboration/[token]/route.test.ts app/api/projects/[projectId]/collaboration-applications/route.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo-level static verification**

Run:

```bash
pnpm type-check
pnpm lint
```

Expected: exit code 0 for both commands. The known Babel deopt warning for `components/reference-ui/ops-reference.jsx` can be ignored if no lint errors accompany it.

## Follow-On Slice After Core

The next plan should wire active agreements into `project_applications`, `recording_submissions`, `project_streamers`, `live_tasks`, `live_reports`, and settlement tables, then add owner/partner UI. That work depends on this slice because the active `project_collaboration_agreements.id` becomes the foreign key and permission source.
