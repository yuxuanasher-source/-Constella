# 结算链路价值强化计划（可解释 · 可追溯 · 低使用成本）

> 依据 2026-07-26 对「报数 → 审核 → 结算 → 导出」金额链路的代码审计，以及一次已验证可行后回退的持久化试写（settlement-engine / settlement-service / settlement-queries 三层测试全绿）。

**目标：** 让「每笔钱可解释、可追溯」从引擎层的设计变成用户屏幕上每个金额旁边真实存在的东西，同时不增加（并尽量降低）运营与审核人员的使用成本和学习成本。

**核心判断：** 本产品的价值断层是**引擎层已经算出了解释，展示与持久化层把它丢掉了**——遗留结算引擎算出 `breakdown` 后不入库；服务端映射好的 `ruleBreakdown` 被客户端适配器丢字段；审计日志字段完整但查询不支持按对象反查；导出金额由浏览器现算且服务端直接信任。因此本计划的主体不是新建能力，而是**把已建好的能力接通到生产路径**。

**体验总原则（每个任务都必须遵守）：** 结论先行、解释后置。默认只给结论和一行人话摘要，证据、公式、审计收在「想看才展开」的下一层；默认路径零额外输入、零新增交互范式。

**分支基点（重要）：** 工作分支 `codex/settlement-value-hardening` 必须基于 `codex/streamer-ai-match-recommendations`（当前实际主干，领先 `codex/full-project-ui` 523 个提交；阶梯时薪/罚扣引擎、自定义公式规则、预审引擎均只存在于该分支）。分支已建好并指向正确基点。

**技术栈：** Next.js App Router、React 19、TypeScript、Supabase/Postgres RLS、Vitest。

---

## 优先级依据

排序按「价值兑现的直接程度 × 改动面大小」，并遵守一条约束：**同时命中"价值强化"和"降低成本"两个目标的任务优先**。

| 层 | 内容 | 理由 |
|---|---|---|
| P0 | 金额可解释 + 导出可信 + 审计可反查 | 改动面小，直接兑现产品承诺 |
| P1 | 审核原因结构化 + 自动过审灰度 + 差异标记 | 价值与降本双命中 |
| P2 | 证据防篡改 + 规则模板 + 自定义规则执行灰度 | 依赖 P0/P1 打底 |

---

# P0：金额从黑盒变成可解释（第一梯队）

## 任务 1：遗留引擎 breakdown 持久化到 evidence_snapshot

**问题：** [settlement-engine.ts](../../features/settlements/settlement-engine.ts) 的 `calculateSettlementItem` 已算出 `breakdown`（`baseAmount` / `penaltyAmount` / `penalties[]` / `floorApplied` / `capApplied`），但 [settlement-service.ts:544](../../features/settlements/settlement-service.ts:544) 的 `buildLegacySettlementBatchPayload` 只持久化 `evidenceSnapshot`（仅 4 个字段），breakdown 算完即丢。生产批次的每笔金额因此无法解释、无法复算、无法举证。

**方案（试写已验证）：** 在引擎内把规则快照与拆解一起写进 `evidenceSnapshot.legacyEngine`，所有持久化路径自动带上；`settlement_batch_items.evidence_snapshot` 是 jsonb，**无需数据库迁移**。快照结构：

```ts
evidenceSnapshot: {
  liveReportId, settlementDuration, timeSource, evidenceLevel,   // 原有 4 字段不动，向后兼容
  legacyEngine: {
    rule: { settlementMethod, hourlyRate, baseSalary, hourlyTiers, floorAmount, capAmount },
    includeBaseSalary,
    breakdown: { baseAmount, penaltyAmount, penalties, floorApplied, capApplied, computedAmount },
  },
}
```

**文件：**
- 修改：`features/settlements/settlement-engine.ts`（新增 `SettlementLegacyEngineSnapshot` 类型；`calculateSettlementItem` 组装快照）
- 修改：`features/settlements/settlement-engine.test.ts`（原 `evidenceSnapshot` 的 `toEqual` 改 `toMatchObject`；新增快照断言用例）
- 修改：`features/settlements/settlement-service.test.ts`（批次生成用例断言 items 携带 `legacyEngine`）

