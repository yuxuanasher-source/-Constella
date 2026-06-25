# Role-Based Dashboard Redesign

Date: 2026-06-16
Scope: Redesign the dashboard experience so each account type lands on the metrics, queues, risks, and actions that match its business responsibility.

## 1. Confirmed Product Decisions

- Use one shared metric foundation with role-specific dashboard pages.
- Do not keep a single generic dashboard that every role has to filter manually.
- The first staff MVP covers `owner`, `ops_manager`, `operator_business`, and `finance`.
- Streamer, collaboration MCN, and external vendor/customer dashboards are included in the product model, but can ship as later role-scoped surfaces.
- Dashboard numbers are decision support. High-risk actions such as publishing, final join confirmation, settlement locking, batch reopening, sensitive export, and rule changes still require explicit user action, reason capture, permissions, and audit logging.
- Field masking is part of the dashboard design, not a later polish item. Streamers and external viewers must never receive internal cost, MCN margin, supplier internal cost, or private risk notes through dashboard DTOs.

## 2. Goals

- Make the default homepage answer the account's most urgent business question.
- Reduce noise by hiding metrics that the account cannot act on or should not see.
- Keep shared metric definitions consistent across roles.
- Preserve project-first navigation: every dashboard card should drill down to project, streamer, task, report, settlement, audit, or export records.
- Surface workflow blockers before they become settlement or delivery failures.
- Separate operating execution, financial settlement, and governance risk clearly.

## 3. Non-Goals

- No new authentication role hierarchy in this design.
- No automated payment, invoice, bank reconciliation, or tax workflow.
- No automatic high-risk operation from a dashboard card.
- No full external vendor portal rebuild.
- No cross-tenant data sharing beyond already authorized collaboration and share-link scopes.
- No attempt to build a general BI tool with arbitrary charting in the first version.

## 4. Account Types

| Account type               | Existing role or scope            | Default business question                                         | Dashboard posture             |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Boss / owner               | `owner`                           | Is the business healthy, profitable, and controlled?              | Executive operating view      |
| Operations lead            | `ops_manager`                     | Which projects are blocked and what should the team handle first? | Project delivery command view |
| Frontline operator         | `operator_business`               | What do I personally need to process today?                       | Personal action queue         |
| Finance                    | `finance`                         | Which reports can be settled safely and which amounts are risky?  | Settlement safety view        |
| Streamer                   | `streamer`                        | What do I need to broadcast, submit, fix, and get paid for?       | Task and earnings view        |
| Collaboration MCN          | collaboration agreement scope     | What did my organization contribute and what needs action?        | Partner-scoped execution view |
| External vendor / customer | tokenized share or delivery scope | Which candidates or delivery outputs can I review?                | Public delivery review view   |

## 5. Shared Metric Foundation

The system should calculate metrics from one shared business layer, then project them into role-specific DTOs.

### 5.1 Project Health

Core objects:

- `projects`
- `project_streamers`
- `project_applications`
- `recording_submissions`
- `live_tasks`
- `live_reports`
- `settlement_batches`

Useful metrics:

- Active projects by status: recruiting, pending start, active, paused, ended, settling.
- Project progress: completed live hours / planned live hours.
- Project delivery risk: overdue tasks, missing reports, unresolved anomalies, pending admissions.
- Project financial snapshot: receivable, payable, gross, gross margin, low-margin or negative-margin flag.
- Project closeout readiness: ended but not settled, settled but not archived, open delivery package.

### 5.2 Admission And Supply

Core objects:

- `project_applications`
- `recording_submissions`
- `project_recording_share_boards`
- `project_recording_vendor_reviews`

Useful metrics:

- Signup count, invitation count, candidate count, joined count.
- Recording required, recording reviewing, recording approved, recording rejected, needs changes.
- Latest recording version coverage.
- Final join confirmation backlog.
- Project roster gap: target slots minus joined streamers.
- Vendor review backlog for shared admission boards.

### 5.3 Live Execution

Core objects:

- `live_tasks`
- `task_anomalies`
- `notifications`

Useful metrics:

- Today's scheduled tasks.
- Pending live, live, pending report, report pending review, approved, completed, cancelled, abnormal.
- Not-started overdue tasks.
- Not-stopped long-running tasks.
- Missing screenshot or report backlog.
- Operator-owned tasks by due time.

