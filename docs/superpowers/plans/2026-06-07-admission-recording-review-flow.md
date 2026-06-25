# Admission Recording Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project admission recordings follow a clear MCN-first-review, vendor-review, MCN-final-confirmation workflow.

**Architecture:** Reuse the existing `project_applications`, `recording_submissions`, `project_recording_share_boards`, `project_recording_share_items`, and `project_recording_vendor_reviews` tables. Keep state transition enforcement in `features/applications/*` services, then adapt MCN, vendor, and streamer UI surfaces to those service outcomes.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/PostgREST, Vitest, React Testing Library, existing reference UI components.

---

## File Map

- `features/applications/admission-share-board.ts`: enforce share eligibility and vendor decision sync rules.
- `features/applications/admission-share-board.test.ts`: service-level regression tests for share creation and vendor sync.
- `features/applications/admission-board.ts`: admission board DTOs, counts, and recording detail shaping.
- `features/applications/admission-board.test.ts`: DTO/count tests for MCN-visible vendor decisions and next actions.
- `features/applications/application-state.ts`: application and recording transition helpers if a new derived helper is needed.
- `components/reference-ui/ops-reference.jsx`: MCN admission board and recording detail UI.
- `components/reference-ui/ops-reference.test.jsx`: MCN UI smoke tests.
- `app/share/admission/[token]/admission-share-page-client.tsx`: vendor decision UI and client-side validation.
- `app/share/admission/[token]/admission-share-page-client.test.tsx`: vendor page tests.
- `features/recordings/project-announcements.ts`: streamer project announcement DTO if feedback fields need to surface there.
- `components/reference-ui/streamer-mobile-reference.jsx`: streamer project recording feedback UI.
- `components/reference-ui/streamer-mobile-reference.test.jsx`: streamer mobile smoke tests.
- `components/reference-ui/streamer-desktop-reference.jsx`: streamer desktop project recording feedback UI.
- `components/reference-ui/streamer-desktop-reference.test.jsx`: streamer desktop smoke tests.

## Task 1: Lock Share Eligibility To MCN-Approved Recordings

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing service tests for approved-only share creation**

Add tests to `features/applications/admission-share-board.test.ts`:

```ts
it("rejects explicitly selected recordings that are not MCN approved", async () => {
  const repo = createRepo({
    listShareableApplications: vi.fn().mockResolvedValue([
      {
        id: "app-1",
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "recording_reviewing",
      },
    ]),
    listLatestRecordings: vi.fn().mockResolvedValue([
      {
        id: "rec-1",
        applicationId: "app-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        version: 1,
        status: "submitted",
      },
    ]),
  });

  await expect(
    createAdmissionShareBoard({
      repo,
      actor,
      projectId: "project-1",
      input: { title: "Vendor review", applicationIds: ["app-1"] },
      now: "2026-06-07T00:00:00.000Z",
      tokenFactory: () => "plain-token",
    }),
  ).rejects.toThrow("Every shared recording must be approved by MCN");
});

it("shares only MCN-approved recordings when creating a project-level board", async () => {
  const repo = createRepo({
    listShareableApplications: vi.fn().mockResolvedValue([
      {
        id: "app-approved",
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "recording_approved",
      },
      {
        id: "app-reviewing",
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-2",
        status: "recording_reviewing",
      },
    ]),
    listLatestRecordings: vi.fn().mockResolvedValue([
      {
        id: "rec-approved",
        applicationId: "app-approved",
        projectId: "project-1",
        streamerId: "streamer-1",
        version: 1,
        status: "approved",
      },
      {
        id: "rec-reviewing",
        applicationId: "app-reviewing",
        projectId: "project-1",
        streamerId: "streamer-2",
        version: 1,
        status: "submitted",
      },
    ]),
  });

  await createAdmissionShareBoard({
    repo,
    actor,
    projectId: "project-1",
    input: { title: "Vendor review" },
    now: "2026-06-07T00:00:00.000Z",
    tokenFactory: () => "plain-token",
  });

  expect(repo.shareItemInserts).toEqual([
    expect.objectContaining({
      applicationId: "app-approved",
      recordingSubmissionId: "rec-approved",
    }),
  ]);
});
```

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: the new tests fail because `ShareableRecording` does not yet carry `status`, and share creation accepts any latest recording.

- [ ] **Step 3: Add recording status to shareable recordings**

Update `features/applications/admission-share-board.ts`:

```ts
export type ShareableRecording = {
  id: string;
  applicationId: string;
  projectId: string;
  streamerId: string;
  version: number;
  status: RecordingReviewStatus;
};
```

Change the repository select:

```ts
.select("id, application_id, project_id, streamer_id, version, status")
```

Update the row type and mapper:

```ts
type ShareableRecordingRow = {
  id: string;
  application_id: string;
  project_id: string;
  streamer_id: string;
  version: number;
  status: RecordingReviewStatus;
};

function toShareableRecording(row: ShareableRecordingRow): ShareableRecording {
  return {
    id: row.id,
    applicationId: row.application_id,
    projectId: row.project_id,
    streamerId: row.streamer_id,
    version: row.version,
    status: row.status,
  };
}
```

- [ ] **Step 4: Enforce MCN-approved eligibility in service**

In `createAdmissionShareBoard`, derive eligible applications using both application and recording status:

```ts
function isMcnApprovedShareCandidate(
  application: ShareableApplication,
  recording: ShareableRecording | undefined,
) {
  return (
    application.status === "recording_approved" &&
    recording?.status === "approved"
  );
}
```

Use it:

```ts
const approvedApplications = applications.filter((application) =>
  isMcnApprovedShareCandidate(
    application,
    recordingsByApplication.get(application.id),
  ),
);

if (
  isExplicitSelection &&
  approvedApplications.length !== applications.length
) {
  throw new Error("Every shared recording must be approved by MCN");
}

const applicationsToShare = isExplicitSelection
  ? applications
  : approvedApplications;

if (applicationsToShare.length === 0) {
  throw new Error("Share board requires at least one MCN-approved recording");
}
```

- [ ] **Step 5: Run service tests and verify pass**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: all admission share board service tests pass.

- [ ] **Step 6: Add MCN UI smoke for no approved recordings**

In `components/reference-ui/ops-reference.test.jsx`, add a case where the board has `recordingCount: 1`, `mcnApproved: 0`, and local recording status is `submitted`. Click `创建分享链接`.

Expected assertion:

```js
expect(
  await screen.findByText("当前项目暂无 MCN 已通过的可分享录屏"),
).toBeInTheDocument();
expect(
  fetchMock.mock.calls.some(([url]) =>
    String(url).includes("/admission-share-boards"),
  ),
).toBe(false);
```

- [ ] **Step 7: Update MCN UI share filtering**

In `components/reference-ui/ops-reference.jsx`, replace local shareable filtering with:

```js
function isMcnApprovedAdmissionRecording(application) {
  return (
    application.status === "recording_approved" &&
    application.latestRecording?.status === "approved"
  );
}
```

Use this in `createShareBoard`. If neither local rows nor server board counts indicate approved recordings, show:

```js
setAdmissionMessage("当前项目暂无 MCN 已通过的可分享录屏");
```

When local data is stale but `board.counts.mcnApproved > 0`, allow project-level share creation without `applicationIds` so the server can choose eligible rows.

- [ ] **Step 8: Run UI smoke**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: ops reference tests pass.

## Task 2: Make Vendor Backup A First-Class Visible Outcome

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `features/applications/admission-board.ts`
- Modify: `features/applications/admission-board.test.ts`

- [ ] **Step 1: Write failing service test for backup persistence**

Add to `features/applications/admission-share-board.test.ts`:

```ts
it("persists vendor backup decisions without changing MCN-approved statuses", async () => {
  const repo = createRepo({
    getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
  });

  await submitVendorAdmissionReviews({
    repo,
    token: "plain-token",
    input: {
      reviewerName: "Vendor",
      items: [
        {
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          decision: "backup",
          remark: "Keep as backup.",
        },
      ],
    },
    now: "2026-06-07T08:00:00.000Z",
  });

  expect(repo.updateRecordingReviewForVendor).not.toHaveBeenCalled();
  expect(repo.updateApplicationStatusForVendor).not.toHaveBeenCalled();
  expect(repo.upsertVendorReviews).toHaveBeenCalledWith([
    expect.objectContaining({
      decision: "backup",
      remark: "Keep as backup.",
      syncedApplicationStatus: null,
      syncedRecordingStatus: null,
      syncStatus: "synced",
    }),
  ]);
});
```

- [ ] **Step 2: Run service test and verify failure**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: fails because `backup` currently returns `syncStatus: "skipped"`.

