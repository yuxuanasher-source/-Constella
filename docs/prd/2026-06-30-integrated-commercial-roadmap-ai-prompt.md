# 最新整合文档：经营舱未闭合功能去重与开发交付 AI 提示词

| 项 | 内容 |
| --- | --- |
| 文档名称 | 经营舱未闭合功能去重与开发交付 AI 提示词 |
| 版本 | v1.0 |
| 状态 | 最新整合交付稿 |
| 交付形态 | 可直接复制给 AI 产品/研发 Agent 的提示词 |
| 编写日期 | 2026-06-30 |
| 适用产品 | 经营舱 / Constella |

## 1. 使用方式

将本文第 4 节「AI 提示词正文」整体复制给 AI 产品经理、AI 架构师或 AI 研发 Agent，用于继续完成产品方案、技术拆解、排期、代码实现或验收清单。

本文整合了三个判断：

1. 已经有完整方案但尚未完整开发闭合的功能。
2. 哪些能力存在重复造轮子风险，应优先复用第三方或既有底座。
3. 哪些能力属于经营舱的业务壁垒，必须沉淀为自有产品能力。

## 2. 引用文档

| 功能方向 | 文档 |
| --- | --- |
| 商用产品完整度审计 | `docs/reports/2026-06-30-commercial-product-completeness-audit.md` |
| 录屏预览与 AI 资产化 | `docs/prd/2026-06-30-recording-preview-ai-asset-prd.md` |
| 单项目结算体系 | `docs/prd/2026-06-20-single-project-settlement-prd.md` |
| P6 商业化上线 | `docs/superpowers/specs/2026-06-05-p6-commercialization-launch-design.md` |
| 跨 MCN 项目协作 | `docs/superpowers/specs/2026-06-10-project-mcn-collaboration-design.md` |
| 角色化看板 | `docs/superpowers/specs/2026-06-16-role-based-dashboard-design.md` |
| AI 经营问答 Copilot | `docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md` |
| AI Runtime Foundation | `docs/superpowers/specs/2026-06-04-ai-runtime-foundation-design.md` |
| 报名录屏审核流 | `docs/superpowers/specs/2026-06-07-admission-recording-review-flow-design.md` |
| P1 项目管理待办 | `docs/checklists/P1-project-management.md` |
| P1 主播池待办 | `docs/checklists/P1-streamer-pool.md` |
| P3 治理待办 | `docs/checklists/P3-governance.md` |
| P5 商业化待办 | `docs/checklists/P5-commercialization.md` |

## 3. 最新整合结论

经营舱当前不是缺少方向，而是已经积累了多份完整方案，下一步关键是做收敛：

- 用一个统一的「录屏资产」承接 B 站 URL、原始视频文件、准入审核、厂家复核、AI 分析和主播画像。
- 用一个统一的「AI Runtime」承接 AI Copilot、录屏 AI 分析、OCR、自动审核和经营洞察。
- 用一个统一的「Billing Domain」承接套餐、订阅、订单、用量、支付、发票和只读降级。
- 用一个统一的「Settlement Engine」承接应收、应付、税费、外部成本、协作分账和项目级毛利核算。
- 用一个统一的「Metric Foundation」承接老板、运营、财务、主播、协作 MCN、外部客户的角色化看板。

真正应该自研的是业务对象、业务流程、风控规则、结算规则、AI 分析结果如何转化为经营决策。真正不应该自研的是视频底层、转码、ASR、OCR、支付、发票、SSO、消息通道和通用 BI。

---

## 4. AI 提示词正文

你是一名资深 SaaS 产品架构师、全栈技术负责人和 AI Agent 研发负责人。你正在继续开发一个名为「经营舱 / Constella」的产品，它服务于 MCN、直播工作室、主播运营团队和直播项目管理团队。

你的任务不是重新设计一个新产品，而是在现有代码仓库和既有文档基础上，把已经有完整方案但尚未开发闭合的能力进行去重、整合、排期和落地。你必须按可商用 SaaS 产品标准进行判断。

### 4.1 产品背景

经营舱已经形成以下主线：

```text
项目创建
-> 主播招募
-> 报名准入
-> 录屏审核
-> 排班直播
-> 主播报数
-> 证据审核
-> 结算批次
-> 审计治理
-> AI 辅助经营
-> 套餐计费与商业化
```

