# AI Custom Settlement Rules Phase 3 Payable And Receivable Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved payable and receivable custom rules affect production settlement batches with deterministic project/group/individual composition, report and aggregate execution grains, explicit missing-data behavior, atomic review exceptions, complete rule snapshots, and fixed-rule fallback only when no active custom layer exists.

**Architecture:** Add an execution planner between settlement-pool loading and batch persistence. It resolves effective active versions and frozen group memberships, partitions approved reports into declared grains, builds typed contexts and period aggregates, applies missing-data policy, executes pure compiled ASTs, composes layers, and returns batch items in integer cents. A unit adapter converts final cents to the legacy settlement tables' yuan numerics exactly once. Aggregate items link to all source reports through a normalized junction table. Review-routed work creates zero-total placeholder items and blocking exceptions atomically; unexpected custom-rule failures block generation and never fall back.

**Tech Stack:** Existing settlement service/repository/atomic Postgres RPC, TypeScript pure engine, Supabase/Postgres, Vitest, API route tests, regression golden paths, React reference UI.

---

## Preconditions And Safety Invariants

- Complete Phase 1 and Phase 2 plans first.
- Production execution is controlled by server flag `CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED`, default false.
- Approval must remain disabled while the server execution capability is false.
- If an active custom rule already exists while execution is disabled or broken, batch generation blocks. It must not silently use fixed rules.
- Existing fixed rules remain the base only when the resolver finds no active custom layer for that scope/target/time.
- Locked batches and their snapshots are immutable.

### Task 1: Define Execution Units, Contexts, And Aggregate Semantics

**Files:**

- Modify: `.env.example`
- Modify: `features/settlements/custom-rule-feature-flag.ts`
- Modify: `features/settlements/custom-rule-feature-flag.test.ts`
- Create: `features/settlements/custom-rule-execution-plan.ts`
- Test: `features/settlements/custom-rule-execution-plan.test.ts`
- Create: `features/settlements/custom-rule-execution-context.ts`
- Test: `features/settlements/custom-rule-execution-context.test.ts`
- Create: `features/settlements/custom-rule-business-inputs.ts`
- Test: `features/settlements/custom-rule-business-inputs.test.ts`
- Modify: `features/settlements/custom-rule-types.ts`
- Modify: `features/settlements/custom-rule-validator.ts`
- Modify: `features/settlements/custom-rule-validator.test.ts`

- [ ] Add a failing server-flag test proving only exact `"true"` enables execution. Add `CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED=false` to `.env.example`.

- [ ] Define execution-unit types:

```ts
export type CustomRuleExecutionUnit = {
  key: string;
  grain: CustomRuleExecutionGrain;
  projectId: string;
  projectStreamerId?: string;
  streamerId?: string;
  periodStart: string;
  periodEnd: string;
  sourceReportIds: string[];
  membershipSnapshot: SettlementGroupMembershipSnapshot;
  variables: Record<string, TypedRuntimeValue>;
};
```

- [ ] Reuse this execution planner from both simulation and production. Add parity tests that feed the same frozen source set to each path and compare unit keys, membership/rule partitions, typed contexts, and outputs; do not maintain a lighter simulation-only grain implementation.

- [ ] Write planner tests for:
  - `report` -> one unit per approved eligible report;
  - `project_streamer_period` -> one unit per project streamer and stable membership segment;
  - `batch` -> one unit for the selected batch;
  - `project_period` -> one unit for the project/period;
  - receivable batch-level base fees applied once;
  - payable period guarantees/caps applied once per streamer period;
  - report and streamer-period units partition at effective rule-version boundaries;
  - batch/project-period grain blocks with a split-period instruction when the requested period crosses an effective rule boundary, preventing a once-per-batch fee from being applied twice or under an arbitrary version;
  - deterministic ordering independent of database row order.

- [ ] Define membership changes inside a requested period: resolve assignments at the work-occurrence timestamp `live_tasks.system_started_at`, then `planned_start_at`, then immutable `live_reports.created_at` as the last fallback. `reviewed_at` remains the `approved_at` formula input but never retroactively changes group membership for work already performed. Persist the chosen timestamp/source, then partition `project_streamer_period` units whenever the membership snapshot changes. Never aggregate reports across different membership snapshots.

