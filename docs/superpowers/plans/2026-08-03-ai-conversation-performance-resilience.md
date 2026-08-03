# AI Conversation Performance and Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fast-mode AI turns meet a 99 percent success rate, an 8-second first-delta P95, and a 30-second end-to-end P95 while preserving conversation memory and allowing browser navigation, refresh, and transient network loss without cancelling or duplicating accepted work.

**Architecture:** Product database state remains authoritative. The Product reuses one sanitized Gateway session per conversation but issues a fresh actor assertion and invocation capability for every turn. Accepted turns run independently of the HTTP subscriber, publish bounded recovery snapshots, atomically persist terminal output and structured memory, and are reattached by a lightweight cursor endpoint. Gateway retains session and Agent state under bounded idle TTLs and emits initialization heartbeats. The browser batches deltas and only refreshes full history at conversation open and terminal reconciliation.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Supabase/PostgreSQL, Vitest, React Testing Library, `ws`, Node.js 20, Python 3.12+, pytest, systemd, PM2.

---

## Baselines And Invariants

- Product baseline: `03e67fc2f4bf3c5eeaf5cf4b1de6bf9ba91a678a`.
- Gateway baseline: `de80fbf83f13fd8e72d2efe66961baa385dd5919`.
- Product implementation branch prefix: `codex/ai-conversation-performance-resilience`.
- Gateway implementation branch prefix: `codex/xingyao-session-lifecycle-resilience`.
- Product workspace: `C:\Users\admin\Documents\版本2`.
- Gateway workspace: `C:\Users\admin\Documents\版本2\.worktrees\xingyao-hermes-agent-init-fix`.
- Never edit an existing migration. Every database change in this plan is additive.
- Never persist actor assertions, invocation capabilities, prompts, response bodies, service tokens, or private keys in telemetry.
- Never retry `prompt.submit` after Gateway acknowledgement.
- Never fall back to Legacy after Gateway acknowledgement.
- Browser disconnect and component unmount detach a subscriber; only the authenticated cancel endpoint cancels a turn.
- Product and Gateway changes are built, committed, released, and rolled back independently.

## Execution Setup

After this plan is committed, continue from the clean planning worktree and create the Product implementation branch:

```powershell
Set-Location 'C:\Users\admin\Documents\版本2\.worktrees\ai-performance-review-03e67fc2'
git status --short
git switch -c codex/ai-conversation-performance-resilience
git rev-parse HEAD
```

Expected: the worktree is clean and the new branch contains the approved design and this implementation plan. Do not implement from the dirty main worktree.

The ten tasks below produce five reviewable changesets:

1. Tasks 1-2: telemetry and enforceable performance budgets.
2. Task 3: Gateway lifecycle and timeout contract.
3. Task 4: Product session reuse and submit-once protection.
4. Task 5: structured memory and token-aware context.
5. Tasks 6-10: durable recovery, browser batching, executable gates, and rollout controls.

## Task 1: Establish Executable Baselines And Performance Statistics

**Files:**

- Modify: `features/ai/hermes/performance-contract.test.ts`
- Modify: `scripts/test-xingyao-hermes-e2e.mjs`
- Create: `features/ai/hermes/performance-statistics.ts`
- Create: `features/ai/hermes/performance-statistics.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing percentile and release-gate tests**

Add pure statistics tests for nearest-rank percentile, success rate, and minimum sample enforcement:

```ts
expect(
  nearestRankPercentile([11_530, 36_900, 38_230, 46_950, 62_640], 0.95),
).toBe(62_640);

expect(
  evaluateFastTurnGate({
    samples: oneHundredPassingFastSamples,
    minSamples: 100,
    minSuccessRate: 0.99,
    maxFirstDeltaP95Ms: 8_000,
    maxTotalP95Ms: 30_000,
  }),
).toEqual({ ok: true, failures: [] });

expect(
  evaluateFastTurnGate({
    samples: oneSlowSample,
    minSamples: 100,
    minSuccessRate: 0.99,
    maxFirstDeltaP95Ms: 8_000,
    maxTotalP95Ms: 30_000,
  }).failures,
).toContain("insufficient_samples");
```

Run:

```powershell
pnpm vitest run features/ai/hermes/performance-statistics.test.ts features/ai/hermes/performance-contract.test.ts
```

Expected: fail because the statistics module and enforceable thresholds do not exist.

- [ ] **Step 2: Implement deterministic statistics and separate fixture validation from live gates**

Export these types and functions from `performance-statistics.ts`:

```ts
export type FastTurnPerformanceSample = {
  success: boolean;
  firstDeltaMs: number | null;
  totalMs: number;
};

