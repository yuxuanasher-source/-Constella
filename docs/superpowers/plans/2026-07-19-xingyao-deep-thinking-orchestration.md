# Xingyao Deep Thinking Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Xingyao chat deep mode into a 60-second, read-only, evidence-first adaptive reasoning orchestration with stage progress.

**Architecture:** Keep `executeDashboardAiChat` as the public entry and preserve fast mode. Add a focused `features/ai/deep-thinking/` module for contracts, evidence shaping, budget control, validation, and orchestration; wire deep mode through it only when `AI_DEEP_ORCHESTRATION_ENABLED` is enabled.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Zod, existing AI provider gateway, existing web search provider, existing conversation SSE protocol, React dashboard UI.

---

## Scope Check

The approved spec targets one subsystem: Xingyao dashboard chat deep mode. It touches backend AI orchestration, conversation SSE, and the existing assistant panel because all three are required for one working feature. Fast mode remains unchanged and is tested as a non-regression.

## File Structure

- Create `features/ai/deep-thinking/contracts.ts`: shared stage, evidence, plan, assessment, draft, review, final answer, metadata, and Zod schemas.
- Create `features/ai/deep-thinking/budget.ts`: 52-second orchestration deadline and stage budget slicing.
- Create `features/ai/deep-thinking/evidence.ts`: converts existing grounding, knowledge, and attachments into normalized evidence items.
- Create `features/ai/deep-thinking/search-safety.ts`: web trigger classification, safe query sanitization, result truncation.
- Create `features/ai/deep-thinking/validator.ts`: citation existence, numeric traceability, read-only wording, and final Markdown rendering.
- Create `features/ai/deep-thinking/prompts.ts`: stage prompts with no hidden chain-of-thought request.
- Create `features/ai/deep-thinking/orchestrator.ts`: stage orchestration, model calls, web search, degradation, invocation ledger, and final result.
- Create `features/ai/deep-thinking/*.test.ts`: deterministic unit tests for the above.
- Modify `features/ai/conversation-contracts.ts`: add `reasoning.stage` SSE event and optional frozen `deepContext`.
- Modify `features/ai/conversation-contracts.test.ts`: validate stage event contract and malformed rejection.
- Modify `features/ai/conversation-service.ts`: validate optional `deepContext` and allow the frozen gateway snapshot to be refreshed while a deep turn is generating.
- Modify `features/ai/conversation-service.test.ts`: prove final `deepContext` survives frozen retry snapshots and unsafe deep context is rejected.
- Modify `features/ai/conversation-stream-adapter.ts`: pass stage callback into legacy chat and emit typed conversation stage events.
- Modify `features/ai/conversation-stream-adapter.test.ts`: assert stage event ordering and persistence order remains terminal-safe.
- Modify `app/api/ai/chat/route.ts`: feature flag, web provider, deep orchestrator branch, stage callback, final metadata, fallback to current single-model deep.
- Modify `app/api/ai/chat/route.test.ts`: deep orchestration enabled/disabled, streaming stage events, no web when internal evidence is enough, safe web when needed.
- Modify `components/dashboard/overview-board.jsx`: consume `reasoning.stage`, show compact deep progress on the assistant bubble, collapse after completion.
- Modify `components/dashboard/overview-board.test.jsx`: verify deep progress appears, does not appear in fast mode, and history restores completed metadata.

## Task 1: Deep Contracts And Conversation Protocol

**Files:**
- Create: `features/ai/deep-thinking/contracts.ts`
- Modify: `features/ai/conversation-contracts.ts`
- Modify: `features/ai/conversation-service.ts`
- Test: `features/ai/conversation-contracts.test.ts`
- Test: `features/ai/conversation-service.test.ts`

- [ ] **Step 1: Write the failing protocol contract tests**

Add these cases to `features/ai/conversation-contracts.test.ts`:

```ts
it("recognizes deep reasoning stage stream events", () => {
  const event: ConversationStreamEvent = {
    type: "reasoning.stage",
    conversationId: "conversation-1",
    turnId: "turn-1",
    stage: "planning",
    status: "started",
    elapsedMs: 0,
  };

  expect(isConversationStreamEvent(event)).toBe(true);
  expect(
    isConversationStreamEvent({
      ...event,
      stage: "hidden_chain_of_thought",
    }),
  ).toBe(false);
  expect(
    isConversationStreamEvent({
      ...event,
      status: "thinking_text",
    }),
  ).toBe(false);
});

it("allows frozen gateway context to carry sanitized deep context", () => {
  const context = {
    messages: [{ role: "user", content: "分析风险" }],
    attachments: [],
    mode: "deep",
    primaryProvider: "deepseek",
    lastUserMessage: "分析风险",
    responseMetadata: {
      grounding: {},
      knowledge: {},
      retrospectiveDraft: null,
    },
    invocationMetadata: {},
    deepContext: {
      plan: {
        objective: "分析风险",
        subquestions: ["当前风险是什么"],
        requiredEvidence: ["经营事实"],
      },
      evidence: [
        {
          id: "D1",
          sourceType: "business_data",
          statement: "高风险项目 1 个",
          sourceId: "dashboard.risks.highRisk",
        },
      ],
      webResults: [],
      gaps: [],
      contradictions: [],
      stages: [
        {
          stage: "planning",
          status: "completed",
          elapsedMs: 12,
        },
      ],
      review: {
        verdict: "pass",
        unsupportedClaims: [],
        contradictions: [],
        missingEvidence: [],
      },
    },
  };

  expect(isConversationStreamEvent({
    type: "heartbeat",
    conversationId: "conversation-1",
    turnId: "turn-1",
  })).toBe(true);
  expect(context.deepContext.evidence[0].statement).not.toContain("思维链");
});
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run:

```bash
pnpm vitest run features/ai/conversation-contracts.test.ts
```

Expected: FAIL because `reasoning.stage` and `DeepThinkingContext` are not defined in the stream contract yet.

- [ ] **Step 3: Add deep-thinking shared contracts**

Create `features/ai/deep-thinking/contracts.ts`:

```ts
import { z } from "zod";

export const deepThinkingStages = [
  "planning",
  "internal_retrieval",
  "evidence_check",
  "web_retrieval",
  "drafting",
  "reviewing",
  "finalizing",
  "validating",
] as const;

export const deepThinkingStageStatuses = [
  "started",
  "completed",
  "skipped",
  "degraded",
] as const;

export type DeepThinkingStage = (typeof deepThinkingStages)[number];
export type DeepThinkingStageStatus =
  (typeof deepThinkingStageStatuses)[number];

export const evidenceSourceTypes = [
  "business_data",
  "knowledge_base",
  "attachment",
  "web",
] as const;

export type EvidenceSourceType = (typeof evidenceSourceTypes)[number];

export const deepPlanSchema = z.object({
  objective: z.string().trim().min(1),
  subquestions: z.array(z.string().trim().min(1)).min(1).max(8),
  requiredEvidence: z.array(z.string().trim().min(1)).min(1).max(12),
});
export type DeepPlan = z.infer<typeof deepPlanSchema>;

export const evidenceItemSchema = z.object({
  id: z.string().trim().min(1).max(24),
  sourceType: z.enum(evidenceSourceTypes),
  statement: z.string().trim().min(1).max(1_000),
  sourceId: z.string().trim().min(1).max(240),
  url: z.string().url().optional(),
  observedAt: z.string().datetime().optional(),
  title: z.string().trim().max(160).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidenceAssessmentSchema = z.object({
  coveredRequirements: z.array(z.string().trim().min(1)).max(12),
  missingRequirements: z.array(z.string().trim().min(1)).max(12),
  contradictions: z.array(z.string().trim().min(1)).max(12),
  needsWebSearch: z.boolean(),
  safeSearchQueries: z.array(z.string().trim().min(1).max(120)).max(2),
});
export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;

export const deepDraftClaimSchema = z.object({
  text: z.string().trim().min(1).max(700),
  evidenceRefs: z.array(z.string().trim().min(1).max(24)).min(1).max(6),
});
export type DeepDraftClaim = z.infer<typeof deepDraftClaimSchema>;

export const deepDraftSchema = z.object({
  conclusion: z.array(deepDraftClaimSchema).min(1).max(4),
  keyEvidence: z.array(deepDraftClaimSchema).min(1).max(8),
  uncertainties: z.array(z.string().trim().min(1).max(400)).max(6),
  risks: z.array(deepDraftClaimSchema).max(6),
  suggestions: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        evidenceRefs: z.array(z.string().trim().min(1).max(24)).max(6),
        requiresHumanApproval: z.literal(true),
      }),
    )
    .max(6),
});
export type DeepDraft = z.infer<typeof deepDraftSchema>;

export const deepReviewSchema = z.object({
  verdict: z.enum(["pass", "revise", "insufficient"]),
  unsupportedClaims: z.array(z.string().trim().min(1).max(400)).max(12),
  contradictions: z.array(z.string().trim().min(1).max(400)).max(12),
  missingEvidence: z.array(z.string().trim().min(1).max(400)).max(12),
});
export type DeepReview = z.infer<typeof deepReviewSchema>;

export const deepStageRecordSchema = z.object({
  stage: z.enum(deepThinkingStages),
  status: z.enum(deepThinkingStageStatuses),
  elapsedMs: z.number().int().nonnegative(),
  reason: z.string().trim().max(160).optional(),
});
export type DeepStageRecord = z.infer<typeof deepStageRecordSchema>;

