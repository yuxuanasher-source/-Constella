# AI 自定义结算公式规则设计

## 目标

让 MCN 用户能够基于自己的业务逻辑定义结算规则，而不是只能使用预设的“复杂规则”。用户可以用自然语言描述规则，通过 AI 消除歧义，确认中文业务规则合同，预览财务影响，并在无需理解公式语法的情况下提交审核。规则只有在人工审批后才会生效。

本设计采用“公式 / DSL + AI 辅助”的方式，但不会执行任意用户脚本。系统负责解析、校验、执行、预览、审批和审计。

## 当前上下文

现有结算系统已经具备多层能力：

- 项目级默认结算设置通过 `PATCH /api/projects/:projectId/settlement-rule` 更新，并要求提供审计原因。
- 主播加入项目时，主播 / 项目维度的应付规则会冻结到 `project_streamers`，因此历史结算保持稳定。
- `calculateSettlementItem` 支持固定方式、CPT / 底薪、阶梯小时价、扣罚、保底和封顶。
- 复杂成本规则是独立工作流，用于成本预览、导入、手工成本项、看板和导出。
- 单项目对账会合并应收、应付、外部成本、税费和毛利检查。

当前缺失的产品闭环是：

```text
自然语言业务规则
  -> AI 澄清和数据就绪检查
  -> 用户确认的业务规则合同
  -> 系统生成的安全公式和解释
  -> 自动校验和模拟
  -> 草稿提交审核
  -> 人工审批
  -> 生效规则用于结算批次
  -> 历史计算快照
```

## 非目标

- 不允许公式包含任意 JavaScript、SQL、网络调用、数据库查询、循环、递归、随机性或副作用。
- 不允许 AI 直接激活规则、确认结算批次、锁定结算、重开已锁定批次、修改历史批次明细或确认付款。
- 不向主播侧 API 暴露内部应收、毛利、税费、其他主播规则或成本公式。
- 不通过一次迁移替换现有固定结算规则。现有规则仍作为兜底。
- 规则变更后不重算已锁定的历史结算批次。
- 不要求普通用户理解分、基点、英文变量名或 DSL 语法。公式编辑属于高级模式能力。

## 推荐方案

使用受控公式 DSL 加 AI 辅助起草。

用户用自然语言与 AI 对话。AI 先返回结构化理解，并针对尚未解决的业务含义提出聚焦问题。用户确认理解后，系统生成：

- 允许 DSL 内的公式，
- 基于已校验 AST 生成的确定性中文解释，
- 测试用例，
- 预期输入，
- 安全提示。

后端解析并校验公式，检查其所需数据是否可用，并自动运行模拟。拥有起草权限的用户可以一键应用并提交审核。只有 owner 或 ops manager 可以审批规则版本并使其生效。

这既给用户真正的自定义能力，又保持结算确定、可解释、可审计、可测试。

## 规则架构

新增 `custom_settlement_rule_versions` 表保存版本化规则记录，而不是直接替换 `projects.default_settlement_rule`。草稿保持可编辑；已提交和已生效版本不可变。

每个版本保存：

- `scope`：`receivable`、`payable`、`external_cost` 或 `reconciliation`。
- `target_type`：`project`、`project_streamer` 或 `streamer_group`。
- `target_id`：项目级默认规则为空。
- `execution_grain`：`report`、`project_streamer_period`、`batch` 或 `project_period`。
- `composition_mode`：`replace`、`add`、`multiply`、`clamp`、`emit_items` 或 `check`。
- `priority`：重叠修饰层的确定性顺序。
- `formula`：原始公式文本。
- `compiled_ast`：解析并规范化后的 AST。
- `variables`：该规则允许使用的变量列表。
- `parameters`：带有明确用户侧单位的具名业务参数。
- `rule_contract`：用户确认的中文业务含义。
- `system_explanation_template`：基于 AST 生成的确定性解释。
- `test_cases`：生成且可由用户调整的测试用例。
- `simulation_summary`：预览输出摘要。
- `missing_data_policy`：每个可选或不可用输入的明确处理方式。
- `status`：`draft`、`pending_review`、`changes_requested`、`active` 或 `archived`。
- `effective_from`：首次生效时间。
- `effective_until`：排期规则的可选结束时间。
- `created_by`、`approved_by`、`ai_draft_id`、`reason`。

约束：

- 同一 `project_id + scope + target_type + target_id` 只能存在一个 active 版本。单个目标不能同时激活独立的 `replace` 和修饰版本；该目标的公式必须表达该目标的全部组件。
- active 版本不可变。任何变更都会创建新版本。
- 版本只能归档，不能删除。
- 规则只能对未来批次生效。已锁定批次永不重算。
- 规则只有在执行粒度、参数单位、输入来源、缺失数据策略、组合顺序和模拟覆盖率均有效后才能激活。
- 结算使用的主播分组成员关系会在主播加入项目时，或在审计过的分组指派变更获批时快照化。之后的资料标签编辑不会静默改变历史或已排期结算。
- 现有项目主播需要先完成审计过的分组指派回填，分组规则才能对其生效。未分组主播继续使用项目基础规则，并在模拟覆盖率中明确展示。

### 规则生命周期

AI 草稿是会话证据，不是可执行规则版本。用户可以保存为 `draft`，也可以使用 `apply-and-submit` 直接创建一个带有不可变模拟快照的 `pending_review` 版本。

允许的状态流转为：

```text
draft -> pending_review
pending_review -> changes_requested
changes_requested -> draft
pending_review -> active
active -> archived
draft -> archived
changes_requested -> archived
```

