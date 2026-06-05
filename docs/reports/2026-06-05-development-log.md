# 经营舱开发日志

日期：2026-06-05
范围：从项目初始化到当前 `codex/full-project-ui` 分支 HEAD。
当前节点：全项目 UI 闭环完成，并合入 AI3 自动审核灰度指标可观测能力。

## 日志依据

- Git 时间线：`e1faeb6` 到 `360836a`。
- 阶段计划：`docs/superpowers/plans/` 与 `docs/superpowers/specs/` 下的 P0-P5、AI Runtime、AG1/AG2、AI3 设计和实施计划。
- 验收材料：`docs/reports/business-closure-acceptance-report.md`、`docs/reports/code-audit-report.md`、`docs/reports/bug-test-report.md`、`docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`。
- 当前验证：2026-06-05 当前分支已通过 `pnpm type-check`、`pnpm lint`、`pnpm test`；全量测试结果为 112 个测试文件通过、414 个用例通过，另有 1 个文件、3 个用例跳过。

## 项目目标

经营舱是面向游戏直播 MCN / 直播工作室的项目经营系统。项目从第一天开始就按业务闭环推进，而不是只搭管理后台壳子。核心目标是把立项、招募、选播、排班、直播计时、报数审核、结算、治理、智能作战台和商业化底座串成一条可验收链路。

系统的基础约束在早期即确立：

- 多租户：业务表带 `organization_id`，数据库层启用 RLS。
- 权限：数据库 RLS、服务端 RBAC、前端按钮/菜单门控三层并行。
- 审计：高风险动作写 `audit_logs`，统一走审计服务。
- 通知：核心状态变更写站内通知。
- 脱敏：主播端不暴露厂家应收、毛利、成本和内部风险字段。
- 证据：直播报数保留系统时长、截图时长、主播申报时长三轨，审核后冻结结算时长和证据等级。

## 阶段总览

| 日期                     | 阶段                              | 主要产出                                                                                                           | 当前状态                  |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 2026-06-02               | P0 工程骨架与项目纵切片           | Next.js 工作区、Supabase 基础 schema、登录壳、项目草稿创建与发布                                                   | 完成                      |
| 2026-06-02               | P1 履约证据闭环                   | 项目完善、主播池、报名录屏、排班直播、报数审核、可结算池                                                           | 完成主链路                |
| 2026-06-02               | P2 结算后端                       | 结算批次、CPT/底薪引擎、人工承载项、锁定/重开、主播安全账单                                                        | 完成主链路                |
| 2026-06-02               | P3 治理能力                       | 审计中心、通知待办、异常扫描、导出中心、厂家交付包                                                                 | 完成                      |
| 2026-06-02               | P4 决策飞轮                       | 自动审核 shadow、报价、匹配、复盘、安全 AI 诊断、active 门禁                                                       | 完成规则版                |
| 2026-06-02               | P5 商业化底座                     | 套餐门控、用量计量、账单状态、欠费只读                                                                             | 完成 v1 底座              |
| 2026-06-03               | UI 业务闭环修补                   | M10/M11、主播移动端、主播桌面端、经营侧二级动作逐步接后端                                                          | 完成主要闭环              |
| 2026-06-04               | AI Runtime Foundation             | AI invocation 账本、工具账本、LLM Gateway、OCR job、Provider contract                                              | 完成第一层地基            |
| 2026-06-04               | AG1 / AG2 Agent 层                | 经营分析、主播诊断、脚本优化、选播建议、报价权衡、M10 Copilot                                                      | 完成 deterministic/API 层 |
| 2026-06-04 至 2026-06-05 | AI3 自动审核灰度可观测            | rollout gates、指标构建、审计仓储、只读 API、M10 readiness UI                                                      | 当前节点                  |
| 后续 P0                  | 真实用户接线优先级                | `/m/diagnosis` 接入 `/api/ai/diagnosis`，报数截图先走 `/api/uploads/signed` 再提交 live report                     | 计划中                    |
| 后续 P1                  | AI Gateway 降级可靠性             | 结构化 schema mismatch 不直接硬失败，继续 fallback 到下一个可用 provider                                           | 计划中                    |
| 后续 P2                  | OCR 生产运维面                    | OCR job retry ceiling、staff runner route、经营侧队列/失败/待确认面板                                              | 计划中                    |
| 后续 P3                  | 剩余 UI 二级动作收口              | 桌面端 AI 诊断接 API，经营/主播剩余按钮归类为真实 API、导航、本地过滤或显式 pending                                | 计划中                    |
| 后续验收                 | Next Stage Real AI And UI Closure | 更新 gap inventory，输出 `2026-06-05-next-stage-real-ai-ui-closure-report.md`，跑 AI、P4/P5、UI smoke 和全仓 gates | 待执行                    |