当前产品已有较强工程底座和测试覆盖，可用于受控试点，但距离正式商业化售卖仍有阻断项。

已知关键问题：

1. 主播移动端 `/m/login` 存在重定向循环，未登录主播无法正常进入登录页。
2. Pricing 页面存在套餐价格显示为 `¥0/月` 的风险，影响正式售卖可信度。
3. 真实支付、发票、税务、对账、外部通知、生产 AI provider、客户 onboarding 还没有完整闭合。
4. 多个方案之间存在重复建设风险，需要统一资产层、AI 层、结算层、计费层和指标层。

### 4.2 最高原则

请严格遵守以下原则：

1. 不绕过第三方平台限制，不抓取或代理 B 站真实视频流。
2. 不自研播放器、转码、ASR、OCR、支付、发票、SSO、短信邮件飞书企微通道、通用 BI。
3. 业务域必须自研，包括录屏资产、主播画像、项目协作、结算规则、审核证据、经营决策卡片。
4. AI 只做辅助判断，不自动通过主播、不自动拒绝主播、不自动锁定结算、不自动导出敏感文件。
5. 所有金额以分存储，所有比例以 bps 存储。
6. 所有跨组织、主播端、外部客户可见数据必须经过 DTO、权限、脱敏和审计。
7. 新功能必须复用现有底座，不得新造平行系统。
8. 每个商业关键路径必须有自动化测试和至少一个可验收的浏览器级路径。

### 4.3 禁止重复造轮子的能力

以下能力不得自研底层，只能通过第三方、云服务或现有成熟组件接入：

| 能力 | 禁止做法 | 推荐做法 |
| --- | --- | --- |
| B 站视频播放 | 服务端抓取、代理、转播 B 站真实视频流 | 只做 URL 识别、官方外链播放器、失败兜底和外部打开 |
| 视频底层 | 自研播放器、转码、封面抽帧、切片播放 | 使用对象存储、CDN、云转码、媒体处理服务 |
| ASR/OCR | 自研语音识别、OCR 模型 | 接 OpenAI、腾讯云、阿里云或其他成熟 provider |
| 多模态理解 | 自训练视频理解模型 | 先用大模型 API 和结构化提示词沉淀业务结果 |
| 支付 | 自研支付通道、扣款、验签、退款 | 接聚合支付、微信支付、支付宝、Stripe 或 Paddle |
| 发票税务 | 自研发票开具、红冲、税局接口 | 接第三方发票平台或财税系统，产品只管申请和状态 |
| SSO/MFA | 自研 SAML、OIDC、MFA、设备风控 | 使用成熟 Auth 服务或企业 IdP 对接 |
| 外部通知 | 自研短信、邮件、飞书、企微网关 | 接成熟消息服务，内部沉淀模板和发送记录 |
| 通用 BI | 自研拖拽报表、任意 SQL、任意图表引擎 | 先做固定经营指标，复杂 BI 可接 Metabase/Superset/嵌入式 BI |

### 4.4 必须自研的核心业务能力

以下能力是经营舱的产品壁垒，必须沉淀在自有系统中：

| 能力 | 自研原因 |
| --- | --- |
| 录屏资产化 | 通用视频平台只知道视频，不知道主播、项目、报名、复盘和准入结论 |
| 主播直播节奏分析 | 这是 MCN 对主播能力、项目匹配度和直播质量的业务判断 |
| 录屏审核证据链 | 关系到主播准入、厂家复核、争议处理和后续结算审计 |
| 项目协作流程 | 跨 MCN 合作、收入分成、主播贡献、结算关闭是行业工作流 |
| 单项目利润核算 | 通用财务软件无法理解主播成本、项目收入、弱证据、供应商成本和协作分账 |
| 经营决策卡片 | 不是普通 BI，而是把数据转化成下一步经营动作 |
| AI 业务结果结构化 | AI provider 可以外接，但分析维度、评分口径、证据片段和建议闭环必须自有 |

### 4.5 内部重复建设风险与统一方案

请优先消除以下内部重复：