- [ ] **步骤 1：** 引擎新增类型与快照组装，保留原 4 字段不变。
- [ ] **步骤 2：** 更新引擎测试（含一条"黄证据 + 底薪 + 扣罚"的完整快照断言）。
- [ ] **步骤 3：** 服务层测试断言 `createSettlementBatchAtomic` 收到的 items 携带 `legacyEngine.rule` 与 `legacyEngine.breakdown`。

**验收：** 新生成批次的 `settlement_batch_items.evidence_snapshot` 含完整规则快照与拆解；旧数据（无 `legacyEngine`）不受影响。

---

## 任务 2：金额解释进结算详情页（复用现有「规则拆解」UI，零新增交互）

**问题 A：** 遗留路径在 UI 上没有任何「这笔钱怎么算的」入口——因为数据本来就没入库（任务 1 解决）。
**问题 B（存量 bug，试写时发现并验证）：** 服务端 [settlement-queries.ts:516](../../features/settlements/settlement-queries.ts:516) 已把自定义规则快照映射成 `ruleBreakdown`，但经营端客户端适配器 `toReferenceBatchDetailFromApi`（[ops-reference.jsx:19473](../../components/reference-ui/ops-reference.jsx:19473)）没有透传 `ruleBreakdown` / `openExceptions`，且兜底数据 `BATCH_DETAIL_ITEMS = []`（L1393）——**「规则拆解」区块对 API 数据从来没渲染过**。

**方案（试写已验证）：** 把 `evidence_snapshot.legacyEngine` 映射成与自定义规则**同构**的 `OpsSettlementRuleBreakdown`，现有「规则拆解」区块零改动复用；同时修客户端适配器丢字段的 bug。映射要点：

- `mode: "legacy"`、`executionGrain: "单条报数"`、`sourceReportCount: 1`、`missingDataDecisions: []`
- `appliedVersionLabels: ["固定规则 · <结算方式中文名>"]`（时长计费 / 底薪 / 底薪 + 时长计费 / CPS 抽成 / CPA / 礼物流水 / 人工结算）
- `components`：基础金额、扣罚合计（负数）、最终金额（元 → 分，`Math.round(x*100)`，UI 用 `formatYuanFromCents`）
- `explanationZh`：确定性生成的一句人话，覆盖以下分支——
  - 绿证据 + 系统计时：`系统计时 390 分钟（约 6.5 小时）× 时薪 ¥80/小时`；有阶梯则 `按 N 档阶梯时薪计费`
  - 非绿或非系统：`时长证据为黄色、来源为截图计时，时长计费部分按规则记 ¥0（仅绿色证据 + 系统计时可计费）` ——直接回答用户最高频的疑问「为什么这笔是 0」
  - 底薪：`计入底薪 ¥200（每批次仅计一次）` / `底薪已在本批次其他条目计入，本条不重复计`
  - cpa/cps/gift/manual：`该结算方式的金额由人工录入承载，系统计算部分为 ¥0`
  - 扣罚逐条：`触发「黄证据扣罚」，扣 ¥50`；保底/封顶命中时说明
  - 收尾：`最终系统金额 ¥470`

**文件：**
- 修改：`features/settlements/settlement-queries.ts`（`toOpsSettlementRuleBreakdown` 无 `ruleEngine` 时回退 `toLegacyRuleBreakdown`；新增解释生成器与中文标签函数）
- 修改：`features/settlements/settlement-queries.test.ts`（两条用例：完整拆解映射精确断言、非绿证据零计费解释断言）
- 修改：`components/reference-ui/ops-reference.jsx`（`toReferenceBatchDetailFromApi` 透传 `ruleBreakdown` / `openExceptions` / `evidenceLevel`）

- [ ] **步骤 1：** 查询层新增 `toLegacyRuleBreakdown` + `buildLegacyRuleExplanation`（纯函数，含精确字符串断言的测试）。
- [ ] **步骤 2：** 修 jsx 适配器丢字段 bug（此修复同时让自定义规则路径的拆解首次在 API 数据上可见）。
- [ ] **步骤 3：** 手动验收：生成一个遗留批次，结算详情页出现「规则拆解」，默认收敛、不加宽明细表。

