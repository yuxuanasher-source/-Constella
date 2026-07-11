# AI Custom Settlement Rules Phase 2 Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn validated Phase 1 simulations into governed, versioned rule records with atomic apply-and-submit, requested changes, distinct approval, explicit force approval, archival, settlement groups, effective-dated membership, cloning, and organization templates.

**Architecture:** Financial state transitions are database-atomic and service-authorized. Base tables are readable through project-scoped RLS; sensitive writes use fixed-search-path security-definer RPCs that re-check actor, organization, project, role, status, simulation freshness, and target conflicts. Submitted and active rule payloads are immutable. Review events are append-only. Group assignments are explicit effective intervals rather than mutable streamer tags. The complete approval path is implemented here, but runtime activation is refused until Phase 3 supplies an enabled custom-rule execution capability.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase/Postgres RLS and RPCs, Zod, existing audit/billing/auth helpers, Vitest and Testing Library.

---

## Preconditions And Ownership

- Complete `docs/superpowers/plans/2026-07-11-ai-custom-settlement-phase-1-foundation.md` first.
- Phase 1 migrations, compiled AST contracts, hash helpers, simulation service, and read-only workspace are stable inputs.
- This phase owns lifecycle/governance only. Do not edit `generateSettlementBatch` or the atomic batch-generation RPC yet.
- Existing fixed project and project-streamer settlement settings remain available and are the production path until Phase 3.
- Inject an `executionCapability` into approval service/context and default it to disabled. Tests may enable it to exercise atomic approval; deployed Phase 2 code must leave pending versions pending rather than activate rules that production generation cannot honor.

### Task 1: Add Version, Review, Group, Assignment, And Template Schema

**Files:**

- Create: `supabase/migrations/20260711120000_custom_settlement_rule_governance.sql`
- Modify: `lib/db/schema-contract.test.ts`

- [ ] Add failing schema tests for:
  - `custom_settlement_rule_versions`;
  - `custom_settlement_rule_review_events`;
  - `settlement_rule_groups`;
  - `project_streamer_settlement_group_assignments`;
  - `settlement_rule_templates`;
  - exact status/scope/target/grain/composition checks;
  - unique version numbers per target;
  - at most one active version per project/scope/target;
  - append-only reviews;
  - non-overlapping group-assignment intervals;
  - RLS and revoked direct writes;
  - the Phase 1 `settlement_formula_simulations.rule_version_id` foreign key.

- [ ] Run the schema test and confirm it fails:

```bash
pnpm vitest run lib/db/schema-contract.test.ts
```

- [ ] Create `custom_settlement_rule_versions` using the approved schema. Add explicit immutable freshness columns in addition to the JSON summary:

```sql
formula_hash text not null,
rule_contract_hash text not null,
parameter_hash text not null,
variable_catalog_version text not null,
data_selection_hash text not null,
simulation_id uuid not null
```

Store `compiled_ast`, `variables`, `parameters`, `rule_contract`, `missing_data_policy`, `test_cases`, and `simulation_summary` as JSONB with object/array shape checks.

- [ ] Enforce one active target with a partial expression index that treats null target IDs consistently:

```sql
create unique index custom_settlement_rule_one_active_target
on public.custom_settlement_rule_versions (
  project_id,
  scope,
  target_type,
  coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where status = 'active';
```

- [ ] Enforce target identity in the database/RPC:
  - `project` requires `target_id is null`;
  - `streamer_group` target ID references a group in the same organization/project;
  - `project_streamer` target ID references `project_streamers.id`, never the global `streamers.id`, and must belong to the same organization/project;
  - non-payable scopes reject non-project targets in the first release.

- [ ] Add a trigger that rejects formula, AST, contract, parameter, policy, test, target, priority, grain, and composition edits unless status is exactly `draft`. A `changes_requested` row remains immutable until the transition RPC moves it back to `draft`. Status/effective/approval fields may change only through governance RPCs.

