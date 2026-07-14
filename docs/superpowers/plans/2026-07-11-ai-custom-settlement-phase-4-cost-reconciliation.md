# AI Custom Settlement Rules Phase 4 Cost And Reconciliation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the rule system by executing approved external-cost formulas into review-required project cost items and approved reconciliation formulas into deterministic pass/warn/block checks that gate settlement confirmation and locking.

**Architecture:** Extend the same parser and pure compiled-AST engine with scope-specific output contracts rather than a separate evaluator. External-cost execution consumes normalized authorized import contexts and emits typed, idempotent `project_cost_items` in `pending_review`; an active custom external-cost rule replaces the legacy direct import-to-confirmed-item conversion for that import, while no active rule preserves legacy behavior. Reconciliation executes only after core receivable/payable/cost/tax calculation, appends custom checks, persists an immutable run snapshot, and is recomputed inside confirm/lock gates. Neither scope may feed values backward into payable/receivable calculation.

**Tech Stack:** Existing complex-cost and settlement reconciliation modules, custom-rule parser/validator/engine, Supabase/Postgres RPCs, Next.js App Router, React reference UI, Vitest and regression tests.

---

## Preconditions And Safety Invariants

- Complete Phases 1-3 first.
- External-cost authoring/execution requires settlement billing write access and the existing project complex-cost entitlement.
- Generated external cost items default to `pending_review` and do not enter confirmed cost totals until the existing cost-item review flow confirms them.
- When an active external-cost rule exists, do not also create legacy imported cost items for the same source rows.
- Reconciliation runs after finalized computed outputs are available and cannot mutate settlement batches.
- A custom `block` result cannot be bypassed by the existing reconciliation `forceApproved` input; change/archive the rule through governance instead.

### Task 1: Add Scope-Specific Typed Output Contracts

**Files:**

- Modify: `features/settlements/custom-rule-types.ts`
- Modify: `features/settlements/custom-rule-types.test.ts`
- Modify: `features/settlements/custom-rule-validator.ts`
- Modify: `features/settlements/custom-rule-validator.test.ts`
- Modify: `features/settlements/custom-rule-engine.ts`
- Modify: `features/settlements/custom-rule-engine.test.ts`
- Modify: `features/settlements/custom-rule-explanation.ts`
- Modify: `features/settlements/custom-rule-explanation.test.ts`
- Modify: `features/settlements/custom-rule-variable-catalog.ts`
- Modify: `features/settlements/custom-rule-variable-catalog.test.ts`

- [ ] Write validator tests for external-cost output:

```text
cost_items([
  { category: "traffic", amount: yuan(500), memo: "7 月投流" }
])
```

Require:

- category from the existing `ProjectCostItemType` subset allowed for generated costs;
- amount typed as money cents, finite, non-negative, and within project safety cap;
- memo string with a bounded length;
- at most 20 items per execution unit;
- `emit_items` composition and compatible grain;
- no `money_result` or reconciliation helpers in external-cost scope.

- [ ] Write reconciliation tests for a single check or an array of checks:

```text
[
  block_if(margin_rate < rate_percent(10), "毛利率低于 10%"),
  warn_if(red_evidence_count > 0, "存在红证据场次")
]
```

Require:

- boolean condition and bounded message;
- `check` composition and project-period/batch-compatible grain;
- variables only from finalized core reconciliation plus evidence counts;
- no payable/receivable/cost-item outputs;
- no check value feeding another rule layer.

- [ ] Add typed outputs:

```ts
export type ExternalCostRuleResult = {
  kind: "cost_items";
  items: Array<{
    category: ProjectCostItemType;
    amountCents: number;
    memo: string;
  }>;
};

export type ReconciliationRuleResult = {
  kind: "checks";
  checks: Array<{
    severity: "pass" | "warn" | "block";
    message: string;
    condition: boolean;
  }>;
};
```