不存在直接 `draft -> active` 流转。审批会在一个事务内激活已提交版本，并归档同一目标的上一 active 版本。

手动归档 active 规则会设置其生效结束时间，要求对剩余规则层或固定规则兜底进行模拟，并且永不改变已锁定批次。移除 active 修饰规则属于财务变更，不是无害删除。

## 业务规则合同

自然语言是主要的创作界面。系统生成公式前，AI 必须产出中文业务规则合同，内容包括：

- 计算对象：客户应收、主播应付、外部成本或对账检查，
- 规则适用于谁或什么对象，
- 执行粒度：按报表、按主播每周期、按批次或按项目周期，
- 计算组件，例如基础金额、奖金、扣罚、保底、封顶和最终金额，
- 每个必需数据字段及其来源，
- 用户侧单位：元、百分比、小时、分钟、数量或日期，
- 生效期间，
- 缺失数据处理方式，
- 与项目、分组和个人规则的组合关系，
- 至少一个正常示例和两个边界示例。

用户确认的是这份合同，而不是原始公式。之后任何自然语言或高级公式编辑都会重新生成合同差异，并要求在模拟或提交前再次确认。

## AI 交互流程

在项目结算设置中，用户打开“AI 构建结算规则”，输入业务规则，例如：

```text
这个项目按系统直播时长结算。绿证据全额，黄证据按 80%，红证据不计。
单场不足 60 分钟不结算；超过 3 小时的部分按 120 元/小时。
如果主播等级是 S，每场额外奖励 50 元。
```

流程：

1. 用户用中文描述业务规则。
2. AI 提取业务规则合同草稿，并检查项目范围内的变量目录。
3. 如果金额单位、目标、执行粒度、时间范围、数据来源、异常、组合行为或缺失数据策略存在歧义，AI 每轮只问一个聚焦问题。只要必需歧义未解决，就不得生成最终公式。
4. 用户确认中文业务规则合同。
5. AI 提出 DSL 公式和边界用例。服务端解析、类型检查并校验公式。AI 输出永不被信任为可执行内容。
6. 系统基于已校验 AST 生成权威中文解释，然后自动运行数据就绪检查和模拟。
7. 用户查看已确认业务含义、样本覆盖率、当前 / 新规则 / 差额金额、受影响记录和风险。
8. 用户点击一个状态感知动作：“应用并提交审核”。对于 operator，对应标签为“保存并请求审核”。该动作在一个事务内保存不可变的已提交版本，记录最新模拟，并移动到 `pending_review`。
9. 合格的 owner 或 ops manager 查看规则合同差异和模拟影响，然后带必填原因批准激活，或退回要求修改。

UI 必须避免为 AI 生成输出提供名为“立即生效”的按钮。一键应用表示一键创建并提交待审核草稿；绝不表示绕过激活审批。

自然语言修订属于第一版能力。用户可以说：“黄证据从 80% 改为 70%，其他条件不变”。AI 必须保留未受影响的合同字段，展示精确的前后业务差异，重新生成公式，并重新运行校验和模拟。

AI 可以：

- 建议公式，
- 解释规则，
- 生成测试用例，
- 识别缺失输入，
- 提醒风险结果，
- 在保留未受影响条件的同时修订现有草稿，
- 准备草稿，并且只有在用户显式操作后，才持久化并提交人工审核。

AI 不能：

- 激活规则，
- 绕过审批，
- 锁定或确认结算，
- 修改不可变历史证据，
- 执行资金流转或付款确认。

AI 接收用户会话、已确认的合同草稿，以及名称、类型、单位、来源标签、可用状态等范围安全的变量元数据。默认不向模型发送原始历史结算行、其他主播金额、内部毛利细节或导入证据值。历史模拟仍是确定性的服务端处理；只有当用户明确要求帮助解释结果时，才可以向 AI 提供授权且脱敏后的摘要。

## 公式 DSL

DSL 是用于金额计算和结算检查的确定性表达式语言。

示例：

```text
payable = money_result({
  base: if(system_minutes < 60, yuan(0),
    tiered(system_minutes, [
      { upto: 180, rate_per_hour: yuan(80) },
      { upto: null, rate_per_hour: yuan(120) }
    ]) * evidence_multiplier(
      evidence_level,
      { green: rate_percent(100), yellow: rate_percent(80), red: rate_percent(0) }
    )
  ),
  bonus: if(streamer_level == "S", yuan(50), yuan(0)),
  penalty: yuan(0),
  final: base + bonus - penalty
})
```

高级模式公式文本使用带类型、用户可读的字面量，例如 `yuan(80)` 和 `rate_percent(80)`。编译器在 AST 中将金额规范化为分，将费率规范化为基点。无法安全推断单位的原始整数金额或费率字面量会被拒绝。

金额规则通过 `money_result` 返回具名组件。这让模拟、审批、导出和主播解释拥有稳定标签，而不是要求产品反向解析一个不透明的最终数字。简单规则可以只返回 `final`；复杂规则应在适用时返回 `base`、`bonus`、`penalty` 和 `final`。

在 `money_result` 内，一个组件只能引用同一结果对象中更早出现的具名组件。校验器会构建组件依赖图，并拒绝前向引用或循环引用。这让 `final: base + bonus - penalty` 在不引入通用用户自定义变量的情况下保持确定性。

业务参数与公式结构分开存储，并通过名称引用：

```text
parameter("s_level_bonus")
parameter("yellow_evidence_rate")
```

修改参数仍会创建新的规则版本和模拟，但用户编辑的是带标签的元 / 百分比字段，而不是公式语法。

