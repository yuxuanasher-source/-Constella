# Xingyao Conversation Protocol Design

## Goal

把星耀 AI 助手从“浏览器里拼接几条消息后直接请求模型”的临时聊天，升级为可持久化、可恢复、可审计的正式会话协议。新协议必须解决首次回答只返回标点仍被当作成功、技术重试被误写成新用户问题、刷新或换设备后上下文丢失，以及服务端无法判断同一回合状态的问题。

## Product Contract

### Source Of Truth

- 服务端会话账本是消息与回合状态的唯一真相。
- 浏览器只缓存当前 `conversationId`、输入草稿和纯展示偏好，不再把 `localStorage` 消息当作模型上下文。
- 会话按组织隔离，并且 V1 仅会话创建者可见；同组织其他成员不能读取该会话。
- 模型供应商的 conversation/thread id 只作为适配器状态保存，不能替代产品自己的会话账本。

### Turn Semantics

一次正常提问只创建一条用户消息和一个回合：

```text
accepted -> grounding -> generating -> validating -> completed
                                             \-> failed
```

- `retry` 是技术恢复：沿用原用户消息和原上下文快照，创建新的执行尝试，不创建“重试”用户气泡。
- `regenerate` 是用户主动要求另一个答案：沿用原用户消息，创建新的回答版本，并把旧回答标记为已被替代。
- 相同 `idempotencyKey` 的重复请求返回同一回合，避免双击、网络重放或超时重试产生重复消息。
- 同一会话同一时刻只允许一个活跃回合，V1 不支持并发分支对话。
- 同一个源回合最多产生一个直接 `retry` 或 `regenerate` 后继；旧页面或另一设备重复操作时返回现有后继并要求客户端刷新，不能形成多个并列完成答案。
- 活跃回合持有 2 分钟数据库租约，每次状态推进和 15 秒 SSE 心跳都会按数据库时钟续租。进程终止导致租约过期时，下一次创建回合会先把旧回合和助手消息原子标记为可重试失败，再释放会话锁。
- 已存在的幂等回合在 API 和流适配器两层都返回 `409 + reloadConversation`，不会重新推进或失败化原执行。

### Response Commit Barrier

流式输出在通过“有效内容门禁”前不会展示给用户：

- 空白、纯标点、纯 Markdown 装饰符和不可见字符不是有效回答。
- 一旦缓冲区出现中文、字母、数字或其他语义字符，缓冲内容按原顺序一次性释放，后续增量正常透传。
- 供应商以 `done` 结束但内容无效时，网关对同一供应商自动重试一次；仍无效才进入现有 fallback 或失败路径。
- 只有通过门禁的回答可以写成 `completed`。失败尝试保存错误码和摘要，但不能提交一条伪成功助手消息。
- `response.completed` 和 `response.failed` 只能在对应终态已经原子落库后发送；终态持久化失败时中止 SSE，让客户端重新读取账本，不能伪报终态。

## Data Model

### `ai_conversations`

保存产品级会话：组织、创建者、标题、状态、结构化摘要、摘要版本、最近消息时间和供应商适配状态。

### `ai_chat_messages`

保存用户与助手消息。每条消息有稳定 ID、会话内序号、角色、状态、正文、父消息、调用账本关联和元数据。助手消息可以处于 `pending`、`streaming`、`completed`、`failed` 或 `superseded`。

### `ai_chat_turns`

保存一次用户意图的执行状态：用户消息、当前助手消息、模式、状态、幂等键、重试/重新生成来源、尝试次数、上下文快照、供应商、调用账本和错误信息。

V1 把不可变上下文快照直接存入回合的 `context_snapshot`，暂不增加独立快照表。等快照需要复用或单独归档时再拆表，避免现在引入无收益的关联复杂度。

## Context Assembly

服务端按以下顺序构建上下文：

1. 稳定系统指令和当前组织权限边界。
2. 会话结构化摘要（如果存在）。
3. 最近已完成的用户/助手消息，按字符预算截断。
4. 当前用户消息。
5. 本回合实时经营数据、知识库和星耀诊断 grounding。

上下文快照记录消息 ID、摘要版本、grounding 引用、实际供应商输入消息、净化后的附件、回答元数据和调用审计元数据。技术重试与重新生成直接复用该冻结输入，不重新读取实时看板、知识库或星耀特征仓，避免数据变化或实时数据源故障改变重试语义。

V1 使用“摘要字段 + 最近消息窗口”的确定性压缩策略，不在请求链路中额外调用模型生成摘要。后续在会话跨越预算阈值时，可用后台任务更新结构化摘要。

