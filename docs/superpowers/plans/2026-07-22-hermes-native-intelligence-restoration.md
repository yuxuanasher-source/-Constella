# 星耀 AI：Hermes 原生智能恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把经营舱内的“星耀 AI”切换到固定版本的官方 Hermes TUI Gateway 与原生 `AIAgent`，恢复 Session、压缩、Todo、Clarify、Skills、个人记忆、安全 Web、隔离计算和只读子智能体，同时保证当前 provider/model 不变、业务数据只读、组织与角色权限不可绕过。

**Architecture:** 产品后端是唯一入口和权威账本；它通过本机 WebSocket/JSON-RPC 连接官方 TUI Gateway。Gateway 只持有模型配置和产品公钥，通过 invocation 级 opaque capability 调用产品 Tool Broker。Tool Broker 每次重新校验当前组织成员关系、角色、scope、Skill grant、轮次租约和调用幂等性，再复用现有 Read API 核心或专用 AI 状态 Repository。官方 SessionDB 只作为按组织+用户隔离的运行缓存，丢失后由产品账本重建。

**Tech Stack:** Next.js 16 App Router、TypeScript、React 19、Supabase/PostgreSQL RLS、Vitest/React Testing Library、`ws`、Python 3.12+、官方 Hermes Agent `v2026.7.20`、aiohttp/FastAPI WebSocket、pytest、Docker 无网络沙箱、systemd、PM2。

---

## 0. 不可变边界

实现期间以下约束不能被“临时打通”或留到上线前再补：

- 用户仍只看到“星耀 AI”，浏览器不连接 Gateway。
- Fork 必须从官方签名标签 `v2026.7.20`（commit `3ef6bbd201263d354fd83ec55b3c306ded2eb72a`）建立；不得把旧 Fork 整体合并回官方基线。
- 官方 Agent Loop、压缩算法和委派算法保持原样，只增加身份、策略、状态和事件扩展钩子。
- Gateway 不得拥有 Supabase URL、service-role key、产品 Read API token 或 Actor 私钥。
- 当前 provider/model 不变；拒绝 `fallback_model`、`fallback_providers`、会话 `/model` 切换和静默 Legacy fallback。
- 所有 `xingyao_*` 经营工具只读；项目、主播、报数、结算、权限、知识库写路径在工具注册、网络和凭证三层都不可达。
- 第一阶段不注册主机终端、任意文件写入、浏览器点击/输入、Cron、消息发送、Home Assistant、通用 MCP、图片生成或付费外部动作。
- 只允许写三类 AI 状态：产品会话账本、本人个人记忆、本人 Skill 草稿。Skill 发布必须人工批准。
- 不记录模型私有思维链、完整 JWS、opaque capability、密钥或未脱敏网页正文。
- 新 Gateway 使用 `127.0.0.1:8643`；Legacy `/v1/xingyao/runs` 保留在 `8642`，只允许通过服务端开关整轮切换。

## 1. 双仓库与分支纪律

产品仓库与 Hermes Fork 是两个可独立构建、可独立回滚的发布物，但在产品形态上仍是同一个经营舱能力。

| 发布物      | 基线                           | 实施分支                                       | 目标                                                    |
| ----------- | ------------------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| 产品        | 当前规格分支，父提交 `d8e066c` | `codex/hermes-native-intelligence-restoration` | 会话账本、Bridge、Tool Broker、UI、开关和部署门禁       |
| Hermes Fork | 官方 tag `v2026.7.20`          | `codex/xingyao-hermes-native-v2`               | 官方 Gateway 上的窄策略层、租户 Session、工具与状态插件 |

- [ ] **Step 1: 验证产品设计提交与工作区**

在 `C:\Users\admin\Documents\版本2\.worktrees\hermes-native-intelligence-restoration-design` 运行：

```powershell
git status --short --branch
git log -2 --oneline
git switch -c codex/hermes-native-intelligence-restoration
```

预期：工作区干净，历史包含 `5eaebea docs: design Hermes native intelligence restoration`；新分支创建成功。

- [ ] **Step 2: 从官方标签建立独立 Hermes worktree**

在 `C:\Users\admin\Documents\xingyao-hermes-agent` 运行：

```powershell
git fetch --tags upstream
git rev-parse 'v2026.7.20^{commit}'
git worktree add .worktrees\xingyao-hermes-native-v2 -b codex/xingyao-hermes-native-v2 v2026.7.20
git -C .worktrees\xingyao-hermes-native-v2 status --short --branch
```

预期：`rev-parse` 输出完整 commit `3ef6bbd201263d354fd83ec55b3c306ded2eb72a`，新 worktree 干净。若 `upstream` 不存在，先执行 `git remote add upstream https://github.com/NousResearch/hermes-agent.git`，再重新 fetch；不要改写现有 `origin`。

- [ ] **Step 3: 为两个发布物建立基线证据**

```powershell
git rev-parse HEAD
git -C C:\Users\admin\Documents\xingyao-hermes-agent\.worktrees\xingyao-hermes-native-v2 rev-parse HEAD
git -C C:\Users\admin\Documents\xingyao-hermes-agent\.worktrees\xingyao-hermes-native-v2 describe --tags --exact-match
```

把三行输出保存在后续 Task 19 创建的发布证据清单中。此步骤不产生提交。

## 2. 目标文件结构

### 产品仓库

- Modify `features/ai/hermes/contracts.ts`
- Create `features/ai/hermes/gateway-contracts.ts`
- Create `features/ai/hermes/gateway-client.ts`
- Create `features/ai/hermes/runtime-selection.ts`
- Create `features/ai/hermes/run-capability.ts`
- Create `features/ai/hermes/live-actor-authorization.ts`
- Create `features/ai/hermes/tool-broker-contracts.ts`
- Create `features/ai/hermes/tool-broker.ts`
- Create `features/ai/hermes/hermes-state-repository.ts`
- Create `features/ai/hermes/memory-policy.ts`
- Create `features/ai/hermes/approved-skill-registry.ts`
- Create `features/ai/hermes/skill-signing.ts`
- Create `features/ai/hermes/builtin-skills/business-context/SKILL.md`
- Create `features/ai/hermes/builtin-skills/project-review/SKILL.md`
- Create `features/ai/hermes/builtin-skills/report-precheck/SKILL.md`
- Create `features/ai/hermes/builtin-skills/settlement-analysis/SKILL.md`
- Create `features/ai/hermes/active-run-registry.ts`
- Create matching `*.test.ts` files for every module above
- Create `features/ai/native-assistant/gateway-executor.ts`
- Create `features/ai/native-assistant/legacy-turn-executor.ts`
- Modify `features/ai/conversation-contracts.ts`
- Modify `features/ai/conversation-repository.ts`
- Modify `features/ai/conversation-service.ts`
- Modify `features/ai/conversation-stream-adapter.ts`
- Create `app/api/internal/hermes/tools/execute/route.ts`
- Create `app/api/internal/hermes/capabilities/derive/route.ts`
- Create `app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.ts`
- Create `app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.ts`
- Modify `app/api/ai/turns/[turnId]/retry/route.ts`
- Modify `app/api/ai/turns/[turnId]/regenerate/route.ts`
- Create `app/api/ai/hermes/skill-drafts/[draftId]/review/route.ts`
- Create route tests beside each new route
- Modify `app/api/ai/conversations/[conversationId]/turns/route.ts`
- Modify `components/dashboard/overview-board.jsx`
- Modify `components/dashboard/overview-board.test.jsx`
- Create `components/dashboard/hermes-skill-draft-review.jsx`
- Create `components/dashboard/hermes-skill-draft-review.test.jsx`
- Create `supabase/migrations/20260722100000_xingyao_hermes_native_state.sql`
- Create `lib/db/xingyao-hermes-native-schema-contract.test.ts`
- Modify `lib/config/env.ts`, `lib/config/env.test.ts`, `app/api/health/route.ts`, `app/api/health/route.test.ts`, `.env.example`, `package.json`, `pnpm-lock.yaml`
- Create `scripts/test-xingyao-hermes-e2e.mjs`
- Create `scripts/verify-xingyao-hermes-release.mjs`
- Create `scripts/verify-xingyao-hermes-release.test.mjs`
- Create `scripts/create-xingyao-hermes-rollback.sh`
- Create `scripts/create-xingyao-hermes-rollback.test.mjs`
- Create `docs/runbooks/xingyao-hermes-gateway.md`

### Hermes Fork

- Create `xingyao/upstream_provenance.py`
- Port and adapt `xingyao/actor_assertion.py`, `execution_context.py`, `tool_policy.py`, `errors.py`, `secret_redaction.py`, `skill_registry.py`
- Replace old direct Read API client with `xingyao/tool_broker_client.py`
- Create `xingyao/gateway_auth.py`, `profile_scope.py`, `run_budget.py`, `model_config_gate.py`, `sandbox_policy.py`, `web_policy.py`, `attachment_policy.py`
- Create `xingyao/SOUL.md`
- Create `tools/xingyao_business_tools.py`, `tools/xingyao_state_tools.py`, `tools/xingyao_attachment_tool.py`
- Create `plugins/memory/xingyao/__init__.py`, `provider.py`
- Modify `pyproject.toml`, `uv.lock` only for the pinned `xingyao-runtime` HTTP dependency set
- Modify only these official extension surfaces as needed: `toolsets.py`, `tui_gateway/ws.py`, `tui_gateway/server.py`, `hermes_cli/web_server.py`, `agent/memory_manager.py`, `tools/delegate_tool.py`, `tools/code_execution_tool.py`, `tools/environments/docker.py`
- Create `config/xingyao.yaml`
- Create `deploy/xingyao/Dockerfile`, `deploy/xingyao/xingyao-hermes-gateway.service`, `deploy/xingyao/xingyao-hermes-model-gate.sh`
- Create focused tests under `tests/xingyao/`

