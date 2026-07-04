# 经营舱 审计修复计划（2026-06-18）

配套文档：`docs/reports/2026-06-18-comprehensive-code-audit.md`

原则：
- **分批小 PR**，每批围绕一个边界，独立可评审、可回滚，避免一次性大改引入回归。
- 每批先补/改测试再改实现；改动后跑对应 `package.json` 专项测试脚本 + `type-check` + `lint`。
- DB 迁移（RLS/触发器/视图）单独成批，谨慎评审，**只新增 forward 迁移，不改历史迁移文件**。
- C4（真实 LLM）属功能建设而非缺陷修复，需产品确认 API key / 成本 / 模型后单独立项。

优先级总览：

| 批次 | 内容 | 覆盖项 | 严重度 | 工作量 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| **PR-A** | 认证网关 | C1, C2 | Critical | S | 无（最先做） |
| **PR-B** | 结算资金正确性 | C3, M4, M5, M6 | Critical/Med | M | 无 |
| **PR-C** | 履约状态机 | H2, H3, L10 | High | S–M | 无 |
| **PR-D** | 存储上传边界 | H1, H4, M11 | High/Med | S | 无 |
| **PR-E** | OCR 管道落地 | C5, H5, M7 | Critical/High | M | 含自身 H5 校验 |
| **PR-F** | AI 真实接入 | C4 | Critical | L | 需产品决策 |
| **PR-G** | 前端韧性 | H6, L4(部分) | High | M | 建议在 PR-A 后 |
| **PR-H** | DB/RLS 加固迁移 | M2, M3, M9, M12, L11 | Med | M | 谨慎评审 |
| **PR-I** | 横切小修扫尾 | M1, M8, M13, L1/L3/L5–L9/L12 | Med/Low | M | 可持续推进 |

建议合入顺序：A → (B, C, D 可并行) → E → G → H → I；F 独立轨道推进。

---

## PR-A 认证网关（C1 + C2）— 最高优先

**目标**：让认证真正生效，匿名访问受保护区被挡。

- **C1 中间件失效**
  - 根因：`proxy.ts` 导出 `proxy()`，Next 只加载根 `middleware.ts` 的 `middleware` 导出。
  - 修复：`git mv proxy.ts middleware.ts`，导出函数改名 `middleware`，`config.matcher` 保留。
  - 注意：`/login` 不在 matcher 内（OK）；中间件每请求会查 `auth.getUser()`，确认 `response` 透传刷新后的 cookie（现有写法已处理）。
- **C2 页面无认证兜底**
  - 修复：新增 `lib/auth/require-auth.ts` 导出 `requireAuthContext()`（无会话则 `redirect("/login")`），在三个布局统一调用：`app/(ops)/console/layout.tsx`、`app/(streamer-app)/m/layout.tsx`、`app/(streamer-desktop)/.../layout.tsx`。布局是 Server Component，`redirect()` 可用。
  - 顺带（可选，关联 H4/越权 UI）：布局层加角色校验，主播命中 `/console` 时 `redirect("/m/tasks")`，反之亦然。
- **测试**：新增中间件单测（未登录→302 `/login`，已登录→放行）；布局守卫测试（`requireAuthContext` 在 `auth=null` 时抛 `redirect`）。
- **风险/回滚**：小；若中间件引入登录回环，回退到仅页面级 `requireAuthContext`。改动隔离、易回滚。

---

## PR-B 结算资金正确性（C3 + M4 + M5 + M6）

**目标**：应收金额正确、生成原子、金额无浮点漂移、锁有前置。

- **C3 应收底薪重复计**（`features/settlements/settlement-service.ts:212-238`）
  - 根因：receivable 用项目级 `projectRule`，但 `includeBaseSalary` 按 `report.streamerId` 去重 → N 主播计 N 次底薪。
  - 修复：receivable 批次底薪「整批一次」——用单个 `let baseSalaryConsumed = false`，仅首条 include；payable 保持按 streamerId（每主播底薪正确）。
  - 测试：新增「2 主播 + 含底薪应收方法」用例断言底薪仅计一次；纳入 `pnpm test:golden`。
- **M4 生成非原子**（`settlement-service.ts:241-278`）
  - 修复：将「建批次 + 批量建明细 + `markReportSettled`」收敛进 Postgres RPC/事务；`markReportSettled` 校验受影响行数，为 0 即中止回滚。
- **M5 浮点丢失更新**（`settlement-service.ts:425-428`、引擎 `124-129`、合计 `570-579`）
  - 修复：金额统一改整数分计算（复用已正确的 `pricing-calculator` 模式）；手工明细更新批次合计改 SQL 原子自增或事务内由明细重算，去掉 JS 读-改-写。
- **M6 锁定缺前置**（`settlement-service.ts:336-339`）
  - 修复：引入显式可锁状态集（仅 `confirmed/generated/reopened`），对齐直播任务转移表风格。
- **测试**：`pnpm test:golden`、`pnpm test:permissions`；新增并发手工明细的合计一致性测试。
- **风险**：触及资金，务必先golden测试；事务化需确认 repo 层支持 RPC。

