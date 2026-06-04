# AI Runtime Foundation Design

## Goal

把已完成的 P4/P5 规则版飞轮升级为真实 AI 系统的第一层地基：所有 AI/OCR/LLM 工作先具备可审计、可计量、可降级、可回放的运行时账本。这个阶段不追求 Agent 全量智能化，而是先让后续真实 OCR、真实多供应商 LLM、自动审核灰度、学习闭环和主动洞察有稳定落点。

## Current Baseline

仓库已有以下能力，可复用而不重做：

- `features/ai/ai-tool-layer.ts`：注册式 AI 工具层，已有 RBAC、主播端敏感字段剥离和审计写入。
- `features/auto-review/*`：自动审核 shadow/active 规则引擎和服务。
- `features/war-room/*`：规则版选播、报价、供应商评分和项目复盘。
- `features/billing/usage-metering.ts`：已有 `ocr`、`ai` usage metric 的计量入口。
- `supabase/migrations/20260601161000_initial_foundation.sql`：已有 `ocr_results`、`auto_review_rules`、`report_screenshots`、`live_reports` 等基础表。

当前缺口是：AI 调用没有统一 invocation 账本，OCR 还是结果占位表而非 job 化链路，LLM 没有 provider gateway，prompt 没有版本，工具调用没有独立审计粒度，学习闭环相关结果没有结构化沉淀。

## Scope

第一阶段包含三个工作包。

### AI-0 Baseline Gate

开始实现前保留当前 dirty worktree，不清理、不回滚、不混入无关修复。先运行：

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

如果基线失败，记录失败命令、失败摘要和是否属于现有 dirty 改动。除非失败直接阻塞 AI 地基设计，否则不在本阶段顺手修复无关问题。

### AI-1 Runtime Schema

新增迁移，建立 AI 运行时和学习闭环的最小数据模型：

- `ai_invocations`：一次 LLM/OCR/Agent/insight 调用的顶层账本，记录组织、actor、场景、provider 路由、状态、token、成本、耗时、prompt version、降级原因和错误摘要。
- `ai_tool_invocations`：一次 AI 调用内部的工具调用明细，记录工具名、输入输出摘要、耗时、授权结果、审计对象和失败原因。
- `background_jobs`：OCR、AI replay、insight scan 等后台任务队列，记录 job type、payload、status、attempt、run_after、locked_at、error。
- `prompts`：prompt key、version、status、content hash、schema、created_by、published_at，支持回放和灰度。
- `streamer_metrics`、`supplier_scores`、`scoring_weights`：承接后续学习闭环和供应商评分，不直接替换现有规则引擎。
- `recommendation_outcomes`：记录建议是否被采纳、人工结果、业务结果，用于后续效果学习。
- `project_reviews`、`ai_diagnoses`、`ai_script_versions`：保存项目复盘、主播诊断和脚本调优的结构化输出。

所有业务表必须包含 `organization_id`，开启 RLS。员工可按组织读取，写入仅允许服务端受控路径；主播端只能读取经过 DTO/安全视图允许的诊断结果。

### AI-1 Runtime Services

新增一组窄接口，而不是直接把外部 SDK 散落到业务代码里：

- `features/ai/invocation-ledger.ts`：创建、完成、失败 AI invocation，并同时写审计和 usage event。
- `features/ai/tool-ledger.ts`：记录工具调用明细，沿用现有注册工具和 RBAC 判断。
- `features/ai/llm-gateway.ts`：定义 provider contract、路由结果、结构化输出结果和 fallback/degraded 状态。
- `features/ai/providers/deterministic-provider.ts`：测试用 provider，保证本阶段不依赖真实外部密钥。
- `features/ai/ocr-jobs.ts`：把截图 OCR 变成 `background_jobs` 状态机，写入/更新 `ocr_results`，保留 raw JSON 和解析字段。

现有 `runAiToolQuery` 保持作为唯一公开工具入口之一；本阶段扩展它记录 `ai_invocations` 和 `ai_tool_invocations`，但不允许工具直接接收 SQL 或绕过 DTO。

## Non-Goals

- 不在本阶段启用完整 Agent Orchestrator。
- 不在本阶段要求真实 OpenAI、腾讯混元或腾讯 OCR 凭据可用。
- 不在本阶段把自动审核从 shadow 推到 active。
- 不在本阶段启用主动洞察定时扫描。
- 不写入真实外部服务密钥，不把 provider secret 放进仓库。
- 不做大范围 UI 重设计。

## Architecture

业务入口只调用 AI runtime 服务。AI runtime 负责：