export function nearestRankPercentile(
  values: number[],
  percentile: number,
): number;
export function evaluateFastTurnGate(input: {
  samples: FastTurnPerformanceSample[];
  minSamples: number;
  minSuccessRate: number;
  maxFirstDeltaP95Ms: number;
  maxTotalP95Ms: number;
}): { ok: boolean; failures: string[] };
```

Keep the existing fixed evaluation as a schema and safety fixture. Add a `--performance-report <path>` mode to `test-xingyao-hermes-e2e.mjs` that evaluates real, sanitized samples and exits non-zero when a gate fails. It must reject reports containing `prompt`, `content`, `assertion`, `capability`, `authorization`, `serviceToken`, `accessToken`, `secret`, or `chainOfThought` fields. Numeric input/output token counts remain allowed performance metrics.

Add:

```json
"test:ai-performance": "vitest run features/ai/hermes/performance-statistics.test.ts features/ai/hermes/performance-contract.test.ts"
```

- [ ] **Step 3: Verify focused behavior**

Run:

```powershell
pnpm test:ai-performance
node scripts/test-xingyao-hermes-e2e.mjs --local
```

Expected: tests pass; the local fixture remains deterministic and does not claim production SLO compliance.

- [ ] **Step 4: Commit the executable baseline**

```powershell
git add features/ai/hermes/performance-contract.test.ts features/ai/hermes/performance-statistics.ts features/ai/hermes/performance-statistics.test.ts scripts/test-xingyao-hermes-e2e.mjs package.json
git diff --cached --check
git commit -m "test(ai): enforce conversation performance budgets"
```

## Task 2: Persist Stage Timings Without Changing Runtime Selection

**Files:**

- Create: `supabase/migrations/20260803120000_ai_turn_stage_telemetry.sql`
- Modify: `lib/db/xingyao-hermes-native-schema-contract.test.ts`
- Modify: `features/ai/conversation-contracts.ts`
- Modify: `features/ai/conversation-contracts.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/conversation-service.ts`
- Modify: `features/ai/conversation-service.test.ts`
- Modify: `features/ai/native-assistant/gateway-executor.ts`
- Modify: `features/ai/native-assistant/gateway-executor.test.ts`

- [ ] **Step 1: Write failing schema-contract tests**

Require these additive `ai_chat_turns` columns:

```text
accepted_at timestamptz
context_ready_at timestamptz
session_ready_at timestamptz
session_action text
agent_ready_at timestamptz
first_delta_at timestamptz
terminal_at timestamptz
persisted_at timestamptz
```

Require `session_action` to be null, `resumed`, or `rebuilt`. Require a security-definer RPC named `record_ai_chat_turn_stage` with organization, owner, conversation, and turn inputs. Revoke public execution and grant only `service_role`.

Run:

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts
```

Expected: fail because the migration and RPC do not exist.

- [ ] **Step 2: Add the migration and monotonic stage RPC**

The RPC must:

1. Lock the matching turn under all four identity columns.
2. Set only the requested stage column.
3. Use `coalesce(existing_value, p_observed_at)` so retries cannot rewrite timing history.
4. Reject invalid stage names and invalid `session_action` values.
5. Return a sanitized JSON object containing turn ID and recorded timestamp only.

Set `accepted_at = coalesce(accepted_at, created_at)` for existing rows. Do not rewrite terminal or historical status.

- [ ] **Step 3: Add repository and service contracts**

Add:

```ts
export type ConversationTurnStage =
  | "accepted"
  | "context_ready"
  | "session_ready"
  | "agent_ready"
  | "first_delta"
  | "terminal"
  | "persisted";

export type ConversationSessionAction = "resumed" | "rebuilt";
```

Expose `recordTurnStage(...)` through repository and service layers. Convert unknown RPC failures to a sanitized `conversation_turn_stage_persist_failed` error without echoing Supabase response bodies.

- [ ] **Step 4: Instrument the executor in current behavior**

Record accepted, context-ready, session-ready, first-delta, terminal, and persisted timestamps around existing operations. This task must not change session creation, prompt retry, runtime selection, or Legacy fallback behavior.

Test that duplicate stage calls are idempotent and that instrumentation failure does not submit the prompt twice. A pre-terminal telemetry failure may continue with a structured warning; terminal persistence still remains authoritative.