### 5.4 Report Evidence Quality

Core objects:

- `live_reports`
- OCR jobs and AI invocation records where applicable.

Useful metrics:

- Pending OCR, pending streamer confirmation, pending operations review, pending adjudication.
- Green / yellow / red evidence distribution.
- System time versus screenshot time divergence.
- Reports requiring manual reason.
- Approved reports eligible for settlement pool.
- Reports rejected or requiring more information.

### 5.5 Settlement And Margin

Core objects:

- `settlement_batches`
- `settlement_batch_items`
- `live_reports`
- `project_streamers`
- collaboration settlement records where applicable.

Useful metrics:

- Settlement pool report count and amount.
- Draft, locked, reopened, and completed settlement batches.
- Streamer payable amount.
- Manual carry amount.
- Weak-evidence amount.
- Project gross margin and margin rate.
- Rule change, batch reopen, and sensitive export risk events.

### 5.6 Collaboration

Core objects:

- `project_collaboration_shares`
- `project_collaboration_applications`
- active collaboration agreements
- collaboration settlement records

Useful metrics:

- Active collaboration projects.
- Partner applications pending owner review.
- Owner counters pending partner confirmation.
- Partner streamer count.
- Partner-scoped live hours, approved reports, anomalies, and revenue-share settlement state.

### 5.7 Governance

Core objects:

- `audit_logs`
- `notifications`
- governed export records
- AI/OCR invocation ledger

Useful metrics:

- Recent high-risk actions.
- Sensitive export count.
- Settlement rule changes.
- Batch locks and reopens.
- AI/OCR usage and failed jobs.
- Unhandled notification or task age.

## 6. Dashboard Designs

### 6.1 Boss / Owner Dashboard

Purpose: show business result, profit risk, and governance risk.

Top KPIs:

- Active projects.
- Current-month vendor receivable.
- Estimated gross profit and gross margin.
- Low-margin or negative-margin projects.
- High-risk pending items.

Primary panels:

- Project operating ranking: margin, progress, anomaly count, owner, status.
- Profit risk list: low margin, negative margin, high supplier cost, high streamer payable, weak evidence exposure.
- Delivery risk list: overdue tasks, missing reports, delayed admissions, projects near end date.
- Governance trail: settlement rule changes, batch reopens, sensitive exports, owner-only actions.
- Trend strip: weekly live hours, receivable, payable, margin rate.

Default drilldowns:

- Project review.
- Low-margin analysis.
- High-risk audit log.
- Settlement batch detail.

### 6.2 Operations Lead Dashboard

Purpose: prioritize project delivery blockers across the team.

Top KPIs:

- Recruiting, active, and settling project counts.
- Projects with streamer gaps.
- Recordings pending review.
- Today's scheduled sessions.
- Open anomalies.

Primary panels:

- Project blocker queue sorted by business impact.
- Admission funnel: submitted, recording required, reviewing, approved, final confirmation, joined.
- Today's execution board: pending live, live, pending report, pending review.
- Team workload: owner or operator, project, overdue age, action type.
- Vendor/admission share status where applicable.

Default actions:

- Assign anomaly.
- Review recording.
- Finalize project join.
- Open project details.
- Export daily execution brief.

### 6.3 Frontline Operator Dashboard

Purpose: show only the operator's actionable queue.

Top KPIs:

- My tasks today.
- Overdue not-started tasks.
- Pending reports.
- Reports awaiting my review.
- Streamers requiring contact.

Primary panels:

- Timeline queue by planned start time and due time.
- Anomaly list: not started, not stopped, no report, missing screenshot, duplicated or conflicting evidence.
- Report review queue: pending review, pending adjudication, evidence divergence.
- Streamer reminder queue: resubmit recording, upload screenshot, confirm OCR, supplement report.
- My project quick links.

Default actions:

- Contact streamer through notification or task context.
- Record anomaly handling reason.
- Review report.
- Open task detail.
- Open admission row.

### 6.4 Finance Dashboard

Purpose: protect settlement accuracy and financial visibility.

Top KPIs:

- Settlement pool amount.
- Settlement pool report count.
- Draft batches.
- Current-month streamer payable.
- Weak-evidence or manual-carry amount.

