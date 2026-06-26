# AI 生产执行与审计一体化引擎设计

## 目标

在已落地的 AI 运行时账本（`ai_invocations` / `llm-gateway` / `invocation-ledger`）之上，
新增一道**生产级确定性闸门**：任何一次准备落库或执行的 AI 产出，必须先通过四道闸门，
否则拒绝生成可执行结果，并标记为「不合格 AI 输出」。

引擎不生成 AI 内容，只做裁决，是纯函数、可单测、可在业务路径同步调用。

## 四道闸门

1. **真实性**：必须是真实大模型调用，`model_name`、`request_id`/`trace_id`、`prompt_input`、
   `response_output`、`token_usage(input/output)`、`latency`、`timestamp` 全部齐全；缺任一字段 →
   判定为非生产级 AI 调用。
2. **落地性**：输出必须能映射到 ERP 业务对象（project / host / settlement / review /
   schedule / revenue / cost / share）；无法映射 → 不可落地。
3. **流程嵌入**：必须绑定至少一个流程节点（审核 / 结算 / 排班 / 对账 / 复盘 / 风控）；
   未绑定 → AI 能力未进入业务流。
4. **结构化**：必须是严格结构化对象（结论 / 建议 / 可执行动作），禁止用自然语言替代结构数据。

附加治理：高风险可执行动作不能自动执行（`自动执行: true` 且缺 `需人工审批` → 越权，判定不通过），
与现有 Agent 输出契约「recommendations 必须 requiresHumanApproval」一致。

## 公共接口

- `auditAiProduction(input): ProductionAuditVerdict` —— 主裁决入口。
- `assertProductionGrade(input)` —— 不通过时抛出「不合格 AI 输出」，供业务路径拒绝执行。
- `auditGatewayInvocation({ gatewayResult, ... })` —— 直接接入 `runAiGateway` 结果的适配器。
- `POST /api/ai/audit` —— 仅 MCN 内部员工可访问的审计端点。

类型与字典：`BUSINESS_OBJECT_TYPES`、`PROCESS_NODES`、`AiAuthenticitySignals`、
`ExecutableAction`、`ProductionAuditVerdict`，业务对象/流程节点支持中英别名归一
（如 `live_report → review`、`auto_review → 审核`）。

## 标准裁决格式

```json
{
  "是否真实AI调用": true,
  "调用可信等级": "高",
  "业务对象映射": ["project"],
  "流程节点": "复盘",
  "是否可执行": true,
  "是否可入库": true,
  "是否通过自检": true,
  "AI输出内容": { "结论": "", "建议": "", "可执行动作": [] },
  "风险项": [],
  "缺失字段": [],
  "最终判定": "通过"
}
```

`调用可信等级` 按真实性 + 可追踪/可审计/可计费信号分级（高 / 中 / 低 / 无）；
非真实调用恒为「无」。`缺失字段` 使用规范 snake_case 名（`model_name`、`token_usage`、
`business_object_mapping`、`process_node`、`structured_output` 等）。

## 边界

- 不替换现有 `llm-gateway` schema 校验，而是在其之上做业务级落地裁决。
- 不直接写库、不调用 provider；只读裁决，可在 ledger 写入前作为门禁。
- 不放宽「只读工具 / 人工审批」既有安全约束，反而把它编码进闸门。

## 测试

- `features/ai/production-auditor.test.ts`：四道闸门、治理越权、可信分级、适配器。
- `app/api/ai/audit/route.test.ts`：鉴权、员工门控、通过/不通过响应形状。
- 纳入 `pnpm test:ai-system`（聚合 `features/ai` 与 `app/api/ai`）。
