# AI Conversation Performance and Resilience Design

**Status:** Approved for implementation planning

**Date:** 2026-08-03

**Baseline:** Product `03e67fc2f4bf3c5eeaf5cf4b1de6bf9ba91a678a`; Gateway `de80fbf83f13fd8e72d2efe66961baa385dd5919`

## Goal

Make Xingyao AI conversations fast, durable, and context-aware without weakening organization, user, role, conversation, capability, or read-scope isolation.

The first release must meet all of these conditions:

- Fast-mode successful turn rate is at least 99 percent.
- Fast-mode end-to-end P95 is at most 30 seconds.
- Fast-mode first-delta P95 is at most 8 seconds.
- Leaving, refreshing, or reconnecting to the page does not cancel an accepted turn.
- A 20-turn conversation retains confirmed facts, corrections, decisions, and unresolved questions.
- A prompt accepted by Gateway is never submitted a second time automatically.

## Current Baseline

The production review found the following:

- Five turns completed after the current release was activated. Their end-to-end durations were 11.53, 36.90, 38.23, 46.95, and 62.64 seconds. This is a 38.23-second median and a 59.50-second sample P95.
- Every ordinary turn creates a new Gateway session. The previous `sessionId` stored in provider state is not resumed for the next ordinary turn.
- Product idle timeout and the Xingyao Agent initialization timeout are both 120 seconds, creating a boundary race.
- All 18 production conversations have an empty summary and `summary_version = 0`.
- The active canary conversation contains 43,446 message characters, while prompt construction keeps at most 24,000 characters.
- Recovery polls the complete conversation once per second. The largest production conversation currently contains 97,755 message characters.
- Every streamed delta can trigger a React state update and an automatic scroll.
- The existing performance contract records fixture latency but has no latency or first-delta threshold.

## Scope

This design changes five connected areas:

1. Conversation-scoped Gateway session reuse and Agent lifecycle.
2. Structured summary and token-aware context assembly.
3. Durable turn ownership and cursor-based recovery.
4. Batched browser rendering for streamed output.
5. Stage-level telemetry, release gates, and rollback automation.

The work is delivered in independently releasable phases. Legacy runtime remains available throughout the rollout.

## Non-Goals

- Do not replace Hermes provider routing, model selection, tool governance, or capability issuance.
- Do not allow Hermes to mutate product business data.
- Do not weaken actor assertions, invocation capabilities, tenant isolation, or state sanitization.
- Do not introduce a general-purpose distributed job platform in the first release.
- Do not persist chain-of-thought or raw prompts in performance telemetry.
- Do not delete existing turns, messages, checkpoints, summaries, or rollback artifacts during rollout.

## Architecture

### 1. Conversation-Scoped Session Lifecycle

One AI conversation owns one resumable Gateway session at a time.

Provider state remains minimal and sanitized:

```ts
type HermesGatewayProviderState = {
  generation: number;
  sessionId: string;
  checkpointId?: string;
  provider: string;
  model: string;
  lastUsedAt: string;
};
```

Identity-bearing fields do not enter provider state. Gateway validates organization, user, role, conversation, profile, skill grants, and invocation identity from the new actor assertion and invocation capability issued for every turn.

For an ordinary turn:

1. Persist the turn as accepted.
2. Prepare the immutable turn context and issue a new invocation capability.
3. Read provider state using the existing organization, owner, and conversation boundary.
4. If a `sessionId` exists, connect and call `session.resume` with the new assertion and capability.
5. If resume reports an expired, missing, or incompatible session, create one replacement session and update provider state with generation-based compare-and-swap.
6. Submit the prompt once.
7. Persist the authoritative terminal state.
8. Close the WebSocket transport while retaining the Gateway session and Agent for reuse.

The product performs at most one session rebuild per turn. A CAS conflict causes a fresh state read and resume attempt; it does not cause another prompt submission.

Session idle time-to-live is 15 minutes. Agent idle time-to-live is 10 minutes. Configuration, provider, model, profile, or skill-grant changes invalidate the reusable Agent before the next prompt. Eviction is transparent and produces one controlled rebuild.

The process-local active-run registry remains an optimization for immediate cancel and clarify calls. Database turn state and Gateway session state remain authoritative after a process restart.

### 2. Durable Turn Ownership

The server-side executor owns a turn after database acceptance. HTTP and SSE transports are subscribers and never own cancellation rights.

- Request abort, browser navigation, page unmount, tab suspension, and network loss detach the subscriber only.
- Explicit user cancellation calls the authenticated cancel endpoint and interrupts the authoritative Gateway session.
- Prompt retry is allowed once only before Gateway acknowledges `prompt.submit`.
- After acknowledgement, recovery is limited to `session.resume` and event replay.
- Legacy fallback is allowed only before Gateway accepts the prompt. An accepted Gateway turn cannot be replayed through Legacy.

