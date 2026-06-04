# AG2 Pricing Tradeoff Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only pricing tradeoff Agent and route dispatch so `/api/ai/briefs` can return grounded pricing advice with `kind: "pricing"`.

**Architecture:** `runPricingTradeoffAgent` wraps the existing `calculateProjectPricing` function, classifies the resulting risk notes, and validates a shared AgentOutput. `/api/ai/briefs` remains the AI brief entrypoint and dispatches between casting and pricing briefs by `kind`, with unchanged MCN staff authorization.

**Tech Stack:** Next.js route handlers, Vitest, TypeScript, existing war-room pricing calculator, existing AgentOutput validator.

---

### Task 1: Pricing Agent RED Test

**Files:**
- Create: `features/ai/pricing-tradeoff-agent.test.ts`

- [ ] **Step 1: Write the failing Agent test**

Add tests that call the desired `runPricingTradeoffAgent` API and assert:

- Healthy CPT pricing returns `approve_review` and `low` risk.
- Low margin returns `raise_quote_review`.
- Negative margin returns `pause_commitment`.
- Numeric claims appear only in `facts`.
- Recommendations require human approval and have no executable fields.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/pricing-tradeoff-agent.test.ts`

Expected: FAIL because `./pricing-tradeoff-agent` does not exist.

### Task 2: Pricing Agent GREEN

**Files:**
- Create: `features/ai/pricing-tradeoff-agent.ts`

- [ ] **Step 1: Implement exported types and function**

Implement:

```ts
export type PricingTradeoffInput = ProjectPricingInput;

export type PricingTradeoffAdvice = {
  decision: "approve_review" | "raise_quote_review" | "pause_commitment";
  riskLevel: "low" | "medium" | "high";
  recommendedSettlementMethod: PricingSettlementMethod;
  riskNotes: string[];
  reviewChecklist: string[];
};

export type PricingTradeoffAgentResult = {
  pricing: ProjectPricingResult;
  tradeoffAdvice: PricingTradeoffAdvice;
  agentOutput: AgentOutput;
  validation: ReturnType<typeof validateAgentOutput>;
};
```

- [ ] **Step 2: Run GREEN**

Run: `pnpm vitest run features/ai/pricing-tradeoff-agent.test.ts`

Expected: PASS.

### Task 3: Briefs Route Dispatch RED Test

**Files:**
- Modify: `app/api/ai/briefs/route.test.ts`

- [ ] **Step 1: Add route tests**

Add tests that assert:

- `kind: "pricing"` returns `pricing`, `tradeoffAdvice`, `agentOutput`, and valid validation.
- Omitted `kind` still returns the existing casting `candidateAdvice`.
- Streamers remain blocked.
- The route stays read-only and does not call `supabase.from`.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/briefs/route.test.ts`

Expected: FAIL because the route ignores `kind: "pricing"` and still treats the body as casting input.

### Task 4: Briefs Route Dispatch GREEN

**Files:**
- Modify: `app/api/ai/briefs/route.ts`

- [ ] **Step 1: Implement dispatch**

Read the request body once. If `body.kind === "pricing"`, call `runPricingTradeoffAgent(body)`. Otherwise, call `runCastingAdviceAgent` exactly as before.

- [ ] **Step 2: Run route test**

Run: `pnpm vitest run app/api/ai/briefs/route.test.ts`

Expected: PASS.

### Task 5: Regression Verification

**Files:**
- No edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run features/ai/pricing-tradeoff-agent.test.ts
pnpm vitest run app/api/ai/briefs/route.test.ts
```

- [ ] **Step 2: Run staged suites**

Run:

```bash
pnpm test:ai-system
pnpm test:p4-flywheel
pnpm test:golden
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Expected: all pass. Run `pnpm type-check` after `pnpm build` if parallel execution races on generated `.next/types`.

### Task 6: Commit And Push

**Files:**
- All AG-2 pricing tradeoff files.

- [ ] **Step 1: Commit implementation**

Commit the plan separately from implementation when possible.

- [ ] **Step 2: Push**

Run:

```bash
git push -u origin codex/ag2-pricing-tradeoff-agent
```

Expected: branch pushed.

## Self Review

- Spec coverage: Agent, route dispatch, compatibility, RBAC, read-only behavior, numeric grounding, and validation are covered.
- Marker scan: no open markers remain.
- Type consistency: exported type names match the route and tests.