- [ ] Add external-cost catalog fields only when normalized sources exist: import type/row index, sales/order/gift/supplier/traffic values, streamer/supplier/report references. Mark raw unknown import keys unavailable; formulas cannot address arbitrary JSON paths.

- [ ] Add reconciliation variables from the existing cents/bps core result: receivable, payable, external cost, tax, gross margin, margin rate, and evidence counts.

- [ ] Generate authoritative Chinese explanations for each emitted item/check from AST, typed inputs, and result. Do not copy the formula's free-form memo into the legal explanation without HTML/control-character sanitization.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-types.test.ts features/settlements/custom-rule-validator.test.ts features/settlements/custom-rule-engine.test.ts features/settlements/custom-rule-explanation.test.ts features/settlements/custom-rule-variable-catalog.test.ts
git add features/settlements/custom-rule-types.ts features/settlements/custom-rule-types.test.ts features/settlements/custom-rule-validator.ts features/settlements/custom-rule-validator.test.ts features/settlements/custom-rule-engine.ts features/settlements/custom-rule-engine.test.ts features/settlements/custom-rule-explanation.ts features/settlements/custom-rule-explanation.test.ts features/settlements/custom-rule-variable-catalog.ts features/settlements/custom-rule-variable-catalog.test.ts
git commit -m "feat: type cost and reconciliation formula outputs"
```

### Task 2: Add Idempotent Cost Provenance And Reconciliation Runs

**Files:**

- Create: `supabase/migrations/20260711140000_custom_settlement_cost_reconciliation.sql`
- Modify: `lib/db/schema-contract.test.ts`
- Modify: `features/complex-cost/complex-cost-types.ts`
- Modify: `features/complex-cost/complex-cost-repository.ts`
- Create: `features/complex-cost/complex-cost-repository.test.ts`

- [ ] Add failing schema tests for:
  - custom-rule provenance columns on `project_cost_items`;
  - unique execution key;
  - `external_cost_rule_exceptions` and immutable reviewed resolutions;
  - `settlement_reconciliation_runs`;
  - immutable run snapshots;
  - an atomic import-confirm/custom-item RPC;
  - RLS and organization/project ownership.

- [ ] Extend `project_cost_items` with nullable:

```text
source_rule_version_id
source_import_batch_id
source_execution_key
source_input_hash
source_explanation
```

Add a partial unique index on `organization_id + source_execution_key` for non-null keys. Existing rows remain unchanged.

- [ ] Create `settlement_reconciliation_runs`:

```text
id, organization_id, project_id, period_start, period_end,
trigger_type, trigger_batch_id, core_input_hash, core_result,
rule_version_id, formula_hash, custom_checks, final_checks,
blocked, warnings, created_by, created_at
```

Rows are append-only and readable by MCN staff with project access. Streamers cannot read them.

- [ ] Create `external_cost_rule_exceptions` for `route_item_to_review` outcomes:

```text
id, organization_id, project_id, import_batch_id, import_row_index,
rule_version_id, variable_name, policy, source_context_snapshot,
status, resolution_value, resolution_reason, created_by, resolved_by,
created_at, resolved_at
```

Use `review_required | resolved | voided` status. Store only the authorized row context required for deterministic replay. Identity/evidence/auth-sensitive variables cannot be resolved with a default.

- [ ] Add `confirm_cost_import_with_rule_items` as a fixed-search-path security-definer RPC. It locks the import batch and:
  - verifies actor/org/project/status;
  - when custom items and/or review exceptions are supplied, inserts only `pending_review` items plus one exception per missing variable with unique execution keys;
  - when legacy items are supplied, preserves current confirmed behavior;
  - never accepts both modes;
  - marks the import confirmed only after all inserts succeed;
  - returns existing results on the same idempotency key, but rejects a changed input hash.

An import may be confirmed with open external-cost exceptions, but those rows produce no cost item and no cost total until all sibling exceptions for that source row are reviewed and deterministic replay emits its pending-review items.

- [ ] Add an atomic `resolve_external_cost_rule_exception` RPC. It records one reviewed value; when unresolved siblings remain it creates no item. After the last sibling resolves, the service replays the original rule version/context and the RPC inserts all resulting pending-review cost items exactly once.

- [ ] Add repository tests for all-or-nothing insert, duplicate request, changed-hash conflict, cross-org source IDs, and no double legacy/custom rows.

- [ ] Update DTO mapping while preserving existing cost item consumers.

- [ ] Run tests/migration and commit:

```bash
pnpm vitest run lib/db/schema-contract.test.ts features/complex-cost/complex-cost-repository.test.ts
pnpm supabase:migrate
git add supabase/migrations/20260711140000_custom_settlement_cost_reconciliation.sql lib/db/schema-contract.test.ts features/complex-cost/complex-cost-types.ts features/complex-cost/complex-cost-repository.ts features/complex-cost/complex-cost-repository.test.ts
git commit -m "feat: persist custom cost and reconciliation provenance"
```

### Task 3: Execute External-Cost Rules During Import Confirmation

**Files:**

- Create: `features/settlements/custom-rule-external-cost.ts`
- Test: `features/settlements/custom-rule-external-cost.test.ts`
- Modify: `features/complex-cost/complex-cost-service.ts`
- Modify: `features/complex-cost/complex-cost-service.test.ts`
- Modify: `app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.ts`
- Modify: `app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.test.ts`

- [ ] Write external-cost execution tests for:
  - no active custom rule -> existing legacy item calculation/status unchanged;
  - active rule -> no legacy items and only pending-review emitted items;
  - one source row emitting multiple categories;
  - zero emitted items;
  - normalized source variables and every explicit missing-data policy;
  - `route_item_to_review` creating no amount until all row exceptions are reviewed, then replaying the original snapshotted rule once;
  - output count/amount cap;
  - idempotent retry;
  - rule changes after import do not rewrite prior items;
  - formula failure leaves the import unconfirmed and creates no items.

- [ ] Build a normalized import context adapter from the fields already supported by the complex-cost parser:

```text
unitCount, unitPriceCents, salesAmountCents, rateBps,
directAmountCents, streamerId, supplierOrganizationId, liveReportId
```

Map only recognized fields to typed rule variables. Preserve raw row JSON in existing source evidence, but do not expose arbitrary keys to the formula or AI.

- [ ] Derive a stable execution key:

```text
sha256(organization + project + importBatch + rowIndex +
       ruleVersion + outputIndex + sourceInputHash)
