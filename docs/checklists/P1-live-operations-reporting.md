# P1 M4/M5 Live Operations And Reporting Checklist

## Scope Implemented

- [x] Staff can create one or many live tasks for joined `project_streamers` only.
- [x] Streamers and staff can start / stop live tasks with system timing captured on `live_tasks`.
- [x] Reports are created only from live tasks, preserving the product rule that reports must enter from tasks.
- [x] Report submission freezes `settlement_duration`, `time_source`, and `evidence_level` at write time.
- [x] Evidence resolution prioritizes system duration, then screenshot duration, then claimed duration.
- [x] Staff review can approve, reject, or request more information.
- [x] Approved reports enter the settlement pool by flag only; no settlement batch item or money calculation is created in P1.
- [x] Audit logs and notifications are written for task creation, task timing, report submission, and report review.
- [x] Frontend-safe DTOs exist for streamer task cards and ops report review queue.

## API Surface

- [x] `POST /api/live-tasks`
- [x] `POST /api/live-tasks/batch`
- [x] `POST /api/live-tasks/:taskId/start`
- [x] `POST /api/live-tasks/:taskId/stop`
- [x] `POST /api/live-tasks/:taskId/reports`
- [x] `GET /api/live-reports`
- [x] `PATCH /api/live-reports/:reportId/review`
- [x] `GET /api/streamer/live-tasks`

## Verification

- [x] Unit tests cover task state transitions, evidence resolution, service permissions, and DTO safety.
- [x] Service permission regressions cover streamer binding, streamer task ownership, and cross-organization task/report defense.
- [x] API route contracts return 403 for live-operation service permission denials.
- [x] API route contracts pin the M5 ops review payload used by the reference UI.
- [x] DTO contracts keep M5 report queue responses camelCase and amount-free.
- [x] HTTP integration smoke covers authenticated M5 report queue reads with seed data.
- [x] M5 frontend smoke covers report approval payload, local approved state, and settlement-pool insertion with `pnpm test:ui-smoke`.
- [x] Streamer frontend smoke covers start live -> stop live -> submit report payload and submitted confirmation with `pnpm test:ui-smoke`.
- [x] Seed data contains one joined project streamer, one report-pending task, one pending report, and one screenshot record.
- [ ] UI pages are wired to the new APIs.
- [ ] Authenticated browser smoke tests cover task start / stop / report / review.