- [ ] **Step 5: Verify migration and focused suites**

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts features/ai/native-assistant/gateway-executor.test.ts
pnpm type-check
```

Expected: all listed suites and type-check pass.

- [ ] **Step 6: Commit telemetry**

```powershell
git add supabase/migrations/20260803120000_ai_turn_stage_telemetry.sql lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts features/ai/native-assistant/gateway-executor.ts features/ai/native-assistant/gateway-executor.test.ts
git diff --cached --check
git commit -m "feat(ai): record durable turn stage timings"
```

## Task 3: Extend Gateway Session And Agent Lifecycle

**Repository:** Gateway worktree `C:\Users\admin\Documents\版本2\.worktrees\xingyao-hermes-agent-init-fix`

**Files:**

- Modify: `tui_gateway/server.py`
- Modify: `tests/test_tui_gateway_server.py`
- Modify: `tests/gateway/test_agent_cache.py`
- Modify: `tests/xingyao/test_gateway_session_binding.py`
- Modify: `tests/xingyao/test_gateway_ws_transport.py`
- Modify: `tests/xingyao/test_gateway_protocol.py`

- [ ] **Step 1: Create a clean Gateway implementation branch**

```powershell
git status --short
git rev-parse HEAD
git switch -c codex/xingyao-session-lifecycle-resilience
```

Expected: clean worktree at `de80fbf83f13fd8e72d2efe66961baa385dd5919` before the branch is created.

- [ ] **Step 2: Write failing session-resume and heartbeat tests**

Cover these exact cases:

- `session.resume` accepts a fresh actor assertion and fresh invocation capability for the same organization, user, and conversation.
- Cross-organization, cross-user, conversation drift, profile drift, skill-grant drift, revoked capability, and expired capability are rejected.
- Closing a WebSocket does not evict the server session or an idle cached Agent.
- Session idle TTL is 15 minutes.
- Agent idle TTL is 10 minutes.
- A live Agent is not evicted by a sweep or cache-cap enforcement.
- Initialization emits a public `activity.updated` heartbeat at least every 15 seconds.
- Initialization stops at 120 seconds with `gateway_agent_initialization_timed_out`.
- Heartbeat payloads contain no prompt, assertion, capability, service token, private key, stack, or chain-of-thought.

Run:

```powershell
uv run pytest -q tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_ws_transport.py tests/xingyao/test_gateway_protocol.py tests/gateway/test_agent_cache.py tests/test_tui_gateway_server.py
```

Expected: new tests fail against the current lifecycle.

- [ ] **Step 3: Extend existing cache and session records**

Reuse the existing Agent cache, LRU cap, active-Agent protection, and idle sweep. Do not create a second Agent cache. Add explicit session last-used timestamps and use monotonic time for TTL decisions.

Use these constants:

```py
_XINGYAO_SESSION_IDLE_TTL_SECONDS = 15 * 60
_XINGYAO_AGENT_IDLE_TTL_SECONDS = 10 * 60
_XINGYAO_AGENT_READY_TIMEOUT_SECONDS = 120
_XINGYAO_AGENT_PROGRESS_INTERVAL_SECONDS = 15
```

Configuration, provider, model, profile, and skill-grant signature changes invalidate a cached Agent before the next prompt. Eviction must happen outside `_agent_cache_lock` when cleanup can block.

- [ ] **Step 4: Add bounded initialization progress**

While waiting for Agent readiness, emit a sanitized `activity.updated` event with label `Preparing AI session` and status `running`. Any emitted event must refresh Product's event-idle clock. On readiness emit the existing ready/progress transition; on timeout emit the stable error code.

- [ ] **Step 5: Verify Gateway security and lifecycle suites**

```powershell
uv run pytest -q tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_ws_transport.py tests/xingyao/test_gateway_protocol.py tests/gateway/test_agent_cache.py tests/test_tui_gateway_server.py
uv run ruff check tui_gateway/server.py tests/xingyao tests/gateway/test_agent_cache.py
git diff --check
```

Expected: focused tests and lint pass; secret scans in the tests find no forbidden payload fields.

- [ ] **Step 6: Commit Gateway lifecycle changes**

```powershell
git add tui_gateway/server.py tests/test_tui_gateway_server.py tests/gateway/test_agent_cache.py tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_ws_transport.py tests/xingyao/test_gateway_protocol.py
git diff --cached --check
git commit -m "feat(gateway): retain resumable conversation agents"
```

## Task 4: Reuse Product Sessions And Enforce Submit-Once Semantics

**Files:**

- Modify: `features/ai/hermes/gateway-contracts.ts`
- Modify: `features/ai/hermes/gateway-contracts.test.ts`
- Modify: `features/ai/hermes/gateway-client.ts`
- Modify: `features/ai/hermes/gateway-client.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/native-assistant/gateway-executor.ts`
- Modify: `features/ai/native-assistant/gateway-executor.test.ts`

- [ ] **Step 1: Write failing session-reuse tests**

Test the executor state machine:

```text
no session -> create -> CAS -> submit once
valid session -> resume with fresh capability -> submit once
expired session -> create one replacement -> CAS -> submit once
CAS conflict before submit -> reload -> resume winner -> submit once
transport loss before acknowledgement -> one bounded submit retry
transport loss after acknowledgement -> resume/recover only, no submit retry
resume failure after one rebuild -> fail visibly, no Legacy replay
```

Assert that every turn has a different invocation capability even when `sessionId` is reused. Assert the reusable session envelope contains only generation, sessionId, checkpointId, provider, model, and lastUsedAt and contains no identity-bearing fields. Preserve existing clarification and child-session control behavior until Task 6 moves that transient state into the turn recovery ledger.

Run:

```powershell
pnpm vitest run features/ai/hermes/gateway-contracts.test.ts features/ai/hermes/gateway-client.test.ts features/ai/conversation-repository.test.ts features/ai/native-assistant/gateway-executor.test.ts
```

Expected: tests fail because ordinary turns still build a fresh session.

- [ ] **Step 2: Separate transport lifecycle from Gateway session lifecycle**

Update `gateway-client.ts` so `close()` closes only the local WebSocket. Preserve the server session unless Product explicitly calls a destructive session command. Keep connect and ready timeouts at 2 seconds, short RPC timeout at 15 seconds, and set client event idle to 180 seconds. Retain two bounded event-recovery attempts.

- [ ] **Step 3: Replace fresh-only context creation with resume-or-rebuild**

Refactor `buildAndCaptureFreshGatewayContext` into an explicit helper such as:

```ts
type GatewaySessionPreparation = {
  sessionId: string;
  action: "resumed" | "rebuilt";
  generation: number;
};