---

## PR-C 履约状态机（H2 + H3 + L10）

- **H3 直播任务可重启清零计时**（`live-task-state.ts:28-30`、`live-operations-service.ts:271-278`）
  - 根因：`assertLiveTaskTransition` 的 `if (from===to) return;` 被多处幂等依赖（如重复 cancel），**不可全局删除**。
  - 修复（定向）：在 `startLiveTask` 内显式校验 `before.status` ∈ {`pending_live`,`abnormal`}，且 `before.systemStartedAt` 已存在时拒绝；不依赖 `assertLiveTaskTransition` 兜底重启。保留 `from===to` 幂等语义。
- **H2 `need_more` 误入结算池 + 错标驳回**（`live-operations-service.ts:509-572`）
  - 修复：① 514-515 行默认值改为「仅 `approve` 时」`includeInTaskResult/enterSettlementPool` 才默认 true，否则 false。② 535-544 行按三决策分支：`need_more` 让任务停留在 `report_pending_review`（不转 `report_rejected`），并确保 `report_rejected`/`pending_report` 重提路径仍可达。③ 552 行审计 `action` 与通知文案区分 reject / need_more。
- **L10 数值/日期无范围校验**（`live-operations-route-utils.ts:83-91`、`service:667-678`）
  - 修复：观众/时长加整数范围；`assertScheduleWindow` 在比较前拒绝 `NaN` 日期。
- **测试**：扩展 live-operations 服务测试覆盖三种 review 决策与重复 start；`pnpm test:permissions`。

---

## PR-D 存储上传边界（H1 + H4 + M11）

- **H1 上传桶配置错误**（`app/api/uploads/signed/route.ts:12,34`）
  - 修复：读 `process.env.STORAGE_BUCKET_PRIVATE`，默认 `"jy-private"`；同步修正 `signed-route.test.ts:57,63` 的断言为 `jy-private`。
- **H4 创建主播档案无授权 + userId 可指定他人**（`app/api/streamers/route.ts:33-89`、`streamer-service.ts:102-160`）
  - 修复：路由 + 服务加 `isMcnStaff` 角色门控；`userId` 绑定需校验/授权（默认绑定调用者，员工代建时显式授权）。
- **M11 ownerId/category 未校验**（`uploads/signed/route.ts:22-40`、`private-upload.ts:5-13`）
  - 修复：运行时 zod 校验 `category` 枚举；`ownerId` 默认/强制为调用者自身。
- **测试**：上传路由（正确桶名、缺字段 400、非员工 403、ownerId 越权拒绝）；streamers 创建授权测试。

---

## PR-E OCR 管道落地（C5 + H5 + M7）

- **C5 无 worker**（`features/ai/ocr-jobs.ts:232`、`tencent-ocr-provider.ts:58`）
  - 修复：新增受保护入口 `POST /api/ocr/jobs/run`（或调度器/cron），用内部密钥鉴权，领取队列并调 `runOcrJobOnce` + 配置好的 `createTencentOcrProvider`。
- **M7 领取竞态 + degraded 死分支 + 无 max_attempts**（`ocr-jobs.ts:197-230,243-250,263-264`）
  - 修复：领取改条件更新 `update(status:"running").eq("status","queued")`，按受影响行数判定（0 则跳过）；修正 `degraded ? "failed" : "failed"` 死三元，`degraded` 映射独立状态；`retryOcrJob` 校验 `attempt < max_attempts`。retry 前先按 `organizationId` 加载并 404（修跨组织顺序问题）。
- **H5 SSRF + 大小上限**（`ocr-jobs.ts:91-92`、`tencent-ocr-provider.ts:144`、`app/api/ocr/jobs/route.ts:42`）
  - 修复：`imageUrl` 限 https 且白名单主机（优先项目私有桶）；屏蔽内网/元数据地址；`imageBase64` 设长度上限；入口补 zod 且要求至少一种图源。
- **测试**：worker 领取幂等/并发、degraded 与 max_attempts、SSRF 校验拒绝、跨组织 retry 404。

---

## PR-F AI 真实接入（C4）— 需产品决策后立项

- **现状**：唯一 provider 是 `createDeterministicProvider`，`openai/hunyuan` 仅类型字面量，无任何真实 LLM；usage 记伪造 token。
- **方案**：在现有 `AiProvider` 接口后实现真实 Anthropic provider（经 `@anthropic-ai/sdk`，默认模型 `claude-opus-4` / 备选 `claude-sonnet`，由 env 选择），`llm-gateway`/`runAiGateway` 按配置路由；保留 deterministic 作测试 fallback；真实 token 用量回填 `invocation-ledger`。
- **前置（需确认）**：`ANTHROPIC_API_KEY` 注入方式、成本/限流预算、诊断/复盘的 prompt 与输出契约。
- **落地前临时措施**：`app/api/ai/diagnosis` 响应明确标注 `mode:"stub"`/disabled，避免冒充真实诊断。
- **工作量**：L；建议独立 PR，配契约测试 + 真实调用 env 门控冒烟（参照 OCR 冒烟模式）。