export const deepThinkingMetaSchema = z.object({
  status: z.enum(["completed", "degraded"]),
  webSearchUsed: z.boolean(),
  reviewVerdict: z.enum(["pass", "revised", "insufficient"]),
  evidence: z.array(evidenceItemSchema).max(80),
  completedStages: z.array(z.enum(deepThinkingStages)).max(8),
  skippedStages: z.array(z.enum(deepThinkingStages)).max(8),
  elapsedMs: z.number().int().nonnegative(),
  citationRejectCount: z.number().int().nonnegative().default(0),
});
export type DeepThinkingMeta = z.infer<typeof deepThinkingMetaSchema>;

export const deepThinkingContextSchema = z.object({
  plan: deepPlanSchema.optional(),
  evidence: z.array(evidenceItemSchema).max(80).default([]),
  webResults: z.array(evidenceItemSchema).max(6).default([]),
  gaps: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
  contradictions: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
  stages: z.array(deepStageRecordSchema).max(24).default([]),
  review: deepReviewSchema.optional(),
});
export type DeepThinkingContext = z.infer<typeof deepThinkingContextSchema>;

export type ReasoningStagePayload = {
  stage: DeepThinkingStage;
  status: DeepThinkingStageStatus;
  elapsedMs: number;
};
```

- [ ] **Step 4: Extend the conversation stream contract**

Modify `features/ai/conversation-contracts.ts`:

```ts
import type {
  DeepThinkingContext,
  DeepThinkingStage,
  DeepThinkingStageStatus,
} from "./deep-thinking/contracts";
import {
  deepThinkingContextSchema,
  deepThinkingStages,
  deepThinkingStageStatuses,
} from "./deep-thinking/contracts";
```

Add `deepContext` to `ConversationGatewayContext`:

```ts
export type ConversationGatewayContext = {
  messages: AiMessage[];
  attachments: AiAttachment[];
  mode: AiChatMode;
  primaryProvider: AiProviderName;
  lastUserMessage: string;
  responseMetadata: {
    grounding: Record<string, unknown>;
    knowledge: Record<string, unknown>;
    retrospectiveDraft: unknown;
  };
  invocationMetadata: Record<string, unknown>;
  deepContext?: DeepThinkingContext;
};
```

Add the stream event union member:

```ts
  | {
      type: "reasoning.stage";
      conversationId: string;
      turnId: string;
      stage: DeepThinkingStage;
      status: DeepThinkingStageStatus;
      elapsedMs: number;
    }
```

Add this switch branch in `isConversationStreamEvent`:

```ts
    case "reasoning.stage":
      return (
        deepThinkingStages.includes(value.stage as DeepThinkingStage) &&
        deepThinkingStageStatuses.includes(
          value.status as DeepThinkingStageStatus,
        ) &&
        typeof value.elapsedMs === "number" &&
        Number.isInteger(value.elapsedMs) &&
        value.elapsedMs >= 0
      );
```

Modify `features/ai/conversation-service.ts` to validate optional frozen deep context:

```ts
function isDeepThinkingContext(value: unknown): value is DeepThinkingContext {
  return deepThinkingContextSchema.safeParse(value).success;
}
```

Then extend `isConversationGatewayContext`:

```ts
    isRecord(value.invocationMetadata) &&
    (value.deepContext === undefined || isDeepThinkingContext(value.deepContext))
```

Update `captureGatewayContext` so the initial capture still works in `grounding`, and a second capture can refresh `gatewayContext.deepContext` while the turn is `generating`:

```ts
      const captured =
        (await persistence.transitionTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          turnId,
          from: "grounding",
          to: "grounding",
          patch: {
            contextSnapshot: persistedSnapshot,
            contextHash: hashConversationSnapshot(persistedSnapshot),
          },
        })) ||
        (await persistence.transitionTurn({
          organizationId: actor.organizationId,
          ownerUserId: actor.userId,
          turnId,
          from: "generating",
          to: "generating",
          patch: {
            contextSnapshot: persistedSnapshot,
            contextHash: hashConversationSnapshot(persistedSnapshot),
          },
        }));
```

Add a service test that captures a second snapshot with `deepContext` while the first transition is already past grounding:

```ts
it("refreshes a generating turn snapshot with sanitized deep context", async () => {
  const store = persistence({
    transitionTurn: vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true),
  });
  const service = createConversationService(store);
  const snapshot = frozenSnapshot(trustedGatewayContext());
  const captured = await service.captureGatewayContext(
    actor,
    "turn-1",
    snapshot,
    {
      ...trustedGatewayContext(),
      deepContext: {
        evidence: [
          {
            id: "D1",
            sourceType: "business_data",
            statement: "高风险项目 1 个",
            sourceId: "dashboard.risks.highRisk",
          },
        ],
        webResults: [],
        gaps: [],
        contradictions: [],
        stages: [
          { stage: "planning", status: "completed", elapsedMs: 10 },
        ],
      },
    },
  );

  expect(captured.gatewayContext?.deepContext?.evidence[0].id).toBe("D1");
  expect(store.transitionTurn).toHaveBeenLastCalledWith(
    expect.objectContaining({ from: "generating", to: "generating" }),
  );
});
```

- [ ] **Step 5: Run the contract test and confirm it passes**

Run:

```bash
pnpm vitest run features/ai/conversation-contracts.test.ts features/ai/conversation-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

Run:

```bash
git add features/ai/deep-thinking/contracts.ts features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts
git commit -m "feat(ai): add deep thinking stream contracts"
```

## Task 2: Budget, Evidence, Search Safety, And Final Validation

**Files:**
- Create: `features/ai/deep-thinking/budget.ts`
- Create: `features/ai/deep-thinking/evidence.ts`
- Create: `features/ai/deep-thinking/search-safety.ts`
- Create: `features/ai/deep-thinking/validator.ts`
- Test: `features/ai/deep-thinking/budget.test.ts`
- Test: `features/ai/deep-thinking/evidence.test.ts`
- Test: `features/ai/deep-thinking/search-safety.test.ts`
- Test: `features/ai/deep-thinking/validator.test.ts`

- [ ] **Step 1: Write failing budget tests**

Create `features/ai/deep-thinking/budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createDeepThinkingBudget,
  remainingStageBudgetMs,
  shouldSkipOptionalStage,
} from "./budget";

describe("deep thinking budget", () => {
  it("uses a 52 second orchestration deadline inside the 60 second route limit", () => {
    const budget = createDeepThinkingBudget({ nowMs: () => 1_000 });

    expect(budget.startedAtMs).toBe(1_000);
    expect(budget.deadlineMs).toBe(53_000);
    expect(remainingStageBudgetMs(budget, "planning")).toBe(6_000);
  });

  it("clips stage budget by remaining total time", () => {
    const budget = createDeepThinkingBudget({ nowMs: () => 1_000 });
    const lateBudget = { ...budget, nowMs: () => 51_500 };

    expect(remainingStageBudgetMs(lateBudget, "drafting")).toBe(1_500);
  });

  it("skips optional web retrieval when less than 2 seconds remain", () => {
    const budget = createDeepThinkingBudget({ nowMs: () => 1_000 });
    const lateBudget = { ...budget, nowMs: () => 52_000 };

    expect(shouldSkipOptionalStage(lateBudget, "web_retrieval")).toBe(true);
    expect(shouldSkipOptionalStage(budget, "validating")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement budget utilities**

Create `features/ai/deep-thinking/budget.ts`:

```ts
import type { DeepThinkingStage } from "./contracts";

export const DEEP_THINKING_TOTAL_BUDGET_MS = 52_000;

const STAGE_BUDGET_MS: Record<DeepThinkingStage, number> = {
  planning: 6_000,
  internal_retrieval: 10_000,
  evidence_check: 3_000,
  web_retrieval: 8_000,
  drafting: 10_000,
  reviewing: 7_000,
  finalizing: 5_000,
  validating: 3_000,
};

export type DeepThinkingBudget = {
  startedAtMs: number;
  deadlineMs: number;
  nowMs: () => number;
};

export function createDeepThinkingBudget({
  nowMs = Date.now,
}: {
  nowMs?: () => number;
} = {}): DeepThinkingBudget {
  const startedAtMs = nowMs();
  return {
    startedAtMs,
    deadlineMs: startedAtMs + DEEP_THINKING_TOTAL_BUDGET_MS,
    nowMs,
  };
}

export function remainingTotalBudgetMs(budget: DeepThinkingBudget): number {
  return Math.max(0, budget.deadlineMs - budget.nowMs());
}

export function remainingStageBudgetMs(
  budget: DeepThinkingBudget,
  stage: DeepThinkingStage,
): number {
  return Math.min(STAGE_BUDGET_MS[stage], remainingTotalBudgetMs(budget));
}

export function shouldSkipOptionalStage(
  budget: DeepThinkingBudget,
  stage: DeepThinkingStage,
): boolean {
  if (stage !== "web_retrieval") {
    return false;
  }
  return remainingTotalBudgetMs(budget) < 2_000;
}
```

- [ ] **Step 3: Write failing evidence and search-safety tests**

Create `features/ai/deep-thinking/evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildInternalEvidence } from "./evidence";