## Task 1: Product Gateway v2 Contracts And Mode Budgets

**Files:**

- Modify: `features/ai/hermes/contracts.ts`
- Modify: `features/ai/hermes/contracts.test.ts`
- Create: `features/ai/hermes/gateway-contracts.ts`
- Create: `features/ai/hermes/gateway-contracts.test.ts`
- Modify: `features/ai/native-assistant/contracts.ts`
- Modify: `features/ai/native-assistant/contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover these exact invariants:

```ts
expect(HERMES_KERNEL_ID).toBe("hermes-agent-official-gateway");
expect(HERMES_PROTOCOL_VERSION).toBe("xingyao-hermes-gateway-v2");
expect(HERMES_PROFILE_VERSION).toBe("hermes-xingyao-v2");
expect(HERMES_MODE_BUDGETS.fast).toEqual({
  maxIterations: 24,
  wallClockMs: 90_000,
  maxParallelSubagents: 1,
  maxSubagentDepth: 1,
});
expect(HERMES_MODE_BUDGETS.deep).toEqual({
  maxIterations: 90,
  wallClockMs: 300_000,
  maxParallelSubagents: 3,
  maxSubagentDepth: 2,
});
expect(HERMES_OUTCOMES).toEqual([
  "complete",
  "partial",
  "blocked",
  "failed",
  "cancelled",
]);
```

Add parser tests that reject unknown JSON-RPC methods/events, raw `reasoning.delta` as a product-visible event, malformed UUIDs, extra Actor fields, widened scopes, an unknown outcome, or a handshake with a different protocol/profile/upstream commit.

- [ ] **Step 2: Run the tests and verify RED**

```powershell
pnpm vitest run features/ai/hermes/contracts.test.ts features/ai/hermes/gateway-contracts.test.ts features/ai/native-assistant/contracts.test.ts
```

Expected: imports/constants/parsers for Gateway v2 are missing.

- [ ] **Step 3: Implement the narrow contracts**

`gateway-contracts.ts` must define:

- `HermesGatewayHealth` with `status`, `upstreamTag`, full `upstreamCommit`, `forkCommit`, `protocolVersion`, `profileVersion`, `capabilityManifestSha256`.
- `HermesGatewayCommand`: create/resume session, attach bytes, submit prompt, respond to Clarify, interrupt.
- `HermesGatewayEvent`: `message.delta`, `message.complete`, `tool.start`, `tool.complete`, `clarify.request`, Todo payload from `tool.complete`, `subagent.*`, status and terminal failure/cancellation.
- `HermesOutcome` and normalized tool result metadata: `evidenceRefs`, `sourceLabels`, `updatedAt`, `missingData`, `permissionDenials`, `truncated`.
- `HermesModeBudget` constants above. These are server-enforced values, not client inputs.

Do not export any provider fallback or model-selection field in browser DTOs.

- [ ] **Step 4: Run GREEN and static checks**

```powershell
pnpm vitest run features/ai/hermes/contracts.test.ts features/ai/hermes/gateway-contracts.test.ts features/ai/native-assistant/contracts.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/contracts.ts features/ai/hermes/contracts.test.ts features/ai/hermes/gateway-contracts.ts features/ai/hermes/gateway-contracts.test.ts features/ai/native-assistant/contracts.ts features/ai/native-assistant/contracts.test.ts
git commit -m "feat(ai): define Hermes Gateway v2 contracts"
```

## Task 2: Additive AI State, Capability, Cancellation, And Lease Schema

**Files:**

- Create: `supabase/migrations/20260722100000_xingyao_hermes_native_state.sql`
- Create: `lib/db/xingyao-hermes-native-schema-contract.test.ts`
- Modify: `lib/db/ai-schema-contract.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing schema contract**

The test must read the migration as text and assert all of the following:

- `ai_hermes_run_capabilities` stores only `token_sha256`, never a raw capability; it binds organization, user, conversation, turn, invocation, actor fingerprint, scope hash, Skill grant hash, expiry, revocation and parent invocation.
- `ai_hermes_broker_calls` has a unique `(capability_id, tool_call_id)` and stores canonical `request_sha256`; an exact retry can reuse the saved response, while a changed request conflicts.
- `ai_hermes_memories` contains organization+owner identity, approved four memory types, revision, active flag, source conversation/message/invocation and soft-deactivation fields.
- `ai_hermes_skill_drafts` contains the approved lifecycle, bundle hash, signing key ID and signature; unapproved rows cannot be granted.
- `ai_chat_turns` gains `outcome`, `cancel_requested_at`, and a mode-aware lease (`2 minutes` Fast, `6 minutes` Deep).
- RPCs exist for capability claim, tool-message append, provider-state compare-and-swap, memory revision write, Skill draft write/review, cancel and lease renewal.
- Authenticated users get owner-only `SELECT` on memories and drafts. No `INSERT`, `UPDATE`, `DELETE`, or capability/broker-call policy exists for `anon` or `authenticated`.
- Memory source validation proves the source is a `role='user'` message with identical organization, owner and conversation.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts lib/db/ai-schema-contract.test.ts
```

Expected: migration and new contract are absent.

- [ ] **Step 3: Implement the additive migration**

Use these terminal-state rules:

```sql
constraint ai_chat_turns_outcome_check check (
  outcome is null or outcome in ('complete', 'partial', 'blocked', 'failed', 'cancelled')
)
```

`partial` and `blocked` coexist with `ai_chat_turns.status='completed'`; `failed` and `cancelled` mirror their terminal status. Extend, do not rewrite, the existing ledger.

`claim_ai_hermes_broker_call` must atomically verify:

1. capability hash and expiry;
2. capability not revoked;
3. active turn lease and matching invocation;
4. actor fingerprint and exact tool name;
5. existing `tool_call_id` request hash equality.

`cancel_ai_chat_turn` must be idempotent and only transition an owned active turn. `append_ai_hermes_tool_message` must allocate the next sequence under a conversation lock. `update_ai_conversation_hermes_state` must require the expected `generation` to prevent stale Gateway checkpoints overwriting newer ones.

Update `test:ai-system` to include the new schema test.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run lib/db/xingyao-hermes-native-schema-contract.test.ts lib/db/ai-schema-contract.test.ts
pnpm test:ai-system
git diff --check
```

The full `test:ai-system` may expose unrelated existing failures; record them separately, but the two schema contract files must pass.

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260722100000_xingyao_hermes_native_state.sql lib/db/xingyao-hermes-native-schema-contract.test.ts lib/db/ai-schema-contract.test.ts package.json
git commit -m "feat(ai): add Hermes native state schema"
```

## Task 3: Product-Owned Hermes State Repository

**Files:**

- Create: `features/ai/hermes/hermes-state-repository.ts`
- Create: `features/ai/hermes/hermes-state-repository.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/conversation-service.ts`
- Modify: `features/ai/conversation-service.test.ts`

- [ ] **Step 1: Write failing repository tests**

Test these methods with a fake Supabase client:

```ts
issueRunCapability(actorSnapshot, turn, allowedTools, expiresAt);
claimBrokerCall(capabilityHash, toolCallId, toolName, requestHash);
completeBrokerCall(claimId, sanitizedEnvelope);
appendToolMessage(actor, turnId, auditMessage);
loadActiveMemories(actor);
writeMemoryRevision(actor, proposal);
upsertSkillDraft(actor, proposal);
reviewSkillDraft(ownerActor, command);
compareAndSwapGatewayState(
  actor,
  conversationId,
  expectedGeneration,
  nextState,
);
cancelTurn(actor, conversationId, turnId);
```

Assert every call passes `organizationId` and `ownerUserId`; no method accepts identity from a model/tool request. Assert raw capabilities and signing private keys are never sent to Supabase.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/hermes-state-repository.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts
```

- [ ] **Step 3: Implement the repository and service wrappers**

Use the existing admin client only inside server modules. Map DB errors to stable codes (`not_found`, `permission_denied`, `idempotency_conflict`, `lease_expired`, `state_conflict`) without leaking SQL or table names. Preserve existing conversation behavior for Legacy turns.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/hermes-state-repository.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/hermes-state-repository.ts features/ai/hermes/hermes-state-repository.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts
git commit -m "feat(ai): add product-owned Hermes state repository"
```

## Task 4: Invocation Capabilities And Live Actor Reauthorization

**Files:**

- Create: `features/ai/hermes/run-capability.ts`
- Create: `features/ai/hermes/run-capability.test.ts`
- Create: `features/ai/hermes/live-actor-authorization.ts`
- Create: `features/ai/hermes/live-actor-authorization.test.ts`
- Modify: `features/ai/hermes/actor-assertion.ts`
- Modify: `features/ai/hermes/actor-assertion.test.ts`
- Create: `app/api/internal/hermes/capabilities/derive/route.ts`
- Create: `app/api/internal/hermes/capabilities/derive/route.test.ts`

- [ ] **Step 1: Write failing security tests**

Required cases:

- Capability is 32 random bytes encoded base64url; only SHA-256 is persisted.
- Capability expires no later than the turn budget plus 30 seconds and is revoked on terminal state.
- A request body containing `organizationId`, `userId`, `role`, `scopes`, `skills`, `model`, `provider` or `tools` is rejected rather than ignored.
- Exact membership query is `(organization_id, user_id, status='active')`; a role downgrade changes the Actor fingerprint and invalidates the session/capability.
- Unknown role, missing membership, scope expansion, expired assertion and changed Skill grant fail closed.
- Child capability derivation keeps organization/user/conversation/fingerprint, can only reduce tools/scopes, increments depth, binds `parent_invocation_id`, and sets `aiStateWritesAllowed=false`.
- Fast rejects a second parallel child or depth 2; Deep rejects a fourth child or depth 3.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/run-capability.test.ts features/ai/hermes/live-actor-authorization.test.ts features/ai/hermes/actor-assertion.test.ts app/api/internal/hermes/capabilities/derive/route.test.ts
```

