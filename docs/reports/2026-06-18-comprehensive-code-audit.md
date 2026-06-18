# 经营舱 综合性代码审计报告

- 日期：2026-06-18
- 范围：全仓库（约 22.9k 行 TS/TSX，`app/`、`features/`、`lib/`、`components/`、`supabase/`、`scripts/`）
- 方法：5 个领域并行静态审计（认证/RBAC/RLS、API 路由、结算与履约业务逻辑、AI/OCR/治理、前端/配置/工具链）+ 基线构建检查 + 关键发现人工复核
- 性质：本文件是只读审计结论，未改动任何业务代码。

> 严重度说明：审计已对照实际 RLS 策略与 SECURITY DEFINER 函数校准。凡数据库 RLS 已能拦截的跨租户/越权问题，按「纵深防御缺口」降级为 Medium/Low，并在条目中注明。

---

## 0. 基线健康度（可信信号）

| 检查 | 结果 |
| --- | --- |
| `pnpm type-check` (tsc --noEmit) | ✅ 通过，0 错误 |
| `pnpm lint` (eslint) | ✅ 通过，0 错误 |
| `pnpm test` (vitest) | ✅ 81 文件 / 262 通过 / 1 跳过 |
| 唯一跳过用例 | `features/ai/providers/tencent-ocr-provider.test.ts:94` — 环境门控的真实 OCR 冒烟，合理 |

基线工程纪律良好（强类型、契约测试、无 `.only` 污染、空 seed、演示数据守卫测试在位）。**主要风险不在编译期，而在运行期语义、安全边界与未落地的功能。**

---

## 1. Critical（需优先处理）

### C1. 认证中间件从未生效（文件名 `proxy.ts` 而非 `middleware.ts`）
- 类别：Security / Bug ｜ 位置：`proxy.ts:6`（且仓库不存在 `middleware.ts`）｜ 状态：✅ 已人工复核
- Next.js 只执行根目录 `middleware.ts` 导出的 `middleware` 函数。本文件导出的是 `proxy()` + `config.matcher`，Next 永不加载它。预期的「未登录访问 `/console`、`/m`、`/desktop` 跳转 `/login`」逻辑完全不触发（git 历史确认从未叫过 `middleware.ts`，也无任何 import）。
- 影响：未认证访客不会被重定向；叠加 C2，整套应用外壳可匿名打开。
- 修复：将 `proxy.ts` 重命名为 `middleware.ts`，并把导出改名为 `middleware`。

### C2. 受保护页面无页面级认证兜底
- 类别：Security ｜ 位置：`app/(ops)/console/**/page.tsx`、`app/(streamer-app)/m/**/page.tsx`、`app/(streamer-desktop)/desktop/page.tsx`
- 没有任何页面在 `!auth` 时 `redirect()`/`notFound()`；数据加载器在无会话时返回 `undefined/null/{}`，UI 静默回退到占位数据。安全仅依赖（且当前失效的）中间件。
- 影响：匿名用户可看到完整经营/主播外壳与路由结构（行级数据仍受 DB RLS 保护，但 UI 面与结构被暴露）。
- 修复：在受保护页面或共享 layout 中 `if (!auth) redirect("/login")`，并修复 C1。

### C3. 应收结算批次重复计算项目底薪（按主播次数叠加）
- 类别：Bug（资金）｜ 位置：`features/settlements/settlement-service.ts:212-238`、`220-228`｜ 状态：✅ 已人工复核
- `batchType === "receivable"` 时对每条报数使用同一个项目级 `projectRule`，但 `includeBaseSalary` 用 `baseSalaryApplied`（按 `report.streamerId` 去重）。底薪是项目级向厂家计收的费用，却被「每个主播各计一次」。N 个主播时厂家被多收 `(N-1) × 底薪`。现有单测仅覆盖底薪为 0 的 CPT 场景，未能发现。
- 影响：凡使用含底薪应收方法且周期内 >1 主播时，向厂家开账金额直接偏高。
- 修复：应收批次的 `includeBaseSalary` 应基于「整批一次」的项目级标记，而非按 `streamerId` 去重。

