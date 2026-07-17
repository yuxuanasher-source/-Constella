# 路由独立取数与合同制商业试点设计

日期：2026-07-18
状态：已确认，待实施计划
适用范围：运营控制台、核心业务数据记载、合同制人工订阅

## 1. 背景

当前运营控制台已经具备 Supabase 业务表、查询层、服务层、API、审计和套餐底座，但前端主壳仍由 `components/reference-ui/ops-reference.jsx` 维护大量共享 `useState`。控制台内部导航主要通过 `setRoute` 切换屏幕，而不是进入独立的 Next.js 路由。

现有 `/console/stubs/[module]` 入口只为初始模块预取部分数据。用户进入其他屏幕后，组件再通过挂载时的 `useEffect` 补请求。项目详情、准入、排班、导出、组织概览和作战台又会复用同一份内存 Context，因此页面访问顺序可能影响数据是否已经加载。

典型风险包括：

- 没有先打开项目页时，任务或导出页面缺少项目信息。
- 没有先打开主播或准入页面时，排班候选数据不完整。
- 报数审核、结算池和导出读取了不同时间点的内存数组。
- 查询失败与真实空数据都被转换为空数组，用户无法判断数据是否完整。
- 静态常量回退可能把未加载状态伪装成有效数据。
- 页面挂载被误用为业务数据生成或异步任务启动条件。

持牌聚合支付在本阶段后置。产品先通过线下签约、人工核验和人工激活订阅支持受控商业客户，平台不处理资金划转。

## 2. 目标

### 2.1 产品目标

- 用户可以直接打开、刷新或深链进入任意核心页面，并获得该页面完整的授权数据。
- 页面访问顺序不得影响业务记录、派生结果或跨模块引用。
- 数据加载失败、真实空数据、加载中和数据过期必须可区分。
- 写操作完成后，当前页面立即显示新状态，相关页面在下次打开时读取最新事实。
- 支持线下合同客户的试用、人工订阅开通、续期、降级和只读生命周期。

### 2.2 工程目标

- 复用现有 `features/*-queries.ts`、repository、service、DTO 和 RLS，不复制业务规则。
- 建立页面专属 Loader 和显式数据依赖契约。
- 使用稳定 UUID、数据库外键和关系表完成跨模块引用。
- 为高频并发编辑记录增加乐观并发控制。
- 将业务写入、审计与必要的后台任务纳入可靠闭环。
- 渐进拆分大型前端组件，不进行一次性重写。

## 3. 非目标

- 本阶段不接入聚合支付、微信支付、支付宝或生产支付 webhook。
- 本阶段不实现自动确认银行到账或自动退款。
- 本阶段不引入全站 TanStack Query 缓存。
- 本阶段不建立通用事件总线、数据仓库或全量物化视图体系。
- 本阶段不为所有业务表统一增加版本字段，只覆盖存在多人并发修改风险的核心表。
- 本阶段不因重构数据入口而重新设计全部页面视觉。

## 4. 已确认决策

1. 核心模块迁移为真实 URL 路由。
2. 每个路由使用服务端页面 Loader 独立加载完整数据。
3. 跨页面引用读取数据库或共享 query，不读取其他页面曾加载的 React Context。
4. 客户端状态只保存表单草稿、弹窗、勾选和短期交互状态。
5. 初期不启用跨请求的权限数据缓存；高频队列后续可局部使用 TanStack Query。
6. 套餐暂统一为 Trial、Basic、Pro、Enterprise。
7. 商业试点通过线下合同和人工订阅激活完成，平台不经手资金。

## 5. 目标架构

```text
真实 URL 与查询参数
  -> Next.js route page
  -> 认证、组织和角色上下文
  -> 页面专属 Loader
  -> 现有 feature queries / services
  -> Supabase 业务事实
  -> 页面 DTO + 数据状态元信息
  -> 页面组件

页面写操作
  -> API / server action
  -> 权限 + Billing Guard + revision 检查
  -> 数据库事务写业务记录、审计记录和必要后台任务
  -> 返回新 revision、correlationId、affectedResources
  -> 当前页面刷新 + 相关资源失效
```

### 5.1 真实路由

目标路由为：