- [ ] Add a no-overlap constraint for approved effective ranges of the same target. A future replacement archives the previous lifecycle row but sets its `effective_until` to the replacement's `effective_from`; the archived row remains execution-eligible before that timestamp. Adjacent intervals are allowed, overlapping intervals are not.

- [ ] Create append-only `custom_settlement_rule_review_events` with event types `submitted`, `changes_requested`, `resubmitted`, `approved`, `force_approved`, `archived`, and `activation_failed`. Include actor/role, reason/comment, before/after status, risk summary, hashes, and created time.

- [ ] Create project-scoped groups and effective-dated assignments. Use `btree_gist` plus an exclusion constraint, or an equivalent transaction-safe database check, to reject overlapping intervals for the same `project_streamer_id + group_id`. The write RPC must also verify all organization/project IDs match.

- [ ] Create organization templates with source rule/version metadata, contract/formula/AST/parameters, and status. Persist organization templates in this table. Keep Phase 1 system templates in code and merge them into the list DTO as read-only entries; do not duplicate compiled system templates with SQL seed JSON.

- [ ] Add foreign keys from Phase 1 draft/simulation evidence only after all referenced tables exist. `custom_settlement_rule_versions.simulation_id` and `settlement_formula_simulations.rule_version_id` form an intentional one-to-one cycle; generate both UUIDs first and define both foreign keys as `DEFERRABLE INITIALLY DEFERRED` so the atomic submit transaction can insert both non-null links. Deleting a rule must be impossible; use archive status.

- [ ] Add RLS:
  - MCN staff with project access can read rules, reviews, groups, and assignments;
  - finance is read-only except comments through the RPC;
  - streamers cannot read internal formulas or reviews;
  - templates are visible only to their organization plus system templates;
  - no authenticated role directly updates submitted/active rows.

- [ ] Add fixed-search-path RPC skeletons:
  - `save_custom_settlement_rule_draft`;
  - `apply_and_submit_custom_settlement_rule`;
  - `review_custom_settlement_rule`;
  - `archive_custom_settlement_rule`;
  - `change_settlement_group_assignment`.

Each function revokes `public`, grants only `authenticated`, checks `auth.uid()`, and locks affected target rows with `FOR UPDATE`.

- [ ] Run schema tests and local migration:

```bash
pnpm vitest run lib/db/schema-contract.test.ts
pnpm supabase:migrate
```

- [ ] Commit:

```bash
git add supabase/migrations/20260711120000_custom_settlement_rule_governance.sql lib/db/schema-contract.test.ts
git commit -m "feat: add governed settlement rule schema"
```

### Task 2: Implement Lifecycle, Permission, And Material-Risk Policies

**Files:**

- Create: `features/settlements/custom-rule-governance.ts`
- Test: `features/settlements/custom-rule-governance.test.ts`
- Create: `features/settlements/custom-rule-risk.ts`
- Test: `features/settlements/custom-rule-risk.test.ts`
- Modify: `features/settlements/custom-rule-types.ts`
- Modify: `features/settlements/custom-rule-types.test.ts`

- [ ] Write state-machine tests for only these transitions:

```text
draft -> pending_review
pending_review -> changes_requested
changes_requested -> draft
pending_review -> active
active -> archived
draft -> archived
changes_requested -> archived
```

Reject direct `draft -> active`, edits to pending/active payloads, reactivation of archived versions, and deletion semantics.

- [ ] Write role tests:
  - owner: all lifecycle actions including force approval;
  - ops manager: create/simulate/submit, standard approval, request changes, archive, groups/templates;
  - finance: view/simulate/comment/request changes, never activate;
  - operator: AI/draft/simulate/submit, never approve/archive active/group-assign;
  - streamer: no internal access.

- [ ] Write distinct-approval tests:
  - when another eligible approver exists, creator cannot standard-approve;
  - a material-risk rule always needs a different owner;
  - a single eligible owner may force approve only with explicit acknowledgment plus reason;
  - force approval is never available to ops manager.

- [ ] Implement material-risk detection from deterministic simulation and contract data:

```ts
export type MaterialRiskCode =
  | "negative_margin"
  | "abnormal_total_increase"
  | "red_evidence_payment"
  | "money_changing_explicit_default"
  | "group_level_replace"
  | "overlapping_group_exception"
  | "safety_cap_exceeded";
```

Define abnormal increase and safety cap as organization/project configuration inputs, not hidden constants in UI code. If configuration is absent, use the conservative documented server default and return it in the risk summary.

- [ ] Add `assertSimulationFresh` comparing formula, contract, parameter, variable-catalog, and data-selection hashes. Any mismatch removes submit/approve eligibility.

- [ ] Add `getPrimaryActionForRuleState` as a pure DTO helper so UI and route responses share the state-action contract.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-governance.test.ts features/settlements/custom-rule-risk.test.ts features/settlements/custom-rule-types.test.ts
git add features/settlements/custom-rule-governance.ts features/settlements/custom-rule-governance.test.ts features/settlements/custom-rule-risk.ts features/settlements/custom-rule-risk.test.ts features/settlements/custom-rule-types.ts features/settlements/custom-rule-types.test.ts
git commit -m "feat: enforce settlement rule governance policy"
```

### Task 3: Implement Atomic Version Repository And Service Flows

**Files:**

- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-repository.test.ts`
- Modify: `features/settlements/custom-rule-service.ts`
- Modify: `features/settlements/custom-rule-service.test.ts`

- [ ] Extend repository tests for:
  - project/org-scoped list by status;
  - next version number under concurrency;
  - draft save;
  - atomic apply-and-submit;
  - copied immutable version-bound simulation;
  - review events ordered by creation;
  - request changes/resubmission;
  - approval archiving the prior active target in the same transaction;
  - force approval marker;
  - active archive setting `effective_until`;
  - idempotency by client request ID;
  - stale simulation, target conflict, and concurrent approval rollback.

- [ ] Make `apply_and_submit_custom_settlement_rule` accept an AI draft or editable saved draft plus a current simulation. Inside one transaction:
  1. lock the AI draft/simulation;
  2. verify ownership, status, all freshness hashes, validation success, data readiness, and role;
  3. allocate the next target version;
  4. pre-generate version and copied-simulation UUIDs;
  5. insert one immutable `pending_review` version pointing to the copied-simulation UUID;
  6. copy the AI-draft simulation into the version-owned simulation row pointing back to the version UUID;
  7. append a submitted review event;
  8. return the complete version/simulation/event.

If any insert fails, no visible version may remain.

- [ ] Implement service methods with injected repository and audit writer:

```ts
saveCustomRuleDraft(...)
applyAndSubmitCustomRule(...)
requestCustomRuleChanges(...)
reopenRequestedChangesAsDraft(...)
resubmitCustomRule(...)
approveCustomRule(...)
forceApproveCustomRule(...)
archiveCustomRule(...)
listCustomRules(...)
```

- [ ] `reopenRequestedChangesAsDraft` performs the allowed `changes_requested -> draft` transition before any formula/contract edit. It preserves review history and requires a new simulation before resubmission.

- [ ] Approval must recompute authorization and material risk from server-owned records. Never trust client-provided `isMaterialRisk`, approver counts, creator IDs, hashes, or simulation totals. It must also reject activation while the injected production execution capability is disabled.

- [ ] Standard approval transaction:
  - lock target versions;
  - re-check freshness and effective period;
  - archive the prior active lifecycle row and set its effective end to the new version's start;
  - activate submitted version with approver/reason/time;
  - append review event.

For a future effective start, list DTOs derive `effectiveNow` and `scheduled` from the interval. Phase 3 execution must still select the superseded archived row until its effective end; status alone is not the execution predicate.

- [ ] Active archival must require a fresh simulation of remaining custom layers or fixed fallback. Locked batches are excluded and never recalculated.

- [ ] Write a high-risk audit event after each committed transition. On activation failure, write a failure event/audit record without mutating version status. Use existing generic audit actions (`create`, `update`, `approve`, `reject`, `void`) and encode precise transition in object type/after JSON rather than extending the enum without need.