- [ ] **Step 3: Implement fail-closed authorization**

Generate a fresh RS256 Actor assertion for Session create/resume/prompt. After Prompt acceptance, tool authorization uses the server-side Actor snapshot plus live membership check, not the expiring JWS. Child capability tokens are returned only to the Gateway's internal delegate adapter, are marked secret, and must be redacted before model/tool events or logs.

Do not cache active membership across tool calls. A small query cost is intentional because role downgrade must take effect during a Deep run.

- [ ] **Step 4: Run GREEN and mutation checks**

```powershell
pnpm vitest run features/ai/hermes/run-capability.test.ts features/ai/hermes/live-actor-authorization.test.ts features/ai/hermes/actor-assertion.test.ts app/api/internal/hermes/capabilities/derive/route.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/run-capability.ts features/ai/hermes/run-capability.test.ts features/ai/hermes/live-actor-authorization.ts features/ai/hermes/live-actor-authorization.test.ts features/ai/hermes/actor-assertion.ts features/ai/hermes/actor-assertion.test.ts app/api/internal/hermes/capabilities/derive/route.ts app/api/internal/hermes/capabilities/derive/route.test.ts
git commit -m "feat(ai): enforce Hermes invocation capabilities"
```

## Task 5: Product Tool Broker And Existing Read API Reuse

**Files:**

- Create: `features/ai/hermes/tool-broker-contracts.ts`
- Create: `features/ai/hermes/tool-broker-contracts.test.ts`
- Create: `features/ai/hermes/tool-broker.ts`
- Create: `features/ai/hermes/tool-broker.test.ts`
- Modify: `features/ai/hermes/read-api.ts`
- Modify: `features/ai/hermes/read-api.test.ts`
- Modify: `app/api/internal/hermes/read/route-handler.ts`
- Create: `app/api/internal/hermes/tools/execute/route.ts`
- Create: `app/api/internal/hermes/tools/execute/route.test.ts`

- [ ] **Step 1: Write failing Broker tests**

The only accepted request shape is:

```ts
{
  invocationId: "uuid",
  toolCallId: "gateway-stable-id",
  toolName: "xingyao_search_projects",
  arguments: {}
}
```

Identity is recovered from the hashed Bearer capability. Tests must prove:

- missing/expired/revoked/mismatched capability is rejected;
- cross-org, cross-user, cross-conversation and guessed Session IDs reveal nothing;
- role downgrade is applied on every call;
- a tool outside the capability allowlist is rejected before dispatch;
- scope and role checks match the existing Read API exactly;
- exact replay returns the stored envelope once, changed replay returns `409 idempotency_conflict`;
- one read tool returning `upstream_unavailable` does not change other tools or the whole run to failed;
- successful envelopes always carry evidence/source/observation/missing/denial metadata;
- logs and `role=tool` messages contain sanitized arguments/results but no Bearer token, JWS or secret.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/tool-broker-contracts.test.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/read-api.test.ts app/api/internal/hermes/tools/execute/route.test.ts
```

- [ ] **Step 3: Implement one authorization core**

Refactor `read-api.ts` so both HTTP Read routes and Tool Broker call the same pure authorization and execution functions. The Broker creates a fresh short-lived Actor assertion and validates it through the shared boundary, then invokes the same organization-scoped query in process; do not make a self-HTTP call to port 3000.

Dispatch only explicit names from `HERMES_READ_ENDPOINTS` plus the AI-state tools added in Tasks 6-7. Never accept URLs, table names, HTTP methods, SQL, arbitrary operation names or provider/model fields.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/tool-broker-contracts.test.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/read-api.test.ts app/api/internal/hermes/tools/execute/route.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/tool-broker-contracts.ts features/ai/hermes/tool-broker-contracts.test.ts features/ai/hermes/tool-broker.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/read-api.ts features/ai/hermes/read-api.test.ts app/api/internal/hermes/read/route-handler.ts app/api/internal/hermes/tools/execute/route.ts app/api/internal/hermes/tools/execute/route.test.ts
git commit -m "feat(ai): add reauthorizing Hermes Tool Broker"
```

## Task 6: Personal Memory Policy And Repository Tools

**Files:**

- Create: `features/ai/hermes/memory-policy.ts`
- Create: `features/ai/hermes/memory-policy.test.ts`
- Modify: `features/ai/hermes/tool-broker.ts`
- Modify: `features/ai/hermes/tool-broker.test.ts`
- Modify: `features/ai/hermes/hermes-state-repository.ts`
- Modify: `features/ai/hermes/hermes-state-repository.test.ts`

- [ ] **Step 1: Write failing memory safety tests**

Accept only `preference`, `workflow`, `communication`, `user_instruction`. Require a same-owner `role='user'` source message. Reject proposals containing or derived from:

- money/currency/percent/ROI/settlement values;
- project, streamer, report, settlement, organization or knowledge object IDs;
- `evidenceRefs`, tool output, knowledge chunks, URLs with credentials;
- API keys, tokens, private keys, passwords, cookies or authorization headers;
- permission changes such as “ignore role/scope”;
- assistant/tool source messages;
- subagent writes.

Assert `(invocationId, contentHash)` is idempotent, updates create a new revision, deactivation is soft, and a newly written memory appears only in the next turn snapshot.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/memory-policy.test.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/hermes-state-repository.test.ts
```

- [ ] **Step 3: Implement conservative personal memory**

Expose only `xingyao_memory_list`, `xingyao_memory_remember`, and `xingyao_memory_forget` through Broker. Lists are always actor-owned; writes require the parent invocation and source user message. Return a stable `permission_denied` or `memory_content_rejected` without echoing rejected secrets.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/memory-policy.test.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/hermes-state-repository.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/memory-policy.ts features/ai/hermes/memory-policy.test.ts features/ai/hermes/tool-broker.ts features/ai/hermes/tool-broker.test.ts features/ai/hermes/hermes-state-repository.ts features/ai/hermes/hermes-state-repository.test.ts
git commit -m "feat(ai): add actor-private Hermes memory policy"
```

## Task 7: Signed Skill Registry, Drafts, And Human Approval

**Files:**

- Create: `features/ai/hermes/approved-skill-registry.ts`
- Create: `features/ai/hermes/approved-skill-registry.test.ts`
- Create: `features/ai/hermes/skill-signing.ts`
- Create: `features/ai/hermes/skill-signing.test.ts`
- Create: `features/ai/hermes/builtin-skills/business-context/SKILL.md`
- Create: `features/ai/hermes/builtin-skills/project-review/SKILL.md`
- Create: `features/ai/hermes/builtin-skills/report-precheck/SKILL.md`
- Create: `features/ai/hermes/builtin-skills/settlement-analysis/SKILL.md`
- Modify: `features/ai/hermes/skill-governance.ts`
- Modify: `features/ai/hermes/skill-governance.test.ts`
- Modify: `app/api/ai/hermes/skills/route.ts`
- Modify: `app/api/ai/hermes/skills/route.test.ts`
- Create: `app/api/ai/hermes/skill-drafts/[draftId]/review/route.ts`
- Create: `app/api/ai/hermes/skill-drafts/[draftId]/review/route.test.ts`
- Modify: `features/ai/hermes/tool-broker.ts`
- Modify: `features/ai/hermes/tool-broker.test.ts`

- [ ] **Step 1: Write failing Skill lifecycle tests**

Test this exact lifecycle:

1. Hermes parent invocation creates/updates only its own `draft`.
2. Owner submits/approves/rejects through product route; Hermes cannot call the review operation.
3. Approval signs canonical manifest+bundle SHA-256 with Ed25519 using a product-only private key.
4. Gateway receives only the public key and retrieves artifacts through Tool Broker.
5. Only `approved` rows with matching organization, role, scopes, grant hash, bundle hash, key ID and signature enter `enabledSkillVersions`.
6. Rejected, superseded, revoked, hash-mismatched or unsigned versions disappear from `skills_list` and cannot be opened by `skill_view`.
7. `skill_manage`, install, repair, enable, publish and external registry URLs are never exposed.

