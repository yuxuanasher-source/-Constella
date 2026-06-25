# AG2 M10 Copilot Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic `/api/ai/copilot` entrypoint that routes explicit M10 intents to existing grounded Agents and returns a unified read-only Copilot envelope.

**Architecture:** `runM10CopilotAgent` switches on `intent`, calls an existing Agent, normalizes the child result to `{ intent, copilotSummary, routedResult, agentOutput, validation }`, and does not mutate state. The route mirrors existing AI route auth and rejects non-MCN staff before calling the orchestrator.

**Tech Stack:** Next.js route handlers, Vitest, TypeScript, existing AI Agents, existing AgentOutput validator.

---

### Task 1: Copilot Agent RED Test

**Files:**

- Create: `features/ai/m10-copilot-agent.test.ts`

- [ ] **Step 1: Write the failing Agent test**

Add tests that call the desired `runM10CopilotAgent` API and assert:

- `pricing_tradeoff` returns a pricing routed result and `ready_for_review` summary.
- `casting_advice` returns candidate advice and preserves casting AgentOutput.
- `project_review` maps business analysis `output` to `agentOutput`.
- `script_optimization` returns a draft with `draft_not_persisted`.
- Unsupported intent throws.
- Numeric claims remain confined to child facts.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/m10-copilot-agent.test.ts`

Expected: FAIL because `./m10-copilot-agent` does not exist.

### Task 2: Copilot Agent GREEN

**Files:**

- Create: `features/ai/m10-copilot-agent.ts`

- [ ] **Step 1: Implement exported types and `runM10CopilotAgent`**

Implement:

```ts
export type M10CopilotIntent =
  | "pricing_tradeoff"
  | "casting_advice"
  | "project_review"
  | "script_optimization";

export type M10CopilotSummary = {
  intent: M10CopilotIntent;
  title: string;
  status: "ready_for_review" | "needs_review" | "blocked";
  nextStep: string;
  requiresHumanApproval: true;
  persistence: "read_only" | "draft_not_persisted";
};
```

- [ ] **Step 2: Run GREEN**

Run: `pnpm vitest run features/ai/m10-copilot-agent.test.ts`

Expected: PASS.

### Task 3: Copilot Route RED Test

**Files:**

- Create: `app/api/ai/copilot/route.test.ts`

- [ ] **Step 1: Write route tests**

Add tests that assert:

- MCN staff can run `pricing_tradeoff`.
- Streamers receive `403`.
- Unauthenticated users receive `401`.
- The route stays read-only and does not call `supabase.from`.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/copilot/route.test.ts`

Expected: FAIL because the route does not exist.

### Task 4: Copilot Route GREEN

**Files:**

- Create: `app/api/ai/copilot/route.ts`

- [ ] **Step 1: Implement route**

Use `createSupabaseServerClient`, `getAuthContext`, and `isMcnStaff`. Read the request body as `M10CopilotInput`, call `runM10CopilotAgent`, and return JSON.

- [ ] **Step 2: Run route test**

Run: `pnpm vitest run app/api/ai/copilot/route.test.ts`

Expected: PASS.

### Task 5: Regression Verification

**Files:**

- No edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run features/ai/m10-copilot-agent.test.ts
pnpm vitest run app/api/ai/copilot/route.test.ts
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

Expected: all pass. Run `pnpm type-check` after `pnpm build` if generated `.next/types` are rebuilt concurrently.

### Task 6: Commit And Push

**Files:**

- All AG-2 M10 Copilot files.

- [ ] **Step 1: Commit implementation**

Commit the plan separately from implementation when possible.

- [ ] **Step 2: Push**

Run:

```bash
git push -u origin codex/ag2-m10-copilot-agent
```

Expected: branch pushed.

## Self Review

- Spec coverage: Agent, route, auth, read-only behavior, child AgentOutput preservation, script draft non-persistence, and validation are covered.
- Marker scan: no open markers remain.
- Type consistency: exported type names match the route and tests.