## 2026-06-02 开发日志

### 工程与基础架构

项目以 `chore: scaffold Next.js workspace` 起步，建立 Next.js App Router、TypeScript、Vitest、ESLint、Prettier、pnpm workspace 和基础目录结构。随后通过 `feat: add Supabase foundation schema` 建立 Supabase 本地开发基础，包括初始迁移、schema contract test、RLS 和 seed 占位。

当日完成了最小可验证纵切片：登录页、经营 Web 外壳、主播移动端外壳、主播桌面端外壳、项目草稿创建、发布状态机、RBAC 校验、RLS 写入、审计和通知。这个阶段对应 P0，目标是证明项目不是静态页面，而是具备真实权限、状态和数据边界的业务系统。

关键提交：

- `e1faeb6`：初始化 Next.js 工作区。
- `9eafb72`：新增 Supabase 基础 schema。
- `f55bdc0`：加入 auth shell 与项目发布纵切片。
- `d7e6ba7`：补充 P0 骨架流程文档。
- `b565a59`：新增自动化开发计划。

### P1 履约证据闭环

P1 从项目管理开始向履约链路扩展。项目服务加入更多项目状态、资料字段和状态约束；主播池增加合作状态、风险、完成率等领域规则；选播准入建立报名、录屏、审核、二次确认流程；直播任务建立排班、开始/停止、报数、证据分级和审核入池。

这个阶段的核心成果是 M1-M5 贯通：

```text
项目完善 -> 主播池 -> 报名/录屏 -> 审核/确认加入 -> 排班直播 -> 报数审核 -> 进入可结算池
```

关键提交：

- `143031e`：扩展项目管理服务。
- `999d42f`：新增主播池领域规则。
- `25938a1`：新增 P1 admission schema foundation。
- `595fadc`：新增选播准入后端。
- `896e534`：新增直播任务和报数后端。
- `c5eac40`：把 live operations UI 接到后端。
- `4cff0b1`：新增 P1 认证流程 smoke。

### P2 结算闭环

P2 建立结算批次后端。结算输入只消费已审核并进入可结算池的报数，审核阶段不计算金额。CPT / 底薪由引擎计算，CPA / CPS / 礼物等保留为人工承载项；批次支持生成、人工调整、锁定和负责人重开，并保留原因、审计和通知。

主播端通过安全查询和安全视图读取自己的结算摘要，不返回厂家应收、毛利、成本等内部字段。

关键提交：

- `5744a61`：新增 settlement batch backend。
- `3f3169a`：接入结算中心动作。
- `fc19a86`：在控制台展示可结算池。
- `6a63230`：新增主播结算摘要。
- `b6cb572`：新增 P1/P2 settlement golden path。
- `61189ba`：新增 P2 认证结算 smoke。

### P3 治理能力

P3 不是新增一条孤立业务线，而是给前面链路加横向治理。审计中心提供高风险操作查询；通知待办提供任务状态提醒；异常扫描通过 deterministic 规则识别风险；导出中心走字段白名单；厂家交付包分阶段输出候选、执行和结项材料，并剔除成本、毛利和内部风险备注。

关键提交：

- `7058f33`：新增 P3 governance closure plan。
- `4d198e7`：新增审计中心。
- `b77dcff`：新增通知待办中心。
- `551fb8f`：新增 deterministic anomaly scanner。
- `7948208`：新增 governed export center。
- `4e6ab01`：新增 vendor-safe delivery package。
- `3f100e7`：新增 P3 governance regression。

### P4 决策飞轮

P4 在已有业务闭环上加入规则版智能能力。自动审核先做 shadow 模式，只记录“本应自动通过”的判定，不直接放行；报价测算、主播匹配、项目复盘以 cents / basis points 等稳定数值输出；AI 诊断走注册工具，不允许任意 SQL，不绕过 DTO 和权限边界。

active 自动审核在本阶段被明确门禁：必须存在 active rule，并且不能默认开启。即便 active 生效，也只调用报数审核入池，不计算金额，不生成结算项。

关键提交：

- `192bb97`：新增自动审核 shadow mode。
- `b2e2670`：新增报价测算器。
- `ecaeeda`：新增作战台匹配评分。
- `5835d00`：新增项目复盘报告。
- `d3a540f`：新增安全 AI 诊断工具。
- `1e5c4de`：为 active 自动审核加审批门禁。
- `a61767d`：新增 P4 flywheel regression。

### P5 商业化底座

