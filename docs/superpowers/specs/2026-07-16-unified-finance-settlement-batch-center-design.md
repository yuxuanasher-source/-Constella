# Unified Finance Settlement Batch Center Design

## Goal

把现有以项目为第一维度的结算流程升级为统一的「财务结算中心」。财务先创建批次，再选择本批次要处理的对象；项目不再限制批次范围，而是成为批次明细里的归因维度。

第一版统一承载四类财务动作：

- 客户应收
- 主播应付
- 项目成本
- 协作分账

每个财务批次只处理一种类型，但所有类型共用批次列表、创建流程、状态流、导出、审计、异常处理和项目归因汇总。

## Current Context

现有结算链路已经具备不少基础能力，但核心模型仍偏项目优先：

- `POST /api/settlement-batches` 创建批次时要求传入 `projectId`。
- `generateSettlementBatch` 先按 `projectId + batchType + period` 读取结算池，再生成批次。
- `settlement_batches` 和 `settlement_batch_items` 都保留 `project_id`，现有批次天然对应单项目。
- 结算池查询已经能在 ops 查询层支持不传 `projectId` 的组织级读取，但服务层生成批次仍要求单项目。
- 项目详情页会展示项目结算规则、结算明细和跳转结算中心入口。
- 复杂成本、应收/应付对账、协作分账已经有相邻能力，但还没有统一财务批次入口。

这个现状适合运营按项目复盘，不适合财务按一批对象集中处理收款、付款、成本和分账。

## Non-Goals

- 不把客户应收、主播应付、项目成本、协作分账混进同一个批次。
- 不直接替换现有 `settlement_batches` 的所有语义；第一版通过新财务批次层兼容旧批次。
- 不让财务直接修改系统计算金额。
- 不在系统内执行真实打款、收款、开票或外部支付动作。
- 不把财务中心做成完整总账、凭证、科目和税务申报系统。
- 不改变已锁定历史批次的计算结果。

## Recommended Approach

新增统一财务批次模型：

```text
finance_batches
  -> finance_batch_items
  -> finance_batch_adjustments
  -> finance_batch_project_summaries
```

`finance_batches` 是财务中心第一对象，不绑定单一项目。`finance_batch_items` 绑定具体业务来源，必须保留项目、对象、金额和证据归因。项目页只读取这些明细和汇总，不再作为结算发起的第一入口。

这样可以保留现有项目结算和规则引擎的计算能力，同时把财务工作流提升到跨项目、按对象、按批次处理。

## Batch Types

财务批次类型使用统一枚举：

- `receivable`: 客户应收
- `streamer_payable`: 主播应付
- `project_cost`: 项目成本
- `collaboration_share`: 协作分账

每个批次只允许一个 `batch_type`。不同类型共享状态和审计，但来源数据、对象选择器、导出模板和明细字段不同。

## Data Model

### `finance_batches`

批次头表：

- `id`
- `organization_id`
- `batch_type`
- `title`
- `period_start`
- `period_end`
- `status`
- `system_amount`
- `adjustment_amount`
- `final_amount`
- `item_count`
- `exception_count`
- `created_by`
- `submitted_by`
- `confirmed_by`
- `locked_by`
- `exported_by`
- `reopened_by`
- `voided_by`
- `created_at`
- `updated_at`
- `submitted_at`
- `confirmed_at`
- `locked_at`
- `exported_at`
- `completed_at`
- `reopened_at`
- `voided_at`
- `status_reason`
- `metadata`

`system_amount + adjustment_amount = final_amount`。金额字段保留现有项目里的元单位兼容层，服务内部新增 cents 级计算对象，避免浮点误差继续扩大。

### `finance_batch_items`

批次明细表：

- `id`
- `organization_id`
- `finance_batch_id`
- `batch_type`
- `project_id`
- `counterparty_type`
- `counterparty_id`
- `counterparty_name_snapshot`
- `source_type`
- `source_id`
- `source_snapshot`
- `system_amount`
- `adjustment_amount`
- `final_amount`
- `evidence_level`
- `evidence_snapshot`
- `status`
- `exception_flags`
- `created_at`
- `updated_at`

不同类型的来源约定：

- 客户应收：`source_type = live_report | receivable_rule_result | manual_receivable_seed`
- 主播应付：`source_type = live_report | settlement_rule_result`
- 项目成本：`source_type = project_cost_item | cost_import_item`
- 协作分账：`source_type = collaboration_settlement_item | project_collaboration_share`

`project_id` 在明细上必填。批次可以跨项目，但每条金额都必须能回到具体项目。

### `finance_batch_adjustments`

人工调整表：

- `id`
- `organization_id`
- `finance_batch_id`
- `finance_batch_item_id`
- `direction`
- `amount`
- `reason`
- `evidence_snapshot`
- `created_by`
- `created_at`
- `voided_by`
- `voided_at`
- `void_reason`