### C4. AI 运行层全是确定性桩，无任何真实 LLM 接入
- 类别：Unimplemented ｜ 位置：`features/ai/ai-tool-layer.ts:45-112`、`features/ai/providers/deterministic-provider.ts`、`features/ai/contracts.ts:53`｜ 状态：✅ 已人工复核
- 唯一的 `AiProvider` 实现是 `createDeterministicProvider`（回显/写死中文文案与固定追问）。`AiProviderName = "openai" | "hunyuan" | "deterministic"` 但 `openai`/`hunyuan`/Anthropic provider 在全仓库不存在。`streamer_diagnosis`、`project_review_summary` 返回硬编码字符串，usage 账本记录伪造的 `promptTokens:1, completionTokens:1`。`app/api/ai/diagnosis` 却把它当作真实「诊断」对外提供。
- 影响：产品的 AI 诊断/建议是冒充真实输出的占位实现；计费/用量账本数据失真。
- 修复：在现有 `AiProvider` 接口后实现真实 Anthropic provider（如经 `@anthropic-ai/sdk` 调 `claude-opus-4` / `claude-sonnet`），并把 `runAiGateway` 路由过去；落地前应将响应明确标注为 stub/disabled。

### C5. OCR 任务管道没有 worker，任务永远不会执行
- 类别：Unimplemented / Bug ｜ 位置：`features/ai/ocr-jobs.ts:232`（`runOcrJobOnce`）、`features/ai/providers/tencent-ocr-provider.ts:58`
- `createOcrJob`（被 `POST /api/ocr/jobs` 调用）只入队 `background_jobs(status:"queued")` 和 `ocr_results(status:"pending")`，但 `runOcrJobOnce` 与 `createTencentOcrProvider` 只在测试中被引用——没有任何 cron/worker/路由消费队列。真实且签名正确的 Tencent provider 是死代码。
- 影响：每个 OCR 任务创建后永远停在 queued/pending；生产环境从不做证据 OCR 提取。
- 修复：新增 worker/定时任务（如 `POST /api/ocr/jobs/run` 或调度器）领取队列并调用 `runOcrJobOnce`。

---

## 2. High

### H1. 签名上传指向不存在、无 RLS 策略的存储桶（且环境变量名读错）
- 类别：Bug / Security ｜ 位置：`app/api/uploads/signed/route.ts:12,34`｜ 状态：✅ 已人工复核
- 路由读 `process.env.SUPABASE_PRIVATE_BUCKET`、默认 `"evidence-private"`。但实际桶是 `jy-private`（`supabase/migrations/20260601161000_initial_foundation.sql:789`，RLS 策略绑定 `bucket_id='jy-private'`，行 1113/1121），环境变量名是 `STORAGE_BUCKET_PRIVATE`（`.env.example:5`）。即读了错误的变量名、又回退到一个不存在且无访问控制的桶。测试 `signed-route.test.ts:57,63` 甚至固化了错误值 `evidence-private`。
- 影响：正确配置的环境里签名上传必然失败；若该桶被后续创建，则落入无访问控制的桶。
- 修复：改读 `process.env.STORAGE_BUCKET_PRIVATE`，默认 `"jy-private"`，并修正测试断言。

### H2. `need_more`（需补充）审核把未通过报数推入结算池，并被错标为「驳回」
- 类别：Bug（状态机/资金）｜ 位置：`features/live-operations/live-operations-service.ts:512-578`（路由 `app/api/live-reports/[reportId]/review/route.ts`）
- `decision === "need_more"` 时报数以 `enterSettlementPool: input.enterSettlementPool ?? true`、`includeInTaskResult ?? true` 保存——把未通过报数默认拉进结算池；任务转移走 `else`/驳回分支（→ `report_rejected`），审计 `action` 与通知文案都写「reject」。报数状态(`need_more`)与任务状态(`report_rejected`)发散，且 `need_more` 报数无法干净地重新进入审核。
- 影响：待补证报数被计入结算、任务被标记为驳回，主播/经营端状态自相矛盾。
- 修复：仅当 `decision === "approve"` 时默认 `enterSettlementPool/includeInTaskResult` 为 true；按三种决策分别处理任务转移、审计与通知（`need_more` 不应进 `report_rejected`）。

