# Xingyao Conversation Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a durable, owner-scoped conversation protocol for Xingyao AI Assistant with meaningful-output validation, idempotent turns, true retry/regenerate semantics, typed streaming events, and server-owned history.

**Architecture:** Keep the existing AI gateway and grounding pipeline, then place a product-owned conversation ledger around it. A repository/service layer owns conversation, message, and turn transitions. New App Router endpoints expose the protocol while `/api/ai/chat` remains temporarily compatible. The dashboard lazily creates a server conversation and renders state from typed events instead of submitting the word “重试”.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase/Postgres RLS, SSE, Vitest, existing AI gateway and invocation ledger.

---

### Task 1: Meaningful Streaming Output Gate

**Files:**
- Modify: `features/ai/llm-gateway-stream.ts`
- Modify: `features/ai/llm-gateway-stream.test.ts`

- [x] Add failing tests for punctuation-only output, one automatic same-provider retry, valid buffered Markdown, and fallback after an invalid retry.
- [x] Run the focused test and confirm the new cases fail.
- [x] Buffer deltas until semantic content appears and make an invalid completed stream retryable.
- [x] Run the focused gateway tests and confirm all existing fallback behavior remains green.

### Task 2: Conversation Protocol Contracts

**Files:**
- Create: `features/ai/conversation-contracts.ts`
- Create: `features/ai/conversation-contracts.test.ts`

- [x] Add contract tests for ID/status validation, typed event envelopes, retry/regenerate commands, and meaningful completed messages.
- [x] Implement narrow shared types and runtime parsers without coupling React to database row types.
- [x] Verify contract tests pass.

### Task 3: Durable Conversation Schema

**Files:**
- Create: `supabase/migrations/20260711100000_xingyao_conversation_protocol.sql`
- Modify: `lib/db/schema-contract.test.ts`

- [x] Add failing schema assertions for `ai_conversations`, `ai_chat_messages`, `ai_chat_turns`, owner-scoped RLS, sequence uniqueness, idempotency, and active-turn constraints.
- [x] Add the migration with organization/owner foreign keys, status checks, indexes, triggers, grants, and RLS policies matching existing helpers.
- [x] Run the schema contract test.

### Task 4: Repository And State Machine

**Files:**
- Create: `features/ai/conversation-repository.ts`
- Create: `features/ai/conversation-repository.test.ts`
- Create: `features/ai/conversation-service.ts`
- Create: `features/ai/conversation-service.test.ts`

- [x] Write repository tests for owner-scoped create/list/read, ordered messages, idempotent turn insertion, and atomic terminal state updates.
- [x] Write service tests for normal turns, duplicate client request IDs, retry without a user message, regenerate with answer versioning, and invalid transitions.
- [x] Implement repository interfaces plus Supabase adapter methods.
- [x] Implement the turn state machine and immutable context snapshots.
- [x] Run focused repository/service tests.

### Task 5: Conversation APIs And Typed SSE

**Files:**
- Create: `app/api/ai/conversations/route.ts`
- Create: `app/api/ai/conversations/[conversationId]/route.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/route.ts`
- Create: `app/api/ai/turns/[turnId]/retry/route.ts`
- Create: `app/api/ai/turns/[turnId]/regenerate/route.ts`
- Create focused route tests beside each route or in `app/api/ai/conversations/route.test.ts`
- Modify: `app/api/ai/chat/route.ts`
- Modify: `app/api/ai/chat/route.test.ts`

- [x] Write route tests for auth, ownership, idempotency, normal streaming, failed streaming, retry, and regenerate.
- [x] Extract/reuse the existing grounding and gateway execution path rather than duplicating provider logic.
- [x] Emit `turn.started`, `context.ready`, `response.delta`, `response.completed`, `response.failed`, and heartbeat envelopes.
- [x] Persist terminal state before emitting the terminal event.
- [x] Keep legacy chat behavior compatible while applying the same output quality gate.
- [x] Run all affected route tests.

### Task 6: Dashboard Conversation Client

**Files:**
- Modify: `components/dashboard/overview-board.jsx`
- Modify: `components/dashboard/overview-board.test.jsx`

- [x] Add failing tests that lazily create a conversation, send a client request ID, parse typed events, restore history, and retry without a new user bubble.
- [x] Replace local-history context submission with server conversation IDs; keep only active conversation ID and drafts in browser storage.
- [x] Render pending/failed/completed state and wire retry/regenerate to their dedicated endpoints.
- [x] Fall back to a clear error state if conversation initialization fails; do not silently treat local messages as trusted context.
- [x] Run focused dashboard tests.

### Task 7: Verification And Rollout Safety

**Files:**
- All files changed above.

- [x] Run focused AI gateway, contract, repository, service, route, schema, and dashboard tests.
- [x] Run `git diff --check`, file-scoped lint, `pnpm type-check`, and `pnpm build`.
- [ ] Start the app on an available local port and verify first-turn success, punctuation-only recovery, refresh restore, retry, and regenerate in desktop and narrow-window layouts.
- [x] Record any unrelated pre-existing failures without modifying their files.

Authenticated end-to-end conversation verification remains pending because the local Supabase service at `127.0.0.1:54321` is not running. The dashboard layout was visually verified at desktop and `1024x768`; 114 focused protocol tests, file-scoped lint, type-check, and production build pass. The database-backed first-turn, restore, retry, regenerate, RLS, lease recovery, lock ordering, and one-successor constraints still require the migration to be applied and exercised on a running Supabase/Postgres instance.