| 页面 | 目标路由 |
| --- | --- |
| 角色首页 | `/console` |
| 作战台 | `/console/war-room` |
| 项目列表 | `/console/projects` |
| 项目详情 | `/console/projects/[projectId]` |
| 主播池 | `/console/streamers` |
| 准入 | `/console/admission` |
| 排班任务 | `/console/tasks` |
| 报数审核 | `/console/reports` |
| 结算中心 | `/console/settlements` |
| 导出中心 | `/console/exports` |
| 审计中心 | `/console/audit` |
| 通知待办 | `/console/notifications` |
| 组织与权限 | `/console/organization` |
| 套餐与订阅 | `/console/billing` |

旧 `/console/stubs/m*` 地址保留兼容重定向。侧边栏使用 `Link` 或 `router.push`，不再通过 `setRoute` 跨模块切屏。

以下状态进入 URL：

- 项目、主播和批次 ID。
- 当前页签。
- 项目、状态、日期和风险筛选。
- 分页游标或页码。
- 从看板跳转时的定位上下文。

表单草稿、抽屉开关和临时勾选不进入 URL，也不写业务表。

### 5.2 页面专属 Loader

Loader 按现有领域边界放置，例如：

- `features/projects/projects-page-loader.ts`
- `features/projects/project-detail-page-loader.ts`
- `features/applications/admission-page-loader.ts`
- `features/live-operations/tasks-page-loader.ts`
- `features/live-operations/reports-page-loader.ts`
- `features/settlements/settlement-page-loader.ts`
- `features/exports/export-page-loader.ts`
- `features/organizations/organization-page-loader.ts`
- `features/war-room/war-room-page-loader.ts`

Loader 负责：

- 接收已验证的 auth、路径参数和查询参数。
- 并行调用现有 query 或只读 service。
- 将数据库结果转换为页面 DTO。
- 区分核心依赖与辅助依赖。
- 返回加载时间、来源更新时间和部分失败信息。

Loader 不负责：

- 绕过 RLS 或服务层权限。
- 执行业务写入。
- 复制状态机或结算规则。
- 读取客户端 Context。
- 返回演示常量作为生产回退。

### 5.3 页面返回契约

```ts
type PageLoadResult<T> = {
  data: T;
  meta: {
    loadedAt: string;
    partial: boolean;
    sources: Array<{
      name: string;
      status: "ok" | "error";
      recordCount?: number;
      updatedAt?: string;
    }>;
  };
  issues: Array<{
    source: string;
    message: string;
    retryable: boolean;
  }>;
};
```

状态语义必须固定：

- `undefined`：组件契约错误，不允许作为正常页面状态。
- `loading`：路由或局部数据正在加载。
- `[]` / `null`：查询成功后的真实空结果；是否允许 `null` 由字段类型明确规定。
- `issues`：查询失败或数据降级。
- `partial=true`：页面主数据可用，但至少一个辅助来源失败。

### 5.4 页面数据依赖矩阵

| 页面 | 核心依赖 | 辅助依赖 |
| --- | --- | --- |
| 项目列表 | 项目、协作项目 | 任务与结算摘要、角色首页摘要 |
| 项目详情 | 项目、项目成员 | 主播、报名、任务、报数、结算摘要、组织成员 |
| 主播池 | 主播主档和账号 | 项目关系、供应商、画像洞察 |
| 准入 | 项目、报名、录屏提交 | 主播、预审、AI 分析、分享看板 |
| 排班任务 | 任务、项目、主播 | 已准入关系、异常摘要 |
| 报数审核 | 报数、任务、项目、主播 | OCR、预审、风险规则 |
| 结算中心 | 批次、结算池、默认范围 | 批次明细、复杂成本设置、对账摘要 |
| 导出中心 | 导出定义、授权项目 | 历史导出记录；导出行在提交时重新查询 |
| 组织与权限 | 组织、成员、权限 | 项目数、主播数、订阅状态 |
| 作战台 | 角色化经营聚合 | OCR 队列、复杂成本和 AI 建议 |

辅助依赖失败不得伪装成零值。核心依赖失败进入路由错误态。

## 6. 数据记载设计

### 6.1 业务事实层

现有业务表继续作为唯一事实来源，包括：