| 重复风险 | 统一方案 |
| --- | --- |
| `recording_submissions`、`streamer_recording_links`、新录屏资产模型各自为政 | 建立统一 `recording_assets`，原有表作为场景引用或兼容层 |
| AI 诊断、AI Copilot、录屏 AI 分析各自调用模型 | 全部走 AI Runtime，统一 invocation、tool invocation、usage、prompt version、audit |
| P5 计费和 P6 商业化各写一套套餐权益 | 统一 Billing Domain，套餐、订阅、订单、权益、用量只保留一个权威口径 |
| 主播结算、项目结算、协作分账分散计算 | 统一 Settlement Engine，按收入、成本、税费、分账、锁账组织 |
| 老板看板、运营看板、财务看板各自拼 SQL | 建立 Metric Foundation，指标统一计算，按角色裁剪 DTO |

### 4.6 最新优先级

按商业价值和阻断程度，开发优先级如下。

#### P0 商用入口修复

目标：解除正式试用和销售演示的入口级阻断。

必须完成：

1. 修复 `/m/login` 重定向循环。
2. 修复 Pricing 页面套餐价格显示错误。
3. 建立稳定演示组织、试用路径和端到端 smoke。
4. 增加测试覆盖：未登录访问 `/m/login` 不应 307，标准套餐不能全部为 0。

验收标准：

```text
未登录主播可访问 /m/login
未登录访问 /m/tasks 会跳到 /m/login?next=/m/tasks
登录后可回到原任务页
Pricing 展示真实套餐价格
注册试用后 10 分钟内能看到产品核心价值
```

#### P1 录屏预览与 AI 资产化

目标：把主播录屏从一次性审核材料升级为长期数据资产。

必须完成：

1. 支持主播提交 B 站 URL，并解析为标准化录屏来源。
2. 产品内尝试使用 B 站官方外链播放器预览。
3. 预览失败时提供明确状态、外部打开和上传原始文件兜底。
4. 支持原始视频上传到私有存储，作为正式审核证据和 AI 分析源。
5. 建立统一 `recording_assets` 资产模型。
6. AI 解析录屏，输出直播节奏、话术、互动、音画质量、合规风险、项目匹配度和高光片段。
7. AI 结果进入主播画像、项目匹配、复盘和审核辅助，不自动做最终准入决策。

建议数据模型：

```text
recording_assets
recording_asset_sources
recording_ai_analyses
recording_ai_segments
```

必须复用：

```text
/api/uploads/signed
ai_invocations
ai_tool_invocations
audit log
usage metering
existing recording submissions
```

不得实现：

```text
B 站视频流抓取
服务端代理 B 站播放
绕过登录、风控或防盗链
```

验收标准：

```text
B 站 URL 可识别并展示预览尝试
无法预览时用户知道原因和下一步
原始文件可上传、播放、归档
AI 分析可排队、失败重试、展示报告
审核员可基于 AI 片段做人工决策
所有调用计入 AI/存储/转码用量
```

#### P1 单项目结算闭环

目标：让产品能回答“这个项目到底赚不赚钱，能不能结算”。

必须完成：

1. 项目维度应收单价配置。
2. 税费配置和含税/不含税金额口径。
3. 外部成本录入与归集。
4. 应收、应付、税费、外部成本合并为项目级结算校验。
5. 毛利、毛利率、差异项、可结判定。
6. 校验通过后才允许结算批次确认和锁定。

必须复用：

```text
settlement_batches
settlement_batch_items
project_cost_items
settlement-engine.ts
calculateProjectFinancials
roles.ts
billing entitlement gates
audit log
```

验收标准：

```text
项目能配置收入规则
应收批次不再因缺规则回落到 0
项目能展示收入、成本、税费、毛利
负毛利或差异异常会阻断结算锁定
锁定、重开、人工调整都有原因和审计
```

#### P1 AI Runtime 生产化

目标：所有 AI 能力走统一底座，避免每个模块各接一套模型。

必须完成：

1. 统一 AI invocation 账本。
2. 统一 provider gateway。
3. 统一 prompt version。
4. 统一 tool invocation。
5. 统一 usage 计量。
6. 统一降级、重试、回放和审计。
7. 录屏 AI、经营问答、OCR、自动审核都必须接入。

不得实现：

```text
业务代码直接调用外部模型 SDK
模型自由写 SQL
模型绕过 DTO/RBAC/RLS
模型直接执行审核、结算、导出、权限变更
```

验收标准：

```text
每次 AI 调用可查 provider、prompt、成本、耗时、输入输出摘要
无密钥环境可用 deterministic provider 跑测试
真实 provider 通过 env-gated 测试接入
AI 失败时业务功能可降级
```

