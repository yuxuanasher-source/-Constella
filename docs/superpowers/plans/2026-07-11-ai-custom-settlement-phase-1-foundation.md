# AI Custom Settlement Rules Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the feature-flagged, read-only authoring foundation: natural-language clarification, a confirmed Chinese business-rule contract, a controlled typed formula DSL, deterministic validation/explanation, project data-readiness checks, and historical/synthetic/user-example simulation.

**Architecture:** Keep AI outside the financial trust boundary. Reuse the shared Xingyao conversation ledger for turn persistence, but place a settlement-specific adapter around it. Parse expressions with jsep, immediately translate library nodes into a product-owned AST, type-check that AST, and execute only the compiled product AST in a pure engine. Supabase access is confined to repository/data-readiness layers; the model receives only scope-safe variable metadata. Phase 1 persists AI draft evidence and immutable simulation records but cannot create or activate executable rule versions.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase/Postgres RLS, Zod 4, jsep 1.4.0 with the object-expression plugin, existing AI gateway/conversation service, Vitest and Testing Library.

---

## Preconditions And Ownership

- This plan depends on `docs/superpowers/plans/2026-07-11-xingyao-conversation-protocol.md` being implemented and committed first.
- Treat `features/ai/conversation-*.ts` and `app/api/ai/conversations/**` as shared infrastructure. Import their public service/contracts; do not fork or rewrite them in this slice.
- Keep `features/settlements/settlement-engine.ts` as the legacy fixed-rule path. Phase 1 does not change production batch generation.
- The public feature flag is `NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED` and defaults to false.
- Initial authoring permissions are explicit: owner, ops manager, and business operator may start/revise/confirm AI drafts; finance may view catalogs and run simulations on an existing authorized draft but may not create or submit one; streamers have no access.
- The source design is `docs/superpowers/specs/2026-07-11-ai-custom-settlement-formula-rules-design.md`. Any conflict is resolved in favor of that spec.

### Task 1: Establish The Baseline And Parser Dependency

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Create: `features/settlements/custom-rule-feature-flag.ts`
- Test: `features/settlements/custom-rule-feature-flag.test.ts`

- [ ] Confirm the shared conversation protocol is tracked:

```bash
git ls-files features/ai/conversation-contracts.ts features/ai/conversation-service.ts
```

Expected: both paths are printed. If either path is absent, stop this plan and finish the prerequisite plan; do not copy uncommitted conversation files.

- [ ] Run the settlement and conversation baseline:

```bash
pnpm vitest run features/settlements/settlement-engine.test.ts features/settlements/structured-settlement-rule.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-service.test.ts
```

Expected: all selected tests pass. Record unrelated baseline failures before changing code.

- [ ] Add the expression parser at exact reviewed versions:

```bash
pnpm add jsep@1.4.0 @jsep-plugin/object@1.2.2
```

- [ ] Write a failing feature-flag test proving undefined, empty, and `"false"` are disabled while only `"true"` is enabled.

- [ ] Run the new test and confirm it fails because the module does not exist:

```bash
pnpm vitest run features/settlements/custom-rule-feature-flag.test.ts
```

- [ ] Implement a side-effect-free helper that accepts an injected environment record. Add `NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED=false` to `.env.example`.

```ts
export function isCustomSettlementRulesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED === "true";
}
```

- [ ] Re-run the test and commit only this task:

```bash
pnpm vitest run features/settlements/custom-rule-feature-flag.test.ts
git add package.json pnpm-lock.yaml .env.example features/settlements/custom-rule-feature-flag.ts features/settlements/custom-rule-feature-flag.test.ts
git commit -m "feat: add custom settlement rule feature gate"
```

### Task 2: Define Runtime Contracts, Stable ASTs, And Unit Adapters

**Files:**

- Create: `features/settlements/custom-rule-types.ts`
- Test: `features/settlements/custom-rule-types.test.ts`
- Create: `features/settlements/custom-rule-contract.ts`
- Test: `features/settlements/custom-rule-contract.test.ts`