- `projects`
- `streamers`
- `project_applications`
- `live_tasks`
- `live_reports`
- `settlement_batches`
- `settlement_batch_items`
- `organization_subscriptions`

任何用户可见的业务变化必须先持久化成功，页面才能呈现为成功。禁止只更新 Context、组件数组或浏览器存储。

跨模块引用必须使用 UUID 和数据库关系记录。显示名称只能用于展示，不能成为关联键。

### 6.2 并发版本

新增迁移，为以下表增加 `revision bigint not null default 1`：

- `projects`
- `streamers`
- `project_applications`
- `live_tasks`
- `live_reports`

更新触发器在有效更新时递增 `revision`。PATCH、审核和状态变更接口接收 `expectedRevision`，更新条件必须包含当前 revision。没有更新到记录时返回 `409 REVISION_CONFLICT`。

`updated_at` 表示数据最后更新时间；`revision` 表示并发版本。两者不得互相替代。

结算锁定、规则版本和 append-only 记录继续使用其现有不可变与版本机制，不重复添加通用 revision。

### 6.3 审计台账

现有 `audit_logs` 保留为人工可解释的操作台账，并增加：

- `correlation_id uuid`：串联一次请求产生的业务、审计和后台任务。
- `entity_revision bigint`：本次写入后的实体版本。
- `operation_source text`：`web`、`mobile`、`import`、`system_job`、`ai_confirmed`。
- `idempotency_key text`：批量导入、创建、重试等操作的幂等追踪键。

`audit_logs.idempotency_key` 用于追踪，不单独承担防重。业务防重优先使用现有自然唯一键或操作专属唯一约束；没有自然键的创建、导入和批量操作，再增加按 `organization_id + operation_scope + idempotency_key` 约束的请求记录。相同幂等键但请求内容不同必须拒绝。

高风险操作的业务变更与审计写入必须通过事务型数据库函数或等价事务边界完成，不得由应用层顺序执行两次独立请求。审计失败时，高风险业务写入不得单独成功。

### 6.4 派生结果与后台任务

- 页面即时需要的简单派生值由共享 query 从事实表计算。
- 必须与写入同时生效的派生字段在同一事务中更新。
- OCR、AI、批量导入等耗时工作在业务写入时创建 `background_jobs`。
- worker 独立处理任务，页面打开只能读取状态、触发显式人工重试，不能成为正常任务启动条件。
- 复用现有 `attempt`、`max_attempts`、`next_run_at` 和 `claimed_at` 完成退避与卡死回收。
- 超过最大重试次数后进入运营可见的失败状态。

本阶段不新增通用经营快照表。满足以下任一条件后再评估快照或物化视图：

- 需要跨月历史趋势，而源表无法恢复历史时点。
- 试点数据规模下页面核心查询 P95 持续超过 2 秒。
- 同一复杂聚合在多个页面重复执行并成为数据库主要负载。

## 7. 写入、刷新与失效

### 7.1 写操作返回契约

成功响应至少包含：

```ts
type MutationMeta = {
  correlationId: string;
  revision?: number;
  affectedResources: string[];
};
```

服务端 route handler 根据 `affectedResources` 执行集中式失效，并在响应中返回同一列表供客户端刷新当前页和记录诊断信息。客户端不得根据按钮类型自行维护另一份失效映射。

### 7.2 资源失效映射

建立集中式 `invalidateOpsResources()`：

| 业务变化 | 失效资源 |
| --- | --- |
| 项目变化 | 项目列表、项目详情、作战台 |
| 主播变化 | 主播池、项目成员、准入、排班候选 |
| 报名或准入变化 | 准入、项目详情、主播池、排班候选 |
| 任务变化 | 任务、项目详情、作战台 |
| 报数审核变化 | 报数、结算池、项目详情、作战台 |
| 结算批次变化 | 结算、项目详情、作战台、导出 |
| 成员或套餐变化 | 组织、套餐状态、权限和写入门控 |
| OCR 或 AI 结果变化 | 对应任务、报数、准入或主播详情 |

初期通过 `revalidatePath` 和当前页面 `router.refresh()` 实现。若未来启用服务端数据缓存，再将资源映射扩展为包含组织 ID 的 cache tag。

### 7.3 新鲜度策略