async function prepareGatewaySession(...): Promise<GatewaySessionPreparation>;
```

Read provider state once, resume when possible, rebuild at most once, and update state through existing generation CAS. A CAS conflict is resolved before `prompt.submit` by rereading and resuming the winning state.

- [ ] **Step 4: Track acknowledgement as an irreversible boundary**

Maintain an executor-local `promptAccepted` boolean that is set only from the Gateway acknowledgement. Before it is true, one retry or Legacy fallback may occur under existing policy. After it is true, only session resume and event recovery are permitted. Tests must count `prompt.submit` calls and prove the count is one.

- [ ] **Step 5: Verify focused Product suites**

```powershell
pnpm vitest run features/ai/hermes/gateway-contracts.test.ts features/ai/hermes/gateway-client.test.ts features/ai/conversation-repository.test.ts features/ai/native-assistant/gateway-executor.test.ts features/ai/conversation-stream-adapter.test.ts
pnpm type-check
pnpm lint -- features/ai/hermes/gateway-contracts.ts features/ai/hermes/gateway-client.ts features/ai/native-assistant/gateway-executor.ts
```

Expected: focused tests, type-check, and scoped lint pass.

- [ ] **Step 6: Commit Product reuse**

```powershell
git add features/ai/hermes/gateway-contracts.ts features/ai/hermes/gateway-contracts.test.ts features/ai/hermes/gateway-client.ts features/ai/hermes/gateway-client.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/native-assistant/gateway-executor.ts features/ai/native-assistant/gateway-executor.test.ts
git diff --cached --check
git commit -m "feat(ai): reuse gateway sessions without duplicate submit"
```

## Task 5: Add Structured Conversation Memory And Token Budgets

**Files:**

- Create: `supabase/migrations/20260803130000_ai_conversation_structured_memory.sql`
- Modify: `lib/db/xingyao-hermes-native-schema-contract.test.ts`
- Modify: `features/ai/conversation-contracts.ts`
- Modify: `features/ai/conversation-contracts.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/conversation-service.ts`
- Modify: `features/ai/conversation-service.test.ts`
- Modify: `features/ai/native-assistant/context-engine.ts`
- Modify: `features/ai/native-assistant/context-engine.test.ts`
- Create: `features/ai/native-assistant/token-budget.ts`
- Create: `features/ai/native-assistant/token-budget.test.ts`
- Modify: `features/ai/native-assistant/gateway-executor.ts`
- Modify: `features/ai/native-assistant/gateway-executor.test.ts`

- [ ] **Step 1: Write failing memory-contract tests**

Add this bounded schema:

```ts
export type ConversationMemorySummary = {
  schemaVersion: 1;
  goals: Array<{ text: string; sourceMessageIds: string[] }>;
  confirmedFacts: Array<{ text: string; sourceMessageIds: string[] }>;
  decisions: Array<{ text: string; sourceMessageIds: string[] }>;
  unresolvedQuestions: Array<{ text: string; sourceMessageIds: string[] }>;
  lastCompactedSequence: number;
};

