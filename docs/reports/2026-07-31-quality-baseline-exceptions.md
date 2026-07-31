# Quality Baseline Exceptions — 2026-07-31

This file records quality work that is intentionally not hidden by the new
changed-file formatting, critical-domain coverage, and visual smoke gates.

| Exception                               | Current evidence                                                                                                                                | Owner                | Resolution                                                                                                                                                  | Due        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Historical Prettier backlog             | `pnpm format:check` reports 437 files; `pnpm check:changed-format` passes all 21 supported files changed by PR-8C                               | Frontend maintainers | Land mechanical, directory-scoped formatting PRs with semantic diff review; do not reformat `components/reference-ui/ops-reference.jsx` inside feature work | 2026-08-28 |
| Credentialed AI provider smoke tests    | Four tests remain env-gated for OpenAI, Hunyuan, DeepSeek, and Tencent OCR credentials                                                          | AI integrations      | Run in a restricted scheduled workflow with environment-scoped secrets and redacted output                                                                  | 2026-08-14 |
| Database and Hermes live contracts      | The default unit job reports 21 skipped tests in total; remaining skips are container/service-role-gated DB regression or Hermes live contracts | Platform engineering | Move each contract to the isolated database job, provide its documented container/service-role input, and retain destructive cleanup assertions             | 2026-08-21 |
| Admission share full-suite timing flake | One 5,276-test run missed an asynchronously loaded “展开 主播甲 历史版本” control; the same file passed 26/26 immediately in isolation          | Frontend QA          | Replace implicit load timing with an explicit awaited ready state and repeat under constrained workers                                                      | 2026-08-07 |

## Closed in PR-8C

- ESLint: 18 warnings reduced to 0 without adding `eslint-disable`.
- Critical-domain coverage: the corrected gate includes Markdown, billing
  providers and webhooks, usage metering, and the AI knowledge-base adapter;
  statements 87.10%, branches 80.91%, functions 94.54%, lines 88.64%.
- Visual smoke: all six configured viewports pass.
- Changed-file Prettier: exact argument-array execution passes; full-repository
  formatting remains a separately tracked baseline exception above.
