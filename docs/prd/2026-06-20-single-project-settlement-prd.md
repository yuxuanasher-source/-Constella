# 直播项目单项目结算体系 · 产品需求文档（PRD）

| 项 | 内容 |
|---|---|
| 文档名称 | 直播项目「单项目结算体系」产品需求文档 |
| 版本 | v1.0 |
| 状态 | 评审稿（可用于研发排期） |
| 关联模块 | 项目管理 / 直播任务 / 结算中心 / 成本看板 / 计费与权限 / 审计中心 |
| 计量约定 | **金额一律以「分(cents)」存储**（`bigint`）；**税率/比例一律以「基点(bps)」存储**（0–10000，10000=100%）；展示层做分↔元、bps↔% 转换 |
| 编写日期 | 2026-06-20 |

> 说明：本文严格对齐当前代码已落地的实体与字段（`settlement_batches`/`settlement_batch_items`、`projects` 财务字段、`project_cost_items`、结算引擎 `settlement-engine.ts`、`calculateProjectFinancials`、角色 `roles.ts`、计费 entitlement 门）。每个功能均标注 **【复用】/【增强】/【新增】**，便于排期估点。

---

## 1. 需求背景与业务目标

### 1.1 业务现状与问题

当前「项目管理 → 直播任务 → 结算中心」链路中，结算能力**只覆盖成本侧、缺收入侧、缺全维度校验**：

| 维度 | 现状 | 问题 |
|---|---|---|
| 成本侧（应付主播） | 已有「单项目·单主播」应付结算规则（CPT/底薪/CPA/CPS/打赏/阶梯/封顶/罚扣），有编辑入口 | 基本可用 |
| 收入侧（应收客户/厂商） | 仅有项目级应收规则的**数据通道**（`getProjectSettlementRule`），**无配置入口、无结构化「应收单价」**，应收批次常因无规则回落到 `manual` → 计算结果为 ¥0 | **收入端无法配置**，单项目收入算不出来 |
| 税费侧 | 已有项目财务字段（开票标记、销项税率、附加税率、采购成本）与核算函数，但**无产品化配置页与开票金额口径** | 税费不可视、不可控 |
| 其他外部成本 | 已有 `project_cost_items` 归集表（供应商费/流量/平台费/赠品/样品等），录入入口不完整 | 外部成本归集不齐 |
| 结算校验 | 结算批次各自独立（应收批次、应付批次），**无单项目层面的「收入−成本−税费」对账** | 无法判断单项目盈亏是否成立、是否可结 |

**根因**：结算中心以「批次」为最小单位独立运转，缺少**项目级的收入端配置**与**项目级的三维（收入/成本/税费）合并对账**，导致无法回答「**这个项目到底赚不赚钱、能不能结、差额来自哪里**」。

### 1.2 业务目标

1. **补齐收入端**：让运营/财务在项目维度配置「应收单价」（计费方式、单价/阶梯、底薪、CPA/CPS 比例、保底/封顶），驱动应收批次自动算账。
2. **税费可控**：开票标记 → 自动核算销项增值税、附加税，并给出**开票金额（含税）/不含税金额**口径。
3. **外部成本归集**：把供应商、流量、平台、赠品、样品、罚扣等非主播成本统一录入并归集到项目。
4. **单项目结算校验**：在项目维度合并「应收（收入）− 应付/外部成本（成本）− 税费」，输出**毛利、毛利率、可结判定、差异明细**，校验通过方可锁定结算。
5. **可治理**：全程沿用证据等级（绿/黄/红）、高风险审计、计费 entitlement 门、append-only 审计。

### 1.3 范围

| 范围内（In Scope） | 范围外（Out of Scope，本期不做） |
|---|---|
| 单项目应收单价配置 | 跨项目/客户合并对账、合并开票 |
| 销项增值税 / 附加税自动核算 + 开票金额计算 | 进项税抵扣链路、税局直连开票 |
| 其他外部成本录入与归集 | 应收回款/应付付款的银行流水核销 |
| 单项目结算校验（收入/成本/税费三维） | 多币种、汇率折算 |
| 权限矩阵、异常场景、审计 | 自动生成会计凭证、对接 ERP/金蝶 |

### 1.4 术语

