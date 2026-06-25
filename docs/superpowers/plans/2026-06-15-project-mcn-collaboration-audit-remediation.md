# Project MCN Collaboration Audit Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects found in the 2026-06-15 collaboration audit: restore the counter-confirmation flow that the owner-only RLS tightening broke, stop `accept` from resurrecting non-submitted applications, honor share `visibleFields`, make partner-attributed invitations actually work, guard the settlement state machine, and clean up low-risk gaps.

**Architecture:** Keep the owner project as the only project record and `project_collaboration_agreements.id` as the partner permission anchor. Per the follow-up plan, do **not** widen raw `projects` RLS; instead route cross-org (partner) actions through service methods backed by the admin client, where the service re-verifies the active agreement and the actor's organization. The admin client is the boundary; the service-layer checks are the enforcement.

**Tech Stack:** Next.js route handlers, TypeScript domain services, Supabase/Postgres migrations and RLS, Vitest.

---

## Audit Baseline

The 2026-06-15 audit (relative to `codex/ai-runtime-foundation`) found the following. Severity in brackets.

- **[High] Counter confirmation is dead under RLS.** `confirm/route.ts` uses the RLS-scoped session client, but Task 3 of the follow-up plan made `project_collaboration_applications_owner_update` and `project_collaboration_agreements_owner_insert` owner-only. The applicant can neither read (`can_access_project_collaboration` needs a not-yet-existing agreement) nor write the application/agreement, so `confirmProjectCollaborationCounter` always fails. The route test fully mocks the service, so it is untested.
- **[High] `accept` skips the status guard.** In `reviewProjectCollaborationApplication`, the `accept` branch runs before `if (application.status !== "submitted")`, and `activateAgreementFromApplication` only checks for an existing/active agreement — so accepting a `rejected`/`withdrawn`/`expired` application creates an active agreement, and accepting an `owner_countered` one bypasses applicant confirmation.
- **[Medium] `confirmProjectCollaborationCounter` has no role check** — only an org-match check. Once it uses the admin client, any applicant-org role (streamer, finance, …) could activate a binding revenue-share agreement.
- **[Medium] `visibleFields` is stored but never enforced.** `getPublicProjectCollaboration` → `toPublicProject` always returns name/code/summary/terms, ignoring the owner's chosen visible fields.
- **[Medium] Partner attributed invitations cannot run end-to-end.** `invitations/route.ts` uses the session client; `requireProject` cannot read the owner project for a partner (no partner `projects` read policy, by design), so the wired `collaborationId` path dies at `requireProject`.
- **[Medium, latent] Settlement state machine has no precondition guards.** `confirm`/`dispute`/`lock`/`reopen`/`void` never check the current status; `operator_business` can `void` a `locked` batch, bypassing the owner-only `reopen`. Not yet wired to routes.
- **[Low] Cleanups:** `applyToProject` accepts an unused `collaborationId`; public POST falls back to a client that cannot read shares when `SUPABASE_SERVICE_ROLE_KEY` is missing; `mcn_collaboration_terms` has no size bound.

## File Structure

- Modify: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.ts` and its test — use the admin client and admin-client audit.
- Modify: `features/collaborations/project-collaboration-service.ts` and its test — confirm role check, `accept` status guard, `visibleFields` filtering.
- Modify: `app/api/public/project-collaboration/[token]/route.ts` and its test — fail closed when the admin client is unavailable.
- Modify: `app/api/projects/[projectId]/invitations/route.ts` and its test — use the admin client when `collaborationId` is present.
- Modify: `features/applications/application-service.ts` and its test — assert partner streamer ownership; remove the unused `applyToProject` `collaborationId`.
- Modify: `features/collaborations/project-collaboration-settlement-service.ts` and its test — add status-transition guards.
- Modify: `app/api/projects/[projectId]/route.ts` and `app/api/projects/projects-route.test.ts` — bound `mcnCollaborationTerms` size.

---

## Task 1: Restore Counter Confirmation (admin client + role check)

**Files:**

- Modify: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.ts`
- Modify: `app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts`
- Modify: `features/collaborations/project-collaboration-service.ts`
- Modify: `features/collaborations/project-collaboration-service.test.ts`