### 允许的变量组

直播证据：

- `system_minutes`
- `screenshot_minutes`
- `settlement_minutes`
- `evidence_level`
- `time_source`
- `views`
- `live_started_at`
- `weekday`
- `hour_of_day`
- `approved_at`

项目和主播：

- `project_id`
- `project_tags`
- `streamer_id`
- `streamer_level`
- `streamer_source`
- `collaboration_id`
- `base_hourly_rate`
- `base_salary`
- `cps_rate`
- `streamer_group_ids`

业务结果：

- `sales_amount`
- `orders_count`
- `gift_amount`
- `supplier_fee`
- `traffic_cost`
- `manual_adjustment`

预计算周期聚合，仅可用于兼容的执行粒度：

- `period_system_minutes`
- `period_settlement_minutes`
- `period_sales_amount`
- `period_orders_count`
- `period_report_count`
- `red_evidence_count`
- `yellow_evidence_count`
- `period_payable_amount`
- `period_receivable_amount`
- `period_start`
- `period_end`

服务层在公式执行前计算这些聚合。DSL 不能自行发起查询或遍历任意记录。

对账：

- `receivable_amount`
- `payable_amount`
- `external_cost_amount`
- `tax_amount`
- `gross_margin`
- `margin_rate`

### 允许的函数

```text
if(condition, when_true, when_false)
min(a, b)
max(a, b)
clamp(value, floor, cap)
round_money(value)
tiered(minutes, [{ upto, rate_per_hour }])
percent(amount, rate)
evidence_multiplier(evidence_level, { green, yellow, red })
in(value, ["A", "B"])
contains(tags, "tag")
yuan(value)
rate_percent(value)
parameter(name)
money_result({ components..., final })
```

对账规则额外增加检查辅助函数：

```text
block_if(condition, message)
warn_if(condition, message)
pass_if(condition, message)
```

外部成本规则通过 `cost_items([{ category, amount, memo }])` 返回带类型的草稿项。对账规则返回带类型的检查。规则不能返回另一个 scope 的输出合同。

### 限制

- 第一版不支持用户自定义函数。
- 不允许循环、递归、异步行为、随机值、网络调用、数据库读取、文件访问或全局状态。
- 公式复杂度由 AST 节点数、表达式深度、函数数量和序列化大小限制。
- 除非某个规则类型明确允许带符号调整，否则金额规则输出必须有限且非负。
- 拒绝没有明确单位的原始金额和费率字面量。
- 公式引用只能使用该规则层执行前已经可用的输入。校验器拒绝循环依赖，以及对同层或后续层输出的引用。
- 缺失必需变量会导致校验失败。可选变量必须有明确缺失数据策略；生产执行绝不能发明或静默替换默认值。

### 缺失数据策略

每个可选输入都需要在已确认的业务规则合同中选择一个策略：

- `route_item_to_review`：将受影响项排除在计算总额之外，并创建需要复核的结算异常；
- `block_batch`：当该输入与批次结果在财务上不可分割时，阻断整个批次；
- `use_explicit_default`：使用一个有名称、可见的默认值；该默认值纳入模拟，并要求 owner 审批。

`use_explicit_default` 禁用于身份、证据真实性、组织归属或其他授权敏感字段。必需输入在激活前需要 100% schema 就绪；当存在历史样本时，还需要 100% 样本覆盖率。可选输入可以有较低覆盖率，但每个未覆盖情况都必须有允许的明确策略。无历史的新项目使用 schema 就绪度、合成示例和用户示例，并标记为“未经过历史验证”。

## 规则范围

每条规则都声明执行粒度和输出合同。规则不能依靠 UI 文案来暗示它是按报表、按主播每结算周期、按批次还是按项目周期运行。

### 规则组合

应付和应收金额规则使用确定性层：

1. 解析基础层。若存在 active 项目级 `replace` 规则，则使用它；否则使用现有冻结固定结算规则。
2. 按 `priority` 升序应用每个匹配的主播分组修饰器。除非 owner 明确批准分组级 `replace` 规则，否则分组规则使用 `add`、`multiply` 或 `clamp`。
3. 最后应用 active 项目主播规则。它可以替换此前结果，也可以应用明确修饰器。
4. 在结算明细快照中持久化每个已应用层、优先级、分组成员快照、输入、组件输出和最终输出。

如果一个主播属于多个 active 规则重叠的分组，且优先级相同或组合方式有歧义，则激活失败。用户必须先解决冲突，规则才能生效。引擎永不按创建时间或数据库行顺序选择规则。

对于金额规则，项目级目标使用 `replace`；主播分组目标通常使用 `add`、`multiply` 或 `clamp`；项目主播目标可以使用 `replace` 或修饰器。分组级 `replace` 只能通过重大风险 owner 审批。对账规则使用 `check`。外部成本规则使用 `emit_items` 和其带类型的项目输出，而不是金额规则组合。

### 应收规则

计算 MCN 向客户或供应商收取的金额。可以覆盖 CPT、基础费加 CPT、GMV / CPS 收入、保底、封顶、证据折扣或项目特定奖金。

对于应收批次，项目级基础费根据声明的执行粒度，每批次或每项目周期应用一次，而不是每个主播应用一次。明细级和批次级组件在输出拆分中保持分离，避免重复计算。

### 应付规则

计算 MCN 支付给主播的金额。应付规则通过上述组合顺序支持项目默认值、冻结的主播分组修饰器和特定项目主播例外。若没有 active 自定义基础层，冻结在 `project_streamers` 中的固定规则仍作为基础。手工金额始终是明确复核过的输入，绝不是 active 规则失败时的自动兜底。

