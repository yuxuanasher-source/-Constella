# AI Custom Settlement Formula Rules Design

## Goal

Let MCN users define settlement rules from their own business logic instead of being limited to preconfigured "complex rules". Users can describe a rule in natural language, resolve ambiguity with AI, confirm a Chinese business-rule contract, preview its financial impact, and apply it for review without needing to understand formula syntax. The rule only becomes active after human approval.

This design chooses a formula/DSL approach with AI assistance, but it does not execute arbitrary user scripts. The system owns parsing, validation, execution, preview, approval, and audit.

## Current Context

The existing settlement system already has several layers:

- Project-level default settlement settings are updated through `PATCH /api/projects/:projectId/settlement-rule` and require an audit reason.
- Streamer/project payable rules are frozen into `project_streamers` when a streamer joins a project, so historical settlement is stable.
- `calculateSettlementItem` supports fixed methods, CPT/base salary, tiered hourly pricing, penalties, floor, and cap.
- Complex cost rules are a separate workflow for cost preview, imports, manual cost items, dashboards, and exports.
- Single-project reconciliation combines receivable, payable, external costs, tax, and margin checks.

The missing product loop is:

```text
natural-language business rule
  -> AI clarification and data-readiness check
  -> user-confirmed business-rule contract
  -> system-generated safe formula and explanation
  -> automatic validation and simulation
  -> draft submitted for review
  -> human approval
  -> active rule used by settlement batches
  -> historical calculation snapshot
```

## Non-Goals

- Do not allow arbitrary JavaScript, SQL, network calls, database queries, loops, recursion, randomness, or side effects in formulas.
- Do not allow AI to directly activate rules, confirm settlement batches, lock settlement, reopen locked batches, change historical batch items, or confirm payment.
- Do not expose internal receivable, margin, tax, other streamer rules, or cost formulas to streamer-facing APIs.
- Do not replace existing fixed settlement rules in one migration. Existing rules remain the fallback.
- Do not recalculate locked historical settlement batches after a rule changes.
- Do not require normal users to understand cents, basis points, English variable names, or DSL syntax. Formula editing is an advanced-mode capability.

## Recommended Approach

Use a controlled formula DSL plus AI-assisted drafting.

Users talk to AI in natural language. AI first returns a structured interpretation and asks focused questions for any unresolved business meaning. After the user confirms the interpretation, the system produces:

- a formula in the allowed DSL,
- a deterministic Chinese explanation generated from the validated AST,
- test cases,
- expected inputs,
- safety notes.

The backend parses and validates the formula, checks whether its required data is available, and automatically runs simulation. A user with drafting permission can apply and submit the result for review in one action. Only an owner or ops manager can approve the rule version and make it active.

This gives the user real customization while keeping settlement deterministic, explainable, auditable, and testable.

## Rule Architecture

Add versioned rule records in a new `custom_settlement_rule_versions` table instead of directly replacing `projects.default_settlement_rule`. Drafts remain editable; submitted and active versions are immutable.

Each version stores:

- `scope`: `receivable`, `payable`, `external_cost`, or `reconciliation`.
- `target_type`: `project`, `project_streamer`, or `streamer_group`.
- `target_id`: nullable for project-level defaults.
- `execution_grain`: `report`, `project_streamer_period`, `batch`, or `project_period`.
- `composition_mode`: `replace`, `add`, `multiply`, `clamp`, `emit_items`, or `check`.
- `priority`: deterministic order for overlapping modifier layers.
- `formula`: original formula text.
- `compiled_ast`: parsed and normalized AST.
- `variables`: allowed variable list for this rule.
- `parameters`: named business parameters with explicit user-facing units.
- `rule_contract`: the user-confirmed Chinese business meaning.
- `system_explanation_template`: deterministic explanation generated from the AST.
- `test_cases`: generated and user-adjustable test cases.
- `simulation_summary`: preview output summary.
- `missing_data_policy`: explicit behavior for every optional or unavailable input.
- `status`: `draft`, `pending_review`, `changes_requested`, `active`, or `archived`.
- `effective_from`: first effective timestamp.
- `effective_until`: optional end timestamp for scheduled rules.
- `created_by`, `approved_by`, `ai_draft_id`, `reason`.

Constraints:

- Only one active version can exist for the same `project_id + scope + target_type + target_id`. A single target cannot activate separate `replace` and modifier versions at the same time; its formula must express all components for that target.
- Active versions are immutable. Changes create a new version.
- Versions are archived, not deleted.
- A rule may be active for future batches only. Locked batches are never recalculated.
- A rule cannot be activated until its execution grain, parameter units, input sources, missing-data policy, composition order, and simulation coverage are valid.
- Streamer-group membership used by settlement is snapshotted when the streamer joins the project or when an audited group-assignment change is approved. Later profile edits do not silently change historical or already scheduled settlement.
- Existing project streamers need an audited group-assignment backfill before a group rule can activate for them. Unassigned streamers remain on the project base rule and appear explicitly in simulation coverage.

### Rule Lifecycle

An AI draft is conversation evidence, not an executable rule version. A user may save a `draft` or use `apply-and-submit` to create a version directly in `pending_review` with its immutable simulation snapshot.

Allowed transitions are:

```text
draft -> pending_review
pending_review -> changes_requested
changes_requested -> draft
pending_review -> active
active -> archived
draft -> archived
changes_requested -> archived
```

There is no direct `draft -> active` transition. Approval activates the submitted version and archives the prior active version for the same target in one transaction.

Manually archiving an active rule sets its effective end, requires a simulation of the resulting remaining layers or fixed-rule fallback, and never changes locked batches. Removing an active modifier is treated as a financial change, not as a harmless delete.

## Business Rule Contract

Natural language is the primary authoring surface. Before the system generates a formula, AI must produce a Chinese business-rule contract containing:

- what is being calculated: customer receivable, streamer payable, external cost, or reconciliation check,
- who or what the rule applies to,
- execution grain: per report, per streamer per period, per batch, or per project period,
- calculation components such as base amount, bonuses, penalties, floors, caps, and final amount,
- every required data field and its source,
- user-facing units in yuan, percentages, hours, minutes, counts, or dates,
- effective period,
- missing-data behavior,
- composition with project, group, and individual rules,
- at least one normal example and two boundary examples.

The user confirms this contract, not the raw formula. Any later natural-language or advanced-formula edit regenerates the contract diff and requires reconfirmation before simulation or submission.

## AI Interaction Flow

In project settlement settings, users open "AI build settlement rule" and enter a business rule, for example:

```text
这个项目按系统直播时长结算。绿证据全额，黄证据按 80%，红证据不计。
单场不足 60 分钟不结算；超过 3 小时的部分按 120 元/小时。
如果主播等级是 S，每场额外奖励 50 元。
```

The flow:

1. The user describes the business rule in Chinese.
2. AI extracts a draft business-rule contract and checks the project-scoped variable catalog.
3. If the amount unit, target, execution grain, time range, data source, exception, composition behavior, or missing-data policy is ambiguous, AI asks one focused question per turn. It must not generate a final formula while required ambiguity remains.
4. The user confirms the Chinese business-rule contract.
5. AI proposes a DSL formula and edge cases. The server parses, type-checks, and validates it. AI output is never trusted as executable.
6. The system generates the authoritative Chinese explanation from the validated AST, then automatically runs data-readiness checks and simulation.
7. The user reviews the confirmed business meaning, sample coverage, current/new/delta amounts, affected records, and risks.
8. The user clicks one state-aware action: "应用并提交审核". For an operator, the equivalent label is "保存并请求审核". The action saves an immutable submitted version, records the latest simulation, and moves it to `pending_review` in one transaction.
9. An eligible owner or ops manager reviews the rule-contract diff and simulation impact, then approves activation with a required reason or returns it with requested changes.

The UI must avoid a button named "立即生效" for AI-generated output. One-click application means one click to create and submit a reviewed draft; it never means bypassing activation approval.

Natural-language revision is part of the first release. A user can say, for example, "黄证据从 80% 改为 70%，其他条件不变". AI must preserve unaffected contract fields, show the exact before/after business diff, regenerate the formula, and rerun validation and simulation.

AI can:

- suggest formulas,
- explain rules,
- produce test cases,
- identify missing inputs,
- warn about risky outcomes,
- revise an existing draft while preserving unaffected conditions,
- prepare a draft and, only after an explicit user action, persist and submit it for human review.

AI cannot:

- activate a rule,
- bypass approval,
- lock or confirm settlement,
- change immutable historical evidence,
- perform money movement or payment confirmation.

AI receives the user's conversation, the confirmed contract draft, and scope-safe variable metadata such as name, type, unit, source label, and availability state. Raw historical settlement rows, other streamers' amounts, internal margin details, and imported evidence values are not sent to the model by default. Historical simulation remains deterministic server-side processing; only an authorized, redacted summary may be supplied to AI when the user explicitly asks for help interpreting the result.

## Formula DSL

The DSL is a deterministic expression language for money calculation and settlement checks.

Example:

```text
payable = money_result({
  base: if(system_minutes < 60, yuan(0),
    tiered(system_minutes, [
      { upto: 180, rate_per_hour: yuan(80) },
      { upto: null, rate_per_hour: yuan(120) }
    ]) * evidence_multiplier(
      evidence_level,
      { green: rate_percent(100), yellow: rate_percent(80), red: rate_percent(0) }
    )
  ),
  bonus: if(streamer_level == "S", yuan(50), yuan(0)),
  penalty: yuan(0),
  final: base + bonus - penalty
})
```

Advanced-mode formula text uses typed, user-readable literals such as `yuan(80)` and `rate_percent(80)`. The compiler normalizes money to cents and rates to basis points in the AST. Raw integer money or rate literals are rejected when their unit cannot be inferred safely.

Money rules return named components through `money_result`. This gives simulation, approval, export, and streamer explanations stable labels instead of forcing the product to reverse-engineer one opaque final number. Simple rules may return only `final`; complex rules should return `base`, `bonus`, `penalty`, and `final` where applicable.

Within `money_result`, a component may reference only an earlier named component in the same result object. The validator builds a component dependency graph and rejects forward references or cycles. This makes `final: base + bonus - penalty` deterministic without introducing general user-defined variables.

Business parameters are stored separately from formula structure and referenced by name:

```text
parameter("s_level_bonus")
parameter("yellow_evidence_rate")
```

Changing a parameter still creates a new rule version and simulation, but users edit a labeled yuan/percentage field instead of editing formula syntax.