- **应收（receivable）**：MCN 向**客户/厂商**收取的收入侧金额。
- **应付（payable）**：MCN 向**主播**支付的成本侧金额。
- **证据等级**：`green`（系统直采，可全额计 CPT）/`yellow`（截图等弱证据，触发罚扣）/`red`（自报/缺证，CPT 不计、触发罚扣）。
- **结算池**：状态为 `approved` 且未被对应类型批次结算的直播报告集合。
- **bps**：基点，500 bps = 5%。

---

## 2. 核心业务流程

### 2.1 全链路总览：项目管理 → 直播任务 → 结算中心

```
┌─────────────── 项目管理 ───────────────┐
│ 建项目                                 │
│  ├─【新增】应收单价配置（收入端规则）   │
│  ├─【增强】税费配置（开票/销项/附加/采购）│
│  ├─【复用】单主播应付规则（成本端规则）  │
│  └─【增强】其他外部成本录入             │
└───────────────┬───────────────────────┘
                │ 派发直播任务
                ▼
┌─────────────── 直播任务 ───────────────┐
│ 主播执行 → 提交直播报告(live_reports)   │
│  → OCR/系统采集时长 → 证据定级(绿/黄/红) │
│  → 业务/运营审核 → status = approved    │
└───────────────┬───────────────────────┘
                │ 进入「结算池」(未结算的 approved 报告)
                ▼
┌─────────────── 结算中心 ───────────────┐
│ ① 生成【应收批次】= Σ(报告 × 应收单价规则)│
│ ② 生成【应付批次】= Σ(报告 × 应付规则)   │
│ ③ 归集【其他外部成本】(project_cost_items)│
│ ④ 核算【税费】(开票→销项→附加)          │
│ ⑤【新增】单项目结算校验:                 │
│     收入 − 成本 − 税费 = 毛利 / 毛利率   │
│     → 校验通过 → 批次可 confirmed → lock │
│     → 不通过 → 标记差异、阻断锁定         │
└────────────────────────────────────────┘
```

### 2.2 直播报告 → 结算的状态流转（复用现状）

- 直播报告：`draft → submitted → reviewing → approved`（仅 `approved` 进结算池）。
- 结算批次状态机（`settlement_batches.status`）：
  `draft → generated → pending → confirmed → locked → (reopened) → (voided)`
  - `generated`：按规则算出、原子落库（`generate_settlement_batch` RPC，单事务）。
  - `confirmed`：**通过单项目结算校验**后方可流转（本期新增校验为前置条件）。
  - `locked`：财务锁定，需理由 + 高风险审计；仅 owner/ops_manager。
  - `reopened`：仅 owner，需理由。
- 一条已结算报告通过 `settled_batch_item_id` + `settledBatchTypes` 防重复结算（应收、应付各结一次）。

### 2.3 三条数据线如何汇入「单项目结算校验」

| 线 | 数据来源 | 汇入口径 |
|---|---|---|
| 收入线 | 应收批次 `settlement_batches(batch_type='receivable')` 合计 | 项目期内**应收总额（不含税）** |
| 成本线 | 应付批次（主播）+ `project_cost_items`（direction=`cost`）− `revenue_offset` | 项目期内**总成本** |
| 税费线 | `projects` 财务字段 → `calculateProjectFinancials` | **销项增值税 + 附加税 + 采购成本** |

→ 合并为单项目损益与可结判定（见 §3.4）。

---

## 3. 功能详情

### 3.1 单项目「应收单价」配置（收入端）  **【新增】**

#### 3.1.1 功能描述
在项目维度配置 MCN 向客户/厂商收取的计价规则，结构**对称复用**应付规则引擎（`SettlementRule`），但作用域为**项目级**（一个项目一套应收规则），用于生成应收批次。

#### 3.1.2 入口
项目详情 → 「结算设置」Tab → 「应收单价规则（我们的收入）」分区。与既有「主播应付规则」并列。

#### 3.1.3 配置项（复用 `SettlementRule` 字段语义）