- [ ] **Step 1: Write the failing service role test**

In `features/collaborations/project-collaboration-service.test.ts`, add:

```ts
it("rejects counter confirmation from a non-MCN applicant role", async () => {
  // owner_countered application owned by org-partner
  await expect(
    confirmProjectCollaborationCounter({
      repo,
      actor: { ...partnerActor, role: "streamer" },
      projectId: "project-1",
      applicationId: "application-countered",
    }),
  ).rejects.toThrow(/MCN/);
});
```

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: FAIL — no role check exists.

- [ ] **Step 2: Add the role check in the service**

In `confirmProjectCollaborationCounter`, before loading the application, add the same gate used by `submitProjectCollaborationApplication`:

```ts
if (!isMcnStaff(actor.role)) {
  throw new Error("Only MCN organization members can confirm a counter");
}
```

Keep the existing `applicantOrganizationId === actor.organizationId` and `status === "owner_countered"` checks.

- [ ] **Step 3: Write the failing route test (admin client)**

In `confirm/route.test.ts`, add a mock for `@/lib/db/supabase-server` exposing `createSupabaseAdminClient`, and assert:

- the route returns 500 when `createSupabaseAdminClient()` returns `null`;
- on success, `confirmProjectCollaborationCounter` is called with a repo built from the admin client (not `context.supabase`).

Run: `pnpm vitest run app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts`

Expected: FAIL — route still uses `context.supabase`.

- [ ] **Step 4: Switch the route to the admin client**

Mirror `app/api/collaboration-projects/route.ts`:

```ts
const context = await getAdmissionRouteContext();
const repoClient = createSupabaseAdminClient();
if (!repoClient) {
  throw new RouteError("Collaboration service is unavailable", 500);
}
const repo = new SupabaseProjectCollaborationRepository(repoClient);
const result = await confirmProjectCollaborationCounter({
  repo,
  audit: (input) => context.audit(repoClient, input), // admin client: actor is partner, org is owner
  actor: actorFromContext(context),
  projectId,
  applicationId,
});
```

Import `createSupabaseAdminClient` and `RouteError`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm vitest run features/collaborations/project-collaboration-service.test.ts app/api/projects/[projectId]/collaboration-applications/[applicationId]/confirm/route.test.ts
```

Expected: PASS.

## Task 2: Guard the `accept` Transition

**Files:**

- Modify: `features/collaborations/project-collaboration-service.ts`
- Modify: `features/collaborations/project-collaboration-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("refuses to accept a non-submitted application", async () => {
  // application-rejected has status "rejected"
  await expect(
    reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: "application-rejected",
      input: { action: "accept" },
    }),
  ).rejects.toThrow(/submitted/);
  expect(repo.agreements).toHaveLength(0);
});

it("refuses to accept an owner_countered application (use confirm instead)", async () => {
  await expect(
    reviewProjectCollaborationApplication({
      repo,
      actor: ownerActor,
      projectId: "project-1",
      applicationId: "application-countered",
      input: { action: "accept" },
    }),
  ).rejects.toThrow(/submitted/);
});
```

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: FAIL — accept currently bypasses the status guard.

- [ ] **Step 2: Move the status guard above the accept branch**

In `reviewProjectCollaborationApplication`, require `application.status === "submitted"` for all owner actions _before_ the `accept` branch:

```ts
const application = await requireApplication(repo, applicationId, projectId);
if (application.status !== "submitted") {
  throw new Error("Only submitted applications can be reviewed");
}
if (input.action === "accept") { ... }
```

The existing idempotency in `activateAgreementFromApplication` (existing-agreement short-circuit) is now only reachable from `confirm`, which is correct.

- [ ] **Step 3: Verify the lifecycle still passes**

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: PASS, including the existing accept/counter/confirm happy-path tests.

## Task 3: Honor Share `visibleFields` in the Public Snapshot

**Files:**

- Modify: `features/collaborations/project-collaboration-service.ts`
- Modify: `features/collaborations/project-collaboration-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("omits summary and terms when visibleFields excludes them", async () => {
  // share created with visibleFields: ["projectName"]
  const result = await getPublicProjectCollaboration({
    repo,
    token: "raw-token",
  });
  expect(result).toMatchObject({ available: true });
  if (result.available) {
    expect(result.project.name).toBeDefined();
    expect(result.project.collaborationSummary).toBe("");
    expect(result.project.collaborationTerms).toEqual({});
  }
});
```

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts`