- [ ] Write failing tests for:
  - valid scope, target, grain, composition mode, status, variable, parameter, missing-data policy, and simulation records;
  - scope/target compatibility: payable allows project, settlement group, and project-streamer targets; receivable, external cost, and reconciliation are project-targeted in the first release;
  - `target_type=project` requires a null target ID, while group and project-streamer targets require an ID;
  - rejection of unknown object keys and ambiguous amount fields;
  - Chinese contract completeness: target, grain, components, inputs and sources, units, effective period, missing-data behavior, composition, one normal example, and two boundary examples;
  - a valid IANA business timezone whenever weekday/hour/date boundaries are referenced; default to an explicit `Asia/Shanghai` contract value only when no organization setting exists, never to the server's local timezone;
  - natural-language revision preserving untouched fields and producing a before/after business diff;
  - exact yuan-to-cents and percent-to-basis-point conversion, including `0.01 yuan -> 1 cent` and `80% -> 8000 bps`;
  - overflow, NaN, Infinity, fractional cents, and unsafe integers.

- [ ] Run the tests and confirm missing exports fail:

```bash
pnpm vitest run features/settlements/custom-rule-types.test.ts features/settlements/custom-rule-contract.test.ts
```

- [ ] Define narrow domain unions rather than database-row-shaped types:

```ts
export type CustomRuleScope =
  | "receivable"
  | "payable"
  | "external_cost"
  | "reconciliation";

export type CustomRuleExecutionGrain =
  | "report"
  | "project_streamer_period"
  | "batch"
  | "project_period";

export type MissingDataPolicy =
  | { kind: "route_item_to_review" }
  | { kind: "block_batch" }
  | { kind: "use_explicit_default"; value: TypedRuntimeValue };
```

- [ ] Define two ASTs:
  - `NormalizedAstNode` is the parser-owned, library-independent expression tree.
  - `CompiledAstNode` includes inferred types and normalized money/rate literals. Persist only this stable compiled form, never jsep nodes.

Required normalized node kinds are `literal`, `identifier`, `unary`, `binary`, `call`, `array`, and `object`. Required compiled scalar types are `money_cents`, `rate_bps`, `number`, `integer`, `boolean`, `string`, `timestamp`, and typed arrays/objects.

- [ ] Add explicit adapters:

```ts
export function yuanToCentsStrict(value: number): number;
export function centsToLegacyYuan(cents: number): number;
export function percentToBpsStrict(value: number): number;
export function assertSafeIntegerValue(value: number, label: string): number;
```

Do not expose a generic persisted field named `amount` inside new JSON contracts. Use `amountCents` or `rateBps`.

- [ ] Distinguish per-execution safe integer cents from aggregate database `bigint` totals. Repository code parses aggregate cents into `bigint`/`BigInt`, hashes their canonical decimal strings, and serializes API totals as decimal strings when they may exceed JSON's safe integer range. Add round-trip tests; never coerce a Postgres bigint string with unchecked `Number(...)`.

- [ ] Implement strict Zod schemas and `diffBusinessRuleContracts(before, after)`. Do not accept AI output through TypeScript casts.

- [ ] Re-run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-types.test.ts features/settlements/custom-rule-contract.test.ts
git add features/settlements/custom-rule-types.ts features/settlements/custom-rule-types.test.ts features/settlements/custom-rule-contract.ts features/settlements/custom-rule-contract.test.ts
git commit -m "feat: define custom settlement rule contracts"
```

### Task 3: Parse And Type-Check The Controlled DSL

**Files:**

- Create: `features/settlements/custom-rule-parser.ts`
- Test: `features/settlements/custom-rule-parser.test.ts`
- Create: `features/settlements/custom-rule-validator.ts`
- Test: `features/settlements/custom-rule-validator.test.ts`

- [ ] Write parser tests that accept:
  - an optional narrow `payable =`, `receivable =`, `external_cost =`, or `reconciliation =` prefix;
  - `money_result({ base: yuan(80), final: base })`;
  - arrays and object literals used by `tiered` and `evidence_multiplier`;
  - allowed arithmetic, comparison, boolean, and unary operators.

- [ ] Write parser tests that reject member access, computed access, assignment inside the expression, statements, blocks, sequence/compound expressions, arrow/functions, constructors, templates, spread, update operators, regex, optional chaining, and any unrecognized jsep node.

- [ ] Add hard-limit tests for UTF-8 formula size over 16 KiB, depth over 20, and node count over 300.

- [ ] Run the parser test and confirm red:

```bash
pnpm vitest run features/settlements/custom-rule-parser.test.ts
```

- [ ] Register only `@jsep-plugin/object`. Strip the optional scope prefix before parsing, translate every accepted node into `NormalizedAstNode`, and fail closed on unknown nodes. Never use `eval`, `Function`, dynamic imports, or source-code generation.

- [ ] Write validator tests for the scope/grain-specific allowlists and these functions:

```text
if, min, max, clamp, round_money, tiered, percent,
evidence_multiplier, in, contains, yuan, rate_percent,
parameter, money_result
```

- [ ] Cover typed behavior:
  - `yuan(80)` compiles to 8000 cents;
  - `rate_percent(80)` compiles to 8000 bps;
  - `percent(money, rate)` returns money;
  - money plus money is valid, money plus rate is not;
  - raw numeric money/rate arguments are rejected when the unit cannot be inferred;
  - `money_result` requires `final`, rejects forward component references, and allows only earlier component references;
  - a component dependency cycle is rejected;
  - report variables are unavailable to incompatible aggregate grains;
  - external-cost and reconciliation output functions remain disabled in Phase 1;
  - unknown variables/functions and incorrect argument counts produce stable error codes and source spans.

- [ ] Implement `validateCustomRuleFormula` returning either a compiled AST plus referenced variables/parameters or typed validation issues:

```ts
type ValidationResult =
  | {
      ok: true;
      compiledAst: CompiledAstNode;
      variables: string[];
      parameters: string[];
      formulaHash: string;
    }
  | { ok: false; issues: CustomRuleIssue[] };