```

Exception replay keys additionally include the sorted exception IDs and resolution-value hash. A retry with the same values is idempotent; changed values require an explicit reopen flow and a new audited replay.

- [ ] Implement `executeExternalCostRuleForImport` using the active effective project `external_cost` rule, data-readiness policy, compiled AST, and deterministic explanation.

- [ ] Use the same effective-interval semantics as Phase 3. A superseded archived version remains executable for source timestamps before its `effective_until`; today's latest active formula must not rewrite an older import's intended version.

- [ ] Set generated item evidence from the linked report when one exists; otherwise use yellow review evidence and record the import reference. Use `source="system"` with the custom rule/import provenance columns.

- [ ] Refactor `confirmProjectCostImportBatch` to choose exactly one path:
  - active custom external-cost version -> execute and call atomic RPC in custom mode;
  - no active version -> calculate existing imported items and call atomic RPC in legacy mode.

Do not retain the current per-row non-transactional insert loop.

- [ ] Require existing project complex-cost entitlement plus settlement billing write access. Preserve role/reason/audit behavior and include rule version, item count, input hash, and mode in the audit record.

- [ ] Run service/route tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-external-cost.test.ts features/complex-cost/complex-cost-service.test.ts app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.test.ts
git add features/settlements/custom-rule-external-cost.ts features/settlements/custom-rule-external-cost.test.ts features/complex-cost/complex-cost-service.ts features/complex-cost/complex-cost-service.test.ts app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.ts app/api/projects/[projectId]/cost-imports/[batchId]/confirm/route.test.ts
git commit -m "feat: generate reviewed costs from custom rules"
```

