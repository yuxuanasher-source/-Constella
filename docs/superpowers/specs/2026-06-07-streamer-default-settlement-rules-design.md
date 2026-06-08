# Streamer Default Settlement Rules Design

## Goal

Add per-streamer default settlement rules in the streamer resource pool so an MCN can configure a streamer's baseline CPT hourly price, CPS share rate, and base salary, then carry those values into project admission and settlement without changing historical project settlement snapshots.

## Current Context

The current codebase already has most of the settlement backbone:

- `streamers` stores the streamer business profile and already includes `default_settlement_method`, `default_price`, and `default_base_salary`.
- `project_streamers` stores the joined-project relationship and already includes `settlement_method`, `hourly_rate`, `base_salary`, and `settlement_rule`.
- `confirmApplicationJoin` currently freezes the project default settlement rule into `project_streamers` when a streamer joins a project.
- Settlement batch generation reads `project_streamers` for payable batches and reads `projects` for receivable batches.
- The settlement engine already calculates CPT, base salary, and base salary plus CPT. CPA, CPS, gift, and manual rows are currently manual carrying rows.
- The streamer resource pool UI can select a default settlement method, but cannot input CPT hourly price, CPS share rate, or base salary.

The missing product loop is: streamer resource pool default rule -> project join snapshot -> settlement preview and settlement batch explanation.

## Non-Goals

- Do not bind commercial pricing directly to `profiles` or organization members. The subaccount is a login identity; the commercial subject is `streamers.id`.
- Do not recalculate historical project settlement when a streamer's default rule changes.
- Do not expose internal margin, vendor receivable, supplier cost, or other streamers' settlement data to streamer-facing APIs.
- Do not build a full sales order or GMV ledger in this feature.
- Do not make CPS fully automatic until the system has a trusted sales amount source.

## Recommended Approach

Use the existing streamer and project-streamer settlement fields, add one missing CPS percentage field, and formalize rule inheritance.

Rule inheritance:

1. Project-level streamer override, if a future admission UI supplies one.
2. Streamer resource pool default rule.
3. Project default settlement rule.
4. Manual rule fallback.

The important boundary is that settlement batches read the frozen `project_streamers` snapshot, not the latest `streamers` row. This keeps locked and historical settlement stable.

## Data Design

Keep existing fields:

- `streamers.default_settlement_method`
- `streamers.default_price`
- `streamers.default_base_salary`
- `project_streamers.settlement_method`
- `project_streamers.hourly_rate`
- `project_streamers.base_salary`
- `project_streamers.settlement_rule`

Add CPS rate fields:

```sql
alter table public.streamers
  add column default_cps_rate_bps integer not null default 0,
  add constraint streamers_default_cps_rate_bps_range
    check (default_cps_rate_bps >= 0 and default_cps_rate_bps <= 10000);

alter table public.project_streamers
  add column cps_rate_bps integer not null default 0,
  add constraint project_streamers_cps_rate_bps_range
    check (cps_rate_bps >= 0 and cps_rate_bps <= 10000);
```

Use basis points for percentages:

- `10000` = 100%
- `1500` = 15%
- `250` = 2.5%

The current settlement engine and tests treat hourly price values as yuan, so this feature should keep `default_price`, `hourly_rate`, and `base_salary` as yuan values unless a separate money-unit migration is planned. During implementation, check and align any UI display that divides project hourly rates by 100.

Example frozen `project_streamers.settlement_rule`:

```json
{
  "source": "streamer_default",
  "settlementMethod": "base_salary_cpt",
  "cptHourlyRate": 80,
  "baseSalary": 6000,
  "cpsRateBps": 0,
  "snapshotAt": "2026-06-07T00:00:00.000Z"
}
```

## Backend Design

### Streamer Service

Extend streamer settlement inputs:

- `defaultHourlyRate?: number`
- `defaultBaseSalary?: number`
- `defaultCpsRateBps?: number`
- `defaultSettlementMethod?: StreamerSettlementMethod`

Validation:

- `displayName` remains required for creation.
- Hourly rate must be finite and non-negative.
- Base salary must be finite and non-negative.
- CPS rate must be an integer from `0` to `10000`.
- If method is `cpt` or `base_salary_cpt`, hourly rate may be zero but the UI should warn that the rule will calculate zero CPT until configured.
- If method is `base_salary` or `base_salary_cpt`, base salary may be zero but the UI should show "未配置".
- If method is `cps`, CPS rate may be zero but the UI should show "未配置".

Add a dedicated update service:

```ts
updateStreamerSettlementRule({
  repo,
  audit,
  actor,
  streamerId,
  input,
  reason,
});
```

Permission:

- `owner` and `ops_manager` can update.
- `operator_business` can read but cannot update.
- `finance` can read but cannot update.
- `streamer` cannot update.

Audit:

- Module: `streamer`
- Object type: `streamer`
- Action: `update`
- `isHighRisk: true`
- Required reason
- Changed fields include `default_settlement_method`, `default_price`, `default_base_salary`, and `default_cps_rate_bps` as applicable.

### Streamer Repository and Queries

Creation and updates should map:

- `defaultHourlyRate` -> `default_price`
- `defaultBaseSalary` -> `default_base_salary`
- `defaultCpsRateBps` -> `default_cps_rate_bps`

List and profile queries should select the new CPS field. DTOs should expose a safe, display-ready summary:

```ts
settlement: {
  method: "base_salary_cpt",
  cptHourlyRate: 80,
  baseSalary: 6000,
  cpsRateBps: 0,
  label: "底薪 ¥6000 + CPT ¥80/h"
}
```

### API Routes

Extend `POST /api/streamers`:

```json
{
  "displayName": "小鹿",
  "defaultSettlementMethod": "base_salary_cpt",
  "defaultHourlyRate": 80,
  "defaultBaseSalary": 6000,
  "defaultCpsRateBps": 0
}
```

Add:

- `PATCH /api/streamers/:streamerId/settlement-rule`

Example:

```json
{
  "defaultSettlementMethod": "cps",
  "defaultHourlyRate": 0,
  "defaultBaseSalary": 0,
  "defaultCpsRateBps": 1500,
  "reason": "签约分成规则更新"
}
```

Expected responses:

- `200` with updated streamer summary.
- `400` for invalid numbers, invalid settlement method, missing reason, or CPS rate out of range.
- `401` when unauthenticated.
- `403` when the role cannot update streamer settlement rules.
- `404` when the streamer does not exist or is outside the current organization.

### Project Admission Snapshot

Extend admission repository access so `confirmApplicationJoin` can load the streamer's default settlement rule before creating `project_streamers`.

Add to `StreamerAdmissionRecord`:

- `defaultSettlementMethod`
- `defaultHourlyRate`
- `defaultBaseSalary`
- `defaultCpsRateBps`

Snapshot resolution:

```ts
function resolveProjectStreamerSettlementRule({
  streamer,
  project,
  override,
  now,
}) {
  if (override) return snapshotFromOverride(override, now);
  if (streamerHasConfiguredSettlement(streamer)) {
    return snapshotFromStreamerDefault(streamer, now);
  }
  return snapshotFromProjectDefault(project, now);
}
```

`streamerHasConfiguredSettlement` should be true when at least one of these is configured:

- non-zero hourly rate for CPT-bearing methods
- non-zero base salary for base-salary methods
- non-zero CPS rate for CPS
- a non-manual `defaultSettlementMethod` intentionally selected

`createProjectStreamer` should write:

- `settlement_method`
- `hourly_rate`
- `base_salary`
- `cps_rate_bps`
- `settlement_rule`

The audit for join confirmation should include the application status change as it does now. The created `project_streamers` row should be inspectable in tests to prove that the rule was frozen from the streamer default.

## Settlement Design

### CPT

Keep current logic:

```text
settlementDuration / 60 * hourlyRate
```

Only calculate when:

- `evidenceLevel = green`
- `timeSource = system`

### Base Salary

Keep current logic:

- `base_salary` applies once per streamer per settlement batch.
- `base_salary_cpt` applies base salary once plus CPT per eligible report.

### CPS

First version stores and freezes the CPS percentage, but does not auto-compute system amount from live reports because the system does not yet have a trusted sales amount or GMV source.

For settlement center imports or manual carrying rows, support a CPS helper:

```ts
calculateCpsManualAmount({
  salesAmount,
  cpsRateBps,
}) = roundCurrency((salesAmount * cpsRateBps) / 10000);
```

The generated manual row should store:

```json
{
  "source": "manual_cps_import",
  "salesAmount": 12000,
  "cpsRateBps": 1500,
  "settlementRuleSource": "project_streamer_snapshot"
}
```

This preserves a clear path to future automation: when a trusted sales table exists, CPS can move from manual amount into computed amount using the same frozen rate.

## Frontend Design

### Streamer Resource Pool

In the create/edit streamer form, add settlement fields:

- Settlement method select.
- CPT hourly price input, visible for `cpt` and `base_salary_cpt`.
- CPS share percentage input, visible for `cps`.
- Base salary input, visible for `base_salary` and `base_salary_cpt`.

The list column should show compact rule labels:

- `CPT ¥80/h`
- `CPS 15%`
- `底薪 ¥6000`
- `底薪 ¥6000 + CPT ¥80/h`
- `手动结算`

The right detail panel should show:

- Default settlement rule.
- CPT hourly price.
- CPS share.
- Base salary.
- A small note: "适用于未来入项，已入项项目以项目内快照为准。"

### Project Join Confirmation

When confirming a streamer into a project, show the settlement snapshot that will be frozen:

- Source: streamer default, project default, or project override.
- Method.
- CPT hourly price.
- CPS share.
- Base salary.

