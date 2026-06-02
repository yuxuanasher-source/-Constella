# P3 Governance Checklist

## Scope In

- [x] Audit center lists filterable audit logs with role-scoped visibility.
- [x] Export center uses field whitelists, sensitivity flags, async placeholders, and export audit logs.
- [x] Notification center supports unread / read / handled / ignored transitions and my todos.
- [x] Deterministic anomaly scanner covers not started, not reported, overdue report, missing screenshot, and live over 48h.
- [x] Delivery package DTOs remove price, margin, cost, and internal risk notes.

## Scope Out

- [ ] External channels such as WeCom, Feishu, SMS, and email remain out of P3 v1.
- [ ] AI decisioning and automatic review stay in P4.
- [ ] SaaS package gates and metering stay in P5.

## Security Boundaries

- [ ] New business tables include `organization_id` and RLS.
- [ ] Every write action uses the shared audit writer.
- [x] Audit logs remain append-only with no update/delete API.
- [x] Delivery/export DTOs are server-side filtered and never rely on frontend hiding.
- [x] Sensitive fields such as cost, margin, vendor receivable, and internal risk notes are not exposed to streamer/vendor-facing outputs.

## Verification

- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm test`
- [x] `pnpm build`
- [ ] `pnpm supabase:migrate` (no migration in this audit-center slice)
- [x] `pnpm test:api-integration-smoke`
- [x] P1 and P2 golden paths still pass.