周期保底、累计阶梯或周期封顶必须使用 `project_streamer_period` 粒度和预计算周期聚合。不能通过汇总独立封顶的报表级结果来近似。

### 外部成本规则

根据供应商、流量、平台、样品、回放或其他导入字段生成项目成本项。外部成本输出默认是需要复核的成本项，除非获批，否则不会自动进入已确认成本总额。

每个生成项声明其类别、金额、执行粒度、来源字段和证据引用。公式不能发出隐藏多个类别的无类型聚合成本。

### 对账规则

返回项目结算的 `pass`、`warn` 或 `block` 检查。示例：

```text
block_if(margin_rate < rate_percent(10), "毛利率低于 10%")
warn_if(red_evidence_count > 0, "存在红证据场次")
```

对账规则只在应收、应付、外部成本和税费输出都存在后执行。它们可以引用这些最终输出，但不能把值反馈到更早的金额规则。对账规则用于卡住确认和锁定流程，但不会直接修改结算批次记录。

## 数据模型

### `settlement_rule_groups`

定义显式的项目范围结算分组。分组不会在执行时从可变主播资料标签中推断。

关键字段：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `name text not null`
- `description text null`
- `status text not null`
- `created_by uuid null`
- `created_at timestamptz not null default now()`
- `archived_at timestamptz null`

### `project_streamer_settlement_group_assignments`

保存项目主播的带生效日期、保留审计的分组成员关系。

关键字段：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `project_streamer_id uuid not null`
- `group_id uuid not null`
- `effective_from timestamptz not null`
- `effective_until timestamptz null`
- `assigned_by uuid null`
- `reason text not null`
- `created_at timestamptz not null default now()`

成员关系变更会在一个审计事务内关闭上一生效区间并插入新指派。资料标签变更永不自动改变此表。允许多个 active 分组指派，但规则优先级冲突必须在激活前解决。

数据库和服务层会强制组织 / 项目归属匹配，禁止同一项目主播 / 分组对出现重叠区间，并防止成员关系编辑改变已锁定结算历史。影响未来未结算工作的成员关系变更需要新的影响模拟。

### `custom_settlement_rule_versions`

保存覆盖草稿、审核、生效和归档状态的版本化业务规则。

关键字段：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `scope text not null`
- `target_type text not null`
- `target_id uuid null`
- `execution_grain text not null`
- `composition_mode text not null`
- `priority integer not null default 100`
- `version_no integer not null`
- `status text not null`
- `formula text not null`
- `compiled_ast jsonb not null`
- `variables jsonb not null`
- `parameters jsonb not null default '{}'`
- `rule_contract jsonb not null`
- `system_explanation_template text not null`
- `missing_data_policy jsonb not null default '{}'`
- `test_cases jsonb not null default '[]'`
- `simulation_summary jsonb not null default '{}'`
- `effective_from timestamptz null`
- `effective_until timestamptz null`
- `created_by uuid null`
- `approved_by uuid null`
- `ai_draft_id uuid null`
- `reason text null`
- `created_at timestamptz not null default now()`
- `approved_at timestamptz null`
- `archived_at timestamptz null`

创建草稿不要求高风险原因。提交、激活、强制审批、active 规则归档，以及任何生效期变更，都要求在对应审计事件中提供原因。

### `ai_settlement_rule_drafts`

保存 AI 生成可追溯性。

关键字段：

- `id uuid primary key`
- `organization_id uuid not null`
- `project_id uuid not null`
- `conversation_id uuid not null`
- `initial_user_prompt text not null`
- `conversation_turns jsonb not null default '[]'`
- `draft_rule_contract jsonb not null default '{}'`
- `unresolved_ambiguities jsonb not null default '[]'`
- `variable_catalog_version text not null`
- `ai_response jsonb not null`
- `generated_formula text null`
- `generated_explanation_draft text null`
- `generated_test_cases jsonb not null default '[]'`
- `model text not null`
- `safety_flags jsonb not null default '[]'`
- `created_by uuid null`
- `created_at timestamptz not null default now()`

### `settlement_formula_simulations`

保存模拟摘要。

关键字段：

- `id uuid primary key`
- `rule_version_id uuid null`
- `ai_draft_id uuid null`
- `formula_hash text not null`
- `sample_source text not null`
- `sample_selection jsonb not null default '{}'`
- `coverage_summary jsonb not null default '{}'`
- `scenario_results jsonb not null default '[]'`
- `old_total_amount_cents bigint null`
- `new_total_amount_cents bigint null`
- `delta_amount_cents bigint null`
- `largest_deltas jsonb not null default '[]'`
- `warnings jsonb not null default '[]'`
- `created_by uuid null`
- `created_at timestamptz not null default now()`

一次模拟要么属于持久化规则版本，要么属于 AI 草稿；`rule_version_id` 和 `ai_draft_id` 必须且只能有一个存在。这允许用户应用草稿前先模拟，而不会创建孤儿规则版本。`apply-and-submit` 会将已校验的 AI 草稿模拟复制到新的、绑定版本的不可变模拟记录；它不会修改或重新关联原始 AI 草稿证据。

当新项目没有可比较历史周期时，历史总额和差额保持 `null`。合成场景总额不得被呈现为真实历史基线。

### 结算明细快照

在 `settlement_batch_items.evidence_snapshot` 中扩展 `ruleEngine` 对象：

