# Project MCN Collaboration Design

Date: 2026-06-10  
Scope: Add cross-MCN project collaboration with a project share link, login-required partner application, one-round revenue-share confirmation, scoped execution visibility, and settlement closure.

## 1. Confirmed Product Decisions

- Use one owner project as the source of truth. Do not create mirror projects.
- Use a collaboration view for participating MCNs.
- Calculate MCN-to-MCN revenue share from project revenue, not from streamer payable cost or gross profit.
- Participating MCNs manage their own streamers and contribution data.
- Owner MCN keeps global project visibility and final project control.
- Applicants must log in as an existing MCN organization before applying.
- Use one proposal plus optional counter-offer confirmation. No multi-round negotiation in the first version.

## 2. Goals

- Let an owner MCN mark a project as open to outside MCN collaboration.
- Let the owner MCN generate and revoke a share link for the project.
- Let another logged-in MCN apply through the link and propose a revenue-share percentage.
- Let the owner MCN accept, reject, or counter the proposed percentage.
- Let the applicant MCN confirm the counter-offer and activate the agreement.
- Let the partner MCN manage its own streamers in the owner project after agreement activation.
- Keep the owner project as the only project record while allowing scoped partner views.
- Connect applications, recordings, project streamers, live tasks, reports, and settlements to a collaboration agreement.
- Generate MCN-to-MCN settlement from confirmed project revenue and the active agreement percentage.
- Preserve auditability, tenant isolation, and role-based controls.

## 3. Non-Goals

- No unauthenticated outside MCN intent form.
- No mirror project generation.
- No multi-round negotiation history.
- No automated payment, invoice, tax, or bank reconciliation.
- No multi-level channel hierarchy.
- No partner-to-partner visibility.
- No automatic import of partner streamers into the owner MCN streamer pool.

## 4. Core Data Model

### 4.1 Project Collaboration Switch

Extend `projects`:

- `is_open_to_mcn_collaboration boolean not null default false`
- `mcn_collaboration_summary text not null default ''`
- `mcn_collaboration_terms jsonb not null default '{}'::jsonb`

Rules:

- Only `owner` and `ops_manager` can enable or disable external MCN collaboration.
- Disabling the switch blocks new applications and new share creation.
- Existing active agreements remain valid until suspended or ended.

### 4.2 Project Collaboration Shares

New table: `project_collaboration_shares`

Purpose: tokenized project invitation link for MCN collaboration.

Key fields:

- `id`
- `owner_organization_id`
- `project_id`
- `token_hash`
- `status`: `active`, `expired`, `revoked`
- `expires_at`
- `allow_applications`
- `visible_fields`
- `created_by`
- `revoked_by`
- `revoked_at`
- `last_viewed_at`
- `last_submitted_at`
- timestamps

Rules:

- A share belongs to the owner organization and one project.
- The raw token is only returned at creation time.
- Public reads use the token hash and only return approved public fields.
- Revoked or expired shares can show an unavailable state but cannot accept applications.

### 4.3 Project Collaboration Applications

New table: `project_collaboration_applications`

Purpose: partner MCN request to join an owner project.

Key fields:

- `id`
- `share_id`
- `project_id`
- `owner_organization_id`
- `applicant_organization_id`
- `requested_revenue_share_bps`
- `owner_counter_revenue_share_bps`
- `final_revenue_share_bps`
- `status`
- `applicant_note`
- `owner_review_note`
- `rejection_reason`
- `submitted_by`
- `reviewed_by`
- `reviewed_at`
- `applicant_confirmed_by`
- `applicant_confirmed_at`
- timestamps

Status:

```text
submitted
  -> approved
  -> owner_countered
  -> rejected
  -> withdrawn
  -> expired

owner_countered
  -> applicant_confirmed
  -> rejected
  -> withdrawn

applicant_confirmed
  -> approved
```

Rules:

- `requested_revenue_share_bps`, `owner_counter_revenue_share_bps`, and `final_revenue_share_bps` use basis points. `1000` means 10%.
- Values must be between `0` and `10000`.
- The same applicant organization cannot have more than one active or pending application for the same project.
- The same applicant organization cannot apply if it already has an active agreement for the project.
- The applicant organization cannot equal the owner organization.
- Owner acceptance creates an active agreement directly.
- Owner counter-offer requires applicant confirmation before agreement creation.
- Rejecting or withdrawing must preserve the application record for audit.

### 4.4 Project Collaboration Agreements

New table: `project_collaboration_agreements`

Purpose: active cross-MCN project relationship and authorization anchor.

Key fields:

- `id`
- `application_id`
- `project_id`
- `owner_organization_id`
- `partner_organization_id`
- `revenue_share_bps`
- `settlement_basis`: `project_revenue`
- `status`: `active`, `suspended`, `ended`
- `owner_confirmed_by`
- `owner_confirmed_at`
- `partner_confirmed_by`
- `partner_confirmed_at`
- `suspended_by`
- `suspended_at`
- `ended_by`
- `ended_at`
- `status_reason`
- timestamps

Rules:

- One active agreement per owner project and partner organization.
- Active agreement grants scoped partner access to the project.
- Suspension blocks new partner-created applications, tasks, and reports, but keeps historical reads and settlement access.
- Ended agreements keep historical data visible to both sides.

### 4.5 Execution Data Attribution

Add optional collaboration attribution to existing execution tables:

- `project_applications.collaboration_id`
- `project_applications.contributor_organization_id`
- `recording_submissions.collaboration_id`
- `recording_submissions.contributor_organization_id`
- `project_streamers.collaboration_id`
- `project_streamers.contributor_organization_id`
- `live_tasks.collaboration_id`
- `live_tasks.contributor_organization_id`
- `live_reports.collaboration_id`
- `live_reports.contributor_organization_id`
- `settlement_batch_items.collaboration_id`
- `settlement_batch_items.contributor_organization_id`

Rules:

- Owner-created data may leave these fields null or set `contributor_organization_id = owner_organization_id`.
- Partner-created data must reference an active agreement and set `contributor_organization_id = partner_organization_id`.
- The `project_id` must match the agreement project.
- The existing `organization_id` on partner-created execution rows should remain the contributor organization, while `project_id` links back to the owner project.
- Owner global reads must be authorized by project ownership.
- Partner reads and writes must be authorized by active agreement plus contributor organization.

## 5. Product Flow

### 5.1 Owner Opens Project Collaboration

```text
owner/ops_manager enables project MCN collaboration
  -> writes project collaboration summary and terms
  -> creates active collaboration share
  -> copies share URL
```

Audit actions:

- `enable_collaboration`
- `create_collaboration_share`
- `revoke_collaboration_share`

### 5.2 Partner Applies Through Share Link

```text
partner opens share link
  -> sees public project summary
  -> logs in if needed
  -> chooses current organization
  -> submits requested revenue share and note
  -> owner receives notification
```

Validation:

- Share is active and not expired.
- Project is open to MCN collaboration.
- User belongs to an active organization.
- Applicant organization is not the owner organization.
- No duplicate pending application or active agreement.

### 5.3 Owner Reviews Application

Owner choices:

- Accept requested share: create active agreement.
- Reject: application becomes `rejected`.
- Counter: application becomes `owner_countered` with `owner_counter_revenue_share_bps`.

Counter-offer rule:

- The applicant must confirm the counter-offer before an agreement is created.

### 5.4 Agreement Activation

```text
application approved or applicant confirms counter
  -> create project_collaboration_agreement
  -> notify owner and partner
  -> partner sees project in collaboration project list
```

Agreement activation is the permission source for partner project views and writes.

### 5.5 Partner Execution

```text
partner selects own streamers
  -> creates project applications linked to collaboration
  -> submits recordings if required
  -> project_streamers captures settlement snapshot on join
  -> creates or receives live tasks
  -> submits reports and evidence
  -> participates in normal report review and settlement flows
```