- 写入成功后立即刷新当前页面。
- 进入新路由时由 Loader 重新读取事实。
- 页面重新获得焦点时，只有数据年龄超过页面阈值才刷新。
- 任务、报数和异步任务状态允许页面级 60 秒轮询。
- 普通项目、主播、组织和套餐页面不常驻轮询。
- 网络中断时保留最后一次成功数据，并明确标记可能过期。

## 8. 错误与恢复

统一错误协议：

```ts
type ApiError = {
  code:
    | "VALIDATION_FAILED"
    | "FORBIDDEN"
    | "BILLING_BLOCKED"
    | "REVISION_CONFLICT"
    | "DEPENDENCY_UNAVAILABLE"
    | "INTERNAL_ERROR";
  message: string;
  retryable: boolean;
  correlationId: string;
};
```

处理规则：

- `REVISION_CONFLICT`：保留用户草稿，加载最新记录并显示冲突。
- 核心查询失败：进入对应路由 `error.tsx`，提供重试。
- 辅助查询失败：主页面继续可用，显示局部错误与最近成功时间。
- 失败不得转换为“暂无数据”。
- 重试不得重复创建业务记录，创建和批量操作必须使用幂等键。
- 后台任务耗尽重试后进入运营失败队列，支持有权限的人工重试并写审计。

## 9. 合同制商业试点

### 9.1 套餐口径

本阶段统一为：

| 产品名 | 数据库 tier | 说明 |
| --- | --- | --- |
| Trial | `free` | 14 天 Pro 等效功能，AI/OCR/导出额度较低 |
| Basic | `basic` | 小型工作室 |
| Pro | `pro` | 成长型 MCN |
| Enterprise | `enterprise` | 定制额度和合同条款 |

Starter 和 Business 暂不公开，不新增 tier。未来恢复自助支付项目前，重新验证价格与套餐数量。

本设计在合同制试点阶段暂时覆盖 P6 规格中的公开套餐矩阵；P6 的支付 provider、订单支付、webhook、对账和自动退款范围继续后置。

### 9.2 人工订阅字段

复用 `organization_subscriptions` 的状态、账期、`grace_until` 和 `updated_at`，新增：

- `activation_source text`：`trial`、`manual_contract`、`payment_provider`。
- `contract_reference text`：内部合同或订单参考号，不保存敏感金融信息。
- `offline_verification_status text`：`not_required`、`pending`、`verified`、`rejected`。
- `verified_at timestamptz`。
- `verified_by uuid`。
- `activated_by uuid`。
- `activation_reason text`。

人工合同订阅默认 `auto_renew=false`，账期使用现有 `current_period_start` 和 `current_period_end`。现有运行时状态继续采用 `past_due + grace_until` 表示宽限期，不新增与代码不一致的 `grace_period` enum。

### 9.3 人工运营动作

人工订阅只能由平台计费运营身份执行，组织 owner、ops_manager 和普通成员只能读取本组织订阅状态，不能直接修改套餐、账期或核验状态。

新增最小平台运营身份表 `platform_billing_operators`，记录 `user_id`、`status`、`created_by` 和时间字段。该表不向普通 authenticated 用户开放写权限。内部计费路由同时验证登录身份、有效运营资格和操作原因，再通过服务端事务修改订阅。实施时必须移除现有允许组织 owner/ops_manager 直接管理 `organization_subscriptions` 的写策略，保留按组织读取策略。

平台计费运营后台支持：

- 激活试用或合同套餐。
- 续期。
- 立即升级。
- 到期降级。
- 切换为 `readonly`、恢复和取消。
- 设置或清除宽限期。
- 修正线下核验状态。

每次操作必须记录操作者、原因、合同参考号、前后套餐、前后账期和审计记录。平台不创建资金流水，不自动判断银行到账，不经手退款。

### 9.4 Billing Guard

正式接收合同客户前，所有关键业务写路由必须完成服务端 Billing Guard 覆盖。只读、审计写入和必要的恢复操作不能因订阅状态被阻断。

`past_due` 在 `grace_until` 前允许写入并显示提醒；宽限结束后进入 `readonly`。历史业务、结算和审计记录不得因降级隐藏或删除。

## 10. 渐进迁移计划

### 10.1 第一批：消除访问顺序依赖