- [ ] Write context tests mapping persisted source units:
  - duration columns to minutes without multiplying;
  - legacy hourly/base salary yuan to strict cents;
  - CPS basis points unchanged;
  - viewers/counts to safe integers;
  - timestamps/weekday/hour derived deterministically in the rule contract's confirmed IANA business timezone, never the process-local timezone;
  - collaboration/source IDs from frozen project-streamer data;
  - unavailable fields remain missing rather than zero.

- [ ] Compute period aggregates from the unit's approved source reports before execution. The engine receives aggregates and cannot query or iterate arbitrary records.

- [ ] Add a strict business-input adapter for confirmed normalized import rows used by CPS/gift rules. Accept only documented keys such as `salesAmountCents`, `ordersCount`, `giftAmountCents`, explicit `liveReportId`/`streamerId`, period, import batch ID, and row index. Join by explicit IDs and compatible period only; never fuzzy-match names. Sum documented additive fields in stable source order, treat duplicate/non-additive conflicts as missing-data errors, and retain source references in the execution snapshot. Raw unknown JSON keys never enter the DSL context.

- [ ] Add an engine-supplied typed `prior_layer_amount` variable only in modifier validation/execution contexts. It is not a database/catalog field and is not offered for project base rules.

All modifier formulas still return `money_result`:

- `add` formula final is a signed delta; composition adds it to the running amount;
- `multiply` formula final is the absolute new amount and validator requires it to derive from `percent(prior_layer_amount, ...)`;
- `clamp` formula final is the absolute new amount and validator requires it to derive from `clamp(prior_layer_amount, ...)`;
- `replace` formula final becomes the running amount.

This keeps one output contract while making composition semantics auditable. Signed deltas are permitted only for an explicitly typed `add` modifier; final composed money must remain non-negative.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-feature-flag.test.ts features/settlements/custom-rule-execution-plan.test.ts features/settlements/custom-rule-execution-context.test.ts features/settlements/custom-rule-business-inputs.test.ts features/settlements/custom-rule-validator.test.ts
git add .env.example features/settlements/custom-rule-feature-flag.ts features/settlements/custom-rule-feature-flag.test.ts features/settlements/custom-rule-execution-plan.ts features/settlements/custom-rule-execution-plan.test.ts features/settlements/custom-rule-execution-context.ts features/settlements/custom-rule-execution-context.test.ts features/settlements/custom-rule-business-inputs.ts features/settlements/custom-rule-business-inputs.test.ts features/settlements/custom-rule-types.ts features/settlements/custom-rule-validator.ts features/settlements/custom-rule-validator.test.ts
git commit -m "feat: plan custom settlement execution units"
```

### Task 2: Resolve Effective Layers And Compose Deterministically

**Files:**

- Create: `features/settlements/custom-rule-composition.ts`
- Test: `features/settlements/custom-rule-composition.test.ts`
- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-repository.test.ts`

- [ ] Write repository tests for executable lookup by organization, project, scope, target, and timestamp. Exclude future/not-yet-effective, ended, never-approved, and wrong-organization versions. Include a superseded `archived` row while the requested timestamp is still inside its approved effective interval, so a scheduled replacement creates no gap.

- [ ] Load in one bounded query:
  - project base version effective at the execution timestamp;
  - effective versions for all group IDs in the frozen snapshots;
  - effective project-streamer exceptions;
  - assignment IDs and intervals used for each unit.

Avoid N+1 queries per report.

- [ ] Write composition tests for:
  - existing fixed base when no active project custom base exists;
  - custom project `replace` base;
  - all matching groups in ascending priority;
  - project-streamer layer last;
  - add, multiply, clamp, and replace semantics;
  - tied priorities and ambiguous overlap blocking before money execution;
  - group-level replace marked material risk;
  - same result regardless of database row order;
  - cent-level rounding after typed operation, never after converting to yuan.

- [ ] Implement:

```ts
export function composeCustomSettlementLayers(input: {
  base: ResolvedBaseLayer;
  groupLayers: ResolvedCustomRuleLayer[];
  projectStreamerLayer?: ResolvedCustomRuleLayer;
  executionUnit: CustomRuleExecutionUnit;
}): ComposedCustomRuleResult;
```

- [ ] The result includes every layer's version ID, target, priority, composition, formula/contract hashes, typed inputs, named outputs, missing-data decisions, and deterministic explanation.

- [ ] Reject a layer whose compiled AST/hash does not match its active record. Active records are never reparsed and silently repaired at runtime.