Include bundle safety tests for zip traversal, absolute paths, symlinks/hardlinks, executables/scripts/native/WASM files, dynamic MCP config, environment references, duplicate paths, oversized bundles and hash mismatch.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/approved-skill-registry.test.ts features/ai/hermes/skill-signing.test.ts features/ai/hermes/skill-governance.test.ts app/api/ai/hermes/skills/route.test.ts app/api/ai/hermes/skill-drafts/[draftId]/review/route.test.ts features/ai/hermes/tool-broker.test.ts
```

- [ ] **Step 3: Implement product-owned approval**

Port the four existing Xingyao `SKILL.md` files into the product release as code-owned approved bundles, package them with the same canonical bundle algorithm used by the Gateway, and verify the existing hardcoded hashes before granting. Serve both built-ins and approved organization/user versions to the Gateway only through Tool Broker. Initially `role='owner'` is the Skill reviewer; no other existing role gains approval implicitly.

Add server-only env parsing for:

```text
XINGYAO_HERMES_SKILL_SIGNING_PRIVATE_KEY
XINGYAO_HERMES_SKILL_SIGNING_KEY_ID
```

Never return the private key, raw signing error or bundle storage path to the browser or Gateway.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/approved-skill-registry.test.ts features/ai/hermes/skill-signing.test.ts features/ai/hermes/skill-governance.test.ts app/api/ai/hermes/skills/route.test.ts app/api/ai/hermes/skill-drafts/[draftId]/review/route.test.ts features/ai/hermes/tool-broker.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/approved-skill-registry.ts features/ai/hermes/approved-skill-registry.test.ts features/ai/hermes/skill-signing.ts features/ai/hermes/skill-signing.test.ts features/ai/hermes/builtin-skills features/ai/hermes/skill-governance.ts features/ai/hermes/skill-governance.test.ts app/api/ai/hermes/skills/route.ts app/api/ai/hermes/skills/route.test.ts app/api/ai/hermes/skill-drafts/[draftId]/review/route.ts app/api/ai/hermes/skill-drafts/[draftId]/review/route.test.ts features/ai/hermes/tool-broker.ts features/ai/hermes/tool-broker.test.ts
git commit -m "feat(ai): govern signed Hermes Skill drafts"
```

## Task 8: Fork From Official v0.19 And Port Only Security Primitives

**Repository:** `C:\Users\admin\Documents\xingyao-hermes-agent\.worktrees\xingyao-hermes-native-v2`

**Files:**

- Create: `xingyao/upstream_provenance.py`
- Create: `xingyao/actor_assertion.py`
- Create: `xingyao/execution_context.py`
- Create: `xingyao/tool_policy.py`
- Create: `xingyao/errors.py`
- Create: `xingyao/secret_redaction.py`
- Create: `xingyao/model_config_gate.py`
- Create: `tests/xingyao/test_upstream_provenance.py`
- Create: `tests/xingyao/test_actor_assertion.py`
- Create: `tests/xingyao/test_execution_context.py`
- Create: `tests/xingyao/test_tool_policy.py`
- Create: `tests/xingyao/test_secret_redaction.py`
- Create: `tests/xingyao/test_model_config_gate.py`

- [ ] **Step 1: Write failing provenance and security tests**

Assert exact constants:

```python
UPSTREAM_TAG = "v2026.7.20"
UPSTREAM_COMMIT = "3ef6bbd201263d354fd83ec55b3c306ded2eb72a"
PROTOCOL_VERSION = "xingyao-hermes-gateway-v2"
PROFILE_VERSION = "hermes-xingyao-v2"
```

Actor tests must verify RS256 signature, issuer/audience, exact claim keys, max 300-second lifetime, `jti == invocationId`, scope/grant hash, no duplicate scopes, and rejection of unknown roles/extra fields.

Model gate tests must parse YAML semantically with duplicate-key rejection. It must reject duplicate or whitespace-obscured provider/model keys, `fallback_model`, `fallback_providers`, provider routing, per-session override and missing expected provider/model. Do not hand-parse YAML lines.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev pytest tests/xingyao/test_upstream_provenance.py tests/xingyao/test_actor_assertion.py tests/xingyao/test_execution_context.py tests/xingyao/test_tool_policy.py tests/xingyao/test_secret_redaction.py tests/xingyao/test_model_config_gate.py -q
```

- [ ] **Step 3: Port minimal code from the old Fork**

Use the old Fork only as a reference for validation and bundle-hardening logic. Reimplement against official v0.19 APIs. Do not copy:

- old `gateway/platforms/xingyao_api/adapter.py` Run API;
- old custom SSE loop;
- old broad disabled-tool configuration;
- any product token/private key handling;
- any fallback-provider behavior.

`XingyaoExecutionContext` must be immutable and carry the verified Actor snapshot, opaque capability handle, budget, parent/depth metadata and `ai_state_writes_allowed` flag. Its `repr`/logging representation must redact the capability.

- [ ] **Step 4: Run GREEN and lint**

```powershell
uv run --extra dev pytest tests/xingyao/test_upstream_provenance.py tests/xingyao/test_actor_assertion.py tests/xingyao/test_execution_context.py tests/xingyao/test_tool_policy.py tests/xingyao/test_secret_redaction.py tests/xingyao/test_model_config_gate.py -q
uv run --with ruff ruff check xingyao tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit in the Hermes Fork**

```powershell
git add xingyao tests/xingyao
git commit -m "feat(xingyao): add official gateway security kernel"
```

## Task 9: Authenticated Xingyao WebSocket, Tenant Profile, And Session Ownership

**Repository:** Hermes Fork worktree

**Files:**

- Create: `xingyao/gateway_auth.py`
- Create: `xingyao/profile_scope.py`
- Modify: `tui_gateway/ws.py`
- Modify: `tui_gateway/server.py`
- Modify: `hermes_cli/web_server.py`
- Create: `tests/xingyao/test_gateway_auth.py`
- Create: `tests/xingyao/test_profile_scope.py`
- Create: `tests/xingyao/test_gateway_session_binding.py`
- Create: `tests/xingyao/test_gateway_health.py`

- [ ] **Step 1: Write failing Gateway boundary tests**

Required behavior:

- New endpoint is `/api/xingyao/ws`; product supplies a dedicated Gateway service token in the WebSocket Authorization header.
- With `XINGYAO_GATEWAY_ONLY=1`, generic `/api/ws`, dashboard configuration mutation and generic MCP discovery are unavailable.
- Session create, resume and Prompt submit require a fresh signed Actor assertion and invocation capability.
- Client-provided `profile`, `cwd`, provider, model, toolsets, max iterations and reasoning options are rejected for Xingyao sessions.
- Runtime profile directory is `HMAC-SHA256(XINGYAO_PROFILE_HMAC_SECRET, organizationId + "\n" + userId)` encoded as an opaque slug; raw IDs never appear in paths.
- Session ownership is exact actor fingerprint. Cross-user/org resume, guessed session ID, role downgrade or grant change returns the same not-found/unauthorized envelope.
- SessionDB is opened under the derived tenant home. A missing cache rebuild is allowed; a shared global SessionDB is not.
- Full Actor JWS and capability never enter SessionDB or logs.
- `/healthz` returns ready, upstream/fork/protocol/profile versions and capability manifest hash, but no model key, service token, paths or actor data.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev pytest tests/xingyao/test_gateway_auth.py tests/xingyao/test_profile_scope.py tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_health.py -q
```

- [ ] **Step 3: Add a narrow official Gateway extension**

Add `handle_xingyao_ws` without changing generic `handle_ws` behavior when `XINGYAO_GATEWAY_ONLY` is false. Store only immutable verified claims and Actor fingerprint on the live session. Replace the invocation capability on each accepted Prompt; never persist it. Bind profile-scoped `HERMES_HOME` and SessionDB around all session create/resume/search/branch/summary operations.

The dedicated Gateway token is not a product Read API token. It only authorizes the local product Bridge to open the Xingyao WebSocket.

- [ ] **Step 4: Run GREEN plus upstream regressions**

```powershell
uv run --extra dev pytest tests/xingyao/test_gateway_auth.py tests/xingyao/test_profile_scope.py tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_health.py -q
uv run --extra dev pytest tests/tui_gateway/test_session_platform_resolution.py tests/tui_gateway/test_gateway_owned_session_reap.py tests/tui_gateway/test_reasoning_session_scope.py -q
uv run --with ruff ruff check xingyao tui_gateway tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add xingyao/gateway_auth.py xingyao/profile_scope.py tui_gateway/ws.py tui_gateway/server.py hermes_cli/web_server.py tests/xingyao/test_gateway_auth.py tests/xingyao/test_profile_scope.py tests/xingyao/test_gateway_session_binding.py tests/xingyao/test_gateway_health.py
git commit -m "feat(xingyao): bind gateway sessions to verified actors"
```

## Task 10: Exclusive Toolset, Broker Client, And Read-Only Business Tools

**Repository:** Hermes Fork worktree

**Files:**

- Create: `xingyao/tool_broker_client.py`
- Create: `tools/xingyao_business_tools.py`
- Create: `tools/xingyao_state_tools.py`
- Modify: `toolsets.py`
- Modify: `tui_gateway/server.py`
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Create: `tests/xingyao/test_tool_broker_client.py`
- Create: `tests/xingyao/test_business_tools.py`
- Create: `tests/xingyao/test_production_toolset.py`
- Create: `tests/xingyao/test_tool_dispatch_policy.py`

- [ ] **Step 1: Write failing tool exposure and dispatch tests**

The `xingyao_native` toolset may contain only:

```text
xingyao_get_current_context
xingyao_search_projects
xingyao_get_project_summary
xingyao_get_streamer_project_profile
xingyao_search_live_reports
xingyao_search_recording_reviews
xingyao_search_knowledge
xingyao_get_settlement_summary
xingyao_memory_list
xingyao_memory_remember
xingyao_memory_forget
xingyao_skill_draft
skills_list
skill_view
todo
clarify
session_search
web_search
web_extract
vision_analyze
execute_code
delegate_task
xingyao_attachment_read
```

Tests must assert absence at both schema exposure and dispatch for terminal/process, generic file tools, `skill_manage`, browser automation, image/video generation, text-to-speech, Cron, messaging, Home Assistant, Kanban, computer use, project mutation and all MCP/managed tools.

Broker client tests must use a fixed product internal origin, send only invocation/tool-call/tool-name/arguments, redact Authorization, apply bounded retry only to idempotent reads, and preserve the tool-specific error envelope.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev pytest tests/xingyao/test_tool_broker_client.py tests/xingyao/test_business_tools.py tests/xingyao/test_production_toolset.py tests/xingyao/test_tool_dispatch_policy.py -q
```

