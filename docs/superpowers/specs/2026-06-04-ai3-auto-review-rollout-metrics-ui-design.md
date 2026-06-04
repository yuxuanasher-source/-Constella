# AI3 Auto Review Rollout Metrics UI Design

## Goal

Show AI-3 automatic review rollout readiness in the operations console so staff can inspect shadow performance, audit sampling, and gate failure reasons before active mode is considered.

## Scope

- Add a read-only panel to the M10 war-room screen.
- Load initial data for `/console/stubs/m10` from the server.
- Allow a manual refresh through `GET /api/auto-review/rollout-metrics`.
- Do not add an active-mode toggle.
- Do not approve reports or call mutation APIs.
- Do not expose raw audit rows.

## Placement

The panel lives in `ScreenWarRoom` below the top metrics strip and above the tabbed work area. It is visible only when M10 has rollout metrics data or after refresh succeeds.

## Display

The panel shows:

- Effective mode and target mode.
- Shadow sample count.
- Shadow false accept rate.
- Audit compared count.
- Audit error rate.
- Failed gate reasons.
- A read-only status badge: ready, blocked, or shadow-only.

The copy explicitly says the panel is read-only and cannot enable active automatic review.

## Data Flow

Server preload:

- `app/(ops)/console/stubs/[module]/page.tsx`
- For `module === "m10"`, call `listAutoReviewRolloutMetricRows` with conservative active-readiness config.
- Run `evaluateAutoReviewRolloutGate`.
- Pass the result to `OpsReferenceApp`.

Client refresh:

- Add `refreshAutoReviewRolloutMetrics` to existing `actions`.
- Fetch `/api/auto-review/rollout-metrics?targetMode=active&explicitActiveRequest=true`.
- Store the returned `result`.

## Testing

- Component smoke test renders the readiness panel from preloaded data.
- Component smoke test refreshes through the read-only API.
- Server page logic stays role-gated through existing `isMcnStaff` checks.
- P4 and AI-system regressions continue to pass.

## Acceptance

- M10 shows rollout readiness without raw audit rows.
- The UI has no active enablement control.
- Refresh uses only a GET endpoint.
- Existing war-room actions keep working.
