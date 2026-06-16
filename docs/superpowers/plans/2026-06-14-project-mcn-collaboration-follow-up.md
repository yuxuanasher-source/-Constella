# Project MCN Collaboration Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps found in the 2026-06-14 collaboration audit: keep share links as applications, make partner execution use active agreements, harden RLS, and complete scoped owner/partner UI.

**Architecture:** Keep the owner project as the only project record. Use `project_collaboration_agreements.id` as the partner permission and attribution anchor, but do partner-facing writes through explicit service methods and safe DTO routes instead of widening raw project-table access.

**Tech Stack:** Next.js route handlers, TypeScript domain services, Supabase/Postgres migrations and RLS, Vitest, existing reference UI tests.

---

## Audit Baseline

The core plan at `docs/superpowers/plans/2026-06-10-project-mcn-collaboration-core.md` is implemented and its focused tests pass. The follow-up work is needed because later execution/UI slices were partially added before a plan existed:

- `/api/collaboration-projects/join` currently calls `acceptProjectCollaborationInvite`, which activates an agreement from a pasted share link without owner review.
- `app/api/projects/[projectId]/invitations/route.ts` does not pass `collaborationId`, so partner project cards cannot write attributed applications through the real API.
- RLS for `project_collaboration_applications` allows broad applicant updates.
- Attribution exists for applications, recordings, and project streamers, but not yet for live tasks, live reports, or collaboration settlement.
- Owner UI accepts applications, but counter/reject and applicant counter confirmation are not fully surfaced.

## File Structure

- Modify: `features/collaborations/project-collaboration-service.ts` to remove direct share-link agreement activation and replace it with application submission from invite links.
- Modify: `features/collaborations/project-collaboration-service.test.ts` to assert pasted invite links create pending applications, not agreements.
- Modify: `app/api/collaboration-projects/join/route.ts` and `app/api/collaboration-projects/join/route.test.ts` to return a submitted application and `pendingOwnerReview: true`.
- Modify: `components/reference-ui/ops-reference.jsx` and `components/reference-ui/ops-reference.test.jsx` to rename the partner flow from join to application submission and collect requested share.
- Modify: `app/api/projects/[projectId]/invitations/route.ts` to accept and pass optional `collaborationId`.
- Modify: `features/applications/application-service.test.ts` and add route coverage for partner collaboration invitations.
- Modify: `features/projects/project-ui-dto.ts` and `features/projects/project-ui-dto.test.ts` to expose `collaborationId` on partner project cards.
- Modify: `supabase/migrations/20260610120000_project_mcn_collaboration_core.sql` and `lib/db/project-collaboration-schema-contract.test.ts` to tighten collaboration application RLS.
- Modify: live-operation services/routes after identifying the existing task/report creation entrypoints.
- Create: `lib/db/project-collaboration-settlement-schema-contract.test.ts` for MCN-to-MCN settlement tables in the next settlement slice.

## Task 1: Make Share Links Submit Applications Only

**Files:**

- Modify: `features/collaborations/project-collaboration-service.ts`
- Modify: `features/collaborations/project-collaboration-service.test.ts`
- Modify: `app/api/collaboration-projects/join/route.ts`
- Modify: `app/api/collaboration-projects/join/route.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write the failing service regression**

In `features/collaborations/project-collaboration-service.test.ts`, replace the direct-join expectation with:

```ts
it("submits an invite-link application without activating an agreement", async () => {
  const repo = new MemoryCollaborationRepository([openProject()]);
  await createProjectCollaborationShare({
    repo,
    actor: ownerActor,
    projectId: "project-1",
    input: {},
    now: "2026-06-10T00:00:00.000Z",
    tokenFactory: () => "raw-token",
  });

  const result = await submitProjectCollaborationInviteApplication({
    repo,
    actor: partnerActor,
    input: {
      inviteLink: "http://localhost:3000/share/project-collaboration/raw-token",
      requestedRevenueShareBps: 900,
      applicantNote: "We can bring verified streamers.",
    },
    now: "2026-06-11T00:00:00.000Z",
  });

  expect(result).toEqual({
    application: expect.objectContaining({
      projectId: "project-1",
      applicantOrganizationId: "org-partner",
      status: "submitted",
      requestedRevenueShareBps: 900,
      finalRevenueShareBps: null,
    }),
    project: expect.objectContaining({ id: "project-1" }),
    pendingOwnerReview: true,
  });
  expect(repo.agreements).toHaveLength(0);
});
```

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: FAIL because `submitProjectCollaborationInviteApplication` does not exist.

- [x] **Step 2: Implement the service change**

In `features/collaborations/project-collaboration-service.ts`, remove `acceptProjectCollaborationInvite` from exported route usage and add:

```ts
export async function submitProjectCollaborationInviteApplication({
  repo,
  audit,
  actor,
  input,
  now = new Date().toISOString(),
}: {
  repo: ProjectCollaborationRepository;
  audit?: ProjectCollaborationAuditWriter;
  actor: ProjectCollaborationActor;
  input: AcceptCollaborationInviteInput;
  now?: string;
}) {
  const token = extractProjectCollaborationInviteToken(input.inviteLink);
  const application = await submitProjectCollaborationApplication({
    repo,
    audit,
    actor,
    token,
    input: {
      requestedRevenueShareBps: input.requestedRevenueShareBps ?? 0,
      applicantNote: input.applicantNote,
    },
    now,
  });

  const snapshot = await requireAvailablePublicShare(repo, token, now);
  return {
    application,
    project: toPublicProject(snapshot.project),
    pendingOwnerReview: true as const,
  };
}
```

- [x] **Step 3: Update route and UI tests**

Update `app/api/collaboration-projects/join/route.test.ts` so the mocked service is `submitProjectCollaborationInviteApplication` and the response contains `application.status: "submitted"` plus `pendingOwnerReview: true`.

Update the UI test in `components/reference-ui/ops-reference.test.jsx` so the partner paste-link form asserts the success copy says the application was submitted for owner review, not that the project was joined.

- [x] **Step 4: Verify the direct-activation path is gone**

Run:

```bash
pnpm vitest run features/collaborations/project-collaboration-service.test.ts app/api/collaboration-projects/join/route.test.ts components/reference-ui/ops-reference.test.jsx
rg -n "acceptProjectCollaborationInvite|alreadyJoined" features app components
```

Expected: tests PASS, and `rg` returns no production references to `acceptProjectCollaborationInvite`.

## Task 2: Pass Collaboration Attribution Through Partner Invitations

**Files:**

- Modify: `features/projects/project-ui-dto.ts`
- Modify: `features/projects/project-ui-dto.test.ts`
- Modify: `app/api/projects/[projectId]/invitations/route.ts`
- Modify: `features/applications/application-service.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [x] **Step 1: Write failing API/UI tests**