| 配置项 | 字段 | 说明 |
|---|---|---|
| 计费方式 | `settlement_method` | `cpt`（按时长）/`base_salary_cpt`（底薪+时长）/`cpa`/`cps`（按销额比例）/`gift`/`manual` |
| 应收时薪 | `hourly_rate`（分/小时） | CPT 单价；可被阶梯覆盖 |
| 阶梯单价 | `hourly_tiers[]`（`upto_minutes`,`rate_per_hour`） | 分段计价，开放顶档 `upto_minutes=null` |
| 应收底薪 | `base_salary`（分） | **项目级：整批次只计一次**（已在引擎实现 `receivableBaseSalaryApplied`） |
| CPS 比例 | `cps_rate_bps` | 按销额 × bps |
| 保底 / 封顶 | `floor_amount`/`cap_amount`（分） | 计算后下/上限钳制 |
| 罚扣规则 | `penalties[]`（trigger: `red_evidence`/`yellow_evidence`/`non_system_time`；mode: `fixed`/`percent`） | 收入端一般不配，保留能力 |

#### 3.1.4 计算口径（沿用 `calculateSettlementItem`）
- **CPT 仅在 `evidence_level=green` 且 `time_source=system` 时计费**；否则该报告 CPT=0。
- 单报告应收 = `clamp( max(0, 基础额 − 罚扣), floor, cap )`，基础额 = 底薪(整批一次) + 时长×单价(或阶梯)。
- 应收批次 `computed_amount` = Σ 各报告应收（`generate_settlement_batch` 原子生成）。

#### 3.1.5 交互与校验
- 保存为高风险操作：**必须填写变更理由**，写审计（`module=settlement, object_type=project_settlement_rule, is_high_risk=true`）。
- 校验：`hourly_rate/base_salary/floor/cap ≥ 0`；`cps_rate_bps ∈ [0,10000]`；阶梯 `upto_minutes` 升序、金额 ≥ 0；`method=cps` 时必须填 `cps_rate_bps`。
- 无应收规则时，应收批次按 `manual=0` 回落并**在校验页明确提示「项目未配置应收单价」**（替代当前静默出 ¥0）。

---

### 3.2 增值税、附加税自动核算与开票金额计算  **【增强】**

#### 3.2.1 功能描述
基于项目「是否开票 + 销项税率 + 附加税率 + 采购成本」自动核算税费，并产出**含税/不含税/开票金额**三个口径。复用 `calculateProjectFinancials`，本期产品化配置页 + 校验口径。

#### 3.2.2 配置项（复用 `projects` 已有字段）

| 配置项 | 字段 | 单位/约束 |
|---|---|---|
| 是否开票 | `is_invoiced` | bool；**为 false 时销项税=0** |
| 销项增值税率 | `output_vat_rate_bps` | bps，0–10000（如 6% 专票=600） |
| 附加税率 | `surtax_rate_bps` | bps，0–10000（城建+教育+地方教育，合计如 12%=1200） |
| 采购成本 | `procurement_cost_cents` | 分，≥0（计入成本而非税） |

#### 3.2.3 计算公式（与引擎一致）

设应收总额（不含税口径）为 `R`（= 应收批次 computed 合计）：

```
销项增值税 output_vat = is_invoiced ? round(R × output_vat_rate_bps / 10000) : 0
附加税     surtax     = round(output_vat × surtax_rate_bps / 10000)   // 以增值税额为计税基数
税费合计   tax_total  = output_vat + surtax
开票金额(含税) invoice_amount = R + output_vat        // 给客户开票的票面金额
项目财务附加成本 totalFinancialCost = output_vat + surtax + procurement_cost
```

> 口径约定：系统内 `R` 与应付、外部成本均按**不含税**记账；销项税单列；附加税以增值税额为基数（符合中国现行口径）。

#### 3.2.4 交互与校验
- 开票开关切换、税率修改为高风险操作，写审计。
- 校验：两个税率 `∈ [0,10000]`；`procurement ≥ 0`；`is_invoiced=false` 时税率字段置灰但保留值。
- 结算校验页展示「不含税应收 / 销项税 / 附加税 / 开票金额（含税）」四行。

---

### 3.3 项目其他外部成本录入与归集  **【增强】**

#### 3.3.1 功能描述
统一录入主播应付**之外**的项目成本（供应商、流量、平台抽成、赠品、样品、罚扣、手工调整等），归集进 `project_cost_items`，供单项目结算校验汇总。