describe("deep thinking evidence", () => {
  it("normalizes grounding, knowledge, and attachments with stable prefixes", () => {
    const evidence = buildInternalEvidence({
      grounding: {
        facts: [
          { label: "高风险项目", value: "1 个", source: "dashboard.risks.highRisk" },
        ],
      },
      knowledge: {
        passages: [
          {
            id: "kb-1",
            title: "低转化复盘",
            snippet: "开场福利节点不清晰会造成互动断层",
            sourceRef: "knowledge.retrospective:low-conversion",
          },
        ],
      },
      attachments: [
        { name: "brief.txt", mimeType: "text/plain", text: "预算口径以系统为准" },
      ],
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        id: "D1",
        sourceType: "business_data",
        statement: "高风险项目：1 个",
        sourceId: "dashboard.risks.highRisk",
      }),
      expect.objectContaining({
        id: "K1",
        sourceType: "knowledge_base",
        sourceId: "knowledge.retrospective:low-conversion",
      }),
      expect.objectContaining({
        id: "A1",
        sourceType: "attachment",
        statement: expect.stringContaining("brief.txt"),
      }),
    ]);
  });
});
```

Create `features/ai/deep-thinking/search-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { sanitizeSearchQuery, shouldUseWebSearch } from "./search-safety";

describe("deep thinking search safety", () => {
  it("does not use web search when internal evidence covers the question", () => {
    expect(
      shouldUseWebSearch({
        missingRequirements: [],
        requestedQuestion: "分析本月经营风险",
      }),
    ).toBe(false);
  });

  it("uses web search for current external platform policy gaps", () => {
    expect(
      shouldUseWebSearch({
        missingRequirements: ["当前抖音直播规则"],
        requestedQuestion: "结合最新平台规则判断风险",
      }),
    ).toBe(true);
  });

  it("removes sensitive names, internal ids, and money from search queries", () => {
    expect(
      sanitizeSearchQuery(
        "主播张三 项目 9f1b6b89-1111-4222-8333-123456789abc 抖音 预算 30000 元 最新规则",
      ),
    ).toBe("抖音 最新规则");
  });
});
```

- [ ] **Step 4: Implement evidence and search-safety utilities**

Create `features/ai/deep-thinking/evidence.ts`:

```ts
import type { AiAttachment } from "../contracts";
import type { EvidenceItem } from "./contracts";

type GroundingFact = {
  label?: unknown;
  value?: unknown;
  source?: unknown;
};

type KnowledgePassageLike = {
  id?: unknown;
  title?: unknown;
  snippet?: unknown;
  sourceRef?: unknown;
};

export function buildInternalEvidence({
  grounding,
  knowledge,
  attachments,
}: {
  grounding: Record<string, unknown>;
  knowledge: Record<string, unknown>;
  attachments: AiAttachment[];
}): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  let businessIndex = 1;
  for (const fact of arrayValue<GroundingFact>(grounding.facts)) {
    const label = stringValue(fact.label);
    const value = stringValue(fact.value);
    const source = stringValue(fact.source);
    if (!label || !source) continue;
    evidence.push({
      id: `D${businessIndex++}`,
      sourceType: "business_data",
      statement: value ? `${label}：${value}` : label,
      sourceId: source,
    });
  }

  let knowledgeIndex = 1;
  for (const passage of arrayValue<KnowledgePassageLike>(knowledge.passages)) {
    const sourceRef = stringValue(passage.sourceRef) || stringValue(passage.id);
    const title = stringValue(passage.title);
    const snippet = stringValue(passage.snippet);
    if (!sourceRef || !snippet) continue;
    evidence.push({
      id: `K${knowledgeIndex++}`,
      sourceType: "knowledge_base",
      statement: [title, snippet].filter(Boolean).join("：").slice(0, 1_000),
      sourceId: sourceRef,
      ...(title ? { title } : {}),
    });
  }

  let attachmentIndex = 1;
  for (const attachment of attachments) {
    const preview = stringValue(attachment.text).slice(0, 700);
    if (!preview) continue;
    evidence.push({
      id: `A${attachmentIndex++}`,
      sourceType: "attachment",
      statement: `${attachment.name}：${preview}`.slice(0, 1_000),
      sourceId: `attachment:${attachment.name}`,
    });
  }

  return evidence.slice(0, 80);
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
```

Create `features/ai/deep-thinking/search-safety.ts`:

```ts
import type { WebSearchResult } from "../web-search-provider";
import type { EvidenceItem } from "./contracts";

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const MONEY_PATTERN = /\b\d+(?:\.\d+)?\s*(?:元|块|万|万元|¥|RMB|CNY)\b/gi;
const SENSITIVE_PREFIX_PATTERN =
  /(主播|成员|员工|达人|账号|项目|预算|成本|报价|结算|回款)\s*[\p{L}\p{N}_-]+/giu;
const CURRENT_EXTERNAL_PATTERN =
  /(最新|当前|今年|政策|规则|平台|竞品|市场|行业|趋势|政策|抖音|快手|小红书|B站|视频号)/u;

export function shouldUseWebSearch({
  missingRequirements,
  requestedQuestion,
}: {
  missingRequirements: string[];
  requestedQuestion: string;
}): boolean {
  const text = `${requestedQuestion}\n${missingRequirements.join("\n")}`;
  return missingRequirements.length > 0 && CURRENT_EXTERNAL_PATTERN.test(text);
}