### Task 4: Add External-Cost Preview And Review UI

**Files:**

- Create: `app/api/projects/[projectId]/settlement-rules/external-cost/preview/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/external-cost/preview/route.test.ts`
- Create: `app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions/route.ts`
- Create: `app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions/route.test.ts`
- Create: `app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions/[exceptionId]/resolve/route.ts`
- Create: `app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions/[exceptionId]/resolve/route.test.ts`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.test.jsx`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] Write preview route tests for auth, project/organization isolation, entitlement, billing read-only behavior, active/draft rule source, bounded sample rows, redacted response, and deterministic result.

- [ ] Preview returns category totals, item count, source coverage, missing-data outcomes, warnings, and a bounded row sample. It does not confirm the import or create cost items.

- [ ] Write exception route tests for project/org isolation, owner/ops/finance resolution permission, operator read-only behavior, streamer denial, billing guard, typed reviewed values, required reason, sibling exception behavior, locked idempotency key, and original-version replay.

- [ ] Extend the custom rule workspace's business scope chooser with `项目成本` and show:
  - normalized available import fields;
  - emitted item categories and yuan totals;
  - pending-review behavior;
  - source/evidence references;
  - no wording implying automatic confirmed cost.

- [ ] In the existing cost tab, label generated items with rule version and `待审核`, show deterministic explanation/provenance, list unresolved import-row exceptions, collect typed reviewed values/reasons, and reuse the existing confirm/void actions after items exist.

- [ ] Keep one primary action for the active authoring state and avoid duplicating the cost-item review action inside the authoring workspace.

- [ ] Run route/UI tests and commit:

```bash
pnpm vitest run app/api/projects/[projectId]/settlement-rules/external-cost/preview/route.test.ts app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/ops-reference.test.jsx
git add app/api/projects/[projectId]/settlement-rules/external-cost/preview app/api/projects/[projectId]/cost-imports/[batchId]/rule-exceptions components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: preview and review formula generated costs"
```

### Task 5: Evaluate And Persist Custom Reconciliation Checks

**Files:**

- Create: `features/settlements/custom-rule-reconciliation.ts`
- Test: `features/settlements/custom-rule-reconciliation.test.ts`
- Modify: `features/settlements/project-settlement-reconciliation.ts`
- Modify: `features/settlements/project-settlement-reconciliation.test.ts`
- Modify: `features/settlements/project-settlement-reconciliation-service.ts`
- Modify: `features/settlements/project-settlement-reconciliation-service.test.ts`
- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-repository.test.ts`

- [ ] Write tests proving order:
  1. load receivable/payable/external-cost/financial/evidence inputs;
  2. compute existing core reconciliation;
  3. build typed reconciliation variables;
  4. execute the active reconciliation compiled AST;
  5. append custom checks after core checks;
  6. persist one immutable run snapshot.

- [ ] Test no active custom rule keeps the existing core result byte-for-byte compatible except for optional run metadata.

- [ ] Test `pass`, `warn`, and `block`, multiple messages, boundary margin rate, red evidence, missing finalized inputs, stale/invalid active AST, and cross-org rule exclusion.

- [ ] Add input hash over all money/evidence/financial values plus active rule/formula hash. Repeated reads may return a cached immutable run only when the entire input hash matches; confirm/lock still calls the service and verifies the hash.

- [ ] Persist final checks with provenance:

```ts
type ReconciliationCheckWithSource = {
  severity: "pass" | "warn" | "block";
  code: string;
  message: string;
  source: "core" | "custom_rule";
  ruleVersionId?: string;
  formulaHash?: string;
};
```

