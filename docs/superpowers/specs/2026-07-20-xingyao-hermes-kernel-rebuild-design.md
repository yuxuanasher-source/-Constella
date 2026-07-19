# 星耀 AI Hermes 内核重构设计

日期：2026-07-20
状态：草案，待审阅

## 目标

对外产品名称继续使用“星耀 AI”，但产品 AI 内核整体替换为 Hermes。旧星耀 AI 的诊断、归因、风险雷达、grounding、深度思考编排和体验口径全部不保留，不做兼容层迁移。

Hermes 是新的只读业务智能体内核。它负责理解用户问题、读取授权数据、调用受控 skills、生成证据包、校验来源、形成建议和草稿，并把每次调用写入可审计记录。Hermes 有数据访问权限，但没有业务操作权限。

## 已确认的产品决策

- 对外名字不变：用户界面、产品文案和入口仍叫“星耀 AI”。
- 内核重建：内部 AI 内核命名为 Hermes，后续新能力不再进入 `xingyao-*` 模块。
- 旧功能不保留：旧星耀经营诊断、风险预警、归因模型和旧 grounding 口径全部下线。
- Hermes 是只读智能体：可以读取授权数据、生成分析、建议、草稿和模拟结果，不能执行业务变更。
- 权限继承当前用户：Hermes 不拥有超级权限，不绕过组织隔离、角色权限或页面上下文。
- Skills 是新能力扩展方式：业务能力通过受控 skill registry 挂载，而不是把逻辑继续堆进聊天 prompt。
- 通用基础设施可复用：AI Gateway、会话、附件净化、知识库、Web Search、调用账本、审计和 RBAC 校验不属于旧星耀功能，可以继续作为底座使用。

## 非目标

- 不保留旧星耀模块的用户体验或回答口径。
- 不把旧 `xingyao` 诊断能力包装成 Hermes skill。
- 不允许 Hermes 调用业务写接口。
- 不让 Hermes 直接确认报数、审核录屏、修改排班、修改项目、修改主播状态、发布知识库、生成或锁定结算、确认收付款。
- 不建设开放式、无限递归的通用 Agent Runtime。
- 不向用户展示隐藏思维链。

## 总体架构

```text
用户看到的星耀 AI
  -> Hermes Kernel
      -> Intent Planner
      -> Source Intelligence
      -> Skill Registry
      -> Evidence Validator
      -> Safety Gateway
      -> Response Synthesizer
      -> Audit Ledger
```

用户仍从“星耀 AI”入口提问。服务端入口完成认证、组织解析、角色解析、附件净化和会话创建后，把请求交给 Hermes Kernel。Hermes 根据当前用户、组织、页面上下文和问题类型生成只读执行计划，再通过受控数据访问层和 skills 获取证据，最终返回带引用、缺口和人工确认提示的回答。

## 模块边界

建议新增 `features/ai/hermes/` 作为新内核边界：

- `kernel`：编排一次用户请求的完整生命周期。
- `planner`：识别意图、拆分任务、判断需要哪些来源和 skills。
- `source-intelligence`：把内部数据、知识库、附件和外部搜索统一成证据包。
- `data-access`：只读数据访问门面，强制组织隔离和角色过滤。
- `skill-registry`：注册、发现、校验和调用受控业务 skills。
- `evidence-validator`：校验来源、时间、组织范围、引用完整性和数据缺口。
- `safety-gateway`：阻止越权问题、业务写操作和高风险自动化。
- `synthesizer`：把证据和 skill 输出合成为面向用户的中文回答。
- `audit`：记录调用、数据来源、skill 调用、降级和拒绝原因。

旧 `features/ai/xingyao-*` 模块进入退役路径。实施时应逐步断开入口、移除引用、删除测试夹具和文案依赖，而不是把它们改名成 Hermes。

## 数据访问权限

Hermes 可以读取数据，但读取必须经过 `HermesDataAccess`。任何 skill 和模型阶段都不得直接持有 Supabase client 或自行拼接跨组织查询。

每次 Hermes 请求必须绑定：

- `organizationId`
- `userId`
- `role`
- `pageContext`
- `allowedScopes`
- `conversationId`

数据访问规则：

- 所有查询必须强制加 `organizationId` 过滤。
- 所有查询必须继承当前用户角色权限。
- 页面上下文只能缩小访问范围，不能扩大权限。
- 用户请求跨组织数据时必须拒绝。
- 用户请求超出角色权限的数据时必须拒绝或返回“当前角色无权访问该数据”。
- 附件、知识库命中和外部搜索摘要必须绑定当前组织与会话。
- 证据包不得混入其他组织的资料、缓存或历史会话内容。

## 无操作权限

Hermes 不接收任何业务 mutation authority。