**验收：** `pnpm vitest run features/settlements` 全绿；结算详情页每条 live_report 明细能展开看到人话解释；明细表 8 列布局不变。

---

## 任务 3：导出改为服务端取数（交互不变，数字保证一致）

**问题：** [app/api/exports/route.ts](../../app/api/exports/route.ts) 与 xlsx 路由的行数据完全由客户端 `body.rows` 提交；[ops-reference.jsx:14882](../../components/reference-ui/ops-reference.jsx) 附近的达人费是浏览器里 `时长 × 项目默认时薪` 现算的，不读 `settlement_batch_items.computed_amount`。对外发出的结算单可能与库内金额不一致，且任何有导出权限的人可提交任意金额行拿到一份带真实截图的"官方"xlsx；导出审计只记 `rowCount` 不记内容。

- [ ] **步骤 1：** 结算相关导出（`settlement_batch`、`report_settlement_details`、报数明细 xlsx）改为服务端按 `batchId`/`reportIds` 从库取数重建行，客户端只传 id 与筛选条件；字段白名单与角色门控逻辑保留。
- [ ] **步骤 2：** `settlement_batch` 导出补列：规则版本/结算方式标签（来自任务 1 快照）、证据等级、差异标记；金额列一律来自 `computed_amount`/`manual_amount`/`adjustment_amount`。
- [ ] **步骤 3：** 删除浏览器现算 `talentFee` 的路径；导出审计记录导出参数（batchId、周期、行数、字段集）。
- [ ] **步骤 4：** 客户端导出交互完全不变（这是降使用成本项：用户不再需要导出后人工核对金额）。

**验收：** 同一批次页面合计与导出合计逐分一致；提交伪造 `body.rows` 不再影响导出内容。

---

## 任务 4：审计按对象反查

**问题：** [audit-center-queries.ts](../../features/audit-center/audit-center-queries.ts) 的 `AuditCenterFilters` 只有 `module/action/projectId/highRiskOnly/limit`（上限 100），无 `objectId/objectType`；[app/api/audit-logs/route.ts](../../app/api/audit-logs/route.ts) 不透传；UI 只能对 `?limit=50` 窗口做客户端过滤，还用 `objectName === b.name` 模糊兜底（[ops-reference.jsx:22348](../../components/reference-ui/ops-reference.jsx:22348)）。「这笔结算历史上被谁改过」超过 50 条就答不出来。

- [ ] **步骤 1：** 查询层与 API 增加 `objectId`/`objectType` 过滤参数（audit_logs 已有相应列，确认索引，缺则补 `(organization_id, object_type, object_id, created_at desc)` 迁移）。
- [ ] **步骤 2：** 结算详情「刷新审计明细」改为 `?objectType=settlement_batch&objectId=<batchId>` 精确反查全历史，删除 `objectName` 模糊兜底。
- [ ] **步骤 3：** 审计中心保持现有界面，仅新增按对象搜索入口（不重排现有 tab，学习成本为零）。

**验收：** 对一个有 50+ 条审计记录的批次，详情页能看到完整历史；查询命中索引。

---

# P1：价值与降本双命中（第二梯队）

## 任务 5：审核驳回原因标签化（默认零输入，产出结构化原因）

**问题：** 预审引擎的 `failedGates[]`（约 15 个具名卡点门）已落库 `report_pre_review_results`，但报数审核页不展示；驳回按钮无原因输入，UI 硬编码 `reviewNotes: "经营端页面审核"`（[ops-reference.jsx](../../components/reference-ui/ops-reference.jsx) `ReportDetail` 操作条）；批量通过循环调 approve，无原因、无预审门槛检查。审核意见在流向结算的路上丢光，主播端收到驳回也不知道为什么。

- [ ] **步骤 1：** 报数审核详情展示该报数命中的 `failedGates`（中文标签，如「截图缺失」「时长偏差过大」），放在现有风控提示区，不新增区块。
- [ ] **步骤 2：** 驳回/需补充截图时把命中门渲染成**预选标签**，审核员确认即提交（默认路径零输入），可选补充文本；`reviewNotes` 携带结构化原因。
- [ ] **步骤 3：** 批量通过前置预审门槛检查：绿证据且全门通过的才可批量过，其余项列出原因留给逐条处理。
- [ ] **步骤 4：** 主播端驳回通知带上具体原因标签（减少「为什么驳我」的群聊往返）。

