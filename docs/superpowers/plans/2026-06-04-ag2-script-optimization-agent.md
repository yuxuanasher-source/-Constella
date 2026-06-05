# AG2 Script Optimization Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/api/ai/scripts` to create grounded AI script draft versions without publishing or mutating live work.

**Architecture:** `runScriptOptimizationAgent` builds a deterministic draft and `AgentOutput`; the route authenticates MCN staff, inserts a draft row into `ai_script_versions`, and returns the draft plus validation. The route never writes `published` status and never touches tasks or settlements.

**Tech Stack:** TypeScript, Vitest, Next.js route handlers, existing `AgentOutput` validator, Supabase-style insert client.

---

### Task 1: Script Optimization Agent

**Files:**

- Create: `features/ai/script-optimization-agent.test.ts`
- Create: `features/ai/script-optimization-agent.ts`

- [ ] **Step 1: Write failing tests**

Test `runScriptOptimizationAgent` with:

```typescript
const result = runScriptOptimizationAgent({
  scriptKey: "opening-hook",
  version: 1,
  currentScript: "Welcome to the stream.",
  diagnosisType: "traffic_drop",
  feedback: ["weak opening"],
  replayNotes: ["viewers left during intro"],
});

expect(result.scriptVersionDraft.status).toBe("draft");
expect(result.validation).toEqual({ valid: true, errors: [] });
expect(result.agentOutput.facts).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      statement: "Feedback item count is 1",
      sourceTool: "script_optimization",
    }),
  ]),
);
expect(JSON.stringify(result.agentOutput.recommendations)).not.toMatch(/\d/);
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/script-optimization-agent.test.ts`
Expected: FAIL because `script-optimization-agent.ts` does not exist.

- [ ] **Step 3: Implement agent**

Implement:

- `runScriptOptimizationAgent`
- `buildScriptDraftContent`
- `collectScriptFacts`
- `source`

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run features/ai/script-optimization-agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/script-optimization-agent.ts features/ai/script-optimization-agent.test.ts
git commit -m "feat: add AG2 script optimization agent"
```

### Task 2: Scripts API Route

**Files:**

- Create: `app/api/ai/scripts/route.test.ts`
- Create: `app/api/ai/scripts/route.ts`

- [ ] **Step 1: Write failing route tests**

Add tests proving:

- MCN staff receives `{ scriptVersionDraft, agentOutput, validation }`
- route inserts one `ai_script_versions` row with `status: "draft"`
- streamers receive 403
- unauthenticated requests receive 401

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/scripts/route.test.ts`
Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route**

Implement `POST /api/ai/scripts`:

- require Supabase client
- require auth
- require `isMcnStaff(auth.role)`
- call `runScriptOptimizationAgent`
- insert draft row into `ai_script_versions`
- return JSON

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run app/api/ai/scripts/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai/scripts/route.ts app/api/ai/scripts/route.test.ts
git commit -m "feat: expose script optimization API"
```

### Task 3: Regression Gate And Push

**Files:**

- No production files unless verification finds a scoped defect.

- [ ] **Step 1: Run AI system tests**

Run: `pnpm test:ai-system`
Expected: PASS.

- [ ] **Step 2: Run flywheel and golden regressions**

Run: `pnpm test:p4-flywheel`
Expected: PASS.

Run: `pnpm test:golden`
Expected: PASS.

- [ ] **Step 3: Run quality gate**

Run: `pnpm lint && pnpm type-check && pnpm test && pnpm build`
Expected: PASS.

- [ ] **Step 4: Push branch**

Run: `git push -u origin codex/ag2-script-optimization-agent`
Expected: remote branch created.

---

## Self-Review

- Spec coverage: deterministic draft generation, draft persistence, MCN-only route, no publish or task mutation.
- Placeholder scan: No placeholders remain.
- Type consistency: Uses `runScriptOptimizationAgent`, `scriptVersionDraft`, `AgentOutput`, and `ai_script_versions` consistently.