财务可以自行新增或作废调整项，不需要额外审批。调整必须有原因。已锁定批次不能调整，必须先重开。

### `finance_batch_project_summaries`

项目归因汇总表或物化查询：

- `finance_batch_id`
- `project_id`
- `receivable_amount`
- `streamer_payable_amount`
- `project_cost_amount`
- `collaboration_share_amount`
- `gross_margin_impact`
- `item_count`
- `exception_count`

第一版可以由查询聚合生成；当批次数量变大或导出变慢时再物化。

## Generation Rules

创建批次时，金额默认由系统从已审核、可结算、未进入有效财务批次的数据生成。

通用条件：

- 数据属于当前组织。
- 数据在批次周期内。
- 数据已审核或已确认可入账。
- 数据没有进入未作废、未重开的有效财务批次。
- 数据具备当前批次类型要求的最小证据。

类型差异：

- 客户应收：从已审核报数、客户计费规则、项目应收规则生成。
- 主播应付：从已审核报数、主播项目结算快照、结算规则生成。
- 项目成本：从已审核成本项、成本导入项、外部成本规则结果生成。
- 协作分账：从已确认协作关系、分账比例、项目收入或约定分账基数生成。

财务在草稿阶段选择对象范围：

- 客户应收：客户、项目、项目组或已审核报数。
- 主播应付：主播、主播分组、项目或已审核报数。
- 项目成本：项目、成本类型、成本导入批次或成本项。
- 协作分账：协作方、协作项目或分账记录。

对象选择只是筛选来源数据，不改变计算口径。

## Adjustment Rules

系统金额不可直接编辑。财务只能新增调整项：

```text
system_amount + sum(active_adjustments) = final_amount
```

调整项要求：

- 必填 `reason`。
- 明确方向：补款、扣款、折扣、冲销、成本修正、分账修正。
- 可绑定到整批，也可绑定到单条明细。
- 可关联凭证快照。
- 作废调整项时必须填写作废原因。

调整不需要审批，但所有新增和作废都写入审计日志。

## Status Flow

统一状态流：

```text
draft -> pending_review -> confirmed -> locked -> exported -> completed
```

旁路状态：

- `rejected`
- `reopened`
- `voided`
- `has_exceptions`

状态语义：

- `draft`: 财务选择对象、预览金额、添加调整。
- `pending_review`: 金额已生成，等待复核。
- `confirmed`: 业务口径已确认，允许进入导出准备。
- `locked`: 金额、对象、证据和调整冻结。
- `exported`: 已导出付款表、收款表、成本表或分账单。
- `completed`: 外部收款、付款、成本入账或分账对账流程已完成并归档。
- `rejected`: 复核不通过，退回草稿。
- `reopened`: 锁定或导出后因原因重开。
- `voided`: 作废，不进入有效财务统计。
- `has_exceptions`: 有异常时的标记，可以与主状态共存。

锁定后不能修改明细、调整项或对象范围。重开必须填写原因，并记录重开前后的差异。

## User Experience

### 财务中心首页

首页展示统一批次列表和汇总指标：

- 总应收
- 总应付
- 总成本
- 总分账
- 待确认金额
- 异常金额
- 按项目拆分的毛利影响

批次列表支持按类型、状态、周期、项目、对象、创建人和异常筛选。

### 创建批次

创建流程：

1. 选择批次类型。
2. 选择周期。
3. 选择对象范围。
4. 系统预览可入批数据和异常。
5. 财务确认生成草稿。
6. 财务添加必要调整。
7. 提交复核或直接进入确认流程。

第一版可以保留「待审核」状态，但人工调整不需要独立审批。

### 批次详情

批次详情包含：

- 批次状态和关键动作。
- 系统金额、调整金额、最终金额。
- 明细列表。
- 调整项列表。
- 异常列表。
- 项目归因汇总。
- 导出入口。
- 审计记录。

明细表必须能按项目、对象、来源、金额、异常和证据过滤。

### 项目详情页

项目页不再作为结算发起入口。项目页展示：

- 该项目被哪些财务批次引用。
- 该项目在不同批次中的应收、应付、成本、分账和毛利影响。
- 可跳转到财务批次详情查看来源明细。

项目页仍可显示项目结算规则和历史单项目结算数据，但新财务批次是主入口。

## API Shape

新增 API：

- `GET /api/finance/batches`
- `POST /api/finance/batches`
- `GET /api/finance/batches/:batchId`
- `POST /api/finance/batches/:batchId/submit`
- `POST /api/finance/batches/:batchId/confirm`
- `POST /api/finance/batches/:batchId/lock`
- `POST /api/finance/batches/:batchId/export`
- `POST /api/finance/batches/:batchId/complete`
- `POST /api/finance/batches/:batchId/reopen`
- `POST /api/finance/batches/:batchId/void`
- `POST /api/finance/batches/:batchId/adjustments`
- `POST /api/finance/batches/:batchId/adjustments/:adjustmentId/void`
- `GET /api/finance/batch-source-preview`