**验收：** 驳回记录的 `reviewNotes` 不再出现硬编码文案；批量通过不会放过有卡点门的报数。

## 任务 6：启用 auto-review 灰度（削减最高频人工动作）

**现状：** [features/auto-review](../../features/auto-review) 的 shadow → active 灰度框架（rollout-gates + metrics）已建好但未启用。审核是全产品频次最高的人工动作。

- [ ] **步骤 1：** 先跑 shadow 模式收集与人工决策的一致率指标（框架已支持）。
- [ ] **步骤 2：** 一致率达标后对「绿证据 + 全门通过」开 active：自动过审并写审计（actor 标记为系统，决策来自确定性引擎）。
- [ ] **步骤 3：** 审核队列默认视图改为只显示需要人的项（黄红/卡点），自动过审项收进可展开的分组。

**验收：** 绿色快车道报数无需人工点击即入结算池；审核队列默认长度显著下降；每条自动决策可在审计中反查。

## 任务 7：差异标记贯穿到结算单（只在有差异时出现）

**问题：** `generateSettlementBatch` 筛选只看 `status === "approved"`，不看异常/riskFlags/evidenceLevel；结算明细 8 列无任何差异列；anomaly-scanner 只发通知不落表。

- [ ] **步骤 1：** 明细行携带 `evidenceLevel`/`riskFlags`（任务 2 已透传 evidenceLevel），黄红行显示一个小标记，绿行界面与现在完全一致（学习成本为零）。
- [ ] **步骤 2：** 批次顶部一行汇总：「32 项中 3 项证据存在差异，建议复核」，点击筛出差异行。
- [ ] **步骤 3：** 确认/锁定批次时若存在红证据行，要求填写确认理由（写入审计 reason，高风险标记）。

**验收：** 无差异批次的界面与现状零差别；有差异批次一眼可见差异项并可下钻到解释（任务 2）。

---

# P2：证明力与规模化（第三梯队）

## 任务 8：截图内容哈希服务端重算

**问题：** `report_screenshots.file_hash` 由客户端拼字符串（`manual-${id}-${Date.now()}-...`，[streamer-mobile-reference.jsx:6506](../../components/reference-ui/streamer-mobile-reference.jsx)），非内容哈希；`unique(organization_id, file_hash)` 因带时间戳形同虚设；全项目对截图无一处 `createHash`。对外举证不具证明力。

- [ ] 上传落库后服务端对文件算 SHA-256 回写 `file_hash`；展示「上传时间 + 内容指纹」；重复内容检测恢复生效；存量数据补算脚本另行评估。

## 任务 9：结算规则模板 + AI 解释入口（降学习成本主项）

- [ ] 预置 3–5 个行业模板（纯 CPT / 底薪+阶梯 / 底薪+CPS 抽成），用户从模板改参数而非从零建规则。
- [ ] 金额/状态/卡点旁提供「这是什么意思」即时解释入口，用业务语言回答（数据全部来自 P0/P1 的副产品：evidenceLevel、failedGates、breakdown）。

## 任务 10：自定义公式规则执行开关灰度（前置条件：P0 全部完成）

**现状：** 后端 Phase 1–4 代码、26 个 API 路由、迁移与测试全在，`CUSTOM_SETTLEMENT_RULE_EXECUTION_ENABLED=false` 关闭执行；四份 plan 文档 checkbox 未回勾。

- [ ] 在 P0 把遗留路径修实、任务 9 模板就绪后，按原 Phase 3 灰度计划开执行；开关打开前先回勾核对四份计划文档的实际完成状态。

---

## 不做清单（本计划明确排除）

- 不重构 35857 行的 `ops-reference.jsx`（但结算详情、报数审核两个高频区块的改动应尽量以独立组件形式落地，为将来拆分留缝）。
- 不新建统一财务批次中心（`features/finance-batches` 空目录、计划 0/51——另立计划）。
- 不给录屏补报数外键（`recording_assets` 与 `live_report_id` 关联属证据链扩展，另立计划）。
- 不改结算明细表的 8 列布局、不新增交互范式。