Primary panels:

- Settlement pool grouped by project, streamer, evidence level, and settlement method.
- Batch status board: draft, locked, reopened, exported.
- Risk amount list: red/yellow evidence, manual adjustments, rule changes, modified report values.
- Export center shortcuts: streamer payment table, project cost detail, settlement batch detail, anomaly audit table.
- Read-only margin snapshot by project where the role is allowed to view it.

Default actions:

- Create settlement batch where allowed by existing permissions.
- View weak evidence.
- View or request batch lock.
- Export governed finance files.
- Open audit context for risky amounts.

### 6.5 Streamer Dashboard

Purpose: help the streamer complete work and understand safe earnings state.

Top KPIs:

- Today's tasks.
- Screenshots to upload.
- Reports under review.
- Items needing supplement.
- Safe payable or settled earnings summary.

Primary panels:

- Today task cards: project, time, settlement hint, recording requirement.
- Report state tracker: OCR running, pending confirmation, pending review, approved, rejected, needs more.
- Recording/application feedback: resubmit, rejected reason, approved but not joined.
- Safe earnings summary backed by streamer-safe settlement views.
- Notifications for missing action.

Default actions:

- Start live.
- Stop live and upload screenshot.
- Confirm OCR.
- Resubmit recording or report supplement.
- View safe settlement item.

Field rules:

- No vendor receivable.
- No MCN margin.
- No other streamer data.
- No supplier internal cost.
- No internal risk notes.

### 6.6 Collaboration MCN Dashboard

Purpose: let a partner MCN handle only its own contribution inside owner projects.

Top KPIs:

- Active collaboration projects.
- Partner streamers joined.
- Partner-scoped live hours.
- Approved partner reports.
- Revenue-share settlement pending confirmation.

Primary panels:

- Collaboration project list with owner organization, status, and agreement state.
- Partner streamer contribution table.
- Partner task and report anomalies.
- Partner settlement state: pending, confirmed, returned, settled.
- Counter-offer or application status where relevant.

Default actions:

- Manage or invite own streamers within allowed collaboration scope.
- Process partner-side anomalies.
- View collaboration settlement detail.
- Confirm owner counter-offer if applicable.

Field rules:

- No owner organization's unrelated projects.
- No other partner organization's streamers.
- No owner internal margin unless explicitly exposed by product policy.
- No direct mutation of owner-only project settings.

### 6.7 External Vendor / Customer Dashboard

Purpose: support candidate review and delivery acceptance without exposing internal finance.

Top KPIs:

- Candidate streamers.
- Recordings pending vendor review.
- Approved candidates.
- Delivered sessions.
- Delivery package status.

Primary panels:

- Candidate streamer table: display name, platform, recording link, MCN review state, vendor decision.
- Recording review workspace: selected, rejected, needs changes, remark required for negative decisions.
- Delivery summary: sessions, approved public hours, public audience values where allowed, delivery package status.
- Export or package links with expiry and scope.

Default actions:

- Submit recording review decision.
- Download authorized delivery package.
- View public project summary.

Field rules:

- No streamer settlement price.
- No MCN gross profit or margin.
- No supplier internal cost.
- No internal risk notes.
- No private audit details.

## 7. Permission And Masking Rules

The dashboard DTO layer should mask fields before they reach client components.

| Data family                          | Owner | Ops manager            | Frontline operator            | Finance                 | Streamer              | Collaboration MCN            | Vendor/customer         |
| ------------------------------------ | ----- | ---------------------- | ----------------------------- | ----------------------- | --------------------- | ---------------------------- | ----------------------- |
| Project status and delivery progress | Yes   | Yes                    | Scoped                        | Read                    | Own task only         | Scoped                       | Public scope            |
| Vendor receivable                    | Yes   | Yes                    | Scoped if already allowed     | Yes                     | No                    | Scoped if explicitly allowed | Public summary only     |
| Streamer payable                     | Yes   | Scoped                 | No by default                 | Yes                     | Own safe payable only | Own org scoped               | No                      |
| MCN gross profit and margin          | Yes   | Yes if already allowed | No by default                 | Yes                     | No                    | No by default                | No                      |
| Internal risk notes                  | Yes   | Yes                    | Scoped operational notes only | Read if finance-related | No                    | No                           | No                      |
| Audit and high-risk actions          | Yes   | Yes                    | Own/actionable subset         | Finance-related subset  | No                    | Own collaboration subset     | No                      |
| Sensitive exports                    | Yes   | Yes                    | Request or limited export     | Finance exports         | Own safe data only    | Scoped exports               | Authorized package only |