- [ ] Run service/repository tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-repository.test.ts features/settlements/custom-rule-service.test.ts
git add features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts features/settlements/custom-rule-service.ts features/settlements/custom-rule-service.test.ts
git commit -m "feat: add atomic settlement rule lifecycle"
```

### Task 4: Implement Settlement Group Membership Governance

**Files:**

- Create: `features/settlements/custom-rule-groups.ts`
- Test: `features/settlements/custom-rule-groups.test.ts`
- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-repository.test.ts`
- Modify: `features/settlements/custom-rule-service.ts`
- Modify: `features/settlements/custom-rule-service.test.ts`

- [ ] Write tests for create/list/archive groups, duplicate active names, organization/project mismatch, joining a non-project streamer, overlapping intervals, close-and-insert changes, multiple simultaneous groups, and archive with active rules/future assignments.

- [ ] Add backfill tests:
  - existing joined project streamers are listed as unassigned;
  - assigning them requires reason and effective time;
  - unassigned streamers remain covered by the project base rule;
  - a group rule cannot activate until simulation explicitly includes assigned and unassigned population.

- [ ] Define a deterministic membership snapshot:

```ts
export type SettlementGroupMembershipSnapshot = {
  projectStreamerId: string;
  effectiveAt: string;
  groups: Array<{ id: string; name: string; assignmentId: string }>;
  snapshotHash: string;
};
```

- [ ] Implement owner/ops-manager-only create/archive/assignment changes. Finance/operator may list and include requests in review comments but cannot mutate membership.

- [ ] `change_settlement_group_assignment` must close the prior interval and insert the next interval atomically. It must reject any change that purports to rewrite a locked batch's historical effective time.

- [ ] Mark all pending simulations for affected future unsettled work stale by changing the data-selection/group snapshot hash. Do not mutate immutable historical simulations; their stale state is derived at read time.

- [ ] Add conflict analysis for active/pending group rules:
  - matching layers sort by ascending priority;
  - same priority on an overlapping population is blocking;
  - ambiguous composition is blocking;
  - group `replace` is material risk and requires owner approval.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-groups.test.ts features/settlements/custom-rule-repository.test.ts features/settlements/custom-rule-service.test.ts
git add features/settlements/custom-rule-groups.ts features/settlements/custom-rule-groups.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts features/settlements/custom-rule-service.ts features/settlements/custom-rule-service.test.ts
git commit -m "feat: govern settlement rule groups"
```

### Task 5: Implement Clone, Parameters, And Organization Templates

**Files:**

- Create: `features/settlements/custom-rule-templates.ts`
- Test: `features/settlements/custom-rule-templates.test.ts`
- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-service.ts`
- Modify: `features/settlements/custom-rule-service.test.ts`

- [ ] Write tests proving:
  - clone requires access to source and target projects;
  - clone strips project IDs, approval, active/effective state, simulations, sample selections, review history, and AI conversation IDs;
  - clone rebinds the target variable catalog and starts as editable draft;
  - missing target variables block simulation;
  - parameter edits require valid typed units, create a new version, and stale the prior simulation;
  - system templates are read-only;
  - organization templates are owner/ops-manager managed and organization isolated.

- [ ] Implement clone-to-draft with a new draft ID and version lineage metadata only. Never copy `approved_by`, `effective_from`, `status=active`, historical amounts, or source record IDs.

- [ ] Implement parameters as labeled business fields:

```ts
type RuleParameterDefinition = {
  key: string;
  labelZh: string;
  type: "money_cents" | "rate_bps" | "integer" | "number";
  value: number;
  min?: number;
  max?: number;
};
```

Normal UI receives yuan/percent values through DTO adapters; persisted values remain cents/bps.

