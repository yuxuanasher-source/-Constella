# AG1 Business Analysis Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first business analysis Agent that turns a war-room project review report into grounded `AgentOutput`.

**Architecture:** The Agent does not query raw databases and does not execute business actions. It reuses `buildProjectReviewReport` as the deterministic fact source, emits all numeric claims as `facts[]` with `sourceTool/sourceId`, keeps numeric-free conclusions in `findings[]`, puts unverified market context in `caveats[]`, and returns only human-approval recommendations. `/api/ai/project-reviews` exposes the Agent while `/api/war-room/*` remains rule-only.

**Tech Stack:** TypeScript, Vitest, Next.js route handlers, existing AI contracts, existing war-room project review report builder.

---

### Task 1: Numeric Grounding Guard

**Files:**

- Modify: `features/ai/agent-output-contract.test.ts`
- Modify: `features/ai/agent-output-contract.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving that numeric claims outside `facts[]` are rejected:

```typescript
it("rejects numeric claims in findings because numbers belong in sourced facts", () => {
  const result = validateAgentOutput({
    ...validOutput,
    findings: [
      {
        summary: "Margin is 4167 bps and should be protected",
        evidence: [
          { sourceTool: "project_review_summary", sourceId: "tool-1" },
        ],
      },
    ],
  });

  expect(result.valid).toBe(false);
  expect(result.errors).toContain(
    "findings[0] must not include unsourced numeric claims",
  );
});

it("rejects numeric claims in recommendations because recommendations only propose", () => {
  const result = validateAgentOutput({
    ...validOutput,
    recommendations: [
      {
        proposal: "Increase the next quote by 20%",
        requiresHumanApproval: true,
      },
    ],
  });

  expect(result.valid).toBe(false);
  expect(result.errors).toContain(
    "recommendations[0] must not include unsourced numeric claims",
  );
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/agent-output-contract.test.ts`
Expected: FAIL because the validator currently allows numbers in findings and recommendations.

- [ ] **Step 3: Implement guard**

Add a small numeric scanner in `validateAgentOutput` that rejects digits in `findings[].summary`, `caveats[].summary`, `recommendations[].proposal`, and `recommendations[].expectedImpact`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run features/ai/agent-output-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/agent-output-contract.ts features/ai/agent-output-contract.test.ts
git commit -m "feat: enforce numeric grounding in Agent outputs"
```

### Task 2: Business Analysis Agent Golden Cases

**Files:**

- Create: `features/ai/business-analysis-agent.test.ts`
- Create: `features/ai/business-analysis-agent.ts`

- [ ] **Step 1: Write failing tests**

Create S1-S4 golden tests:

- S1 profitable project recommends continuing.
- S2 low margin recommends pricing review or pause.
- S3 zero receivable stays finite and records caveats.
- S4 anomalies and disputes recommend risk replacement.

Each test must assert:

- `validation.valid === true`
- every fact has `sourceTool/sourceId`
- findings cite existing facts
- recommendations require human approval
- no digits appear outside `facts[]`

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/business-analysis-agent.test.ts`
Expected: FAIL because the Agent file does not exist.

- [ ] **Step 3: Implement Agent**

Implement `runBusinessAnalysisAgent(input: ProjectReviewInput)` to build a `ProjectReviewReport`, create `AgentOutput`, validate it, and return `{ report, output, validation }`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run features/ai/business-analysis-agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ai/business-analysis-agent.ts features/ai/business-analysis-agent.test.ts
git commit -m "feat: add AG1 business analysis agent"
```

### Task 3: Project Review Agent API

**Files:**

- Create: `app/api/ai/project-reviews/route.test.ts`
- Create: `app/api/ai/project-reviews/route.ts`

- [ ] **Step 1: Write failing tests**

Add route tests proving:

- authenticated MCN staff receives `{ report, agentOutput, validation }`
- streamers are blocked from internal economics
- unauthenticated users receive 401

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/project-reviews/route.test.ts`
Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route**

Implement `POST /api/ai/project-reviews` with the same auth style as `/api/war-room/project-review`, call `runBusinessAnalysisAgent`, and return JSON without mutating business state.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run app/api/ai/project-reviews/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ai/project-reviews/route.ts app/api/ai/project-reviews/route.test.ts
git commit -m "feat: expose AG1 project review API"
```

### Task 4: Regression Gate

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

---

## Self-Review

- Spec coverage: AG-1 outputs `facts`, `findings`, `caveats`, and `recommendations`; every number is forced into sourced facts; recommendations do not execute actions; `/api/war-room/*` remains unchanged.
- Placeholder scan: No task says to fill details later.
- Type consistency: Uses existing `AgentOutput`, `ProjectReviewInput`, `ProjectReviewReport`, and route auth patterns.