```

- [ ] Hash canonical JSON, not object insertion order. Use the existing platform crypto API or Node `createHash("sha256")` in server code.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-parser.test.ts features/settlements/custom-rule-validator.test.ts
git add features/settlements/custom-rule-parser.ts features/settlements/custom-rule-parser.test.ts features/settlements/custom-rule-validator.ts features/settlements/custom-rule-validator.test.ts
git commit -m "feat: add typed settlement formula compiler"
```

### Task 4: Build The Pure Engine And Deterministic Explanation

**Files:**

- Create: `features/settlements/custom-rule-engine.ts`
- Test: `features/settlements/custom-rule-engine.test.ts`
- Create: `features/settlements/custom-rule-explanation.ts`
- Test: `features/settlements/custom-rule-explanation.test.ts`

- [ ] Write failing engine tests for CPT, progressive tiers, evidence discounts, base plus bonus minus penalty, floor/cap, named parameters, CPS percent, zero, threshold boundaries, and maximum configured values.

- [ ] Lock arithmetic semantics in tests: money/rates are integers; general division cannot accept money; `percent` and `tiered` use checked integer/BigInt numerator-denominator arithmetic; positive half-cent values round half up and signed modifier values round half away from zero. Test exact half-cent boundaries and intermediate overflow before converting back to a safe integer.

- [ ] Add failure tests for missing required inputs, wrong runtime types, negative money output, non-finite output, unsafe integers, unknown compiled nodes, and engine step/depth exhaustion.

- [ ] Verify `money_result` returns stable named components:

```ts
expect(result).toEqual({
  kind: "money_result",
  componentsCents: {
    base: 24000,
    bonus: 5000,
    penalty: 0,
    final: 29000,
  },
});
```

- [ ] Implement the evaluator as a pure function over a frozen input context:

```ts
export function executeCompiledCustomRule(input: {
  ast: CompiledAstNode;
  variables: Readonly<Record<string, TypedRuntimeValue>>;
  parameters: Readonly<Record<string, TypedRuntimeValue>>;
  limits?: { maxSteps: number; maxDepth: number };
}): CustomRuleExecutionResult;
```

The module must not import Supabase, filesystem, network, environment, clocks, random state, or the AI gateway.

- [ ] Write explanation tests proving the same AST/input/output always generates the same Chinese text, includes units and triggered branches, omits untriggered branches, and never uses free-form AI prose as the authoritative explanation.

- [ ] Implement AST-derived template and execution explanation functions. Keep labels in a registry keyed by variable/function IDs so the formula engine remains language-neutral.

- [ ] Run the pure tests twice to catch hidden clock/random dependence, then commit:

```bash
pnpm vitest run features/settlements/custom-rule-engine.test.ts features/settlements/custom-rule-explanation.test.ts
pnpm vitest run features/settlements/custom-rule-engine.test.ts features/settlements/custom-rule-explanation.test.ts
git add features/settlements/custom-rule-engine.ts features/settlements/custom-rule-engine.test.ts features/settlements/custom-rule-explanation.ts features/settlements/custom-rule-explanation.test.ts
git commit -m "feat: execute and explain settlement formulas"
```

### Task 5: Add Project Variable Catalog And Data-Readiness Analysis

**Files:**

- Create: `features/settlements/custom-rule-variable-catalog.ts`
- Test: `features/settlements/custom-rule-variable-catalog.test.ts`
- Create: `features/settlements/custom-rule-data-readiness.ts`
- Test: `features/settlements/custom-rule-data-readiness.test.ts`
- Create: `features/settlements/custom-rule-repository.ts`
- Test: `features/settlements/custom-rule-repository.test.ts`

- [ ] Write catalog tests that expose only scope/grain-safe metadata: ID, Chinese label, type, unit, source label, availability, coverage numerator/denominator, and latest sampled period.

- [ ] Lock initial source truth to the current schema:
  - available/coverage-based: `system_minutes`, `screenshot_minutes`, `settlement_minutes`, `evidence_level`, `time_source`, `views`, report timestamps, project/streamer IDs, frozen hourly/base/CPS values, streamer source, collaboration ID;
  - `approved_at` maps to immutable `live_reports.reviewed_at` for approved reports; never invent an `approved_at` column;
  - derived: weekday/hour and compatible period aggregates;
  - partial only when backed by normalized imports: sales, order, gift, supplier, and traffic fields;
  - unavailable initially: `streamer_level` and any field without a canonical persisted source.

- [ ] Add a regression test that an AI-facing catalog DTO contains no report values, streamer amounts, other-streamer data, internal margin, tax, or raw import payload.

- [ ] Write readiness tests for `available`, `partial`, `unavailable`, and `not_applicable`; required input at less than 100% coverage; optional input with each explicit policy; forbidden defaults for identity/evidence/authorization fields; and a project with no history.

- [ ] Expose weekday/hour variables only with a confirmed business timezone. Include that timezone in contract and simulation hashes so a timezone change makes prior simulation stale.

- [ ] Implement repository reads with organization and project predicates on every query. Fetch only fields needed to compute coverage; do not return raw rows from the API:

```ts
export type CustomRuleReadRepository = {
  getProjectVariableCoverage(input: {
    organizationId: string;
    projectId: string;
    periodStart?: string;
    periodEnd?: string;
  }): Promise<ProjectVariableCoverage>;
};
```