### Allowed Variable Groups

Live evidence:

- `system_minutes`
- `screenshot_minutes`
- `settlement_minutes`
- `evidence_level`
- `time_source`
- `views`
- `live_started_at`
- `weekday`
- `hour_of_day`
- `approved_at`

Project and streamer:

- `project_id`
- `project_tags`
- `streamer_id`
- `streamer_level`
- `streamer_source`
- `collaboration_id`
- `base_hourly_rate`
- `base_salary`
- `cps_rate`
- `streamer_group_ids`

Business result:

- `sales_amount`
- `orders_count`
- `gift_amount`
- `supplier_fee`
- `traffic_cost`
- `manual_adjustment`

Precomputed period aggregates, available only to compatible execution grains:

- `period_system_minutes`
- `period_settlement_minutes`
- `period_sales_amount`
- `period_orders_count`
- `period_report_count`
- `red_evidence_count`
- `yellow_evidence_count`
- `period_payable_amount`
- `period_receivable_amount`
- `period_start`
- `period_end`

The service layer computes these aggregates before formula execution. The DSL cannot issue its own query or iterate arbitrary records.

Reconciliation:

- `receivable_amount`
- `payable_amount`
- `external_cost_amount`
- `tax_amount`
- `gross_margin`
- `margin_rate`

### Allowed Functions

```text
if(condition, when_true, when_false)
min(a, b)
max(a, b)
clamp(value, floor, cap)
round_money(value)
tiered(minutes, [{ upto, rate_per_hour }])
percent(amount, rate)
evidence_multiplier(evidence_level, { green, yellow, red })
in(value, ["A", "B"])
contains(tags, "tag")
yuan(value)
rate_percent(value)
parameter(name)
money_result({ components..., final })
```

For reconciliation rules, add check helpers:

```text
block_if(condition, message)
warn_if(condition, message)
pass_if(condition, message)
```

External-cost rules return typed draft items through `cost_items([{ category, amount, memo }])`. Reconciliation rules return typed checks. A rule cannot return the output contract of another scope.

### Restrictions

- No user-defined functions in the first version.
- No loops, recursion, async behavior, random values, network calls, database reads, file access, or global state.
- Formula complexity is capped by AST node count, expression depth, function count, and serialized size.
- Output must be finite and non-negative for money rules unless a rule type explicitly allows signed adjustments.
- Raw money and rate literals without explicit units are rejected.
- Formula references may use only inputs available before that rule layer executes. The validator rejects circular dependencies and references to same-layer or later-layer outputs.
- Missing required variables fail validation. Optional variables require an explicit missing-data policy; production execution must never invent or silently substitute a default.

### Missing-Data Policies

Each optional input chooses one policy in the confirmed business-rule contract:

- `route_item_to_review`: exclude the affected item from calculated totals and create a review-required settlement exception,
- `block_batch`: block the whole batch when the input is financially inseparable from the batch result,
- `use_explicit_default`: use a named, visible default value that is included in simulation and requires owner approval.

`use_explicit_default` is forbidden for identity, evidence authenticity, organization ownership, or other authorization-sensitive fields. Required inputs need 100% schema readiness and, when a historical sample exists, 100% sample coverage before activation. Optional inputs may have lower coverage only when every uncovered case has an allowed explicit policy. A new project with no history uses schema readiness plus synthetic and user examples and is labeled as unverified against history.

## Rule Scopes

Every rule declares an execution grain and an output contract. A rule cannot rely on UI wording to imply whether it runs per report, per streamer per settlement period, per batch, or per project period.

### Rule Composition

Payable and receivable money rules use deterministic layers:

1. Resolve a base layer. Use an active project-level `replace` rule when one exists; otherwise use the existing frozen fixed settlement rule.
2. Apply every matching streamer-group modifier in ascending `priority` order. Group rules use `add`, `multiply`, or `clamp` unless an owner explicitly approves a group-level `replace` rule.
3. Apply the active project-streamer rule last. It may replace the prior result or apply an explicit modifier.
4. Persist every applied layer, priority, group-membership snapshot, inputs, component outputs, and final output in the settlement-item snapshot.

If a streamer belongs to multiple groups whose active rules overlap, activation fails when priorities are tied or composition is otherwise ambiguous. The user must resolve the conflict before the rule can become active. The engine never chooses a rule by creation time or database row order.

For money rules, a project-level target uses `replace`; a streamer-group target normally uses `add`, `multiply`, or `clamp`; and a project-streamer target may use `replace` or a modifier. Group-level `replace` is allowed only through material-risk owner approval. Reconciliation rules use `check`. External-cost rules use `emit_items` with their typed item output instead of money-rule composition.

### Receivable Rules

Calculate what the MCN charges the customer or vendor. This can cover CPT, base fee plus CPT, GMV/CPS income, floors, caps, evidence discounts, or project-specific bonuses.

For receivable batches, project-level base fees apply once per batch or project period according to the declared execution grain, not once per streamer. Item-level and batch-level components remain separate in the output breakdown so they cannot be double counted.

### Payable Rules

Calculate what the MCN pays a streamer. Payable rules support project defaults, frozen streamer-group modifiers, and specific project-streamer exceptions through the composition order above. When no active custom base layer exists, the frozen `project_streamers` fixed rule remains the base. Manual amounts remain explicit reviewed inputs and are never an automatic fallback for a failed active rule.