迁移项目、项目详情、准入、任务和报数：

- 建立真实路由和页面 Loader。
- 侧边栏改用真实路由导航。
- 建立数据依赖契约测试。
- 去除静态数据回退。
- 增加核心记录 revision 与冲突处理。
- 建立统一 API 错误协议。

### 10.2 第二批：经营与交付闭环

迁移结算、导出、组织、作战台、通知和审计：

- 导出提交时重新查询源记录。
- 作战台使用独立经营聚合 Loader。
- 建立集中式资源失效。
- 补充数据更新时间和局部失败状态。
- 分离页面 Context，逐步缩小 `ops-reference.jsx`。

### 10.3 第三批：合同制商业化

- 统一 Trial、Basic、Pro、Enterprise 口径。
- 实现人工订阅运营动作和审计。
- 补齐 Billing Guard 覆盖矩阵。
- 建立可删除的试点数据和稳定验收账号。
- 完成浏览器级商业流程测试与生产监控。

## 11. 验收标准

### 11.1 页面独立性

- 全新会话可以直接打开每个核心 URL。
- 任意页面访问顺序得到一致结果。
- 浏览器刷新不会丢失当前业务上下文。
- 页面不依赖其他屏幕先挂载或先请求。

### 11.2 跨模块闭环

- 创建项目后不打开项目列表，任务页仍能引用该项目。
- 主播准入后不打开主播页，排班页仍能选择该主播。
- 报数审核通过后直接打开结算页，记录进入结算池。
- 结算批次生成后直接打开导出页，可以正确导出。
- 更新组织成员或套餐后，后续业务写操作使用最新权限与权益。

### 11.3 一致性与恢复

- 两人同时编辑同一记录时，旧 revision 返回 409，不覆盖新数据。
- 同一幂等键重试不会创建重复记录。
- OCR、AI 和导入任务在相关页面从未打开时仍会执行。
- 辅助依赖失败时主页面仍可使用，并显示失败来源。
- 任务超时可回收，任务耗尽重试后可由运营定位和重试。

### 11.4 权限与商业化

- 所有页面 Loader 和写路由按组织、角色和主播绑定隔离。
- 所有关键业务写路由经过 Billing Guard。
- 人工订阅变更具备完整审计、原因和合同参考号。
- `readonly` 保留读取、历史记录和审计能力，阻止业务数据修改。

### 11.5 性能与质量门槛

- 核心页面直接加载成功率达到 99.9%。
- 试点规模下核心页面服务端取数 P95 不超过 2 秒。
- 所有列表具备分页、游标或明确的数据量上限。
- `pnpm type-check`、`pnpm lint`、`pnpm test` 和 `pnpm build` 通过。
- 浏览器端到端测试覆盖直接 URL、随机访问顺序、跨模块闭环、并发冲突和只读状态。
- 登录、任务、报数、结算、导出和后台任务失败均可通过 correlationId 定位。

## 12. 测试策略

- Loader 单元测试：依赖组合、DTO、核心失败和部分失败。
- 路由组件测试：URL 参数、loading、error 和空数据状态。
- schema contract 测试：revision、审计扩展和人工订阅字段。
- service 测试：revision 冲突、幂等、事务审计和 Billing Guard。
- 回归测试：P1/P2/P3/P4/P5/P6 现有测试继续通过，支付 provider 测试保持 mock 范围。
- 浏览器 E2E：每条业务闭环从干净会话和直接 URL 开始，不复用上一个用例的前端内存。

## 13. 发布与回滚

- 每个模块独立迁移，旧路由在稳定期内保留重定向。
- 新 Loader 与旧组件可以短期共存，但同一页面只能有一个生产数据入口。
- 数据库新增字段先保持向后兼容，再启用服务端强校验。
- revision 强校验按模块启用，避免一次切换所有客户端。
- 若新页面出现严重问题，可以将该模块重定向回旧入口；已经写入的 revision 和审计字段无需回滚。

## 14. 后续范围

完成合同制试点并验证定价后，再单独重启自助支付项目，决定聚合支付服务商、公开套餐矩阵、在线订单、支付回调、对账、退款和发票自动化。该项目不得反向改变本设计确立的页面独立取数、业务事实、审计和并发控制原则。