export type ConversationMemoryDelta = Omit<
  ConversationMemorySummary,
  "schemaVersion" | "lastCompactedSequence"
> & { throughSequence: number };
```

Reject unknown keys, blank text, duplicate source IDs, cross-conversation message IDs, non-monotonic sequence, and arrays over the declared bounds. Do not accept raw prompt transcripts as summary fields.

- [ ] **Step 2: Write failing atomic persistence tests**

The migration must add:

```text
ai_conversations.memory_status text not null default 'ready'
ai_conversations.memory_degraded_at timestamptz
ai_conversation_memory_jobs table with one pending job per conversation/version
finish_ai_chat_turn_v3 RPC
```

`finish_ai_chat_turn_v3` must complete the assistant message, close the turn and invocation, revoke the run capability, and merge the memory delta under `summary_version` CAS in one transaction. If only the memory merge fails, the response remains completed, the previous summary remains unchanged, `memory_status` becomes `degraded`, and an idempotent retry job is inserted. Identity, ownership, and invocation checks from v2 remain intact.

Test rollback for message/turn/invocation failures and the degraded-memory savepoint path separately.

- [ ] **Step 3: Implement deterministic token budgeting**

Create a pure selector with this contract:

```ts
export type ConversationTokenBudget = {
  contextWindowTokens: number;
  reservedSystemTokens: number;
  reservedToolTokens: number;
  reservedAttachmentTokens: number;
  reservedOutputTokens: number;
};

export function estimateConservativeTokens(text: string): number;
export function selectConversationContext(input: {
  currentRequest: GatewayLedgerTranscriptMessage;
  pinnedFacts: GatewayLedgerTranscriptMessage[];
  summary: ConversationMemorySummary;
  recentMessages: GatewayLedgerTranscriptMessage[];
  budget: ConversationTokenBudget;
}): GatewayLedgerTranscriptMessage[];
```

Use a conservative deterministic estimate: count each non-ASCII code point as one token and each group of four ASCII bytes as one token, then add a fixed per-message envelope. Model configuration supplies the context window; unknown models use a conservative configured default. Current request and pinned facts are mandatory. Include summary next, then whole recent messages newest-first. Never split a message.

- [ ] **Step 4: Integrate summary and recent ledger into context assembly**

Replace the current character cap in `gateway-executor.ts` with the token selector. `context-engine.ts` must return the summary version and `lastCompactedSequence` used to build the immutable turn snapshot. Include all completed messages after `lastCompactedSequence` even when memory is degraded.

- [ ] **Step 5: Persist Gateway memory delta at terminal completion**

Parse and validate `memoryDelta` from terminal metadata. Call `finish_ai_chat_turn_v3` once. Do not call the old best-effort `syncConversationSummary` afterward. A malformed or absent delta completes the answer but records `memory_degraded`; it never discards assistant content.

- [ ] **Step 6: Add 20-turn recall and correction tests**

Build a deterministic 20-turn fixture where turn 1 establishes a fact, turn 9 corrects it, turn 14 records a decision, and turn 20 asks for all retained state. Assert the correction supersedes the original, confirmed decisions remain, unresolved questions remain, and the context stays under budget.

Run:

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts features/ai/native-assistant/token-budget.test.ts features/ai/native-assistant/context-engine.test.ts features/ai/native-assistant/gateway-executor.test.ts
pnpm type-check
```

Expected: all focused suites pass, including the 20-turn fixture and degraded-memory path.

- [ ] **Step 7: Commit structured memory**

```powershell
git add supabase/migrations/20260803130000_ai_conversation_structured_memory.sql lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts features/ai/native-assistant/context-engine.ts features/ai/native-assistant/context-engine.test.ts features/ai/native-assistant/token-budget.ts features/ai/native-assistant/token-budget.test.ts features/ai/native-assistant/gateway-executor.ts features/ai/native-assistant/gateway-executor.test.ts
git diff --cached --check
git commit -m "feat(ai): persist structured conversation memory"
```

## Task 6: Add Durable Recovery Snapshots And A Lightweight Status API

**Files:**

