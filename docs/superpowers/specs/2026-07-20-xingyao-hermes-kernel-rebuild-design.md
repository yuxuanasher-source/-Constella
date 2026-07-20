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
- 星耀业务 Skills 使用 Hermes 官方 Skills 机制，但生产 Skills 是只读发布物，Hermes 不得自行创建或修改。
- 首期禁用 Hermes Memory；星耀会话仍由产品会话系统持久化。后续只有在完成组织和用户命名空间隔离后才评估 Memory。
- 当前产品已有的认证、业务领域服务、只读 DTO、会话、附件净化、调用账本和审计属于平台基础设施，可以保留；旧 AI 推理和分析逻辑不保留。

## 3. 官方源码基线

官方架构中，`run_agent.py` 的 `AIAgent` 是统一内核，CLI、Gateway、ACP、API Server 和 Python Library 都只是入口。工具经过 `model_tools.py`、`tools/registry.py` 和 `toolsets.py` 完成发现、暴露与执行。参考：

- [Hermes Agent Architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)
- [Agent Loop Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop)
- [Tools Runtime](https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime)
- [Toolsets Reference](https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference)
- [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)

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
  plugins/xingyao/                 # 星耀原生只读工具和固定 Skills
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
              -> 固定星耀 Skills
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
pageContext
jti
iat
exp
```

约束：

- 有效期不超过 5 分钟，每个用户回合重新签发。
- `role` 必须属于现有 `owner`、`ops_manager`、`operator_business`、`finance`、`streamer` 枚举。
- `pageContext` 只包含经过校验的对象 ID 和页面类型，不携带客户端自报权限。
- 请求正文中的 `organizationId`、`role`、`allowedReadScopes` 一律不可信；出现冲突时拒绝请求。
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
organizationId + userId + role + scopesHash + conversationId + profileVersion
```

任何仅以 `conversationId`、`sessionId` 或自然语言名称作为隔离键的实现都不合格。

每个回合都重新从当前服务端认证状态计算 actor fingerprint。恢复 Hermes session 前必须与会话保存的 fingerprint 比较；组织、角色或 scopes 任一发生变化时，立即终止旧 Hermes session 并创建新 session，旧工具结果不得重新注入新权限上下文。产品若支持切换组织，也必须先在服务端重新验证该用户的有效 membership，不能直接接受客户端选择值。

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

## 11. Skills 策略

星耀 Skills 作为 `plugins/xingyao` 的固定发布物随 Fork 镜像发布，并通过官方 `ctx.register_skill()` 或当前版本等价机制注册。

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

生产环境只开放 `skills_list` 和 `skill_view` 的等价只读能力，不开放 `skill_manage`。Skills 目录在容器中只读挂载，更新必须经过代码审查、测试、版本号和镜像发布。

## 12. 会话与 Memory

首期由星耀产品会话系统保存用户消息、Hermes 回答、工具摘要和 evidence refs。Hermes session 只承担单次会话运行所需的上下文，不作为跨组织业务事实库。

产品读取历史会话时仍需按当前组织和角色重新授权。用户权限被降低后，不能因为曾经参与过该会话就继续获得已不再有权查看的业务证据。

首期明确禁用：

- Hermes 持久化 Memory tool。
- 跨会话自动学习业务事实。
- 自动创建或修改 Skills。
- session search 跨用户或跨组织检索。

后续若启用 Memory，必须先实现 `organizationId + userId + profile` 命名空间、数据分类、用户删除、过期策略和越权回归测试。

## 13. 当前产品仓库改造边界

当前 Next.js 仓库负责：

- 保留“星耀 AI”入口和现有会话 UI。
- 在服务端通过 `getAuthContext()` 解析真实 actor。
- 计算只读 scopes 并签发 ActorAssertion。
- 调用 `xingyao-hermes-agent` 专用入口并映射 SSE 事件。
- 提供固定、内网、只读的 Hermes Read API。
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
- Skills 只能读取，运行时无法新增、修改或删除。

### 17.2 Next.js 产品

- ActorAssertion 只能从服务端 `AuthContext` 生成。
- 客户端提交的组织、角色和 scopes 被忽略或拒绝。
- Read API 对 `owner`、`ops_manager`、`operator_business`、`finance`、`streamer` 使用既有权限规则。
- 跨组织对象 ID、无权角色和字段级敏感数据测试返回拒绝。
- Read API 不存在业务写路由或通用查询入口。
- `/api/ai/chat` 新路径不再调用旧 grounding、旧 Xingyao 模块或旧 provider gateway。
- SSE、取消、超时、会话恢复、调用账本和 evidence refs 可完整闭环。

### 17.3 端到端安全用例

- 组织 A 用户无法通过提示词、对象 ID、缓存键或 session ID 读取组织 B 数据。
- 主播角色不能读取其他主播、组织财务、内部风险备注或供应商敏感字段。
- 财务角色不能因为 Hermes 获得其业务权限之外的数据。
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

### 阶段 5：发布固定 Skills 和生产加固

- 发布首批星耀 Skills。
- 完成只读容器、网络隔离、密钥轮换和可观测性。
- 完成全链路安全验收后再进入生产。

## 19. 首版上线验收标准

- 运行的是官方 Hermes Agent 源码 Fork，而不是自研内核或未修改黑盒服务。
- 用户仍只看到“星耀 AI”。
- 每个回合都绑定经过签名的组织、用户、角色、会话和只读 scopes。
- Hermes 只能看到固定 Skills 和星耀原生只读工具。
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
- 首期不开放 Hermes Memory、自动学习、自动改写 Skills 或动态 MCP。
- 不向用户展示隐藏思维链。
