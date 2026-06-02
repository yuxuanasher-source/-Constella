# P5 Commercialization Checklist

## Scope In

- [x] Billing schema includes plans, subscriptions, usage events, monthly counters, usage add-ons, and feature add-ons.
- [x] Billing business tables carry `organization_id`, RLS, and org-scoped policies.
- [x] Feature gates support free/basic/pro/enterprise plans plus feature add-ons.
- [x] Usage metering supports active streamers, seats, OCR, AI, storage, exports, monthly reset keys, soft overage, and add-on credits.
- [x] Past-due subscriptions downgrade write actions to read-only without deleting settlement or audit data.
- [x] Billing APIs expose safe usage/entitlement status for authenticated MCN staff.

## Scope Out

- [x] Real payment provider integration remains out of P5 v1 placeholder.
- [x] Invoice issuing and tax workflows remain out of P5 v1.
- [x] Enterprise SSO/private deployment is documented as extension-ready, not fully integrated.

## Security Boundaries

- [x] Billing write operations use audit logs.
- [x] Streamers cannot read organization billing economics or subscription status.
- [x] Past-due guard blocks writes but allows read-only access.
- [x] Settlement and audit records are never deleted or hidden by downgrade.

## Verification

- [x] `pnpm test:p5-commercialization`
- [x] `pnpm test:p4-flywheel`
- [x] `pnpm test:p3-governance`
- [x] `pnpm test:golden`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm build`