- [ ] Add a deterministic catalog version hash over source definitions plus project coverage state. The hash must change when source availability changes, not merely when labels/copy change.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-variable-catalog.test.ts features/settlements/custom-rule-data-readiness.test.ts features/settlements/custom-rule-repository.test.ts
git add features/settlements/custom-rule-variable-catalog.ts features/settlements/custom-rule-variable-catalog.test.ts features/settlements/custom-rule-data-readiness.ts features/settlements/custom-rule-data-readiness.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts
git commit -m "feat: expose settlement rule data readiness"
```

### Task 6: Persist AI Draft Evidence And Immutable Simulations

**Files:**

- Create: `supabase/migrations/20260711110000_custom_settlement_rule_authoring.sql`
- Modify: `lib/db/schema-contract.test.ts`
- Modify: `features/settlements/custom-rule-repository.ts`
- Modify: `features/settlements/custom-rule-repository.test.ts`

- [ ] Add failing schema-contract assertions for `ai_settlement_rule_drafts` and `settlement_formula_simulations`, their check constraints, indexes, organization/project foreign keys, `ai_settlement_rule_drafts.conversation_id -> ai_conversations.id`, unique conversation revision numbers, owner/staff read policies, and service-owned write paths.

- [ ] Run the schema test and confirm it fails:

```bash
pnpm vitest run lib/db/schema-contract.test.ts
```

- [ ] Create `ai_settlement_rule_drafts` with the approved fields plus explicit revision/status/hash columns:
  - conversation and prompt/turn trace;
  - draft Chinese contract and unresolved ambiguities;
  - variable catalog version;
  - AI response, generated formula/explanation draft/test cases, model, and safety flags;
  - contract/formula/parameter hashes;
  - `clarifying | contract_ready | simulated | failed | superseded` status and monotonic revision number.

- [ ] Create `settlement_formula_simulations` with exactly one owner:

```sql
check (
  (rule_version_id is not null)::integer
  + (ai_draft_id is not null)::integer
  = 1
)
```

In Phase 1 `rule_version_id` is a nullable UUID column without a foreign key. Phase 2 adds the foreign key after the version table exists.

- [ ] Store all freshness inputs: formula hash, rule-contract hash, parameter hash, variable-catalog version, data-selection hash, sample source/selection, coverage, scenarios, historical totals, deltas, largest changes, warnings, and creator/time.

- [ ] Add RLS:
  - MCN staff with project access can read;
  - streamers cannot read;
  - clients cannot mutate simulations after insert;
  - authoring writes go through fixed-search-path security-definer functions that verify `auth.uid()`, organization membership, project access, and allowed role.

- [ ] Add repository tests for organization isolation, ordered revisions, immutable simulation insert/read, and no raw cross-project sample rows in persisted summaries.

- [ ] Implement Supabase mappings with explicit snake/camel conversion and typed JSON parsing.

- [ ] Run schema and repository tests, reset the local database if available, and commit:

```bash
pnpm vitest run lib/db/schema-contract.test.ts features/settlements/custom-rule-repository.test.ts
pnpm supabase:migrate
git add supabase/migrations/20260711110000_custom_settlement_rule_authoring.sql lib/db/schema-contract.test.ts features/settlements/custom-rule-repository.ts features/settlements/custom-rule-repository.test.ts
git commit -m "feat: persist settlement AI drafts and simulations"
```

Expected database result: both tables exist, RLS is enabled, and an authenticated streamer cannot select their rows.

### Task 7: Implement Settlement-Specific AI Clarification And Simulation

**Files:**

- Create: `features/settlements/custom-rule-ai.ts`
- Test: `features/settlements/custom-rule-ai.test.ts`
- Create: `features/settlements/custom-rule-service.ts`
- Test: `features/settlements/custom-rule-service.test.ts`
- Create: `features/settlements/custom-rule-simulation.ts`
- Test: `features/settlements/custom-rule-simulation.test.ts`
- Create: `features/settlements/custom-rule-system-templates.ts`
- Test: `features/settlements/custom-rule-system-templates.test.ts`

- [ ] Define a small injected conversation port in `custom-rule-ai.ts` using the public conversation service methods. Do not import database row types and do not modify the generic conversation service.

- [ ] Write AI adapter tests for:
  - structured-output schema validation;
  - one focused question per turn;
  - no formula while required ambiguities remain;
  - formula/test cases only after explicit contract confirmation;
  - revision preserving unaffected contract fields and returning an exact business diff;
  - prompt payload containing scope-safe metadata but no raw settlement rows or amounts;
  - provider failure preserving the conversation and draft;
  - model output claiming validity still being rejected by the deterministic validator.

- [ ] Use the existing structured AI gateway with a Zod response schema:

```ts
const settlementDraftResponseSchema = z.strictObject({
  contractPatch: businessRuleContractPatchSchema,
  unresolvedAmbiguities: z.array(ambiguitySchema),
  nextQuestion: z.string().nullable(),
  formulaProposal: z.string().nullable(),
  testCases: z.array(ruleTestCaseSchema),
  safetyFlags: z.array(z.string()),
});
```

- [ ] Write simulation tests covering:
  - authorized historical comparison when history exists;
  - no-history result with null old/delta totals and a visible unverified label;
  - synthetic zero, every threshold edge, configured maximum, every evidence level, and every missing-data policy;
  - user-adjustable examples;
  - record count, coverage, uncovered count, zero-pay count, review-routed count, largest increases/decreases, total delta, margin impact, and risk flags;
  - simulation freshness hashes;
  - legacy-yuan/current-rule results converted to cents exactly once.

- [ ] Implement a deterministic simulator that receives already-authorized sample contexts and never asks AI to calculate money. Hash the selected record IDs and immutable source versions into `dataSelectionHash`; do not persist raw other-streamer inputs in the simulation summary.

- [ ] Implement read-only system templates for common CPT, CPS, base-plus-performance, evidence discount, floor/cap, and group bonus contracts. Templates produce editable contracts, never active formulas.

- [ ] Implement service transitions:
  - start session -> persist clarifying draft;
  - answer/revise -> append generic conversation turn and new draft revision;
  - confirm contract -> require zero unresolved items, call AI formula proposal, parse/validate, derive authoritative explanation, run readiness and all simulations;
  - no Phase 1 method may create `custom_settlement_rule_versions` or activate anything.

- [ ] Run focused tests and commit:

```bash
pnpm vitest run features/settlements/custom-rule-ai.test.ts features/settlements/custom-rule-service.test.ts features/settlements/custom-rule-simulation.test.ts features/settlements/custom-rule-system-templates.test.ts
git add features/settlements/custom-rule-ai.ts features/settlements/custom-rule-ai.test.ts features/settlements/custom-rule-service.ts features/settlements/custom-rule-service.test.ts features/settlements/custom-rule-simulation.ts features/settlements/custom-rule-simulation.test.ts features/settlements/custom-rule-system-templates.ts features/settlements/custom-rule-system-templates.test.ts
git commit -m "feat: add AI settlement authoring and simulation"
```

### Task 8: Expose Read-Only Authoring APIs

**Files:**

- Create: `features/settlements/custom-rule-route-context.ts`
- Test: `features/settlements/custom-rule-route-context.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/variable-catalog/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/variable-catalog/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/validate/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/validate/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/simulate/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/simulate/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/turns/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/turns/route.test.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/confirm-contract/route.ts`
- Create: `app/api/projects/[projectId]/settlement-rules/ai-sessions/[sessionId]/confirm-contract/route.test.ts`

- [ ] Write route tests before handlers for authentication, project/organization isolation, the exact authoring/view/simulation role matrix above, disabled flag, malformed JSON, unknown session, stale revision, and stable error-to-status mapping.

- [ ] The session detail GET composes generic conversation history with the latest organization/project-scoped settlement draft revision and simulation summary. It is the refresh/restore source and never returns raw historical sample rows.

- [ ] Prove every write-like authoring route calls:

```ts
await assertBillingWriteAllowed({
  client: context.supabase,
  organizationId: context.auth.organizationId,
  featureKey: "settlement",
});
```

GET variable catalog remains readable in billing read-only mode; starting sessions, adding turns, confirming contracts, validating edited formulas, and running new simulations are settlement writes.

- [ ] Build `getCustomRuleRouteContext` by composing existing auth, Supabase, audit, AI provider registry/gateway, generic conversation service, and custom-rule repository/service dependencies. Do not add global singletons.

- [ ] Parse all request bodies through Zod. Return safe error objects:

```json
{
  "error": {
    "code": "CUSTOM_RULE_UNIT_MISMATCH",
    "message": "金额不能与百分比直接相加",
    "path": ["formula", "final"],
    "retryable": false
  }
}
```

- [ ] Ensure AI/provider errors never expose provider keys, raw prompts containing sensitive values, or model stack traces.

- [ ] Run all new route tests and the API contract suite:

```bash
pnpm vitest run app/api/projects/[projectId]/settlement-rules features/settlements/custom-rule-route-context.test.ts
pnpm test:api-contracts
```

- [ ] Commit:

```bash
git add features/settlements/custom-rule-route-context.ts features/settlements/custom-rule-route-context.test.ts app/api/projects/[projectId]/settlement-rules
git commit -m "feat: expose settlement rule authoring APIs"
```

### Task 9: Add The Feature-Flagged Read-Only Workspace

**Files:**

- Create: `components/reference-ui/custom-settlement-rule-workspace.jsx`
- Test: `components/reference-ui/custom-settlement-rule-workspace.test.jsx`
- Create: `components/reference-ui/custom-settlement-rule-api.js`
- Test: `components/reference-ui/custom-settlement-rule-api.test.js`
- Modify: `components/reference-ui/ops-reference.jsx`
- Modify: `components/reference-ui/ops-reference.test.jsx`

- [ ] Write API client tests for typed success/error handling, aborted stale requests, and URL encoding.

- [ ] Write component tests for:
  - scope choice in business language;
  - one focused AI question at a time;
  - unresolved contract fields highlighted;
  - advanced formula area collapsed by default;
  - yuan/percent display without cents/bps/English variable names in normal mode;
  - deterministic explanation visually distinct from AI draft prose;
  - current/new/delta, coverage, zero-pay, review-routed, largest changes, and risk output;
  - no-history label;
  - natural-language revision diff preserving unchanged fields;
  - exactly one primary action in each Phase 1 state;
  - keyboard focus moved to the new AI question/error/result heading and polite status announcements.

- [ ] Implement the workspace as a full-width tool surface with restrained panels, no nested cards, stable responsive dimensions, and lucide icons/tooltips for icon-only controls.

- [ ] Keep local state to unsent input, selected scope/target, active session ID, and request state. Server responses remain authoritative for conversation, contract, and simulation history.

- [ ] Add a `custom_rules` tab to `ScreenSettlement` only when the public feature flag is enabled. Do not move or remove the existing summary fixed-rule form.

- [ ] Phase 1 exposes customer receivable and streamer payable choices only. Do not render disabled project-cost/risk-check controls; Phase 4 adds those choices when their output contracts and execution paths exist.

- [ ] In Phase 1, the state actions are:
  - unresolved: `回复 AI`;
  - contract ready: `确认业务规则并试算`;
  - simulated: no activation action; show a non-primary internal-preview status and `修改规则` as the next editable command.

Do not render `应用并提交审核` until Phase 2 implements its atomic backend.

- [ ] Run focused UI tests:

```bash
pnpm vitest run components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/ops-reference.test.jsx
```

- [ ] Commit:

```bash
git add components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-workspace.test.jsx components/reference-ui/custom-settlement-rule-api.js components/reference-ui/custom-settlement-rule-api.test.js components/reference-ui/ops-reference.jsx components/reference-ui/ops-reference.test.jsx
git commit -m "feat: add AI settlement rule simulation workspace"
```

### Task 10: Phase 1 Verification And Exit Gate

**Files:**

- All files changed in this plan.

- [ ] Run focused domain and route suites:

```bash
pnpm vitest run features/settlements app/api/projects/[projectId]/settlement-rules components/reference-ui/custom-settlement-rule-workspace.test.jsx
```

- [ ] Run broad static verification:

```bash
git diff --check
pnpm type-check
pnpm eslint features/settlements app/api/projects/[projectId]/settlement-rules components/reference-ui/custom-settlement-rule-workspace.jsx components/reference-ui/custom-settlement-rule-api.js
pnpm build
```

- [ ] Reset/migrate a local Supabase instance and verify RLS with owner, operator, finance, and streamer accounts:

```bash
pnpm supabase:migrate
pnpm test:api-integration-smoke
```

- [ ] Start the app on an available port and test desktop plus narrow viewport:

```bash
pnpm dev
```

Verify ambiguous prompt -> one question -> confirmed Chinese contract -> deterministic validation -> historical/synthetic/user simulation -> natural-language revision. Confirm no Phase 1 UI or API can create/approve/activate a production rule.

- [ ] Verify the feature is absent when the flag is false and visible when true.

- [ ] Review the diff for accidental edits to shared conversation files or production settlement generation.

- [ ] Exit criteria:
  - parser/validator/engine never execute arbitrary code;
  - model sees metadata only;
  - all monetary runtime outputs are integer cents;
  - all simulations have freshness hashes;
  - new-project simulations do not fake historical totals;
  - feature flag defaults off;
  - existing fixed settlement generation is unchanged.

- [ ] Commit any verification-only fixes in their owning task commit; do not make a catch-all refactor commit.

## Phase 1 Handoff

Proceed to `docs/superpowers/plans/2026-07-11-ai-custom-settlement-phase-2-governance.md` only after every exit criterion passes. Phase 2 may rely on the compiled AST, contract hashes, data-readiness report, AI draft repository, and immutable simulation records created here.

## 2026-07-29 Task 10 Status Audit

- [x] Phase 1 implementation artifacts are present in the repository: feature flags, typed contracts, parser/validator, pure engine, explanations, variable catalog/readiness, repository, authoring service, system templates, route context, API routes, and reference UI workspace.
- [x] The public authoring flag remains default-off in `.env.example` with `NEXT_PUBLIC_AI_CUSTOM_SETTLEMENT_RULES_ENABLED=false`.
- [x] Focused verification passed on 2026-07-29: `pnpm test:custom-settlement` returned 47 files / 1096 tests passed, and the authoring/governance API route suite returned 21 files / 196 tests passed.
- [ ] Local Supabase reset, RLS role walkthrough, and browser acceptance were not performed in this Task 10 audit; they remain required before broad rollout.