#### 3.3.2 录入方式
1. **手工单笔录入**：选成本类型、金额、方向、证据等级、理由、（可选）关联主播/供应商/直播报告。
2. **批量导入**（`project_cost_import_batches`）：CPA/CPS/赠品/流量/供应商账单 CSV → 解析 `parsed_payload` → 复核 → 确认入账。导入解析需做 **CSV 公式注入中和**（已在导出侧实现，导入侧复用同规则）。

#### 3.3.3 字段（复用 `project_cost_items`）

| 字段 | 取值 | 说明 |
|---|---|---|
| `item_type` | cpa/cps/gift/bonus/penalty/supplier_fee/traffic/platform_fee/sample/replay/tax/manual | 成本类型 |
| `direction` | `cost`（增加成本）/`revenue_offset`（冲减收入）/`adjustment`（调整） | 决定汇总符号 |
| `amount_cents` | 分，≥0 | 金额 |
| `evidence_level` | green/yellow/red | 证据等级 |
| `source` | system/import/manual | 来源 |
| `status` | draft/pending_review/confirmed/voided | **仅 `confirmed` 计入结算校验** |
| `reason` | 文本（必填） | 入账理由，进审计 |

#### 3.3.4 归集规则
- 进入单项目校验的外部成本 = Σ `confirmed` 且 `direction=cost` 的 `amount_cents` − Σ `direction=revenue_offset`。
- `direction=adjustment` 计入「人工调整」单列，不混入自动成本。
- `draft/pending_review/voided` 不计入，但在明细中可见（灰显）。

---

### 3.4 单项目结算校验（收入、成本、税费全维度核对）  **【新增 · 本期核心】**

#### 3.4.1 功能描述
在项目 + 结算周期维度，把三条线合并成一张**单项目结算对账单**，输出损益与「可结判定」，作为应收/应付批次从 `generated → confirmed/locked` 的**前置闸门**。

#### 3.4.2 对账模型

```
A. 收入
   应收(不含税)  R   = Σ 应收批次.computed_amount (period)
B. 成本
   主播应付      P   = Σ 应付批次.(computed+manual+adjustment) (period)
   外部成本      C   = Σ project_cost_items(confirmed, cost) − Σ(revenue_offset)
   采购成本      M   = projects.procurement_cost_cents
   成本合计      COST = P + C + M
C. 税费
   销项增值税    VAT = is_invoiced ? round(R × vat_bps/10000) : 0
   附加税        SUR = round(VAT × surtax_bps/10000)
   税费合计      TAX = VAT + SUR
D. 损益
   毛利          GM   = R − COST − TAX
   毛利率        GM_RATE_bps = R>0 ? round(GM/R × 10000) : 0
   人工调整      ADJ  = Σ project_cost_items(adjustment)   // 单列展示
```

#### 3.4.3 校验规则（可结判定）

| 校验项 | 规则 | 不通过处理 |
|---|---|---|
| 收入端已配置 | 项目存在有效应收规则，且 `R>0` 或已显式标注「本期无应收」 | **阻断**确认，提示配置应收单价 |
| 池一致性 | 应收/应付批次覆盖的 `approved` 报告集合一致，无遗漏/越期 | **告警**，列出差异报告 |
| 证据红线 | 含 `red` 证据的报告金额不计入自动收入；红/黄占比超阈值（默认 red>0 或 yellow 占比>20%） | **告警**，需理由放行 |
| 税费完整性 | `is_invoiced=true` 时税率必须>0 | **阻断**确认 |
| 毛利红线 | `GM < 0`（亏损）或 `GM_RATE < 阈值`（默认 0） | **阻断**锁定，需 owner 填理由强制放行（高风险审计） |
| 重复结算 | 不存在同一报告在同类型批次重复结算 | **阻断**（DB 唯一约束兜底） |

- 校验全部通过 → 允许批次 `confirmed`，并允许 owner/ops_manager `lock`。
- 任一**阻断**项未解决 → 锁定按钮禁用；**告警**项可由 owner 填理由放行（写高风险审计 `is_high_risk=true`）。

#### 3.4.4 输出与展示
- 单项目结算对账单：收入/成本/税费三块 + 损益汇总 + 差异清单 + 证据分布（绿/黄/红计数，复用 `summarizeEvidence`）。
- 支持导出 CSV（复用 `createGovernedExport`，按角色字段白名单 + 公式注入中和；财务可见全字段，业务运营隐藏内部风险/毛利明细）。