- [ ] **Step 3: Change backup sync status**

Update `mapVendorDecisionToSyncPatch`:

```ts
if (decision === "backup") {
  return {
    applicationStatus: null,
    recordingStatus: null,
    syncStatus: "synced",
  };
}
```

Keep `pending` as skipped.

- [ ] **Step 4: Run service test and verify pass**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: pass.

- [ ] **Step 5: Add admission board DTO test for backup**

In `features/applications/admission-board.test.ts`, add or update a detail conversion test:

```ts
expect(details[0].vendorReview).toEqual(
  expect.objectContaining({
    decision: "backup",
    remark: "Keep as backup.",
  }),
);
```

Also assert project counts:

```ts
expect(board.counts.vendorBackup).toBe(1);
```

- [ ] **Step 6: Run admission board tests**

Run:

```bash
pnpm test features/applications/admission-board.test.ts
```

Expected: pass.

## Task 3: Sync Vendor Rejection And Change Requests To Recording Details

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `features/applications/admission-board.ts`
- Modify: `features/applications/admission-board.test.ts`

- [ ] **Step 1: Write failing tests for vendor rejected and needs_changes sync**

Add table tests to `features/applications/admission-share-board.test.ts`:

```ts
it.each([
  {
    decision: "rejected",
    expectedApplicationStatus: "recording_rejected",
    expectedRecordingStatus: "rejected",
    remark: "Quality is not enough.",
  },
  {
    decision: "needs_changes",
    expectedApplicationStatus: "recording_required",
    expectedRecordingStatus: "needs_changes",
    remark: "Please add gameplay intro.",
  },
] as const)(
  "syncs vendor $decision to recording and application details",
  async ({
    decision,
    expectedApplicationStatus,
    expectedRecordingStatus,
    remark,
  }) => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    await submitVendorAdmissionReviews({
      repo,
      token: "plain-token",
      input: {
        items: [
          {
            recordingSubmissionId: "rec-1",
            recordingVersion: 2,
            decision,
            remark,
          },
        ],
      },
      now: "2026-06-07T08:00:00.000Z",
    });

    expect(repo.updateRecordingReviewForVendor).toHaveBeenCalledWith(
      "rec-1",
      expect.objectContaining({
        status: expectedRecordingStatus,
        reviewNote: remark,
      }),
    );
    expect(repo.updateApplicationStatusForVendor).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({
        status: expectedApplicationStatus,
        decisionReason: remark,
      }),
    );
  },
);
```

- [ ] **Step 2: Run tests and verify current behavior**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: pass if current service already syncs these states. If it fails, adjust only the sync map and update methods.

- [ ] **Step 3: Ensure admission detail exposes reasons**

If `AdmissionRecordingDetail` already includes `decisionReason` and `vendorReview.remark`, keep both. Add test coverage in `features/applications/admission-board.test.ts` that rejected and needs-changes vendor review remarks appear in details.

- [ ] **Step 4: Run board tests**

Run:

```bash
pnpm test features/applications/admission-board.test.ts
```

Expected: pass.

## Task 4: Clarify MCN Admission Detail UI And Next Actions

**Files:**

- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] **Step 1: Write failing UI smoke for vendor selected next action**

In `components/reference-ui/ops-reference.test.jsx`, create an admission row:

```js
{
  id: "app-selected",
  status: "recording_approved",
  project: { id: "project-1", code: "P-001", name: "Alpha Project" },
  streamer: { id: "streamer-1", displayName: "Streamer One" },
  latestRecording: { id: "rec-1", version: 1, status: "approved" },
  vendorReview: {
    decision: "selected",
    remark: "Best fit.",
    submittedAt: "2026-06-07T08:00:00.000Z",
  },
}
```

Render admission view, open details, and assert:

```js
expect(screen.getByText("厂家已选入")).toBeInTheDocument();
expect(screen.getByText("Best fit.")).toBeInTheDocument();
expect(
  screen.getByRole("button", { name: /邀请进入项目|二次确认/ }),
).toBeInTheDocument();
```

- [ ] **Step 2: Write failing UI smoke for backup / rejected / needs_changes**

Use rows with `vendorReview.decision` values `backup`, `rejected`, and `needs_changes`. Assert:

```js
expect(screen.getByText("厂家备选")).toBeInTheDocument();
expect(screen.getByText("厂家拒绝")).toBeInTheDocument();
expect(screen.getByText("需修改")).toBeInTheDocument();
```