Expected: FAIL — `toPublicProject` always returns summary/terms.

- [ ] **Step 2: Filter by visibleFields**

Change `toPublicProject(project)` to `toPublicProject(project, visibleFields: string[])` and gate the optional fields:

```ts
function toPublicProject(project, visibleFields) {
  const show = (key: string) => visibleFields.includes(key);
  return {
    id: project.id,
    code: project.code,
    ownerOrganizationName: project.ownerOrganizationName,
    name: show("projectName") ? project.name : "",
    collaborationSummary: show("collaborationSummary")
      ? project.collaborationSummary
      : "",
    collaborationTerms: show("collaborationTerms")
      ? project.collaborationTerms
      : {},
  };
}
```

Pass `snapshot.share.visibleFields` at both call sites (`getPublicProjectCollaboration`, `submitProjectCollaborationInviteApplication`). Default visible fields already include all three, so existing default-share behavior is unchanged.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run features/collaborations/project-collaboration-service.test.ts app/api/public/project-collaboration/[token]/route.test.ts`

Expected: PASS.

## Task 4: Make Partner Attributed Invitations Work End-to-End

**Files:**

- Modify: `app/api/projects/[projectId]/invitations/route.ts`
- Modify: `app/api/projects/[projectId]/invitations/route.test.ts`
- Modify: `features/applications/application-service.ts`
- Modify: `features/applications/application-service.test.ts`

- [ ] **Step 1: Write the failing route test**

Assert that when the body includes `collaborationId`, the route builds the repo from `createSupabaseAdminClient()` (returns 500 if unavailable); and when it does not, the repo uses `context.supabase`. Mock `@/lib/db/supabase-server`.

Run: `pnpm vitest run app/api/projects/[projectId]/invitations/route.test.ts`

Expected: FAIL.

- [ ] **Step 2: Select the client by collaboration presence**

In `invitations/route.ts`, after reading the body:

```ts
const collaborationId = optionalString(body, "collaborationId");
const context = await getAdmissionRouteContext();
let repoClient = context.supabase;
if (collaborationId) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new RouteError("Collaboration service is unavailable", 500);
  repoClient = admin;
}
const repo = new SupabaseApplicationRepository(repoClient);
```

Pass `repo` (and the admin client for audit when `collaborationId` is set) into `inviteStreamerToProject`. Owner-only invites keep the session client and current behavior.

- [ ] **Step 3: Assert partner streamer ownership in the service**

Because the admin client bypasses RLS, `resolveCollaborationAttribution` must also confirm the invited streamer belongs to the partner organization (otherwise a partner could attribute any streamer). In `application-service.test.ts`, add:

```ts
it("rejects partner invitation when the streamer is not in the partner org", async () => { ... });
```

Then extend `requireStreamer`/`resolveCollaborationAttribution` so a partner invite asserts `streamer.organizationId === actor.organizationId` (the contributor org). Keep owner invites unchanged.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run app/api/projects/[projectId]/invitations/route.test.ts features/applications/application-service.test.ts
```

Expected: PASS, with `getActiveCollaborationAgreement` and the streamer-org check called before any partner insert.

> Note: this keeps the follow-up plan's "no raw `projects` RLS widening" rule. If the team prefers RLS instead, the alternative is a SELECT-only `projects` policy gated by `public.can_contribute_to_project`; do not choose both.

