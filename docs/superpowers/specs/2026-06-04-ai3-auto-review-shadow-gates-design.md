# AI3 Auto Review Shadow Gates Design

## Goal

Add an AI-3 rollout gate layer for automatic review so active approval cannot be enabled until shadow performance, audit sampling, and kill switch checks pass. This does not change the existing eight-gate auto-review engine.

## Scope

In scope:

- Add a pure rollout gate evaluator under `features/auto-review`.
- Keep `evaluateAutoReview` unchanged.
- Keep `evaluateAutoReviewShadow` unchanged.
- Extend `evaluateAutoReviewActive` with an optional rollout gate result.
- Block active application when a gate result is present and not allowed.
- Default target mode remains `shadow`.

Out of scope:

- No new database migration in this slice.
- No UI switch.
- No automatic rollout state transition.
- No active enablement by default.
- No learning-loop weight changes.

## Public Contract

`AutoReviewRolloutGateInput` accepts:

- `targetMode`: `shadow | gray | active`
- `killSwitchEnabled`
- `shadowSampleCount`
- `minimumShadowSampleCount`
- `shadowFalseAcceptRateBps`
- `maximumFalseAcceptRateBps`
- `auditSampleCount`
- `minimumAuditSampleCount`
- `auditErrorRateBps`
- `maximumAuditErrorRateBps`
- `explicitActiveRequest`

`evaluateAutoReviewRolloutGate(input)` returns:

- `allowed`
- `effectiveMode`: `shadow | gray | active`
- `targetMode`
- `reasons`
- `failedGates`

## Decision Rules

- `shadow` is allowed unless the kill switch is enabled.
- Kill switch always blocks `gray` and `active`, and returns `effectiveMode: "shadow"`.
- `active` requires an explicit active request.
- `gray` and `active` require enough shadow samples.
- `active` requires shadow false accept rate within threshold.
- `active` requires enough audit samples.
- `active` requires audit error rate within threshold.
- Any blocked result falls back to `effectiveMode: "shadow"`.

## Active Service Integration

`evaluateAutoReviewActive` keeps its current behavior when no gate result is passed, preserving existing tests and callers. When `rolloutGate` is passed:

- If `rolloutGate.allowed !== true`, throw `Active auto review blocked by rollout gate`.
- If `rolloutGate.effectiveMode !== "active"`, throw the same error.
- If the gate allows active, the existing active rule version and eight-gate evaluation still run.

This makes rollout enforcement opt-in for the new AI-3 path without silently changing the existing P4 API.

## Security And Safety

- Active remains impossible without an active rule version.
- Active rollout becomes impossible with kill switch enabled.
- Blocked gates never call `approveReport`.
- Gate decisions are deterministic and testable.
- Gate outputs are suitable for future persistence in metrics/outcomes tables.

## Testing

- Unit test shadow default allowed behavior.
- Unit test kill switch blocking active.
- Unit test active blocked by missing explicit request.
- Unit test active blocked by low sample count.
- Unit test active blocked by high false accept rate.
- Unit test active blocked by high audit error rate.
- Unit test active allowed only when all gates pass.
- Service test active gate blocks approval and does not call `approveReport`.
- Existing P4, AI, and golden tests must still pass.

## Self Review

- The design adds a rollout safety layer without changing the eight-gate rule engine.
- It keeps the change small and reversible.
- It avoids schema churn until the gate output has stable consumers.
- It keeps active opt-in and auditable.