---

## 4. 核心数据字段清单

> 命名遵循库内既有风格：金额 `*_cents`(bigint)、比例 `*_bps`(int)、ID 为 `uuid`、`organization_id` 多租户隔离、RLS 生效。

### 4.1 收入类

| 字段 | 表 | 类型/单位 | 含义 | 状态 |
|---|---|---|---|---|
| `settlement_method` | 项目应收规则 | enum | 应收计费方式 | 新增配置项 |
| `hourly_rate` | 项目应收规则 | bigint·分/时 | 应收时薪/CPT 单价 | 新增 |
| `hourly_tiers` | 项目应收规则 | jsonb | 阶梯单价 | 新增 |
| `base_salary` | 项目应收规则 | bigint·分 | 应收底薪（整批一次） | 新增 |
| `cps_rate_bps` | 项目应收规则 | int·bps | CPS 应收比例 | 新增 |
| `floor_amount`/`cap_amount` | 项目应收规则 | bigint·分 | 保底/封顶 | 新增 |
| `batch_type='receivable'` | `settlement_batches` | enum | 应收批次标识 | 复用 |
| `computed_amount` | `settlement_batches` | bigint·分 | 应收自动计算合计（不含税 R） | 复用 |
| `manual_amount`/`adjustment_amount` | `settlement_batches` | bigint·分 | 人工/调整应收 | 复用 |

### 4.2 成本类

| 字段 | 表 | 类型/单位 | 含义 | 状态 |
|---|---|---|---|---|
| 主播应付规则（同 `SettlementRule` 全字段） | 项目·主播应付规则 | — | 应付计费规则 | 复用（#44/#49 已上线编辑） |
| `batch_type='payable'`.`computed/manual/adjustment` | `settlement_batches` | bigint·分 | 主播应付合计 P | 复用 |
| `item_type` | `project_cost_items` | enum | 外部成本类型 | 复用 |
| `direction` | `project_cost_items` | enum(cost/revenue_offset/adjustment) | 成本方向 | 复用 |
| `amount_cents` | `project_cost_items` | bigint·分 | 外部成本金额 | 复用 |
| `status` | `project_cost_items` | enum | 仅 confirmed 入账 | 复用 |
| `procurement_cost_cents` | `projects` | bigint·分 | 采购成本 M | 复用 |
| `evidence_level` | `project_cost_items`/报告 | enum(green/yellow/red) | 证据等级 | 复用 |

### 4.3 税费类

| 字段 | 表 | 类型/单位 | 含义 | 状态 |
|---|---|---|---|---|
| `is_invoiced` | `projects` | bool | 是否开票（税基开关） | 复用 |
| `output_vat_rate_bps` | `projects` | int·bps | 销项增值税率 | 复用 |
| `surtax_rate_bps` | `projects` | int·bps | 附加税率（以 VAT 为基数） | 复用 |
| `output_vat_cents`（计算态） | 校验结果 | bigint·分 | 销项增值税额 | 复用计算 |
| `surtax_cents`（计算态） | 校验结果 | bigint·分 | 附加税额 | 复用计算 |
| `tax_total_cents`（计算态） | 校验结果 | bigint·分 | 税费合计 | 新增聚合 |
| `invoice_amount_cents`（计算态） | 校验结果 | bigint·分 | 开票金额（含税）= R + VAT | **新增口径** |
| `gross_margin_cents`/`margin_rate_bps`（计算态） | 校验结果 | bigint·分 / bps | 毛利 / 毛利率 | 复用看板口径 |

---

## 5. 权限配置与异常场景

### 5.1 权限矩阵（角色见 `roles.ts`：owner / ops_manager / operator_business / finance / streamer）

