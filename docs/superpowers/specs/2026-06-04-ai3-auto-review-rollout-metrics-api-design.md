# AI3 Auto Review Rollout Metrics API Design

## Goal

Expose a read-only API endpoint for operations staff to inspect AI-3 automatic review rollout readiness. The endpoint returns measured rollout metrics, the computed rollout gate result, and the failed gate reasons without enabling active automatic review.

## Scope

- Add `GET /api/auto-review/rollout-metrics`.
- Reuse `listAutoReviewRolloutMetricRows`.
- Reuse `evaluateAutoReviewRolloutGate`.
- Keep active approval service unchanged.
- Do not add write actions, mutations, UI, or migrations.
- Do not expose raw `audit_logs` rows.

## Access Control

Allowed roles:

- `owner`
- `ops_manager`
- `operator_business`

Other roles receive `403`. Missing auth receives `401`.

## Query Parameters

- `targetMode`: optional `shadow | gray | active`, default `shadow`
- `limit`: optional integer, repository adapter clamps it to its safe range
- `explicitActiveRequest`: optional boolean, default `false`
- `killSwitchEnabled`: optional boolean, default `false`
- `minimumShadowSampleCount`: optional integer, default `50`
- `maximumFalseAcceptRateBps`: optional integer, default `100`
- `minimumAuditSampleCount`: optional integer, default `20`
- `maximumAuditErrorRateBps`: optional integer, default `250`

Invalid enum values return `400`.

## Response Shape

The endpoint returns:

```json
{
  "result": {
    "gate": {
      "allowed": false,
      "targetMode": "active",
      "effectiveMode": "shadow",
      "reasons": [],
      "failedGates": ["insufficient_shadow_samples"]
    },
    "metrics": {
      "gateInput": {},
      "summary": {}
    }
  }
}
```

`metrics.gateInput` is included because it is already sanitized rollout input. Raw audit row content stays private.

## Error Handling

- Supabase creation failure returns `401`.
- Auth lookup failure returns `401`.
- Unauthorized role returns `403`.
- Invalid query parameters return `400`.
- Repository or service errors use `statusForServiceError`.

## Testing

- Route contract test returns gate and metrics for operations staff.
- Route contract test blocks streamers.
- Route contract test validates `targetMode`.
- Route contract test passes parsed config and limit into repository adapter.
- Existing P4 and AI-system tests continue to pass.

## Acceptance

- Operations staff can inspect rollout readiness from measured audit data.
- Endpoint is read-only.
- Endpoint does not open active mode or approve reports.
- Existing auto-review behavior remains unchanged.
