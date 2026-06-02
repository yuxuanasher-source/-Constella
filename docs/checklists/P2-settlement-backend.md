# P2 M6 Settlement Backend Checklist

## Scope Implemented

- [x] Settlement pool reads approved, `enter_settlement_pool` reports that have no `settled_batch_item_id`.
- [x] Batch generation consumes approved reports by setting `live_reports.settled_batch_item_id`.
- [x] Duplicate settlement is guarded by service filtering and the existing unique `settlement_batch_items` index.
- [x] Payable batches use per-streamer `project_streamers` settlement rules.
- [x] Receivable batches use project default settlement rules.
- [x] The engine calculates only CPT, base salary, and base salary plus CPT.
- [x] CPA, CPS, gift, and manual values are carried as manual rows only.
- [x] Manual amount changes require a reason and write high-risk audit logs.
- [x] Batch lock and reopen require reasons and write high-risk audit logs.
- [x] Reopen is restricted to `owner` in the service layer.
- [x] Finance remains read-only for settlement writes in the P2 RLS migration.
- [x] M6 console stub can receive real settlement batch DTOs without changing the reference UI layout.
- [x] M6 console actions call the settlement create, manual item, lock, and reopen APIs.
- [x] M6 batch detail can render real `settlement_batch_items` rows.
- [x] M6 settlement pool preview renders approved, unsettled reports from the backend scope.
- [x] Streamer mobile settlement reads only `streamer_payable_items_safe` DTOs and does not expose receivable, gross margin, or cost fields.

## API Surface

- [x] `GET /api/settlement-pool?projectId=...&periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD`
- [x] `GET /api/settlement-batches`
- [x] `POST /api/settlement-batches`
- [x] `POST /api/settlement-batches/:batchId/manual-items`
- [x] `POST /api/settlement-batches/:batchId/lock`
- [x] `POST /api/settlement-batches/:batchId/reopen`
- [x] `GET /api/streamer/settlements`

## Verification

- [x] Unit tests cover engine boundaries, service permissions, duplicate-pool behavior, manual carrying rows, and DTO mapping.
- [x] Service permission regressions filter cross-organization pool rows and block cross-organization batch generation.
- [x] API route contracts return 403 for settlement service permission denials.
- [x] Golden-path regression covers submit report -> approve -> settlement pool -> payable batch -> streamer-safe bill with `pnpm test:golden`.
- [x] M6 frontend smoke covers the create-batch button, POST payload, batch list update, and settlement-pool removal with `pnpm test:ui-smoke`.
- [x] Schema contract covers the settlement pool index and finance read-only RLS write boundary.
- [x] Seed data includes one unsettled approved report and one generated payable batch.
- [x] Local page smoke confirms `/console/stubs/m6` responds.
- [ ] Browser smoke test creates a fresh batch from the pool through the UI.
- [ ] Export, invoicing, payment, and full gross-margin reports are intentionally out of this slice.
