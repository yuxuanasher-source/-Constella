# AI3 Auto Review Metrics Design

## Goal

Add a read-only metrics snapshot layer for AI-3 automatic review rollout. The layer converts historical shadow decisions and manual audit outcomes into `AutoReviewRolloutGateInput`, so the existing rollout gate can be driven by measurable evidence instead of hand-built parameters.

## Scope

- Create a pure metrics builder under `features/auto-review`.
- Keep `evaluateAutoReviewRolloutGate` unchanged.
- Keep `evaluateAutoReviewShadow` and `evaluateAutoReviewActive` unchanged in this phase.
- Do not enable active mode automatically.
- Do not add API routes or UI in this phase.
- Do not add a database migration in this phase.

## Inputs

The metrics builder accepts:

- rollout configuration:
  - `targetMode`
  - `killSwitchEnabled`
  - `minimumShadowSampleCount`
  - `maximumFalseAcceptRateBps`
  - `minimumAuditSampleCount`
  - `maximumAuditErrorRateBps`
  - `explicitActiveRequest`
- shadow review outcomes:
  - shadow decision
  - final human decision
  - optional sampled flag
- audit samples:
  - expected decision
  - actual decision

## Metrics

The builder calculates:

- `shadowSampleCount`: number of shadow decisions considered for rollout.
- `shadowFalseAcceptRateBps`: among shadow `auto_pass_candidate` decisions, the rate where final human decision was not approve.
- `auditSampleCount`: number of manual audit samples considered.
- `auditErrorRateBps`: among audit samples, the rate where expected and actual decisions differ.

Rates use basis points and safe integer math. Empty denominators return `0` so insufficient sample gates, not divide-by-zero behavior, decide rollout safety.

## Output

The builder returns:

- `gateInput`: a complete `AutoReviewRolloutGateInput`
- `summary`: denominator and numerator details for future UI/API/audit consumers

The output must be deterministic and free of side effects.

## Data Boundary

This phase does not read Supabase directly. A follow-up phase can add a repository adapter that maps rows from `audit_logs`, `recommendation_outcomes`, or dedicated review tables into these in-memory records. Keeping the first layer pure locks the rollout math and keeps CI independent from database state.

## Errors And Edge Cases

- Unknown or unreviewed final human decisions are excluded from false accept denominators.
- Shadow decisions other than `auto_pass_candidate` count toward `shadowSampleCount` but not the false accept denominator.
- Audit samples with missing decisions are excluded from the audit denominator.
- Negative or non-finite thresholds are passed through the existing rollout gate sanitization only after metrics are constructed.

## Testing

- Unit test rate math for false accepts.
- Unit test insufficient sample counts are preserved in `gateInput`.
- Unit test unknown final decisions are ignored for false accept rate.
- Unit test audit error rate math.
- Unit test the builder output can be passed to `evaluateAutoReviewRolloutGate` to block or allow active mode.

## Acceptance

- Rollout gate input can be created from historical records without external calls.
- No production code performs write operations.
- Existing auto-review service behavior remains unchanged.
- Focused tests and existing AI/P4 regression tests pass.