- [ ] Do not expose formula/AST in the reconciliation DTO. Internal staff may see rule version/contract label; streamers receive none of this route.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-reconciliation.test.ts features/settlements/project-settlement-reconciliation.test.ts features/settlements/project-settlement-reconciliation-service.test.ts features/settlements/custom-rule-repository.test.ts
git add features/settlements/custom-rule-reconciliation.ts features/settlements/custom-rule-reconciliation.test.ts features/settlements/project-settlement-reconciliation.ts features/settlements/project-settlement-reconciliation.test.ts features/settlements/project-settlement-reconciliation-service.ts features/settlements/project-settlement-reconciliation-service.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts
git commit -m "feat: append custom settlement reconciliation checks"
```

### Task 6: Enforce Reconciliation In Confirm And Lock Gates

**Files:**

- Modify: `features/settlements/settlement-service.ts`
- Modify: `features/settlements/settlement-service.test.ts`
- Modify: `features/settlements/settlement-route-utils.ts`
- Modify: `features/settlements/settlement-route-utils.test.ts`
- Modify: `app/api/settlement-batches/[batchId]/confirm/route.ts`
- Modify: `app/api/settlement-batches/[batchId]/confirm/route.test.ts`
- Modify: `app/api/settlement-batches/[batchId]/lock/route.ts`
- Modify: `app/api/settlement-batches/[batchId]/lock/route.test.ts`
- Modify: `app/api/projects/[projectId]/settlement-reconciliation/route.ts`
- Create: `app/api/projects/[projectId]/settlement-reconciliation/route.test.ts`

- [ ] Extend the Phase 3 batch gate:

```ts
type SettlementBatchGate = {
  assertNoOpenRuleExceptions(batchId: string): Promise<void>;
  evaluateReconciliation(input: {
    batchId: string;
    actor: SettlementActor;
    trigger: "confirm" | "lock";
  }): Promise<ProjectSettlementReconciliationResult>;
};
```

- [ ] Write tests:
  - unresolved exception blocks before reconciliation;
  - missing counterpart/finalized input with active custom check blocks safely;
  - custom block prevents status update;
  - custom warning allows transition and is included in audit/response metadata;
  - core block remains blocking;
  - `forceApproved` cannot bypass a custom block;
  - reconciliation service/DB failure blocks rather than proceeds;
  - no status mutation occurs before the run is persisted.

- [ ] Build the gate in `getSettlementRouteContext` with the authenticated Supabase client. Avoid route-local duplicate queries.

- [ ] Confirm both confirm and lock handlers call `assertBillingWriteAllowed` with `featureKey: "settlement"` before entering the gate/service. Add billing read-only route tests; a reconciliation pass does not override the subscription write restriction.

- [ ] On blocked confirm/lock, write a failed high-risk audit record with safe check codes and run ID; do not write raw formulas/inputs.

- [ ] Update the read reconciliation route to return core/custom provenance, run freshness, and gate verdict.

- [ ] Run service/route tests and commit:

```bash
pnpm vitest run features/settlements/settlement-service.test.ts features/settlements/settlement-route-utils.test.ts app/api/settlement-batches/[batchId]/confirm/route.test.ts app/api/settlement-batches/[batchId]/lock/route.test.ts app/api/projects/[projectId]/settlement-reconciliation/route.test.ts
git add features/settlements/settlement-service.ts features/settlements/settlement-service.test.ts features/settlements/settlement-route-utils.ts features/settlements/settlement-route-utils.test.ts app/api/settlement-batches/[batchId]/confirm/route.ts app/api/settlement-batches/[batchId]/confirm/route.test.ts app/api/settlement-batches/[batchId]/lock/route.ts app/api/settlement-batches/[batchId]/lock/route.test.ts app/api/projects/[projectId]/settlement-reconciliation/route.ts app/api/projects/[projectId]/settlement-reconciliation/route.test.ts
git commit -m "feat: gate settlement transitions with reconciliation"
```

### Task 7: Show Reconciliation Provenance And Actionable Blocks

**Files:**

- Modify: `components/reference-ui/settlement-reconciliation-view.js`
- Modify: `components/reference-ui/settlement-reconciliation-view.test.js`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.test.jsx`