- [ ] **Step 3: Implement policy twice**

Filter tools when schemas are assembled and check again immediately before dispatch. A model-generated arbitrary function name must not reach HTTP. Convert Broker responses into tool results without rewriting a single-tool failure into a global “上游接口全部不可用” message.

Do not start MCP discovery for a Xingyao-only Gateway process. Add a minimal `xingyao-runtime` extra containing the pinned `aiohttp` version already used elsewhere in the official lockfile; do not pull messaging platform dependencies into production.

- [ ] **Step 4: Run GREEN and generic tool regressions**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_tool_broker_client.py tests/xingyao/test_business_tools.py tests/xingyao/test_production_toolset.py tests/xingyao/test_tool_dispatch_policy.py -q
uv run --extra dev pytest tests/test_toolsets.py tests/tools/test_registry.py tests/tools/test_mcp_tool.py -q
uv run --with ruff ruff check xingyao tools/xingyao_business_tools.py tools/xingyao_state_tools.py tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add xingyao/tool_broker_client.py tools/xingyao_business_tools.py tools/xingyao_state_tools.py toolsets.py tui_gateway/server.py pyproject.toml uv.lock tests/xingyao/test_tool_broker_client.py tests/xingyao/test_business_tools.py tests/xingyao/test_production_toolset.py tests/xingyao/test_tool_dispatch_policy.py
git commit -m "feat(xingyao): route exclusive tools through broker"
```

## Task 11: Product-Backed Memory, Progressive Skills, And Xingyao SOUL

**Repository:** Hermes Fork worktree

**Files:**

- Create: `plugins/memory/xingyao/__init__.py`
- Create: `plugins/memory/xingyao/provider.py`
- Create: `xingyao/skill_registry.py`
- Create: `xingyao/SOUL.md`
- Modify: `agent/memory_manager.py`
- Modify: `tui_gateway/server.py`
- Create: `tests/xingyao/test_memory_provider.py`
- Create: `tests/xingyao/test_memory_leakage.py`
- Create: `tests/xingyao/test_skill_registry.py`
- Create: `tests/xingyao/test_skill_policy.py`
- Create: `tests/xingyao/test_prompt_assembly.py`

- [ ] **Step 1: Write failing native-capability tests**

Prove:

- memory prefetch is organization+user scoped and appears before current conversation history;
- memory writes route to Broker and never `~/.hermes/memories`;
- a subagent receives no memory-write or Skill-draft schema;
- approved Skill indexes load first, bodies load only through `skill_view`;
- signature/hash/grant mismatch blocks the Skill;
- `xingyao_skill_draft` creates a draft only and cannot approve/install/enable;
- SOUL says “星耀 AI”, preserves official system/Agent Loop first, and cannot override the security policy;
- external webpage, attachment, knowledge and tool text is wrapped as untrusted content, not system instructions;
- compressed/session summaries never promote tool data into personal memory.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_memory_provider.py tests/xingyao/test_memory_leakage.py tests/xingyao/test_skill_registry.py tests/xingyao/test_skill_policy.py tests/xingyao/test_prompt_assembly.py -q
```

- [ ] **Step 3: Implement official extension interfaces**

Implement the v0.19 `MemoryProvider` interface (`initialize`, `prefetch`, tool schemas/dispatch and compression/session hooks). Use Broker tools for list/write/forget. Keep official `MemoryManager`, Skills preprocessing and progressive `skills_list`/`skill_view`; replace only their data source for Xingyao sessions.

Prompt order must be: official Hermes system/loop protocol, immutable Xingyao policy, Xingyao SOUL, Actor/budget snapshot, personal memories, approved Skill index, product ledger transcript/tool summaries.

- [ ] **Step 4: Run GREEN plus official memory/skills regressions**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_memory_provider.py tests/xingyao/test_memory_leakage.py tests/xingyao/test_skill_registry.py tests/xingyao/test_skill_policy.py tests/xingyao/test_prompt_assembly.py -q
uv run --extra dev pytest tests/tools/test_skills_tool.py tests/plugins/memory -q
uv run --with ruff ruff check plugins/memory/xingyao xingyao tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add plugins/memory/xingyao xingyao/skill_registry.py xingyao/SOUL.md agent/memory_manager.py tui_gateway/server.py tests/xingyao/test_memory_provider.py tests/xingyao/test_memory_leakage.py tests/xingyao/test_skill_registry.py tests/xingyao/test_skill_policy.py tests/xingyao/test_prompt_assembly.py
git commit -m "feat(xingyao): restore native memory and Skills safely"
```

## Task 12: Safe Web, Byte Attachments, And Docker-Only Compute

**Repository:** Hermes Fork worktree

**Files:**

- Create: `xingyao/web_policy.py`
- Create: `xingyao/attachment_policy.py`
- Create: `xingyao/sandbox_policy.py`
- Create: `tools/xingyao_attachment_tool.py`
- Modify: `tui_gateway/server.py`
- Modify: `tools/code_execution_tool.py`
- Modify: `tools/environments/docker.py`
- Create: `config/xingyao.yaml`
- Create: `tests/xingyao/test_web_policy.py`
- Create: `tests/xingyao/test_attachment_policy.py`
- Create: `tests/xingyao/test_sandbox_policy.py`
- Create: `tests/xingyao/test_production_config.py`

- [ ] **Step 1: Write failing attack tests**

Web tests must reject loopback, RFC1918, link-local, IPv6 local/private, cloud metadata, decimal/hex IP variants, DNS rebinding and redirects to private addresses. Limit HTTP/HTTPS only, response bytes, content types, redirect count and timeout. Mark returned text `untrustedExternalContent=true`.

Attachment tests must accept only product-resolved bytes belonging to the same org/user/conversation/turn. For Xingyao, reject host `path` on `image.attach`, `pdf.attach` and `file.attach`; permit byte/base64 variants after MIME magic, name, size and count checks. Materialize only under the derived tenant's current invocation attachment directory. `xingyao_attachment_read` cannot traverse, follow links or read another turn.

Sandbox tests must fail startup unless:

```yaml
terminal:
  backend: docker
  docker_network: false
  docker_mount_cwd_to_workspace: false
  docker_volumes: []
  docker_forward_env: []
```

The generated container command must include non-root user, read-only root FS, tmpfs workspace, dropped capabilities, `no-new-privileges`, PID/CPU/memory/time limits, no mounts, no secrets and no network. Reject local/SSH/Singularity backends and a rootful `/var/run/docker.sock`; production uses a dedicated rootless Docker context.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_web_policy.py tests/xingyao/test_attachment_policy.py tests/xingyao/test_sandbox_policy.py tests/xingyao/test_production_config.py -q
```

- [ ] **Step 3: Implement the constrained capabilities**

Reuse official `web_search`, `web_extract`, vision, `image.attach_bytes`, PDF base64 and `execute_code` logic behind Xingyao policy hooks. Do not expose generic file or terminal schemas. Set compute defaults to 1 CPU, 512 MiB memory, 128 PIDs, 64 MiB tmpfs and 30-second execution timeout; mode budget never expands these limits.

- [ ] **Step 4: Run GREEN plus upstream safety tests**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_web_policy.py tests/xingyao/test_attachment_policy.py tests/xingyao/test_sandbox_policy.py tests/xingyao/test_production_config.py -q
uv run --extra dev pytest tests/tools/test_web_tools_config.py tests/tools/test_docker_network_config.py tests/tools/test_container_cwd_sanitize.py tests/tools/test_file_read_guards.py tests/tools/test_skill_view_traversal.py -q
uv run --with ruff ruff check xingyao tools/xingyao_attachment_tool.py tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add xingyao/web_policy.py xingyao/attachment_policy.py xingyao/sandbox_policy.py tools/xingyao_attachment_tool.py tui_gateway/server.py tools/code_execution_tool.py tools/environments/docker.py config/xingyao.yaml tests/xingyao/test_web_policy.py tests/xingyao/test_attachment_policy.py tests/xingyao/test_sandbox_policy.py tests/xingyao/test_production_config.py
git commit -m "feat(xingyao): constrain web attachments and compute"
```

## Task 13: Fast/Deep Budgets And Read-Only Subagents

**Repository:** Hermes Fork worktree

**Files:**

- Create: `xingyao/run_budget.py`
- Modify: `tui_gateway/server.py`
- Modify: `tools/delegate_tool.py`
- Create: `tests/xingyao/test_run_budget.py`
- Create: `tests/xingyao/test_subagent_inheritance.py`
- Create: `tests/xingyao/test_subagent_interrupt.py`

- [ ] **Step 1: Write failing budget and inheritance tests**

Verify service-side Fast/Deep values exactly match Task 1. A client cannot override them. Test iteration exhaustion, wall-clock cancellation, active-child count and maximum depth.

For every child assert:

- same organization/user/conversation/Actor fingerprint;
- equal or narrower scopes, Skills and tools;
- separate derived invocation capability bound to parent;
- `ai_state_writes_allowed=false`;
- no memory remember/forget or Skill draft tools;
- no host path, provider/model override, extra network or longer budget;
- child completion can only be delivered to the owning parent invocation.

Interrupting a parent must stop all children and prevent further provider/tool calls.

- [ ] **Step 2: Run RED**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_run_budget.py tests/xingyao/test_subagent_inheritance.py tests/xingyao/test_subagent_interrupt.py -q
```