- Create: `supabase/migrations/20260803140000_ai_turn_recovery_snapshots.sql`
- Modify: `lib/db/xingyao-hermes-native-schema-contract.test.ts`
- Modify: `features/ai/conversation-contracts.ts`
- Modify: `features/ai/conversation-contracts.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/conversation-service.ts`
- Modify: `features/ai/conversation-service.test.ts`
- Modify: `features/ai/conversation-stream-adapter.ts`
- Modify: `features/ai/conversation-stream-adapter.test.ts`
- Modify: `features/ai/native-assistant/gateway-executor.ts`
- Modify: `features/ai/native-assistant/gateway-executor.test.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.test.ts`

- [ ] **Step 1: Write failing recovery-contract and schema tests**

Add:

```ts
export type TurnRecoverySnapshot = {
  turnId: string;
  status: ConversationTurnStatus;
  eventSequence: number;
  partialContent: string;
  terminalEvent?: ConversationStreamEvent;
  updatedAt: string;
};
```

Require an `ai_chat_turn_events` table keyed by `(turn_id, event_sequence)` and turn snapshot columns for current sequence, partial content, partial update timestamp, and terminal event. Require RPCs `append_ai_chat_turn_recovery_event` and `get_ai_chat_turn_recovery_snapshot` with organization/user/conversation/turn boundaries.

- [ ] **Step 2: Implement bounded persistence**

Persist accepted, context-ready, session action, tool, clarify, cancel, and terminal milestones immediately. Coalesce text into the turn snapshot at most once per second or after 2 KiB of additional UTF-8 content. Never insert one database row per token.

The append RPC must lock the turn, increment `event_sequence`, insert the sanitized milestone, update partial or terminal snapshot fields, and return the assigned sequence. Enforce payload size and allowed event names in SQL and TypeScript.

Move `pendingClarify` and child-session control identifiers out of the reusable `hermesGateway` session envelope into turn-scoped recovery state. Update cancel and clarify routes to read that turn-scoped state after a process restart. Keep a backward-compatible reader for old provider-state records during rollout, but write only the new location. After this task, the persisted `hermesGateway` envelope must match the approved minimal schema.

- [ ] **Step 3: Implement the status endpoint**

`GET /api/ai/conversations/:conversationId/turns/:turnId/status?after=<sequence>` must:

- authenticate through existing conversation route context;
- reject invalid UUIDs and negative cursors;
- return 404 outside organization/user/conversation ownership;
- return 204 when the sequence has not advanced and the turn is active;
- return only `TurnRecoverySnapshot` when it advanced or is terminal;
- set `Cache-Control: no-store`;
- avoid `getHistory`, message-list, turn-list, and provider-state calls.

- [ ] **Step 4: Make stream disconnection subscriber-only**

Ensure `conversation-stream-adapter.ts` detaches the transport on cancel/abort without calling the authoritative executor cancellation path. The executor continues to write snapshots and terminal state. Explicit cancel route behavior remains unchanged.

- [ ] **Step 5: Verify recovery behavior**

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts features/ai/conversation-stream-adapter.test.ts features/ai/native-assistant/gateway-executor.test.ts 'app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.test.ts'
pnpm type-check
```

Expected: refresh/disconnect tests show one authoritative turn and one prompt submission; status route tests prove no full-history calls.

- [ ] **Step 6: Commit recovery persistence**

```powershell
git add supabase/migrations/20260803140000_ai_turn_recovery_snapshots.sql lib/db/xingyao-hermes-native-schema-contract.test.ts features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts features/ai/native-assistant/gateway-executor.ts features/ai/native-assistant/gateway-executor.test.ts 'app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.ts' 'app/api/ai/conversations/[conversationId]/turns/[turnId]/status/route.test.ts'
git diff --cached --check
git commit -m "feat(ai): persist resumable turn snapshots"
```

## Task 7: Replace Full-History Polling And Batch Browser Rendering

**Files:**

- Create: `features/ai/conversation-stream-buffer.ts`
- Create: `features/ai/conversation-stream-buffer.test.ts`
- Modify: `components/dashboard/overview-board.jsx`
- Modify: `components/dashboard/overview-board.test.jsx`

- [ ] **Step 1: Write failing stream-buffer tests**

Test that:

- many deltas in one animation frame produce one message-state update;
- commits occur no more frequently than every 50 milliseconds;
- tool and terminal events flush pending text first;
- duplicate or stale event sequences are ignored;
- scrolling occurs only when the viewport was already near the bottom;
- disposal flushes or transfers pending content without cancelling the turn.

- [ ] **Step 2: Implement a framework-neutral buffer**

Expose `pushDelta`, `flush`, and `dispose` from a small pure module. Inject clock and animation-frame scheduling in tests. Do not put timer policy directly into `overview-board.jsx`.

- [ ] **Step 3: Replace active-turn full-history polling**

Keep one full-history fetch when opening a conversation. During an active turn, call the new status endpoint with the last applied sequence and back off at 1, 2, 4, then 5 seconds. After terminal state, fetch full history once and clear recovery timers.

Route change, component unmount, page refresh, visibility change, and transient fetch failure must preserve the accepted turn ID and reattach on return. Only the cancel button calls the cancel endpoint.

- [ ] **Step 4: Add browser-state regression tests**

Cover:

- switch away during generation and return to the same partial response;
- refresh during generation and reconcile terminal response;
- recover after two network failures;
- avoid duplicate response text when status sequence repeats;
- avoid full-history polling while active;
- do not auto-scroll when the user is reading older content.

Run:

```powershell
pnpm vitest run features/ai/conversation-stream-buffer.test.ts components/dashboard/overview-board.test.jsx
pnpm type-check
pnpm lint -- features/ai/conversation-stream-buffer.ts components/dashboard/overview-board.jsx
```

Expected: tests pass without React act warnings caused by unflushed timers.

- [ ] **Step 5: Commit frontend recovery and batching**

```powershell
git add features/ai/conversation-stream-buffer.ts features/ai/conversation-stream-buffer.test.ts components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx
git diff --cached --check
git commit -m "perf(ai): batch streaming and recover by cursor"
```

## Task 8: Add Production-Like Recovery, Recall, And Restart Gates

**Files:**

- Modify: `scripts/test-xingyao-hermes-e2e.mjs`
- Modify: `scripts/xingyao-hermes-eval-cases.json`
- Create: `scripts/test-ai-conversation-resilience.mjs`
- Create: `scripts/test-ai-conversation-resilience.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing script contract tests**