Per-period guarantees, cumulative tiers, or period caps must use `project_streamer_period` grain and precomputed period aggregates. They must not be approximated by summing independently clamped report-level results.

### External Cost Rules

Generate project cost items from supplier, traffic, platform, sample, replay, or other imported fields. External cost outputs default to review-required cost items and do not automatically enter confirmed cost totals unless approved.

Each generated item declares its category, amount, execution grain, source fields, and evidence reference. A formula cannot emit an untyped aggregate cost that hides multiple categories.

### Reconciliation Rules

Return `pass`, `warn`, or `block` checks for project settlement. Examples:

```text
block_if(margin_rate < rate_percent(10), "毛利率低于 10%")
warn_if(red_evidence_count > 0, "存在红证据场次")
```

Reconciliation rules execute only after receivable, payable, external-cost, and tax outputs exist. They may reference those finalized outputs but cannot feed values back into an earlier money rule. Reconciliation rules gate confirmation and lock flows but do not directly mutate settlement batch records.

## Data Model

### `settlement_rule_groups`

Defines explicit project-scoped settlement groups. Groups are not inferred at execution time from mutable streamer profile tags.

Key fields:

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `name text not null`
- `description text null`
- `status text not null`
- `created_by uuid null`
- `created_at timestamptz not null default now()`
- `archived_at timestamptz null`

### `project_streamer_settlement_group_assignments`

Stores effective-dated, audit-retained group membership for a project streamer.

Key fields:

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `project_streamer_id uuid not null`
- `group_id uuid not null`
- `effective_from timestamptz not null`
- `effective_until timestamptz null`
- `assigned_by uuid null`
- `reason text not null`
- `created_at timestamptz not null default now()`

Changing membership closes the prior effective interval and inserts a new assignment in one audited transaction. A profile tag change never changes this table automatically. Multiple active group assignments are allowed, but rule-priority conflicts must be resolved before activation.

The database and service layer enforce matching organization/project ownership, prohibit overlapping intervals for the same project-streamer/group pair, and prevent membership edits from changing locked settlement history. A membership change that affects future unsettled work requires a fresh impact simulation.

### `custom_settlement_rule_versions`

Stores versioned business rules throughout draft, review, active, and archived states.

Key fields:

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `scope text not null`
- `target_type text not null`
- `target_id uuid null`
- `execution_grain text not null`
- `composition_mode text not null`
- `priority integer not null default 100`
- `version_no integer not null`
- `status text not null`
- `formula text not null`
- `compiled_ast jsonb not null`
- `variables jsonb not null`
- `parameters jsonb not null default '{}'`
- `rule_contract jsonb not null`
- `system_explanation_template text not null`
- `missing_data_policy jsonb not null default '{}'`
- `test_cases jsonb not null default '[]'`
- `simulation_summary jsonb not null default '{}'`
- `effective_from timestamptz null`
- `effective_until timestamptz null`
- `created_by uuid null`
- `approved_by uuid null`
- `ai_draft_id uuid null`
- `reason text null`
- `created_at timestamptz not null default now()`
- `approved_at timestamptz null`
- `archived_at timestamptz null`

Draft creation does not require a high-risk reason. Submission, activation, force approval, active-rule archive, and any effective-period change do require a reason in the corresponding audit event.

### `ai_settlement_rule_drafts`

Stores AI generation traceability.

Key fields:

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `conversation_id uuid not null`
- `initial_user_prompt text not null`
- `conversation_turns jsonb not null default '[]'`
- `draft_rule_contract jsonb not null default '{}'`
- `unresolved_ambiguities jsonb not null default '[]'`
- `variable_catalog_version text not null`
- `ai_response jsonb not null`
- `generated_formula text null`
- `generated_explanation_draft text null`
- `generated_test_cases jsonb not null default '[]'`
- `model text not null`
- `safety_flags jsonb not null default '[]'`
- `created_by uuid null`
- `created_at timestamptz not null default now()`

### `settlement_formula_simulations`

Stores simulation summaries.

Key fields:

- `id uuid primary key`
- `rule_version_id uuid null`
- `ai_draft_id uuid null`
- `formula_hash text not null`
- `sample_source text not null`
- `sample_selection jsonb not null default '{}'`
- `coverage_summary jsonb not null default '{}'`
- `scenario_results jsonb not null default '[]'`
- `old_total_amount_cents bigint null`
- `new_total_amount_cents bigint null`
- `delta_amount_cents bigint null`
- `largest_deltas jsonb not null default '[]'`
- `warnings jsonb not null default '[]'`
- `created_by uuid null`
- `created_at timestamptz not null default now()`

A simulation belongs to either a persisted rule version or an AI draft; exactly one of `rule_version_id` and `ai_draft_id` must be present. This allows simulation before the user applies a draft without creating orphan rule versions. `apply-and-submit` copies the validated AI-draft simulation into a new immutable version-bound simulation record; it does not mutate or relink the original AI-draft evidence.

Historical totals and delta remain `null` when a new project has no comparable historical period. Synthetic scenario totals must not be presented as if they were a real historical baseline.

### Settlement Item Snapshot

Extend `settlement_batch_items.evidence_snapshot` with a `ruleEngine` object:

```json
{
  "ruleEngine": {
    "mode": "custom_formula",
    "ruleContractHash": "...",
    "executionGrain": "report",
    "parameters": {
      "s_level_bonus_cents": 5000,
      "yellow_evidence_rate_bps": 8000
    },
    "appliedLayers": [
      {
        "ruleVersionId": "...",
        "targetType": "project",
        "compositionMode": "replace",
        "priority": 100,
        "formulaHash": "..."
      },
      {
        "ruleVersionId": "...",
        "targetType": "streamer_group",
        "targetId": "...",
        "compositionMode": "add",
        "priority": 200,
        "formulaHash": "..."
      }
    ],
    "inputs": {
      "system_minutes": 180,
      "evidence_level": "green",
      "streamer_level": "S",
      "streamer_group_ids": ["..."]
    },
    "outputs": {
      "base": 24000,
      "bonus": 5000,
      "penalty": 0,
      "final": 29000
    },
    "missingDataDecisions": [],
    "explanation": "系统计时 180 分钟，按 80 元/小时计 240 元，S 级奖励 50 元。"
  }
}
```

This snapshot is required so future rule, parameter, or group-membership changes do not erase historical settlement explanations. The explanation is rendered from the applied AST layers and actual inputs, not copied from free-form AI prose.

## Backend Design

Add the following modules:

- `features/settlements/custom-rule-types.ts`
- `features/settlements/custom-rule-parser.ts`
- `features/settlements/custom-rule-validator.ts`
- `features/settlements/custom-rule-engine.ts`
- `features/settlements/custom-rule-contract.ts`
- `features/settlements/custom-rule-variable-catalog.ts`
- `features/settlements/custom-rule-data-readiness.ts`
- `features/settlements/custom-rule-composition.ts`
- `features/settlements/custom-rule-explanation.ts`
- `features/settlements/custom-rule-service.ts`
- `features/settlements/custom-rule-repository.ts`
- `features/settlements/custom-rule-ai.ts`

The parser converts formula text into an AST. The validator checks syntax, variable allowlists, function allowlists, money units, output ranges, and complexity. The engine executes the AST as a pure function.

The engine must not access Supabase, the filesystem, network, environment variables, timers, or random state. Database access belongs to the service/repository layer before building the execution context.

The AI adapter owns conversation-to-contract drafting only. Contract validation, variable availability, formula parsing, deterministic explanation, simulation, and state transitions remain non-AI services with typed outputs.

## Data Readiness and Simulation Gate

Before formula generation, the project-scoped variable catalog labels every candidate input as `available`, `partial`, `unavailable`, or `not_applicable`, with its source and latest coverage period. AI may suggest only variables allowed for the selected scope and must call out partial or unavailable fields in the business-rule contract.

Simulation has three required evidence sets:

1. Historical comparison against an authorized complete settlement period when data exists.
2. Synthetic boundary cases covering zero, threshold boundaries, maximum configured values, every evidence level, and every missing-data policy.
3. User-adjustable business examples stored with the rule version.

The result shows record count, required-input coverage, uncovered records, zero-pay count, review-routed count, largest increases and decreases, total delta, margin impact, and triggered risk policies. A new project with no history may use schema readiness plus synthetic and user examples, but the UI must label that no historical comparison exists.

Activation requires a simulation whose formula hash, rule-contract hash, parameter hash, variable-catalog version, and data-selection hash still match the submitted version. Any relevant edit makes the simulation stale and removes the activation action until simulation succeeds again.

## Settlement Execution

During settlement batch generation:

1. Determine scope and execution grain from `batchType` and the active rule contract.
2. Resolve every active base, group, and individual layer in deterministic composition order.
3. Build the input context and precomputed period aggregates from approved reports, project data, frozen project-streamer data, imported business data, and role-safe fields.
4. Apply the declared missing-data policy before execution. Review-routed items are excluded from calculated totals and surfaced as blocking exceptions for batch confirmation.
5. Execute each typed rule layer and compose its named output components.
6. Generate the Chinese explanation from the applied AST, parameters, inputs, and component outputs.
7. Persist final amount, component breakdown, all applied rule versions, formula hashes, group-membership snapshot, missing-data decisions, and input/output snapshot.
8. If no active custom base or modifier exists, keep using existing `calculateSettlementItem`.

If custom rule execution fails:

- In draft or simulation, return validation errors to the UI.
- In production, use `route_item_to_review` only for the exact optional-input case declared in the active rule contract.
- Any parser, type, unit, composition, parameter, authorization, or unexpected engine failure blocks generation. Do not silently fall back, because the user expects the active rule to be honored.
- Fixed-rule fallback is used only when no active custom base or modifier exists.
- A batch with review-routed items cannot be confirmed or locked until those items receive an audited resolution.

## Amount Unit Strategy

The new custom rule engine uses cents internally. All normal UI, AI conversation, business-rule contracts, parameters, examples, and explanations display yuan and percentages. Advanced-mode formulas use typed unit functions and never ask users to enter raw cents or basis points.

The existing settlement engine has legacy yuan-based outputs in some paths, while complex cost and tax use cents. Implementation must introduce explicit adapters:

- legacy settlement engine output yuan -> custom/reconciliation cents,
- typed DSL yuan/percentage literals -> AST cents/basis points -> settlement batch persisted unit,
- cost/tax cents remain unchanged,
- tests cover 100x conversion risks.

No new formula rule should store ambiguous "amount" fields without a unit suffix in persisted JSON.

## Product Usability Targets

The feature is not successful merely because the engine can evaluate a formula. Before general release, usability testing with target owner, ops-manager, finance, and operator users should meet these goals:

- after no more than 20 minutes of onboarding, at least 80% of participants can create and submit a template-based rule within 5 minutes without opening advanced mode,
- at least 80% can create and submit a new natural-language rule within 10 minutes, excluding approval wait time,
- at least 80% can correctly predict the outcome of the normal example and two boundary examples using only the Chinese business-rule contract and simulation,
- a reviewer can identify scope, affected target, largest financial delta, missing-data behavior, and material risks within 3 minutes,
- changing one named parameter and resubmitting a cloned rule takes no more than 3 minutes,
- every state shows at most one primary action, and normal completion never requires a user to enter cents, basis points, English variable names, or formula syntax.

Failure to meet these targets blocks broad rollout and triggers copy, workflow, template, or AI-clarification changes before adding more DSL power.

## Frontend Design

In project detail -> settlement settings, add "自定义公式规则".

The first decision uses business language: "你要计算什么？" with customer receivable, streamer payable, project cost, and settlement risk check. Technical scope values remain internal. The second decision shows only targets valid for the selected scope and explains how the target composes with existing rules. Payable supports project default, streamer group, and specific project streamer; receivable, external cost, and reconciliation default to project-scoped targets unless a later approved use case adds a narrower target.

The primary workspace includes:

- AI conversation with visible clarification questions and preserved revision history,
- Chinese business-rule contract with unresolved items highlighted,
- data-readiness panel showing source and coverage for every required variable,
- deterministic explanation panel,
- automatically generated and user-adjustable test cases,
- automatic simulation comparison:
  - current rule total,
  - new rule total,
  - delta,
  - sample count and required-input coverage,
  - zero-pay and review-routed counts,
  - largest changed streamers or reports,
  - triggered conditions,
  - margin impact.
- Risk panel:
  - negative margin,
  - abnormal increase,
  - red evidence priced,
  - missing variables,
  - unresolved imported fields.
- Version panel:
  - active version,
  - drafts,
  - pending review,
  - requested changes and comments,
  - archived versions,
  - approver and reason.
- Advanced mode, collapsed by default:
  - typed formula editor with syntax highlighting,
  - server-side validation messages,
  - compiled unit preview,
  - AST-derived explanation diff.
- First-release reuse tools:
  - common CPT, CPS, base-plus-performance, evidence-discount, floor/cap, and group-bonus templates,
  - clone from another authorized project,
  - save a confirmed rule as an organization template.

The page shows at most one primary action for the current state:

- unresolved conversation: "回复 AI",
- contract ready: "确认业务规则并试算",
- current successful simulation: "应用并提交审核" or, for an operator, "保存并请求审核",
- pending review for an eligible approver: "确认生效",
- changes requested: "修改并重新试算",
- active rule: "创建新版本".

Validation and simulation run as part of the state transition rather than appearing as permanent competing primary buttons. "保存草稿", "查看高级公式", "退回修改", and "归档规则" are contextual secondary actions or menu items.

"应用并提交审核" atomically persists the contract, formula, parameters, test cases, simulation hashes, and audit event before transitioning to `pending_review`. Partial persistence must not leave a formula that appears submitted but has no matching simulation.

Streamer-facing UI only receives personal settlement explanation summaries. It must not expose formulas, receivable rules, internal margin, tax, cost, or other streamers' data.

## API Design

Add routes:

- `POST /api/projects/:projectId/settlement-rules/ai-sessions`
  - Starts a project-scoped settlement-rule conversation and returns the initial draft contract.
- `POST /api/projects/:projectId/settlement-rules/ai-sessions/:sessionId/turns`
  - Adds a natural-language answer or revision and returns the contract diff, remaining ambiguity, and data-readiness changes.
- `POST /api/projects/:projectId/settlement-rules/ai-sessions/:sessionId/confirm-contract`
  - Confirms a fully resolved business-rule contract, generates a formula proposal, validates it, and starts simulation.
- `GET /api/projects/:projectId/settlement-rules/variable-catalog`
  - Returns scope-safe variables, sources, units, and project coverage.
- `GET /api/projects/:projectId/settlement-rule-groups`
  - Lists explicit settlement groups and effective membership counts.
- `POST /api/projects/:projectId/settlement-rule-groups`
  - Creates a project-scoped group.
- `POST /api/projects/:projectId/settlement-rule-groups/:groupId/assignments`
  - Adds, changes, or closes effective-dated membership with an audit reason and impact preview.
- `POST /api/projects/:projectId/settlement-rule-groups/:groupId/archive`
  - Archives a group only after all active rules and future memberships targeting it are resolved.
- `POST /api/projects/:projectId/settlement-rules/validate`
  - Validates an advanced-mode formula and returns the typed AST, deterministic explanation, contract diff, and errors.
- `POST /api/projects/:projectId/settlement-rules/simulate`
  - Runs historical, synthetic, and user-example previews with coverage and risk summaries.