Execution ownership:

- Partner manages its own streamers and contribution data.
- Owner can see all contribution data on the project.
- Partner cannot see other partner MCNs' streamers, reports, or settlements.

## 6. Settlement Design

### 6.1 Existing Streamer Settlement

Streamer payable settlement continues to use the existing path:

```text
project_streamers settlement snapshot
  -> approved live_reports
  -> settlement_batches(payable)
  -> settlement_batch_items
  -> streamer_payable_items_safe
```

Rules:

- Partner MCN settles its own streamers using frozen `project_streamers` rules.
- Existing CPT, base salary, CPS, and manual item logic remains the base.
- Partner streamer settlement is separate from MCN-to-MCN revenue share.

### 6.2 Project Revenue Records

New table: `project_revenue_records`

Purpose: confirmed income basis for MCN-to-MCN collaboration settlement.

Key fields:

- `id`
- `owner_organization_id`
- `project_id`
- `period_start`
- `period_end`
- `amount`
- `currency`
- `source_type`
- `source_reference`
- `status`: `draft`, `confirmed`, `voided`
- `confirmed_by`
- `confirmed_at`
- `voided_by`
- `voided_at`
- `void_reason`
- timestamps

Rules:

- First version supports manual confirmed revenue records.
- Confirmed revenue records cannot be edited in place.
- Corrections use negative adjustment records or void-and-recreate with audit.

### 6.3 Collaboration Settlement

New tables:

- `project_collaboration_settlement_batches`
- `project_collaboration_settlement_items`

Batch fields:

- `id`
- `agreement_id`
- `project_id`
- `owner_organization_id`
- `partner_organization_id`
- `period_start`
- `period_end`
- `revenue_total`
- `revenue_share_bps`
- `partner_amount`
- `status`: `generated`, `owner_confirmed`, `partner_confirmed`, `locked`, `disputed`, `reopened`, `voided`
- `owner_confirmed_by`
- `partner_confirmed_by`
- `lock_reason`
- `dispute_reason`
- `reopen_reason`
- timestamps

Item fields:

- `id`
- `batch_id`
- `revenue_record_id`
- `project_id`
- `agreement_id`
- `revenue_amount`
- `revenue_share_bps`
- `partner_amount`
- `evidence_snapshot`
- timestamps

Calculation:

```text
partner_amount = confirmed_project_revenue * agreement.revenue_share_bps / 10000
```

Rules:

- Only confirmed project revenue records enter collaboration settlement.
- A revenue record can only be consumed once per agreement and settlement batch type.
- Owner confirms first, partner confirms second, then the batch can be locked.
- Partner can dispute with a reason before lock.
- Locked batches cannot be edited; reopening requires high-risk audit.

## 7. Permissions and RLS

### 7.1 Owner Organization

Owner MCN can:

- Manage collaboration switch and shares.
- Review applications.
- See all collaboration applications and agreements on its projects.
- See all partner contribution data for the project.
- Generate project revenue and collaboration settlement.
- Confirm, lock, reopen, or void collaboration settlement according to role.

### 7.2 Partner Organization

Partner MCN can:

- Apply through active share links.
- Confirm owner counter-offer.
- View its own agreements.
- View the owner project through scoped collaboration fields.
- Manage its own streamers and contribution data for active agreements.
- View and confirm or dispute its own collaboration settlement.

Partner MCN cannot:

- Modify owner project basics.
- Modify owner project default settlement rules.
- See other partners' contribution data.
- See owner-only financial fields outside the collaboration settlement basis.
- Create data after agreement suspension or end.

### 7.3 Streamers

Streamers can:

- Access only their own tasks, recordings, reports, diagnosis, and safe payable view.
- Continue using existing mobile and desktop flows.

Streamers cannot:

- See MCN-to-MCN revenue share.
- See project revenue records.
- See other organizations' contribution data.