- [ ] Run tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-composition.test.ts features/settlements/custom-rule-repository.test.ts
git add features/settlements/custom-rule-composition.ts features/settlements/custom-rule-composition.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts
git commit -m "feat: compose active settlement rule layers"
```

### Task 3: Add Aggregate Report Links And Review Exceptions Atomically

**Files:**

- Create: `supabase/migrations/20260711130000_custom_settlement_rule_execution.sql`
- Modify: `lib/db/schema-contract.test.ts`
- Modify: `features/settlements/settlement-service.ts`
- Modify: `features/settlements/settlement-service.test.ts`
- Modify: `features/settlements/settlement-repository.ts`
- Test: `features/settlements/settlement-repository.test.ts`

- [ ] Add failing schema assertions for:
  - `settlement_batch_item_reports` junction table;
  - backfill from existing non-null `settlement_batch_items.live_report_id`;
  - unique item/report link;
  - `settlement_rule_exceptions`;
  - exception status/policy constraints and indexes;
  - atomic generation accepting multiple report IDs and exceptions;
  - atomic exception resolution;
  - RLS and immutable resolved/locked state.

- [ ] Create `settlement_batch_item_reports` so one aggregate batch item can own many reports. Preserve `settlement_batch_items.live_report_id` for backward compatibility only when the item has one source report.

- [ ] Update settlement-pool settled detection to query the junction joined through batch type, with a legacy fallback during migration. A report linked to a payable item remains independently eligible for receivable, and vice versa.

- [ ] Create `settlement_rule_exceptions`:

```text
id, organization_id, project_id, settlement_batch_id,
settlement_batch_item_id, live_report_id, rule_version_id,
layer_snapshot, variable_name, policy, status,
resolution_value, resolution_reason, created_by, resolved_by,
created_at, resolved_at
```

Allowed status is `review_required | resolved | voided`. Identity/evidence/auth-sensitive fields cannot be resolved with an explicit default.

- [ ] Replace `public.generate_settlement_batch` in the new migration; do not edit old migrations. The new signature accepts each item with `live_report_ids` and zero or more exception payloads. In one transaction it:
  1. locks all source reports;
  2. re-checks no report is already linked for this batch type;
  3. inserts the batch;
  4. inserts calculated or zero-total placeholder items;
  5. inserts every item/report junction link;
  6. inserts exceptions tied to placeholders;
  7. updates the legacy report pointer only when safe;
  8. returns batch, items, links, and exceptions.

- [ ] Add `public.resolve_settlement_rule_exception`. It locks exception/item/batch, rejects confirmed/locked/voided batches, updates the placeholder snapshot/amount, updates batch computed total by exact delta, marks the exception resolved, and returns all changed records. The service computes the deterministic replacement result; the RPC verifies IDs, status, old amount, and organization before applying.

- [ ] Extend TypeScript atomic input:

```ts
export type SettlementBatchAtomicItemInput = {
  liveReportIds: string[];
  computedAmount: number; // legacy yuan at repository boundary only
  evidenceSnapshot: Record<string, unknown>;
  exceptions?: SettlementRuleExceptionInsert[];
  // existing fields remain
};
```

- [ ] Add repository transaction mapping tests, including concurrent duplicate generation, aggregate links, rollback after exception insert failure, and exact 1-cent resolution delta.

- [ ] Support multiple missing variables on one execution unit. Insert one exception per variable against the same zero-total placeholder. Resolving one exception records its reviewed value but leaves the placeholder and batch total unchanged until all sibling exceptions are resolved; only then does the service re-execute once and the RPC apply one atomic amount delta.

- [ ] Run migration/service/repository tests and commit:

```bash
pnpm vitest run lib/db/schema-contract.test.ts features/settlements/settlement-repository.test.ts features/settlements/settlement-service.test.ts
pnpm supabase:migrate
git add supabase/migrations/20260711130000_custom_settlement_rule_execution.sql lib/db/schema-contract.test.ts features/settlements/settlement-service.ts features/settlements/settlement-service.test.ts features/settlements/settlement-repository.ts features/settlements/settlement-repository.test.ts
git commit -m "feat: persist aggregate settlement links and exceptions"
```

### Task 4: Apply Missing-Data Policies Before Execution

**Files:**

- Create: `features/settlements/custom-rule-missing-data.ts`
- Test: `features/settlements/custom-rule-missing-data.test.ts`
- Create: `features/settlements/custom-rule-executor.ts`
- Test: `features/settlements/custom-rule-executor.test.ts`

- [ ] Write missing-data tests for every variable class and policy:
  - required missing -> blocking error;
  - optional `block_batch` -> no batch transaction attempted;
  - optional `route_item_to_review` -> placeholder item, zero contribution, exception;
  - optional `use_explicit_default` -> typed default, normal output, snapshot decision;
  - forbidden default fields -> blocking error;
  - multiple missing variables use the most conservative declared outcome;
  - undeclared policy -> blocking error.

- [ ] Implement policy resolution before invoking the AST engine. Return a typed result:

```ts
type PreparedExecution =
  | {
      kind: "ready";
      variables: Record<string, TypedRuntimeValue>;
      decisions: MissingDataDecision[];
    }
  | { kind: "review"; exceptions: PreparedRuleException[] }
  | { kind: "blocked"; error: CustomRuleExecutionError };