- [ ] Write reconciliation view tests for:
  - core and custom checks grouped with source labels;
  - rule version/contract label without formula;
  - blocking/warning/pass tones and accessible text;
  - stale run indication;
  - confirm/lock disabled with exact actionable reasons;
  - warnings visible without blocking;
  - cents/bps formatting.

- [ ] Add `结算风险校验` to the authoring scope. Show available finalized variables and explain that checks run after receivable/payable/cost/tax.

- [ ] In the settlement reconciliation view, show a compact ordered check list, run time/input freshness, and links to the internal rule version. Do not put the result in another nested card.

- [ ] When a block occurs, keep the user's entered reason intact, focus the blocking heading, and show whether the fix is missing data, an unresolved exception, or a custom rule condition.

- [ ] Confirm streamer-facing screens never import or render reconciliation rules/checks.

- [ ] Run UI tests and commit:

```bash
pnpm vitest run components/reference-ui/settlement-reconciliation-view.test.js components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/ops-reference.test.jsx
git add components/reference-ui/settlement-reconciliation-view.js components/reference-ui/settlement-reconciliation-view.test.js components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-workspace.test.jsx
git commit -m "feat: surface custom reconciliation decisions"
```

### Task 8: Cost/Reconciliation Golden Path And Final Exit Gate

**Files:**

- Create: `features/regression/custom-settlement-cost-reconciliation.test.ts`
- Modify: `package.json`

- [ ] Add golden paths:
  1. no external-cost rule preserves legacy confirmed import;
  2. active rule emits two pending-review cost items and no legacy duplicate;
  3. missing import fields create row exceptions, final sibling resolution emits pending-review items once;
  4. retry is idempotent;
  5. failed formula rolls back import and items;
  6. cost review confirmation changes reconciliation input;
  7. custom warning allows settlement confirmation;
  8. custom block prevents confirmation and lock;
  9. rule revision plus new run allows transition;
  10. locked batch and historical cost provenance remain unchanged;
  11. all totals remain integer cents across settlement/cost/tax/reconciliation boundaries.

- [ ] Add the new regression to `test:custom-settlement`.

- [ ] Run:

```bash
pnpm test:custom-settlement
pnpm vitest run features/complex-cost
pnpm test:golden
pnpm test:permissions
pnpm test:api-contracts
git diff --check
pnpm type-check
pnpm lint
pnpm build
```

- [ ] Reset Supabase and manually verify:
  - atomic import confirmation under concurrent retries;
  - generated cost item RLS and review;
  - reconciliation run immutability;
  - confirm/lock rollback on block or database failure;
  - owner/ops/finance/operator/streamer role behavior.

- [ ] Run browser acceptance at desktop and narrow viewport for authoring -> approval -> import -> cost review -> reconciliation -> confirm/lock. Verify one primary action per state and no overlapping text/controls.

- [ ] Exit criteria:
  - one import row is never charged by both legacy and custom paths;
  - generated costs are pending review;
  - execution keys make retries idempotent;
  - reconciliation is core-first and custom-last;
  - block gates fail closed;
  - custom checks cannot mutate earlier money;
  - internal provenance is complete and streamer privacy remains intact;
  - all four rule scopes satisfy the approved design.

- [ ] Commit:

```bash
git add features/regression/custom-settlement-cost-reconciliation.test.ts package.json
git commit -m "test: close custom settlement rule golden path"
```

## Final Handoff

After this plan passes, run the source design's usability study before broad rollout: template completion within 5 minutes, natural-language creation within 10 minutes, reviewer understanding within 3 minutes, parameter revision within 3 minutes, and at least 80% task success without exposing formula syntax in the normal flow. Product usability failure blocks expansion of the DSL.