## 8. Data Flow

Recommended architecture:

1. Authentication resolves the account role, organization, project scope, streamer identity, and collaboration scope.
2. A dashboard profile resolver maps the account to a dashboard type.
3. A metric query layer reads existing business records and computes shared metric facts.
4. A role projection layer masks and reshapes those facts into a role-specific dashboard DTO.
5. The UI renders reusable dashboard widgets from the DTO and links back to existing module routes.

This keeps metric definitions consistent while allowing different dashboard layouts.

Implementation guidance for a later plan:

- Prefer server-side aggregation for sensitive financial and governance metrics.
- Reuse existing project, live operation, report, settlement, admission, export, notification, and collaboration query modules where possible.
- Avoid client-side filtering as the only privacy boundary.
- Make every dashboard card carry a typed drilldown target, not a free-form route string.

## 9. Interaction Model

Each role homepage should have four stable regions:

1. KPI strip: five to seven numbers that answer the account's default business question.
2. Action queue: records requiring work, sorted by due time and business impact.
3. Risk panel: exceptions, weak evidence, low margin, high-risk audit events, or permission-relevant blockers.
4. Drilldown list: project, task, report, settlement, candidate, or package rows that take the user to the existing workflow.

Dashboard cards should not perform high-risk writes directly. They can open the correct workflow with context preselected.

## 10. Empty, Stale, And Partial Data States

- Use explicit empty states when no records exist.
- Do not display missing financial data as zero unless the source value is truly zero.
- If one metric family fails to load, show the rest of the dashboard with a visible partial-data warning.
- If data is scoped by role, label it as "my projects", "authorized projects", "own reports", or "collaboration scope" rather than implying full organization coverage.
- For time-windowed metrics, show the window: today, this week, current month, project lifecycle, or selected custom range.

## 11. MVP Phasing

### Phase 1: Staff Role Homepages

Build the staff dashboard router and four staff DTOs:

- `owner`
- `ops_manager`
- `operator_business`
- `finance`

Deliver:

- Role-specific default homepage.
- Shared metric foundation for project health, admission, live execution, report evidence, settlement, and governance.
- Drilldowns to existing modules.
- Field masking tests for finance and operator boundaries.

### Phase 2: Streamer Dashboard Enhancements

Enhance the existing streamer task and settlement surfaces:

- Today task KPI strip.
- Report state tracker.
- Safe earnings summary.
- Recording and report feedback queue.

### Phase 3: Collaboration MCN Dashboard

Add a partner-scoped dashboard for active collaboration agreements:

- Collaboration projects.
- Partner streamer contribution.
- Partner anomalies.
- Collaboration settlement state.

### Phase 4: Vendor / Customer Review Dashboard

Extend existing share-board and delivery package surfaces:

- Candidate review summary.
- Recording review queue.
- Delivery package status.
- Strict public-field DTO.

## 12. Testing Strategy

- Unit-test shared metric calculations with empty, partial, and mixed-status data.
- Unit-test each role projection so hidden fields are absent, not merely hidden by UI.
- Route-test dashboard API authorization and organization scoping.
- UI-test role landing behavior for owner, operations lead, operator, and finance.
- Add regression coverage that streamer and vendor DTOs do not contain receivable, gross margin, supplier cost, or internal risk fields.
- Preserve existing workflow tests for project, admission, live reports, settlement, collaboration, and governed exports.

## 13. Product Acceptance Criteria

- Logging in as each staff role lands on the correct role dashboard.
- The same metric has the same value when shown to multiple roles with the same data scope.
- A role never receives hidden financial or internal-risk fields in its dashboard payload.
- Every actionable queue item links to an existing workflow or a clearly defined read-only detail.
- Empty projects, no reports, and no settlement data render as explicit empty states.
- High-risk actions remain inside their governed workflows and continue to require reason, permission, and audit logging.