禁止直接执行：

- 创建、修改或删除项目、主播、排班、账号、任务或客户资料。
- 确认、驳回或修改报数。
- 审核、采用或驳回录屏。
- 创建、修改、锁定、重开或确认结算批次。
- 确认收款、付款、开票或财务关账。
- 发布正式知识库内容。
- 修改不可逆证据、审计记录或历史快照。

允许写入的只有 AI 系统自身的 append-only 记录：

- 会话消息。
- Hermes 调用账本。
- skill 调用记录。
- 证据引用快照。
- 待确认草稿。
- 拒绝和降级日志。

这些写入不代表业务动作，必须可审计、可追溯、不可覆盖历史。

## Skills 模型

Hermes skills 是受控业务能力单元。每个 skill 必须声明：

- `id`
- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `requiredScopes`
- `readSources`
- `writesAiArtifacts`
- `forbiddenActions`
- `evidencePolicy`
- `timeoutMs`

第一版建议只实现基础 registry 和 2-3 个低风险 skills，用于验证内核形态：

- `business_context_summary`：汇总当前页面和组织经营上下文。
- `evidence_gap_check`：检查回答所需数据是否齐全。
- `draft_response_builder`：基于证据包生成待人工确认的建议草稿。

后续再逐步新增复盘、预审、录屏归因、结算规则草稿、财务建议等业务 skills。任何钱、证据、审核和排班相关 skill 默认只能生成草稿或模拟，不允许直接执行。

## 回答契约

Hermes 返回给星耀 AI UI 的回答必须包含结构化元数据：

```text
answer
evidenceRefs
missingData
permissionDenials
skillsUsed
suggestedActions
draftArtifacts
auditId
```

回答规则：

- 有事实必须能追溯到 evidence ref。
- 数据不足必须明确说明缺口。
- 外部搜索只能作为参考，不得覆盖内部事实。
- 建议动作必须标记为“需人工确认”。
- 权限不足不能用猜测补齐。
- 涉及钱、审核、证据和结算的回答必须附带安全提示。

## 会话与状态

现有会话协议可以复用，但状态语义改为 Hermes 内核：

```text
accepted
  -> planning
  -> sourcing
  -> skill_running
  -> validating
  -> synthesizing
  -> completed
```

失败状态包括：

- `permission_denied`
- `insufficient_context`
- `source_unavailable`
- `skill_failed`
- `validation_failed`
- `provider_failed`

如果 Hermes 不可用，星耀 AI 不回退到旧星耀功能。第一版可以返回明确失败态：“星耀 AI 内核暂不可用，请稍后重试。”

## 下线旧星耀能力

实施时需要明确删除或断开的旧能力：

- 旧星耀 feature store。
- 旧星耀 assistant。
- 旧星耀 risk radar。
- 旧星耀 attribution engine。
- 旧星耀 grounding 注入。
- 旧星耀 deep thinking 设计和实现路径。
- 旧星耀 UI 中依赖特定诊断、风险或归因口径的文案。

删除顺序应由实施计划决定，但最终代码中不应存在新的 Hermes 调用旧 `xingyao-*` 模块的路径。

## 安全测试要求

第一版必须覆盖：

- Hermes 读取数据时强制带 `organizationId`。
- 运营角色无法读取老板专属数据。
- 主播角色无法读取其他主播、其他项目或组织级经营数据。
- Hermes skill 不能拿到原始 Supabase client。
- 请求业务写操作时返回拒绝，不调用业务写接口。
- 外部搜索结果不会被标记为内部事实。
- 证据引用缺失时回答进入 validation failed 或降级回答。
- Hermes 不可用时不会回退旧星耀功能。

## 验收标准

- UI 对外仍显示“星耀 AI”。
- 新请求路径进入 Hermes Kernel。
- 旧星耀 AI 核心模块不再被聊天、作战台或复盘入口调用。
- Hermes 所有业务数据读取都经过统一只读数据访问层。
- Hermes 的回答包含 evidence refs、missing data、skills used 和 audit id。
- 所有高风险业务变更只生成建议或草稿，不执行操作。
- 组织隔离和角色权限有自动化测试覆盖。
- 不存在从 Hermes 到业务 mutation route/service 的直接调用。

## 后续实施建议

第一阶段只做内核替换和最小 skill registry，不急着重建全部业务 AI 能力。先让星耀 AI 的所有入口接入 Hermes，并证明权限、证据、审计和无操作边界成立。

第二阶段再按业务价值增加 skills：

- 作战台经营解释。
- 主播项目复盘。
- 报数和 OCR 预审。
- 录屏质量归因。
- 结算规则草稿。
- 财务与合规建议。

每个业务 skill 都必须先定义权限、来源、证据契约和禁止动作，再进入实现。