```

- [ ] Write executor tests for planning -> layer resolution -> context -> policy -> execution -> composition -> snapshot, including deterministic call order and zero database imports in pure modules.

- [ ] Define stable production error codes carrying safe context: rule version ID, target/layer, execution-unit key, variable, and category. Do not include formulas, raw values, other streamers' amounts, or provider data in unauthorized responses.

- [ ] Ensure parser, type, unit, AST hash, parameter, composition, authorization, and unexpected errors always block. `route_item_to_review` is legal only for the exact declared optional-input miss.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-missing-data.test.ts features/settlements/custom-rule-executor.test.ts
git add features/settlements/custom-rule-missing-data.ts features/settlements/custom-rule-missing-data.test.ts features/settlements/custom-rule-executor.ts features/settlements/custom-rule-executor.test.ts
git commit -m "feat: enforce settlement missing data policies"
```

### Task 5: Integrate Custom Execution Into Batch Generation

**Files:**

- Modify: `features/settlements/settlement-service.ts`
- Modify: `features/settlements/settlement-service.test.ts`
- Modify: `features/settlements/settlement-repository.ts`
- Modify: `features/settlements/custom-rule-service.ts`
- Test: `features/settlements/custom-rule-production.test.ts`
- Modify: `app/api/settlement-batches/route.ts`
- Modify: `app/api/settlement-batches/route.test.ts`

- [ ] Expand `SettlementPoolReport` and its repository select with actual context fields: system/screenshot/settlement duration, evidence/time source, viewers, `reviewed_at`, project-streamer ID, streamer source, collaboration ID, and frozen rate fields. Keep organization/project predicates.

- [ ] Write production integration tests:
  - no active custom layers -> exact existing `calculateSettlementItem` result;
  - active project base -> custom result;
  - fixed base plus group/individual modifiers;
  - report, streamer-period, batch, and project-period grains;
  - selected-streamer batch filters;
  - receivable base once per batch;
  - period membership partition;
  - explicit default;
  - review-routed placeholder excluded from totals;
  - block-batch creates no records;
  - active AST/hash failure blocks;
  - execution flag false plus active rule blocks;
  - no 100x yuan/cents regression.

- [ ] Refactor `generateSettlementBatch` around an injected custom execution port while preserving its public signature:

```ts
type CustomSettlementExecutionPort = {
  resolveAndExecute(
    input: CustomSettlementProductionInput,
  ): Promise<"no_custom_layers" | CustomSettlementProductionResult>;
};
```

When the port returns `no_custom_layers`, run the untouched legacy calculation branch. Any other custom-rule error propagates; never catch and replace it with `fallbackRule()`.

- [ ] Convert custom cents to legacy yuan only when building `SettlementBatchAtomicItemInput`:

```ts
const computedAmount = centsToLegacyYuan(result.finalAmountCents);
```

The evidence snapshot retains integer cents. Batch totals sum with `BigInt` cents first, range-check against both the legacy `numeric(12,2)` column and safe conversion boundaries, then convert once; do not sum floating yuan item values.

- [ ] Persist the required `evidenceSnapshot.ruleEngine` object with:
  - mode, contract hash, grain, parameters;
  - applied layers and priorities;
  - membership assignment IDs/snapshot hash;
  - sanitized typed inputs;
  - named component outputs in cents;
  - missing-data decisions;
  - source report IDs;
  - deterministic Chinese explanation.

- [ ] Keep manual settlement items explicit. They never rescue a failed custom execution automatically.

- [ ] Ensure the batch route creates the production execution port from the authenticated Supabase context and applies the existing settlement billing guard.