P5 建立 SaaS 化底座，包括套餐、功能门控、用量计量、加量包、账单状态和欠费只读。欠费或 past_due 状态允许读历史数据，但拒绝关键写操作，不删除结算或审计数据。

关键提交：

- `ed907b3`：新增 billing schema foundation。
- `755d8a5`：新增 billing feature gates。
- `2a81fb0`：新增 usage metering。
- `8724299`：新增 billing status API。
- `1beb822`：新增 P5 commercialization regression。

### 2026-06-02 验收结论

当日输出三份验收材料：

- `business-closure-acceptance-report.md`：系统从 P0 骨架推进到 P5 商业化底座，主线闭环与横向治理有回归保护。
- `code-audit-report.md`：RLS、授权、密钥、AI 工具边界、整数金额、审计脱敏均通过审计。
- `bug-test-report.md`：覆盖除零、重复结算、跨组织越权、审核重提、并发/重复提交等高发边界。

当时验证证据包括：

- `pnpm test`：60 files / 180 tests passed。
- `pnpm test:p5-commercialization`：6 files / 15 tests passed。
- `pnpm test:p4-flywheel`：12 files / 29 tests passed。
- `pnpm test:p3-governance`：9 files / 19 tests passed。
- `pnpm test:golden`：1 file / 1 test passed。
- `pnpm lint`：0 errors。
- `pnpm type-check`：pass。
- `pnpm build`：pass。

## 2026-06-03 开发日志

### UI 业务闭环盘点

2026-06-03 首先输出 `docs/reports/2026-06-03-ui-business-closure-gap-inventory.md`，对经营 Web、主播移动端、主播桌面端逐项盘点哪些按钮已经接入真实业务动作，哪些仍是 UI-only 或静态数据。

当时高优先级缺口包括：

- M10 作战台 API 已存在，但 UI 按钮未调用 `/api/war-room/*`。
- M11 billing route 存在 API，但控制台没有可见账单状态屏。
- 主播移动端 AI 诊断仍是本地响应。
- 主播移动端报数截图不能继续使用硬编码 demo path。
- 主播桌面端任务、录屏和资料仍偏静态。

### M10 / M11 与三端闭环修补

随后按 gap inventory 修复主要闭环：

- M10 作战台绑定报价、匹配、项目复盘 API。
- M11 增加账单状态控制台。
- 主播移动端“我的”相关动作补到录屏、结算等真实面板。
- 主播桌面端任务接入 live API。
- 移除源码 seed 演示数据，改为由真实本地流程创建验收数据。
- 经营端 M1/M2/M4/M5/M6 的二级动作继续向真实 API、导航、过滤或显式 pending 收敛。

关键提交：

- `e084af4`：盘点 UI 与业务闭环缺口。
- `1a5614b`：M10 war room UI 绑定 live APIs。
- `ce10c8f`：新增 billing status console。
- `e5bf5e2`：闭合主播移动端 profile actions。
- `6d937e5`：主播桌面任务接入 live API。
- `4b40264`：新增生产数据和验收守卫，移除源码演示 seed。
- `04544f8`：新增 ops console closure plan。
- `cb0a77b`：闭合主播池经营侧动作。
- `7f64b84`：闭合项目管理经营侧动作。
- `02e6d5d`：闭合直播排班动作。
- `c05f5b1`：闭合报数与结算动作。
- `588a55c`：闭合剩余经营壳动作。

## 2026-06-04 开发日志

### AI Runtime Foundation

2026-06-04 开始把 P4/P5 规则版飞轮升级为真实 AI 系统的第一层地基。目标不是一次性启用完整 Agent Orchestrator，而是先让 AI/OCR/LLM 调用具备可审计、可计量、可降级、可回放的运行时账本。

新增运行时能力包括：

- `ai_invocations`：记录一次 LLM/OCR/Agent/insight 调用。
- `ai_tool_invocations`：记录 AI 内部工具调用明细。
- `background_jobs`：承载 OCR、AI replay、insight scan 等后台任务。
- `prompts`：支持 prompt key、version、status、hash 和 schema。
- `streamer_metrics`、`supplier_scores`、`scoring_weights`、`recommendation_outcomes`：为后续学习闭环和供应商评分沉淀结构化结果。
- `project_reviews`、`ai_diagnoses`、`ai_script_versions`：保存复盘、诊断和脚本调优结果。

关键提交：