Require scenario names and exit behavior for:

```text
twenty_turn_recall_and_correction
route_switch_recovery
page_refresh_recovery
network_disconnect_recovery
product_restart_recovery
gateway_restart_recovery
expired_agent_single_rebuild
terminal_persist_failure_visibility
clarify_after_recovery
cancel_after_recovery
```

The runner must use generated local UUIDs and disposable local database records. It must refuse production URLs unless `RUN_AI_RESILIENCE_CANARY=1` and an explicit canary organization/user pair are provided. It must never manufacture or print production credentials.

- [ ] **Step 2: Implement a resumable scenario runner**

Record sanitized per-turn stage timings, submit count, session action, recovery attempts, and terminal status. On failure, print IDs and stable error codes only. Always clean up local test records; never delete production records.

Add:

```json
"test:ai-resilience": "node --test scripts/test-ai-conversation-resilience.test.mjs && node scripts/test-ai-conversation-resilience.mjs --local"
```

- [ ] **Step 3: Verify full focused Product gate**

```powershell
pnpm test:ai-performance
pnpm test:ai-resilience
pnpm test:ai-system
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: all commands pass. If an unrelated baseline failure appears, record it with command output and do not label this task complete until focused AI suites and build pass.

- [ ] **Step 4: Commit resilience gates**

```powershell
git add scripts/test-xingyao-hermes-e2e.mjs scripts/xingyao-hermes-eval-cases.json scripts/test-ai-conversation-resilience.mjs scripts/test-ai-conversation-resilience.test.mjs package.json
git diff --cached --check
git commit -m "test(ai): gate durable conversation recovery"
```

## Task 9: Document Release, Canary, Metrics, And Rollback

**Files:**

- Modify: `docs/runbooks/xingyao-hermes-gateway.md`
- Create: `docs/runbooks/ai-conversation-performance-rollout.md`
- Modify: `.env.example`
- Modify: `lib/config/env.ts`
- Modify: `lib/config/env.test.ts`
- Modify: `app/api/health/route.ts`
- Modify: `app/api/health/route.test.ts`

- [ ] **Step 1: Write failing feature-flag and health-contract tests**

Add server-only flags for session reuse, structured memory, recovery snapshots, and stream batching. Default all rollout flags to false. Health output may expose enabled/configured booleans and release identity, but no allowlist values or secrets.

Use these exact names:

```text
XINGYAO_HERMES_SESSION_REUSE_ENABLED
XINGYAO_HERMES_STRUCTURED_MEMORY_ENABLED
XINGYAO_HERMES_TURN_RECOVERY_ENABLED
XINGYAO_HERMES_STREAM_BATCHING_ENABLED
```

Test that disabling any phase returns to the previous compatible behavior without deleting state.

- [ ] **Step 2: Write the deployment order**

The runbook must require:

1. Exact Product and Gateway commits and clean source trees.
2. Gateway release first with lifecycle flags disabled.
3. Database backup and additive migrations.
4. Product release with all new behavior disabled.
5. Phase 0 telemetry observation.
6. One organization/user canary for 24 hours.
7. At least 100 Fast samples before 5 percent expansion.
8. 5 percent, 25 percent, and 100 percent stages with complete observation windows.
9. PM2 dump persistence, systemd enablement, health checks, and immutable release evidence.

- [ ] **Step 3: Define SQL and API evidence checks**

Include queries for success rate, first-delta P95, total P95, session resume rate, Agent rebuild duration, recovery success, duplicate submit count, degraded memory count, terminal persistence failures, and active-turn leaks. Queries must aggregate timings and counts only.

Release gates:

```text
Fast success >= 99 percent over >= 100 samples
Fast first-delta P95 <= 8 seconds
Fast total P95 <= 30 seconds
Recovery endpoint P95 <= 200 milliseconds
20-turn recall suite passes
duplicate submit count = 0
terminal persistence failures = 0
tenant/capability violations = 0
```

- [ ] **Step 4: Define automatic rollback**

Rollback removes the affected Gateway allowlist and disables the phase flag, then restarts Product with `--update-env` and saves PM2 state. It preserves provider state, Gateway sessions, turns, messages, summaries, recovery snapshots, telemetry, and release evidence.

Trigger rollback for a 15-minute success rate below 99 percent, two consecutive total-P95 breaches, any duplicate prompt/tool execution, terminal persistence failure, tenant mismatch, secret leak, or active turn exceeding its declared budget.

- [ ] **Step 5: Verify configuration and docs**

```powershell
pnpm vitest run lib/config/env.test.ts app/api/health/route.test.ts
pnpm prettier --check docs/runbooks/xingyao-hermes-gateway.md docs/runbooks/ai-conversation-performance-rollout.md .env.example lib/config/env.ts app/api/health/route.ts
git diff --check
```

Expected: config and health tests pass; docs formatting and diff checks pass.

- [ ] **Step 6: Commit rollout controls**

```powershell
git add docs/runbooks/xingyao-hermes-gateway.md docs/runbooks/ai-conversation-performance-rollout.md .env.example lib/config/env.ts lib/config/env.test.ts app/api/health/route.ts app/api/health/route.test.ts
git diff --cached --check
git commit -m "docs(ai): define performance rollout and rollback"
```

## Task 10: Final Review And Release Readiness

- [ ] **Step 1: Review spec coverage**

Confirm every requirement in `docs/superpowers/specs/2026-08-03-ai-conversation-performance-resilience-design.md` maps to at least one implementation task and one test. Verify especially:

- 15-minute session TTL and 10-minute Agent TTL;
- fresh capability per turn;
- submit-once boundary;
- 120-second Agent initialization and 180-second event idle;
- 15-second progress heartbeat;
- atomic memory/degraded-memory behavior;
- 1-second or 2-KiB partial snapshot coalescing;
- 1/2/4/5-second recovery backoff;
- 50-millisecond render batching;
- one-user to 5/25/100-percent rollout.

- [ ] **Step 2: Scan for incomplete implementation markers**

```powershell
rg -n "TODO|TBD|FIXME|NotImplemented|throw new Error\(\"not implemented" features/ai app/api/ai components/dashboard scripts docs/runbooks supabase/migrations
```

Expected: no marker introduced by this implementation remains in changed files.

- [ ] **Step 3: Run Product release verification**

```powershell
pnpm test:ai-performance
pnpm test:ai-resilience
pnpm test:ai-system
pnpm type-check
pnpm lint
pnpm build
pnpm check:changed-format
git diff --check
git status --short
```

Expected: all commands pass and the Product worktree is clean after commits.

- [ ] **Step 4: Run Gateway release verification**

From the Gateway worktree:

```powershell
uv run pytest -q tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_ws_transport.py tests/xingyao/test_gateway_protocol.py tests/gateway/test_agent_cache.py tests/test_tui_gateway_server.py
uv run ruff check tui_gateway/server.py tests/xingyao tests/gateway/test_agent_cache.py
git diff --check
git status --short
```

Expected: all commands pass and the Gateway worktree is clean after commits.

- [ ] **Step 5: Produce immutable release evidence before deployment**

Record, without secrets:

```text
Product commit and tree hash
Gateway commit and tree hash
migration filenames and checksums
Product BUILD_ID and release manifest checksum
Gateway source checksum and protocol/profile versions
focused test summaries
build result
rollback artifact paths and checksums
canary organization/user pair hash
```

Do not call queued CI passing. Do not call a canary successful until the complete observation window and sample gates pass.