- [ ] Wire the Phase 2 approval `executionCapability` to the same server execution flag only after the production executor and atomic migration are available. Approval and generation must read one source of truth; tests cover disabled approval, enabled approval, and disabled generation with a pre-existing effective rule.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-production.test.ts features/settlements/settlement-service.test.ts app/api/settlement-batches/route.test.ts
git add features/settlements/settlement-service.ts features/settlements/settlement-service.test.ts features/settlements/settlement-repository.ts features/settlements/custom-rule-service.ts features/settlements/custom-rule-production.test.ts app/api/settlement-batches/route.ts app/api/settlement-batches/route.test.ts
git commit -m "feat: execute custom rules in settlement batches"
```

### Task 6: Resolve Exceptions And Gate Confirm/Lock

**Files:**

- Create: `features/settlements/custom-rule-exception-service.ts`
- Test: `features/settlements/custom-rule-exception-service.test.ts`
- Modify: `features/settlements/settlement-service.ts`
- Modify: `features/settlements/settlement-service.test.ts`
- Modify: `features/settlements/settlement-repository.ts`
- Create: `app/api/settlement-batches/[batchId]/rule-exceptions/route.ts`
- Create: `app/api/settlement-batches/[batchId]/rule-exceptions/route.test.ts`
- Create: `app/api/settlement-batches/[batchId]/rule-exceptions/[exceptionId]/resolve/route.ts`
- Create: `app/api/settlement-batches/[batchId]/rule-exceptions/[exceptionId]/resolve/route.test.ts`
- Modify: `app/api/settlement-batches/[batchId]/confirm/route.ts`
- Create: `app/api/settlement-batches/[batchId]/confirm/route.test.ts`
- Modify: `app/api/settlement-batches/[batchId]/lock/route.ts`
- Create: `app/api/settlement-batches/[batchId]/lock/route.test.ts`

- [ ] Write service tests for list, authorized resolution, typed resolution value, rule re-execution, batch total delta, duplicate resolution idempotency/conflict, and locked/confirmed batch rejection.

- [ ] Resolution must rerun the original snapshotted active compiled AST and layers with the original immutable report/group inputs plus the reviewed value. It must not use today's active rule or today's group membership.

- [ ] Require a reason and owner/ops-manager/finance authorization for resolution; operator may view but not finalize a money-changing resolution. Audit before/after amount, source, resolver, rule version, and reason as high risk.

- [ ] Extend settlement confirmation/lock service dependencies with a gate:

```ts
type SettlementBatchGate = {
  assertNoOpenRuleExceptions(batchId: string): Promise<void>;
};
```

Call it before any status update. An unresolved exception blocks both confirm and lock with a safe `409` response.

- [ ] Add route tests for auth, billing guard on resolution, cross-org IDs, stale batch state, required reason, safe error mapping, and streamer denial.

- [ ] Add the existing `assertBillingWriteAllowed(... featureKey: "settlement")` guard to confirm and lock routes if it is not already present. Reconciliation/exception gates do not replace commercial write gating.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-exception-service.test.ts features/settlements/settlement-service.test.ts app/api/settlement-batches/[batchId]/rule-exceptions app/api/settlement-batches/[batchId]/confirm/route.test.ts app/api/settlement-batches/[batchId]/lock/route.test.ts
git add features/settlements/custom-rule-exception-service.ts features/settlements/custom-rule-exception-service.test.ts features/settlements/settlement-service.ts features/settlements/settlement-service.test.ts features/settlements/settlement-repository.ts app/api/settlement-batches/[batchId]/rule-exceptions app/api/settlement-batches/[batchId]/confirm/route.ts app/api/settlement-batches/[batchId]/confirm/route.test.ts app/api/settlement-batches/[batchId]/lock/route.ts app/api/settlement-batches/[batchId]/lock/route.test.ts
git commit -m "feat: review settlement rule exceptions"
```

### Task 7: Expose Internal And Streamer-Safe Explanations

**Files:**

