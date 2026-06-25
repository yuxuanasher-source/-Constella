# P1 Applications Screening Checklist

## Scope In

- [x] Streamer signup creates `project_applications` through the service layer.
- [x] Staff direct invitation creates `project_applications` and blocks blacklisted streamers.
- [x] Screening recording submission preserves versions in `recording_submissions`.
- [x] Recording review supports approved / rejected / needs_changes and writes audit.
- [x] Recording approval leaves the application in pending final join state (`recording_approved`), not joined.
- [x] Owner / ops_manager final confirmation creates `project_streamers` with a settlement rule snapshot.
- [x] Final rejection records a not-joined reason.
- [x] REST endpoints exist for signup, invitation, recording submission, review, confirm join, and reject join.
- [x] Frontend-safe DTO queries exist for ops queue and streamer application cards.
- [x] Local acceptance records are created outside source-controlled seed files for non-empty UI/API reads.

## Scope Out

- [ ] Real signed upload URL generation is still in the storage slice.
- [ ] Vendor candidate export is deferred to the M8 export slice.
- [ ] Pixel-level UI wiring is deferred until the finished frontend components are connected to these DTOs.
- [ ] Scheduling remains blocked until `project_streamers.status = joined` exists from this slice.

## Security Boundaries

- [x] New actions rely on existing RLS tables from `20260602013000_p1_admission_foundation.sql`.
- [x] Service actions enforce role rules before repository writes.
- [x] Blacklisted streamers cannot apply or be invited.
- [x] Recording approval does not bypass final owner / ops_manager confirmation.
- [x] DTOs do not expose settlement price, margin, supplier cost, or internal financial fields.
- [x] Review and join decisions write audit and send notifications.

## Verification

- [x] `pnpm test features/applications/application-state.test.ts features/applications/application-service.test.ts`
- [x] `pnpm test features/applications/application-queries.test.ts`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm supabase db reset`
- [ ] API smoke test for `/api/applications` and `/api/streamer/applications` after frontend auth wiring.
