# 星耀 AI 官方 Hermes Agent 源码改造设计

日期：2026-07-20
状态：已确认方向，待用户审阅书面设计

## 1. 结论

星耀 AI 不再把 Hermes 当作一个未经修改的外部 API 服务，也不参考 Hermes 重新自研内核。新的唯一基线是：

```text
星耀 AI = 对外产品名称
xingyao-hermes-agent = 基于 NousResearch/hermes-agent 官方源码维护的独立 Fork
当前 Next.js 产品 = 身份认证、业务数据、会话 UI、审计和只读数据面的所有者
```

Hermes 官方源码中的 `AIAgent`、agent loop、prompt assembly、provider resolution、tool registry、tool dispatch、skills 和 session runtime 构成星耀 AI 的真实内核。星耀只在必须产品化和安全化的位置做薄改造，不再实现第二套 Hermes-like runtime。

API 仍然存在，但它只是星耀产品调用自有 Hermes Fork 的传输入口，不再是“接一个外部黑盒”的集成边界。MCP 不是星耀核心数据访问主路径，只作为未来接入通用外部只读数据源的可选扩展。

## 2. 已确认产品决策

- 用户界面、入口和产品文案继续叫“星耀 AI”。
- 内核直接基于官方 [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) 源码改造。
- 建立独立仓库 `xingyao-hermes-agent`，不把 Hermes 全量源码复制进当前 Next.js 仓库，也不使用 Git submodule。
- `xingyao-hermes-agent` 保留官方仓库为 `upstream`，星耀 Fork 为 `origin`，生产镜像锁定准确提交和镜像 digest。
- 旧星耀 AI 的诊断、归因、风险雷达、grounding、deep-thinking 编排和回答口径全部下线，不包装成 Hermes skill，也不在新链路中调用。
- Hermes 可以读取当前用户有权读取的数据，但没有任何业务操作权限。
- 组织隔离和角色权限由星耀业务系统签发的不可伪造执行上下文决定，模型参数不得决定权限。
- 星耀业务 Skills 使用 Hermes 官方 Skills 机制，并允许通过星耀 Skill 中心受控安装；生产 Skills 是经过扫描、审批、签名和版本锁定的只读发布物，运行中的 Hermes 不得自行安装、创建、更新或删除。
- 首期禁用 Hermes Memory；星耀会话仍由产品会话系统持久化。后续只有在完成组织和用户命名空间隔离后才评估 Memory。
- 当前产品已有的认证、业务领域服务、只读 DTO、会话、附件净化、调用账本和审计属于平台基础设施，可以保留；旧 AI 推理和分析逻辑不保留。

## 3. 官方源码基线

官方架构中，`run_agent.py` 的 `AIAgent` 是统一内核，CLI、Gateway、ACP、API Server 和 Python Library 都只是入口。工具经过 `model_tools.py`、`tools/registry.py` 和 `toolsets.py` 完成发现、暴露与执行。参考：