- `4210cbc`：设计 AI runtime foundation。
- `edeef50`：细化 AI runtime interfaces。
- `568c56d`：补充 AI runtime test gates。
- `78b676c`：计划 AI runtime OCR implementation。
- `4ccaabe`：新增 AI runtime schema foundation。
- `4f8aac5`：新增 AI provider gateway contracts。
- `f61e5de`：记录 AI tool invocations。
- `71fd62c`：新增 Tencent OCR job pipeline。
- `d1f60bb`：开放 OCR job APIs。

### LLM Provider 与 Gateway

AI provider 不直接散落到业务代码，而是通过 `llm-gateway` 和 provider contract 进入。OpenAI、腾讯混元、腾讯 OCR 等真实 provider 走 env-gated 测试，CI 和无密钥场景由 deterministic provider 保持稳定。

关键提交：

- `b3af940`：计划 AI provider adapters。
- `ed0ee8b`：新增真实 LLM provider adapters。
- `08760e8`：新增 AI provider registry。
- `1d9aabf`：新增 LLM gateway provider smoke guards。
- `76bbdd6`：收紧 LLM provider 类型契约。

### AG1 / AG2 Agent 层

在 runtime 和 provider 边界之上，项目新增一批 deterministic-first Agent：

- AG1 经营分析 Agent：输出结构化项目复盘 / 经营分析。
- AG2 主播诊断 Agent：将主播端诊断升级为 AgentOutput。
- AG2 脚本优化 Agent：输出脚本调整建议和版本化结果。
- AG2 选播建议 Agent：辅助项目候选主播建议。
- AG2 报价权衡 Agent：输出价格、毛利、风险和建议方案。
- AG2 M10 Copilot：按明确 intent 路由到已接地 Agent，并返回统一 Copilot envelope。

关键提交：

- `beec684`：计划 AG1 business analysis agent。
- `5fa283e`：强制 Agent output numeric grounding。
- `0cd7f53`：新增 AG1 business analysis agent。
- `36aa664`：开放 AG1 project review API。
- `5fc12d0`：新增 AG2 streamer diagnosis agent。
- `5768625`：诊断 API 返回 AgentOutput。
- `e104e89`：新增 AG2 script optimization agent。
- `3003bbd`：开放 script optimization API。
- `c56b54f`：新增 AG2 casting advice agent。
- `6f882e6`：新增 AG2 pricing tradeoff agent。
- `b118ff5`：新增 AG2 M10 copilot agent。

### AI3 自动审核灰度门禁

AI3 的核心是让 active 自动审核从“代码上可用”变成“必须被数据证明后才能考虑”。本阶段新增 rollout gate、metrics builder、audit-log repository 和只读 API。

能力拆分如下：

- Rollout gates：检查 kill switch、shadow 样本量、误放率、抽检样本量、抽检错误率、显式 active 请求。
- Metrics builder：把 shadow 判定、人工最终结论、抽检样本转成 gate input。
- Repository adapter：从 `audit_logs` 映射 shadow outcomes 和 active audit samples。
- API：`GET /api/auto-review/rollout-metrics`，仅 operations roles 可读。
- UI 设计：M10 作战台展示 readiness，不暴露原始审计行，不提供 active toggle。

关键提交：

- `8ed2466`：设计 AI3 auto review shadow gates。
- `dc1d5bc`：计划 AI3 auto review shadow gates。
- `77d9c07`：新增 AI3 auto review rollout gates。
- `ef97a78`：设计 AI3 auto review metrics。
- `683124f`：计划 AI3 auto review metrics。
- `3af1f8f`：新增 AI3 auto review rollout metrics。
- `30b80a8`：设计 AI3 auto review metrics repository。
- `0a0a556`：计划 AI3 auto review metrics repository。
- `3105681`：新增 AI3 auto review metrics repository。
- `400383c`：设计 rollout metrics API。
- `cb5a499`：计划 rollout metrics API。
- `4b1b62e`：新增 rollout metrics API。
- `015ee2b`：设计 rollout metrics UI。

### 全项目 UI Flow 合并

2026-06-04 的 `feat: complete full project UI flows` 是一次大范围闭合提交，把此前经营端、主播移动端、主播桌面端、登录、组织成员、项目扩展字段、录屏库、settlement 安全查询等成果收束到完整 UI 流程中。

关键变化包括：

- 登录链路补充 workflow、business snapshot、表单和测试。
- 主播移动端新增 `/m/login`，录屏、任务、资料相关流程增强。
- 主播桌面端增强任务、录屏和 profile 数据绑定。
- 组织成员 API、成员管理服务和经营侧组织成员 UI 测试加入。
- 项目、主播、结算、录屏库 DTO 和查询进一步接入 UI。
- `supabase/seed.sql` 保持空 seed，避免演示数据进入源码。

关键提交：