## Task 5: Guard the Settlement State Machine

**Files:**

- Modify: `features/collaborations/project-collaboration-settlement-service.ts`
- Modify: `features/collaborations/project-collaboration-settlement-service.test.ts`

- [ ] **Step 1: Write failing transition tests**

```ts
it("cannot confirm or dispute a locked batch", async () => { ... });
it("cannot void a locked batch (owner must reopen first)", async () => { ... });
it("cannot reopen anything except a locked batch", async () => { ... });
```

Run: `pnpm vitest run features/collaborations/project-collaboration-settlement-service.test.ts`

Expected: FAIL — no status guards exist.

- [ ] **Step 2: Add allowed-predecessor guards**

Add a helper `assertStatusIn(before.status, allowed, message)` and apply (proposed transition map — confirm with product before merging):

```text
confirm : generated | reopened          -> partner_confirmed
dispute : generated | reopened          -> partner_disputed
lock    : generated | partner_confirmed | partner_disputed -> locked
reopen  : locked                        -> reopened
void    : generated | partner_confirmed | partner_disputed | reopened -> voided  (NOT locked)
```

Apply the guard in each function after `requireBatch`.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run features/collaborations/project-collaboration-settlement-service.test.ts`

Expected: PASS.

## Task 6: Low-Risk Hardening

**Files:**

- Modify: `features/applications/application-service.ts`, `features/applications/application-service.test.ts`
- Modify: `app/api/public/project-collaboration/[token]/route.ts`, `app/api/public/project-collaboration/[token]/route.test.ts`
- Modify: `app/api/projects/[projectId]/route.ts`, `app/api/projects/projects-route.test.ts`

- [ ] **Step 1: Remove the unused `applyToProject` collaborationId**

Drop `collaborationId?` from the `applyToProject` input type (it is never read). Self-signups are not collaboration-attributed; attribution flows only through invites/live-ops. Update any caller/test.

- [ ] **Step 2: Fail closed on missing service role key in public POST**

In `public/project-collaboration/[token]/route.ts` POST, replace `const repoClient = createSupabaseAdminClient() ?? authClient;` with an explicit guard that throws `RouteError("Public collaboration service is unavailable", 503)` when the admin client is null (the session client cannot read shares under RLS, so the fallback silently fails). Add a test for the 503.

- [ ] **Step 3: Bound `mcnCollaborationTerms`**

In `normalizeProjectTerms` (project PATCH route), reject objects whose serialized size exceeds a sane cap (e.g. 8 KB) or whose key count exceeds e.g. 50, returning a 400 via the existing error path. Add a test.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run features/applications/application-service.test.ts app/api/public/project-collaboration/[token]/route.test.ts app/api/projects/projects-route.test.ts
```

Expected: PASS.

## Task 7: Final Verification

**Files:**

- All files touched by Tasks 1-6.

- [ ] **Step 1: Run the focused collaboration suite**

Run:

```bash
pnpm vitest run features/collaborations features/applications/application-service.test.ts lib/db/project-collaboration-schema-contract.test.ts lib/db/project-collaboration-execution-schema-contract.test.ts app/api/collaboration-projects app/api/projects/[projectId]/collaboration-applications app/api/projects/[projectId]/collaboration-shares app/api/public/project-collaboration app/api/projects/[projectId]/invitations
```

Expected: PASS.

- [ ] **Step 2: Run repo static gates**

Run:

```bash
git diff --check
pnpm type-check
pnpm lint
```

Expected: exit code 0. The known Babel deopt warning for `components/reference-ui/ops-reference.jsx` is acceptable if there are no lint errors.

- [ ] **Step 3: Run broader regression before commit**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS.

## Out of Scope / Follow-On

- A real RLS integration test harness (the current schema-contract tests only regex the SQL, so RLS regressions like the Task 1 bug are invisible). Strongly recommended as a separate slice before settlement routes ship.
- Wiring settlement service into routes — Task 5 only guards the existing service; it does not expose it.