- `GET /api/projects/:projectId/settlement-rules`
  - Lists active, draft, pending, changes-requested, and archived versions.
- `POST /api/projects/:projectId/settlement-rules`
  - Saves a draft without submitting it.
- `POST /api/projects/:projectId/settlement-rules/apply-and-submit`
  - Atomically creates the version, attaches the current simulation, writes audit records, and moves it to pending review.
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/request-changes`
  - Moves a pending version to changes requested with structured comments.
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/approve`
  - Activates the version and archives the prior active version.
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/archive`
  - Archives a draft or active rule with reason.
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/clone`
  - Creates an editable draft in an authorized target project with no inherited approval or active status.
- `GET /api/settlement-rule-templates`
  - Lists system and organization templates available to the actor.
- `POST /api/settlement-rule-templates`
  - Saves a confirmed rule as an organization template without copying project IDs, approvals, or historical sample data.

All write routes require billing write access for settlement, organization scoping, and role checks. Only high-risk state transitions require an audit reason; ordinary AI turns and low-risk draft saves do not.

## Permissions

- `owner`: create, simulate, submit, request changes, approve, activate, force approve, archive, and manage organization templates.
- `ops_manager`: create, simulate, submit, request changes, approve standard-risk rules, activate standard-risk rules, archive, and manage organization templates.
- `finance`: view, simulate, comment or request changes; no direct activation.
- `operator_business`: use AI, create drafts, simulate, and submit/request review; no approval or activation.
- `streamer`: no access to internal rules; can view personal settlement explanation summaries.

Owner and ops manager can create settlement groups and change effective membership. Finance and operators can view group composition; operators can request a membership change through review comments but cannot activate it themselves.

By default, the creator and approver must be different when the organization has another eligible approver. Material-risk rules always require a different owner approver. If the organization has only one eligible owner, that owner may use a clearly labeled force-approval path with an additional acknowledgment and reason; the action is highlighted in audit history.

Material risk includes negative margin, abnormal total increase, red-evidence payment, an explicit missing-data default that changes money, a group-level replacement rule, overlapping group exceptions, or output above the project safety cap.

Activation, force approval, active-rule archive, and any effective-period change are high-risk settlement actions and require an audit reason. Returning a rule for changes requires a comment but does not require a high-risk reason.

## Error Handling

Validation errors should be specific:

- unresolved business ambiguity,
- contract and formula mismatch,
- unknown variable,
- unknown function,
- wrong argument count,
- unit mismatch,
- raw money or rate literal without a unit,
- incompatible execution grain,
- circular or later-layer dependency,
- target overlap or composition-priority conflict,
- formula too complex,
- missing required input,
- partial data coverage without an explicit policy,
- possible negative output,
- output exceeds configured safety cap,
- red evidence is being paid when policy blocks it,
- simulation sample unavailable,
- stale simulation after contract, parameter, catalog, or formula changes.

Production settlement generation follows only the active rule's declared missing-data policy. All other active custom-rule failures block generation. The response should identify the rule version, failing layer, and safe error category without leaking unauthorized data.

AI generation can fail independently of formula validation. In that case, preserve the conversation, confirmed contract, and user edits, show a retryable AI error, and do not create a rule version. A formula may never become valid merely because AI described it as valid.

## Audit and Governance

Every draft application, submission, requested change, approval, force approval, archive, group-assignment change, and failed activation attempt writes audit records.

Audit records include:

- actor,
- role,
- project,
- rule scope,
- version number,
- before/after status,
- formula hash,
- rule-contract and parameter hashes,
- execution grain and composition order,
- variable-catalog version and coverage summary,
- simulation delta summary,
- reason,
- whether creator and approver are the same,
- force-approval acknowledgment where applicable,
- AI draft ID where applicable.

AI prompts, turns, contract revisions, and responses are retained in `ai_settlement_rule_drafts` for traceability and remain organization-scoped sensitive data. The active formula, compiled AST, parameters, confirmed business-rule contract, missing-data policy, and applied version snapshot are the legal calculation source inside the product. Free-form AI explanation is never the legal source.

## Testing Plan

Unit tests:

- parser accepts valid formulas and rejects illegal syntax,
- typed literals compile yuan to cents and percentages to basis points without exposing raw units to normal users,
- validator rejects unknown variables/functions, ambiguous units, invalid output contracts, circular dependencies, and excessive complexity,
- contract diff logic preserves unchanged fields during natural-language revision,
- variable adapters expose persisted cents and basis-point fields as typed money and rate values,
- composition orders project, group, and individual layers deterministically and rejects tied overlapping priorities,
- engine computes CPT, tiers, evidence discounts, bonuses, floors, caps, CPS, and signed adjustments correctly,
- amount unit adapters prevent yuan/cents 100x errors.

Service tests:

- unresolved AI ambiguity prevents contract confirmation,
- AI provider payloads contain scope-safe metadata and exclude raw settlement rows by default,
- AI draft cannot become active directly,
- one active rule per target is enforced,
- stale simulation prevents submission or activation,
- apply-and-submit is atomic,
- requested changes preserve comments and require a fresh simulation after edits,
- material-risk approval enforces a different owner or the explicit single-owner force path,
- settlement-group assignments enforce organization/project ownership, effective intervals, audited backfill, and fresh simulation,
- approval archives old active versions,
- role permissions match the matrix,
- declared missing-data policies route, block, or use approved defaults exactly as configured,
- production generation blocks on undeclared active custom-rule failure,
- no active custom layer falls back silently, while no active custom rule uses existing fixed rules.