For rejected and needs_changes, assert the operation cell shows no invitation action and communicates waiting for streamer resubmission.

- [ ] **Step 3: Run UI smoke and verify failure**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: fail on missing labels or next-action copy.

- [ ] **Step 4: Add derived display helpers**

In `components/reference-ui/ops-reference.jsx`, add:

```js
function admissionNextActionLabel(application) {
  const decision = application.vendorReview?.decision;
  if (decision === "selected" && application.status === "recording_approved") {
    return "邀请进入项目";
  }
  if (decision === "backup") return "厂家备选";
  if (decision === "rejected") return "等待主播重新上传";
  if (decision === "needs_changes") return "等待主播补充录屏";
  if (isAdmissionRecordingReviewable(application)) return "MCN 初审";
  if (!application.latestRecording) return "等待录屏";
  return "无需操作";
}
```

Keep the actual confirm handler wired to existing `confirmJoin`.

- [ ] **Step 5: Update operation rendering**

Update the operation column so:

- MCN-reviewable rows show `需补充 / 驳回 / 通过`.
- Vendor selected + `recording_approved` rows show `邀请进入项目` or reuse `二次确认`.
- Backup rows show passive `厂家备选`.
- Rejected / needs_changes rows show passive resubmission copy.

- [ ] **Step 6: Run UI smoke**

Run:

```bash
pnpm test components/reference-ui/ops-reference.test.jsx
```

Expected: pass.

## Task 5: Require Vendor Remarks For Negative Decisions

**Files:**

- Modify: `features/applications/admission-share-board.ts`
- Modify: `features/applications/admission-share-board.test.ts`
- Modify: `app/share/admission/[token]/admission-share-page-client.tsx`
- Modify: `app/share/admission/[token]/admission-share-page-client.test.tsx`

- [ ] **Step 1: Write failing service test**

Add:

```ts
it.each(["rejected", "needs_changes"] as const)(
  "requires a remark for vendor %s decisions",
  async (decision) => {
    const repo = createRepo({
      getPublicShareBoardSnapshot: vi.fn().mockResolvedValue(publicSnapshot()),
    });

    await expect(
      submitVendorAdmissionReviews({
        repo,
        token: "plain-token",
        input: {
          items: [
            {
              recordingSubmissionId: "rec-1",
              recordingVersion: 2,
              decision,
              remark: " ",
            },
          ],
        },
      }),
    ).rejects.toThrow("Vendor rejection or change request requires a remark");
  },
);
```

- [ ] **Step 2: Run service test and verify failure**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts
```

Expected: fails because blank remarks are accepted.

- [ ] **Step 3: Add service validation**

Inside the vendor review loop:

```ts
if (
  (item.decision === "rejected" || item.decision === "needs_changes") &&
  !remark
) {
  throw new Error("Vendor rejection or change request requires a remark");
}
```

- [ ] **Step 4: Add vendor client test**

In `app/share/admission/[token]/admission-share-page-client.test.tsx`, set one draft to `rejected` with blank remark, click submit, and assert:

```ts
expect(await screen.findByText("拒绝或需修改时请填写原因")).toBeInTheDocument();
expect(fetch).not.toHaveBeenCalledWith(
  expect.stringContaining("/reviews"),
  expect.objectContaining({ method: "POST" }),
);
```

- [ ] **Step 5: Add client-side validation**

Before POST:

```ts
const missingRemark = payloadItems.some(
  (item) =>
    (item.decision === "rejected" || item.decision === "needs_changes") &&
    !item.remark.trim(),
);
if (missingRemark) {
  setErrorMessage("拒绝或需修改时请填写原因");
  return;
}
```

- [ ] **Step 6: Run vendor page tests**

Run:

```bash
pnpm test app/share/admission/[token]/admission-share-page-client.test.tsx features/applications/admission-share-board.test.ts
```

Expected: pass.

## Task 6: Surface Vendor Feedback To Streamer Resubmission Flow

**Files:**

- Modify: `features/recordings/project-announcements.ts`
- Modify: tests for project announcements if present
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.jsx`
- Modify: `components/reference-ui/streamer-desktop-reference.test.jsx`

- [ ] **Step 1: Identify current announcement DTO shape**

Read `features/recordings/project-announcements.ts` and current tests. Confirm whether latest recording review note or application decision reason is already selected.

