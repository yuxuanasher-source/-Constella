# 星耀 AI 助手 · 组织级业务诊断与优化引擎

日期：2026-07-03
状态：已落地（本文档随代码同步提交）

## 核心定位

星耀 AI 助手是组织级业务诊断与优化引擎，是整个系统的「智能大脑」，而非简单的
问答工具。它把资深运营的经验转化为可复制的算法能力，从「人找问题」升级为
「AI 主动发现问题」。

安全边界沿用《AI 能力全套方案》的分层铁律：诊断引擎全部处于 L1 感知层
（只读、确定性、可复算），输出遵守 `AgentOutput` 契约——数字只出现在带
溯源的 facts 中，findings / recommendations 一律定性描述，且所有建议
`requiresHumanApproval: true`，确认权归人。

## 五大能力与实现

### 1. 全量数据感知 —— 统一业务特征库

`features/ai/xingyao-feature-store.ts` + `xingyao-snapshot-loader.ts`

- loader 打通项目、主播、账号、结算、知识库、录屏六个模块的留痕数据
  （RLS 作用下的组织可见范围），逐模块 best-effort，单模块故障降级为空切片。
- 特征库为纯函数：从原始切片派生人（上播率、转化、缺勤规律）、
  场（开播率、时段执行、流量趋势）、货（账号状态、投放占比）、
  效（ROI、回款敞口）全维度特征，统一 cents / bps 口径。
- `coverage` / `missingData` 显式暴露数据覆盖情况，未接入模块不凭空造数。
- 尚无独立留痕的信号（培训完成度、账号流量）使用已有数据做显式代理并注释，
  等专属模块落地后替换。

### 2. 卡点自动定位与归因

`features/ai/xingyao-attribution-engine.ts`

- 项目 ROI 不达标 → 自动拆解「开播率不足 / 账号流量下滑 / 主播转化能力弱 /
  投放策略问题」四环，各环给出 0-10000 bps 严重度得分并排序，
  定位到具体主播（低上播 TOP）、具体账号（流量下滑 TOP）、具体时段
  （低开播 / 流量下滑时段 TOP）。
- 主播上播率低 → 自动关联排班合理性（不可用时段冲突 + 日均强度过载）、
  测试通过率、培训完成度、历史缺勤规律（识别「总在同一星期几缺勤」），
  输出核心原因。

### 3. 预测与风险预警

`features/ai/xingyao-risk-radar.ts`

- 四个确定性加权评分模型：项目月度达标率、主播留存风险、账号封禁风险、
  回款逾期风险；每条预测携带信号明细（值 × 权重 × 贡献）与应对建议。
- 风险分 ≥ 4000 bps 进入预警（medium），≥ 7000 bps 为 high；
  雷达输出按风险分排序，按模型聚合成 findings + 人工确认建议。

### 4. 自我学习与迭代

`features/ai/xingyao-learning-loop.ts` + `xingyao-weight-repository.ts`

- 特征权重校准：用「预测 vs 实际结果」样本做有界感知机式更新
  （权重恒在 0-10000 bps，与 `scoring_weights` 表约束同口径），
  报告校准前后命中率；校准结果持久化到既有 `scoring_weights`
  （weight_key 前缀 `xingyao.`），读取时与默认模型合并，缺失时安全回退。
- 策略验证沉淀：优化建议落地后对比基线指标（最小提升阈值 + 最小样本量），
  验证有效的策略蒸馏成标准化 playbook 写入知识库
  （复用 `knowledge-asset-index` 通道，source_ref 可溯源），反哺运营流程。

### 5. 自然语言交互

`features/ai/xingyao-assistant.ts` + `app/api/ai/xingyao/route.ts`

- 口语化提问（如「上周《天使之战》ROI 为什么下滑？」）→ 意图识别
  （ROI 归因 / 上播率归因 / 风险预测 / 经营总览）→ 书名号 / 名称包含
  实体定位 → 调用对应引擎 → 结构化归因分析报告。
- 时间口径与快照口径不一致时自动追加定性 caveat；SQL 注入式提问直接拒绝。
- 注册为只读 L1 工具 `xingyao_org_diagnosis`（scopes: mcn_staff），
  经 `runAiToolQuery` 全程留痕（ai_invocations / ai_tool_invocations / audit_logs）。
- `POST /api/ai/xingyao`：staff 权限门控 → 加载组织快照与校准权重 →
  确定性诊断 → `enrichAgentOutputWithLlm` 生成中文叙事（模型失败时
  回退确定性输出）→ 返回报告 + AgentOutput + 校验结果。
- 星耀聊天（`/api/ai/chat`）注入组织级诊断事实包（ROI 卡点 TOP +
  风险预警 TOP），对话模型只能引用带 source 的真实事实。

## 数据与安全

- 不新增数据库表：权重复用 `scoring_weights`，策略沉淀复用
  `knowledge_documents`，调用留痕复用 `ai_invocations`。
- 所有读取走 RLS 客户端，组织 ID 一律取自会话 auth，不接受调用方传入。
- 诊断输出经 `validateAgentOutput` 强校验：证据必须指向已有 fact、
  结论区禁止未溯源数字、建议必须人工确认、禁止可执行动作字段。

## 后续迭代

- 账号级流量 / 违规 / 直播时长留痕接入后，替换账号切片的中性代理值。
- 培训与测试模块落地后，替换 `auto_trust` / `clean_report_count` 代理。
- 增加定时 runner（沿用 `app/api/internal/*/run` 模式）做周期性
  风险扫描 + 预警推送，并把预测样本自动回流到学习闭环。
