# AG2 Casting Advice Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only casting advice Agent and `/api/ai/briefs` route that turn existing streamer matching results into grounded AgentOutput.

**Architecture:** The Agent calls `rankStreamerCandidates`, builds candidate advice from the ranked matches, and validates the shared AgentOutput contract. The route mirrors existing MCN staff authorization and returns advice without writing database state.

**Tech Stack:** Next.js route handlers, Vitest, TypeScript, existing war-room matching engine, existing AgentOutput validator.

---

### Task 1: Agent RED Test

**Files:**

- Create: `features/ai/casting-advice-agent.test.ts`

- [ ] **Step 1: Write the failing Agent test**

```ts
import { describe, expect, it } from "vitest";

import { validateAgentOutput } from "./agent-output-contract";
import { runCastingAdviceAgent } from "./casting-advice-agent";
import type { AgentOutput } from "./contracts";

describe("runCastingAdviceAgent", () => {
  it("grounds casting advice in ranked matching facts", () => {
    const result = runCastingAdviceAgent(createInput());

    expect(result.matches[0]).toMatchObject({
      streamerId: "streamer-a",
      score: 93,
      suggestedSettlementMethod: "base_salary_cpt",
    });
    expect(result.candidateAdvice[0]).toMatchObject({
      streamerId: "streamer-a",
      rank: 1,
      recommendation: "invite",
    });
    expect(result.candidateAdvice).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          streamerId: "streamer-b",
          recommendation: "manual_review",
        }),
      ]),
    );
    expect(result.validation).toEqual({ valid: true, errors: [] });
    expect(result.agentOutput.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: "Ava match score is 93",
          sourceTool: "casting_advice",
          sourceId: "casting_advice:streamer-a:score",
        }),
        expect.objectContaining({
          statement: "Ava available minutes is 1200",
          sourceId: "casting_advice:streamer-a:availableMinutes",
        }),
      ]),
    );
    expectNoNumbersOutsideFacts(result.agentOutput);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run features/ai/casting-advice-agent.test.ts`

Expected: FAIL because `./casting-advice-agent` does not exist.

### Task 2: Agent GREEN

**Files:**

- Create: `features/ai/casting-advice-agent.ts`
- Modify: `features/ai/casting-advice-agent.test.ts`

- [ ] **Step 1: Implement `runCastingAdviceAgent`**

Implement the function with these exported types:

```ts
export type CastingAdviceInput = {
  project: MatchingProjectContext;
  candidates: StreamerCandidateSnapshot[];
  maxRecommendations?: number;
};

export type CandidateAdvice = {
  streamerId: string;
  streamerName: string;
  rank: number;
  suggestedSettlementMethod: StreamerMatchResult["suggestedSettlementMethod"];
  recommendation: "invite" | "backup" | "manual_review";
  reasons: string[];
  riskNotes: string[];
};
```

- [ ] **Step 2: Run GREEN**

Run: `pnpm vitest run features/ai/casting-advice-agent.test.ts`

Expected: PASS.

### Task 3: Briefs Route RED Test

**Files:**

- Create: `app/api/ai/briefs/route.test.ts`

- [ ] **Step 1: Write route tests**

Test that MCN staff receive `candidateAdvice`, streamers receive `403`, unauthenticated users receive `401`, and the mocked Supabase client has no `.from(...).insert(...)` calls.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run app/api/ai/briefs/route.test.ts`

Expected: FAIL because the route does not exist.

### Task 4: Briefs Route GREEN

**Files:**

- Create: `app/api/ai/briefs/route.ts`

- [ ] **Step 1: Implement `POST /api/ai/briefs`**

Use `createSupabaseServerClient`, `getAuthContext`, and `isMcnStaff`, then call `runCastingAdviceAgent`.

- [ ] **Step 2: Run route test**

Run: `pnpm vitest run app/api/ai/briefs/route.test.ts`

Expected: PASS.

### Task 5: Regression Verification

**Files:**

- No edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run features/ai/casting-advice-agent.test.ts
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

Expected: all pass. The known Next.js worktree root warning is acceptable if build succeeds.

### Task 6: Commit And Push

**Files:**

- All new AG-2 casting advice files.

- [ ] **Step 1: Commit docs and implementation**

Use separate commits for docs and feature work when possible.

- [ ] **Step 2: Push**

Run:

```bash
git push -u origin codex/ag2-casting-advice-agent
```

Expected: branch pushed.

## Self Review

- Spec coverage: Agent, API, RBAC, read-only behavior, numeric grounding, and validation are covered.
- Placeholder scan: no TBD/TODO/later placeholders remain.
- Type consistency: exported type names match the route and tests.