In the project invitation route test, assert the body can include:

```ts
{
  "streamerId": "streamer-1",
  "collaborationId": "agreement-1"
}
```

and that `inviteStreamerToProject` receives:

```ts
input: {
  projectId: "project-1",
  streamerId: "streamer-1",
  collaborationId: "agreement-1",
}
```

Add a UI test that clicks invite on a partner collaboration project card and expects the request body to include `collaborationId`.

- [x] **Step 2: Expose `collaborationId` on partner project cards**

Ensure `toCollaborationProjectCardDtos` maps:

```ts
collaborationId: row.agreement.id,
collaborationRole: "partner",
```

and the test asserts both fields are present.

- [x] **Step 3: Wire the route and action**

In `app/api/projects/[projectId]/invitations/route.ts`, pass:

```ts
collaborationId: optionalString(body, "collaborationId"),
```

In `components/reference-ui/ops-reference.jsx`, send:

```js
body: JSON.stringify({
  streamerId,
  collaborationId: project?.collaborationId,
}),
```

- [x] **Step 4: Verify partner attribution**

Run:

```bash
pnpm vitest run features/projects/project-ui-dto.test.ts features/applications/application-service.test.ts app/api/projects/[projectId]/invitations/route.test.ts components/reference-ui/ops-reference.test.jsx
```

Expected: PASS, with `repo.getActiveCollaborationAgreement` called before any partner application insert.

## Task 3: Harden Collaboration RLS

**Files:**

- Modify: `supabase/migrations/20260610120000_project_mcn_collaboration_core.sql`
- Modify: `lib/db/project-collaboration-schema-contract.test.ts`

- [x] **Step 1: Write failing RLS contract assertions**

Add assertions that the migration does not contain broad applicant update checks:

```ts
expect(migration).not.toContain(
  "or public.is_org_member(applicant_organization_id)",
);
expect(migration).toContain("project_collaboration_applications_owner_update");
expect(migration).toContain(
  "public.can_manage_project_collaboration(project_id)",
);
```

Run: `pnpm vitest run lib/db/project-collaboration-schema-contract.test.ts`

Expected: FAIL against the current broad update policy.

- [x] **Step 2: Restrict direct table writes**

Change `project_collaboration_applications_owner_update` so both `using` and `with check` require only:

```sql
public.can_manage_project_collaboration(project_id)
```

Keep applicant actions through route/service methods backed by the server/admin client, where the service enforces applicant organization checks.

- [x] **Step 3: Verify RLS contract**

Run:

```bash
pnpm vitest run lib/db/project-collaboration-schema-contract.test.ts lib/db/project-collaboration-execution-schema-contract.test.ts
```

Expected: PASS.

## Task 4: Complete Owner Review UI States

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: route tests under `app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/`
- Modify: route tests under `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/`

- [x] **Step 1: Write UI tests for reject and counter**

Add tests that owner project detail can:

```ts
await user.click(screen.getByRole("button", { name: "反报价" }));
await user.type(screen.getByLabelText("反报价比例"), "8");
await user.click(screen.getByRole("button", { name: "提交反报价" }));
```