```json
{
  "ruleEngine": {
    "mode": "custom_formula",
    "ruleContractHash": "...",
    "executionGrain": "report",
    "parameters": {
      "s_level_bonus_cents": 5000,
      "yellow_evidence_rate_bps": 8000
    },
    "appliedLayers": [
      {
        "ruleVersionId": "...",
        "targetType": "project",
        "compositionMode": "replace",
        "priority": 100,
        "formulaHash": "..."
      },
      {
        "ruleVersionId": "...",
        "targetType": "streamer_group",
        "targetId": "...",
        "compositionMode": "add",
        "priority": 200,
        "formulaHash": "..."
      }
    ],
    "inputs": {
      "system_minutes": 180,
      "evidence_level": "green",
      "streamer_level": "S",
      "streamer_group_ids": ["..."]
    },
    "outputs": {
      "base": 24000,
      "bonus": 5000,
      "penalty": 0,
      "final": 29000
    },
    "missingDataDecisions": [],
    "explanation": "系统计时 180 分钟，按 80 元/小时计 240 元，S 级奖励 50 元。"
  }
}
```

该快照是必需的，确保未来规则、参数或分组成员变化不会抹掉历史结算解释。解释由已应用 AST 层和实际输入渲染，不复制自由文本 AI 话术。

## 后端设计

新增以下模块：

- `features/settlements/custom-rule-types.ts`
- `features/settlements/custom-rule-parser.ts`
- `features/settlements/custom-rule-validator.ts`
- `features/settlements/custom-rule-engine.ts`
- `features/settlements/custom-rule-contract.ts`
- `features/settlements/custom-rule-variable-catalog.ts`
- `features/settlements/custom-rule-data-readiness.ts`
- `features/settlements/custom-rule-composition.ts`
- `features/settlements/custom-rule-explanation.ts`
- `features/settlements/custom-rule-service.ts`
- `features/settlements/custom-rule-repository.ts`
- `features/settlements/custom-rule-ai.ts`

解析器将公式文本转换为 AST。校验器检查语法、变量白名单、函数白名单、金额单位、输出范围和复杂度。引擎以纯函数方式执行 AST。

引擎不得访问 Supabase、文件系统、网络、环境变量、计时器或随机状态。数据库访问属于服务 / 仓储层，在构建执行上下文前完成。

AI 适配器只负责会话到合同的起草。合同校验、变量可用性、公式解析、确定性解释、模拟和状态流转仍由非 AI 服务以带类型输出负责。

## 数据就绪和模拟门槛

公式生成前，项目范围变量目录会为每个候选输入标记 `available`、`partial`、`unavailable` 或 `not_applicable`，并提供来源和最新覆盖周期。AI 只能建议所选 scope 允许的变量，并且必须在业务规则合同中指出部分可用或不可用字段。

模拟有三组必需证据：

1. 当数据存在时，与一个授权且完整的结算周期做历史对比。
2. 覆盖零值、阈值边界、最大配置值、每个证据等级和每个缺失数据策略的合成边界用例。
3. 与规则版本一起保存、可由用户调整的业务示例。

结果展示记录数、必需输入覆盖率、未覆盖记录、零结算数量、转复核数量、最大增加和减少、总差额、毛利影响和触发的风险策略。无历史的新项目可以使用 schema 就绪度、合成示例和用户示例，但 UI 必须标明不存在历史对比。

激活要求模拟的公式 hash、规则合同 hash、参数 hash、变量目录版本和数据选择 hash 仍与已提交版本匹配。任何相关编辑都会使模拟过期，并移除激活动作，直到模拟再次成功。

## 结算执行

结算批次生成时：

1. 根据 `batchType` 和 active 规则合同确定 scope 和执行粒度。
2. 按确定性组合顺序解析每个 active 基础层、分组层和个人层。
3. 从已审批报表、项目数据、冻结的项目主播数据、导入业务数据和角色安全字段构建输入上下文与预计算周期聚合。
4. 在执行前应用声明的缺失数据策略。转复核项会排除在计算总额之外，并作为批次确认的阻断异常展示。
5. 执行每个带类型规则层，并组合其具名输出组件。
6. 根据已应用 AST、参数、输入和组件输出生成中文解释。
7. 持久化最终金额、组件拆分、所有已应用规则版本、公式 hash、分组成员快照、缺失数据决策和输入 / 输出快照。
8. 如果不存在 active 自定义基础层或修饰层，则继续使用现有 `calculateSettlementItem`。

如果自定义规则执行失败：

- 在草稿或模拟中，将校验错误返回给 UI。
- 在生产中，只有 active 规则合同明确声明的可选输入场景，才使用 `route_item_to_review`。
- 任何解析器、类型、单位、组合、参数、授权或意外引擎失败都会阻断生成。不要静默兜底，因为用户期望 active 规则被执行。
- 固定规则兜底只在不存在 active 自定义基础层或修饰层时使用。
- 带有转复核项的批次，在这些项获得审计过的处理结果前，不能确认或锁定。

## 金额单位策略

新的自定义规则引擎内部使用分。所有普通 UI、AI 会话、业务规则合同、参数、示例和解释都显示元和百分比。高级模式公式使用带类型的单位函数，绝不要求用户输入原始分或基点。

现有结算引擎在部分路径中有基于元的遗留输出，而复杂成本和税费用分。实现必须引入明确适配器：

- 遗留结算引擎输出元 -> 自定义 / 对账分，
- DSL 中带类型的元 / 百分比字面量 -> AST 分 / 基点 -> 结算批次持久化单位，
- 成本 / 税费分保持不变，
- 测试覆盖 100 倍转换风险。

新的公式规则不应在持久化 JSON 中存储没有单位后缀的歧义 `"amount"` 字段。

