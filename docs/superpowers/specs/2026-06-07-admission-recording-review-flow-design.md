# Admission Recording Review Flow Design

## Goal

Restructure the admission recording workflow so MCN staff, vendors, and streamers each see the right stage of the same business process:

1. Streamers submit project-specific recording links.
2. MCN staff perform the first quality review.
3. Only MCN-approved recordings can be shared with vendors.
4. Vendor decisions update the MCN recording detail view and drive the next MCN action.
5. Streamers see rejection or change-request feedback and can resubmit when allowed.

## Current Problem

The current flow partially syncs vendor decisions, but the business meaning is unclear:

- Share links can be created from recordings that have not passed MCN review.
- Vendor `selected`, `rejected`, and `needs_changes` have partial backend sync, while `backup` is treated as skipped.
- MCN recording details show vendor feedback but do not clearly expose the next action.
- Streamer-facing recording feedback is not explicit enough after vendor decisions.

## Business State Model

The workflow keeps the existing `project_applications` and `recording_submissions` tables. It does not introduce a parallel review subsystem.

### Stage 1: Streamer Upload

When a streamer submits a project recording:

- `recording_submissions.status = submitted`
- `project_applications.status = recording_reviewing`
- MCN admission board shows the item as pending MCN review.

### Stage 2: MCN First Review

MCN review is the quality gate before any vendor sharing.

| MCN action    | Recording status | Application status   | Result                                          |
| ------------- | ---------------- | -------------------- | ----------------------------------------------- |
| Approve       | `approved`       | `recording_approved` | Eligible for vendor share                       |
| Reject        | `rejected`       | `recording_rejected` | Streamer can see reason and resubmit            |
| Needs changes | `needs_changes`  | `recording_required` | Streamer can see requested changes and resubmit |

### Stage 3: Vendor Share

Creating a vendor share link must only include items where:

- latest recording exists,
- latest recording status is `approved`,
- application status is `recording_approved`.

If a project has recordings but none are MCN-approved, the UI should say:

`当前项目暂无 MCN 已通过的可分享录屏`

The service must enforce this, not just the UI.

### Stage 4: Vendor Decision

Vendor decisions are stored in `project_recording_vendor_reviews` and reflected in MCN details.

| Vendor decision | Recording status | Application status   | MCN next action                                            |
| --------------- | ---------------- | -------------------- | ---------------------------------------------------------- |
| `selected`      | `approved`       | `recording_approved` | Show invitation / final confirmation action                |
| `backup`        | `approved`       | `recording_approved` | Show vendor backup state, no auto join                     |
| `rejected`      | `rejected`       | `recording_rejected` | Show vendor rejection reason, allow streamer resubmission  |
| `needs_changes` | `needs_changes`  | `recording_required` | Show vendor requested changes, allow streamer resubmission |
| `pending`       | unchanged        | unchanged            | No sync action                                             |

`selected` should not directly set `joined`. Vendor selection is a commercial signal; MCN still owns project membership, settlement defaults, and final joining.

### Stage 5: MCN Final Action

When an item is vendor-selected, MCN should see a clear action:

- `邀请进入项目` or the current `二次确认` action.
- The action should create or update project membership using the existing `confirmApplicationJoin` path.
- After confirmation, `project_applications.status = joined`.

## MCN UI Requirements

The admission detail table should make three concepts visible:

1. MCN review status: pending review, approved, rejected, needs changes.
2. Vendor decision: pending, selected, backup, rejected, needs changes.
3. Next action: review, share, invite/confirm, wait for resubmission, no action.

The table should not show a generic final state only. The goal is to make the next operation obvious.

## Streamer UI Requirements

Streamer project cards and project recording forms should show:

- MCN rejection reason.
- Vendor rejection reason.
- Vendor requested changes.
- Whether resubmission is allowed.

Resubmission is allowed when the application is `recording_required` or `recording_rejected`, using the existing `assertCanSubmitRecording` rule.

## Vendor Share Page Requirements

The vendor share page should only contain MCN-approved recordings. Vendors can still choose:

- `选入`
- `备选`
- `拒绝`
- `需修改`

Vendor remarks are required for `rejected` and `needs_changes` because these remarks are shown back to MCN and streamers.

## Backend Safety Requirements

The service layer must reject invalid state transitions:

- A share board cannot include a non-approved recording.
- Vendor review cannot target a recording outside the share board.
- Vendor review must match the locked `recordingVersion`.
- Vendor `rejected` and `needs_changes` must update both recording and application status.
- Vendor `backup` must be persisted as a visible vendor decision, not counted as a silent skip.
- Vendor `selected` must not automatically set `joined`.

## Testing Strategy

Add service tests first:

- Share creation rejects unapproved recordings.
- Project-level share creation filters to MCN-approved recordings.
- Vendor `backup` persists and is visible in admission details.
- Vendor `rejected` updates recording/application statuses and stores reason.
- Vendor `needs_changes` updates recording/application statuses and stores reason.
- Vendor `selected` leaves status ready for MCN confirmation.

Then add route and UI smoke tests:

- MCN cannot create a vendor link before MCN approval.
- MCN sees vendor selected / backup / rejected / needs changes states.
- Streamer can resubmit after rejection or requested changes.

## Open Product Choice

The recommended behavior is `selected -> MCN confirms -> joined`. If the product later wants vendor selection to auto-invite the streamer, that should be a separate explicit rule that creates a project membership in an invited or pending state, not an immediate silent `joined`.