Route tests:

- unauthenticated and unauthorized requests fail,
- billing write guard blocks writes,
- AI session, variable catalog, group, template, validation, simulation, apply-and-submit, request-changes, approve, clone, and archive routes map errors correctly,
- audit reason is required for high-risk transitions.

Integration/regression tests:

- payable batch composes project base, frozen streamer-group modifiers, and project-streamer exceptions in priority order,
- unassigned existing project streamers remain on the project base and appear in simulation coverage,
- effective-dated group changes affect future eligible work without changing locked history,
- payable batch falls back to frozen `project_streamers` base when no custom base exists,
- per-period guarantees and caps execute once at `project_streamer_period` grain,
- receivable batch-level base fees execute once at batch grain,
- review-routed items stay outside calculated totals and block confirmation until resolved,
- item snapshots include every applied layer, contract and formula hashes, group snapshot, inputs, outputs, missing-data decisions, and deterministic explanation,
- locked historical batches do not change after a rule update,
- reconciliation warns or blocks based on custom checks.

UI tests:

- AI asks focused questions when required business meaning is ambiguous,
- normal mode confirms a Chinese business-rule contract while advanced formula editing stays collapsed,
- user-facing money and rate values display yuan and percentages,
- only one primary action appears for each state,
- "应用并提交审核" creates and submits one simulation-bound version atomically,
- natural-language revision shows a business diff and preserves unaffected conditions,
- requested changes return the rule to an editable state,
- approval requires reason,
- simulation shows current/new/delta amounts, coverage, zero-pay count, review-routed count, and risk warnings,
- keyboard focus and status announcements work across AI replies, validation errors, simulation completion, and approval dialogs,
- streamer view receives only personal explanation summaries.

## Rollout Plan

Phase 1: Low-cost authoring, typed DSL, and read-only simulation.

- Add project variable catalog, business-rule contract, typed parser, validator, engine, deterministic explanation, and tests.
- Add multi-turn AI clarification and natural-language revision behind a feature flag.
- Add AI-draft and simulation storage for historical, synthetic boundary, and user-example simulations with data-readiness coverage.
- Add common read-only system templates.
- Keep formula editing inside collapsed advanced mode.

Phase 2: Drafts and approval.

- Add rule version tables, RLS, repositories, services, and routes.
- Add atomic apply-and-submit, request-changes, distinct approval, force approval, and archive workflows.
- Add audit and version UI.
- Add settlement-group tables, effective-dated assignments, and group management UI.
- Add organization templates, clone-to-draft, and parameter editing.

Phase 3: Payable and receivable execution.

- Integrate base, group, and individual composition into settlement batch generation.
- Add report, project-streamer-period, batch, and project-period execution grains.
- Add missing-data review exceptions and pre-confirmation gates.
- Persist item snapshots.
- Keep fixed-rule fallback.

Phase 4: External costs and reconciliation.

- Add external cost rule execution into cost-item draft flow.
- Add custom reconciliation checks into confirmation/lock gates.

Phase 5: Hardening.

- Add larger-period simulation and performance tuning.
- Add richer organization template governance and usage analytics.
- Add AI-assisted migration of legacy structured rules into confirmed contracts.
- Add export fields for rule explanations.

## Implementation Defaults

Use these defaults for the first implementation plan:

- Natural-language conversation and the Chinese business-rule contract are the primary authoring experience. Text formula editing, syntax highlighting, and compiled-unit preview live in collapsed advanced mode. Do not build a full block editor in the first version.
- AI must resolve required ambiguity before formula generation and must support natural-language revision with a preserved business diff in the first release.
- Normal UI and formula literals use yuan and percentages; the compiler and persistence layer use cents and basis points.
- Show one state-aware primary action. Applying a ready rule creates and submits a simulation-bound draft in one transaction; it never activates directly.
- Operators can create, simulate, and submit/request review. Only owner and ops manager can approve activation or archive an active rule.
- Standard approval uses a different eligible approver when available. Material-risk rules require a different owner; a single-owner organization uses the explicit force-approval path.
- Use project base, frozen streamer-group modifier, and project-streamer exception layers with deterministic priorities. Reject ambiguous overlaps.
- Freeze streamer-group membership for settlement-relevant assignments and persist the applied membership in item snapshots.
- Use scope- and execution-grain-specific variable allowlists. Receivable, payable, external cost, and reconciliation rules do not share one global variable surface.
- Require data-readiness coverage and fresh historical/synthetic simulation before activation. Every optional input has an explicit missing-data policy.
- Include common templates, named parameters, clone-to-draft, and organization template saving in the first usable release.
- External cost formulas create `draft` cost items by default. A separate confirmation action is required before those cost items count in project reconciliation.
- Set formula complexity limits in configuration, with conservative initial defaults: serialized formula under 16 KB, AST depth under 20, AST nodes under 300, and no single calculated money output above the project-level safety cap unless owner force approval is recorded.
- Require owner force reason for formulas whose simulation creates negative margin, abnormal total increase, red-evidence payment, an overlapping group exception, or an explicit missing-data default that materially affects settlement.