## 产品可用性目标

该功能不能仅仅因为引擎能计算公式就算成功。广泛发布前，面向目标 owner、ops manager、finance 和 operator 用户的可用性测试应满足：

- 不超过 20 分钟上手后，至少 80% 参与者能在 5 分钟内创建并提交基于模板的规则，且无需打开高级模式；
- 至少 80% 能在 10 分钟内创建并提交一条新的自然语言规则，不含等待审批时间；
- 至少 80% 能只凭中文业务规则合同和模拟，正确预测正常示例和两个边界示例的结果；
- 审核者能在 3 分钟内识别 scope、受影响目标、最大财务差额、缺失数据行为和重大风险；
- 修改一个具名参数并重新提交克隆规则不超过 3 分钟；
- 每个状态最多显示一个主操作，正常完成流程永不要求用户输入分、基点、英文变量名或公式语法。

未达到这些目标会阻止广泛发布，并在增加更多 DSL 能力前触发文案、工作流、模板或 AI 澄清调整。

## 前端设计

在项目详情 -> 结算设置中，新增“自定义公式规则”。

第一个决策使用业务语言：“你要计算什么？”，选项为客户应收、主播应付、项目成本和结算风险检查。技术 scope 值保持内部使用。第二个决策只展示对所选 scope 有效的目标，并解释该目标如何与现有规则组合。应付支持项目默认值、主播分组和特定项目主播；应收、外部成本和对账默认使用项目范围目标，除非后续批准的用例增加更窄目标。

主工作区包括：

- AI 会话，显示澄清问题并保留修订历史；
- 中文业务规则合同，高亮未解决项；
- 数据就绪面板，展示每个必需变量的来源和覆盖率；
- 确定性解释面板；
- 自动生成且可由用户调整的测试用例；
- 自动模拟对比：
  - 当前规则总额，
  - 新规则总额，
  - 差额，
  - 样本数量和必需输入覆盖率，
  - 零结算和转复核数量，
  - 变化最大的主播或报表，
  - 触发条件，
  - 毛利影响。
- 风险面板：
  - 负毛利，
  - 异常增长，
  - 红证据计价，
  - 缺失变量，
  - 未解决导入字段。
- 版本面板：
  - active 版本，
  - 草稿，
  - 待审核，
  - 要求修改和评论，
  - 已归档版本，
  - 审批人和原因。
- 默认折叠的高级模式：
  - 带语法高亮的类型化公式编辑器，
  - 服务端校验消息，
  - 编译后单位预览，
  - 基于 AST 的解释差异。
- 第一版复用工具：
  - 常见 CPT、CPS、底薪加绩效、证据折扣、保底 / 封顶和分组奖励模板，
  - 从另一个授权项目克隆，
  - 将已确认规则保存为组织模板。

页面根据当前状态最多显示一个主操作：

- 未解决会话：“回复 AI”；
- 合同就绪：“确认业务规则并试算”；
- 当前模拟成功：“应用并提交审核”，operator 为“保存并请求审核”；
- 合格审批人查看待审核规则：“确认生效”；
- 要求修改：“修改并重新试算”；
- active 规则：“创建新版本”。

校验和模拟作为状态流转的一部分运行，而不是作为永久竞争的主按钮出现。“保存草稿”、“查看高级公式”、“退回修改”和“归档规则”是上下文二级操作或菜单项。

“应用并提交审核”会在转为 `pending_review` 前，原子持久化合同、公式、参数、测试用例、模拟 hash 和审计事件。部分持久化绝不能留下“看起来已提交但没有匹配模拟”的公式。

主播侧 UI 只接收个人结算解释摘要。不得暴露公式、应收规则、内部毛利、税费、成本或其他主播数据。

## API 设计

新增路由：

- `POST /api/projects/:projectId/settlement-rules/ai-sessions`
  - 启动项目范围的结算规则会话，并返回初始合同草稿。
- `POST /api/projects/:projectId/settlement-rules/ai-sessions/:sessionId/turns`
  - 添加自然语言回答或修订，并返回合同差异、剩余歧义和数据就绪变化。
- `POST /api/projects/:projectId/settlement-rules/ai-sessions/:sessionId/confirm-contract`
  - 确认已完全解决的业务规则合同，生成公式提案，校验，并开始模拟。
- `GET /api/projects/:projectId/settlement-rules/variable-catalog`
  - 返回 scope 安全的变量、来源、单位和项目覆盖率。
- `GET /api/projects/:projectId/settlement-rule-groups`
  - 列出显式结算分组和有效成员数量。
- `POST /api/projects/:projectId/settlement-rule-groups`
  - 创建项目范围分组。
- `POST /api/projects/:projectId/settlement-rule-groups/:groupId/assignments`
  - 通过审计原因和影响预览，添加、变更或关闭带生效日期的成员关系。
- `POST /api/projects/:projectId/settlement-rule-groups/:groupId/archive`
  - 只有在所有指向该分组的 active 规则和未来成员关系均已处理后，才归档分组。
- `POST /api/projects/:projectId/settlement-rules/validate`
  - 校验高级模式公式，并返回带类型 AST、确定性解释、合同差异和错误。
- `POST /api/projects/:projectId/settlement-rules/simulate`
  - 运行历史、合成和用户示例预览，返回覆盖率和风险摘要。
- `GET /api/projects/:projectId/settlement-rules`
  - 列出 active、draft、pending、changes-requested 和 archived 版本。
- `POST /api/projects/:projectId/settlement-rules`
  - 保存草稿但不提交。
