# AG2 Streamer Diagnosis Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing streamer diagnosis read-only tool in the shared `AgentOutput` contract while keeping `/api/ai/diagnosis` backward compatible.

**Architecture:** `runStreamerDiagnosisAgent` calls `runAiToolQuery("streamer_diagnosis")`, builds streamer-safe sourced facts from the tool result, derives numeric-free findings/caveats/recommendations, validates the output, and returns both the old `result` and new `agentOutput`. The route continues to authenticate through the existing Supabase/auth helpers and does not write business state.

**Tech Stack:** TypeScript, Vitest, Next.js route handlers, existing AI tool layer, existing AgentOutput validator.

---

### Task 1: Streamer Diagnosis Agent

**Files:**

- Create: `features/ai/streamer-diagnosis-agent.test.ts`
- Create: `features/ai/streamer-diagnosis-agent.ts`

- [ ] **Step 1: Write failing tests**

Create tests that assert:

```typescript
const result = await runStreamerDiagnosisAgent({
  client,
  actor: streamerActor,
  input: {
    report: {
      settlementDuration: 80,
      totalViews: 300,
      evidenceLevel: "yellow",
      grossMarginCents: 50000,
    },
    feedback: ["weak interaction"],
  },
});

expect(result.result.toolName).toBe("streamer_diagnosis");
expect(result.validation).toEqual({ valid: true, errors: [] });
expect(result.agentOutput.facts).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      statement: "Total views are 300",
      sourceTool: "streamer_diagnosis",
    }),
  ]),
);
expect(JSON.stringify(result.agentOutput)).not.toContain("grossMarginCents");
```

Also assert that no digits appear in findings/caveats/recommendations.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/streamer-diagnosis-agent.test.ts`
Expected: FAIL because `streamer-diagnosis-agent.ts` does not exist.

- [ ] **Step 3: Implement agent**

Implement `runStreamerDiagnosisAgent({ client, actor, input })` and helpers:

- `buildStreamerDiagnosisAgentOutput`
- `collectStreamerFacts`
- `source`
- `hasTrafficDropSignal`

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run features/ai/streamer-diagnosis-agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/streamer-diagnosis-agent.ts features/ai/streamer-diagnosis-agent.test.ts
git commit -m "feat: add AG2 streamer diagnosis agent"
```

### Task 2: Diagnosis Route Compatibility

**Files:**

- Modify: `app/api/ai/diagnosis/route.test.ts`
- Modify: `app/api/ai/diagnosis/route.ts`

- [ ] **Step 1: Write failing route test**

Update the existing successful route test to assert:

```typescript
expect(body.result.output.scriptSuggestions.length).toBeGreaterThan(0);
expect(body.agentOutput.facts.length).toBeGreaterThan(0);
expect(body.validation).toEqual({ valid: true, errors: [] });
expect(JSON.stringify(body)).not.toContain("grossMarginCents");
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/diagnosis/route.test.ts`
Expected: FAIL because the route still returns only `{ result }`.

- [ ] **Step 3: Update route**

Replace direct `runAiToolQuery` usage with `runStreamerDiagnosisAgent` and return:

```typescript
return NextResponse.json({
  result: agentResult.result,
  agentOutput: agentResult.agentOutput,
  validation: agentResult.validation,
});
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run app/api/ai/diagnosis/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai/diagnosis/route.ts app/api/ai/diagnosis/route.test.ts
git commit -m "feat: return AgentOutput from diagnosis API"
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

Run: `git push -u origin codex/ag2-streamer-diagnosis-agent`
Expected: remote branch created.

---

## Self-Review

- Spec coverage: route remains backward compatible, numeric claims are grounded in facts, sensitive economics stay out of output, and recommendations do not execute actions.
- Placeholder scan: No placeholders or unspecified implementation steps remain.
- Type consistency: Uses `runStreamerDiagnosisAgent`, `AgentOutput`, `AiToolResult`, and existing diagnosis route naming consistently.