- [Hermes Agent Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)
- [Agent Loop Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop)
- [Tools Runtime](https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime)
- [Toolsets Reference](https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference)
- [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)
- [Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
- [Working with Skills](https://hermes-agent.nousresearch.com/docs/guides/work-with-skills/)

官方默认 `hermes-api-server` toolset 保留文件、终端、浏览器、代码执行、定时任务、委派、Memory 和 Skills 管理等大部分能力，不能直接作为星耀生产配置。官方 `skills` toolset 也包含 `skill_manage`，不能原样开放。

因此，星耀必须在官方源码上增加自己的平台入口、请求执行上下文、只读工具集和双层策略校验，而不是只靠系统提示词或外围反向代理限制能力。

## 4. 仓库与版本策略

### 4.1 独立 Fork

新建独立仓库：

```text
xingyao-hermes-agent/
  upstream -> https://github.com/NousResearch/hermes-agent.git
  origin   -> 星耀维护的 Hermes Fork
```

该仓库直接保留官方历史和目录结构。星耀新增代码尽量集中在独立目录和小型调用点：

```text
xingyao-hermes-agent/
  xingyao/                         # 星耀执行上下文、策略、数据客户端
  plugins/xingyao/                 # 星耀原生只读工具和内置核心 Skills
  gateway/platforms/xingyao_api/   # 星耀专用服务端入口
  tests/xingyao/                   # 星耀安全与集成测试
```

实际目录可在克隆源码后按照官方当前版本结构微调，但责任边界不变。

### 4.2 上游同步

- 初始版本锁定一个官方稳定 release tag 和准确 commit SHA。
- 保留官方 MIT `LICENSE`、版权声明和上游来源说明。
- 星耀改动以可审查的小提交维护，避免大面积重写 `run_agent.py`。
- 上游升级必须走独立升级分支，执行完整安全、工具暴露、并发隔离和产品集成测试。
- 不自动跟随官方 `main`，不在未审计情况下自动发布新版 Hermes。
- 当前 Next.js 仓库通过容器镜像 tag 和 digest 引用 Fork，不依赖浮动 `latest`。

## 5. 总体架构

```text
星耀 AI UI
  -> Next.js 星耀 AI 会话路由
      -> getAuthContext() 解析真实用户、组织和角色
      -> 签发短期 XingyaoActorAssertion
      -> 调用 xingyao-hermes-agent 专用入口
          -> 验证服务身份和 ActorAssertion
          -> 创建不可变 XingyaoExecutionContext
          -> 官方 AIAgent.run_conversation(...)
              -> XingyaoSkillPolicy 解析当前组织、角色允许的已签名 Skills
              -> xingyao-readonly 原生工具集
                  -> 星耀内部 Read API
                      -> 现有业务领域服务与安全 DTO
                      -> 显式 organizationId / role / scope 校验
                      -> Supabase
          -> 流式返回回答、工具事件和证据引用
      -> 写入星耀会话、调用账本、工具日志和证据快照
      -> UI 继续显示“星耀 AI”
```

Hermes Fork 与 Next.js 产品分进程、分容器运行。Hermes 不持有 Supabase `service-role`，也不能直接访问生产数据库网络。

## 6. Hermes 源码改造点

### 6.1 星耀专用入口

在 Fork 中增加 `xingyao_api` 平台入口，复用官方 API Server 的流式、取消、session 和 `AIAgent` 能力，但使用独立路径，例如：

```text
POST /v1/xingyao/responses
GET  /v1/xingyao/runs/{runId}/events
POST /v1/xingyao/runs/{runId}/cancel
GET  /v1/xingyao/capabilities
```

生产网络只开放星耀专用入口。官方通用 API Server 入口不对产品网络开放，防止持有普通 API key 的调用者绕过星耀执行上下文。

每次请求必须同时通过：

- 服务间认证：内网 mTLS 或独立 Bearer service key。
- 用户执行上下文认证：`X-Xingyao-Actor` 短期签名断言。

### 6.2 不可变执行上下文

Next.js 后端在已经完成 `getAuthContext()` 后签发短期 JWS。推荐使用非对称签名，使 Hermes 只持有验签公钥，不能自行签发更高权限身份。

断言最少包含：

```text
iss
aud
sub / userId
organizationId
role
conversationId
allowedReadScopes
enabledSkillVersions
skillGrantsHash
pageContext
jti
iat
exp
```

约束：

- 有效期不超过 5 分钟，每个用户回合重新签发。
- `role` 必须属于现有 `owner`、`ops_manager`、`operator_business`、`finance`、`streamer` 枚举。
- `enabledSkillVersions` 只能由服务端根据当前组织、角色和已批准 Registry 解析，条目只包含不可变 `skillId + version`；`skillGrantsHash` 是其规范化摘要。
- `pageContext` 只包含经过校验的对象 ID 和页面类型，不携带客户端自报权限。
- 请求正文中的 `organizationId`、`role`、`allowedReadScopes`、`enabledSkillVersions` 或 `skillGrantsHash` 一律不可信；出现冲突时拒绝请求。
- 原始断言、服务密钥和下游访问凭证永不进入模型消息、tool schema、日志正文或错误输出。

Fork 新增不可变 `XingyaoExecutionContext`，并显式沿以下链路传递：

```text
xingyao_api
  -> AIAgent
      -> run_conversation
          -> model_tools.handle_function_call
              -> tools.registry.dispatch
                  -> tool handler kwargs
```

不能只使用进程全局变量保存 actor。并发的不同组织请求必须拥有彼此独立的执行上下文，运行结束后立即释放。

### 6.3 工具策略双重校验

工具权限同时在两个位置执行：

1. Schema 暴露阶段：模型只看到当前星耀 profile 和当前角色允许的工具。
2. Dispatch 执行阶段：即使构造伪造 tool call，也必须再次检查 tool allowlist、只读标记、actor scope 和目标对象归属。

源码新增 `XingyaoToolPolicy`，至少检查：

- 工具属于 `xingyao-readonly` 或明确允许的只读系统工具集。
- 工具元数据声明 `read_only=true`。
- 当前角色和 `allowedReadScopes` 满足工具要求。
- 工具没有接收或覆盖 actor 身份字段。
- 目标 project、streamer、report、recording、settlement 等对象属于当前组织且当前角色可见。
- 工具结果经过大小限制、字段脱敏和证据元数据封装。

策略拒绝必须返回结构化 `permission_denied` 或 `tool_not_allowed`，同时写入安全审计事件。

### 6.4 星耀生产 Toolset

新增严格白名单平台 toolset：

```text
hermes-xingyao
  includes:
    xingyao-readonly
    xingyao-skills-readonly
```

首期不包含：

- `terminal`
- `file`
- `browser`
- `web`
- `image_gen`
- `code_execution`
- `cronjob`
- `delegation`
- `messaging`
- `memory`
- 官方完整 `skills`
- 任意动态 `mcp-*`

如果后续需要 Web、Vision 或 MCP，必须分别完成威胁建模和单独上线审批，不能通过 `safe`、`all`、`*` 或默认 `hermes-api-server` 间接引入。

## 7. 星耀原生只读工具

星耀核心数据工具直接作为 Fork 内的第一方 Python plugin/tool 实现，而不是先建设 Hermes MCP Server。工具只负责参数校验、调用星耀内部 Read API、封装证据和错误；业务权限与查询规则仍由星耀产品数据面掌握。

首批工具：

- `xingyao_get_current_context`
- `xingyao_search_projects`
- `xingyao_get_project_summary`
- `xingyao_get_streamer_project_profile`
- `xingyao_search_live_reports`
- `xingyao_search_recording_reviews`
- `xingyao_search_knowledge`
- `xingyao_get_settlement_summary`

工具 schema 不得出现 `organizationId`、`userId`、`role` 或权限 scope 参数。这些值只能来自隐藏的 `XingyaoExecutionContext`。

统一工具结果契约：

```text
status
data
evidenceRefs[]
sourceLabels[]
updatedAt
missingData[]
permissionDenials[]
truncated
```

所有业务文本都作为不可信数据处理，不能覆盖 system prompt、Skills 或工具政策。工具结果需要携带来源类型和对象 ID，供星耀产品写入证据快照。

## 8. 星耀内部 Read API

当前 Next.js 仓库新增仅内网可达的 Hermes Read API。它不是开放式 SQL、GraphQL 或任意表查询接口，而是按业务对象设计的固定只读端点。

Read API 必须：

- 验证同一份短期 ActorAssertion 或由它派生的只读 token。
- 从断言恢复 actor，不信任 URL、body 或 Hermes 参数中的组织和角色字段。
- 复用现有领域服务、scoped repository 和安全 DTO，不复用旧星耀 AI 分析器。
- 每个查询显式接收 `organizationId`，并执行既有角色权限和对象归属校验。
- 不返回原始数据库行、内部密钥、完整手机号、收款账号、供应商敏感价格或角色不可见字段。
- 限制页大小、时间范围、结果体积和单回合调用次数。
- 为每次调用生成 `toolInvocationId`、`traceId` 和可审计证据引用。
- 不提供任何 POST/PATCH/DELETE 业务 mutation 语义。

星耀 Fork 只持有 Read API 地址、服务认证凭证和当前回合短期 actor 断言，不持有数据库密钥。

## 9. 组织隔离与角色权限

Hermes 不定义新的业务权限矩阵，也不拥有超级角色。`allowedReadScopes` 由当前产品根据真实 `AuthContext` 和既有业务策略计算，Hermes 只能进一步缩小权限，不能扩大权限。

四层隔离必须同时成立：

1. 请求层：ActorAssertion 绑定组织、用户、角色、会话和有效期。
2. Agent 层：每个 `AIAgent` run 持有独立执行上下文，禁止跨 run 复用 actor。
3. Tool 层：schema 暴露与 dispatch 都做角色和 scope 校验。
4. 数据层：Read API 和 repository 再做组织过滤、对象归属、字段级脱敏及适用的 RLS 校验。

缓存、会话、证据和幂等键必须至少包含：

```text
organizationId + userId + role + scopesHash + skillGrantsHash + conversationId + profileVersion
```

任何仅以 `conversationId`、`sessionId` 或自然语言名称作为隔离键的实现都不合格。

每个回合都重新从当前服务端认证状态计算 actor fingerprint。恢复 Hermes session 前必须与会话保存的 fingerprint 比较；组织、角色、scopes、Skill grants 或 profile version 任一发生变化时，立即终止旧 Hermes session 并创建新 session，旧工具结果和旧 Skill 内容不得重新注入新权限上下文。产品若支持切换组织，也必须先在服务端重新验证该用户的有效 membership，不能直接接受客户端选择值。

## 10. 无操作权限

Hermes 可做的事情只有：读取授权数据、分析、解释、比较、生成建议、输出草稿文本和指出数据缺口。

Hermes 工具表中不得存在以下能力：

- 创建、修改、删除项目、主播、账号、客户、排班或任务。
- 确认、驳回、修改报数或录屏审核结果。
- 创建、修改、锁定、重开、确认结算。
- 确认收款、付款、开票、关账或修改财务证据。
- 发布知识库、修改业务规则或覆盖历史快照。
- 调用任意业务 mutation route、数据库写接口或通用终端。

星耀产品后端可以在 Hermes 回答结束后写入以下 AI 基础设施记录：

- 会话消息。
- AI invocation ledger。
- tool invocation log。
- evidence snapshot。
- 纯 AI 草稿产物。
- 拒绝、超时和安全事件。

这些写入由 Next.js 产品代码执行，不是 Hermes 工具权限，也不能改变业务状态。任何草稿进入正式业务流程仍需用户在现有业务界面中明确确认。

## 11. Skills 与 Skill 中心

### 11.1 保留官方 Skills 内核

保留 Hermes 官方 Skills 的渐进披露、`skills_list`、`skill_view`、Skill metadata、引用文件和模板加载能力。星耀不重新实现 Skill 格式或加载协议。

Skills 分为两类：

1. 内置核心 Skills：随 `xingyao-hermes-agent` 版本发布，承载星耀基础业务语义和统一输出规范。
2. 受控安装 Skills：来自 Hermes 官方目录、批准的 GitHub 仓库或其他白名单来源，经星耀 Skill 中心审核后独立发布，不要求重建 Hermes 镜像。

首批内置核心 Skills：

```text
plugins/xingyao/skills/
  business-context/SKILL.md
  project-review/SKILL.md
  report-precheck/SKILL.md
  settlement-analysis/SKILL.md
```

每个 Skill 必须声明：

- 适用问题和非适用问题。
- 可调用的星耀只读工具。
- 必需证据和引用格式。
- 数据不足时应提出的澄清或缺口。
- 禁止动作和人工确认边界。
- 输出结构和敏感字段规则。

### 11.2 安装与发布链路

星耀允许安装 Skill，但安装是平台控制面操作，不是 Hermes runtime 工具调用：

```text
Hermes 官方目录 / 白名单 GitHub / 批准 URL
  -> 隔离下载区
  -> 官方包解析与完整 bundle 扫描
  -> 星耀能力清单和安全策略校验
  -> 平台管理员人工审批
  -> 签名的不可变 Skill Registry
  -> 组织所有者按组织和角色启用
  -> Hermes 只读加载当前 actor 获准的版本
```

Fork 应复用官方 Hermes 的 Skill 下载、引用文件收集、隔离扫描和 lock metadata 代码，但这些模块只能运行在独立构建 worker 或 Skill 中心服务中。生产 Agent 容器不提供公网 Hub 安装入口，也不持有 Skill Registry 写凭证。

每次发布必须固定并记录：

- `skillId`、语义版本和发布状态。
- 来源类型、来源 URL、仓库 commit 或上游版本。
- 完整 bundle 内容哈希、扫描器版本、扫描结果和审批人。
- 包签名、发布时间、撤销状态和可回滚的上一版本。
- 所需 `toolsets`、具体工具、读取 scopes、允许角色和数据分类。
- 是否需要网络、环境变量、可执行脚本或业务写入。

首版策略固定为：

- `requiredToolsets` 和 `requiredTools` 必须是 `hermes-xingyao` 当前只读 allowlist 的子集。
- `businessWrites` 必须为 `false`。
- Skill 不得声明公网网络访问或 Skill 专属密钥、环境变量。
- `scripts/` 和其他可执行内容拒绝发布；`references/`、`templates/`、`examples/` 和静态 `assets/` 可在扫描后发布。
- 扫描告警不能使用 `--force` 绕过；策略不通过时只能修订 bundle 后重新审核。
- 更新产生新不可变版本，不得原地覆盖已发布内容。

### 11.3 组织与角色授权

Skill 安装、批准、启用和使用是不同权限：

- 平台管理员可以提交来源、审核并发布全平台可用版本。
- 组织所有者只能从已批准 Registry 中为自己的组织和指定角色启用或停用版本，不能修改 Skill 内容或扩大其能力清单。
- 普通业务用户只能使用当前组织、当前角色和当前读取 scopes 允许的 Skills。
- Hermes 可以生成“建议安装或改进某个 Skill”的文本草稿，但不能调用 Skill 中心 API、提交审批、发布版本或改变组织启用状态。

Skill 中心写接口不得出现在 Hermes tool schema、Read API 或 `hermes-xingyao` toolset 中。所有安装、审批和启用动作都由已认证用户在独立管理界面明确执行并进入管理审计。

Fork 新增 `XingyaoSkillPolicy`。它从隐藏的 `XingyaoExecutionContext` 和服务端下发的 Skill grants 计算可见集合，并在以下位置重复校验：

1. system prompt 的 Skill 索引。
2. `skills_list` 返回结果。
3. `skill_view` 和引用文件加载。
4. 显式 Skill 名称、slash command 或 bundle 解析。

不能只隐藏列表；任何直接按名称加载未授权 Skill 的请求也必须返回 `permission_denied`。组织 A 启用的 Skill、版本或配置不能被组织 B 发现或加载。

actor fingerprint 增加已启用 Skill grants 的稳定哈希，至少覆盖 `skillId + version + organizationId + allowedRoles + requiredReadScopes`。Skill 被升级、停用或撤销时，旧 Hermes session 立即失效，旧 Skill 内容不得继续留在新回合上下文中。

### 11.4 生产运行时边界

生产环境只开放 `skills_list` 和 `skill_view` 的等价只读能力，不开放 `skill_manage`、`/learn`、Hub install/update/uninstall/publish 或自动 self-improvement。Skills 以只读目录或只读 Registry snapshot 提供，加载前验证签名、哈希、状态和 actor grant。

内置 Skills 更新必须经过代码审查、测试和镜像发布；受控安装 Skills 更新必须经过隔离扫描、人工审批、版本发布和组织重新授权。两类 Skills 都不得绕过工具策略，也不能通过说明文字恢复已禁用的 terminal、file、browser、code execution、Memory 或业务写能力。

## 12. 会话与 Memory

首期由星耀产品会话系统保存用户消息、Hermes 回答、工具摘要和 evidence refs。Hermes session 只承担单次会话运行所需的上下文，不作为跨组织业务事实库。

产品读取历史会话时仍需按当前组织和角色重新授权。用户权限被降低后，不能因为曾经参与过该会话就继续获得已不再有权查看的业务证据。

首期明确禁用：

- Hermes 持久化 Memory tool。
- 跨会话自动学习业务事实。
- 自动安装、创建、修改或发布 Skills。
- session search 跨用户或跨组织检索。

后续若启用 Memory，必须先实现 `organizationId + userId + profile` 命名空间、数据分类、用户删除、过期策略和越权回归测试。

## 13. 当前产品仓库改造边界

当前 Next.js 仓库负责：

- 保留“星耀 AI”入口和现有会话 UI。
- 在服务端通过 `getAuthContext()` 解析真实 actor。
- 计算只读 scopes、已批准 Skill grants 并签发 ActorAssertion。
- 调用 `xingyao-hermes-agent` 专用入口并映射 SSE 事件。
- 提供固定、内网、只读的 Hermes Read API。
- 提供独立的 Skill 中心管理界面、审核控制面和按组织/角色启用策略；这些写接口不对 Hermes 开放。
- 保存会话、调用、工具、证据和安全审计记录。
- 在切换完成后删除旧星耀 AI 运行链路。

以下旧 AI 模块不得进入新 Hermes 路径，并在最终切换后删除或确认无引用：

- `features/ai/xingyao-*`
- `features/ai/dashboard-chat-grounding.ts`
- 旧星耀 assistant、risk radar、attribution、feature store 和 weights 链路。
- `/api/ai/chat` 中直接加载旧 grounding、调用旧 provider gateway 和生成旧星耀回答的逻辑。
- 旧 deep-thinking 方案和仅服务旧回答口径的测试夹具。

可以保留的仅是与具体旧 AI 行为无关的通用基础设施，例如认证、会话存储、附件净化、审计账本、业务领域服务和安全 DTO。保留不等于把旧星耀能力换名复用。

## 14. MCP 的定位

MCP 不作为首期星耀核心数据访问方案。核心业务数据通过 Fork 内置星耀工具调用受控 Read API。

未来只有以下场景考虑 MCP：

- 接入不属于星耀核心数据库的第三方只读数据源。
- 数据源已经提供成熟、可审计、支持认证的 MCP Server。
- 完成单独的工具 allowlist、输出净化、prompt injection 和组织隔离审查。

任何动态 `mcp-*` toolset 默认关闭，不能因为 MCP Server 已配置就自动进入 `hermes-xingyao` profile。

## 15. 安全与部署

`xingyao-hermes-agent` 以独立容器部署：

- 非 root 用户运行。
- 根文件系统只读，只有临时目录可写。
- 不挂载产品源码、生产文件目录或用户主目录。
- 不安装通用 shell 工作流所需凭证。
- 网络出站只允许模型 provider、星耀 Read API 和必要可观测性端点。
- Agent runtime 不允许访问公网 Skills Hub、GitHub 或 Skill 中心写接口；只有隔离的 Skill 构建 worker 可以按来源白名单出站。
- 数据库网段对 Hermes 容器不可达。
- 专用入口只在内网暴露，配置速率限制、请求大小限制和并发上限。
- 日志默认脱敏，不记录 ActorAssertion、附件全文、收款信息和完整业务数据。

生产配置不得使用官方默认 `hermes-api-server`、`all`、`*` 或 `hermes-cli` toolset。

## 16. 错误与降级

- ActorAssertion 缺失、过期、audience 错误或签名失败：拒绝请求，不启动 `AIAgent`。
- actor 与请求中的对象范围冲突：返回 `permission_denied` 并记录安全事件。
- 工具不在 allowlist：dispatch 层拒绝，不能仅依赖模型不调用。
- Read API 不可用：Hermes 明确说明业务数据暂不可用，不基于记忆猜测。
- 数据不足：返回 `missingData`，不得编造内部事实。
- 模型或 Hermes 超时：结束当前 run，记录错误，不回退旧星耀 AI。
- Skills 加载失败：只允许无 Skill 的受限回答或直接失败，不临时启用通用工具集。
- Skill 签名、哈希、发布状态或 actor grant 校验失败：拒绝加载并记录安全事件；不得回退到未审核版本。
- Skill 被撤销或组织停用：新回合立即拒绝加载，并通过 fingerprint 失效旧 session。
- 上游升级导致安全测试失败：禁止发布，继续使用上一已验证镜像。

回滚只允许回滚到上一版 `xingyao-hermes-agent` 镜像，不允许回退到旧星耀 AI 内核。

## 17. 测试要求

### 17.1 Hermes Fork

- 无有效 ActorAssertion 时专用入口拒绝请求。
- 请求正文不能覆盖组织、角色和 scopes。
- 两个组织并发运行时 execution context 不串线。
- 模型 schema 中只出现当前角色允许的只读工具。
- 伪造 tool call 在 dispatch 层仍被拒绝。
- `terminal`、`file`、`browser`、`code_execution`、`cronjob`、`delegation`、`memory`、`skill_manage` 不可见且不可执行。
- 所有星耀工具都拒绝缺失 execution context 的调用。
- 工具输出中的提示注入文本不能改变系统政策。
- Skills 只能读取，运行时无法安装、新增、修改、更新、发布或删除。
- 未授权 Skill 在 prompt index、`skills_list`、`skill_view`、slash command 和 bundle 路径中均不可见且不可加载。
- Skill 声明写工具、额外网络、环境变量或可执行脚本时无法通过发布策略。
- Skill 签名、哈希、状态或版本不匹配时拒绝加载。
- Skill grants 变化后旧 session fingerprint 失效。

### 17.2 Next.js 产品

- ActorAssertion 只能从服务端 `AuthContext` 生成。
- 客户端提交的组织、角色和 scopes 被忽略或拒绝。
- Read API 对 `owner`、`ops_manager`、`operator_business`、`finance`、`streamer` 使用既有权限规则。
- 跨组织对象 ID、无权角色和字段级敏感数据测试返回拒绝。
- Read API 不存在业务写路由或通用查询入口。
- `/api/ai/chat` 新路径不再调用旧 grounding、旧 Xingyao 模块或旧 provider gateway。
- SSE、取消、超时、会话恢复、调用账本和 evidence refs 可完整闭环。
- Skill 中心安装、审批、发布和组织启用接口要求独立管理权限，且不出现在 Hermes 可调用工具中。

### 17.3 端到端安全用例

- 组织 A 用户无法通过提示词、对象 ID、缓存键或 session ID 读取组织 B 数据。
- 主播角色不能读取其他主播、组织财务、内部风险备注或供应商敏感字段。
- 财务角色不能因为 Hermes 获得其业务权限之外的数据。
- 组织 A 启用的 Skill 及其内容、版本和配置不能被组织 B 发现或加载。
- 用户要求“直接修改、确认、结算、付款、发布”时，Hermes 只能解释或给草稿，不产生工具调用。
- 删除旧星耀模块后，新聊天仍能完成一次带来源的只读业务回答。

## 18. 实施阶段

### 阶段 1：建立官方源码 Fork

- 创建 `xingyao-hermes-agent` 独立仓库。
- 配置 `upstream`、锁定官方稳定 tag 和 SHA。
- 建立独立 CI、镜像和上游同步规范。
- 验证未修改官方基线测试。

### 阶段 2：完成安全内核改造

- 实现 `xingyao_api` 专用入口。
- 实现 ActorAssertion 和 `XingyaoExecutionContext`。
- 修改 `AIAgent -> model_tools -> registry` 的显式上下文传递。
- 实现 `XingyaoToolPolicy` 和 `hermes-xingyao` toolset。
- 完成无高风险工具、并发隔离和绕过测试。

### 阶段 3：接通只读数据面

- 在当前产品仓库实现 ActorAssertion 签发和 Hermes Read API。
- 在 Fork 中实现首批原生只读工具。
- 打通组织、角色、对象归属、字段脱敏、证据和审计。

### 阶段 4：切换星耀 AI

- `/api/ai/chat` 和会话 turn 路由切换到 `xingyao-hermes-agent`。
- 保持 UI 名称和必要的会话交互合同。
- 删除旧星耀回答、grounding、risk、attribution 和 provider 调用路径。
- 不设置旧内核 fallback。

### 阶段 5：建设 Skill 中心和生产加固

- 发布首批内置核心 Skills。
- 建设隔离下载、扫描、能力清单校验、人工审批、签名 Registry、版本撤销和回滚链路。
- 实现 `XingyaoSkillPolicy` 及按组织、角色、读取 scopes 的 Skill grants。
- 提供独立管理界面，由平台管理员发布、组织所有者启用，Hermes runtime 不拥有管理入口。
- 完成只读容器、网络隔离、密钥轮换和可观测性。
- 完成全链路安全验收后再进入生产。

## 19. 首版上线验收标准

- 运行的是官方 Hermes Agent 源码 Fork，而不是自研内核或未修改黑盒服务。
- 用户仍只看到“星耀 AI”。
- 每个回合都绑定经过签名的组织、用户、角色、会话和只读 scopes。
- Hermes 只能看到当前组织、角色和读取 scopes 获准的已签名 Skills，以及星耀原生只读工具。
- Skill 可通过受控 Skill 中心安装和升级，但生产 Hermes 不能自行安装、修改、发布或启用 Skill。
- Skill 版本可审计、可撤销、可回滚，组织间的 Skill 发现和加载严格隔离。
- Hermes 不持有 Supabase 密钥，不能访问生产数据库，不能调用业务写接口。
- 同组织不同角色和不同组织之间的读取隔离有自动化测试证明。
- 新聊天路径不调用任何旧星耀 AI 分析逻辑，旧内核不可回退。
- 回答包含来源、证据引用、数据更新时间、数据缺口和权限拒绝信息。
- 所有请求、工具调用、拒绝、超时和证据快照可审计。
- 官方上游升级可以通过受控 rebase/merge 和固定测试重新发布，不需要重写星耀产品集成。

## 20. 非目标

- 不在当前 Next.js 仓库重新实现 Hermes agent loop。
- 不把官方 Hermes 全量源码复制进当前仓库。
- 不让 Hermes 直接连接 Supabase 或持有 `service-role`。
- 不保留旧星耀 AI 功能、回答口径或 fallback。
- 不开放通用终端、文件、浏览器、代码执行、定时任务、委派或业务 mutation。
- 首期不开放 Hermes Memory、自动学习、Skill 自主安装或改写、可执行 Skill 脚本或动态 MCP。
- 不向用户展示隐藏思维链。