#### P2 P6 正式商业化

目标：从受控试点升级为可收费 SaaS。

必须完成：

1. 自助试用。
2. 套餐选择。
3. 在线支付订单。
4. 支付回调和幂等确认。
5. 订阅生命周期。
6. 用量包购买。
7. 发票申请和后台人工开票状态。
8. 财务运营后台。
9. Billing Guard 覆盖关键写操作。
10. 欠费宽限期和只读降级。

可以外接：

```text
聚合支付服务商
微信支付
支付宝
第三方发票平台
财税系统
```

不得自研：

```text
支付通道
真实扣款系统
税局直连开票
复杂税务引擎
```

验收标准：

```text
客户可自助注册试用
客户可选择套餐并发起支付
支付成功后订阅权益立即生效
欠费后进入宽限期，再进入只读保护
发票可申请、可审核、可标记开票完成
所有支付回调可重放且幂等
```

#### P2 跨 MCN 协作闭环

目标：让一个 MCN 能把项目开放给外部 MCN 协作，并完成申请、确认、执行和分账。

必须完成：

1. 项目协作开关。
2. 协作分享链接。
3. 外部 MCN 登录后申请。
4. 收入分成比例提议、拒绝、反报价、确认。
5. 协作 MCN 管理自己的主播贡献。
6. Owner MCN 保持全局控制。
7. 协作收入分账进入结算体系。
8. 所有跨组织数据严格隔离。

不得实现：

```text
镜像项目
未登录匿名协作申请
多轮复杂谈判历史
自动支付、自动发票、银行流水核销
```

验收标准：

```text
Owner 可创建并撤销协作链接
Applicant MCN 可提交申请
Owner 可接受、拒绝或反报价
Applicant 可确认反报价
激活后双方看到的项目数据符合权限
协作分账可进入项目结算
```

#### P2 角色化看板与 Metric Foundation

目标：让不同角色进入产品后看到自己真正需要处理的问题。

必须完成：

1. 老板看经营健康、毛利、风险和关键卡点。
2. 运营负责人看项目卡点、候选缺口、异常任务。
3. 一线运营看个人待办。
4. 财务看结算池、弱证据金额、重开批次。
5. 主播看任务、报数、补证据和收入。
6. 协作 MCN 看自己的贡献、任务和分账。
7. 外部客户/厂家看候选录屏、交付结果和可审核内容。

必须复用：

```text
projects
project_streamers
project_applications
recording_assets
live_tasks
live_reports
settlement_batches
audit log
```

不得实现：

```text
第一版不要做通用 BI
不要允许角色自行写 SQL
不要在 DTO 中泄漏内部成本、毛利、供应商成本或私密风险备注
```

验收标准：

```text
每个角色默认页问题明确
所有指标来自同一 Metric Foundation
卡片可钻取到真实业务对象
敏感字段按角色脱敏
高风险动作仍需人工确认和审计
```

### 4.7 技术落地架构

请按照以下域拆分实现，不要横向堆页面：

```text
features/recordings
  录屏资产、来源、预览状态、AI 分析结果、审核引用

features/ai
  invocation ledger、provider gateway、prompt version、tool registry、usage、audit

features/billing
  plans、subscriptions、orders、payments、invoices、usage、entitlements、read-only guard

features/settlement
  receivable、payable、tax、cost、collaboration share、project closeout

features/collaboration
  project shares、applications、agreements、partner scoped views

features/metrics
  shared metric foundation、role DTO、drilldown links
```

数据层原则：

1. 新表必须带 `organization_id`，除非是全局静态配置表。
2. 业务数据必须开启 RLS 或由服务端受控路径访问。
3. 所有用户动作必须写 audit。
4. 所有 AI、OCR、转码、导出、支付相关动作必须写 usage 或 operation log。
5. 任何旧表兼容都应明确迁移路径，不允许长期两套权威来源。

API 原则：

1. API 返回 DTO，不直接返回数据库裸行。
2. API 负责权限、计费权益、审计和幂等。
3. 支付回调、AI job、转码 job 必须可重试。
4. 外部 token 链接必须可撤销、可过期、可审计。

UI 原则：

1. 主流程优先，不做解释型落地页。
2. 录屏页必须同时支持 URL 预览、文件上传、AI 报告和人工审核。
3. 结算页必须同时展示收入、成本、税费、差异和可结状态。
4. 商业化页必须让客户清楚知道当前套餐、额度、欠费状态和下一步。
5. AI 结果必须展示证据、置信度、片段和人工确认入口。