### 3. Structured Conversation Memory

Conversation context has three layers:

1. **Pinned facts:** confirmed identity, goals, constraints, corrections, and decisions that must not be truncated.
2. **Structured summary:** goals, confirmed facts, decisions, unresolved questions, source message identifiers, and `lastCompactedSequence`.
3. **Recent ledger:** completed user, assistant, and tool messages selected by a model-aware token budget.

The summary schema is bounded and versioned:

```ts
type ConversationMemorySummary = {
  schemaVersion: 1;
  goals: Array<{ text: string; sourceMessageIds: string[] }>;
  confirmedFacts: Array<{ text: string; sourceMessageIds: string[] }>;
  decisions: Array<{ text: string; sourceMessageIds: string[] }>;
  unresolvedQuestions: Array<{ text: string; sourceMessageIds: string[] }>;
  lastCompactedSequence: number;
};
```

Every successful Gateway turn emits a schema-validated `memoryDelta`. The terminal database transaction writes the assistant response, merges the delta with summary-version compare-and-swap, advances `lastCompactedSequence`, and increments `summary_version`.

Summary failure does not discard messages. The conversation is marked `memory_degraded`, the previous summary remains valid, and all messages after `lastCompactedSequence` remain eligible for the next prompt. A durable idempotent maintenance record retries the summary merge. Successful retry clears the degraded state.

Context assembly uses provider token limits rather than JavaScript character count. It reserves capacity for system instructions, tools, attachments, and output before selecting context. Current request and pinned facts are mandatory. Structured summary is included next. Recent messages fill the remaining budget from newest to oldest without splitting a message in the middle.

### 4. Cursor-Based Event Recovery

Every public turn event has a monotonically increasing `eventSequence` scoped to the turn.

Persist these events immediately:

- turn accepted and context ready
- session resumed, rebuilt, or degraded
- tool and clarification milestones
- cancellation request and result
- terminal completion or failure

Text deltas are coalesced into a partial assistant snapshot at most once per second or after 2 KiB of additional text, whichever occurs first. Token-by-token database writes are prohibited.

A lightweight status endpoint returns only:

```ts
type TurnRecoverySnapshot = {
  turnId: string;
  status: string;
  eventSequence: number;
  partialContent: string;
  terminalEvent?: ConversationStreamEvent;
  updatedAt: string;
};
```

It does not load conversation history, all messages, all turns, or provider state. The browser resumes from its last sequence. If streaming reconnection is unavailable, status polling backs off through 1, 2, 4, and 5 seconds, then remains at 5 seconds until terminal state.

Opening a conversation still loads full history once. Active-turn recovery uses only the lightweight endpoint. After terminal state, the client refreshes full history once to reconcile authoritative message metadata.

### 5. Stream Rendering

The browser buffers text deltas and commits them at most once per animation frame and no more frequently than every 50 milliseconds. Each batch performs one message update and one conditional scroll.

Automatic scrolling occurs only when the user is already near the bottom. Reading older content must not be interrupted by incoming tokens. Tool, activity, todo, and subagent events remain independently bounded by their existing display limits.

### 6. Timeout Contract

Timeouts have separate meanings and must not share the same boundary:

- WebSocket connect: 2 seconds.
- Gateway ready handshake: 2 seconds.
- Short control RPC: 15 seconds.
- Xingyao Agent initialization: 120 seconds.
- Client event idle: 180 seconds.
- Initialization progress heartbeat: at least once every 15 seconds.
- Recovery attempts after an accepted prompt: two resume attempts with bounded backoff.

Agent initialization emits a public progress event without internal stack, prompt, secret, or chain-of-thought content. Receipt of any valid event resets the client idle timer.

## Error Handling

Errors are classified by stage:

- `gateway_connect_failed`
- `gateway_resume_failed`
- `gateway_session_rebuilt`
- `gateway_agent_initialization_timed_out`
- `gateway_prompt_submit_failed`
- `gateway_event_recovery_failed`
- `gateway_terminal_persist_failed`
- `conversation_memory_degraded`

Public responses remain sanitized. Structured logs include turn ID, conversation ID hash, stage, elapsed milliseconds, attempt count, session action, provider/model identity hash, and final code. They exclude prompt text, response content, service tokens, assertions, capabilities, and private keys.

Terminal persistence failure is never converted into apparent success. Duplicate prompt submission, cross-tenant state, or a mismatched actor assertion is a release-blocking security incident.

## Observability

Each turn records:

- `acceptedAt`
- `contextReadyAt`
- `sessionReadyAt`
- `sessionAction` as `resumed` or `rebuilt`
- `agentReadyAt`
- `firstDeltaAt`
- `terminalAt`
- `persistedAt`

Derived metrics include:

- acceptance-to-first-delta latency
- acceptance-to-terminal latency
- terminal-to-persisted latency
- session resume success rate
- Agent rebuild rate and duration
- disconnect recovery success rate
- duplicate submission count
- summary merge success and degraded-memory count
- lightweight recovery endpoint latency and payload size

Metrics are segmented by Fast/Deep mode, resumed/rebuilt session, provider/model identity hash, and release commit. No prompt or response text is exported.

## Test Strategy

### Unit Tests

- Resume an existing session with a new turn capability.
- Rebuild once after an expired session.
- Prevent resubmission after prompt acknowledgement.
- Preserve tenant and conversation boundaries during resume.
- Merge memory deltas with summary-version CAS.
- Retain uncompacted messages after summary failure.
- Select context by token budget without truncating mandatory facts.
- Batch browser deltas and scrolling.

### Integration Tests

- Twenty-turn conversation recalls a first-turn fact.
- A later correction supersedes the original fact.
- Refresh, route change, and network interruption recover the same turn.
- Product and Gateway process restarts recover without duplicate execution.
- Expired Agent causes one rebuild and then completes.
- Terminal persistence failure remains visible and retryable.
- Clarification and cancellation work after transport recovery.

### Performance Tests

Performance fixtures are replaced or supplemented with timed executable scenarios. CI fails when the agreed budgets regress. A production-like canary run supplies at least 100 Fast samples before expansion beyond the initial allowlist.

### Security Tests

- Cross-organization and cross-user session resume are rejected.
- Conversation and invocation drift are rejected.
- Stale, replayed, or revoked capabilities are rejected.
- Gateway process environment contains no actor private key.
- Telemetry and event persistence contain no prompt, secret, assertion, or capability.

## Rollout

### Phase 0: Measurement

Deploy stage timestamps and dashboards without changing execution behavior. Record the existing Fast success rate, first-delta latency, total latency, rebuild rate, and disconnect rate.

### Phase 1: Gateway Lifecycle

Deploy resume validation, Agent/session TTL, initialization heartbeat, and timeout separation behind disabled feature flags. Verify Gateway protocol and security tests before enabling Product reuse.

### Phase 2: Product Session Reuse

Enable reuse for one canary organization/user pair for 24 hours. Require no duplicate prompt, identity mismatch, terminal persistence failure, or active-turn leak. Compare resumed and rebuilt latency separately.

### Phase 3: Conversation Memory

Deploy atomic memory-delta persistence and token-aware context assembly. Run the 20-turn recall and correction suite before enabling it for the canary.

### Phase 4: Recovery and Rendering

Deploy the lightweight recovery endpoint, cursor resumption, backoff, and browser batching. Verify route switching, refresh, network loss, and process restart scenarios.

### Phase 5: Expansion

Expand Gateway traffic from one user to 5 percent, 25 percent, and 100 percent. Each stage must satisfy release gates for a complete observation window before expansion.

## Release Gates

- At least 99 percent successful Fast turns over at least 100 representative samples.
- Fast end-to-end P95 at most 30 seconds.
- Fast first-delta P95 at most 8 seconds.
- Lightweight recovery endpoint P95 at most 200 milliseconds.
- Twenty-turn recall and correction suite passes completely.
- Disconnect and process-restart recovery produce no duplicate prompt.
- Zero terminal persistence failures, cross-tenant events, and leaked secrets.

## Automatic Rollback

Rollback is triggered when any of these conditions occurs:

- Fast success rate falls below 99 percent in a 15-minute window.
- Fast P95 exceeds 30 seconds in two consecutive windows.
- Any duplicate prompt, duplicate tool execution, terminal persistence failure, tenant mismatch, or capability boundary violation occurs.
- Active turns cannot reach a terminal state within their declared execution budget.

Rollback removes the affected Gateway allowlist and restores Legacy execution. It does not delete provider state, sessions, messages, summaries, turns, or evidence. The rollout owner captures health, PM2 runtime identity, Gateway commit, error distribution, and rollback timestamp before resuming investigation.

## Delivery Boundaries

The work should be implemented as five reviewable changesets:

1. Telemetry and enforceable performance budgets.
2. Gateway session/Agent lifecycle and timeout contract.
3. Product session reuse and duplicate-submit protection.
4. Structured memory and token-aware context.
5. Cursor recovery and browser rendering batches.

Each changeset must pass focused tests, type-check, lint, formatting, build, and diff checks. Gateway and Product changes are released independently, with backward-compatible protocol handling and Legacy fallback retained until the full rollout is certified.