### 7.4 RLS Helpers

Add helper functions:

- `public.can_access_project_collaboration(project_id uuid, organization_id uuid)`
- `public.can_manage_project_collaboration(project_id uuid)`
- `public.can_contribute_to_project(project_id uuid, organization_id uuid)`
- `public.can_read_collaboration_settlement(batch_id uuid)`

Principles:

- Owner access follows project ownership and existing project access checks.
- Partner access follows active or historical agreement plus contributor organization.
- Service layer must repeat authorization checks for all writes.

## 8. API Surface

Project management:

- `PATCH /api/projects/[projectId]`
  - Adds collaboration switch and public collaboration summary fields.
- `POST /api/projects/[projectId]/collaboration-shares`
  - Creates a share link.
- `POST /api/projects/[projectId]/collaboration-shares/[shareId]/revoke`
  - Revokes a share link.

Public share:

- `GET /api/public/project-collaboration/[token]`
  - Reads public project collaboration summary.
- `POST /api/public/project-collaboration/[token]/applications`
  - Creates a logged-in applicant organization request.

Application review:

- `GET /api/projects/[projectId]/collaboration-applications`
  - Owner reads applications.
- `POST /api/projects/[projectId]/collaboration-applications/[applicationId]/review`
  - Owner accepts, rejects, or counters.
- `POST /api/projects/[projectId]/collaboration-applications/[applicationId]/confirm`
  - Applicant confirms owner counter-offer.

Agreement and execution:

- `GET /api/projects/[projectId]/collaborators`
  - Reads collaborator list and agreement state.
- `GET /api/collaboration-projects`
  - Partner reads projects it participates in.

Settlement:

- `POST /api/projects/[projectId]/revenue-records`
  - Owner creates or confirms project revenue.
- `GET /api/projects/[projectId]/revenue-records`
  - Owner reads project revenue.
- `POST /api/projects/[projectId]/collaboration-settlements`
  - Owner generates collaboration settlement.
- `POST /api/collaboration-settlements/[batchId]/confirm`
  - Owner or partner confirms depending on current status.
- `POST /api/collaboration-settlements/[batchId]/dispute`
  - Partner disputes before lock.
- `POST /api/collaboration-settlements/[batchId]/lock`
  - Owner locks after both confirmations.

## 9. UI Scope

### 9.1 Owner Project Page

Add an "External MCN Collaboration" section:

- Open/closed collaboration switch.
- Public collaboration summary and terms.
- Create, copy, revoke share link.
- Application list with requested share, status, notes, and actions.
- Agreement list with partner MCN, share percentage, status, and contribution summary.

### 9.2 Public Collaboration Page

Route:

- `/share/project-collaboration/[token]`

Display:

- Owner organization name.
- Project name and public collaboration summary.
- Visible terms and revenue-share instructions.
- Login-required apply action.
- Requested revenue-share input.
- Applicant note.

### 9.3 Partner Collaboration Projects

Add a partner-facing collaboration entry:

- Joined collaboration projects.
- Agreement status and confirmed revenue share.
- Own streamers in the project.
- Own tasks, recordings, reports, and report review status.
- Own collaboration settlement receivable.

### 9.4 Settlement UI

Owner view:

- Project revenue records.
- Collaboration settlement batches by partner.
- Confirmation, dispute, lock, reopen state.

Partner view:

- Own receivable batches.
- Revenue basis and share percentage.
- Confirm or dispute.

## 10. Notifications and Audit

Notifications:

- Share created.
- Application submitted.
- Application accepted, rejected, or countered.
- Counter-offer confirmed.
- Agreement activated.
- Agreement suspended or ended.
- Collaboration settlement generated.
- Settlement confirmed, disputed, locked, reopened, or voided.

Audit actions:

- `enable_collaboration`
- `disable_collaboration`
- `create_collaboration_share`
- `revoke_collaboration_share`
- `submit_collaboration_application`
- `review_collaboration_application`
- `confirm_collaboration_counter`
- `activate_collaboration_agreement`
- `suspend_collaboration_agreement`
- `end_collaboration_agreement`
- `create_project_revenue`
- `confirm_project_revenue`
- `generate_collaboration_settlement`
- `confirm_collaboration_settlement`
- `dispute_collaboration_settlement`
- `lock_collaboration_settlement`
- `reopen_collaboration_settlement`
- `void_collaboration_settlement`

High-risk actions require a reason:

- Disable collaboration when active agreements exist.
- Suspend or end agreement.
- Void revenue record.
- Dispute, reopen, or void settlement.
- Change active agreement revenue share after activation. This should be out of first-version scope unless implemented as ending old agreement and creating a new one.

## 11. Error Handling

- Expired or revoked link returns an unavailable public state.
- Duplicate pending application returns a clear conflict message.
- Active agreement conflict blocks new application.
- Applicant organization equal to owner organization is rejected.
- Counter confirmation is rejected if the application is no longer `owner_countered`.
- Agreement creation is idempotent for the approved application path.
- Suspended agreements block new writes but preserve reads.
- Partner attempts to read another partner's data return 403.
- Partner attempts to edit owner project fields return 403.
- Settlement generation fails if no confirmed revenue records exist for the period.
- Settlement generation fails if any selected revenue record is already settled for the agreement.
- Notification failures are logged but do not roll back the primary state transition.

## 12. Testing Plan

Database contract tests:

- Tables, columns, constraints, indexes, and RLS helpers exist.
- Basis point constraints reject values outside `0..10000`.
- Duplicate pending application and active agreement conflicts are enforced.
- Partner scoped reads cannot cross organizations.

Service tests:

- Owner can create and revoke share link.
- Public share snapshot hides private project fields.
- Logged-in partner can apply with requested revenue share.
- Duplicate application is rejected.
- Owner accepts requested share and creates agreement.
- Owner counters and partner confirmation creates agreement.
- Owner rejection preserves application history.
- Suspended agreement blocks new partner execution writes.
- Owner global reads include partner contribution data.
- Partner reads only its own contribution data.

Execution tests:

- Partner-created application stores collaboration attribution.
- Recording submission inherits collaboration attribution.
- Project streamer join stores collaboration attribution and settlement snapshot.
- Live task and live report preserve contributor organization.

Settlement tests:

- Confirmed project revenue generates partner amount from `revenue_share_bps`.
- Unconfirmed revenue is excluded.
- Revenue record is not double-consumed for the same agreement.
- Owner confirms first, partner confirms second, then lock succeeds.
- Partner dispute blocks lock until resolved or reopened.

UI tests:

- Owner project page exposes collaboration controls by role.
- Public page requires login before application submission.
- Partner collaboration projects page only displays partner-scoped data.
- Settlement view displays owner global and partner-scoped versions correctly.

## 13. Implementation Slices

1. Database migration for collaboration shares, applications, agreements, revenue records, settlement batches, settlement items, execution attribution fields, RLS helpers, and audit enum values.
2. Collaboration domain service and repository with tests for share, application, review, counter, agreement, and scoped permissions.
3. Project API and public share API.
4. Execution-chain attribution in applications, recordings, project streamers, live tasks, and live reports.
5. Collaboration settlement service and revenue records.
6. Owner UI section in project details or project console surface.
7. Public share page.
8. Partner collaboration project view.
9. Collaboration settlement UI.
10. Regression tests for cross-organization permission boundaries and data visibility.

## 14. Open Product Defaults

These defaults are selected for the first implementation unless changed before development:

- Share link expiration default: 14 days.
- One active share link per project is preferred, but historical revoked links remain visible to owner staff.
- First version revenue records are manually entered by owner MCN staff.
- Agreement percentage cannot be edited in place after activation.
- Partner can manage its own streamers and contribution data, while owner keeps final project-level visibility and control.