- [ ] **Step 2: Write failing DTO test**

Add a test where an application has:

```ts
status: "recording_required",
decision_reason: "Please add gameplay intro.",
latestRecording: {
  status: "needs_changes",
}
```

Expected DTO:

```ts
expect(project.latestRecordingStatus).toBe("needs_changes");
expect(project.recordingFeedback).toBe("Please add gameplay intro.");
expect(project.canSubmitRecording).toBe(true);
```

- [ ] **Step 3: Update DTO mapping**

Add optional `recordingFeedback` or reuse existing reason field if present:

```ts
recordingFeedback:
  application.decision_reason ||
  latestRecording?.review_note ||
  latestVendorReview?.remark ||
  "",
```

Prefer `decision_reason` for current actionable state.

- [ ] **Step 4: Run DTO/API tests**

Run project announcement tests, for example:

```bash
pnpm test features/recordings/project-announcements.test.ts app/api/streamer/project-announcements/route.test.ts app/api/streamer/project-announcements/[projectId]/route.test.ts
```

Expected: pass after DTO update.

- [ ] **Step 5: Add streamer UI smoke tests**

For mobile and desktop reference tests, add cases:

```js
latestRecordingStatus: "needs_changes",
recordingFeedback: "Please add gameplay intro.",
canSubmitRecording: true,
```

Assert the feedback appears and submit button is enabled.

- [ ] **Step 6: Update streamer UI**

In both mobile and desktop project recording cards, render feedback when present:

```jsx
{
  project.recordingFeedback ? (
    <p style={{ color: "var(--warn-600)" }}>{project.recordingFeedback}</p>
  ) : null;
}
```

Keep visual treatment consistent with existing warning/error styles.

- [ ] **Step 7: Run streamer UI tests**

Run:

```bash
pnpm test components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: pass.

## Task 7: Final Verification

**Files:**

- No new files expected.

- [ ] **Step 1: Run full admission/share regression suite**

Run:

```bash
pnpm test features/applications/admission-share-board.test.ts features/applications/admission-board.test.ts app/api/projects/[projectId]/admission-share-boards/route.test.ts app/api/public/admission-share/[token]/route.test.ts app/api/public/admission-share/[token]/reviews/route.test.ts app/share/admission/[token]/admission-share-page-client.test.tsx components/reference-ui/ops-reference.test.jsx
```

Expected: all tests pass.

- [ ] **Step 2: Run streamer project recording suite**

Run:

```bash
pnpm test features/recordings/project-announcements.test.ts app/api/streamer/project-announcements/route.test.ts app/api/streamer/project-announcements/[projectId]/route.test.ts app/api/streamer/recordings/route.test.ts components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.test.jsx
```

Expected: all tests pass.

- [ ] **Step 3: Run type, lint, and formatting checks**

Run:

```bash
pnpm type-check
pnpm lint
pnpm exec prettier --check features/applications/admission-share-board.ts features/applications/admission-share-board.test.ts features/applications/admission-board.ts features/applications/admission-board.test.ts components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx app/share/admission/[token]/admission-share-page-client.tsx app/share/admission/[token]/admission-share-page-client.test.tsx components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx components/reference-ui/streamer-desktop-reference.jsx components/reference-ui/streamer-desktop-reference.test.jsx
git diff --check
```

Expected: type-check, lint, targeted formatting, and diff whitespace checks pass. The existing Babel deopt warning for `components/reference-ui/ops-reference.jsx` is acceptable.

- [ ] **Step 4: Manual smoke checklist**

Run the app against a local database with the admission share migrations applied. Verify:

1. Streamer uploads a project recording.
2. MCN sees it as pending first review.
3. Creating share link before MCN approval is blocked.
4. MCN approves the recording.
5. Creating share link succeeds.
6. Vendor marks one item selected and one item backup.
7. MCN detail shows selected and backup.
8. Vendor rejects or requests changes on another item.
9. MCN detail shows the reason.
10. Streamer can resubmit after rejected or needs changes.

## Self-Review

- Spec coverage: MCN first review, approved-only share, vendor selected/backup/rejected/needs_changes, streamer feedback, service-side enforcement, and tests are all mapped to tasks.
- Placeholder scan: No placeholder implementation tasks remain.
- Type consistency: Uses existing `ApplicationStatus`, `RecordingReviewStatus`, and `VendorAdmissionDecision`; no new database status is required.