- [ ] **Step 3: Wire budgets without replacing delegation**

Keep official `delegate_task` orchestration. Before child creation, call the internal Broker capability-derive endpoint, keep the returned token outside model-visible results, and attach the reduced execution context to the official child. Add deadline checks around the official loop and delegation waits; on budget exhaustion return existing evidence plus `missingData` and a `partial`/`blocked` outcome rather than discarding the turn.

- [ ] **Step 4: Run GREEN plus official delegation regressions**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_run_budget.py tests/xingyao/test_subagent_inheritance.py tests/xingyao/test_subagent_interrupt.py -q
uv run --extra dev pytest tests/tools/test_delegate.py tests/gateway/test_subagent_protection_30170.py tests/tui_gateway/test_subagent_child_mirror.py tests/agent/test_subagent_stop_hook.py -q
uv run --with ruff ruff check xingyao tools/delegate_tool.py tests/xingyao
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add xingyao/run_budget.py tui_gateway/server.py tools/delegate_tool.py tests/xingyao/test_run_budget.py tests/xingyao/test_subagent_inheritance.py tests/xingyao/test_subagent_interrupt.py
git commit -m "feat(xingyao): enforce native run and delegation budgets"
```

## Task 14: Product WebSocket/JSON-RPC Gateway Client

**Repository:** Product worktree

**Files:**

- Create: `features/ai/hermes/gateway-client.ts`
- Create: `features/ai/hermes/gateway-client.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the server WebSocket dependency**

```powershell
pnpm add ws
pnpm add -D @types/ws
```

Expected: only `package.json` and `pnpm-lock.yaml` dependency metadata changes.

- [ ] **Step 2: Write failing protocol-client tests**

Use a fake WebSocket server and prove:

- URL must be loopback `ws://127.0.0.1` or `ws://localhost`; user input cannot choose it.
- Authorization uses a dedicated Gateway service token and never a Read API token.
- `gateway.ready` must match upstream tag/commit, protocol/profile and capability manifest before Session creation.
- JSON-RPC IDs correlate concurrent responses and events remain ordered.
- Supported methods are exactly `session.create`, `session.resume`, `session.info`, `session.list`, `session.branch`, `session.compress`, `image.attach_bytes`, byte-backed `pdf.attach`/`file.attach`, `prompt.submit`, `clarify.respond`, `session.interrupt`.
- Supported official events map without exposing `reasoning.delta` or `thinking.delta`.
- Connection loss before Prompt acceptance may retry safely; after acceptance it must query/resume the same invocation and never submit a duplicate Prompt.
- Unknown terminal schema, version drift or Actor/session mismatch fails closed.
- Heartbeat, connect, RPC and idle timeouts are bounded; close removes listeners and timers.

- [ ] **Step 3: Run RED**

```powershell
pnpm vitest run features/ai/hermes/gateway-client.test.ts
```

- [ ] **Step 4: Implement the typed client**

Expose an `AsyncIterable<HermesGatewayEvent>` plus explicit `respondToClarify()` and `interrupt()` handles. Coalesce only text deltas; never drop tool/Clarify/subagent/terminal frames. Redact headers and opaque capability from errors. Attachments are server-resolved bytes from the accepted product command, not paths supplied by the browser.

- [ ] **Step 5: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/gateway-client.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add features/ai/hermes/gateway-client.ts features/ai/hermes/gateway-client.test.ts package.json pnpm-lock.yaml
git commit -m "feat(ai): add official Hermes Gateway client"
```

## Task 15: Gateway Executor, Ledger Replay, Tool Transcript, And Outcomes

**Repository:** Product worktree

**Files:**

- Create: `features/ai/native-assistant/gateway-executor.ts`
- Create: `features/ai/native-assistant/gateway-executor.test.ts`
- Create: `features/ai/native-assistant/legacy-turn-executor.ts`
- Create: `features/ai/native-assistant/legacy-turn-executor.test.ts`
- Modify: `features/ai/native-assistant/context-engine.ts`
- Modify: `features/ai/native-assistant/context-engine.test.ts`
- Modify: `features/ai/conversation-contracts.ts`
- Modify: `features/ai/conversation-contracts.test.ts`
- Modify: `features/ai/conversation-stream-adapter.ts`
- Modify: `features/ai/conversation-stream-adapter.test.ts`
- Modify: `features/ai/conversation-repository.ts`
- Modify: `features/ai/conversation-repository.test.ts`
- Modify: `features/ai/conversation-service.ts`
- Modify: `features/ai/conversation-service.test.ts`
- Modify: `app/api/ai/turns/[turnId]/retry/route.ts`
- Modify: `app/api/ai/turns/[turnId]/retry/route.test.ts`
- Modify: `app/api/ai/turns/[turnId]/regenerate/route.ts`
- Modify: `app/api/ai/turns/[turnId]/regenerate/route.test.ts`

- [ ] **Step 1: Write failing executor and event tests**

Add these product SSE event types:

```text
turn.started
context.ready
activity.updated
tool.started
tool.completed
clarify.requested
todo.updated
subagent.updated
response.delta
response.completed
response.failed
response.cancelled
heartbeat
```

`response.completed` must include `outcome: complete | partial | blocked`, evidence/missing metadata and observation times. `response.failed` is reserved for Gateway/protocol/provider/internal failures. A cancelled turn emits `response.cancelled` only after the ledger says cancelled.

Tests must prove:

- Actor, page context, approved Skills, personal-memory revision and Fast/Deep budget are frozen once per turn.
- Product messages and sanitized `role=tool` messages replay in sequence; no other user's state enters the Session.
- Gateway cache miss rebuilds from product ledger and increments provider-state `generation` with compare-and-swap.
- retry/regenerate branches from the recorded product checkpoint through official `session.branch`; it never reuses another actor's runtime session or appends onto the wrong branch.
- official compression/summary is synchronized into `ai_conversations.summary` with a version check; Session list/search remains tenant-scoped.
- one failed read plus one successful read produces `partial`; all task-critical reads denied/unavailable produces `blocked`; a normal no-tool answer is `complete`.
- a historical tool result retains its original `updatedAt` and is never presented as live.
- model/Gateway failure after partial text persists a failed assistant message and stable trace code, not a fabricated completed answer.
- Provider failure retries only a safe request against the configured provider/model; it never switches provider/model or invokes Legacy.
- product-visible activity contains labels/status only, never private reasoning text.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/native-assistant/gateway-executor.test.ts features/ai/native-assistant/legacy-turn-executor.test.ts features/ai/native-assistant/context-engine.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts app/api/ai/turns/[turnId]/retry/route.test.ts app/api/ai/turns/[turnId]/regenerate/route.test.ts
```

- [ ] **Step 3: Implement a generic turn executor seam**

Refactor the stream adapter to consume a typed `ConversationTurnExecutor` async event source. Wrap the existing `/api/ai/chat` behavior in `legacy-turn-executor.ts`; do not delete or behaviorally rewrite it. `gateway-executor.ts` performs:

1. capability issuance and fresh Actor assertion;
2. handshake and create/resume/rebuild;
3. byte attachment upload;
4. Prompt submission;
5. Gateway event normalization;
6. atomic tool-message/audit persistence;
7. branch/compression/summary synchronization;
8. final outcome classification and provider-state checkpoint.

Do not pre-inject project/streamer/settlement data. The Context Engine provides only actor/page/memory/Skill index and ledger transcript; business facts remain on-demand tools.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/native-assistant/gateway-executor.test.ts features/ai/native-assistant/legacy-turn-executor.test.ts features/ai/native-assistant/context-engine.test.ts features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.test.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.test.ts app/api/ai/turns/[turnId]/retry/route.test.ts app/api/ai/turns/[turnId]/regenerate/route.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/native-assistant/gateway-executor.ts features/ai/native-assistant/gateway-executor.test.ts features/ai/native-assistant/legacy-turn-executor.ts features/ai/native-assistant/legacy-turn-executor.test.ts features/ai/native-assistant/context-engine.ts features/ai/native-assistant/context-engine.test.ts features/ai/conversation-contracts.ts features/ai/conversation-contracts.test.ts features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts features/ai/conversation-repository.ts features/ai/conversation-repository.test.ts features/ai/conversation-service.ts features/ai/conversation-service.test.ts app/api/ai/turns/[turnId]/retry/route.ts app/api/ai/turns/[turnId]/retry/route.test.ts app/api/ai/turns/[turnId]/regenerate/route.ts app/api/ai/turns/[turnId]/regenerate/route.test.ts
git commit -m "feat(ai): persist native Hermes execution events"
```

## Task 16: Clarify, Stop, Disconnect, And Active Run Control

**Repository:** Product worktree

**Files:**

- Create: `features/ai/hermes/active-run-registry.ts`
- Create: `features/ai/hermes/active-run-registry.test.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.ts`
- Create: `app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/route.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/route.test.ts`
- Modify: `features/ai/conversation-stream-adapter.ts`
- Modify: `features/ai/conversation-stream-adapter.test.ts`

- [ ] **Step 1: Write failing run-control tests**

Assert:

- active-run keys contain organization+user+conversation+turn and cannot be guessed across actors;
- Clarify response must match the currently pending `clarifyId`, allowed option/free-text rule and active turn;
- duplicate Clarify response is idempotent; changed response conflicts;
- cancel first marks `cancel_requested_at`, then invokes native `session.interrupt`; it is idempotent if already terminal;
- parent cancellation interrupts children and revokes capabilities;
- request disconnect/AbortSignal interrupts the native run after a short grace period, rather than consuming indefinitely;
- after a product process restart, Clarify/cancel opens a fresh authenticated control WebSocket and addresses the owned Gateway session from `provider_state`; if the Gateway session is also gone, recovery marks/rebuilds deterministically;
- terminal SSE is sent only after matching DB terminal state exists.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/active-run-registry.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts features/ai/conversation-stream-adapter.test.ts
```