### H3. 直播任务自转移逃逸：已 `live` 任务可被「重新开始」，清零系统计时
- 类别：Bug（计时/资金基础）｜ 位置：`features/live-operations/live-task-state.ts:28-30` + `live-operations-service.ts:271-278`
- `assertLiveTaskTransition` 中 `if (from === to) return;` 无条件放行任意 X→X。`startLiveTask` 在任务已 `live` 时仍通过校验，更新会把 `systemStartedAt=now`、`systemStoppedAt=null`、`systemDuration=0` 重置。第二次「开始」（双击/重试/恶意）会丢弃已累计直播时长——而系统时长是 CPT 绿证结算的唯一计费依据。
- 影响：系统时长（唯一产生绿证 CPT 付薪的 `time_source: "system"`）可被静默清零，改变结算金额。
- 修复：去掉 `from === to` 提前返回；`start` 仅允许从 `pending_live`/`abnormal` 进入，且 `live` 任务已有 `systemStartedAt` 时拒绝。

### H4. 创建主播档案无角色校验，且 `userId` 由调用方完全控制
- 类别：Security ｜ 位置：`app/api/streamers/route.ts:33-89`、`features/streamers/streamer-service.ts:102-160`
- `POST /api/streamers` 仅认证、无任何角色/权限校验（与做了 owner/ops_manager 门控的风险更新路由不一致），`createStreamerProfile` 也无角色门控。更糟的是 `body.userId` 被透传，调用方可把新档案绑定到任意他人 auth ID。
- 影响：任意已认证用户（含 `streamer`）可创建主播档案并绑定到他人账号。
- 修复：路由/服务收敛到 MCN 内部角色（`isMcnStaff`），并校验/授权 `userId` 绑定关系。

### H5. OCR `imageUrl` 存在 SSRF 风险，`imageBase64` 无大小上限
- 类别：Security ｜ 位置：`app/api/ocr/jobs/route.ts:42` → `features/ai/ocr-jobs.ts:91-92,253-254` → `tencent-ocr-provider.ts:144`
- `imageUrl` 取自请求体，无 scheme/host 校验即存储并交给 Tencent OCR `ImageUrl`（worker 落地后会被服务端拉取）。无白名单、无 https 限制、未屏蔽内网/元数据地址（`169.254.169.254`、`localhost`、RFC1918）。`imageBase64` 也无长度上限。
- 影响：管道运行后可被用于服务端请求伪造/内网探测；超大 base64 可耗尽内存。
- 修复：限制 `imageUrl` 为指向白名单主机的 https（或项目自有私有桶），并为 `imageBase64` 设上限。

### H6. 无 `error.tsx` / `loading.tsx` / `not-found.tsx`，生产 UI 静默渲染占位数据
- 类别：Stability / Bug ｜ 位置：`app/**`（无任一边界文件）；占位回退见 `components/reference-ui/ops-reference.jsx:784`、`streamer-mobile-reference.jsx:754` 等
- 每个 console/streamer 页面都是 async Server Component 直查 Supabase，无 Suspense、无错误边界。`Array.isArray(x) ? x : FALLBACK` 模式使「未授权/失败/无 streamerId」与「真实空数据」无法区分；查询抛错则触发 Next 默认未样式化错误屏并拖垮整条路由。
- 影响：加载失败/被拒看起来像健康的空仪表盘；用户无从得知数据加载失败。
- 修复：新增 `app/(ops)/console/{error,loading}.tsx` 与路由组 `not-found.tsx`；由页面传出显式 `state: unauthorized|empty|loaded`，取消静默占位回退。

---

## 3. Medium

### M1. `getAuthContext` 为多组织用户任意挑选组织/角色
- 类别：Bug / Security ｜ 位置：`lib/auth/context.ts:45-56`
- 成员查询用 `.eq("status","active").limit(1).maybeSingle()`，无 `order by`、无组织选择器。多组织活跃成员得到的 `organizationId`/`role` 不确定且可能逐请求变化，所有 RBAC 门控均源自此 `role`（可能套用错误角色）。
- 修复：由显式且校验过的请求参数（活跃组织 cookie/header）驱动组织选择并验证成员关系，而非 `limit(1)`。