### 4.8 开发前必须执行的上下文读取

在写代码或继续拆方案前，先读取并对齐以下文档：

```text
docs/reports/2026-06-30-commercial-product-completeness-audit.md
docs/prd/2026-06-30-recording-preview-ai-asset-prd.md
docs/prd/2026-06-20-single-project-settlement-prd.md
docs/superpowers/specs/2026-06-05-p6-commercialization-launch-design.md
docs/superpowers/specs/2026-06-10-project-mcn-collaboration-design.md
docs/superpowers/specs/2026-06-16-role-based-dashboard-design.md
docs/superpowers/specs/2026-06-18-ai-business-copilot-design.md
docs/superpowers/specs/2026-06-04-ai-runtime-foundation-design.md
docs/superpowers/specs/2026-06-07-admission-recording-review-flow-design.md
docs/checklists/P1-project-management.md
docs/checklists/P1-streamer-pool.md
docs/checklists/P3-governance.md
docs/checklists/P5-commercialization.md
```

然后扫描当前代码：

```text
app/api
app/console
app/m
features/ai
features/billing
features/settlement
features/war-room
features/auto-review
supabase/migrations
tests
```

### 4.9 输出要求

如果你是产品 Agent，请输出：

1. 最新功能范围。
2. 去重后的模块边界。
3. P0/P1/P2 排期。
4. 每个模块的用户故事、状态机、权限、数据模型、API、UI、验收标准。
5. 明确标注哪些接第三方，哪些自研。

如果你是研发 Agent，请输出：

1. 现有代码可复用点。
2. 需要新增或修改的文件。
3. 数据迁移计划。
4. API 设计。
5. UI 改动。
6. 测试计划。
7. 灰度和回滚方案。
8. 风险清单。

如果你直接开始开发，请按以下顺序：

```text
1. 修复 P0 商用入口问题
2. 建立统一 recording_assets 资产模型
3. 接入录屏 URL 预览和原始文件上传
4. 接入 AI Runtime 的录屏分析 job
5. 补齐单项目收入、税费、成本、毛利校验
6. 补齐 P6 真实支付前的沙箱闭环
7. 补齐跨 MCN 协作和角色看板的剩余闭环
```

### 4.10 测试与验收要求

必须至少覆盖：

```text
pnpm type-check
pnpm lint
pnpm build
pnpm test
pnpm test:ui-smoke
pnpm test:p3-governance
pnpm test:p4-flywheel
pnpm test:p5-commercialization
pnpm test:golden
pnpm test:onboarding-funnel
```

新增测试必须覆盖：

1. `/m/login` 未登录可访问。
2. `/m/tasks` 未登录跳转到 `/m/login?next=/m/tasks`。
3. Pricing 标准套餐价格不同时为 0。
4. B 站 URL 解析和预览 fallback。
5. 原始录屏文件上传和权限校验。
6. 录屏 AI job 成功、失败、重试、降级。
7. AI invocation 和 usage 写入。
8. 项目应收规则生成非 0 应收批次。
9. 项目毛利校验阻断异常结算锁定。
10. 支付回调幂等。
11. 协作 MCN 不能看到 Owner 内部成本和私密备注。
12. 不同角色看板 DTO 不泄漏敏感字段。

### 4.11 最终交付判断

当以下条件满足时，才可以认为经营舱从“受控试点”进入“可正式商业化售卖”：

```text
入口可用：登录、注册、主播端、定价页无 P0 问题
付费可信：套餐、订阅、订单、支付、发票、欠费降级可验收
业务闭环：项目、主播、录屏、直播、报数、结算、审计能端到端跑通
资产沉淀：录屏、AI 分析、主播画像、项目复盘可复用
财务可信：单项目收入、成本、税费、毛利、结算锁定可追溯
权限可信：跨组织、主播端、外部客户、协作 MCN 无数据泄漏
AI 可信：所有 AI 结果有证据、有账本、有成本、有降级、有人工确认
运维可信：关键路径有测试、日志、监控、演示数据和回滚方案
```

请基于以上约束继续工作。不要重新发明底层基础设施。优先把经营舱独有的业务资产、经营判断和结算闭环做深、做稳、做成可商用产品。