## API Protocol

### Endpoints

- `POST /api/ai/conversations`：创建会话。
- `GET /api/ai/conversations`：列出当前用户自己的会话。
- `GET /api/ai/conversations/:conversationId`：读取会话及已提交消息。
- `POST /api/ai/conversations/:conversationId/turns`：提交用户消息并流式执行回合。
- `POST /api/ai/turns/:turnId/retry`：技术重试，不创建用户消息。
- `POST /api/ai/turns/:turnId/regenerate`：生成新的助手答案版本。

现有 `/api/ai/chat` 在迁移期继续可用，并复用相同的输出质量门禁；新界面完成切换后再单独废弃。

新星耀面板只调用会话协议。会话接口不可用或返回异常成功体时，面板显示明确错误并停止，不能降级为携带浏览器历史调用 `/api/ai/chat`；旧接口兼容仅服务尚未迁移的旧客户端。

### Typed Stream Events

SSE 使用具名事件和统一 envelope：

```ts
type ConversationStreamEvent =
  | { type: "turn.started"; conversationId: string; turnId: string; userMessageId: string; assistantMessageId: string }
  | { type: "context.ready"; conversationId: string; turnId: string; snapshotVersion: number }
  | { type: "response.delta"; conversationId: string; turnId: string; messageId: string; delta: string }
  | { type: "response.completed"; conversationId: string; turnId: string; messageId: string; content: string }
  | { type: "response.failed"; conversationId: string; turnId: string; code: string; retryable: boolean; message: string }
  | { type: "heartbeat"; conversationId: string; turnId: string };
```

客户端按 `turnId + messageId` 去重并更新状态，不能把事件文本直接当作新的聊天消息。

## Failure And Recovery

- 请求在创建回合前失败：返回普通 HTTP 错误，不留下半条消息。
- 附件在创建回合前完成类型、可读内容、单文件 8 MiB 原始大小及 Base64 膨胀上限校验；非法附件不落消息或回合记录。
- 回合已创建但 grounding 或模型失败：回合和助手消息标记为 `failed`，SSE 发 `response.failed`。
- 终态落库失败：不发送终态 SSE；客户端把连接视为中断并重新读取服务端会话。
- 活跃回合租约过期：下一次创建请求先将其恢复为 `turn_lease_expired` 可重试失败，再创建新回合。
- 客户端断线后 V1 重新读取会话即可得到最终状态；不承诺逐 token 续传。
- 用户点击重试时调用 retry endpoint，界面原地更新同一用户问题下的助手回答。
- 供应商短暂故障由网关自动重试/fallback；产品级 retry 只在回合最终失败后由用户触发。

## Security And Audit

- 每个读写请求同时校验登录用户、组织成员关系和 `owner_user_id`。
- 所有表启用 RLS；浏览器不能越权更新回合终态或伪造助手消息。
- 服务端 service role 负责状态推进，调用继续写入 `ai_invocations`。
- 正文与上下文快照不得包含未经过现有安全 DTO 的敏感业务字段。
- 错误事件只返回稳定错误码和可展示摘要，不返回 provider raw response、密钥或内部堆栈。

## Rollout

1. 先上线输出质量门禁和自动重试，立即消除“两个点”伪成功。
2. 上线数据库、服务和新 API，同时保留旧聊天入口兼容。
3. 星耀界面切换到服务端会话；旧本地历史不上传为可信上下文。
4. 观察失败率、重复回合率、首次有效回答率和 retry 成功率。
5. 稳定后移除旧的本地消息上下文和 `/api/ai/chat` 兼容路径。

## Acceptance Criteria

- 首次请求只收到标点时，用户不会看到伪回答，系统自动恢复或显示明确失败。
- 点击“重试”不会新增一条内容为“重试”的用户消息。
- 刷新页面和更换设备后，创建者可以继续自己的会话。
- 重复提交相同幂等键不会生成重复消息。
- 同一源回合的重复重试或重新生成不会创建并列回答版本。
- 技术重试在实时业务数据源不可用时仍能使用冻结上下文执行。
- 前端只展示服务端已提交的历史，并能区分生成中、失败、完成和已替代状态。
- 会话、消息、回合和 invocation 可以通过 ID 完整串联审计。
- 部署前必须在实际 Supabase/Postgres 上执行迁移并验证 RLS、租约回收、锁顺序、幂等重复和版本链事务；静态 schema contract 不能替代数据库级集成测试。