- [ ] **Step 3: Implement durable control with a local fast path**

Use the in-process registry only as a fast path for the streaming connection. The authoritative control lookup is the actor-owned turn plus `ai_conversations.provider_state`; a route may open a new authenticated control WebSocket and call `clarify.respond` or `session.interrupt`. This remains correct across product restarts or more than one PM2 worker. Set route `maxDuration = 330` so Deep's 300-second server budget can complete; the Gateway deadline remains authoritative.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/active-run-registry.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts features/ai/conversation-stream-adapter.test.ts
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/active-run-registry.ts features/ai/hermes/active-run-registry.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/cancel/route.test.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.ts app/api/ai/conversations/[conversationId]/turns/[turnId]/clarify/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts features/ai/conversation-stream-adapter.ts features/ai/conversation-stream-adapter.test.ts
git commit -m "feat(ai): add native Clarify and interrupt control"
```

## Task 17: 星耀 AI Progress, Clarify, Stop, Outcomes, And Skill Review UI

**Repository:** Product worktree

**Files:**

- Modify: `components/dashboard/overview-board.jsx`
- Modify: `components/dashboard/overview-board.test.jsx`
- Create: `components/dashboard/hermes-skill-draft-review.jsx`
- Create: `components/dashboard/hermes-skill-draft-review.test.jsx`

- [ ] **Step 1: Write failing interaction tests**

Cover:

- Fast/Deep segmented control remains visible and does not change provider/model wording.
- while running, the Send button becomes a familiar Stop icon with tooltip; dimensions do not shift.
- compact activity rows show tool label, source and success/limited/failure status without raw arguments, stack, internal route or chain-of-thought.
- Todo and subagent rows are stable, compact, and update in place.
- Clarify renders choices plus optional free-text, disables after submission, and reconnect/reload restores pending state.
- `partial` renders “基于部分可用数据” and missing items; `blocked` states the exact unavailable/denied data; neither fabricates historical numbers.
- cancelled is distinct from failed and does not show retryable provider failure copy.
- an owner can inspect a Skill draft hash/manifest, approve or reject with a human action; non-owner sees no approval command.
- visible product name remains “星耀 AI”; “Hermes Gateway” and internal provider names are absent from user-facing copy.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run components/dashboard/overview-board.test.jsx components/dashboard/hermes-skill-draft-review.test.jsx
```

- [ ] **Step 3: Implement feature-complete compact controls**

Use the existing icon library for Stop, status and disclosure controls. Do not add marketing cards, nested cards or instructional feature text. Keep the AI panel's current visual system and keyboard behavior. Use `AbortController` for the stream and call the cancel route before aborting local rendering.

- [ ] **Step 4: Run GREEN and UI smoke**

```powershell
pnpm vitest run components/dashboard/overview-board.test.jsx components/dashboard/hermes-skill-draft-review.test.jsx
pnpm test:ui-smoke
pnpm type-check
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add components/dashboard/overview-board.jsx components/dashboard/overview-board.test.jsx components/dashboard/hermes-skill-draft-review.jsx components/dashboard/hermes-skill-draft-review.test.jsx
git commit -m "feat(ai): expose native Hermes progress and control"
```

## Task 18: Server-Only Runtime Selection, Health, And No Silent Fallback

**Repository:** Product worktree

**Files:**

