# AI3 Auto Review Metrics Repository Design

## Goal

Add a read-only repository adapter that converts existing `audit_logs` rows into the shadow outcomes and audit samples consumed by the AI-3 rollout metrics builder.

## Scope

- Create a focused repository module under `features/auto-review`.
- Query only `audit_logs`.
- Reuse `buildAutoReviewRolloutMetrics`.
- Keep the rollout gate and active service unchanged.
- Do not add a migration.
- Do not add an API route or UI.
- Do not enable active automatic review.

## Data Source

The adapter reads append-only `audit_logs` rows for one organization. It only considers:

- `module = "auto_review"` rows for shadow decisions.
- `module = "live_report"` rows for final human review outcomes.
- `object_type = "live_report"` rows.
- `result = "success"` rows.

The query orders by `created_at desc` and uses a caller-provided safe limit.

## Row Mapping

Shadow rows map from `after_json`:

- `after_json.mode === "shadow"` is required.
- `after_json.decision` maps to `shadowDecision`.
- `object_id` maps to `reportId`.

Human review rows map from audit fields and `after_json.status`:

- `action = "approve"` or `after_json.status = "approved"` maps to `approve`.
- `action = "reject"` and `after_json.status = "rejected"` maps to `reject`.
- `action = "reject"` and `after_json.status = "need_more"` maps to `needs_changes`.
- Any missing or unsupported final state maps to `unknown`.

When multiple human review rows exist for a report, the most recent row wins.

## Audit Samples

This phase derives audit samples from active automatic review rows that already include a reviewer outcome in `after_json.auditOutcome`. Supported fields:

- `expectedDecision`
- `actualDecision`

Rows without both fields are ignored. This lets future sampling workers write compatible metadata without requiring a schema change.

## Public Interface

The module exposes:

- `listAutoReviewRolloutMetricRows(client, actor, options)`
- `buildAutoReviewRolloutMetricsFromAuditRows(input)`

`listAutoReviewRolloutMetricRows` reads rows and returns a metrics snapshot. `buildAutoReviewRolloutMetricsFromAuditRows` is pure and maps supplied rows into the existing metrics builder.

## Error Handling

- Supabase errors are thrown.
- Missing row arrays are treated as empty.
- Invalid decisions are ignored or mapped to `unknown`.
- Limits are clamped between `1` and `500`.

## Testing

- Unit test pure row mapping with correlated shadow and human review rows.
- Unit test most recent human review wins.
- Unit test repository query filters organization, modules, object type, result, order, and safe limit.
- Unit test active audit sample metadata feeds audit error rate.
- Regression run keeps existing auto-review, AI-system, and P4 tests green.

## Acceptance

- Metrics can be built from existing audit log rows.
- Repository adapter is read-only.
- No business code directly flips active mode.
- Existing rollout metrics and rollout gate behavior remain unchanged.