### M2. `audit_logs` append-only 触发器未覆盖 TRUNCATE；审计字段可被伪造
- 类别：Security（审计完整性）｜ 位置：`supabase/migrations/20260601161000_initial_foundation.sql:614-616`、`lib/audit/audit.ts:53-72` + 插入策略 `1082-1085`
- 行级 `before update or delete` 触发器拦不住 `TRUNCATE`，具备 truncate 权限者（service-role/表 owner）可整表清空审计且不触发守卫。插入策略只校验 `is_org_member`，`actor_user_id/name/role` 由客户端自由提供 → 同组织成员可冒名写审计。
- 修复：增加 `before truncate ... for each statement` 触发器并 revoke TRUNCATE；插入 `WITH CHECK` 强制 `actor_user_id = auth.uid()`，`actor_role` 服务端推导。

### M3. 财务字段脱敏仅靠应用层 `canSeeFinancialFields`，DB 无列级兜底
- 类别：Security / Maintainability ｜ 位置：`lib/rbac/permissions.ts:15-19`
- 厂家应收/毛利/成本的屏蔽完全依赖序列化前调用 `canSeeFinancialFields`，无 DB 列级保护（不像主播侧有 `streamer_payable_items_safe` 安全视图）。`ops_manager`/`operator_business` 的 RLS 仍可读应收批次，任何忘记调用脱敏的路由都会向非财务角色泄露毛利。
- 修复：为面向内部员工的应收/成本路径增加脱敏 DTO 视图（对齐 payable-safe 模式）和/或列级授权。

### M4. 结算/履约多写操作非原子、无事务，部分失败留下不一致状态
- 类别：Stability / Bug（资金）｜ 位置：`settlement-service.ts:241-278`、`live-operations-service.ts:397-475 / 512-545`、`features/ai/ocr-jobs.ts:96-131`、`app/api/live-tasks/batch/route.ts`
- 批次行、各明细、`markReportSettled` 为多次独立 await，无事务。`markReportSettled` 未检查受影响行数，竞态下可留下「批次与明细已落库但报数未结算」或中途因唯一索引冲突半写。批量建任务亦逐条提交、无回滚、无条数上限。
- 修复：用 DB 事务/RPC 包裹生成流程；校验 `markReportSettled` 受影响行数，为 0 则回滚；批量操作改为全有全无或返回逐项结果并设上限。

### M5. 手工结算明细以浮点「读-改-写」更新批次合计，存在丢失更新与精度漂移
- 类别：Bug / Stability（资金）｜ 位置：`settlement-service.ts:425-428`、引擎 `settlement-engine.ts:124-129`、合计 `570-579`
- `updateSettlementBatch({ manualAmount: before.manualAmount + item.manualAmount })` 读入 JS 相加再写回，并发新增会互相覆盖（丢失更新）。全程浮点运算（`(duration/60)*rate` 后 `Math.round(*100)/100`）逐项取整再求和，与 DB `numeric(12,2)` 可产生分位差。
- 修复：批次合计改为 SQL 原子自增或在事务内由明细重算；金额计算改用整数分（参考已正确实现的 `pricing-calculator`）。

### M6. `lockSettlementBatch` 允许直接锁定 `draft` 批次（缺少 confirmed/finance 前置）
- 类别：Bug（状态机）｜ 位置：`settlement-service.ts:336-339`
- 仅拒绝 `locked`/`voided`，`draft/generated/pending/confirmed/reopened` 均可直接锁定，可 `draft → locked` 跳过复核，削弱锁的财务管控意义。
- 修复：引入显式允许状态集（如仅 `confirmed/generated/reopened` 可锁），对齐直播任务的转移表。

### M7. OCR 重试在跨组织校验之前已完成写入与审计；领取无原子性
- 类别：Security / Bug / Stability ｜ 位置：`app/api/ocr/jobs/[jobId]/route.ts:44-52`、`features/ai/ocr-jobs.ts:197-230,243-250`
- `retryOcrJob`（`getOcrJob` 仅按 `id`，无 `organization_id`）先更新状态并写审计，路由随后才比较 `organizationId`。RLS 多半能拦 UPDATE，但审计行已写、且与 GET 路径「先校验后信任」不一致。`runOcrJobOnce` 的领取 `update(status:"running")` 无条件守卫（无 CAS），两个 worker 可重复处理同一任务（重复计费）。
- 修复：mutate 前先按 `organizationId` 加载并 404；领取改为条件更新 `.eq("status","queued")` 并按受影响行数判定。