---

## PR-G 前端韧性（H6）

- **H6 无边界 + 静默占位**（`app/**` 无 error/loading/not-found；`reference-ui/*.jsx` 的 `Array.isArray(x)?x:FALLBACK`）
  - 修复：新增 `app/(ops)/console/{error,loading}.tsx`、路由组 `not-found.tsx`、`app/global-error.tsx`；数据加载器返回显式 `state: "unauthorized"|"empty"|"loaded"`；reference-ui 按 state 渲染区分空/错/未授权，移除对象型静默占位（`WAR_ROOM_FALLBACK_PROJECT`、`MY_EARNINGS` 等）。
- **L4 失败登录不审计**（`app/(auth)/login/actions.ts:18-33`）：用提交邮箱独立记录失败登录。
- **测试**：`pnpm test:ui-smoke`；新增 loader 三态测试。
- **风险**：reference-ui 体量大（已整文件 eslint-disable，见 PR-I 主题3），改动需小步。

---

## PR-H DB/RLS 加固迁移（M2 + M3 + M9 + M12 + L11）— 谨慎评审

新增单个 forward 迁移，集中以下：
- **M2 审计完整性**：加 `before truncate ... for each statement` 触发器并 `revoke truncate`；`audit_logs` 插入 `WITH CHECK` 强制 `actor_user_id = auth.uid()`，`actor_role` 服务端推导。
- **M3 财务列级脱敏**：为内部员工应收/成本路径增设脱敏 DTO 视图（对齐 `streamer_payable_items_safe` 模式），减少「仅应用层 `canSeeFinancialFields`」的泄露面。
- **M9 异常去重**：`notifications` 加 `(organization_id, source)` 唯一约束，扫描改 upsert/冲突忽略；重审 source 有效期。
- **M12 RLS 角色子句**：为准入/AI/计费策略补 `to authenticated`（`20260602013000`、`20260602203000`、`20260604103000`）。
- **L11 主播唯一性**：`streamers(organization_id,user_id)` 加唯一约束（`user_id is not null`），使 `current_streamer_id` 确定。
- **测试**：`lib/db/*-schema-contract.test.ts` 全量；本地 `supabase db reset` 验证迁移可重建。
- **风险**：唯一约束可能与既有脏数据冲突，迁移前需数据体检。

---

## PR-I 横切小修扫尾（Medium/Low）

可在前述批次之间持续推进，互不阻塞：
- **M1 多组织角色任意挑选**（`lib/auth/context.ts:45-56`）：由显式活跃组织选择器驱动并校验成员关系，替代 `limit(1)`。
- **M8 CSV 公式注入**（`export-service.ts:72-78`）：对 `= + - @ \t \r` 开头单元格加前导 `'`。
- **M13 申请状态机语义**（`application-service.ts` / `application-state.ts`）：拆分「无需录屏」与「录屏已复核通过」，恢复 `confirmed` 可达。
- **L1 HTTP 状态码语义**（`lib/http/route-error-status.ts`）：改 typed error（`AuthorizationError`/`NotFoundError`）按类型分支，未知错误默认 500，替代英文消息正则。
- **L3/L9 `.or()` 拼接**（`notification-center-queries.ts:79`）：拼接前校验 UUID/枚举或用 builder。
- **L5 各路由缺 zod**：war-room/auto-review/ai/ocr 补 schema 并 `typeof body==="object" && body!==null` 守卫。
- **L6 影子模式误导审计**（`auto-review-service.ts:43-63`）：shadow 跳过审计或用 `action:"evaluate"`。
- **L7 通知更新未按收件人收敛**（`notification-service.ts:49-58`）：对齐读取的收件人过滤并 404。
- **L8 定价计入红证营收**（`pricing-calculator.ts:60,111`）：毛利剔除红证手工营收或单列。
- **L12 用量分数静默截断**（`usage-metering.ts:91-93,131-133`）：显式校验并保留支持的分数指标。
- 维护性主题：reference-ui 去整文件 `eslint-disable` 逐步收敛、删除死代码 `components/layouts/ops-shell.tsx` 与重复 `components/ui/{button,badge}.tsx`、`stubs` 路由重命名为 `/console/[module]`、修正 README 演示数据漂移与悬挂引用、`next.config.ts` 补安全响应头、`lib/config/env.ts` 增补服务端 env schema。

---

## 验证与节奏

- 每个 PR 合入前：`pnpm type-check && pnpm lint && pnpm test` 全绿，并跑该域专项脚本（`test:golden`/`test:permissions`/`test:ai-system`/`test:ui-smoke` 等）。
- 资金类（PR-B）与权限类（PR-A/D）务必新增回归用例后再改实现。
- 迁移类（PR-H）本地 `supabase db reset` 验证可重建，并跑 schema 契约测试。
- 建议每批对应一个可跟踪 issue，Critical/High 先行。
