# P4 Flywheel Checklist

## Scope In

- [x] Auto review shadow mode evaluates pending live reports with eight-gate decisions.
- [x] Auto review active pass is gated by active rule version and does not run by default.
- [x] Pricing calculator returns receivable, payable, supplier cost, gross margin, margin rate, break-even, suggested minimum quote, and risk notes.
- [x] Streamer matching engine returns score, reasons, risk notes, reference projects, and suggested settlement method.
- [x] Supplier quality score handles completion, screening pass, margin contribution, anomalies, and blacklist penalties.
- [x] Project review report summarizes delivery, finance, best/worst streamers, supplier performance, and next-round recommendations.
- [x] AI safety layer uses registered read-only tools, writes audit for every query, and never exposes organization finance data to streamers.

## Scope Out

- [x] Real external AI provider calls remain out of P4 v1; use deterministic placeholder responses.
- [x] Automatic review active rollout remains off until shadow consistency data is accepted.
- [x] SaaS package gates, metering, and billing stay in P5.

## Security Boundaries

- [x] Auto review writes audit for shadow and active evaluations.
- [x] Auto review active approval must not calculate money; it only enters the settlement pool exactly like manual approval.
- [x] Pricing and review calculations avoid floating-point money storage assumptions and expose cents/decimal-safe outputs.
- [x] AI tools inherit actor role and scope; no arbitrary SQL or direct DB access is exposed.
- [x] Streamer-facing AI DTOs do not include receivable, gross margin, cost, supplier cost, or internal risk notes.

## Verification

- [x] `pnpm test:p4-flywheel`
- [x] `pnpm test:p3-governance`
- [x] `pnpm test:golden`
- [x] `pnpm lint`
- [x] `pnpm type-check`
- [x] `pnpm build`