### M8. 导出 CSV 存在公式注入；导出/匿名探测面待收敛
- 类别：Security ｜ 位置：`features/exports/export-service.ts:72-78`（`csvCell`），数据源 `app/api/exports/route.ts:37-45`
- `csvCell` 处理了 `, " \n` 但未中和电子表格公式前缀（`= + - @`、Tab/CR）。`rows` 直接来自请求体，攻击者可注入 `=HYPERLINK(...)` 等在 Excel/Sheets 打开时执行。
- 修复：对以 `= + - @ \t \r` 开头的单元格加前导 `'`。

### M9. 异常扫描去重有竞态且无时间窗
- 类别：Bug / Stability ｜ 位置：`features/anomalies/anomaly-scanner.ts:42-60,131-160`
- 「先查后插」无锁，并发扫描会重复发通知；`notificationExists` 仅按 `(organization_id, source)` 且无时间窗，导致同 source 的复发异常永不再次通知。
- 修复：对 `(organization_id, source)` 加唯一约束并 upsert/冲突忽略；重新设计 source 的有效期。

### M10. 主播档案越权操作（apply/提交录屏）在应用层无属主校验
- 类别：Security（纵深防御）｜ 位置：`features/applications/application-route-utils.ts:86-104`、`application-service.ts:135-157,247-291`
- `resolveStreamerId` 接受 `body.streamerId` 而不校验是否属于当前用户；`applyToProject`/`submitRecording` 不校验 `streamer.userId === actor.userId`。**经核对 RLS 实际可拦截**（`can_access_project` 与 streamer 插入策略要求 `streamer_id = current_streamer_id`），故为纵深防御缺口而非线上可利用漏洞——但应用层不应仅依赖 RLS。
- 修复：在上述函数中要求解析出的 streamer 的 `userId` 等于 `actor.userId`，否则拒绝。

### M11. 上传 `ownerId`/`category` 未校验，组织内可跨属主写入
- 类别：Security ｜ 位置：`app/api/uploads/signed/route.ts:22-40`、`features/storage/private-upload.ts:5-13`
- `category` 仅 TS 类型（运行时不校验），`ownerId` 完全由调用方控制并拼入路径 `{org}/{category}/{ownerId}/{file}`；存储 RLS 仅校验首段 org。组织内任意用户可为任意 `ownerId`/category 签发上传 URL。
- 修复：运行时校验 `category` 枚举；将 `ownerId` 默认/强制为调用者自身（员工代传时再单独授权）。

### M12. 准入/AI/计费多条 RLS 策略缺 `to authenticated`，默认作用于 `public`（含 anon）
- 类别：Security（纵深防御）｜ 位置：`20260602013000_p1_admission_foundation.sql:185-246`、`20260602203000_p5_billing.sql:151-197`、`20260604103000_ai_runtime_foundation.sql:280-342`
- 与初始迁移一致使用 `to authenticated` 不同，这些策略未带角色子句，作用于 `public`（含匿名 `anon`）。今天仅因每条谓词最终依赖 `auth.uid()`（anon 为 null）而幸免；任何未引用 `auth.uid()` 的新策略都会暴露给 anon。
- 修复：为以上策略统一补 `to authenticated`。

### M13. 申请状态机：`recording_approved` 语义被复用，`confirmed` 状态不可达
- 类别：Bug ｜ 位置：`features/applications/application-service.ts:165,219,422-441,493-500`、`application-state.ts`
- `forceRecording` 为 false 时直接置 `recording_approved`（兼作「无需录屏」），使 `confirmed` 及其转移成为死状态，「拒绝入职」与「筛选后拒绝」无法仅凭状态区分。
- 修复：拆分「无需录屏」与「录屏已复核通过」两个状态。

---

## 4. Low（按主题归并）