- [ ] Saving a rule as an organization template requires a confirmed contract and valid formula but does not inherit approval or become executable.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-templates.test.ts features/settlements/custom-rule-service.test.ts
git add features/settlements/custom-rule-templates.ts features/settlements/custom-rule-templates.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-service.ts features/settlements/custom-rule-service.test.ts
git commit -m "feat: add settlement rule reuse tools"
```

### Task 6: Expose Governance, Group, And Template APIs

**Files:**

- Modify: `features/settlements/custom-rule-route-context.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/apply-and-submit/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/apply-and-submit/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/request-changes/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/request-changes/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/approve/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/approve/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/archive/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/archive/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/clone/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/[ruleVersionId]/clone/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/[groupId]/assignments/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/[groupId]/assignments/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/[groupId]/archive/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rule-groups/[groupId]/archive/route.test.ts`
- Create: `app/api/settlement-rule-templates/route.ts`
- Create: `app/api/settlement-rule-templates/route.test.ts`

- [ ] Write route tests first for auth, project/org access, every role, billing read-only mode, stale simulation, wrong target, malformed reason/comment, distinct approval, material-risk owner requirement, force acknowledgment, idempotency, and database conflict mapping.

- [ ] All mutating routes call the existing settlement billing gate. List routes remain readable in billing read-only mode.

- [ ] Use Zod request schemas and explicit DTOs. Never return `compiled_ast`, formula, internal risk thresholds, receivable data, or review details to streamer contexts.

- [ ] Keep force approval on the same approve endpoint with a typed command:

```json
{
  "reason": "单一负责人组织，已复核风险与试算",
  "force": true,
  "acknowledgment": "I_UNDERSTAND_SINGLE_OWNER_FINANCIAL_RISK"
}
```

Server decides whether the force path is eligible. A client cannot downgrade material risk.

- [ ] Return `409` for stale simulation/concurrent target conflict, `422` for deterministic validation/readiness failures, `403` for role/project/billing denial, and `400` for malformed commands.

- [ ] Run route and API contract suites:

```bash
pnpm vitest run app/api/projects/[projectId]/settlement-rules app/api/projects/[projectId]/settlement-rule-groups app/api/settlement-rule-templates
pnpm test:api-contracts
```

- [ ] Commit:

```bash
git add features/settlements/custom-rule-route-context.ts app/api/projects/[projectId]/settlement-rules app/api/projects/[projectId]/settlement-rule-groups app/api/settlement-rule-templates
git commit -m "feat: expose settlement rule governance APIs"
```

### Task 7: Add Version, Review, Group, And Reuse UI

**Files:**

- Modify: `components/reference-ui/custom-settlement-rule-workspace.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-workspace.test.jsx`
- Modify: `components/reference-ui/custom-settlement-rule-api.js`
- Modify: `components/reference-ui/custom-settlement-rule-api.test.js`
- Create: `components/reference-ui/custom-settlement-rule-version-panel.jsx`
- Test: `components/reference-ui/custom-settlement-rule-version-panel.test.jsx`
- Create: `components/reference-ui/custom-settlement-rule-group-panel.jsx`
- Test: `components/reference-ui/custom-settlement-rule-group-panel.test.jsx`
- Create: `components/reference-ui/custom-settlement-rule-review-dialog.jsx`
- Test: `components/reference-ui/custom-settlement-rule-review-dialog.test.jsx`

- [ ] Write UI tests for the exact one-primary-action mapping:
  - unresolved -> `回复 AI`;
  - contract ready -> `确认业务规则并试算`;
  - current simulation -> `应用并提交审核` or operator `保存并请求审核`;
  - pending review eligible approver -> `确认生效`;
  - changes requested -> `修改并重新试算`, which first reopens the version as `draft`;
  - active -> `创建新版本`.

- [ ] Test that apply-and-submit makes one request and does not show a submitted state until the atomic response contains version, copied simulation, and review event.

- [ ] Test review UX:
  - reviewer sees scope/target, contract diff, largest delta, missing-data behavior, risk, creator, and simulation freshness;
  - scheduled future version, currently effective superseded interval, and fully ended archive have distinct derived labels;
  - reason is required for approval/archive/effective changes;
  - request changes requires a comment;
  - force approval is visibly distinct, owner-only, and requires typed acknowledgment;
  - creator cannot see standard approval when a different eligible approver is required.

- [ ] Test group UI:
  - explicit groups and membership counts;
  - unassigned streamers called out;
  - assignment effective time and reason;
  - overlap/priority conflict blocks submission;
  - no profile-tag wording implies automatic membership.

- [ ] Test reuse:
  - system/organization template chooser;
  - clone opens an editable draft and exposes missing target data;
  - parameter fields display yuan/percent and never raw cents/bps;
  - advanced formula remains collapsed.

- [ ] Implement separate full-width panes/tabs inside the workspace for `搭建`, `版本与审核`, and `结算分组`. Do not place cards inside cards or add competing primary buttons.

- [ ] Preserve server state across refresh by loading versions/reviews/session by project. Keep unsent input only in browser state.

- [ ] Announce state transitions and focus the status heading/dialog error after submit, request changes, approval, archive, and assignment updates.

- [ ] Run focused UI tests and commit:

```bash
pnpm vitest run components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/custom-settlement-rule-version-panel.test.jsx components/reference-ui/custom-settlement-rule-group-panel.test.jsx components/reference-ui/custom-settlement-rule-review-dialog.test.jsx
git add components/reference-ui/custom-settlement-rule-api.js components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/custom-settlement-rule-version-panel.jsx components/reference-ui/custom-settlement-rule-version-panel.test.jsx components/reference-ui/custom-settlement-rule-group-panel.jsx components/reference-ui/custom-settlement-rule-group-panel.test.jsx components/reference-ui/custom-settlement-rule-review-dialog.jsx components/reference-ui/custom-settlement-rule-review-dialog.test.jsx
git commit -m "feat: add settlement rule review workspace"
```

### Task 8: Phase 2 Verification And Exit Gate

**Files:**

- All files changed in this plan.

- [ ] Run focused governance suites:

```bash
pnpm vitest run features/settlements/custom-rule-governance.test.ts features/settlements/custom-rule-risk.test.ts features/settlements/custom-rule-groups.test.ts features/settlements/custom-rule-templates.test.ts features/settlements/custom-rule-service.test.ts features/settlements/custom-rule-repository.test.ts
pnpm vitest run app/api/projects/[projectId]/settlement-rules app/api/projects/[projectId]/settlement-rule-groups app/api/settlement-rule-templates
pnpm vitest run components/reference-ui
```

- [ ] Run static/build checks:

```bash
git diff --check
pnpm type-check
pnpm eslint features/settlements app/api/projects/[projectId]/settlement-rules app/api/projects/[projectId]/settlement-rule-groups app/api/settlement-rule-templates components/reference-ui
pnpm build
```

- [ ] Reset local Supabase and exercise database concurrency:
  - two simultaneous submissions allocate unique version numbers;
  - two approvals cannot produce two active targets;
  - failed copied simulation insert rolls back the version;
  - overlapping assignment transactions leave only one valid interval;
  - direct update of active formula/AST fails.

- [ ] Run manual role acceptance with owner, ops manager, finance, operator, and streamer accounts. Verify billing read-only blocks all writes while retaining list/history access.

- [ ] Confirm production batch results are byte-for-byte unchanged from the Phase 1 baseline because no execution wiring exists yet:

```bash
pnpm vitest run features/settlements/settlement-engine.test.ts features/settlements/settlement-service.test.ts features/regression/settlement-golden-path.test.ts
```

- [ ] Exit criteria:
  - no direct `draft -> active` path;
  - submitted/active payloads are immutable;
  - apply-and-submit is atomic and simulation-bound;
  - approval is conflict-safe and distinct where required;
  - force approval is single-owner/owner-only/audited;
  - group membership is explicit, effective-dated, and conflict-checked;
  - clone/template never inherit approvals/history;
  - approval logic is complete, but deployed activation remains blocked until the Phase 3 execution capability is enabled.

## Phase 2 Handoff

Proceed to `docs/superpowers/plans/2026-07-11-ai-custom-settlement-phase-3-execution.md` only after the governance exit gate is green. Phase 3 is the first plan allowed to make active payable/receivable custom rules affect generated settlement amounts.