创建批次输入：

```json
{
  "batchType": "streamer_payable",
  "periodStart": "2026-07-01",
  "periodEnd": "2026-07-31",
  "title": "7月主播付款批次",
  "selection": {
    "streamerIds": ["..."],
    "projectIds": ["..."]
  }
}
```

`selection` 根据 `batchType` 使用不同字段。服务端负责校验无效组合。

## Compatibility And Migration

第一阶段不删除现有 `settlement_batches`。迁移策略：

1. 新增 `finance_batches` 等表和服务层。
2. 主播应付先接入现有结算池和规则引擎，生成财务批次明细。
3. 客户应收复用项目应收规则和已审核报数。
4. 项目成本复用 `project_cost_items` 和成本导入结果。
5. 协作分账复用协作结算服务。
6. 现有项目结算页面改为读取财务批次项目归因，同时保留旧批次历史显示。
7. 当新财务中心稳定后，旧 `settlement_batches` 仅作为历史兼容层或被财务批次包装。

历史单项目批次可以在 UI 中标记为「旧项目批次」，并在项目详情页继续可查。

## Permissions And Audit

权限建议：

- `finance`: 创建批次、保存调整、导出。
- `ops_manager` 或 `owner`: 确认、锁定、重开、作废。
- `viewer`: 只读。
- `streamer`: 只看与自己有关且已允许展示的应付结果。
- `collaboration_partner`: 只看与自己有关且已确认展示的分账结果。

审计必须覆盖：

- 创建批次。
- 生成明细。
- 新增或作废调整项。
- 提交、确认、锁定、导出、完成、重开、作废。
- 导出文件生成。
- 异常处理。

任何金额变化都必须能看到系统金额、调整金额、最终金额、操作人、原因和时间。

## Exception Handling

批次生成时遇到以下情况应标记异常，而不是静默跳过：

- 来源数据缺少项目归因。
- 来源数据已进入有效批次。
- 结算规则缺失或无法计算。
- 证据等级不足。
- 协作关系失效。
- 成本项未审核。
- 金额为负且业务类型不允许。
- 调整后最终金额越过配置的异常阈值。

异常不一定阻断草稿生成，但会阻断锁定，除非具有明确的人工处理记录。

## Reporting

财务中心汇总看四类金额：

```text
项目毛利影响 = 客户应收 - 主播应付 - 项目成本 - 协作分账
```

这个公式用于项目归因展示，不替代正式财务报表。正式报表导出仍按批次类型分别输出，避免收款、付款、成本和分账口径混淆。

## Testing Plan

服务层测试：

- 跨项目主播应付批次能从多个项目生成明细。
- 同一来源数据不能进入两个有效财务批次。
- 人工调整只影响调整金额和最终金额，不改系统金额。
- 锁定后不能新增调整，重开后可以新增调整。
- 项目归因汇总能正确拆分四类金额。
- 作废批次不进入有效财务统计。

API 测试：

- 不同 `batchType` 的 selection 校验。
- 财务可以创建批次和调整项。
- 非财务角色不能创建或导出批次。
- 锁定、导出、完成、重开、作废状态流合法。
- 有未处理异常时不能锁定。

UI 测试：

- 财务中心首页能按类型和状态筛选。
- 创建批次时先选类型，再选周期和对象。
- 批次详情展示系统金额、调整金额、最终金额。
- 项目详情页能展示被财务批次引用的金额归因。

Regression 测试：

- 旧项目批次列表仍可读。
- 旧项目详情页历史结算数据不丢失。
- 主播端只看到允许展示的应付结果，不暴露客户应收、项目成本和毛利。

## Rollout

第一阶段：数据模型和只读财务中心

- 新增表、DTO 和查询。
- 首页展示新旧批次聚合列表。
- 项目页展示财务批次引用。

第二阶段：主播应付批次

- 以主播应付作为第一个可创建类型。
- 支持跨项目选择主播。
- 支持调整、锁定、导出和项目归因汇总。

第三阶段：客户应收和项目成本

- 客户应收接入已审核报数和应收规则。
- 项目成本接入成本项和导入结果。

第四阶段：协作分账

- 接入协作关系、分账比例和协作结算确认。

第五阶段：旧项目结算入口降级

- 项目详情只作为追溯和汇总入口。
- 财务中心成为唯一新批次创建入口。

## Success Criteria

- 财务可以在一个批次中处理跨项目的一批主播应付。
- 财务中心可以统一查看四类批次，但每个批次类型清晰。
- 任意批次都能按项目拆分收入、支出、成本、分账和毛利影响。
- 系统金额、人工调整和最终金额可解释、可追溯。
- 旧项目结算历史不丢失。
- 主播、协作方和普通运营看不到不该看的财务口径。