- **L1. HTTP 状态码语义错误**（`lib/http/route-error-status.ts:1-16`，多路由）：授权失败/未找到/底层 DB 异常因「英文消息前缀正则」统一塌缩为 400，掩盖 403/404/500，破坏客户端重试与监控；本地化（中文项目）后必然失配。建议：改用带显式状态码的 typed error，按类型而非消息分支。
- **L2. 风险等级无法置 `blacklisted`**（`app/api/streamers/[streamerId]/risk/route.ts:13`）：`validRiskLevels` 缺 `blacklisted`，而模型/`assertStreamerCanBeInvited`/`blacklistReason` 都依赖它，唯一风险更新入口无法拉黑。建议：补入并要求 `blacklistReason`。
- **L3. PostgREST `.or()` 字符串拼接**（`features/notifications/notification-center-queries.ts:79`）：`recipient_user_id.eq.${userId},recipient_role.eq.${role}` 直拼，当前值受信但属过滤注入易感模式。建议：拼接前校验 UUID/枚举或用 builder。
- **L4. 失败登录通常不被审计**（`app/(auth)/login/actions.ts:18-33`）：审计仅在 `getAuthContext` 有 context 时写，失败登录 context 为 null → 失败登录不记账（安全监控盲点）。建议：用提交的邮箱独立记录失败登录。
- **L5. 多处 POST 体无 zod 校验**（war-room/auto-review/ai/ocr 路由）：`await request.json()` 直接断言，`null` 体会触发对 null 取属性的 TypeError；OCR 允许三种图源全空。建议：逐路由补 zod，并要求至少一种 OCR 图源。
- **L6. `auto-review/evaluate` 影子模式写入误导性 `action:"approve"` 审计**（`features/auto-review/auto-review-service.ts:43-63`）：只读 what-if 却无条件写审计且用攻击者可控 id，污染审计。建议：影子模式跳过审计或用 `evaluate`。
- **L7. 通知状态更新未按收件人收敛**（`features/notifications/notification-service.ts:49-58`）：更新仅按 `id+organization_id`，与读取按收件人不一致；角色定向通知无人能更新，缺失行 `.single()` 报 400 而非 404。建议：更新对齐读取的收件人过滤并 404。
- **L8. 战情室定价把红证未核实手工营收计入毛利**（`features/war-room/pricing-calculator.ts:60,111`）：`expectedReceivableCents += carriedManualRevenueCents`（硬编码 `red` 证据）无条件计入，抬高报价。建议：毛利剔除红证手工营收或单列。
- **L9. `forceRecording` 默认 `true`**（`features/applications/application-queries.ts:207`）：`project?.force_recording ?? true`，项目行被 RLS 隐藏时主播卡片误判为必须录屏。建议：默认 `false` 或项目行存在时才暴露。
- **L10. 直播提交数值/日期无范围校验**（`live-operations-route-utils.ts:83-91`、`live-operations-service.ts:667-678`）：`optionalNumber` 接受任意有限数；`assertScheduleWindow` 对不可解析日期得 `NaN<NaN===false` 而放行。建议：加观众/时长整数范围；插入前拒绝 `NaN` 日期。
- **L11. `current_streamer_id` / 成员唯一性**（`20260601161000_initial_foundation.sql:699-711`）：`streamers(organization_id,user_id)` 无唯一约束，一人多档案时身份不确定。建议：加唯一约束或使函数确定性。
- **L12. `recordUsageEvent` 静默截断分数量**（`features/billing/usage-metering.ts:91-93,131-133`）：`0.5 → 0` 抛错、`1.9 → 1` 静默，分数计量被错计。建议：显式校验原值并保留支持的分数指标。

---

## 5. 可维护性 / 稳定性 主题（横切）