- `c50031c`：设计本地《传奇》测试数据。
- `39be42f`：完成 full project UI flows。

## 2026-06-05 开发日志

### 当前合并点

当前 HEAD 为：

- `360836a`：Merge branch `codex/ai3-auto-review-rollout-metrics-ui` into `codex/full-project-ui`。

这代表当前项目节点是：完整项目 UI 闭环已经完成，AI3 自动审核灰度指标 UI/API 已合入主工作分支。系统现在可以在 M10 作战台读取自动审核 rollout readiness，展示 shadow 样本、误放率、抽检错误率和失败门禁原因；该能力是只读观察面，不开启 active 自动审核。

### 当前验证

当前分支验证结果：

- `pnpm type-check`：通过。
- `pnpm lint`：通过。
- `pnpm test`：通过，112 个测试文件通过、414 个用例通过；1 个测试文件、3 个用例跳过。
- `git status --short`：验证时工作区干净。

### 下一阶段计划

`docs/superpowers/plans/2026-06-05-next-stage-real-ai-ui-closure.md` 已列出下一阶段重点。该计划认为当前最高价值缺口不是大范围后端缺口，而是面向真实用户的接线、AI 降级、OCR 运维面和二级 UI 收口。

建议顺序：

1. 移动端主播 AI 诊断调用 `/api/ai/diagnosis`。
2. 主播报数截图先请求 `/api/uploads/signed`，再提交 live report。
3. `runAiGateway` 在结构化 schema mismatch 时继续 fallback 到下一个 provider。
4. OCR job 增加 retry ceiling、staff runner route 和经营侧队列面板。
5. 桌面端主播 AI 诊断接入同一诊断 API。
6. 剩余二级按钮统一分类为真实 API、真实导航、本地过滤或显式 pending。
7. 输出下一阶段 real AI / UI closure 验收报告。

## 当前能力清单

### 业务主链路

- 项目：草稿创建、发布、项目列表和项目资料扩展。
- 主播：主播池、风险状态、报名、录屏、审核、确认加入。
- 履约：批量排班、任务开始/停止、报数、证据分级、审核入池。
- 结算：可结算池、批次生成、人工项、锁定、重开、主播安全账单。
- 治理：审计中心、通知待办、异常扫描、导出中心、厂家交付包。
- 作战台：报价、匹配、复盘、AI 诊断、M10 Copilot。
- 商业化：套餐门控、用量计量、账单状态、欠费只读。

### AI 与自动审核

- 自动审核：shadow 模式、active rule 门禁、rollout gate。
- AI Runtime：invocation ledger、tool ledger、background jobs、prompt schema。
- Provider：deterministic、OpenAI、腾讯混元、腾讯 OCR 的 contract / adapter。
- OCR：job pipeline、job API、结果解析和状态机。
- Agent：经营分析、主播诊断、脚本优化、选播建议、报价权衡、M10 Copilot。
- AI3：rollout metrics、audit log repository、read-only API、readiness UI 设计/合入。

## 质量与边界

### 已验证边界

- RLS 与组织隔离覆盖核心业务表。
- 经营 API 使用 `getAuthContext` 和角色判断。
- 主播端安全 DTO / 安全视图不返回应收、毛利、成本。
- 自动审核 active 不默认开放。
- active 自动审核不计算金额、不生成结算项。
- 欠费只读不删除历史结算和审计。
- 金额和用量采用整数存储。
- 报价、复盘、用量等除零场景返回显式 fallback。
- 导出和厂家交付包剔除敏感字段。

### 仍在范围外

- 真实支付 provider、发票、税务。
- 企业 SSO、厂商门户、私有化部署。
- 完整账号安全设置，如密码重置、2FA、设备撤销。
- 默认启用 active 自动审核。
- 新增外部服务密钥或生产部署。

## 结论

项目已经从 P0 工程骨架推进到 P5 商业化底座，并完成第一轮经营 Web、主播移动端、主播桌面端的 UI 业务闭环修补。2026-06-04 至 2026-06-05 的重点已经转向真实 AI 系统地基和 AI3 自动审核灰度治理：系统不再只具备规则版智能能力，而是开始具备可审计、可计量、可降级、可回放的 AI 运行时。

当前最准确的开发节点描述是：

```text
P0-P5 主业务闭环完成
-> 三端 UI 主流程闭合
-> AI Runtime Foundation 完成第一层地基
-> AG1/AG2 deterministic Agent API 层完成
-> AI3 自动审核 rollout readiness 只读观测能力合入
-> 下一步进入真实 AI 接线、OCR 运维面和剩余 UI 二级动作收口
```