1. 校验 actor、organization 和 feature entitlement。
2. 创建 `ai_invocations`，绑定 prompt version、scene、object type 和 object id。
3. 通过 LLM gateway 或 OCR job runner 调 provider。
4. 工具调用统一经过注册表，写 `ai_tool_invocations`。
5. 成功时写结构化结果和 usage event；失败时写错误摘要和 degraded reason。
6. 对外返回明确状态：`succeeded`、`failed`、`degraded`、`queued`。

后续真实 provider 只实现 provider contract，不改业务服务。OpenAI 可以成为工具调用和结构化输出主链路，混元可以成为中文生成、备用路由或 shadow 对照；这属于下一阶段接入，不影响本阶段 contract。

## OCR Flow

截图上传仍落在现有 `report_screenshots`。创建截图后，服务端创建一条 `background_jobs`：

```text
report_screenshot uploaded
-> background_jobs(type = "ocr.extract_live_report")
-> ocr_results(status = "pending")
-> worker/provider extracts duration/viewers/confidence/raw_json
-> ocr_results(status = "succeeded" | "failed" | "needs_confirmation")
-> live_reports only receives trusted parsed fields through existing review/evidence path
```

低置信、字段冲突、缺失时不自动覆盖 `live_reports`，只把结果标记为需要人工确认。自动回填必须走现有报数变更/审核路径，保留 `report_change_logs` 和高风险审计。

## LLM Gateway Contract

Provider 输入包含：

- `providerKey`
- `model`
- `promptKey`
- `promptVersion`
- `messages`
- `responseSchema`
- `tools`
- `metadata`

Provider 输出包含：

- `status`
- `text`
- `structuredOutput`
- `toolCalls`
- `usage`
- `latencyMs`
- `costCents`
- `rawResponse`
- `degradedReason`
- `errorSummary`

Gateway 不暴露 provider SDK 原始对象给业务层。业务层只处理结构化输出、状态和可展示的错误摘要。

## Security Boundaries

- AI 工具不能接受 raw SQL。
- AI 工具必须继承 actor role 和 organization scope。
- 主播端 DTO 不包含应收、毛利、成本、供应商成本、内部风险备注。
- 每次 AI 调用写 `ai_invocations`，每次工具调用写 `ai_tool_invocations`。
- 高风险建议不能自动执行，只能生成 recommendation，并等待人工采纳或拒绝。
- Prompt 发布需要版本化；历史调用永远能追溯到 prompt key/version/hash。
- Provider raw response 保留在受控表字段中，不直接返回给前端。

## Degradation

本阶段定义明确降级语义：

- provider 未配置：返回 `degraded`，记录 `provider_unconfigured`。
- provider 超时：按路由策略尝试 fallback；全部失败则返回 `failed`。
- 结构化输出不符合 schema：记录 `schema_validation_failed`，不写入业务结论。
- 工具鉴权失败：记录工具调用失败，不允许模型继续拿到敏感数据。

降级结果可以展示给经营端，但不能伪装成真实 AI 结论。

## Testing

新增或扩展测试：

- `lib/db/schema-contract.test.ts`：覆盖新表、RLS、索引和关键约束。
- `features/ai/invocation-ledger.test.ts`：覆盖成功、失败、降级、usage metering 和审计。
- `features/ai/tool-ledger.test.ts`：覆盖工具明细、授权失败和敏感字段边界。
- `features/ai/llm-gateway.test.ts`：覆盖 deterministic provider、fallback、schema validation、degraded 状态。
- `features/ai/ocr-jobs.test.ts`：覆盖 OCR job 创建、重试、成功、失败、低置信人工确认。
- 现有 `features/ai/ai-tool-layer.test.ts`：从 `mode: "placeholder"` 过渡为包含 invocation id 的结果，同时保持原有安全断言。

实现完成后运行：

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

如果本机 Docker/Supabase 可用，再运行 `pnpm supabase:migrate` 验证迁移。若环境不可用，记录具体阻塞，不把未运行说成通过。

## Acceptance

第一阶段完成时应满足：

- AI/OCR/LLM 相关调用都有统一 invocation 记录。
- 现有 AI 工具查询仍可用，并额外记录工具调用明细、审计和 usage。
- OCR 已从单纯占位结果变成可排队、可重试、可失败、可人工确认的 job 状态机。
- LLM gateway 可以用 deterministic provider 跑通结构化输出和 fallback 测试。
- 真实 provider 接入只需要新增 provider adapter 和配置，不需要改业务调用方。
- 自动审核、战情室、计费的既有 P4/P5 测试不因本阶段改造回退。