1. **三个生产级 reference-ui 大文件整文件 `eslint-disable`**（`ops-reference.jsx:2`、`streamer-mobile-reference.jsx:1`、`streamer-desktop-reference.jsx:1`，约 120–412K）：应用最核心、行为最密集的文件零 lint 覆盖（exhaustive-deps/a11y/unused 全失效）。建议：去掉整文件禁用，逐步收敛，必要时按规则/按行禁用。
2. **死代码与重复实现**：`components/layouts/ops-shell.tsx` 无任何引用（真实导航在 reference-ui 内），`components/ui/{button,badge}.tsx` 与 reference-ui 内联实现并存。建议：删除或接线，统一设计令牌。
3. **路由命名误导**：`app/(ops)/console/stubs/[module]/page.tsx` 中 m4–m9 标 `status:"live"` 却挂在 `/console/stubs/...`；m0/m8/m10 无分支（真桩，渲染占位）。`status` 元数据装饰性、未被强制。建议：重命名为 `/console/[module]`，对真桩给出明确「暂未开放」。
4. **README 与实现漂移**：README 称「不再写入演示账号/样例数据」且 seed 为空，但 `scripts/api-integration-smoke.mjs`、`manual-acceptance-smoke.mjs` 硬编码演示账号（`owner@jy-demo.local`…/`Password123!`）与种子 ID；README 指向不存在的 `经营舱-开发计划.md`。建议：补充种子步骤说明（或加 env 开关），修正悬挂引用。
5. **结算口径用 `created_at` 与 UTC 日窗**（`settlement-repository.ts:147-148`、`settlement-queries.ts:133-134`、月度 key）：以「报数创建时间」+ 固定 `T00:00:00.000Z…T23:59:59.999Z` 划期。中国时区下月末/午夜附近报数会落入错误结算月。建议：确定规范口径字段（直播日或审核日）并按固定业务时区构窗与分月。
6. **错误对外暴露**：多数路由直接返回 `error.message`（内部 DB/provider 异常原文）。建议：已知错误映射码，未知错误返回通用文案 + 500。
7. **`next.config.ts` 为空**：无安全响应头（CSP/X-Frame-Options/Referrer）。建议：为处理结算财务数据的多租户应用补 `headers()` 基线。
8. **服务端 env 缺校验**：`lib/config/env.ts` 仅校验 3 个 `NEXT_PUBLIC_*`，`SUPABASE_SERVICE_ROLE_KEY`、`STORAGE_BUCKET_PRIVATE` 各处临时读取。建议：补服务端 env schema，配置错误在启动期暴露。
9. **`createSupabaseAdminClient`（service-role，绕过 RLS）已定义但无调用方**（`lib/db/supabase-server.ts:47-65`）：当前非线上漏洞，但与普通 server client 并列导出，易被误用于请求路径。建议：限定到 server-only 边界或暂时移除。客户端工厂的 `catch {}` 返回 null 也会把配置错误伪装成未登录（`42-44,62-64`）。

---

## 6. 复核确认无误的设计（减少误报）

- CPA/CPS/礼物正确「仅承载」（`computedAmount=0`，需手工录入 + 红/黄证据 + 原因）；CPT 仅在 `green && time_source==="system"` 付薪。
- 证据冻结由 DB 触发器 `prevent_live_report_snapshot_mutation` 强制（`settlement_duration/time_source/evidence_level` 写后不可变）。
- 主播侧 `streamer_payable_items_safe` 视图按 `current_streamer_id` 过滤，仅暴露本人应付项，不含 MCN 毛利/成本/厂家应收；治理 golden-path 测试断言成本/毛利不外泄，`getAllowedExportFields` 也会剥离。
- `reopenSettlementBatch` 仅 owner 且需原因；lock/reopen 为高风险审计；finance 被正确禁止管理/锁定。
- Tencent OCR 的 TC3-HMAC 签名实现真实正确、从 env 读密钥、不泄露 secret（问题仅在于从不被调用，见 C5）。
- `'use client'` 边界正确（仅三个 reference-ui 为客户端），无服务端密钥泄漏到客户端；演示数据守卫测试在位。

---

## 7. 建议修复顺序

1. **先堵安全/资金要害**：C1+C2（认证网关）、H1（上传桶）、C3（应收重复底薪）、H2/H3（结算/计时状态机）、H4/H5（主播档案越权、OCR SSRF）。
2. **再补功能落地**：C4（真实 LLM 接入）、C5（OCR worker）。
3. **稳定性与一致性**：M4/M5/M7（事务与原子性、金额整数分）、M1（多组织角色）、M2/M3（审计完整性与列级脱敏）、H6（错误/加载边界）。
4. **可维护性收尾**：lint 覆盖、死代码清理、路由命名、README 漂移、错误对外暴露与 env 校验。

> 全部 Critical/High 已逐条人工或交叉复核；Medium/Low 已对照 RLS 校准严重度。建议将本报告条目转为可跟踪 issue 后分批修复，避免一次性大改动引入回归。