- Create: `features/ai/hermes/runtime-selection.ts`
- Create: `features/ai/hermes/runtime-selection.test.ts`
- Modify: `lib/config/env.ts`
- Modify: `lib/config/env.test.ts`
- Modify: `app/api/health/route.ts`
- Modify: `app/api/health/route.test.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/route.ts`
- Modify: `app/api/ai/conversations/[conversationId]/turns/route.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing selection/config tests**

Parse these server-only variables:

```text
XINGYAO_HERMES_GATEWAY_ENABLED
XINGYAO_HERMES_GATEWAY_ALLOWLIST
XINGYAO_HERMES_GATEWAY_BASE_URL
XINGYAO_HERMES_GATEWAY_SERVICE_TOKEN
XINGYAO_HERMES_LEGACY_RUNTIME_ENABLED
```

Allowlist grammar is comma-separated `organizationUuid/userUuid` or `organizationUuid/*`; reject every other shape. Selection rules:

1. Gateway disabled -> Legacy only if Legacy flag is true.
2. Gateway enabled but actor not allowlisted -> Legacy only if Legacy flag is true.
3. Gateway enabled and actor allowlisted -> Gateway v2 or an explicit failure; never same-turn Legacy fallback.
4. Both paths disabled -> stable `runtime_disabled`.
5. malformed config -> startup/request failure, never permissive default.

Health tests may expose only booleans and compatibility status, not URL/token/provider/model/Actor data.

- [ ] **Step 2: Run RED**

```powershell
pnpm vitest run features/ai/hermes/runtime-selection.test.ts lib/config/env.test.ts app/api/health/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts
```

- [ ] **Step 3: Implement deterministic turn selection**

Choose the executor once after authentication and before accepting the turn. Persist the selected runtime/protocol/profile in context snapshot. A later flag change affects only a new turn; active Gateway turns are interrupted and terminally persisted before operational rollback.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm vitest run features/ai/hermes/runtime-selection.test.ts lib/config/env.test.ts app/api/health/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts
pnpm type-check
pnpm build
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add features/ai/hermes/runtime-selection.ts features/ai/hermes/runtime-selection.test.ts lib/config/env.ts lib/config/env.test.ts app/api/health/route.ts app/api/health/route.test.ts app/api/ai/conversations/[conversationId]/turns/route.ts app/api/ai/conversations/[conversationId]/turns/route.test.ts .env.example
git commit -m "feat(ai): gate Hermes Gateway by server allowlist"
```

## Task 19: Side-By-Side Service, Model Gate, Local Release Evidence, And Runbook

**Repositories:** Product and Hermes Fork worktrees

**Hermes files:**

- Create: `deploy/xingyao/Dockerfile`
- Create: `deploy/xingyao/xingyao-hermes-gateway.service`
- Create: `deploy/xingyao/xingyao-hermes-model-gate.sh`
- Create: `deploy/xingyao/install-candidate.sh`
- Create: `docs/xingyao/deployment.md`
- Create: `tests/xingyao/test_deployment_contract.py`

**Product files:**

- Create: `docs/runbooks/xingyao-hermes-gateway.md`
- Create: `scripts/verify-xingyao-hermes-release.mjs`
- Create: `scripts/verify-xingyao-hermes-release.test.mjs`
- Create: `scripts/create-xingyao-hermes-rollback.sh`
- Create: `scripts/create-xingyao-hermes-rollback.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing deployment contract tests**

Hermes tests must assert:

- process listens only on `127.0.0.1:8643`;
- service has `Restart=always`, `NoNewPrivileges=true`, private tmp, system protection and explicit writable cache paths;
- generic Gateway is disabled and `/api/xingyao/ws` is the only WebSocket entry;
- Gateway environment denylist rejects Supabase/service-role/product private-key variables;
- model gate compares the deployed provider/model to a captured expected pair and rejects all fallback fields;
- rootless Docker context is required before `execute_code` is reported ready;
- health includes exact provenance and protocol.

Product release-script tests must assert it records product commit, fork commit, upstream tag/commit, protocol/profile, model identifier hash, schema migration hash, test results and SHA-256 values without recording secrets.

- [ ] **Step 2: Run RED**

Hermes:

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_deployment_contract.py -q
```

Product:

```powershell
pnpm vitest run scripts/verify-xingyao-hermes-release.test.mjs scripts/create-xingyao-hermes-rollback.test.mjs
node scripts/verify-xingyao-hermes-release.mjs --help
```

Expected: candidate deployment and release scripts are absent.

- [ ] **Step 3: Implement candidate deployment without touching Legacy**

The install script must create a separate source/cache location and systemd unit. It must not delete or overwrite `/opt/xingyao-hermes-agent`, `/usr/local/bin/xingyao-hermes-run`, `xingyao-hermes.service`, port 8642 or the existing rollback bundle.

The runbook's candidate start sequence is:

```bash
cd /opt/xingyao-hermes-gateway
FORK_SHA="$(git rev-parse --short=12 HEAD)"
UPSTREAM_COMMIT="$(git rev-parse 'v2026.7.20^{commit}')"
sudo bash deploy/xingyao/install-candidate.sh
sudo systemctl enable --now xingyao-hermes-gateway
curl -fsS http://127.0.0.1:8642/healthz
curl -fsS http://127.0.0.1:8643/healthz
```

The product deploy remains repo-native:

```bash
cd /var/www/jingying-cabin
APP_DIR=/var/www/jingying-cabin \
BRANCH=codex/hermes-native-intelligence-restoration \
PM2_NAME=jingying-cabin \
SYSTEMD_UNIT=jingying-cabin \
bash scripts/deploy.sh
pm2 restart jingying-cabin --update-env
pm2 save
```

Start with `XINGYAO_HERMES_GATEWAY_ENABLED=false`, verify both services, then enable one exact `organizationUuid/userUuid` canary entry and restart PM2. Do not put secrets in shell history; the runbook must use root-owned `640` env files and `sudoedit`.

- [ ] **Step 4: Run deployment contract GREEN**

Hermes:

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_deployment_contract.py tests/xingyao/test_model_config_gate.py tests/xingyao/test_gateway_health.py -q
uv run --with ruff ruff check deploy/xingyao xingyao tests/xingyao
git diff --check
```

Product:

```powershell
node scripts/verify-xingyao-hermes-release.mjs --help
bash -n scripts/create-xingyao-hermes-rollback.sh
pnpm vitest run scripts/verify-xingyao-hermes-release.test.mjs scripts/create-xingyao-hermes-rollback.test.mjs
pnpm format:check
git diff --check
```

- [ ] **Step 5: Commit each repository separately**

Hermes:

```powershell
git add deploy/xingyao docs/xingyao/deployment.md tests/xingyao/test_deployment_contract.py
git commit -m "chore(xingyao): package the official gateway candidate"
```

Product:

```powershell
git add docs/runbooks/xingyao-hermes-gateway.md scripts/verify-xingyao-hermes-release.mjs scripts/verify-xingyao-hermes-release.test.mjs scripts/create-xingyao-hermes-rollback.sh scripts/create-xingyao-hermes-rollback.test.mjs package.json
git commit -m "chore(ai): add Hermes Gateway release controls"
```

## Task 20: Cross-Repository Security, Recovery, Quality Benchmark, And Final Gate

**Hermes files:**

- Create: `tests/xingyao/test_crash_recovery.py`
- Create: `tests/xingyao/test_runtime_performance_contract.py`
- Create: `tests/xingyao/test_security_matrix.py`
- Create: `tests/xingyao/fixtures/native_eval_cases.json`

**Product files:**

- Create: `features/ai/hermes/performance-contract.test.ts`
- Create: `features/ai/hermes/security-matrix.test.ts`
- Create: `scripts/test-xingyao-hermes-e2e.mjs`
- Create: `scripts/xingyao-hermes-eval-cases.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing acceptance harness**

Create at least 20 fixed prompts covering:

- general reasoning with no business tools;
- current context, project search/detail, streamer profile, reports, recording review, knowledge and settlement;
- one-tool failure with remaining evidence;
- all critical data missing;
- Fast vs Deep planning/delegation;
- Todo and Clarify;
- Session resume/search/summary/compression and cache rebuild;
- explicit personal memory and forbidden business-memory proposal;
- Skill list/view/draft/approval;
- safe public Web and SSRF denial;
- image/PDF/text attachment and cross-turn/path denial;
- isolated calculation and network denial;
- cancellation with active subagent;
- role downgrade and cross-org/user/session/replay attempts.

The harness must record completion/outcome, tool success, evidence refs, observation times, model/provider identity hash, iteration/subagent counts, latency, tokens and leaked-write count. It must never record prompt secrets or chain-of-thought.

- [ ] **Step 2: Run focused RED**

Product:

```powershell
pnpm vitest run features/ai/hermes/performance-contract.test.ts features/ai/hermes/security-matrix.test.ts
```

Hermes:

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao/test_crash_recovery.py tests/xingyao/test_runtime_performance_contract.py tests/xingyao/test_security_matrix.py -q
```

- [ ] **Step 3: Implement deterministic failure injection and evaluation**

Inject Gateway crashes at three points: before first delta, during a tool call and after final model text before product checkpoint. Verify product ledger reaches one deterministic terminal/recoverable state and restart never duplicates memory, Skill draft, tool audit or model Prompt.

Benchmark official tag and Xingyao build with the same provider/model/config and prompt set. For business prompts, both runs use the same immutable, non-production read-only fixture envelopes through a benchmark-only adapter; the official baseline never receives production credentials, and fixture mode is forbidden by the production config gate. Release criteria:

- integrated completion rate is no more than 5 percentage points below official;
- zero evidence-less numeric claims;
- zero cross-tenant leakage;
- zero business writes;
- zero provider/model fallback;
- Fast/Deep iteration and subagent traces differ as configured;
- all denial, replay, SSRF, attachment and sandbox escape cases fail closed;
- interrupt stops parent and children with no later provider/tool events.

- [ ] **Step 4: Run the complete local product gate**

```powershell
pnpm format:check
pnpm type-check
pnpm lint
pnpm test:ai-system
pnpm vitest run components/dashboard/overview-board.test.jsx components/dashboard/hermes-skill-draft-review.test.jsx features/ai/hermes/performance-contract.test.ts features/ai/hermes/security-matrix.test.ts
pnpm build
git diff --check
```

- [ ] **Step 5: Run the complete local Hermes gate**

```powershell
uv run --extra dev --extra xingyao-runtime pytest tests/xingyao -q
uv run --extra dev pytest tests/tui_gateway/test_session_platform_resolution.py tests/tui_gateway/test_gateway_owned_session_reap.py tests/tui_gateway/test_reasoning_session_scope.py tests/tui_gateway/test_subagent_child_mirror.py tests/tools/test_delegate.py tests/tools/test_skills_tool.py tests/tools/test_web_tools_config.py tests/tools/test_docker_network_config.py -q
uv run --with ruff ruff check xingyao plugins/memory/xingyao tools/xingyao_business_tools.py tools/xingyao_state_tools.py tools/xingyao_attachment_tool.py tests/xingyao
git diff --check
```

- [ ] **Step 6: Run real two-service smoke and capture evidence**

On the server, with one canary actor only:

```bash
cd /var/www/jingying-cabin
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8642/healthz
curl -fsS http://127.0.0.1:8643/healthz
node scripts/test-xingyao-hermes-e2e.mjs
node scripts/verify-xingyao-hermes-release.mjs
sudo bash scripts/create-xingyao-hermes-rollback.sh
```

Verify the generated rollback archive with `sha256sum -c`, `bash -n` on its restore script and a dry-run manifest inspection before expanding the allowlist.

- [ ] **Step 7: Commit acceptance harnesses**

Hermes:

```powershell
git add tests/xingyao/test_crash_recovery.py tests/xingyao/test_runtime_performance_contract.py tests/xingyao/test_security_matrix.py tests/xingyao/fixtures/native_eval_cases.json
git commit -m "test(xingyao): certify native gateway isolation and recovery"
```

Product:

```powershell
git add features/ai/hermes/performance-contract.test.ts features/ai/hermes/security-matrix.test.ts scripts/test-xingyao-hermes-e2e.mjs scripts/xingyao-hermes-eval-cases.json package.json
git commit -m "test(ai): certify Hermes native restoration"
```

## Final Review Checklist

Before opening PRs, inspect both diffs and answer every item with evidence:

- [ ] Product code never imports Gateway model credentials or exposes Gateway to the browser.
- [ ] Gateway environment contains no Supabase/product private credentials.
- [ ] Fork diff does not replace `AIAgent` or official Agent Loop/compression/delegation algorithms.
- [ ] `xingyao_native` is exclusive at schema and dispatch.
- [ ] Read API, Tool Broker and DB all enforce organization+user+role+scope.
- [ ] Actor downgrade invalidates Runtime Session and new tool calls immediately.
- [ ] SessionDB/profile/attachment/Skill paths contain opaque HMAC keys, not raw IDs.
- [ ] Personal memory and Skill draft are the only AI-owned writes; business-write count is zero.
- [ ] Subagents inherit reduced capability and cannot write memory/Skills.
- [ ] Web, attachment and compute escape suites pass.
- [ ] partial/blocked semantics replace false global upstream failures.
- [ ] no private reasoning is saved or displayed.
- [ ] current provider/model identity matches the pre-change baseline and fallback config is absent.
- [ ] Legacy 8642 remains healthy and untouched; new Gateway 8643 passes handshake.
- [ ] server-side allowlist starts with one exact actor and no `NEXT_PUBLIC_*` controls runtime choice.
- [ ] rollback package, checksum and restore-script syntax are verified.

## PR And Rollout Order

1. Push Hermes Fork branch and open a PR whose base is the Fork's official-integration branch. Record upstream tag/commit in the PR body.
2. Push product branch and open a PR against the actual product default branch `codex/full-project-ui`. Link the exact Fork commit/digest.
3. Merge neither PR until both local gates and the cross-repository smoke are attached as evidence.
4. Merge/deploy Hermes candidate first on 8643 with product flag off.
5. Apply additive DB migration and deploy product with Gateway flag off.
6. Enable one exact actor, run the acceptance suite, then expand organization by organization.
7. Keep Legacy 8642 for one stable observation window. Removing it is a separate change and is outside this plan.