- `POST /api/projects/:projectId/settlement-rules/apply-and-submit`
  - 原子创建版本、附加当前模拟、写入审计记录，并移动到待审核。
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/request-changes`
  - 将待审核版本移为要求修改，并附结构化评论。
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/approve`
  - 激活该版本，并归档上一 active 版本。
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/archive`
  - 带原因归档草稿或 active 规则。
- `POST /api/projects/:projectId/settlement-rules/:ruleVersionId/clone`
  - 在授权目标项目中创建可编辑草稿，不继承审批或 active 状态。
- `GET /api/settlement-rule-templates`
  - 列出演员可用的系统模板和组织模板。
- `POST /api/settlement-rule-templates`
  - 将已确认规则保存为组织模板，不复制项目 ID、审批或历史样本数据。

所有写入路由都要求结算 billing 写权限、组织范围校验和角色检查。只有高风险状态流转要求审计原因；普通 AI 轮次和低风险草稿保存不要求。

## 权限

- `owner`：创建、模拟、提交、要求修改、审批、激活、强制审批、归档和管理组织模板。
- `ops_manager`：创建、模拟、提交、要求修改、审批标准风险规则、激活标准风险规则、归档和管理组织模板。
- `finance`：查看、模拟、评论或要求修改；不能直接激活。
- `operator_business`：使用 AI、创建草稿、模拟和提交 / 请求审核；不能审批或激活。
- `streamer`：不能访问内部规则；可查看个人结算解释摘要。

owner 和 ops manager 可以创建结算分组并变更有效成员关系。finance 和 operator 可以查看分组组成；operator 可以通过审核评论请求成员关系变更，但不能自行激活。

默认情况下，当组织内存在另一个合格审批人时，创建者和审批人必须不同。重大风险规则始终要求不同 owner 审批。如果组织只有一个合格 owner，该 owner 可以使用明确标注的强制审批路径，并需要额外确认和原因；该动作会在审计历史中突出显示。

重大风险包括负毛利、异常总额增长、红证据付款、会改变金额的显式缺失数据默认值、分组级替换规则、重叠分组例外，或输出超过项目安全上限。

激活、强制审批、active 规则归档和任何生效期变更都是高风险结算动作，需要审计原因。退回要求修改需要评论，但不需要高风险原因。

## 错误处理

校验错误应具体明确：

- 未解决的业务歧义；
- 合同与公式不匹配；
- 未知变量；
- 未知函数；
- 参数数量错误；
- 单位不匹配；
- 原始金额或费率字面量没有单位；
- 执行粒度不兼容；
- 循环或后续层依赖；
- 目标重叠或组合优先级冲突；
- 公式过于复杂；
- 缺失必需输入；
- 部分数据覆盖但没有明确策略；
- 可能产生负输出；
- 输出超过配置安全上限；
- 策略禁止时仍对红证据付款；
- 模拟样本不可用；
- 合同、参数、目录或公式变更后模拟过期。

生产结算生成只遵循 active 规则声明的缺失数据策略。所有其他 active 自定义规则失败都会阻断生成。响应应识别规则版本、失败层和安全错误类别，同时不泄露未授权数据。

AI 生成可能独立于公式校验失败。在这种情况下，保留会话、已确认合同和用户编辑，展示可重试的 AI 错误，不创建规则版本。公式绝不能因为 AI 描述其有效就变得有效。

## 审计和治理

每次草稿应用、提交、要求修改、审批、强制审批、归档、分组指派变更和激活失败尝试都写入审计记录。

审计记录包括：

- actor；
- role；
- project；
- rule scope；
- version number；
- before/after status；
- formula hash；
- 规则合同和参数 hash；
- 执行粒度和组合顺序；
- 变量目录版本和覆盖率摘要；
- 模拟差额摘要；
- reason；
- 创建者和审批人是否相同；
- 适用时的强制审批确认；
- 适用时的 AI 草稿 ID。

AI prompts、turns、合同修订和响应保留在 `ai_settlement_rule_drafts` 中以便追溯，并仍是组织范围敏感数据。active 公式、compiled AST、参数、已确认业务规则合同、缺失数据策略和已应用版本快照，是产品内的合法计算来源。自由文本 AI 解释永不是合法来源。

## 测试计划

单元测试：

- parser 接受有效公式并拒绝非法语法；
- 类型化字面量将元编译为分、百分比编译为基点，且不向普通用户暴露原始单位；
- validator 拒绝未知变量 / 函数、歧义单位、无效输出合同、循环依赖和过高复杂度；
- 合同差异逻辑在自然语言修订中保留未变化字段；
- 变量适配器将已持久化分和基点字段暴露为带类型金额和费率值；
- 组合按项目、分组和个人层确定性排序，并拒绝优先级相同的重叠规则；
- engine 正确计算 CPT、阶梯、证据折扣、奖金、保底、封顶、CPS 和带符号调整；
- 金额单位适配器防止元 / 分 100 倍错误。

服务测试：

- 未解决的 AI 歧义阻止合同确认；
- AI provider payload 包含 scope 安全元数据，并默认排除原始结算行；
- AI 草稿不能直接变成 active；
- 强制同一目标只能有一个 active 规则；
- 过期模拟阻止提交或激活；
- apply-and-submit 是原子的；
- 要求修改保留评论，并在编辑后要求新模拟；
- 重大风险审批强制要求不同 owner，或显式单 owner 强制路径；
- 结算分组指派强制组织 / 项目归属、生效区间、审计回填和新鲜模拟；
- 审批会归档旧 active 版本；
- 角色权限与矩阵匹配；
- 声明的缺失数据策略严格按配置路由、阻断或使用已批准默认值；
- 生产生成在未声明的 active 自定义规则失败时阻断；
- 没有 active 自定义层时使用现有固定规则；存在 active 自定义规则时不会静默兜底。

路由测试：

- 未登录和未授权请求失败；
- billing 写入 guard 阻止写入；
- AI session、变量目录、分组、模板、校验、模拟、apply-and-submit、request-changes、approve、clone 和 archive 路由正确映射错误；
- 高风险流转需要审计原因。

集成 / 回归测试：

- 应付批次按优先级顺序组合项目基础、冻结主播分组修饰器和项目主播例外；
- 未分组的现有项目主播继续使用项目基础规则，并在模拟覆盖率中展示；
- 带生效日期的分组变更影响未来合格工作，而不改变已锁定历史；
- 没有自定义基础规则时，应付批次回落到冻结的 `project_streamers` 基础规则；
- 周期保底和封顶在 `project_streamer_period` 粒度只执行一次；
- 应收批次级基础费在批次粒度只执行一次；
- 转复核项不进入计算总额，并在解决前阻断确认；
- 明细快照包含每个已应用层、合同和公式 hash、分组快照、输入、输出、缺失数据决策和确定性解释；
- 规则更新后，已锁定历史批次不改变；
- 对账根据自定义检查提示 warn 或 block。

UI 测试：

- 必需业务含义存在歧义时，AI 提出聚焦问题；
- 普通模式确认中文业务规则合同，高级公式编辑保持折叠；
- 用户侧金额和费率显示为元和百分比；
- 每个状态只出现一个主操作；
- “应用并提交审核”原子创建并提交一个绑定模拟的版本；
- 自然语言修订展示业务差异并保留未受影响条件；
- 要求修改会将规则返回可编辑状态；
- 审批需要原因；
- 模拟展示当前 / 新规则 / 差额金额、覆盖率、零结算数量、转复核数量和风险提示；
- 键盘焦点和状态播报覆盖 AI 回复、校验错误、模拟完成和审批弹窗；
- 主播视图只接收个人解释摘要。

## 上线计划

Phase 1：低成本创作、类型化 DSL 和只读模拟。

- 增加项目变量目录、业务规则合同、类型化 parser、validator、engine、确定性解释和测试。
- 在 feature flag 后增加多轮 AI 澄清和自然语言修订。
- 增加 AI 草稿和模拟存储，用于带数据就绪覆盖率的历史、合成边界和用户示例模拟。
- 增加常见只读系统模板。
- 将公式编辑放在折叠的高级模式内。

Phase 2：草稿和审批。

- 增加规则版本表、RLS、repositories、services 和 routes。
- 增加原子 apply-and-submit、request-changes、不同人审批、force approval 和 archive 工作流。
- 增加审计和版本 UI。
- 增加结算分组表、带生效日期的指派和分组管理 UI。
- 增加组织模板、clone-to-draft 和参数编辑。

Phase 3：应付和应收执行。

- 将基础、分组和个人组合接入结算批次生成。
- 增加 report、project-streamer-period、batch 和 project-period 执行粒度。
- 增加缺失数据复核异常和确认前门槛。
- 持久化明细快照。
- 保留固定规则兜底。

Phase 4：外部成本和对账。

- 将外部成本规则执行接入成本项草稿流程。
- 将自定义对账检查接入确认 / 锁定门槛。

Phase 5：加固。

- 增加更大周期模拟和性能调优。
- 增加更丰富的组织模板治理和使用分析。
- 增加 AI 辅助，将遗留结构化规则迁移为已确认合同。
- 为规则解释增加导出字段。

## 实施默认值

第一版实施计划使用以下默认值：

- 自然语言会话和中文业务规则合同是主要创作体验。文本公式编辑、语法高亮和编译单位预览放在折叠高级模式。第一版不要构建完整块编辑器。
- AI 必须先解决必需歧义，才能生成公式；第一版必须支持自然语言修订，并保留业务差异。
- 普通 UI 和公式字面量使用元和百分比；编译器和持久化层使用分和基点。
- 显示一个状态感知主操作。应用已就绪规则会在一个事务中创建并提交绑定模拟的草稿；绝不直接激活。
- operator 可以创建、模拟和提交 / 请求审核。只有 owner 和 ops manager 可以审批激活或归档 active 规则。
- 标准审批在存在其他合格审批人时使用不同审批人。重大风险规则要求不同 owner；单 owner 组织使用显式 force-approval 路径。
- 使用项目基础、冻结主播分组修饰器和项目主播例外层，并采用确定性优先级。拒绝歧义重叠。
- 冻结与结算相关的主播分组成员关系，并在明细快照中持久化已应用成员关系。
- 使用特定 scope 和执行粒度的变量白名单。应收、应付、外部成本和对账规则不共享一个全局变量表面。
- 激活前要求数据就绪覆盖率和新鲜历史 / 合成模拟。每个可选输入都有明确缺失数据策略。
- 在第一版可用版本中包含常见模板、具名参数、clone-to-draft 和组织模板保存。
- 外部成本公式默认创建 `draft` 成本项。这些成本项进入项目对账前需要单独确认动作。
- 在配置中设置公式复杂度限制，初始默认值保守：序列化公式小于 16 KB、AST 深度小于 20、AST 节点小于 300，且单个计算金额输出不得超过项目级安全上限，除非记录了 owner force approval。
- 如果公式模拟产生负毛利、异常总额增长、红证据付款、重叠分组例外，或会实质影响结算的显式缺失数据默认值，则要求 owner force reason。