and:

```ts
await user.click(screen.getByRole("button", { name: "拒绝" }));
await user.type(screen.getByLabelText("拒绝原因"), "当前档期不匹配。");
await user.click(screen.getByRole("button", { name: "确认拒绝" }));
```

Expected requests:

```ts
{ action: "counter", ownerCounterRevenueShareBps: 800 }
{ action: "reject", rejectionReason: "当前档期不匹配。" }
```

- [x] **Step 2: Implement controls**

In the collaboration panel, show accept, counter, and reject for `submitted` applications. Disable reject submit until a nonblank reason exists.

- [x] **Step 3: Add applicant confirmation surface**

For partner-side pending projects, show `owner_countered` applications and post to:

```text
/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm
```

Only show this action to the applicant organization.

- [x] **Step 4: Verify UI workflow tests**

Run:

```bash
pnpm vitest run components/reference-ui/ops-reference.test.jsx app/api/projects/[projectId]/collaboration-applications/[applicationId]/review/route.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts
```

Expected: PASS.

## Task 5: Plan and Implement Live Task/Report Attribution

**Files:**

- Inspect before editing: existing live task and report service/route files under `features/live-operations/` and `app/api/live-*`.
- Modify: the actual live task creation service and route after inspection.
- Modify: the actual live report submission/confirmation service and route after inspection.
- Test: focused live-operation service and route tests.

- [x] **Step 1: Identify live operation write entrypoints**

Run:

```bash
rg -n "createLiveTask|live_tasks|insert\\(|submitLiveReport|live_reports|confirmLiveReport" features/live-operations app/api -g "*.ts"
```

Expected: list the exact service methods and route files to edit before implementation.

- [x] **Step 2: Write failing attribution tests**

For task creation and report submission, add tests that partner writes include:

```ts
{
  collaborationId: "agreement-1",
  contributorOrganizationId: "org-partner",
}
```

and reject missing or inactive agreements.

- [x] **Step 3: Implement minimal attribution**

Thread optional `collaborationId` from partner routes/actions into the live services. Resolve the active agreement before inserting `live_tasks` or `live_reports`; do not trust front-end organization fields.

- [x] **Step 4: Verify live-operation slice**

Run the focused live-operation test files identified in Step 1 plus:

```bash
pnpm type-check
```

Expected: PASS.

## Task 6: Add MCN-to-MCN Collaboration Settlement Slice

**Files:**

- Create: `lib/db/project-collaboration-settlement-schema-contract.test.ts`
- Create: a new Supabase migration for collaboration revenue and settlement tables.
- Create: `features/collaborations/project-collaboration-settlement-service.ts`
- Create: `features/collaborations/project-collaboration-settlement-service.test.ts`
- Create route handlers only after the service tests are green.

- [x] **Step 1: Write schema contract**

Assert migration creates:

```text
project_collaboration_revenue_records
project_collaboration_settlement_batches
project_collaboration_settlement_items
can_read_collaboration_settlement
```

and a uniqueness guard so one confirmed revenue record cannot be consumed twice by the same agreement and batch type.

- [x] **Step 2: Write service tests**

Cover:

```ts
it("generates partner receivable settlement from confirmed project revenue", async () => {});
it("does not consume draft or void revenue records", async () => {});
it("prevents duplicate settlement consumption", async () => {});
it("lets partner confirm or dispute only its own settlement", async () => {});
it("lets owner lock, reopen, or void according to role", async () => {});
```

- [x] **Step 3: Implement calculation**

Use:

```ts
partnerAmount = (confirmedProjectRevenue * agreement.revenueShareBps) / 10000;
```

Store the revenue source ids and calculation snapshot on each settlement item.

- [x] **Step 4: Verify settlement slice**

Run:

```bash
pnpm vitest run lib/db/project-collaboration-settlement-schema-contract.test.ts features/collaborations/project-collaboration-settlement-service.test.ts
pnpm type-check
pnpm lint
```

Expected: PASS.

## Task 7: Final Verification

**Files:**

- All files touched by Tasks 1-6.

- [x] **Step 1: Run focused collaboration suite**

Run:

```bash
pnpm vitest run features/collaborations features/applications/application-service.test.ts lib/db/project-collaboration-schema-contract.test.ts lib/db/project-collaboration-execution-schema-contract.test.ts components/reference-ui/ops-reference.test.jsx app/api/collaboration-projects app/api/projects/[projectId]/collaboration-applications app/api/projects/[projectId]/collaboration-shares app/api/public/project-collaboration
```

Expected: PASS.

- [x] **Step 2: Run repo static gates**

Run:

```bash
git diff --check
pnpm type-check
pnpm lint
```

Expected: exit code 0. The known Babel deopt warning for `components/reference-ui/ops-reference.jsx` is acceptable if there are no lint errors.

- [x] **Step 3: Run broader regression before commit**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS.