export function sanitizeSearchQuery(query: string): string {
  return query
    .replace(UUID_PATTERN, " ")
    .replace(MONEY_PATTERN, " ")
    .replace(SENSITIVE_PREFIX_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function normalizeWebResults(
  results: WebSearchResult[],
  startIndex: number,
): EvidenceItem[] {
  return results.slice(0, 3).flatMap((result, index) => {
    const title = result.title.trim().slice(0, 160);
    const url = result.url.trim();
    const content = result.content.replace(/\s+/g, " ").trim().slice(0, 700);
    if (!title || !url || !content) return [];
    return [
      {
        id: `W${startIndex + index}`,
        sourceType: "web" as const,
        statement: `${title}：${content}`.slice(0, 1_000),
        sourceId: url,
        url,
        title,
        ...(result.publishedAt ? { observedAt: result.publishedAt } : {}),
      },
    ];
  });
}
```

- [ ] **Step 5: Write failing validator tests**

Create `features/ai/deep-thinking/validator.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { renderFinalAnswer, validateDeepDraft } from "./validator";

const evidence = [
  {
    id: "D1",
    sourceType: "business_data" as const,
    statement: "高风险项目：1 个",
    sourceId: "dashboard.risks.highRisk",
  },
];

describe("deep thinking validator", () => {
  it("rejects claims with missing evidence refs", () => {
    const result = validateDeepDraft({
      evidence,
      draft: {
        conclusion: [{ text: "高风险项目 1 个", evidenceRefs: ["D9"] }],
        keyEvidence: [],
        uncertainties: [],
        risks: [],
        suggestions: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("missing evidence ref D9");
  });

  it("rejects unsourced numeric claims", () => {
    const result = validateDeepDraft({
      evidence,
      draft: {
        conclusion: [{ text: "高风险项目 2 个", evidenceRefs: ["D1"] }],
        keyEvidence: [],
        uncertainties: [],
        risks: [],
        suggestions: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("unsourced numeric claim");
  });

  it("renders stable final Chinese sections with citations", () => {
    const markdown = renderFinalAnswer({
      draft: {
        conclusion: [{ text: "高风险项目 1 个", evidenceRefs: ["D1"] }],
        keyEvidence: [{ text: "系统风险队列显示高风险项目 1 个", evidenceRefs: ["D1"] }],
        uncertainties: ["缺少外部平台最新规则"],
        risks: [{ text: "优先处理高风险项目", evidenceRefs: ["D1"] }],
        suggestions: [
          {
            text: "建议人工复核高风险项目并确认处理顺序",
            evidenceRefs: ["D1"],
            requiresHumanApproval: true,
          },
        ],
      },
      evidence,
    });

    expect(markdown).toContain("**结论**");
    expect(markdown).toContain("[D1]");
    expect(markdown).toContain("人工确认");
  });
});
```

- [ ] **Step 6: Implement final validation and rendering**

Create `features/ai/deep-thinking/validator.ts`:

```ts
import { collectNumberTokens, hasUnsourcedNumber } from "../agent-output-contract";
import type { DeepDraft, EvidenceItem } from "./contracts";

export type DeepDraftValidation =
  | { ok: true; citationRejectCount: number }
  | { ok: false; errors: string[]; citationRejectCount: number };

export function validateDeepDraft({
  draft,
  evidence,
}: {
  draft: DeepDraft;
  evidence: EvidenceItem[];
}): DeepDraftValidation {
  const errors: string[] = [];
  let citationRejectCount = 0;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  const validateClaim = (text: string, refs: string[], path: string) => {
    if (!refs.length) {
      errors.push(`${path} must include evidence refs`);
      citationRejectCount += 1;
      return;
    }
    const citedStatements: string[] = [];
    for (const ref of refs) {
      const item = evidenceById.get(ref);
      if (!item) {
        errors.push(`${path} missing evidence ref ${ref}`);
        citationRejectCount += 1;
        continue;
      }
      citedStatements.push(item.statement);
    }
    if (hasUnsourcedNumber(text, collectNumberTokens(citedStatements))) {
      errors.push(`${path} contains unsourced numeric claim`);
      citationRejectCount += 1;
    }
  };

  draft.conclusion.forEach((claim, index) =>
    validateClaim(claim.text, claim.evidenceRefs, `conclusion[${index}]`),
  );
  draft.keyEvidence.forEach((claim, index) =>
    validateClaim(claim.text, claim.evidenceRefs, `keyEvidence[${index}]`),
  );
  draft.risks.forEach((claim, index) =>
    validateClaim(claim.text, claim.evidenceRefs, `risks[${index}]`),
  );
  draft.suggestions.forEach((suggestion, index) => {
    if (suggestion.requiresHumanApproval !== true) {
      errors.push(`suggestions[${index}] must require human approval`);
    }
    if (/(自动执行|直接执行|已为你创建|已修改|已发布)/.test(suggestion.text)) {
      errors.push(`suggestions[${index}] must remain read-only`);
    }
    if (
      suggestion.evidenceRefs.length &&
      hasUnsourcedNumber(
        suggestion.text,
        collectNumberTokens(
          suggestion.evidenceRefs
            .map((ref) => evidenceById.get(ref)?.statement ?? "")
            .filter(Boolean),
        ),
      )
    ) {
      errors.push(`suggestions[${index}] contains unsourced numeric claim`);
      citationRejectCount += 1;
    }
  });

  return errors.length
    ? { ok: false, errors, citationRejectCount }
    : { ok: true, citationRejectCount };
}

export function renderFinalAnswer({
  draft,
  evidence,
}: {
  draft: DeepDraft;
  evidence: EvidenceItem[];
}): string {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const cite = (refs: string[]) =>
    refs.filter((ref) => evidenceById.has(ref)).map((ref) => `[${ref}]`).join(" ");
  const claims = (items: Array<{ text: string; evidenceRefs: string[] }>) =>
    items.map((item) => `- ${item.text} ${cite(item.evidenceRefs)}`.trim());

  return [
    "**结论**",
    ...claims(draft.conclusion),
    "",
    "**关键证据**",
    ...claims(draft.keyEvidence),
    "",
    "**不确定性与数据缺口**",
    ...(draft.uncertainties.length
      ? draft.uncertainties.map((item) => `- ${item}`)
      : ["- 当前证据未显示明显缺口。"]),
    "",
    "**风险判断**",
    ...(draft.risks.length ? claims(draft.risks) : ["- 未发现需要升级的额外风险。"]),
    "",
    "**建议与下一步**",
    ...(draft.suggestions.length
      ? draft.suggestions.map(
          (item) =>
            `- ${item.text} ${cite(item.evidenceRefs)}。需人工确认后执行。`.trim(),
        )
      : ["- 建议保持人工复核，不自动执行任何业务动作。"]),
  ].join("\n");
}
```

- [ ] **Step 7: Run the pure utility tests**

Run:

```bash
pnpm vitest run features/ai/deep-thinking/budget.test.ts features/ai/deep-thinking/evidence.test.ts features/ai/deep-thinking/search-safety.test.ts features/ai/deep-thinking/validator.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the pure utility slice**

Run:

```bash
git add features/ai/deep-thinking
git commit -m "feat(ai): add deep thinking guardrails"
```

## Task 3: Deep Thinking Orchestrator

**Files:**
- Create: `features/ai/deep-thinking/prompts.ts`
- Create: `features/ai/deep-thinking/orchestrator.ts`
- Test: `features/ai/deep-thinking/orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Create `features/ai/deep-thinking/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { runDeepThinkingOrchestration } from "./orchestrator";
import type { AiGatewayResult } from "../contracts";

const actor = {
  userId: "user-1",
  name: "Ops",
  role: "ops_manager",
  organizationId: "org-1",
};

const succeeded = (structuredOutput: unknown): AiGatewayResult => ({
  status: "succeeded",
  providerName: "deepseek",
  structuredOutput,
  fallbackUsed: false,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  latencyMs: 5,
  costCents: 0,
});

describe("deep thinking orchestrator", () => {
  it("runs all required stages without web search when internal evidence is enough", async () => {
    const stages: string[] = [];
    const runGateway = vi
      .fn()
      .mockResolvedValueOnce(
        succeeded({
          objective: "分析经营风险",
          subquestions: ["当前风险"],
          requiredEvidence: ["高风险项目"],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          coveredRequirements: ["高风险项目"],
          missingRequirements: [],
          contradictions: [],
          needsWebSearch: false,
          safeSearchQueries: [],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          conclusion: [{ text: "高风险项目 1 个", evidenceRefs: ["D1"] }],
          keyEvidence: [{ text: "系统显示高风险项目 1 个", evidenceRefs: ["D1"] }],
          uncertainties: [],
          risks: [{ text: "需优先处理高风险项目 1 个", evidenceRefs: ["D1"] }],
          suggestions: [
            {
              text: "建议人工复核高风险项目",
              evidenceRefs: ["D1"],
              requiresHumanApproval: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          verdict: "pass",
          unsupportedClaims: [],
          contradictions: [],
          missingEvidence: [],
        }),
      );
    const webSearch = { search: vi.fn() };

    const result = await runDeepThinkingOrchestration({
      providers: [{ name: "deepseek", capabilities: ["structured"] } as never],
      primaryProvider: "deepseek",
      client: { from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }) } as never,
      actor,
      lastUserMessage: "分析经营风险",
      messages: [{ role: "user", content: "分析经营风险" }],
      attachments: [],
      responseMetadata: {
        grounding: {
          facts: [
            {
              label: "高风险项目",
              value: "1 个",
              source: "dashboard.risks.highRisk",
            },
          ],
        },
        knowledge: { passages: [] },
        retrospectiveDraft: null,
      },
      invocationMetadata: { chatMode: "deep" },
      runGateway,
      webSearchProvider: webSearch,
      recordInvocation: vi.fn().mockResolvedValue("invocation-1"),
      nowMs: () => 1_000,
      onStage: (event) => stages.push(`${event.stage}:${event.status}`),
    });

    expect(result.status).toBe("completed");
    expect(result.webSearchUsed).toBe(false);
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(result.text).toContain("高风险项目 1 个");
    expect(stages).toContain("planning:started");
    expect(stages).toContain("web_retrieval:skipped");
    expect(stages.at(-1)).toBe("validating:completed");
  });

  it("uses at most two sanitized web queries when external evidence is required", async () => {
    const runGateway = vi
      .fn()
      .mockResolvedValueOnce(
        succeeded({
          objective: "判断最新平台规则",
          subquestions: ["最新规则"],
          requiredEvidence: ["当前抖音直播规则"],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          coveredRequirements: [],
          missingRequirements: ["当前抖音直播规则"],
          contradictions: [],
          needsWebSearch: true,
          safeSearchQueries: [
            "主播张三 项目 9f1b6b89-1111-4222-8333-123456789abc 抖音 最新规则",
            "快手 直播 最新规则",
            "第三个查询不会执行",
          ],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          conclusion: [{ text: "外部规则证据已补充", evidenceRefs: ["W1"] }],
          keyEvidence: [{ text: "外部网页提供规则说明", evidenceRefs: ["W1"] }],
          uncertainties: [],
          risks: [],
          suggestions: [
            {
              text: "建议人工确认平台规则后再调整话术",
              evidenceRefs: ["W1"],
              requiresHumanApproval: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        succeeded({
          verdict: "pass",
          unsupportedClaims: [],
          contradictions: [],
          missingEvidence: [],
        }),
      );
    const webSearch = {
      search: vi.fn().mockResolvedValue([
        {
          title: "规则说明",
          url: "https://example.com/rule",
          content: "公开视频平台规则说明",
        },
      ]),
    };

    const result = await runDeepThinkingOrchestration({
      providers: [{ name: "deepseek", capabilities: ["structured"] } as never],
      primaryProvider: "deepseek",
      client: { from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }) } as never,
      actor,
      lastUserMessage: "结合最新平台规则判断风险",
      messages: [{ role: "user", content: "结合最新平台规则判断风险" }],
      attachments: [],
      responseMetadata: {
        grounding: { facts: [] },
        knowledge: { passages: [] },
        retrospectiveDraft: null,
      },
      invocationMetadata: { chatMode: "deep" },
      runGateway,
      webSearchProvider: webSearch,
      recordInvocation: vi.fn().mockResolvedValue("invocation-1"),
      nowMs: () => 1_000,
    });

    expect(result.webSearchUsed).toBe(true);
    expect(webSearch.search).toHaveBeenCalledTimes(2);
    expect(webSearch.search.mock.calls[0][0].query).toBe("抖音 最新规则");
    expect(result.deepContext.webResults).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the orchestrator test and confirm it fails**

Run:

```bash
pnpm vitest run features/ai/deep-thinking/orchestrator.test.ts
```

Expected: FAIL because `runDeepThinkingOrchestration` does not exist.

- [ ] **Step 3: Add prompt builders**

Create `features/ai/deep-thinking/prompts.ts`:

```ts
import type { AiMessage } from "../contracts";
import type { DeepDraft, DeepPlan, DeepReview, EvidenceAssessment, EvidenceItem } from "./contracts";

export const DEEP_THINKING_PROMPT_KEY = "dashboard.ai.deep-thinking";
export const DEEP_THINKING_PROMPT_VERSION = 1;

export function planningMessages({
  userMessage,
}: {
  userMessage: string;
}): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "你是星耀 AI 的问题规划器。只拆解目标、子问题和证据需求，不下结论，不输出隐藏思维链。只返回 JSON。",
    },
    { role: "user", content: userMessage },
  ];
}

export function assessmentMessages({
  plan,
  evidence,
  userMessage,
}: {
  plan: DeepPlan;
  evidence: EvidenceItem[];
  userMessage: string;
}): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "你是证据充分性检查器。判断内部证据是否覆盖需求；只有外部当前事实缺失时才建议联网。只返回 JSON。",
    },
    {
      role: "user",
      content: JSON.stringify({
        userMessage,
        plan,
        evidence: evidence.map((item) => ({
          id: item.id,
          sourceType: item.sourceType,
          statement: item.statement,
        })),
      }),
    },
  ];
}

export function draftingMessages({
  plan,
  assessment,
  evidence,
}: {
  plan: DeepPlan;
  assessment: EvidenceAssessment;
  evidence: EvidenceItem[];
}): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "你是只读经营分析师。只能依据 evidence id 引用事实；每个关键判断必须带 evidenceRefs；建议必须 requiresHumanApproval=true。只返回 JSON。",
    },
    {
      role: "user",
      content: JSON.stringify({ plan, assessment, evidence }),
    },
  ];
}

export function reviewingMessages({
  draft,
  evidence,
}: {
  draft: DeepDraft;
  evidence: EvidenceItem[];
}): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "你是反方审查员。找无证据主张、矛盾、遗漏风险和过度推断。不要输出推理过程，只返回 JSON。",
    },
    { role: "user", content: JSON.stringify({ draft, evidence }) },
  ];
}

export function deterministicReview(): DeepReview {
  return {
    verdict: "pass",
    unsupportedClaims: [],
    contradictions: [],
    missingEvidence: [],
  };
}
```

- [ ] **Step 4: Implement orchestrator with injected dependencies**

Create `features/ai/deep-thinking/orchestrator.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AiActor,
  AiAttachment,
  AiGatewayResult,
  AiInvocationStatus,
  AiMessage,
  AiProvider,
  AiProviderName,
} from "../contracts";
import { recordAiInvocation } from "../invocation-ledger";
import { runAiGateway } from "../llm-gateway";
import type { WebSearchProvider } from "../web-search-provider";
import { createDeepThinkingBudget, remainingStageBudgetMs, shouldSkipOptionalStage } from "./budget";
import {
  deepDraftSchema,
  deepPlanSchema,
  deepReviewSchema,
  evidenceAssessmentSchema,
  type DeepDraft,
  type DeepPlan,
  type DeepReview,
  type DeepStageRecord,
  type DeepThinkingContext,
  type DeepThinkingMeta,
  type ReasoningStagePayload,
} from "./contracts";
import { buildInternalEvidence } from "./evidence";
import {
  assessmentMessages,
  DEEP_THINKING_PROMPT_KEY,
  DEEP_THINKING_PROMPT_VERSION,
  deterministicReview,
  draftingMessages,
  planningMessages,
  reviewingMessages,
} from "./prompts";
import {
  normalizeWebResults,
  sanitizeSearchQuery,
  shouldUseWebSearch,
} from "./search-safety";
import { renderFinalAnswer, validateDeepDraft } from "./validator";

type RunGateway = typeof runAiGateway;
type RecordInvocation = typeof recordAiInvocation;

export type DeepThinkingResult = {
  status: "completed" | "degraded";
  text: string;
  providerName?: AiProviderName;
  invocationId?: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  costCents: number;
  latencyMs: number;
  webSearchUsed: boolean;
  deepContext: DeepThinkingContext;
  meta: DeepThinkingMeta;
};

export async function runDeepThinkingOrchestration({
  providers,
  primaryProvider,
  client,
  actor,
  lastUserMessage,
  messages,
  attachments,
  responseMetadata,
  invocationMetadata,
  webSearchProvider,
  runGateway = runAiGateway,
  recordInvocation = recordAiInvocation,
  nowMs = Date.now,
  onStage,
}: {
  providers: AiProvider[];
  primaryProvider: AiProviderName;
  client: SupabaseClient;
  actor: AiActor;
  lastUserMessage: string;
  messages: AiMessage[];
  attachments: AiAttachment[];
  responseMetadata: {
    grounding: Record<string, unknown>;
    knowledge: Record<string, unknown>;
    retrospectiveDraft: unknown;
  };
  invocationMetadata: Record<string, unknown>;
  webSearchProvider?: WebSearchProvider | null;
  runGateway?: RunGateway;
  recordInvocation?: RecordInvocation;
  nowMs?: () => number;
  onStage?: (payload: ReasoningStagePayload) => Promise<void> | void;
}): Promise<DeepThinkingResult> {
  const budget = createDeepThinkingBudget({ nowMs });
  const stages: DeepStageRecord[] = [];
  let status: "completed" | "degraded" = "completed";
  let webSearchUsed = false;
  let providerName: AiProviderName | undefined;
  let invocationId: string | null = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let costCents = 0;
  let latencyMs = 0;

  const emit = async (stage: ReasoningStagePayload["stage"], stageStatus: ReasoningStagePayload["status"], reason?: string) => {
    const elapsedMs = Math.max(0, nowMs() - budget.startedAtMs);
    stages.push({ stage, status: stageStatus, elapsedMs, ...(reason ? { reason } : {}) });
    await onStage?.({ stage, status: stageStatus, elapsedMs });
  };

  const recordStage = async (stage: string, result: AiGatewayResult) => {
    providerName = result.providerName ?? providerName;
    usage.promptTokens += result.usage.promptTokens;
    usage.completionTokens += result.usage.completionTokens;
    usage.totalTokens += result.usage.totalTokens;
    costCents += result.costCents;
    latencyMs += result.latencyMs;
    invocationId = await recordInvocation({
      client,
      actor,
      input: {
        scene: "dashboard_ai_chat",
        providerName: result.providerName,
        primaryProvider,
        status: result.status as AiInvocationStatus,
        promptKey: DEEP_THINKING_PROMPT_KEY,
        promptVersion: DEEP_THINKING_PROMPT_VERSION,
        usage: result.usage,
        costCents: result.costCents,
        latencyMs: result.latencyMs,
        degradedReason: result.degradedReason,
        errorSummary: result.errorSummary,
        metadata: {
          ...invocationMetadata,
          chatMode: "deep",
          deepThinkingStage: stage,
        },
      },
    }).catch(() => invocationId);
  };

  await emit("planning", "started");
  const planResult = await runGateway({
    providers,
    primaryProvider,
    request: {
      kind: "structured",
      promptKey: DEEP_THINKING_PROMPT_KEY,
      promptVersion: DEEP_THINKING_PROMPT_VERSION,
      messages: planningMessages({ userMessage: lastUserMessage }),
      responseSchema: deepPlanSchema,
      metadata: { chatMode: "deep", deepThinkingStage: "planning" },
      mode: "deep",
      reasoning: { effort: "high", summary: "auto" },
    },
  });
  await recordStage("planning", planResult);
  const plan = deepPlanSchema.safeParse(planResult.structuredOutput).success
    ? deepPlanSchema.parse(planResult.structuredOutput)
    : deterministicPlan(lastUserMessage);
  if (planResult.status !== "succeeded") status = "degraded";
  await emit("planning", planResult.status === "succeeded" ? "completed" : "degraded");

  await emit("internal_retrieval", "started");
  const internalEvidence = buildInternalEvidence({
    grounding: responseMetadata.grounding,
    knowledge: responseMetadata.knowledge,
    attachments,
  });
  await emit("internal_retrieval", "completed");

  await emit("evidence_check", "started");
  const assessmentResult = await runGateway({
    providers,
    primaryProvider,
    request: {
      kind: "structured",
      promptKey: DEEP_THINKING_PROMPT_KEY,
      promptVersion: DEEP_THINKING_PROMPT_VERSION,
      messages: assessmentMessages({ plan, evidence: internalEvidence, userMessage: lastUserMessage }),
      responseSchema: evidenceAssessmentSchema,
      metadata: { chatMode: "deep", deepThinkingStage: "evidence_check" },
      mode: "deep",
      reasoning: { effort: "medium", summary: "auto" },
    },
  });
  await recordStage("evidence_check", assessmentResult);
  const assessment = evidenceAssessmentSchema.safeParse(assessmentResult.structuredOutput).success
    ? evidenceAssessmentSchema.parse(assessmentResult.structuredOutput)
    : deterministicAssessment(plan, internalEvidence, lastUserMessage);
  if (assessmentResult.status !== "succeeded") status = "degraded";
  await emit("evidence_check", assessmentResult.status === "succeeded" ? "completed" : "degraded");

  let evidence = internalEvidence;
  if (
    webSearchProvider &&
    assessment.needsWebSearch &&
    shouldUseWebSearch({
      missingRequirements: assessment.missingRequirements,
      requestedQuestion: lastUserMessage,
    }) &&
    !shouldSkipOptionalStage(budget, "web_retrieval")
  ) {
    await emit("web_retrieval", "started");
    let nextWebIndex = 1;
    for (const rawQuery of assessment.safeSearchQueries.slice(0, 2)) {
      const query = sanitizeSearchQuery(rawQuery);
      if (!query) continue;
      const results = await webSearchProvider.search({
        query,
        maxResults: 3,
      }).catch(() => []);
      const normalized = normalizeWebResults(results, nextWebIndex);
      nextWebIndex += normalized.length;
      evidence = evidence.concat(normalized);
      webSearchUsed = webSearchUsed || normalized.length > 0;
    }
    await emit("web_retrieval", webSearchUsed ? "completed" : "skipped");
  } else {
    await emit("web_retrieval", "skipped");
  }

  await emit("drafting", "started");
  const draftResult = await runGateway({
    providers,
    primaryProvider,
    request: {
      kind: "structured",
      promptKey: DEEP_THINKING_PROMPT_KEY,
      promptVersion: DEEP_THINKING_PROMPT_VERSION,
      messages: draftingMessages({ plan, assessment, evidence }),
      responseSchema: deepDraftSchema,
      metadata: { chatMode: "deep", deepThinkingStage: "drafting" },
      mode: "deep",
      reasoning: { effort: "high", summary: "auto" },
    },
  });
  await recordStage("drafting", draftResult);
  const draft = deepDraftSchema.safeParse(draftResult.structuredOutput).success
    ? deepDraftSchema.parse(draftResult.structuredOutput)
    : conservativeDraft(evidence, assessment.missingRequirements);
  if (draftResult.status !== "succeeded") status = "degraded";
  await emit("drafting", draftResult.status === "succeeded" ? "completed" : "degraded");

  await emit("reviewing", "started");
  let review: DeepReview = deterministicReview();
  if (remainingStageBudgetMs(budget, "reviewing") >= 1_000) {
    const reviewResult = await runGateway({
      providers,
      primaryProvider,
      request: {
        kind: "structured",
        promptKey: DEEP_THINKING_PROMPT_KEY,
        promptVersion: DEEP_THINKING_PROMPT_VERSION,
        messages: reviewingMessages({ draft, evidence }),
        responseSchema: deepReviewSchema,
        metadata: { chatMode: "deep", deepThinkingStage: "reviewing" },
        mode: "deep",
        reasoning: { effort: "medium", summary: "auto" },
      },
    });
    await recordStage("reviewing", reviewResult);
    review = deepReviewSchema.safeParse(reviewResult.structuredOutput).success
      ? deepReviewSchema.parse(reviewResult.structuredOutput)
      : deterministicReview();
    if (reviewResult.status !== "succeeded") status = "degraded";
    await emit("reviewing", reviewResult.status === "succeeded" ? "completed" : "degraded");
  } else {
    status = "degraded";
    await emit("reviewing", "degraded", "insufficient_budget");
  }

  await emit("finalizing", "started");
  if (review.verdict !== "pass") {
    status = "degraded";
  }
  await emit("finalizing", status === "completed" ? "completed" : "degraded");

  await emit("validating", "started");
  const validation = validateDeepDraft({ draft, evidence });
  const finalDraft = validation.ok ? draft : conservativeDraft(evidence, assessment.missingRequirements);
  if (!validation.ok) status = "degraded";
  const text = renderFinalAnswer({ draft: finalDraft, evidence });
  await emit("validating", validation.ok ? "completed" : "degraded");

  const deepContext: DeepThinkingContext = {
    plan,
    evidence,
    webResults: evidence.filter((item) => item.sourceType === "web"),
    gaps: assessment.missingRequirements,
    contradictions: assessment.contradictions,
    stages,
    review,
  };
  const meta: DeepThinkingMeta = {
    status,
    webSearchUsed,
    reviewVerdict:
      review.verdict === "pass"
        ? "pass"
        : review.verdict === "revise"
          ? "revised"
          : "insufficient",
    evidence,
    completedStages: stages.filter((item) => item.status === "completed").map((item) => item.stage),
    skippedStages: stages.filter((item) => item.status === "skipped").map((item) => item.stage),
    elapsedMs: Math.max(0, nowMs() - budget.startedAtMs),
    citationRejectCount: validation.citationRejectCount,
  };

  return {
    status,
    text,
    providerName,
    invocationId,
    usage,
    costCents,
    latencyMs,
    webSearchUsed,
    deepContext,
    meta,
  };
}

function deterministicPlan(userMessage: string): DeepPlan {
  return {
    objective: userMessage.slice(0, 200) || "分析当前经营问题",
    subquestions: ["当前可见事实是什么", "有哪些风险和缺口", "下一步建议是什么"],
    requiredEvidence: ["经营事实", "知识库经验", "用户附件"],
  };
}

function deterministicAssessment(
  plan: DeepPlan,
  evidence: Array<{ sourceType: string }>,
  userMessage: string,
) {
  const missingRequirements =
    evidence.length > 0 ? [] : plan.requiredEvidence.slice(0, 3);
  return {
    coveredRequirements: evidence.length > 0 ? plan.requiredEvidence.slice(0, 3) : [],
    missingRequirements,
    contradictions: [],
    needsWebSearch: shouldUseWebSearch({ missingRequirements, requestedQuestion: userMessage }),
    safeSearchQueries: [],
  };
}

function conservativeDraft(
  evidence: Array<{ id: string; statement: string }>,
  gaps: string[],
): DeepDraft {
  const first = evidence[0];
  if (!first) {
    return {
      conclusion: [{ text: "当前证据不足，不能可靠下结论", evidenceRefs: [] }],
      keyEvidence: [],
      uncertainties: gaps.length ? gaps : ["缺少可引用证据"],
      risks: [],
      suggestions: [
        {
          text: "建议先补齐系统数据或附件，再由人工确认分析结论",
          evidenceRefs: [],
          requiresHumanApproval: true,
        },
      ],
    };
  }
  return {
    conclusion: [{ text: first.statement, evidenceRefs: [first.id] }],
    keyEvidence: [{ text: first.statement, evidenceRefs: [first.id] }],
    uncertainties: gaps,
    risks: [],
    suggestions: [
      {
        text: "建议基于现有证据进行人工复核",
        evidenceRefs: [first.id],
        requiresHumanApproval: true,
      },
    ],
  };
}
```

- [ ] **Step 5: Run the orchestrator test and confirm it passes**

Run:

```bash
pnpm vitest run features/ai/deep-thinking/orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the orchestrator slice**

Run:

```bash
git add features/ai/deep-thinking
git commit -m "feat(ai): orchestrate deep thinking analysis"
```

## Task 4: Route Integration And Feature Flag

**Files:**
- Modify: `app/api/ai/chat/route.ts`
- Test: `app/api/ai/chat/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Add mocks to `app/api/ai/chat/route.test.ts`:

```ts
const runDeepThinkingOrchestrationMock = vi.fn();
const createWebSearchProviderFromEnvMock = vi.fn();

vi.mock("@/features/ai/deep-thinking/orchestrator", () => ({
  runDeepThinkingOrchestration: runDeepThinkingOrchestrationMock,
}));

vi.mock("@/features/ai/web-search-provider", () => ({
  createWebSearchProviderFromEnv: createWebSearchProviderFromEnvMock,
}));
```

Reset them in `beforeEach`:

```ts
runDeepThinkingOrchestrationMock.mockReset();
createWebSearchProviderFromEnvMock.mockReset();
createWebSearchProviderFromEnvMock.mockReturnValue(null);
delete process.env.AI_DEEP_ORCHESTRATION_ENABLED;
```

Add tests:

```ts
it("routes deep mode through the orchestration path when the flag is enabled", async () => {
  process.env.AI_DEEP_ORCHESTRATION_ENABLED = "true";
  runDeepThinkingOrchestrationMock.mockResolvedValue({
    status: "completed",
    text: "**结论**\n- 高风险项目 1 个 [D1]",
    providerName: "deepseek",
    invocationId: "deep-invocation-1",
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    costCents: 0,
    latencyMs: 20,
    webSearchUsed: false,
    deepContext: { evidence: [], webResults: [], gaps: [], contradictions: [], stages: [] },
    meta: {
      status: "completed",
      webSearchUsed: false,
      reviewVerdict: "pass",
      evidence: [],
      completedStages: ["planning", "validating"],
      skippedStages: ["web_retrieval"],
      elapsedMs: 20,
      citationRejectCount: 0,
    },
  });
  const { POST } = await import("./route");

  const response = await POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        mode: "deep",
        messages: [{ role: "user", content: "分析风险" }],
      }),
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    message: { role: "assistant", content: expect.stringContaining("高风险项目") },
    status: "completed",
    invocationId: "deep-invocation-1",
    mode: "deep",
    deepThinking: expect.objectContaining({ status: "completed" }),
  });
  expect(runDeepThinkingOrchestrationMock).toHaveBeenCalledTimes(1);
  expect(runAiGatewayMock).not.toHaveBeenCalled();
});

it("keeps current single-model deep behavior when the orchestration flag is disabled", async () => {
  delete process.env.AI_DEEP_ORCHESTRATION_ENABLED;
  const { POST } = await import("./route");

  const response = await POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        mode: "deep",
        messages: [{ role: "user", content: "分析风险" }],
      }),
    }),
  );

  expect(response.status).toBe(200);
  expect(runDeepThinkingOrchestrationMock).not.toHaveBeenCalled();
  expect(runAiGatewayMock).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({
        mode: "deep",
        reasoning: { effort: "high", summary: "auto" },
      }),
    }),
  );
});
```

- [ ] **Step 2: Run route tests and confirm they fail**

Run:

```bash
pnpm vitest run app/api/ai/chat/route.test.ts
```

Expected: FAIL because route integration does not exist.

- [ ] **Step 3: Wire the deep orchestrator into the route**

Modify imports in `app/api/ai/chat/route.ts`:

```ts
import {
  runDeepThinkingOrchestration,
  type DeepThinkingResult,
} from "@/features/ai/deep-thinking/orchestrator";
import type { ReasoningStagePayload } from "@/features/ai/deep-thinking/contracts";
import { createWebSearchProviderFromEnv } from "@/features/ai/web-search-provider";
```

Extend options:

```ts
export type DashboardAiChatInternalOptions = {
  trustedGatewayContext?: ConversationGatewayContext;
  onContextReady?: (
    context: ConversationGatewayContext,
  ) => Promise<void> | void;
  onGenerationStarted?: (providerName: AiProviderName) => Promise<void> | void;
  onReasoningStage?: (payload: ReasoningStagePayload) => Promise<void> | void;
};
```

After `chatContext` is built and before current gateway execution:

```ts
    if (shouldUseDeepThinkingOrchestration(chatMode)) {
      await options.onGenerationStarted?.(primaryProvider);
      const baseGatewayContext = toPersistableConversationGatewayContext({
        messages,
        attachments,
        mode: chatMode,
        primaryProvider,
        lastUserMessage,
        responseMetadata,
        invocationMetadata,
      });
      const persistDeepContext = async (result: DeepThinkingResult) => {
        await options.onContextReady?.({
          ...baseGatewayContext,
          deepContext: result.deepContext,
        });
      };
      const runDeep = () =>
        runDeepThinkingOrchestration({
          providers,
          primaryProvider,
          client: supabase,
          actor: auth as AiActor,
          lastUserMessage,
          messages,
          attachments,
          responseMetadata,
          invocationMetadata,
          webSearchProvider: createWebSearchProviderFromEnv(),
          onStage: options.onReasoningStage,
        }).then(async (result) => {
          await persistDeepContext(result);
          return result;
        });

      if (wantsStream) {
        return streamDeepThinkingResponse({
          runDeep,
          context: chatContext,
          emitLegacyStageEvents: !options.onReasoningStage,
        });
      }

      const deepResult = await runDeep();
      return deepThinkingJsonResponse({
        result: deepResult,
        context: chatContext,
      });
    }
```

Add helper functions near `buildReasoningConfig`:

```ts
function shouldUseDeepThinkingOrchestration(mode: AiChatMode): boolean {
  return (
    mode === "deep" &&
    /^(1|true|yes|on)$/i.test(
      process.env.AI_DEEP_ORCHESTRATION_ENABLED?.trim() ?? "",
    )
  );
}

function deepThinkingJsonResponse({
  result,
  context,
}: {
  result: DeepThinkingResult;
  context: ChatRequestContext;
}) {
  return NextResponse.json({
    message: { role: "assistant", content: result.text },
    providerName: result.providerName,
    status: result.status,
    invocationId: result.invocationId,
    fallbackUsed: false,
    mode: context.chatMode,
    usage: result.usage,
    grounding: context.responseMetadata.grounding,
    knowledge: context.responseMetadata.knowledge,
    retrospectiveDraft: context.responseMetadata.retrospectiveDraft,
    deepThinking: result.meta,
  });
}

function streamDeepThinkingResponse({
  runDeep,
  context,
  emitLegacyStageEvents,
}: {
  runDeep: () => Promise<DeepThinkingResult>;
  context: ChatRequestContext;
  emitLegacyStageEvents: boolean;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        const result = await runDeep();
        if (emitLegacyStageEvents) {
          for (const stage of result.deepContext.stages) {
            send("reasoning.stage", {
              stage: stage.stage,
              status: stage.status,
              elapsedMs: stage.elapsedMs,
            });
          }
        }
        send("done", {
          message: { role: "assistant", content: result.text },
          providerName: result.providerName,
          status: result.status,
          fallbackUsed: false,
          mode: context.chatMode,
          usage: result.usage,
          grounding: context.responseMetadata.grounding,
          knowledge: context.responseMetadata.knowledge,
          retrospectiveDraft: context.responseMetadata.retrospectiveDraft,
          invocationId: result.invocationId,
          deepThinking: result.meta,
        });
      } catch (error) {
        send("error", {
          error: error instanceof Error ? error.message : "Deep thinking failed",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Persist final deep context in the frozen gateway snapshot**

The route already calls `onContextReady` once before generation for the grounded base context. In the deep orchestration branch, call it a second time with `deepContext` after orchestration finishes and before `done` is emitted. Add this object shape to `toPersistableConversationGatewayContext` JSON normalization:

```ts
      deepContext: context.deepContext,
```

Expected: `undefined` deep context is omitted on the base snapshot; populated deep context is persisted before terminal completion, so retry can reuse successful evidence and web results.

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm vitest run app/api/ai/chat/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the route slice**

Run:

```bash
git add app/api/ai/chat/route.ts app/api/ai/chat/route.test.ts
git commit -m "feat(ai): route deep mode through orchestrator"
```

## Task 5: Conversation SSE Stage Progress

**Files:**
- Modify: `features/ai/conversation-stream-adapter.ts`
- Modify: `features/ai/conversation-stream-adapter.test.ts`

- [ ] **Step 1: Write failing SSE adapter test**

Add this case to `features/ai/conversation-stream-adapter.test.ts`:

```ts
it("emits deep reasoning stage events between context and final completion", async () => {
  const callOrder: string[] = [];
  const service = serviceDouble({ callOrder });
  const executeLegacyChat = vi.fn().mockImplementation(async (_request, options) => {
    await options.onContextReady({
      messages: [{ role: "user", content: "冻结上下文" }],
      attachments: [],
      mode: "deep",
      primaryProvider: "deepseek",
      lastUserMessage: "分析风险",
      responseMetadata: { grounding: {}, knowledge: {}, retrospectiveDraft: null },
      invocationMetadata: {},
    });
    await options.onGenerationStarted("deepseek");
    await options.onReasoningStage({
      stage: "planning",
      status: "started",
      elapsedMs: 0,
    });
    await options.onReasoningStage({
      stage: "planning",
      status: "completed",
      elapsedMs: 30,
    });
    return legacySseResponse([
      [
        "done",
        {
          message: { role: "assistant", content: "处理建议" },
          providerName: "deepseek",
          invocationId: "invocation-1",
          status: "succeeded",
          deepThinking: {
            status: "completed",
            webSearchUsed: false,
            reviewVerdict: "pass",
            evidence: [],
            completedStages: ["planning"],
            skippedStages: [],
            elapsedMs: 30,
          },
        },
      ],
    ]);
  });

  const response = createConversationTurnStream({
    request: new Request("http://localhost/api/ai/conversations/conversation-1/turns"),
    actor: { organizationId: "org-1", userId: "user-1" },
    turn,
    attachments: [],
    service,
    executeLegacyChat,
  });
  const events = parseSseEvents(await response.text());

  expect(events.map((event) => event.event)).toEqual([
    "turn.started",
    "context.ready",
    "reasoning.stage",
    "reasoning.stage",
    "response.completed",
  ]);
  expect(events[2].data).toMatchObject({
    type: "reasoning.stage",
    stage: "planning",
    status: "started",
  });
});
```

- [ ] **Step 2: Run adapter test and confirm it fails**

Run:

```bash
pnpm vitest run features/ai/conversation-stream-adapter.test.ts
```

Expected: FAIL because adapter options do not include `onReasoningStage`.

- [ ] **Step 3: Add stage callback support to the adapter**

Modify `executeLegacyChat` option type in `features/ai/conversation-stream-adapter.ts`:

```ts
      onReasoningStage?: (
        payload: {
          stage: Extract<
            ConversationStreamEvent,
            { type: "reasoning.stage" }
          >["stage"];
          status: Extract<
            ConversationStreamEvent,
            { type: "reasoning.stage" }
          >["status"];
          elapsedMs: number;
        },
      ) => Promise<void> | void;
```

Inside `start`, add:

```ts
      let contextReadySent = false;
      const sendContextReady = () => {
        if (contextReadySent) return;
        contextReadySent = true;
        send({
          type: "context.ready",
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          snapshotVersion: preparedSnapshotVersion,
        });
      };
```

Use a local `preparedSnapshotVersion` after `prepareTurn`:

```ts
        const prepared = await service.prepareTurn(actor, turn.turnId, [
          "dashboard:role-home",
          "xingyao:feature-store",
          "knowledge-base",
        ]);
        const preparedSnapshotVersion = prepared.snapshot.version;
```

Update the `onContextReady` option:

```ts
            onContextReady: async (gatewayContext) => {
              await service.captureGatewayContext(
                actor,
                turn.turnId,
                prepared.snapshot,
                gatewayContext,
              );
              sendContextReady();
            },
            onReasoningStage: async (payload) => {
              sendContextReady();
              send({
                type: "reasoning.stage",
                conversationId: turn.conversationId,
                turnId: turn.turnId,
                stage: payload.stage,
                status: payload.status,
                elapsedMs: payload.elapsedMs,
              });
            },
```

After `executeLegacyChat` returns, replace the existing unconditional `context.ready` send with:

```ts
        sendContextReady();
```

- [ ] **Step 4: Include deep metadata in response metadata extraction**

Modify `responseMetadata` in `features/ai/conversation-stream-adapter.ts`:

```ts
    ...(isRecord(value.deepThinking) ? { deepThinking: value.deepThinking } : {}),
```

Expected: assistant message metadata can restore progress completion state after reload.

- [ ] **Step 5: Run adapter tests**

Run:

```bash
pnpm vitest run features/ai/conversation-stream-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the conversation SSE slice**

Run:

```bash
git add features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts
git commit -m "feat(ai): stream deep reasoning stages"
```

## Task 6: Assistant Panel Stage UI

**Files:**
- Modify: `components/dashboard/overview-board.jsx`
- Modify: `components/dashboard/overview-board.test.jsx`

- [ ] **Step 1: Write failing UI tests**

Add a protocol SSE sequence with reasoning stages to `components/dashboard/overview-board.test.jsx`:

```jsx
it("shows deep thinking stage progress while a deep response is running", async () => {
  const encoder = new TextEncoder();
  fetch.mockImplementation((url, options = {}) => {
    if (url === "/api/ai/conversations" && options.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ conversation: { id: "conversation-1" } }),
      });
    }
    if (url === "/api/ai/conversations") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ conversations: [] }),
      });
    }
    if (url === "/api/ai/conversations/conversation-1/turns") {
      const sse = protocolSse([
        [
          "turn.started",
          {
            type: "turn.started",
            conversationId: "conversation-1",
            turnId: "turn-1",
            userMessageId: "message-user-1",
            assistantMessageId: "message-assistant-1",
          },
        ],
        [
          "context.ready",
          {
            type: "context.ready",
            conversationId: "conversation-1",
            turnId: "turn-1",
            snapshotVersion: 1,
          },
        ],
        [
          "reasoning.stage",
          {
            type: "reasoning.stage",
            conversationId: "conversation-1",
            turnId: "turn-1",
            stage: "planning",
            status: "started",
            elapsedMs: 0,
          },
        ],
        [
          "reasoning.stage",
          {
            type: "reasoning.stage",
            conversationId: "conversation-1",
            turnId: "turn-1",
            stage: "validating",
            status: "completed",
            elapsedMs: 120,
          },
        ],
        [
          "response.completed",
          {
            type: "response.completed",
            conversationId: "conversation-1",
            turnId: "turn-1",
            messageId: "message-assistant-1",
            content: "深度分析完成",
            meta: {
              deepThinking: {
                status: "completed",
                completedStages: ["planning", "validating"],
                skippedStages: [],
              },
            },
          },
        ],
      ]);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream; charset=utf-8" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(sse));
            controller.close();
          },
        }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not found" }),
    });
  });

  const { container } = render(
    <OverviewBoard
      dashboard={dashboard}
      projects={[]}
      tasks={[]}
      reports={[]}
      batches={[]}
      currentUser={{ id: "user-1", name: "123", role: "owner" }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "深度思考" }));
  const input = container.querySelector("input");
  fireEvent.change(input, { target: { value: "深度分析风险" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  expect(await screen.findByText("深度分析完成")).toBeInTheDocument();
  expect(screen.getByText("深度分析已完成")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the UI test and confirm it fails**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx
```

Expected: FAIL because `reasoning.stage` is ignored and no progress UI exists.

- [ ] **Step 3: Add stage normalization helpers**

Modify `components/dashboard/overview-board.jsx` near AI metadata helpers:

```jsx
const DEEP_THINKING_STAGE_LABELS = {
  planning: "规划问题",
  internal_retrieval: "读取内部证据",
  evidence_check: "检查证据",
  web_retrieval: "按需检索公开信息",
  drafting: "生成分析",
  reviewing: "复核结论",
  finalizing: "整理答案",
  validating: "校验证据",
};

function normalizeDeepThinkingMeta(value) {
  if (!value || typeof value !== "object") return undefined;
  const completedStages = Array.isArray(value.completedStages)
    ? value.completedStages.filter((stage) => DEEP_THINKING_STAGE_LABELS[stage])
    : [];
  const skippedStages = Array.isArray(value.skippedStages)
    ? value.skippedStages.filter((stage) => DEEP_THINKING_STAGE_LABELS[stage])
    : [];
  const status = value.status === "degraded" ? "degraded" : "completed";
  return { status, completedStages, skippedStages };
}

function updateDeepThinkingStage(current, payload) {
  const stage = payload?.stage;
  const status = payload?.status;
  if (!DEEP_THINKING_STAGE_LABELS[stage]) return current;
  const stages = Array.isArray(current?.stages) ? current.stages.slice() : [];
  const index = stages.findIndex((item) => item.stage === stage);
  const nextStage = {
    stage,
    status,
    label: DEEP_THINKING_STAGE_LABELS[stage],
  };
  if (index >= 0) stages[index] = nextStage;
  else stages.push(nextStage);
  return {
    ...(current || {}),
    status: status === "degraded" ? "degraded" : "running",
    stages,
  };
}
```

Extend `normalizeAiMessageMeta`:

```jsx
  const deepThinking = normalizeDeepThinkingMeta(
    value?.deepThinking || value?.meta?.deepThinking,
  );
  const meta = {
    ...(projectHealth ? { projectHealth } : {}),
    ...(suggestedActions ? { suggestedActions } : {}),
    ...(deepThinking ? { deepThinking } : {}),
  };
```

- [ ] **Step 4: Consume stage events into the assistant message**

In `handleEvent`, add this branch before `response.delta`:

```jsx
      if (eventName === "reasoning.stage") {
        activeTurnId = payload?.turnId || activeTurnId;
        const messageId =
          activeAssistantMessageId ||
          replaceMessageId ||
          createAiClientRequestId("assistant");
        activeAssistantMessageId = messageId;
        onAssistantMessageId?.(activeAssistantMessageId);
        upsertAiMessageWithUpdater(messageId, (existing) => ({
          id: messageId,
          role: "ai",
          text: streamedText || existing?.text || "正在进行深度分析…",
          status: "streaming",
          turnId: activeTurnId,
          meta: {
            ...(existing?.meta || {}),
            deepThinking: updateDeepThinkingStage(
              existing?.meta?.deepThinking,
              payload,
            ),
          },
        }));
        return;
      }
```

Add this functional helper before `handleEvent`:

```jsx
const upsertAiMessageWithUpdater = (messageId, updater) => {
  setMsgs((current) => {
    const existing = current.find((item) => item.id === messageId);
    const nextMessage = updater(existing);
    const index = current.findIndex((item) => item.id === messageId);
    if (index < 0) return current.concat([nextMessage]);
    const next = current.slice();
    next[index] = { ...current[index], ...nextMessage };
    return next;
  });
};
```

- [ ] **Step 5: Render compact progress**

Add a component near `AiSuggestedActionCard`:

```jsx
function AiDeepThinkingProgress({ deepThinking, status }) {
  if (!deepThinking) return null;
  const completed = deepThinking.status === "completed";
  const degraded = deepThinking.status === "degraded";
  const runningStage = Array.isArray(deepThinking.stages)
    ? deepThinking.stages.findLast?.((stage) => stage.status === "started") ||
      deepThinking.stages.at?.(-1)
    : null;
  const label = completed
    ? "深度分析已完成"
    : degraded
      ? "已基于现有证据完成"
      : runningStage?.label || "正在进行深度分析";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        color: degraded ? C.warn : C.primaryDeep,
        background: degraded ? "#fef5e3" : C.primarySoft,
        border: `1px solid ${degraded ? "#f2d28a" : "#dce6ff"}`,
        borderRadius: 8,
        padding: "6px 8px",
        fontSize: 11.5,
        fontWeight: 650,
      }}
    >
      {!completed && status === "streaming" ? (
        <span
          style={{
            width: 10,
            height: 10,
            border: "2px solid rgba(59,107,230,.18)",
            borderTopColor: C.primary,
            borderRadius: "50%",
            animation: "obspin .7s linear infinite",
          }}
        />
      ) : null}
      <span>{label}</span>
    </div>
  );
}
```

Render it before `AiMessageContent`:

```jsx
<AiDeepThinkingProgress
  deepThinking={m.meta?.deepThinking}
  status={m.status}
/>
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit the UI slice**

Run:

```bash
git add components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx
git commit -m "feat(ai): show deep thinking progress"
```

## Task 7: Focused Regression And Full Verification

**Files:**
- Verify only unless a focused test exposes an implementation bug.

- [ ] **Step 1: Run focused AI tests**

Run:

```bash
pnpm vitest run features/ai/deep-thinking features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.test.ts app/api/ai/chat/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused UI test**

Run:

```bash
pnpm vitest run components/dashboard/overview-board.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run type checking**

Run:

```bash
pnpm type-check
```

Expected: PASS. If unrelated dirty work causes failures outside touched files, capture the exact failing files and run the narrowed TypeScript check for touched modules before finalizing.

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS. If existing unrelated files fail lint, document them and fix only failures in files touched by this feature.

- [ ] **Step 5: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Inspect final scoped diff**

Run:

```bash
git status --short
git diff -- features/ai/deep-thinking features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts app/api/ai/chat/route.ts app/api/ai/chat/route.test.ts components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx
```

Expected: diff contains only the deep thinking orchestration feature and does not include unrelated war-room or reference UI edits.

- [ ] **Step 7: Final commit**

Run:

```bash
git add features/ai/deep-thinking features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts app/api/ai/chat/route.ts app/api/ai/chat/route.test.ts components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx
git commit -m "feat(ai): enable xingyao deep thinking mode"
```

## Self-Review

**Spec coverage:** The plan covers the approved adaptive orchestration path, 52-second internal budget, 60-second route limit, internal evidence priority, optional sanitized web search, read-only final validation, stage progress SSE, final metadata, feature flag fallback, and fast-mode non-regression.

**Placeholder scan:** The plan avoids placeholder terms and includes concrete files, snippets, commands, and expected outcomes for each task.

**Type consistency:** `DeepThinkingStage`, `DeepThinkingStageStatus`, `DeepThinkingContext`, `ReasoningStagePayload`, and `DeepThinkingMeta` are defined in Task 1 and reused consistently by route, adapter, orchestrator, and UI tasks.