For the first implementation, the UI can display the snapshot without override editing. A later iteration can add per-project override editing before join.

### Settlement Center

Settlement pool preview should continue showing expected CPT/base salary amounts. CPS rows should display the frozen share rate and explain that amount is produced by CPS import/manual carrying until sales data automation exists.

Manual CPS import should let staff enter:

- Streamer
- Sales amount
- Optional manually confirmed amount
- Reason

If manually confirmed amount is omitted, calculate from frozen CPS rate.

## Permissions and Security

- Streamer settlement default changes are high-risk operations.
- Only `owner` and `ops_manager` can mutate streamer settlement defaults.
- Existing billing write guard should protect the new write route using the same read-only billing behavior as other write routes.
- Streamer-facing DTOs must never return vendor receivable, gross margin, supplier cost, or other streamers' amounts.
- All streamer reads and writes must stay scoped to `organization_id`.
- Subaccount binding remains one field on the streamer profile. Settlement rules belong to the streamer profile, not the subaccount profile.

## Migration and Backfill

Migration:

1. Add `default_cps_rate_bps` to `streamers`.
2. Add `cps_rate_bps` to `project_streamers`.
3. Add check constraints for both fields.
4. Update schema contract tests to pin the new fields and constraints.

Backfill:

- Existing rows default to `0`.
- Existing CPT and base salary behavior remains unchanged.
- Existing project streamer snapshots remain valid with `cps_rate_bps = 0`.

## Testing Strategy

### Unit Tests

`features/streamers/streamer-service.test.ts`:

- Creates streamer with CPT hourly price.
- Creates streamer with CPS share rate.
- Creates streamer with base salary plus CPT.
- Rejects negative hourly price.
- Rejects negative base salary.
- Rejects CPS rate below `0` or above `10000`.
- Requires reason for update.
- Blocks `operator_business`, `finance`, and `streamer` settlement-rule updates.

`features/streamers/streamer-ui-dto.test.ts`:

- Formats `CPT ¥80/h`.
- Formats `CPS 15%`.
- Formats `底薪 ¥6000 + CPT ¥80/h`.
- Does not expose margin or vendor receivable.

`features/applications/application-service.test.ts`:

- Confirms join using streamer default rule when configured.
- Falls back to project default rule when streamer default is unconfigured.
- Freezes `cpsRateBps` into `project_streamers`.

`features/settlements/settlement-engine.test.ts`:

- Existing CPT and base salary tests continue passing.
- CPS still does not auto-compute without a sales amount source.
- CPS manual helper calculates `salesAmount * cpsRateBps / 10000`.

`features/settlements/settlement-service.test.ts`:

- Payable batch continues reading `project_streamers`.
- Base salary applies once per streamer per batch.
- CPS manual import stores sales amount and frozen rate in `evidenceSnapshot`.

### Route Tests

`app/api/streamers/route.test.ts`:

- `POST /api/streamers` accepts settlement price fields.
- Invalid numeric fields return `400`.

`app/api/streamers/[streamerId]/settlement-rule/route.test.ts`:

- Authorized update succeeds.
- Missing reason returns `400`.
- Unauthorized role returns `403`.
- Billing read-only mode returns `403`.

### Regression Tests

`features/regression/settlement-golden-path.test.ts`:

- Streamer default CPT is frozen at join.
- Approved green system report generates expected payable.
- Streamer safe bill shows only payable-safe fields.

### UI Smoke Tests

`components/reference-ui/ops-reference.test.jsx`:

- Streamer resource pool create form includes CPT, CPS, and base salary inputs.
- Created streamer displays the compact default settlement label.
- Streamer detail panel displays the configured settlement rule.
- Settlement center still supports CPA/CPS import flow.

## Rollout Plan

1. Ship schema migration and contract tests.
2. Ship service and repository support for streamer default settlement fields.
3. Ship create/update API routes with high-risk audit and billing guard.
4. Ship project admission snapshot resolution.
5. Ship settlement center CPS manual import helper.
6. Ship streamer resource pool UI fields and labels.
7. Run targeted tests, then full verification chain:

```bash
pnpm format:check
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

## Acceptance Criteria

- Operations can configure a streamer's CPT hourly price in the streamer resource pool.
- Operations can configure a streamer's CPS share rate in the streamer resource pool.
- Operations can configure a streamer's base salary in the streamer resource pool.
- A streamer can still be bound to one login subaccount; settlement rules remain attached to the streamer profile.
- Confirming project join freezes the resolved settlement rule into `project_streamers`.
- Future changes to the streamer default rule do not alter existing `project_streamers` snapshots.
- Payable settlement batches calculate CPT and base salary from the frozen snapshot.
- CPS percentage is preserved in the snapshot and used for CPS import/manual carrying.
- Streamer-facing settlement views remain safe and do not expose internal financial fields.
- All settlement default mutations are permission-checked, reason-required, and audited as high-risk changes.
