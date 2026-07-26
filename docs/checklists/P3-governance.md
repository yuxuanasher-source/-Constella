# P3 Governance Checklist

## Scope In

- [x] Audit center lists filterable audit logs with role-scoped visibility.
- [x] Export center uses field whitelists, sensitivity flags, async placeholders, and export audit logs.
- [x] Notification center supports unread / read / handled / ignored transitions and my todos.
- [x] Deterministic anomaly scanner covers not started, not reported, overdue report, missing screenshot, and live over 48h.
- [x] Manufacturer delivery uses project admission share boards; no standalone delivery-package DTO or `vendor_delivery` export kind remains.

## Scope Out

- [ ] External channels such as WeCom, Feishu, SMS, and email remain out of P3 v1.
- [ ] AI decisioning and automatic review stay in P4.
- [ ] SaaS package gates and metering stay in P5.

## Security Boundaries

- [x] No new business tables were added in P3 v1; existing writes rely on RLS-backed tables.
- [x] Every write action uses the shared audit writer.
- [x] Audit logs remain append-only with no update/delete API.
- [x] Export DTOs and public share-board projections are server-side filtered and never rely on frontend hiding.
- [x] Manufacturer share access is token-gated, expires or can be revoked, and private recordings use the controlled playback route.
- [x] Sensitive fields such as cost, margin, vendor receivable, and internal risk notes are not exposed to streamer/vendor-facing outputs.

## Verification

- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm test:p3-governance`
- [ ] `pnpm supabase:migrate` (no migration in this audit-center slice)
- [x] `pnpm test:api-integration-smoke`
- [x] P1 and P2 golden paths still pass.
