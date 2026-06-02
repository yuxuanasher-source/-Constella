# P4 Flywheel Checklist

## Scope In

- [x] Auto review shadow mode evaluates pending live reports with eight-gate decisions.
- [ ] Auto review active pass is gated by active rule version and does not run by default.
- [x] Pricing calculator returns receivable, payable, supplier cost, gross margin, margin rate, break-even, suggested minimum quote, and risk notes.
- [x] Streamer matching engine returns score, reasons, risk notes, reference projects, and suggested settlement method.
- [x] Supplier quality score handles completion, screening pass, margin contribution, anomalies, and blacklist penalties.
- [x] Project review report summarizes delivery, finance, best/worst streamers, supplier performance, and next-round recommendations.
- [ ] AI safety layer uses registered read-only tools, writes audit for every query, and never exposes organization finance data to streamers.

## Scope Out

- [ ] Real external AI provider calls remain out of P4 v1; use deterministic placeholder responses.
- [ ] Automatic review active rollout remains off until shadow consistency data is accepted.
- [ ] SaaS package gates, metering, and billing stay in P5.

## Security Boundaries

- [ ] Auto review writes audit for shadow and active evaluations.
- [ ] Auto review active approval must not calculate money; it only enters the settlement pool exactly like manual approval.
- [x] Pricing and review calculations avoid floating-point money storage assumptions and expose cents/decimal-safe outputs.
- [ ] AI tools inherit actor role and scope; no arbitrary SQL or direct DB access is exposed.
- [ ] Streamer-facing AI DTOs do not include receivable, gross margin, cost, supplier cost, or internal risk notes.

## Verification

- [ ] `pnpm test:p4-flywheel`
- [ ] `pnpm test:p3-governance`
- [ ] `pnpm test:golden`
- [ ] `pnpm lint`
- [ ] `pnpm type-check`
- [ ] `pnpm build`