- Modify: `features/settlements/settlement-queries.ts`
- Modify: `features/settlements/settlement-queries.test.ts`
- Modify: `features/settlements/streamer-settlement-queries.ts`
- Modify: `features/settlements/streamer-settlement-queries.test.ts`
- Modify: `features/settlements/settlement-ui-adapters.ts`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.jsx`
- Modify: `components/reference-ui/streamer-mobile-reference.test.jsx`

- [ ] Write internal DTO tests showing named components, applied version labels, execution grain, source report count, missing-data decisions, and open exceptions.

- [ ] Write streamer DTO privacy tests. A streamer may receive only their payable item's:
  - final amount;
  - personal component labels/amounts;
  - personal evidence/time facts;
  - deterministic personal Chinese explanation.

It must omit formula/AST, receivable rules, margin, tax, external cost, other streamers, group roster, reviewer comments, and internal risk thresholds.

- [ ] Update the internal settlement detail with a concise rule breakdown and an exception queue. Reuse existing tabs; do not create nested card layouts.

- [ ] Add a personal explanation expander to the streamer settlement item surface with accessible button/region semantics.

- [ ] Ensure all displayed money uses yuan formatting from cents snapshots and existing legacy items continue to render.

- [ ] Run focused query/UI tests and commit:

```bash
pnpm vitest run features/settlements/settlement-queries.test.ts features/settlements/streamer-settlement-queries.test.ts components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git add features/settlements/settlement-queries.ts features/settlements/settlement-queries.test.ts features/settlements/streamer-settlement-queries.ts features/settlements/streamer-settlement-queries.test.ts features/settlements/settlement-ui-adapters.ts components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx components/reference-ui/streamer-mobile-reference.jsx components/reference-ui/streamer-mobile-reference.test.jsx
git commit -m "feat: explain custom settlement calculations"
```

### Task 8: Production Golden Paths And Phase 3 Exit Gate

**Files:**

- Create: `features/regression/custom-settlement-rules-golden-path.test.ts`
- Modify: `package.json`

- [ ] Add end-to-end service golden paths for:
  1. payable fixed fallback;
  2. payable project base + two ordered groups + individual exception;
  3. payable period guarantee across multiple reports;
  4. receivable report fees plus one batch base fee;
  5. group membership change inside period;
  6. explicit default;
  7. review-routed item -> resolution -> confirm -> lock;
  8. block-batch no-write rollback;
  9. locked history unchanged after a new active version;
  10. cents/yuan boundary amounts.

- [ ] Add a script such as:

```json
"test:custom-settlement": "vitest run features/settlements app/api/settlement-batches features/regression/custom-settlement-rules-golden-path.test.ts"
```

- [ ] Run:

```bash
pnpm test:custom-settlement
pnpm test:golden
pnpm test:permissions
pnpm test:api-contracts
git diff --check
pnpm type-check
pnpm lint
pnpm build
```

- [ ] Reset local Supabase and manually verify concurrent batch generation, multi-report links, exception rollback/resolution, RLS, and locked immutability.

- [ ] Start the app and verify desktop/narrow layouts with owner, finance, operator, and streamer roles.

- [ ] Rollout safety:
  - deploy migration/code with execution flag false;
  - confirm approval remains blocked;
  - run simulation against production-like data;
  - enable for an internal organization;
  - activate one low-risk rule;
  - compare generated batch to approved simulation hashes and totals;
  - disable new activations on anomaly, but never let an already active rule silently fall back.

- [ ] Exit criteria:
  - every grain links all source reports;
  - every active custom amount is reproducible from snapshot;
  - unresolved review items block confirm/lock;
  - unexpected failures block;
  - fixed fallback occurs only with zero active custom layers;
  - no 100x conversions;
  - streamer privacy tests pass;
  - locked history is stable.

- [ ] Commit:

```bash
git add features/regression/custom-settlement-rules-golden-path.test.ts package.json
git commit -m "test: cover custom settlement production paths"
```

## Phase 3 Handoff

Proceed to `docs/superpowers/plans/2026-07-11-ai-custom-settlement-phase-4-cost-reconciliation.md` after a real payable and receivable batch matches its submitted simulation and the production exit gate is green.

## 2026-07-29 Task 10 Status Audit

- [x] Phase 3 implementation artifacts are present in the repository: execution planning/context/business inputs, effective layer resolution, deterministic composition, aggregate report links, rule exceptions, missing-data policies, production executor, settlement batch integration, exception resolution, and internal/streamer-safe explanations.
- [x] Production batch generation is wired to `createProductionCustomSettlementExecutionPort`, and generation fails closed when active custom layers exist while `CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED` is false.
- [x] Approval and generation now read the server execution capability through the shared custom-rule feature-flag helper path, avoiding duplicate route-local flag logic.
- [x] The execution flag remains default-off in `.env.example` with `CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED=false`; rollout still requires an environment-level enablement step.
- [x] Focused verification passed on 2026-07-29: `pnpm test:custom-settlement` returned 47 files / 1096 tests passed.
- [ ] Production-like data simulation, internal-organization enablement, real payable/receivable batch comparison, and rollback drill were not performed in this Task 10 audit; they remain required before broad rollout.