| 操作 | owner | ops_manager | operator_business | finance | streamer |
|---|:-:|:-:|:-:|:-:|:-:|
| 配置应收单价规则（3.1） | ✅ | ✅ | ❌ | ❌ | ❌ |
| 配置税费（3.2） | ✅ | ✅ | ❌ | 查看 | ❌ |
| 录入/导入外部成本（3.3） | ✅ | ✅ | ✅ | ✅ | ❌ |
| 确认外部成本入账（confirmed） | ✅ | ✅ | ❌ | ✅ | ❌ |
| 生成应收/应付批次 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 运行单项目结算校验（3.4，只读） | ✅ | ✅ | ✅ | ✅ | ❌ |
| 确认批次 `confirmed`（需校验通过） | ✅ | ✅ | ✅ | ❌ | ❌ |
| 锁定批次 `lock` | ✅ | ✅ | ❌ | ❌ | ❌ |
| 强制放行毛利/证据告警 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 重开批次 `reopen` | ✅ | ❌ | ❌ | ❌ | ❌ |
| 导出对账单 | ✅ | ✅ | 字段受限 | ✅ | ❌ |

> 与既有实现一致：`assertCanManageSettlement`=owner/ops_manager/operator_business；`lock`=owner/ops_manager；`reopen`=owner。主播（streamer）仅能看与自己相关的应付结果，看不到收入/毛利。

### 5.2 计费 / Entitlement 门
- 配置应收单价、生成批次、运行结算校验均受 `settlement` entitlement 约束（计费门 `billing-gates.ts`）。
- 默认套餐（pro，trialing）已自动开通 settlement，避免「Current plan is not entitled to settlement」误拦截（已修复）。

### 5.3 异常场景

| 场景 | 期望行为 |
|---|---|
| 项目未配置应收单价就生成应收批次 | 批次按 manual=0 生成，但**校验阻断确认**，提示「请配置应收单价」（不再静默 ¥0） |
| 应收批次与应付批次报告集合不一致 | 校验**告警**，列差异报告，owner 可填理由放行 |
| 含 red 证据 / 黄证据占比超阈值 | CPT 不计 + 罚扣触发；校验告警，需理由放行 |
| `is_invoiced=true` 但税率为 0 | 校验**阻断**，提示补税率 |
| 毛利为负或低于阈值 | **阻断锁定**，仅 owner 可强制放行（高风险审计 + owner 通知） |
| 同一报告重复进入同类型批次 | 阻断；DB 唯一约束（`settlement_batch_items`）兜底，原子事务回滚 |
| 批次生成中途失败 | `generate_settlement_batch` 单事务整体回滚，绝不产生「半截批次」 |
| 非法 `projectId`（非 UUID） | 路由返回 400（非 500），错误信息透出 |
| 任何收入/税费/锁定/放行变更 | 写 `audit_logs`，append-only、禁 TRUNCATE、`actor_user_id` 强制=操作人；金额变更类标 `is_high_risk` 并要求理由 |

---

## 6. 验收标准（摘要）

1. 项目可配置应收单价并成功生成 `R>0` 的应收批次；无规则时校验阻断并提示。
2. 开票开关 + 税率可正确产出销项税、附加税、开票金额（与 §3.2.3 公式一致，分/ bps 边界正确）。
3. 外部成本手工 + 导入两路均可归集，仅 confirmed 入账。
4. 单项目对账单输出 R / COST / TAX / GM / GM_Rate / 证据分布 / 差异清单，校验闸门按 §3.4.3 生效。
5. 权限矩阵、计费门、审计（append-only/防删/actor 强制/高风险理由）全部生效。
6. 全链路金额以分、比例以 bps，无浮点漂移；批次生成原子。

## 7. 研发排期建议（分期）

| 期 | 内容 | 依赖 | 估点 |
|---|---|---|---|
| P0 | 应收单价规则表 + 配置入口 + 应收批次接入（3.1） | 复用结算引擎 | 中 |
| P0 | 税费配置页 + 开票金额口径（3.2） | 复用 `calculateProjectFinancials` | 小 |
| P1 | 外部成本录入/导入闭环（3.3） | 复用 `project_cost_items` + 导入解析 | 中 |
| P1 | 单项目结算校验对账单 + 闸门（3.4） | 依赖 P0/P1 数据 | 大 |
| P2 | 对账单导出 + 权限字段白名单 + 埋点 | 复用 `createGovernedExport` | 小 |

---

*本 PRD 字段与状态机均对齐当前 `codex/full-project-ui` 分支已落地实现，标注「复用」项无需重复开发，「新增/增强」项为本期主要工作量。*
